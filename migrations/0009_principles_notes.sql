-- ── 요구사항 한 줄 확인 (일정) ────────────────────────────────
ALTER TABLE schedules ADD COLUMN confirm_line TEXT;
ALTER TABLE schedules ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0;

-- ── 회의 중 실시간 메모 (트리형 + 액션아이템) ─────────────────
CREATE TABLE IF NOT EXISTS meeting_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email  TEXT NOT NULL,
  date        TEXT NOT NULL,                 -- YYYY-MM-DD
  title       TEXT NOT NULL DEFAULT '',
  purpose     TEXT NOT NULL DEFAULT '',      -- 이 회의로 무엇을 정하려는가
  attendees   TEXT NOT NULL DEFAULT '',
  outline     TEXT NOT NULL DEFAULT '[]',    -- JSON [{d,m,t,who,due}]
  meeting_id  INTEGER,                       -- 회의록으로 확정하면 연결
  schedule_id INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_user_date ON meeting_notes(user_email, date);

-- ── AI 작업 원칙 체크리스트 항목 추가 (멱등) ──────────────────
INSERT INTO checklist_items (section, text, sort)
  SELECT '하루 시작', '보존할 기존 기능과 건드리지 않을 범위를 먼저 적어 걸렀다', 5
  WHERE NOT EXISTS (SELECT 1 FROM checklist_items WHERE text='보존할 기존 기능과 건드리지 않을 범위를 먼저 적어 걸렀다');
INSERT INTO checklist_items (section, text, sort)
  SELECT 'AI 사용', 'AI에게 맡기기 전에 예외·제외 대상을 먼저 정리했다', 24
  WHERE NOT EXISTS (SELECT 1 FROM checklist_items WHERE text='AI에게 맡기기 전에 예외·제외 대상을 먼저 정리했다');
INSERT INTO checklist_items (section, text, sort)
  SELECT '제출 전', '패키징·배포 전에 실제 브라우저에서 화면을 열어 확인했다', 35
  WHERE NOT EXISTS (SELECT 1 FROM checklist_items WHERE text='패키징·배포 전에 실제 브라우저에서 화면을 열어 확인했다');
INSERT INTO checklist_items (section, text, sort)
  SELECT '제출 전', '부품(컴포넌트)을 하나씩 따로 확인했다 — 전체만 보고 넘기지 않았다', 36
  WHERE NOT EXISTS (SELECT 1 FROM checklist_items WHERE text='부품(컴포넌트)을 하나씩 따로 확인했다 — 전체만 보고 넘기지 않았다');
