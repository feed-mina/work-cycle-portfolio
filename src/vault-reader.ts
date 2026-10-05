/* vault-reader.ts — 옵시디언 Markdown을 읽어주기 친화적인 안전한 HTML로 변환 */

type VaultMeta = Record<string, string>;

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function yamlScalar(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))))
    return v.slice(1, -1).trim();
  return v;
}

function splitFrontmatter(markdown: string): { body: string; meta: VaultMeta } {
  const normalized = markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") return { body: normalized, meta: {} };

  const end = lines.slice(1, 201).findIndex((line) => line.trim() === "---");
  if (end < 0) return { body: normalized, meta: {} };

  const meta: VaultMeta = {};
  for (const line of lines.slice(1, end + 1)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m && m[2].trim()) meta[m[1].toLowerCase()] = yamlScalar(m[2]);
  }
  return { body: lines.slice(end + 2).join("\n"), meta };
}

function plainInline(value: string): string {
  return value
    .replace(/!\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeHref(value: string): string | null {
  const v = value.trim();
  if (v.startsWith("#")) return v;
  try {
    const url = new URL(v);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function inlineMarkdown(value: string): string {
  const tokens: string[] = [];
  const token = (html: string) => `\u0000${tokens.push(html) - 1}\u0000`;
  let source = value.replace(/\u0000/g, "");

  source = source.replace(/`([^`]+)`/g, (_, code: string) => token(`<code>${esc(code)}</code>`));
  source = source.replace(/!\[\[([^\]]+)\]\]/g, (_, label: string) =>
    token(`<span class="attachment">첨부: ${esc(plainInline(label))}</span>`));
  source = source.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, _target: string, label: string) =>
    token(esc(plainInline(label))));
  source = source.replace(/\[\[([^\]]+)\]\]/g, (_, label: string) => token(esc(plainInline(label))));
  source = source.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, label: string) =>
    token(`<span class="attachment">첨부: ${esc(label || "이미지")}</span>`));
  source = source.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_, label: string, href: string) => {
      const safe = safeHref(href);
      return safe
        ? token(`<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`)
        : token(esc(label));
    });

  let html = esc(source)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, "$1<em>$2</em>")
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, "$1<em>$2</em>");

  return html.replace(/\u0000(\d+)\u0000/g, (_, index: string) => tokens[Number(index)] ?? "");
}

function tableCells(line: string): string[] {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  return value.split("|").map((cell) => cell.trim());
}

function isTableDivider(line: string): boolean {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isHorizontalRule(line: string): boolean {
  return /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line);
}

function calloutLabel(type: string): string {
  const labels: Record<string, string> = {
    decision: "결정", summary: "요약", warning: "주의", caution: "주의",
    note: "참고", info: "안내", tip: "도움말", check: "확인",
    important: "중요", question: "질문", todo: "할 일",
  };
  return labels[type.toLowerCase()] || "참고";
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  return /^\s*$/.test(line) || /^\s{0,3}#{1,6}\s+/.test(line) || /^\s*```/.test(line) ||
    /^\s*>/.test(line) || /^\s*(?:[-+*]|\d+\.)\s+/.test(line) || isHorizontalRule(line) ||
    (line.includes("|") && isTableDivider(lines[index + 1] ?? ""));
}

function renderBlocks(markdown: string): string {
  const lines = markdown.replace(/<!--[^]*?-->/g, "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || /^\s*<!--/.test(line)) { i++; continue; }
    if (isHorizontalRule(line)) { i++; continue; }

    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      out.push(`<pre${fence[1] ? ` aria-label="${esc(fence[1])} 코드"` : ""}><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = Math.max(2, Math.min(6, heading[1].length + 1));
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (line.includes("|") && isTableDivider(lines[i + 1] ?? "")) {
      const headers = tableCells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(tableCells(lines[i++]));
      out.push(`<div class="table-wrap"><table><thead><tr>${headers.map((cell) => `<th scope="col">${inlineMarkdown(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) =>
        `<tr>${headers.map((_, col) => `<td>${inlineMarkdown(row[col] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      const callout = quote[0]?.match(/^\[!([A-Za-z0-9_-]+)\]\s*(.*)$/);
      if (callout) {
        const label = callout[2].trim() || calloutLabel(callout[1]);
        const content = quote.slice(1).join(" ").trim();
        out.push(`<aside class="callout callout-${esc(callout[1].toLowerCase())}"><p class="callout-title">${inlineMarkdown(label)}</p>${content ? `<p>${inlineMarkdown(content)}</p>` : ""}</aside>`);
      } else {
        out.push(`<blockquote><p>${inlineMarkdown(quote.join(" "))}</p></blockquote>`);
      }
      continue;
    }

    const list = line.match(/^(\s*)([-+*]|\d+\.)\s+(.+)$/);
    if (list) {
      const ordered = /\d+\./.test(list[2]);
      const tag = ordered ? "ol" : "ul";
      const items: string[] = [];
      while (i < lines.length) {
        const item = lines[i].match(/^(\s*)([-+*]|\d+\.)\s+(.+)$/);
        if (!item || /\d+\./.test(item[2]) !== ordered) break;
        const depth = Math.min(4, Math.floor(item[1].replace(/\t/g, "  ").length / 2));
        const task = item[3].match(/^\[([ xX])\]\s+(.+)$/);
        const content = task
          ? `<span class="task-state">${task[1].trim() ? "완료" : "미완료"}</span> ${inlineMarkdown(task[2])}`
          : inlineMarkdown(item[3]);
        items.push(`<li${depth ? ` class="depth-${depth}"` : ""}>${content}</li>`);
        i++;
      }
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    const paragraph = [line.trim()];
    i++;
    while (i < lines.length && !isBlockStart(lines, i)) paragraph.push(lines[i++].trim());
    out.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
  }
  return out.join("\n");
}

export function vaultMarkdownToHtml(markdown: string, fallbackTitle: string): string {
  const { body: rawBody, meta } = splitFrontmatter(markdown);
  let body = rawBody.trim();
  const firstHeading = body.match(/^\s*#\s+(.+?)\s*#*\s*(?:\n|$)/);
  const headingTitle = firstHeading ? plainInline(firstHeading[1]) : "";
  const title = meta.title || headingTitle || fallbackTitle || "문서";

  // YAML title과 첫 H1이 같은 경우 한 번만 읽히도록 본문 쪽 중복 제목을 제거한다.
  if (firstHeading && plainInline(firstHeading[1]).toLocaleLowerCase() === plainInline(title).toLocaleLowerCase())
    body = body.slice(firstHeading[0].length).trimStart();

  const metaRows = [
    ["날짜", meta.date],
    ["프로젝트", meta.project],
    ["상태", meta.status],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  const metaHtml = metaRows.length
    ? `<dl class="meta">${metaRows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${inlineMarkdown(value)}</dd></div>`).join("")}</dl>`
    : "";

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<style>
:root{--bg:#f7f5f2;--paper:#fff;--ink:#24211f;--muted:#716b66;--line:#ded9d3;--accent:#795b47;--soft:#f2ebe5;--code:#f3f1ee}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:'Malgun Gothic','맑은 고딕',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:18px;line-height:1.82;word-break:keep-all;overflow-wrap:anywhere}
main{max-width:900px;margin:0 auto;padding:42px 24px 80px}
article{background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:54px 64px;box-shadow:0 10px 35px rgba(55,45,38,.07)}
header{padding-bottom:24px;margin-bottom:30px;border-bottom:1px solid var(--line)}
h1{font-size:2rem;line-height:1.35;letter-spacing:-.035em;margin:0;color:var(--ink)}
h2{font-size:1.45rem;line-height:1.45;margin:2.2em 0 .65em;padding-bottom:.35em;border-bottom:1px solid var(--line)}
h3{font-size:1.2rem;margin:1.8em 0 .5em}h4,h5,h6{font-size:1.05rem;margin:1.5em 0 .45em}
p{margin:.75em 0}strong{font-weight:800}a{color:#2266a6;text-underline-offset:3px}
ul,ol{margin:.65em 0 1em;padding-left:1.5em}li{margin:.28em 0}.depth-1{margin-left:1.2em}.depth-2{margin-left:2.4em}.depth-3{margin-left:3.6em}.depth-4{margin-left:4.8em}
.meta{display:flex;flex-wrap:wrap;gap:8px 18px;margin:18px 0 0;font-size:.82rem;color:var(--muted)}.meta div{display:flex;gap:7px}.meta dt{font-weight:800}.meta dd{margin:0}
.callout{margin:1.2em 0;padding:16px 20px;border-left:5px solid var(--accent);border-radius:0 12px 12px 0;background:var(--soft)}.callout-title{font-weight:800;margin:0 0 5px}.callout p:last-child{margin-bottom:0}
blockquote{margin:1.2em 0;padding:4px 20px;border-left:4px solid var(--line);color:var(--muted)}
.table-wrap{overflow-x:auto;margin:1.2em 0}table{width:100%;border-collapse:collapse;font-size:.88rem;line-height:1.55}th,td{border:1px solid var(--line);padding:10px 12px;text-align:left;vertical-align:top}th{background:var(--soft);font-weight:800}
code{font-family:Consolas,'Cascadia Mono',monospace;font-size:.88em;background:var(--code);border-radius:5px;padding:.12em .35em;word-break:break-word}pre{overflow:auto;background:#252422;color:#f7f3ef;border-radius:12px;padding:18px 20px;line-height:1.55;font-size:.82rem}pre code{background:none;padding:0;color:inherit;white-space:pre}
.task-state{display:inline-block;padding:1px 8px;border-radius:999px;background:var(--soft);font-size:.72em;font-weight:800;vertical-align:2px}.attachment{color:var(--muted)}
@media(max-width:600px){body{font-size:16px;word-break:normal}main{padding:0}article{border:0;border-radius:0;box-shadow:none;padding:30px 20px 60px}h1{font-size:1.65rem}.meta{display:block}.meta div{margin:3px 0}.table-wrap{margin-left:-8px;margin-right:-8px}}
@media(prefers-color-scheme:dark){:root{--bg:#161514;--paper:#201f1d;--ink:#f2eeea;--muted:#b8b0aa;--line:#45413d;--accent:#d0a98d;--soft:#322c28;--code:#302d2a}article{box-shadow:none}a{color:#8bc1f0}pre{background:#111}}
@media print{body{background:#fff;font-size:12pt}main{max-width:none;padding:0}article{border:0;box-shadow:none;padding:0}pre{white-space:pre-wrap}}
</style></head><body><main><article>
<header><h1>${inlineMarkdown(title)}</h1>${metaHtml}</header>
${renderBlocks(body)}
</article></main></body></html>`;
}

/* ── html 노트 정제 ─────────────────────────────────────────────────────────
 * 볼트의 .html 보고서를 앱 안에서 열 때 쓴다. Workers 에는 DOM 이 없어 정규식으로 걷어낸다.
 * 이것만 믿지 않고 /api/vault/file 의 CSP(default-src 'none') 가 스크립트·외부 자원을 한 번 더 막는다.
 * 걷어내는 것: script/iframe/object/embed/frame/applet/base/form/link 태그, on* 속성, javascript:/data: 주소,
 *              meta refresh. 링크에는 rel="noopener noreferrer" 를 붙인다. */
export function sanitizeHtml(html: string): string {
  let out = String(html).replace(/^\uFEFF/, "");
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/<(script|iframe|object|embed|frame|frameset|applet|noscript|form|link|base|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  out = out.replace(/<(script|iframe|object|embed|frame|frameset|applet|noscript|form|link|base|template|input|button|select|textarea)\b[^>]*\/?>/gi, "");
  out = out.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, "");
  // 속성: on*="…", javascript:/vbscript:/data: 주소
  out = out.replace(/<[^>]+>/g, (tag) => {
    let t = tag.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    t = t.replace(/\s+(href|src|action|formaction|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (m, attr: string, val: string) => {
      const v = val.replace(/^["']|["']$/g, "").trim().replace(/[\u0000-\u0020]+/g, "");
      return /^(javascript|vbscript|data):/i.test(v) ? "" : m;
    });
    if (/^<a\b/i.test(t)) t = t.replace(/\s+rel\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/^<a\b/i, '<a rel="noopener noreferrer" target="_blank"');
    return t;
  });
  return out;
}

/** html → 읽을 수 있는 텍스트 (md 내려받기·AI 요약용). 줄 구조만 대강 살린다. */
export function htmlToText(html: string): string {
  return sanitizeHtml(html)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer|br|pre|blockquote)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
