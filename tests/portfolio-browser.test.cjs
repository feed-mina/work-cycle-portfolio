/* tests/portfolio-browser.test.cjs — 공개 데모(portfolio-dist/) 브라우저 검증
 *
 * 1) tools/build-portfolio.mjs 로 빌드 → 2) 정적 서버(/personal → personal.html, Workers Assets 규칙) →
 * 3) Chromium 으로 네 화면을 1280px·420px 에서 열어
 *    - 운영 화면의 핵심 부품이 그려지는지 (사이클 6단계 · 주간 블록 · 체크리스트 12개 · 칸반 카드 · 회의록 목록 · 도넛 42칸)
 *    - 조작이 localStorage 에 남고 새로고침 뒤에도 유지되는지 (메모 · 체크 · 카드 추가 · 읽음)
 *    - 페이지 오류 0 · alert/confirm 0 · 가로 넘침 0 · 네트워크 요청은 정적 파일과 구글 폰트뿐인지
 *    - 체험 초기화가 데모 키만 지우는지
 *
 * 실행: node tests/portfolio-browser.test.cjs   (playwright + Chromium 필요, PORTFOLIO.md 참고)
 */
const { chromium } = require("playwright");
const { execFileSync } = require("node:child_process");
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "portfolio-dist");
execFileSync(process.execPath, [path.join(ROOT, "tools/build-portfolio.mjs")], { stdio: "inherit" });

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  let file = path.join(DIST, p);
  if (!file.startsWith(DIST + path.sep)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) && fs.existsSync(file + ".html")) file += ".html";
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
    res.end(data);
  });
});

const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); };
const ALLOWED_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ ...(process.env.DEMO_BROWSER ? { executablePath: process.env.DEMO_BROWSER } : {}), args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ko-KR" });
  const page = await context.newPage();
  const errors = [], dialogs = [], external = [], failed = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  // 체험 초기화 확인창만 승인한다. 그 밖의 alert/confirm 은 전부 실패로 센다(운영 화면이 '요청 실패'를 alert 로 알리므로).
  page.on("dialog", (d) => { dialogs.push(d.type() + ": " + d.message()); (d.message().startsWith("체험 데이터") ? d.accept() : d.dismiss()).catch(() => {}); });
  page.on("request", (r) => { const u = new URL(r.url()); if (u.origin !== base && !ALLOWED_HOSTS.includes(u.hostname)) external.push(r.url()); });
  page.on("requestfailed", (r) => { const u = new URL(r.url()); if (u.origin === base) failed.push(r.url()); });
  const noOverflow = async (label) => assert(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), "가로 넘침 " + label);
  const open = async (p) => { await page.goto(base + p, { waitUntil: "load" }); await page.waitForSelector(".demo-bar"); };

  // 루트 → /personal
  await page.goto(base + "/", { waitUntil: "load" });
  await page.waitForURL(/\/personal$/);
  await page.evaluate(() => localStorage.setItem("production-record", "keep"));

  for (const width of [1280, 420]) {
    await page.setViewportSize({ width, height: 900 });
    const tag = `${width}px`;

    // ── 개인 마이페이지 ──
    await open("/personal");
    await page.waitForFunction(() => /\d\/6/.test(document.querySelector("#heroDone")?.textContent || ""));
    assert((await page.locator("#cycle .step").count()) === 6, "사이클 6단계 " + tag);
    assert((await page.locator("#week .blk").count()) >= 5, "주간 블록 " + tag);
    assert((await page.locator("#checklist .check-row").count()) === 12, "체크리스트 12개 " + tag);
    assert((await page.locator("#vrows tr.editable").count()) >= 2, "결과 기록 행 " + tag);
    await page.waitForSelector("#habitGrid .habit-tap-main", { state: "attached" });   // 퀵 기록 카드는 기본 접힘
    assert((await page.locator("#prefill").textContent()).includes("회고에서"), "어제 회고 프리필 " + tag);
    assert((await page.locator(".prin-c").count()) === 3, "개인 3원칙 배너 " + tag);
    assert((await page.locator("#me").textContent()).includes("guest@"), "체험 계정 표시 " + tag);
    assert((await page.locator(".mode-slot").isVisible()) === false, "회사용/개인용 선택 숨김 " + tag);
    await noOverflow("personal " + tag);
    if (width === 1280) {
      // 메모 기록 → 저장됨 → 새로고침 뒤 유지
      await page.fill("#worklogForm textarea", "데모 테스트 메모 — 브라우저에만 저장");
      await page.click("#worklogForm button");
      await page.waitForFunction(() => (document.querySelector("#worklogStatus")?.textContent || "").startsWith("저장됨"));
      await page.reload({ waitUntil: "load" });
      await page.waitForFunction(() => /\d\/6/.test(document.querySelector("#heroDone")?.textContent || ""));
      await page.click("#worklogToggle");
      assert((await page.locator("#worklogList").textContent()).includes("데모 테스트 메모"), "메모 새로고침 유지");
      // 체크리스트 체크 → 섹션 배지 갱신
      const before = await page.locator("#checklist input[type=checkbox]:checked").count();
      await page.locator("#checklist input[type=checkbox]:not(:checked)").first().check();
      await page.waitForFunction((n) => document.querySelectorAll("#checklist input[type=checkbox]:checked").length === n + 1, before);
      // md 내려받기는 네트워크 없이 Blob 으로
      const dl = page.waitForEvent("download");
      await page.click("#worklogMd");
      assert((await dl).suggestedFilename().endsWith("_work-cycle-demo.md"), "md 내려받기 파일명");
      assert((await page.locator("#personalUiStatus").textContent()).trim() === "", "개인 화면 상태줄 오류 없음");
    }

    // ── 스케줄 ──
    await open("/schedule");
    await page.waitForSelector("#donutCal .donut-btn");
    assert((await page.locator("#donutCal .donut-btn").count()) === 42, "도넛 42칸 " + tag);
    assert((await page.locator("#week .blk").count()) >= 5, "스케줄 주간 블록 " + tag);
    await page.click('.viewtoggle button[data-v="month"]');
    await page.waitForSelector("#month .mc");
    assert((await page.locator("#month .mc:not(.blank)").count()) >= 28, "월간 달력 " + tag);
    await noOverflow("schedule " + tag);

    // ── 칸반 ──
    await open("/kanban");
    await page.waitForSelector(".matrix .kcard");
    const cards = await page.locator(".matrix .kcard").count();
    assert(cards >= 5, "칸반 카드 " + tag);
    assert((await page.locator("#doneCard").isVisible()), "완료 카드 묶음 " + tag);
    await noOverflow("kanban " + tag);
    if (width === 1280) {
      await page.fill('#kForm input[name="title"]', "데모 테스트 카드");
      await page.click("#kForm button");
      await page.waitForFunction((n) => document.querySelectorAll(".matrix .kcard").length === n + 1, cards);
      await page.reload({ waitUntil: "load" });
      await page.waitForSelector(".matrix .kcard");
      assert((await page.locator(".matrix").textContent()).includes("데모 테스트 카드"), "카드 새로고침 유지");
    }

    // ── 회의록 ──
    await open("/meetings?tab=list");   // 마이페이지 '회의록 읽기' 단계에서 넘어오는 주소 — 목록 탭 + 볼트 인덱스까지 그린다
    await page.waitForSelector("#mlist article");
    assert((await page.locator("#mlist article").count()) >= 3, "회의록 목록 " + tag);
    await page.waitForFunction(() => (document.querySelector("#vlist")?.textContent || "").includes("0개 파일"));
    assert((await page.locator(".sub.vault-personal").textContent()).includes("공개 데모"), "볼트 안내 문구 " + tag);
    await noOverflow("meetings " + tag);
    if (width === 1280) {
      await page.locator("#mlist article button").first().click();
      await page.waitForSelector("#meetingDetail:not([hidden])");
      assert((await page.locator("#meetingContent").textContent()).length > 20, "회의록 요약 탭");
      await page.click('[data-meeting-tab="actions"]');
      assert((await page.locator("#meetingContent").textContent()).includes("- [ ]"), "회의록 할 일 탭");
      const readBtn = page.locator('#meetingDetail button:has-text("읽음으로 표시")');
      if (await readBtn.count()) { await readBtn.click(); await page.waitForSelector("#meetingDetail .pill2.ok"); }
      await page.reload({ waitUntil: "load" });
      await page.click('.subtabs button[data-tab="list"]');
      await page.waitForSelector("#mlist article");
      assert((await page.locator("#mlist article .pill2.ok").count()) >= 1, "읽음 새로고침 유지");
      // 회의 중 메모 자동 저장
      await page.click('.subtabs button[data-tab="live"]');
      await page.waitForSelector("#outline .ol-row");
      await page.fill("#lvTitle", "데모 메모");
      await page.waitForFunction(() => (document.querySelector("#lvSaved")?.textContent || "").startsWith("저장됨"), null, { timeout: 5000 });
    }

    // ── 범위 밖 화면 안내 ──
    await open("/report");
    assert((await page.locator(".card.sig h2").textContent()).includes("제공하지 않는 화면"), "주간보고 안내 " + tag);
    await noOverflow("report-notice " + tag);
  }

  // ── 체험 초기화: 데모 키만 지운다 ──
  await open("/personal");
  const before = await page.evaluate(() => Object.keys(localStorage).length);
  await page.click(".demo-bar-reset");
  await page.waitForURL(/\/personal$/);
  await page.waitForSelector(".demo-bar");
  const storage = await page.evaluate(() => ({ ...localStorage }));
  assert(storage["production-record"] === "keep", "초기화가 관계없는 키를 지움");
  assert(before > 1, "초기화 전 저장값 있음");
  const demoState = JSON.parse(storage["portfolio-demo:work-cycle:v2"] || "null");
  assert(demoState && !JSON.stringify(demoState).includes("데모 테스트 카드"), "초기화 뒤 새 예시");

  const realDialogs = dialogs.filter((d) => !d.startsWith("confirm: 체험 데이터"));
  assert(!errors.length, "페이지 오류: " + errors.join(" | "));
  assert(!realDialogs.length, "alert/confirm 발생: " + realDialogs.join(" | "));
  assert(!external.length, "외부 요청: " + [...new Set(external)].join(", "));
  assert(!failed.length, "정적 파일 404: " + [...new Set(failed)].join(", "));
  console.log("PASS — /personal /schedule /kanban /meetings 1280px·420px · 조작 유지 · 오류 0 · 외부 요청 0 · 초기화 격리");
  await context.close(); await browser.close(); await new Promise((r) => server.close(r));
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
