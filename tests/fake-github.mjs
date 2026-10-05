// 로컬 검증용 가짜 GitHub API — 실제 ME 저장소에는 아무것도 쓰지 않는다
// 실행: node tests/fake-github.mjs  (기본 포트 18799, FAKE_GITHUB_PORT 로 변경)
import http from 'node:http';
import crypto from 'node:crypto';

const files = new Map();
const log = [];
let failNext = null;

const blobSha = (content) => crypto.createHash('sha1').update(content).digest('hex');
const headSha = () => {
  const h = crypto.createHash('sha1');
  for (const [path, value] of [...files.entries()].sort(([a],[b]) => a.localeCompare(b))) h.update(path+'\0'+value.sha+'\0');
  return h.digest('hex');
};
const putText = (path, text, message='seed') => {
  const content = Buffer.from(String(text), 'utf8').toString('base64');
  files.set(path, { sha: blobSha(content), content, message });
};

http.createServer((req, res) => {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => {
    const send = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    const u = new URL(req.url, 'http://x');

    if (u.pathname === '/__state') return send(200, { files: Object.fromEntries([...files].map(([k, v]) => [k, Buffer.from(v.content, 'base64').toString('utf8')])), log });
    if (u.pathname === '/__fail') { failNext = Number(u.searchParams.get('status')); return send(200, { ok: true }); }
    if (u.pathname === '/__reset') { files.clear(); log.length = 0; failNext = null; return send(200, { ok: true }); }
    if (u.pathname === '/__seed' && req.method === 'POST') {
      const seeded = JSON.parse(body || '{}').files || {};
      for (const [path, text] of Object.entries(seeded)) putText(path, text);
      return send(200, { ok: true, files: Object.keys(seeded).length, sha: headSha() });
    }

    const commit = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/commits\/main$/);
    if (commit) return send(200, { sha: headSha() });

    const tree = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/git\/trees\/([^/]+)$/);
    if (tree) {
      return send(200, {
        sha: tree[2],
        truncated: false,
        tree: [...files.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([path, value]) => ({
          path, mode: '100644', type: 'blob', sha: value.sha,
          size: Buffer.from(value.content, 'base64').length,
        })),
      });
    }

    const m = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/);
    if (!m) return send(404, { message: 'Not Found' });
    const path = decodeURIComponent(m[2]);
    log.push({ method: req.method, repo: m[1], path, auth: req.headers.authorization ? 'set' : 'none' });

    if (req.method === 'PUT' && failNext) {
      const s = failNext; failNext = null;
      return send(s, { message: 'Resource not accessible by personal access token', status: String(s) });
    }

    if (req.method === 'GET') {
      const current = files.get(path);
      if (current) return send(200, {
        name: path.slice(path.lastIndexOf('/') + 1), path, sha: current.sha,
        size: Buffer.from(current.content, 'base64').length,
        content: current.content.replace(/(.{60})/g, '$1\n'),
      });
      const prefix = path.replace(/\/+$/, '') + '/';
      const children = [...files.entries()].flatMap(([childPath, value]) => {
        if (!childPath.startsWith(prefix)) return [];
        const rest = childPath.slice(prefix.length);
        if (!rest || rest.includes('/')) return [];
        return [{
          name: rest, path: childPath, type: 'file', sha: value.sha,
          size: Buffer.from(value.content, 'base64').length,
        }];
      });
      return children.length ? send(200, children) : send(404, { message: 'Not Found' });
    }

    if (req.method === 'PUT') {
      const b = JSON.parse(body);
      const cur = files.get(path);
      if (cur && b.sha !== cur.sha) return send(409, { message: 'sha mismatch' });
      if (!cur && b.sha) return send(422, { message: 'sha given for new file' });
      const sha = blobSha(b.content);
      files.set(path, { sha, content: b.content, message: b.message });
      log[log.length - 1].message = b.message;
      return send(cur ? 200 : 201, { content: { path, sha } });
    }
    send(405, {});
  });
}).listen(Number(process.env.FAKE_GITHUB_PORT || 18799), () => console.log('fake github on', process.env.FAKE_GITHUB_PORT || 18799));
