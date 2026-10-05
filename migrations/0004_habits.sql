-- 퀵 기록 (습관 버튼) — harness 이관
CREATE TABLE IF NOT EXISTS habit_buttons (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  name       TEXT NOT NULL,
  emoji      TEXT NOT NULL DEFAULT '🔥',
  goal       INTEGER NOT NULL DEFAULT 1,   -- 하루 목표 횟수
  category   TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS habit_records (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  button_id  INTEGER NOT NULL REFERENCES habit_buttons(id),
  user_email TEXT NOT NULL,
  date       TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 1,
  UNIQUE(button_id, date)
);
