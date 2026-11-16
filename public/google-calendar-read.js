(() => {
  'use strict';
  const root=document.getElementById('googleCalendarRead');
  if(!root)return;
  const status=document.getElementById('googleCalendarStatus');
  const controls=document.getElementById('googleCalendarControls');
  const range=document.getElementById('googleCalendarRange');
  const from=document.getElementById('googleCalendarFrom');
  const to=document.getElementById('googleCalendarTo');
  const message=document.getElementById('googleCalendarMessage');
  const list=document.getElementById('googleCalendarEvents');
  const connection=document.getElementById('googleCalendarConnection');
  const quick=[...root.querySelectorAll('[data-calendar-range]')];
  const mark=active=>quick.forEach(button=>button.classList.toggle('on',button===active));
  let generation=0,controller=null;
  const isPersonal=()=>document.documentElement.dataset.workMode==='personal';
  const dateNow=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const plusDays=(date,n)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  const dateLabel=date=>{
    if(date.date){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date.date);return (m?Number(m[2])+'. '+Number(m[3])+'.':date.date)+' 종일';}
    try{return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(date.dateTime));}
    catch{return '시간 확인 필요';}
  };
  // 같은 날 끝나는 일정은 끝나는 쪽에 시각만 적는다 (예: 11. 12. 14:00 ~ 15:00).
  const endLabel=(start,end)=>{const a=dateLabel(start),b=dateLabel(end),day=a.slice(0,a.lastIndexOf(' ')+1);return day&&b.startsWith(day)?b.slice(day.length):b;};
  function clear(){list.replaceChildren();message.textContent='';}
  function cancel(){generation++;if(controller)controller.abort();controller=null;clear();}
  async function request(url,signal){
    const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal});
    const payload=await response.json().catch(()=>({error:'응답을 확인할 수 없습니다.'}));
    if(!response.ok)throw new Error(payload.error||'요청에 실패했습니다.');
    return payload;
  }
  async function loadEvents(){
    cancel();if(!isPersonal()||controls.hidden)return;
    const current=generation;controller=new AbortController();
    message.textContent='Google 일정을 불러오는 중입니다.';
    try{
      const p=new URLSearchParams({from:from.value,to:to.value});
      const data=await request('/api/google-calendar/events?'+p,controller.signal);
      if(current!==generation||!isPersonal())return;
      for(const event of data.events){
        const li=document.createElement('li');
        const title=document.createElement('strong');title.textContent=event.summary;
        const when=document.createElement('span');when.className='gw-when';
        when.textContent=dateLabel(event.start)+(event.allDay?'':(' ~ '+endLabel(event.start,event.end)));
        li.append(when,title);list.append(li);
      }
      message.textContent=data.events.length?`${data.events.length}개 일정 · 읽기 전용 · 방금 확인`: '선택한 기간에 일정이 없습니다.';
    }catch(error){if(error.name!=='AbortError'&&current===generation&&isPersonal())message.textContent=error.message;}
  }
  async function refresh(){
    cancel();root.hidden=!isPersonal();controls.hidden=true;status.classList.remove('on');connection.open=true;
    if(root.hidden){status.textContent='';return;}
    const current=generation;controller=new AbortController();status.textContent='연결 상태 확인 중입니다.';
    try{
      const data=await request('/api/google-calendar/status',controller.signal);
      if(current!==generation||!isPersonal())return;
      if(data.connected){
        status.textContent=`저장된 Google 계정: ${data.account} · 읽기 전용`;status.classList.add('on');connection.open=false;
        document.getElementById('googleCalendarAccount').value=data.account;
        controls.hidden=false;from.value=dateNow();to.value=plusDays(from.value,6);mark(quick.find(button=>button.dataset.calendarRange==='week'));
        await loadEvents();
      }else{
        const reasons={migration_required:'일정 연결 DB 설정이 필요합니다.',configuration_required:'Google 연결 설정이 필요합니다.',not_connected:'연결된 Google 캘린더가 없습니다.'};
        status.textContent=reasons[data.reason]||'연결 상태를 확인해 주세요.';
      }
    }catch(error){if(error.name!=='AbortError'&&current===generation&&isPersonal())status.textContent=error.message;}
  }
  range.addEventListener('submit',event=>{event.preventDefault();mark(null);loadEvents();});
  quick.forEach(button=>button.addEventListener('click',()=>{
    mark(button);from.value=dateNow();const days={day:0,week:6,month:29};to.value=plusDays(from.value,days[button.dataset.calendarRange]);loadEvents();
  }));
  document.addEventListener('wc:mode',refresh);
  refresh();
})();
