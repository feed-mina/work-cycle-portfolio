-- 개인 회의록의 앱 저장과 GitHub 보관 상태를 분리한다. 기존 회의록은 수정하지 않는다.
CREATE TABLE IF NOT EXISTS meeting_history_exports (
  meeting_id INTEGER PRIMARY KEY REFERENCES meetings(id),
  repo TEXT NOT NULL,
  path TEXT NOT NULL,
  content_hash TEXT,
  remote_sha TEXT,
  commit_sha TEXT,
  exported_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  lock_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS meeting_history_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id),
  status TEXT NOT NULL,
  path TEXT NOT NULL,
  commit_sha TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS meeting_history_attempts_meeting ON meeting_history_attempts(meeting_id, id DESC);
