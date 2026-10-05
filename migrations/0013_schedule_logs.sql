CREATE TABLE IF NOT EXISTS schedule_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  logged_date TEXT NOT NULL,
  logged_time TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_schedule_logs_schedule
  ON schedule_logs(schedule_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_schedule_logs_user_date
  ON schedule_logs(user_email, logged_date, id DESC);
