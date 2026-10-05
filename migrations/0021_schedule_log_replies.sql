-- 0021: 업무 메모 대댓글 — schedule_logs.parent_id (같은 일정의 다른 메모에 단 답글, 한 단계만).
-- 기존 행은 NULL(일반 메모). 삭제는 API에서 부모와 답글을 함께 지운다.
--
-- 운영 D1 콘솔에서는 블록을 나눠 실행한다 (docs/DEPLOY.md):
--   블록 A(재실행 불가) → 블록 C(기록 보정). `duplicate column`이면 이미 적용된 것.

-- 블록 A
ALTER TABLE schedule_logs ADD COLUMN parent_id INTEGER REFERENCES schedule_logs(id);

-- 블록 B (재실행 가능)
CREATE INDEX IF NOT EXISTS idx_schedule_logs_parent ON schedule_logs(parent_id);

-- 블록 C (콘솔 적용 시에만)
-- INSERT INTO d1_migrations (name) SELECT '0021_schedule_log_replies.sql'
--   WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name='0021_schedule_log_replies.sql');
