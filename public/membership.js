// 계정 메뉴에 '팀 멤버에서 나가기'를 추가한다.
// Cloudflare Access 계정 자체를 삭제하지 않고, 팀 보드·집계·알림 대상에서만 제외한다.
(function () {
  const api = async (path, opt) => {
    const r = await fetch(path, opt ? { headers: { 'Content-Type': 'application/json' }, ...opt } : undefined);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || '요청에 실패했습니다.');
    }
    return r.json();
  };

  async function addLeaveControl() {
    const menu = document.querySelector('.acct-menu');
    if (!menu) return;

    let me;
    try { me = await api('/api/me'); }
    catch { return; }

    const notice = document.createElement('p');
    notice.style.cssText = 'margin:7px 11px 5px;font-size:11px;line-height:1.45;color:var(--ink3);';
    const leave = document.createElement('button');
    leave.type = 'button';
    leave.className = 'acct-item out';
    leave.style.cssText = 'width:100%;text-align:left;background:transparent;border:0;border-top:1px solid var(--line);color:var(--ink);cursor:pointer;font-family:inherit;';

    if (!me.team_member) {
      notice.textContent = '이 계정은 팀 멤버 목록에서 제외되어 있습니다.';
      leave.textContent = '팀 멤버에서 나간 상태';
      leave.disabled = true;
      leave.style.cssText += 'cursor:default;opacity:.62;';
      menu.prepend(notice);
      menu.appendChild(leave);
      return;
    }

    leave.textContent = '팀 멤버에서 나가기';
    leave.title = '업무 기록은 보존하고 팀 보드·집계·알림에서만 제외합니다';
    leave.addEventListener('click', async () => {
      const ok = window.confirm(
        '이 계정을 팀 멤버 목록에서 제외할까요?\n\n' +
        '기존 업무 기록은 삭제되지 않지만, 팀 보드·공유 화면·알림 대상에서는 제외됩니다. 다시 로그인해도 자동으로 팀 멤버가 되지 않습니다.'
      );
      if (!ok) return;

      leave.disabled = true;
      leave.textContent = '제외하는 중…';
      try {
        await api('/api/team-membership/leave', { method: 'POST' });
        notice.textContent = '팀 멤버 목록에서 제외되었습니다. 이 계정은 자동으로 다시 등록되지 않습니다.';
        menu.prepend(notice);
        leave.textContent = '팀 멤버에서 나간 상태';
        leave.style.cssText += 'cursor:default;opacity:.62;';
      } catch (e) {
        leave.disabled = false;
        leave.textContent = '팀 멤버에서 나가기';
        alert(e instanceof Error ? e.message : '요청에 실패했습니다.');
      }
    });
    menu.appendChild(leave);
  }

  addLeaveControl();
})();
