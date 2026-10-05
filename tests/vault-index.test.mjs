// 개인용 ME docs + 01-History 하위 폴더 문서 묶음 인덱스 검사. 실제 GitHub에는 접근하지 않는다.
// 준비:
//   node tests/fake-github.mjs
//   npx wrangler dev --local --port 18788 --var GITHUB_API_BASE:http://127.0.0.1:18799 --var GITHUB_TOKEN_VAULT:fake-token
// 실행: TEST_BASE_URL=http://127.0.0.1:18788 node tests/vault-index.test.mjs
import assert from 'node:assert/strict';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:18788';
const gh = process.env.FAKE_GITHUB_URL || 'http://127.0.0.1:18799';
for (const u of [base, gh]) if (!['127.0.0.1', 'localhost'].includes(new URL(u).hostname)) throw new Error('Local test environment only');

const USER = `vault-index-${Date.now()}@example.test`;
let count = 0;
async function call(path, { method='GET', body, status=200 } = {}) {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type':'application/json', 'Cf-Access-Authenticated-User-Email': USER },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let d; try { d = JSON.parse(text); } catch { d = text; }
  assert.equal(r.status, status, `${method} ${path}: ${text}`);
  count++;
  return d;
}

await fetch(gh + '/__reset');
const seeded = {
  'docs/2026-10-01/interview-portfolio-5/README.md': '# Interview Portfolio\n대표 문서',
  'docs/2026-10-01/interview-portfolio-5/fix-guide.html': '<html><body><h1>Fix Guide</h1><script>alert(1)</script></body></html>',
  'docs/2026-10-01/interview-portfolio-5/assets/detail.md': '# Nested Detail',
  'docs/2026-10-02/no-readme/easy-guide.md': '# Easy Guide',
  'docs/2026-10-02/no-readme/fix-guide.html': '<h1>Fix without README</h1>',
  'docs/2026-10-02/no-readme/assets/README.md': '# Asset README should not become representative',
  'docs/mobile-meeting-update/README.md': '# Mobile Meeting',
  'docs/2026-10-03/direct.md': '# Direct doc',
  '01-History/2026-10-04-note.md': '# Normal personal note',
  '01-History/2026-10-04_디밀리언_면접_포트폴리오_개선/README.md': '# Dmillion Portfolio',
  '01-History/2026-10-04_디밀리언_면접_포트폴리오_개선/dmillion-plan.html': '<h1>Dmillion Plan</h1>',
  '01-History/2026-10-04_디밀리언_면접_포트폴리오_개선/archive/v1.md': '# Archived V1',
};
const seedRes = await fetch(gh + '/__seed', {
  method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({files:seeded})
});
assert.equal(seedRes.status, 200);

await call('/api/personal/settings', { method:'PUT', body:{ view_mode:'personal' } });
const index = await call('/api/vault/index?folder=docs&since=');
assert(Array.isArray(index.collections), 'collections array');
assert.equal(index.rows.length, 0, 'docs are grouped, not duplicated in flat rows');
const docsFolder = index.folders.find((f) => f.folder === 'docs');
assert(docsFolder && docsFolder.files === 8 && docsFolder.collection_count === 4, 'docs folder reports files + collections');

const portfolio = index.collections.find((c) => c.root === 'docs/2026-10-01/interview-portfolio-5');
assert(portfolio, 'dated report collection exists');
assert.equal(portfolio.count, 3);
assert.equal(portfolio.representative.name, 'README.md', 'README.md is representative');
assert(portfolio.files.some((f) => f.path.endsWith('/assets/detail.md')), 'nested docs remain in same collection');

const noReadme = index.collections.find((c) => c.root === 'docs/2026-10-02/no-readme');
assert(noReadme, 'collection without README exists');
assert.equal(noReadme.representative.name, 'easy-guide.md', 'root markdown beats nested assets/README when root README is absent');

const noDate = index.collections.find((c) => c.root === 'docs/mobile-meeting-update');
assert(noDate && noDate.representative.name === 'README.md', 'undated docs collection appears when docs folder is selected');

const direct = index.collections.find((c) => c.root === 'docs/2026-10-03');
assert(direct && direct.name === '2026-10-03', 'files directly below dated docs folder are grouped');

const history = await call('/api/vault/index?folder=01-History&since=');
assert.equal(history.collections.length, 1, '01-History child folder is grouped');
assert.equal(history.rows.length, 1, '01-History root file stays flat');
assert.equal(history.rows[0].path, '01-History/2026-10-04-note.md');
const dmillion = history.collections[0];
assert.equal(dmillion.root, '01-History/2026-10-04_디밀리언_면접_포트폴리오_개선');
assert.equal(dmillion.representative.name, 'README.md', '01-History collection also prioritizes README');
assert.equal(dmillion.count, 3, 'nested archive file remains inside the same history collection');
assert(dmillion.files.some((f) => f.path.endsWith('/archive/v1.md')), 'history nested document is individually available');
const historyFolder = history.folders.find((f) => f.folder === '01-History');
assert(historyFolder && historyFolder.collection_count === 1 && historyFolder.flat_count === 1, '01-History reports collection + flat root note separately');

const historySearch = await call('/api/vault/index?folder=01-History&since=&q=dmillion-plan');
assert.equal(historySearch.collections.length, 1, 'history child-file search returns the whole collection');
assert.equal(historySearch.collections[0].representative.name, 'README.md', 'history search keeps README representative');

const searched = await call('/api/vault/index?folder=docs&since=&q=fix-guide');
assert.equal(searched.collections.length, 2, 'search matches collections through child files');
assert(searched.collections.find((c) => c.root === portfolio.root).files.some((f) => f.name === 'README.md'), 'search preserves full collection and README representative');

const preview = await fetch(base + '/api/vault/file?path=' + encodeURIComponent('docs/2026-10-01/interview-portfolio-5/fix-guide.html'), {
  headers:{'Cf-Access-Authenticated-User-Email':USER},
});
assert.equal(preview.status, 200); count++;
const previewText = await preview.text();
// 기본은 원본 html 그대로 (인라인 script 유지) + CSP sandbox 로 격리. 목록의 미리보기 iframe(frame-ancestors 'self')에도 담긴다.
assert(previewText.includes('Fix Guide') && previewText.includes('<script>alert(1)</script>'), 'individual HTML opens as original (scripts kept)');
const previewCsp = preview.headers.get('content-security-policy') || '';
assert(/\bsandbox allow-scripts\b/.test(previewCsp) && /connect-src 'none'/.test(previewCsp) && /frame-ancestors 'self'/.test(previewCsp), `original html is served under sandbox CSP: ${previewCsp}`);
assert(!/frame-ancestors 'none'/.test(previewCsp), 'preview iframe is not blocked');

const safePreview = await fetch(base + '/api/vault/file?path=' + encodeURIComponent('docs/2026-10-01/interview-portfolio-5/fix-guide.html') + '&safe=1', {
  headers:{'Cf-Access-Authenticated-User-Email':USER},
});
assert.equal(safePreview.status, 200); count++;
const safeText = await safePreview.text();
assert(safeText.includes('Fix Guide') && !safeText.includes('<script'), '?safe=1 still gives the sanitized preview');
const safeCsp = safePreview.headers.get('content-security-policy') || '';
assert(!/script-src/.test(safeCsp) && /frame-ancestors 'self'/.test(safeCsp), `sanitized preview keeps scripts blocked: ${safeCsp}`);

const mdPreview = await fetch(base + '/api/vault/file?path=' + encodeURIComponent('docs/2026-10-01/interview-portfolio-5/README.md'), {
  headers:{'Cf-Access-Authenticated-User-Email':USER},
});
assert.equal(mdPreview.status, 200); count++;
assert((await mdPreview.text()).includes('Interview Portfolio'), 'md renders to readable html');
assert(/frame-ancestors 'self'/.test(mdPreview.headers.get('content-security-policy') || '') && !/script-src/.test(mdPreview.headers.get('content-security-policy') || ''), 'md preview: no scripts, embeddable in same-origin iframe');

const imported = await call('/api/vault/import', {
  method:'POST',
  body:{ path:portfolio.representative.path, date:portfolio.date },
});
assert.equal(imported.ok, true);
const after = await call('/api/vault/index?folder=docs&since=');
const afterPortfolio = after.collections.find((c) => c.root === portfolio.root);
assert.equal(afterPortfolio.representative.imported, true, 'representative import is reflected on collection');

await call('/api/personal/settings', { method:'PUT', body:{ view_mode:'company' } });
await call('/api/vault/index?folder=docs&since=', { status:400 });

console.log(`PASS: ${count} vault-index checks. docs + 01-History collections, README priority, flat root notes, individual preview, import status. No real GitHub calls.`);
