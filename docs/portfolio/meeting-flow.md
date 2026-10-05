# A07 · 회의록 AI 요약 API 한 장 (meeting-flow)

작성일 2026-10-04 · 기준 커밋 main `797c060` · 코드 읽기만 수행했고 새로 실행한 시험은 없다. 면접(2026-09-30) 당시 코드와 같은 버전이라는 뜻은 아니다.

한 줄 결론: 사용자가 확인한 텍스트 한 덩어리가 `POST /api/meetings/summarize`로 들어가, 인증 → 입력·사용량 검사 → 프롬프트 조립 → 모델 호출 → D1 저장 → 응답 순서로 처리된다. **이 경로에는 임베딩 검색이 없다** (`src/routes/meetings.ts`, `src/shared.ts`에 chroma·embedding·vector 참조 0건).

## 1. 입력 1건의 실제 순서

| # | 단계 | 어디서 | 무엇을 | 실패 시 |
| --- | --- | --- | --- | --- |
| 0 | 텍스트 확보 (브라우저) | `public/meetings.html` | 세 가지 중 하나: ① `.vtt/.srt/.txt` 파일 업로드 (`:261-273`, vtt/srt는 타임코드·번호 줄 제거) ② 브라우저 Web Speech API 녹음 (`:236-258`, Chrome `ko-KR`) ③ 클로바노트는 외부 사이트 링크만 (`:126`) — 앱이 CLOVA API를 호출하지 않으며 사용자가 받은 txt를 ①로 올린다 | 음성 인식 미지원 브라우저는 안내 문구 (`:239`) |
| 0' | 사용자 확인 | `#transcript` textarea (`:134`) | 텍스트를 보고 고친 뒤 "AI 요약 → 회의록 생성 & 저장" 클릭 (`:280-296`) | 날짜·텍스트 비면 alert |
| 1 | 요청 | `meetings.html:286-290` | `POST /api/meetings/summarize` JSON `{date, transcript, time, attendees, topic, title, schedule_id}` | — |
| 2 | 인증 | `src/index.ts:36-47` | `Cf-Access-Authenticated-User-Email` 헤더(개발은 `DEV_EMAIL`) → `users` upsert | 헤더 없음 → **401** |
| 3 | 입력 검사 | `src/routes/meetings.ts:120-123` | transcript 공백 / date 형식 / AI 바인딩·키 없음 | **400** |
| 4 | 사용량 검사 | `meetings.ts:125-129` | `ai_usage`의 오늘 calls ≥ `AI_DAILY_LIMIT`(20, `shared.ts:101`) | **429** |
| 5 | 프롬프트 조립 | `meetings.ts:131-147` | 고정 섹션 구조(참석자·안건·요약·할 일·참고) + `transcript.slice(0, 60000)` | — |
| 6 | 모델 호출 | `shared.ts:109-161 generateAiText` | Workers AI `@cf/google/gemma-4-26b-a4b-it` 먼저 → 빈 응답·실패면 Gemini(`GEMINI_MODEL` 또는 `gemini-3.6-flash`) → 둘 다 실패면 throw | 핸들러가 **502** `AI 요약 실패` (`meetings.ts:155-161`) |
| 7 | 저장 | `meetings.ts:163-171` | `INSERT INTO meetings (date, title, body_mode='full_md', body_md, created_by, schedule_id, scope)` 그 다음 `ai_usage` calls +1 (UPSERT) | 3~6 단계 실패는 이 지점 전에 return → `meetings`·`ai_usage` 쓰기 없음 |
| 8 | 응답 | `meetings.ts:172-173` | `{ok, id, md, provider, calls, limit}` | 비정상 응답은 `api()` 헬퍼가 alert 후 throw (`meetings.html:215-219`) |

로컬 개발 모의: `GEMINI_API_KEY === "dev-mock"`이면 모델을 호출하지 않고 고정 md를 만든다 (`meetings.ts:149-151`). 이 경로의 응답은 실제 모델 시험 증거가 아니다.

## 2. 네 가지를 구분한다

| 구분 | 실제 |
| --- | --- |
| 외부 음성 인식 | 브라우저 Web Speech API(Chrome 엔진) 또는 클로바노트(사용자가 외부에서 받은 txt). 둘 다 **앱 코드가 호출하는 API가 아니다** |
| 직접 작성한 앱 | 파일 파싱·textarea·요청(`meetings.html`), 인증·검증·사용량·저장(`index.ts`, `routes/meetings.ts`), 모델 호출 공통 함수(`shared.ts`) |
| 모델 호출 | Workers AI → Gemini 순서의 2단 폴백. 임베딩·벡터 검색 없음 |
| 저장 | D1 `meetings.body_md`에 **생성된 Markdown만** 저장. 요청의 `transcript` 원문은 어느 테이블에도 쓰지 않는다 (`meetings` 테이블에 원문 컬럼 없음, `migrations/0001_init.sql:38-45`, `0003_meeting_ai.sql:2`) |

"요약 INSERT가 원문 전문까지 영구 저장한다"고 말하지 않는다. 다만 프롬프트에는 원문 60,000자까지 포함되어 모델 제공자에게 전송된다.

## 3. 오류 예제 하나 (모델 실패)

- 입력: 정상 날짜 + 비어 있지 않은 텍스트, 한도 미달.
- 기대 동작(코드 읽기 기준): Workers AI와 Gemini가 모두 실패 → `generateAiText`가 throw → **502** 응답, `meetings` INSERT 0건, `ai_usage` 증가 0건. 인증 미들웨어의 `users` upsert만 발생.
- 실행 확인은 A34(추적)·A35(mock 시험)에서 한다. 이번에는 코드로만 확인했다.

## 4. 정적 체험(`portfolio/`)과의 경계

`portfolio/app.js`는 허구 데이터로 사용자 흐름만 체험하는 독립 정적 앱이다. 운영 API 요청이 없고 CSP `connect-src 'none'`으로 차단하며 브라우저 저장 키는 `portfolio-demo:work-cycle:v1`이다 (`PORTFOLIO.md`). **실제 요약 API 검증 자료가 아니다.** 2026-10-03 로컬 Chromium 검증 기록은 화면 흐름 검증이지 모델 시험이 아니다.

## 5. 90초 설명용 코드 세 지점

1. `public/meetings.html:286` — 요청 본문이 어떻게 만들어지는가
2. `src/routes/meetings.ts:118` — 400 / 429 / 502가 각각 어디서 나가는가, 저장이 언제 일어나는가
3. `src/shared.ts:109` — 모델 폴백 순서

꼬리질문 대비: "왜 임베딩이 없나" → 입력이 회의 한 건의 텍스트 전체이고 검색 대상이 없으므로 요약만 필요하다. 과거 회의록을 찾는 기능은 별도 목록 API(`GET /api/meetings`)가 담당한다.

## 6. 다음 작업 연결

- A34: 빈 입력 또는 모델 실패 한 가지의 저장·응답 순서를 실행으로 추적 (이 문서 3절을 재현).
- A35: `tests/meeting-summary.test.mjs`(신규)에서 모델 실패를 mock하고 응답 상태와 D1 쓰기 횟수를 검사.
- A37: 이 문서(실제 API)와 `PORTFOLIO.md`(정적 체험)를 두 구획으로 묶은 보충 카드.
