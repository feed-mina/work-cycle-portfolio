(()=>{
'use strict';
const $=id=>document.getElementById(id),personal=()=>document.documentElement.dataset.workMode==='personal';
let generation=0,controller=null,busy=false,page='',history=[],selectedReview=null;
const headers={'Content-Type':'application/json'};
async function request(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:controller.signal,...options});const data=await r.json().catch(()=>({error:'서버 응답을 확인할 수 없습니다.'}));if(!r.ok)throw new Error(data.error||'요청에 실패했습니다.');return data;}
const post=(url,body={})=>request(url,{method:'POST',headers,body:JSON.stringify(body)});
function error(e,n){if(e.name!=='AbortError'&&n===generation&&personal()){const box=$('gmailError')||$('googleSyncError');box.textContent=e.message;box.hidden=false;}}
function clearError(){for(const id of ['gmailError','googleSyncError'])if($(id)){$(id).textContent='';$(id).hidden=true;}}
async function run(task){if(busy||!personal())return;busy=true;const n=generation;clearError();try{await task(n);}catch(e){error(e,n);}finally{if(n===generation)busy=false;}}
function clearPrivate(){
 for(const id of ['gmailMessages','gmailAttachments','googleSyncItems'])$(id)?.replaceChildren();
 for(const id of ['gmailSubject','gmailFrom','gmailDate','gmailBody','gmailStatus','googleSyncStatus','googleSyncProgress','googleReviewLocal','googleReviewRemote'])if($(id))$(id).textContent='';
 for(const id of ['gmailAccount','googleSyncAccount','gmailQuery'])if($(id))$(id).value='';
 for(const id of ['gmailDetail','gmailConnected','googleSyncConnected','googleSyncReview'])if($(id))$(id).hidden=true;
 for(const id of ['googleSyncConfirm','googleReviewConfirm'])if($(id))$(id).checked=false;
 for(const id of ['gmailStatus','googleSyncStatus'])$(id)?.classList.remove('on');
 if($('googleSyncCalendar'))$('googleSyncCalendar').replaceChildren();selectedReview=null;page='';history=[];
}
async function refresh(){
 generation++;controller?.abort();controller=new AbortController();busy=false;clearError();clearPrivate();
 for(const id of ['gmailMail','googleSyncCard'])if($(id))$(id).hidden=!personal();
 if(!personal())return;
 const n=generation;await run(async()=>{
  const data=await request('/api/google-workspace/status');if(n!==generation)return;
  if($('gmailMail')){
   $('gmailConnectButton').disabled=!data.configured;
   $('gmailStatus').textContent=data.gmail.connected?'연결된 Gmail: '+data.gmail.account:'Gmail을 연결하면 선택한 메일을 읽을 수 있습니다.';
   $('gmailStatus').classList.toggle('on',data.gmail.connected);$('gmailConnection').open=!data.gmail.connected;
   if(data.gmail.connected){$('gmailAccount').value=data.gmail.account;$('gmailConnected').hidden=false;await loadGmail(n);}
  }
  if($('googleSyncCard')){
   $('googleSyncConnectButton').disabled=!data.configured;
   $('googleSyncStatus').textContent=data.calendar.connected?'연결된 Google 계정: '+data.calendar.account:'수정 권한으로 Google 계정을 연결해 주세요. 기존 읽기 전용 연결과 별도입니다.';
   $('googleSyncStatus').classList.toggle('on',data.calendar.connected);$('googleSyncConnection').open=!data.calendar.connected;
   if(data.calendar.connected){
    $('googleSyncAccount').value=data.calendar.account;$('googleSyncConnected').hidden=false;
    const [catalog,state]=await Promise.all([request('/api/google-sync/calendars'),request('/api/google-sync/status')]);if(n!==generation)return;
    for(const item of catalog.calendars){const option=document.createElement('option');option.value=item.id;option.textContent=item.title+(item.primary?' · 기본':'');$('googleSyncCalendar').append(option);}
    if(state.settings&&catalog.calendars.some(v=>v.id===state.settings.calendar_id))$('googleSyncCalendar').value=state.settings.calendar_id;
    showSync(state);
   }
  }
 });
}
async function loadGmail(n){
 $('gmailDetail').hidden=true;$('gmailBody').textContent='';$('gmailMessages').replaceChildren();$('gmailCount').textContent='메일을 읽는 중입니다.';
 const p=new URLSearchParams({q:$('gmailQuery').value,page}),data=await request('/api/gmail/messages?'+p);if(n!==generation||!personal())return;
 for(const mail of data.messages)$('gmailMessages').append(wcMail.row(mail,()=>run(async n=>{
   const detail=await request('/api/gmail/messages/'+encodeURIComponent(mail.id));if(n!==generation)return;
   $('gmailSubject').textContent=detail.subject;$('gmailFrom').textContent='보낸 사람: '+detail.from;$('gmailDate').textContent=wcMail.when(detail.date);$('gmailBody').textContent=detail.text;
   $('gmailAttachments').replaceChildren();for(const attachment of detail.attachments){const a=document.createElement('li');a.textContent=attachment.name+' · '+attachment.size+'바이트 · 파일은 Gmail에서 열기';$('gmailAttachments').append(a);}
   $('gmailDraft').href='/mail-schedule?'+new URLSearchParams({provider:'gmail',messageId:detail.id});$('gmailDetail').hidden=false;wcMail.reveal($('gmailDetail'));
  })));
 $('gmailCount').textContent=data.messages.length?data.messages.length+'개 메일 표시':'표시할 메일이 없습니다.';
 $('gmailNext').disabled=!data.nextPageToken;$('gmailPrevious').disabled=!history.length;$('gmailNext').dataset.page=data.nextPageToken||'';
}
function showSync(data){
 const s=data.settings;const active=!!s?.enabled;
 $('googleSyncRun').disabled=!active;$('googleSyncPause').disabled=!active;
 $('googleSyncProgress').textContent=!s?'대상 캘린더와 동기화 범위를 확인한 뒤 켜 주세요.':(active?'양방향 동기화 켜짐':'동기화 일시 정지')+(s.more?' · 가져올 변경분이 남아 있습니다. 다시 동기화하거나 예약 실행을 기다려 주세요.':'')+(s.last_success_at?' · 최근 처리: '+new Date(s.last_success_at).toLocaleString('ko-KR'):'')+(s.last_error?' · '+s.last_error:'');
 $('googleSyncItems').replaceChildren();
 for(const item of data.items){const li=document.createElement('li'),title=document.createElement('strong'),reason=document.createElement('p');title.textContent=item.title;reason.className='google-note';reason.textContent=item.reason||item.state;li.append(title,reason);
  if(['conflict','local_deleted','remote_deleted'].includes(item.state)){const button=document.createElement('button');button.type='button';button.className='btn2 ghost';button.textContent='변경 내용 비교';button.addEventListener('click',()=>run(async n=>{const detail=await request('/api/google-sync/review/'+encodeURIComponent(item.event_id));if(n===generation)showReview(detail);}));li.append(button);}
  $('googleSyncItems').append(li);
 }
}
function showReview(detail){
 selectedReview=detail;$('googleSyncReview').hidden=false;$('googleReviewConfirm').checked=false;
 const l=detail.local,r=detail.remote;
 $('googleReviewLocal').textContent=l?[l.title,l.date,(l.start_time||'종일')+' ~ '+(l.end_time||'종료 미정'),l.body||''].join('\n'):'work-cycle에서 삭제된 일정입니다.';
 $('googleReviewRemote').textContent=r.status==='cancelled'?'Google에서 삭제된 일정입니다.':[r.summary,r.start?.date||r.start?.dateTime||'',r.end?.date||r.end?.dateTime||'',r.description].join('\n');
 $('googleReviewUseLocal').hidden=detail.state!=='conflict';$('googleReviewUseGoogle').hidden=detail.state!=='conflict';$('googleReviewDelete').hidden=detail.state==='conflict';$('googleReviewKeep').hidden=detail.state==='conflict';
 $('googleReviewDelete').textContent=detail.state==='remote_deleted'?'work-cycle에서도 삭제':'Google에서도 삭제';
 $('googleReviewKeep').textContent=detail.state==='remote_deleted'?'개인 일정 보존·이 일정 동기화 종료':'Google 일정 보존·이 일정 동기화 종료';
 reviewControls();
}
function reviewControls(){for(const id of ['googleReviewUseLocal','googleReviewUseGoogle','googleReviewDelete','googleReviewKeep'])if($(id))$(id).disabled=!$('googleReviewConfirm').checked;}
if($('gmailMail')){
 $('gmailSearch').addEventListener('submit',event=>{event.preventDefault();run(async n=>{page='';history=[];await loadGmail(n);});});
 $('gmailReload').addEventListener('click',()=>run(loadGmail));
 $('gmailNext').addEventListener('click',()=>run(async n=>{history.push(page);page=$('gmailNext').dataset.page;await loadGmail(n);}));
 $('gmailPrevious').addEventListener('click',()=>run(async n=>{page=history.pop()||'';await loadGmail(n);}));
 $('gmailDisconnect').addEventListener('click',()=>run(async()=>{await request('/api/google-workspace/gmail',{method:'DELETE'});await refresh();}));
}
if($('googleSyncCard')){
 $('googleSyncConfigure').addEventListener('submit',event=>{event.preventDefault();run(async n=>{await post('/api/google-sync/configure',{calendar_id:$('googleSyncCalendar').value,acknowledge:$('googleSyncConfirm').checked});if(n!==generation)return;$('googleSyncConfirm').checked=false;showSync(await request('/api/google-sync/status'));});});
 $('googleSyncRun').addEventListener('click',()=>run(async n=>{$('googleSyncProgress').textContent='변경분을 확인하고 동기화하는 중입니다.';const result=await post('/api/google-sync/run');if(n!==generation)return;showSync(await request('/api/google-sync/status'));document.dispatchEvent(new Event('wc:google-sync'));}));
 $('googleSyncPause').addEventListener('click',()=>run(async n=>{await post('/api/google-sync/pause');if(n===generation)showSync(await request('/api/google-sync/status'));}));
 $('googleSyncDisconnect').addEventListener('click',()=>run(async()=>{await request('/api/google-workspace/calendar',{method:'DELETE'});await refresh();}));
 $('googleReviewConfirm').addEventListener('change',reviewControls);
 for(const [id,action] of [['googleReviewUseLocal','local'],['googleReviewUseGoogle','google'],['googleReviewDelete','delete'],['googleReviewKeep','keep']])$(id).addEventListener('click',()=>run(async n=>{
  if(!selectedReview||!$('googleReviewConfirm').checked)return;
  await post('/api/google-sync/review/'+encodeURIComponent(selectedReview.event_id),{version:selectedReview.version,review_token:selectedReview.review_token,action,acknowledge:true});if(n!==generation)return;
  $('googleSyncReview').hidden=true;selectedReview=null;showSync(await request('/api/google-sync/status'));document.dispatchEvent(new Event('wc:google-sync'));
 }));
}
document.addEventListener('wc:mode',refresh);refresh();
})();
