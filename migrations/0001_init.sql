-- work-cycle D1 초기 스키마 (설계서 v2 §4)
-- 모든 기록은 user_email(Cloudflare Access가 주는 회사 이메일)과 cycle_date로 묶인다.

CREATE TABLE IF NOT EXISTS users (
  email      TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── planning-harness 이관 대상 (M2에서 채움, 스키마만 선반영) ──────────────
CREATE TABLE IF NOT EXISTS schedules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  date       TEXT NOT NULL,              -- YYYY-MM-DD
  block_type TEXT NOT NULL DEFAULT '가능', -- 가능/집중/회의
  title      TEXT NOT NULL,
  start_time TEXT,
  end_time   TEXT
);

CREATE TABLE IF NOT EXISTS git_targets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  repo       TEXT NOT NULL,              -- owner/repo
  project_no INTEGER,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kanban_cards (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email   TEXT NOT NULL,
  quadrant     TEXT NOT NULL,            -- 즉시처리/전략적계획/축소위임/취소연기
  title        TEXT NOT NULL,
  gh_issue_url TEXT,
  sort         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meetings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT NOT NULL,            -- 회의 날짜
  title        TEXT NOT NULL,
  body_mode    TEXT NOT NULL DEFAULT 'link_only', -- link_only | full (full이면 R2에 원문)
  r2_key       TEXT,
  gh_issue_url TEXT
);

-- ── 사이클 기록 ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meeting_reads (           -- ④ 회의록 읽음
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id),
  user_email TEXT NOT NULL,
  read_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(meeting_id, user_email)
);

CREATE TABLE IF NOT EXISTS checklist_items (         -- ⑤ 항목 (seed로 초기화)
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL,
  text    TEXT NOT NULL,
  sort    INTEGER NOT NULL DEFAULT 0,
  active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS checks (                  -- ⑤ 일일 체크
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    INTEGER NOT NULL REFERENCES checklist_items(id),
  user_email TEXT NOT NULL,
  cycle_date TEXT NOT NULL,
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, user_email, cycle_date)
);

CREATE TABLE IF NOT EXISTS ai_requests (             -- ⑦ 질문 템플릿 인스턴스
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email    TEXT NOT NULL,
  cycle_date    TEXT NOT NULL,
  user_flow     TEXT NOT NULL DEFAULT '',
  keep          TEXT NOT NULL DEFAULT '',
  dont_touch    TEXT NOT NULL DEFAULT '',
  done_criteria TEXT NOT NULL DEFAULT '',
  unknowns      TEXT NOT NULL DEFAULT '',
  final_prompt  TEXT NOT NULL DEFAULT '',
  reused_from   INTEGER REFERENCES retros(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS verifications (           -- ② 검증 표
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  cycle_date TEXT NOT NULL,
  item       TEXT NOT NULL,              -- 항목 (예: 조회 사이클 수)
  formula    TEXT NOT NULL DEFAULT '',   -- 계산식
  method     TEXT NOT NULL DEFAULT '',   -- 검증 방법 (예: 원본 JSONL 대조)
  result     TEXT NOT NULL DEFAULT '',   -- 결과
  status     TEXT NOT NULL DEFAULT '미확인', -- 확인됨 | 불일치→수정 | 미확인
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS retros (                  -- ⑥ 회고
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email      TEXT NOT NULL,
  cycle_date      TEXT NOT NULL,
  work_summary    TEXT NOT NULL DEFAULT '',
  ai_answer_md    TEXT NOT NULL DEFAULT '',
  tomorrow_prompt TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS review_targets (          -- ③ 화면 리뷰 대상
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  r2_image_key TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pins (                    -- ③ 핀 댓글
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id    INTEGER NOT NULL REFERENCES review_targets(id),
  x_pct        REAL NOT NULL,
  y_pct        REAL NOT NULL,
  author_email TEXT NOT NULL,
  body         TEXT NOT NULL,
  parent_id    INTEGER REFERENCES pins(id),
  resolved     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- M1 임시: 아직 전용 화면이 없는 단계(④⑦⑥ 보고·공유)를 수동 완료 표시.
-- M2에서 실제 기록(meeting_reads/ai_requests/retros)이 생기면 보드가 그쪽을 우선 사용.
CREATE TABLE IF NOT EXISTS step_marks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  cycle_date TEXT NOT NULL,
  step       TEXT NOT NULL,              -- read|plan|work|verify|share|retro
  marked_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_email, cycle_date, step)
);

CREATE INDEX IF NOT EXISTS idx_checks_date        ON checks(cycle_date, user_email);
CREATE INDEX IF NOT EXISTS idx_verifications_date ON verifications(cycle_date, user_email);
CREATE INDEX IF NOT EXISTS idx_step_marks_date    ON step_marks(cycle_date, user_email);
