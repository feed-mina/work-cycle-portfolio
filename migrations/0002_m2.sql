-- M2: harness 이관 기능에 필요한 컬럼 보강
ALTER TABLE meetings ADD COLUMN link TEXT;              -- link_only 모드: 원문 위치(클로바노트/드라이브 URL)
ALTER TABLE meetings ADD COLUMN created_by TEXT;
ALTER TABLE kanban_cards ADD COLUMN due TEXT;           -- 마감 표시용 (자유 텍스트: "~8/21")
ALTER TABLE kanban_cards ADD COLUMN color TEXT DEFAULT '#579BFC';
ALTER TABLE schedules ADD COLUMN created_by TEXT;
