/* acc.js — 카드 접기·펴기(아코디언) + 섹션 2중 아코디언
   사용법: <div class="card" data-acc="키" [data-acc-default="closed"] [data-acc-group="묶음"]> … </div>
           카드 첫 <h2>가 접기 버튼이 되고, 그 뒤 내용이 본문이 됩니다.
   묶음(data-acc-group): 같은 묶음의 카드는 함께 열리고 함께 닫히며 저장 키는 묶음 하나(wc.acc.g.묶음)만 쓴다.
           묶음이 있으면 개별 키(wc.acc.키)는 읽지도 쓰지도 않는다. (2026-09-27, 개인용 계획·회고 카드) */
(function () {
  const NS = "wc.acc.";
  const get = k => { try { return localStorage.getItem(NS + k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(NS + k, v); } catch {} };

  /* 저장 키: 묶음이 있으면 g.묶음, 없으면 카드 키 */
  function keyOf(card) {
    return card.dataset.accGroup ? "g." + card.dataset.accGroup : (card.dataset.acc || "");
  }
  /* 함께 움직일 카드들: 묶음이 있으면 같은 묶음 전부, 없으면 자기 자신 */
  function members(card) {
    const g = card.dataset.accGroup;
    return g ? [...document.querySelectorAll('.card[data-acc-group="' + g + '"]')] : [card];
  }

  function applyOne(card, open) {
    card.classList.toggle("closed", !open);
    const btn = card.querySelector(":scope > .acc-h");
    if (btn) btn.setAttribute("aria-expanded", String(open));
  }
  function apply(card, open, key) {
    members(card).forEach(c => applyOne(c, open));
    if (key) set(key, open ? "1" : "0");
  }

  function build(card) {
    if (card.dataset.accReady) return;
    const h2 = card.querySelector(":scope > h2");
    if (!h2) return;
    card.dataset.accReady = "1";
    const key = card.dataset.acc || "";

    /* h2 뒤 형제 전부를 본문으로 감싼다 */
    const body = document.createElement("div");
    body.className = "acc-body";
    const rest = [];
    for (let n = h2.nextSibling; n; n = n.nextSibling) rest.push(n);
    rest.forEach(n => body.appendChild(n));

    /* h2 → 버튼 (자식 노드는 그대로 옮겨서 id/참조 유지) */
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "acc-h";
    const t = document.createElement("span");
    t.className = "acc-t";
    [...h2.childNodes].forEach(n => t.appendChild(n));
    const ar = document.createElement("span");
    ar.className = "acc-ar";
    ar.setAttribute("aria-hidden", "true");
    ar.textContent = "▾";
    btn.append(t, ar);
    h2.replaceWith(btn);
    card.appendChild(body);

    const storeKey = keyOf(card);
    btn.addEventListener("click", () => apply(card, card.classList.contains("closed"), storeKey));

    const saved = storeKey ? get(storeKey) : null;
    const openByDefault = card.dataset.accDefault !== "closed";
    applyOne(card, saved === null ? openByDefault : saved === "1");
  }

  function initCards(root) {
    (root || document).querySelectorAll(".card[data-acc]").forEach(build);
  }

  /* ── 2중 아코디언: 카드 안 섹션 ──────────────────────────────
     마크업: <div class="secx" data-sec="이름">
               <button type="button" class="sec-h">…</button>
               <div class="sec-body">…</div>
             </div>                                              */
  function sectionKey(sec) {
    const card = sec.closest(".card[data-acc]");
    return "sec." + (card ? card.dataset.acc : "x") + "." + (sec.dataset.sec || "");
  }
  function applySections(root) {
    (root || document).querySelectorAll(".secx").forEach(sec => {
      const saved = get(sectionKey(sec));
      const open = saved === null ? sec.dataset.secDefault !== "closed" : saved === "1";
      sec.classList.toggle("closed", !open);
      const b = sec.querySelector(":scope > .sec-h");
      if (b) b.setAttribute("aria-expanded", String(open));
    });
  }
  document.addEventListener("click", e => {
    const b = e.target.closest(".sec-h");
    if (!b) return;
    const sec = b.closest(".secx");
    if (!sec) return;
    const open = sec.classList.contains("closed");
    sec.classList.toggle("closed", !open);
    b.setAttribute("aria-expanded", String(open));
    set(sectionKey(sec), open ? "1" : "0");
  });

  /* /#verif 처럼 해시로 들어오면 그 카드를 펼치고 그 자리로 이동 */
  function openFromHash() {
    const id = (location.hash || "").slice(1);
    if (!id) return;
    const card = document.getElementById(id);
    if (!card || !card.classList.contains("card")) return;
    members(card).forEach(build);
    apply(card, true, keyOf(card));
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    card.classList.add("hl");
    setTimeout(() => card.classList.remove("hl"), 1600);
  }

  window.accInit = initCards;
  window.accSections = applySections;
  window.addEventListener("hashchange", openFromHash);
  function boot() { initCards(); openFromHash(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
