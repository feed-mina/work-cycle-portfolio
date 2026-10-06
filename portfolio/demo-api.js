/* demo-api.js — 공개 데모용 가짜 API (운영 화면 public/ 그대로 + 이 파일 하나)
 *
 * 역할
 *  1) window.fetch 를 가로채 /api/* 요청을 네트워크 없이 이 파일 안에서 처리한다.
 *     응답 모양은 src/routes/*.ts · src/personal.ts 가 돌려주는 JSON 과 같다(화면 코드가 그대로 돈다).
 *  2) 모든 상태는 localStorage 한 키(KEY)에만 저장한다. 운영 저장소·로그인·외부 서비스에는 닿지 않는다.
 *  3) 화면이 뜬 뒤 데모 안내 배너를 붙이고, 데모에서 쓸 수 없는 버튼(OAuth 연결·ME 볼트·파일 내려받기)을 막는다.
 *
 * 범위(2026-10-06 합의): 개인 마이페이지(/personal) · 회의록 · 칸반 · 스케줄. 개인용 모드 고정.
 * 빌드: node tools/build-portfolio.mjs 가 public/ 을 portfolio-dist/ 로 복사하면서 이 파일을 <head> 맨 앞에 끼운다.
 */
(() => {
  "use strict";
  const KEY = "portfolio-demo:work-cycle:v2";
  const EMAIL = "guest@example.com";
  const NAME = EMAIL.split("@")[0];
  const UI_VERSION = "personal-v1";
  const AI_LIMIT = 20;
  const QUADS = ["즉시처리", "전략적계획", "축소위임", "취소연기"];
  const V_STATUS = ["확인됨", "불일치→수정", "미확인"];
  const CATEGORIES = ["구직", "학습", "개인 프로젝트"];
  const STEP_ORDER = ["read", "plan", "work", "verify", "share", "retro"];
  const STEP_META = {
    read: { label: "회의록 읽기", time: "08:30" }, plan: { label: "실행 계획", time: "09:30" },
    work: { label: "체크리스트", time: "작업 중" }, verify: { label: "결과 기록", time: "16:50" },
    share: { label: "보고·공유", time: "17:20" }, retro: { label: "하루 회고", time: "17:50" },
  };
  // migrations/0016_personal_mode.sql 의 personal-v1 정의와 같다
  const PROFILE = {
    schema: 1, version: UI_VERSION, title: "개인용 · 나의 준비",
    principles: [
      { title: "오늘의 방향", description: "오늘 이룰 것과 우선순위를 정하고, 끝났는지 알 수 있는 결과를 적습니다.", target: "plan" },
      { title: "직접 이해하고 판단하기", description: "모르는 내용은 예제나 비유로 생각을 확인하고, 내 말로 설명해 봅니다.", target: "check" },
      { title: "결과 기록 및 오늘 하루 검토", description: "실제 결과와 작업 과정을 확인하고, 오늘 배운 점과 내일 첫 행동을 남깁니다.", target: "verif" },
    ],
    planLabels: { user_flow: "오늘 이룰 것", keep: "이어갈 습관·자산", dont_touch: "오늘 하지 않을 일", done_criteria: "완료하면 남길 결과", unknowns: "도움 필요한 점" },
    retroLabels: { work_summary: "오늘 한 일과 배운 점", ai_answer_md: "받은 조언 / 내 생각 (선택)", tomorrow_prompt: "내일 첫 행동" },
    checklist: [
      { id: 1, section: "하루 방향 잡기", text: "오늘 해야 할 일, 프로젝트, 학습 중 우선순위를 골랐다" },
      { id: 2, section: "하루 방향 잡기", text: "끝났는지 알 수 있는 결과 하나를 정했다" },
      { id: 3, section: "하루 방향 잡기", text: "시간과 체력을 고려해 오늘 하지 않을 일을 정했다" },
      { id: 4, section: "집중해서 진행하기", text: "가장 중요한 일을 작은 단계로 시작했다" },
      { id: 5, section: "집중해서 진행하기", text: "모르는 내용은 예제나 비유로 생각을 확인했다" },
      { id: 6, section: "집중해서 진행하기", text: "막힌 점과 다음에 확인할 것을 적었다" },
      { id: 7, section: "결과 확인하기", text: "실제 결과물이나 학습 내용을 직접 확인했다" },
      { id: 8, section: "결과 확인하기", text: "지원·공유할 자료의 사실과 작업 과정을 한 번 더 검토했다" },
      { id: 9, section: "결과 확인하기", text: "다시 볼 수 있는 결과나 근거를 남겼다" },
      { id: 10, section: "하루 마무리하기", text: "오늘 한 일과 배운 점을 기록했다" },
      { id: 11, section: "하루 마무리하기", text: "내일 먼저 할 행동 하나를 정했다" },
      { id: 12, section: "하루 마무리하기", text: "무리하지 않도록 휴식과 다음 일정을 확인했다" },
    ],
  };

  /* ── 날짜·시각 (KST, 운영 shared.ts 와 같은 규칙) ─────────────────────── */
  const kst = () => new Date(Date.now() + 9 * 3600 * 1000);
  const today = () => kst().toISOString().slice(0, 10);
  const nowHm = () => kst().toISOString().slice(11, 16);
  const nowUtc = () => new Date().toISOString().slice(0, 19).replace("T", " ");
  const shift = (date, n) => { const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dow = (date) => new Date(date + "T00:00:00Z").getUTCDay(); // 일=0
  const mondayOf = (date) => shift(date, -((dow(date) + 6) % 7));
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const validDate = (v) => typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));

  /* ── 허구 예시 데이터 ──────────────────────────────────────────────────── */
  function seed() {
    const T = today(), Y = shift(T, -1), mon = mondayOf(T);
    const s = { version: 2, anchor: T, seq: 100, email: EMAIL, settings: { view_mode: "personal", reminder_mode: "personal", ui_version: UI_VERSION } };
    const d = (n) => shift(mon, n); // 이번 주 월=0 … 일=6
    s.schedules = [
      { id: 1, date: d(0), block_type: "업무", title: "포트폴리오 데모 화면 점검", start_time: "10:00", end_time: "12:00", body: "개인 마이페이지·회의록·칸반·스케줄 네 화면이 허구 데이터로 열리는지 확인", status: "완료", memo: "네 화면 모두 열림. 모바일 420px 가로 넘침 0 확인." },
      { id: 2, date: d(0), block_type: "업무", title: "지원서 초안 작성", start_time: "14:00", end_time: "16:00", body: "제조 도메인 에이전틱·자동화 직무 기준으로 경험 3개 고르기", status: "완료", memo: "" },
      { id: 3, date: d(1), block_type: "업무", title: "회의록 AI 요약 흐름 정리", start_time: "09:30", end_time: "11:30", body: "인증 → 입력 검사 → 모델 호출 → 저장 순서를 그림 한 장으로", status: "완료", memo: "" },
      { id: 4, date: d(1), block_type: "회의", title: "스터디 모임 — 기획 하네스 리뷰", start_time: "19:00", end_time: "20:00", body: "회의록 → 기획 산출물 → 승인 흐름 피드백 받기", status: "미완료", memo: "" },
      { id: 5, date: d(2), block_type: "업무", title: "센서 대시보드 케이스 스터디 글쓰기", start_time: "10:00", end_time: "12:00", body: "문제 → 판단 → 결과 순서로 1,500자", status: "미완료", memo: "" },
      { id: 6, date: d(2), block_type: "업무", title: "이력서 링크·데모 주소 최종 확인", start_time: "15:00", end_time: "15:30", body: "모든 링크가 로그인 없이 열리는지", status: "미완료", memo: "" },
      { id: 7, date: d(3), block_type: "업무", title: "면접 예상 질문 10개 답변 정리", start_time: "09:00", end_time: "11:00", body: "30초 답변으로 압축", status: "미완료", memo: "" },
      { id: 8, date: d(4), block_type: "회의", title: "멘토 피드백 (온라인)", start_time: "11:00", end_time: "11:40", body: "포트폴리오 카드 문구 검토", status: "미완료", memo: "" },
      { id: 9, date: d(4), block_type: "업무", title: "주간 회고 작성", start_time: "17:00", end_time: "17:30", body: "이번 주 지원 2건 결과 정리", status: "미완료", memo: "" },
    ].map((r) => ({ user_email: EMAIL, created_by: EMAIL, scope: "personal", confirm_line: null, confirmed: 0, meet_url: null, meet_event_id: null, ...r }));
    // 오늘이 주말이면 오늘 업무가 비지 않게 하나 더
    if (!s.schedules.some((r) => r.date === T && r.block_type === "업무"))
      s.schedules.push({ id: 10, user_email: EMAIL, created_by: EMAIL, scope: "personal", date: T, block_type: "업무", title: "주말 정리 — 다음 주 계획", start_time: "10:00", end_time: "11:00", body: "다음 주 지원 일정과 공부 범위 정하기", status: "미완료", memo: "", confirm_line: null, confirmed: 0, meet_url: null, meet_event_id: null });
    const todayWork = s.schedules.filter((r) => r.date === T && r.block_type === "업무");
    const yWork = s.schedules.filter((r) => r.date === Y && r.block_type === "업무");
    const log = (id, schedule_id, logged_date, logged_time, body, parent_id = null) =>
      ({ id, schedule_id, parent_id, body, logged_date, logged_time, created_at: logged_date + " " + logged_time + ":00", updated_at: logged_date + " " + logged_time + ":00" });
    s.logs = [];
    if (yWork[0]) s.logs.push(log(1, yWork[0].id, Y, "10:20", "화면 캡처를 먼저 모아 두니 설명이 빨라짐"), log(2, yWork[0].id, Y, "11:05", "모바일에서 표가 넘쳐서 가로 스크롤 박스로 감쌈"), log(3, yWork[0].id, Y, "11:30", "↳ 420px·360px 둘 다 다시 확인함", 2));
    if (todayWork[0]) s.logs.push(log(4, todayWork[0].id, T, "09:40", "어제 회고에서 정한 첫 행동부터 시작"), log(5, todayWork[0].id, T, "10:15", "허구 데이터만 쓰는지 다시 확인 — 실제 이름·회사명 0건"));
    s.plans = {};
    s.retros = { [Y]: { cycle_date: Y, ui_version: UI_VERSION, work_summary: "포트폴리오 카드 3장 문구를 고치고 데모 링크를 확인했다. 설명이 길어지는 카드는 한 줄로 줄이는 편이 읽기 쉬웠다.", ai_answer_md: "숫자보다 '누가 무엇을 판단하는가'를 먼저 쓰라는 조언을 받음.", tomorrow_prompt: "회의록 AI 요약 흐름을 그림 한 장으로 정리하고, 실패 경로 두 개를 적는다", updated_at: Y + " 09:10:00" } };
    s.checks = { [T]: { 1: { checked: 1, memo: "" }, 2: { checked: 1, memo: "데모 네 화면이 열리면 완료" }, 3: { checked: 1, memo: "" }, 4: { checked: 1, memo: "" } } };
    s.results = [
      { id: 1, cycle_date: T, item: "데모 화면 4개 렌더링 확인", formula: "4/4 화면이 운영과 같은 모양", method: "브라우저 1280px·420px 직접 열어 비교", result: "4/4 · 가로 넘침 0", status: "확인됨", category: "개인 프로젝트" },
      { id: 2, cycle_date: T, item: "지원서 초안 사실 검토", formula: "경험 3개 모두 근거 링크 있음", method: "링크 직접 열기", result: "2/3 · 하나는 비공개 저장소라 공개 사본 필요", status: "불일치→수정", category: "구직" },
      { id: 3, cycle_date: Y, item: "회의록 모바일 카드 개선", formula: "제목이 두 줄 이내로 보임", method: "360px 캡처", result: "두 줄 이내", status: "확인됨", category: "개인 프로젝트" },
    ].map((r) => ({ user_email: EMAIL, ui_version: UI_VERSION, deleted_at: null, ...r }));
    s.stepMarks = {};
    s.habits = [
      { id: 1, name: "물 마시기", emoji: "💧", goal: 3, category: null, repeat_type: "everyday", repeat_days: "1,2,3,4,5,6,7", active: 1, sort: 1 },
      { id: 2, name: "30분 공부", emoji: "📚", goal: 1, category: null, repeat_type: "daily", repeat_days: "1,2,3,4,5", active: 1, sort: 2 },
      { id: 3, name: "운동", emoji: "🏃", goal: 1, category: null, repeat_type: "selected", repeat_days: "1,3,5", active: 1, sort: 3 },
      { id: 4, name: "회고 공유", emoji: "💬", goal: 2, category: null, repeat_type: "weekly", repeat_days: "", active: 1, sort: 4 },
    ].map((b) => ({ user_email: EMAIL, ...b }));
    s.habitTaps = [];
    const tap = (button_id, date, time) => s.habitTaps.push({ button_id, date, tapped_time: time });
    for (let i = 0; i < 7; i++) {
      const date = d(i); if (date >= T) break;
      tap(1, date, "08:40"); tap(1, date, "12:10"); if (i % 2 === 0) tap(1, date, "16:30");
      if (i < 5) tap(2, date, "21:00");
      if ([0, 2, 4].includes(i)) tap(3, date, "07:30");
      if (i === 1) tap(4, date, "18:00");
    }
    if (T !== d(0) || dow(T) === 1) tap(1, T, "08:35");
    s.meetings = [
      { id: 1, date: Y, title: "스터디 — 회의록 AI 요약 흐름 리뷰", body_mode: "full_md", link: null, schedule_id: null, gh_issue_url: null, body_md: [
        `# ${Y} 스터디 — 회의록 AI 요약 흐름 리뷰`, "## 참석자", "- 나, 스터디원 2명", "## 안건", "- 요약 API 처리 순서 그림", "- 실패 경로 테스트 범위",
        "## 요약", "요청 원문은 저장하지 않고 생성된 회의록만 저장하는 설계를 유지하기로 했다. 모델은 Workers AI 를 먼저 부르고 실패하면 Gemini 로 넘기며, 둘 다 실패하면 저장 전에 멈춘다. 하루 호출 한도(20회)는 비용 상한으로 둔다. 실패 경로 실행 테스트는 다음 모임까지 각자 하나씩 맡는다.",
        "## 할 일 (Action Items)", "- [ ] 처리 순서 그림을 포트폴리오 카드에 넣기 — @나 ~이번 주 [priority:High]", "- [ ] 401·429·502 실패 경로 실행 테스트 — @나 ~다음 모임 [priority:Medium]", "## 참고 / 링크", "- 없음",
      ].join("\n") },
      { id: 2, date: shift(T, -3), title: "멘토 피드백 — 포트폴리오 카드 문구", body_mode: "full_md", link: null, schedule_id: null, gh_issue_url: null, body_md: [
        `# ${shift(T, -3)} 멘토 피드백 — 포트폴리오 카드 문구`, "## 참석자", "- 나, 멘토", "## 안건", "- 카드 3장 문구", "- 라이브 데모 주소",
        "## 요약", "카드마다 '누가 무엇을 판단하는가'를 첫 줄에 두기로 했다. 숫자는 근거가 있는 것만 남기고 나머지는 뺀다. 데모는 로그인 없이 열려야 하며 허구 데이터임을 화면에 적는다.",
        "## 할 일 (Action Items)", "- [ ] 카드 첫 줄을 판단 기준 문장으로 바꾸기 — @나 ~내일 [priority:High]", "- [ ] 근거 없는 숫자 3개 삭제 — @나 ~내일 [priority:Medium]", "## 참고 / 링크", "- 없음",
      ].join("\n") },
      { id: 3, date: shift(T, -7), title: "지난주 회고 메모 (원문 링크만)", body_mode: "link_only", link: "https://example.com/notes/weekly-retro", schedule_id: null, gh_issue_url: null, body_md: null },
    ].map((m) => ({ created_by: EMAIL, scope: "personal", created_at: m.date + " 18:00:00", ...m }));
    s.reads = [2, 3]; // 읽은 회의록 id
    s.notes = [
      { id: 1, date: Y, title: "스터디 메모 — 요약 흐름", purpose: "요약 API 처리 순서를 확정한다", attendees: "나, 스터디원 2명", schedule_id: null, meeting_id: 1, updated_at: Y + " 19:40:00",
        outline: [
          { d: 0, m: "decide", t: "원문은 DB에 저장하지 않고 생성된 회의록만 저장", who: "", due: "" },
          { d: 1, m: "", t: "실패하면 저장 전에 멈춘다 (사용량 기록도 없음)", who: "", due: "" },
          { d: 0, m: "todo", t: "처리 순서 그림을 카드에 넣기", who: "나", due: shift(T, 2) },
          { d: 0, m: "need", t: "하루 한도 20회가 충분한지 사용 로그로 확인", who: "", due: "" },
          { d: 0, m: "star", t: "임베딩·벡터 검색은 쓰지 않는다 — 회의 한 건 요약이라 검색 대상이 없음", who: "", due: "" },
        ] },
      { id: 2, date: shift(T, -3), title: "멘토 피드백 메모", purpose: "카드 문구 방향을 정한다", attendees: "나, 멘토", schedule_id: null, meeting_id: null, updated_at: shift(T, -3) + " 12:10:00",
        outline: [
          { d: 0, m: "decide", t: "첫 줄은 '누가 무엇을 판단하는가'", who: "", due: "" },
          { d: 0, m: "todo", t: "근거 없는 숫자 3개 삭제", who: "나", due: shift(T, -2) },
        ] },
    ].map((n) => ({ user_email: EMAIL, scope: "personal", ...n }));
    s.kanban = [
      { id: 1, quadrant: "즉시처리", title: "처리 순서 그림을 포트폴리오 카드에 넣기", due: "~이번 주", color: "#E2445C", sort: 1 },
      { id: 2, quadrant: "즉시처리", title: "지원서 — 비공개 저장소 경험을 공개 사본으로 교체", due: "~내일", color: "#E2445C", sort: 2 },
      { id: 3, quadrant: "전략적계획", title: "센서 대시보드 케이스 스터디 글", due: "", color: "#579BFC", sort: 3 },
      { id: 4, quadrant: "전략적계획", title: "401·429·502 실패 경로 실행 테스트", due: "~다음 모임", color: "#579BFC", sort: 4 },
      { id: 5, quadrant: "축소위임", title: "데모 화면 캡처 다시 찍기 (다크 모드)", due: "", color: "#FDAB3D", sort: 5 },
      { id: 6, quadrant: "취소연기", title: "주간보고 양식 꾸미기", due: "", color: "#9699A6", sort: 6 },
      { id: 7, quadrant: "즉시처리", title: "카드 첫 줄을 판단 기준 문장으로 바꾸기", due: "~내일", color: "#E2445C", sort: 0, done_at: shift(T, -2) + " 08:30:00" },
    ].map((k) => ({ user_email: EMAIL, name: NAME, gh_repo: null, gh_issue_no: null, gh_state: null, scope: "personal", done_at: null, ...k }));
    s.gitTargets = [];
    s.aiCalls = 0;
    // 지난 6주 도넛 이력 — 평일만, 정해진 패턴(허구)
    const PATTERN = [6, 5, 4, 6, 3, 6, 5, 2, 6, 4, 6, 6, 3, 5, 6, 4, 6, 5, 6, 2, 6, 6, 4, 5, 6, 3, 6, 6, 5, 4];
    s.history = {};
    let k = 0;
    for (let i = 42; i >= 1; i--) {
      const date = shift(T, -i);
      if (dow(date) === 0 || dow(date) === 6) continue;
      const n = PATTERN[k++ % PATTERN.length];
      s.history[date] = Object.fromEntries(STEP_ORDER.map((st, idx) => [st, idx < n]));
    }
    return s;
  }

  /* ── 저장소 ────────────────────────────────────────────────────────────── */
  let S = null;
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (raw && raw.version === 2 && raw.anchor === today()) { S = raw; return; }
    } catch { /* 깨진 저장값은 버린다 */ }
    S = seed(); save();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* 사생활 보호 모드 등 — 이번 화면에서만 체험 */ } }
  const nextId = () => ++S.seq;
  const clean = (x, max = 3000) => (typeof x === "string" ? x.trim().slice(0, max) : "");

  /* ── 응답 ─────────────────────────────────────────────────────────────── */
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  const err = (message, status = 400) => json({ error: message }, status);
  const NOT_IN_DEMO = "공개 데모에서는 제공하지 않는 기능입니다";

  /* ── 개인 사이클 계산 (src/personal.ts personalBoard 와 같은 규칙) ───────── */
  function checklistFor(date) {
    const day = S.checks[date] || {};
    return { date, version: UI_VERSION, items: PROFILE.checklist.map((i) => ({ ...i, checked: day[i.id]?.checked ? 1 : 0, memo: day[i.id]?.memo || "" })) };
  }
  function stepsFor(date) {
    const marks = S.stepMarks[date] || [];
    const items = checklistFor(date).items;
    return {
      read: marks.includes("read"), plan: !!S.plans[date], work: items.every((i) => i.checked),
      verify: S.results.some((r) => r.cycle_date === date && !r.deleted_at), share: marks.includes("share"), retro: !!S.retros[date],
    };
  }
  function board(date) {
    const steps = stepsFor(date);
    return { date, board: [{ email: EMAIL, name: NAME, steps, done: Object.values(steps).filter(Boolean).length, total: 6 }], step_meta: STEP_META };
  }
  function cycleHistory(from, to) {
    const days = [];
    for (let date = from; date <= to; date = shift(date, 1)) {
      let steps = null;
      if (date === today()) steps = stepsFor(date);
      else if (S.history[date]) steps = S.history[date];
      else if (date < today() && (S.retros[date] || S.plans[date] || S.checks[date] || S.results.some((r) => r.cycle_date === date))) steps = stepsFor(date);
      if (steps) days.push({ date, steps, done: STEP_ORDER.filter((st) => steps[st]).length });
    }
    return { from, to, step_meta: STEP_META, days, personal: true };
  }
  function widgetNow() {
    const k = kst(); const h = k.getUTCHours() + k.getUTCMinutes() / 60;
    const current = h < 9.5 ? "read" : h < 10.5 ? "plan" : h < 16 + 50 / 60 ? "work" : h < 17 + 20 / 60 ? "verify" : h < 17 + 50 / 60 ? "share" : "retro";
    return { date: today(), current, meta: STEP_META[current] };
  }
  function reminderText(slot) {
    const T = today();
    if ([1000, 1230, 1700].includes(slot)) {
      const sections = slot === 1000 ? ["하루 방향 잡기"] : slot === 1230 ? ["집중해서 진행하기"] : ["결과 확인하기", "하루 마무리하기"];
      const left = checklistFor(T).items.filter((i) => sections.includes(i.section) && !i.checked);
      return left.length ? ["📋 work-cycle 개인용 점검", ...left.map((i) => "□ " + i.text)].join("\n") : null;
    }
    const results = S.results.filter((r) => r.cycle_date === T && !r.deleted_at);
    return [`${slot === 825 ? "🌅" : "🌇"} work-cycle 개인용 ${slot === 825 ? "아침 계획" : "결과 기록 및 오늘 하루 검토"} (${T})`,
      `개인 사이클 ${board(T).board[0].done}/6`, `결과 기록 ${results.length}건 · 미확인 ${results.filter((r) => r.status === "미확인").length}건`,
      "개인 화면에서 오늘의 기록을 확인해주세요."].join("\n");
  }
  function dayMarkdown(date) {
    const plan = S.plans[date], retro = S.retros[date];
    const lines = (row, labels) => Object.entries(labels).map(([k, label]) => `- **${label}**: ${String(row?.[k] ?? "").trim() || "—"}`).join("\n");
    const memo = [];
    for (const sch of S.schedules.filter((r) => r.date === date && r.block_type === "업무")) {
      memo.push("", `### ${sch.status === "완료" ? "✓ " : ""}${sch.title}${sch.start_time ? ` (${sch.start_time}${sch.end_time ? "~" + sch.end_time : ""})` : ""}`);
      if ((sch.memo || "").trim()) memo.push(`> **정리 메모**: ${sch.memo}`, "");
      const roots = S.logs.filter((l) => l.schedule_id === sch.id && l.logged_date === date && !l.parent_id);
      if (!roots.length) memo.push("(메모 없음)");
      for (const l of roots) { memo.push(`- ${l.logged_time} ${l.body}`); for (const r of S.logs.filter((x) => x.parent_id === l.id)) memo.push(`  - ↳ ${r.logged_time} ${r.body}`); }
    }
    return [`# ${date} work-cycle 개인 기록 (공개 데모 · 허구 예시)`, "", "## 실행 계획", plan ? lines(plan, PROFILE.planLabels) : "기록 없음",
      "", "## 메모", ...(memo.length ? memo.slice(1) : ["기록 없음"]), "", "## 하루 회고", retro ? lines(retro, PROFILE.retroLabels) : "기록 없음", ""].join("\n");
  }

  /* ── 라우터 ────────────────────────────────────────────────────────────── */
  const routes = [];
  const on = (method, pattern, handler) => routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), handler });

  // 공통
  on("GET", "/api/me", () => json({ email: EMAIL, today: today(), team_member: true, view_mode: "personal" }));
  on("GET", "/api/config", () => json({ kakao_js_key: null }));
  on("GET", "/api/health", () => json({ ok: true, date: today(), demo: true }));
  on("POST", "/api/team-membership/leave", () => json({ ok: true, team_member: false }));
  on("GET", "/api/widget/now", () => json(widgetNow()));

  // 개인 설정·화면 정의
  on("GET", "/api/personal/settings", () => json(S.settings));
  on("PUT", "/api/personal/settings", (q, b) => {
    for (const k of ["view_mode", "reminder_mode"]) if (b[k] !== undefined && !["company", "personal"].includes(b[k])) return err("화면 또는 알림 모드가 올바르지 않습니다");
    if (b.view_mode !== undefined && b.view_mode !== "personal") return err("공개 데모는 개인용 화면으로 고정되어 있습니다");
    if (b.reminder_mode !== undefined) S.settings.reminder_mode = b.reminder_mode;
    save(); return json({ ok: true });
  });
  on("GET", "/api/personal/ui", () => json(PROFILE));
  on("GET", "/api/personal/ui/history", () => json({ versions: [{ id: UI_VERSION, label: "개인용 첫 화면", created_at: "2026-09-26 00:00:00" }], events: [], settings: S.settings }));

  // 개인 사이클 보드 · 단계 표시
  on("GET", "/api/personal/board", (q) => { const date = q.get("date") || today(); if (!validDate(date)) return err("날짜가 올바르지 않습니다"); return json(board(date)); });
  on("POST", "/api/personal/step_marks", (q, b) => {
    if (!["read", "share"].includes(b.step || "")) return err("이 단계는 실제 기록으로 완료됩니다");
    const T = today(); S.stepMarks[T] = [...new Set([...(S.stepMarks[T] || []), b.step])]; save(); return json({ ok: true });
  });

  // 체크리스트
  on("GET", "/api/personal/checklist", (q) => { const date = q.get("date") || today(); if (!validDate(date)) return err("날짜가 올바르지 않습니다"); return json(checklistFor(date)); });
  on("POST", "/api/personal/checks", (q, b) => {
    const date = b.date || today(), id = Number(b.item_id);
    if (!validDate(date) || typeof b.checked !== "boolean") return err("입력 값이 올바르지 않습니다");
    if (!PROFILE.checklist.some((i) => i.id === id)) return err("이 날짜의 체크리스트 항목이 아닙니다", 404);
    const day = (S.checks[date] ??= {}); day[id] = { ...(day[id] || { memo: "" }), checked: b.checked ? 1 : 0 }; save(); return json({ ok: true });
  });
  on("PUT", "/api/personal/checklist/:itemId/memo", (q, b, p) => {
    const date = b.date || today(), id = Number(p.itemId);
    if (!validDate(date) || typeof b.memo !== "string" || b.memo.length > 1000) return err("입력 값이 올바르지 않습니다");
    if (!PROFILE.checklist.some((i) => i.id === id)) return err("이 날짜의 체크리스트 항목이 아닙니다", 404);
    const memo = clean(b.memo, 1000); const day = (S.checks[date] ??= {}); day[id] = { ...(day[id] || { checked: 0 }), memo }; save();
    return json({ ok: true, memo, deleted: memo === "" });
  });

  // 실행 계획 · 회고
  on("GET", "/api/personal/plan/prefill", () => {
    const T = today();
    const prev = Object.values(S.retros).filter((r) => r.cycle_date < T && r.tomorrow_prompt).sort((a, b) => b.cycle_date.localeCompare(a.cycle_date))[0] || null;
    return json({ prefill: prev ? { id: 1, cycle_date: prev.cycle_date, tomorrow_prompt: prev.tomorrow_prompt } : null, today: S.plans[T] || null, retro: S.retros[T] || null });
  });
  on("POST", "/api/personal/plan", (q, b) => {
    if (!clean(b.user_flow)) return err("오늘 이룰 것을 적어주세요");
    const keys = Object.keys(PROFILE.planLabels), T = today();
    const prompt = keys.map((k) => `[${PROFILE.planLabels[k]}] ${clean(b[k])}`).join("\n");
    S.plans[T] = { cycle_date: T, ui_version: UI_VERSION, ...Object.fromEntries(keys.map((k) => [k, clean(b[k])])), final_prompt: prompt, updated_at: nowUtc() };
    save(); return json({ ok: true, final_prompt: prompt });
  });
  on("POST", "/api/personal/retro", (q, b) => {
    if (!clean(b.work_summary)) return err("오늘 한 일과 배운 점을 적어주세요");
    const T = today();
    S.retros[T] = { cycle_date: T, ui_version: UI_VERSION, work_summary: clean(b.work_summary), ai_answer_md: clean(b.ai_answer_md), tomorrow_prompt: clean(b.tomorrow_prompt), updated_at: nowUtc() };
    save(); return json({ ok: true });
  });

  // 결과 기록
  on("GET", "/api/personal/verifications", (q) => {
    const date = q.get("date") || today(); if (!validDate(date)) return err("날짜가 올바르지 않습니다");
    return json({ date, rows: S.results.filter((r) => r.cycle_date === date && !r.deleted_at).sort((a, b) => b.id - a.id) });
  });
  on("POST", "/api/personal/verifications", (q, b) => {
    const date = b.date || today();
    if (!validDate(date) || !clean(b.item, 200) || !V_STATUS.includes(String(b.status ?? "미확인"))) return err("한 일·날짜·확인 상태를 확인해주세요");
    const row = { id: nextId(), user_email: EMAIL, cycle_date: date, ui_version: UI_VERSION, item: clean(b.item, 200), formula: clean(b.formula), method: clean(b.method), result: clean(b.result), status: b.status ?? "미확인", category: CATEGORIES.includes(String(b.category)) ? String(b.category) : "개인 프로젝트", deleted_at: null };
    S.results.push(row); save(); return json({ ok: true, id: row.id });
  });
  on("PATCH", "/api/personal/verifications/:id", (q, b, p) => {
    const row = S.results.find((r) => String(r.id) === p.id && !r.deleted_at); if (!row) return err("내 결과 기록을 찾을 수 없습니다", 404);
    const next = { ...row };
    for (const k of ["item", "formula", "method", "result", "status"]) if (b[k] !== undefined) next[k] = clean(b[k], k === "item" ? 200 : 3000);
    if (!next.item || !V_STATUS.includes(next.status)) return err("항목과 상태를 확인해주세요");
    Object.assign(row, next); save(); return json({ ok: true });
  });
  on("DELETE", "/api/personal/verifications/:id", (q, b, p) => {
    const row = S.results.find((r) => String(r.id) === p.id && !r.deleted_at); if (row) { row.deleted_at = nowUtc(); save(); }
    return json({ ok: true, deleted: row ? 1 : 0 });
  });
  on("GET", "/api/personal/reminders/preview", () => json({ text: reminderText(1740) }));
  on("GET", "/api/personal/cycle_history", (q) => { const from = q.get("from") || today(), to = q.get("to") || from; if (!validDate(from) || !validDate(to) || from > to) return err("기간을 확인해주세요"); return json(cycleHistory(from, to)); });
  on("GET", "/api/personal/dashboard", (q) => {
    const from = q.get("from") || today(), to = q.get("to") || from, cat = q.get("category") || "";
    if (!validDate(from) || !validDate(to) || from > to) return err("기간(최대 1년)과 분류를 확인해주세요");
    const results = S.results.filter((r) => r.cycle_date >= from && r.cycle_date <= to && !r.deleted_at && (!cat || r.category === cat)).sort((a, b) => b.cycle_date.localeCompare(a.cycle_date) || b.id - a.id);
    const retro = Object.values(S.retros).filter((r) => r.cycle_date >= from && r.cycle_date <= to).sort((a, b) => b.cycle_date.localeCompare(a.cycle_date))[0] || null;
    return json({ from, to, category: cat, results, tasks: [], focus: [], next: retro && { cycle_date: retro.cycle_date, tomorrow_prompt: retro.tomorrow_prompt },
      summary: { results: results.length, tasks: 0, done: 0, focus_minutes: 0, unchecked: results.filter((r) => r.status === "미확인").length } });
  });
  on("GET", "/api/personal/journal", (q) => {
    const from = q.get("from") || today(), to = q.get("to") || from;
    const rows = [...Object.values(S.plans).map((p) => ({ cycle_date: p.cycle_date, ui_version: UI_VERSION, kind: "실행 계획", body: p.final_prompt })),
      ...Object.values(S.retros).map((r) => ({ cycle_date: r.cycle_date, ui_version: UI_VERSION, kind: "하루 회고", body: [r.work_summary, r.ai_answer_md, r.tomorrow_prompt].join("\n") }))]
      .filter((r) => r.cycle_date >= from && r.cycle_date <= to).sort((a, b) => b.cycle_date.localeCompare(a.cycle_date));
    return json({ rows });
  });

  // 스케줄 · 업무 메모
  const withLatestLog = (s) => {
    const last = S.logs.filter((l) => l.schedule_id === s.id).sort((a, b) => b.id - a.id)[0];
    return { ...s, latest_log: last ? last.body : null, latest_log_time: last ? last.logged_time : null };
  };
  on("GET", "/api/schedules", (q) => {
    const from = validDate(q.get("from")) ? q.get("from") : today(), to = validDate(q.get("to")) ? q.get("to") : today();
    const rows = S.schedules.filter((s) => s.date >= from && s.date <= to).sort((a, b) => a.date.localeCompare(b.date) || String(a.start_time || "").localeCompare(String(b.start_time || ""))).map(withLatestLog);
    return json({ rows, scope: "personal" });
  });
  on("POST", "/api/schedules", (q, b) => {
    if (!clean(b.title, 200) || !validDate(b.date)) return err("date(YYYY-MM-DD)와 title은 필수");
    const row = { id: nextId(), user_email: EMAIL, created_by: EMAIL, scope: "personal", date: b.date, block_type: b.block_type === "회의" ? "회의" : "업무", title: clean(b.title, 200), start_time: b.start_time || null, end_time: b.end_time || null, body: b.body || null, status: b.status === "완료" ? "완료" : "미완료", memo: null, confirm_line: null, confirmed: 0, meet_url: null, meet_event_id: null };
    S.schedules.push(row); save(); return json({ ok: true, id: row.id });
  });
  on("PATCH", "/api/schedules/:id", (q, b, p) => {
    const own = S.schedules.find((s) => String(s.id) === p.id); if (!own) return err("내가 만든 일정만 고칠 수 있습니다", 404);
    const title = b.title !== undefined ? clean(b.title, 200) : own.title; if (!title) return err("제목은 비울 수 없습니다");
    if (b.status !== undefined && !["미완료", "완료"].includes(b.status)) return err("상태는 미완료 / 완료 중 하나여야 합니다");
    Object.assign(own, {
      title, block_type: (b.block_type !== undefined ? b.block_type : own.block_type) === "회의" ? "회의" : "업무",
      start_time: b.start_time !== undefined ? (b.start_time || null) : own.start_time, end_time: b.end_time !== undefined ? (b.end_time || null) : own.end_time,
      body: b.body !== undefined ? (b.body || null) : own.body, date: b.date !== undefined && validDate(b.date) ? b.date : own.date,
      status: b.status !== undefined ? b.status : own.status, confirm_line: b.confirm_line !== undefined ? (b.confirm_line || null) : own.confirm_line,
      confirmed: b.confirmed !== undefined ? (b.confirmed ? 1 : 0) : own.confirmed, memo: b.memo !== undefined ? (b.memo || null) : own.memo,
    });
    save(); return json({ ok: true });
  });
  on("DELETE", "/api/schedules/:id", (q, b, p) => {
    const n = S.schedules.length; S.schedules = S.schedules.filter((s) => String(s.id) !== p.id); S.logs = S.logs.filter((l) => String(l.schedule_id) !== p.id);
    save(); return json({ ok: true, deleted: n - S.schedules.length });
  });
  on("POST", "/api/schedules/:id/meet", () => err("공개 데모에서는 구글 캘린더 연결을 제공하지 않습니다"));
  on("DELETE", "/api/schedules/:id/meet", () => json({ ok: true }));
  on("GET", "/api/work-logs", (q) => {
    const date = validDate(q.get("date")) ? q.get("date") : today();
    const schedules = S.schedules.filter((s) => s.date === date && s.block_type === "업무").sort((a, b) => (a.status === "미완료" ? 0 : 1) - (b.status === "미완료" ? 0 : 1) || String(a.start_time || "").localeCompare(String(b.start_time || "")) || a.id - b.id);
    const logs = S.logs.filter((l) => l.logged_date === date).sort((a, b) => b.id - a.id).map((l) => ({ ...l, schedule_title: S.schedules.find((s) => s.id === l.schedule_id)?.title || "" }));
    return json({ date, schedules, logs, replies_ready: true });
  });
  on("POST", "/api/schedules/:id/logs", (q, b, p) => {
    const body = clean(b.body, 1000); if (!body) return err("메모 내용을 입력하세요");
    const sch = S.schedules.find((s) => String(s.id) === p.id); if (!sch) return err("내 업무 일정을 찾을 수 없습니다", 404);
    if (sch.block_type !== "업무") return err("업무 일정에만 메모를 기록할 수 있습니다");
    let parentId = null, loggedDate = today();
    if (b.parent_id !== undefined && b.parent_id !== null && b.parent_id !== "") {
      const parent = S.logs.find((l) => l.id === Number(b.parent_id) && l.schedule_id === sch.id); if (!parent) return err("답글을 달 메모를 찾을 수 없습니다", 404);
      parentId = parent.parent_id ?? parent.id; loggedDate = parent.logged_date;
    } else if (sch.date !== today()) return err("오늘 업무에만 새 메모를 기록할 수 있습니다");
    const row = { id: nextId(), schedule_id: sch.id, parent_id: parentId, body, logged_date: loggedDate, logged_time: nowHm(), created_at: nowUtc(), updated_at: nowUtc() };
    S.logs.push(row); save();
    return json({ ok: true, id: row.id, schedule_id: sch.id, parent_id: parentId, body, logged_date: loggedDate, logged_time: row.logged_time });
  });
  on("PATCH", "/api/work-logs/:id", (q, b, p) => {
    const body = clean(b.body, 1000); if (!body) return err("메모 내용을 입력하세요");
    const log = S.logs.find((l) => String(l.id) === p.id); if (!log) return err("수정할 메모를 찾을 수 없습니다", 404);
    log.body = body; log.updated_at = nowUtc(); save(); return json({ ok: true });
  });
  on("DELETE", "/api/work-logs/:id", (q, b, p) => {
    const n = S.logs.length; S.logs = S.logs.filter((l) => String(l.id) !== p.id && String(l.parent_id) !== p.id);
    if (n === S.logs.length) return err("삭제할 메모를 찾을 수 없습니다", 404); save(); return json({ ok: true });
  });
  on("GET", "/api/month", (q) => {
    const ym = /^\d{4}-\d{2}$/.test(q.get("ym") || "") ? q.get("ym") : today().slice(0, 7);
    const from = ym + "-01", to = ym + "-31", T = today();
    const inRange = (d) => d >= from && d <= to;
    const hist = cycleHistory(from, to > T ? T : to).days;
    const verifs = S.results.filter((r) => !r.deleted_at && inRange(r.cycle_date)).reduce((a, r) => { a[r.cycle_date] = (a[r.cycle_date] || 0) + 1; return a; }, {});
    for (const h of hist) if (h.steps.verify && !verifs[h.date]) verifs[h.date] = 1;
    const checks = {};
    for (const h of hist) { const n = h.date === T ? checklistFor(T).items.filter((i) => i.checked).length : h.steps.work ? 12 : Math.min(11, h.done * 2); if (n) checks[h.date] = n; }
    return json({ ym, scope: "personal",
      schedules: S.schedules.filter((s) => inRange(s.date)).map((s) => ({ date: s.date, title: s.title, block_type: s.block_type })),
      meetings: S.meetings.filter((m) => inRange(m.date)).map((m) => ({ id: m.id, date: m.date, title: m.title, gh_issue_url: m.gh_issue_url })),
      verifs: Object.entries(verifs).map(([d, n]) => ({ d, n })), checks: Object.entries(checks).map(([d, n]) => ({ d, n })),
      retros: hist.filter((h) => h.steps.retro).map((h) => ({ d: h.date })) });
  });
  on("GET", "/api/cycle_history", (q) => {
    const from = validDate(q.get("from")) ? q.get("from") : today(), to = validDate(q.get("to")) ? q.get("to") : today();
    return json(cycleHistory(from, to));
  });

  // 퀵 기록 (습관 버튼)
  const canTap = (b, date) => { const d = dow(date) === 0 ? 7 : dow(date); const r = b.repeat_type; if (r === "daily") return d <= 5; if (r === "everyday" || r === "weekly") return true; if (r === "weekend") return d >= 6; return String(b.repeat_days || "").split(",").includes(String(d)); };
  on("GET", "/api/habits", (q) => {
    const from = validDate(q.get("from")) ? q.get("from") : today(), to = validDate(q.get("to")) ? q.get("to") : today();
    const taps = S.habitTaps.filter((t) => t.date >= from && t.date <= to);
    const rec = {}; for (const t of taps) { const k = t.button_id + "|" + t.date; rec[k] = (rec[k] || 0) + 1; }
    return json({ buttons: S.habits.filter((b) => b.active).sort((a, b) => a.sort - b.sort || a.id - b.id),
      records: Object.entries(rec).map(([k, count]) => { const [button_id, date] = k.split("|"); return { button_id: Number(button_id), date, count }; }), taps });
  });
  on("POST", "/api/habits", (q, b) => {
    if (!clean(b.name, 80)) return err("이름은 필수입니다");
    const repeat = ["selected", "weekly", "everyday", "weekend"].includes(b.repeat_type) ? b.repeat_type : "daily";
    const days = Array.isArray(b.repeat_days) ? b.repeat_days : String(b.repeat_days || "").split(",");
    const repeatDays = repeat === "daily" ? "1,2,3,4,5" : repeat === "everyday" ? "1,2,3,4,5,6,7" : repeat === "weekend" ? "6,7" : repeat === "selected" ? [...new Set(days.map(Number).filter((n) => n >= 1 && n <= 7))].sort().join(",") : "";
    if (repeat === "selected" && !repeatDays) return err("반복할 요일을 하나 이상 선택하세요");
    S.habits.push({ id: nextId(), user_email: EMAIL, name: clean(b.name, 80), emoji: (b.emoji || "🔥").slice(0, 8), goal: Math.max(1, Number(b.goal) || 1), category: b.category ?? null, repeat_type: repeat, repeat_days: repeatDays, active: 1, sort: S.habits.length + 1 });
    save(); return json({ ok: true });
  });
  on("POST", "/api/habits/:id/tap", (q, b, p) => {
    const btn = S.habits.find((h) => String(h.id) === p.id && h.active); if (!btn) return err("퀵 기록 버튼이 없습니다", 404);
    const date = validDate(b.date) ? b.date : today(); if (!canTap(btn, date)) return err("이 버튼은 오늘 기록하는 항목이 아닙니다");
    const time = nowHm(); S.habitTaps.push({ button_id: btn.id, date, tapped_time: time }); save(); return json({ ok: true, date, time });
  });
  on("DELETE", "/api/habits/:id", (q, b, p) => { const btn = S.habits.find((h) => String(h.id) === p.id); if (btn) { btn.active = 0; save(); } return json({ ok: true }); });

  // 칸반
  on("GET", "/api/kanban", () => json({ rows: [...S.kanban].sort((a, b) => a.sort - b.sort || a.id - b.id), quads: QUADS, scope: "personal" }));
  on("POST", "/api/kanban", (q, b) => {
    if (!clean(b.title, 200) || !QUADS.includes(b.quadrant)) return err("title과 올바른 quadrant 필수");
    const repo = clean(b.gh_repo, 100) || null, no = Number(b.gh_issue_no) > 0 ? Number(b.gh_issue_no) : null;
    if (!!repo !== !!no) return err("이슈를 연결하려면 레포와 번호가 모두 필요합니다");
    S.kanban.push({ id: nextId(), user_email: EMAIL, name: NAME, quadrant: b.quadrant, title: clean(b.title, 200), due: b.due ?? null, color: b.color ?? "#579BFC", gh_repo: repo, gh_issue_no: no, gh_state: no ? (b.gh_state ?? "open") : null, scope: "personal", sort: S.kanban.length + 1, done_at: null });
    save(); return json({ ok: true });
  });
  on("PATCH", "/api/kanban/:id", (q, b, p) => {
    const card = S.kanban.find((k) => String(k.id) === p.id); if (!card) return err("카드가 없습니다", 404);
    if (b.done !== undefined) { if (typeof b.done !== "boolean") return err("done 은 true/false 여야 합니다"); card.done_at = b.done ? nowUtc() : null; save(); return json({ ok: true, changed: 1 }); }
    if (!QUADS.includes(b.quadrant || "")) return err("올바른 quadrant 필수");
    card.quadrant = b.quadrant; save(); return json({ ok: true });
  });
  on("DELETE", "/api/kanban/:id", (q, b, p) => { const n = S.kanban.length; S.kanban = S.kanban.filter((k) => String(k.id) !== p.id); save(); return json({ ok: true, deleted: n - S.kanban.length }); });
  on("GET", "/api/github/repos", () => json({ repos: [{ full_name: "demo-user/work-cycle-demo", private: false, push: true, updated_at: today() + "T09:00:00Z" }], total: 1, cached: true, fetched_at: null, default_repo: null, github_calls: 0 }));
  on("GET", "/api/github/issues", (q) => {
    const repo = q.get("repo") || "demo-user/work-cycle-demo";
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return err("기본 git 대상을 먼저 저장하거나 owner/repo를 입력하세요");
    const linked = new Set(S.kanban.filter((k) => k.gh_repo === repo).map((k) => k.gh_issue_no));
    const issues = [{ number: 12, title: "회의록 카드 — 모바일에서 제목 두 줄 넘침" }, { number: 15, title: "칸반 완료 카드에 완료 날짜 표시" }, { number: 18, title: "도넛 달력 키보드 포커스 툴팁" }]
      .map((i) => ({ ...i, url: `https://github.com/${repo}/issues/${i.number}`, linked: linked.has(i.number) }));
    return json({ repo, issues, demo: "허구 예시 이슈입니다" });
  });

  // 회의록
  const meetingRow = (m) => ({ ...m, read_count: 0, read_by_me: S.reads.includes(m.id) ? 1 : 0 });
  on("GET", "/api/meetings", () => json({ rows: [...S.meetings].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).map(meetingRow), team_size: 1, scope: "personal" }));
  on("POST", "/api/meetings", (q, b) => {
    if (!clean(b.title, 200) || !validDate(b.date)) return err("date와 title은 필수");
    S.meetings.push({ id: nextId(), date: b.date, title: clean(b.title, 200), body_mode: "link_only", body_md: null, link: clean(b.link, 500) || null, created_by: EMAIL, schedule_id: null, scope: "personal", gh_issue_url: null, created_at: nowUtc() });
    save(); return json({ ok: true });
  });
  on("POST", "/api/meetings/:id/read", (q, b, p) => {
    const m = S.meetings.find((x) => String(x.id) === p.id); if (!m) return err("회의록 없음", 404);
    if (!S.reads.includes(m.id)) S.reads.push(m.id);
    const T = today(); S.stepMarks[T] = [...new Set([...(S.stepMarks[T] || []), "read"])]; save();
    return json({ ok: true, personal_read: true });
  });
  on("POST", "/api/meetings/:id/issue", () => err("공개 데모에서는 GitHub 이슈를 만들지 않습니다"));
  on("GET", "/api/meetings/:id/md", (q, b, p) => { const m = S.meetings.find((x) => String(x.id) === p.id); if (!m?.body_md) return err("생성된 회의록 md가 없습니다", 404); return json({ date: m.date, title: m.title, md: m.body_md }); });
  on("POST", "/api/meetings/:id/kanban", (q, b, p) => {
    const m = S.meetings.find((x) => String(x.id) === p.id); if (!m?.body_md) return err("생성된 회의록 md가 없습니다", 404);
    const items = (m.body_md.match(/^- \[ \] .+$/gm) ?? []).map((l) => l.replace(/^- \[ \] /, "").trim()).slice(0, 20);
    if (!items.length) return err("할 일 항목이 없습니다");
    for (const t of items) { const high = /priority:High/i.test(t); S.kanban.push({ id: nextId(), user_email: EMAIL, name: NAME, quadrant: high ? "즉시처리" : "전략적계획", title: t.slice(0, 200), due: null, color: high ? "#E2445C" : "#579BFC", gh_repo: null, gh_issue_no: null, gh_state: null, scope: "personal", sort: S.kanban.length + 1, done_at: null }); }
    save(); return json({ ok: true, created: items.length });
  });
  on("GET", "/api/git_targets", () => json({ rows: S.gitTargets }));
  on("POST", "/api/git_targets", (q, b) => {
    if (!/^[\w.-]+\/[\w.-]+$/.test(b.repo ?? "")) return err("repo는 owner/repo 형식");
    S.gitTargets.forEach((t) => { t.is_default = 0; }); S.gitTargets.push({ id: nextId(), repo: b.repo, project_no: b.project_no ?? null, is_default: 1 }); save(); return json({ ok: true });
  });
  on("GET", "/api/ai/usage", () => json({ calls: S.aiCalls, limit: AI_LIMIT, ready: true }));
  on("POST", "/api/meetings/summarize", (q, b) => {
    const transcript = clean(b.transcript, 60000); if (!transcript) return err("회의 텍스트가 비어 있습니다");
    if (!validDate(b.date)) return err("회의 날짜는 필수입니다");
    if (S.aiCalls >= AI_LIMIT) return err(`오늘 AI 호출 한도(${AI_LIMIT}회)를 초과했습니다`, 429);
    // 모델 호출 없이 모의 회의록을 만든다 — 운영 GEMINI_API_KEY=dev-mock 경로와 같은 모양
    const title = clean(b.title, 200) || clean(b.topic, 200) || "회의";
    const sentences = transcript.replace(/\s+/g, " ").split(/(?<=[.!?。])\s+|(?<=다\.)\s*/).map((s) => s.trim()).filter(Boolean);
    const md = [`# ${b.date} ${title}`, "## 참석자", `- ${clean(b.attendees, 300) || "미기재"}`, "## 안건", ...sentences.slice(0, 3).map((s) => `- ${s.slice(0, 80)}`),
      "## 요약", `(공개 데모 모의 요약 — 실제 모델을 부르지 않습니다) ${sentences.slice(0, 4).join(" ").slice(0, 400)}`,
      "## 할 일 (Action Items)", "- [ ] 회의에서 정한 첫 행동을 칸반 카드로 옮기기 — @나 ~내일 [priority:High]", "- [ ] 확인이 필요한 수치는 원문과 1:1로 대조하기 — @나 [priority:Medium]", "## 참고 / 링크", "- 없음"].join("\n");
    const id = nextId();
    S.meetings.push({ id, date: b.date, title, body_mode: "full_md", body_md: md, link: null, created_by: EMAIL, schedule_id: Number(b.schedule_id) > 0 ? Number(b.schedule_id) : null, scope: "personal", gh_issue_url: null, created_at: nowUtc() });
    S.aiCalls += 1; save();
    return json({ ok: true, id, md, provider: "mock", calls: S.aiCalls, limit: AI_LIMIT });
  });
  on("GET", "/api/meeting-history/:id", () => json({ available: false, reason: "공개 데모에서는 ME(GitHub) 보관을 제공하지 않습니다", status: "unavailable", changed_since_export: false, path: null, exported_at: null, commit_sha: null, error: null, attempts: [] }));
  on("POST", "/api/meeting-history/:id/export", () => err(NOT_IN_DEMO, 403));

  // 회의 중 메모
  const todos = (outline) => (outline || []).filter((n) => n.m === "todo").length;
  const cleanOutline = (v) => (Array.isArray(v) ? v : []).slice(0, 500).map((n) => ({ d: Math.max(0, Math.min(5, Number(n?.d) || 0)), m: ["", "star", "decide", "todo", "need"].includes(n?.m) ? n.m : "", t: String(n?.t ?? "").slice(0, 1000), who: String(n?.who ?? "").slice(0, 60), due: validDate(String(n?.due ?? "")) ? String(n.due) : "" }));
  on("GET", "/api/notes", () => json({ rows: [...S.notes].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).map((n) => ({ id: n.id, date: n.date, title: n.title, purpose: n.purpose, attendees: n.attendees, meeting_id: n.meeting_id, updated_at: n.updated_at, todos: todos(n.outline) })) }));
  on("GET", "/api/notes/:id", (q, b, p) => { const n = S.notes.find((x) => String(x.id) === p.id); if (!n) return err("메모를 찾을 수 없습니다", 404); return json({ ...n, outline: cleanOutline(n.outline) }); });
  on("POST", "/api/notes", (q, b) => {
    const row = { id: nextId(), user_email: EMAIL, scope: "personal", date: validDate(b.date) ? b.date : today(), title: String(b.title ?? "").slice(0, 200), purpose: String(b.purpose ?? "").slice(0, 500), attendees: String(b.attendees ?? "").slice(0, 300), outline: cleanOutline(b.outline), schedule_id: Number(b.schedule_id) || null, meeting_id: null, updated_at: nowUtc() };
    S.notes.push(row); save(); return json({ ok: true, id: row.id });
  });
  on("PUT", "/api/notes/:id", (q, b, p) => {
    const n = S.notes.find((x) => String(x.id) === p.id); if (!n) return err("내가 만든 메모만 고칠 수 있습니다", 404);
    if (b.title !== undefined) n.title = String(b.title).slice(0, 200); if (b.purpose !== undefined) n.purpose = String(b.purpose).slice(0, 500);
    if (b.attendees !== undefined) n.attendees = String(b.attendees).slice(0, 300); if (b.outline !== undefined) n.outline = cleanOutline(b.outline);
    if (validDate(b.date)) n.date = b.date; n.updated_at = nowUtc(); save(); return json({ ok: true });
  });
  on("DELETE", "/api/notes/:id", (q, b, p) => { const len = S.notes.length; S.notes = S.notes.filter((x) => String(x.id) !== p.id); save(); return json({ ok: true, deleted: len - S.notes.length }); });
  on("POST", "/api/notes/:id/kanban", (q, b, p) => {
    const n = S.notes.find((x) => String(x.id) === p.id); if (!n) return err("메모를 찾을 수 없습니다", 404);
    const list = cleanOutline(n.outline).filter((x) => x.m === "todo" && x.t.trim()).slice(0, 30); if (!list.length) return err("할 일로 표시한 줄이 없습니다");
    for (const t of list) S.kanban.push({ id: nextId(), user_email: EMAIL, name: NAME, quadrant: t.due ? "즉시처리" : "전략적계획", title: ((t.who ? `[${t.who}] ` : "") + t.t.trim()).slice(0, 200), due: t.due || null, color: t.due ? "#E2445C" : "#579BFC", gh_repo: null, gh_issue_no: null, gh_state: null, scope: "personal", sort: S.kanban.length + 1, done_at: null });
    save(); return json({ ok: true, created: list.length });
  });
  on("POST", "/api/notes/:id/publish", (q, b, p) => {
    const n = S.notes.find((x) => String(x.id) === p.id); if (!n) return err("메모를 찾을 수 없습니다", 404);
    const nodes = cleanOutline(n.outline);
    const md = [`# ${n.date} ${n.title || "회의 메모"}`, n.purpose ? `목적: ${n.purpose}` : "", n.attendees ? `참석: ${n.attendees}` : "", "", "## 요약",
      ...nodes.filter((x) => x.m === "decide").map((x) => `- ◆ ${x.t}`), "", "## 할 일 (Action Items)",
      ...nodes.filter((x) => x.m === "todo").map((x) => `- [ ] ${x.t}${x.who ? ` — @${x.who}` : ""}${x.due ? ` ~${x.due}` : ""}`), "", "## 메모",
      ...nodes.map((x) => `${"  ".repeat(x.d)}- ${x.t}`)].join("\n");
    const title = (n.title || "회의 메모").slice(0, 200);
    if (n.meeting_id) { const m = S.meetings.find((x) => x.id === n.meeting_id); if (m) Object.assign(m, { title, body_md: md, date: n.date }); save(); return json({ ok: true, meeting_id: n.meeting_id, updated: true }); }
    const id = nextId();
    S.meetings.push({ id, date: n.date, title, body_mode: "full", body_md: md, link: null, created_by: EMAIL, schedule_id: n.schedule_id ?? null, scope: "personal", gh_issue_url: null, created_at: nowUtc() });
    n.meeting_id = id; save(); return json({ ok: true, meeting_id: id, updated: false });
  });

  // 볼트(ME)·알림·보관 — 데모에서는 연결하지 않는다 (화면은 빈 상태로 그린다)
  on("GET", "/api/vault/index", (q) => json({ since: q.get("since") ?? shift(today(), -14), folder: q.get("folder") || "", q: q.get("q") || "", kind: "", total: 0, collection_total: 0, folders: [], tree_sha: "demo", github_calls: 0, cached: true, rows: [], collections: [], note: "공개 데모에서는 ME 볼트(GitHub)를 읽지 않습니다" }));
  on("GET", "/api/vault/notes", (q) => json({ date: q.get("date") || today(), path: "", rows: [], note: "공개 데모에서는 볼트를 읽지 않습니다", personal: true }));
  on("POST", "/api/vault/import", () => err("공개 데모에서는 볼트 가져오기를 제공하지 않습니다"));
  on("GET", "/api/vault-history/status", () => json({ enabled: false, mine: false, reason: "", dir: null, schedule: "매일 23:50 · 다음 날 00:10 (KST)" }));
  on("POST", "/api/vault-history/sync", () => err(NOT_IN_DEMO, 403));
  on("GET", "/api/reminders/status", () => json({ kakao: null, google: null, secrets_ready: false, google_ready: false, demo: true }));
  on("GET", "/api/reminders/preview", () => json({ when: "evening", text: reminderText(1740) }));
  on("POST", "/api/reminders/test", (q, b) => json({ when: b.when === "morning" ? "morning" : "evening", sent: false, detail: "공개 데모에서는 카카오톡으로 보내지 않습니다", text: reminderText(b.when === "morning" ? 825 : 1740) }));

  async function handle(url, method, bodyText) {
    const path = url.pathname;
    let body = {};
    if (bodyText) { try { body = JSON.parse(bodyText); } catch { body = {}; } }
    if (body === null || typeof body !== "object") body = {};
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path); if (!m) continue;
      try { return r.handler(url.searchParams, body, m.groups || {}); }
      catch (e) { console.error("demo-api", path, e); return err("데모 처리 중 오류가 났습니다. 체험 초기화를 눌러주세요.", 500); }
    }
    return err(NOT_IN_DEMO, 404);
  }

  /* ── fetch 가로채기 ─────────────────────────────────────────────────────── */
  const realFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    let url; try { url = new URL(raw, location.href); } catch { return realFetch(input, init); }
    if (url.origin !== location.origin || !(url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/"))) return realFetch(input, init);
    if (url.pathname.startsWith("/auth/")) return err("공개 데모에서는 외부 계정 연결을 제공하지 않습니다", 404);
    const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    let bodyText = null;
    if (init?.body !== undefined && init?.body !== null) bodyText = typeof init.body === "string" ? init.body : await new Response(init.body).text();
    else if (input instanceof Request && method !== "GET" && method !== "HEAD") bodyText = await input.clone().text();
    if (!S) load();
    return handle(url, method, bodyText);
  };
  load();

  /* ── 화면 보정: 안내 배너 · 데모에서 막는 동작 ──────────────────────────── */
  function reset() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    for (const k of ["wc.mode", "wc.prin.open", "wc.gh.repo", "wc.lv.big"]) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
    location.href = "/personal";
  }
  window.workCycleDemo = { KEY, reset, state: () => S };

  function download(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  function notice(msg) {
    const el = document.querySelector("#demoNotice"); if (!el) return;
    el.textContent = msg; el.hidden = false; clearTimeout(notice.t); notice.t = setTimeout(() => { el.hidden = true; }, 4000);
  }
  function decorate() {
    document.documentElement.classList.add("demo");
    const wrap = document.querySelector(".wrap") || document.body;
    const bar = document.createElement("div");
    bar.className = "demo-bar"; bar.setAttribute("role", "note");
    bar.innerHTML = `<span class="demo-bar-tag">공개 데모</span><span class="demo-bar-text">허구 예시 데이터 · 로그인 없음 · 기록은 이 브라우저에만 저장되고 운영 서비스와 연결되지 않습니다 · 날짜가 바뀌면 새 예시로 시작합니다</span><button type="button" class="demo-bar-reset">체험 초기화</button><span id="demoNotice" class="demo-bar-notice" role="status" aria-live="polite" hidden></span>`;
    bar.querySelector(".demo-bar-reset").addEventListener("click", () => { if (confirm("체험 데이터를 처음 상태로 되돌릴까요?")) reset(); });
    wrap.prepend(bar);

    // 외부 계정 연결(OAuth)·파일 내려받기·볼트 — 데모에서는 안내만
    document.querySelectorAll('a[href^="/auth/"]').forEach((a) => { a.addEventListener("click", (e) => { e.preventDefault(); notice("공개 데모에서는 외부 계정 연결을 제공하지 않습니다."); }); a.setAttribute("aria-disabled", "true"); a.classList.add("demo-off"); });
    const vaultSub = document.querySelector(".sub.vault-personal");
    if (vaultSub) vaultSub.textContent = "공개 데모에서는 ME 볼트(GitHub)를 읽지 않습니다 — 아래 회의록 목록은 허구 예시입니다.";
    document.addEventListener("click", (e) => {
      const t = e.target.closest("#lvHtml,#lvDlHtml,#lvDlMd,#worklogMd,#bannerInstall,.vault-doc a,.vault-collection a");
      if (!t) return;
      e.preventDefault(); e.stopPropagation();
      if (t.id === "worklogMd") { const date = document.querySelector("#worklogDate")?.value || today(); download(`${date}_work-cycle-demo.md`, dayMarkdown(date)); notice(`${date} 기록을 md 파일로 내려받았습니다 (허구 예시).`); return; }
      notice("공개 데모에서는 파일 내보내기·외부 열기를 제공하지 않습니다.");
    }, true);

    // 계정 메뉴: Access 로그아웃 → 체험 초기화
    const fix = () => {
      const out = document.querySelector('.acct-menu a.acct-item.out[href="/cdn-cgi/access/logout"]');
      if (!out) return false;
      const btn = document.createElement("button"); btn.type = "button"; btn.className = "acct-item out"; btn.textContent = "↺ 체험 초기화";
      btn.addEventListener("click", () => { if (confirm("체험 데이터를 처음 상태로 되돌릴까요?")) reset(); });
      out.replaceWith(btn);
      const who = document.querySelector(".acct-menu .acct-who small"); if (who) who.textContent = "체험 계정 (허구)";
      return true;
    };
    if (!fix()) { const mo = new MutationObserver(() => { if (fix()) mo.disconnect(); }); mo.observe(document.body, { childList: true }); setTimeout(() => mo.disconnect(), 5000); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", decorate); else decorate();
})();
