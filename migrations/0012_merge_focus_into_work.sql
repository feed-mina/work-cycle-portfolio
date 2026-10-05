-- 업무와 집중을 하나의 '업무' 유형으로 통합한다.
-- 오래된 기본값 '가능'을 포함해 회의가 아닌 기존 일정도 모두 업무로 정규화한다.
UPDATE schedules
SET block_type='업무'
WHERE block_type <> '회의';
