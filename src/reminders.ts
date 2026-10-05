/* reminders.ts — 리마인드 메시지 조립 · 카카오 나에게 보내기 · 상태/테스트 API · Cron 시간표(SLOTS)
 * index.ts 에서 2026-09-26 분리. scheduled 핸들러는 index.ts 가 export default 에 실어 준다. */
import { Hono } from "hono";
import type { Env, Vars, Step } from "./shared";
import { kstToday, meetingReadSourceDate, STEPS, STEP_META, appOrigin } from "./shared";
import { freshAccessToken } from "./auth";
import { habitCanTapOn, habitRepeat } from "./routes/habits";
import { personalSettings, buildPersonalReminder } from "./personal";
import { collect, weekStart, addDays } from "./report";
import { historySlotAt, runHistorySlot } from "./vault-history";

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// ── 리마인드 메시지 조립 ─────────────────────────────────────────────────────
export async function todayCalendar(env: Env, email: string): Promise<string[]> {
  const token = await freshAccessToken(env, email, "google");
  if (!token) return [];
  const d = kstToday();
  const min = d + "T00:00:00+09:00";
  const max = d + "T23:59:59+09:00";
  const u = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  u.searchParams.set("timeMin", min);
  u.searchParams.set("timeMax", max);
  u.searchParams.set("singleEvents", "true");
  u.searchParams.set("orderBy", "startTime");
  u.searchParams.set("maxResults", "8");
  const r = await fetch(u.toString(), { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) return [];
  const data = await r.json<{ items?: { summary?: string; start?: { dateTime?: string; date?: string } }[] }>();
  return (data.items || []).map((e) => {
    const t = e.start?.dateTime ? e.start.dateTime.slice(11, 16) : "종일";
    return `${t} ${e.summary || "(제목 없음)"}`;
  });
}

export async function buildReminder(env: Env, email: string, when: "morning" | "evening"): Promise<string> {
  const date = kstToday();
  const meetingReadDate = meetingReadSourceDate(date);
  const db = env.DB;
  const L: string[] = [];

  if (when === "morning") {
    L.push(`🌅 work-cycle 아침 브리핑 (${date})`);
    const cal = await todayCalendar(env, email);
    if (cal.length) { L.push("", "📅 오늘 일정"); cal.forEach((s) => L.push("· " + s)); }
    const sched = await db.prepare(
      "SELECT start_time, title FROM schedules WHERE user_email=?1 AND date=?2 ORDER BY COALESCE(start_time,'99')"
    ).bind(email, date).all();
    if (sched.results.length) {
      L.push("", "🗓 work-cycle 스케줄");
      (sched.results as any[]).forEach((s) => L.push(`· ${s.start_time || ""} ${s.title}`.trim()));
    }
    const unread = await db.prepare(
      `SELECT m.title FROM meetings m
       WHERE m.date=?1 AND NOT EXISTS (SELECT 1 FROM meeting_reads r WHERE r.meeting_id=m.id AND r.user_email=?2)
       ORDER BY m.id LIMIT 5`
    ).bind(meetingReadDate, email).all();
    if (unread.results.length) {
      L.push("", `📖 안 읽은 ${meetingReadDate} 회의록`);
      (unread.results as any[]).forEach((m) => L.push("· " + m.title));
    }
    const y = new Date(Date.now() + 9 * 3600 * 1000); y.setUTCDate(y.getUTCDate() - 1);
    const yd = y.toISOString().slice(0, 10);
    const retro = await db.prepare(
      "SELECT tomorrow_prompt FROM retros WHERE user_email=?1 AND cycle_date=?2 ORDER BY id DESC LIMIT 1"
    ).bind(email, yd).first<{ tomorrow_prompt: string | null }>();
    if (retro?.tomorrow_prompt) L.push("", "📌 어제 회고에서: " + retro.tomorrow_prompt.slice(0, 120));
    L.push("", "오늘 첫 단계: 08:30 회의록 읽기 ✅");
  } else {
    L.push(`🌇 work-cycle 저녁 점검 (${date})`);
    const [checks, verifs, reads, reqs, retros] = await Promise.all([
      db.prepare("SELECT COUNT(*) n FROM checks WHERE user_email=?1 AND cycle_date=?2").bind(email, date).first<{ n: number }>(),
      db.prepare("SELECT COUNT(*) n FROM verifications WHERE user_email=?1 AND cycle_date=?2").bind(email, date).first<{ n: number }>(),
      db.prepare("SELECT COUNT(*) n FROM meeting_reads r JOIN meetings m ON m.id=r.meeting_id WHERE r.user_email=?1 AND m.date=?2").bind(email, meetingReadDate).first<{ n: number }>(),
      db.prepare("SELECT COUNT(*) n FROM ai_requests WHERE user_email=?1 AND cycle_date=?2").bind(email, date).first<{ n: number }>(),
      db.prepare("SELECT COUNT(*) n FROM retros WHERE user_email=?1 AND cycle_date=?2").bind(email, date).first<{ n: number }>(),
    ]);
    const marks = await db.prepare("SELECT step FROM step_marks WHERE user_email=?1 AND cycle_date=?2").bind(email, date).all();
    const marked = (s: Step) => (marks.results as any[]).some((r) => r.step === s);
    const steps: Record<Step, boolean> = {
      read: (reads?.n ?? 0) > 0 || marked("read"),
      plan: (reqs?.n ?? 0) > 0 || marked("plan"),
      work: (checks?.n ?? 0) > 0,
      verify: (verifs?.n ?? 0) > 0,
      share: marked("share"),
      retro: (retros?.n ?? 0) > 0 || marked("retro"),
    };
    const undone = STEPS.filter((s) => !steps[s]);
    const done = STEPS.length - undone.length;
    L.push("", `사이클 ${done}/6 완료`);
    if (undone.length) {
      L.push("⏳ 남은 단계: " + undone.map((s) => STEP_META[s].label).join(", "));
    } else {
      L.push("🎉 오늘 사이클 전부 완료!");
    }
    const mon = weekStart(date), fri = addDays(mon, 6);   // 주 N회 집계는 월~일 7일 합계 (2026-09-27)
    const [habits, habitRecords] = await Promise.all([
      db.prepare(
        "SELECT id, name, emoji, goal, repeat_type, repeat_days FROM habit_buttons WHERE user_email=?1 AND active=1 ORDER BY id"
      ).bind(email).all(),
      db.prepare(
        "SELECT button_id, date, count FROM habit_records WHERE user_email=?1 AND date BETWEEN ?2 AND ?3"
      ).bind(email, mon, fri).all(),
    ]);
    const weekCounts = new Map<number, number>();
    const todayCounts = new Map<number, number>();
    for (const r of habitRecords.results as any[]) {
      weekCounts.set(r.button_id, (weekCounts.get(r.button_id) ?? 0) + r.count);
      if (r.date === date) todayCounts.set(r.button_id, r.count);
    }
    const hs = (habits.results as any[]).filter((h) => habitRepeat(h.repeat_type) === "weekly" || habitCanTapOn(h, date))
      .map((h) => ({ ...h, cnt: habitRepeat(h.repeat_type) === "weekly"
        ? (weekCounts.get(h.id) ?? 0) : (todayCounts.get(h.id) ?? 0) }));
    if (hs.length) {
      const doneH = hs.filter((h) => h.cnt >= h.goal).length;
      L.push("", `🔥 퀵 기록 ${doneH}/${hs.length}`);
      hs.filter((h) => h.cnt < h.goal).slice(0, 4).forEach((h) => L.push(`· ${h.emoji} ${h.name} ${h.cnt}/${h.goal}`));
    }
    L.push("", "17:50 AI 회고까지 마무리하면 내일 아침 질문 템플릿이 준비됩니다 ✍️");
  }
  return L.join("\n");
}

/** 체크리스트 구간 알림 — 해당 섹션에서 아직 안 누른 항목만 */
export async function buildChecklistReminder(
  env: Env, email: string, sections: string[], label: string
): Promise<string | null> {
  const date = kstToday();
  const marks = sections.map((_, i) => `?${i + 3}`).join(",");
  const rows = await env.DB.prepare(
    `SELECT i.section, i.text FROM checklist_items i
     WHERE i.active=1 AND i.section IN (${marks})
       AND NOT EXISTS (SELECT 1 FROM checks c WHERE c.item_id=i.id AND c.user_email=?1 AND c.cycle_date=?2)
     ORDER BY i.sort`
  ).bind(email, date, ...sections).all();
  const left = rows.results as any[];
  if (!left.length) return null; // 다 체크했으면 보내지 않음
  const L = [`📋 ${label} 점검`, "", `아직 안 누른 항목이 ${left.length}개 있어요`, ""];
  for (const r of left.slice(0, 8)) L.push(`□ ${r.text}`);
  if (left.length > 8) L.push(`… 외 ${left.length - 8}개`);
  return L.join("\n");
}

export async function sendKakaoMemo(env: Env, email: string, text: string, personal = false): Promise<{ ok: boolean; detail?: string }> {
  const token = await freshAccessToken(env, email, "kakao");
  if (!token) return { ok: false, detail: "카카오 연결 없음(또는 토큰 만료) — 마이페이지에서 다시 연결해주세요" };
  const template = {
    object_type: "text",
    text: text.slice(0, 1900),
    link: { web_url: appOrigin(env) + (personal ? "/personal" : ""), mobile_web_url: appOrigin(env) + (personal ? "/personal" : "") },
    button_title: personal ? "개인 화면 열기" : "work-cycle 열기",
  };
  const r = await fetch("https://kapi.kakao.com/v2/api/talk/memo/default/send", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ template_object: JSON.stringify(template) }),
  });
  if (!r.ok) return { ok: false, detail: (await r.text()).slice(0, 300) };
  return { ok: true };
}


// ── 상태·테스트 API ──────────────────────────────────────────────────────────
app.get("/api/reminders/status", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT provider, updated_at FROM oauth_tokens WHERE user_email=?1"
  ).bind(c.get("email")).all();
  const providers = Object.fromEntries((rows.results as any[]).map((r) => [r.provider, r.updated_at]));
  return c.json({
    kakao: providers.kakao ?? null,
    google: providers.google ?? null,
    secrets_ready: !!(c.env.KAKAO_REST_KEY && c.env.KAKAO_CLIENT_SECRET),
    google_ready: !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
  });
});

app.get("/api/reminders/preview", async (c) => {
  const q = c.req.query("when") ?? "evening";
  // 체크리스트 구간도 미리보기 가능: ?when=1000 / 1230 / 1700
  const slot = SLOTS.find((s) => String(s.hhmm) === q);
  if (slot && slot.kind === "report") {
    return c.json({ when: q, text: await buildReportNotice(c.env, c.get("email")) });
  }
  if (slot && slot.kind === "checklist") {
    const text = await buildChecklistReminder(c.env, c.get("email"), slot.sections, slot.label);
    return c.json({ when: q, text: text ?? `(${slot.label} 구간을 모두 체크해서 보내지 않습니다)`, skipped: !text });
  }
  const when = q === "morning" ? "morning" : "evening";
  const text = await buildReminder(c.env, c.get("email"), when);
  return c.json({ when, text });
});

// 전체 알림 시간표 (화면 안내용)
app.get("/api/reminders/slots", (c) => {
  const slots = SLOTS.map((s) => ({
    hhmm: s.hhmm,
    label: s.kind === "brief" ? (s.when === "morning" ? "아침 브리핑" : "저녁 점검") : s.label,
    dow: s.dow ?? null,
    kind: s.kind,
  }));
  // ?at=ISO 시각 → 그때 cron 이 무엇을 보낼지 (주말 규칙 확인용: 토·일은 개인용만)
  const at = c.req.query("at");
  const t = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(t)) return c.json({ slots });
  const kst = new Date(t + 9 * 3600 * 1000);
  const dow = kst.getUTCDay();
  const pick = slotAt(t);
  return c.json({ slots, at: {
    hhmm: kst.getUTCHours() * 100 + kst.getUTCMinutes(), dow,
    slot: pick ? pick.slot.hhmm : null,
    personal_only: pick ? pick.personalOnly : dow === 0 || dow === 6,
  } });
});

app.post("/api/reminders/test", async (c) => {
  const b = await c.req.json<{ when?: string; profile?: string }>().catch(() => ({} as { when?: string; profile?: string }));
  const when = b.when === "morning" ? "morning" : "evening";
  const personal = b.profile === "personal";
  const text = personal ? (await buildPersonalReminder(c.env.DB, c.get("email"), when === "morning" ? 825 : 1740))! : await buildReminder(c.env, c.get("email"), when);
  const sent = await sendKakaoMemo(c.env, c.get("email"), text, personal);
  return c.json({ when, sent: sent.ok, detail: sent.detail ?? null, text });
});


// ── Cron ─────────────────────────────────────────────────────────────────────
/**
 * 알림 시간표 (KST). Cloudflare 무료 플랜은 Worker당 cron 트리거가 3개까지라
 * 표현식 하나(wrangler.toml crons)로 받아 여기서 시각을 보고 갈라 보낸다. 표에 없는 시각은 그냥 통과.
 */
export type Slot =
  | { hhmm: number; kind: "brief"; when: "morning" | "evening"; dow?: number }
  | { hhmm: number; kind: "checklist"; sections: string[]; label: string; dow?: number }
  | { hhmm: number; kind: "report"; label: string; dow: number };

export const SLOTS: Slot[] = [
  { hhmm: 825,  kind: "brief", when: "morning" },
  { hhmm: 1000, kind: "checklist", sections: ["하루 시작"], label: "하루 시작" },
  { hhmm: 1230, kind: "checklist", sections: ["작업 중", "AI 사용"], label: "작업 중 · AI 사용" },
  { hhmm: 1300, kind: "report", label: "주간업무보고 초안", dow: 5 },   // 금요일만
  { hhmm: 1700, kind: "checklist", sections: ["제출 전"], label: "제출 전" },
  { hhmm: 1740, kind: "brief", when: "evening" },
];

/** 금요일 13:00 — 이번 주 보고 초안이 준비됐다는 알림 */
export async function buildReportNotice(env: Env, email: string): Promise<string> {
  const mon = weekStart(kstToday());
  const d = await collect(env.DB, email, mon);
  const filled = d.days.filter((x) => x.done.trim()).length;
  const app_url = env.APP_URL ?? "http://localhost:8788";
  const lines = [
    `📄 ${d.label} 주간업무보고 초안이 준비됐습니다`,
    `기록이 채워진 날: ${filled}/${d.days.length}일`,
    "",
    ...d.days.map((x) => `${x.date.slice(5)}(${x.dow}) ${x.done.trim() ? "○" : "—"}`),
    "",
    "화면에서 손보고 엑셀로 받으세요:",
    `${app_url}/report`,
  ];
  return lines.join("\n").slice(0, 900);
}

/** personalOnly: 주말 — 회사용 알림은 쉬고, 리마인드 모드가 개인용인 사람에게만 보낸다 */
export async function runSlot(env: Env, slot: Slot, opts: { personalOnly?: boolean } = {}) {
  const users = await env.DB.prepare(
    `SELECT DISTINCT t.user_email FROM oauth_tokens t
     WHERE t.provider='kakao'
       AND NOT EXISTS (SELECT 1 FROM team_membership_exits x WHERE x.user_email=t.user_email)`
  ).all();
  for (const u of users.results as any[]) {
    try {
      const personal = (await personalSettings(env.DB, u.user_email)).reminder_mode === "personal";
      if (opts.personalOnly && !personal) continue;
      const text = personal ? await buildPersonalReminder(env.DB, u.user_email, slot.hhmm) : slot.kind === "brief"
        ? await buildReminder(env, u.user_email, slot.when)
        : slot.kind === "report"
        ? await buildReportNotice(env, u.user_email)
        : await buildChecklistReminder(env, u.user_email, slot.sections, slot.label);
      if (text) {
        const sent = await sendKakaoMemo(env, u.user_email, text, personal);
        if (!sent.ok) console.log("reminder_send_failed", { slot: slot.hhmm, mode: personal ? "personal" : "company" });
      }
    } catch (e) {
      console.log("reminder_failed", { slot: slot.hhmm });
    }
  }
}

/** 이 시각(UTC ms)에 보낼 슬롯. 주말(토·일)은 개인용 리마인드만 보낸다(2026-09-27 사용자 결정) — 회사용 알림·금요일 보고는 평일 그대로. */
export function slotAt(scheduledTime: number): { slot: Slot; hhmm: number; dow: number; personalOnly: boolean } | null {
  const kst = new Date(scheduledTime + 9 * 3600 * 1000);
  const dow = kst.getUTCDay();                       // 0=일 … 6=토
  const hhmm = kst.getUTCHours() * 100 + kst.getUTCMinutes();
  const slot = SLOTS.find((s) => s.hhmm === hhmm);
  if (!slot) return null;                            // 표에 없는 시각은 그냥 통과
  if (slot.dow !== undefined && slot.dow !== dow) return null;  // 요일 지정 슬롯 (예: 금요일 보고)
  return { slot, hhmm, dow, personalOnly: dow === 0 || dow === 6 };
}

export const scheduled: ExportedHandlerScheduledHandler<Env> = async (controller, env, ctx) => {
  // 하루 기록 md → 볼트 history/ (23:50 그날 · 00:10 전날, vault-history.ts). 알림 슬롯과 시각이 겹치지 않는다.
  const history = historySlotAt(controller.scheduledTime);
  if (history) { ctx.waitUntil(runHistorySlot(env, history.date)); return; }
  const pick = slotAt(controller.scheduledTime);
  if (!pick) return;
  ctx.waitUntil(runSlot(env, pick.slot, { personalOnly: pick.personalOnly }));
};


export default app;
