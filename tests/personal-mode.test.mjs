import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:18788';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw new Error('Local test environment only');
const personalHtml=readFileSync('public/personal.html','utf8');
const personalSource=readFileSync('src/personal.ts','utf8');
const personalUi=readFileSync('public/personal-ui.js','utf8');
assert(!personalHtml.includes('오늘 할 일과 집중 시간'),'unused personal task/focus card removed from UI');
assert(!personalHtml.includes('id="personalTaskForm"')&&!personalHtml.includes('id="personalFocusForm"'),'task/focus forms removed from UI only');
assert(personalSource.includes("app.post('/tasks'")&&personalSource.includes("app.post('/focus'"),'task/focus APIs preserved');
assert(personalUi.includes("if(el('personalFilters'))await refresh()"),'only the dashboard filter triggers the D1 summary read');
{ // 2026-10-02: 나의 준비 현황에서 개인 할 일·집중 시간 카드와 지표 2칸을 뺐다(입력 경로 없음). 표·API는 보존(위 assert).
 const dashHtml=readFileSync('public/personal-dashboard.html','utf8');
 for(const id of ['personalTasks','personalFocusRows','personalDoneCount','personalMinutes'])assert(!dashHtml.includes(`id="${id}"`),'personal-dashboard: '+id+' removed');
 for(const id of ['personalResultCount','personalResultRows','personalJournal','personalNext'])assert(dashHtml.includes(`id="${id}"`),'personal-dashboard: '+id+' kept');
 assert(!/personalDoneCount|personalMinutes|personalTasks|personalFocusRows/.test(personalUi),'personal-ui.js no longer touches removed elements');
}
const tag=Date.now(),A=`personal-a-${tag}@example.test`,B=`personal-b-${tag}@example.test`;
let count=0;
async function call(path,{user=A,method='GET',body,status=200,origin}={}){
 const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json','Cf-Access-Authenticated-User-Email':user,...(origin?{Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const d=await r.json();assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(d)}`);count++;return d;
}
for(const file of readdirSync('public')){
 if(!/\.(js|html)$/.test(file))continue;
 const source=readFileSync('public/'+file,'utf8');
 if(file.endsWith('.js'))new Function(source);
 if(file.endsWith('.html'))for(const match of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new Function(match[1]);
 if(file.endsWith('.html')&&source.includes('class="nav-tabs"')){
  // 탭은 회사용·개인용 두 벌을 HTML에 두고 CSS로 고른다. mode-switch.js는 헤더보다 먼저 실행돼야 깜빡이지 않는다.
  const nav=source.match(/<nav class="nav-tabs">[\s\S]*?<\/nav>/)[0];
  assert.equal((nav.match(/data-mode="company"/g)||[]).length,2,file+': company tabs');
  assert.equal((nav.match(/data-mode="personal"/g)||[]).length,2,file+': personal tabs');
  assert(source.indexOf('/mode-switch.js')<source.indexOf('<header'),file+': mode-switch.js must load before <header>');
  assert(source.includes('/principles.js'),file+': principles.js banner');
  assert(!source.includes('class="personal-notice">개인 계획'),file+': long personal notice removed');
  assert(source.includes('<span class="mode-slot"></span>'),file+': header mode-slot placeholder');
  assert(!source.includes('class="personal-notice"'),file+': no personal-notice');
  if(/^personal/.test(file))assert(!/<button>/.test(source),file+': every <button> has a class (personal screens)');
 }
}
const before=await call('/api/checklist');
const settings=await call('/api/personal/settings');assert.equal(settings.reminder_mode,'company');
assert.equal((await call('/api/me')).view_mode,'company');
{ // 레포 드롭다운 API: 토큰 없으면 400(기존 issues 와 같은 문구), 있으면 repos 배열 + total
 const r=await fetch(base+'/api/github/repos',{headers:{'Cf-Access-Authenticated-User-Email':A}});const d=await r.json();count++;
 assert([200,400,502].includes(r.status),'/api/github/repos status '+r.status);   // 502 = 토큰은 있으나 GitHub 연결 실패(원문 JSON)
 if(r.status===200){assert(Array.isArray(d.repos)&&d.total===d.repos.length,'repos array');}else assert(/GITHUB|GitHub/.test(d.error),'json error text');
}
await call('/api/personal/settings',{method:'PUT',body:{view_mode:'personal'}});
assert.equal((await call('/api/me')).view_mode,'personal');
assert.equal((await call('/api/me',{user:B})).view_mode,'company');
assert.equal((await call('/api/personal/settings')).reminder_mode,'company');
await call('/api/personal/settings',{method:'PUT',body:{reminder_mode:'personal'}});
assert.equal((await call('/api/personal/settings',{user:B})).view_mode,'company');
await call('/api/personal/settings',{method:'PUT',body:{view_mode:'wrong'},status:400});
await call('/api/personal/settings',{method:'PUT',body:{view_mode:'personal'},origin:'https://untrusted.example',status:403});
const ui=await call('/api/personal/ui');assert.equal(ui.principles[2].title,'결과 기록 및 오늘 하루 검토');
assert.equal(ui.checklist.length,12);assert(ui.checklist.some(i=>i.text==='모르는 내용은 예제나 비유로 생각을 확인했다'));
await call('/api/personal/checklist?date=2026-02-30',{status:400});
await call('/api/personal/plan',{method:'POST',body:{user_flow:'계획 검증',done_criteria:'결과 기록'}});
await call('/api/personal/retro',{method:'POST',body:{work_summary:'오늘 결과',tomorrow_prompt:'내일 첫 행동'}});
assert.equal((await call('/api/personal/plan/prefill',{user:B})).today,null);
const me=await call('/api/me');
for(const i of ui.checklist)await call('/api/personal/checks',{method:'POST',body:{item_id:i.id,checked:true}});
const memoRes=await call('/api/personal/checklist/1/memo',{method:'PUT',body:{memo:'근거 메모'}});assert.equal(memoRes.memo,'근거 메모');assert.equal(memoRes.deleted,false); // 응답에 저장값 (화면이 칸을 다시 채움)
assert.equal((await call('/api/personal/checklist')).items[0].checked,1);
await call('/api/personal/checks',{method:'POST',body:{item_id:1,checked:false}});
assert.equal((await call('/api/personal/checklist')).items[0].memo,'근거 메모');
const memoDel=await call('/api/personal/checklist/1/memo',{method:'PUT',body:{memo:''}});assert.deepEqual([memoDel.memo,memoDel.deleted],['',true]);
assert.equal((await call('/api/personal/checklist')).items[0].memo,'');
await call('/api/personal/checklist/1/memo',{method:'PUT',body:{memo:'근거 메모'}});
assert.equal((await call('/api/personal/board')).board[0].steps.work,false);
await call('/api/personal/checks',{method:'POST',body:{item_id:1,checked:true}});
assert.equal((await call('/api/personal/board')).board[0].steps.work,true);
const otherDayBoard=await call('/api/personal/board?date=2026-01-02');
assert.equal(otherDayBoard.date,'2026-01-02');assert.equal(otherDayBoard.board[0].done,0,'board honors requested KST date');
await call('/api/personal/board?date=2026-02-30',{status:400});
// 0018: 회의록 범위 분리 — 개인용(A)이 만든 것은 회사 목록(B)에 안 보이고, 개인 읽음 처리는 개인 사이클 read 를 채운다
await call('/api/meetings',{user:B,method:'POST',body:{date:'2026-09-26',title:'회사 회의 '+tag}});
await call('/api/meetings',{method:'POST',body:{date:'2026-09-26',title:'개인 노트 '+tag}});
const listA=await call('/api/meetings');assert.equal(listA.scope,'personal');
assert(listA.rows.every(r=>r.scope==='personal'&&r.created_by===A),'personal list only mine');
assert(listA.rows.some(r=>r.title==='개인 노트 '+tag)&&!listA.rows.some(r=>r.title==='회사 회의 '+tag));
const listB=await call('/api/meetings',{user:B});assert.equal(listB.scope,'company');
assert(listB.rows.every(r=>r.scope==='company'),'company list only company');
assert(listB.rows.some(r=>r.title==='회사 회의 '+tag)&&!listB.rows.some(r=>r.title==='개인 노트 '+tag));
const mine=listA.rows.find(r=>r.title==='개인 노트 '+tag);
await call('/api/meetings/'+mine.id+'/read',{user:B,method:'POST',status:404});
assert.equal((await call('/api/personal/board')).board[0].steps.read,false);
assert.equal((await call('/api/meetings/'+mine.id+'/read',{method:'POST'})).personal_read,true);
assert.equal((await call('/api/personal/board')).board[0].steps.read,true);
assert.equal((await call('/api/personal/board',{user:B})).board[0].steps.read,false);
// 0020: 일정·칸반 범위 분리 — 개인용(A) 것은 회사용(B) 목록에 없고, 회사 것은 개인용 목록에 없다. 개인 도넛은 personal_* 로 계산
const today=me.today, wk=`from=${today}&to=${today}`;
await call('/api/schedules',{user:B,method:'POST',body:{date:today,title:'회사 일정 '+tag}});
await call('/api/schedules',{method:'POST',body:{date:today,title:'개인 일정 '+tag}});
const schA=await call('/api/schedules?'+wk);assert.equal(schA.scope,'personal');
assert(schA.rows.every(r=>r.scope==='personal'&&r.user_email===A)&&schA.rows.some(r=>r.title==='개인 일정 '+tag),'personal schedules only mine');
const schB=await call('/api/schedules?'+wk,{user:B});assert.equal(schB.scope,'company');
assert(schB.rows.every(r=>r.scope==='company')&&schB.rows.some(r=>r.title==='회사 일정 '+tag)&&!schB.rows.some(r=>r.title==='개인 일정 '+tag),'company schedules exclude personal');
await call('/api/kanban',{user:B,method:'POST',body:{title:'회사 카드 '+tag,quadrant:'즉시처리'}});
await call('/api/kanban',{method:'POST',body:{title:'개인 카드 '+tag,quadrant:'전략적계획'}});
const kA=await call('/api/kanban');assert.equal(kA.scope,'personal');assert(kA.rows.every(r=>r.scope==='personal'&&r.user_email===A)&&kA.rows.some(r=>r.title==='개인 카드 '+tag),'personal kanban only mine');
const kB=await call('/api/kanban',{user:B});assert(kB.rows.every(r=>r.scope==='company')&&kB.rows.some(r=>r.title==='회사 카드 '+tag)&&!kB.rows.some(r=>r.title==='개인 카드 '+tag),'company kanban excludes personal');
{ // 칸반 완료(0022 done_at): 완료하면 quadrant 는 그대로, done_at 만 찍힌다. 되돌리면 NULL. 주간보고 '할 일'에서 완료 카드는 빠진다.
 const title='완료 카드 '+tag;
 await call('/api/kanban',{user:B,method:'POST',body:{title,quadrant:'즉시처리'}});
 const card=(await call('/api/kanban',{user:B})).rows.find(r=>r.title===title);assert(card&&!card.done_at,'new card is open');
 await call('/api/kanban/'+card.id,{user:B,method:'PATCH',body:{done:'yes'},status:400});
 assert.equal((await call('/api/kanban/'+card.id,{user:B,method:'PATCH',body:{done:true}})).changed,1);
 assert.equal((await call('/api/kanban/'+card.id,{user:B,method:'PATCH',body:{done:true}})).changed,0,'second done keeps first done_at');
 const doneRow=(await call('/api/kanban',{user:B})).rows.find(r=>r.id===card.id);assert(doneRow.done_at&&doneRow.quadrant==='즉시처리','done keeps quadrant');
 assert(!(await call('/api/report/weekly',{user:B})).goal.includes(title),'done card excluded from weekly report');
 await call('/api/kanban/'+card.id,{user:B,method:'PATCH',body:{done:false}});
 const undone=(await call('/api/kanban',{user:B})).rows.find(r=>r.id===card.id);assert(!undone.done_at&&undone.quadrant==='즉시처리','undo returns to original quadrant');
 assert((await call('/api/report/weekly',{user:B})).goal.includes(title),'undone card back in weekly report');
 await call('/api/kanban/'+card.id,{user:B,method:'PATCH',body:{quadrant:'전략적계획'}});
 await call('/api/kanban/'+card.id,{user:B,method:'DELETE'});
}
const monA=await call('/api/month?ym='+today.slice(0,7));assert.equal(monA.scope,'personal');assert(monA.schedules.every(s=>s.title!=='회사 일정 '+tag),'personal month excludes company schedule');
const hist=await call(`/api/cycle_history?${wk}`);assert.equal(hist.personal,true);
const day=hist.days.find(d=>d.date===today);assert(day&&day.steps.plan&&day.steps.retro&&day.steps.read&&day.done>=3,'personal cycle history from personal_* tables: '+JSON.stringify(day));
const histB=await call(`/api/cycle_history?${wk}`,{user:B});assert.equal(histB.personal,undefined,'company cycle history unchanged shape');
assert.equal((await call('/api/personal/checklist',{user:B})).items.filter(i=>i.checked).length,0);
const task=await call('/api/personal/tasks',{method:'POST',body:{title:'테스트 할 일',category:'학습'}});
await call('/api/personal/tasks/'+task.id,{user:B,method:'PATCH',body:{done:true},status:404});
await call('/api/personal/tasks/'+task.id,{method:'PATCH',body:{done:true}});
await call('/api/personal/focus',{method:'POST',body:{minutes:25,note:'집중 기록',category:'학습'}});
await call('/api/personal/focus',{method:'POST',body:{minutes:0,note:'오류'},status:400});
await call('/api/personal/focus',{method:'POST',body:{minutes:1.5,note:'오류'},status:400});
const result=await call('/api/personal/verifications',{method:'POST',body:{item:'학습 결과',method:'직접 확인',status:'미확인',category:'학습'}});
await call('/api/personal/verifications/'+result.id,{user:B,method:'PATCH',body:{status:'확인됨'},status:404});
await call('/api/personal/verifications/'+result.id,{method:'PATCH',body:{status:'확인됨'}});
const dash=await call('/api/personal/dashboard');assert.deepEqual(dash.summary,{results:1,tasks:1,done:1,focus_minutes:25,unchecked:0});
assert.equal((await call('/api/personal/dashboard',{user:B})).summary.results,0);
assert.equal((await call('/api/personal/dashboard?category=구직')).summary.focus_minutes,0);
assert.equal((await call('/api/personal/journal')).rows.length,2);
assert.equal((await call('/api/personal/journal',{user:B})).rows.length,0);
await call('/api/personal/ui/activate',{method:'POST',body:{version:'personal-v1',base_version:'stale'},status:409});
await call('/api/personal/ui/activate',{method:'POST',body:{version:'personal-v1',base_version:'personal-v1'}});
assert.equal((await call('/api/personal/ui/history')).events.length,1);
const preview=await call('/api/personal/reminders/preview');assert(preview.text.includes('work-cycle 개인용'));assert(preview.text.includes('결과 기록 1건'));
assert(!preview.text.includes('집중 시간')&&!preview.text.includes('계획 대비 완료')&&!preview.text.includes('테스트 할 일'),'personal reminder drops task/focus lines (2026-10-02)');
assert.deepEqual(await call('/api/checklist'),before);
await call('/api/personal/verifications/'+result.id,{method:'DELETE'});
assert.equal((await call('/api/personal/dashboard')).summary.results,0);
// 2026-09-27: 개인용 주간보고는 월~일 7행, 회사용은 월~금 5행 그대로. xlsx는 무압축(STORED)이라 원문에 날짜 글자가 그대로 있다
const wkA=await call('/api/report/weekly?week=2026-09-21');assert.equal(wkA.days.length,7);assert.equal(wkA.week_end,'2026-09-27');assert.deepEqual(wkA.days.slice(5).map(d=>d.dow),['토','일']);
const wkB=await call('/api/report/weekly?week=2026-09-21',{user:B});assert.equal(wkB.days.length,5);assert.equal(wkB.week_end,'2026-09-25');
const xlsx=async user=>{const r=await fetch(base+'/api/report/weekly.xlsx?week=2026-09-21',{headers:{'Cf-Access-Authenticated-User-Email':user}});assert.equal(r.status,200);count++;return Buffer.from(await r.arrayBuffer()).toString('utf8');};
const xA=await xlsx(A),xB=await xlsx(B);assert(xA.includes('2026.09.27')&&xA.includes('(일)'),'personal xlsx has Sunday row');assert(!xB.includes('2026.09.26')&&xB.includes('(금)'),'company xlsx stays Mon-Fri');
assert(xA.includes('A12:F12')&&xB.includes('A10:F10'),'next-week band row follows the day rows');
// 주말 리마인드: 토·일은 개인용만(회사용 알림 없음), 평일은 전과 같음, 금요일 보고 슬롯은 토요일에 안 뜸
const at=iso=>call('/api/reminders/slots?at='+encodeURIComponent(iso));
assert.deepEqual((await at('2026-09-27T08:25:00+09:00')).at,{hhmm:825,dow:0,slot:825,personal_only:true});
assert.deepEqual((await at('2026-09-28T08:25:00+09:00')).at,{hhmm:825,dow:1,slot:825,personal_only:false});
assert.equal((await at('2026-09-25T13:00:00+09:00')).at.slot,1300);assert.equal((await at('2026-09-26T13:00:00+09:00')).at.slot,null);
// 2026-09-27 C2: 퀵 기록 토·일 — 주말만/매일/요일(일) 버튼은 일요일에 200, 평일 매일은 400 그대로, 요일 선택에 6·7 허용
const sun='2026-09-27';
const hb=async body=>{await call('/api/habits',{method:'POST',body});return (await call('/api/habits?from='+sun+'&to='+sun)).buttons.at(-1);};
const hWeekend=await hb({name:'주말 '+tag,repeat_type:'weekend'});assert.equal(hWeekend.repeat_days,'6,7');
const hEvery=await hb({name:'매일 '+tag,repeat_type:'everyday'});assert.equal(hEvery.repeat_days,'1,2,3,4,5,6,7');
const hDaily=await hb({name:'평일 '+tag,repeat_type:'daily'});assert.equal(hDaily.repeat_days,'1,2,3,4,5');
const hSel=await hb({name:'요일 '+tag,repeat_type:'selected',repeat_days:[7,2]});assert.equal(hSel.repeat_days,'2,7');
const tap=(id,status=200)=>call('/api/habits/'+id+'/tap',{method:'POST',body:{date:sun},status});
assert.equal((await tap(hWeekend.id)).date,sun);await tap(hEvery.id);await tap(hSel.id);await tap(hDaily.id,400);
assert.equal((await call('/api/habits?from='+sun+'&to='+sun)).records.filter(r=>r.date===sun).length,3,'sunday records');
// 0021 대댓글: 답글은 parent_id 로 묶이고, 답글의 답글은 뿌리에 붙으며, 뿌리를 지우면 답글도 지워진다
const wlSch=(await call('/api/schedules?'+wk)).rows.find(r=>r.title==='개인 일정 '+tag);
const root=await call('/api/schedules/'+wlSch.id+'/logs',{method:'POST',body:{body:'뿌리 메모 '+tag}});assert.equal(root.parent_id,null);
const rep1=await call('/api/schedules/'+wlSch.id+'/logs',{method:'POST',body:{body:'답글 1',parent_id:root.id}});assert.equal(rep1.parent_id,root.id);assert.equal(rep1.logged_date,root.logged_date);
const rep2=await call('/api/schedules/'+wlSch.id+'/logs',{method:'POST',body:{body:'답글의 답글',parent_id:rep1.id}});assert.equal(rep2.parent_id,root.id,'reply to reply attaches to root');
await call('/api/schedules/'+wlSch.id+'/logs',{method:'POST',body:{body:'남의 메모에 답글',parent_id:root.id},user:B,status:404});
await call('/api/work-logs/'+rep1.id,{method:'PATCH',body:{body:'답글 1 (수정)'}});
const wl=await call('/api/work-logs?date='+today);assert.deepEqual(wl.logs.filter(l=>l.parent_id===root.id).map(l=>l.body).sort(),['답글 1 (수정)','답글의 답글']);
{ // 하루 기록 md (2026-10-02): 실행 계획 · 개인용 일정 메모(답글 들여쓰기) · 하루 회고. 본인 기록만, 첨부로 내려준다.
 const md=async(user,q='date='+today)=>{const r=await fetch(base+'/api/personal/day.md?'+q,{headers:{'Cf-Access-Authenticated-User-Email':user}});count++;return {r,text:await r.text()};};
 const a=await md(A);assert.equal(a.r.status,200);
 assert(a.r.headers.get('content-type').startsWith('text/markdown'),'md content type');
 assert(a.r.headers.get('content-disposition').includes(today+'_work-cycle.md'),'md file name is the date');
 for(const part of ['# '+today+' work-cycle 개인 기록','## 실행 계획','**오늘 이룰 것**','## 메모','### 개인 일정 '+tag,'- '+root.logged_time+' 뿌리 메모 '+tag,'  - ↳ ','답글 1 (수정)','## 하루 회고','**내일 첫 행동**'])assert(a.text.includes(part),'day.md has '+part);
 assert(a.text.indexOf('뿌리 메모')<a.text.indexOf('답글 1 (수정)'),'reply listed under its root');
 const b=await md(B);assert.equal(b.r.status,200);assert(!b.text.includes('뿌리 메모')&&!b.text.includes('개인 일정 '+tag),'other user md has none of A');
 assert(b.text.includes('## 실행 계획\n기록 없음'),'empty plan shows 기록 없음');
 assert.equal((await md(A,'date=2026-02-30')).r.status,400);
}
{ // 하루 기록 md 확장 (2026-10-02 · 0023): 실행 계획·회고 저장 이력, 정리 메모, 메모 없는 일정
 const C=`personal-c-${tag}@example.test`;
 await call('/api/personal/settings',{user:C,method:'PUT',body:{view_mode:'personal'}});
 await call('/api/personal/plan',{user:C,method:'POST',body:{user_flow:'첫 계획 '+tag}});
 await call('/api/personal/plan',{user:C,method:'POST',body:{user_flow:'첫 계획 '+tag}});
 await call('/api/personal/plan',{user:C,method:'POST',body:{user_flow:'바꾼 계획 '+tag,keep:'줄1\n줄2'}});
 await call('/api/personal/retro',{user:C,method:'POST',body:{work_summary:'한 번만 저장한 회고'}});
 const done=await call('/api/schedules',{user:C,method:'POST',body:{date:today,title:'정리만 한 일정 '+tag,block_type:'업무',start_time:'09:00',end_time:'10:00'}});
 await call('/api/schedules/'+done.id,{user:C,method:'PATCH',body:{memo:'정리 메모 첫 줄\n둘째 줄',status:'완료'}});
 await call('/api/schedules',{user:C,method:'POST',body:{date:today,title:'메모 없는 일정 '+tag,block_type:'업무',start_time:'11:00'}});
 const r=await fetch(base+'/api/personal/day.md?date='+today,{headers:{'Cf-Access-Authenticated-User-Email':C}});count++;const t=await r.text();
 const plan=t.slice(t.indexOf('## 실행 계획'),t.indexOf('## 메모')),memo=t.slice(t.indexOf('## 메모'),t.indexOf('## 하루 회고')),retro=t.slice(t.indexOf('## 하루 회고'));
 assert(plan.startsWith('## 실행 계획\n- **오늘 이룰 것**: 바꾼 계획 '+tag),'final plan first');
 assert(plan.includes('### 저장 이력 (2회)'),'same content saved twice is one revision: '+plan);
 assert(plan.indexOf('#### 1. ')<plan.indexOf('첫 계획 '+tag)&&plan.indexOf('첫 계획 '+tag)<plan.indexOf('#### 2. ')&&plan.includes('(최종)'),'revisions in save order');
 assert(plan.includes('**이어갈 습관·자산**: 줄1\n  줄2'),'multi-line field indented');
 assert(retro.includes('한 번만 저장한 회고')&&!retro.includes('저장 이력'),'single save has no history block');
 assert(memo.includes('### ✓ 정리만 한 일정 '+tag+' (09:00~10:00)'),'done schedule marked');
 assert(memo.includes('> **정리 메모**: 정리 메모 첫 줄\n> 둘째 줄'),'schedule summary memo included');
 assert(memo.indexOf('정리만 한 일정')<memo.indexOf('메모 없는 일정 '+tag)&&(memo.match(/\(메모 없음\)/g)||[]).length===2,'schedules without memos listed in time order');
 assert(!(await (await fetch(base+'/api/personal/day.md?date='+today,{headers:{'Cf-Access-Authenticated-User-Email':A}})).text()).includes('바꾼 계획 '+tag),'other user md excludes C');count++;
}
{ // 메모 수정 이력 (2026-10-02 · 0024): 수정 전 내용이 md 에 '✎ 시각 작성/수정'으로 남는다. 같은 내용 재저장·남의 수정은 쌓이지 않는다
 const D=`personal-d-${tag}@example.test`;
 await call('/api/personal/settings',{user:D,method:'PUT',body:{view_mode:'personal'}});
 const sch=await call('/api/schedules',{user:D,method:'POST',body:{date:today,title:'수정 일정 '+tag,block_type:'업무'}});
 const m=await call('/api/schedules/'+sch.id+'/logs',{user:D,method:'POST',body:{body:'처음 메모'}});
 await call('/api/work-logs/'+m.id,{user:D,method:'PATCH',body:{body:'고친 메모'}});
 await call('/api/work-logs/'+m.id,{user:D,method:'PATCH',body:{body:'고친 메모'}});
 await call('/api/work-logs/'+m.id,{user:A,method:'PATCH',body:{body:'남이 고침'},status:404});
 await call('/api/work-logs/'+m.id,{user:D,method:'PATCH',body:{body:'최종 메모'}});
 const rp=await call('/api/schedules/'+sch.id+'/logs',{user:D,method:'POST',body:{body:'처음 답글',parent_id:m.id}});
 await call('/api/work-logs/'+rp.id,{user:D,method:'PATCH',body:{body:'고친 답글'}});
 const md=async()=>{const r=await fetch(base+'/api/personal/day.md?date='+today,{headers:{'Cf-Access-Authenticated-User-Email':D}});count++;return r.text();};
 const t=await md();
 assert(new RegExp('- '+m.logged_time+' 최종 메모 _\\(수정 2회 · 마지막 \\d\\d:\\d\\d\\)_\\n  - ✎ \\d\\d:\\d\\d 작성: 처음 메모\\n  - ✎ \\d\\d:\\d\\d 수정: 고친 메모\\n').test(t),'memo revisions in order, no duplicate: '+t);
 assert(/  - ↳ \d\d:\d\d 고친 답글 _\(수정 1회 · 마지막 \d\d:\d\d\)_\n    - ✎ \d\d:\d\d 작성: 처음 답글/.test(t),'reply revisions indented');
 assert(!t.includes('남이 고침'),'other user edit not recorded');
 await call('/api/work-logs/'+m.id,{user:D,method:'DELETE'});
 const after=await md();assert(!after.includes('처음 메모')&&!after.includes('처음 답글'),'deleted memo history gone');
}
await call('/api/work-logs/'+root.id,{method:'DELETE'});
assert.equal((await call('/api/work-logs?date='+today)).logs.filter(l=>[root.id,rep1.id,rep2.id].includes(l.id)).length,0,'root delete removes replies');
{ // 볼트 history/ 올리기(2026-10-02)는 VAULT_HISTORY_EMAIL 한 사람만 — 일반 사용자에게는 버튼·폴더가 안 보이고 올리기는 403
 const st=await call('/api/vault-history/status');assert.equal(st.mine,false);assert.equal(st.dir,null);
 await call('/api/vault-history/sync',{method:'POST',body:{date:today},status:403});
}
console.log(`PASS: ${count} API checks, ownership isolation, company preservation, aggregate accuracy, reminder preview, JS syntax. No external messages sent.`);
