/* =========================================================
   Trả lời ẩn danh – trang người tham gia (index.html)
   Luồng: ?room= hoặc gõ 4 số → getRoom → J1 câu hỏi + ô gõ → Gửi › → J2 Đã gửi ✓ → chờ câu kế
          → heartbeat mỗi POLL_JOIN_MS (tab hiện) tự đổi câu / kết thúc.
   Mọi màn là section trong index.html, đổi bằng ẩn/hiện; focus vào tiêu đề màn mới.
   Mọi click qua data-act; mọi chuỗi vào HTML qua esc(); toast thay cho hộp thoại alert của trình duyệt.
   Không dùng ?. và ?? để WebView cũ (Zalo, Messenger) vẫn chạy.
   ========================================================= */
(() => {
  'use strict';
  const C = window.APP_CONFIG || {};
  const U = window.APP_UI, S = window.APP_STORE, A = window.APP_API;
  const { $, $$, esc } = U;
  const MAX = C.MAX_LEN || 280;
  const CODE_LEN = C.ROOM_CODE_LENGTH || 4;
  const CODE_RE = new RegExp('^\\d{' + CODE_LEN + '}$');
  const COUNTER_FROM = 200;     // bộ đếm hiện từ 200 ký tự (UX)
  const COUNTER_NEAR = 260;     // .near (tech design 6.1)

  /* ===== Chuỗi hiển thị động – nguyên văn PRD Phụ lục A / UX mục 6 ===== */
  const TEXT = {
    enterNeed: '💡 Gõ đủ 4 số rồi vào nhé.',
    enterReady: '✨ Đủ rồi, bạn bấm vào phòng nhé.',
    enterBtn: 'Vào phòng ›',
    entering: 'Đang vào…',
    notFound: 'Mình không tìm thấy phòng này. Bạn kiểm tra lại mã trên màn chiếu nhé.',
    enterNet: 'Chưa vào được. Mạng hơi chậm, bạn thử lại nhé.',
    sendNeed: '💡 Gõ một câu rồi gửi nhé.',
    sendReady: '✨ Đọc lại một lần rồi gửi nhé.',
    sendBtn: 'Gửi ›',
    sending: 'Đang gửi…',
    retryBtn: 'Gửi lại',
    sendFail: 'Chưa gửi được. Mạng hơi chậm, bạn thử lại nhé.',
    sendFailWebview: 'Chưa gửi được. Bạn mở link bằng Chrome hoặc Safari rồi thử lại nhé.',
    wait: 'Chờ câu tiếp theo nhé.',
    dup: 'Bạn đã gửi câu này rồi. Chờ câu tiếp theo nhé.',
    thanksTitle: 'Cám ơn bạn',
    thanksLead: 'Buổi hôm nay đã xong. Cám ơn bạn đã góp một câu.',
    endedTitle: 'Phòng này đã kết thúc',
    endedLead: 'Cám ơn bạn đã tham gia.',
    qLabel: (k, n) => 'Câu ' + k + '/' + n
  };

  /* ===== Trạng thái (tech design 3.4) ===== */
  const state = {
    device: '',
    room: null,                 // {code, status, currentIndex, questionCount, createdAt}
    question: null,             // {index, text}
    answered: {},               // {"<q>": text}
    draft: '',
    sending: false,
    sendError: null,
    changedWhileTyping: false,
    online: true,
    entering: false,
    dupShown: false,            // J2 đang ở biến thể "đã gửi rồi"
    screen: ''
  };
  const el = {};
  let poller = null;

  /* ===== Màn hình: ẩn/hiện section, focus tiêu đề ===== */
  const SCREENS = {
    loading: { el: () => el.loading, heading: () => null },
    enter:   { el: () => el.enter,   heading: () => $('#enter-title') },
    room:    { el: () => el.room,    heading: () => el.qText },
    closed:  { el: () => el.closed,  heading: () => $('#closed-title') }
  };
  function show(name, opts) {
    const o = opts || {};
    U.runCleanups();
    Object.keys(SCREENS).forEach(k => { const node = SCREENS[k].el(); if (node) node.hidden = (k !== name); });
    state.screen = name;
    document.title = C.APP_NAME || document.title;
    if (!o.keepScroll) scrollTo(0, 0);
    if (!o.noFocus) U.focusHeading(SCREENS[name].heading());
  }

  /* ===== J0: ô mã 4 số, nút thức dậy ===== */
  const cleanCode = raw => String(raw || '').replace(/\D/g, '').slice(0, CODE_LEN);
  function onCodeInput() {
    const v = cleanCode(el.code.value);
    if (el.code.value !== v) el.code.value = v;
    el.code.classList.remove('not-found');
    setEnterError('');
    renderEnter();
  }
  function setEnterError(msg) {
    el.enterError.textContent = msg;
    el.enterError.className = 'lookup-state' + (msg ? ' not-found' : '');
  }
  function renderEnter() {
    const ready = CODE_RE.test(el.code.value) && !state.entering;
    el.enterHint.textContent = ready || (state.entering) ? TEXT.enterReady : TEXT.enterNeed;
    el.enterHint.classList.toggle('done', ready);
    el.btnEnter.classList.toggle('ready', ready);
    el.btnEnter.classList.toggle('sending', state.entering);
    el.btnEnter.disabled = !ready;
    el.btnEnter.textContent = state.entering ? TEXT.entering : TEXT.enterBtn;
    el.code.readOnly = state.entering;
  }

  /* Vào phòng: từ nút (gõ mã) hoặc từ ?room= (fromUrl → màn tải) */
  async function enterRoom(code, fromUrl) {
    if (state.entering) return;
    if (!CODE_RE.test(code)) { show('enter'); setEnterError(TEXT.notFound); el.code.classList.add('not-found'); return; }
    state.entering = true;
    if (fromUrl) show('loading', { noFocus: true }); else renderEnter();
    const r = await A.getRoom(code);
    state.entering = false;
    if (r.result === 'success') { applyRoom(r, true); return; }
    /* Lỗi → về J0, giữ mã trong ô để sửa một số là xong */
    el.code.value = code;
    show('enter', { noFocus: true });
    renderEnter();
    if (r.error === 'room_not_found' || r.error === 'room_invalid') {
      setEnterError(TEXT.notFound);
      el.code.classList.add('not-found');
    } else {
      console.warn('tlad: vào phòng thất bại (' + r.error + ')');
      setEnterError(TEXT.enterNet);
      el.code.classList.add('not-found');
    }
    try { el.code.focus({ preventScroll: true }); } catch (e) { /* bỏ qua */ }
  }

  /* ===== Nhận trạng thái phòng (getRoom / heartbeat) ===== */
  function applyRoom(r, initial) {
    const room = r.room || {};
    if (room.status === 'closed') { showClosed(initial ? 'ended' : 'thanks'); return; }
    state.online = true;
    renderNet();
    /* Phòng mới trùng mã (createdAt khác) → quên các câu đã gửi của phòng cũ */
    if (initial) {
      const saved = S.join.load();
      state.answered = (saved && saved.room === room.code && saved.createdAt === room.createdAt) ? saved.answered : {};
      state.draft = '';
      state.changedWhileTyping = false;
      state.sendError = null;
    }
    state.room = room;
    const q = r.currentQuestion || null;
    const prev = state.question;
    const changed = !prev || !q || prev.index !== q.index;
    state.question = q;
    if (initial) {
      S.join.save({ room: room.code, createdAt: room.createdAt, answered: state.answered });
      const isSent = renderRoom(true);        // đổ chữ trước rồi mới hiện và focus, để trình đọc màn hình đọc đúng
      show('room', { noFocus: true });
      U.focusHeading(isSent ? el.sentTitle : el.qText);
      startPoll();
    } else if (changed) {
      onQuestionChanged();
    } else if (q && prev && prev.text !== q.text) {
      renderQuestion();
    }
  }

  /* Người dẫn chuyển câu (US-3) */
  function onQuestionChanged() {
    state.sendError = null;
    state.dupShown = false;
    if (state.question && !state.answered[state.question.index]) {
      state.changedWhileTyping = state.draft.trim() !== '';
    } else {
      state.changedWhileTyping = false;
    }
    renderRoom(false);
  }

  /* ===== Vòng heartbeat ===== */
  function startPoll() {
    if (poller) poller.destroy();
    poller = U.makePoller({
      ms: C.POLL_JOIN_MS || 3500,
      jitter: C.POLL_JITTER,
      backoffMax: C.POLL_BACKOFF_MAX_MS,
      tick: async () => {
        if (state.screen !== 'room' || !state.room) return true;
        const r = await A.heartbeat(state.room.code, state.device);
        if (state.screen !== 'room') return true;
        if (r.result === 'success') { applyRoom(r, false); return true; }
        if (r.error === 'room_not_found' || r.error === 'room_invalid') { showClosed('ended'); return true; }
        /* lỗi mạng, timeout, server_error… → giữ màn, dòng nhỏ "Đang kết nối lại…" */
        console.warn('tlad: heartbeat thất bại (' + r.error + ')');
        state.online = false;
        renderNet();
        return false;
      }
    });
    U.lifecycle.onCleanup(() => { if (poller) { poller.destroy(); poller = null; } });
    poller.start();
  }
  function renderNet() { el.net.hidden = state.online; }

  /* ===== J1 / J2: vẽ theo state ===== */
  function renderQuestion() {
    const q = state.question, n = state.room ? state.room.questionCount : 0;
    el.qLabel.textContent = q ? TEXT.qLabel(q.index, n) : '';
    el.qText.textContent = q ? q.text : '';
  }
  function renderRoom(initial) {
    renderQuestion();
    const q = state.question;
    const sentText = q ? state.answered[q.index] : undefined;
    const isSent = !!q && sentText !== undefined;
    el.room.classList.toggle('is-sent', isSent);
    el.form.hidden = isSent;
    el.sent.hidden = !isSent;
    if (isSent) {
      renderSent(sentText, state.dupShown, initial);
    } else {
      el.answer.value = state.draft;
      renderForm();
    }
    /* B-02: đang gõ trong ô (focus ở textarea) thì KHÔNG kéo focus đi, kẻo bàn phím ảo đóng; aria-live đã đọc câu mới */
    const typing = !isSent && document.activeElement === el.answer;
    if (!initial && !typing) U.focusHeading(isSent ? el.sentTitle : el.qText);
    return isSent;
  }
  function renderForm() {
    const text = state.draft, len = text.length, hasText = text.trim() !== '';
    const ready = hasText && !state.sending;
    el.qChanged.hidden = !(state.changedWhileTyping && hasText);
    el.sendError.hidden = !state.sendError;
    if (state.sendError) el.sendError.textContent = state.sendError === 'webview' ? TEXT.sendFailWebview : TEXT.sendFail;
    el.sendHint.textContent = hasText ? TEXT.sendReady : TEXT.sendNeed;
    el.sendHint.classList.toggle('done', hasText && !state.sending);
    /* Bộ đếm: ẩn < 200, muted 200–279, cam ấm ở 280 */
    el.count.hidden = len < COUNTER_FROM;
    el.count.textContent = len + '/' + MAX;
    el.count.classList.toggle('near', len >= COUNTER_NEAR);
    el.count.classList.toggle('full', len >= MAX);
    el.btnSend.classList.toggle('ready', ready);
    el.btnSend.classList.toggle('sending', state.sending);
    el.btnSend.disabled = !ready;
    el.btnSend.textContent = state.sending ? TEXT.sending : (state.sendError ? TEXT.retryBtn : TEXT.sendBtn);
    el.answer.readOnly = state.sending;
  }
  function renderSent(text, dup, initial) {
    const still = dup || U.reduceMotion() || initial;   // tick tĩnh khi trùng, F5, hoặc tắt chuyển động
    el.check.classList.toggle('still', still);
    const hasText = typeof text === 'string' && text !== '';
    el.sentText.hidden = !hasText;
    el.sentBody.innerHTML = hasText ? esc(text) : '';
    el.sentNote.textContent = dup ? TEXT.dup : TEXT.wait;
  }

  function onAnswerInput() {
    if (state.sending) return;
    state.draft = el.answer.value;
    if (state.draft.trim() === '') state.changedWhileTyping = false;   // xóa hết thì hộp nhắc tự ẩn
    renderForm();
  }
  function clearDraft() {
    state.draft = '';
    state.changedWhileTyping = false;
    el.answer.value = '';
    renderForm();
    try { el.answer.focus(); } catch (e) { /* bỏ qua */ }
  }

  /* ===== Gửi (tech design 5.3) ===== */
  async function send() {
    if (state.sending || !state.question || !state.room) return;
    const text = state.draft;
    if (text.trim() === '') return;
    const q = state.question.index;
    state.sending = true;            // chống bấm đúp lớp 1
    state.sendError = null;
    renderForm();
    const r = await A.submitAnswer({ room: state.room.code, device: state.device, q, text });
    state.sending = false;
    if (state.screen !== 'room') return;
    if (r.result === 'success' || r.error === 'already_answered') {
      /* B-06: bị từ chối trùng thì chữ vừa gõ KHÔNG phải chữ Sheet đã lưu → chỉ giữ bản đã nhớ (nếu có), không thì '' (ẩn hộp lặp câu) */
      if (r.result === 'success') state.answered[q] = text;
      else if (state.answered[q] === undefined) state.answered[q] = '';
      S.join.save({ room: state.room.code, createdAt: state.room.createdAt, answered: state.answered });
      state.draft = '';
      state.changedWhileTyping = false;
      state.dupShown = r.error === 'already_answered';
      if (r.result === 'success') U.vibrate(20);
      renderRoom(false);
      return;
    }
    if (r.error === 'question_changed') {
      /* Giữ chữ, đổi câu, nhắc; nút mở lại */
      if (r.currentQuestion) state.question = r.currentQuestion;
      if (r.room) state.room = r.room;
      state.changedWhileTyping = true;
      renderRoom(false);
      return;
    }
    if (r.error === 'room_closed') { showClosed('thanks'); return; }
    if (r.error === 'room_not_found') { showClosed('ended'); return; }
    /* network / timeout / busy / room_full / khác → giữ chữ, hộp mềm, nút "Gửi lại", focus về nút */
    console.warn('tlad: gửi thất bại (' + r.error + ')');
    state.sendError = (r.error === 'network' && isInAppBrowser()) ? 'webview' : r.error;
    renderForm();
    try { el.btnSend.focus({ preventScroll: true }); } catch (e) { /* bỏ qua */ }
  }
  /* WebView Zalo/Messenger chặn POST → gợi ý mở bằng trình duyệt (R12) */
  function isInAppBrowser() {
    const ua = navigator.userAgent || '';
    return /Zalo|FBAN|FBAV|FB_IAB|Instagram|Line\//i.test(ua);
  }

  /* ===== J3 ===== */
  function showClosed(kind) {
    if (poller) { poller.destroy(); poller = null; }
    const thanks = kind === 'thanks';
    $('#closed-title').textContent = thanks ? TEXT.thanksTitle : TEXT.endedTitle;
    $('#closed-lead').textContent = thanks ? TEXT.thanksLead : TEXT.endedLead;
    $('#closed-illu').hidden = !thanks;
    show('closed');
  }

  /* ===== Sự kiện: event delegation theo data-act ===== */
  const actions = {
    enter: () => enterRoom(cleanCode(el.code.value), false),
    send,
    'clear-draft': clearDraft,
    forget: () => { S.forgetDevice(); U.toast('Đã xóa dấu vết trên máy này.'); }
  };
  document.addEventListener('click', e => {
    const target = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!target) return;
    const fn = actions[target.getAttribute('data-act')];
    if (fn) { e.preventDefault(); fn(target, e); }
  });

  /* ===== Khởi động ===== */
  function init() {
    el.loading = $('#scr-loading');
    el.enter = $('#scr-enter');
    el.room = $('#scr-room');
    el.closed = $('#scr-closed');
    el.code = $('#room-code');
    el.enterError = $('#enter-error');
    el.enterHint = $('#enter-hint');
    el.btnEnter = $('#btn-enter');
    el.qLabel = $('#q-label');
    el.qText = $('#q-text');
    el.qChanged = $('#q-changed');
    el.form = $('#answer-form');
    el.answer = $('#answer');
    el.count = $('#answer-count');
    el.sendError = $('#send-error');
    el.sendHint = $('#send-hint');
    el.btnSend = $('#btn-send');
    el.sent = $('#sent');
    el.sentTitle = $('#sent-title');
    el.sentText = $('#sent-text');
    el.sentBody = $('#sent-body');
    el.sentNote = $('#sent-note');
    el.check = $('.success-checkmark', el.sent);
    el.net = $('#net-status');

    document.title = C.APP_NAME || document.title;
    el.code.maxLength = CODE_LEN;
    el.answer.maxLength = MAX;
    state.device = S.getDeviceId();

    el.code.addEventListener('input', onCodeInput);
    /* B-03: dán " 12 34" → maxlength cắt trước khi app lọc. Bắt beforeinput/paste, lọc rồi tự chèn (giữ maxlength cho autofill). */
    function insertClean(data) {
      const v = el.code.value, s = el.code.selectionStart, e = el.code.selectionEnd;
      const next = cleanCode(v.slice(0, s === null ? v.length : s) + data + v.slice(e === null ? v.length : e));
      el.code.value = next;
      try { el.code.setSelectionRange(next.length, next.length); } catch (err) { /* bỏ qua */ }
      onCodeInput();
    }
    el.code.addEventListener('beforeinput', e => {
      const data = e.data;
      if (typeof data !== 'string' || !data || e.inputType === 'insertCompositionText') return;
      if (data.length > 1 || /\D/.test(data)) { e.preventDefault(); insertClean(data); }
    });
    el.code.addEventListener('paste', e => {
      const cd = e.clipboardData || window.clipboardData;
      const data = cd ? cd.getData('text') : '';
      if (data) { e.preventDefault(); insertClean(data); }
    });
    el.code.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); actions.enter(); } });
    el.answer.addEventListener('input', onAnswerInput);
    el.answer.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });

    A.ping();
    let param = '';
    try { param = new URLSearchParams(location.search).get('room') || ''; } catch (e) { param = ''; }
    param = cleanCode(param);
    if (param) {
      enterRoom(param, true);
    } else {
      show('enter', { noFocus: true });
      renderEnter();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
