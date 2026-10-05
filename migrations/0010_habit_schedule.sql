-- 퀵 기록: 반복 주기 + 클릭 시각
-- ALTER TABLE 두 줄은 운영 D1 콘솔에서 각각 따로 실행한다.
ALTER TABLE habit_buttons ADD COLUMN repeat_type TEXT NOT NULL DEFAULT 'daily';
ALTER TABLE habit_buttons ADD COLUMN repeat_days TEXT NOT NULL DEFAULT '1,2,3,4,5';

CREATE TABLE IF NOT EXISTS habit_taps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  button_id   INTEGER NOT NULL REFERENCES habit_buttons(id),
  user_email  TEXT NOT NULL,
  date        TEXT NOT NULL,
  tapped_time TEXT NOT NULL,                 -- KST HH:MM
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_habit_taps_user_date
  ON habit_taps(user_email, date, button_id);

