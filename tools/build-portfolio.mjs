#!/usr/bin/env node
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "portfolio-dist");
const SRC = join(ROOT, "public");
const DEMO = join(ROOT, "portfolio");

// The public bundle is an explicit allowlist. Reference catalogs and private reports stay out.
const pages = ["personal", "meetings", "schedule", "kanban", "roadmap", "personal-dashboard", "dashboard", "report", "more"];
const assets = [
  "acc.js", "edit.js", "ext.js", "logo.svg", "meeting-share-manager.css", "meeting-share-manager.js",
  "meeting-sharing.js", "membership.js", "mobile.css", "mobile.js", "mode-switch.js", "personal-edit.js",
  "personal-ui.js", "personal.css", "principles.js", "quick.js", "roadmap-action-checks.js", "roadmap-context.js",
  "roadmap.css", "roadmap.js", "style.css", "theme.js",
];
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


function shell(title, body) {
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title><link rel="icon" href="/logo.svg"><link rel="stylesheet" href="/style.css"></head><body class="theme-airtable"><main class="wrap demo-landing">' + body + '</main></body></html>';
}
const landing = shell("work-cycle 공개 체험", '<section class="card"><p>로그인 없이 사용 · 예시 데이터</p><h1>work-cycle 공개 체험</h1><p>회의록을 확인하고, 칸반에서 일을 진행한 뒤 결과를 주간보고로 모아 보세요.</p><div class="demo-entry"><a class="btn2" href="/meetings?tab=list&amp;tour=1">3분 핵심 체험</a><a class="btn2 ghost" href="/personal">자유롭게 둘러보기</a></div><p>입력한 기록은 이 브라우저에만 저장됩니다. 요약과 공유 링크는 예시로 체험합니다.</p></section><nav class="card demo-entry" aria-label="체험 화면"><a href="/roadmap">통합 로드맵</a><a href="/meetings?tab=list">회의록과 공유 관리</a><a href="/schedule">스케줄</a><a href="/kanban">칸반</a><a href="/personal-dashboard">나의 준비 현황</a><a href="/report">주간보고</a><a href="/dashboard">검증 대시보드</a></nav>');
const share = shell("공유 링크 체험", '<section class="card"><p>이 브라우저에서만 열리는 예시 링크</p><h1 id="demoShareTitle"></h1><pre id="demoShareBody"></pre><a href="/meetings?tab=list">회의록으로 돌아가기</a></section>');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const page of pages) {
  const file = page + ".html";
  let html = readFileSync(join(SRC, file), "utf8");
  html = html.replace(/(href="\/dashboard") data-mode="company"/g, "$1");
  if (page === "meetings") {
    html = html.replace(/서버에는 주소의 해시값만 보관합니다\.[^<]+/, "공유 상태와 링크는 이 브라우저에서 체험할 수 있어요. 다른 기기나 브라우저에서는 예시 링크를 열 수 없습니다.");
  }
  if (page === "roadmap") {
    html = html.replace(/<script src="\/(?:roadmap-guides|ai-content-guides|roadmap-references|roadmap-reference-view|roadmap-progress|roadmap-actions)\.js" defer><\/script>\s*/g, "");
  }
  html = inject(html, file);
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(script[1]);
  writeFileSync(join(OUT, file), html);
}
for (const file of assets) {
  const source = join(SRC, file);
  if (file === "mode-switch.js") {
    const code = readFileSync(source, "utf8").replace(", '/dashboard': '/personal-dashboard'", "");
    writeFileSync(join(OUT, file), code);
  } else if (file === "roadmap-action-checks.js") {
    writeFileSync(join(OUT, file), readFileSync(source, "utf8").replace("계정에 저장됨", "이 브라우저에 저장됨"));
  } else cpSync(source, join(OUT, file));
}
writeFileSync(join(OUT, "index.html"), inject(landing, "index.html"));
writeFileSync(join(OUT, "share-demo.html"), inject(share, "share-demo.html"));
for (const file of ["demo-api.js", "demo.css"]) cpSync(join(DEMO, file), join(OUT, file));
new Function(readFileSync(join(OUT, "demo-api.js"), "utf8"));
console.log("Portfolio build complete: " + pages.length + " interactive screens and local share preview");
