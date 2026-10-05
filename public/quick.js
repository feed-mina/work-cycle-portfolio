// 헤더 시계 칩 + 퀵 기록 모달 (전 페이지 공통)
(function(){
  const api = async (path, opt) => {
    const r = await fetch(path, opt ? { headers:{'Content-Type':'application/json'}, ...opt } : undefined);
    if (!r.ok) { alert((await r.json().catch(()=>({}))).error || '요청 실패'); throw new ApiError(path); }
    return r.json();
  };
  const esc = s => (s??'').toString().replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const header = document.querySelector('header.top');
  if (!header) return;

  // ── 시계 칩 ──
  const chip = document.createElement('button');
  chip.className = 'clock-chip';
  chip.title = '퀵 기록 열기';
  chip.innerHTML = '<span><b id="qkTime">--:--</b><small id="qkDate"></small></span><i>＋</i>';
  header.querySelector('h1').after(chip);

  // ── 바탕화면 상단 고정 배너 설정·실행 ──
  // 최초 한 번 설치하면 workcycle-banner:// 주소가 Windows에 등록된다.
  const BANNER_TEXT_KEY = 'wc.desktopBanner.text';
  const DEFAULT_BANNER_TEXT = '**업무 3원칙**     **고객 니즈 파악** — 이 화면을 누가, 무엇을 판단하려고 보는가를 만들기 전에 한 줄로 적는다.     **AI 과신 지양** — AI가 준 설계·수치·임계값은 원문 요구사항과 1:1로 대조한 뒤에 쓴다. 테스트 통과는 검증이 아니다.     **검증과 테스트 습관화** — 패키징보다 실제 브라우저 확인과 부품 하나씩 확인이 먼저. "동작함"이 아니라 "원본과 대조해 확인함"을 남긴다.';
  const bannerDownload = document.createElement('button');
  bannerDownload.type = 'button';
  bannerDownload.className = 'desktop-banner-download';
  bannerDownload.title = '배너 문구 설정 및 실행';
  bannerDownload.setAttribute('aria-label', '상단 고정 배너 설정 및 실행');
  bannerDownload.innerHTML = `
    <span class="desktop-banner-download-icon" aria-hidden="true">▰</span>
    <span><b>상단 고정 배너</b><small>문구 설정 · 바로 실행</small></span>`;
  const nav = header.querySelector('.nav-tabs');
  if (nav) nav.before(bannerDownload);
  else header.appendChild(bannerDownload);

  const bannerModal = document.createElement('div');
  bannerModal.id = 'bannerModal';
  bannerModal.innerHTML = `
    <div class="banner-panel" role="dialog" aria-modal="true" aria-labelledby="bannerModalTitle">
      <div class="banner-head">
        <div><b id="bannerModalTitle">상단 고정 배너</b><small>사이트에서 문구를 바꾸고 바로 실행할 수 있습니다.</small></div>
        <button type="button" class="banner-x" aria-label="닫기">×</button>
      </div>
      <label class="banner-field"><span>배너 문구</span>
        <textarea id="bannerText" rows="7" maxlength="700"></textarea>
      </label>
      <p class="banner-status" id="bannerStatus" aria-live="polite"></p>
      <div class="banner-install">
        <b>처음 사용하는 컴퓨터만</b>
        <span>설치 파일을 한 번 실행하면 이후에는 이 버튼으로 바로 켤 수 있습니다.</span>
        <a href="/api/downloads/desktop-banner" download="work-cycle-desktop-banner.pyw" id="bannerInstall">최초 1회 설치</a>
      </div>
      <div class="banner-actions">
        <button type="button" class="banner-reset">기본 문구로</button>
        <button type="button" class="banner-save">문구만 저장</button>
        <button type="button" class="banner-start">저장하고 배너 켜기</button>
      </div>
    </div>`;
  document.body.appendChild(bannerModal);
  const bannerText = bannerModal.querySelector('#bannerText');
  const bannerStatus = bannerModal.querySelector('#bannerStatus');
  const savedBannerText = () => {
    try { return localStorage.getItem(BANNER_TEXT_KEY) || DEFAULT_BANNER_TEXT; }
    catch { return DEFAULT_BANNER_TEXT; }
  };
  const saveBannerText = () => {
    const text = bannerText.value.trim();
    if (!text) { bannerStatus.textContent = '배너 문구를 입력해주세요.'; bannerText.focus(); return null; }
    try { localStorage.setItem(BANNER_TEXT_KEY, text); } catch {}
    return text;
  };
  const closeBannerModal = () => { bannerModal.classList.remove('on'); };
  bannerDownload.addEventListener('click', () => {
    bannerText.value = savedBannerText();
    bannerStatus.textContent = '';
    bannerModal.classList.add('on');
    setTimeout(() => bannerText.focus(), 0);
  });
  bannerModal.querySelector('.banner-x').addEventListener('click', closeBannerModal);
  bannerModal.addEventListener('mousedown', e => { if (e.target === bannerModal) closeBannerModal(); });
  bannerModal.querySelector('.banner-reset').addEventListener('click', () => {
    bannerText.value = DEFAULT_BANNER_TEXT;
    bannerStatus.textContent = '기본 문구를 불러왔습니다.';
  });
  bannerModal.querySelector('.banner-save').addEventListener('click', () => {
    if (saveBannerText()) bannerStatus.textContent = '사이트에 문구를 저장했습니다.';
  });
  bannerModal.querySelector('.banner-start').addEventListener('click', () => {
    const text = saveBannerText(); if (!text) return;
    const launch = document.createElement('a');
    launch.href = 'workcycle-banner://start?text=' + encodeURIComponent(text);
    launch.style.display = 'none';
    document.body.appendChild(launch);
    launch.click();
    launch.remove();
    bannerStatus.textContent = '배너 실행을 요청했습니다. 뜨지 않으면 최초 1회 설치를 진행해주세요.';
  });
  bannerModal.querySelector('#bannerInstall').addEventListener('click', () => {
    bannerStatus.textContent = '다운로드한 파일을 한 번 실행한 뒤 이 화면으로 돌아와 배너를 켜주세요.';
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && bannerModal.classList.contains('on')) closeBannerModal();
  });

  function tick(){
    const n = new Date();
    document.getElementById('qkTime').textContent =
      String(n.getHours()).padStart(2,'0') + ':' + String(n.getMinutes()).padStart(2,'0');
    document.getElementById('qkDate').textContent =
      `${n.getFullYear()}.${String(n.getMonth()+1).padStart(2,'0')}.${String(n.getDate()).padStart(2,'0')}`;
  }
  setInterval(tick, 1000); tick();

  // ── 모달 ──
  const modal = document.createElement('div');
  modal.id = 'qkModal';
  modal.innerHTML = `
    <div class="qk-panel">
      <div class="qk-head"><b>퀵 기록</b><span class="qk-sum" id="qkSum"></span>
        <button class="qk-x" title="닫기">×</button></div>
      <div id="qkList" class="qk-list"></div>
      <div class="qk-actions"><button id="qkShare" class="qk-share">💬 카카오로 공유</button></div>
      <form id="qkForm" class="qk-form">
        <select name="emoji_choice" class="habit-emoji-select" aria-label="이모지 선택" title="이모지 선택">
          <option value="🔥">🔥</option><option value="✅">✅</option><option value="📅">📅</option>
          <option value="💧">💧</option><option value="📚">📚</option><option value="💬">💬</option>
          <option value="__custom__">직접 입력…</option>
        </select>
        <input name="emoji_custom" class="habit-emoji-custom" placeholder="원하는 이모지" maxlength="8" hidden>
        <input name="name" placeholder="새 버튼 이름" required>
        <select name="repeat_type" class="habit-repeat" aria-label="반복 주기" title="반복 주기">
          <option value="daily">평일 매일</option><option value="everyday">매일</option><option value="weekend">주말만</option><option value="selected">요일 선택</option><option value="weekly">주 N회</option>
        </select>
        <div class="habit-day-picker" hidden aria-label="반복 요일">
          <label><input type="checkbox" name="repeat_days" value="1">월</label>
          <label><input type="checkbox" name="repeat_days" value="2">화</label>
          <label><input type="checkbox" name="repeat_days" value="3">수</label>
          <label><input type="checkbox" name="repeat_days" value="4">목</label>
          <label><input type="checkbox" name="repeat_days" value="5">금</label>
          <label><input type="checkbox" name="repeat_days" value="6">토</label>
          <label><input type="checkbox" name="repeat_days" value="7">일</label>
        </div>
        <input name="goal" type="number" min="1" value="1" title="하루 목표">
        <button>만들기</button>
      </form>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.classList.remove('on');
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  modal.querySelector('.qk-x').addEventListener('click', close);
  chip.addEventListener('click', () => { modal.classList.add('on'); loadQk(); });

  function weekDays(){
    const now = new Date(Date.now() + 9*3600*1000);
    const mon = new Date(now); mon.setUTCDate(now.getUTCDate() - (now.getUTCDay()+6)%7);
    return Array.from({length:7},(_,i)=>{ const d=new Date(mon); d.setUTCDate(mon.getUTCDate()+i); return d.toISOString().slice(0,10); });   // 월~일 (2026-09-27 토·일 추가)
  }
  const DAY_NAMES = ['월','화','수','목','금','토','일'];
  const repeatOf = b => ['selected','weekly','everyday','weekend'].includes(b.repeat_type) ? b.repeat_type : 'daily';
  const daysOf = b => String(b.repeat_days||'1,2,3,4,5').split(',').map(Number);
  // idx: 월=1 … 일=7. 서버 habitCanTapOn 과 같은 규칙
  const onDay = (b,idx) => { const r=repeatOf(b); if(r==='weekly'||r==='everyday') return true; if(r==='daily') return idx<=5; if(r==='weekend') return idx>=6; return daysOf(b).includes(idx); };
  const dueOn = (b,today,days) => { const idx=days.indexOf(today)+1; return idx>=1 && onDay(b,idx); };
  const scheduleLabel = b => {
    const repeat=repeatOf(b);
    if(repeat==='weekly') return `주 ${b.goal}회`;
    if(repeat==='daily') return '평일 매일';
    if(repeat==='everyday') return '매일';
    if(repeat==='weekend') return '주말만';
    return `매주 ${daysOf(b).map(d=>DAY_NAMES[d-1]).join('·')}요일`;
  };
  function setupHabitForm(form){
    const emoji=form.elements.emoji_choice, custom=form.elements.emoji_custom;
    const repeat=form.elements.repeat_type, picker=form.querySelector('.habit-day-picker');
    const syncEmoji=()=>{ custom.hidden=emoji.value!=='__custom__'; if(!custom.hidden) custom.focus(); };
    const syncRepeat=()=>{
      picker.hidden=repeat.value!=='selected';
      form.elements.goal.title=repeat.value==='weekly'?'주간 목표 횟수':'하루 목표 횟수';
    };
    emoji.addEventListener('change',syncEmoji); repeat.addEventListener('change',syncRepeat);
    form._syncHabit=()=>{ syncEmoji(); syncRepeat(); }; form._syncHabit();
  }
  async function loadQk(){
    const days = weekDays();
    const [d, me] = await Promise.all([api(`/api/habits?from=${days[0]}&to=${days[6]}`), api('/api/me')]);
    const rec = {}; d.records.forEach(r => { (rec[r.button_id] ??= {})[r.date] = r.count; });
    const taps = {}; (d.taps||[]).forEach(r => { ((taps[r.button_id] ??= {})[r.date] ??= []).push(r.tapped_time); });
    let doneToday=0, dueToday=0, doneWeekly=0, weeklyTotal=0;
    document.getElementById('qkList').innerHTML = d.buttons.map(b => {
      const t = rec[b.id]?.[me.today] ?? 0;
      const repeat=repeatOf(b), due=dueOn(b,me.today,days);
      const weekCnt=days.reduce((n,day)=>n+(rec[b.id]?.[day]??0),0);
      const progress=repeat==='weekly'?weekCnt:t;
      if(repeat==='weekly'){ weeklyTotal++; if(progress>=b.goal) doneWeekly++; }
      else if(due){ dueToday++; if(progress>=b.goal) doneToday++; }
      const todayTimes=taps[b.id]?.[me.today]||[];
      const latest=days.flatMap((day,i)=>(taps[b.id]?.[day]||[]).map(tm=>`${DAY_NAMES[i]} ${tm}`)).at(-1);
      const timeText=todayTimes.length?` · 기록 ${todayTimes.join(', ')}`:(repeat==='weekly'&&latest?` · 최근 ${latest}`:'');
      const progressText=repeat==='weekly'?`이번 주 ${progress}/${b.goal}`:due?`오늘 ${progress}/${b.goal}`:'오늘 대상 아님';
      return `<div class="qk-item">
        <button class="qk-tap" data-id="${b.id}" ${due?'':'disabled'} title="${due?'오늘 +1':'오늘 기록하는 항목이 아닙니다'}">${esc(b.emoji)}</button>
        <div class="qk-info"><b>${esc(b.name)}</b><small>${scheduleLabel(b)} · ${progressText}${timeText}</small></div>
        <button class="qk-del" data-id="${b.id}" title="버튼 삭제">×</button>
        <div class="qk-dots">${days.map((day,i)=>{
          const c = rec[b.id]?.[day] ?? 0;
          const scheduled=onDay(b,i+1);
          const time=(taps[b.id]?.[day]||[]).join(', '), title=`${day}${time?' · '+time:''}`;
          if(!scheduled) return `<span title="${title}"><i class="off">—</i>${DAY_NAMES[i]}</span>`;
          const bg=repeat==='weekly'?(c?'var(--ok)':'var(--line)'):(c>=b.goal?'var(--ok)':(c?'var(--warn)':'var(--line)'));
          return `<span title="${title}"><i style="background:${bg}"></i>${DAY_NAMES[i]}</span>`;
        }).join('')}</div>
      </div>`;
    }).join('') || '<p class="qk-empty">버튼이 없습니다 — 아래에서 만들어보세요.</p>';
    const sums=[];
    if(dueToday) sums.push(`오늘 ${doneToday}/${dueToday}`); else if(d.buttons.length) sums.push('오늘 예정 없음');
    if(weeklyTotal) sums.push(`주간 ${doneWeekly}/${weeklyTotal}`);
    document.getElementById('qkSum').textContent=sums.join(' · ');
    document.querySelectorAll('.qk-tap').forEach(btn => btn.addEventListener('click', async () => {
      await api(`/api/habits/${btn.dataset.id}/tap`, { method:'POST', body:'{}' });
      loadQk();
      if (typeof loadHabits === 'function') loadHabits(); // 마이페이지 카드 동기화
    }));
    document.querySelectorAll('.qk-del').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('이 버튼을 삭제할까요? (기록은 보존됩니다)')) return;
      await api('/api/habits/' + btn.dataset.id, { method:'DELETE' });
      loadQk();
      if (typeof loadHabits === 'function') loadHabits();
    }));
    LAST_QK = { buttons: d.buttons, rec, taps, today: me.today, days, doneToday, dueToday, doneWeekly, weeklyTotal };
  }
  let LAST_QK = null, KAKAO_KEY = null;
  api('/api/config').then(c => {
    KAKAO_KEY = c.kakao_js_key;
    if (KAKAO_KEY && !window.Kakao) {
      const sc = document.createElement('script');
      sc.src = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js';
      sc.onload = () => { try { window.Kakao.init(KAKAO_KEY); } catch(e){} };
      document.head.appendChild(sc);
    }
  }).catch(()=>{});

  document.getElementById('qkShare').addEventListener('click', async () => {
    if (!LAST_QK) return;
    const relevant=LAST_QK.buttons.filter(b=>repeatOf(b)==='weekly'||dueOn(b,LAST_QK.today,LAST_QK.days));
    const lines = relevant.map(b => {
      const t = LAST_QK.rec[b.id]?.[LAST_QK.today] ?? 0;
      const n=repeatOf(b)==='weekly'?LAST_QK.days.reduce((sum,day)=>sum+(LAST_QK.rec[b.id]?.[day]??0),0):t;
      const label=repeatOf(b)==='weekly'?'이번 주':'오늘';
      return `${b.emoji} ${b.name} ${label} ${n}/${b.goal}${n >= b.goal ? ' ✅' : ''}`;
    });
    const summary=[`오늘 ${LAST_QK.doneToday}/${LAST_QK.dueToday}`];
    if(LAST_QK.weeklyTotal) summary.push(`주간 ${LAST_QK.doneWeekly}/${LAST_QK.weeklyTotal}`);
    const text = `📋 work-cycle 퀵 기록 (${LAST_QK.today})\n${lines.join('\n')||'오늘 예정된 기록 없음'}\n${summary.join(' · ')} 달성`;
    if (window.Kakao?.isInitialized?.()) {
      window.Kakao.Share.sendDefault({
        objectType: 'text', text,
        link: { webUrl: location.origin, mobileWebUrl: location.origin },
      });
    } else if (navigator.share) {
      try { await navigator.share({ text }); } catch(e){}
    } else {
      await navigator.clipboard.writeText(text);
      alert('요약이 복사됐습니다 — 카카오톡에 붙여넣으세요.\n(카카오 앱 키를 등록하면 공유창이 바로 뜹니다)');
    }
  });

  document.getElementById('qkForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd=new FormData(e.target), b=Object.fromEntries(fd);
    b.emoji=b.emoji_choice==='__custom__'?b.emoji_custom.trim():b.emoji_choice;
    b.repeat_days=fd.getAll('repeat_days').map(Number);
    delete b.emoji_choice; delete b.emoji_custom;
    b.goal = parseInt(b.goal) || 1;
    await api('/api/habits', { method:'POST', body: JSON.stringify(b) });
    e.target.reset(); e.target._syncHabit(); loadQk();
  });
  setupHabitForm(document.getElementById('qkForm'));

  /* ── 계정 메뉴 (헤더 이메일 클릭 → 로그아웃 · 로그인 방식) ────────── */
  const meEl = document.getElementById('me');
  if (meEl) {
    meEl.classList.add('acct-btn');
    meEl.setAttribute('role', 'button');
    meEl.setAttribute('tabindex', '0');
    meEl.setAttribute('aria-haspopup', 'true');
    meEl.setAttribute('aria-expanded', 'false');
    meEl.title = '계정 메뉴';

    const menu = document.createElement('div');
    menu.className = 'acct-menu';
    menu.innerHTML = `
      <div class="acct-who"><small>로그인 계정</small><b id="acctEmail">…</b></div>
      <a class="acct-item out" href="/cdn-cgi/access/logout">↩ 로그아웃</a>`;
    document.body.appendChild(menu);

    const place = () => {
      const r = meEl.getBoundingClientRect();
      const w = menu.offsetWidth || 240;
      menu.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
      menu.style.top = (r.bottom + 8) + 'px';
    };
    const openMenu = () => {
      const em = meEl.textContent.trim();
      if (em && em !== '…') menu.querySelector('#acctEmail').textContent = em;
      menu.classList.add('on');
      meEl.setAttribute('aria-expanded', 'true');
      place();
    };
    const closeMenu = () => {
      menu.classList.remove('on');
      meEl.setAttribute('aria-expanded', 'false');
    };
    const toggle = () => (menu.classList.contains('on') ? closeMenu() : openMenu());

    meEl.addEventListener('click', e => { e.stopPropagation(); toggle(); });
    meEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
    document.addEventListener('click', e => { if (!menu.contains(e.target)) closeMenu(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
    window.addEventListener('resize', () => menu.classList.contains('on') && place());
    window.addEventListener('scroll', closeMenu, { passive: true });
  }
})();
