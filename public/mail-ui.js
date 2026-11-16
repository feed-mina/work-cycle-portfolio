// 메일 화면 공용 UI — Gmail/네이버 탭 전환과 메일 목록 한 줄 만들기.
// naver-mail.js · google-workspace.js 보다 먼저 불러야 합니다 (window.wcMail 사용).
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const sameYear=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
const otherYear=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'numeric',day:'numeric'});
const yearOf=d=>new Date(d.getTime()+9*3600000).getUTCFullYear();
// 메일 서버가 준 날짜(영문 원문 등)를 한국 시간의 짧은 표기로 바꾼다. 해석할 수 없으면 원문 그대로 보여준다.
function when(value){
  const raw=String(value||'');if(!raw||/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
  const d=new Date(raw);if(!Number.isFinite(d.getTime()))return raw;
  return (yearOf(d)===yearOf(new Date())?sameYear:otherYear).format(d);
}
// "이름" <주소> 에서 이름만. 이름이 없으면 주소를 그대로 쓴다.
function who(from){
  const raw=String(from||'').trim(),m=raw.match(/^"?([^"<]*?)"?\s*<([^>]+)>$/);
  return (m?(m[1].trim()||m[2].trim()):raw)||'(보낸 사람 없음)';
}
function row(mail,open){
  const li=document.createElement('li'),button=document.createElement('button'),sender=document.createElement('span'),date=document.createElement('span'),subject=document.createElement('strong');
  button.type='button';button.className='mail-row'+(mail.unread?' unread':'');
  sender.className='who';sender.textContent=who(mail.from);sender.title=String(mail.from||'');
  date.className='when';date.textContent=when(mail.date);
  subject.className='subj';subject.textContent=mail.subject||'(제목 없음)';
  button.append(sender,date,subject);
  if(mail.unread){const badge=document.createElement('span');badge.className='gw-sr';badge.textContent=' · 읽지 않은 메일';button.append(badge);}
  button.addEventListener('click',()=>{
    for(const other of li.parentElement.querySelectorAll('.mail-row[aria-current]'))other.removeAttribute('aria-current');
    button.setAttribute('aria-current','true');open();
  });
  li.append(button);return li;
}
// 좁은 화면에서는 본문이 목록 아래에 있으므로 열린 본문으로 화면을 옮긴다.
function reveal(element){if(matchMedia('(max-width:760px)').matches)element.scrollIntoView({block:'start'});}
window.wcMail={row,when,who,reveal};

const box=$('mailBox');if(!box)return;
const tabs=[{name:'gmail',tab:$('mailTabGmail'),panel:$('mailPanelGmail'),connected:$('gmailConnected')},{name:'naver',tab:$('mailTabNaver'),panel:$('mailPanelNaver'),connected:$('naverConnected')}];
const KEY='wc.mailTab',personal=()=>document.documentElement.dataset.workMode==='personal';
function show(name,options={}){
  const target=tabs.find(t=>t.name===name)||tabs[0];
  for(const t of tabs){const on=t===target;t.tab.setAttribute('aria-selected',String(on));t.tab.tabIndex=on?0:-1;t.panel.hidden=!on;}
  if(options.remember)try{localStorage.setItem(KEY,target.name);}catch{}
  if(options.focus)target.tab.focus();
}
tabs.forEach((t,index)=>{
  t.tab.addEventListener('click',()=>show(t.name,{remember:true}));
  t.tab.addEventListener('keydown',event=>{
    const step={ArrowRight:1,ArrowLeft:-1}[event.key];if(!step)return;
    event.preventDefault();show(tabs[(index+step+tabs.length)%tabs.length].name,{remember:true,focus:true});
  });
  // 연결된 메일함은 탭에 초록 점으로 표시한다. 연결 여부는 각 화면 스크립트가 바꾸는 hidden 값을 그대로 따른다.
  const mark=()=>{const on=!t.connected.hidden;t.tab.classList.toggle('connected',on);t.tab.querySelector('.gw-sr').textContent=on?' (연결됨)':' (연결 안 됨)';};
  new MutationObserver(mark).observe(t.connected,{attributes:true,attributeFilter:['hidden']});mark();
});
function mode(){box.hidden=!personal();}
let first=location.hash.slice(1);
if(!tabs.some(t=>t.name===first))try{first=localStorage.getItem(KEY)||'';}catch{first='';}
show(first);addEventListener('hashchange',()=>{const name=location.hash.slice(1);if(tabs.some(t=>t.name===name))show(name);});
document.addEventListener('wc:mode',mode);mode();
})();
