/* Local adapters for the current production UI. No provider credentials or network fallback. */
(() => {
  'use strict';
  const D=window.workCycleDemo, S=D.state(), {on,json,err,save,nextId,today,shift}=D;
  const day=shift(today(),1), stamp=()=>new Date().toISOString();
  if(!S.recent){
    S.recent={drafts:[],cancellations:{},imported:{},harness:false,blogDrafts:{},progress:{},
      campaigns:[{id:9001,version:1,name:'예시 · 달빛 카페 방문',source_id:'sample-1',campaign_url:'https://example.com/campaign/sample-1',phone:'',deadline_date:shift(today(),7),requirements:'허구 체험단입니다. 방문 메모와 사진 설명을 확인하세요.',keywords:'예시, 방문 기록',visit_date:today(),visit_start:'13:00',visit_end:'14:00',visited_at:stamp()}]};
    S.schedules.push({id:nextId(),date:day,title:'예시 · 새봄 스튜디오 면접',start_time:'14:00',end_time:'15:00',block_type:'회의',status:'미완료',body:'허구 면접 일정입니다.',scope:'personal',created_by:'guest@example.com',user_email:'guest@example.com'});save();
  }
  const R=S.recent;
  const shareURL=row=>new URL('/share-demo?id='+row.meeting_id+'&version='+row.updated_at,location.origin).href;
  const activeShare=id=>S.shares.find(s=>String(s.meeting_id)===id&&!s.revoked_at&&(!s.expires_at||s.expires_at>Date.now()));
  on('GET','/api/meetings/:id/share-link',(q,b,p)=>{const row=activeShare(p.id);return row?json({url:shareURL(row)}):err('활성화된 예시 공유가 없습니다.',404);});
  on('PUT','/api/meetings/:id/share-link',(q,b,p)=>{const row=activeShare(p.id);return row&&b.url===shareURL(row)?json({url:b.url}):err('이 브라우저에서 만든 예시 주소만 사용할 수 있습니다.');});
  on('PATCH','/api/meetings/:id/share',(q,b,p)=>{const row=activeShare(p.id),meeting=S.meetings.find(m=>String(m.id)===p.id);if(!row||!meeting)return err('활성화된 예시 공유가 없습니다.',404);if(!b.confirmed||b.expected_updated_at!==row.updated_at)return err('공유 상태를 다시 확인해 주세요.',409);row.body=meeting.body_md;row.content_updated_at=stamp();save();return json({url:shareURL(row),updated_at:row.updated_at});});
  const mail=[{id:'sample-interview',uid:101,subject:'[예시] 새봄 스튜디오 면접 안내',from:'새봄 채용팀 <recruit@example.com>',to:['guest@example.com'],date:today()+'T09:00:00+09:00',unread:true,seen:false,text:`안녕하세요. 새봄 스튜디오의 허구 면접 안내입니다.\n일시: ${day} 14:00 ~ 15:00\n장소: 온라인 예시 회의실\n포트폴리오에 대해 이야기를 나눕니다. 실제 연락이나 참석은 필요하지 않습니다.`,attachments:[]},
    {id:'sample-project',uid:102,subject:'[예시] 프로젝트 회의 자료',from:'예시 팀 <team@example.com>',to:['guest@example.com'],date:today()+'T08:00:00+09:00',unread:false,seen:true,text:'회의록에서 결정 사항을 읽고 칸반으로 할 일을 옮겨 보세요.',attachments:[]}];
  const filtered=q=>mail.filter(m=>(m.subject+' '+m.from).includes(q.get('q')||''));
  on('GET','/api/google-workspace/status',()=>json({configured:false,gmail:{connected:true,account:'guest@example.com'},calendar:{connected:false}}));
  on('GET','/api/gmail/messages',q=>json({messages:filtered(q),nextPageToken:null}));
  on('GET','/api/gmail/messages/:id',(q,b,p)=>mail.find(m=>m.id===p.id)?json(mail.find(m=>m.id===p.id)):err('예시 메일을 찾을 수 없습니다.',404));
  on('GET','/api/naver-mail/status',()=>json({configured:false,connected:true,account:'sample@example.com'}));
  on('GET','/api/naver-mail/folders',()=>json({folders:[{id:'INBOX',name:'예시 받은메일함'}]}));
  on('GET','/api/naver-mail/messages',q=>json({messages:filtered(q),total:mail.length,matched:filtered(q).length,validity:'demo',next_before:null}));
  on('GET','/api/naver-mail/message',q=>mail.some(m=>String(m.uid)===q.get('uid'))?json(mail.find(m=>String(m.uid)===q.get('uid'))):err('예시 메일을 찾을 수 없습니다.',404));
  on('GET','/api/google-calendar/status',()=>json({connected:true,account:'guest@example.com'}));
  on('GET','/api/google-calendar/events',q=>json({events: day>=(q.get('from')||'')&&day<=(q.get('to')||'9999')?[{summary:'예시 · 포트폴리오 검토',start:{dateTime:day+'T16:00:00+09:00'},end:{dateTime:day+'T17:00:00+09:00'}}]:[]}));
  const findDraft=id=>R.drafts.find(d=>String(d.id)===id);
  on('GET','/api/mail-schedule/drafts',()=>json({drafts:R.drafts}));
  on('GET','/api/mail-schedule/drafts/:id',(q,b,p)=>findDraft(p.id)?json({draft:findDraft(p.id)}):err('초안을 찾을 수 없습니다.',404));
  on('POST','/api/mail-schedule/drafts',(q,b)=>{
    const m=mail.find(m=>b.provider==='gmail'?m.id===b.messageId:m.uid===b.uid);if(!m)return err('예시 메일을 선택해 주세요.');
    const existing=R.drafts.find(d=>d.source_id===m.id&&d.status!=='dismissed');if(existing)return json({draft:existing});
    const candidate={title:'예시 · 새봄 스튜디오 면접',company:'새봄 스튜디오(허구)',date:day,start_time:'14:00',end_time:'15:00',location:'온라인 예시 회의실',warnings:['AI 호출 없이 미리 준비한 예시를 표시합니다.']};
    const hasDate=m.id==='sample-interview';
    if(!hasDate)Object.assign(candidate,{title:'예시 · 일정 확인 필요',company:'',date:'',start_time:'',end_time:'',location:''});
    const draft={id:nextId(),version:1,source_id:m.id,status:'needs_input',subject:m.subject,from:m.from,candidate,missing:hasDate?[]:['이 메일에는 면접 날짜와 시간이 없습니다. 직접 확인해 주세요.'],extracted:{evidence:hasDate?{date:day,start_time:'14:00',end_time:'15:00',location:'온라인 예시 회의실'}:{}}};
    R.drafts.unshift(draft);save();return json({draft});
  });
  on('POST','/api/mail-schedule/drafts/:id/:action',(q,b,p)=>{
    const d=findDraft(p.id);if(!d)return err('초안 없음',404);
    if(p.action==='approve'&&d.status==='saved')return json({draft:d});
    if(d.version!==b.version)return err('다른 화면에서 바뀌었습니다. 목록을 새로고침해 주세요.',409);
    if(['saved','dismissed'].includes(d.status))return err('이미 처리한 초안입니다.',409);
    if(p.action==='review'){
      const c=b.candidate||{};if(!c.title?.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(c.date)||!c.start_time||c.end_time<=c.start_time)return err('제목·날짜와 종료 시간이 시작 시간보다 늦은지 확인해 주세요.');
      d.candidate={...c,warnings:['허구 데이터만 비교했습니다.']};d.status='awaiting_approval';d.review_token='demo-'+nextId();
      d.check={google:'not_connected',warnings:['실제 Google 캘린더에는 접근하지 않습니다.'],conflicts:S.schedules.filter(s=>s.date===c.date&&s.status!=='취소'&&s.start_time<c.end_time&&s.end_time>c.start_time).map(s=>({certainty:'certain',source:'Work-cycle 예시',title:s.title,start:s.start_time,end:s.end_time}))};
    }else if(p.action==='approve'){
      if(d.status!=='awaiting_approval'||!b.acknowledge||b.review_token!==d.review_token)return err('초안을 검토하고 확인란을 선택해 주세요.');
      const id=nextId();S.schedules.push({id,...d.candidate,block_type:'회의',status:'미완료',scope:'personal',user_email:'guest@example.com',created_by:'guest@example.com',body:'허구 메일에서 저장한 일정'});d.status='saved';d.schedule_id=id;
    }else if(p.action==='dismiss')d.status='dismissed';else return err('지원하지 않는 동작',404);
    d.version++;save();return json({draft:d});
  });
  on('GET','/api/schedules/:id/interview-cancellation',(q,b,p)=>{const schedule=S.schedules.find(s=>String(s.id)===p.id);return schedule?json({schedule,record:R.cancellations[p.id]||null,google_linked:false}):err('일정 없음',404);});
  on('PUT','/api/schedules/:id/interview-cancellation',(q,b,p)=>{
    const s=S.schedules.find(s=>String(s.id)===p.id);if(!s)return err('일정 없음',404);const old=R.cancellations[p.id];
    if(b.version!==(old?.version||0))return err('기록이 바뀌었습니다. 다시 열어 주세요.',409);
    const record={...b,version:(old?.version||0)+1,cancelled_at:b.mode==='cancel'?stamp():old?.cancelled_at};R.cancellations[p.id]=record;
    if(record.cancelled_at)s.status='취소';save();return json({record});
  });
  const docs=['docs','05-Assets','07-Projects'].map((folder,i)=>({path:folder+'/sample-'+i+'.md',name:'sample-'+i+'.md',title:['예시 · 주간 회의록','예시 · 화면 인수인계','예시 · 프로젝트 계획'][i],folder,date:today(),changed_at:today()+`T0${9-i}:00:00Z`,kind:'md',size:256,sha:'demo-'+i,body:'# '+['주간 회의록','화면 인수인계','프로젝트 계획'][i]+'\n\n실제 ME 문서가 아닌 허구 예시입니다.\n\n## 할 일 (Action Items)\n- [ ] 체험 결과를 확인하고 칸반에 기록하기'}));
  on('GET','/api/vault/index',q=>{const rows=docs.filter(d=>(!q.get('folder')||d.folder===q.get('folder'))&&(!q.get('q')||(d.title+d.name).includes(q.get('q')))).map(d=>({...d,imported:!!R.imported[d.path]}));return json({rows,collections:[],total:rows.length,folders:docs.map(d=>({folder:d.folder,count:1})),tree_sha:'demo',revision:'demo-v1',github_calls:0,cached:true,since:q.get('since')||''});});
  on('POST','/api/vault/import',(q,b)=>{const d=docs.find(d=>d.path===b.path);if(!d)return err('예시 문서 없음',404);if(R.imported[d.path])return json({ok:true,already:true});const id=nextId();S.meetings.push({id,date:today(),title:d.title,body_md:d.body,body_mode:'full_md',scope:'personal',created_by:'guest@example.com',created_at:stamp()});R.imported[d.path]=id;save();return json({ok:true,id,title:d.title,chars:d.body.length,kind:"md"});});
  on('GET','/api/nblog-campaigns',()=>json({rows:R.campaigns}));
  on('POST','/api/nblog-campaigns/inspect',()=>json({candidate:{source_id:'sample-new',campaign_url:'https://example.com/campaign/sample-new',name:'예시 · 별빛 공방',phone:'',deadline:shift(today(),7),requirements:'작품과 방문 경험을 예시로 기록하기',keywords:'공방, 체험',deadline_evidence:'예시 안내문'}}));
  on('POST','/api/nblog-campaigns',(q,b)=>{if(!b.reviewed||!b.name?.trim())return err('이름과 확인란을 확인해 주세요.');let c=R.campaigns.find(c=>c.source_id===b.source_id);if(c)return json({campaign:c,reused:true});c={...b,id:nextId(),version:1,deadline_date:b.deadline};R.campaigns.unshift(c);save();return json({campaign:c});});
  on('PATCH','/api/nblog-campaigns/:id',(q,b,p)=>{
    const c=R.campaigns.find(c=>String(c.id)===p.id);if(!c)return err('캠페인 없음',404);if(c.version!==b.version)return err('목록을 다시 불러와 주세요.',409);
    if(b.action==='visit'){
      if(!b.date||!b.start||b.end<=b.start)return err('방문 날짜와 시간을 확인해 주세요.');
      let s=S.schedules.find(s=>s.id===c.visit_schedule_id);if(!s){s={id:nextId(),title:c.name,block_type:'업무',scope:'personal',created_by:'guest@example.com',user_email:'guest@example.com'};S.schedules.push(s);c.visit_schedule_id=s.id;}
      Object.assign(s,{date:b.date,start_time:b.start,end_time:b.end,status:'미완료'});Object.assign(c,{visit_date:b.date,visit_start:b.start,visit_end:b.end});
    }else if(b.action==='visited')c.visited_at=stamp();
    else if(b.action==='publish'){if(!/^https:\/\/example\.com\//.test(b.url))return err('허구 주소 https://example.com/post/demo 를 사용해 주세요.');c.published_url=b.url;}
    else if(b.action==='submit'&&b.confirmed)c.submitted_at=stamp();
    else if(b.action==='sms')c.sms_confirmed_at=stamp();
    else if(b.action==='details'){c.phone=b.phone;c.deadline_date=b.deadline;}
    else if(b.action==='cancel_visit'&&b.confirmed){c.visit_date=null;const s=S.schedules.find(s=>s.id===c.visit_schedule_id);if(s)s.status='취소';}
    else return err('지원하지 않는 동작');c.version++;save();return json({campaign:c});
  });
  on('GET','/api/nblog-campaigns/:id/progress',(q,b,p)=>json({runs:R.progress[p.id]||[],activity:[]}));
  on('PUT','/api/nblog-campaigns/:id/progress',(q,b,p)=>{(R.progress[p.id]||=[]).push({...b,updated_at:stamp()});save();return json({ok:true});});
  // Fail-closed boundary for navigation, forms, popups, and embedded documents.
  window.open=()=>{announce('외부 서비스는 열지 않습니다. 이 화면의 예시로 체험해 주세요.');return null;};
  function announce(text){const n=document.getElementById('demoNotice');if(n){n.textContent=text;n.hidden=false;}}
  function preview(path){const d=docs.find(d=>d.path===path);if(!d)return;const box=document.createElement('dialog');box.className='demo-document';const h=document.createElement('h2'),pre=document.createElement('pre'),close=document.createElement('button');h.textContent=d.title;pre.textContent=d.body;close.textContent='닫기';close.onclick=()=>box.close();box.append(h,pre,close);document.body.append(box);box.addEventListener('close',()=>box.remove());box.showModal();}
  document.addEventListener('click',e=>{
    const button=e.target.closest('[data-vault-preview]');if(button){e.preventDefault();e.stopImmediatePropagation();preview(button.dataset.path);return;}
    const a=e.target.closest('a');if(!a)return;const u=new URL(a.href,location.href);
    if(['https://feed-mina.github.io/#work-cycle','https://work-cycle-demo.minyerin.chatgpt.site/'].includes(u.href))return;
    if(a.id==='worklogMd'||a.id==='dl'||(u.protocol==='blob:'&&u.origin===location.origin&&a.hasAttribute('download')))return;
    if(u.pathname.includes('/auth/harness')){e.preventDefault();e.stopImmediatePropagation();R.harness=!R.harness;save();a.textContent=R.harness?'Harness 예시 연결됨 · 클릭하면 해제':'Harness 예시 계정 연결';announce('허구 계정의 연결 상태만 바꿨습니다.');return;}
    if(u.origin!==location.origin||/\/(?:auth|api|cdn-cgi)\//.test(u.pathname)||!/^https?:$/.test(u.protocol)){e.preventDefault();e.stopImmediatePropagation();if(u.pathname==='/api/vault/file')preview(u.searchParams.get('path'));else announce('공개 체험에서는 외부 이동·계정 연결·실제 발송을 차단합니다.');}
  },true);
  document.addEventListener('submit',e=>{const f=e.target;if(f.action.includes('/auth/')||f.id==='naverConnect'){e.preventDefault();e.stopImmediatePropagation();announce('계정 연결은 허구 데이터로만 체험합니다.');}},true);
  document.addEventListener('DOMContentLoaded',()=>{
    if(document.querySelector('.demo-landing')){
      const routes={documents:'/meetings?tab=list',mail:'/mail',interview:'/schedule',nblog:'/schedule#nblogCampaigns',account:'/more'};
      const target=routes[location.hash.slice(1)];if(target)location.replace(target);
    }
    // Preserve element IDs required by production scripts but remove credential entry.
    for(const id of ['gmailConnection','naverConnection','googleSyncConnection','googleCalendarConnection']){const box=document.getElementById(id);if(box){box.hidden=true;for(const input of box.querySelectorAll('input')){input.type='hidden';input.removeAttribute('required');input.value='';}}}
    for(const id of ['gmailDisconnect','naverDisconnect']){const b=document.getElementById(id);if(b)b.hidden=true;}
    const first=document.querySelector('#mailTitle + p');if(first)first.textContent='허구 메일함입니다. Gmail·네이버 계정 없이 본문과 일정 초안을 체험합니다.';
    const input=document.querySelector('#nblogImport input');if(input){input.value='https://example.com/campaign/sample-new';input.readOnly=true;}
    const create=document.getElementById('draftCreateButton');if(create){create.textContent='예시 일정 초안 만들기';document.querySelector('#draftCreate p').textContent='선택한 허구 메일로 준비된 초안을 표시합니다. AI나 외부 서버를 호출하지 않습니다.';document.querySelectorAll('.draft-note').forEach(p=>{if(p.textContent.includes('양방향 동기화'))p.textContent='승인하면 이 브라우저의 개인 스케줄에 한 번만 저장합니다. 실제 Google 캘린더에는 반영되지 않습니다.';});}
    const h=document.querySelector('a[href="/auth/harness"]');if(h){h.removeAttribute('aria-disabled');h.textContent=R.harness?'Harness 예시 연결됨 · 클릭하면 해제':'Harness 예시 계정 연결';}
  });
})();
