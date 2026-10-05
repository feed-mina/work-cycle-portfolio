import { Hono } from 'hono';

type Bindings = { DB: D1Database };
type Vars = { email: string };
type Profile = {
  version: string; schema: number; title: string;
  principles: { title: string; description: string; target: string }[];
  planLabels: Record<string, string>; retroLabels: Record<string, string>;
  checklist: { id: number; section: string; text: string }[];
};
const app = new Hono<{ Bindings: Bindings; Variables: Vars }>();
export const personalToday = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
export function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
const clean = (x: unknown, max = 3000) => typeof x === 'string' ? x.trim().slice(0, max) : '';
const statuses = ['미확인', '확인됨', '불일치→수정'];
const categories = ['구직', '학습', '개인 프로젝트'];
const category = (x: unknown) => categories.includes(String(x)) ? String(x) : '개인 프로젝트';

app.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  if (!['GET', 'HEAD'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: '같은 사이트에서 요청해주세요' }, 403);
  }
  await next();
});
app.onError((error, c) => {
  console.error('personal_request_failed', error instanceof Error ? error.name : 'Error');
  return c.json({ error: '개인 기록을 처리하지 못했습니다. 다시 시도해 주세요.' }, 500);
});

export async function personalSettings(db: D1Database, email: string) {
  return await db.prepare('SELECT view_mode, reminder_mode, ui_version FROM personal_settings WHERE user_email=?1').bind(email)
    .first<{ view_mode: string; reminder_mode: string; ui_version: string }>() ?? { view_mode: 'company', reminder_mode: 'company', ui_version: 'personal-v1' };
}
export async function personalProfile(db: D1Database, email: string, date: string, pin = false): Promise<Profile> {
  const settings = await personalSettings(db, email);
  if (pin) await db.prepare('INSERT INTO personal_days(user_email,cycle_date,ui_version) VALUES(?1,?2,?3) ON CONFLICT DO NOTHING').bind(email, date, settings.ui_version).run();
  const day = await db.prepare('SELECT ui_version FROM personal_days WHERE user_email=?1 AND cycle_date=?2').bind(email, date).first<{ ui_version: string }>();
  const row = await db.prepare('SELECT definition FROM personal_ui_versions WHERE id=?1').bind(day?.ui_version ?? settings.ui_version).first<{ definition: string }>();
  if (!row) throw new Error('profile_missing');
  const profile = JSON.parse(row.definition) as Profile;
  if (profile.schema !== 1 || !Array.isArray(profile.checklist) || !profile.checklist.length) throw new Error('profile_incompatible');
  return profile;
}
app.get('/settings', async c => c.json(await personalSettings(c.env.DB, c.get('email'))));
app.put('/settings', async c => {
  const b = await c.req.json<{ view_mode?: string; reminder_mode?: string }>();
  for (const k of ['view_mode', 'reminder_mode'] as const) if (b[k] !== undefined && !['company', 'personal'].includes(b[k]!)) return c.json({ error: '화면 또는 알림 모드가 올바르지 않습니다' }, 400);
  const old = await personalSettings(c.env.DB, c.get('email'));
  await c.env.DB.prepare(`INSERT INTO personal_settings(user_email,view_mode,reminder_mode,ui_version) VALUES(?1,?2,?3,?4)
    ON CONFLICT(user_email) DO UPDATE SET view_mode=excluded.view_mode,reminder_mode=excluded.reminder_mode,updated_at=datetime('now')`)
    .bind(c.get('email'), b.view_mode ?? old.view_mode, b.reminder_mode ?? old.reminder_mode, old.ui_version).run();
  return c.json({ ok: true });
});
app.get('/ui', async c => c.json(await personalProfile(c.env.DB, c.get('email'), personalToday())));
app.get('/ui/history', async c => {
  const versions = await c.env.DB.prepare('SELECT id,label,created_at FROM personal_ui_versions ORDER BY created_at DESC,id DESC').all();
  const events = await c.env.DB.prepare('SELECT from_version,to_version,created_at FROM personal_ui_events WHERE user_email=?1 ORDER BY id DESC LIMIT 50').bind(c.get('email')).all();
  return c.json({ versions: versions.results, events: events.results, settings: await personalSettings(c.env.DB, c.get('email')) });
});
app.post('/ui/activate', async c => {
  const b = await c.req.json<{ version?: string; base_version?: string }>();
  const row = await c.env.DB.prepare('SELECT definition FROM personal_ui_versions WHERE id=?1').bind(clean(b.version, 80)).first<{ definition: string }>();
  if (!row || JSON.parse(row.definition).schema !== 1) return c.json({ error: '호환되는 화면 버전이 아닙니다' }, 400);
  const email = c.get('email');
  await c.env.DB.prepare('INSERT INTO personal_settings(user_email) VALUES(?1) ON CONFLICT DO NOTHING').bind(email).run();
  // Both operations share a transaction; changes() gates the audit on a successful compare-and-swap.
  const result = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE personal_settings SET ui_version=?1,updated_at=datetime('now') WHERE user_email=?2 AND ui_version=?3").bind(b.version!, email, clean(b.base_version, 80)),
    c.env.DB.prepare('INSERT INTO personal_ui_events(user_email,from_version,to_version) SELECT ?1,?2,?3 WHERE changes()=1').bind(email, clean(b.base_version, 80), b.version!),
  ]);
  if (!result[0].meta.changes) return c.json({ error: '다른 화면에서 설정이 바뀌었습니다. 새로고침해 주세요.' }, 409);
  return c.json({ ok: true, note: '이미 기록한 날짜는 당시 버전을 유지합니다. 새 날짜부터 선택한 버전을 사용합니다.' });
});

app.get('/plan/prefill', async c => {
  const email = c.get('email'), date = personalToday();
  const [prefill, today, retro] = await Promise.all([
    c.env.DB.prepare("SELECT id,cycle_date,tomorrow_prompt FROM personal_retros WHERE user_email=?1 AND cycle_date<?2 AND tomorrow_prompt!='' ORDER BY cycle_date DESC LIMIT 1").bind(email, date).first(),
    c.env.DB.prepare('SELECT * FROM personal_plans WHERE user_email=?1 AND cycle_date=?2').bind(email, date).first(),
    c.env.DB.prepare('SELECT * FROM personal_retros WHERE user_email=?1 AND cycle_date=?2').bind(email, date).first(),
  ]);
  return c.json({ prefill, today, retro });
});
const PLAN_KEYS = ['user_flow', 'keep', 'dont_touch', 'done_criteria', 'unknowns'] as const;
const RETRO_KEYS = ['work_summary', 'ai_answer_md', 'tomorrow_prompt'] as const;
/* 저장 이력(0023 personal_entry_revisions): 저장할 때마다 그때 내용을 한 줄씩 쌓아 하루 기록 md 에 '저장 이력'으로 넣는다.
 * 화면용 personal_plans/personal_retros 는 그대로 하루 1행 덮어쓰기. 표가 없으면(0023 전) 이력만 건너뛰고 저장은 그대로 된다.
 * true 는 영구 캐시, false 는 60초만 (routes/schedule.ts hasLogParent 와 같은 방식) */
let HAS_REVISIONS: boolean | null = null, HAS_REVISIONS_AT = 0;
async function hasRevisions(db: D1Database): Promise<boolean> {
  if (HAS_REVISIONS === true) return true;
  if (HAS_REVISIONS === false && Date.now() - HAS_REVISIONS_AT < 60_000) return false;
  const row = await db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='personal_entry_revisions'").first<{ n: number }>();
  HAS_REVISIONS = (row?.n ?? 0) > 0; HAS_REVISIONS_AT = Date.now();
  return HAS_REVISIONS;
}
/** 메모 수정 이력(0024 schedule_log_revisions) 표가 있는지 — routes/schedule.ts 의 메모 수정과 하루 기록 md 가 쓴다.
 * shared.ts 가 이 파일을 import 하므로(순환 금지) 여기에 둔다. true 는 영구 캐시, false 는 60초만. */
let HAS_LOG_REVISIONS: boolean | null = null, HAS_LOG_REVISIONS_AT = 0;
export async function hasLogRevisions(db: D1Database): Promise<boolean> {
  if (HAS_LOG_REVISIONS === true) return true;
  if (HAS_LOG_REVISIONS === false && Date.now() - HAS_LOG_REVISIONS_AT < 60_000) return false;
  const row = await db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='schedule_log_revisions'").first<{ n: number }>();
  HAS_LOG_REVISIONS = (row?.n ?? 0) > 0; HAS_LOG_REVISIONS_AT = Date.now();
  return HAS_LOG_REVISIONS;
}
const pickFields = (row: Record<string, unknown>, keys: readonly string[]) => JSON.stringify(Object.fromEntries(keys.map(k => [k, String(row[k] ?? '')])));
/** 덮어쓰기 직전에 부른다. 그날 이력이 아직 없는데 기존 행이 있으면(0023 전 저장분) 그 내용을 먼저 한 줄 옮겨 둔다 */
async function seedRevision(db: D1Database, email: string, date: string, kind: 'plan' | 'retro') {
  if (!(await hasRevisions(db))) return;
  const table = kind === 'plan' ? 'personal_plans' : 'personal_retros', keys = kind === 'plan' ? PLAN_KEYS : RETRO_KEYS;
  const [old, any] = await Promise.all([
    db.prepare(`SELECT * FROM ${table} WHERE user_email=?1 AND cycle_date=?2`).bind(email, date).first<Record<string, string>>(),
    db.prepare('SELECT 1 FROM personal_entry_revisions WHERE user_email=?1 AND cycle_date=?2 AND kind=?3 LIMIT 1').bind(email, date, kind).first(),
  ]);
  if (old && !any) await db.prepare('INSERT INTO personal_entry_revisions(user_email,cycle_date,kind,ui_version,fields,saved_at) VALUES(?1,?2,?3,?4,?5,?6)')
    .bind(email, date, kind, old.ui_version, pickFields(old, keys), old.updated_at).run();
}
/** 저장 직후에 부른다. 바로 앞 이력과 내용이 같으면(같은 내용 다시 저장) 쌓지 않는다 */
async function addRevision(db: D1Database, email: string, date: string, kind: 'plan' | 'retro', version: string, fields: string) {
  if (!(await hasRevisions(db))) return;
  const last = await db.prepare('SELECT fields FROM personal_entry_revisions WHERE user_email=?1 AND cycle_date=?2 AND kind=?3 ORDER BY id DESC LIMIT 1')
    .bind(email, date, kind).first<{ fields: string }>();
  if (last?.fields === fields) return;
  await db.prepare('INSERT INTO personal_entry_revisions(user_email,cycle_date,kind,ui_version,fields) VALUES(?1,?2,?3,?4,?5)').bind(email, date, kind, version, fields).run();
}
/** 이력은 부가 기능 — 실패해도 저장 응답은 성공으로 둔다(원인은 로그에 이름만) */
async function safely(fn: () => Promise<void>) {
  try { await fn(); } catch (e) { console.error('personal_revision_failed', e instanceof Error ? e.message.slice(0, 200) : 'Error'); }
}
app.post('/plan', async c => {
  const b = await c.req.json<Record<string, unknown>>(), email = c.get('email'), date = personalToday();
  const keys = PLAN_KEYS;
  if (!clean(b.user_flow)) return c.json({ error: '오늘 이룰 것을 적어주세요' }, 400);
  const profile = await personalProfile(c.env.DB, email, date, true);
  await safely(() => seedRevision(c.env.DB, email, date, 'plan'));
  const prompt = keys.map(k => `[${profile.planLabels[k]}] ${clean(b[k])}`).join('\n');
  await c.env.DB.prepare(`INSERT INTO personal_plans(user_email,cycle_date,ui_version,user_flow,keep,dont_touch,done_criteria,unknowns,final_prompt)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(user_email,cycle_date) DO UPDATE SET
    user_flow=excluded.user_flow,keep=excluded.keep,dont_touch=excluded.dont_touch,done_criteria=excluded.done_criteria,unknowns=excluded.unknowns,final_prompt=excluded.final_prompt,updated_at=datetime('now')`)
    .bind(email, date, profile.version, ...keys.map(k => clean(b[k])), prompt).run();
  await safely(() => addRevision(c.env.DB, email, date, 'plan', profile.version, pickFields(Object.fromEntries(keys.map(k => [k, clean(b[k])])), keys)));
  return c.json({ ok: true, final_prompt: prompt });
});
app.post('/retro', async c => {
  const b = await c.req.json<Record<string, unknown>>(), email = c.get('email'), date = personalToday();
  if (!clean(b.work_summary)) return c.json({ error: '오늘 한 일과 배운 점을 적어주세요' }, 400);
  const profile = await personalProfile(c.env.DB, email, date, true);
  await safely(() => seedRevision(c.env.DB, email, date, 'retro'));
  await c.env.DB.prepare(`INSERT INTO personal_retros(user_email,cycle_date,ui_version,work_summary,ai_answer_md,tomorrow_prompt) VALUES(?1,?2,?3,?4,?5,?6)
    ON CONFLICT(user_email,cycle_date) DO UPDATE SET work_summary=excluded.work_summary,ai_answer_md=excluded.ai_answer_md,tomorrow_prompt=excluded.tomorrow_prompt,updated_at=datetime('now')`)
    .bind(email, date, profile.version, clean(b.work_summary), clean(b.ai_answer_md), clean(b.tomorrow_prompt)).run();
  await safely(() => addRevision(c.env.DB, email, date, 'retro', profile.version, pickFields(Object.fromEntries(RETRO_KEYS.map(k => [k, clean(b[k])])), RETRO_KEYS)));
  return c.json({ ok: true });
});
export async function personalChecklist(db: D1Database, email: string, date: string) {
  const profile = await personalProfile(db, email, date);
  const rows = await db.prepare('SELECT item_id,checked,memo FROM personal_checks WHERE user_email=?1 AND cycle_date=?2 AND ui_version=?3').bind(email, date, profile.version).all<{ item_id: number; checked: number; memo: string }>();
  return { date, version: profile.version, items: profile.checklist.map(i => ({ ...i, checked: 0, memo: '', ...rows.results.find(r => r.item_id === i.id) })) };
}
app.get('/checklist', async c => {
  const date = c.req.query('date') ?? personalToday();
  if (!validDate(date)) return c.json({ error: '날짜가 올바르지 않습니다' }, 400);
  return c.json(await personalChecklist(c.env.DB, c.get('email'), date));
});
async function updateCheck(c: any, memoOnly: boolean) {
  const b = await c.req.json(), date = b.date ?? personalToday(), email = c.get('email');
  if (!validDate(date) || (!memoOnly && typeof b.checked !== 'boolean') || (memoOnly && (typeof b.memo !== 'string' || b.memo.length > 1000))) return c.json({ error: '입력 값이 올바르지 않습니다' }, 400);
  const profile = await personalProfile(c.env.DB, email, date, true);
  const id = Number(memoOnly ? c.req.param('itemId') : b.item_id);
  if (!profile.checklist.some(i => i.id === id)) return c.json({ error: '이 날짜의 체크리스트 항목이 아닙니다' }, 404);
  const column = memoOnly ? 'memo' : 'checked';
  const saved = memoOnly ? clean(b.memo, 1000) : Number(b.checked);
  await c.env.DB.prepare(`INSERT INTO personal_checks(user_email,cycle_date,ui_version,item_id,${column}) VALUES(?1,?2,?3,?4,?5)
    ON CONFLICT(user_email,cycle_date,ui_version,item_id) DO UPDATE SET ${column}=excluded.${column}`)
    .bind(email, date, profile.version, id, saved).run();
  // 메모 저장은 저장한 값을 같이 돌려준다 — 화면이 이 응답으로 칸을 다시 채우므로(회사 API routes/cycle.ts 와 같은 모양). 체크 저장은 그대로 {ok}.
  return c.json(memoOnly ? { ok: true, memo: saved, deleted: saved === '' } : { ok: true });
}
app.post('/checks', c => updateCheck(c, false));
app.put('/checklist/:itemId/memo', c => updateCheck(c, true));

app.get('/verifications', async c => {
  const date = c.req.query('date') ?? personalToday();
  if (!validDate(date)) return c.json({ error: '날짜가 올바르지 않습니다' }, 400);
  const rows = await c.env.DB.prepare('SELECT * FROM personal_results WHERE user_email=?1 AND cycle_date=?2 AND deleted_at IS NULL ORDER BY id DESC').bind(c.get('email'), date).all();
  return c.json({ date, rows: rows.results });
});
app.post('/verifications', async c => {
  const b = await c.req.json<Record<string, unknown>>(), date = b.date ?? personalToday(), email = c.get('email');
  if (!validDate(date) || !clean(b.item, 200) || !statuses.includes(String(b.status ?? '미확인'))) return c.json({ error: '한 일·날짜·확인 상태를 확인해주세요' }, 400);
  const profile = await personalProfile(c.env.DB, email, date, true);
  const r = await c.env.DB.prepare(`INSERT INTO personal_results(user_email,cycle_date,ui_version,item,formula,method,result,status,category) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)`)
    .bind(email, date, profile.version, clean(b.item, 200), clean(b.formula), clean(b.method), clean(b.result), b.status ?? '미확인', category(b.category)).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});
app.patch('/verifications/:id', async c => {
  const b = await c.req.json<Record<string, unknown>>(), email = c.get('email');
  const old = await c.env.DB.prepare('SELECT * FROM personal_results WHERE id=?1 AND user_email=?2 AND deleted_at IS NULL').bind(c.req.param('id'), email).first<Record<string, string>>();
  if (!old) return c.json({ error: '내 결과 기록을 찾을 수 없습니다' }, 404);
  const values = ['item', 'formula', 'method', 'result', 'status'].map(k => b[k] === undefined ? old[k] : clean(b[k], k === 'item' ? 200 : 3000));
  if (!values[0] || !statuses.includes(values[4])) return c.json({ error: '항목과 상태를 확인해주세요' }, 400);
  await c.env.DB.prepare("UPDATE personal_results SET item=?1,formula=?2,method=?3,result=?4,status=?5,updated_at=datetime('now') WHERE id=?6 AND user_email=?7")
    .bind(...values, c.req.param('id'), email).run();
  return c.json({ ok: true });
});
app.delete('/verifications/:id', async c => {
  const r = await c.env.DB.prepare("UPDATE personal_results SET deleted_at=datetime('now') WHERE id=?1 AND user_email=?2 AND deleted_at IS NULL").bind(c.req.param('id'), c.get('email')).run();
  return c.json({ ok: true, deleted: r.meta.changes });
});
app.get('/tasks', async c => {
  const date = c.req.query('date') ?? personalToday();
  if (!validDate(date)) return c.json({ error: '날짜 오류' }, 400);
  return c.json({ rows: (await c.env.DB.prepare('SELECT * FROM personal_tasks WHERE user_email=?1 AND task_date=?2 ORDER BY id').bind(c.get('email'), date).all()).results });
});
app.post('/tasks', async c => {
  const b = await c.req.json<Record<string, unknown>>(), date = b.date ?? personalToday();
  if (!validDate(date) || !clean(b.title, 200)) return c.json({ error: '할 일과 날짜를 적어주세요' }, 400);
  const r = await c.env.DB.prepare('INSERT INTO personal_tasks(user_email,task_date,title,category) VALUES(?1,?2,?3,?4)').bind(c.get('email'), date, clean(b.title, 200), category(b.category)).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});
app.patch('/tasks/:id', async c => {
  const b = await c.req.json<{ done?: boolean }>();
  if (typeof b.done !== 'boolean') return c.json({ error: '완료 상태 오류' }, 400);
  const r = await c.env.DB.prepare('UPDATE personal_tasks SET done=?1 WHERE id=?2 AND user_email=?3').bind(Number(b.done), c.req.param('id'), c.get('email')).run();
  return c.json({ ok: !!r.meta.changes }, r.meta.changes ? 200 : 404);
});
app.post('/focus', async c => {
  const b = await c.req.json<Record<string, unknown>>(), date = b.date ?? personalToday(), minutes = Number(b.minutes);
  if (!validDate(date) || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440 || !clean(b.note, 200)) return c.json({ error: '집중한 내용과 1~1440분 사이의 시간을 적어주세요' }, 400);
  const r = await c.env.DB.prepare('INSERT INTO personal_focus(user_email,focus_date,minutes,note,category) VALUES(?1,?2,?3,?4,?5)').bind(c.get('email'), date, minutes, clean(b.note, 200), category(b.category)).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});
app.delete('/focus/:id', async c => {
  const r = await c.env.DB.prepare("UPDATE personal_focus SET deleted_at=datetime('now') WHERE id=?1 AND user_email=?2 AND deleted_at IS NULL").bind(c.req.param('id'), c.get('email')).run();
  return c.json({ ok: true, deleted: r.meta.changes });
});

export async function personalSummary(db: D1Database, email: string, from: string, to: string, selectedCategory = '') {
  const args = [email, from, to, selectedCategory];
  const [results, tasks, focus, retro] = await Promise.all([
    db.prepare("SELECT * FROM personal_results WHERE user_email=?1 AND cycle_date BETWEEN ?2 AND ?3 AND (?4='' OR category=?4) AND deleted_at IS NULL ORDER BY cycle_date DESC,id DESC").bind(...args).all<Record<string, any>>(),
    db.prepare("SELECT * FROM personal_tasks WHERE user_email=?1 AND task_date BETWEEN ?2 AND ?3 AND (?4='' OR category=?4) ORDER BY task_date DESC,id DESC").bind(...args).all<Record<string, any>>(),
    db.prepare("SELECT * FROM personal_focus WHERE user_email=?1 AND focus_date BETWEEN ?2 AND ?3 AND (?4='' OR category=?4) AND deleted_at IS NULL ORDER BY focus_date DESC,id DESC").bind(...args).all<Record<string, any>>(),
    db.prepare('SELECT cycle_date,tomorrow_prompt FROM personal_retros WHERE user_email=?1 AND cycle_date BETWEEN ?2 AND ?3 ORDER BY cycle_date DESC LIMIT 1').bind(email, from, to).first(),
  ]);
  return { from, to, category: selectedCategory, results: results.results, tasks: tasks.results, focus: focus.results, next: retro,
    summary: { results: results.results.length, tasks: tasks.results.length, done: tasks.results.filter(r => r.done).length,
      focus_minutes: focus.results.reduce((n, r) => n + Number(r.minutes), 0), unchecked: results.results.filter(r => r.status === '미확인').length } };
}
app.get('/dashboard', async c => {
  const from = c.req.query('from') ?? personalToday(), to = c.req.query('to') ?? from, cat = c.req.query('category') ?? '';
  if (!validDate(from) || !validDate(to) || from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 366 || (cat && !categories.includes(cat))) return c.json({ error: '기간(최대 1년)과 분류를 확인해주세요' }, 400);
  return c.json(await personalSummary(c.env.DB, c.get('email'), from, to, cat));
});
app.get('/journal', async c => {
  const from=c.req.query('from') ?? personalToday(), to=c.req.query('to') ?? from;
  if(!validDate(from)||!validDate(to)||from>to||(Date.parse(to)-Date.parse(from))/86400000>366) return c.json({error:'기간을 확인해주세요'},400);
  const rows=await c.env.DB.prepare(`SELECT cycle_date,ui_version,'실행 계획' AS kind,final_prompt AS body FROM personal_plans WHERE user_email=?1 AND cycle_date BETWEEN ?2 AND ?3
    UNION ALL SELECT cycle_date,ui_version,'하루 회고' AS kind,work_summary || char(10) || ai_answer_md || char(10) || tomorrow_prompt AS body FROM personal_retros WHERE user_email=?1 AND cycle_date BETWEEN ?2 AND ?3 ORDER BY cycle_date DESC`).bind(c.get('email'),from,to).all();
  return c.json({rows:rows.results});
});
/** 하루 기록 md — 그날의 실행 계획 · 메모 · 하루 회고를 한 파일로 (2026-10-02).
 * 실행 계획·회고: 최종본 + 저장 이력(0023, 2번 이상 저장했을 때 저장 시각순 전체).
 * 메모: 개인용 '업무' 일정마다 묶음 — 정리 메모, 시간순 메모(답글 들여쓰기), 메모 수정 이력(0024). 메모가 없는 일정도 '(메모 없음)'으로 남긴다.
 * 본인 기록만, 개인용(scope='personal') 일정만. 볼트·외부에는 쓰지 않는다 — 내려받기만. */
export async function personalDayMarkdown(db: D1Database, email: string, date: string): Promise<string> {
  const [withRevisions, withLogRevisions] = await Promise.all([hasRevisions(db), hasLogRevisions(db)]);
  const [profile, plan, retro, schedules, logs, revisions, logRevisions] = await Promise.all([
    personalProfile(db, email, date),
    db.prepare('SELECT * FROM personal_plans WHERE user_email=?1 AND cycle_date=?2').bind(email, date).first<Record<string, string>>(),
    db.prepare('SELECT * FROM personal_retros WHERE user_email=?1 AND cycle_date=?2').bind(email, date).first<Record<string, string>>(),
    // 개인 마이페이지 메모 드롭다운과 같은 일정(그날 · 업무 · 개인용) + 그날 메모가 달린 개인용 일정(일정 날짜를 옮긴 경우)
    db.prepare(`SELECT id, title, start_time, end_time, status, memo FROM schedules s WHERE s.user_email=?1 AND s.scope='personal'
      AND ((s.date=?2 AND s.block_type='업무') OR EXISTS (SELECT 1 FROM schedule_logs l WHERE l.schedule_id=s.id AND l.user_email=?1 AND l.logged_date=?2))
      ORDER BY COALESCE(s.start_time,''), s.id`).bind(email, date).all<Record<string, any>>(),
    // l.* — 0021(parent_id) 적용 전 D1 에서도 같은 쿼리로 돈다(컬럼이 없으면 parent_id 가 undefined → 모두 일반 메모)
    db.prepare(`SELECT l.* FROM schedule_logs l JOIN schedules s ON s.id=l.schedule_id
      WHERE l.user_email=?1 AND s.user_email=?1 AND s.scope='personal' AND l.logged_date=?2
      ORDER BY l.logged_time, l.id`).bind(email, date).all<Record<string, any>>(),
    withRevisions
      ? db.prepare('SELECT kind, fields, saved_at FROM personal_entry_revisions WHERE user_email=?1 AND cycle_date=?2 ORDER BY id').bind(email, date).all<{ kind: string; fields: string; saved_at: string }>()
      : Promise.resolve({ results: [] as { kind: string; fields: string; saved_at: string }[] }),
    // 메모 수정 이력(0024): 그날 md 에 들어가는 메모들의 바뀌기 전 내용, 수정 순서대로
    withLogRevisions
      ? db.prepare(`SELECT r.log_id, r.body, r.written_at, r.replaced_at, l.created_at AS log_created FROM schedule_log_revisions r
          JOIN schedule_logs l ON l.id=r.log_id JOIN schedules s ON s.id=l.schedule_id
          WHERE r.user_email=?1 AND l.user_email=?1 AND s.user_email=?1 AND s.scope='personal' AND l.logged_date=?2 ORDER BY r.id`)
          .bind(email, date).all<{ log_id: number; body: string; written_at: string; replaced_at: string; log_created: string }>()
      : Promise.resolve({ results: [] as { log_id: number; body: string; written_at: string; replaced_at: string; log_created: string }[] }),
  ]);
  const indent = (text: unknown, pad: string) => String(text ?? '').trim().replace(/\r?\n/g, '\n' + pad);
  const fieldLines = (row: Record<string, string>, labels: Record<string, string>) =>
    Object.entries(labels).map(([k, label]) => `- **${label}**: ${indent(row[k], '  ') || '—'}`).join('\n');
  // saved_at 은 UTC "YYYY-MM-DD HH:MM:SS" → KST HH:MM
  const kstHm = (utc: string) => { const t = Date.parse(String(utc).replace(' ', 'T') + 'Z'); return isNaN(t) ? '' : new Date(t + 9 * 3600000).toISOString().slice(11, 16); };
  const section = (title: string, kind: 'plan' | 'retro', row: Record<string, string> | null, labels: Record<string, string>) => {
    const out = [`## ${title}`, row ? fieldLines(row, labels) : '기록 없음'];
    const revs = revisions.results.filter(r => r.kind === kind);
    if (revs.length >= 2) {
      out.push('', `### 저장 이력 (${revs.length}회)`);
      revs.forEach((r, i) => {
        let fields: Record<string, string> = {};
        try { fields = JSON.parse(r.fields); } catch { /* 깨진 이력은 빈 칸으로 */ }
        out.push('', `#### ${i + 1}. ${kstHm(r.saved_at)} 저장${i === revs.length - 1 ? ' (최종)' : ''}`, fieldLines(fields, labels));
      });
    }
    return out.join('\n');
  };
  const memo: string[] = [];
  // 메모 한 줄 + 수정 이력(있으면): 본문은 최종 내용, 그 아래 '✎ 시각 작성/수정: 그때 내용'을 오래된 순으로
  const memoLine = (l: Record<string, any>, prefix: string, pad: string) => {
    const revs = logRevisions.results.filter(r => r.log_id === l.id);
    const edited = revs.length ? ` _(수정 ${revs.length}회 · 마지막 ${kstHm(revs[revs.length - 1].replaced_at)})_` : '';
    memo.push(`${prefix}${l.logged_time} ${indent(l.body, pad)}${edited}`);
    // 처음 쓴 그대로인 내용만 '작성' (0024 전에 이미 고친 내용이 첫 이력이면 '수정')
    revs.forEach((r, i) => memo.push(`${pad}- ✎ ${kstHm(r.written_at)} ${i === 0 && r.written_at === r.log_created ? '작성' : '수정'}: ${indent(r.body, pad + '  ')}`));
  };
  for (const s of schedules.results) {
    const time = s.start_time ? ` (${s.start_time}${s.end_time ? '~' + s.end_time : ''})` : '';
    memo.push('', `### ${s.status === '완료' ? '✓ ' : ''}${String(s.title).trim()}${time}`);
    if (String(s.memo ?? '').trim()) memo.push(`> **정리 메모**: ${indent(s.memo, '> ')}`, '');
    const roots = logs.results.filter(l => l.schedule_id === s.id && !l.parent_id);
    if (!roots.length) memo.push('(메모 없음)');
    for (const l of roots) {
      memoLine(l, '- ', '  ');
      for (const r of logs.results.filter(x => x.parent_id === l.id)) memoLine(r, '  - ↳ ', '    ');
    }
  }
  return [`# ${date} work-cycle 개인 기록`, '', section('실행 계획', 'plan', plan, profile.planLabels),
    '', '## 메모', ...(memo.length ? memo.slice(1) : ['기록 없음']),
    '', section('하루 회고', 'retro', retro, profile.retroLabels), ''].join('\n');
}
app.get('/day.md', async c => {
  const date = c.req.query('date') ?? personalToday();
  if (!validDate(date)) return c.json({ error: '날짜가 올바르지 않습니다' }, 400);
  return c.body(await personalDayMarkdown(c.env.DB, c.get('email'), date), 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename="${date}_work-cycle.md"`,
  });
});
export async function personalBoard(db: D1Database, email: string, date: string) {
  const [checks, plan, results, retro, marks] = await Promise.all([
    personalChecklist(db, email, date),
    db.prepare('SELECT id FROM personal_plans WHERE user_email=?1 AND cycle_date=?2').bind(email, date).first(),
    db.prepare('SELECT id FROM personal_results WHERE user_email=?1 AND cycle_date=?2 AND deleted_at IS NULL LIMIT 1').bind(email, date).first(),
    db.prepare('SELECT id FROM personal_retros WHERE user_email=?1 AND cycle_date=?2').bind(email, date).first(),
    db.prepare('SELECT step FROM personal_step_marks WHERE user_email=?1 AND cycle_date=?2').bind(email, date).all<{ step: string }>(),
  ]);
  const marked = (s: string) => marks.results.some(r => r.step === s);
  const steps = { read: marked('read'), plan: !!plan, work: checks.items.every(i => i.checked), verify: !!results, share: marked('share'), retro: !!retro };
  return { date, board: [{ email, name: email.split('@')[0], steps, done: Object.values(steps).filter(Boolean).length, total: 6 }],
    step_meta: { read: { label: '회의록 읽기', time: '08:30' }, plan: { label: '실행 계획', time: '09:30' }, work: { label: '체크리스트', time: '작업 중' }, verify: { label: '결과 기록', time: '16:50' }, share: { label: '보고·공유', time: '17:20' }, retro: { label: '하루 회고', time: '17:50' } } };
}
app.get('/board', async c => {
  const date = c.req.query('date') ?? personalToday();
  if (!validDate(date)) return c.json({ error: '날짜가 올바르지 않습니다' }, 400);
  return c.json(await personalBoard(c.env.DB, c.get('email'), date));
});
app.post('/step_marks', async c => {
  const b = await c.req.json<{ step?: string }>();
  if (!['read', 'share'].includes(b.step ?? '')) return c.json({ error: '이 단계는 실제 기록으로 완료됩니다' }, 400);
  await c.env.DB.prepare('INSERT INTO personal_step_marks(user_email,cycle_date,step) VALUES(?1,?2,?3) ON CONFLICT DO NOTHING').bind(c.get('email'), personalToday(), b.step!).run();
  return c.json({ ok: true });
});
export async function buildPersonalReminder(db: D1Database, email: string, slot: number): Promise<string | null> {
  const date = personalToday();
  if ([1000, 1230, 1700].includes(slot)) {
    const checklist = await personalChecklist(db, email, date);
    const sections = slot === 1000 ? ['하루 방향 잡기'] : slot === 1230 ? ['집중해서 진행하기'] : ['결과 확인하기', '하루 마무리하기'];
    const left = checklist.items.filter(i => sections.includes(i.section) && !i.checked);
    return left.length ? ['📋 work-cycle 개인용 점검', ...left.map(i => '□ ' + i.text)].join('\n') : null;
  }
  const data = await personalSummary(db, email, date, date);
  const board = await personalBoard(db, email, date);
  return [`${slot === 825 ? '🌅' : '🌇'} work-cycle 개인용 ${slot === 825 ? '아침 계획' : '결과 기록 및 오늘 하루 검토'} (${date})`,
    // '계획 대비 완료'·'집중 시간'·미완료 할 일 줄은 뺐다(2026-10-02) — 입력 칸이 없어 늘 0이던 값이다.
    `개인 사이클 ${board.board[0].done}/6`, `결과 기록 ${data.summary.results}건 · 미확인 ${data.summary.unchecked}건`,
    '개인 화면에서 오늘의 기록을 확인해주세요.'].join('\n');
}
app.get('/reminders/preview', async c => c.json({ text: await buildPersonalReminder(c.env.DB, c.get('email'), 1740) }));

/** 기간 내 날짜별 개인 사이클 6단계 완료 이력 — 스케줄 도넛 달력(개인용)이 쓴다. 규칙은 personalBoard 와 같다(0020). */
export async function personalCycleHistory(db: D1Database, email: string, from: string, to: string) {
  const q = (sql: string) => db.prepare(sql).bind(email, from, to).all<Record<string, any>>();
  const [marks, plans, checks, results, retros, versions] = await Promise.all([
    q('SELECT cycle_date d, step FROM personal_step_marks WHERE user_email=?1 AND cycle_date BETWEEN ?2 AND ?3'),
    q('SELECT cycle_date d FROM personal_plans WHERE user_email=?1 AND cycle_date BETWEEN ?2 AND ?3'),
    q('SELECT cycle_date d, ui_version v, SUM(checked) n FROM personal_checks WHERE user_email=?1 AND cycle_date BETWEEN ?2 AND ?3 GROUP BY cycle_date, ui_version'),
    q('SELECT cycle_date d FROM personal_results WHERE user_email=?1 AND cycle_date BETWEEN ?2 AND ?3 AND deleted_at IS NULL GROUP BY cycle_date'),
    q('SELECT cycle_date d FROM personal_retros WHERE user_email=?1 AND cycle_date BETWEEN ?2 AND ?3'),
    db.prepare('SELECT id, definition FROM personal_ui_versions').all<{ id: string; definition: string }>(),
  ]);
  // 체크리스트 완료 = 그날 화면 버전의 항목을 모두 체크 (personalBoard 의 every(checked) 와 같은 뜻)
  const itemCount: Record<string, number> = {};
  for (const v of versions.results) { try { itemCount[v.id] = (JSON.parse(v.definition).checklist || []).length; } catch { itemCount[v.id] = 0; } }
  type S = { read: boolean; plan: boolean; work: boolean; verify: boolean; share: boolean; retro: boolean };
  const byDate: Record<string, S> = {};
  const ensure = (d: string) => (byDate[d] ??= { read: false, plan: false, work: false, verify: false, share: false, retro: false });
  for (const r of marks.results) if (r.step === 'read' || r.step === 'share') ensure(r.d)[r.step as 'read' | 'share'] = true;
  for (const r of plans.results) ensure(r.d).plan = true;
  for (const r of checks.results) if (itemCount[r.v] && Number(r.n) >= itemCount[r.v]) ensure(r.d).work = true;
  for (const r of results.results) ensure(r.d).verify = true;
  for (const r of retros.results) ensure(r.d).retro = true;
  const order = ['read', 'plan', 'work', 'verify', 'share', 'retro'] as const;
  const days = Object.entries(byDate).map(([date, steps]) => ({ date, steps, done: order.filter(s => steps[s]).length }));
  return { from, to, step_meta: (await personalBoard(db, email, to)).step_meta, days, personal: true };
}
app.get('/cycle_history', async c => {
  const from = c.req.query('from') ?? personalToday(), to = c.req.query('to') ?? from;
  if (!validDate(from) || !validDate(to) || from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 366) return c.json({ error: '기간(최대 1년)을 확인해주세요' }, 400);
  return c.json(await personalCycleHistory(c.env.DB, c.get('email'), from, to));
});
export default app;
