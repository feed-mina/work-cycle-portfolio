-- 체크리스트 항목별 메모: 체크 해제와 독립적으로 사용자·날짜별 메모를 보존한다.
CREATE TABLE IF NOT EXISTS checklist_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     INTEGER NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  user_email  TEXT NOT NULL,
  cycle_date  TEXT NOT NULL,
  memo        TEXT NOT NULL CHECK (length(memo) BETWEEN 1 AND 1000),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, user_email, cycle_date)
);

CREATE INDEX IF NOT EXISTS idx_checklist_notes_user_date
  ON checklist_notes(user_email, cycle_date, item_id);
