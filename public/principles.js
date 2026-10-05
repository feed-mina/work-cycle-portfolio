/* principles.js — 3원칙 상시 배너 (모든 화면 헤더 아래)
   회사용: 대표 피드백 "업무 3원칙" (문구·링크 고정, 마이페이지 /#plan·/#check·/#verif)
   개인용: /api/personal/ui 의 principles 로 "개인 3원칙" (개인 마이페이지 /personal#plan·#check·#verif)
   어느 쪽인지는 mode-switch.js 가 <html data-work-mode> 로 정해 두고, 바뀌면 'wc:mode' 이벤트로 알린다. */
(function () {
  const KEY = "wc.prin.open";

  const COMPANY = [
    { k: "need",   ic: "🎯", t: "고객 니즈 파악",
      d: "이 화면을 <b>누가</b>, <b>무엇을 판단하려고</b> 보는가 — 만들기 전에 한 줄로 적는다.",
      go: "/#plan" },
    { k: "ai",     ic: "🤖", t: "AI 과신 지양",
      d: "AI가 준 설계·수치·임계값은 <b>원문 요구사항과 1:1로 대조</b>한 뒤에 쓴다. 테스트 통과는 검증이 아니다.",
      go: "/#check" },
    { k: "verify", ic: "🔬", t: "검증과 테스트 습관화",
      d: "패키징보다 <b>실제 브라우저 확인</b>과 <b>부품 하나씩 확인</b>이 먼저. \"동작함\"이 아니라 \"원본과 대조해 확인함\"을 남긴다.",
      go: "/#verif" },
  ];
  const PERSONAL_ICONS = ["🧭", "🧠", "📝"];
  const PERSONAL_TARGETS = { plan: "plan", check: "check", verif: "verif" };

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const isPersonal = () => document.documentElement.dataset.workMode === "personal";

  async function personalCards() {
    const r = await fetch("/api/personal/ui");
    if (!r.ok) throw new Error("개인 3원칙을 불러오지 못했습니다 (" + r.status + ")");
    const profile = await r.json();
    return (profile.principles || []).map((p, i) => ({
      k: "p" + i, ic: PERSONAL_ICONS[i] || "•", t: esc(p.title), d: esc(p.description),
      go: "/personal#" + (PERSONAL_TARGETS[p.target] || "plan"),
    }));
  }

  function render(host, title, cards, note) {
    const wrap = document.createElement("div");
    wrap.className = "prin";
    wrap.innerHTML = `
      <button type="button" class="prin-h" aria-expanded="false">
        <span class="prin-t">${title}</span>
        <span class="prin-mini">${cards.map(p => `<i title="${p.t}">${p.ic}</i>`).join("")}</span>
        <span class="prin-ar" aria-hidden="true">▾</span>
      </button>
      <div class="prin-body">
        ${cards.map(p => `<a class="prin-c" href="${p.go}">
          <b>${p.ic} ${p.t}</b><span>${p.d}</span>
        </a>`).join("")}
        ${note ? `<p class="prin-note">${esc(note)}</p>` : ""}
      </div>`;
    host.insertAdjacentElement("afterend", wrap);

    let open = false;
    try { open = localStorage.getItem(KEY) === "1"; } catch {}
    const apply = () => {
      wrap.classList.toggle("open", open);
      wrap.querySelector(".prin-h").setAttribute("aria-expanded", String(open));
    };
    apply();
    wrap.querySelector(".prin-h").addEventListener("click", () => {
      open = !open; apply();
      try { localStorage.setItem(KEY, open ? "1" : "0"); } catch {}
    });
  }

  let seq = 0;
  async function build() {
    const host = document.querySelector("header.top");
    if (!host) return;
    const my = ++seq;
    document.querySelectorAll(".prin").forEach(el => el.remove());
    if (!isPersonal()) { render(host, "업무 3원칙", COMPANY); return; }
    let cards = [], note = "";
    try { cards = await personalCards(); } catch (e) { note = e.message; }
    if (my !== seq || document.querySelector(".prin")) return;   // 그 사이 모드가 다시 바뀌었으면 버린다
    render(host, "개인 3원칙", cards, note);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
  document.addEventListener("wc:mode", build);
})();
