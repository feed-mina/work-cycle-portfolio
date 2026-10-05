/* vault-history.ts — 하루 기록 md 를 볼트(GitHub ME 저장소)의 history/ 에 하루 한 파일로 올린다 (2026-10-02 사용자 결정)
 *
 * 언제: 매일 23:50 KST(그날 파일) · 다음 날 00:10 KST(전날 파일 한 번 더 — 23:50 이후 수정 반영) cron,
 *       그리고 개인 마이페이지 메모 카드의 [ME에 올리기](고른 날짜, 수동).
 * 무엇: personalDayMarkdown 과 같은 내용(= [md 내려받기] 파일). 파일명 {VAULT_HISTORY_DIR}/YYYY-MM-DD_work-cycle.md
 *       같은 날 다시 올리면 그 파일만 최신으로 덮어쓴다. 내용이 같으면 커밋하지 않는다. 기록이 하나도 없는 날은 올리지 않는다.
 * 누구: VAULT_HISTORY_EMAIL 한 사람(볼트 주인)의 개인용 기록만. 이 값이 없으면 기능 전체가 꺼진다 — 다른 사람 기록이 ME 에 섞이지 않게.
 * 권한: GITHUB_TOKEN_VAULT(없으면 GITHUB_TOKEN)가 VAULT_REPO 에 Contents: Read and write.
 *       vault.ts 의 읽기 경로는 그대로 읽기 전용이다 — 쓰기는 이 파일의 history/ 한 폴더뿐.
 * 실패: GitHub 응답 원문을 그대로 돌려주고 로그에 남긴다(AGENTS.md 2-4). 토큰·이메일은 로그에 넣지 않는다.
 *
 * vault.ts 가 personal.ts 를 import 하므로(personal → vault 는 순환) 별도 파일로 둔다. */
import { Hono } from "hono";
import type { Env, Vars } from "./shared";
import { personalDayMarkdown, validDate, personalToday } from "./personal";

const HISTORY_DIR_DEFAULT = "history";
const VAULT_REPO_DEFAULT = "feed-mina/ME";

/** cron 시각(KST hhmm) → 올릴 날짜(오늘 기준 며칠 전). reminders.ts 의 SLOTS 와 같은 cron 표현식 하나로 받는다. */
export const HISTORY_SLOTS: { hhmm: number; dayOffset: 0 | -1 }[] = [
  { hhmm: 2350, dayOffset: 0 },
  { hhmm: 10, dayOffset: -1 },
];
export function historySlotAt(scheduledTime: number): { date: string; hhmm: number } | null {
  const kst = new Date(scheduledTime + 9 * 3600 * 1000);
  const hhmm = kst.getUTCHours() * 100 + kst.getUTCMinutes();
  const slot = HISTORY_SLOTS.find((s) => s.hhmm === hhmm);
  if (!slot) return null;
  kst.setUTCDate(kst.getUTCDate() + slot.dayOffset);
  return { date: kst.toISOString().slice(0, 10), hhmm };
}

export function historyConfig(env: Env) {
  const email = (env.VAULT_HISTORY_EMAIL || "").trim().toLowerCase();
  const token = env.GITHUB_TOKEN_VAULT || env.GITHUB_TOKEN || "";
  const dir = (env.VAULT_HISTORY_DIR || HISTORY_DIR_DEFAULT).normalize("NFC").trim().replace(/^\/+|\/+$/g, "");
  const repo = env.VAULT_REPO || VAULT_REPO_DEFAULT;
  const reason = !email ? "VAULT_HISTORY_EMAIL 이 설정되지 않았습니다" : !token ? "GITHUB_TOKEN_VAULT 가 설정되지 않았습니다"
    : !dir || dir.includes("..") ? "VAULT_HISTORY_DIR 경로가 올바르지 않습니다" : "";
  return { enabled: !reason, reason, email, token, dir, repo };
}
export const historyPath = (dir: string, date: string) => `${dir}/${date}_work-cycle.md`;

/** 그날 올릴 기록이 하나라도 있는지 — 계획·회고·개인용 업무 일정·메모 (빈 파일을 매일 만들지 않게) */
async function dayHasRecords(db: D1Database, email: string, date: string): Promise<boolean> {
  const row = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM personal_plans WHERE user_email=?1 AND cycle_date=?2)
    + (SELECT COUNT(*) FROM personal_retros WHERE user_email=?1 AND cycle_date=?2)
    + (SELECT COUNT(*) FROM schedules WHERE user_email=?1 AND scope='personal' AND date=?2 AND block_type='업무')
    + (SELECT COUNT(*) FROM schedule_logs l JOIN schedules s ON s.id=l.schedule_id WHERE l.user_email=?1 AND s.scope='personal' AND l.logged_date=?2) AS n`)
    .bind(email, date).first<{ n: number }>();
  return (row?.n ?? 0) > 0;
}

// GitHub contents API 는 base64 — 한글이 깨지지 않게 UTF-8 바이트 단위로 바꾼다 (큰 문자열은 나눠서)
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}

export type HistoryResult =
  | { ok: true; status: "uploaded" | "unchanged" | "empty"; path: string; date: string }
  | { ok: false; status: "disabled" | "error"; path?: string; date: string; error: string };

/** 그날 하루 기록 md 를 history/ 에 올린다. cron 과 [ME에 올리기]가 같이 쓴다. */
export async function syncDayToVault(env: Env, date: string): Promise<HistoryResult> {
  const cfg = historyConfig(env);
  if (!cfg.enabled) return { ok: false, status: "disabled", date, error: cfg.reason };
  const path = historyPath(cfg.dir, date);
  if (!(await dayHasRecords(env.DB, cfg.email, date))) return { ok: true, status: "empty", path, date };
  const md = await personalDayMarkdown(env.DB, cfg.email, date);

  const url = `${env.GITHUB_API_BASE || "https://api.github.com"}/repos/${cfg.repo}/contents/${encodeURI(path)}`;
  const headers = { Authorization: `Bearer ${cfg.token}`, Accept: "application/vnd.github+json", "User-Agent": "work-cycle" };
  let sha: string | undefined;
  try {
    const cur = await fetch(url, { headers });
    if (cur.ok) {
      const file = await cur.json<{ sha?: string; content?: string }>();
      sha = file.sha;
      if (file.content !== undefined && fromBase64(file.content) === md) return { ok: true, status: "unchanged", path, date };
    } else if (cur.status !== 404) {
      const full = await cur.text();                    // 판별은 전문으로, 표시만 잘라서 (AGENTS.md 2-4)
      return { ok: false, status: "error", path, date, error: `GitHub 파일 확인 실패 (${cur.status}) ${full.slice(0, 400)}` };
    }
    const put = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ message: `work-cycle: ${date} 하루 기록`, content: toBase64(md), ...(sha ? { sha } : {}) }),
    });
    if (!put.ok) {
      const full = await put.text();
      const hint = put.status === 403 || put.status === 404 ? " — 토큰에 이 저장소 Contents: Read and write 권한이 있는지 확인하세요 (docs/DEPLOY.md)" : "";
      return { ok: false, status: "error", path, date, error: `GitHub 올리기 실패 (${put.status}) ${full.slice(0, 400)}${hint}` };
    }
    return { ok: true, status: "uploaded", path, date };
  } catch (e) {                                          // 네트워크 단계 실패도 원문 그대로
    return { ok: false, status: "error", path, date, error: `GitHub 연결 실패 ${String(e instanceof Error ? e.message : e).slice(0, 300)}` };
  }
}

/** cron 에서 부른다 — 결과를 로그에 남긴다(경로·상태·GitHub 원문만, 이메일·토큰 없음) */
export async function runHistorySlot(env: Env, date: string) {
  const r = await syncDayToVault(env, date);
  if (r.ok) console.log("vault_history", { date, status: r.status, path: r.path });
  else if (r.status === "disabled") console.log("vault_history", { date, status: r.status });
  else console.error("vault_history_failed", { date, path: r.path, error: r.error });
}

// ── 화면용: 상태 · 수동 올리기 (/api/vault-history/*) ──────────────────────────
const app = new Hono<{ Bindings: Env; Variables: Vars }>();
app.use("*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  if (!["GET", "HEAD"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "같은 사이트에서 요청해주세요" }, 403);
  }
  await next();
});
/** 버튼을 보여 줄지 — 볼트 주인 본인에게만, 꺼져 있으면 이유를 알려 준다 */
app.get("/status", (c) => {
  const cfg = historyConfig(c.env);
  const mine = !!cfg.email && cfg.email === c.get("email").trim().toLowerCase();
  return c.json({ enabled: cfg.enabled, mine, reason: mine ? cfg.reason : "", dir: mine ? cfg.dir : null, schedule: "매일 23:50 · 다음 날 00:10 (KST)" });
});
app.post("/sync", async (c) => {
  const cfg = historyConfig(c.env);
  if (!cfg.email || cfg.email !== c.get("email").trim().toLowerCase()) return c.json({ error: "볼트에 올리는 기능은 볼트 주인만 쓸 수 있습니다" }, 403);
  const b = await c.req.json<{ date?: string }>().catch(() => ({} as { date?: string }));
  const date = b.date ?? personalToday();
  if (!validDate(date) || date > personalToday()) return c.json({ error: "날짜가 올바르지 않습니다" }, 400);
  const r = await syncDayToVault(c.env, date);
  if (!r.ok) return c.json(r, r.status === "disabled" ? 400 : 502);
  return c.json(r);
});
export default app;
