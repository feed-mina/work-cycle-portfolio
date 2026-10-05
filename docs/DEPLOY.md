# 배포 절차

`git push` → Cloudflare가 자동 빌드·배포합니다. 다만 **DB 마이그레이션과 cron은 수동**입니다.

---

## 순서

```
1) 마이그레이션 SQL을 D1 콘솔에 적용   ← 먼저!
2) git push
3) (cron 표현식이 바뀐 경우에만) 대시보드에서 트리거 수정
4) Ctrl+Shift+R 로 열어서 확인
```

**1번을 건너뛰면 배포 직후 500이 납니다.** 코드가 아직 없는 컬럼·테이블을 찾기 때문입니다.

---

## 왜 `wrangler d1 migrations apply --remote`를 안 쓰나

작업 PC에 `CLOUDFLARE_ACCOUNT_ID` 환경변수가 박혀 있어 `wrangler whoami`가 맞는 계정을 보여줘도
실제 API 요청은 다른 계정으로 나갑니다. logout/login으로 해결되지 않아,
**Cloudflare 대시보드 → D1 → work-cycle-db → 콘솔에 SQL을 직접 붙여넣는** 방식을 씁니다.

우회하려면 명령 앞에 환경변수를 직접 붙이는 방법도 있습니다:

```bash
CLOUDFLARE_ACCOUNT_ID=<올바른_계정_ID> npx wrangler d1 migrations apply work-cycle-db --remote
```

---

## SQL을 콘솔에 붙여넣을 때 — 블록을 나눈다

SQLite에는 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`가 없습니다.
D1 콘솔은 **앞 문장이 실패하면 뒤 문장을 실행하지 않으므로**, 재실행 불가한 것과 가능한 것을 나눠 넣습니다.

**블록 A — 재실행 불가 (`ALTER TABLE`)**
`duplicate column` 이 뜨면 이미 적용된 것이니 넘어갑니다.
여러 줄이면 **한 줄씩** 넣어야 뒷줄이 안 잘립니다.

**블록 B — 재실행 안전**
`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
`INSERT ... WHERE NOT EXISTS (...)` 만 모아둡니다.

**블록 C — 마이그레이션 기록 보정**

```sql
INSERT INTO d1_migrations (name) SELECT '00NN_이름.sql'
  WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name='00NN_이름.sql');
```

이걸 빼먹으면 나중에 `migrations apply`가 이미 적용된 것을 다시 돌리려다 실패합니다.

### `0024_schedule_log_revisions.sql` 적용 순서 (업무 메모 수정 이력, 2026-10-02)

1. 파일의 `CREATE TABLE IF NOT EXISTS schedule_log_revisions …`와 `CREATE INDEX IF NOT EXISTS …` 실행 (재실행 가능)
2. 블록 C: `d1_migrations`에 `0024_schedule_log_revisions.sql` 기록
3. 확인: `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schedule_log_revisions';` → 1

0024 전에 배포돼도 메모 수정은 그대로 되고, 이력만 쌓이지 않는다(표 확인 결과는 최대 60초 캐시).
메모나 일정을 지우면 이력도 함께 지워진다(외래키 ON DELETE CASCADE).

### `0023_personal_entry_revisions.sql` 적용 순서 (실행 계획·회고 저장 이력, 2026-10-02)

1. 파일의 `CREATE TABLE IF NOT EXISTS personal_entry_revisions …`와 `CREATE INDEX IF NOT EXISTS …` 실행 (재실행 가능)
2. 블록 C: `d1_migrations`에 `0023_personal_entry_revisions.sql` 기록
3. 확인: `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='personal_entry_revisions';` → 1

0023 전에 배포돼도 계획·회고 저장과 md 내려받기는 그대로 되고, 이력만 쌓이지 않는다(표 확인 결과는 최대 60초 캐시).
이력은 표가 생긴 뒤 저장부터 쌓인다. 그날 첫 저장 때 그 직전 내용(덮어쓰기 전)을 한 줄 옮겨 두므로, 오늘 이미 저장한 내용은 남는다.

### `0022_kanban_done.sql` 적용 순서 (칸반 카드 완료 표시, 2026-10-02)

1. 블록 A: `ALTER TABLE kanban_cards ADD COLUMN done_at TEXT;` 한 줄 실행 (`duplicate column`이면 이미 적용)
2. 블록 C: `d1_migrations`에 `0022_kanban_done.sql` 기록
3. 확인: `SELECT name FROM pragma_table_info('kanban_cards') WHERE name='done_at';` → 1행

기존 카드는 `done_at` NULL(진행 중). 0022 전에 배포돼도 칸반 목록·주간보고는 그대로 뜨고, ✓ 완료만
"마이그레이션 0022 적용 뒤에 쓸 수 있습니다" 400 으로 막힌다(컬럼 확인 결과는 최대 60초 캐시 — 적용 직후 1분 안에 살아남).

### `0021_schedule_log_replies.sql` 적용 순서 (업무 메모 대댓글, 2026-09-27)

1. 블록 A: `ALTER TABLE schedule_logs ADD COLUMN parent_id INTEGER REFERENCES schedule_logs(id);` 한 줄 실행 (`duplicate column`이면 이미 적용)
2. 블록 B: `CREATE INDEX IF NOT EXISTS idx_schedule_logs_parent ON schedule_logs(parent_id);`
3. 블록 C: `d1_migrations`에 `0021_schedule_log_replies.sql` 기록

기존 메모는 `parent_id` NULL(일반 메모). 코드는 `parent_id` 컬럼이 없으면 `GET /api/work-logs`가 500이므로 **배포 전에** 적용한다.

### `0010_habit_schedule.sql` 적용 순서

퀵 기록의 반복 요일·클릭 시각 기능을 배포하기 전에 아래 순서로 적용합니다.

1. `ALTER TABLE habit_buttons ... repeat_type` 한 줄 실행
2. `ALTER TABLE habit_buttons ... repeat_days` 한 줄 실행
3. 같은 파일의 `CREATE TABLE IF NOT EXISTS habit_taps ...`와 `CREATE INDEX IF NOT EXISTS ...` 실행
4. 아래 기록 보정 실행

```sql
INSERT INTO d1_migrations (name) SELECT '0010_habit_schedule.sql'
  WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name='0010_habit_schedule.sql');
```

적용 확인:

```sql
SELECT
  (SELECT COUNT(*) FROM pragma_table_info('habit_buttons') WHERE name='repeat_type') AS repeat_type,
  (SELECT COUNT(*) FROM pragma_table_info('habit_buttons') WHERE name='repeat_days') AS repeat_days,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='habit_taps') AS habit_taps;
-- 목표: 1 / 1 / 1
```

### `0011_schedule_memo.sql` 적용 순서

일정 편집 모달의 메모 저장 기능을 배포하기 전에 아래 SQL을 한 번 실행합니다.

```sql
ALTER TABLE schedules ADD COLUMN memo TEXT;
```

그다음 마이그레이션 기록을 보정합니다.

```sql
INSERT INTO d1_migrations (name) SELECT '0011_schedule_memo.sql'
  WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name='0011_schedule_memo.sql');
```

적용 확인:

```sql
SELECT COUNT(*) AS schedule_memo
FROM pragma_table_info('schedules')
WHERE name='memo';
-- 목표: 1
```

### `0012_merge_focus_into_work.sql` 적용 순서

집중·가능 유형을 업무로 합치기 위해 아래 SQL을 실행합니다. 재실행해도 안전합니다.

```sql
UPDATE schedules
SET block_type='업무'
WHERE block_type <> '회의';
```

그다음 마이그레이션 기록을 보정합니다.

```sql
INSERT INTO d1_migrations (name) SELECT '0012_merge_focus_into_work.sql'
  WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name='0012_merge_focus_into_work.sql');
```

적용 확인:

```sql
SELECT block_type, COUNT(*) AS schedules
FROM schedules
GROUP BY block_type
ORDER BY block_type;
-- 목표: 업무와 회의만 표시
```

### `0013_schedule_logs.sql` 적용 순서

시간순 업무 메모 기능은 새 테이블을 바로 조회하므로 **코드를 push하기 전에** 아래 SQL을 먼저 실행합니다.
기존 일정이나 기존 `memo` 값은 변경하지 않습니다.

```sql
CREATE TABLE IF NOT EXISTS schedule_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  logged_date TEXT NOT NULL,
  logged_time TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_schedule_logs_schedule
  ON schedule_logs(schedule_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_schedule_logs_user_date
  ON schedule_logs(user_email, logged_date, id DESC);
```

그다음 마이그레이션 기록을 보정합니다.

```sql
INSERT INTO d1_migrations (name) SELECT '0013_schedule_logs.sql'
  WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name='0013_schedule_logs.sql');
```

적용 확인:

```sql
SELECT
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schedule_logs') AS schedule_logs,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_schedule_logs_schedule') AS schedule_index,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_schedule_logs_user_date') AS user_date_index;
-- 목표: 1 / 1 / 1
```

### `0014_team_membership_exit.sql` 적용 순서

팀 멤버에서 나가기 기능을 배포하기 전에 아래 SQL을 먼저 실행합니다. 업무 기록과 OAuth 토큰은 삭제하지 않으며, 이후 코드가 이 테이블을 기준으로 보드·팀 집계·알림 대상을 제외합니다.

```sql
CREATE TABLE IF NOT EXISTS team_membership_exits (
  user_email TEXT PRIMARY KEY REFERENCES users(email),
  left_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

그다음 마이그레이션 기록을 보정합니다.

```sql
INSERT INTO d1_migrations (name) SELECT '0014_team_membership_exit.sql'
  WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name='0014_team_membership_exit.sql');
```

적용 확인:

```sql
SELECT COUNT(*) AS team_membership_exit_table
FROM sqlite_master
WHERE type='table' AND name='team_membership_exits';
-- 목표: 1
```

### `0015_checklist_notes.sql` 적용 순서

체크리스트 항목을 눌렀을 때 적는 개인 메모를 배포하기 전에 아래 SQL을 먼저 실행합니다. 체크 완료 여부(`checks`)와 메모(`checklist_notes`)는 분리되어 있으므로, 체크를 해제해도 메모는 지워지지 않습니다.

```sql
CREATE TABLE IF NOT EXISTS checklist_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     INTEGER NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  user_email  TEXT NOT NULL,
  cycle_date  TEXT NOT NULL,
  memo        TEXT NOT NULL CHECK (length(memo) BETWEEN 1 AND 1000),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, user_email, cycle_date)
);

CREATE INDEX IF NOT EXISTS idx_checklist_notes_user_date
  ON checklist_notes(user_email, cycle_date, item_id);
```

그다음 마이그레이션 기록을 보정합니다.

```sql
INSERT INTO d1_migrations (name) SELECT '0015_checklist_notes.sql'
  WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name='0015_checklist_notes.sql');
```

적용 확인:

```sql
SELECT
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='checklist_notes') AS notes_table,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_checklist_notes_user_date') AS notes_index,
  (SELECT COUNT(*) FROM d1_migrations WHERE name='0015_checklist_notes.sql') AS migration_record;
-- 목표: 1 / 1 / 1
```

---

## 적용 확인

```sql
SELECT
  (SELECT COUNT(*) FROM pragma_table_info('schedules') WHERE name='confirm_line') AS c1,
  (SELECT COUNT(*) FROM pragma_table_info('schedules') WHERE name='confirmed')     AS c2,
  (SELECT COUNT(*) FROM sqlite_master WHERE name='meeting_notes')                  AS c3,
  (SELECT COUNT(*) FROM checklist_items WHERE active=1)                            AS items;
-- 목표: 1 / 1 / 1 / 21
```

컬럼이 실제로 있는지 의심될 땐 `d1_migrations` 기록이 아니라 **`pragma_table_info`로 실물을 확인**합니다.

---

## Cron 트리거

무료 플랜은 Worker당 트리거 **3개**까지라, 표현식을 1개만 두고 코드(`SLOTS`)에서 시각을 보고 갈라 보냅니다.

```
0,25,30,40 23,1,3,4,8 * * *
```

- Cloudflare는 `0-4` 같은 **요일 범위 표기를 거부**합니다 (400). 대시보드에서는 `SUN-THU` 형태만 받습니다.
- 표현식을 바꿀 땐 **기존 트리거를 연필(✏️) 아이콘으로 수정**하세요.
  `+ Add`로 하나 더 만들면 같은 시각에 두 번 발화해 알림이 중복됩니다.
- 수정 후 `Runs` 설명에 의도한 시각이 들어갔는지 확인합니다.

---

## 시크릿

토큰·키는 레포에 넣지 않고 전부 secret으로 등록합니다.

### 대시보드에서 넣기 (권장)

**Workers & Pages → work-cycle → Settings → Variables and Secrets → Add**

| 항목 | 값 |
|---|---|
| Type | **Secret** |
| Variable name | 아래 표의 이름 |
| Value | 발급받은 키 |

넣고 `Deploy`(또는 Save)를 누르면 끝입니다. 재배포는 필요 없습니다.

> **Type을 `Text`로 두지 마세요.** Text는 값이 대시보드에 그대로 보입니다.

`wrangler secret put`보다 대시보드를 권하는 이유는 위 [D1 항목](#왜-wrangler-d1-migrations-apply---remote를-안-쓰나)과 같습니다 —
작업 PC의 `CLOUDFLARE_ACCOUNT_ID` 때문에 **엉뚱한 계정의 Worker에 키가 들어가고**,
앱에서는 계속 "키가 설정되지 않았습니다"가 뜹니다. 원인을 찾기 어려운 부류의 실패입니다.

CLI로 넣어야 한다면 계정 ID를 명시하세요:

```bash
CLOUDFLARE_ACCOUNT_ID=<올바른_계정_ID> npx wrangler secret put GEMINI_API_KEY
```

### 등록할 것

| 이름 | 없으면 안 되는 기능 |
|---|---|
| `GEMINI_API_KEY` | 회의록 AI 요약, 주간보고 `✨ 문장 다듬기` |
| `GEMINI_MODEL` | (선택) 기본값 `gemini-2.5-flash`. 비밀이 아니라 Text로 넣어도 됩니다 |
| `GITHUB_TOKEN` | 칸반 이슈 가져오기·**레포 드롭다운**(`GET /user/repos`), 회의록 → GitHub 이슈 생성. 볼트 전용 토큰이 없으면 볼트 읽기에도 대체 사용. **필요 권한:** classic이면 `repo`(비공개 포함, 없으면 `public_repo`), fine-grained면 Metadata: Read + Issues: Read and write, 대상 저장소에 드롭다운에 보일 레포 포함 |
| `GITHUB_TOKEN_VAULT` | **옵시디언 볼트에서 회의록 가져오기** 전용. `VAULT_REPO` 읽기 권한 필요. **하루 기록을 볼트 `history/`에 올리려면 쓰기 권한도 필요** (fine-grained: 저장소 `feed-mina/ME`만, Contents: Read and write) — 아래 '하루 기록 → 볼트 history/' |
| `KAKAO_JS_KEY` | 화상회의 링크·퀵기록 **카카오 공유** (JavaScript 키) |
| `KAKAO_REST_KEY` | 카카오 로그인·알림 (REST API 키) |
| `KAKAO_CLIENT_SECRET` | 카카오 로그인 |
| `GOOGLE_CLIENT_ID` | 구글 캘린더 연동, 화상회의 만들기 |
| `GOOGLE_CLIENT_SECRET` | 위와 같음 |

한 번 저장하면 **값은 다시 볼 수 없습니다** — 이름만 보입니다. 바꾸려면 새 값으로 덮어쓰세요.

### 옵시디언 볼트 (선택)

`회의록 읽기` 단계에서 볼트의 그날 노트를 가져옵니다. 기본값으로 동작하므로 보통 건드릴 필요가 없습니다.
다른 레포·폴더를 쓴다면 Text 변수로 넣으세요 (비밀이 아닙니다).

| 이름 | 기본값 | 뜻 |
|---|---|---|
| `VAULT_REPO` | `feed-mina/ME` | 옵시디언 볼트를 미러하는 GitHub 레포 |
| `VAULT_DIR` | `daily` | **팀용** 일일 노트 루트 |
| (참고) 회사/개인 범위 | — | `meetings`·`meeting_notes`(0018), `schedules`·`kanban_cards`(0020)의 `scope` 컬럼. 개인용에서 만든 것만 `personal`, 기존 행은 전부 `company`. 주간업무보고는 회사 표만 읽는다 |
| `VAULT_PERSONAL_DIRS` | `04-Thinking,06-Knowledge,07-Projects,10-Meta,생활정착/회의기록,01-History,history,docs` | **개인용**에서 보는 폴더 목록. `docs` 전체와 `01-History` 하위 폴더는 문서 묶음으로 표시 |
| `GITHUB_API_BASE` | `https://api.github.com` | 로컬 검증용. 운영에서는 넣지 않는다 |

회사용 폴더 규칙은 `{VAULT_DIR}/{N}월/{N}월DD일/` 입니다 (월은 0 없이, 일은 0을 채워서 — 예: `daily/8월/8월03일`).
개인용은 날짜 폴더 대신 저장소 전체 트리를 1회 받아 `vault_index_cache`(마이그레이션 0017)에 캐시하고, `VAULT_PERSONAL_DIRS` 안의 md·html을 폴더·날짜·검색으로 고릅니다 (`GET /api/vault/index`, 기본 최근 14일). 최신 커밋 sha가 같으면 GitHub 호출은 `commits/main` 1회뿐입니다.
`docs`는 파일을 한 줄씩 펼치지 않고 `docs/YYYY-MM-DD/<보고서폴더>/...` 또는 `docs/<보고서폴더>/...` 단위의 **문서 묶음(collection)** 으로 그룹화합니다.
`01-History`는 루트의 md·html은 기존처럼 개별 노트로 유지하고, `01-History/<하위폴더>/...` 안의 md·html만 하위폴더 단위 문서 묶음으로 그룹화합니다. 예: `01-History/2026-10-04_디밀리언_면접_포트폴리오_개선/README.md`는 해당 폴더의 대표 문서가 됩니다.
대표 문서는 `README.md → README.html → index.md → index.html → 폴더 바로 아래 첫 md → 첫 html` 순서로 고르고, 회의록 가져오기는 대표 문서를 사용합니다. 묶음 안의 더 깊은 `archive/`·`assets/` 문서도 같은 묶음에서 개별적으로 열 수 있습니다.
`docs`는 v49 기능의 고정 소스라 운영에 예전 `VAULT_PERSONAL_DIRS` 값이 남아 있어도 자동으로 추가됩니다. `01-History`는 기본 개인 폴더 목록에 이미 포함되어 있습니다. 다른 개인 폴더 설정은 그대로 유지합니다.
이 읽기 경로는 읽기 전용이며(쓰기는 아래 `history/` 한 폴더뿐) `GITHUB_TOKEN_VAULT`가 그 레포를 읽을 수 있어야 합니다. 이 Secret이 없으면 기존 `GITHUB_TOKEN`을 사용합니다. 코드는 `src/vault.ts`.

> 볼트는 옵시디언 Sync/iCloud가 원본이고 GitHub는 미러입니다.
> **커밋되지 않은 날은 폴더가 없어** 화면이 "폴더가 없습니다"로 안내합니다 — 오류가 아닙니다.

### 하루 기록 → 볼트 `history/` (2026-10-02)

개인 마이페이지의 [md 내려받기]와 같은 파일을 볼트 저장소에 **하루 한 파일**로 올립니다. 코드는 `src/vault-history.ts`.

| 언제 | 무엇 |
|---|---|
| 매일 23:50 KST | 그날 파일 `history/YYYY-MM-DD_work-cycle.md` |
| 다음 날 00:10 KST | 전날 파일을 한 번 더 (23:50 이후 수정 반영) |
| 개인 마이페이지 메모 카드 [ME에 올리기] | 메모 날짜에서 고른 날 (볼트 주인에게만 보임) |

- 같은 날 다시 올리면 그 파일만 최신으로 덮어씁니다. 내용이 같으면 커밋하지 않고, 기록이 하나도 없는 날은 파일을 만들지 않습니다.
- **볼트 주인 한 사람의 개인용 기록만** 올립니다. 회사용 기록은 md에 들어가지 않습니다.
- cron은 기존 표현식 하나에 분·시를 더했습니다(`wrangler.toml`). 표에 없는 시각은 코드에서 그냥 통과합니다.

설정 (Workers → work-cycle → Settings → Variables and Secrets):

> **Text가 아니라 Secret으로 넣으세요.** git push 자동 배포(`wrangler deploy`)는 `keep_vars`가 없으면
> 대시보드에서 넣은 Text 변수를 지우고 `wrangler.toml`의 vars만 남깁니다. Secret은 배포로 지워지지 않습니다
> (wrangler `--keep-vars` 설명: "Note that secrets are never deleted by deployments", 2026-10-02 확인).
> 위 '옵시디언 볼트' 표의 Text 변수들도 같은 이유로 배포 때 지워질 수 있지만 기본값이 있어 동작은 같습니다.

| 이름 | 종류 | 값 |
|---|---|---|
| `VAULT_HISTORY_EMAIL` | **Secret** | 볼트 주인의 Cloudflare Access 로그인 이메일. **없으면 기능 전체가 꺼짐** |
| `VAULT_HISTORY_DIR` | Secret (선택) | 기본 `history` — 바꿀 때만 |
| `GITHUB_TOKEN_VAULT` | Secret | 위 표 — `feed-mina/ME` Contents: Read and write |

확인: 개인 마이페이지에서 [ME에 올리기] → "ME history/… 에 올렸습니다". 실패하면 GitHub 응답 원문이 그대로 보입니다
(예: `(403) Resource not accessible by personal access token` → 토큰 권한 부족). cron 결과는 Workers 로그의 `vault_history` / `vault_history_failed`.

> ⚠️ GitHub가 볼트의 미러라면, 옵시디언 쪽 동기화(예: Obsidian Git)가 **push 전에 pull** 하도록 켜 두어야 합니다.
> 그렇지 않으면 work-cycle이 올린 커밋 때문에 옵시디언의 다음 push가 거절될 수 있습니다.

로컬 검증 (실제 GitHub에 쓰지 않음): `node tests/fake-github.mjs` →
`npx wrangler dev --local --port 18788 --var GITHUB_API_BASE:http://127.0.0.1:18799 --var GITHUB_TOKEN_VAULT:fake-token --var VAULT_HISTORY_EMAIL:owner@example.test` →
`node tests/vault-history.test.mjs`.

### git push로 배포해도 시크릿은 유지됩니다

시크릿은 코드와 별개로 저장되고, `wrangler.toml`에 `[vars]` 블록이 없어 덮어쓸 것도 없습니다.
배포할 때마다 다시 넣을 필요가 없습니다.

### 카카오는 키만으로 부족하다

`KAKAO_JS_KEY`가 등록돼 있어도 **카카오 개발자 콘솔에 사이트 도메인이 없으면 공유가 조용히 실패**합니다.

**카카오 개발자 콘솔 → 내 애플리케이션 → 앱 설정 → 플랫폼 → Web → 사이트 도메인**

```
https://<your-worker>.workers.dev
```

확인은 앱 아무 화면에서 브라우저 콘솔에 `window.Kakao?.isInitialized()` 를 쳐봅니다.

| 결과 | 뜻 |
|---|---|
| `true` | 키·SDK 정상. 공유가 안 되면 위 도메인 등록을 확인 |
| `false` / `undefined` | 키가 안 잡힘 — 대시보드의 `KAKAO_JS_KEY` 확인 |

### 로컬

`.dev.vars` (gitignore됨)에 넣습니다. `DEV_EMAIL`을 넣으면 Access 인증을 우회해 로컬 실행이 됩니다.
`GEMINI_API_KEY=dev-mock` 으로 두면 AI 호출 없이 모의 응답으로 회의록 요약·문장 다듬기를 테스트할 수 있습니다.

---

## 윈도우(Git Bash)에서 파일 반영할 때

zip으로 받은 변경분을 클론 폴더에 덮어쓰는 흐름입니다.

```bash
cd /d/work-cycle/work-cycle          # Git Bash에서 D: 는 /d
cp -f ~/Downloads/wc-vN/public/*     public/
cp -f ~/Downloads/wc-vN/src/*        src/
cp -f ~/Downloads/wc-vN/migrations/* migrations/
git status                           # 변경 파일 수가 예상과 맞는지 먼저 확인
git add -A && git commit -m "vN: ..." && git push
```

- `LF will be replaced by CRLF` 경고는 무시해도 됩니다. 커밋 요약의 **`N files changed`** 숫자로 판단하세요.
- 무관한 파일이 `modified`로 떠도 줄바꿈 차이면 커밋에는 안 잡힙니다.
