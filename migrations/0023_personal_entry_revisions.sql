-- 0023: 실행 계획·하루 회고 저장 이력 — 저장할 때마다 그때 내용을 한 줄씩 쌓는다 (2026-10-02 사용자 요청).
-- 화면용 personal_plans / personal_retros 는 지금처럼 하루 1행 덮어쓰기. 이 표는 하루 기록 md 의 '저장 이력'에만 쓴다.
-- kind: 'plan' | 'retro'. fields: 그때 저장한 칸들(JSON). saved_at: UTC datetime('now').
-- 배포 전 덮어써진 내용은 되살릴 수 없다 — 이 표가 생긴 뒤 저장부터 쌓인다(그날 첫 저장 때 직전 내용을 한 번 옮겨 둔다).
--
-- 운영 D1 콘솔: 전체를 그대로 실행해도 된다(IF NOT EXISTS, 재실행 가능) → 마지막 블록 C 로 기록 보정.

CREATE TABLE IF NOT EXISTS personal_entry_revisions(
  id INTEGER PRIMARY KEY,
  user_email TEXT NOT NULL,
  cycle_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('plan','retro')),
  ui_version TEXT NOT NULL,
  fields TEXT NOT NULL,
  saved_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS personal_entry_revisions_day ON personal_entry_revisions(user_email, cycle_date, kind, id);

-- 블록 C (콘솔 적용 시에만)
-- INSERT INTO d1_migrations (name) SELECT '0023_personal_entry_revisions.sql'
--   WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name='0023_personal_entry_revisions.sql');
