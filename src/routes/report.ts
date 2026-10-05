/* routes/report.ts — 주간업무보고 API (집계·양식 조립은 src/report.ts)
 * index.ts 에서 2026-09-26 분리. 라우트 경로·동작은 그대로다. /api/* 인증 미들웨어(c.get("email"))는 index.ts 가 먼저 건다. */
import { Hono } from "hono";
import type { Env, Vars, AiProvider } from "../shared";
import { kstToday, DATE_RE, generateAiText, AI_DAILY_LIMIT, noteScope } from "../shared";
import { collect, toXlsx, fileName, weekStart, addDays } from "../report";
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// ── 주간업무보고 ────────────────────────────────────────────────────────────
/** ?week= 아무 날짜 → 그 주 월요일. 없으면 이번 주 */
function weekParam(v: string | undefined): string {
  return weekStart(v && DATE_RE.test(v) ? v : kstToday());
}
/** 보고 행 수: 개인용(사용 화면 = 개인용)은 월~일 7행, 회사용은 양식대로 월~금 5행 (2026-09-27 사용자 결정) */
async function reportDays(c: { env: Env; get: (k: "email") => string }): Promise<5 | 7> {
  return (await noteScope(c)) === "personal" ? 7 : 5;
}

app.get("/api/report/settings", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM report_settings WHERE user_email=?1")
    .bind(c.get("email")).first<any>();
  return c.json({ settings: row ?? null });
});

app.put("/api/report/settings", async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));
  const g = (k: string, d = "") => String(b[k] ?? d).slice(0, 200);
  await c.env.DB.prepare(
    `INSERT INTO report_settings (user_email, author, dept, role_name, prj_code, project, goal)
     VALUES (?1,?2,?3,?4,?5,?6,?7)
     ON CONFLICT(user_email) DO UPDATE SET
       author=?2, dept=?3, role_name=?4, prj_code=?5, project=?6, goal=?7`
  ).bind(c.get("email"), g("author"), g("dept", "기술연구소"), g("role_name", "연구원"),
         g("prj_code"), g("project"), String(b.goal ?? "").slice(0, 1000)).run();
  return c.json({ ok: true });
});

app.get("/api/report/weekly", async (c) => {
  const mon = weekParam(c.req.query("week"));
  const data = await collect(c.env.DB, c.get("email"), mon, await reportDays(c));
  return c.json({
    ...data,
    prev: addDays(mon, -7),
    next_week: addDays(mon, 7),
    file_name: fileName(data),
  });
});

/** 한 칸 보정 저장 — field: e:날짜 | f:날짜 | c:날짜 | goal | next | author */
app.put("/api/report/cell", async (c) => {
  const b = await c.req.json<{ week?: string; field?: string; value?: string }>().catch(() => ({} as any));
  const mon = weekParam(b.week);
  const field = String(b.field ?? "");
  if (!/^(e|f|c):\d{4}-\d{2}-\d{2}$|^(goal|next|author)$/.test(field))
    return c.json({ error: "알 수 없는 칸입니다" }, 400);
  const value = String(b.value ?? "").slice(0, 4000);
  await c.env.DB.prepare(
    `INSERT INTO report_overrides (user_email, week_start, field, value)
     VALUES (?1,?2,?3,?4)
     ON CONFLICT(user_email, week_start, field) DO UPDATE SET value=?4, updated_at=datetime('now')`
  ).bind(c.get("email"), mon, field, value).run();
  return c.json({ ok: true });
});

/**
 * 초안 문장 다듬기 — 자동 집계된 진행사항/진행예정을 보고서 문장으로 고친다.
 *
 * 금요일 cron에서 자동으로 돌리지 않는다. 사람 수만큼 호출이 나가 하루 한도를 조용히
 * 소진하기 때문이고, 다듬은 결과는 사람이 보고 판단해야 하는 값이기 때문이다.
 * 한 주 전체를 호출 1회로 처리하고, 결과는 report_overrides에 고정한다.
 * (고정하지 않으면 다음 자동 갱신 때 사라진다.)
 * 사용자가 이미 손으로 고친 칸은 건드리지 않는다.
 */
app.post("/api/report/polish", async (c) => {
  const b = await c.req.json<{ week?: string }>().catch(() => ({} as any));
  const mon = weekParam(b.week);
  if (!c.env.AI && !c.env.GEMINI_API_KEY)
    return c.json({ error: "사용 가능한 AI 연결이 설정되지 않았습니다" }, 400);

  const email = c.get("email"), today = kstToday();
  const usage = await c.env.DB.prepare("SELECT calls FROM ai_usage WHERE user_email=?1 AND date=?2")
    .bind(email, today).first<{ calls: number }>();
  if ((usage?.calls ?? 0) >= AI_DAILY_LIMIT)
    return c.json({ error: `오늘 AI 호출 한도(${AI_DAILY_LIMIT}회)를 초과했습니다` }, 429);

  const d = await collect(c.env.DB, email, mon, await reportDays(c));
  const targets: { field: string; text: string }[] = [];
  for (const day of d.days) {
    for (const [k, v] of [["e", day.done], ["f", day.todo]] as const) {
      const field = `${k}:${day.date}`;
      if (d.edited.includes(field)) continue;   // 손으로 고친 칸은 그대로 둔다
      if (!v.trim()) continue;                  // 기록 없는 칸은 다듬을 게 없다
      targets.push({ field, text: v.slice(0, 2000) });
    }
  }
  if (!targets.length)
    return c.json({ ok: true, updated: 0, fields: [], calls: usage?.calls ?? 0, limit: AI_DAILY_LIMIT,
                    note: "다듬을 자동 집계 칸이 없습니다 (기록이 없거나 이미 직접 고친 칸뿐)" });

  const polishFallback = (detail: string) => c.json({
    ok: true,
    updated: 0,
    fields: [],
    fallback: true,
    calls: usage?.calls ?? 0,
    limit: AI_DAILY_LIMIT,
    note: `AI를 사용할 수 없어 문장 다듬기만 건너뛰었습니다. 메모가 반영된 자동 초안은 그대로 유지됩니다.\n\n원인: ${detail.slice(0, 400)}`,
  });

  const prompt = [
    "너는 회사 주간업무보고 문장을 다듬는 도우미다.",
    "아래 각 칸의 초안을 보고서에 그대로 넣을 수 있게 정리하라.",
    "",
    "필드 의미:",
    "- `e:날짜`는 그날 실제로 수행한 진행사항이다. 일정 메모와 작업 기록을 중심으로 쓴다.",
    "- `f:날짜`는 다음 업무일의 진행사항을 미리 적는 진행예정이다.",
    "",
    "규칙 (반드시 지킬 것):",
    "- 초안에 없는 사실을 추가하거나 추측하지 마라. 모르는 것은 쓰지 마라.",
    "- `[업무]` 같은 대괄호 머리말은 첫 줄에 그대로 둔다. 내용 불릿은 `* `로 시작한다.",
    "- `e:` 진행사항은 같은 날 메모의 실제 작업을 1~4개 불릿으로 묶고, 중복만 합친다.",
    "- `f:` 진행예정은 다음 업무일 내용을 정보 손실 없이 한 문장·한 불릿으로 요약하고 마지막을 `예정`으로 끝낸다.",
    "- 진행 중인 내용을 근거 없이 완료로 바꾸지 말고 `진행`, `확인`, `작성`처럼 원문 수준을 유지한다.",
    "- 같은 날 메모를 진행예정으로 다시 옮기지 마라.",
    "- 숫자, 파일명, seq 번호, 고유명사, 대괄호 머리말([업무] 등)은 절대 바꾸지 마라.",
    "- 진행사항은 무엇을 어디까지 했는지 드러나게 명사형으로 끝낸다.",
    "- 군더더기(정말, 매우, ~것 같다)를 빼라.",
    "",
    "출력 형식을 정확히 지켜라. 다른 말은 붙이지 마라:",
    "<<<필드키>>>",
    "다듬은 내용",
    "<<<END>>>",
    "",
    "---- 다듬을 칸 ----",
    ...targets.map(t => `<<<${t.field}>>>\n${t.text}\n<<<END>>>`),
  ].join("\n");

  let raw: string;
  let provider: AiProvider | "mock" = "mock";
  if (c.env.GEMINI_API_KEY === "dev-mock") {
    raw = targets.map(t => `<<<${t.field}>>>\n${t.text.split("\n").map(l =>
      l.startsWith("* ")
        ? (t.field.startsWith("f:") ? l.replace(/\s*예정\s*$/, " 진행 예정") : l.replace(/\s*$/, "") + " (다듬음)")
        : l).join("\n")}\n<<<END>>>`).join("\n");
  } else {
    try {
      const generated = await generateAiText(c.env, prompt, 3200);
      raw = generated.text;
      provider = generated.provider;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ event: "report_polish_fallback", detail: detail.slice(0, 1000) }));
      return polishFallback(detail);
    }
  }

  // 요청한 칸만 골라 반영한다 — AI가 없는 키를 지어내도 무시된다
  const asked = new Map(targets.map(t => [t.field, t.text]));
  const done: string[] = [];
  for (const m of raw.matchAll(/<<<([^>\n]+)>>>\n([\s\S]*?)\n?<<<END>>>/g)) {
    const field = m[1].trim();
    const text = m[2].trim();
    if (!asked.has(field) || !text) continue;
    if (text === asked.get(field)) continue;            // 달라진 게 없으면 고정하지 않는다
    await c.env.DB.prepare(
      `INSERT INTO report_overrides (user_email, week_start, field, value)
       VALUES (?1,?2,?3,?4)
       ON CONFLICT(user_email, week_start, field) DO UPDATE SET value=?4, updated_at=datetime('now')`
    ).bind(email, mon, field, text.slice(0, 4000)).run();
    done.push(field);
  }

  await c.env.DB.prepare(
    `INSERT INTO ai_usage (user_email, date, calls) VALUES (?1,?2,1)
     ON CONFLICT(user_email, date) DO UPDATE SET calls = calls + 1`
  ).bind(email, today).run();

  return c.json({ ok: true, updated: done.length, fields: done, provider,
                  calls: (usage?.calls ?? 0) + 1, limit: AI_DAILY_LIMIT });
});

/** 보정값 되돌리기 (자동 집계로 복귀) */
app.delete("/api/report/cell", async (c) => {
  const b = await c.req.json<{ week?: string; field?: string }>().catch(() => ({} as any));
  const mon = weekParam(b.week);
  if (b.field) {
    await c.env.DB.prepare("DELETE FROM report_overrides WHERE user_email=?1 AND week_start=?2 AND field=?3")
      .bind(c.get("email"), mon, String(b.field)).run();
  } else {
    await c.env.DB.prepare("DELETE FROM report_overrides WHERE user_email=?1 AND week_start=?2")
      .bind(c.get("email"), mon).run();
  }
  return c.json({ ok: true });
});

app.get("/api/report/weekly.xlsx", async (c) => {
  const mon = weekParam(c.req.query("week"));
  const data = await collect(c.env.DB, c.get("email"), mon, await reportDays(c));
  const buf = toXlsx(data);
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        `attachment; filename="weekly-report-${mon}.xlsx"; filename*=UTF-8''` +
        encodeURIComponent(fileName(data)),
      "Cache-Control": "no-store",
    },
  });
});


export default app;
