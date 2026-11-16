/* 회의록 원문 전체 공유. 요약/할 일 선택 옵션을 두지 않는다. */
(() => {
  const urls = new Map();
  window.getMeetingShareUrl = (id, updatedAt) => {
    const value = urls.get(Number(id));
    return value?.updated_at === updatedAt ? value.url : null;
  };
  document.addEventListener('wc:mode', () => { generation++; urls.clear(); document.getElementById('meetingSharePanel')?.remove(); });
  document.addEventListener('wc:meeting-shares-revoked', event => {
    const id=Number(event.detail.id);urls.delete(id);
    const panel=document.getElementById('meetingSharePanel');
    if(panel?.dataset.meetingId===String(id)){generation++;panel.remove();}
  });
  let generation = 0;
  async function request(path, method='GET', body) {
    const r = await fetch(path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || '공유 요청을 처리하지 못했습니다');
    return d;
  }
  const escape = s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  window.openMeetingShare = async id => {
    const current = ++generation;
    let panel=document.getElementById('meetingSharePanel');
    if (panel) panel.remove();
    panel=document.createElement('section');panel.id='meetingSharePanel';panel.className='meeting-share-panel';panel.dataset.meetingId=String(id);
    panel.setAttribute('aria-label','회의록 원문 공유');
    document.getElementById('meetingDetail').append(panel);
    panel.innerHTML='<h3 tabindex="-1">저장된 원문 공유</h3><p role="status">공유 상태 확인 중</p>';
    panel.querySelector('h3').focus();
    const endpoint=`/api/meetings/${id}/share`;
    try {
      const d=await request(endpoint);
      if(current!==generation || !panel.isConnected)return;
      if(!d.available){const p=panel.querySelector('p');p.textContent=d.reason;return;}
      panel.innerHTML=`<div class="meeting-toolbar"><h3 tabindex="-1">저장된 원문 공유</h3><button type="button" class="btn2 ghost" data-close>닫기</button></div>
        <p>앱에 저장된 원문 전체를 읽기 전용으로 공유합니다. 링크를 가진 사람은 로그인 없이 볼 수 있습니다.</p>
        <p class="sub">공유한 시점의 원문과 HTML 실습 기능을 보관합니다. 새 링크를 만들면 이전 링크는 중지됩니다.</p>
        <p data-state class="sub">${d.active?'공유 중':'비공개 또는 공유 종료'}${d.expires_at?' · 만료 '+escape(new Date(d.expires_at).toLocaleString('ko-KR')):''}</p>
        <label>링크 만료 <select data-days><option value="7">7일 후</option><option value="30">30일 후</option><option value="0">기한 없음</option></select></label>
        <label class="meeting-share-check"><input type="checkbox" data-confirm> 저장된 원문 전체를 외부에 공유해도 되는지 확인했습니다.</label>
        <div class="meeting-toolbar"><button type="button" class="btn2" data-create disabled>${d.active?'원문 갱신 · 새 링크 만들기':'공유 링크 만들기'}</button><button type="button" class="btn2 ghost" data-revoke ${d.active?'':'hidden'}>공유 중지</button></div>
        <div data-linkbox ${d.active&&urls.has(id)?'':'hidden'}><label>공유 주소<input data-url readonly aria-label="공유 주소"></label><div class="meeting-toolbar"><button type="button" class="btn2 ghost" data-copy>링크 복사</button><a class="btn2 ghost" data-open target="_blank" rel="noopener noreferrer">공유 화면 열기</a></div></div>
        <p data-status role="status"></p>`;
      const find=s=>panel.querySelector(s), confirm=find('[data-confirm]'), create=find('[data-create]'), status=find('[data-status]');
      function setLink(url){find('[data-url]').value=url;find('[data-open]').href=url;find('[data-linkbox]').hidden=false;}
      const knownUrl=d.url||window.getMeetingShareUrl(id,d.updated_at);
      if(d.active&&knownUrl)urls.set(Number(id),{url:knownUrl,updated_at:d.updated_at});
      find('[data-linkbox]').hidden=!d.active||!knownUrl;
      if(d.active&&knownUrl){setLink(knownUrl);status.textContent='기존 공유 주소입니다. 다시 복사해도 주소와 만료일은 바뀌지 않습니다.';}
      find('[data-close]').onclick=()=>{generation++;panel.remove();document.getElementById('meetingShareButton')?.focus();};
      confirm.onchange=()=>{create.disabled=!confirm.checked;};
      find('[data-days]').onchange=()=>{confirm.checked=false;create.disabled=true;};
      function lock(value){panel.querySelectorAll('button,input,select').forEach(el=>el.disabled=value);if(!value)create.disabled=!confirm.checked;}
      create.onclick=async()=>{lock(true);status.textContent='원문 공유 링크 만드는 중';try{const result=await request(endpoint,'POST',{days:Number(find('[data-days]').value),confirmed:confirm.checked});document.dispatchEvent(new CustomEvent('wc:meeting-shares-changed'));if(current!==generation||!panel.isConnected)return;urls.set(id,{url:result.url,updated_at:result.updated_at});document.dispatchEvent(new CustomEvent('wc:meeting-shares-changed'));setLink(result.url);find('[data-state]').textContent='공유 중'+(result.expires_at?' · 만료 '+new Date(result.expires_at).toLocaleString('ko-KR'):' · 만료 기한 없음');find('[data-revoke]').hidden=false;create.textContent='원문 갱신 · 새 링크 만들기';confirm.checked=false;status.textContent='저장된 원문 전체를 공유했습니다. 이전 링크가 있었다면 중지됩니다.';}catch(e){status.textContent=e.message;}finally{lock(false);}};
      find('[data-revoke]').onclick=async()=>{lock(true);try{await request(endpoint,'DELETE');urls.delete(id);document.dispatchEvent(new CustomEvent('wc:meeting-shares-changed'));if(current!==generation||!panel.isConnected)return;find('[data-linkbox]').hidden=true;find('[data-url]').value='';find('[data-open]').removeAttribute('href');find('[data-state]').textContent='공유 중지됨';find('[data-revoke]').hidden=true;create.textContent='공유 링크 만들기';confirm.checked=false;status.textContent='공유를 중지했습니다. 기존 링크로 새로 열람할 수 없습니다.';}catch(e){status.textContent=e.message;}finally{lock(false);}};
      find('[data-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(find('[data-url]').value);status.textContent='링크를 복사했습니다.';}catch{find('[data-url]').focus();find('[data-url]').select();status.textContent='선택한 주소를 복사해 주세요.';}};
    }catch(e){if(panel.isConnected)panel.querySelector('p').textContent=e.message;}
  };
})();
