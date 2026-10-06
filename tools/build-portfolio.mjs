#!/usr/bin/env node
/* tools/build-portfolio.mjs — 공개 데모(portfolio-dist/) 빌드
 *
 * 운영 화면 public/ 을 그대로 복사하고, 각 HTML <head> 맨 앞에
 *   - CSP(meta): connect-src 'none' — 네트워크 요청은 정적 파일·폰트뿐
 *   - /demo-api.js — /api/* 를 브라우저 안에서 처리하는 가짜 API (portfolio/demo-api.js)
 *   - /demo.css    — 데모 배너
 * 를 끼운다. 운영 HTML·JS·CSS 는 한 글자도 고치지 않는다(복사본에만 끼움).
 *
 * 범위 밖 화면(회사 마이페이지 /, 검증 대시보드, 나의 준비 현황, 주간보고)은 같은 헤더를 가진 안내 페이지로 바꾼다.
 * 루트(/)는 개인 마이페이지(/personal)로 보낸다.
 *
 * 사용: node tools/build-portfolio.mjs   →  portfolio-dist/
 *       npx wrangler deploy --config wrangler.portfolio.toml
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "public");
const DEMO = join(ROOT, "portfolio");
const OUT = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(ROOT, "portfolio-dist");

/** 범위 밖 화면 → 안내 페이지 (탭 이름은 personal.html 헤더의 href 와 같아야 'on' 표시가 붙는다) */
const OUT_OF_SCOPE = {
  "dashboard.html": { href: "/dashboard", title: "검증 대시보드", why: "팀 검증 기록을 모아 보는 회사용 화면입니다. 공개 데모는 개인용 화면만 담았습니다." },
  "personal-dashboard.html": { href: "/personal-dashboard", title: "나의 준비 현황", why: "기간별 결과·계획·회고 집계 화면입니다. 1차 공개 범위(개인 마이페이지 · 회의록 · 칸반 · 스케줄)에 들어 있지 않습니다." },
  "report.html": { href: "/report", title: "주간보고", why: "한 주 기록을 보고 양식으로 모아 AI 로 다듬는 화면입니다. 1차 공개 범위에 들어 있지 않습니다." },
};
const SKIP = new Set(["index.html", "downloads"]);   // 회사 마이페이지 · 바탕화면 배너 실행 파일

const CSP = [
  "default-src 'self'",
  "connect-src 'none'",
  "img-src 'self' data:",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'self'",
].join("; ");
const INJECT = `\n<meta http-equiv="Content-Security-Policy" content="${CSP}">\n<script src="/demo-api.js"></script>\n<link rel="stylesheet" href="/demo.css">`;

function inject(html, file) {
  const re = /<meta name="viewport"[^>]*>/;
  if (!re.test(html)) throw new Error(`${file}: <meta name="viewport"> 가 없어 데모 스크립트를 끼울 자리를 못 찾았습니다`);
  return html.replace(re, (m) => m + INJECT);
}

/** personal.html 의 <head> 링크·헤더를 그대로 빌려 안내 페이지를 만든다 */
function noticePage(personalHtml, { href, title, why }) {
  const header = personalHtml.match(/<header class="top">[\s\S]*?<\/header>/)?.[0];
  if (!header) throw new Error("personal.html 에서 <header class=\"top\"> 를 찾지 못했습니다");
  const nav = header.replace(/ class="on"/g, "").replace(`href="${href}"`, `href="${href}" class="on"`);
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${INJECT}
<title>work-cycle · ${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="icon" type="image/svg+xml" href="/logo.svg?v=27-apricot">
<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/personal.css">
<link rel="stylesheet" href="/mobile.css">
<script src="/mobile.js" defer></script>
</head>
<body class="theme-material" data-work-mode="personal">
<script src="/theme.js"></script><script src="/mode-switch.js"></script>
<div class="wrap">
${nav}
<div class="card sig">
  <h2>${title} — 공개 데모에서는 제공하지 않는 화면입니다</h2>
  <p class="sub">${why}</p>
  <p style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 0">
    <a class="btn2" href="/personal" style="text-decoration:none">개인 마이페이지로</a>
    <a class="btn2 ghost" href="/meetings" style="text-decoration:none">회의록</a>
    <a class="btn2 ghost" href="/kanban" style="text-decoration:none">칸반</a>
    <a class="btn2 ghost" href="/schedule" style="text-decoration:none">스케줄</a>
  </p>
</div>
<footer>work-cycle · 공개 데모 — 허구 예시 데이터</footer>
</div>
<script src="/quick.js"></script>
<script src="/membership.js"></script>
<script src="/acc.js"></script>
<script src="/principles.js"></script>
</body>
</html>
`;
}

const ROOT_REDIRECT = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0; url=/personal">
<title>work-cycle · 공개 데모</title>
<link rel="icon" type="image/svg+xml" href="/logo.svg?v=27-apricot">
</head>
<body>
<p>공개 데모는 <a href="/personal">개인 마이페이지</a>에서 시작합니다.</p>
</body>
</html>
`;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const personalHtml = readFileSync(join(SRC, "personal.html"), "utf8");
const report = { copied: [], injected: [], notice: [], skipped: [] };

for (const abs of walk(SRC)) {
  const rel = relative(SRC, abs);
  const top = rel.split(/[\\/]/)[0];
  if (SKIP.has(top)) { report.skipped.push(rel); continue; }
  const dest = join(OUT, rel);
  mkdirSync(dirname(dest), { recursive: true });
  if (OUT_OF_SCOPE[rel]) { writeFileSync(dest, noticePage(personalHtml, OUT_OF_SCOPE[rel])); report.notice.push(rel); continue; }
  if (rel.endsWith(".html")) { writeFileSync(dest, inject(readFileSync(abs, "utf8"), rel)); report.injected.push(rel); continue; }
  cpSync(abs, dest); report.copied.push(rel);
}
writeFileSync(join(OUT, "index.html"), ROOT_REDIRECT);
for (const f of ["demo-api.js", "demo.css"]) cpSync(join(DEMO, f), join(OUT, f));

// 복사본의 인라인 <script> 문법 검사 (AGENTS.md 2-1 과 같은 방식)
for (const rel of report.injected) {
  const html = readFileSync(join(OUT, rel), "utf8");
  for (const [i, m] of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].entries()) {
    try { new Function(m[1]); } catch (e) { throw new Error(`${rel} 인라인 스크립트 #${i}: ${e.message}`); }
  }
}
new Function(readFileSync(join(OUT, "demo-api.js"), "utf8"));

console.log(`portfolio-dist 빌드 완료 → ${relative(process.cwd(), OUT) || "."}`);
console.log(`  데모 스크립트 삽입: ${report.injected.join(", ")}`);
console.log(`  안내 페이지로 교체: ${report.notice.join(", ")} (+ index.html → /personal)`);
console.log(`  그대로 복사: ${report.copied.length}개 · 제외: ${report.skipped.join(", ")}`);
