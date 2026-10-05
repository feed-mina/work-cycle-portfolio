/**
 * work-cycle — 업무 습관 통합 사이클
 * Cloudflare Workers + Hono + D1. 정적 화면은 public/ (Workers Assets).
 * 인증: Cloudflare Access가 붙이는 Cf-Access-Authenticated-User-Email 헤더.
 *
 * 2026-09-26 분리: 이 파일은 인증 미들웨어 + 라우터 마운트 + export 만 담당한다.
 *   shared.ts        Env 타입 · 상수 · 공용 헬퍼(kstToday 등) · generateAiText
 *   routes/cycle.ts  공통 · 사이클 보드 · 체크리스트 · 검증 · 대시보드 · 위젯 · 계획/회고
 *   routes/schedule.ts  스케줄 · 업무 메모 · 월간 · 도넛 이력 · 화상회의
 *   routes/meetings.ts  회의록 · AI 요약 · 회의 중 메모 · git 대상
 *   routes/kanban.ts    칸반 · GitHub 이슈
 *   routes/habits.ts    퀵 기록
 *   routes/report.ts    주간업무보고 API
 *   auth.ts          OAuth(/auth/*) · 토큰 갱신
 *   reminders.ts     리마인드 조립 · 카카오 발송 · Cron SLOTS · scheduled
 *   personal.ts / vault.ts  개인용 · 볼트(GitHub ME)
 */
import { Hono } from "hono";
import type { Env, Vars } from "./shared";
import personalApi from "./personal";
import vaultApi from "./vault";
import vaultHistoryApi from "./vault-history";
import cycleRoutes from "./routes/cycle";
import scheduleRoutes from "./routes/schedule";
import meetingsRoutes from "./routes/meetings";
import meetingHistoryRoutes from "./meeting-history";
import kanbanRoutes from "./routes/kanban";
import habitsRoutes from "./routes/habits";
import reportRoutes from "./routes/report";
import authRoutes from "./auth";
import remindersRoutes, { scheduled } from "./reminders";

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// ── 인증: Access 헤더 → 사용자 upsert ────────────────────────────────────────
app.use("/api/*", async (c, next) => {
  const email =
    c.req.header("Cf-Access-Authenticated-User-Email") ||
    c.env.DEV_EMAIL ||
    "";
  if (!email) return c.json({ error: "인증 정보가 없습니다 (Cloudflare Access 필요)" }, 401);
  c.set("email", email);
  await c.env.DB.prepare(
    "INSERT INTO users (email, name) VALUES (?1, ?2) ON CONFLICT(email) DO NOTHING"
  ).bind(email, email.split("@")[0]).run();
  await next();
});


// 마운트는 반드시 위 미들웨어 뒤에 — 하위 라우터가 c.get("email") 을 그대로 쓴다
app.route("/api/personal", personalApi);
app.route("/api/vault", vaultApi);
app.route("/api/vault-history", vaultHistoryApi);
app.route("/", cycleRoutes);
app.route("/", scheduleRoutes);
app.route("/", meetingsRoutes);
app.route("/", meetingHistoryRoutes);
app.route("/", kanbanRoutes);
app.route("/", habitsRoutes);
app.route("/", reportRoutes);
app.route("/", authRoutes);       // /auth/* — /api 미들웨어 밖
app.route("/", remindersRoutes);  // /api/reminders/*

export default { fetch: app.fetch, scheduled };
