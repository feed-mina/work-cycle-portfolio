(() => {
  const el=id=>document.getElementById(id);
  const status=text=>{el('personalUiStatus').textContent=text;};
  const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  async function request(path,method='GET',body){
    const r=await fetch('/api/personal'+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const d=await r.json();if(!r.ok)throw new Error(d.error||'기록을 처리하지 못했습니다.');return d;
  }
  const run=fn=>async e=>{e?.preventDefault();try{await fn(e);}catch(err){status(err.message);}};
  let today, current;
  function rows(target,items,render,empty){const box=el(target);if(!box)return;box.replaceChildren();if(!items.length)box.append(node('p',empty));for(const item of items)box.append(render(item));}
  async function refresh(){
    const form=el('personalFilters');
    const query=form?new URLSearchParams(new FormData(form)):new URLSearchParams({from:today,to:today});
    current=await request('/dashboard?'+query);
    if(!form)return;
    el('personalRange').textContent=current.from+' ~ '+current.to+' · '+(current.category||'전체 분류');
    el('personalResultCount').textContent=current.summary.results+'건';
    el('personalNext').textContent='최근 회고의 다음 행동 (전체 분류): '+(current.next?.tomorrow_prompt||'아직 남긴 다음 행동이 없습니다.');
    el('personalPending').textContent='미확인 결과 '+current.summary.unchecked+'건';
    const tbody=el('personalResultRows');tbody.replaceChildren();
    for(const item of current.results){const tr=node('tr');for(const value of [item.cycle_date,item.item,item.category,item.method,item.status])tr.append(node('td',value));const td=node('td'),btn=node('button','상세 / 수정');btn.type='button';btn.className='btn2 ghost';btn.addEventListener('click',()=>window.openVerifModal(item,refresh));td.append(btn);tr.append(td);tbody.append(tr);}
    if(!current.results.length){const td=node('td','선택한 기간에 결과 기록이 없습니다.');td.colSpan=6;const tr=node('tr');tr.append(td);tbody.append(tr);}
    const history=await request('/journal?from='+current.from+'&to='+current.to);
    rows('personalJournal',history.rows,item=>{const detail=node('details');detail.className='personal-detail';detail.append(node('summary',item.cycle_date+' · '+item.kind+' · '+item.ui_version),node('p',item.body));return detail;},'선택한 기간에 계획과 회고가 없습니다.');
  }
  function setPeriod(){const f=el('personalFilters'),d=new Date(today+'T00:00:00Z');if(f.period.value==='week')d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);else if(f.period.value==='month')d.setUTCDate(1);else return;f.from.value=d.toISOString().slice(0,10);f.to.value=today;}
  async function init(){
    const me=await (await fetch('/api/me')).json();today=me.today;if(el('me'))el('me').textContent=me.email;
    const profile=await request('/ui');
    // 개인 3원칙 배너는 principles.js 가 모든 화면에서 같은 모양으로 그린다 (여기서 따로 만들지 않음)
    for(const [formId,labels] of [['planForm',profile.planLabels],['retroForm',profile.retroLabels]]){const form=el(formId);if(!form)continue;for(const [name,label] of Object.entries(labels)){const input=form.elements[name];if(input?.previousElementSibling?.tagName==='LABEL'){input.previousElementSibling.textContent=label;input.id='personal-'+name;input.previousElementSibling.htmlFor=input.id;}}}
    // #personalUiStatus 는 저장 결과·오류만 표시한다 (초기 안내 문구 없음 · 2026-09-26)
    const filter=el('personalFilters');if(filter){setPeriod();filter.addEventListener('submit',run(refresh));filter.period.addEventListener('change',run(async()=>{setPeriod();await refresh();}));for(const name of ['from','to'])filter.elements[name].addEventListener('change',()=>{filter.period.value='custom';});}
    const settings=await request('/settings');if(el('personalReminderMode')){
      el('personalReminderMode').value=settings.reminder_mode;
      el('personalReminderSave').addEventListener('click',run(async()=>{await request('/settings','PUT',{reminder_mode:el('personalReminderMode').value});status('예약 알림 선택을 저장했습니다. 다음 예약 시각부터 적용됩니다.');}));
      const preview=node('pre');preview.id='personalPreviewText';(el('personalPreview').closest('.inline')||el('personalPreview').parentElement).after(preview);
      el('personalPreview').addEventListener('click',run(async()=>{preview.textContent=(await request('/reminders/preview')).text;}));
    }
    // "개인 화면 버전과 적용 이력" 카드는 화면에서 뺐다(2026-09-26). 서버 /api/personal/ui/history·/ui/activate 와
    // personal_ui_versions·personal_ui_events 표는 기록 날짜별 버전 고정에 계속 쓰이므로 그대로 둔다.
    // 기간 집계는 나의 준비 현황(/personal-dashboard)에만 있다. 개인 할 일·집중 시간 카드는 2026-10-02에 화면에서 뺐고
    // personal_tasks·personal_focus 표와 /api/personal/tasks·focus API는 보존한다.
    if(el('personalFilters'))await refresh();
  }
  init().catch(e=>status(e.message));
})();
