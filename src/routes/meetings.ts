/* routes/meetings.ts — 회의록(④ 읽기) · 기본 git 대상 · AI 요약 · md 내려받기 · 회의 중 실시간 메모
 * index.ts 에서 2026-09-26 분리. 라우트 경로·동작은 그대로다. /api/* 인증 미들웨어(c.get("email"))는 index.ts 가 먼저 건다. */
import { Hono } from "hono";
import type { Env, Vars, AiProvider } from "../shared";
import { kstToday, DATE_RE, noteScope, generateAiText, AI_DAILY_LIMIT } from "../shared";
import { personalToday } from "../personal";
import { htmlToText } from "../vault-reader";
import { noteToMd, noteToHtml } from "../notedoc";
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// ── 회의록 (④ 읽기 루틴) ──
// 회사용: scope='company' 전체(팀 공용) + 팀 읽음 수. 개인용: scope='personal' AND 내 것만, 읽음은 read_by_me 만.
app.get("/api/meetings", async (c) => {
  const email = c.get("email");
  const scope = await noteScope(c);
  if (scope === "personal") {
    const rows = await c.env.DB.prepare(
      `SELECT m.*, 0 AS read_count,
         EXISTS(SELECT 1 FROM meeting_reads r WHERE r.meeting_id=m.id AND r.user_email=?1) read_by_me
       FROM meetings m WHERE m.scope='personal' AND m.created_by=?1
       ORDER BY m.date DESC, m.id DESC LIMIT 100`
    ).bind(email).all();
    return c.json({ rows: rows.results, team_size: 1, scope });
  }
  const rows = await c.env.DB.prepare(
    `SELECT m.*,
       (SELECT COUNT(*) FROM meeting_reads r
        WHERE r.meeting_id=m.id
          AND NOT EXISTS (SELECT 1 FROM team_membership_exits x WHERE x.user_email=r.user_email)) read_count,
       EXISTS(SELECT 1 FROM meeting_reads r WHERE r.meeting_id=m.id AND r.user_email=?1) read_by_me
     FROM meetings m WHERE m.scope='company' ORDER BY m.date DESC, m.id DESC LIMIT 100`
  ).bind(email).all();
  const users = await c.env.DB.prepare(
    `SELECT COUNT(*) n FROM users u
     WHERE NOT EXISTS (SELECT 1 FROM team_membership_exits x WHERE x.user_email=u.email)`
  ).first<{ n: number }>();
  return c.json({ rows: rows.results, team_size: users?.n ?? 1, scope });
});

app.post("/api/meetings", async (c) => {
  const b = await c.req.json<{ date: string; title: string; link?: string }>();
  if (!b.title?.trim() || !DATE_RE.test(b.date ?? "")) return c.json({ error: "date와 title은 필수" }, 400);
  await c.env.DB.prepare(
    "INSERT INTO meetings (date, title, body_mode, link, created_by, scope) VALUES (?1,?2,'link_only',?3,?4,?5)"
  ).bind(b.date, b.title.trim(), b.link?.trim() || null, c.get("email"), await noteScope(c)).run();
  return c.json({ ok: true });
});

app.post("/api/meetings/:id/read", async (c) => {
  const email = c.get("email");
  const m = await c.env.DB.prepare("SELECT id, scope, created_by FROM meetings WHERE id=?1").bind(c.req.param("id")).first<any>();
  if (!m) return c.json({ error: "회의록 없음" }, 404);
  if (m.scope === "personal" && m.created_by !== email) return c.json({ error: "내 노트가 아닙니다" }, 404);
  await c.env.DB.prepare(
    "INSERT INTO meeting_reads (meeting_id, user_email) VALUES (?1,?2) ON CONFLICT DO NOTHING"
  ).bind(m.id, email).run();
  // 개인 노트를 읽음 처리하면 개인 사이클 "회의록 읽기"(personal_step_marks.read)도 함께 완료된다
  if (m.scope === "personal") {
    await c.env.DB.prepare(
      "INSERT INTO personal_step_marks (user_email, cycle_date, step) VALUES (?1,?2,'read') ON CONFLICT DO NOTHING"
    ).bind(email, personalToday()).run();
  }
  return c.json({ ok: true, personal_read: m.scope === "personal" }); // ④ 단계는 이 기록으로 완료 (보드가 자동 반영)
});

// 회의록 → GitHub 이슈 생성 (기본 git 대상 사용, GITHUB_TOKEN 시크릿 필요)
app.post("/api/meetings/:id/issue", async (c) => {
  if (!c.env.GITHUB_TOKEN) return c.json({ error: "GITHUB_TOKEN이 설정되지 않았습니다. `npx wrangler secret put GITHUB_TOKEN` 후 다시 시도하세요." }, 400);
  const m = await c.env.DB.prepare("SELECT * FROM meetings WHERE id=?1").bind(c.req.param("id")).first<any>();
  if (!m) return c.json({ error: "회의록 없음" }, 404);
  if (m.scope === "personal" && (m.created_by !== c.get("email") || await noteScope(c) !== "personal")) return c.json({ error: "회의록 없음" }, 404);
  if (m.gh_issue_url) return c.json({ ok: true, url: m.gh_issue_url, existed: true });
  const t = await c.env.DB.prepare("SELECT repo FROM git_targets WHERE is_default=1 LIMIT 1").first<{ repo: string }>();
  if (!t?.repo) return c.json({ error: "기본 git 대상을 먼저 저장하세요" }, 400);
  const res = await fetch(`https://api.github.com/repos/${t.repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "work-cycle",
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({
      title: `[회의] ${m.date} ${m.title}`,
      body: (m.body_md ? m.body_md.slice(0, 6000) + "\n\n" : `회의록: ${m.link ?? "(링크 없음)"}\n\n`) + "_work-cycle에서 생성됨_",
    }),
  });
  if (!res.ok) return c.json({ error: `GitHub API 실패 (${res.status})` }, 502);
  const issue = await res.json<any>();
  await c.env.DB.prepare("UPDATE meetings SET gh_issue_url=?1 WHERE id=?2").bind(issue.html_url, m.id).run();
  return c.json({ ok: true, url: issue.html_url });
});

// ── 기본 git 대상 ──
app.get("/api/git_targets", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM git_targets ORDER BY is_default DESC, id").all();
  return c.json({ rows: rows.results });
});

app.post("/api/git_targets", async (c) => {
  const b = await c.req.json<{ repo: string; project_no?: number }>();
  if (!/^[\w.-]+\/[\w.-]+$/.test(b.repo ?? "")) return c.json({ error: "repo는 owner/repo 형식" }, 400);
  await c.env.DB.prepare("UPDATE git_targets SET is_default=0").run();
  await c.env.DB.prepare(
    "INSERT INTO git_targets (repo, project_no, is_default) VALUES (?1,?2,1)"
  ).bind(b.repo, b.project_no ?? null).run();
  return c.json({ ok: true });
});


app.get("/api/ai/usage", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT calls FROM ai_usage WHERE user_email=?1 AND date=?2"
  ).bind(c.get("email"), kstToday()).first<{ calls: number }>();
  return c.json({ calls: row?.calls ?? 0, limit: AI_DAILY_LIMIT, ready: !!c.env.AI || !!c.env.GEMINI_API_KEY });
});

app.post("/api/meetings/summarize", async (c) => {
  const b = await c.req.json<{ date: string; title?: string; time?: string; attendees?: string; topic?: string; transcript: string; schedule_id?: number }>();
  if (!b.transcript?.trim()) return c.json({ error: "회의 텍스트가 비어 있습니다" }, 400);
  if (!DATE_RE.test(b.date ?? "")) return c.json({ error: "회의 날짜는 필수입니다" }, 400);
  if (!c.env.AI && !c.env.GEMINI_API_KEY)
    return c.json({ error: "사용 가능한 AI 연결이 설정되지 않았습니다" }, 400);

  const email = c.get("email"), today = kstToday();
  const usage = await c.env.DB.prepare("SELECT calls FROM ai_usage WHERE user_email=?1 AND date=?2")
    .bind(email, today).first<{ calls: number }>();
  if ((usage?.calls ?? 0) >= AI_DAILY_LIMIT)
    return c.json({ error: `오늘 AI 호출 한도(${AI_DAILY_LIMIT}회)를 초과했습니다` }, 429);

  const title = b.title?.trim() || b.topic?.trim() || "회의";
  const prompt = [
    "너는 회사 회의록 작성 도우미다. 아래 회의 텍스트를 한국어 회의록 마크다운으로 정리하라.",
    "형식(반드시 이 섹션 구조):",
    `# ${b.date} ${title}`,
    "## 참석자\n- (참석자 목록. 모르면 텍스트에서 추정, 없으면 '미기재')",
    "## 안건\n- (핵심 안건 불릿)",
    "## 요약\n(3~6문장. 결정된 것과 근거 중심. 추측 금지 — 텍스트에 없는 내용은 쓰지 말 것)",
    "## 할 일 (Action Items)",
    "- [ ] 할 일 — @담당자 ~기한 [priority:High|Medium|Low] 형식. 담당/기한이 없으면 생략",
    "## 참고 / 링크\n- (있으면)",
    b.time ? `회의 시간: ${b.time}` : "",
    b.attendees ? `참석자 힌트: ${b.attendees}` : "",
    b.topic ? `회의 주제: ${b.topic}` : "",
    "---- 회의 텍스트 ----",
    b.transcript.slice(0, 60000),
  ].filter(Boolean).join("\n");

  let md: string;
  let provider: AiProvider | "mock" = "mock";
  if (c.env.GEMINI_API_KEY === "dev-mock") {
    md = `# ${b.date} ${title}\n## 참석자\n- 미기재\n## 안건\n- (모의 응답)\n## 요약\n로컬 개발용 모의 회의록입니다.\n## 할 일 (Action Items)\n- [ ] 모의 액션 아이템 — @민예린 ~${b.date} [priority:High]\n## 참고 / 링크\n- 없음`;
  } else {
    try {
      const generated = await generateAiText(c.env, prompt, 2400);
      md = generated.text;
      provider = generated.provider;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return c.json({ error: `AI 요약 실패: ${detail.slice(0, 400)}` }, 502);
    }
  }

  const schedId = Number(b.schedule_id) > 0 ? Number(b.schedule_id) : null;
  const r = await c.env.DB.prepare(
    "INSERT INTO meetings (date, title, body_mode, body_md, created_by, schedule_id, scope) VALUES (?1,?2,'full_md',?3,?4,?5,?6)"
  ).bind(b.date, title, md, email, schedId, await noteScope(c)).run();
  await c.env.DB.prepare(
    `INSERT INTO ai_usage (user_email, date, calls) VALUES (?1,?2,1)
     ON CONFLICT(user_email, date) DO UPDATE SET calls = calls + 1`
  ).bind(email, today).run();
  const newUsage = (usage?.calls ?? 0) + 1;
  return c.json({ ok: true, id: r.meta.last_row_id, md, provider, calls: newUsage, limit: AI_DAILY_LIMIT });
});

app.get("/api/meetings/:id/md", async (c) => {
  const m = await c.env.DB.prepare("SELECT date, title, body_md, body_mode, scope, created_by FROM meetings WHERE id=?1")
    .bind(c.req.param("id")).first<any>();
  if (!m?.body_md) return c.json({ error: "생성된 회의록 md가 없습니다" }, 404);
  if (m.scope === "personal" && m.created_by !== c.get("email")) return c.json({ error: "내 노트가 아닙니다" }, 404);
  // html 노트는 태그를 벗긴 텍스트로 내려준다
  const md = m.body_mode === "full_html" ? htmlToText(m.body_md) : m.body_md;
  return c.json({ date: m.date, title: m.title, md });
});

// 할 일(Action Items) → 칸반 카드 변환
app.post("/api/meetings/:id/kanban", async (c) => {
  const m = await c.env.DB.prepare("SELECT body_md, scope, created_by FROM meetings WHERE id=?1").bind(c.req.param("id")).first<any>();
  if (!m?.body_md) return c.json({ error: "생성된 회의록 md가 없습니다" }, 404);
  if (m.scope === "personal" && (m.created_by !== c.get("email") || await noteScope(c) !== "personal")) return c.json({ error: "회의록 없음" }, 404);
  const items = (m.body_md.match(/^- \[ \] .+$/gm) ?? []).map((l: string) => l.replace(/^- \[ \] /, "").trim()).slice(0, 20);
  if (!items.length) return c.json({ error: "할 일 항목이 없습니다" }, 400);
  const scope = await noteScope(c);   // 카드는 회의록을 변환하는 사람의 사용 화면 범위를 따른다(0020)
  for (const t of items) {
    const high = /priority:High/i.test(t);
    await c.env.DB.prepare(
      "INSERT INTO kanban_cards (user_email, quadrant, title, color, scope) VALUES (?1,?2,?3,?4,?5)"
    ).bind(c.get("email"), high ? "즉시처리" : "전략적계획", t.slice(0, 200), high ? "#E2445C" : "#579BFC", scope).run();
  }
  return c.json({ ok: true, created: items.length });
});



// ════════════════════ 회의 중 실시간 메모 (트리형 + 액션아이템) ════════════════════
/** outline 노드: { d:들여쓰기 0~5, m:마크(''|'star'|'decide'|'todo'|'need'), t:본문, who, due } */
type NoteNode = { d: number; m: string; t: string; who?: string; due?: string };
const MARKS = ["", "star", "decide", "todo", "need"];

function cleanOutline(v: unknown): NoteNode[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 500).map((n: any) => ({
    d: Math.max(0, Math.min(5, Number(n?.d) || 0)),
    m: MARKS.includes(n?.m) ? n.m : "",
    t: String(n?.t ?? "").slice(0, 1000),
    who: String(n?.who ?? "").slice(0, 60),
    due: DATE_RE.test(String(n?.due ?? "")) ? String(n.due) : "",
  }));
}

app.get("/api/notes", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, date, title, purpose, attendees, meeting_id, updated_at,
            (SELECT COUNT(*) FROM json_each(outline) WHERE json_extract(value,'$.m')='todo') AS todos
       FROM meeting_notes WHERE user_email=?1 AND scope=?2 ORDER BY date DESC, id DESC LIMIT 50`
  ).bind(c.get("email"), await noteScope(c)).all();
  return c.json({ rows: rows.results });
});

app.get("/api/notes/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM meeting_notes WHERE id=?1 AND user_email=?2")
    .bind(c.req.param("id"), c.get("email")).first<any>();
  if (!row) return c.json({ error: "메모를 찾을 수 없습니다" }, 404);
  let outline: NoteNode[] = [];
  try { outline = cleanOutline(JSON.parse(row.outline || "[]")); } catch {}
  return c.json({ ...row, outline });
});

app.post("/api/notes", async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));
  const date = DATE_RE.test(b?.date ?? "") ? b.date : kstToday();
  const r = await c.env.DB.prepare(
    `INSERT INTO meeting_notes (user_email, date, title, purpose, attendees, outline, schedule_id, scope)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`
  ).bind(
    c.get("email"), date,
    String(b?.title ?? "").slice(0, 200),
    String(b?.purpose ?? "").slice(0, 500),
    String(b?.attendees ?? "").slice(0, 300),
    JSON.stringify(cleanOutline(b?.outline)),
    Number(b?.schedule_id) || null,
    await noteScope(c)
  ).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});

app.put("/api/notes/:id", async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));
  const own = await c.env.DB.prepare("SELECT * FROM meeting_notes WHERE id=?1 AND user_email=?2")
    .bind(c.req.param("id"), c.get("email")).first<any>();
  if (!own) return c.json({ error: "내가 만든 메모만 고칠 수 있습니다" }, 404);
  await c.env.DB.prepare(
    `UPDATE meeting_notes SET title=?1, purpose=?2, attendees=?3, outline=?4, date=?5,
       updated_at=datetime('now') WHERE id=?6 AND user_email=?7`
  ).bind(
    b?.title !== undefined ? String(b.title).slice(0, 200) : own.title,
    b?.purpose !== undefined ? String(b.purpose).slice(0, 500) : own.purpose,
    b?.attendees !== undefined ? String(b.attendees).slice(0, 300) : own.attendees,
    b?.outline !== undefined ? JSON.stringify(cleanOutline(b.outline)) : own.outline,
    DATE_RE.test(b?.date ?? "") ? b.date : own.date,
    c.req.param("id"), c.get("email")
  ).run();
  return c.json({ ok: true });
});

app.delete("/api/notes/:id", async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM meeting_notes WHERE id=?1 AND user_email=?2")
    .bind(c.req.param("id"), c.get("email")).run();
  return c.json({ ok: true, deleted: r.meta.changes });
});

/** 할 일(누가·무엇을·언제까지) → 칸반 카드 */
app.post("/api/notes/:id/kanban", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM meeting_notes WHERE id=?1 AND user_email=?2")
    .bind(c.req.param("id"), c.get("email")).first<any>();
  if (!row) return c.json({ error: "메모를 찾을 수 없습니다" }, 404);
  let nodes: NoteNode[] = [];
  try { nodes = cleanOutline(JSON.parse(row.outline || "[]")); } catch {}
  const todos = nodes.filter((n) => n.m === "todo" && n.t.trim()).slice(0, 30);
  if (!todos.length) return c.json({ error: "할 일로 표시한 줄이 없습니다" }, 400);
  const scope = row.scope === "personal" ? "personal" : "company";   // 메모의 범위를 그대로 따른다(0020)
  for (const t of todos) {
    const title = (t.who ? `[${t.who}] ` : "") + t.t.trim();
    await c.env.DB.prepare(
      "INSERT INTO kanban_cards (user_email, quadrant, title, due, color, scope) VALUES (?1,?2,?3,?4,?5,?6)"
    ).bind(c.get("email"), t.due ? "즉시처리" : "전략적계획",
           title.slice(0, 200), t.due || null, t.due ? "#E2445C" : "#579BFC", scope).run();
  }
  return c.json({ ok: true, created: todos.length });
});

/** 산출물 내보내기 — md / html (html은 브라우저 인쇄로 PDF) */
app.get("/api/notes/:id/export", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM meeting_notes WHERE id=?1 AND user_email=?2")
    .bind(c.req.param("id"), c.get("email")).first<any>();
  if (!row) return c.json({ error: "메모를 찾을 수 없습니다" }, 404);
  let nodes: NoteNode[] = [];
  try { nodes = cleanOutline(JSON.parse(row.outline || "[]")); } catch {}

  const fmt = c.req.query("fmt") === "md" ? "md" : "html";
  const base = `${row.date}_${(row.title || "회의메모").replace(/[\/\\?%*:|"<>]/g, "-")}`.slice(0, 80);
  const inline = c.req.query("inline") === "1";

  if (fmt === "md") {
    return new Response(noteToMd(row, nodes), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="note.md"; filename*=UTF-8''` +
          encodeURIComponent(base + ".md"),
        "Cache-Control": "no-store",
      },
    });
  }
  return new Response(noteToHtml(row, nodes), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...(inline ? {} : {
        "Content-Disposition": `attachment; filename="note.html"; filename*=UTF-8''` +
          encodeURIComponent(base + ".html"),
      }),
      "Cache-Control": "no-store",
    },
  });
});

/** 메모 → 회의록(meetings)으로 확정 저장 */
app.post("/api/notes/:id/publish", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM meeting_notes WHERE id=?1 AND user_email=?2")
    .bind(c.req.param("id"), c.get("email")).first<any>();
  if (!row) return c.json({ error: "메모를 찾을 수 없습니다" }, 404);
  let nodes: NoteNode[] = [];
  try { nodes = cleanOutline(JSON.parse(row.outline || "[]")); } catch {}
  const md = noteToMd(row, nodes);
  const title = (row.title || "회의 메모").slice(0, 200);
  if (row.meeting_id) {
    await c.env.DB.prepare("UPDATE meetings SET title=?1, body_md=?2, date=?3 WHERE id=?4")
      .bind(title, md, row.date, row.meeting_id).run();
    return c.json({ ok: true, meeting_id: row.meeting_id, updated: true });
  }
  // 확정 저장은 메모의 범위를 그대로 따른다 (개인 메모 → 개인 회의록, 내 것으로)
  const r = await c.env.DB.prepare(
    "INSERT INTO meetings (date, title, body_mode, body_md, schedule_id, created_by, scope) VALUES (?1,?2,'full',?3,?4,?5,?6)"
  ).bind(row.date, title, md, row.schedule_id ?? null, c.get("email"), row.scope === "personal" ? "personal" : "company").run();
  await c.env.DB.prepare("UPDATE meeting_notes SET meeting_id=?1 WHERE id=?2")
    .bind(r.meta.last_row_id, row.id).run();
  return c.json({ ok: true, meeting_id: r.meta.last_row_id, updated: false });
});


export default app;
