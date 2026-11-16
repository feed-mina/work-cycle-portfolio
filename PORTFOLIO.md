# 로그인 없는 Work-cycle 공개 체험

2026-11-16 기준, 운영 화면을 복사하는 기존 빌드와 기존 허구 데이터 API를 확장했습니다. 운영 서버/DB/인증 코드는 수정하지 않습니다.

## 비교 기준

- 운영 main: `67f3815bb16397d4b2d2f938e5f3c17294ad9775`
- 기존 공개 데모 소스: `feed-mina/work-cycle-portfolio` main `e8041e6b153a249970b0d63b6b4a97603a66a0b9`
- 포트폴리오 main: `feed-mina/feed-mina.github.io` `14aff255a4aa4dee55f7929357de425e5ab80d9b`
- 최신 공개 체험판 HTML/recent.js 및 기본 체험판 demo-api.js의 실제 HTTP 응답과 해당 main 파일의 SHA-256 일치를 확인했습니다. 사이트 전체 파일 일치를 뜻하지 않습니다.
- Sites 기본 체험판은 공개 버전 1, 소스 커밋 `bc790c12852356b2b9816b5e5822bb810177b722`입니다. 운영 저장소의 4화면 빌더보다 이미 확장된 화면·가짜 API를 재사용합니다.

## 체험 범위

| 영역 | 재사용/추가한 흐름 |
| --- | --- |
| 개인 마이페이지 | 기존 사이클 6단계, 체크리스트, 메모, 결과 기록 유지 |
| 메일 | 새 운영 메일 화면의 Gmail/네이버 탭, 검색, 허구 본문 |
| 메일 → 일정 | 초안 만들기, 원문 근거, 날짜/시간 수정, 겹침 비교, 확인 후 한 번만 저장 |
| 일정 | 기존 달력과 일정 추가/편집 유지, 면접 취소·연락 상태를 허구 기록으로 저장 |
| 회의록 | 기존 읽음/요약/할 일→칸반, 페이지 이동, 공유 생성/중지 유지. 최신 공유 주소 재확인·내용만 갱신 추가 |
| ME | docs/05-Assets/07-Projects의 허구 문서 필터, 텍스트 미리보기, 회의록으로 가져오기 |
| 칸반 | 기존 카드 추가/이동/완료 유지. 운영 main은 숨김 상태지만 공개 데모는 사용자 요청에 따라 표시 |
| NBlog | 기존 스케줄 내 체험단 카드 재사용. 방문일/방문 완료, 예시 사진·메모→초안, 예시 발행 주소 저장 |
| Harness | 더보기에서 허구 계정 연결/해제 상태만 저장 |
| 로드맵·주간보고 | 기존 공개 데모 흐름 유지 |

## 안전 경계와 데이터

- 브라우저의 `portfolio-demo:work-cycle:v4` 키에 허구 상태 저장. 날짜가 바뀌면 예시를 초기화합니다. 이전 v3 체험 데이터는 가져오지 않습니다.
- 실제 비밀번호/계정 연결 입력 없음. NBlog는 준비된 사진 설명을 사용하며 실제 파일을 업로드하지 않습니다.
- `connect-src 'none'`, `form-action 'none'`, 외부 fetch 거부, 계정/외부 링크/팝업 차단을 함께 적용합니다. 외부 폰트도 제거합니다.
- 포트폴리오 홈과 기존 기본 체험판 링크만 명시적으로 이동을 허용합니다. 실제 Gmail/Naver/Harness/API에는 연결하지 않습니다.
- CSP는 브라우저의 XHR 통신 차단까지 검증했습니다. 생성 패키지는 정적 파일만 포함하며 Worker 서버 코드, DB 바인딩, 시크릿, 운영 문서, 사내 다운로드 파일을 포함하지 않습니다.
- 공유는 같은 브라우저의 예시 미리보기입니다. AI 요약·메일 추출·발행은 모의 결과이며 실제 발송/발행/동기화가 아닙니다.
- 저장소가 차단된 브라우저는 새로고침 시 유실될 수 있다는 안내를 표시합니다. 다른 localStorage 키는 초기화 시 보존합니다.

## 빌드와 검증

```powershell
npm install
npm install --no-save --package-lock=false playwright
npm run portfolio:build
# Sites/Workers 형태: 루트 아래 extensionless 경로
node tests/portfolio-browser.test.cjs
node tests/recent-demo.test.cjs
# 기존 GitHub Pages 링크 유지: /work-cycle-demo/*.html
$env:DEMO_BASE='/work-cycle-demo'
node tests/recent-demo.test.cjs
```

설치된 Chromium 경로가 다른 경우 `DEMO_BROWSER`를 지정합니다. `tests/demo-edge.test.cjs`는 실행 중인 로컬 정적 서버를 `QA_URL`로 지정하고 실행합니다. 이 테스트는 조회 실패/재시도, 날짜 없는 메일, 일정 추가/수정/새로고침, 공유 주소 유지, 기존 앵커 이동, 오래된 버전 거절, 중복 승인 1회 저장, XHR 차단을 확인합니다.

검증 결과: 1280/420/360px에서 주소 구조별 49개 점검 통과. 기존 1280/420px 회귀 검사와 TypeScript 검사 통과. 외부 요청/페이지 오류/정적 파일 404/가로 넘침 0. 실제 휴대전화와 Safari/Firefox는 검사하지 않았습니다. 새 공개 배포는 아직 수행하지 않았습니다.

## 승인 후 반영 경로

1. 이 저장소에는 소스·빌더·테스트 변경 PR을 생성합니다.
2. `DEMO_BASE=/work-cycle-demo` 빌드 결과를 `feed-mina/feed-mina.github.io`의 `work-cycle-demo/`에 복사한 별도 PR을 생성합니다. 루트 포트폴리오 페이지는 수정하지 않습니다.
3. 두 PR의 생성·원격 브랜치 업로드는 사용자 승인이 필요합니다. 병합과 공개 배포는 별도로 승인받습니다.
4. 기존 기본 체험판 URL은 그대로 유지합니다. 기본 Sites 체험판 업데이트는 별도 배포 승인 후 동일 소스의 루트 빌드를 사용합니다.
5. 기존 `#documents`, `#mail`, `#interview`, `#nblog`, `#account` 링크는 대응 화면으로 이동합니다.

공개 배포 후에는 두 기존 주소와 핵심 동작을 다시 검사해야 합니다. 이 문서의 로컬 통과 결과가 새 배포 성공을 대신하지 않습니다.
