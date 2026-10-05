/* personal-edit.js — 개인용 결과 기록 / 일정 편집 모달 (개인 마이페이지 · 나의 준비 현황). 회사용은 edit.js */
(function () {
  const V_STATUS = ["확인됨", "불일치→수정", "미확인"];
  const BLOCKS = ["업무", "회의"];
  let closer = null;

  function esc(s) {
    return (s ?? "").toString().replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  async function send(path, method, body) {
    const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { alert((await r.json().catch(() => ({}))).error || "저장하지 못했습니다"); throw new Error(path); }
    return r.json();
  }

  function shell(title, sub, inner, footExtra) {
    const back = document.createElement("div");
    back.className = "em-back";
    back.innerHTML = `<div class="em-panel" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="em-head">
        <div><b>${esc(title)}</b><small>${esc(sub)}</small></div>
        <button type="button" class="em-x" aria-label="닫기">×</button>
      </div>
      <div class="em-body">${inner}</div>
      <div class="em-foot">${footExtra}<button type="button" class="em-btn pri" data-act="save">저장</button></div>
    </div>`;
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add("on"));

    const close = () => {
      back.classList.remove("on");
      document.removeEventListener("keydown", onKey);
      closer = null;
      setTimeout(() => back.remove(), 140);
    };
    const onKey = e => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    back.addEventListener("mousedown", e => { if (e.target === back) close(); });
    back.querySelector(".em-x").addEventListener("click", close);
    closer = close;

    const first = back.querySelector("input,textarea,button.em-seg");
    if (first) first.focus();
    return { back, close };
  }

  /* ── 결과 기록 편집 ───────────────────────────────────────────── */
  window.openVerifModal = function (row, onSaved) {
    const seg = V_STATUS.map(s =>
      `<button type="button" class="em-seg ${row.status === s ? "on" : ""}" data-v="${s}">${s}</button>`).join("");
    const { back, close } = shell("결과 기록 편집", `${row.item ? row.item.slice(0, 28) : ""} · ${row.cycle_date || ""}`, `
      <label class="em-f"><span>상태</span><div class="em-segs" data-name="status">${seg}</div></label>
      <label class="em-f"><span>항목</span><input name="item" value="${esc(row.item)}" required></label>
      <label class="em-f"><span>목표 / 기준</span><input name="formula" value="${esc(row.formula)}" placeholder="목표 또는 확인 기준"></label>
      <label class="em-f"><span>확인한 근거</span><input name="method" value="${esc(row.method)}" placeholder="직접 확인한 근거"></label>
      <label class="em-f"><span>결과</span><input name="result" value="${esc(row.result)}" placeholder="예: 0.67 = 0.67 일치"></label>
    `, `<button type="button" class="em-btn danger" data-act="del">삭제</button>`);

    let status = row.status || "미확인";
    back.querySelectorAll(".em-seg").forEach(b => b.addEventListener("click", () => {
      status = b.dataset.v;
      back.querySelectorAll(".em-seg").forEach(x => x.classList.toggle("on", x === b));
    }));
    back.querySelector('[data-act="save"]').addEventListener("click", async () => {
      const g = n => back.querySelector(`[name="${n}"]`).value;
      if (!g("item").trim()) { alert("항목은 비울 수 없습니다"); return; }
      await send("/api/personal/verifications/" + row.id, "PATCH",
        { status, item: g("item"), formula: g("formula"), method: g("method"), result: g("result") });
      close(); onSaved && onSaved();
    });
    back.querySelector('[data-act="del"]').addEventListener("click", async () => {
      if (!confirm("이 결과 기록을 삭제할까요?")) return;
      await send("/api/personal/verifications/" + row.id, "DELETE", {});
      close(); onSaved && onSaved();
    });
  };

  /* ── 일정 편집 ────────────────────────────────────────────────── */
  window.openSchedModal = function (row, onSaved) {
    const wd = ["일", "월", "화", "수", "목", "금", "토"];
    const [y, m, d] = (row.date || "").split("-").map(Number);
    const dayName = y ? wd[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] : "";
    const currentBlock = row.block_type === "회의" ? "회의" : "업무";
    const seg = BLOCKS.map(value =>
      `<button type="button" class="em-seg kind ${currentBlock === value ? "on" : ""}" data-v="${value}">
        <b>${value}</b>
      </button>`).join("");
    const meetRow = row.meet_url
      ? `<label class="em-f"><span>화상회의</span>
           <div class="em-meeturl">${esc(row.meet_url)}</div>
           <div class="em-meet">
             <a href="${esc(row.meet_url)}" target="_blank" rel="noopener" class="em-btn pri">회의 참여</a>
             <button type="button" class="em-btn" data-act="copy">링크 복사</button>
             <button type="button" class="em-btn" data-act="kakao">💬 공유</button>
             <a class="em-btn" href="/meetings?schedule_id=${row.id}&title=${encodeURIComponent(row.title)}&date=${row.date}">회의록 쓰기</a>
             <button type="button" class="em-btn danger" style="margin:0" data-act="unmeet">회의 해제</button>
           </div></label>`
      : `<label class="em-f"><span>화상회의</span>
           <div class="em-meet">
             <button type="button" class="em-btn" data-act="mkmeet">📹 화상회의 만들기</button>
             <small class="em-hint">구글 캘린더에 일정이 만들어지고 Meet 링크가 붙습니다</small>
           </div></label>`;

    const cfm = !!Number(row.confirmed || 0);
    /* 개인용: 회의 메모의 ❓ 확인 필요 줄이 여기(confirm_line)에 모인다. 저장 필드는 회사용과 같고 문구만 개인용 */
    const confirmRow = `<label class="em-f cfm ${cfm ? "on" : ""}">
      <span>확인할 점 (❓ 확인 필요)
        <i class="em-why" title="회의 메모에서 '❓ 확인 필요 → 일정 요구사항'으로 보낸 줄이 여기에 모입니다. 다 확인했으면 '확인함'으로 표시하세요">?</i></span>
      <textarea name="confirm_line" rows="2"
        placeholder="확인할 점을 한 줄씩 — 예: 지원 마감이 10/3인지, 포트폴리오 링크가 열리는지">${esc(row.confirm_line || "")}</textarea>
      <div class="em-meet">
        <button type="button" class="em-btn" data-act="cfmcopy">📋 복사해서 물어보기</button>
        <button type="button" class="em-btn ${cfm ? "ok" : ""}" data-act="cfmtoggle">
          ${cfm ? "✓ 확인함" : "확인함으로 표시"}</button>
      </div>
    </label>`;

    const st = row.status || "미완료";
    const stSeg = ["미완료", "완료"].map(v =>
      `<button type="button" class="em-seg st ${st === v ? "on" : ""}" data-s="${v}">${v}</button>`).join("");

    const { back, close } = shell(row.title, `${row.date} (${dayName}) · ${currentBlock}`, `
      <label class="em-f"><span>완료 여부</span><div class="em-segs">${stSeg}</div></label>
      <label class="em-f"><span>제목</span><input name="title" value="${esc(row.title)}" required></label>
      <label class="em-f"><span>시간</span><div class="em-two">
        <input name="start_time" type="time" value="${esc(row.start_time || "")}">
        <input name="end_time" type="time" value="${esc(row.end_time || "")}">
      </div></label>
      <label class="em-f"><span>내용</span><textarea name="body" rows="4"
        placeholder="무엇을 어디까지 할지, 판단 기준">${esc(row.body || "")}</textarea></label>
      ${confirmRow}
      <label class="em-f"><span>메모</span><textarea name="memo" rows="3"
        placeholder="진행 중 알게 된 점이나 다음에 기억할 내용을 적으세요">${esc(row.memo || "")}</textarea></label>
      <label class="em-f"><span>유형</span><div class="em-segs" data-name="block_type">${seg}</div></label>
      ${meetRow}
    `, `<button type="button" class="em-btn danger" data-act="del">삭제</button>`);

    let block = currentBlock;
    back.querySelectorAll(".em-seg[data-v]").forEach(b => b.addEventListener("click", () => {
      block = b.dataset.v;
      back.querySelectorAll(".em-seg[data-v]").forEach(x => x.classList.toggle("on", x === b));
    }));
    let status = st;
    back.querySelectorAll(".em-seg.st").forEach(b => b.addEventListener("click", () => {
      status = b.dataset.s;
      back.querySelectorAll(".em-seg.st").forEach(x => x.classList.toggle("on", x === b));
    }));
    /* 요구사항 한 줄 확인 */
    let confirmed = cfm;
    const cfmField = back.querySelector(".em-f.cfm");
    const cfmBtn = back.querySelector('[data-act="cfmtoggle"]');
    cfmBtn.addEventListener("click", () => {
      confirmed = !confirmed;
      cfmField.classList.toggle("on", confirmed);
      cfmBtn.classList.toggle("ok", confirmed);
      cfmBtn.textContent = confirmed ? "✓ 확인함" : "확인함으로 표시";
    });
    back.querySelector('[data-act="cfmcopy"]').addEventListener("click", async () => {
      const line = back.querySelector('[name="confirm_line"]').value.trim();
      if (!line) { alert("먼저 확인할 점을 적어주세요."); return; }
      const text = `[${row.title}] 확인할 점\n\n${line}\n\n이렇게 이해한 게 맞을까요? 다르면 알려주세요.`;
      try { await navigator.clipboard.writeText(text); alert("복사됐습니다 — 물어볼 사람이나 메모에 붙여넣으세요."); }
      catch { prompt("복사해서 물어보세요", text); }
    });

    const copyBtn = back.querySelector('[data-act="copy"]');
    if (copyBtn) copyBtn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(row.meet_url); copyBtn.textContent = "복사됨"; }
      catch { prompt("링크를 복사하세요", row.meet_url); }
    });

    const kkBtn = back.querySelector('[data-act="kakao"]');
    if (kkBtn) kkBtn.addEventListener("click", async () => {
      const when = [row.date, row.start_time, row.end_time && "~ " + row.end_time].filter(Boolean).join(" ");
      const text = `📹 ${row.title}\n${when}\n${row.meet_url}`;
      if (window.Kakao && window.Kakao.isInitialized && window.Kakao.isInitialized()) {
        window.Kakao.Share.sendDefault({
          objectType: "text", text,
          link: { webUrl: row.meet_url, mobileWebUrl: row.meet_url },
        });
      } else if (navigator.share) {
        navigator.share({ title: row.title, text, url: row.meet_url }).catch(() => {});
      } else {
        try { await navigator.clipboard.writeText(text); alert("회의 정보가 복사됐습니다 — 채팅에 붙여넣으세요."); }
        catch { prompt("복사해서 공유하세요", text); }
      }
    });

    const mk = back.querySelector('[data-act="mkmeet"]');
    if (mk) mk.addEventListener("click", async () => {
      mk.disabled = true; mk.textContent = "만드는 중…";
      try {
        const r = await send(`/api/schedules/${row.id}/meet`, "POST", {});
        row.meet_url = r.meet_url;
        close(); onSaved && onSaved();
        alert("회의 링크가 만들어졌습니다.\n" + r.meet_url);
      } finally { mk.disabled = false; mk.textContent = "📹 화상회의 만들기"; }
    });

    const un = back.querySelector('[data-act="unmeet"]');
    if (un) un.addEventListener("click", async () => {
      if (!confirm("회의 링크를 해제할까요? 구글 캘린더 일정도 함께 삭제됩니다.")) return;
      await send(`/api/schedules/${row.id}/meet`, "DELETE", {});
      close(); onSaved && onSaved();
    });
    back.querySelector('[data-act="save"]').addEventListener("click", async () => {
      const g = n => back.querySelector(`[name="${n}"]`).value;
      if (!g("title").trim()) { alert("제목은 비울 수 없습니다"); return; }
      await send("/api/schedules/" + row.id, "PATCH", {
        title: g("title"), start_time: g("start_time"), end_time: g("end_time"),
        body: g("body"), block_type: block, status,
        confirm_line: g("confirm_line"), memo: g("memo"), confirmed,
      });
      close(); onSaved && onSaved();
    });
    back.querySelector('[data-act="del"]').addEventListener("click", async () => {
      if (!confirm("이 일정을 삭제할까요? 이 일정에 쌓인 시간 기록도 함께 삭제됩니다.")) return;
      await send("/api/schedules/" + row.id, "DELETE", {});
      close(); onSaved && onSaved();
    });
  };

  window.closeEditModal = () => closer && closer();
})();
