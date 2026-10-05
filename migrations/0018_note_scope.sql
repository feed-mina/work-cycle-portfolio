-- 0018: 회의록·회의 메모에 회사/개인 범위(scope) 추가.
-- 개인용(사용 화면 = 개인용)에서 만든/가져온 것은 scope='personal' + created_by=본인으로 저장되어
-- 회사 목록·읽음 집계(read_count)와 섞이지 않는다. 기존 행은 전부 'company'(기본값)로 남는다.
--
-- 운영 D1 콘솔에서는 블록을 나눠 실행한다 (docs/DEPLOY.md):
--   블록 A(재실행 불가, 한 줄씩) → 블록 C(기록 보정). `duplicate column`이면 이미 적용된 것.

-- 블록 A-1
ALTER TABLE meetings ADD COLUMN scope TEXT NOT NULL DEFAULT 'company';

-- 블록 A-2
ALTER TABLE meeting_notes ADD COLUMN scope TEXT NOT NULL DEFAULT 'company';

-- 블록 C (콘솔 적용 시에만; wrangler d1 migrations apply 는 스스로 기록한다)
-- INSERT INTO d1_migrations (name) SELECT '0018_note_scope.sql'
--   WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name='0018_note_scope.sql');
