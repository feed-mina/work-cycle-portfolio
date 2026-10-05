-- 팀에서 나간 계정은 업무 기록을 지우지 않고, 팀 화면·집계·알림 대상에서만 제외한다.
-- users는 Access 로그인 식별과 과거 기록의 작성자 정보를 위해 그대로 보존한다.
CREATE TABLE IF NOT EXISTS team_membership_exits (
  user_email TEXT PRIMARY KEY REFERENCES users(email),
  left_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

