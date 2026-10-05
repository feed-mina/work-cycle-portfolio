# AGENTS.md — work-cycle 작업 규칙

이 레포에서 코드를 고치는 에이전트(Codex / Claude / 그 외)가 **먼저 읽어야 하는 문서**입니다.
현재 상태와 남은 일은 [`docs/HANDOFF.md`](docs/HANDOFF.md)에 있습니다.

---

## 0. 이 프로젝트가 존재하는 이유

팀 리더의 업무 피드백 3가지를 **매일 지켜지는 습관**으로 바꾸는 팀 도구입니다.
기능을 늘리는 것보다 **이 3가지가 화면에서 실제로 강제되는가**가 우선입니다.

1. **고객 니즈 파악** — 이 화면을 *누가, 무엇을 판단하려고* 보는가를 만들기 전에 한 줄로 적는다
2. **AI 과신 지양** — AI가 준 설계·수치·임계값은 원문 요구사항과 1:1로 대조한 뒤에 쓴다
3. **검증과 테스트 습관화** — "동작함"이 아니라 "원본과 대조해 확인함"을 남긴다

---

## 1. 스택

| 항목 | 내용 |
|---|---|
| 런타임 | Cloudflare Workers |
| 프레임워크 | Hono (TypeScript) |
| DB | Cloudflare D1 (SQLite) — `work-cycle-db` |
| 정적 화면 | Workers Assets (`public/`) — **빌드 도구 없음. 순수 HTML/CSS/JS** |
| 인증 | Cloudflare Zero Trust Access → `Cf-Access-Authenticated-User-Email` 헤더 |
| 배포 | `git push` → Cloudflare가 자동 빌드 |
| 스케줄 | Workers Cron 1개 표현식 → 코드(`SLOTS`)에서 시각 분기 |

```
src/
  index.ts      # 라우트 전부 (~1300줄, 단일 파일). Env 타입·SLOTS·scheduled 핸들러 포함
  report.ts     # 주간업무보고 집계 + 양식 조립
  xlsx.ts       # 의존성 없는 XLSX 생성기 (CRC32 + STORED zip + OOXML 직접 작성)
  notedoc.ts    # 회의 메모 → md / html 산출물 포맷
public/         # 화면. *.html은 인라인 <script>, 공용 로직만 별도 js
  acc.js        # 카드/섹션 아코디언 + 해시 진입
  principles.js # 3원칙 배너 (모든 화면 공통)
  edit.js       # 검증 기록 · 일정 편집 모달
  quick.js      # 헤더 시계칩 · 퀵기록 모달 · 계정 메뉴
migrations/     # 0001 ~ 0009. 번호 순서대로 적용
seed/seed.sql   # 체크리스트 초기 항목 (DELETE 후 재삽입하므로 주의)
docs/           # 설계서 · 인수인계 · 배포 절차
```

---

## 2. 반드시 지킬 것

### 2-1. 검증 없이 "완료"라고 쓰지 않는다

이 레포의 핵심 규칙입니다. 아래를 **패키징·커밋보다 먼저** 합니다.

1. `npx tsc --noEmit` 통과
2. 인라인 JS까지 문법 검사
   ```bash
   node -e "const fs=require('fs');for(const f of fs.readdirSync('public').filter(x=>x.endsWith('.html'))){const h=fs.readFileSync('public/'+f,'utf8');[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((x,i)=>{try{new Function(x[1])}catch(e){console.log('ERR',f,i,e.message)}})}console.log('OK')"
   ```
3. `npx wrangler dev --local` 로 띄우고 **실제 브라우저로 조작**해서 확인
   (Playwright 사용 가능: `executablePath: '/opt/pw-browsers/chromium'`)
4. **부품을 하나씩** 확인한다 — 전체 화면이 떴다고 넘어가지 않는다
5. 데스크톱(1280) + 모바일(420) 가로 넘침 0 확인

> 실제로 이 규칙이 회귀를 잡았습니다: v5에서 카드에 `id="week"`를 붙였다가 내부 그리드와
> id가 겹쳐 주간 스케줄 카드가 통째로 덮어써졌는데, "아코디언 개수" 검사에서 발견했습니다.

### 2-2. 손대기 전에 보존 범위를 먼저 적는다

바꿀 것보다 **건드리지 않을 것**을 먼저 씁니다. 특히:

- 기존 사이클 6단계(`STEPS`)의 의미와 `/api/widget/now` 경계 시각
- `checklist_items` 기존 문구 — 대표 피드백에서 도출된 것이라 임의로 바꾸지 않음
- `oauth_tokens` 갱신 로직 (카카오/구글 refresh 흐름)

### 2-3. 비밀·회사 데이터는 커밋하지 않는다

- 토큰·키는 전부 `wrangler secret put`. `.dev.vars`는 `.gitignore`에 있음
- 회의록 원문은 대표 승인 전까지 `meetings.body_mode = 'link_only'`
- 로그·에러 메시지에 이메일/토큰이 섞이지 않는지 확인

### 2-4. 외부 API 오류는 원문을 보여준다

임의 문구로 덮으면 원인 파악이 몇 배로 오래 걸립니다.
(Google Calendar 403이 "권한 없음"으로 표시돼 3회 헛돌았던 사례 → 원문 노출로 1회에 판명)

```ts
const full = await res.text();          // 판별은 전문으로
const t = full.slice(0, 400);           // 표시만 잘라서
```

### 2-5. 하지 말 것

- **테스트 대시보드 만들지 않기** (사용자가 명시적으로 중단 요청)
- `seed/seed.sql`을 운영 DB에 다시 돌리지 않기 — 맨 위 `DELETE FROM checklist_items` 때문에 기록이 날아갑니다
- 마이그레이션에 `ALTER TABLE ... ADD COLUMN`을 쓸 때 **재실행 가능하다고 가정하지 않기**
  (SQLite에 `IF NOT EXISTS`가 없음 → 콘솔 적용 시 블록을 나눠야 함. `docs/DEPLOY.md` 참고)

---

## 3. 자주 밟는 함정

| 증상 | 원인 |
|---|---|
| CSS 선언이 통째로 무시됨 | `font: 600 13px var(--font)` 에서 `--font`가 `inherit`일 때 단축 속성 전체 무효. `font-family`/`font-size`/`font-weight`로 쪼갤 것 |
| cron 등록이 400으로 실패 | Cloudflare가 `0-4` 같은 요일 범위를 거부. 표현식은 1개로 두고 코드에서 분기 (무료 플랜 트리거 3개 한도) |
| `duplicate column` 인데 컬럼은 없음 | `d1_migrations` 기록 누락. `pragma_table_info`로 실재 확인 후 멱등 INSERT로 기록만 보정 |
| 일정 쿼리 실패 | 컬럼명은 `start_time` / `end_time` (`start`/`end` 아님) |
| 화면이 안 바뀜 | Workers Assets 캐시. `Ctrl+Shift+R` |

---

## 4. 명령어

```bash
npx tsc --noEmit                                     # 타입 검사
npx wrangler dev --local --port 8788                 # 로컬 실행 (.dev.vars의 DEV_EMAIL로 인증 우회)
npx wrangler d1 migrations apply work-cycle-db --local
npx wrangler d1 execute work-cycle-db --local --command "SELECT ..."
```

원격 D1은 계정 불일치 이슈가 있어 **Cloudflare 대시보드 D1 콘솔에 SQL을 직접 붙여넣는 방식**을
쓰고 있습니다. 절차는 `docs/DEPLOY.md`.

---

## 5. 커밋·PR

- 커밋 메시지는 한국어, `vN: 무엇을 했는지` 형태
- 변경한 파일 수가 예상과 다르면 **커밋 전에 멈추고 확인** (윈도우 CRLF 때문에 무관한 파일이 섞여 보일 수 있음)
- PR 본문에는 **무엇을 어떻게 검증했는지**를 반드시 적을 것. "동작 확인"만 적힌 PR은 이 레포의 규칙 위반입니다.

---

## 6. 인수인계·보고서 문서 요청 규칙

인수인계 문서(`screen-code-handover` 등)나 화면 기반 보고서를 요청받았을 때:

1. **범위**(어느 화면·기능까지)와 **캡처**(운영 캡처 첨부 여부, 없으면 로컬 렌더링 허용 여부)가 요청에 없으면
   **먼저 물어보거나 필요하다고 알려주고, 확인을 받은 뒤** 문서 작성을 시작한다.
   범위·캡처 없이 전체를 추정해 시작하면 읽기·캡처·작성이 모두 몇 배로 늘어난다 (v29 인수인계 작업 경험).
2. 기본 문서 형식은 **Markdown + Mermaid 소스**다. PDF·렌더링 이미지는 요청이 있을 때만 만든다.
3. 문서와 자산은 `docs/<문서명>/README.md` + `assets/` 구조로 두고, 상대 경로만 쓴다.
4. 로컬 캡처가 필요하면 `.claude/hooks/session-start.sh`가 한글 폰트와 의존성을 준비한다 (웹 세션 자동 실행).
