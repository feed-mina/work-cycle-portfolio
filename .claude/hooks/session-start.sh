#!/bin/bash
# Claude Code 웹 세션 시작 훅 — 화면 캡처·보고서 작성에 필요한 준비를 미리 해 둔다.
# 실패해도 세션은 계속 뜨게 한다 (각 단계는 독립적으로 실패를 삼킨다).
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# 1) 한글 폰트 — Chromium 캡처·Mermaid 렌더링에서 한글이 네모로 깨지지 않게
if ! fc-list :lang=ko 2>/dev/null | grep -qi "Noto Sans CJK"; then
  if command -v apt-get >/dev/null 2>&1; then
    (apt-get install -y -q fonts-noto-cjk >/dev/null 2>&1 || (apt-get update -q >/dev/null 2>&1 && apt-get install -y -q fonts-noto-cjk >/dev/null 2>&1)) \
      && echo "[session-start] fonts-noto-cjk installed" \
      || echo "[session-start] WARN: fonts-noto-cjk install failed (apt unavailable?)"
  fi
else
  echo "[session-start] Korean font already present"
fi

# 2) Node 의존성 (wrangler · typescript · hono)
if [ -f package.json ]; then
  npm install --no-audit --no-fund >/dev/null 2>&1 \
    && echo "[session-start] npm install ok" \
    || echo "[session-start] WARN: npm install failed"
fi

# 3) 로컬 D1 — 아직 없을 때만 마이그레이션·seed 적용 (ALTER TABLE은 재실행 불가라 최초 1회만)
if [ ! -d .wrangler/state/v3/d1 ] && [ -d migrations ]; then
  ok=1
  for f in migrations/*.sql; do
    npx wrangler d1 execute work-cycle-db --local --file="$f" >/dev/null 2>&1 || ok=0
  done
  [ -f seed/seed.sql ] && npx wrangler d1 execute work-cycle-db --local --file=seed/seed.sql >/dev/null 2>&1 || ok=0
  [ "$ok" = 1 ] && echo "[session-start] local D1 migrated + seeded" || echo "[session-start] WARN: local D1 setup incomplete"
fi

# 4) 로컬 인증 우회값 (.dev.vars는 .gitignore 대상)
if [ ! -f .dev.vars ]; then
  printf 'DEV_EMAIL=dev@example.test\nGEMINI_API_KEY=dev-mock\n' > .dev.vars
  echo "[session-start] .dev.vars created (DEV_EMAIL=dev@example.test)"
fi
exit 0
