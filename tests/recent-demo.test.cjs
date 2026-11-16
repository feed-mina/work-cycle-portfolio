const { chromium }=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),DIST=path.join(ROOT,'portfolio-dist'),BASE=process.env.DEMO_BASE||'';
execFileSync(process.execPath,['tools/build-portfolio.mjs'],{cwd:ROOT,stdio:'inherit'});
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');let name=decodeURIComponent(u.pathname);
 if(BASE){if(!name.startsWith(BASE+'/')){res.writeHead(404);return res.end();}name=name.slice(BASE.length);}
 if(name==='/')name='/index.html';let file=path.resolve(DIST,'.'+name);
 if(!file.startsWith(DIST+path.sep)){res.writeHead(403);return res.end();}
 if(!BASE&&!path.extname(file))file+='.html';
 if(!fs.existsSync(file)){res.writeHead(404);return res.end('missing');}
 res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'})[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));
});
let browser;const checks=[];
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.DEMO_BROWSER||'C:\\Users\\Samsung\\AppData\\Local\\ms-playwright\\chromium-1208\\chrome-win64\\chrome.exe',headless:true});
 const dest=name=>origin+BASE+'/'+name+(BASE&&name?'.html':'');
 for(const width of [1280,420,360]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
  page.setDefaultTimeout(8000);const errors=[],external=[],missing=[];
  page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',page.url(),e.stack);});page.on('request',r=>{if(!r.url().startsWith(origin))external.push(r.url());});page.on('response',r=>{if(r.status()>=400)missing.push(r.url());});page.on('dialog',d=>d.accept());
  const open=async(name,query='')=>{await page.goto(dest(name)+query);await page.waitForSelector('.demo-bar');};
  const has=async(sel,text)=>{await page.waitForFunction(({sel,text})=>new RegExp(text).test(document.querySelector(sel)?.textContent||''),{sel,text});};
  const check=async label=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,label+' overflow');checks.push(width+' '+label);console.log(width,label);};
  await open('mail');await page.locator('#gmailMessages .mail-row').first().click();await has('#gmailBody','허구 면접');
  await page.fill('#gmailQuery','없는 검색어');await page.click('#gmailSearch button[type=submit]');await has('#gmailCount','없습니다');
  await page.fill('#gmailQuery','면접');await page.click('#gmailSearch button[type=submit]');await page.locator('#gmailMessages .mail-row').click();
  await check('Gmail body/search');await page.click('#mailTabNaver');await page.locator('#naverMessages .mail-row').first().click();await has('#naverBody','허구 면접');
  assert.equal(await page.locator('input[type=password]').count(),0);await check('Naver body');
  await page.click('#naverScheduleDraft');await page.click('#draftCreateButton');await page.waitForSelector('#draftForm');
  await page.fill('#draftTitleInput','예시 QA 면접 '+width);await page.fill('#draftStart','16:00');await page.fill('#draftEnd','15:00');await page.click('#draftReview');await has('#draftError','종료 시간');
  await page.fill('#draftEnd','17:00');await page.click('#draftReview');await page.check('#draftConfirm');await page.click('#draftApprove');await has('#draftState','저장됨');
  await page.reload();await has('#draftState','저장됨');await check('draft validation/review/save/reload');
  const date=await page.inputValue('#draftDate');await page.click('#draftScheduleLink');await page.waitForSelector('#week .blk');
  const schedule=page.locator('#week .blk').filter({hasText:'예시 QA 면접 '+width});await schedule.click();await page.click('[data-act="interview-cancel"]');
  await page.getByText('취소 메모 (선택)',{exact:true}).click();await page.fill('#interviewCancelNote','예시 일정 변경');await page.click('#interviewSave');await has('#interviewProgress','취소 저장됨');
  await page.locator('#interviewClose').click();await page.reload();
  assert.equal(await page.evaluate(title=>window.workCycleDemo.state().schedules.find(s=>s.title===title).status,'예시 QA 면접 '+width),'취소');await check('schedule cancellation/reload');
  const blog=page.locator('#nblog-card-9001');await blog.locator('[data-create]').click();await has('#nblog-card-9001 [data-status]','먼저');
  await blog.locator('[data-photo]').selectOption({label:'음료 예시 사진'});await blog.locator('[data-notes]').fill('허구 카페의 조용한 분위기');await blog.locator('[data-create]').click();await has('#nblog-card-9001 [data-body]','조용한');await page.reload();await has('#nblog-card-9001 [data-body]','조용한');
  await blog.locator('[data-publish]').click();await has('#nblog-card-9001','결과 등록 필요');await check('NBlog draft/save/reload');
  await open('meetings','?tab=list');await page.locator('[data-vault-folder="07-Projects"]').click();await page.locator('[data-vault-preview]').first().click();await has('.demo-document','허구 예시');await page.locator('.demo-document button').click();
  await page.locator('[data-vault-import]').first().click();await page.reload();await has('#mlist','예시 · 프로젝트 계획');await check('ME filter/preview/import/reload');
  await open('kanban');await page.fill('input[name=title]','예시 QA 카드 '+width);await page.locator('form button').first().click();
  const card=page.locator('.kcard').filter({hasText:'예시 QA 카드 '+width});if(width<640)await card.locator('select').selectOption({label:'전략적계획'});else await card.locator('.mv').click();await card.locator('.ok').click();await page.reload();await has('#doneCount','[1-9]');await check('kanban add/move/complete/reload');
  for(const name of ['personal','roadmap','schedule','meetings','personal-dashboard','report','more']){await open(name);await check(name);}
  await page.locator('a[href="/auth/harness"]').click();await page.reload();await has('a[href="/auth/harness"]','연결됨');
  await open('mail');const blocked=await page.evaluate(async()=>({external:(await fetch('https://example.com/forbidden')).status,unknown:(await fetch('/api/unknown')).status,auth:(await fetch('/auth/google')).status}));assert.deepEqual(blocked,{external:403,unknown:404,auth:404});await check('network boundary');
  await page.evaluate(()=>localStorage.setItem('unrelated-record','keep'));await page.click('.demo-bar-reset');await page.waitForURL(dest(''));assert.equal(await page.evaluate(()=>localStorage.getItem('unrelated-record')),'keep');
  await page.evaluate(()=>localStorage.setItem(window.workCycleDemo.KEY,'{broken'));await page.reload();await page.waitForSelector('.demo-bar');await check('reset/corrupt storage recovery');
  await open('mail');await page.click('#mailTabGmail');await page.locator('#gmailMessages .mail-row').first().click();await page.screenshot({path:path.join(ROOT,'../../outputs/after-mail-'+width+'.png'),fullPage:true});
  assert.deepEqual(errors,[],'page errors');assert.deepEqual(external,[],'external requests');assert.deepEqual(missing,[],'missing assets');await context.close();
 }
 const context=await browser.newContext();await context.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('blocked','QuotaExceededError');};});const p=await context.newPage();await p.goto(dest('mail'));await p.waitForSelector('#demoStorageWarning');assert.match(await p.locator('#demoStorageWarning').innerText(),/저장이 제한/);await context.close();checks.push('storage unavailable warning');
 fs.writeFileSync(path.join(ROOT,'../../work/qa'+(BASE?'-pages':'')+'.json'),JSON.stringify({base:BASE,checks},null,2));console.log('PASS '+checks.length+' checks '+BASE);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
