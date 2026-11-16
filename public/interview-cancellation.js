/* Personal schedule cancellation and native SMS composition. */
(() => {
  "use strict";

  function phoneNumber(value) {
    const compact = String(value || "").trim().replace(/[\s().-]/g, "").replace(/^\+82(?:0)?/, "0");
    return /^010\d{8}$/.test(compact) ? compact : "";
  }

  function candidates(text) {
    const found = new Map();
    for (const line of String(text || "").slice(0, 40000).split(/\r?\n/)) {
      for (const match of line.matchAll(/(?<![\d+])(?:010|\+82[ .-]?(?:0)?10)[ .-]?\d{4}[ .-]?\d{4}(?!\d)/g)) {
        const number = phoneNumber(match[0]);
        if (number && !found.has(number)) {
          const start = Math.max(0, match.index - 45);
          found.set(number, line.slice(start, match.index + match[0].length + 45).trim());
        }
        if (found.size === 8) return found;
      }
    }
    return found;
  }

  async function api(path, options) {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "요청을 완료하지 못했습니다.");
    return data;
  }

  function button(label, action) {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "btn2 ghost";
    control.textContent = label;
    control.addEventListener("click", action);
    return control;
  }

  window.openInterviewCancellation = async (row, onSaved) => {
    if (document.getElementById("interviewCancellationDialog")) return;
    const dialog = document.createElement("dialog");
    dialog.className = "interview-cancel";
    dialog.id = "interviewCancellationDialog";
    dialog.setAttribute("aria-labelledby", "interviewCancelTitle");
    dialog.innerHTML = HTML;
    const get = id => dialog.querySelector("#" + id);
    const form = get("interviewCancelForm");
    const contact = get("interviewContact");
    const name = get("interviewContactName");
    const phone = get("interviewContactPhone");
    const message = get("interviewMessage");
    const note = get("interviewCancelNote");
    const notified = get("interviewNotified");
    const confirmed = get("interviewRecipientConfirm");
    const sourceLabel = get("interviewContactSource");
    const progress = get("interviewProgress");
    const error = get("interviewError");
    const prepare = get("interviewPrepareSms");
    const sms = get("interviewOpenSms");
    const save = get("interviewSave");
    const sentSave = get("interviewSentSave");
    const returnPanel = get("interviewReturnPanel");
    const close = get("interviewClose");
    const mailProvider = get("interviewMailProvider");
    const mailSearch = get("interviewMailSearch");
    const mailQuery = get("interviewMailQuery");
    const mailResults = get("interviewMailResults");
    const mailBody = get("interviewMailBody");
    const mailCandidates = get("interviewMailCandidates");
    const path = "/api/schedules/" + encodeURIComponent(row.id) + "/interview-cancellation";
    const requests = new AbortController();
    let version = 0;
    let cancelled = false;
    let savedNotified = false;
    let loaded = false;
    let saving = false;
    let source = "";
    let mailRun = 0;

    const status = text => { progress.textContent = text; };
    const showError = text => { error.textContent = text; error.hidden = !text; };
    const invalidate = () => { sms.hidden = true; sms.removeAttribute("href"); };
    function updateActions() {
      save.disabled = !loaded || saving;
      sentSave.disabled = !loaded || saving;
      get("interviewFields").disabled = !loaded || saving;
      close.disabled = saving;
      prepare.disabled = !loaded || saving || notified.checked || !confirmed.checked || !phoneNumber(phone.value) || !message.value.trim();
      get("interviewSaveHint").textContent = notified.checked ? "Work-cycle 일정 취소와 문자 안내 완료를 함께 저장합니다." : "취소 기록을 저장해야 Work-cycle 달력에 반영됩니다. 문자 발송과는 별개입니다.";
    }

    function chooseNumber(number, origin, contactName = "") {
      phone.value = number;
      name.value = contactName.slice(0, 100);
      source = origin.slice(0, 300);
      sourceLabel.textContent = source;
      confirmed.checked = false;
      notified.checked = false;
      invalidate();
      updateActions();
      phone.focus();
    }

    async function saveRecord(mode) {
      if (!loaded || saving) return;
      const normalized = phoneNumber(phone.value);
      if (phone.value.trim() && !normalized) {
        showError("010으로 시작하는 휴대폰 번호를 확인해 주세요.");
        phone.focus();
        return;
      }
      if (mode === "draft" && (prepare.disabled || savedNotified)) {
        if (savedNotified) showError("연락 상태를 먼저 ‘연락 필요’로 저장한 뒤 새 문자를 준비해 주세요.");
        return;
      }
      const draftText = message.value.trim();
      saving = true;
      updateActions();
      showError("");
      status(mode === "draft" ? "초안 저장 중" : "취소 기록 저장 중");
      try {
        const data = await api(path, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          signal: requests.signal,
          body: JSON.stringify({
            mode, version, contact_name: name.value, contact_phone: normalized,
            contact_source: normalized ? source || "직접 입력" : "", message_text: draftText,
            cancel_note: note.value, sms_notified: mode === "cancel" && notified.checked
          })
        });
        version = data.record.version;
        cancelled = !!data.record.cancelled_at;
        savedNotified = !!data.record.sms_notified;
        if (mode === "draft") {
          if (!confirmed.checked || notified.checked || phoneNumber(phone.value) !== normalized || message.value.trim() !== draftText) {
            status("저장 중에 내용이 바뀌었어요. 받는 사람과 문구를 확인하고 초안을 다시 저장해 주세요.");
            return;
          }
          sms.href = "sms:" + normalized + "?body=" + encodeURIComponent(draftText);
          sms.hidden = false;
          sms.focus();
          status("문자 앱에서 번호와 문구를 확인하고 직접 보내세요. 문구가 비어 있으면 ‘문구 복사’를 이용해 주세요.");
        } else {
          row.status = "취소";
          get("interviewCancelTitle").textContent = "면접 취소 기록";
          save.textContent = "기록 업데이트";
          returnPanel.hidden = true;
          status(savedNotified ? "Work-cycle 일정 취소 저장됨 · 문자 안내 완료(직접 확인)" : "Work-cycle 일정 취소 저장됨 · 담당자 연락 필요");
          onSaved?.();
        }
      } catch (err) {
        showError(err.message);
        status("");
      } finally {
        saving = false;
        updateActions();
      }
    }

    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("cancel", e => { if (saving) e.preventDefault(); });
    dialog.addEventListener("close", () => { requests.abort(); dialog.remove(); }, { once: true });
    form.addEventListener("submit", e => { e.preventDefault(); void saveRecord("cancel"); });
    form.addEventListener("keydown", e => {
      if (e.key !== "Enter" || e.isComposing || !(e.target instanceof HTMLInputElement)) return;
      e.preventDefault();
      if (e.target === mailQuery) mailSearch.click();
    });
    prepare.addEventListener("click", () => { void saveRecord("draft"); });
    sentSave.addEventListener("click", () => {
      notified.checked = true;
      invalidate();
      void saveRecord("cancel");
    });
    sms.addEventListener("click", () => {
      returnPanel.hidden = false;
      status("전송을 마쳤다면 돌아와 ‘담당자에게 문자로 알렸어요’를 체크해 주세요.");
    });
    notified.addEventListener("change", () => {
      invalidate();
      if (notified.checked) contact.open = false;
      updateActions();
    });
    for (const control of [name, phone, message, confirmed]) {
      control.addEventListener(control === confirmed ? "change" : "input", () => {
        if (control === phone) {
          source = "직접 입력";
          sourceLabel.textContent = source;
        }
        if (control !== confirmed) confirmed.checked = false;
        notified.checked = false;
        invalidate();
        updateActions();
      });
    }
    get("interviewCopy").addEventListener("click", async () => {
      if (!message.value.trim()) {
        status("복사할 문자 내용을 입력해 주세요.");
        return;
      }
      try {
        await navigator.clipboard.writeText(message.value);
        status("문구를 복사했어요.");
      } catch {
        message.focus();
        message.select();
        status("선택한 문구를 복사해 주세요.");
      }
    });

    const picker = get("interviewPhonePicker");
    picker.hidden = !window.isSecureContext || typeof navigator.contacts?.select !== "function";
    picker.addEventListener("click", async () => {
      try {
        const selected = await navigator.contacts.select(["name", "tel"], { multiple: false });
        if (!selected.length) return;
        const numbers = (selected[0].tel || []).map(phoneNumber).filter(Boolean);
        const unique = [...new Set(numbers)];
        const list = get("interviewDeviceNumbers");
        list.replaceChildren();
        const person = String(selected[0].name?.[0] || "");
        for (const number of unique) {
          list.append(button(number, () => { chooseNumber(number, "휴대폰 연락처", person); list.replaceChildren(); }));
        }
        status(unique.length ? "사용할 휴대폰 번호를 선택해 주세요." : "선택한 연락처에 010 휴대폰 번호가 없습니다. 직접 입력해 주세요.");
      } catch {
        status("연락처 선택을 마치지 못했어요. 번호를 직접 입력할 수 있어요.");
      }
    });

    function showCandidates(container, text, origin) {
      container.replaceChildren();
      const numbers = candidates(text);
      for (const [number, context] of numbers) {
        const item = document.createElement("div");
        const snippet = document.createElement("small");
        snippet.textContent = context;
        item.append(button(number, () => chooseNumber(number, origin)), snippet);
        container.append(item);
      }
      return numbers.size;
    }

    async function readMail(provider, item, mailbox, run) {
      try {
        mailBody.hidden = true;
        mailCandidates.replaceChildren();
        const endpoint = provider === "gmail"
          ? "/api/gmail/messages/" + encodeURIComponent(item.id)
          : "/api/naver-mail/message?" + new URLSearchParams({ folder: mailbox.folder, uid: item.uid, validity: mailbox.validity });
        const detail = await api(endpoint, { signal: requests.signal });
        if (run !== mailRun) return;
        get("interviewMailMeta").textContent = [detail.subject, detail.from, detail.date].filter(Boolean).join(" · ");
        get("interviewMailText").textContent = String(detail.text || "").slice(0, 40000);
        mailBody.hidden = false;
        const found = showCandidates(mailCandidates, detail.text, [provider === "gmail" ? "Gmail" : "네이버 메일", detail.subject, detail.from, detail.date].filter(Boolean).join(" · "));
        status(found ? "메일 원문에서 번호의 주인을 확인한 뒤 선택해 주세요." : "선택한 메일에 010 번호 후보가 없습니다.");
      } catch (err) {
        if (run === mailRun && err.name !== "AbortError") showError(err.message);
      }
    }

    mailSearch.addEventListener("click", async () => {
      const query = mailQuery.value.trim();
      if (!query) { mailQuery.focus(); return; }
      const run = ++mailRun;
      const provider = mailProvider.value;
      const params = new URLSearchParams({ q: query });
      if (provider === "naver") params.set("folder", "INBOX");
      mailResults.replaceChildren();
      mailBody.hidden = true;
      mailCandidates.replaceChildren();
      showError("");
      status("메일 검색 중");
      try {
        const data = await api("/api/" + (provider === "gmail" ? "gmail" : "naver-mail") + "/messages?" + params, { signal: requests.signal });
        if (run !== mailRun) return;
        const items = (data.messages || []).slice(0, 10);
        for (const item of items) {
          const label = [item.subject, item.from, item.date].filter(Boolean).join(" · ");
          mailResults.append(button(label, () => { showError(""); void readMail(provider, item, data, ++mailRun); }));
        }
        status(items.length ? "해당 면접 안내 메일을 골라 주세요." : "검색 결과가 없습니다. 회사명이나 ‘면접’으로 검색해 보세요.");
      } catch (err) {
        if (run === mailRun && err.name !== "AbortError") { showError(err.message); status(""); }
      }
    });

    document.body.append(dialog);
    dialog.showModal();
    updateActions();
    try {
      const { schedule, record, google_linked } = await api(path, { signal: requests.signal });
      get("interviewScheduleSummary").textContent = [schedule.title, schedule.date, schedule.start_time].filter(Boolean).join(" · ");
      get("interviewGoogleNotice").hidden = !google_linked;
      version = record?.version || 0;
      cancelled = !!record?.cancelled_at;
      savedNotified = !!record?.sms_notified;
      name.value = record?.contact_name || "";
      phone.value = record?.contact_phone || "";
      source = record?.contact_source || "";
      sourceLabel.textContent = source;
      message.value = record?.message_text || "안녕하세요. " + schedule.date + " 면접에 참석 예정이었던 지원자입니다.\n사정이 생겨 면접에 참석하기 어려워 연락드립니다. 면접 기회를 주셔서 감사합니다.";
      note.value = record?.cancel_note || "";
      notified.checked = savedNotified;
      if (cancelled) {
        get("interviewCancelTitle").textContent = "면접 취소 기록";
        save.textContent = "기록 업데이트";
      }
      if (record?.contact_phone && !savedNotified) {
        contact.open = true;
        returnPanel.hidden = false;
      }
      const found = showCandidates(get("interviewScheduleCandidates"), [schedule.body, schedule.memo].filter(Boolean).join("\n"), "일정 내용 또는 메모");
      get("interviewScheduleCandidatesLabel").hidden = !found;
      get("interviewFields").disabled = false;
      loaded = true;
      status(cancelled ? (savedNotified ? "문자 안내 완료" : "담당자 연락 필요") : "");
      updateActions();
    } catch (err) {
      if (err.name !== "AbortError") { showError(err.message); status(""); }
    }
  };

  const HTML = `
    <form id="interviewCancelForm">
      <div class="interview-scroll">
        <h2 id="interviewCancelTitle">면접 참석 취소</h2>
        <p id="interviewScheduleSummary">일정 불러오는 중</p>
        <p id="interviewGoogleNotice" hidden>저장은 Work-cycle 달력에 반영됩니다. 연결된 Google 원본은 자동 취소되지 않습니다. <a href="https://calendar.google.com/" target="_blank" rel="noopener noreferrer">Google 캘린더 열기</a></p>
        <section id="interviewReturnPanel" class="interview-return" hidden>
          <strong>문자를 보낸 뒤 돌아오셨나요?</strong>
          <p>문자 앱을 열어도 발송 여부는 자동 확인할 수 없습니다. 실제로 보냈다면 아래 버튼으로 일정 취소까지 한 번에 저장하세요.</p>
          <button type="button" id="interviewSentSave" class="btn2">문자 발송 완료 · 취소 저장</button>
        </section>
        <fieldset id="interviewFields" disabled>
          <label class="interview-check"><input type="checkbox" id="interviewNotified"> 담당자에게 문자로 알렸어요</label>
          <details id="interviewContact">
            <summary>담당자 확인 · 문자 작성</summary>
            <p id="interviewScheduleCandidatesLabel" hidden>일정에 적힌 번호 후보</p>
            <div id="interviewScheduleCandidates" class="interview-results"></div>
            <button type="button" id="interviewPhonePicker" class="btn2 ghost" hidden>휴대폰 연락처에서 선택</button>
            <div id="interviewDeviceNumbers" class="interview-results"></div>
            <details>
              <summary>연결한 메일에서 번호 찾기</summary>
              <label for="interviewMailProvider">메일 서비스</label>
              <select id="interviewMailProvider"><option value="gmail">Gmail</option><option value="naver">네이버 받은메일함</option></select>
              <label for="interviewMailQuery">회사명 또는 면접 메일 제목</label>
              <input id="interviewMailQuery" type="search" maxlength="100" autocomplete="off">
              <button type="button" id="interviewMailSearch" class="btn2 ghost">메일 검색</button>
              <div id="interviewMailResults" class="interview-results"></div>
              <details id="interviewMailBody" hidden><summary>선택한 메일 원문</summary><p id="interviewMailMeta"></p><pre id="interviewMailText"></pre></details>
              <div id="interviewMailCandidates" class="interview-results"></div>
            </details>
            <label for="interviewContactName">담당자 이름 (선택)</label>
            <input id="interviewContactName" maxlength="100" autocomplete="off">
            <label for="interviewContactPhone">받는 사람 휴대폰 번호</label>
            <input id="interviewContactPhone" type="tel" inputmode="tel" maxlength="20" autocomplete="off" placeholder="010으로 시작하는 번호">
            <small id="interviewContactSource"></small>
            <label class="interview-check"><input id="interviewRecipientConfirm" type="checkbox"> 받는 사람이 맞는지 확인했어요</label>
            <label for="interviewMessage">문자 내용</label>
            <textarea id="interviewMessage" rows="4" maxlength="1000"></textarea>
            <div class="interview-actions">
              <button type="button" id="interviewCopy" class="btn2 ghost">문구 복사</button>
              <button type="button" id="interviewPrepareSms" class="btn2 ghost" disabled>문자 초안 저장</button>
              <a id="interviewOpenSms" class="btn2" hidden>문자 앱 열기</a>
            </div>
          </details>
          <details><summary>취소 메모 (선택)</summary><label class="interview-sr" for="interviewCancelNote">취소 메모</label><textarea id="interviewCancelNote" rows="2" maxlength="300"></textarea></details>
        </fieldset>
        <p id="interviewProgress" role="status" aria-live="polite"></p>
        <p id="interviewError" role="alert" hidden></p>
      </div>
      <div class="interview-footer">
        <small id="interviewSaveHint"></small>
        <div class="interview-actions">
          <button id="interviewClose" class="btn2 ghost" type="button">닫기</button>
          <button id="interviewSave" class="btn2" type="submit" disabled>취소 기록 저장</button>
        </div>
      </div>
    </form>`;
})();

