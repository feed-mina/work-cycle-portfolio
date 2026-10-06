# 로그인 없는 공개 체험 (work-cycle-portfolio)

운영 화면(`public/`)을 **그대로** 쓰는 공개 데모입니다. 서버·DB·로그인 없이, 브라우저 안의 가짜 API 한 파일이
`/api/*` 요청을 받아 허구 예시 데이터를 돌려줍니다. 운영 HTML·CSS·JS 는 한 글자도 고치지 않습니다(빌드 때 복사본에만 스크립트를 끼움).

| | 운영 | 공개 데모 |
|---|---|---|
| 화면 | `public/*.html` | 같은 파일 복사본 (`portfolio-dist/`) |
| API | Hono + D1 (`src/`) | `portfolio/demo-api.js` 가 `window.fetch` 를 가로채 브라우저 안에서 처리 |
| 저장 | D1 | `localStorage` 키 `portfolio-demo:work-cycle:v2` 하나 |
| 인증 | Cloudflare Access | 없음 · 체험 계정 `guest@example.com` (허구) |
| 모드 | 회사용/개인용 | **개인용 고정** (선택 상자 숨김) |
| 네트워크 | — | 정적 파일 + 구글 폰트뿐 · CSP `connect-src 'none'` |

## 범위 (2026-10-06 합의)

**1차 공개 화면 4개**: 개인 마이페이지(`/personal`) · 회의록(`/meetings`) · 칸반(`/kanban`) · 스케줄(`/schedule`).
루트 `/` 는 `/personal` 로 보냅니다.

| 데모에서 되는 것 | 데모에서 안 되는 것 (안내만) |
|---|---|
| 사이클 보드 · 체크리스트 · 결과 기록 · 실행 계획/회고 · 퀵 기록 · 주간 스케줄 · 업무 메모(답글 포함) · 도넛 달력 · 월간 달력 · 칸반 추가/이동/완료 · 회의록 목록/읽음/할 일→칸반 · 회의 중 메모 자동 저장/확정 · AI 요약(모델 호출 없이 **모의 요약**) · 하루 기록 md 내려받기(브라우저에서 생성) | 주간보고 · 검증 대시보드 · 나의 준비 현황(안내 페이지) · 카카오/구글 연결 · ME 볼트 읽기/보관 · GitHub 이슈 생성 · 바탕화면 배너 · 노트 HTML 내보내기 |

GitHub 이슈 가져오기는 허구 레포 `demo-user/work-cycle-demo` 와 허구 이슈 3개를 보여줍니다(카드의 이슈 링크는 실제로 열리지 않습니다).
체험 데이터는 **날짜가 바뀌면 새 예시로 초기화**됩니다(일정·회고가 오늘 기준으로 보이게 하기 위해).

## 파일

| 파일 | 역할 |
|---|---|
| `portfolio/demo-api.js` | 가짜 API · 허구 데이터 · 데모 배너 · 데모에서 막는 버튼 처리. 응답 모양은 `src/routes/*.ts` · `src/personal.ts` 와 같다 |
| `portfolio/demo.css` | 배너 스타일 · 모드 선택 상자/바탕화면 배너 버튼 숨김 |
| `tools/build-portfolio.mjs` | `public/` → `portfolio-dist/` 복사 + `<head>` 에 CSP·demo-api.js·demo.css 삽입 + 범위 밖 화면을 안내 페이지로 교체 + 인라인 스크립트 문법 검사 |
| `wrangler.portfolio.toml` | 별도 Worker `work-cycle-portfolio` · 정적 자산만 (D1·AI·cron·시크릿 없음) |
| `tests/portfolio-browser.test.cjs` | Playwright 검증 (아래) |

`portfolio-dist/` 는 빌드 결과라 커밋하지 않습니다(`.gitignore`).

## 배포 (수동 · work-cycle 저장소에서)

```sh
npm run portfolio:build     # public/ → portfolio-dist/
npm run portfolio:dev       # 로컬 확인: http://127.0.0.1:8787/personal
npm run portfolio:deploy    # 빌드 + npx wrangler deploy --config wrangler.portfolio.toml
```

배포 주소: `https://work-cycle-portfolio.<계정서브도메인>.workers.dev`.
운영 사이트의 Access 정책이 이 Worker 에 붙어 있지 않은지(로그인 없이 열리는지) 배포 뒤 시크릿 창에서 확인합니다. 운영 로그인 정책은 바꾸지 않습니다.

운영 화면(`public/`)을 고치면 데모도 다시 빌드·배포해야 반영됩니다. 새 `/api/*` 엔드포인트를 화면이 부르기 시작하면
`demo-api.js` 에 같은 모양의 응답을 추가합니다(없으면 404 `공개 데모에서는 제공하지 않는 기능입니다` 로 떨어져 화면이 `요청 실패` alert 를 띄웁니다).

## 검증

```sh
npm install --no-save playwright
# Chromium 이 이미 있으면 (예: /opt/pw-browsers/chromium) DEMO_BROWSER 로 경로 지정
DEMO_BROWSER=/opt/pw-browsers/chromium npm run portfolio:test
```

테스트가 확인하는 것 — 1280px·420px 에서 네 화면을 열어:
사이클 6단계 · 주간 블록 · 체크리스트 12개 · 결과 기록 · 도넛 42칸 · 월간 달력 · 칸반 카드/완료 묶음 · 회의록 목록/요약·할 일 탭 · 범위 밖 화면 안내,
메모·체크·카드 추가·읽음이 새로고침 뒤에도 유지, md 내려받기가 네트워크 없이 생성, **페이지 오류 0 · alert 0 · 가로 넘침 0 · 외부 요청 0(폰트 제외) · 정적 파일 404 0**,
체험 초기화가 데모 키만 지우고 관계없는 localStorage 키는 보존.

### 검증 기록

- 2026-10-06 `node tests/portfolio-browser.test.cjs` PASS (Chromium 1194, 1280px·420px). `npx wrangler dev --config wrangler.portfolio.toml` 로 `/personal` `/schedule` `/kanban` `/meetings` `/report` 200, `/api/me` 404(Worker 코드 없음), `/` → `/personal` 확인. 실제 Cloudflare 배포 확인은 아직 하지 않았습니다(이 세션에 배포 토큰 없음).
- 2026-10-03 (이전 데모 — 별도 3파일 앱, 지금은 삭제) 로컬 Chromium 360/420/1280 가로 넘침 0.
