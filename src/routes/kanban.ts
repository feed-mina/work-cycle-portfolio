/* routes/kanban.ts — 칸반(우선순위 매트릭스) · GitHub 이슈 가져오기
 * index.ts 에서 2026-09-26 분리. 라우트 경로·동작은 그대로다. /api/* 인증 미들웨어(c.get("email"))는 index.ts 가 먼저 건다. */
import { Hono } from "hono";
import type { Env, Vars } from "../shared";
import { noteScope, hasKanbanDone, MIGRATION_0022_HINT } from "../shared";
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// ── 칸반 (우선순위 매트릭스) ──
// 회사/개인 범위(0020): 회사용 = scope='company' 팀 전체(분리 전과 같음), 개인용 = scope='personal' AND 본인 카드만
const QUADS = ["즉시처리", "전략적계획", "축소위임", "취소연기"];

app.get("/api/kanban", async (c) => {
  const scope = await noteScope(c);
  const rows = await (scope === "personal"
    ? c.env.DB.prepare(
        `SELECT k.*, u.name FROM kanban_cards k JOIN users u ON u.email=k.user_email
         WHERE k.scope='personal' AND k.user_email=?1 ORDER BY k.sort, k.id`).bind(c.get("email"))
    : c.env.DB.prepare(
        `SELECT k.*, u.name FROM kanban_cards k JOIN users u ON u.email=k.user_email
         WHERE k.scope='company' AND NOT EXISTS (SELECT 1 FROM team_membership_exits x WHERE x.user_email=k.user_email)
         ORDER BY k.sort, k.id`)
  ).all();
  return c.json({ rows: rows.results, quads: QUADS, scope });
});

app.post("/api/kanban", async (c) => {
  const b = await c.req.json<{ title: string; quadrant: string; due?: string; color?: string;
    gh_repo?: string; gh_issue_no?: number; gh_state?: string }>();
  if (!b.title?.trim() || !QUADS.includes(b.quadrant)) return c.json({ error: "title과 올바른 quadrant 필수" }, 400);
  const repo = b.gh_repo?.trim() || null;
  const no = Number(b.gh_issue_no) > 0 ? Number(b.gh_issue_no) : null;
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) return c.json({ error: "레포는 owner/repo 형식이어야 합니다" }, 400);
  if (!!repo !== !!no) return c.json({ error: "이슈를 연결하려면 레포와 번호가 모두 필요합니다" }, 400);
  await c.env.DB.prepare(
    "INSERT INTO kanban_cards (user_email, quadrant, title, due, color, gh_repo, gh_issue_no, gh_state, scope) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"
  ).bind(c.get("email"), b.quadrant, b.title.trim(), b.due ?? null, b.color ?? "#579BFC",
         repo, no, no ? (b.gh_state ?? "open") : null, await noteScope(c)).run();
  return c.json({ ok: true });
});

// 이동: { quadrant } — 기존 그대로. 완료/되돌리기: { done: true|false } (0022 done_at). 완료해도 quadrant 는 그대로 둬서 되돌리면 원래 칸으로 돌아간다.
app.patch("/api/kanban/:id", async (c) => {
  const b = await c.req.json<{ quadrant?: string; done?: unknown }>();
  if (b.done !== undefined) {
    if (typeof b.done !== "boolean") return c.json({ error: "done 은 true/false 여야 합니다" }, 400);
    if (!(await hasKanbanDone(c.env.DB))) return c.json({ error: MIGRATION_0022_HINT }, 400);
    const r = await c.env.DB.prepare(
      b.done ? "UPDATE kanban_cards SET done_at=datetime('now') WHERE id=?1 AND done_at IS NULL"
             : "UPDATE kanban_cards SET done_at=NULL WHERE id=?1"
    ).bind(c.req.param("id")).run();
    return c.json({ ok: true, changed: r.meta.changes });
  }
  if (!QUADS.includes(b.quadrant ?? "")) return c.json({ error: "올바른 quadrant 필수" }, 400);
  await c.env.DB.prepare("UPDATE kanban_cards SET quadrant=?1 WHERE id=?2").bind(b.quadrant, c.req.param("id")).run();
  return c.json({ ok: true });
});

// 열린 이슈 목록 — 기본 git 대상(또는 ?repo=) 기준. 이미 카드가 있는 이슈는 linked로 표시
/* ── 레포 목록 (드롭다운용) ──
 * GET /user/repos 를 Link 헤더 따라 최대 3페이지(300개) 받아 최근 갱신순으로 준다.
 * 사용자별 1시간 캐시(github_repo_cache, 0019). ?refresh=1 이면 캐시를 건너뛴다.
 * 필요한 토큰 권한: classic `repo`(비공개 포함) 또는 `public_repo`, fine-grained 는 Metadata: Read (docs/DEPLOY.md). */
const REPO_CACHE_SEC = 3600;
const REPO_MAX_PAGES = 3;
type RepoRow = { full_name: string; private: boolean; push: boolean; updated_at: string };

app.get("/api/github/repos", async (c) => {
  if (!c.env.GITHUB_TOKEN)
    return c.json({ error: "GITHUB_TOKEN이 없습니다. `npx wrangler secret put GITHUB_TOKEN` 후 다시 시도하세요." }, 400);
  const email = c.get("email");
  const refresh = c.req.query("refresh") === "1";
  const t = await c.env.DB.prepare("SELECT repo FROM git_targets WHERE is_default=1 LIMIT 1").first<{ repo: string }>();
  const default_repo = t?.repo ?? null;

  if (!refresh) {
    const cached = await c.env.DB.prepare(
      "SELECT body, fetched_at FROM github_repo_cache WHERE user_email=?1 AND fetched_at > datetime('now', ?2)"
    ).bind(email, `-${REPO_CACHE_SEC} seconds`).first<{ body: string; fetched_at: string }>();
    if (cached) {
      const repos = JSON.parse(cached.body) as RepoRow[];
      console.log("github_repos", { github_calls: 0, cached: true });
      return c.json({ repos, total: repos.length, cached: true, fetched_at: cached.fetched_at, default_repo, github_calls: 0 });
    }
  }

  const repos: RepoRow[] = [];
  let url: string | null = `${c.env.GITHUB_API_BASE || "https://api.github.com"}/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&sort=updated`;
  let calls = 0;
  while (url && calls < REPO_MAX_PAGES) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${c.env.GITHUB_TOKEN}`, "User-Agent": "work-cycle", Accept: "application/vnd.github+json" },
      });
    } catch (e) {   // 네트워크 단계 실패도 원문 그대로 (500 HTML 대신 JSON)
      return c.json({ error: `GitHub 레포 목록 조회 실패 (연결) ${String(e instanceof Error ? e.message : e).slice(0, 300)}` }, 502);
    }
    calls++;
    if (!res.ok) {
      const full = await res.text();                       // 판별은 전문으로 (AGENTS.md 2-4)
      return c.json({ error: `GitHub 레포 목록 조회 실패 (${res.status}) ${full.slice(0, 300)}` }, 502);
    }
    const page = await res.json<any[]>();
    for (const r of Array.isArray(page) ? page : [])
      repos.push({ full_name: String(r.full_name), private: !!r.private, push: !!r.permissions?.push, updated_at: String(r.updated_at ?? "") });
    const link = res.headers.get("Link") ?? "";
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  repos.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  await c.env.DB.prepare(
    "INSERT INTO github_repo_cache (user_email, body, fetched_at) VALUES (?1,?2,datetime('now')) ON CONFLICT(user_email) DO UPDATE SET body=excluded.body, fetched_at=excluded.fetched_at"
  ).bind(email, JSON.stringify(repos)).run();
  console.log("github_repos", { github_calls: calls, cached: false, total: repos.length });
  return c.json({ repos, total: repos.length, cached: false, fetched_at: null, default_repo, github_calls: calls });
});

app.get("/api/github/issues", async (c) => {
  if (!c.env.GITHUB_TOKEN)
    return c.json({ error: "GITHUB_TOKEN이 없습니다. `npx wrangler secret put GITHUB_TOKEN` 후 다시 시도하세요." }, 400);
  let repo = c.req.query("repo") ?? "";
  if (!repo) {
    const t = await c.env.DB.prepare("SELECT repo FROM git_targets WHERE is_default=1 LIMIT 1").first<{ repo: string }>();
    repo = t?.repo ?? "";
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
    return c.json({ error: "기본 git 대상을 먼저 저장하거나 owner/repo를 입력하세요" }, 400);
  const res = await fetch(`https://api.github.com/repos/${repo}/issues?state=open&per_page=30`, {
    headers: {
      Authorization: `Bearer ${c.env.GITHUB_TOKEN}`,
      "User-Agent": "work-cycle",
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) return c.json({ error: `GitHub 조회 실패 (${res.status}) — 토큰이 이 레포에 접근할 수 있는지 확인하세요` }, 502);
  const raw = await res.json<any[]>();
  const linked = await c.env.DB.prepare(
    "SELECT gh_issue_no FROM kanban_cards WHERE gh_repo=?1 AND gh_issue_no IS NOT NULL"
  ).bind(repo).all();
  const has = new Set((linked.results as any[]).map((r) => r.gh_issue_no));
  const issues = raw
    .filter((i) => !i.pull_request)               // PR 제외
    .map((i) => ({ number: i.number, title: i.title, url: i.html_url, linked: has.has(i.number) }));
  return c.json({ repo, issues });
});

app.delete("/api/kanban/:id", async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM kanban_cards WHERE id=?1 AND user_email=?2")
    .bind(c.req.param("id"), c.get("email")).run();
  return c.json({ ok: true, deleted: r.meta.changes });
});


export default app;
