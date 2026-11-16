// Boundary and recovery checks against a running static preview (including Wrangler).
const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const base=process.env.QA_URL||'http://127.0.0.1:8796',prefix=process.env.DEMO_BASE||'',ext=prefix?'.html':'';const url=n=>base+prefix+'/'+n+(n?ext:'');
 const browser=await chromium.launch({channel:'msedge'});try{const p=await browser.newPage({viewport:{width:420,height:900}});p.setDefaultTimeout(10000);p.on('dialog',d=>d.accept());
 const has=async(sel,text)=>p.waitForFunction(({sel,text})=>document.querySelector(sel)?.textContent.includes(text),{sel,text});
 await p.goto(url('mail'));await p.waitForSelector('#gmailMessages .mail-row');
 await p.evaluate(()=>{const original=fetch;let failed=false;window.fetch=async(input,init)=>{if(!failed&&String(input).startsWith('/api/gmail/messages?')){failed=true;return new Response(JSON.stringify({error:'예시 조회 실패 · 다시 시도하세요.'}),{status:503});}return original(input,init);};});
 await p.click('#gmailReload');await has('#gmailError','예시 조회 실패');await p.click('#gmailReload');await p.waitForSelector('#gmailMessages .mail-row');assert.equal(await p.locator('#gmailError').isVisible(),false);
 await p.locator('#gmailMessages .mail-row').nth(1).click();await p.click('#gmailDraft');await p.click('#draftCreateButton');await has('#draftNotice','날짜와 시간이 없습니다');assert.equal(await p.inputValue('#draftDate'),'');assert.equal(await p.locator('#draftApprove').isEnabled(),false);
 await p.goto(url('schedule'));await p.fill('#schForm input[name=title]','예시 직접 추가 일정');await p.click('#schForm button');await p.locator('#week .blk').filter({hasText:'예시 직접 추가 일정'}).click();await p.locator('.em-panel input[name=title]').fill('예시 수정한 일정');await p.locator('.em-panel [data-act=save]').click();await p.reload();await p.locator('#week .blk').filter({hasText:'예시 수정한 일정'}).waitFor();
 await p.goto(url('meetings')+'?tab=list');await p.locator('[data-share-action=view]').first().click();await p.waitForSelector('[data-share-url]');const link=await p.locator('[data-share-url]').first().inputValue();await p.locator('[data-share-action=refresh-content]').first().click();await has('#shareManagerStatus','기존 공유 주소');await p.locator('[data-share-action=view]').first().click();assert.equal(await p.locator('[data-share-url]').first().inputValue(),link);
 await p.goto(url('')+'#mail');await p.waitForURL(url('mail'));await p.waitForSelector('#gmailMessages .mail-row');
 const result=await p.evaluate(async()=>{
  const D=workCycleDemo, data=await(await fetch('/api/mail-schedule/drafts',{method:'POST',body:JSON.stringify({provider:'gmail',messageId:'sample-interview'})})).json(),d=data.draft;
  const invalid=await fetch('/api/mail-schedule/drafts/'+d.id+'/review',{method:'POST',body:JSON.stringify({version:999,candidate:d.candidate})});
  const reviewed=await(await fetch('/api/mail-schedule/drafts/'+d.id+'/review',{method:'POST',body:JSON.stringify({version:d.version,candidate:d.candidate})})).json();
  const approval={version:reviewed.draft.version,review_token:reviewed.draft.review_token,acknowledge:true};
  const before=D.state().schedules.length;
  for(let i=0;i<2;i++)await fetch('/api/mail-schedule/drafts/'+d.id+'/approve',{method:'POST',body:JSON.stringify(approval)});
  const added=D.state().schedules.length-before;
  let violations=0;document.addEventListener('securitypolicyviolation',()=>violations++);
  const xhr=new XMLHttpRequest();xhr.open('GET','https://example.com/private');try{xhr.send();}catch{}
  await new Promise(r=>setTimeout(r,200));return {stale:invalid.status,violations,added};
 });assert.equal(result.stale,409);assert.ok(result.violations>0);assert.equal(result.added,1);
 console.log('PASS: mail failure/retry, missing-date draft, schedule create/edit/reload, share update keeps URL, old anchor, stale version, CSP blocks XHR. '+prefix);
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
