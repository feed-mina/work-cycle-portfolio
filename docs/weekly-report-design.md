# 주간업무보고 자동 생성 — 설계·구현 기록

작성: 2026-08-22 / 대상: work-cycle

## 1. 목적
월~금 work-cycle 기록(일정·검증·회고·칸반)을 모아 회사 양식
`주간업무보고_양식용 2.xlsx` 구조 그대로 xlsx를 만들고,
매주 **금요일 13:00 KST**에 카카오톡으로 "초안 준비됨" 알림을 보낸다.

## 2. 양식 구조 (원본 분석 결과)

| 위치 | 내용 |
|---|---|
| A1:F1 (병합) | "주간 업무 진행 사항" · 맑은 고딕 24pt · 회색 채움(#D0CECE) |
| A2:F2 (병합) | "작성자 : {소속} {이름} {직급} / Last Rev. YY. MM. DD (금)" · 14pt |
| 3행 | 일자(A) · Prj.Code(B) · 업무구분(C) · 담당자(D) · 진행사항(E) · 진행예정(F) · **G는 빈 열** · 금주 주간 목표(H) |
| 4~8행 | 월~금 5행. E/F는 `[프로젝트]` + 줄바꿈 + `* 내용` (wrap, top 정렬) |
| H4 | 금주 주간 목표 (left/top wrap) |
| A10:F10 (병합) | "차주 업무 계획 및 일정" |
| 11행 | A 빈칸 · Prj.Code · 업무구분 · 담당자 · 진행예정(E11:F11 병합) |
| 12행 | 차주 내용 |

- 열너비: A 11.6 · B 8.6 · C 12.4 · D 11.5 · **E 60.6** · **F 45.5** · G 9.0 · **H 34.2**
- 헤더 채움색: 청회색 #ACB9CA (원본은 theme 3 / tint 0.6)
- 테두리: 전체 thin. 단 A1은 아래 없음, A2는 위 없음 (병합 경계선 제거)
- 폰트: 전체 맑은 고딕

## 3. 데이터 매핑

| 양식 칸 | 원천 |
|---|---|
| 일자 | 그 주 월~금 (`YYYY.MM.DD\n(요일)`) |
| Prj.Code | `report_settings.prj_code` |
| 업무구분 | 그날 `schedules.block_type` distinct (없으면 프로젝트명) |
| 담당자 | `report_settings.author` (없으면 `users.name`) |
| **진행사항 (E)** | ① `schedules.status='완료'` 제목 + body 첫 줄<br>② `verifications.status != '미확인'` → `검증: 항목 → 결과 (상태)`<br>③ `retros.work_summary` 각 줄 |
| **진행예정 (F)** | ① `schedules.status != '완료'`<br>② `verifications.status='미확인'` → `검증 예정: 항목`<br>③ `retros.tomorrow_prompt` 첫 줄 |
| **금주 주간 목표 (H4)** | `report_settings.goal`, 비었으면 칸반 `즉시처리`+`전략적계획` 카드 제목 (최대 8) |
| 차주 계획 (E12) | 다음 주 월~금에 이미 등록된 `schedules` |

중복 줄은 제거하고 칸당 1800자에서 자릅니다.

## 4. 주차 계산 기준 (확정)

**회사 기준 = "그 달의 첫 월요일이 있는 주가 1주차"** (2026-08-22 사용자 확정)

```ts
// mon은 항상 월요일(weekStart 결과)
const dow1 = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();  // 그 달 1일의 요일
const firstMon = 1 + ((8 - dow1) % 7);                     // 그 달 첫 월요일의 일자
const nth = Math.floor((d - firstMon) / 7) + 1;
```

검증 결과:

| 주 시작(월) | 라벨 |
|---|---|
| 2026-08-17 | 26년 8월 3주차 |
| 2026-08-24 | 26년 8월 4주차 |
| 2026-08-31 | 26년 8월 5주차 (그 주는 9/4까지 — 원본 양식도 6/29~7/3을 "6월 5주차"로 씀) |
| 2026-06-29 | 26년 6월 5주차 ← **원본 양식 예시와 일치** |

2026년 전체 월요일 52개를 순회해 전수 검증 통과.

## 5. 구현

### 새 파일
- `src/xlsx.ts` — 의존성 없는 최소 XLSX 생성기.
  CRC32 + 무압축(STORED) ZIP + OOXML 직접 작성.
  Workers에 라이브러리를 넣지 않고 병합·열너비·테두리·폰트·행높이를 재현.
  스타일 인덱스: `PLAIN/TITLE/SUBTITLE/HEAD/CENTER/CENTER_W/TOP_W/LEFT_TOP_W`
- `src/report.ts` — `weekStart` · `weekLabel` · `collect()` · `toXlsx()` · `fileName()`
- `public/report.html` — 주간보고 화면
- `public/acc.js` — 카드/섹션 아코디언 (마이페이지 UI 단순화)
- `migrations/0008_report.sql` — `report_settings`, `report_overrides`

### API
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/report/weekly?week=` | 집계 결과(JSON) |
| GET | `/api/report/weekly.xlsx?week=` | 양식 xlsx 다운로드 |
| GET/PUT | `/api/report/settings` | 작성자·소속·직급·Prj.Code·프로젝트명 |
| PUT/DELETE | `/api/report/cell` | 칸 단위 수동 보정 / 자동 집계로 되돌리기 |

**보정(override) 방식이 핵심**: 자동 집계는 초안일 뿐이라, 화면에서 고친 칸만
`report_overrides`에 고정되고 나머지는 계속 자동으로 갱신됩니다.
field 형식: `e:YYYY-MM-DD` | `f:YYYY-MM-DD` | `c:YYYY-MM-DD` | `goal` | `next` | `author`

### Cron
- 표현식: `0,25,30,40 23,1,3,4,8 * * *` (UTC 4시 추가)
- SLOTS에 `{ hhmm: 1300, kind: "report", dow: 5 }` — **요일 지정 슬롯** 개념 도입
- 한 주 시뮬레이션 결과: 금요일 13:00 정확히 1회, 나머지 평일 알림 5회씩 정상

## 6. 검증 방법 (실제로 한 것)
1. `npx tsc --noEmit` 통과
2. Node로 xlsx 생성 → **openpyxl로 되읽어** 시트명·병합·폰트·채움·열너비·행높이 확인
3. `unzip -t` 로 ZIP 무결성 확인
4. **LibreOffice headless로 PDF 변환 후 이미지로 육안 확인** → 원본 양식과 배치 일치
5. wrangler dev 로컬 구동 + **Playwright 실제 브라우저**로 화면 조작
   (칸 편집 → 저장 → `edited` 표시 → 새로고침 유지, 이전/다음 주 이동, 모바일 가로 넘침 0)
6. cron 슬롯 선택 로직 한 주 시뮬레이션
7. `weekLabel()` 2026년 월요일 전수 검증

## 7. 남은 판단거리
- 금요일 13:00 초안에는 **금요일 오후 작업이 빠집니다.** 퇴근 전 화면에서 보정 후 다시 받는 흐름 권장.
