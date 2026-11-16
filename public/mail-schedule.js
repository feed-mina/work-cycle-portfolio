(()=>{
'use strict';
const $=id=>document.getElementById(id), personal=()=>document.documentElement.dataset.workMode==='personal';
let draft=null,busy=false,dirty=false,generation=0,controller=null;
const selected=new URLSearchParams(location.search);
const states={needs_input:'확인 필요',awaiting_approval:'승인 대기',saved:'개인 일정 저장됨',dismissed:'제외됨'};
const fields=['draftTitleInput','draftCompany','draftDate','draftStart','draftEnd','draftLocation'];
function notice(message){$('draftStatus').textContent=message;}
function fail(error,n){if(n===generation&&personal()&&error.name!=='AbortError'){$('draftError').textContent=error.message;$('draftError').hidden=false;}}
function controls(){
  const editable=draft&&['needs_input','awaiting_approval'].includes(draft.status);
  for(const id of fields)$(id).disabled=busy||!editable;
  $('draftReview').disabled=busy||!editable;$('draftDismiss').disabled=busy||!editable;
  $('draftCreateButton').disabled=busy;$('draftReload').disabled=busy; for(const button of $('draftList').querySelectorAll('button'))button.disabled=busy;
  $('draftConfirm').disabled=busy||dirty||!editable;
  $('draftApprove').disabled=busy||dirty||!editable||draft.status!=='awaiting_approval'||!$('draftConfirm').checked;
}
async function request(path,options={}){
 const response=await fetch('/api/mail-schedule/'+path,{credentials:'same-origin',cache:'no-store',signal:controller.signal,...options});
 const data=await response.json().catch(()=>({error:'서버 응답을 읽을 수 없습니다.'}));
 if(!response.ok)throw new Error(data.error||'요청에 실패했습니다.');return data;
}
const post=(route,body)=>request(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
function list(items){
 $('draftList').replaceChildren();
 if(!items.length){const li=document.createElement('li');li.textContent='아직 만든 초안이 없습니다.';$('draftList').append(li);return;}
 for(const item of items){const li=document.createElement('li'),button=document.createElement('button');button.type='button';button.textContent=(item.candidate.date||'날짜 확인 필요')+' · '+item.candidate.title+' · '+states[item.status];button.disabled=busy;button.addEventListener('click',()=>run(async n=>{const data=await request('drafts/'+encodeURIComponent(item.id));if(n===generation)show(data.draft);}));li.append(button);$('draftList').append(li);}
}
function show(item){
 draft=item;dirty=false;$('draftConfirm').checked=false;$('draftDetail').hidden=false;
 $('draftState').textContent=states[item.status];$('draftSource').textContent='메일 제목: '+item.subject+' · 보낸 사람: '+item.from;
 const c=item.candidate;
 for(const [id,key] of [['draftTitleInput','title'],['draftCompany','company'],['draftDate','date'],['draftStart','start_time'],['draftEnd','end_time'],['draftLocation','location']])$(id).value=c[key];
 $('draftNotice').textContent=[...item.missing,...c.warnings].join(' / ')||'메일에서 읽은 값입니다. 원문과 대조한 뒤 승인해주세요.';
 $('draftQuotes').replaceChildren();
 for(const [key,label] of [['date','날짜'],['start_time','시작 시각'],['end_time','종료 시각'],['location','장소']]){const p=document.createElement('p'),q=document.createElement('blockquote');p.textContent=label;q.textContent=item.extracted.evidence[key]||'원문 근거 없음 · 직접 확인 필요';$('draftQuotes').append(p,q);}
 $('draftCheck').hidden=!item.check;$('draftConflicts').replaceChildren();
 if(item.check){
  const descriptions={checked:'연결된 Google 기본 캘린더 조회 완료',not_connected:'Google 캘린더 미연결 · 외부 일정 충돌 미확인',unavailable:'Google 캘린더 조회 실패 · 외부 일정 충돌 미확인'};
  $('draftGoogle').textContent=descriptions[item.check.google];
  const conflicts=item.check.conflicts;
  if(!conflicts.length){const li=document.createElement('li');li.textContent='조회한 범위에서 겹치는 일정이 없습니다.';$('draftConflicts').append(li);}
  for(const conflict of conflicts){const li=document.createElement('li');li.textContent=(conflict.certainty==='possible'?'겹칠 가능성':'시간 겹침')+' · '+conflict.source+' · '+conflict.title+' · '+conflict.start+' ~ '+conflict.end;$('draftConflicts').append(li);}
  $('draftCheckWarnings').textContent=item.check.warnings.join(' / ');
 }
 $('draftScheduleLink').hidden=item.status!=='saved';
 $('draftScheduleLink').href='/schedule?date='+encodeURIComponent(c.date);
 const url=new URL(location.href);url.searchParams.set('draft',item.id);history.replaceState(null,'',url);controls();
}
async function run(task){
 if(busy||!personal())return;
 const n=generation;busy=true;$('draftError').hidden=true;controls();notice('처리 중입니다.');
 try{await task(n);if(n===generation)notice('');}catch(error){fail(error,n);if(n===generation)notice('');}
 finally{if(n===generation){busy=false;controls();}}
}
async function refresh(){
 generation++;controller?.abort();controller=new AbortController();draft=null;dirty=false;busy=false;
 $('draftConfirm').checked=false;$('draftDetail').hidden=true;$('draftHistory').hidden=true;$('draftCreate').hidden=true;$('draftList').replaceChildren();$('draftError').hidden=true;$('draftPersonalOnly').hidden=personal();notice('');
 for(const id of fields)$(id).value='';$('draftSource').textContent='';$('draftQuotes').replaceChildren();$('draftConflicts').replaceChildren();$('draftNotice').textContent='';
 if(!personal()){controls();return;}
 $('draftHistory').hidden=false;
 const hasSource=selected.get('provider')==='gmail'&&selected.has('messageId')||selected.has('folder')&&selected.has('uid')&&selected.has('validity');
 $('draftCreate').hidden=!hasSource;
 await run(async n=>{
  const data=await request('drafts');if(n!==generation)return;list(data.drafts);
  const id=new URLSearchParams(location.search).get('draft');
  if(id){const detail=await request('drafts/'+encodeURIComponent(id));if(n===generation)show(detail.draft);}
 });
}
$('draftCreateButton').addEventListener('click',()=>run(async n=>{
 const ref=selected.get('provider')==='gmail'?{provider:'gmail',messageId:selected.get('messageId')}:{folder:selected.get('folder'),uid:Number(selected.get('uid')),validity:selected.get('validity')};
 const data=await post('drafts',ref);
 if(n!==generation)return;show(data.draft);const historyData=await request('drafts');if(n===generation)list(historyData.drafts);
}));
$('draftForm').addEventListener('input',()=>{dirty=true;$('draftConfirm').checked=false;controls();});
$('draftForm').addEventListener('submit',event=>{
 event.preventDefault();run(async n=>{
  const candidate={title:$('draftTitleInput').value,company:$('draftCompany').value,date:$('draftDate').value,start_time:$('draftStart').value,end_time:$('draftEnd').value,location:$('draftLocation').value};
  const data=await post('drafts/'+encodeURIComponent(draft.id)+'/review',{version:draft.version,candidate});if(n===generation)show(data.draft);
 });
});
$('draftConfirm').addEventListener('change',controls);
$('draftApprove').addEventListener('click',()=>run(async n=>{
 if(dirty||!$('draftConfirm').checked)return;
 const data=await post('drafts/'+encodeURIComponent(draft.id)+'/approve',{version:draft.version,review_token:draft.review_token,acknowledge:true});
 if(n!==generation)return;show(data.draft);const historyData=await request('drafts');if(n===generation)list(historyData.drafts);
}));
$('draftDismiss').addEventListener('click',()=>run(async n=>{
 const data=await post('drafts/'+encodeURIComponent(draft.id)+'/dismiss',{version:draft.version});if(n===generation)show(data.draft);
}));
$('draftReload').addEventListener('click',refresh);
document.addEventListener('wc:mode',refresh);refresh();
})();
