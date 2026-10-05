/** Explicit personal-only archival. Never auto-exports company meetings or mutates source rows. */
import { Hono } from 'hono';
import type { Env, Vars } from './shared';
import { noteScope } from './shared';
import { htmlToText } from './vault-reader';
const app = new Hono<{ Bindings: Env; Variables: Vars }>();
type Meeting = { id: number; date: string; title: string; body_mode: string; body_md: string | null; link: string | null };
type ExportRow = { repo: string; path: string; content_hash: string | null; remote_sha: string | null; commit_sha: string | null; exported_at: string | null; status: string; error: string | null };
export function meetingHistoryPath(dir: string, m: Meeting): string {
  return `${dir}/meetings/${m.date.slice(0,4)}/${m.date.slice(5,7)}/${m.date}_work-cycle-meeting-${m.id}.md`;
}
export function meetingHistoryMarkdown(m: Meeting): string {
  const body = m.body_mode === 'link_only' ? '' : m.body_mode === 'full_html' ? htmlToText(m.body_md || '') : m.body_md || '';
  return ['---', 'source_app: work-cycle', `source_meeting_id: ${m.id}`, `meeting_date: ${JSON.stringify(m.date)}`, `title: ${JSON.stringify(m.title)}`, 'scope: personal', `body_mode: ${JSON.stringify(m.body_mode)}`, '---', '', `# ${m.title.replace(/[\r\n]/g, ' ')}`, '', `회의 날짜: ${m.date}`, '', '## 저장된 회의록', body || '(본문 없음: 원본 링크만 저장됨)', '', '## 원본 링크', m.link || '(없음)', '', '> 저장된 본문을 보관합니다. 원문 녹취나 별도 확정본이 보존되어 있다는 뜻은 아닙니다.', ''].join('\n');
}
async function hash(s: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), b => b.toString(16).padStart(2,'0')).join(''); }
function base64(s: string) { return btoa(Array.from(new TextEncoder().encode(s), b => String.fromCharCode(b)).join('')); }
function decode(s: string) { return new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g,'')), c => c.charCodeAt(0))); }
function config(env: Env) {
  const dir = (env.VAULT_HISTORY_DIR || 'history').replace(/^\/+|\/+$/g,'');
  const repo = env.VAULT_REPO || 'feed-mina/ME';
  const token = env.GITHUB_TOKEN_VAULT || env.GITHUB_TOKEN || '';
  const reason = !(env.VAULT_HISTORY_EMAIL || '').trim() ? '보관 계정이 설정되지 않았습니다' : !token ? 'GitHub 보관 토큰이 설정되지 않았습니다' : !/^[\w.-]+\/[\w.-]+$/.test(repo) || !dir || dir.split('/').some(p => p === '..' || p === '.') ? '보관 경로 설정이 올바르지 않습니다' : '';
  return {dir,repo,token,reason};
}
async function ready(db: D1Database) { return !!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meeting_history_exports'").first(); }
async function own(c: any): Promise<Meeting | null> {
  if (await noteScope(c) !== 'personal') return null;
  return c.env.DB.prepare("SELECT * FROM meetings WHERE id=?1 AND scope='personal' AND lower(created_by)=?2").bind(c.req.param('id'), c.get('email').toLowerCase()).first();
}
app.get('/api/meeting-history/:id', async c => {
  const m = await own(c); if (!m) return c.json({error:'개인 회의록을 찾을 수 없습니다'},404);
  const cfg = config(c.env), mine = c.get('email').toLowerCase() === (c.env.VAULT_HISTORY_EMAIL || '').trim().toLowerCase();
  if (!mine) return c.json({available:false,reason:'보관 계정만 사용할 수 있습니다',status:'unavailable'});
  if (!await ready(c.env.DB)) return c.json({available:false,reason:'마이그레이션 0025 적용이 필요합니다',status:'unavailable'});
  const row = await c.env.DB.prepare('SELECT * FROM meeting_history_exports WHERE meeting_id=?1').bind(m.id).first<ExportRow>();
  const attempts = await c.env.DB.prepare('SELECT status,path,commit_sha,created_at FROM meeting_history_attempts WHERE meeting_id=?1 ORDER BY id DESC LIMIT 20').bind(m.id).all();
  const changed = !!row?.content_hash && row.content_hash !== await hash(meetingHistoryMarkdown(m));
  return c.json({available:!cfg.reason,reason:cfg.reason || null,status:row?.status || 'not_exported',changed_since_export:changed,path:row?.path || null,exported_at:row?.exported_at || null,commit_sha:row?.commit_sha || null,error:row?.error || null,attempts:attempts.results});
});
app.post('/api/meeting-history/:id/export', async c => {
  const origin = c.req.header('Origin');
  if (origin && origin !== new URL(c.req.url).origin) return c.json({error:'다른 사이트에서 보관을 요청할 수 없습니다'},403);
  const m = await own(c); if (!m) return c.json({error:'개인 회의록을 찾을 수 없습니다'},404);
  if(c.get('email').toLowerCase() !== (c.env.VAULT_HISTORY_EMAIL || '').trim().toLowerCase()) return c.json({error:'보관 계정만 사용할 수 있습니다'},403);
  const cfg = config(c.env); if(cfg.reason) return c.json({error:cfg.reason},400);
  if (!await ready(c.env.DB)) return c.json({error:'마이그레이션 0025 적용이 필요합니다'},503);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date) || !Number.isFinite(Date.parse(m.date)) || new Date(m.date).toISOString().slice(0,10) !== m.date) return c.json({error:'회의 날짜가 올바르지 않습니다'},400);
  await c.env.DB.prepare('INSERT INTO meeting_history_exports(meeting_id,repo,path) VALUES(?1,?2,?3) ON CONFLICT DO NOTHING').bind(m.id,cfg.repo,meetingHistoryPath(cfg.dir,m)).run();
  const row = (await c.env.DB.prepare('SELECT * FROM meeting_history_exports WHERE meeting_id=?1').bind(m.id).first<ExportRow>())!;
  if(row.repo !== cfg.repo) return c.json({error:'보관 저장소 설정이 바뀌었습니다. 기존 연결을 확인하세요'},409);
  const lease = Date.now()+120000;
  const lock = await c.env.DB.prepare('UPDATE meeting_history_exports SET lock_until=?1 WHERE meeting_id=?2 AND lock_until<?3').bind(lease,m.id,Date.now()).run();
  if(!lock.meta.changes) return c.json({error:'이미 보관 중입니다. 잠시 후 다시 확인하세요'},409);
  const md = meetingHistoryMarkdown(m), contentHash = await hash(md);
  const headers = {Authorization:`Bearer ${cfg.token}`,Accept:'application/vnd.github+json','User-Agent':'work-cycle','Content-Type':'application/json'};
  const url = `${c.env.GITHUB_API_BASE || 'https://api.github.com'}/repos/${cfg.repo}/contents/${row.path.split('/').map(encodeURIComponent).join('/')}?ref=main`;
  let status = 'failed', commit: string | null = null;
  try {
    const current = await fetch(url,{headers});
    if(!current.ok && current.status !== 404) throw new Error(`GitHub 조회 실패 (${current.status}) ${(await current.text()).slice(0,400)}`);
    let remote: any = null, remoteHash: string | null = null;
    if(current.ok) { remote = await current.json(); if(remote.encoding !== 'base64' && remote.encoding) throw new Error('GitHub 본문 인코딩을 확인할 수 없습니다'); if(!remote.content) throw new Error('GitHub 본문을 확인할 수 없습니다'); remoteHash = await hash(decode(remote.content)); }
    if(remote && remoteHash !== contentHash && (!row.content_hash || remoteHash !== row.content_hash)) { status='conflict'; throw new Error('GitHub에서 수정된 본문이 있습니다. 덮어쓰지 않았습니다'); }
    if(!remote && row.remote_sha) { status='conflict'; throw new Error('GitHub 파일이 삭제되었습니다. 확인 후 다시 연결하세요'); }
    if(remoteHash === contentHash) status='unchanged';
    else {
      const put = await fetch(url.split('?')[0],{method:'PUT',headers,body:JSON.stringify({message:`work-cycle: 개인 회의록 ${m.id} 보관`,branch:'main',content:base64(md),...(remote ? {sha:remote.sha} : {})})});
      if(!put.ok) { if(put.status === 409 || put.status === 422) status='conflict'; throw new Error(`GitHub 보관 실패 (${put.status}) ${(await put.text()).slice(0,400)}`); }
      const saved: any = await put.json(); remote=saved.content; commit=saved.commit?.sha || null; status='uploaded';
    }
    await c.env.DB.prepare("UPDATE meeting_history_exports SET content_hash=?1,remote_sha=?2,commit_sha=COALESCE(?3,commit_sha),exported_at=datetime('now'),status=?4,error=NULL WHERE meeting_id=?5").bind(contentHash,remote.sha,commit,status,m.id).run();
    return c.json({ok:true,status,path:row.path,commit_sha:commit || row.commit_sha});
  } catch(e) {
    const error = (e instanceof Error ? e.message : String(e)).split(cfg.token).join('[redacted]').slice(0,500);
    await c.env.DB.prepare('UPDATE meeting_history_exports SET status=?1,error=?2 WHERE meeting_id=?3').bind(status,error,m.id).run();
    return c.json({error,status,path:row.path},status === 'conflict' ? 409 : 502);
  } finally {
    try {
      await c.env.DB.prepare('INSERT INTO meeting_history_attempts(meeting_id,status,path,commit_sha) VALUES(?1,?2,?3,?4)').bind(m.id,status,row.path,commit).run();
    } catch {
      // A successful remote write cannot be rolled back by an audit failure. Do not expose source/token details.
      console.error('meeting_history_audit_failed');
    } finally {
      try {
        await c.env.DB.prepare('UPDATE meeting_history_exports SET lock_until=0 WHERE meeting_id=?1 AND lock_until=?2').bind(m.id,lease).run();
      } catch { console.error('meeting_history_lock_release_failed'); }
    }
  }
});
export default app;
