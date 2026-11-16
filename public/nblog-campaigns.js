(() => {
  "use strict";
  const root = document.getElementById("nblogCampaigns");
  if (!root) return;
  const form = root.querySelector("#nblogImport");
  const review = root.querySelector("#nblogReview");
  const list = root.querySelector("#nblogList");
  const status = root.querySelector("#nblogStatus");
  const result = root.querySelector("#nblogResult");
  const nblogUrl = "https://harness-meeting-app.kibayerin.workers.dev/nblog-automation/";
  let busy = false;
  let generation = 0;
  let rows = [];

  function node(tag, text, attrs = {}) {
    const el = document.createElement(tag);
    el.textContent = text;
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    return el;
  }
  const button = (label, type = "button") => node("button", label, { type, class: "btn2" });
  function field(container, name, label, type, value, options = {}) {
    const input = node("input", "", { type, name, ...options });
    input.value = value ?? "";
    const wrapper = node("label", label);
    wrapper.append(input);
    container.append(wrapper);
    return input;
  }
  function link(label, href) {
    return node("a", label, { href, target: "_blank", rel: "noopener noreferrer" });
  }
  const values = form => Object.fromEntries(new FormData(form));
  const personal = () => document.documentElement.dataset.workMode === "personal";
  const dateToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());

  async function api(path = "", method = "GET", body) {
    const response = await fetch("/api/nblog-campaigns" + path, {
      method, cache: "no-store", credentials: "same-origin",
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(data?.error || "체험단 정보를 불러오지 못했어요.");
    return data;
  }

  async function run(control, action) {
    if (busy) return;
    busy = true;
    control.disabled = true;
    result.textContent = "";
    try {
      await action();
    } catch (error) {
      result.textContent = error.message;
    } finally {
      control.disabled = false;
      busy = false;
    }
  }

  function highlight(id) {
    const el = list.querySelector("#nblog-card-" + id);
    if (el) { el.scrollIntoView({ block: "nearest" }); el.focus({ preventScroll: true }); }
  }

  async function reload() {
    const current = ++generation;
    root.hidden = !personal();
    if (root.hidden) {
      rows = [];
      review.replaceChildren();
      list.replaceChildren();
      result.textContent = "";
      return;
    }
    status.textContent = "체험단 목록을 불러오는 중이에요.";
    try {
      const data = await api();
      if (current !== generation) return;
      rows = data.rows;
      render();
      status.textContent = rows.length ? "" : "아직 저장한 체험단이 없어요.";
    } catch (error) {
      if (current === generation) status.textContent = error.message;
    }
  }

  function writeRow(campaign) {
    if (!personal()) return;
    const found = rows.some(row => row.id === campaign.id);
    rows = found ? rows.map(row => row.id === campaign.id ? campaign : row) : [campaign, ...rows];
    status.textContent = "";
    render();
    document.dispatchEvent(new CustomEvent("wc:nblog-schedule"));
  }

  function editForm(parent, label, addFields, onSubmit) {
    const details = node("details", "");
    const edit = node("form", "", { class: "nblog-fields" });
    details.append(node("summary", label), edit);
    addFields(edit);
    const submit = button("저장", "submit");
    edit.append(submit);
    edit.addEventListener("submit", event => {
      event.preventDefault();
      run(submit, () => onSubmit(values(edit)));
    });
    parent.append(details);
    return details;
  }

  function guideBookingPhones(text) {
    const label = /^(?:[*＊•·※▪▶►-]+\s*)?(?:(?:방문\s*)?예약\s*(?:담당자\s*)?(?:전화번호|연락처|전화|번호|문자(?:\s*문의)?)|문자\s*예약(?:\s*(?:번호|연락처))?)\s*(?:[:：]\s*|(?=[+\d(]|$))/;
    const pattern = /(?<!\d)(?:\+82[ .-]?(?:\(0\)[ .-]?)?|0)1[016789][ .(-]*\d{3,4}[ .)-]*\d{4}(?!\d)/g;
    const lines = text.normalize("NFKC").split(/\r?\n/).map(line => line.trim());
    const phones = lines.flatMap((line, index) => {
      const match = line.match(label);
      if (!match) return [];
      const rest = line.slice(match[0].length);
      const next = lines[index + 1] || "";
      const source = rest || (/^[+\d(]/.test(next) ? next : "");
      return [...source.replace(/[‐‑‒–—−]/g, "-").matchAll(pattern)].map(([phone]) =>
        phone.replace(/\D/g, "").replace(/^82(?:0)?(?=1[016789])/, "0"));
    });
    return [...new Set(phones)];
  }

  function offerGuidePaste(edit, phone, onFill) {
    const details = node("details", "");
    const label = node("label", "로그인 화면의 캠페인 가이드 문구");
    const input = node("textarea", "", { rows: "3", maxlength: "12000", placeholder: "예약번호가 표시된 안내 문구를 붙여넣어 주세요." });
    const read = button("가이드에서 예약번호 채우기");
    const feedback = node("p", "", { class: "sub", role: "status" });
    label.append(input);
    details.append(node("summary", "로그인 화면의 가이드에서 번호 가져오기"), label, read, feedback);
    edit.append(details);
    read.addEventListener("click", () => {
      if (phone.value.trim()) {
        feedback.textContent = "예약번호 칸에 이미 입력한 값이 있어요.";
        return;
      }
      const matches = guideBookingPhones(input.value);
      if (matches.length !== 1) {
        feedback.textContent = matches.length
          ? "예약번호 후보가 여러 개예요. 가이드에서 해당 업체 번호를 확인해 주세요."
          : "예약번호가 적힌 줄을 포함해 붙여넣어 주세요.";
        return;
      }
      phone.value = matches[0];
      input.value = "";
      onFill(matches[0]);
      feedback.textContent = "예약번호를 채웠어요. 확인한 뒤 저장해 주세요.";
      phone.focus();
    });
  }

  function renderCandidate(candidate) {
    review.replaceChildren();
    const edit = node("form", "", { class: "nblog-fields" });
    edit.append(node("h3", "가져온 정보 확인"), link("캠페인 원문 열기", candidate.campaign_url));
    field(edit, "name", "업체명", "text", candidate.name, { required: "", maxlength: "150" });
    const phone = field(edit, "phone", "예약 휴대전화 번호", "tel", candidate.phone, { maxlength: "20", placeholder: "확인 필요" });
    let guidePhone = "";
    if (candidate.phone_evidence) edit.append(node("p", candidate.phone_evidence, { class: "sub" }));
    if (!candidate.phone) offerGuidePaste(edit, phone, value => { guidePhone = value; });
    field(edit, "deadline", "결과 등록 마감일", "date", candidate.deadline);
    edit.append(node("p", candidate.deadline_evidence || "마감일 확인 필요. 비워 두면 일정 없이 카드만 저장돼요.", { class: "sub" }));
    if (candidate.deadline && candidate.deadline < dateToday()) {
      edit.append(node("p", "가져온 결과 등록 마감일이 이미 지났어요.", { class: "sub" }));
    }
    if (candidate.visit_period) edit.append(node("p", "방문 가능 기간 · " + candidate.visit_period));
    if (candidate.requirements || candidate.keywords) {
      const requirements = node("details", "");
      requirements.append(node("summary", "작성 조건과 키워드"), node("p", candidate.requirements), node("p", candidate.keywords));
      edit.append(requirements);
    }
    const confirm = node("label", "", { class: "nblog-confirm" });
    confirm.append(node("input", "", { type: "checkbox", required: "" }),
      node("span", "선정 여부와 가져온 번호·마감일을 원문에서 확인했어요."));
    const save = button("카드 저장", "submit");
    edit.append(confirm, save);
    edit.addEventListener("submit", event => {
      event.preventDefault();
      const fields = values(edit);
      run(save, async () => {
        const phoneEvidence = guidePhone && fields.phone === guidePhone ? "사용자가 붙여넣은 캠페인 가이드" :
          fields.phone === candidate.phone ? candidate.phone_evidence : "";
        const saved = await api("", "POST", { ...candidate, ...fields, phone_evidence: phoneEvidence, reviewed: true });
        writeRow(saved.campaign);
        review.replaceChildren();
        form.reset();
        result.textContent = saved.reused ? "기존 캠페인 카드를 열었어요." : "체험단 카드를 저장했어요.";
        highlight(saved.campaign.id);
      });
    });
    review.append(edit);
    edit.querySelector("input").focus();
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    const submit = form.querySelector("button");
    review.replaceChildren();
    run(submit, async () => {
      result.textContent = "공개 캠페인에서 정보를 읽고 있어요.";
      const data = await api("/inspect", "POST", values(form));
      if (!personal()) return;
      if (data.existing) {
        writeRow(data.existing);
        form.reset();
        result.textContent = "기존 캠페인 카드를 열었어요.";
        highlight(data.existing.id);
      } else {
        result.textContent = "가져온 값을 확인하고 저장해 주세요.";
        renderCandidate(data.candidate);
      }
    });
  });

  function card(row) {
    const el = node("article", "", { id: "nblog-card-" + row.id, class: "nblog-card", tabindex: "-1" });
    const phase = row.submitted_at ? "등록 완료" : row.published_url ? "결과 등록 필요" :
      row.visited_at ? "초안·발행 필요" : row.visit_date ? "방문 확정" :
      row.visit_schedule_id ? "방문 취소 · 다시 예약 가능" : row.sms_confirmed_at ? "답변 대기" : "방문 예약 필요";
    const tone = row.submitted_at || (row.visit_date && !row.visited_at) ? "ok" : row.visited_at ? "write" :
      row.sms_confirmed_at && !row.visit_schedule_id ? "wait" : "todo";
    el.append(node("h3", row.name), node("p", phase, { class: "nblog-phase", "data-phase": tone }));
    if (!row.phone && !row.visit_date) el.append(node("p", "예약 연락처 · 확인 필요", { class: "sub" }));
    const facts = node("p", row.deadline_date ? "결과 등록 마감 · " + row.deadline_date : "결과 등록 마감 · 확인 필요");
    if (!row.submitted_at && row.deadline_date) {
      const days = (Date.parse(row.deadline_date) - Date.parse(dateToday())) / 86400000;
      if (days <= 3) facts.append(node("strong", days < 0 ? "마감 지남" : days === 0 ? "오늘까지" : days + "일 남음"));
    }
    el.append(facts);
    if (row.visit_date) el.append(node("p", "방문 · " + row.visit_date + " " + row.visit_start + "–" + row.visit_end));
    if (row.visit_period) el.append(node("p", "방문 가능 기간 · " + row.visit_period, { class: "sub" }));
    const urls = node("div", "", { class: "nblog-actions" });
    urls.append(link("캠페인 원문", row.campaign_url));
    if (row.place_url) urls.append(link("지도 열기", row.place_url));
    el.append(urls);
    if (row.requirements || row.keywords) {
      const requirements = node("details", "");
      requirements.append(node("summary", "작성 조건 보기"), node("p", row.requirements), node("p", row.keywords));
      el.append(requirements);
    }
    window.WorkCycleNBlogProgress?.history(el, row.id);
    if (row.submitted_at) return el;
    const patch = async (action, data = {}) => {
      const updated = await api("/" + row.id, "PATCH", { version: row.version, action, ...data });
      writeRow(updated.campaign);
      result.textContent = "캠페인 상태를 저장했어요.";
      highlight(row.id);
    };
    const foot = node("div", "", { class: "nblog-foot" });
    const quick = (label, action, quiet) => {
      const control = button(label);
      if (quiet) control.classList.add("ghost", "danger");
      control.addEventListener("click", () => run(control, action));
      foot.append(control);
      if (!foot.parentNode) el.append(foot);
      return control;
    };

    const refreshed = {};
    editForm(el, "예약 번호·마감일 확인", edit => {
      const phone = field(edit, "phone", "예약 휴대전화 번호", "tel", row.phone, { maxlength: "20" });
      const deadline = field(edit, "deadline", "결과 등록 마감일", "date", row.deadline_date, row.deadline_date ? { required: "" } : {});
      if (row.deadline_evidence) edit.append(node("p", "원문 · " + row.deadline_evidence, { class: "sub" }));
      const message = node("p", "", { class: "sub", role: "status" });
      if (!row.phone || !row.deadline_date) {
        const refresh = button("원문에서 빈 항목 채우기");
        refresh.addEventListener("click", () => run(refresh, async () => {
          const { candidate } = await api("/inspect", "POST", { url: row.campaign_url, refresh: true });
          const applied = [];
          if (!phone.value && candidate?.phone) {
            phone.value = candidate.phone;
            refreshed.phone = candidate.phone;
            refreshed.phone_evidence = candidate.phone_evidence;
            applied.push("예약번호");
          }
          if (!deadline.value && candidate?.deadline) {
            deadline.value = candidate.deadline;
            refreshed.deadline = candidate.deadline;
            refreshed.deadline_evidence = candidate.deadline_evidence;
            applied.push("마감일");
          }
          const feedback = applied.length
            ? applied.join("·") + " 항목을 채웠어요. 원문을 확인하고 저장해 주세요."
            : "공개 페이지에서 빈 항목을 확인할 수 없어요.";
          message.textContent = [feedback, refreshed.phone_evidence, refreshed.deadline_evidence].filter(Boolean).join(" ");
        }));
        edit.append(refresh, message);
      }
      if (!row.phone) offerGuidePaste(edit, phone, value => {
        refreshed.phone = value;
        refreshed.phone_evidence = "사용자가 붙여넣은 캠페인 가이드";
      });
    }, data => patch("details", {
      ...data,
      phone_evidence: data.phone === refreshed.phone ? refreshed.phone_evidence : undefined,
      deadline_evidence: data.deadline === refreshed.deadline ? refreshed.deadline_evidence : undefined,
    }));

    if (!row.visit_date && row.phone && !row.sms_confirmed_at) {
      const details = node("details", "");
      const message = node("div", "", { class: "nblog-fields" });
      details.append(node("summary", "예약 문자 작성"), message);
      const date = field(message, "preferredDate", "희망 방문일", "date", "");
      const time = field(message, "preferredTime", "희망 시간", "time", "");
      const people = field(message, "people", "인원", "number", "2", { min: "1", max: "20" });
      const nick = field(message, "nick", "이름 또는 닉네임", "text", "", { maxlength: "40" });
      const output = node("textarea", "", { rows: "3", "aria-label": "예약 문자 문구" });
      const send = node("a", "문자 앱 열기");
      const copy = button("문구 복사");
      const sent = button("보냈어요");
      function updateLink() {
        const ready = Boolean(date.value && time.value && people.value && people.checkValidity() && output.value.trim());
        send.hidden = !ready;
        copy.disabled = !ready;
        if (ready) send.href = "sms:" + row.phone + "?body=" + encodeURIComponent(output.value);
        else send.removeAttribute("href");
      }
      function draft() {
        output.value = date.value && time.value && people.value && people.checkValidity() ?
          "안녕하세요. " + row.name + " 체험단" + (nick.value.trim() ? " " + nick.value.trim() : "") +
          "입니다. " + date.value + " " + time.value + "에 " + people.value + "명 방문이 가능할까요? 감사합니다." : "";
        updateLink();
      }
      for (const input of [date, time, people, nick]) input.addEventListener("input", draft);
      output.addEventListener("input", updateLink);
      copy.addEventListener("click", () => run(copy, async () => {
        await navigator.clipboard.writeText(output.value);
        result.textContent = "예약 문구를 복사했어요.";
      }));
      sent.addEventListener("click", () => {
        if (window.confirm("문자 앱에서 실제로 전송했나요? 앱을 여는 것만으로는 발송되지 않습니다.")) run(sent, () => patch("sms", { confirmed: true }));
      });
      const sendRow = node("div", "", { class: "nblog-actions" });
      copy.classList.add("ghost");
      sendRow.append(send, copy, sent);
      message.append(node("p", "받는 번호 · " + row.phone), output, sendRow);
      draft();
      el.append(details);
    }
    if (!row.visited_at) {
      const preparation = node("details", "");
      const checklist = node("ul", "");
      for (const item of [
        "주차나 찾아오는 길 안내를 확인하고 사진 남기기",
        "메뉴판 또는 서비스 안내와 직접 이용한 항목 기록하기",
        "방문 시간과 예약·대기 여부를 메모하기",
      ]) checklist.append(node("li", item));
      preparation.append(node("summary", "방문 전 검색에 쓸 자료 챙기기"), checklist);
      el.append(preparation);
      editForm(el, row.visit_date ? "방문 시간 변경" : "업체가 확정한 방문 일정 추가", edit => {
        field(edit, "date", "방문일", "date", row.visit_date, { required: "" });
        field(edit, "start", "시작 시간", "time", row.visit_start, { required: "" });
        field(edit, "end", "종료 시간", "time", row.visit_end, { required: "" });
      }, data => patch("visit", data));
      if (row.visit_date) {
        quick("방문 완료", () => patch("visited"));
        quick("방문 취소 기록", async () => {
          if (window.confirm("업체와 방문 취소를 확인했나요? 확인하면 연결된 Work-cycle 일정도 취소로 표시됩니다. 이 버튼은 문자를 보내지 않습니다.")) await patch("cancel_visit", { confirmed: true });
        }, true);
      }
    } else if (!row.published_url) {
      window.WorkCycleNBlog?.mount({
        parent: el, campaign: row,
        onPublished: async url => {
          try { await patch("publish", { url }); }
          catch (error) { result.textContent = error.message; throw error; }
        },
      });
      const fallback = node("details", "");
      const destination = new URL(nblogUrl);
      destination.search = new URLSearchParams({
        new_campaign: "1", campaign_id: "NB-" + row.source_id, campaign_url: row.campaign_url,
        campaign_name: row.name, place_url: row.place_url || "", visit_date: row.visit_date,
      }).toString();
      fallback.append(node("summary", "NBlog에서 직접 열기"), link("NBlog 열기", destination.href));
      el.append(fallback);
      editForm(el, "네이버에 발행한 글 주소 저장", edit => {
        field(edit, "url", "블로그 글 주소", "url", "", { required: "", maxlength: "500" });
      }, data => patch("publish", data));
    } else {
      const copy = button("블로그 글 주소 복사");
      copy.addEventListener("click", () => run(copy, async () => {
        await navigator.clipboard.writeText(row.published_url);
        result.textContent = "글 주소를 복사했어요. 캠페인 원문에서 제출해 주세요.";
      }));
      const published = node("div", "", { class: "nblog-actions" });
      published.append(link("발행한 글 열기", row.published_url), copy);
      el.append(published);
      editForm(el, "캠페인 사이트에 제출했어요", edit => {
        const check = node("label", "", { class: "nblog-confirm" });
        check.append(node("input", "", { type: "checkbox", required: "" }),
          node("span", "캠페인 사이트에서 결과 등록 완료를 확인했어요."));
        edit.append(check);
      }, () => patch("submit", { confirmed: true }));
    }
    return el;
  }

  function render() {
    list.replaceChildren(...rows.map(card));
  }

  root.querySelector("#nblogReload").addEventListener("click", () => { void reload(); });
  document.addEventListener("wc:mode", () => { void reload(); });
  void reload();
})();

