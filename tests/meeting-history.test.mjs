// In-memory SQLite and fake GitHub only; no network requests or real ME writes.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const bundle = execFileSync('node_modules/.bin/esbuild',['src/meeting-history.ts','--bundle','--format=esm','--platform=neutral','--log-level=error'],{encoding:'utf8'});
const {default:routes} = await import('data:text/javascript;base64,'+Buffer.from(bundle).toString('base64'));
const db = new DatabaseSync(':memory:');
db.exec("CREATE TABLE personal_settings(user_email TEXT PRIMARY KEY,view_mode TEXT); CREATE TABLE meetings(id INTEGER PRIMARY KEY,date TEXT,title TEXT,body_mode TEXT,body_md TEXT,link TEXT,scope TEXT,created_by TEXT);");
// personalSettings reads schema below, defaults on absence; explicit personal mode needed.

const schema = readFileSync('migrations/0016_personal_mode.sql','utf8');
// Recreate personal_settings exactly as application expects.
db.exec('DROP TABLE personal_settings');
db.exec(schema);
db.exec("INSERT INTO personal_settings(user_email,view_mode) VALUES('owner@example.test','personal'),('other@example.test','personal'); INSERT INTO meetings VALUES(1,'2026-10-03','개인 회의','full_md','요약 본문','https://example.test','personal','owner@example.test'),(2,'2026-10-03','회사 회의','full_md','회사 비밀',NULL,'company','owner@example.test'),(3,'2026-10-03','남의 회의','full_md','남의 비밀',NULL,'personal','other@example.test');");
let failAudit = false;
const DB={prepare(sql){return {bind(...args){this.args=args;return this},async first(){return db.prepare(sql).get(...(this.args||[]))||null},async all(){return {results:db.prepare(sql).all(...(this.args||[]))}},async run(){if(failAudit && sql.startsWith('INSERT INTO meeting_history_attempts')) throw new Error('injected audit failure');return {meta:db.prepare(sql).run(...(this.args||[]))}}}}};
const env={DB,VAULT_HISTORY_EMAIL:'OWNER@example.test',GITHUB_TOKEN_VAULT:'fake-token'};
const {Hono} = await import('hono'); const app=new Hono(); app.use('*',async(c,next)=>{c.set('email',c.req.header('user')||'owner@example.test');await next()}); app.route('/',routes);
let files = new Map(), puts=0, fail=false; const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,opts)=>{ assert(String(url).startsWith('https://api.github.com/repos/feed-mina/ME/contents/history/meetings/')); const path=new URL(url).pathname;const cur=files.get(path); if(opts.method==='PUT'){puts++;if(fail)return Response.json({message:'fake failure'},{status:500}); const b=JSON.parse(opts.body);if(cur && b.sha!==cur.sha)return Response.json({}, {status:409});const entry={content:b.content,sha:'sha-'+puts,encoding:'base64'};files.set(path,entry);return Response.json({content:entry,commit:{sha:'commit-'+puts}})} return cur?Response.json(cur):Response.json({}, {status:404})};
async function call(id=1,method='GET',expected=200,user='owner@example.test',origin){const r=await app.request('http://localhost/api/meeting-history/'+id+(method==='POST'?'/export':''),{method,headers:{user,...(origin?{Origin:origin}:{})}},env);const b=await r.json();assert.equal(r.status,expected,JSON.stringify(b));return b}
try {
 assert.equal((await call()).available,false,'missing migration disables export'); await call(1,'POST',503);
 db.exec(readFileSync('migrations/0025_meeting_history.sql','utf8'));
 assert.equal((await call()).available,true);
 await call(2,'POST',404);await call(3,'POST',404);await call(1,'POST',404,'other@example.test');await call(1,'POST',403,'owner@example.test','https://evil.test');
 assert.equal((await call(1,'POST')).status,'uploaded');assert.equal((await call(1,'POST')).status,'unchanged');assert.equal(puts,1);
 const path=[...files.keys()][0];assert(path.endsWith('2026-10-03_work-cycle-meeting-1.md'));
 db.exec("UPDATE meetings SET title='수정',date='2026-10-04',body_md='수정된 요약' WHERE id=1");
 assert.equal((await call(1,'POST')).status,'uploaded');assert.equal(files.size,1,'date/title edits retain path');
 const current=files.get(path);files.set(path,{...current,content:Buffer.from('GitHub에서 직접 수정').toString('base64'),sha:'manual'});
 await call(1,'POST',409);assert.equal(puts,2,'remote edits not overwritten');
 files.set(path,current);fail=true;db.exec("UPDATE meetings SET body_md='실패 확인' WHERE id=1");await call(1,'POST',502);
 assert.equal(db.prepare('SELECT body_md FROM meetings WHERE id=1').get().body_md,'실패 확인','source survives failure');
 assert.equal((await call()).status,'failed');assert.equal((await call()).attempts.length,5);
 fail=false;failAudit=true;
 assert.equal((await call(1,'POST')).status,'uploaded','audit failure preserves successful response');
 assert.equal(db.prepare('SELECT lock_until FROM meeting_history_exports WHERE meeting_id=1').get().lock_until,0,'audit failure still releases lease');
 assert.equal((await call(1,'POST')).status,'unchanged','next request can proceed');
 console.log('PASS: audit failure releases lock; owner/scope, missing migration, origin, upload, no-op, stable path, remote conflict, failure isolation, audit');
} finally {globalThis.fetch=originalFetch;db.close()}
