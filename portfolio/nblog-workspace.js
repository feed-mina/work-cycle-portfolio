/* Same mount contract as production; replaces only the external NBlog bridge. */
(() => {
  'use strict';
  window.WorkCycleNBlog={mount({parent,campaign,onPublished}){
    const D=window.workCycleDemo,R=D.state().recent;
    const box=document.createElement('section');box.className='nblog-publish-workspace';
    box.innerHTML='<h4>리뷰 초안·발행 체험</h4><p>허구 사진과 메모로 체험합니다. 실제 사진 업로드·AI 호출·네이버 발행은 없습니다.</p><label>예시 사진<select data-photo><option value="">선택해 주세요</option><option>카페 내부 예시 사진</option><option>음료 예시 사진</option></select></label><label>방문 메모<textarea data-notes rows="3" maxlength="8000" placeholder="허구의 방문 경험을 적어 보세요"></textarea></label><div class="nblog-actions"><button type="button" class="btn2" data-create>예시 초안 만들기</button><button type="button" class="btn2 ghost" data-resume>기존 초안 확인</button></div><p data-status role="status"></p><div data-preview hidden><h5>검토할 초안</h5><pre data-body></pre><button type="button" class="btn2" data-publish>예시 발행 주소 저장</button></div>';
    parent.append(box);const el=k=>box.querySelector('[data-'+k+']');
    const show=()=>{const draft=R.blogDrafts[campaign.id];el('preview').hidden=!draft;el('body').textContent=draft?.body||'';el('status').textContent=draft?'예시 초안 확인 완료 · 이 브라우저에 저장됨':'저장된 예시 초안이 없습니다.';};
    el('create').onclick=()=>{const notes=el('notes').value.trim();if(!notes&&!el('photo').value){el('status').textContent='예시 사진이나 방문 메모를 먼저 추가해 주세요.';return;}R.blogDrafts[campaign.id]={body:campaign.name+'\n\n'+notes+'\n\n'+el('photo').value+'\n\n#허구체험 #예시초안'};(R.progress[campaign.id]||=[]).push({state:'ready',updated_at:new Date().toISOString()});D.save();show();};
    el('resume').onclick=show;el('publish').onclick=async()=>{el('publish').disabled=true;try{await onPublished('https://example.com/post/demo');}catch(e){el('status').textContent=e.message;el('publish').disabled=false;}};show();
  }};
})();
