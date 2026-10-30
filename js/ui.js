/* =========================================================
   Tiện ích giao diện dùng chung cho index.html và host.html
   esc() và toast() PHẢI giống hệt ở hai trang nên gom vào đây.
   Gồm: $, $$, esc, toast, reduceMotion, lifecycle (timer/listener dọn khi rời màn),
   newId (chuỗi ngẫu nhiên [a-z0-9]), focusHeading, vibrate, makePoller (vòng hỏi máy chủ
   có jitter, backoff, dừng khi tab ẩn), formatStamp.
   Cố ý không dùng ?. và ?? để vài WebView cũ (Zalo, Messenger) vẫn chạy.
   ========================================================= */
window.APP_UI = (function () {
  'use strict';

  /* ===== Chọn phần tử, thoát HTML ===== */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  /* Mọi chuỗi người gõ hay từ máy chủ phải đi qua đây trước khi vào innerHTML */
  const esc = s => String(s === null || s === undefined ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduceMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ===== Toast thay cho hộp thoại alert của trình duyệt ===== */
  function toast(msg, ms) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), ms || 3000);
  }

  /* ===== Lifecycle: timer/listener của màn hình, dọn hết khi đổi màn ===== */
  let cleanups = [];
  const lifecycle = {
    later(fn, ms) { const id = setTimeout(fn, ms); cleanups.push(() => clearTimeout(id)); return id; },
    every(fn, ms) { const id = setInterval(fn, ms); cleanups.push(() => clearInterval(id)); return id; },
    on(el, type, fn, opts) { el.addEventListener(type, fn, opts); cleanups.push(() => el.removeEventListener(type, fn, opts)); },
    onCleanup(fn) { cleanups.push(fn); }
  };
  function runCleanups() {
    const list = cleanups;
    cleanups = [];
    list.forEach(f => { try { f(); } catch (e) { /* bỏ qua */ } });
  }

  /* ===== Chuỗi ngẫu nhiên [a-z0-9], dùng cho deviceId ===== */
  function newId(len) {
    const n = len || 16, chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    try {
      if (window.crypto && crypto.getRandomValues) {
        const buf = new Uint8Array(n);
        crypto.getRandomValues(buf);
        for (let i = 0; i < n; i++) out += chars[buf[i] % chars.length];
        return out;
      }
    } catch (e) { /* WebView chặn crypto → dùng Math.random */ }
    for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  /* Focus vào tiêu đề màn mới (cho trình đọc màn hình), không cuộn giật */
  function focusHeading(h) {
    if (!h) return;
    if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
    try { h.focus({ preventScroll: true }); } catch (e) { try { h.focus(); } catch (e2) { /* bỏ qua */ } }
  }

  /* Rung nhẹ trên điện thoại; máy không hỗ trợ hay chặn thì thôi */
  const vibrate = ms => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* bỏ qua */ } };

  /* ===== Vòng hỏi máy chủ (tech design 4.13) =====
     - một request đang bay thì không gửi thêm; hẹn lần sau chỉ khi lần trước xong
     - khoảng chờ = ms × (1 ± jitter); lỗi liên tiếp ×2 tới backoffMax; thành công về mức thường
     - tab ẩn thì dừng, hiện lại gọi ngay; có mạng lại (online) gọi ngay
     tick() trả Promise<boolean>: true = thành công, false = lỗi (để tính backoff). */
  function makePoller(opts) {
    let timer = 0, running = false, inFlight = false, fails = 0, baseMs = opts.ms;
    const jitter = typeof opts.jitter === 'number' ? opts.jitter : 0.15;
    const backoffMax = opts.backoffMax || 30000;

    function nextDelay() {
      const grow = fails ? Math.pow(2, Math.min(fails, 6)) : 1;
      const d = Math.min(baseMs * grow, backoffMax);
      return Math.round(d * (1 + (Math.random() * 2 - 1) * jitter));
    }
    function schedule(ms) { clearTimeout(timer); if (running) timer = setTimeout(run, ms); }
    function run() {
      clearTimeout(timer);
      if (!running || inFlight) return;
      if (document.hidden) return;              // chờ visibilitychange gọi lại
      inFlight = true;
      let p;
      try { p = Promise.resolve(opts.tick()); } catch (e) { p = Promise.resolve(false); }
      p.then(ok => ok !== false, () => false).then(ok => {
        inFlight = false;
        if (!running) return;
        fails = ok ? 0 : fails + 1;
        schedule(nextDelay());
      });
    }
    function kick() { if (running && !inFlight) run(); }
    function start() { if (running) return; running = true; fails = 0; run(); }
    function stop() { running = false; clearTimeout(timer); }
    function setBase(ms) { baseMs = ms; }
    const onVis = () => { if (!document.hidden) kick(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', kick);
    return {
      start, stop, kick, setBase,
      isRunning: () => running,
      destroy() { stop(); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', kick); }
    };
  }

  /* 'yyyyMMdd-HHmm' theo giờ máy, cho tên file CSV */
  const pad2 = n => (n < 10 ? '0' : '') + n;
  function formatStamp(d) {
    d = d || new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes());
  }

  return { $, $$, esc, toast, reduceMotion, lifecycle, runCleanups, newId, focusHeading, vibrate, makePoller, formatStamp };
})();
