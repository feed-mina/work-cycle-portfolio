> **포트폴리오용 사본** — 원본 저장소(비공개)에서 회사 데이터(회사명 기본값·실명·피드백 원문·배포 주소·DB ID)를 뺀 스냅샷입니다. 이력 없이 1커밋으로 시작했습니다.

# work-cycle

업무 습관 도구 7종을 **하나의 하루 사이클**로 통합한 팀 도구.
읽기(④) → 계획(⑦) → 작업(⑤) → 검증(②) → 공유(③) → 회고(⑥), 모든 기록은 Cloudflare D1에 저장.

**팀 리더의 업무 피드백 3원칙을 매일 지켜지는 습관으로 바꾸는 것**이 이 도구의 목적입니다.
① 고객 니즈 파악 · ② AI 과신 지양 · ③ 검증과 테스트 습관화

## 📖 먼저 읽을 것

| 문서 | 내용 |
|---|---|
| **[AGENTS.md](AGENTS.md)** | **코드를 고치기 전에 반드시 읽을 작업 규칙** — 검증 절차, 함정, 하지 말 것 |
| [docs/HANDOFF.md](docs/HANDOFF.md) | 현재 상태 · 화면 목록 · 남은 일 |
| [docs/screen-code-handover/README.md](docs/screen-code-handover/README.md) | **화면-코드 인수인계** — 화면 캡처 → 담당 코드 → 저장 필드 → 유지보수, 흐름도·ERD 포함 |
| [docs/DEPLOY.md](docs/DEPLOY.md) | 배포 절차 (D1 SQL을 손으로 넣는 이유 포함) |
| [docs/워크사이클-시스템설계.md](docs/워크사이클-시스템설계.md) | 아키텍처 · 데이터 모델 · 마일스톤 |
| [docs/주간업무보고-자동생성-설계.md](docs/weekly-report-design.md) | 양식 재현 · 데이터 매핑 · 주차 계산 기준 |
| [docs/대표피드백-3원칙-도구화.md](docs/principles-toolkit.md) | 3원칙 배너 · 요구사항 한 줄 확인 · 회의 중 메모 |

## 화면

| 경로 | 내용 |
|---|---|
| `/` | 마이페이지 — 사이클 보드, 주간 스케줄, 질문 템플릿⑦, 회고⑥, 퀵 기록, 체크리스트⑤, 검증 기록② |
| `/schedule` | 사이클 도넛 달력 + 주간/월간 스케줄 |
| `/meetings` | 회의 중 메모(트리형) · 회의록 생성(AI 요약) · 회의록 목록 |
| `/kanban` | 우선순위 4사분면 + GitHub 이슈 연결 |
| `/dashboard` | 검증 대시보드 (대표 공유용) |
| `/report` | 주간업무보고 — 초안 편집 · xlsx 다운로드 |

- 현재 단계: **M3 + v5** — 상세는 [docs/HANDOFF.md](docs/HANDOFF.md)

## M0 — 처음 한 번 (약 30분)

회사 계정 이메일로 https://dash.cloudflare.com 가입 후, 로컬에서:

```bash
npm install
npx wrangler login                      # 브라우저에서 회사 Cloudflare 계정 인증

# 1. D1 생성 → 출력된 database_id를 wrangler.toml에 붙여넣기
npx wrangler d1 create work-cycle-db

# 2. 스키마 + 체크리스트 초기 항목 (원격 DB)
npm run db:migrate
npm run db:seed

# 3. 배포 (이후로는 코드 수정 → 이 명령 하나)
npm run deploy
```

배포 URL: `https://work-cycle.<계정서브도메인>.workers.dev`

### Cloudflare Access (팀원 로그인) 설정

배포 URL은 **Access를 켜기 전까지 인증이 없으므로** 바로 설정합니다:

1. Cloudflare 대시보드 → Zero Trust → Access → Applications → **Add an application** → Self-hosted
2. Application domain: `work-cycle.<계정서브도메인>.workers.dev`
3. Policy: Allow → Include → **Emails** → 팀원 이메일 추가
4. 저장 후 접속하면 이메일 인증(OTP) 화면이 뜨고, 통과하면 앱이 사용자를 자동 인식합니다

> 앱은 Access가 붙여주는 `Cf-Access-Authenticated-User-Email` 헤더로 사용자를 구분합니다.
> 로그인 코드가 앱 안에 없는 이유입니다.

## 로컬 개발

```bash
cp .dev.vars.example .dev.vars    # DEV_EMAIL을 본인 이메일로
npm run db:migrate:local
npm run db:seed:local
npm run dev                        # http://localhost:8787
```

## 구조

```
src/index.ts        Worker API (Hono) — 보드/체크리스트/검증/대시보드/위젯
public/             화면 (index.html 오늘의 사이클 · dashboard.html 팀 대시보드)
migrations/         D1 스키마 (전체 테이블 — M2·M3용 포함)
seed/               체크리스트 초기 항목 (태도·개발 문서에서 추출)
docs/               설계서 · 실행 플랜
```

## 사이클 보드가 "완료"를 판정하는 규칙 (M1)

| 단계 | 완료 조건 |
|---|---|
| ④ 읽기 | 회의록 읽음 기록 (M2) — M1에서는 [완료 표시] 버튼 |
| ⑦ 계획 | 질문 템플릿 저장 (M2) — M1에서는 [완료 표시] 버튼 |
| ⑤ 작업 | 체크리스트 1개 이상 체크 — **수동 표시 불가** |
| ② 검증 | 검증 표 1줄 이상 추가 — **수동 표시 불가** |
| ③ 공유 | [완료 표시] 버튼 (M3에서 핀 댓글 연동) |
| ⑥ 회고 | 회고 저장 (M2) — M1에서는 [완료 표시] 버튼 |

핵심 습관인 ⑤·②는 실제 기록 없이는 완료가 안 되도록 잠가뒀습니다.

## 다음 마일스톤

M0~M3와 v3~v5는 완료됐습니다. 남은 것은 [docs/HANDOFF.md §6](docs/HANDOFF.md)를 보세요.
요약하면: 실사용 후 다듬기 → 화면 핀 댓글(③) → D1→R2 백업 → PC 위젯(①).

## 보안 원칙

- 회사 데이터(회의록 원문, DB 파일)는 이 레포에 커밋하지 않는다 (.gitignore)
- 회의록 원문 저장은 대표님 승인 전까지 `body_mode=link_only`
- GitHub 토큰 등 비밀값은 `wrangler secret put`으로만 (M2)
- 비밀값은 `wrangler secret put`으로만 — 레포·화면에 노출 금지
