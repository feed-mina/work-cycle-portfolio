/* vault.ts — 옵시디언 볼트(GitHub 미러 feed-mina/ME)에서 회의록·노트 읽기
 *
 * index.ts 가 커져서 볼트 관련 라우트를 이 파일로 분리했다. index.ts 는 app.route("/api/vault", vaultApi) 만 한다.
 *
 * 회사용 : 그날 폴더 하나만 읽는다 — {VAULT_DIR}/N월/N월DD일 (.md 만). 결과는 분리 전과 같다.
 * 개인용 : 저장소 전체 트리를 1회 받아 캐시(vault_index_cache)에 두고, 개인 폴더(VAULT_PERSONAL_DIRS)만
 *          폴더·날짜·검색으로 고른다. 기본은 최근 14일.
 * 볼트는 읽기만 한다 — 이 경로로 볼트에 쓰지 않는다(하루 기록을 history/ 에 올리는 쓰기는 vault-history.ts 한 곳뿐). 토큰·저장소 주소는 브라우저에 주지 않는다.
 */
import { Hono } from "hono";
import { personalSettings } from "./personal";
import { vaultMarkdownToHtml, sanitizeHtml } from "./vault-reader";

export type VaultEnv = {
  DB: D1Database;
  GITHUB_TOKEN?: string;
  GITHUB_TOKEN_VAULT?: string;   // 볼트 전용 토큰 (없으면 GITHUB_TOKEN 대체)
  VAULT_REPO?: string;           // 기본 feed-mina/ME
  VAULT_DIR?: string;            // 팀용 일일 노트 루트 (기본 daily)
  VAULT_PERSONAL_DIRS?: string;  // 개인용 폴더 목록 (쉼표 구분, 하위 폴더 포함)
  GITHUB_API_BASE?: string;      // 로컬 검증용 GitHub API 주소 (기본 https://api.github.com)
};
type Vars = { email: string };

const VAULT_REPO_DEFAULT = "feed-mina/ME";
const VAULT_DIR_DEFAULT = "daily";
/** 개인용에서 보는 폴더 (2026-09-26 사용자 지정) — 각 폴더의 하위 폴더까지 포함 */
const VAULT_PERSONAL_DIRS_DEFAULT = ["04-Thinking", "06-Knowledge", "07-Projects", "10-Meta", "생활정착/회의기록", "01-History", "history", "docs"];
const INDEX_DEFAULT_DAYS = 14;
const INDEX_MAX_ROWS = 500;
/** 캐시 본문은 정규화 결과다 — 날짜 규칙 등 정규화 로직을 바꾸면 이 번호를 올려 캐시를 새로 만든다 */
const INDEX_VERSION = "v2";

type VaultSource =
  | { mode: "company"; dir: string; kinds: string[] }
  | { mode: "personal"; dirs: string[]; kinds: string[] };

export type VaultIndexRow = {
  path: string; name: string; folder: string; date: string | null;
  kind: "md" | "html"; size: number; sha: string;
};

export type VaultCollection = {
  root: string;
  name: string;
  date: string | null;
  count: number;
  total_size: number;
  representative: VaultIndexRow;
  files: VaultIndexRow[];
};

const app = new Hono<{ Bindings: VaultEnv; Variables: Vars }>();

function kstToday(): string {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
}
function safeDate(v: string | undefined): string {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : kstToday();
}
function shiftDate(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 볼트 전용 토큰을 우선하고, 기존 배포와의 호환을 위해 공용 토큰을 대체 사용한다. */
function vaultGithubToken(env: VaultEnv): string {
  return env.GITHUB_TOKEN_VAULT || env.GITHUB_TOKEN || "";
}
function vaultRepo(env: VaultEnv): string {
  return env.VAULT_REPO || VAULT_REPO_DEFAULT;
}
function personalDirs(env: VaultEnv): string[] {
  const raw = (env.VAULT_PERSONAL_DIRS || "").normalize("NFC").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  const dirs = raw.length ? raw : VAULT_PERSONAL_DIRS_DEFAULT;
  // 운영에 예전 VAULT_PERSONAL_DIRS 값이 남아 있어도 v49의 docs 묶음 기능은 항상 보이게 한다.
  return dirs.includes("docs") ? dirs : [...dirs, "docs"];
}
/** 요청자의 사용 화면(회사용/개인용)에 따라 읽을 범위를 고른다 — 회사용은 분리 전 규칙 그대로 */
async function vaultSource(env: VaultEnv, email: string): Promise<VaultSource> {
  const s = await personalSettings(env.DB, email);
  return s.view_mode === "personal"
    ? { mode: "personal", dirs: personalDirs(env), kinds: ["md", "html"] }
    : { mode: "company", dir: env.VAULT_DIR || VAULT_DIR_DEFAULT, kinds: ["md"] };
}

/** 볼트 폴더 규칙: {VAULT_DIR}/8월/8월03일 — 월은 0 없이, 일은 0을 채워서 */
function vaultDayPath(dir: string, date: string): string {
  const [, m, d] = date.split("-");
  return `${dir}/${Number(m)}월/${Number(m)}월${d}일`;
}

/** GitHub REST 호출 (repos/{repo}/ 아래 경로). 토큰은 여기서만 쓴다. */
function ghApi(env: VaultEnv, apiPath: string): Promise<Response> {
  return fetch(`${env.GITHUB_API_BASE || "https://api.github.com"}/repos/${vaultRepo(env)}/${apiPath}`, {
    headers: {
      Authorization: `Bearer ${vaultGithubToken(env)}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "work-cycle",
    },
  });
}
function ghVaultFetch(env: VaultEnv, path: string): Promise<Response> {
  return ghApi(env, `contents/${encodeURI(path)}`);
}

function fileKind(path: string): "md" | "html" | null {
  if (/\.md$/i.test(path)) return "md";
  if (/\.html?$/i.test(path)) return "html";
  return null;
}
/** 범위 밖 경로·허용되지 않은 확장자·상위 이동을 막는다 */
function vaultPathOk(source: VaultSource, path: string): boolean {
  if (!path || path.length > 512 || path.includes("..") || path.startsWith("/")) return false;
  const kind = fileKind(path);
  if (!kind || !source.kinds.includes(kind)) return false;
  return source.mode === "company"
    ? path.startsWith(source.dir + "/")
    : source.dirs.some((d) => path.startsWith(d + "/"));
}

/** 파일명에서 제목 뽑기 — "2026-08-13 회의·통화 결정 정리.md" → "회의·통화 결정 정리" */
function vaultTitle(name: string): string {
  return name.replace(/\.(md|html?)$/i, "").replace(/^\d{4}-\d{2}-\d{2}[\s_-]*/, "").trim() || name;
}

const NO_TOKEN = "GITHUB_TOKEN_VAULT 또는 GITHUB_TOKEN이 설정되지 않았습니다. Cloudflare 대시보드에서 등록하세요 (docs/DEPLOY.md).";

async function decodeContent(res: Response): Promise<{ name: string; md: string }> {
  const file = await res.json<any>();
  // GitHub contents API는 base64 — 한글이 깨지지 않게 바이트로 풀어 디코드한다
  const bin = atob(String(file.content ?? "").replace(/\n/g, ""));
  return { name: String(file.name ?? ""), md: new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))) };
}

/* ── 회사용: 그날 폴더 목록 ─────────────────────────────────────────────── */
app.get("/notes", async (c) => {
  if (!vaultGithubToken(c.env)) return c.json({ error: NO_TOKEN }, 400);
  const source = await vaultSource(c.env, c.get("email"));
  const date = safeDate(c.req.query("date"));
  if (source.mode === "personal") {
    // 개인용은 날짜 폴더 규칙이 없다 — 전체 인덱스 API 로 안내
    return c.json({ date, path: "", rows: [], note: "개인용은 폴더·날짜·검색으로 고릅니다 (/api/vault/index)", personal: true });
  }
  const path = vaultDayPath(source.dir, date);

  const res = await ghVaultFetch(c.env, path);
  if (res.status === 404)
    return c.json({ date, path, rows: [], note: `볼트에 ${path} 폴더가 없습니다 (아직 커밋되지 않았을 수 있습니다)` });
  if (!res.ok) {
    const full = await res.text();                       // 판별은 전문으로
    return c.json({ error: `볼트 조회 실패 (${res.status}) ${full.slice(0, 300)}` }, 502);
  }
  const items = await res.json<any[]>();
  const files = (Array.isArray(items) ? items : []).filter((f) => f.type === "file" && /\.md$/i.test(f.name));

  // 이미 가져온 것은 link(볼트 경로)로 가려낸다
  const got = await c.env.DB.prepare("SELECT link FROM meetings WHERE date=?1 AND link IS NOT NULL").bind(date).all();
  const gotSet = new Set((got.results as any[]).map((r) => String(r.link)));

  return c.json({
    date, path,
    rows: files.map((f) => ({
      name: f.name, path: f.path, size: f.size,
      title: vaultTitle(f.name),
      imported: gotSet.has(f.path),
    })),
  });
});

/* ── 개인용: 저장소 전체 인덱스 (tree API 1회 + sha 캐시) ───────────────────
 * 호출당 GitHub 요청: commits/main 1회 + (sha 가 바뀐 경우에만) git/trees 1회.
 * 응답에는 sha 앞 7자·GitHub 호출 횟수·캐시 사용 여부를 넣어 검증할 수 있게 한다. */
const KO_DAY_DIR = /\/(\d{1,2})월\/\1월(\d{2})일\//;
const ISO_DATE = /(20\d\d)-(\d\d)-(\d\d)/g;
const COMPACT_DATE = /(?:^|[^\d])(20\d\d)(\d\d)(\d\d)(?:[^\d]|$)/;
const validYmd = (y: string, m: string, d: string) => Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31;

/** 경로에서 날짜 뽑기 — 파일명 YYYY-MM-DD → 폴더 YYYY-MM-DD → 파일명 YYYYMMDD → 폴더 N월/N월DD일 → 없으면 null */
function dateFromPath(path: string, name: string, year: string): string | null {
  const pick = (s: string): string | null => {
    const all = [...s.matchAll(ISO_DATE)].filter((m) => validYmd(m[1], m[2], m[3]));
    return all.length ? all[all.length - 1][0] : null;   // 여러 개면 가장 안쪽(마지막) 것
  };
  const byName = pick(name);
  if (byName) return byName;
  const byDir = pick(path.slice(0, path.length - name.length));
  if (byDir) return byDir;
  const compact = name.match(COMPACT_DATE);
  if (compact && validYmd(compact[1], compact[2], compact[3])) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const ko = path.match(KO_DAY_DIR);
  if (ko) {
    const y = (path.match(/(?:^|\/)(20\d\d)(?:[-_/]|년)/) || [])[1] || year;
    return `${y}-${ko[1].padStart(2, "0")}-${ko[2]}`;
  }
  return null;
}

function normalizeTree(tree: any[], year: string): VaultIndexRow[] {
  const rows: VaultIndexRow[] = [];
  for (const t of tree) {
    if (t.type !== "blob") continue;
    // macOS 에서 만든 한글 경로는 자소 분리(NFD)로 올 수 있다 — 폴더 이름·검색어와 맞추려고 NFC 로 통일
    const path = String(t.path).normalize("NFC");
    const kind = fileKind(path);
    if (!kind) continue;
    const name = path.slice(path.lastIndexOf("/") + 1);
    const date = dateFromPath(path, name, year);
    rows.push({ path, name, folder: path.includes("/") ? path.slice(0, path.indexOf("/")) : "", date, kind, size: Number(t.size ?? 0), sha: String(t.sha ?? "").slice(0, 7) });
  }
  return rows;
}

/** 문서 묶음으로 취급할 경로를 정한다.
 * docs:
 * - docs/YYYY-MM-DD/<묶음>/...  → docs/YYYY-MM-DD/<묶음>
 * - docs/<묶음>/...             → docs/<묶음>
 * - docs/YYYY-MM-DD/<파일>      → docs/YYYY-MM-DD
 * - docs/<파일>                 → docs
 * 01-History:
 * - 01-History/<묶음>/...       → 01-History/<묶음>
 * - 01-History 루트의 md/html은 기존처럼 개별 노트로 둔다.
 * assets/ · archive/ 같은 더 깊은 하위 폴더도 같은 묶음에 포함한다.
 */
function collectionMeta(row: VaultIndexRow): { root: string; name: string; date: string | null } | null {
  const parts = row.path.split("/");

  if (row.path.startsWith("docs/")) {
    if (parts.length === 2) return { root: "docs", name: "docs", date: row.date };
    const datePart = /^20\d\d-\d\d-\d\d$/.test(parts[1]) ? parts[1] : null;
    if (datePart) {
      if (parts.length >= 4) return { root: `docs/${datePart}/${parts[2]}`, name: parts[2], date: datePart };
      return { root: `docs/${datePart}`, name: datePart, date: datePart };
    }
    return { root: `docs/${parts[1]}`, name: parts[1], date: row.date };
  }

  if (row.path.startsWith("01-History/")) {
    // 루트 파일(01-History/foo.md)은 기존 flat 노트로 유지한다.
    if (parts.length < 3) return null;
    return {
      root: `01-History/${parts[1]}`,
      name: parts[1],
      date: row.date,
    };
  }

  return null;
}

function representativeScore(row: VaultIndexRow, root: string): number {
  const n = row.name.toLowerCase();
  const relative = row.path.startsWith(root + "/") ? row.path.slice(root.length + 1) : row.name;
  const direct = !relative.includes("/");
  if (direct && n === "readme.md") return 0;
  if (direct && (n === "readme.html" || n === "readme.htm")) return 1;
  if (direct && n === "index.md") return 2;
  if (direct && (n === "index.html" || n === "index.htm")) return 3;
  if (direct) return row.kind === "md" ? 4 : 5;
  // assets/README.md 같은 하위 보조문서는 묶음 루트의 일반 문서보다 대표 우선순위를 낮춘다.
  return row.kind === "md" ? 6 : 7;
}

/** README 우선, 없으면 index, 그다음 첫 md/html을 대표 문서로 고른다. */
export function buildVaultCollections(rows: VaultIndexRow[]): VaultCollection[] {
  const groups = new Map<string, { name: string; date: string | null; files: VaultIndexRow[] }>();
  for (const row of rows) {
    const meta = collectionMeta(row);
    if (!meta) continue;
    const current = groups.get(meta.root) ?? { name: meta.name, date: meta.date, files: [] };
    current.files.push(row);
    if (!current.date && meta.date) current.date = meta.date;
    groups.set(meta.root, current);
  }

  return [...groups.entries()].flatMap(([root, group]): VaultCollection[] => {
    const files = [...group.files].sort((a, b) => {
      const score = representativeScore(a, root) - representativeScore(b, root);
      if (score) return score;
      const depth = a.path.split("/").length - b.path.split("/").length;
      return depth || a.path.localeCompare(b.path, "ko");
    });
    const representative = files[0];
    if (!representative) return [];
    return [{
      root,
      name: group.name,
      date: group.date ?? representative.date ?? null,
      count: files.length,
      total_size: files.reduce((sum, row) => sum + row.size, 0),
      representative,
      files,
    }];
  });
}

async function loadIndex(env: VaultEnv): Promise<{ rows: VaultIndexRow[]; sha: string; calls: number; cached: boolean }> {
  const repo = vaultRepo(env);
  const head = await ghApi(env, "commits/main");
  if (!head.ok) throw new Error(`볼트 최신 커밋 조회 실패 (${head.status}) ${(await head.text()).slice(0, 300)}`);
  const sha = String((await head.json<any>()).sha ?? "");
  if (!sha) throw new Error("볼트 최신 커밋 sha 가 비어 있습니다");

  const cacheKey = `${sha}#${INDEX_VERSION}`;
  const cached = await env.DB.prepare("SELECT tree_sha, body FROM vault_index_cache WHERE repo=?1").bind(repo).first<{ tree_sha: string; body: string }>();
  if (cached && cached.tree_sha === cacheKey) return { rows: JSON.parse(cached.body), sha, calls: 1, cached: true };

  const treeRes = await ghApi(env, `git/trees/${sha}?recursive=1`);
  if (!treeRes.ok) throw new Error(`볼트 트리 조회 실패 (${treeRes.status}) ${(await treeRes.text()).slice(0, 300)}`);
  const tree = await treeRes.json<any>();
  if (tree.truncated) throw new Error(`볼트 트리가 잘렸습니다 (truncated=true, ${Array.isArray(tree.tree) ? tree.tree.length : 0}항목) — 폴더별로 나눠 받도록 바꿔야 합니다`);
  const rows = normalizeTree(Array.isArray(tree.tree) ? tree.tree : [], kstToday().slice(0, 4));
  await env.DB.prepare(
    "INSERT INTO vault_index_cache (repo, tree_sha, body, fetched_at) VALUES (?1,?2,?3,datetime('now')) ON CONFLICT(repo) DO UPDATE SET tree_sha=excluded.tree_sha, body=excluded.body, fetched_at=excluded.fetched_at"
  ).bind(repo, cacheKey, JSON.stringify(rows)).run();
  return { rows, sha, calls: 2, cached: false };
}

app.get("/index", async (c) => {
  if (!vaultGithubToken(c.env)) return c.json({ error: NO_TOKEN }, 400);
  const source = await vaultSource(c.env, c.get("email"));
  if (source.mode !== "personal") return c.json({ error: "회사용은 날짜 폴더 방식을 사용합니다" }, 400);

  const today = kstToday();
  const folder = String(c.req.query("folder") ?? "").normalize("NFC").trim().replace(/\/+$/, "");
  const q = String(c.req.query("q") ?? "").normalize("NFC").trim().toLowerCase().slice(0, 100);
  const kind = String(c.req.query("kind") ?? "").trim();
  const sinceRaw = c.req.query("since");
  const since = sinceRaw === "" ? "" : sinceRaw && /^\d{4}-\d{2}-\d{2}$/.test(sinceRaw) ? sinceRaw : shiftDate(today, -INDEX_DEFAULT_DAYS);
  if (folder && !source.dirs.includes(folder)) return c.json({ error: "개인용 폴더 목록에 없는 폴더입니다", folders: source.dirs }, 400);
  if (kind && !["md", "html"].includes(kind)) return c.json({ error: "kind 는 md 또는 html" }, 400);

  let idx: Awaited<ReturnType<typeof loadIndex>>;
  try { idx = await loadIndex(c.env); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 502); }
  console.log("vault_index", { github_calls: idx.calls, cached: idx.cached, tree_sha: idx.sha.slice(0, 7) });

  // 개인 폴더 범위 + 그 파일이 속한 범위 폴더
  const scoped = idx.rows.flatMap((r) => {
    const d = source.dirs.find((dir) => r.path.startsWith(dir + "/"));
    return d ? [{ ...r, folder: d }] : [];
  });
  const allCollections = buildVaultCollections(scoped);
  const groupedPaths = new Set(allCollections.flatMap((group) => group.files.map((row) => row.path)));
  const folders = source.dirs.map((d) => {
    const folderRows = scoped.filter((r) => r.folder === d);
    const folderCollections = allCollections.filter((group) => group.root === d || group.root.startsWith(d + "/"));
    const flat = folderRows.filter((r) => !groupedPaths.has(r.path)).length;
    return {
      folder: d,
      count: folderCollections.length ? folderCollections.length + flat : folderRows.length,
      files: folderRows.length,
      collection_count: folderCollections.length,
      flat_count: flat,
    };
  });

  // docs와 01-History 하위 폴더는 collection 으로 묶는다.
  // 검색(q)은 collection 안의 어떤 파일이 맞아도 그 묶음 전체를 돌려줘 README 대표 문서를 잃지 않게 한다.
  let filtered = scoped;
  if (folder) filtered = filtered.filter((r) => r.folder === folder);
  if (kind) filtered = filtered.filter((r) => r.kind === kind);
  if (since) filtered = filtered.filter((r) => (r.date ? r.date >= since : Boolean(folder)));  // 날짜 없는 파일은 폴더를 골랐을 때만

  let collections = buildVaultCollections(filtered);
  const filteredGroupedPaths = new Set(collections.flatMap((group) => group.files.map((row) => row.path)));
  let rows = filtered.filter((r) => !filteredGroupedPaths.has(r.path));
  if (q) {
    rows = rows.filter((r) => r.path.toLowerCase().includes(q));
    collections = collections.filter((group) =>
      group.root.toLowerCase().includes(q) ||
      group.name.toLowerCase().includes(q) ||
      group.files.some((r) => r.path.toLowerCase().includes(q))
    );
  }
  rows.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.path.localeCompare(b.path));
  collections.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.root.localeCompare(b.root, "ko"));

  const total = rows.length + collections.reduce((sum, group) => sum + group.files.length, 0);
  const collectionTotal = collections.length;
  rows = rows.slice(0, INDEX_MAX_ROWS);
  collections = collections.slice(0, INDEX_MAX_ROWS);

  // 이미 가져온 것: 내 개인 노트(scope='personal' AND created_by=본인)만 센다
  const got = await c.env.DB.prepare("SELECT link FROM meetings WHERE link IS NOT NULL AND scope='personal' AND created_by=?1").bind(c.get("email")).all();
  const gotSet = new Set((got.results as any[]).map((r) => String(r.link)));
  const apiRow = (r: VaultIndexRow) => ({ ...r, title: vaultTitle(r.name), imported: gotSet.has(r.path) });

  return c.json({
    since, folder, q, kind, total, collection_total: collectionTotal, folders,
    tree_sha: idx.sha.slice(0, 7), github_calls: idx.calls, cached: idx.cached,
    rows: rows.map(apiRow),
    collections: collections.map((group) => ({
      ...group,
      imported: gotSet.has(group.representative.path),
      representative: apiRow(group.representative),
      files: group.files.map(apiRow),
    })),
  });
});

/* ── 가져오기 / 원문 읽기 (회사용·개인용 공통, 범위만 다름) ──────────────── */
app.post("/import", async (c) => {
  if (!vaultGithubToken(c.env)) return c.json({ error: NO_TOKEN }, 400);
  const source = await vaultSource(c.env, c.get("email"));
  const b = await c.req.json<{ path?: string; date?: string }>().catch(() => ({} as any));
  const path = String(b.path ?? "").normalize("NFC");
  if (!vaultPathOk(source, path)) return c.json({ error: "볼트 밖 경로이거나 허용되지 않은 파일입니다" }, 400);
  const date = safeDate(b.date);
  const email = c.get("email");
  const kind = fileKind(path);

  // 중복 판정: 같은 경로라도 회사 회의록과 내 개인 노트는 별개다
  const dup = await (source.mode === "personal"
    ? c.env.DB.prepare("SELECT id FROM meetings WHERE link=?1 AND scope='personal' AND created_by=?2").bind(path, email)
    : c.env.DB.prepare("SELECT id FROM meetings WHERE link=?1 AND scope='company'").bind(path)
  ).first<{ id: number }>();
  if (dup) return c.json({ ok: true, id: dup.id, already: true });

  const res = await ghVaultFetch(c.env, path);
  if (!res.ok) {
    const full = await res.text();
    return c.json({ error: `볼트 파일 읽기 실패 (${res.status}) ${full.slice(0, 300)}` }, 502);
  }
  const { name, md } = await decodeContent(res);
  if (!md.trim()) return c.json({ error: "빈 파일입니다" }, 400);
  // html 은 script·이벤트 속성·iframe 등을 걷어낸 정제본을 저장한다 (열 때 CSP 로 한 번 더 막는다)
  const body = kind === "html" ? sanitizeHtml(md) : md;

  const title = vaultTitle(name || "회의록");
  const r = await c.env.DB.prepare(
    "INSERT INTO meetings (date, title, body_mode, body_md, link, created_by, scope) VALUES (?1,?2,?3,?4,?5,?6,?7)"
  ).bind(date, title.slice(0, 200), kind === "html" ? "full_html" : "full_md", body.slice(0, 200000), path, email, source.mode).run();
  return c.json({ ok: true, id: r.meta.last_row_id, title, chars: body.length, kind });
});

/** 가져온 볼트 원문을 앱 안에서 읽는다. GitHub 토큰과 실제 저장소 주소는 브라우저에 노출하지 않는다. */
app.get("/file", async (c) => {
  if (!vaultGithubToken(c.env)) return c.json({ error: NO_TOKEN }, 400);
  const source = await vaultSource(c.env, c.get("email"));
  const path = String(c.req.query("path") ?? "").normalize("NFC");
  if (!vaultPathOk(source, path)) return c.json({ error: "볼트 밖 경로이거나 허용되지 않은 파일입니다" }, 400);

  const res = await ghVaultFetch(c.env, path);
  if (!res.ok) {
    const full = await res.text();
    return c.json({ error: `볼트 파일 읽기 실패 (${res.status}) ${full.slice(0, 300)}` }, 502);
  }
  const { name, md } = await decodeContent(res);
  const raw = c.req.query("raw") === "1";
  const kind = fileKind(path);
  // html 노트는 인라인 <script>가 본문을 그리는 산출물(easy-guide·work-map 등)이 대부분이라,
  // script를 걷어낸 정제본은 빈 껍데기만 남는다. 기본은 원본 그대로 주되 CSP `sandbox`로
  // 불투명 출처(opaque origin)에서 실행시켜 쿠키·앱 API·상위 창에 손대지 못하게 한다.
  // ?safe=1 이면 예전처럼 script를 걷어낸 정제본을 준다.
  const safe = c.req.query("safe") === "1";
  const original = kind === "html" && !safe;
  const body = raw ? md : kind === "html" ? (safe ? sanitizeHtml(md) : md) : vaultMarkdownToHtml(md, vaultTitle(name || "문서.md"));
  const csp = original
    // 원본 html: 인라인 script·style 허용, 네트워크(connect)·프레임·폼은 전부 차단. 외부 자원은 https 정적 파일만.
    ? "default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: https:; font-src data: https:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox"
    // md 변환본·정제본: 예전과 같이 스크립트·외부 자원 전부 차단. 같은 출처의 미리보기 iframe에는 담을 수 있다.
    : "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
  return new Response(body, {
    headers: {
      "Content-Type": raw ? "text/plain; charset=utf-8" : "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      ...(raw ? {} : {
        "Content-Security-Policy": csp,
        "Referrer-Policy": "no-referrer",
      }),
    },
  });
});

export default app;
