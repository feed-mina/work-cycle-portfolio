/* routes/habits.ts — 퀵 기록(습관 버튼) — habitCanTapOn 은 reminders.ts 도 쓴다
 * index.ts 에서 2026-09-26 분리. 라우트 경로·동작은 그대로다. /api/* 인증 미들웨어(c.get("email"))는 index.ts 가 먼저 건다. */
import { Hono } from "hono";
import type { Env, Vars } from "../shared";
import { safeDate, kstTime } from "../shared";
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// ── 퀵 기록 (습관 버튼) ──
/** daily=평일 매일(1~5) · everyday=매일(1~7) · weekend=주말만(6·7) · selected=요일 선택 · weekly=주 N회(월~일 합계). 2026-09-27 토·일 추가 */
export type HabitRepeat = "daily" | "everyday" | "weekend" | "selected" | "weekly";

export function habitRepeat(v: unknown): HabitRepeat {
  return v === "selected" || v === "weekly" || v === "everyday" || v === "weekend" ? v : "daily";
}

export function habitRepeatDays(v: unknown): string {
  const raw = Array.isArray(v) ? v : String(v ?? "").split(",");
  return [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))]
    .sort((a, b) => a - b).join(",");
}

/** ISO 요일: 월=1 ... 일=7 */
export function habitWeekday(date: string): number {
  const d = new Date(date + "T00:00:00Z").getUTCDay();
  return d === 0 ? 7 : d;
}

export function habitCanTapOn(button: { repeat_type?: string; repeat_days?: string }, date: string): boolean {
  const dow = habitWeekday(date);
  const repeat = habitRepeat(button.repeat_type);
  if (repeat === "daily") return dow <= 5;          // 평일 매일 — 기존 버튼(repeat_days '1,2,3,4,5')은 그대로 평일만
  if (repeat === "everyday" || repeat === "weekly") return true;
  if (repeat === "weekend") return dow >= 6;
  return habitRepeatDays(button.repeat_days).split(",").includes(String(dow));
}


app.get("/api/habits", async (c) => {
  const from = safeDate(c.req.query("from")), to = safeDate(c.req.query("to"));
  const email = c.get("email");
  const [buttons, records, taps] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM habit_buttons WHERE user_email=?1 AND active=1 ORDER BY sort, id").bind(email).all(),
    c.env.DB.prepare("SELECT button_id, date, count FROM habit_records WHERE user_email=?1 AND date BETWEEN ?2 AND ?3").bind(email, from, to).all(),
    c.env.DB.prepare("SELECT button_id, date, tapped_time FROM habit_taps WHERE user_email=?1 AND date BETWEEN ?2 AND ?3 ORDER BY id").bind(email, from, to).all(),
  ]);
  return c.json({ buttons: buttons.results, records: records.results, taps: taps.results });
});

app.post("/api/habits", async (c) => {
  const b = await c.req.json<{
    name: string; emoji?: string; goal?: number; category?: string;
    repeat_type?: string; repeat_days?: number[] | string;
  }>();
  if (!b.name?.trim()) return c.json({ error: "이름은 필수입니다" }, 400);
  const repeat = habitRepeat(b.repeat_type);
  const repeatDays = repeat === "daily" ? "1,2,3,4,5"
    : repeat === "everyday" ? "1,2,3,4,5,6,7"
    : repeat === "weekend" ? "6,7"
    : repeat === "selected" ? habitRepeatDays(b.repeat_days) : "";
  if (repeat === "selected" && !repeatDays)
    return c.json({ error: "반복할 요일을 하나 이상 선택하세요" }, 400);
  await c.env.DB.prepare(
    `INSERT INTO habit_buttons (user_email, name, emoji, goal, category, repeat_type, repeat_days)
     VALUES (?1,?2,?3,?4,?5,?6,?7)`
  ).bind(c.get("email"), b.name.trim(), (b.emoji || "🔥").slice(0, 8),
         Math.max(1, b.goal ?? 1), b.category ?? null, repeat, repeatDays).run();
  return c.json({ ok: true });
});

app.post("/api/habits/:id/tap", async (c) => {
  const body: { date?: string } = await c.req.json<{ date?: string }>().catch(() => ({} as { date?: string }));
  const d = safeDate(body.date);
  const email = c.get("email"), id = c.req.param("id");
  const button = await c.env.DB.prepare(
    "SELECT repeat_type, repeat_days FROM habit_buttons WHERE id=?1 AND user_email=?2 AND active=1"
  ).bind(id, email).first<{ repeat_type: string; repeat_days: string }>();
  if (!button) return c.json({ error: "퀵 기록 버튼이 없습니다" }, 404);
  if (!habitCanTapOn(button, d)) return c.json({ error: "이 버튼은 오늘 기록하는 항목이 아닙니다" }, 400);
  const tappedTime = kstTime();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO habit_records (button_id, user_email, date, count) VALUES (?1,?2,?3,1)
       ON CONFLICT(button_id, date) DO UPDATE SET count = count + 1`
    ).bind(id, email, d),
    c.env.DB.prepare(
      "INSERT INTO habit_taps (button_id, user_email, date, tapped_time) VALUES (?1,?2,?3,?4)"
    ).bind(id, email, d, tappedTime),
  ]);
  return c.json({ ok: true, date: d, time: tappedTime });
});

app.delete("/api/habits/:id", async (c) => {
  await c.env.DB.prepare("UPDATE habit_buttons SET active=0 WHERE id=?1 AND user_email=?2")
    .bind(c.req.param("id"), c.get("email")).run();
  return c.json({ ok: true });
});


export default app;
