/* routes/schedule.ts — 스케줄(주간/월간) · 업무 메모 · 월간 달력 · 사이클 도넛 이력 · 화상회의(Google Meet)
 * index.ts 에서 2026-09-26 분리. 라우트 경로·동작은 그대로다. /api/* 인증 미들웨어(c.get("email"))는 index.ts 가 먼저 건다. */
import { Hono } from "hono";
import type { Env, Vars, Step } from "../shared";
import { kstToday, kstTime, safeDate, DATE_RE, meetingReadSourceDate, meetingReadCycleDate, STEPS, STEP_META, CHECKLIST_COMPLETE_MIN, noteScope } from "../shared";
import { freshAccessToken } from "../auth";
import { personalCycleHistory, hasLogRevisions } from "../personal";
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

/* 회사/개인 범위(0020): 회사용은 scope='company' 인 팀 전체(퇴장 계정 제외) — 분리 전과 같은 결과.
 * 개인용은 scope='personal' AND 본인 것만. 만들 때는 그때의 사용 화면대로 scope 를 넣는다. */
function scopeWhere(scope: "company" | "personal", alias: string, emailParam: string): string {
  return scope === "personal"
    ? `${alias}.scope='personal' AND ${alias}.user_email=${emailParam}`
    : `${alias}.scope='company' AND NOT EXISTS (SELECT 1 FROM team_membership_exits x WHERE x.user_email=${alias}.user_email)`;
}

// ── 스케줄 (주간/월간) ──
const WORK_LOG_BODY_MAX = 1000;

const SCH_STATUS = ["미완료", "완료"];
function scheduleType(value: string | undefined): "업무" | "회의" {
  return value === "회의" ? "회의" : "업무";
}

app.get("/api/schedules", async (c) => {
  const from = safeDate(c.req.query("from")), to = safeDate(c.req.query("to"));
  const email = c.get("email");
  const scope = await noteScope(c);
  const rows = await c.env.DB.prepare(
    `SELECT s.*,
       CASE WHEN s.user_email=?1 THEN (
         SELECT l.body FROM schedule_logs l
         WHERE l.schedule_id=s.id AND l.user_email=?1
         ORDER BY l.id DESC LIMIT 1
       ) END latest_log,
       CASE WHEN s.user_email=?1 THEN (
         SELECT l.logged_time FROM schedule_logs l
         WHERE l.schedule_id=s.id AND l.user_email=?1
         ORDER BY l.id DESC LIMIT 1
       ) END latest_log_time
     FROM schedules s
     WHERE s.date BETWEEN ?2 AND ?3
       AND ${scopeWhere(scope, "s", "?1")}
     ORDER BY s.date, s.start_time`
  ).bind(email, from, to).all();
  return c.json({ rows: rows.results, scope });
});

app.post("/api/schedules", async (c) => {
  const b = await c.req.json<{ date: string; title: string; block_type?: string; start_time?: string; end_time?: string; body?: string; status?: string }>();
  if (!b.title?.trim() || !DATE_RE.test(b.date ?? "")) return c.json({ error: "date(YYYY-MM-DD)와 title은 필수" }, 400);
  const st = SCH_STATUS.includes(b.status ?? "") ? b.status! : "미완료";
  const r = await c.env.DB.prepare(
    "INSERT INTO schedules (user_email, date, block_type, title, start_time, end_time, body, status, created_by, scope) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?1,?9)"
  ).bind(c.get("email"), b.date, scheduleType(b.block_type), b.title.trim(), b.start_time ?? null, b.end_time ?? null, b.body ?? null, st, await noteScope(c)).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});

// 일정 편집 — 제목·시간·유형·내용 (본인 일정만)
app.patch("/api/schedules/:id", async (c) => {
  const b = await c.req.json<{ title?: string; block_type?: string; start_time?: string; end_time?: string; body?: string; memo?: string; date?: string; status?: string; confirm_line?: string; confirmed?: boolean }>();
  const own = await c.env.DB.prepare("SELECT * FROM schedules WHERE id=?1 AND user_email=?2")
    .bind(c.req.param("id"), c.get("email")).first<any>();
  if (!own) return c.json({ error: "내가 만든 일정만 고칠 수 있습니다" }, 404);
  const title = b.title !== undefined ? b.title.trim() : own.title;
  if (!title) return c.json({ error: "제목은 비울 수 없습니다" }, 400);
  const date = b.date !== undefined && DATE_RE.test(b.date) ? b.date : own.date;
  if (b.status !== undefined && !SCH_STATUS.includes(b.status))
    return c.json({ error: "상태는 미완료 / 완료 중 하나여야 합니다" }, 400);
  await c.env.DB.prepare(
    `UPDATE schedules SET title=?1, block_type=?2, start_time=?3, end_time=?4, body=?5, date=?6, status=?7,
       confirm_line=?8, confirmed=?9, memo=?10
     WHERE id=?11 AND user_email=?12`
  ).bind(
    title,
    scheduleType(b.block_type !== undefined ? b.block_type : own.block_type),
    b.start_time !== undefined ? (b.start_time || null) : own.start_time,
    b.end_time !== undefined ? (b.end_time || null) : own.end_time,
    b.body !== undefined ? (b.body || null) : own.body,
    date,
    b.status !== undefined ? b.status : (own.status ?? "미완료"),
    b.confirm_line !== undefined ? (b.confirm_line || null) : own.confirm_line,
    b.confirmed !== undefined ? (b.confirmed ? 1 : 0) : (own.confirmed ?? 0),
    b.memo !== undefined ? (b.memo || null) : own.memo,
    c.req.param("id"), c.get("email")
  ).run();
  return c.json({ ok: true });
});

app.delete("/api/schedules/:id", async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM schedules WHERE id=?1 AND user_email=?2")
    .bind(c.req.param("id"), c.get("email")).run();
  return c.json({ ok: true, deleted: r.meta.changes });
});

// ── 업무 메모: 오늘 업무에 시간순으로 짧은 기록을 쌓는다 ──
/** 0021(schedule_logs.parent_id)이 운영 D1에 아직 없어도 화면이 죽지 않게 — 컬럼 유무를 확인해 캐시한다.
 *  (2026-09-27 16:22 운영 "요청 실패": 코드가 먼저 배포되고 콘솔 마이그레이션이 늦어 GET /api/work-logs 가 500) */
let HAS_LOG_PARENT: boolean | null = null;   // true 는 영구 캐시, false 는 60초만 (콘솔에서 0021 적용 직후 재배포 없이 살아나게)
let HAS_LOG_PARENT_AT = 0;
async function hasLogParent(db: D1Database): Promise<boolean> {
  if (HAS_LOG_PARENT === true) return true;
  if (HAS_LOG_PARENT === false && Date.now() - HAS_LOG_PARENT_AT < 60_000) return false;
  const row = await db.prepare("SELECT COUNT(*) n FROM pragma_table_info('schedule_logs') WHERE name='parent_id'").first<{ n: number }>();
  HAS_LOG_PARENT = (row?.n ?? 0) > 0;
  HAS_LOG_PARENT_AT = Date.now();
  return HAS_LOG_PARENT;
}
const MIGRATION_0021_HINT = "답글 기능은 마이그레이션 0021(schedule_logs.parent_id) 적용 뒤에 쓸 수 있습니다 — docs/DEPLOY.md";

app.get("/api/work-logs", async (c) => {
  const email = c.get("email");
  const date = safeDate(c.req.query("date"));
  const scope = await noteScope(c);
  const withParent = await hasLogParent(c.env.DB);
  const [schedules, logs] = await Promise.all([
    c.env.DB.prepare(
      `SELECT s.*
       FROM schedules s
       WHERE s.user_email=?1 AND s.date=?2 AND s.block_type='업무' AND s.scope=?3
       ORDER BY CASE WHEN status='미완료' THEN 0 ELSE 1 END, COALESCE(start_time,''), id`
    ).bind(email, date, scope).all(),
    c.env.DB.prepare(
      `SELECT l.id, l.schedule_id, ${withParent ? "l.parent_id" : "NULL AS parent_id"}, l.body, l.logged_date, l.logged_time, l.created_at, l.updated_at,
              s.title AS schedule_title
       FROM schedule_logs l
       JOIN schedules s ON s.id=l.schedule_id
       WHERE l.user_email=?1 AND s.user_email=?1 AND l.logged_date=?2
       ORDER BY l.id DESC
       LIMIT 100`
    ).bind(email, date).all(),
  ]);
  return c.json({ date, schedules: schedules.results, logs: logs.results, replies_ready: withParent });
});

app.post("/api/schedules/:id/logs", async (c) => {
  const contentLength = Number(c.req.header("content-length") || "0");
  if (contentLength > 4096) return c.json({ error: "메모가 너무 깁니다" }, 413);
  const parsed = await c.req.json<{ body?: unknown; parent_id?: unknown }>().catch(() => ({ body: undefined, parent_id: undefined }));
  const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
  if (!body) return c.json({ error: "메모 내용을 입력하세요" }, 400);
  if (body.length > WORK_LOG_BODY_MAX) return c.json({ error: `메모는 ${WORK_LOG_BODY_MAX}자까지 입력할 수 있습니다` }, 400);

  const schedule = await c.env.DB.prepare(
    "SELECT id, date, block_type FROM schedules WHERE id=?1 AND user_email=?2"
  ).bind(c.req.param("id"), c.get("email")).first<{ id: number; date: string; block_type: string }>();
  if (!schedule) return c.json({ error: "내 업무 일정을 찾을 수 없습니다" }, 404);
  if (schedule.block_type !== "업무") return c.json({ error: "업무 일정에만 메모를 기록할 수 있습니다" }, 400);

  // 대댓글(0021): parent_id 가 있으면 같은 일정의 내 메모에 다는 답글. 답글의 답글은 원래 메모(뿌리)에 붙인다(한 단계만).
  // 답글은 부모 메모의 날짜에 묶이므로 지난 날짜에도 달 수 있다. 시각은 지금.
  let parentId: number | null = null;
  let loggedDate = kstToday();
  const withParent = await hasLogParent(c.env.DB);
  if (parsed.parent_id !== undefined && parsed.parent_id !== null && parsed.parent_id !== "") {
    if (!withParent) return c.json({ error: MIGRATION_0021_HINT }, 400);
    const parent = await c.env.DB.prepare(
      "SELECT id, parent_id, logged_date FROM schedule_logs WHERE id=?1 AND user_email=?2 AND schedule_id=?3"
    ).bind(Number(parsed.parent_id), c.get("email"), schedule.id).first<{ id: number; parent_id: number | null; logged_date: string }>();
    if (!parent) return c.json({ error: "답글을 달 메모를 찾을 수 없습니다" }, 404);
    parentId = parent.parent_id ?? parent.id;
    loggedDate = parent.logged_date;
  } else if (schedule.date !== kstToday()) {
    return c.json({ error: "오늘 업무에만 새 메모를 기록할 수 있습니다" }, 400);
  }

  const loggedTime = kstTime();
  const result = withParent
    ? await c.env.DB.prepare(
        `INSERT INTO schedule_logs (schedule_id, user_email, body, logged_date, logged_time, parent_id)
         VALUES (?1,?2,?3,?4,?5,?6)`
      ).bind(schedule.id, c.get("email"), body, loggedDate, loggedTime, parentId).run()
    : await c.env.DB.prepare(
        `INSERT INTO schedule_logs (schedule_id, user_email, body, logged_date, logged_time)
         VALUES (?1,?2,?3,?4,?5)`
      ).bind(schedule.id, c.get("email"), body, loggedDate, loggedTime).run();
  return c.json({
    ok: true,
    id: result.meta.last_row_id,
    schedule_id: schedule.id,
    parent_id: parentId,
    body,
    logged_date: loggedDate,
    logged_time: loggedTime,
  });
});

app.patch("/api/work-logs/:id", async (c) => {
  const contentLength = Number(c.req.header("content-length") || "0");
  if (contentLength > 4096) return c.json({ error: "메모가 너무 깁니다" }, 413);
  const parsed = await c.req.json<{ body?: unknown }>().catch(() => ({ body: undefined }));
  const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
  if (!body) return c.json({ error: "메모 내용을 입력하세요" }, 400);
  if (body.length > WORK_LOG_BODY_MAX) return c.json({ error: `메모는 ${WORK_LOG_BODY_MAX}자까지 입력할 수 있습니다` }, 400);
  // 수정 이력(0024): 내용이 실제로 바뀔 때만, 바뀌기 전 내용을 같은 batch(트랜잭션)로 먼저 남긴다. 표가 없으면 기존 그대로.
  const update = c.env.DB.prepare(
    "UPDATE schedule_logs SET body=?1, updated_at=datetime('now') WHERE id=?2 AND user_email=?3"
  ).bind(body, c.req.param("id"), c.get("email"));
  const result = (await hasLogRevisions(c.env.DB))
    ? (await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO schedule_log_revisions (log_id, user_email, body, written_at)
           SELECT id, user_email, body, updated_at FROM schedule_logs WHERE id=?1 AND user_email=?2 AND body<>?3`
        ).bind(c.req.param("id"), c.get("email"), body),
        update,
      ]))[1]
    : await update.run();
  if (!result.meta.changes) return c.json({ error: "수정할 메모를 찾을 수 없습니다" }, 404);
  return c.json({ ok: true });
});

app.delete("/api/work-logs/:id", async (c) => {
  // 메모를 지우면 그 아래 답글(0021)도 함께 지운다 (컬럼이 없으면 그 메모만)
  const result = (await hasLogParent(c.env.DB))
    ? await c.env.DB.prepare("DELETE FROM schedule_logs WHERE user_email=?2 AND (id=?1 OR parent_id=?1)")
        .bind(c.req.param("id"), c.get("email")).run()
    : await c.env.DB.prepare("DELETE FROM schedule_logs WHERE user_email=?2 AND id=?1")
        .bind(c.req.param("id"), c.get("email")).run();
  if (!result.meta.changes) return c.json({ error: "삭제할 메모를 찾을 수 없습니다" }, 404);
  return c.json({ ok: true });
});


// 월간 달력 데이터: 일정+회의+사이클 완료율을 한 번에
app.get("/api/month", async (c) => {
  const ym = /^\d{4}-\d{2}$/.test(c.req.query("ym") ?? "") ? c.req.query("ym")! : kstToday().slice(0, 7);
  const from = ym + "-01", to = ym + "-31";
  const email = c.get("email");
  const scope = await noteScope(c);
  const personal = scope === "personal";
  // 개인용: 내 개인 일정·내 개인 노트·개인 기록(personal_*)만. 회사용: 분리 전과 같은 결과.
  const [sch, meet, verifs, checks, retros] = await Promise.all([
    c.env.DB.prepare(
      `SELECT s.date, s.title, s.block_type FROM schedules s
       WHERE s.date BETWEEN ?1 AND ?2 AND ${scopeWhere(scope, "s", "?3")}`
    ).bind(from, to, email).all(),
    personal
      ? c.env.DB.prepare("SELECT id, date, title, gh_issue_url FROM meetings WHERE date BETWEEN ?1 AND ?2 AND scope='personal' AND created_by=?3").bind(from, to, email).all()
      : c.env.DB.prepare("SELECT id, date, title, gh_issue_url FROM meetings WHERE date BETWEEN ?1 AND ?2 AND scope='company'").bind(from, to).all(),
    personal
      ? c.env.DB.prepare("SELECT cycle_date d, COUNT(*) n FROM personal_results WHERE user_email=?3 AND cycle_date BETWEEN ?1 AND ?2 AND deleted_at IS NULL GROUP BY cycle_date").bind(from, to, email).all()
      : c.env.DB.prepare("SELECT cycle_date d, COUNT(*) n FROM verifications WHERE user_email=?3 AND cycle_date BETWEEN ?1 AND ?2 GROUP BY cycle_date").bind(from, to, email).all(),
    personal
      ? c.env.DB.prepare("SELECT cycle_date d, SUM(checked) n FROM personal_checks WHERE user_email=?3 AND cycle_date BETWEEN ?1 AND ?2 GROUP BY cycle_date").bind(from, to, email).all()
      : c.env.DB.prepare("SELECT cycle_date d, COUNT(*) n FROM checks WHERE user_email=?3 AND cycle_date BETWEEN ?1 AND ?2 GROUP BY cycle_date").bind(from, to, email).all(),
    personal
      ? c.env.DB.prepare("SELECT cycle_date d FROM personal_retros WHERE user_email=?3 AND cycle_date BETWEEN ?1 AND ?2").bind(from, to, email).all()
      : c.env.DB.prepare("SELECT cycle_date d FROM retros WHERE user_email=?3 AND cycle_date BETWEEN ?1 AND ?2").bind(from, to, email).all(),
  ]);
  return c.json({ ym, scope, schedules: sch.results, meetings: meet.results, verifs: verifs.results, checks: checks.results, retros: retros.results });
});



// ════════════════════ 스케줄: 사이클 도넛 달력 + 퀵 기록 ════════════════════

// 기간 내 날짜별 사이클 6단계 완료 이력 (현재 사용자)
app.get("/api/cycle_history", async (c) => {
  const from = safeDate(c.req.query("from")), to = safeDate(c.req.query("to"));
  const email = c.get("email"), db = c.env.DB;
  // 개인용: 개인 기록(personal_*)으로 계산한 이력 — 화면은 같은 API 를 쓰고 응답 형태도 같다
  if ((await noteScope(c)) === "personal") return c.json(await personalCycleHistory(db, email, from, to));
  const q = (sql: string) => db.prepare(sql).bind(email, from, to).all();
  const [checks, verifs, marks, reads, reqs, retros] = await Promise.all([
    q(`SELECT c.cycle_date d
       FROM checks c JOIN checklist_items i ON i.id=c.item_id
       WHERE c.user_email=?1 AND c.cycle_date BETWEEN ?2 AND ?3 AND i.active=1
       GROUP BY c.cycle_date
       HAVING COUNT(DISTINCT c.item_id) >= ${CHECKLIST_COMPLETE_MIN}`),
    q("SELECT cycle_date d FROM verifications WHERE user_email=?1 AND cycle_date BETWEEN ?2 AND ?3 GROUP BY cycle_date"),
    q("SELECT cycle_date d, step FROM step_marks WHERE user_email=?1 AND cycle_date BETWEEN ?2 AND ?3"),
    db.prepare(
      "SELECT m.date d FROM meeting_reads r JOIN meetings m ON m.id=r.meeting_id WHERE r.user_email=?1 AND m.date BETWEEN ?2 AND ?3 GROUP BY m.date"
    ).bind(email, meetingReadSourceDate(from), to).all(),
    q("SELECT cycle_date d FROM ai_requests WHERE user_email=?1 AND cycle_date BETWEEN ?2 AND ?3 GROUP BY cycle_date"),
    q("SELECT cycle_date d FROM retros WHERE user_email=?1 AND cycle_date BETWEEN ?2 AND ?3 GROUP BY cycle_date"),
  ]);
  const byDate: Record<string, Record<Step, boolean>> = {};
  const ensure = (d: string) => (byDate[d] ??= { read:false, plan:false, work:false, verify:false, share:false, retro:false });
  for (const r of reads.results as any[]) {
    const cycleDate = meetingReadCycleDate(r.d);
    if (cycleDate >= from && cycleDate <= to) ensure(cycleDate).read = true;
  }
  for (const r of reqs.results as any[]) ensure(r.d).plan = true;
  for (const r of checks.results as any[]) ensure(r.d).work = true;
  for (const r of verifs.results as any[]) ensure(r.d).verify = true;
  for (const r of retros.results as any[]) ensure(r.d).retro = true;
  for (const r of marks.results as any[]) if (STEPS.includes(r.step)) (ensure(r.d) as any)[r.step] = true;
  const days = Object.entries(byDate).map(([date, steps]) => ({
    date, steps, done: STEPS.filter(s => steps[s]).length,
  }));
  return c.json({ from, to, step_meta: STEP_META, days });
});

// ── 화상회의: 일정에 Google Meet 링크 만들기 ────────────────────────────────
app.post("/api/schedules/:id/meet", async (c) => {
  const email = c.get("email");
  const row = await c.env.DB.prepare("SELECT * FROM schedules WHERE id=?1 AND user_email=?2")
    .bind(c.req.param("id"), email).first<any>();
  if (!row) return c.json({ error: "내가 만든 일정에만 회의를 열 수 있습니다" }, 404);
  if (row.meet_url) return c.json({ ok: true, meet_url: row.meet_url, reused: true });

  const token = await freshAccessToken(c.env, email, "google");
  if (!token) return c.json({ error: "구글 캘린더를 먼저 연결해주세요 (마이페이지 🔔 카드)" }, 400);

  const start = (row.start_time && /^\d{2}:\d{2}/.test(row.start_time)) ? row.start_time.slice(0, 5) : "09:00";
  const end = (row.end_time && /^\d{2}:\d{2}/.test(row.end_time)) ? row.end_time.slice(0, 5) : null;
  const endCalc = end ?? (String(Number(start.slice(0, 2)) + 1).padStart(2, "0") + start.slice(2));
  const body = {
    summary: row.title,
    description: row.body ?? "",
    start: { dateTime: `${row.date}T${start}:00+09:00`, timeZone: "Asia/Seoul" },
    end:   { dateTime: `${row.date}T${endCalc}:00+09:00`, timeZone: "Asia/Seoul" },
    conferenceData: { createRequest: { requestId: `wc-${row.id}-${row.date}`, conferenceSolutionKey: { type: "hangoutsMeet" } } },
  };
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
    { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  if (!res.ok) {
    const full = await res.text();               // 판별은 전문으로, 표시만 잘라서
    const t = full.slice(0, 400);
    let reason = "", gmsg = "";
    try {
      const j = JSON.parse(full);
      reason = j?.error?.errors?.[0]?.reason ?? j?.error?.status ?? "";
      gmsg = j?.error?.message ?? "";
    } catch { /* 본문이 JSON이 아니면 원문을 그대로 보여준다 */ }

    const apiOff = reason === "accessNotConfigured"
      || full.includes("accessNotConfigured")
      || /has not been used in project|it is disabled/i.test(gmsg || full);
    if (apiOff)
      return c.json({ error: "Calendar API가 꺼져 있습니다 — Google Cloud → API 라이브러리 → Google Calendar API → [사용]을 누르고 3~5분 뒤 다시 시도해주세요" }, 502);
    if (reason === "insufficientPermissions" || reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT" || res.status === 401)
      return c.json({ error: "캘린더 쓰기 권한이 없습니다 — 🔔 카드에서 구글을 다시 연결해주세요 (동의 화면에서 '캘린더 수정'에 체크)" }, 502);
    // 그 외에는 구글이 준 이유를 그대로 전달 — 추측하지 않는다
    return c.json({ error: `회의 생성 실패 (${res.status}${reason ? " · " + reason : ""}) — ${gmsg || t}` }, 502);
  }
  const ev = await res.json<any>();
  const url: string | null = ev.hangoutLink
    ?? ev.conferenceData?.entryPoints?.find((p: any) => p.entryPointType === "video")?.uri
    ?? null;
  if (!url) return c.json({ error: "일정은 만들어졌지만 회의 링크를 받지 못했습니다" }, 502);
  await c.env.DB.prepare("UPDATE schedules SET meet_url=?1, meet_event_id=?2 WHERE id=?3 AND user_email=?4")
    .bind(url, ev.id ?? null, row.id, email).run();
  return c.json({ ok: true, meet_url: url });
});

// 회의 링크 해제 (캘린더 일정도 함께 삭제)
app.delete("/api/schedules/:id/meet", async (c) => {
  const email = c.get("email");
  const row = await c.env.DB.prepare("SELECT * FROM schedules WHERE id=?1 AND user_email=?2")
    .bind(c.req.param("id"), email).first<any>();
  if (!row) return c.json({ error: "내가 만든 일정만 바꿀 수 있습니다" }, 404);
  if (row.meet_event_id) {
    const token = await freshAccessToken(c.env, email, "google");
    if (token) {
      await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${row.meet_event_id}`,
        { method: "DELETE", headers: { Authorization: "Bearer " + token } }).catch(() => {});
    }
  }
  await c.env.DB.prepare("UPDATE schedules SET meet_url=NULL, meet_event_id=NULL WHERE id=?1 AND user_email=?2")
    .bind(row.id, email).run();
  return c.json({ ok: true });
});

export default app;
