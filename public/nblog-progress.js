(() => {
  "use strict";
  const labels = { connecting: "연결 시작 기록", running: "요청 전달 · 결과 확인 중", generating: "초안 생성 중", ready: "초안 확인 완료", published: "발행 주소 확인 완료", handoff: "사진 입력 도우미 열림", interrupted: "연결 중단 · 결과 확인 필요", error: "처리 실패 · 결과 확인 필요", empty: "저장된 초안 없음" };
  const actions = { saved: "체험단 카드 저장", sms_confirmed: "예약 문자 발송을 사용자가 확인", visit_confirmed: "방문 일정 확정·변경", visit_cancelled: "방문 취소 · 일정 반영", visited: "방문 완료", published: "발행 주소 저장", submitted: "결과 제출 확인" };
  const time = value => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  async function api(id, body) {
    const response = await fetch("/api/nblog-campaigns/" + id + "/progress", {
      credentials: "same-origin", cache: "no-store", ...(body ? { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "실행 기록 저장에 실패했어요.");
    return data;
  }
  const pendingWriters = new Map();
  function writer(id, operation, changed) {
    if (pendingWriters.has(id)) throw new Error("이전 실행 기록부터 저장해 주세요.");
    let notify = changed;
    let sequence = 0, pending = null, chain = Promise.resolve();
    const run_id = crypto.randomUUID();
    const write = body => {
      chain = chain.catch(() => {}).then(async () => {
        try {
          await api(id, body);
          if (pending === body) { pending = null; pendingWriters.delete(id); }
          notify("기록 저장됨 · " + labels[body.state], !!pending);
        } catch (error) {
          notify(error.message + " 실행 결과를 다시 만들지 말고 기록 저장을 재시도해 주세요.", true);
          throw error;
        }
      });
      return chain;
    };
    const instance = {
      record(state) { pending = { run_id, operation, sequence: ++sequence, state }; pendingWriters.set(id, instance); return write(pending); },
      retry() { return pending ? write(pending) : chain; },
      listen(callback) { notify = callback; }
    };
    return instance;
  }
  function history(parent, id) {
    const detail = document.createElement("details");
    detail.className = "nblog-history";
    const summary = document.createElement("summary"); summary.textContent = "저장된 처리·실행 이력";
    const content = document.createElement("div"); content.setAttribute("role", "status");
    detail.append(summary, content); parent.append(detail);
    detail.addEventListener("toggle", async () => {
      if (!detail.open) return;
      content.textContent = "저장된 기록을 확인하고 있어요.";
      try {
        const data = await api(id);
        const entries = [
          ...data.runs.map(r => ({ date: r.updated_at, text: labels[r.state] + (r.state === "connecting" || r.state === "running" ? " (완료 여부는 기존 초안 확인으로 확인)" : "") })),
          ...data.activity.map(r => ({ date: r.created_at, text: actions[r.action] || r.action }))
        ].sort((a, b) => b.date.localeCompare(a.date));
        content.replaceChildren();
        if (!entries.length) content.textContent = "아직 저장된 처리 이력이 없어요. 이전 작업의 완료 여부를 추정하지 않습니다.";
        const list = document.createElement("ol");
        for (const item of entries.slice(0, 20)) { const li = document.createElement("li"); li.textContent = item.text + " · " + time(item.date); list.append(li); }
        content.append(list);
      } catch (error) { content.textContent = error.message; }
    });
  }
  window.WorkCycleNBlogProgress = Object.freeze({ writer, history, pending: id => pendingWriters.get(id) || null });
})();
