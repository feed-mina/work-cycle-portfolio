// 공용 API 오류 타입 —
// 각 화면의 api()는 실패를 사용자에게 alert로 알린 뒤 흐름을 끊으려고 throw 한다.
// 호출부가 대부분 catch 없는 async 이벤트 리스너라 그대로 두면 "처리되지 않은 promise 거부"가
// 콘솔에 쌓여 진짜 오류를 덮는다. 이미 알린 오류만 골라 조용히 삼킨다.
class ApiError extends Error {
  constructor(msg){ super(msg); this.name = 'ApiError'; }
}
window.ApiError = ApiError;
addEventListener('unhandledrejection', e => {
  if (e.reason instanceof ApiError) e.preventDefault();
});

// 다크모드 토글 — localStorage에 저장, 모든 페이지 공통
(function(){
  try { if (localStorage.getItem('wc-dark') === '1') document.body.classList.add('dark'); } catch(e){}
  window.toggleDark = function(){
    const on = document.body.classList.toggle('dark');
    try { localStorage.setItem('wc-dark', on ? '1' : '0'); } catch(e){}
  };
})();
