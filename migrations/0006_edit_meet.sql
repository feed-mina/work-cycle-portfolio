-- 0006: 일정 내용·화상회의, 칸반 GitHub 연결, 회의록-일정 묶기
ALTER TABLE schedules ADD COLUMN body TEXT;              -- 일정 상세 내용 (여러 줄)
ALTER TABLE schedules ADD COLUMN meet_url TEXT;          -- 화상회의 참여 링크
ALTER TABLE schedules ADD COLUMN meet_event_id TEXT;     -- Google Calendar 이벤트 id

ALTER TABLE kanban_cards ADD COLUMN gh_repo TEXT;        -- owner/repo
ALTER TABLE kanban_cards ADD COLUMN gh_issue_no INTEGER; -- 이슈 번호
ALTER TABLE kanban_cards ADD COLUMN gh_state TEXT;       -- open | closed

ALTER TABLE meetings ADD COLUMN schedule_id INTEGER;     -- 어느 일정의 회의였는지
