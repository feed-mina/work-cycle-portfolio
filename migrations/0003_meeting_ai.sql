-- M3-1: 회의록 생성(AI 요약) 이관
ALTER TABLE meetings ADD COLUMN body_md TEXT;      -- AI가 생성한 회의록 md (생성 탭 산출물)

CREATE TABLE IF NOT EXISTS ai_usage (              -- 일일 AI 호출 한도 추적
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  date       TEXT NOT NULL,
  calls      INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_email, date)
);
