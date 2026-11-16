/* 공유 목록에는 원문·토큰을 담지 않고, 선택한 주소만 작성자 API로 조회한다. */
(() => {
  const root = document.getElementById('meetingShareManager');
  if (!root) return;
  const el = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const names = {all:'전체',active:'공유 중',expired:'만료',revoked:'중지'};
  const date = value => value ? new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}) : '기한 없음';
  let generation=0, page=1, filter='all', rows=[], pending=null, busy=false, timer;
  const links=new Map();
  const status = text => {el('shareManagerStatus').textContent=text;};
  const visible = () => document.getElementById('tab-list')?.style.display !== 'none' && !el('shareManagerBody').hidden;
  async function request(path,options) {
    const response=await fetch(path,{cache:'no-store',...options});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error || '공유 목록을 불러오지 못했습니다.');
    return data;
  }
  function closeConfirm(){pending=null;el('shareManagerConfirm').hidden=true;}
  function knownUrl(row){return row.status==='active' ? (links.get(row.meeting_id)?.updated_at===row.updated_at ? links.get(row.meeting_id).url : window.getMeetingShareUrl?.(row.meeting_id,row.updated_at)) : null;}
  function render(data){
    rows=data.rows;page=data.page;
    root.querySelectorAll('[data-share-filter]').forEach(button=>{
      const key=button.dataset.shareFilter;
      button.textContent=names[key]+' '+(data.counts[key==='all'?'total':key] || 0);
      button.setAttribute('aria-pressed',String(key===filter));button.classList.toggle('ghost',key!==filter);
    });
    el('shareManagerRows').innerHTML=rows.length?rows.map(row=>{
      const url=knownUrl(row);

      return `<article class="share-manager-item" data-share-item="${row.meeting_id}"><div class="share-manager-item-head"><div class="share-manager-item-title"><strong>${escape(row.title)}</strong><span class="share-manager-state">${names[row.status]}</span><p class="sub">회의일 ${escape(row.meeting_date)} · 최근 공유 ${date(row.updated_at)}<br>${row.status==='revoked'?'중지 '+date(row.revoked_at):'만료 '+date(row.expires_at)}</p></div><div class="meeting-toolbar"><button type="button" class="btn2 ghost" data-share-action="original" data-id="${row.meeting_id}">원문 보기</button>${row.status==='active'?`<button type="button" class="btn2" data-share-action="view" data-id="${row.meeting_id}" aria-expanded="${!!url}">링크 보기</button><button type="button" class="btn2 ghost" data-share-action="stop" data-id="${row.meeting_id}">공유 중지</button>`:`<button type="button" class="btn2 ghost" data-share-action="create" data-id="${row.meeting_id}">새 링크 만들기</button>`}</div></div><div class="share-manager-linkbox" data-share-linkbox ${url?'':'hidden'}>${url?linkMarkup(row,url):''}</div></article>`;

    }).join(''):'<p class="sub">조건에 맞는 공유 내역이 없습니다.</p>';
    const from=data.total?(page-1)*data.page_size+1:0,to=Math.min(page*data.page_size,data.total);
    el('shareManagerPager').innerHTML=`<button type="button" class="btn2 ghost" data-share-page="${page-1}" ${page<=1?'disabled':''}>이전</button><span>${page} / ${data.pages} · ${from}–${to} / ${data.total}개 · 5개씩</span><button type="button" class="btn2 ghost" data-share-page="${page+1}" ${page>=data.pages?'disabled':''}>다음</button>`;
  }

  function linkMarkup(row,url){
    return `<label>공유 주소<input readonly data-share-url aria-label="공유 주소" value="${escape(url)}"></label><div class="meeting-toolbar"><button type="button" class="btn2 ghost" data-share-action="copy" data-id="${row.meeting_id}">링크 복사</button><a class="btn2 ghost" href="${escape(url)}" target="_blank" rel="noopener noreferrer">공유 화면 열기</a><button type="button" class="btn2 ghost" data-share-action="refresh-content" data-id="${row.meeting_id}">내용만 갱신 · 주소 유지</button><button type="button" class="btn2 ghost" data-share-action="create" data-id="${row.meeting_id}">새 링크로 교체</button></div><p class="sub">기존 주소입니다. 다시 보거나 복사해도 주소와 만료일은 바뀌지 않습니다.</p>`;
  }
  async function reveal(row,button,save=false){
    const current=generation,mode=document.documentElement.dataset.workMode;
    const item=button.closest('[data-share-item]'),box=item.querySelector('[data-share-linkbox]');
    const value=item.querySelector('[data-share-legacy-url]')?.value;
    button.disabled=true;status(save?'기존 주소를 확인하는 중입니다.':'기존 공유 주소를 확인하는 중입니다.');
    try{
      const data=await request('/api/meetings/'+row.meeting_id+'/share-link',save?{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:value})}:undefined);
      if(current!==generation||mode!==document.documentElement.dataset.workMode||!item.isConnected)return;
      box.hidden=false;item.querySelector('[data-share-action="view"]').setAttribute('aria-expanded','true');
      if(data.url){links.set(row.meeting_id,{url:data.url,updated_at:row.updated_at});box.innerHTML=linkMarkup(row,data.url);status(save?'기존 주소를 등록했습니다. 링크는 변경되지 않았습니다.':'기존 공유 주소입니다. 복사하거나 공유 화면을 열 수 있습니다.');}
      else{
        box.innerHTML=`<p class="sub">예전에 만든 주소는 서버에 보관되지 않았습니다. 열어 둔 공유 탭이나 보낸 메시지에서 주소를 복사해 등록하면 기존 링크를 그대로 쓸 수 있어요.</p><label>기존 공유 주소 등록<input type="url" data-share-legacy-url placeholder="https://…/s/m/…" aria-label="기존 공유 주소 등록" autocomplete="off"></label><div class="meeting-toolbar"><button type="button" class="btn2" data-share-action="save-link" data-id="${row.meeting_id}">기존 주소 등록</button><button type="button" class="btn2 ghost" data-share-action="create" data-id="${row.meeting_id}">새 링크 만들기</button></div><p class="sub">주소를 찾지 못해 새 링크를 만들면 이전 링크는 중지됩니다.</p>`;
        status('보관한 기존 주소를 등록해 주세요.');box.querySelector('input').focus();
      }
    }catch(error){if(current===generation&&mode===document.documentElement.dataset.workMode)status(error.message);}
    finally{button.disabled=false;}
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
    if(action==='view'||action==='save-link')return reveal(row,button,action==='save-link');
    if(action==='refresh-content'){
      if(!window.confirm('이 보고서의 최신 원문으로 공유 내용을 갱신할까요? 기존 주소와 만료일은 유지됩니다.'))return;
      const mode=document.documentElement.dataset.workMode;busy=true;button.disabled=true;status('최신 원문으로 내용을 갱신하는 중입니다.');
      try{const result=await request('/api/meetings/'+id+'/share',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmed:true,expected_updated_at:row.updated_at})});
        if(result.url)links.set(id,{url:result.url,updated_at:result.updated_at});else links.delete(id);
        await load();if(mode===document.documentElement.dataset.workMode)status('내용을 갱신했습니다. 기존 공유 주소와 만료일은 유지됩니다.');
      }catch(error){if(mode===document.documentElement.dataset.workMode)status('내용 갱신 실패: '+error.message);}
      finally{busy=false;button.disabled=false;}return;
    }
    if(action==='copy'){
      const url=knownUrl(row);if(!url)return status('주소를 다시 확인해 주세요.');
      try{await navigator.clipboard.writeText(url);status('공유 주소를 복사했습니다.');}
      catch{const input=button.closest('[data-share-item]').querySelector('[data-share-url]');input?.focus();input?.select();status('주소를 선택했습니다. Ctrl+C로 복사해 주세요.');}return;
    }
    if(action==='stop'){pending={id,title:row.title,mode:document.documentElement.dataset.workMode};el('shareManagerConfirmTitle').textContent=row.title;el('shareManagerConfirm').hidden=false;el('shareManagerCancel').focus();}
  });
  el('shareManagerCancel').onclick=()=>{const id=pending?.id;closeConfirm();root.querySelector(`[data-share-action="stop"][data-id="${id}"]`)?.focus();};
  el('shareManagerStop').onclick=async()=>{
    if(!pending||busy)return;const target=pending;busy=true;
    el('shareManagerStop').disabled=true;el('shareManagerCancel').disabled=true;
    try{await request('/api/meetings/'+target.id+'/share',{method:'DELETE'});links.delete(target.id);closeConfirm();document.dispatchEvent(new CustomEvent('wc:meeting-shares-revoked',{detail:{id:target.id}}));await load();if(target.mode===document.documentElement.dataset.workMode)status('공유를 중지했습니다. 기존 링크로 새로 열람할 수 없습니다.');}
    catch(error){if(target.mode===document.documentElement.dataset.workMode)status('공유 중지 실패: '+error.message);}
    finally{busy=false;el('shareManagerStop').disabled=false;el('shareManagerCancel').disabled=false;}
  };
  el('shareManagerSearch').onsubmit=event=>{event.preventDefault();page=1;load();};
  el('shareManagerQuery').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{page=1;load();},250);};
  el('shareManagerSort').onchange=()=>{page=1;load();};el('shareManagerRefresh').onclick=load;
  el('shareManagerToggle').onclick=()=>{const body=el('shareManagerBody');body.hidden=!body.hidden;el('shareManagerToggle').textContent=body.hidden?'펼치기':'접기';el('shareManagerToggle').setAttribute('aria-expanded',String(!body.hidden));if(!body.hidden)load();};
  document.querySelector('[data-tab="list"]')?.addEventListener('click',load);
  document.addEventListener('wc:meeting-shares-changed',load);
  document.addEventListener('wc:mode',()=>{++generation;clearTimeout(timer);links.clear();rows=[];page=1;closeConfirm();el('shareManagerRows').replaceChildren();el('shareManagerPager').replaceChildren();status('');load();});
  load();
})();
