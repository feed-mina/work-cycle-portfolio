// 하루 기록 md → 볼트 history/ 올리기 검사 (2026-10-02). 실제 GitHub 에는 쓰지 않는다 — 가짜 GitHub(tests/fake-github.mjs)로만 돈다.
// 준비(각각 다른 터미널):
//   node tests/fake-github.mjs
//   npx wrangler dev --local --port 18788 --var GITHUB_API_BASE:http://127.0.0.1:18799 --var GITHUB_TOKEN_VAULT:fake-token --var VAULT_HISTORY_EMAIL:owner@example.test
// 실행: node tests/vault-history.test.mjs
// cron 시각(23:50·00:10) 분기는 wrangler /__scheduled 가 시각을 못 정해서 여기서 다루지 않는다 — historySlotAt 은 아래 순수 함수 검사로 본다.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:18788', gh = process.env.FAKE_GITHUB_URL || 'http://127.0.0.1:18799';
for (const u of [base, gh]) if (!['127.0.0.1', 'localhost'].includes(new URL(u).hostname)) throw new Error('Local test environment only');
const OWNER = 'owner@example.test', OTHER = `other-${Date.now()}@example.test`;
let count = 0;
async function call(path, { user = OWNER, method = 'GET', body, status = 200, origin } = {}) {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'Cf-Access-Authenticated-User-Email': user, ...(origin ? { Origin: origin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const d = await r.json(); assert.equal(r.status, status, `${method} ${path}: ${JSON.stringify(d)}`); count++; return d;
}
const state = async () => (await fetch(gh + '/__state')).json();
await fetch(gh + '/__reset');
const today = (await call('/api/me')).today, past = '2001-01-01';
const path = `history/${today}_work-cycle.md`;

// 볼트 주인만: 상태·버튼·올리기
const st = await call('/api/vault-history/status'); assert.equal(st.enabled, true); assert.equal(st.mine, true); assert.equal(st.dir, 'history');
const other = await call('/api/vault-history/status', { user: OTHER }); assert.equal(other.mine, false); assert.equal(other.dir, null, 'non-owner does not see folder');
await call('/api/vault-history/sync', { user: OTHER, method: 'POST', body: { date: today }, status: 403 });
await call('/api/vault-history/sync', { method: 'POST', body: { date: today }, origin: 'https://evil.example', status: 403 });
await call('/api/vault-history/sync', { method: 'POST', body: { date: '2099-01-01' }, status: 400 });
await call('/api/vault-history/sync', { method: 'POST', body: { date: '2026-02-30' }, status: 400 });

// 기록 없는 날은 올리지 않는다
assert.equal((await call('/api/vault-history/sync', { method: 'POST', body: { date: past } })).status, 'empty');

// 올리기 → 같은 내용은 그대로 → 바뀌면 같은 파일을 sha 로 덮어쓴다
await call('/api/personal/settings', { method: 'PUT', body: { view_mode: 'personal' } });
const mark = 'vault 한글 ✓ 🌙 ' + Date.now();
await call('/api/personal/plan', { method: 'POST', body: { user_flow: mark } });
const up = await call('/api/vault-history/sync', { method: 'POST', body: { date: today } });
assert.equal(up.status, 'uploaded'); assert.equal(up.path, path);
assert.equal((await call('/api/vault-history/sync', { method: 'POST', body: { date: today } })).status, 'unchanged');
await call('/api/personal/retro', { method: 'POST', body: { work_summary: '회고 ' + mark } });
assert.equal((await call('/api/vault-history/sync', { method: 'POST', body: { date: today } })).status, 'uploaded');
let s = await state();
const md = await (await fetch(base + `/api/personal/day.md?date=${today}`, { headers: { 'Cf-Access-Authenticated-User-Email': OWNER } })).text(); count++;
assert.equal(s.files[path], md, 'uploaded file equals the md download (UTF-8 intact)');
assert(s.files[path].includes(mark) && s.files[path].includes('회고 ' + mark));
const puts = s.log.filter((l) => l.method === 'PUT');
assert.equal(puts.length, 2, 'one PUT per change, none for unchanged');
assert(puts.every((l) => l.path === path && l.repo === 'feed-mina/ME' && l.auth === 'set' && l.message === `work-cycle: ${today} 하루 기록`));
assert(!Object.keys(s.files).some((p) => p.includes(past)), 'empty day not uploaded');

// 다른 사람 기록은 섞이지 않는다
await call('/api/personal/settings', { user: OTHER, method: 'PUT', body: { view_mode: 'personal' } });
await call('/api/personal/plan', { user: OTHER, method: 'POST', body: { user_flow: '남의 계획 ' + mark } });
await call('/api/personal/retro', { method: 'POST', body: { work_summary: '회고 다시 ' + mark } });
await call('/api/vault-history/sync', { method: 'POST', body: { date: today } });
assert(!(await state()).files[path].includes('남의 계획'), 'only owner records');

// GitHub 오류는 원문 그대로 (AGENTS.md 2-4)
await fetch(gh + '/__fail?status=403');
await call('/api/personal/retro', { method: 'POST', body: { work_summary: '실패 확인 ' + mark } });
const fail = await call('/api/vault-history/sync', { method: 'POST', body: { date: today }, status: 502 });
assert(fail.error.includes('(403)') && fail.error.includes('Resource not accessible by personal access token') && fail.error.includes('Contents: Read and write'), fail.error);

// cron 시각 → 올릴 날짜 (순수 함수, esbuild 로 번들해서 확인)
const bundle = execFileSync('node_modules/.bin/esbuild', ['src/vault-history.ts', '--bundle', '--format=esm', '--platform=neutral', '--log-level=error'], { encoding: 'utf8' });
const { historySlotAt } = await import('data:text/javascript;base64,' + Buffer.from(bundle).toString('base64'));
const at = (iso) => historySlotAt(Date.parse(iso));
assert.deepEqual(at('2026-10-02T14:50:00Z'), { date: '2026-10-02', hhmm: 2350 }, '23:50 KST → that day');
assert.deepEqual(at('2026-10-02T15:10:00Z'), { date: '2026-10-02', hhmm: 10 }, '00:10 KST → previous day');
assert.deepEqual(at('2026-12-31T15:10:00Z'), { date: '2026-12-31', hhmm: 10 }, '00:10 on Jan 1 → Dec 31');
for (const iso of ['2026-10-02T14:40:00Z', '2026-10-02T15:50:00Z', '2026-10-02T23:25:00Z', '2026-10-02T08:40:00Z']) assert.equal(at(iso), null, iso + ' is not a history slot');
count += 7;

console.log(`PASS: ${count} vault-history checks (fake GitHub only). No real GitHub writes.`);
