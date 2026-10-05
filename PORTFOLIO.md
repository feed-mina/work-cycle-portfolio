# 로그인 없는 공개 체험

`portfolio/`는 허구 예시만 사용하는 독립 정적 앱입니다. 운영 API 요청은 없으며 CSP `connect-src 'none'`으로 차단합니다. 브라우저 저장 키는 `portfolio-demo:work-cycle:v1`이며 운영 저장소와 공유하지 않습니다. 초기화는 이 키만 삭제합니다.

## 별도 게시

main 반영만으로 공개 URL이 생성되지 않습니다. 이 데모는 아직 게시하지 않았습니다. Cloudflare의 별도 Worker로 배포할 때 저장소 루트에서 다음 명령을 실행합니다.

```sh
npx wrangler deploy --config wrangler.portfolio.toml
```

설정은 별도 Worker 이름과 정적 자산만 포함합니다. D1, OAuth, cron, 운영 서비스 연결은 없습니다. 배포 후 표시된 별도 URL을 포트폴리오에 사용하세요. 운영 사이트의 Access 정책이 이 별도 주소에도 적용되는지 확인하여 공개 체험 주소는 로그인 요구 없이 열리는지 확인합니다. 운영 로그인 정책은 변경하지 않습니다.

회의록 검색·필터·읽음·할 일, 작업 상태 이동, 노트·회고 저장, 초기화가 가능합니다. 일정·프로젝트·개발 이력·공부·주간보고도 허구 예시입니다.

## 검증 기록

2026-10-03 로컬 Chromium에서 360px, 420px, 1280px 너비로 전체 화면의 가로 넘침 0을 확인했습니다. 회의록의 요약·원문·할 일·이력 전환, 읽음 상태·검색·필터 유지, 작업 상태 저장 후 새로고침, 노트 저장, 초기화 시 운영 키 보존을 조작했습니다. 네트워크 요청은 정적 HTML/CSS/JS 자산만 발생했으며 브라우저 오류가 없었습니다. 아직 별도 공개 배포 확인은 수행하지 않았습니다.

브라우저 테스트 재실행(Playwright 및 Chromium 설치 필요):

```sh
npm install --no-save playwright
npx playwright install chromium
node tests/portfolio-browser.test.cjs
```

별도 Chromium 실행 파일을 사용할 때는 `DEMO_BROWSER` 환경 변수로 경로를 지정합니다. 테스트 서버는 임의의 사용 가능한 포트를 사용하고 종료합니다.
