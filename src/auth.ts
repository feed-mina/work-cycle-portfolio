/* auth.ts — 카카오·구글 OAuth 연결(/auth/*)과 토큰 저장·갱신
 * index.ts 에서 2026-09-26 분리. /auth/* 는 /api 미들웨어 밖이라 authEmail() 로 이메일을 직접 읽는다. */
import { Hono } from "hono";
import type { Env, Vars } from "./shared";
import { appOrigin } from "./shared";
import { personalSettings } from "./personal";

/** 연결 뒤 돌아갈 홈 — 사용 화면이 개인용이면 개인 마이페이지로 (회사 화면으로 보내면 모드 이동이 한 번 더 일어난다) */
async function homeFor(env: Env, email: string, connected: string): Promise<string> {
  const s = await personalSettings(env.DB, email).catch(() => null);
  return (s?.view_mode === "personal" ? "/personal" : "/") + "?connected=" + connected;
}

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

/** /auth/* 는 Access 뒤에 있지만 /api 미들웨어 밖 — 이메일 직접 추출 */
export function authEmail(c: any): string {
  return c.req.header("Cf-Access-Authenticated-User-Email") || c.env.DEV_EMAIL || "";
}

export async function saveToken(env: Env, email: string, provider: string, tok: {
  access_token?: string; refresh_token?: string; expires_in?: number;
}) {
  const expiresAt = tok.expires_in ? Date.now() + tok.expires_in * 1000 : null;
  if (tok.refresh_token) {
    await env.DB.prepare(
      `INSERT INTO oauth_tokens (user_email, provider, access_token, refresh_token, expires_at, updated_at)
       VALUES (?1,?2,?3,?4,?5,datetime('now'))
       ON CONFLICT(user_email, provider) DO UPDATE SET
         access_token=?3, refresh_token=?4, expires_at=?5, updated_at=datetime('now')`
    ).bind(email, provider, tok.access_token ?? null, tok.refresh_token, expiresAt).run();
  } else {
    await env.DB.prepare(
      `UPDATE oauth_tokens SET access_token=?3, expires_at=?4, updated_at=datetime('now')
       WHERE user_email=?1 AND provider=?2`
    ).bind(email, provider, tok.access_token ?? null, expiresAt).run();
  }
}

export async function getStoredToken(env: Env, email: string, provider: string) {
  return env.DB.prepare(
    "SELECT access_token, refresh_token, expires_at FROM oauth_tokens WHERE user_email=?1 AND provider=?2"
  ).bind(email, provider).first<{ access_token: string | null; refresh_token: string; expires_at: number | null }>();
}

/** 유효한 access token 확보 (만료 시 refresh, 카카오는 새 refresh_token이 오면 교체) */
export async function freshAccessToken(env: Env, email: string, provider: "kakao" | "google"): Promise<string | null> {
  const row = await getStoredToken(env, email, provider);
  if (!row) return null;
  if (row.access_token && row.expires_at && row.expires_at > Date.now() + 60_000) return row.access_token;

  const body = new URLSearchParams(
    provider === "kakao"
      ? {
          grant_type: "refresh_token",
          client_id: env.KAKAO_REST_KEY || "",
          client_secret: env.KAKAO_CLIENT_SECRET || "",
          refresh_token: row.refresh_token,
        }
      : {
          grant_type: "refresh_token",
          client_id: env.GOOGLE_CLIENT_ID || "",
          client_secret: env.GOOGLE_CLIENT_SECRET || "",
          refresh_token: row.refresh_token,
        }
  );
  const url = provider === "kakao" ? "https://kauth.kakao.com/oauth/token" : "https://oauth2.googleapis.com/token";
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) return null;
  const tok = await r.json<{ access_token: string; refresh_token?: string; expires_in?: number }>();
  await saveToken(env, email, provider, tok);
  return tok.access_token;
}


// ── OAuth 연결 시작/콜백 ─────────────────────────────────────────────────────
app.get("/auth/kakao/start", (c) => {
  const email = authEmail(c);
  if (!email) return c.text("Cloudflare Access 로그인이 필요합니다", 401);
  if (!c.env.KAKAO_REST_KEY) return c.text("KAKAO_REST_KEY secret이 등록되지 않았습니다", 500);
  const u = new URL("https://kauth.kakao.com/oauth/authorize");
  u.searchParams.set("client_id", c.env.KAKAO_REST_KEY);
  u.searchParams.set("redirect_uri", appOrigin(c.env) + "/auth/kakao/callback");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "talk_message");
  return c.redirect(u.toString());
});

app.get("/auth/kakao/callback", async (c) => {
  const email = authEmail(c);
  if (!email) return c.text("Cloudflare Access 로그인이 필요합니다", 401);
  const code = c.req.query("code");
  if (!code) return c.text("카카오 인증이 취소되었습니다: " + (c.req.query("error_description") || ""), 400);
  const r = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: c.env.KAKAO_REST_KEY || "",
      client_secret: c.env.KAKAO_CLIENT_SECRET || "",
      redirect_uri: appOrigin(c.env) + "/auth/kakao/callback",
      code,
    }),
  });
  if (!r.ok) return c.text("카카오 토큰 발급 실패: " + (await r.text()).slice(0, 300), 502);
  const tok = await r.json<{ access_token: string; refresh_token: string; expires_in: number }>();
  await c.env.DB.prepare(
    "INSERT INTO users (email, name) VALUES (?1, ?2) ON CONFLICT(email) DO NOTHING"
  ).bind(email, email.split("@")[0]).run();
  await saveToken(c.env, email, "kakao", tok);
  return c.redirect(await homeFor(c.env, email, "kakao"));
});

app.get("/auth/google/start", (c) => {
  const email = authEmail(c);
  if (!email) return c.text("Cloudflare Access 로그인이 필요합니다", 401);
  if (!c.env.GOOGLE_CLIENT_ID) return c.text("GOOGLE_CLIENT_ID secret이 등록되지 않았습니다", 500);
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", c.env.GOOGLE_CLIENT_ID);
  u.searchParams.set("redirect_uri", appOrigin(c.env) + "/auth/google/callback");
  u.searchParams.set("response_type", "code");
  // events: 화상회의 일정 만들기(Meet 링크) + 읽기까지 포함
  u.searchParams.set("scope", "https://www.googleapis.com/auth/calendar.events");
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent"); // 재연결 시에도 refresh_token 재발급
  return c.redirect(u.toString());
});

app.get("/auth/google/callback", async (c) => {
  const email = authEmail(c);
  if (!email) return c.text("Cloudflare Access 로그인이 필요합니다", 401);
  const code = c.req.query("code");
  if (!code) return c.text("구글 인증이 취소되었습니다: " + (c.req.query("error") || ""), 400);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: c.env.GOOGLE_CLIENT_ID || "",
      client_secret: c.env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: appOrigin(c.env) + "/auth/google/callback",
      code,
    }),
  });
  if (!r.ok) return c.text("구글 토큰 발급 실패: " + (await r.text()).slice(0, 300), 502);
  const tok = await r.json<{ access_token: string; refresh_token?: string; expires_in: number }>();
  if (!tok.refresh_token) {
    const existing = await getStoredToken(c.env, email, "google");
    if (!existing) return c.text("구글이 refresh token을 주지 않았습니다. 구글 계정 → 보안 → 서드파티 액세스에서 work-cycle 연결을 삭제 후 다시 연결해주세요.", 502);
  }
  await c.env.DB.prepare(
    "INSERT INTO users (email, name) VALUES (?1, ?2) ON CONFLICT(email) DO NOTHING"
  ).bind(email, email.split("@")[0]).run();
  await saveToken(c.env, email, "google", tok);
  return c.redirect(await homeFor(c.env, email, "google"));
});


export default app;
