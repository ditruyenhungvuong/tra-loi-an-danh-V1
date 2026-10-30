/* =========================================================
   Mọi lời gọi tới Apps Script (hoặc tools/mock-api.js khi MOCK = true) – tech design 4.13
   - GET cho người tham gia (ping, getRoom, heartbeat): timeout GET_TIMEOUT_MS,
     fetch bị chặn CORS/redirect (TypeError) → thử lại bằng JSONP (?callback=) trong thời gian còn lại.
   - POST cho submitAnswer và MỌI lời gọi người dẫn (kèm key trong body, không bao giờ trên URL):
     Content-Type text/plain để không có preflight CORS; timeout; không có JSONP.
   - Mọi hàm trả Promise<object> LUÔN resolve: body JSON của máy chủ hoặc
     { result:'error', error:'network'|'timeout'|'no_url' }. Người gọi chỉ cần xem r.result / r.error.
   ========================================================= */
window.APP_API = (function () {
  'use strict';
  const C = window.APP_CONFIG || {};
  const NO_URL = () => ({ result: 'error', error: 'no_url' });
  const ERR = code => ({ result: 'error', error: code });

  function base() {
    const b = C.MOCK ? (C.MOCK_URL || '') : (C.GOOGLE_SCRIPT_URL || '');
    return String(b || '').trim();
  }
  /* Ghép query vào base (base có thể đã có ? hoặc chưa) */
  function urlWith(query) {
    const b = base();
    if (!b) return '';
    return b + (b.indexOf('?') >= 0 ? '&' : '?') + query;
  }
  function qs(obj) {
    return Object.keys(obj).filter(k => obj[k] !== undefined && obj[k] !== null)
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])).join('&');
  }
  /* Máy chủ phải trả object có result; lệch khuôn thì coi là lỗi để UI không vỡ */
  function normalize(r) {
    if (!r || typeof r !== 'object') return ERR('bad_response');
    if (r.result !== 'success' && !r.error) return Object.assign({ result: 'error', error: 'server_error' }, r, { result: 'error' });
    return r;
  }

  /* ===== JSONP dự phòng cho GET (WebView chặn CORS) ===== */
  let jsonpSeq = 0;
  const JSONP_LATE_GRACE_MS = 5000;
  function jsonp(url, ms) {
    return new Promise(resolve => {
      const name = '__tladCb' + (++jsonpSeq) + '_' + Date.now().toString(36);
      const script = document.createElement('script');
      let done = false, timer = 0;
      const removeFn = () => { try { delete window[name]; } catch (e) { window[name] = undefined; } };
      /* Quá giờ: script có thể về muộn và gọi hàm → giữ hàm rỗng 5 s rồi mới xóa, tránh ReferenceError */
      const finish = (val, late) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (late) { window[name] = function () { /* về muộn, bỏ qua */ }; setTimeout(removeFn, JSONP_LATE_GRACE_MS); }
        else removeFn();
        if (script.parentNode) script.parentNode.removeChild(script);
        resolve(val);
      };
      window[name] = json => finish(json, false);
      script.onerror = () => finish(ERR('network'), false);
      timer = setTimeout(() => finish(ERR('timeout'), true), ms);
      script.src = url + '&callback=' + name;
      document.head.appendChild(script);
    });
  }

  /* ===== GET có timeout + JSONP dự phòng ===== */
  function getJSON(query, timeoutMs) {
    const url = urlWith(query);
    if (!url) return Promise.resolve(NO_URL());
    const ms = timeoutMs || C.GET_TIMEOUT_MS || 8000;
    const started = Date.now();
    const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    let timer = 0;
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => { if (ctrl) { try { ctrl.abort(); } catch (e) { /* bỏ qua */ } } resolve(ERR('timeout')); }, ms);
    });
    let req;
    try {
      req = fetch(url, { method: 'GET', redirect: 'follow', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined }).then(r => r.json());
    } catch (e) { req = Promise.reject(e); }
    const guarded = req.catch(err => {
      const remaining = ms - (Date.now() - started);
      if (err && err.name === 'TypeError' && navigator.onLine !== false && remaining > 200) return jsonp(url, remaining);
      return ERR(err && err.name === 'AbortError' ? 'timeout' : 'network');
    });
    return Promise.race([guarded, timeout]).then(r => { clearTimeout(timer); return normalize(r); });
  }

  /* ===== POST text/plain có timeout ===== */
  function postJSON(body, timeoutMs) {
    const url = base();
    if (!url) return Promise.resolve(NO_URL());
    const ms = timeoutMs || C.SUBMIT_TIMEOUT_MS || 8000;
    const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    let timer = 0;
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => { if (ctrl) { try { ctrl.abort(); } catch (e) { /* bỏ qua */ } } resolve(ERR('timeout')); }, ms);
    });
    let req;
    try {
      req = fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'follow',
        cache: 'no-store',
        signal: ctrl ? ctrl.signal : undefined
      }).then(r => r.json());
    } catch (e) { req = Promise.reject(e); }
    const guarded = req.catch(err => ERR(err && err.name === 'AbortError' ? 'timeout' : 'network'));
    return Promise.race([guarded, timeout]).then(r => { clearTimeout(timer); return normalize(r); });
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ===== Người tham gia ===== */
  function ping() {
    /* Đánh thức Apps Script lúc tải trang, không chờ, nuốt lỗi */
    try { getJSON('action=ping', 8000).catch(() => { /* im lặng */ }); } catch (e) { /* im lặng */ }
  }
  const getRoom = room => getJSON(qs({ action: 'getRoom', room }));
  const heartbeat = (room, device) => getJSON(qs({ action: 'heartbeat', room, device }));
  /* Gửi câu trả lời; máy chủ trả busy → tự gửi lại MỘT lần (idempotent nhờ khóa room|q|device) */
  function submitAnswer(p) {
    const body = { action: 'submitAnswer', room: p.room, device: p.device, q: p.q, text: p.text };
    return postJSON(body, C.SUBMIT_TIMEOUT_MS).then(r => {
      if (r.error !== 'busy') return r;
      return sleep((C.BUSY_RETRY_MS || 1500) + Math.floor(Math.random() * 1000)).then(() => postJSON(body, C.SUBMIT_TIMEOUT_MS));
    });
  }

  /* ===== Người dẫn: chỉ POST, khóa trong body ===== */
  const host = {
    createRoom: (key, questions) => postJSON({ action: 'createRoom', key, questions }),
    getState: (key, room, since) => postJSON({ action: 'getState', key, room, since: since || 0 }, C.GET_TIMEOUT_MS),
    setQuestion: (key, room, index) => postJSON({ action: 'setQuestion', key, room, index }),
    closeRoom: (key, room) => postJSON({ action: 'closeRoom', key, room }),
    deleteRoom: (key, room) => postJSON({ action: 'deleteRoom', key, room })
  };

  return { base, ping, getRoom, heartbeat, submitAnswer, host };
})();
