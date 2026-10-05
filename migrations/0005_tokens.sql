-- 0005: OAuth 토큰 저장 (카카오 나에게 보내기 · 구글 캘린더 읽기용)
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email    TEXT NOT NULL,
  provider      TEXT NOT NULL,             -- kakao | google
  access_token  TEXT,
  refresh_token TEXT NOT NULL,
  expires_at    INTEGER,                   -- access token 만료 (epoch ms)
  updated_at    TEXT DEFAULT (datetime('now')),
  UNIQUE(user_email, provider)
);
