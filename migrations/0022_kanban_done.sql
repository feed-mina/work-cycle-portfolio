-- 0022: 칸반 카드 완료 표시 — kanban_cards.done_at (완료 시각, NULL = 진행 중).
-- 완료한 카드는 사분면에서 빠지고 칸반 아래 '완료한 카드'에 모인다. 되돌리면 NULL 로 돌아가 원래 사분면에 다시 보인다.
-- GitHub 이슈는 닫지 않는다(사이트 안에서만 완료 표시, 2026-10-02 사용자 결정).
--
-- 운영 D1 콘솔에서는 블록을 나눠 실행한다 (docs/DEPLOY.md):
--   블록 A(재실행 불가) → 블록 C(기록 보정). `duplicate column`이면 이미 적용된 것.

-- 블록 A
ALTER TABLE kanban_cards ADD COLUMN done_at TEXT;

-- 블록 C (콘솔 적용 시에만)
-- INSERT INTO d1_migrations (name) SELECT '0022_kanban_done.sql'
--   WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name='0022_kanban_done.sql');
