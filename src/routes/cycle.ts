/* routes/cycle.ts — 공통(health·me·config·배너 다운로드) · 사이클 보드 · 체크리스트 · 검증 표 · 대시보드 · 위젯 · 질문 템플릿/회고
 * index.ts 에서 2026-09-26 분리. 라우트 경로·동작은 그대로다. /api/* 인증 미들웨어(c.get("email"))는 index.ts 가 먼저 건다. */
import { Hono } from "hono";
import type { Env, Vars, Step } from "../shared";
import { kstToday, safeDate, DATE_RE, meetingReadSourceDate, STEPS, STEP_META, CHECKLIST_COMPLETE_MIN } from "../shared";
import { personalSettings } from "../personal";
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.get("/api/health", (c) => c.json({ ok: true, date: kstToday() }));

app.get("/api/me", async (c) => {
  const email = c.get("email");
  const [left, settings] = await Promise.all([
    c.env.DB.prepare("SELECT 1 FROM team_membership_exits WHERE user_email=?1").bind(email).first(),
    personalSettings(c.env.DB, email),
  ]);
  // view_mode: 화면 쪽 mode-switch.js가 이 값 하나로 탭·배너를 회사용/개인용으로 가른다
  return c.json({ email, today: kstToday(), team_member: !left, view_mode: settings.view_mode });
});

// Access 로그인 계정은 유지하되, 본인을 팀 멤버 목록·공유 집계·알림에서 제외한다.
// 과거 업무 기록과 OAuth 토큰은 삭제하지 않는다.
app.post("/api/team-membership/leave", async (c) => {
  const email = c.get("email");
  await c.env.DB.prepare(
    "INSERT INTO team_membership_exits (user_email) VALUES (?1) ON CONFLICT(user_email) DO NOTHING"
  ).bind(email).run();
  return c.json({ ok: true, team_member: false });
});

app.get("/api/config", (c) => c.json({ kakao_js_key: c.env.KAKAO_JS_KEY ?? null }));

// ── 바탕화면 상단 고정 배너 다운로드 ─────────────────────────────
// 실행 파일은 정적 자산으로 두고, 이 경로에서만 attachment 헤더를 붙인다.
// 그래야 브라우저가 코드 내용을 열지 않고 .pyw 파일로 내려받는다.
app.get("/api/downloads/desktop-banner", async (c) => {
  const asset = await c.env.ASSETS.fetch(
    new URL("/downloads/work-cycle-desktop-banner.pyw", c.req.url)
  );
  if (!asset.ok)
    return c.json({ error: `배너 파일을 준비하지 못했습니다 (${asset.status})` }, 502);

  const headers = new Headers(asset.headers);
  headers.set("Content-Type", "application/octet-stream");
  headers.set("Content-Disposition", 'attachment; filename="work-cycle-desktop-banner.pyw"');
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(asset.body, { status: asset.status, headers });
});


// ── 사이클 보드: 팀 전원의 오늘 6단계 상태 ──────────────────────────────────
app.get("/api/board", async (c) => {
  const date = safeDate(c.req.query("date"));
  const meetingReadDate = meetingReadSourceDate(date);
  const db = c.env.DB;

  const [users, checks, verifs, marks, reads, reqs, retros] = await Promise.all([
    db.prepare(
      `SELECT u.email, u.name FROM users u
       WHERE NOT EXISTS (SELECT 1 FROM team_membership_exits x WHERE x.user_email=u.email)
       ORDER BY u.created_at`
    ).all(),
    db.prepare(
      `SELECT c.user_email, COUNT(DISTINCT c.item_id) n
       FROM checks c JOIN checklist_items i ON i.id=c.item_id
       WHERE c.cycle_date=?1 AND i.active=1
       GROUP BY c.user_email`
    ).bind(date).all(),
    db.prepare("SELECT user_email, COUNT(*) n FROM verifications WHERE cycle_date=?1 GROUP BY user_email").bind(date).all(),
    db.prepare("SELECT user_email, step FROM step_marks WHERE cycle_date=?1").bind(date).all(),
    db.prepare(
      "SELECT r.user_email, COUNT(*) n FROM meeting_reads r JOIN meetings m ON m.id=r.meeting_id WHERE m.date=?1 GROUP BY r.user_email"
    ).bind(meetingReadDate).all(),
    db.prepare("SELECT user_email, COUNT(*) n FROM ai_requests WHERE cycle_date=?1 GROUP BY user_email").bind(date).all(),
    db.prepare("SELECT user_email, COUNT(*) n FROM retros WHERE cycle_date=?1 GROUP BY user_email").bind(date).all(),
  ]);

  const has = (rows: any, email: string) =>
    (rows.results as any[]).some((r) => r.user_email === email && (r.n ?? 1) > 0);
  const hasChecklistMinimum = (email: string) =>
    (checks.results as any[]).some((r) => r.user_email === email && Number(r.n ?? 0) >= CHECKLIST_COMPLETE_MIN);
  const marked = (email: string, step: Step) =>
    (marks.results as any[]).some((r) => r.user_email === email && r.step === step);

  const board = (users.results as any[]).map((u) => {
    const steps: Record<Step, boolean> = {
      // 실제 기록 우선, 없으면 수동 표시(step_marks) — M2에서 실제 기록으로 대체
      read:   has(reads, u.email)  || marked(u.email, "read"),
      plan:   has(reqs, u.email)   || marked(u.email, "plan"),
      work:   hasChecklistMinimum(u.email),
      verify: has(verifs, u.email),
      share:  marked(u.email, "share"),
      retro:  has(retros, u.email) || marked(u.email, "retro"),
    };
    const done = STEPS.filter((s) => steps[s]).length;
    return { email: u.email, name: u.name, steps, done, total: STEPS.length };
  });

  return c.json({ date, meeting_read_date: meetingReadDate, step_meta: STEP_META, board });
});

// M1 임시 수동 완료 표시 (read/plan/share/retro만 허용 — work/verify는 실제 기록으로만)
app.post("/api/step_marks", async (c) => {
  const { step, date } = await c.req.json<{ step: Step; date?: string }>();
  if (!(["read", "plan", "share", "retro"] as Step[]).includes(step))
    return c.json({ error: "이 단계는 실제 기록으로만 완료됩니다" }, 400);
  const d = safeDate(date);
  await c.env.DB.prepare(
    "INSERT INTO step_marks (user_email, cycle_date, step) VALUES (?1,?2,?3) ON CONFLICT DO NOTHING"
  ).bind(c.get("email"), d, step).run();
  return c.json({ ok: true });
});

// ── ⑤ 체크리스트 ─────────────────────────────────────────────────────────────
app.get("/api/checklist", async (c) => {
  const date = safeDate(c.req.query("date"));
  const email = c.get("email");
  const items = await c.env.DB.prepare(
    `SELECT i.id, i.section, i.text, i.sort,
            EXISTS(SELECT 1 FROM checks ch WHERE ch.item_id=i.id AND ch.user_email=?1 AND ch.cycle_date=?2) checked,
            COALESCE(n.memo, '') memo,
            n.updated_at memo_updated_at
     FROM checklist_items i
     LEFT JOIN checklist_notes n ON n.item_id=i.id AND n.user_email=?1 AND n.cycle_date=?2
     WHERE i.active=1 ORDER BY i.sort`
  ).bind(email, date).all();
  return c.json({ date, items: items.results });
});

app.post("/api/checks", async (c) => {
  const { item_id, checked, date } = await c.req.json<{ item_id: number; checked: boolean; date?: string }>();
  const d = safeDate(date);
  const email = c.get("email");
  if (checked) {
    await c.env.DB.prepare(
      "INSERT INTO checks (item_id, user_email, cycle_date) VALUES (?1,?2,?3) ON CONFLICT DO NOTHING"
    ).bind(item_id, email, d).run();
  } else {
    await c.env.DB.prepare(
      "DELETE FROM checks WHERE item_id=?1 AND user_email=?2 AND cycle_date=?3"
    ).bind(item_id, email, d).run();
  }
  return c.json({ ok: true });
});

/** 체크리스트 메모는 체크 상태와 분리해 보존한다. */
app.put("/api/checklist/:itemId/memo", async (c) => {
  const itemId = Number(c.req.param("itemId"));
  if (!Number.isSafeInteger(itemId) || itemId < 1)
    return c.json({ error: "체크리스트 항목 번호가 올바르지 않습니다" }, 400);

  const b = await c.req.json<{ memo?: unknown; date?: unknown }>();
  if (typeof b.memo !== "string")
    return c.json({ error: "메모는 문자열이어야 합니다" }, 400);

  let date: string;
  if (b.date === undefined || b.date === "") {
    date = kstToday();
  } else if (typeof b.date === "string" && DATE_RE.test(b.date)
    && new Date(b.date + "T00:00:00Z").toISOString().slice(0, 10) === b.date) {
    date = b.date;
  } else {
    return c.json({ error: "날짜는 YYYY-MM-DD 형식이어야 합니다" }, 400);
  }

  const memo = b.memo.trim();
  if (memo.length > 1000)
    return c.json({ error: "메모는 1,000자 이하로 적어주세요" }, 400);

  const item = await c.env.DB.prepare(
    "SELECT id FROM checklist_items WHERE id=?1 AND active=1"
  ).bind(itemId).first();
  if (!item) return c.json({ error: "활성 체크리스트 항목을 찾을 수 없습니다" }, 404);

  const email = c.get("email");
  if (!memo) {
    await c.env.DB.prepare(
      "DELETE FROM checklist_notes WHERE item_id=?1 AND user_email=?2 AND cycle_date=?3"
    ).bind(itemId, email, date).run();
    return c.json({ ok: true, memo: "", deleted: true });
  }

  await c.env.DB.prepare(
    `INSERT INTO checklist_notes (item_id, user_email, cycle_date, memo)
     VALUES (?1,?2,?3,?4)
     ON CONFLICT(item_id, user_email, cycle_date) DO UPDATE SET
       memo=excluded.memo, updated_at=datetime('now')`
  ).bind(itemId, email, date, memo).run();
  return c.json({ ok: true, memo, deleted: false });
});

// ── ② 검증 표 ────────────────────────────────────────────────────────────────
const V_STATUS = ["확인됨", "불일치→수정", "미확인"];

app.get("/api/verifications", async (c) => {
  const date = safeDate(c.req.query("date"));
  const rows = await c.env.DB.prepare(
    "SELECT * FROM verifications WHERE cycle_date=?1 ORDER BY created_at DESC"
  ).bind(date).all();
  return c.json({ date, rows: rows.results });
});

app.post("/api/verifications", async (c) => {
  const b = await c.req.json<{ item: string; formula?: string; method?: string; result?: string; status?: string; date?: string }>();
  if (!b.item?.trim()) return c.json({ error: "항목은 필수입니다" }, 400);
  const status = V_STATUS.includes(b.status ?? "") ? b.status : "미확인";
  await c.env.DB.prepare(
    `INSERT INTO verifications (user_email, cycle_date, item, formula, method, result, status)
     VALUES (?1,?2,?3,?4,?5,?6,?7)`
  ).bind(c.get("email"), safeDate(b.date), b.item.trim(), b.formula ?? "", b.method ?? "", b.result ?? "", status).run();
  return c.json({ ok: true });
});

// 검증 기록 편집 — 상태·항목·계산식·검증방법·결과 (본인 기록만)
app.patch("/api/verifications/:id", async (c) => {
  const b = await c.req.json<{ item?: string; formula?: string; method?: string; result?: string; status?: string }>();
  const own = await c.env.DB.prepare("SELECT * FROM verifications WHERE id=?1 AND user_email=?2")
    .bind(c.req.param("id"), c.get("email")).first<any>();
  if (!own) return c.json({ error: "내가 쓴 검증 기록만 고칠 수 있습니다" }, 404);
  if (b.status !== undefined && !V_STATUS.includes(b.status))
    return c.json({ error: "상태는 확인됨 / 불일치→수정 / 미확인 중 하나여야 합니다" }, 400);
  const item = b.item !== undefined ? b.item.trim() : own.item;
  if (!item) return c.json({ error: "항목은 비울 수 없습니다" }, 400);
  await c.env.DB.prepare(
    `UPDATE verifications SET item=?1, formula=?2, method=?3, result=?4, status=?5 WHERE id=?6 AND user_email=?7`
  ).bind(
    item,
    b.formula !== undefined ? b.formula : own.formula,
    b.method !== undefined ? b.method : own.method,
    b.result !== undefined ? b.result : own.result,
    b.status !== undefined ? b.status : own.status,
    c.req.param("id"), c.get("email")
  ).run();
  return c.json({ ok: true });
});

app.delete("/api/verifications/:id", async (c) => {
  // 본인 기록만 삭제 가능
  const r = await c.env.DB.prepare(
    "DELETE FROM verifications WHERE id=?1 AND user_email=?2"
  ).bind(c.req.param("id"), c.get("email")).run();
  return c.json({ ok: true, deleted: r.meta.changes });
});

// ── ② 팀 대시보드 (날짜별 이력) ──────────────────────────────────────────────
app.get("/api/dashboard", async (c) => {
  const days = Math.min(parseInt(c.req.query("days") ?? "14", 10) || 14, 60);
  const rows = await c.env.DB.prepare(
    `SELECT v.*, u.name FROM verifications v JOIN users u ON u.email=v.user_email
     WHERE NOT EXISTS (SELECT 1 FROM team_membership_exits x WHERE x.user_email=v.user_email)
     ORDER BY v.cycle_date DESC, v.created_at DESC LIMIT 500`
  ).all();
  const byDate: Record<string, any[]> = {};
  for (const r of rows.results as any[]) (byDate[r.cycle_date] ??= []).push(r);
  const dates = Object.keys(byDate).sort().reverse().slice(0, days);
  const summary = {
    total: 0, 확인됨: 0, "불일치→수정": 0, 미확인: 0,
  } as Record<string, number>;
  for (const d of dates) for (const r of byDate[d]) { summary.total++; summary[r.status] = (summary[r.status] ?? 0) + 1; }
  return c.json({ dates: dates.map((d) => ({ date: d, rows: byDate[d] })), summary });
});

// ── ① 위젯용 현재 상태 ───────────────────────────────────────────────────────
app.get("/api/widget/now", async (c) => {
  const date = kstToday();
  const hourKst = (new Date(Date.now() + 9 * 3600 * 1000)).getUTCHours() + (new Date(Date.now() + 9 * 3600 * 1000)).getUTCMinutes() / 60;
  let current: Step = "work";
  if (hourKst < 9.5) current = "read";
  else if (hourKst < 10.5) current = "plan";
  else if (hourKst < 16 + 50 / 60) current = "work";
  else if (hourKst < 17 + 20 / 60) current = "verify";
  else if (hourKst < 17 + 50 / 60) current = "share";
  else current = "retro";
  return c.json({ date, current, meta: STEP_META[current] });
});



// ── ⑦ 질문 템플릿 + ⑥ 회고 (사이클 연결 고리) ──
app.get("/api/plan/prefill", async (c) => {
  // 어제(가장 최근) 회고의 tomorrow_prompt를 오늘 계획에 프리필
  const last = await c.env.DB.prepare(
    "SELECT id, tomorrow_prompt, cycle_date FROM retros WHERE user_email=?1 AND tomorrow_prompt != '' ORDER BY cycle_date DESC LIMIT 1"
  ).bind(c.get("email")).first<any>();
  const today = await c.env.DB.prepare(
    "SELECT * FROM ai_requests WHERE user_email=?1 AND cycle_date=?2 ORDER BY id DESC LIMIT 1"
  ).bind(c.get("email"), kstToday()).first<any>();
  return c.json({ prefill: last ?? null, today: today ?? null });
});

app.post("/api/plan", async (c) => {
  const b = await c.req.json<any>();
  if (!b.user_flow?.trim()) return c.json({ error: "사용자 흐름은 필수" }, 400);
  const prompt = [
    `[원하는 사용자 행동] ${b.user_flow}`,
    `[지킬 기존 기능] ${b.keep ?? ""}`,
    `[건드리지 않을 범위] ${b.dont_touch ?? ""}`,
    `[완료 기준] ${b.done_criteria ?? ""}`,
    `[모르는 것] ${b.unknowns ?? ""}`,
  ].join("\n");
  await c.env.DB.prepare(
    `INSERT INTO ai_requests (user_email, cycle_date, user_flow, keep, dont_touch, done_criteria, unknowns, final_prompt, reused_from)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`
  ).bind(c.get("email"), kstToday(), b.user_flow, b.keep ?? "", b.dont_touch ?? "", b.done_criteria ?? "", b.unknowns ?? "", prompt, b.reused_from ?? null).run();
  return c.json({ ok: true, final_prompt: prompt }); // ⑦ 단계 완료 (보드 자동 반영)
});

app.post("/api/retro", async (c) => {
  const b = await c.req.json<any>();
  if (!b.work_summary?.trim()) return c.json({ error: "오늘 작업 요약은 필수" }, 400);
  await c.env.DB.prepare(
    "INSERT INTO retros (user_email, cycle_date, work_summary, ai_answer_md, tomorrow_prompt) VALUES (?1,?2,?3,?4,?5)"
  ).bind(c.get("email"), kstToday(), b.work_summary, b.ai_answer_md ?? "", b.tomorrow_prompt ?? "").run();
  return c.json({ ok: true }); // ⑥ 단계 완료 · tomorrow_prompt는 내일 ⑦에 프리필
});


export default app;
