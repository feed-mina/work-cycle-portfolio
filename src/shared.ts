/* shared.ts — Env 타입 · 사이클 상수 · 공용 헬퍼 · AI 호출
 * index.ts 에서 2026-09-26 분리. 라우트 파일들이 여기서만 가져다 쓴다(순환 import 금지). */
import { personalSettings } from "./personal";

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  AI?: Ai;
  GITHUB_TOKEN?: string;
  GITHUB_TOKEN_VAULT?: string;  // 옵시디언 볼트 전용 GitHub 토큰
  GITHUB_API_BASE?: string;     // 로컬 검증용 GitHub API 주소 (기본 https://api.github.com · 운영에는 넣지 않는다)
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  KAKAO_JS_KEY?: string;
  KAKAO_REST_KEY?: string;      // 카카오 REST API 키 (OAuth client_id)
  KAKAO_CLIENT_SECRET?: string; // 카카오 로그인 클라이언트 시크릿
  GOOGLE_CLIENT_ID?: string;    // 구글 OAuth 클라이언트 ID (캘린더 읽기용)
  GOOGLE_CLIENT_SECRET?: string;
  VAULT_REPO?: string;          // 옵시디언 볼트 미러 레포 (기본 feed-mina/ME)
  VAULT_DIR?: string;           // 그 안의 일일 노트 루트 (기본 daily)
  VAULT_HISTORY_EMAIL?: string; // 하루 기록 md 를 볼트 history/ 에 올릴 사람(볼트 주인) — 없으면 기능 꺼짐 (vault-history.ts)
  VAULT_HISTORY_DIR?: string;   // 볼트 안 올릴 폴더 (기본 history)
  APP_URL?: string;             // 배포 주소 (기본 http://localhost:8788 — 운영에서는 반드시 설정)
  DEV_EMAIL?: string; // 로컬 개발용 (wrangler dev 시 .dev.vars)
};

export type Vars = { email: string };

export const STEPS = ["read", "plan", "work", "verify", "share", "retro"] as const;
export type Step = (typeof STEPS)[number];
export const CHECKLIST_COMPLETE_MIN = 19;

export const STEP_META: Record<Step, { label: string; time: string; tool: string }> = {
  read:   { label: "회의록 읽기",  time: "08:30", tool: "" },
  plan:   { label: "질문 템플릿",  time: "09:30", tool: "" },
  work:   { label: "체크리스트",   time: "작업 중", tool: "" },
  verify: { label: "검증 기록",    time: "16:50", tool: "" },
  share:  { label: "보고·공유",    time: "17:20", tool: "" },
  retro:  { label: "AI 회고",      time: "17:50", tool: "" },
};


/** KST 오늘 날짜 (YYYY-MM-DD) */
export function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** KST 현재 시각 (HH:MM) */
export function kstTime(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(11, 16);
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function safeDate(v: string | undefined): string {
  return v && DATE_RE.test(v) ? v : kstToday();
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 오늘 사이클에서 읽을 회의록 날짜: 화~금은 전 영업일, 월요일·주말은 금요일 */
export function meetingReadSourceDate(cycleDate: string): string {
  const dow = new Date(cycleDate + "T00:00:00Z").getUTCDay(); // 일=0, 월=1 … 토=6
  if (dow === 1) return shiftDate(cycleDate, -3); // 월 → 지난 금요일
  if (dow === 0) return shiftDate(cycleDate, -2); // 일 → 지난 금요일
  return shiftDate(cycleDate, -1);                // 화~토 → 전날 (토는 금요일)
}

/** 회의록 날짜가 어느 업무일의 '읽기' 단계에 반영되는지 */
export function meetingReadCycleDate(meetingDate: string): string {
  const dow = new Date(meetingDate + "T00:00:00Z").getUTCDay();
  if (dow === 5) return shiftDate(meetingDate, 3); // 금 → 월
  if (dow === 6) return shiftDate(meetingDate, 2); // 토 → 월
  return shiftDate(meetingDate, 1);                // 일~목 → 다음 날
}


/** 요청자의 사용 화면(회사용/개인용). 회의록·회의 메모의 범위(scope) 판별에 쓴다 — 0018 */
export async function noteScope(c: { env: Env; get: (k: "email") => string }): Promise<"company" | "personal"> {
  return (await personalSettings(c.env.DB, c.get("email"))).view_mode === "personal" ? "personal" : "company";
}

/** 칸반 완료 컬럼(0022 kanban_cards.done_at)이 있는지 — 운영 D1 에 0022 를 적용하기 전에 배포돼도 목록·주간보고가 500 나지 않게.
 * true 는 영구 캐시, false 는 60초만 (콘솔에서 0022 적용 직후 재배포 없이 살아나게, routes/schedule.ts hasLogParent 와 같은 방식) */
let HAS_KANBAN_DONE: boolean | null = null;
let HAS_KANBAN_DONE_AT = 0;
export async function hasKanbanDone(db: D1Database): Promise<boolean> {
  if (HAS_KANBAN_DONE === true) return true;
  if (HAS_KANBAN_DONE === false && Date.now() - HAS_KANBAN_DONE_AT < 60_000) return false;
  const row = await db.prepare("SELECT COUNT(*) n FROM pragma_table_info('kanban_cards') WHERE name='done_at'").first<{ n: number }>();
  HAS_KANBAN_DONE = (row?.n ?? 0) > 0;
  HAS_KANBAN_DONE_AT = Date.now();
  return HAS_KANBAN_DONE;
}
export const MIGRATION_0022_HINT = "완료 표시는 마이그레이션 0022(kanban_cards.done_at) 적용 뒤에 쓸 수 있습니다 — docs/DEPLOY.md";

// ════════════════════ M3-1: 회의록 생성 (AI 요약) ════════════════════
export const AI_DAILY_LIMIT = 20;
export const WORKERS_AI_MODEL = "@cf/google/gemma-4-26b-a4b-it" as const;
export type AiProvider = "workers-ai" | "gemini";

/**
 * Cloudflare-hosted AI를 먼저 사용해 Google의 외부 IP 지역 판정에 영향을 받지 않게 한다.
 * Workers AI가 일시적으로 실패한 경우에만 기존 Gemini 키를 보조 경로로 사용한다.
 */
export async function generateAiText(env: Env, prompt: string, maxTokens: number): Promise<{ text: string; provider: AiProvider }> {
  const errors: string[] = [];

  if (env.AI) {
    try {
      const result = await env.AI.run(WORKERS_AI_MODEL, {
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: maxTokens,
        temperature: 0.2,
        chat_template_kwargs: { enable_thinking: false },
      });
      const text = result.choices?.[0]?.message?.content ?? "";
      if (text.trim()) return { text, provider: "workers-ai" };
      errors.push("Workers AI가 빈 응답을 반환했습니다");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      errors.push(`Workers AI 실패: ${detail}`);
      console.error(JSON.stringify({ event: "workers_ai_failure", model: WORKERS_AI_MODEL, detail: detail.slice(0, 1000) }));
    }
  }

  if (env.GEMINI_API_KEY) {
    const model = env.GEMINI_MODEL || "gemini-3.6-flash";
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        }
      );
      if (!res.ok) {
        const full = await res.text();
        errors.push(`Gemini API 실패 (${res.status}) ${full.slice(0, 400)}`);
        console.error(JSON.stringify({ event: "gemini_failure", model, status: res.status, detail: full.slice(0, 1000) }));
      } else {
        const data = await res.json<{
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        }>();
        const text = data.candidates?.[0]?.content?.parts?.map(part => part.text ?? "").join("") ?? "";
        if (text.trim()) return { text, provider: "gemini" };
        errors.push("Gemini가 빈 응답을 반환했습니다");
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      errors.push(`Gemini 연결 실패: ${detail}`);
      console.error(JSON.stringify({ event: "gemini_failure", model, detail: detail.slice(0, 1000) }));
    }
  }

  throw new Error(errors.join(" / ") || "사용 가능한 AI 연결이 설정되지 않았습니다");
}

export function appOrigin(env: Env): string {
  return env.APP_URL || "http://localhost:8788";
}
