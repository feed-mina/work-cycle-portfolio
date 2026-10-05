-- 0019: 칸반 "GitHub 이슈 가져오기" 레포 드롭다운용 — 사용자별 레포 목록 캐시 (GET /user/repos, 1시간).
-- CREATE 만 있으므로 재실행해도 안전하다. 운영 D1 콘솔 또는 `wrangler d1 execute --remote --file` 로 적용.
CREATE TABLE IF NOT EXISTS github_repo_cache (
  user_email TEXT PRIMARY KEY,
  body       TEXT NOT NULL,                 -- JSON [{full_name, private, push, updated_at}]
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
