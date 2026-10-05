-- 0007: 일정 완료 여부 — 태그를 먼저 등록해두고 나중에 완료 처리
ALTER TABLE schedules ADD COLUMN status TEXT NOT NULL DEFAULT '미완료';  -- 미완료 | 완료
