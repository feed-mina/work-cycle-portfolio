# 개인 보드 날짜 계약 및 개인 오늘 화면 정리

- `/api/personal/board`가 `date=YYYY-MM-DD`를 검증하고 해당 날짜의 personal_* 기록으로 6단계를 계산한다.
- 개인 오늘 화면에서 사용하지 않는 “오늘 할 일과 집중 시간” 카드만 제거했다.
- `personal_tasks`, `personal_focus`, 관련 API와 `/personal-dashboard`의 조회·수정 기능은 보존했다.
- 카드가 없는 개인 오늘 화면에서는 관련 dashboard 집계 GET을 생략해 불필요한 D1 읽기를 줄였다.

## 검증

- TypeScript `--noEmit` PASS.
- `public/personal-ui.js` syntax PASS.
- Worker dry-run PASS.
- 로컬 D1 전체 마이그레이션 기준 114 API checks PASS.
- 다른 날짜 보드 반환 및 잘못된 날짜 400 회귀 검사를 추가했다.
