/* notedoc.ts — 회의 메모 → 산출물(md · html) 고정 포맷
   "목적을 알 수 있게 상세히" — 무엇을 정하려던 회의였는지가 맨 위에 오도록 고정합니다. */

export type NoteNode = { d: number; m: string; t: string; who?: string; due?: string };
export type NoteRow = {
  id: number; date: string; title: string; purpose: string; attendees: string;
  updated_at?: string;
};

const WD = ["일", "월", "화", "수", "목", "금", "토"];
export const MARK_LABEL: Record<string, string> = {
  star: "중요", decide: "결정", todo: "할 일", need: "확인 필요",
};
const MARK_ICON: Record<string, string> = {
  star: "★", decide: "◆", todo: "☑", need: "❓",
};

function dow(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  return isNaN(d.getTime()) ? "" : WD[d.getUTCDay()];
}
const pick = (ns: NoteNode[], m: string) => ns.filter((n) => n.m === m && n.t.trim());

/* ── Markdown ──────────────────────────────────────────────── */
export function noteToMd(row: NoteRow, nodes: NoteNode[]): string {
  const L: string[] = [];
  L.push(`# ${row.title || "회의 메모"}`, "");
  L.push("> **이 회의로 정하려는 것**  ");
  L.push("> " + (row.purpose?.trim() || "_(목적이 적히지 않았습니다 — 다음 회의에는 먼저 적어주세요)_"));
  L.push("");
  L.push("| 항목 | 내용 |", "|---|---|");
  L.push(`| 날짜 | ${row.date} (${dow(row.date)}) |`);
  L.push(`| 참석 | ${row.attendees?.trim() || "—"} |`);
  L.push(`| 기록 | work-cycle 회의 메모 |`);
  L.push("");

  const decide = pick(nodes, "decide");
  L.push("## 결정된 것");
  L.push(decide.length ? decide.map((n) => `- ${n.t.trim()}`).join("\n")
                       : "_이번 회의에서 확정된 사항이 없습니다._");
  L.push("");

  const todos = pick(nodes, "todo");
  L.push("## 할 일 — 누가 · 무엇을 · 언제까지");
  if (todos.length) {
    L.push("| 담당 | 할 일 | 기한 |", "|---|---|---|");
    todos.forEach((n) => L.push(`| ${n.who?.trim() || "미정"} | ${n.t.trim()} | ${n.due || "미정"} |`));
    L.push("");
    L.push(...todos.map((n) => `- [ ] ${n.who?.trim() ? `(${n.who.trim()}) ` : ""}${n.t.trim()}${n.due ? ` — ${n.due}까지` : ""}`));
  } else {
    L.push("_할 일로 표시된 항목이 없습니다._");
  }
  L.push("");

  const need = pick(nodes, "need");
  if (need.length) {
    L.push("## 확인이 필요한 것", ...need.map((n) => `- ${n.t.trim()}`), "");
  }
  const star = pick(nodes, "star");
  if (star.length) {
    L.push("## 중요 표시", ...star.map((n) => `- ${n.t.trim()}`), "");
  }

  L.push("## 회의 메모 전문");
  const body = nodes.filter((n) => n.t.trim());
  L.push(body.length
    ? body.map((n) => `${"  ".repeat(n.d)}- ${n.m ? MARK_ICON[n.m] + " " : ""}${n.t.trim()}` +
        (n.m === "todo" && (n.who || n.due) ? ` _(${[n.who, n.due && n.due + "까지"].filter(Boolean).join(" · ")})_` : "")).join("\n")
    : "_메모가 비어 있습니다._");
  L.push("");
  return L.join("\n");
}

/* ── HTML (인쇄하면 그대로 PDF) ────────────────────────────── */
function esc(s: string): string {
  return (s ?? "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function noteToHtml(row: NoteRow, nodes: NoteNode[]): string {
  const decide = pick(nodes, "decide"), todos = pick(nodes, "todo");
  const need = pick(nodes, "need"), star = pick(nodes, "star");
  const body = nodes.filter((n) => n.t.trim());

  const sec = (title: string, inner: string, empty: string) =>
    `<section><h2>${esc(title)}</h2>${inner || `<p class="none">${esc(empty)}</p>`}</section>`;

  const ul = (ns: NoteNode[]) =>
    ns.length ? `<ul>${ns.map((n) => `<li>${esc(n.t.trim())}</li>`).join("")}</ul>` : "";

  const todoTable = todos.length ? `<table class="todo">
    <thead><tr><th>담당</th><th>할 일</th><th>기한</th></tr></thead>
    <tbody>${todos.map((n) => `<tr>
      <td class="who">${esc(n.who?.trim() || "미정")}</td>
      <td>${esc(n.t.trim())}</td>
      <td class="due ${n.due ? "" : "no"}">${esc(n.due || "미정")}</td>
    </tr>`).join("")}</tbody></table>` : "";

  const tree = body.length ? `<ol class="tree">${body.map((n) => `<li class="d${n.d}${n.m ? " m-" + n.m : ""}">
      ${n.m ? `<b class="mk">${MARK_ICON[n.m]} ${esc(MARK_LABEL[n.m])}</b>` : ""}
      <span>${esc(n.t.trim())}</span>
      ${n.m === "todo" && (n.who || n.due)
        ? `<em>${esc([n.who, n.due && n.due + "까지"].filter(Boolean).join(" · "))}</em>` : ""}
    </li>`).join("")}</ol>` : "";

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(row.title || "회의 메모")} — ${esc(row.date)}</title>
<style>
:root{--ink:#1a1a1a;--ink2:#4a4a4a;--ink3:#8a8a8a;--line:#e4e4e7;--accent:#2563eb;
  --ok:#16a34a;--warn:#c2870b;--bg:#fafafa;--card:#fff}
*{box-sizing:border-box}
body{margin:0;padding:32px 20px 64px;background:var(--bg);color:var(--ink);
  font-family:'Malgun Gothic','맑은 고딕',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  font-size:15px;line-height:1.75;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.doc{max-width:860px;margin:0 auto;background:var(--card);border:1px solid var(--line);
  border-radius:14px;padding:36px 40px}
h1{font-size:26px;font-weight:800;letter-spacing:-.02em;margin:0 0 18px}
.purpose{border-left:4px solid var(--accent);background:#eff6ff;border-radius:0 10px 10px 0;
  padding:14px 18px;margin:0 0 20px}
.purpose b{display:block;font-size:12px;font-weight:800;color:var(--accent);
  letter-spacing:.04em;margin-bottom:4px}
.purpose p{margin:0;font-size:15.5px;font-weight:600}
.purpose p.none{color:var(--ink3);font-weight:400}
table{width:100%;border-collapse:collapse;margin:0 0 22px;font-size:14px}
th,td{border:1px solid var(--line);padding:8px 11px;text-align:left;vertical-align:top}
th{background:#f4f4f5;font-weight:700;color:var(--ink2);font-size:12.5px;white-space:nowrap}
table.meta th{width:88px}
table.todo td.who{white-space:nowrap;font-weight:700}
table.todo td.due{white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--warn);font-weight:700}
table.todo td.due.no{color:var(--ink3);font-weight:400}
section{margin:0 0 26px;page-break-inside:avoid}
h2{font-size:16px;font-weight:800;margin:0 0 10px;padding-bottom:6px;border-bottom:2px solid var(--line)}
ul{margin:0 0 8px;padding-left:22px}
li{margin:3px 0}
p.none{color:var(--ink3);font-size:14px;margin:0}
ol.tree{list-style:none;margin:0;padding:0}
ol.tree li{position:relative;padding:3px 0 3px 14px;border-left:2px solid var(--line);margin-left:2px}
ol.tree li.d1{margin-left:22px}ol.tree li.d2{margin-left:44px}ol.tree li.d3{margin-left:66px}
ol.tree li.d4{margin-left:88px}ol.tree li.d5{margin-left:110px}
ol.tree .mk{display:inline-block;font-size:11px;font-weight:800;border-radius:5px;
  padding:1px 7px;margin-right:7px;vertical-align:1px;white-space:nowrap}
ol.tree li.m-decide{border-left-color:var(--accent)}
ol.tree li.m-decide .mk{background:#dbeafe;color:#1d4ed8}
ol.tree li.m-todo{border-left-color:var(--ok)}
ol.tree li.m-todo .mk{background:#dcfce7;color:#15803d}
ol.tree li.m-need{border-left-color:var(--warn)}
ol.tree li.m-need .mk{background:#fef3c7;color:#a16207}
ol.tree li.m-star .mk{background:#fee2e2;color:#b91c1c}
ol.tree em{color:var(--ink3);font-size:12.5px;font-style:normal;margin-left:8px}
footer{max-width:860px;margin:16px auto 0;color:var(--ink3);font-size:12px;text-align:right}
@media print{
  body{background:#fff;padding:0;font-size:11.5pt}
  .doc{border:0;border-radius:0;padding:0;max-width:none}
  h1{font-size:20pt}
  @page{margin:16mm}
}
</style></head><body>
<article class="doc">
  <h1>${esc(row.title || "회의 메모")}</h1>
  <div class="purpose"><b>이 회의로 정하려는 것</b>
    ${row.purpose?.trim()
      ? `<p>${esc(row.purpose.trim())}</p>`
      : `<p class="none">목적이 적히지 않았습니다 — 다음 회의에는 먼저 적어주세요.</p>`}</div>
  <table class="meta"><tbody>
    <tr><th>날짜</th><td>${esc(row.date)} (${dow(row.date)})</td></tr>
    <tr><th>참석</th><td>${esc(row.attendees?.trim() || "—")}</td></tr>
    <tr><th>기록</th><td>work-cycle 회의 메모</td></tr>
  </tbody></table>
  ${sec("결정된 것", ul(decide), "이번 회의에서 확정된 사항이 없습니다.")}
  ${sec("할 일 — 누가 · 무엇을 · 언제까지", todoTable, "할 일로 표시된 항목이 없습니다.")}
  ${need.length ? sec("확인이 필요한 것", ul(need), "") : ""}
  ${star.length ? sec("중요 표시", ul(star), "") : ""}
  ${sec("회의 메모 전문", tree, "메모가 비어 있습니다.")}
</article>
<footer>work-cycle · ${esc(row.date)}</footer>
</body></html>`;
}
