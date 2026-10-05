/* report.ts — 주간업무보고 자동 생성
   월~금 work-cycle 기록을 모아 "주간업무보고_양식" 구조로 만들고 xlsx로 내보냅니다. */
import { buildWorkbook, S, type Row } from "./xlsx";
import { hasKanbanDone } from "./shared";

const WD = ["일", "월", "화", "수", "목", "금", "토"];
const DEFAULT_REPORT_AUTHOR = "민예린";

/** YYYY-MM-DD → 그 주 월요일 */
export function weekStart(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const dow = d.getUTCDay();               // 0=일
  const back = dow === 0 ? 6 : dow - 1;    // 일요일이면 지난 월요일
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
export function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** "26년 8월 3주차" — 그 달의 첫 월요일이 있는 주가 1주차 (회사 기준)
 *  mon은 항상 월요일이므로, 그 달 첫 월요일부터 몇 번째 월요일인지로 센다. */
export function weekLabel(mon: string): string {
  const [y, m, d] = mon.split("-").map(Number);
  const dow1 = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();  // 그 달 1일의 요일
  const firstMon = 1 + ((8 - dow1) % 7);                     // 그 달 첫 월요일의 일자
  const nth = Math.floor((d - firstMon) / 7) + 1;
  return `${String(y).slice(2)}년 ${m}월 ${nth}주차`;
}
const dot = (iso: string) => iso.replace(/-/g, ".");

export type ReportData = {
  week_start: string;
  week_end: string;
  label: string;
  author: string;
  dept: string;
  role_name: string;
  prj_code: string;
  project: string;
  goal: string;
  days: { date: string; dow: string; kind: string; done: string; todo: string }[];
  next: string;
  edited: string[];              // 사용자가 손댄 칸
};

type Ovr = Record<string, string>;

function bullets(lines: string[], limit = 1800): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const t = (raw ?? "").toString().replace(/\s+/g, " ").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push("* " + t);
  }
  let s = out.join("\n");
  if (s.length > limit) s = s.slice(0, limit - 1) + "…";
  return s;
}

function memoSnippet(value: unknown, limit = 240): string {
  const text = (value ?? "").toString().replace(/\s+/g, " ").trim();
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
}

function scheduleLines(row: any, logsBySchedule: Map<number, any[]>): string[] {
  const lines = [row.title + (row.body ? " — " + String(row.body).split("\n")[0] : "")];
  const summary = memoSnippet(row.memo);
  if (summary) lines.push(`${row.title} · 정리 메모: ${summary}`);
  const recentLogs = (logsBySchedule.get(Number(row.id)) ?? []).slice(-3);
  recentLogs.forEach(log => {
    const body = memoSnippet(log.body);
    if (body) lines.push(`${row.title} · ${log.logged_time} 메모: ${body}`);
  });
  return lines;
}

function scheduleHeadline(row: any): string {
  const title = memoSnippet(row.title, 180);
  const body = memoSnippet(String(row.body ?? "").split("\n")[0], 260);
  return body ? `${title} — ${body}` : title;
}

function hasProgress(row: any, logsBySchedule: Map<number, any[]>): boolean {
  return row.status === "완료" || !!memoSnippet(row.memo) || (logsBySchedule.get(Number(row.id))?.length ?? 0) > 0;
}

/** 다음 업무일의 실제 진행 기록을 이전 날의 진행예정 한 문장으로 압축한다. */
function planSentence(lines: string[], limit = 700): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const raw of lines) {
    const text = String(raw ?? "")
      .replace(/^\s*\*\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    parts.push(text.replace(/[.!?]+$/, ""));
  }
  if (!parts.length) return "";
  let sentence = parts.join(" · ");
  if (sentence.length > limit - 3) sentence = sentence.slice(0, limit - 4).trimEnd() + "…";
  return /예정$/.test(sentence) ? sentence : `${sentence} 예정`;
}

/** dayCount: 보고 행 수 — 회사용 5(월~금, 양식 고정) · 개인용 7(월~일, 2026-09-27 사용자 결정) */
export async function collect(db: D1Database, email: string, mon: string, dayCount: 5 | 7 = 5): Promise<ReportData> {
  const fri = addDays(mon, dayCount - 1);       // 마지막 행 날짜 (회사용 금요일 · 개인용 일요일)
  const nextMon = addDays(mon, 7);
  const nextFri = addDays(nextMon, dayCount - 1);
  // 완료한 칸반 카드(0022 done_at)는 '할 일'에서 뺀다. 0022 적용 전 D1 에서는 필터 없이 기존 그대로.
  const kanDone = (await hasKanbanDone(db)) ? " AND done_at IS NULL" : "";

  const [setRow, ovrRows, schRows, logRows, verRows, retRows, kanRows, nextRows] = await Promise.all([
    db.prepare("SELECT * FROM report_settings WHERE user_email=?1").bind(email).first<any>(),
    db.prepare("SELECT field, value FROM report_overrides WHERE user_email=?1 AND week_start=?2").bind(email, mon).all(),
    db.prepare(
      "SELECT id, date, title, body, memo, block_type, status FROM schedules WHERE user_email=?1 AND date BETWEEN ?2 AND ?3 ORDER BY date, start_time"
    ).bind(email, mon, fri).all(),
    db.prepare(
      "SELECT schedule_id, logged_date, logged_time, body FROM schedule_logs WHERE user_email=?1 AND logged_date BETWEEN ?2 AND ?3 ORDER BY logged_date, logged_time, id"
    ).bind(email, mon, fri).all(),
    db.prepare(
      "SELECT cycle_date, item, result, status FROM verifications WHERE user_email=?1 AND cycle_date BETWEEN ?2 AND ?3 ORDER BY cycle_date, id"
    ).bind(email, mon, fri).all(),
    db.prepare(
      "SELECT cycle_date, work_summary, tomorrow_prompt FROM retros WHERE user_email=?1 AND cycle_date BETWEEN ?2 AND ?3"
    ).bind(email, mon, fri).all(),
    db.prepare(
      `SELECT quadrant, title FROM kanban_cards WHERE user_email=?1 AND quadrant IN ('즉시처리','전략적계획')${kanDone} ORDER BY sort LIMIT 8`
    ).bind(email).all(),
    db.prepare(
      "SELECT date, title, body, block_type FROM schedules WHERE user_email=?1 AND date BETWEEN ?2 AND ?3 ORDER BY date, start_time"
    ).bind(email, nextMon, nextFri).all(),
  ]);

  const ovr: Ovr = {};
  for (const r of (ovrRows.results ?? []) as any[]) ovr[r.field] = r.value;

  const st = setRow ?? {};
  const author: string = String(ovr["author"] || st.author || DEFAULT_REPORT_AUTHOR).trim() || DEFAULT_REPORT_AUTHOR;
  const project: string = st.project || "업무";
  const tag = `[${project}]`;

  const sch = (schRows.results ?? []) as any[];
  const logsBySchedule = new Map<number, any[]>();
  for (const log of (logRows.results ?? []) as any[]) {
    const key = Number(log.schedule_id);
    const rows = logsBySchedule.get(key) ?? [];
    rows.push(log);
    logsBySchedule.set(key, rows);
  }
  const ver = (verRows.results ?? []) as any[];
  const ret = (retRows.results ?? []) as any[];
  const nx = (nextRows.results ?? []) as any[];

  const drafts: {
    date: string;
    dow: string;
    kind: string;
    doneLines: string[];
    planSourceLines: string[];
    fallbackPlanLines: string[];
  }[] = [];
  for (let i = 0; i < dayCount; i++) {
    const date = addDays(mon, i);
    const dSch = sch.filter(r => r.date === date);
    const dVer = ver.filter(r => r.cycle_date === date);
    const dRet = ret.find(r => r.cycle_date === date);

    const doneLines: string[] = [];
    dSch.filter(r => hasProgress(r, logsBySchedule)).forEach(r => {
      doneLines.push(...scheduleLines(r, logsBySchedule));
    });
    dVer.filter(r => r.status !== "미확인").forEach(r => {
      doneLines.push(`검증: ${r.item}${r.result ? " → " + r.result : ""} (${r.status})`);
    });
    if (dRet?.work_summary) String(dRet.work_summary).split("\n").forEach(l => doneLines.push(l));

    const fallbackPlanLines: string[] = [];
    dSch.filter(r => r.status !== "완료").forEach(r => fallbackPlanLines.push(scheduleHeadline(r)));
    dVer.filter(r => r.status === "미확인").forEach(r => fallbackPlanLines.push(`검증: ${r.item}`));
    if (dRet?.tomorrow_prompt) fallbackPlanLines.push(String(dRet.tomorrow_prompt).split("\n")[0]);

    const kinds = [...new Set(dSch.map(r => r.block_type).filter(Boolean))];
    drafts.push({
      date,
      dow: WD[new Date(date + "T00:00:00Z").getUTCDay()],
      kind: ovr["c:" + date] ?? (kinds.join(" / ") || project),
      doneLines,
      planSourceLines: doneLines.length ? doneLines : dSch.map(scheduleHeadline),
      fallbackPlanLines,
    });
  }

  const nextWeekPlanLines = nx.map(scheduleHeadline);
  const days = drafts.map((draft, i) => {
    const tomorrowLines = i < dayCount - 1 ? drafts[i + 1].planSourceLines : nextWeekPlanLines;
    const planned = planSentence(tomorrowLines.length ? tomorrowLines : draft.fallbackPlanLines);
    const autoDone = draft.doneLines.length ? tag + "\n" + bullets(draft.doneLines) : "";
    const autoTodo = planned ? `${tag}\n* ${planned}` : "";
    return {
      date: draft.date,
      dow: draft.dow,
      kind: draft.kind,
      done: ovr["e:" + draft.date] ?? autoDone,
      todo: ovr["f:" + draft.date] ?? autoTodo,
    };
  });

  const goalAuto = (kanRows.results ?? []).length
    ? ((kanRows.results ?? []) as any[]).map(r => "- " + r.title).join("\n")
    : "";
  const nextAuto = nx.length
    ? tag + "\n" + nx.map(r => `- ${r.date.slice(5).replace("-", "/")} ${r.title}`).join("\n")
    : "";

  return {
    week_start: mon,
    week_end: fri,
    label: weekLabel(mon),
    author,
    dept: st.dept ?? "기술연구소",
    role_name: st.role_name ?? "연구원",
    prj_code: st.prj_code ?? "",
    project,
    goal: ovr["goal"] ?? (st.goal || goalAuto),
    days,
    next: ovr["next"] ?? nextAuto,
    edited: Object.keys(ovr),
  };
}

/* ── 양식 그대로 xlsx 만들기 ───────────────────────────────── */
const COLS = [
  { min: 1, max: 1, width: 11.6 }, { min: 2, max: 2, width: 8.6 },
  { min: 3, max: 3, width: 12.4 }, { min: 4, max: 4, width: 11.5 },
  { min: 5, max: 5, width: 60.6 }, { min: 6, max: 6, width: 45.5 },
  { min: 7, max: 7, width: 9.0 },  { min: 8, max: 8, width: 34.2 },
];
const visualLength = (s: string) => [...s].reduce((n, ch) => n + (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(ch) ? 1.7 : 1), 0);
const wrappedLines = (s: string, columnWidth: number) => s
  ? s.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(visualLength(line) / (columnWidth * 1.1))), 0)
  : 1;
const heightFor = (...cells: { text: string; width: number }[]) =>
  Math.min(400, Math.max(30, Math.max(...cells.map(c => wrappedLines(c.text, c.width))) * 15.6 + 8));

export function toXlsx(d: ReportData): Uint8Array {
  const band = (v: string | null, s: number) => [1, 2, 3, 4, 5, 6].map(c => ({ c, v: c === 1 ? v : null, s }));
  const rows: Row[] = [];

  rows.push({ r: 1, ht: 39, cells: band("주간 업무 진행 사항", S.TITLE) });
  const rev = `${d.week_end.slice(2).replace(/-/g, ". ")} (${WD[new Date(d.week_end + "T00:00:00Z").getUTCDay()]})`;
  rows.push({
    r: 2, ht: 21,
    cells: band(`작성자 : ${d.dept} ${d.author} ${d.role_name} / Last Rev. ${rev}`, S.SUBTITLE),
  });
  rows.push({
    r: 3,
    cells: [
      { c: 1, v: "일자", s: S.HEAD }, { c: 2, v: "Prj.Code", s: S.HEAD },
      { c: 3, v: "업무구분", s: S.HEAD }, { c: 4, v: "담당자", s: S.HEAD },
      { c: 5, v: "진행사항", s: S.HEAD }, { c: 6, v: "진행예정", s: S.HEAD },
      { c: 8, v: "금주 주간 목표", s: S.HEAD },
    ],
  });

  d.days.forEach((day, i) => {
    const r = 4 + i;
    const cells = [
      { c: 1, v: `${dot(day.date)}\n(${day.dow})`, s: S.CENTER_W },
      { c: 2, v: d.prj_code, s: S.CENTER },
      { c: 3, v: day.kind, s: S.CENTER_W },
      { c: 4, v: d.author, s: S.CENTER },
      { c: 5, v: day.done, s: S.TOP_W },
      { c: 6, v: day.todo, s: S.TOP_W },
    ] as any[];
    if (i === 0) cells.push({ c: 8, v: d.goal, s: S.LEFT_TOP_W });
    rows.push({
      r,
      ht: heightFor(
        { text: day.done, width: 60.6 },
        { text: day.todo, width: 45.5 },
        { text: i === 0 ? d.goal : "", width: 34.2 },
      ),
      cells,
    });
  });

  const r10 = 4 + d.days.length + 1;   // 날짜 행 다음 빈 줄 하나 뒤 — 회사용 5행이면 10행 (양식 그대로), 개인용 7행이면 12행
  rows.push({ r: r10, ht: 22, cells: band("차주 업무 계획 및 일정", S.HEAD) });
  rows.push({
    r: r10 + 1,
    cells: [
      { c: 1, v: null, s: S.HEAD }, { c: 2, v: "Prj.Code", s: S.HEAD },
      { c: 3, v: "업무구분", s: S.HEAD }, { c: 4, v: "담당자", s: S.HEAD },
      { c: 5, v: "진행예정", s: S.HEAD }, { c: 6, v: null, s: S.HEAD },
    ],
  });
  rows.push({
    r: r10 + 2, ht: heightFor({ text: d.next, width: 106.1 }),
    cells: [
      { c: 1, v: null, s: S.CENTER }, { c: 2, v: d.prj_code, s: S.CENTER },
      { c: 3, v: d.project, s: S.CENTER_W }, { c: 4, v: d.author, s: S.CENTER },
      { c: 5, v: d.next, s: S.TOP_W }, { c: 6, v: null, s: S.TOP_W },
    ],
  });

  return buildWorkbook({
    sheetName: d.label,
    cols: COLS,
    merges: ["A1:F1", "A2:F2", `A${r10}:F${r10}`, `E${r10 + 1}:F${r10 + 1}`],
    rows,
  });
}

/** 파일명: 주간업무보고_26년 8월 4주차_민예린.xlsx */
export function fileName(d: ReportData): string {
  return `주간업무보고_${d.label}_${d.author}.xlsx`;
}
