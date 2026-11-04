/* 공유 목록은 현재 작성자·사용 화면만 조회한다. 원문과 공유 토큰은 목록에 포함하지 않는다. */
(() => {
  const root = document.getElementById('meetingShareManager');
  if (!root) return;
  const el = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const names = {all:'전체',active:'공유 중',expired:'만료',revoked:'중지'};
  const date = value => value ? new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}) : '기한 없음';
  let generation=0, page=1, filter='all', rows=[], pending=null, busy=false, timer;
  const status = text => {el('shareManagerStatus').textContent=text;};
  const visible = () => document.getElementById('tab-list')?.style.display !== 'none' && !el('shareManagerBody').hidden;
  async function request(path,options) {
    const response=await fetch(path,{cache:'no-store',...options});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error || '공유 목록을 불러오지 못했습니다.');
    return data;
  }
  function closeConfirm(){pending=null;el('shareManagerConfirm').hidden=true;}
  function knownUrl(row){return row.status==='active' ? window.getMeetingShareUrl?.(row.meeting_id,row.updated_at) : null;}
  function render(data){
    rows=data.rows;page=data.page;
    root.querySelectorAll('[data-share-filter]').forEach(button=>{
      const key=button.dataset.shareFilter;
      button.textContent=names[key]+' '+(data.counts[key==='all'?'total':key] || 0);
      button.setAttribute('aria-pressed',String(key===filter));button.classList.toggle('ghost',key!==filter);
    });
    el('shareManagerRows').innerHTML=rows.length?rows.map(row=>{
      const url=knownUrl(row);
      return `<article class="share-manager-item"><div class="share-manager-item-head"><div class="share-manager-item-title"><strong>${escape(row.title)}</strong><span class="share-manager-state">${names[row.status]}</span><p class="sub">회의일 ${escape(row.meeting_date)} · 최근 공유 ${date(row.updated_at)}<br>${row.status==='revoked'?'중지 '+date(row.revoked_at):'만료 '+date(row.expires_at)}</p></div><div class="meeting-toolbar"><button type="button" class="btn2 ghost" data-share-action="original" data-id="${row.meeting_id}">원문 보기</button>${url?`<button type="button" class="btn2 ghost" data-share-action="copy" data-id="${row.meeting_id}">링크 복사</button><a class="btn2 ghost" href="${escape(url)}" target="_blank" rel="noopener noreferrer">공유 화면 열기</a>`:`<button type="button" class="btn2 ghost" data-share-action="create" data-id="${row.meeting_id}">새 링크 만들기</button>`}${row.status==='active'?`<button type="button" class="btn2 ghost" data-share-action="stop" data-id="${row.meeting_id}">공유 중지</button>`:''}</div></div>${row.status==='active'&&!url?'<p class="sub">이전 주소는 복원할 수 없습니다. 공유 중지는 바로 할 수 있어요.</p>':''}</article>`;
    }).join(''):'<p class="sub">조건에 맞는 공유 내역이 없습니다.</p>';
    const from=data.total?(page-1)*data.page_size+1:0,to=Math.min(page*data.page_size,data.total);
    el('shareManagerPager').innerHTML=`<button type="button" class="btn2 ghost" data-share-page="${page-1}" ${page<=1?'disabled':''}>이전</button><span>${page} / ${data.pages} · ${from}–${to} / ${data.total}개 · 5개씩</span><button type="button" class="btn2 ghost" data-share-page="${page+1}" ${page>=data.pages?'disabled':''}>다음</button>`;
  }
  async function load(){
    if(!visible())return;
    const current=++generation,mode=document.documentElement.dataset.workMode;
    closeConfirm();root.setAttribute('aria-busy','true');status('공유 목록을 불러오는 중입니다.');
    const params=new URLSearchParams({status:filter,q:el('shareManagerQuery').value.trim(),sort:el('shareManagerSort').value,page:String(page)});
    try{const data=await request('/api/meeting-shares?'+params);if(current!==generation||mode!==document.documentElement.dataset.workMode)return;render(data);status('공유 내역 '+data.total+'개');}
    catch(error){if(current!==generation)return;rows=[];el('shareManagerRows').replaceChildren();el('shareManagerPager').replaceChildren();status(error.message+' 새로고침으로 다시 시도해 주세요.');}
    finally{if(current===generation)root.removeAttribute('aria-busy');}
  }
  async function openOriginal(id,sharing){
    const current=generation,mode=document.documentElement.dataset.workMode;
    try{
      // 회의록 기본 목록의 100개 범위 밖이어도 해당 공유 문서로 들어갈 수 있다.
      if(!MEETING_ROWS.some(row=>Number(row.id)===id)){
        const data=await request('/api/meetings/'+id+'/share-source');
        if(current!==generation||mode!==document.documentElement.dataset.workMode)return;
        MEETING_ROWS.push(data.meeting);MEETING_SCOPE=data.scope;
      }
      await openMeeting(id);
      if(current!==generation||mode!==document.documentElement.dataset.workMode)return;
      el('meetingDetail')?.scrollIntoView({block:'start',behavior:'smooth'});
      if(sharing)await window.openMeetingShare(id);
    }catch(error){status(error.message);}
  }
  root.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button||busy)return;
    if(button.dataset.shareFilter){filter=button.dataset.shareFilter;page=1;await load();return;}
    if(button.dataset.sharePage){page=Number(button.dataset.sharePage);await load();return;}
    const id=Number(button.dataset.id),action=button.dataset.shareAction;
    const row=rows.find(row=>Number(row.meeting_id)===id);if(!row)return;
    if(action==='original'||action==='create')return openOriginal(id,action==='create');
    if(action==='copy'){
      const url=knownUrl(row);if(!url)return status('주소를 다시 확인해 주세요.');
      try{await navigator.clipboard.writeText(url);status('공유 주소를 복사했습니다.');}
      catch{status('자동 복사를 사용할 수 없습니다. 원문의 공유 설정에서 주소를 선택해 복사해 주세요.');}return;
    }
    if(action==='stop'){pending={id,title:row.title,mode:document.documentElement.dataset.workMode};el('shareManagerConfirmTitle').textContent=row.title;el('shareManagerConfirm').hidden=false;el('shareManagerCancel').focus();}
  });
  el('shareManagerCancel').onclick=()=>{const id=pending?.id;closeConfirm();root.querySelector(`[data-share-action="stop"][data-id="${id}"]`)?.focus();};
  el('shareManagerStop').onclick=async()=>{
    if(!pending||busy)return;const target=pending;busy=true;
    el('shareManagerStop').disabled=true;el('shareManagerCancel').disabled=true;
    try{await request('/api/meetings/'+target.id+'/share',{method:'DELETE'});closeConfirm();document.dispatchEvent(new CustomEvent('wc:meeting-shares-revoked',{detail:{id:target.id}}));await load();if(target.mode===document.documentElement.dataset.workMode)status('공유를 중지했습니다. 기존 링크로 새로 열람할 수 없습니다.');}
    catch(error){if(target.mode===document.documentElement.dataset.workMode)status('공유 중지 실패: '+error.message);}
    finally{busy=false;el('shareManagerStop').disabled=false;el('shareManagerCancel').disabled=false;}
  };
  el('shareManagerSearch').onsubmit=event=>{event.preventDefault();page=1;load();};
  el('shareManagerQuery').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{page=1;load();},250);};
  el('shareManagerSort').onchange=()=>{page=1;load();};el('shareManagerRefresh').onclick=load;
  el('shareManagerToggle').onclick=()=>{const body=el('shareManagerBody');body.hidden=!body.hidden;el('shareManagerToggle').textContent=body.hidden?'펼치기':'접기';el('shareManagerToggle').setAttribute('aria-expanded',String(!body.hidden));if(!body.hidden)load();};
  document.querySelector('[data-tab="list"]')?.addEventListener('click',load);
  document.addEventListener('wc:meeting-shares-changed',load);
  document.addEventListener('wc:mode',()=>{++generation;clearTimeout(timer);rows=[];page=1;closeConfirm();el('shareManagerRows').replaceChildren();el('shareManagerPager').replaceChildren();status('');load();});
  load();
})();
