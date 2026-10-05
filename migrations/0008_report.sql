-- 주간업무보고: 고정 정보 + 주차별 수동 보정값
CREATE TABLE IF NOT EXISTS report_settings (
  user_email TEXT PRIMARY KEY,
  author     TEXT NOT NULL DEFAULT '',
  dept       TEXT NOT NULL DEFAULT '기술연구소',
  role_name  TEXT NOT NULL DEFAULT '연구원',
  prj_code   TEXT NOT NULL DEFAULT '',
  project    TEXT NOT NULL DEFAULT '',
  goal       TEXT NOT NULL DEFAULT ''
);

-- field: 'e:YYYY-MM-DD' | 'f:YYYY-MM-DD' | 'c:YYYY-MM-DD' | 'goal' | 'next'
CREATE TABLE IF NOT EXISTS report_overrides (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  week_start TEXT NOT NULL,
  field      TEXT NOT NULL,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_email, week_start, field)
);
CREATE INDEX IF NOT EXISTS idx_ro_week ON report_overrides(user_email, week_start);
