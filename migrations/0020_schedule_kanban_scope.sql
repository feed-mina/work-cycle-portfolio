-- 0020: 일정·칸반 카드에 회사/개인 범위(scope) 추가 — 회의록(0018)과 같은 방식.
-- 개인용(사용 화면 = 개인용)에서 만든 일정·카드는 scope='personal' 로 저장되어 회사 화면·집계에 섞이지 않는다.
-- 기존 행은 전부 'company'(기본값)로 남는다. 주간업무보고는 회사 표만 읽으므로 영향 없음.
--
-- 운영 D1 콘솔에서는 블록을 나눠 실행한다 (docs/DEPLOY.md):
--   블록 A(재실행 불가, 한 줄씩) → 블록 C(기록 보정). `duplicate column`이면 이미 적용된 것.

-- 블록 A-1
ALTER TABLE schedules ADD COLUMN scope TEXT NOT NULL DEFAULT 'company';

-- 블록 A-2
ALTER TABLE kanban_cards ADD COLUMN scope TEXT NOT NULL DEFAULT 'company';

-- 블록 C (콘솔 적용 시에만)
-- INSERT INTO d1_migrations (name) SELECT '0020_schedule_kanban_scope.sql'
--   WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name='0020_schedule_kanban_scope.sql');
