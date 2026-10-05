/* mode-switch.js — "사용 화면"(회사용 / 개인용) 판별을 한곳에서.
   <body> 바로 아래(theme.js 다음)에서 동기 실행된다.
   1) 마지막으로 확인한 모드(localStorage)나 화면 종류로 <html data-work-mode>를 즉시 붙인다
      → 탭 두 벌(data-mode="company"/"personal")은 CSS로만 골라 보이므로 화면이 뜬 뒤 글자가 바뀌지 않는다.
   2) /api/me 한 번으로 서버 값을 확인한다. 다르면 그때만 갱신하고 'wc:mode' 이벤트를 쏜다(배너가 다시 그림).
      회사 화면(/, /dashboard)에 개인용으로 들어오면 개인 화면으로, 그 반대도 보낸다.
   3) 헤더의 "사용 화면" 선택 상자와 "개인용" 칩을 그린다. */
(() => {
  const KEY = 'wc.mode';
  const html = document.documentElement;
  const path = (location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/');
  const PERSONAL_PAGES = { '/personal': '/', '/personal-dashboard': '/dashboard' };
  const COMPANY_PAGES = { '/': '/personal', '/dashboard': '/personal-dashboard' };
  const pageMode = path in PERSONAL_PAGES ? 'personal' : path in COMPANY_PAGES ? 'company' : null;

  let stored = null;
  try { stored = localStorage.getItem(KEY); } catch {}
  // 화면에 모드를 붙인다. localStorage 에는 "서버가 확인한 값"만 저장한다(persist=true) —
  // 화면 종류(pageMode)로 추정한 값을 저장하면 회사 화면↔개인 화면 사이를 무한히 오가는 버그가 난다(v34 회귀, v35 수정).
  const setMode = (mode, persist) => {
    html.dataset.workMode = mode;
    if (document.body) document.body.dataset.workMode = mode;
    if (persist) { try { localStorage.setItem(KEY, mode); } catch {} }
  };
  const apply = (mode) => setMode(mode, true);
  setMode(pageMode || (stored === 'personal' ? 'personal' : 'company'), false);
  // 마지막으로 서버가 확인한 모드와 다른 쪽 화면(회사 화면↔개인 화면)에 들어왔으면 서버 응답을 기다리지 않고 바로 보낸다.
  // 도착한 화면에서는 저장값과 화면 종류가 같으므로 다시 튕기지 않고, 서버 확인이 한 번 더 돌아 최종 확정한다.
  const other = pageMode === 'company' ? COMPANY_PAGES : pageMode === 'personal' ? PERSONAL_PAGES : null;
  if (other && (stored === 'personal' || stored === 'company') && stored !== pageMode) {
    location.replace(other[path] + location.search + location.hash);
  }

  const current = () => html.dataset.workMode === 'personal' ? 'personal' : 'company';
  const home = (mode) => mode === 'personal' ? '/personal' : '/';
  let select = null;

  function buildSelect() {
    const header = document.querySelector('header.top');
    if (!header || header.querySelector('.mode-slot select')) return;
    // 자리: 각 화면 헤더의 <span class="mode-slot"> (nav 바로 뒤, 8화면 공통). 없으면 헤더 끝에 만든다(폴백).
    let slot = header.querySelector('.mode-slot');
    if (!slot) { slot = document.createElement('span'); slot.className = 'mode-slot'; header.append(slot); }
    const label = document.createElement('label');
    label.className = 'mode-label';
    label.append('사용 화면 ');
    select = document.createElement('select');
    select.setAttribute('aria-label', '사용 화면');
    for (const [value, text] of [['company', '회사용'], ['personal', '개인용']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
    }
    select.value = current();
    const chip = document.createElement('span');
    chip.className = 'mode-chip'; chip.textContent = '개인용';
    label.append(select, chip);
    slot.append(label);
    select.addEventListener('change', async () => {
      select.disabled = true;
      try {
        const res = await fetch('/api/personal/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view_mode: select.value }) });
        if (!res.ok) throw new Error('화면 선택을 저장하지 못했습니다.');
        apply(select.value);
        location.href = home(select.value);
      } catch (e) { alert(e.message); select.value = current(); select.disabled = false; }
    });
  }

  async function confirmWithServer() {
    let mode;
    try {
      const r = await fetch('/api/me');
      if (!r.ok) return;
      mode = (await r.json()).view_mode === 'personal' ? 'personal' : 'company';
    } catch { return; }
    // 서버 값을 먼저 저장해 두어야 되돌려 보낸 화면이 다시 이쪽으로 튕기지 않는다
    try { localStorage.setItem(KEY, mode); } catch {}
    if (mode === 'personal' && path in COMPANY_PAGES) { location.replace(COMPANY_PAGES[path] + location.search + location.hash); return; }
    if (mode === 'company' && path in PERSONAL_PAGES) { location.replace(PERSONAL_PAGES[path] + location.search + location.hash); return; }
    if (mode !== current()) {
      apply(mode);
      document.dispatchEvent(new CustomEvent('wc:mode', { detail: { mode } }));
    }
    if (select) select.value = mode;
  }

  const start = () => { buildSelect(); confirmWithServer(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
