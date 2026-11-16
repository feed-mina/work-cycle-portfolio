(() => {
  'use strict';
  const $=id=>document.getElementById(id), root=$('naverMail');if(!root)return;
  let generation=0,controller=null,folder='',validity='',nextBefore=null,cursors=[null],page=0,query='',matched=0;
  const personal=()=>document.documentElement.dataset.workMode==='personal';
  function clearDetail(){ $('naverScheduleDraft').hidden=true;$('naverScheduleDraft').href='/mail-schedule'; $('naverDetail').hidden=true; for(const id of ['naverSubject','naverFrom','naverTo','naverDate','naverBody'])$(id).textContent='';$('naverAttachments').replaceChildren(); }
  function clearList(){ $('naverMessages').replaceChildren();$('naverCount').textContent='';$('naverPage').textContent='';$('naverNext').disabled=true;$('naverPrevious').disabled=true;clearDetail(); }
  function begin(){generation++;controller?.abort();controller=new AbortController();$('naverError').hidden=true;return generation;}
  const active=n=>n===generation&&personal();
  function error(e,n){if(e.name!=='AbortError'&&active(n)){$('naverError').textContent=e.message;$('naverError').hidden=false;}}
  async function request(path,options={}){
    const response=await fetch('/api/naver-mail/'+path,{credentials:'same-origin',cache:'no-store',signal:controller.signal,...options});
    const data=await response.json().catch(()=>({error:'메일 서버 응답을 확인할 수 없습니다.'}));
    if(!response.ok)throw new Error(data.error||'메일 조회에 실패했습니다.');return data;
  }
  const formatDate=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(d):value;};
  function setQuery(value){query=value.trim();$('naverQuery').value=query;$('naverSearchClear').hidden=!query;}
  async function detail(uid){
    const n=begin();clearDetail();
    try{const data=await request('message?'+new URLSearchParams({folder,uid,validity}));if(!active(n))return;
      $('naverSubject').textContent=data.subject;$('naverFrom').textContent='보낸 사람: '+data.from;$('naverTo').textContent='받는 사람: '+data.to.join(', ');$('naverDate').textContent=formatDate(data.date);$('naverBody').textContent=data.text;
      for(const a of data.attachments){const li=document.createElement('li'),link=document.createElement('a');link.textContent=a.filename+' ('+a.size.toLocaleString()+'바이트)';link.href='/api/naver-mail/attachment?'+new URLSearchParams({folder,uid,validity,index:a.index});link.setAttribute('download','');li.append(link);$('naverAttachments').append(li);}
      $('naverScheduleDraft').href='/mail-schedule?'+new URLSearchParams({folder,uid,validity});$('naverScheduleDraft').hidden=false;
      $('naverDetail').hidden=false;$('naverSubject').focus({preventScroll:true});wcMail.reveal($('naverDetail'));
    }catch(e){error(e,n);}
  }
  async function list(before=null){
    const n=begin();clearList();$('naverCount').textContent='메일을 불러오는 중입니다.';
    try{const params=new URLSearchParams({folder});if(before)params.set('before',before);if(query)params.set('q',query);if(validity)params.set('validity',validity);
      const data=await request('messages?'+params);if(!active(n))return;validity=data.validity;nextBefore=data.next_before;
      for(const mail of data.messages)$('naverMessages').append(wcMail.row({from:mail.from,date:mail.date,subject:mail.subject,unread:!mail.seen},()=>detail(mail.uid)));
      if(page===0)matched=data.matched||0;
      $('naverCount').textContent=query?(matched?'검색 결과 '+matched.toLocaleString()+'개 중 이번 페이지 '+data.messages.length+'개':'검색 결과가 없습니다. 제목과 보낸 사람에서만 찾습니다.'):data.total.toLocaleString()+'개 중 이번 페이지 '+data.messages.length+'개'+(data.messages.length?'':' · 표시할 메일이 없습니다.');$('naverPage').textContent=(page+1)+'페이지';$('naverPrevious').disabled=page===0;$('naverNext').disabled=!nextBefore;
    }catch(e){if(active(n))$('naverCount').textContent='';error(e,n);}
  }
  async function folders(){
    const n=begin();clearList();$('naverFolder').replaceChildren();$('naverCount').textContent='메일함을 불러오는 중입니다.';
    try{const data=await request('folders');if(!active(n))return;for(const f of data.folders){const option=document.createElement('option');option.value=f.id;option.textContent=f.name;$('naverFolder').append(option);}
      folder=$('naverFolder').value;validity='';cursors=[null];page=0;if(folder)await list();else $('naverCount').textContent='외부 앱에서 조회할 수 있는 메일함이 없습니다.';
    }catch(e){error(e,n);}
  }
  async function refresh(){
    const n=begin();clearList();setQuery('');$('naverPassword').value='';$('naverFolder').replaceChildren();$('naverConnected').hidden=true;$('naverConnectButton').disabled=true;root.hidden=!personal();$('naverPersonalOnly').hidden=personal();$('naverStatus').classList.remove('on');if(root.hidden){$('naverStatus').textContent='';$('naverAccount').value='';return;}
    $('naverStatus').textContent='연결 상태 확인 중입니다.';
    try{const data=await request('status');if(!active(n))return;
      $('naverStatus').classList.toggle('on',!!data.connected);
      if(data.connected){$('naverStatus').textContent='연결 계정: '+data.account+' · 읽기 전용';$('naverAccount').value=data.account;$('naverConnection').open=false;$('naverConnected').hidden=false;$('naverConnectButton').disabled=false;await folders();}
      else{const reasons={migration_required:'메일 연결 DB 설정이 필요합니다.',configuration_required:'메일 연결 암호화 설정이 필요합니다.',not_connected:'네이버 메일이 아직 연결되지 않았습니다.'};$('naverStatus').textContent=reasons[data.reason]||'연결 상태를 확인해주세요.';$('naverConnection').open=true;$('naverConnectButton').disabled=data.reason!=='not_connected';}
    }catch(e){error(e,n);}
  }
  $('naverConnect').addEventListener('submit',async event=>{
    event.preventDefault();if(!personal())return;const n=begin();$('naverConnectButton').disabled=true;
    try{await request('connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:$('naverAccount').value,password:$('naverPassword').value})});if(active(n))await refresh();}
    catch(e){error(e,n);}finally{$('naverPassword').value='';if(active(n))$('naverConnectButton').disabled=false;}
  });
  $('naverDisconnect').addEventListener('click',async()=>{const n=begin();try{await request('disconnect',{method:'POST'});if(active(n))await refresh();}catch(e){error(e,n);}});
  $('naverReload').addEventListener('click',folders);
  // 검색: 고른 메일함 안에서 제목·보낸 사람에 검색어가 들어간 메일만 첫 페이지부터 다시 불러온다.
  $('naverSearch').addEventListener('submit',event=>{event.preventDefault();setQuery($('naverQuery').value);page=0;cursors=[null];if(folder)list();});
  $('naverSearchClear').addEventListener('click',()=>{setQuery('');page=0;cursors=[null];if(folder)list();});
  $('naverFolder').addEventListener('change',()=>{folder=$('naverFolder').value;validity='';page=0;cursors=[null];list();});
  $('naverPrevious').addEventListener('click',()=>{if(page>0){page--;list(cursors[page]);}});
  $('naverNext').addEventListener('click',()=>{if(nextBefore){cursors[++page]=nextBefore;list(nextBefore);}});
  document.addEventListener('wc:mode',refresh);refresh();
})();
