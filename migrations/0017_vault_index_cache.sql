-- 0017: 개인용 볼트 전체 인덱스 캐시 — GitHub tree API 응답(md·html 목록)을 저장소별 1행으로 보관.
-- 최신 커밋 sha 가 같으면 GitHub 를 다시 부르지 않는다 (src/vault.ts loadIndex).
-- CREATE 만 있으므로 재실행해도 안전하다.
CREATE TABLE IF NOT EXISTS vault_index_cache (
  repo       TEXT NOT NULL,
  tree_sha   TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  body       TEXT NOT NULL,                 -- JSON [{path,name,folder,date,kind,size,sha(7)}]
  PRIMARY KEY (repo)
);
