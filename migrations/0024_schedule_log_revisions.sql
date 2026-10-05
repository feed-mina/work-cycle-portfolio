-- 0024: 업무 메모 수정 이력 — 메모를 [수정]할 때 바뀌기 전 내용을 한 줄씩 쌓는다 (2026-10-02 사용자 요청).
-- 화면은 지금처럼 최신 내용만. 이 표는 하루 기록 md 의 '수정 이력'에만 쓴다.
-- body: 바뀌기 전 내용, written_at: 그 내용이 쓰인 시각(UTC, 메모의 직전 updated_at), replaced_at: 수정한 시각(UTC).
-- 메모(또는 그 일정)를 지우면 이력도 함께 지워진다(ON DELETE CASCADE — D1 은 외래키를 강제한다).
-- 배포 전 수정으로 덮어써진 내용은 되살릴 수 없다 — 이 표가 생긴 뒤 수정부터 쌓인다.
--
-- 운영 D1 콘솔: 전체를 그대로 실행해도 된다(IF NOT EXISTS, 재실행 가능) → 마지막 블록 C 로 기록 보정.

CREATE TABLE IF NOT EXISTS schedule_log_revisions(
  id INTEGER PRIMARY KEY,
  log_id INTEGER NOT NULL REFERENCES schedule_logs(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  body TEXT NOT NULL,
  written_at TEXT NOT NULL,
  replaced_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS schedule_log_revisions_log ON schedule_log_revisions(log_id, id);

-- 블록 C (콘솔 적용 시에만)
-- INSERT INTO d1_migrations (name) SELECT '0024_schedule_log_revisions.sql'
--   WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name='0024_schedule_log_revisions.sql');
