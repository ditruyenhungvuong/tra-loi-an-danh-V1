/* =========================================================
   Trả lời ẩn danh – trang người dẫn (host.html)
   Luồng: ?key= → lưu, xóa khỏi URL ngay (màn này bị chiếu) → H0 nhập khóa (nếu chưa có)
          → H1 tạo phòng → H2 màn chiếu: getState mỗi POLL_HOST_MS, Tiếp › hiện từng card,
          ✕ ẩn card, Câu tiếp/Câu trước, Kết thúc (xác nhận), Dữ liệu phòng (CSV / Xóa 2 lần trong 10 s)
          → H3 Cám ơn cả lớp.
   Reveal (đã hiện / đã ẩn) theo từng câu, lưu localStorage, F5 dựng lại từ getState(since 0).
   Hai tab cùng mở: BroadcastChannel 'tlad-host' claim + overlay.
   Mọi chuỗi người gõ (câu hỏi, câu trả lời) vào HTML qua esc(). Toast thay cho hộp thoại alert của trình duyệt.
   ========================================================= */
(() => {
  'use strict';
  const C = window.APP_CONFIG || {};
  const U = window.APP_UI, S = window.APP_STORE, A = window.APP_API;
  const { $, $$, esc } = U;
  const CONFIRM_MS = 10000;
  const LONG_Q = 120;             // câu > 120 ký tự → .long (chữ nhỏ hơn)
  const LONG_CARD = 140;          // card > 140 ký tự → .long (chiếm cả hàng, chữ 28px) – B-01
  const SUGGESTED = C.QUESTIONS_SUGGESTED || 10;

  /* ===== Chuỗi hiển thị động – UX mục 6 ===== */
  const TEXT = {
    keyBtn: 'Vào ›', keyChecking: 'Đang kiểm tra…',
    keyBad: 'Mình chưa nhận ra bạn là người dẫn. Kiểm tra lại link nhé.',
    keyNet: 'Chưa kiểm tra được. Mạng hơi chậm, thử lại nhé.',
    createNeed: '💡 Nhập ít nhất một câu hỏi nhé.', createReady: '✨ Đủ rồi, bấm tạo phòng nào.',
    createBtn: 'Tạo phòng ›', creating: 'Đang tạo phòng…',
    createNet: 'Chưa tạo được phòng. Mạng hơi chậm, thử lại nhé.',
    createTooMany: n => '💡 Nhiều hơn ' + n + ' câu rồi. Bớt lại còn ' + n + ' câu nhé.',
    createTooLong: (i, n) => '💡 Câu số ' + i + ' dài hơn ' + n + ' ký tự. Rút gọn một chút nhé.',
    countQ: n => n + ' câu hỏi · gợi ý tối đa ' + SUGGESTED,
    countQMany: n => n + ' câu hỏi · hơi nhiều, lớp dễ mỏi',
    keyOther: 'Nhập khóa khác',
    opening: 'Đang mở phòng…',
    participants: n => '👥 ' + n + ' người đang tham gia',
    answers: m => '✉️ ' + m + ' câu trả lời',
    shown: (a, m) => 'đã hiện ' + a + '/' + m,
    hiddenN: h => ' · ' + h + ' đã ẩn',
    hintKeys: 'Space / → = Tiếp',
    hintDone: 'Đã hiện hết. Chờ thêm câu mới hoặc chuyển câu hỏi nhé.',
    hideLabel: 'Ẩn câu trả lời này',
    hidToast: 'Đã ẩn một câu.',
    setQFail: 'Chưa chuyển được câu. Thử lại nhé.',
    closeFail: 'Chưa kết thúc được phòng. Thử lại nhé.',
    deleteFail: 'Chưa xóa được phòng. Thử lại nhé.',
    csvDone: 'Đã tải CSV.', csvFail: 'Chưa tải được CSV. Thử lại nhé.',
    linkCopied: 'Đã chép link.', linkFail: 'Chưa chép được link. Bạn chép tay nhé.',
    deleted: code => 'Đã xóa dữ liệu phòng ' + code + '.',
    roomGone: 'Phòng không còn.',
    noStore: 'Máy này không lưu được số đã hiện; F5 sẽ về 0.',
    confirmCloseTitle: code => 'Kết thúc phòng ' + code + '?',
    confirmCloseText: 'Kết thúc thì mọi người không gửi thêm được. Dữ liệu vẫn còn để tải.',
    confirmCloseYes: 'Tôi hiểu, kết thúc',
    confirmDeleteTitle: code => 'Xóa toàn bộ phòng ' + code + '?',
    confirmDeleteText: m => 'Xóa cả câu hỏi và ' + m + ' câu trả lời trên Sheet. Không lấy lại được. Chưa tải CSV thì tải trước nhé.',
    confirmDeleteYes: s => 'Tôi hiểu, xóa toàn bộ (' + s + ')',
    endedSummary: (m, n) => m + ' câu trả lời cho ' + n + ' câu hỏi.',
    qLabel: (k, n) => 'Câu ' + k + '/' + n
  };

  /* ===== Trạng thái (tech design 3.5) ===== */
  const state = {
    key: '',
    room: null,                 // {code, status, currentIndex, questionCount, createdAt}
    questions: [],
    answers: [],                // [{id, q, text, at}] theo thứ tự nhận
    cursor: 0,
    participants: 0,
    reveal: {},                 // {"<q>": {revealed: Set, hidden: Set}}
    busy: false,
    confirm: null,              // 'close' | 'delete' | null
    online: true,
    loaded: false,              // đã có getState thành công lần đầu
    answersTotal: null,         // tổng từ closeRoom (để màn kết đúng số dù tab chưa kịp poll)
    csvBusy: false,
    screen: '',
    active: true,               // tab này đang điều khiển (BroadcastChannel)
    lastRendered: '',           // khóa render vùng card để không vẽ lại thừa
    latestId: null,             // card vừa hiện gần nhất (viền nhấn)
    animateId: null,            // card cần animation lần render tới
    scrollSmooth: false         // lần render tới cuộn mượt (chỉ sau Tiếp ›)
  };
  const el = {};
  let poller = null, channel = null;
  const TAB_ID = U.newId(8);

  /* ===== Màn hình ===== */
  const SCREENS = {
    key:    { el: () => el.key,    heading: () => $('#key-title') },
    create: { el: () => el.create, heading: () => $('#create-title') },
    stage:  { el: () => el.stage,  heading: () => el.stageQ },
    ended:  { el: () => el.ended,  heading: () => $('#ended-title') }
  };
  function show(name, opts) {
    const o = opts || {};
    U.runCleanups();
    Object.keys(SCREENS).forEach(k => { const node = SCREENS[k].el(); if (node) node.hidden = (k !== name); });
    state.screen = name;
    const onStage = name === 'stage';
    document.body.classList.toggle('on-stage', onStage);
    el.main.classList.toggle('stage-mode', onStage || name === 'ended');
    document.title = (name === 'stage' && state.room ? 'Phòng ' + state.room.code + ' · ' : '') + (C.APP_NAME || '') + ' · Người dẫn';
    closeConfirm();
    if (el.menu) el.menu.open = false;
    scrollTo(0, 0);
    if (!o.noFocus) U.focusHeading(SCREENS[name].heading());
  }

  /* ===== Reveal theo câu ===== */
  function rv(q) {
    const k = String(q);
    if (!state.reveal[k]) state.reveal[k] = { revealed: new Set(), hidden: new Set() };
    return state.reveal[k];
  }
  const ofQ = q => state.answers.filter(a => a.q === q);
  const visible = q => { const h = rv(q).hidden; return ofQ(q).filter(a => !h.has(a.id)); };
  const shown = q => { const r = rv(q).revealed; return visible(q).filter(a => r.has(a.id)); };
  function persist() {
    if (!state.room) return;
    const reveal = {};
    Object.keys(state.reveal).forEach(k => {
      reveal[k] = { revealed: Array.from(state.reveal[k].revealed), hidden: Array.from(state.reveal[k].hidden) };
    });
    S.host.save({ room: state.room.code, createdAt: state.room.createdAt, reveal });
  }
  function loadReveal(saved) {
    state.reveal = {};
    if (!saved || !saved.reveal) return;
    Object.keys(saved.reveal).forEach(k => {
      const v = saved.reveal[k] || {};
      state.reveal[k] = { revealed: new Set(Array.isArray(v.revealed) ? v.revealed : []), hidden: new Set(Array.isArray(v.hidden) ? v.hidden : []) };
    });
  }
  /* Bỏ id không còn trong answers (sau reset) */
  function pruneReveal() {
    const ids = new Set(state.answers.map(a => a.id));
    Object.keys(state.reveal).forEach(k => {
      ['revealed', 'hidden'].forEach(t => { state.reveal[k][t].forEach(id => { if (!ids.has(id)) state.reveal[k][t].delete(id); }); });
    });
  }

  /* ===== H0: khóa ===== */
  function renderKey() {
    const ready = el.hostKey.value.trim() !== '' && !state.busy;
    el.btnKey.classList.toggle('ready', ready);
    el.btnKey.classList.toggle('sending', state.busy);
    el.btnKey.disabled = !ready;
    el.btnKey.textContent = state.busy ? TEXT.keyChecking : TEXT.keyBtn;
    el.hostKey.readOnly = state.busy;
  }
  function setKeyError(msg) { el.keyError.textContent = msg; el.keyError.className = 'lookup-state' + (msg ? ' not-found' : ''); el.hostKey.classList.toggle('not-found', !!msg); }
  /* Thăm dò khóa bằng getState với mã 0000: sai khóa → host_key_*; mã không có → chấp nhận khóa (createRoom sẽ kiểm lần cuối) */
  async function checkKey() {
    const key = el.hostKey.value.trim();
    if (!key || state.busy) return;
    state.busy = true; setKeyError(''); renderKey();
    const r = await A.host.getState(key, '0000', 0);
    state.busy = false; renderKey();
    if (r.error === 'host_key_invalid' || r.error === 'host_key_not_set') { setKeyError(TEXT.keyBad); return; }
    /* Chỉ nhận khóa khi máy chủ đã xác thực xong: success hoặc room_not_found (mã 0000 không có). Mọi mã khác → coi như chưa kiểm được, không lưu. */
    if (r.result !== 'success' && r.error !== 'room_not_found') { setKeyError(TEXT.keyNet); return; }
    state.key = key;
    S.host.setKey(key);
    el.hostKey.value = '';
    route();
  }
  function badKey() {
    /* Khóa bị đổi/sai ở bất kỳ lời gọi nào → về H0 với câu nhắc */
    stopPoll();
    state.key = '';
    S.host.clearKey();
    show('key');
    setKeyError(TEXT.keyBad);
    renderKey();
  }

  /* ===== H1: tạo phòng ===== */
  const questionLines = () => el.questions.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  /* B-08: vượt giới hạn thì báo rõ và khóa nút, không cắt lặng */
  function questionsProblem(lines) {
    const maxN = C.QUESTIONS_MAX || 50, maxLen = C.QUESTION_MAX_LENGTH || 500;
    if (lines.length > maxN) return TEXT.createTooMany(maxN);
    for (let i = 0; i < lines.length; i++) if (lines[i].length > maxLen) return TEXT.createTooLong(i + 1, maxLen);
    return '';
  }
  function renderCreate() {
    const lines = questionLines(), n = lines.length;
    const problem = questionsProblem(lines);
    const ready = n > 0 && !problem && !state.busy;
    el.qCount.textContent = n > SUGGESTED ? TEXT.countQMany(n) : TEXT.countQ(n);
    el.createHint.textContent = problem || (n > 0 ? TEXT.createReady : TEXT.createNeed);
    el.createHint.classList.toggle('done', ready);
    el.btnCreate.classList.toggle('ready', ready);
    el.btnCreate.classList.toggle('sending', state.busy);
    el.btnCreate.disabled = !ready;
    el.btnCreate.textContent = state.busy ? TEXT.creating : TEXT.createBtn;
    el.questions.readOnly = state.busy;
  }
  function setCreateError(html) { el.createError.hidden = !html; el.createError.innerHTML = html || ''; }
  async function createRoom() {
    const lines = questionLines();
    if (!lines.length || state.busy || questionsProblem(lines)) { renderCreate(); return; }
    state.busy = true; setCreateError(''); renderCreate();
    const r = await A.host.createRoom(state.key, lines);
    state.busy = false; renderCreate();
    if (r.result === 'success') {
      resetRoomState();
      state.room = r.room;
      state.questions = r.questions || [];
      state.loaded = true;
      persist();
      el.questions.value = '';
      renderCreate();
      enterStage();
      return;
    }
    if (r.error === 'host_key_invalid' || r.error === 'host_key_not_set') {
      setCreateError(esc(TEXT.keyBad) + ' <button type="button" class="link" data-act="key-other">' + esc(TEXT.keyOther) + '</button>');
      return;
    }
    console.warn('tlad: tạo phòng thất bại (' + r.error + ')');
    setCreateError(esc(TEXT.createNet));
  }
  function resetRoomState() {
    state.room = null; state.questions = []; state.answers = []; state.cursor = 0; state.participants = 0;
    state.reveal = {}; state.loaded = false; state.lastRendered = ''; state.latestId = null; state.animateId = null; state.online = true;
    state.answersTotal = null;
  }

  /* ===== H2: vào màn chiếu, vòng getState ===== */
  function enterStage() {
    show('stage');
    el.stage.classList.toggle('loading', !state.loaded);
    if (!S.available()) U.toast(TEXT.noStore);
    renderStage(true);
    startPoll();
  }
  /* Mở lại phòng đang nhớ (F5): dựng từ getState(since 0) */
  function reopen(saved) {
    resetRoomState();
    state.room = { code: saved.room, createdAt: saved.createdAt, status: 'open', currentIndex: 1, questionCount: 0 };
    loadReveal(saved);
    enterStage();
  }
  function startPoll() {
    stopPoll();
    poller = U.makePoller({
      ms: C.POLL_HOST_MS || 2500,
      jitter: C.POLL_JITTER,
      backoffMax: C.POLL_BACKOFF_MAX_MS,
      tick: async () => {
        if (state.screen !== 'stage' || !state.room || !state.active) return true;
        const r = await A.host.getState(state.key, state.room.code, state.cursor);
        if (state.screen !== 'stage' || !state.room) return true;
        if (r.result === 'success') { mergeState(r); return true; }
        if (r.error === 'host_key_invalid' || r.error === 'host_key_not_set') { badKey(); return true; }
        if (r.error === 'room_not_found' || r.error === 'room_invalid') {
          stopPoll(); S.host.clear(); resetRoomState(); show('create'); renderCreate(); U.toast(TEXT.roomGone); return true;
        }
        console.warn('tlad: getState thất bại (' + r.error + ')');
        state.online = false;
        renderBar();
        return false;
      }
    });
    poller.start();
  }
  function stopPoll() { if (poller) { poller.destroy(); poller = null; } }

  function mergeState(r) {
    const firstLoad = !state.loaded;
    state.online = true;
    state.room = r.room || state.room;
    state.questions = r.questions || state.questions;
    const incoming = Array.isArray(r.answersNew) ? r.answersNew : [];
    if (r.reset) {
      state.answers = incoming.slice();
    } else {
      const have = new Set(state.answers.map(a => a.id));
      incoming.forEach(a => { if (a && a.id && !have.has(a.id)) { state.answers.push(a); have.add(a.id); } });
    }
    if (typeof r.cursor === 'number') state.cursor = r.cursor;
    if (r.counts) state.participants = r.counts.participants || 0;
    if (firstLoad || r.reset) pruneReveal();
    state.loaded = true;
    if (state.room.status === 'closed') { showEnded(); return; }
    /* createdAt khác bản nhớ → phòng mới trùng mã, reveal cũ vô nghĩa */
    const saved = S.host.load();
    if (saved && saved.room === state.room.code && saved.createdAt && state.room.createdAt && saved.createdAt !== state.room.createdAt) {
      state.reveal = {};
    }
    persist();
    el.stage.classList.remove('loading');
    renderStage(firstLoad);
  }

  /* ===== Vẽ màn chiếu ===== */
  let qrCode = '';
  function renderStage(full) {
    if (!state.room) return;
    const q = state.room.currentIndex || 1, n = state.room.questionCount || state.questions.length;
    const qObj = state.questions.filter(x => x.index === q)[0];
    const text = qObj ? qObj.text : '';
    el.stageLabel.textContent = state.loaded ? TEXT.qLabel(q, n) : '';
    if (el.stageQ.textContent !== text) el.stageQ.textContent = text;
    el.stageQ.classList.toggle('long', text.length > LONG_Q);
    if (full || qrCode !== state.room.code) renderQR();
    renderCards();
    renderBar();
  }
  function joinUrl() { return (C.BASE_URL || '') + '?room=' + (state.room ? state.room.code : ''); }
  function renderQR() {
    const code = state.room.code;
    qrCode = code;
    el.roomCode.textContent = code;
    el.joinUrl.textContent = C.SHORT_URL_LABEL || (C.BASE_URL || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    try {
      if (typeof window.qrcode !== 'function') throw new Error('thiếu thư viện QR');
      const qr = window.qrcode(0, 'M');
      qr.addData(joinUrl());
      qr.make();
      /* Quiet zone ≥ 4 ô, đen/trắng thuần để camera cũ quét được (R15) */
      el.qr.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true, alt: 'QR vào phòng ' + code });
      el.qr.classList.remove('fallback');
    } catch (e) {
      console.warn('tlad: không vẽ được QR, chỉ hiện mã và link', e);
      el.qr.innerHTML = '';
      el.qr.classList.add('fallback');
    }
  }
  function renderCards() {
    const q = state.room.currentIndex || 1;
    const list = shown(q);
    const key = q + '|' + list.map(a => a.id).join(',') + '|' + state.latestId;
    el.empty.hidden = list.length > 0;
    if (key === state.lastRendered) return;
    state.lastRendered = key;
    const animate = state.animateId && !U.reduceMotion();
    el.cards.innerHTML = list.map(a => {
      const latest = a.id === state.latestId;
      /* B-01: câu dài (> LONG_CARD ký tự) chiếm cả hàng và chữ nhỏ một nấc (vẫn ≥ 28px) để nằm trọn vùng 720p */
      const cls = 'card-answer' + (latest ? ' is-latest new' : '') + (latest && animate && a.id === state.animateId ? ' enter' : '') + (String(a.text).length > LONG_CARD ? ' long' : '');
      return '<li class="' + cls + '" role="listitem" data-id="' + esc(a.id) + '">' +
        '<p class="card-text">' + esc(a.text) + '</p>' +
        '<button type="button" class="card-hide" data-act="hide" data-id="' + esc(a.id) + '" aria-label="' + esc(TEXT.hideLabel) + '" title="' + esc(TEXT.hideLabel) + '">✕</button>' +
        '</li>';
    }).join('');
    state.animateId = null;
    if (state.latestId) {
      const node = el.cards.querySelector('[data-id="' + cssEscape(state.latestId) + '"]');
      /* B-01: card cao hơn vùng cuộn thì căn mép TRÊN để lớp luôn thấy dòng đầu; card thường thì 'nearest' */
      const area = el.cards.parentNode;
      const tall = area && node && node.offsetHeight > area.clientHeight;
      /* Cuộn mượt chỉ khi hiện thêm MỘT card (Tiếp ›); Hiện tất cả / đổi câu / F5 nhảy xa thì cuộn tức thì */
      const behavior = (state.scrollSmooth && !U.reduceMotion()) ? 'smooth' : 'auto';
      state.scrollSmooth = false;
      if (node && node.scrollIntoView) { try { node.scrollIntoView({ block: tall ? 'start' : 'nearest', behavior }); } catch (e) { node.scrollIntoView(tall); } }
    }
  }
  function cssEscape(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }
  /* B-05: báo chiều cao thật của thanh điều khiển cho CSS để toast nằm phía trên, không đè nút */
  function syncBarHeight() {
    const bar = el.stage.querySelector('.control-bar');
    if (bar && !el.stage.hidden) document.documentElement.style.setProperty('--bar-actual', bar.offsetHeight + 'px');
  }
  function renderBar() {
    syncBarHeight();
    const loaded = state.loaded && state.room;
    if (!loaded) {
      el.cParticipants.textContent = TEXT.opening;
      el.cAnswers.textContent = ''; el.cShown.textContent = ''; el.cHidden.hidden = true;
      el.net.hidden = state.online;
      el.hint.textContent = '';
      [el.btnNext, el.btnShowAll, el.btnHideAll, el.btnPrevQ, el.btnNextQ, el.btnClose].forEach(b => { b.disabled = true; });
      return;
    }
    const q = state.room.currentIndex || 1, n = state.room.questionCount || state.questions.length;
    const all = ofQ(q), vis = visible(q), sh = shown(q), h = all.length - vis.length;
    const a = sh.length, m = vis.length;
    el.cParticipants.textContent = TEXT.participants(state.participants);
    el.cAnswers.textContent = TEXT.answers(all.length);
    el.cShown.textContent = TEXT.shown(a, m);
    el.cHidden.hidden = h === 0;
    el.cHidden.textContent = h > 0 ? TEXT.hiddenN(h) : '';
    el.net.hidden = state.online;
    const canNext = a < m;
    el.btnNext.disabled = !canNext;
    el.btnShowAll.disabled = !canNext;
    el.btnHideAll.disabled = a === 0;
    el.hint.textContent = (m > 0 && !canNext) ? TEXT.hintDone : TEXT.hintKeys;
    el.btnPrevQ.disabled = q <= 1 || state.busy;
    el.btnNextQ.disabled = q >= n || state.busy;
    el.btnClose.disabled = state.busy;
    el.btnClose.classList.toggle('bar-solid', q >= n);
    el.btnClose.classList.toggle('bar-ghost', q < n);
  }

  /* ===== Tiếp › / Hiện tất cả / Ẩn / ✕ (không gọi máy chủ) ===== */
  function next() {
    if (!state.loaded || state.screen !== 'stage' || !state.active) return;
    const q = state.room.currentIndex || 1, r = rv(q);
    const nxt = visible(q).filter(a => !r.revealed.has(a.id))[0];
    if (!nxt) { renderBar(); return; }
    r.revealed.add(nxt.id);
    state.latestId = nxt.id;
    state.animateId = nxt.id;
    state.scrollSmooth = true;
    persist();
    renderCards(); renderBar();
  }
  function showAll() {
    if (!state.loaded) return;
    const q = state.room.currentIndex || 1, r = rv(q), vis = visible(q);
    vis.forEach(a => r.revealed.add(a.id));
    state.latestId = vis.length ? vis[vis.length - 1].id : null;
    state.animateId = null;
    persist(); renderCards(); renderBar();
  }
  function hideAll() {
    if (!state.loaded) return;
    const q = state.room.currentIndex || 1;
    rv(q).revealed.clear();       // hidden giữ nguyên; Sheet không đổi
    state.latestId = null;
    persist(); renderCards(); renderBar();
  }
  function hideOne(btn) {
    if (!state.loaded) return;
    const id = btn.getAttribute('data-id');
    const q = state.room.currentIndex || 1, r = rv(q);
    /* Tìm card kế để chuyển focus trước khi vẽ lại */
    const li = btn.closest('li');
    const sibling = li && (li.nextElementSibling || li.previousElementSibling);
    const nextFocusId = sibling ? sibling.getAttribute('data-id') : null;
    r.hidden.add(id);
    r.revealed.delete(id);
    if (state.latestId === id) { const sh = shown(q); state.latestId = sh.length ? sh[sh.length - 1].id : null; }
    persist(); renderCards(); renderBar();
    U.toast(TEXT.hidToast, 2000);
    const target = nextFocusId ? el.cards.querySelector('[data-id="' + cssEscape(nextFocusId) + '"] .card-hide') : null;
    try { (target || el.btnNext).focus({ preventScroll: true }); } catch (e) { /* bỏ qua */ }
  }

  /* ===== Chuyển câu, kết thúc, xóa (có gọi máy chủ, có khóa) ===== */
  function setBusy(btn, on) {
    state.busy = on;
    if (btn) {
      if (on) { btn.dataset.label = btn.textContent; btn.textContent = '…'; }
      else if (btn.dataset.label) { btn.textContent = btn.dataset.label; delete btn.dataset.label; }
    }
    renderBar();
    /* Không có đồng hồ phụ: APP_API luôn resolve (timeout 8 s) nên setBusy(false) chắc chắn được gọi sau request */
  }
  async function setQuestion(delta, btn) {
    if (!state.loaded || state.busy) return;
    const q = state.room.currentIndex || 1, n = state.room.questionCount || state.questions.length;
    const idx = q + delta;
    if (idx < 1 || idx > n) return;
    setBusy(btn, true);
    const r = await A.host.setQuestion(state.key, state.room.code, idx);
    setBusy(btn, false);
    if (state.screen !== 'stage') return;
    if (r.result === 'success') {
      state.room = r.room || Object.assign({}, state.room, { currentIndex: idx });
      const sh = shown(idx);
      state.latestId = sh.length ? sh[sh.length - 1].id : null;   // câu trước: viền nhấn ở card cuối đã hiện
      state.animateId = null;
      renderStage(false);
      U.focusHeading(el.stageQ);
      return;
    }
    if (r.error === 'host_key_invalid' || r.error === 'host_key_not_set') { badKey(); return; }
    if (r.error === 'room_closed') { showEnded(); return; }
    console.warn('tlad: setQuestion thất bại (' + r.error + ')');
    U.toast(TEXT.setQFail);
  }
  async function closeRoom() {
    if (!state.loaded || state.busy) return;
    setBusy(el.btnClose, true);
    const r = await A.host.closeRoom(state.key, state.room.code);
    setBusy(el.btnClose, false);
    if (r.result === 'success') {
      state.room = r.room || Object.assign({}, state.room, { status: 'closed' });
      if (r.counts && typeof r.counts.answersTotal === 'number') state.answersTotal = r.counts.answersTotal;
      showEnded();
      return;
    }
    if (r.error === 'host_key_invalid' || r.error === 'host_key_not_set') { badKey(); return; }
    console.warn('tlad: closeRoom thất bại (' + r.error + ')');
    U.toast(TEXT.closeFail);
  }
  async function deleteRoom() {
    if (!state.room || state.busy) return;
    const code = state.room.code;
    const btn = el.btnConfirmYes;
    state.busy = true; btn.disabled = true; btn.textContent = 'Đang xóa…';
    const r = await A.host.deleteRoom(state.key, code);
    state.busy = false; btn.disabled = false;
    if (r.result === 'success') {
      stopPoll();
      S.host.clear();
      resetRoomState();
      show('create'); renderCreate();
      U.toast(TEXT.deleted(code));
      return;
    }
    closeConfirm();
    if (r.error === 'host_key_invalid' || r.error === 'host_key_not_set') { badKey(); return; }
    console.warn('tlad: deleteRoom thất bại (' + r.error + ')');
    U.toast(TEXT.deleteFail);
  }
  function showEnded() {
    stopPoll();
    const m = typeof state.answersTotal === 'number' ? Math.max(state.answersTotal, state.answers.length) : state.answers.length;
    const n = state.room ? (state.room.questionCount || state.questions.length) : state.questions.length;
    $('#ended-summary').textContent = TEXT.endedSummary(m, n);
    show('ended');
  }
  function newRoom() {
    S.host.clear();
    resetRoomState();
    show('create'); renderCreate();
  }

  /* ===== Hộp xác nhận ===== */
  let confirmTimer = 0, confirmTick = 0, confirmEndsAt = 0;
  function openConfirm(kind) {
    if (!state.room) return;
    state.confirm = kind;
    if (el.menu) el.menu.open = false;
    const code = state.room.code;
    const isDelete = kind === 'delete';
    el.confirmBox.classList.toggle('danger', isDelete);
    el.confirmBody.className = isDelete ? 'urgent-box' : '';
    el.confirmTitle.textContent = isDelete ? TEXT.confirmDeleteTitle(code) : TEXT.confirmCloseTitle(code);
    el.confirmText.textContent = isDelete ? TEXT.confirmDeleteText(state.answers.length) : TEXT.confirmCloseText;
    el.btnConfirmYes.className = 'btn ' + (isDelete ? 'danger' : 'primary');
    el.btnConfirmYes.disabled = false;
    el.confirm.hidden = false;
    confirmEndsAt = Date.now() + CONFIRM_MS;
    const tick = () => {
      const s = Math.max(0, Math.ceil((confirmEndsAt - Date.now()) / 1000));
      el.btnConfirmYes.textContent = isDelete ? TEXT.confirmDeleteYes(s) : TEXT.confirmCloseYes;
    };
    tick();
    clearInterval(confirmTick); confirmTick = setInterval(tick, 250);
    clearTimeout(confirmTimer); confirmTimer = setTimeout(() => { if (!state.busy) closeConfirm(); }, CONFIRM_MS);
    try { el.btnConfirmNo.focus(); } catch (e) { /* bỏ qua */ }
  }
  function closeConfirm() {
    clearTimeout(confirmTimer); clearInterval(confirmTick);
    if (!el.confirm || el.confirm.hidden) { state.confirm = null; return; }
    el.confirm.hidden = true;
    const kind = state.confirm;
    state.confirm = null;
    const back = kind === 'delete' ? (state.screen === 'ended' ? $('#btn-delete-end') : el.menu && el.menu.querySelector('summary')) : el.btnClose;
    try { if (back) back.focus({ preventScroll: true }); } catch (e) { /* bỏ qua */ }
  }
  function confirmYes() {
    if (state.confirm === 'close') { closeConfirm(); closeRoom(); }
    else if (state.confirm === 'delete') { clearTimeout(confirmTimer); clearInterval(confirmTick); deleteRoom(); }   // B-07: dừng cả đếm ngược để "Đang xóa…" không bị ghi đè
  }

  /* ===== CSV (tech design 4.10) ===== */
  async function downloadCsv(btn) {
    if (!state.room || state.csvBusy) return;
    state.csvBusy = true;
    const label = btn ? btn.textContent : '';
    if (btn) { btn.textContent = 'Đang tải…'; btn.disabled = true; }
    const r = await A.host.getState(state.key, state.room.code, 0);
    state.csvBusy = false;
    if (btn) { btn.textContent = label; btn.disabled = false; }
    if (r.result !== 'success') {
      if (r.error === 'host_key_invalid' || r.error === 'host_key_not_set') { badKey(); return; }
      console.warn('tlad: tải CSV thất bại (' + r.error + ')');
      U.toast(TEXT.csvFail);
      return;
    }
    state.answers = Array.isArray(r.answersNew) ? r.answersNew.slice() : state.answers;
    if (typeof r.cursor === 'number') state.cursor = r.cursor;
    if (r.questions) state.questions = r.questions;
    pruneReveal();
    const csv = buildCsv();
    const name = 'tra-loi-an-danh-' + state.room.code + '-' + U.formatStamp() + '.csv';
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
      U.toast(TEXT.csvDone);
    } catch (e) {
      console.warn('tlad: không tạo được file CSV', e);
      U.toast(TEXT.csvFail);
    }
    if (el.menu) el.menu.open = false;
    if (state.screen === 'stage') renderStage(false);
  }
  function buildCsv() {
    const qText = {};
    state.questions.forEach(q => { qText[q.index] = q.text; });
    const rows = [['Thời gian', 'Mã phòng', 'Số câu', 'Câu hỏi', 'Nội dung']];
    state.answers.forEach(a => rows.push([a.at, state.room.code, String(a.q), qText[a.q] || '', a.text]));
    /* Ô bắt đầu = + - @ thêm ' để Excel không chạy công thức; mọi ô bọc "…", nhân đôi " */
    const cell = v => {
      let s = String(v === null || v === undefined ? '' : v);
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    return '\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  async function copyLink() {
    const url = joinUrl();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(url); U.toast(TEXT.linkCopied); }
      else throw new Error('no clipboard');
    } catch (e) { U.toast(TEXT.linkFail + ' ' + url, 6000); }
    if (el.menu) el.menu.open = false;
  }

  /* ===== Hai tab host (tech design 5.6) ===== */
  function setupChannel() {
    if (typeof BroadcastChannel !== 'function') return;
    try {
      channel = new BroadcastChannel('tlad-host');
      channel.onmessage = e => {
        const m = e.data || {};
        if (m.type === 'claim' && m.id !== TAB_ID) { state.active = false; el.overlay.hidden = false; renderBar(); U.focusHeading($('#overlay-title')); }
      };
      channel.postMessage({ type: 'claim', id: TAB_ID });
    } catch (e) { channel = null; }
    /* Tab kia đổi reveal → đọc lại khi tab này không điều khiển */
    window.addEventListener('storage', e => {
      if (e.key !== S.KEYS.host || state.active || !state.room) return;
      const saved = S.host.load();
      if (saved && saved.room === state.room.code) { loadReveal(saved); state.lastRendered = ''; if (state.screen === 'stage') renderStage(false); }
    });
  }
  function claim() {
    state.active = true;
    el.overlay.hidden = true;
    if (channel) { try { channel.postMessage({ type: 'claim', id: TAB_ID }); } catch (e) { /* bỏ qua */ } }
    const saved = S.host.load();
    if (saved && state.room && saved.room === state.room.code) loadReveal(saved);
    state.lastRendered = '';
    if (state.screen === 'stage') { renderStage(false); if (poller) poller.kick(); else startPoll(); }
    U.focusHeading(el.stageQ);
  }

  /* ===== Phím tắt ===== */
  function onKeydown(e) {
    const tag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
    if (e.key === 'Escape') {
      if (!el.confirm.hidden) { e.preventDefault(); closeConfirm(); return; }
      if (el.menu && el.menu.open) { e.preventDefault(); el.menu.open = false; return; }
      return;
    }
    if (!el.confirm.hidden) {
      /* Bẫy focus trong hộp xác nhận: Tab xoay giữa hai nút */
      if (e.key === 'Tab') {
        const f = [el.btnConfirmNo, el.btnConfirmYes].filter(b => !b.disabled);
        const i = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
      return;
    }
    if (state.screen !== 'stage' || !el.overlay.hidden) return;
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const code = e.code || e.key;
    const keys = C.KEYS_NEXT || ['Space', 'ArrowRight', 'PageDown'];
    const isNext = keys.indexOf(code) >= 0 || (code === ' ' && keys.indexOf('Space') >= 0);
    if (!isNext) return;
    /* Space trên nút đang focus = bấm nút đó (hành vi chuẩn), không chồng thêm "Tiếp" */
    if (code === 'Space' && (tag === 'button' || tag === 'summary' || tag === 'a')) return;
    e.preventDefault();
    next();
  }

  /* ===== Điều hướng lúc tải ===== */
  function route() {
    if (!state.key) { show('key'); renderKey(); return; }
    const saved = S.host.load();
    if (saved && saved.room) { reopen(saved); return; }
    show('create'); renderCreate();
  }

  /* ===== Sự kiện: event delegation theo data-act ===== */
  const actions = {
    key: checkKey,
    'toggle-key': () => { el.hostKey.type = el.keyShow.checked ? 'text' : 'password'; },
    'key-other': () => { stopPoll(); state.key = ''; S.host.clearKey(); show('key'); setKeyError(''); renderKey(); },
    create: createRoom,
    next, 'show-all': showAll, 'hide-all': hideAll, hide: hideOne,
    'prev-q': btn => setQuestion(-1, btn),
    'next-q': btn => setQuestion(1, btn),
    close: () => openConfirm('close'),
    delete: () => openConfirm('delete'),
    'confirm-yes': confirmYes,
    'confirm-no': closeConfirm,
    csv: btn => downloadCsv(btn),
    'copy-link': copyLink,
    new: newRoom,
    claim
  };
  document.addEventListener('click', e => {
    const target = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!target) return;
    const act = target.getAttribute('data-act');
    const fn = actions[act];
    if (!fn) return;
    if (act !== 'toggle-key') e.preventDefault();   // checkbox cần hành vi mặc định
    fn(target, e);
  });
  /* Bấm ra ngoài hộp xác nhận → đóng */
  document.addEventListener('click', e => { if (e.target === el.confirm) closeConfirm(); });

  /* ===== Khởi động ===== */
  function init() {
    el.main = $('#main');
    el.key = $('#scr-key'); el.create = $('#scr-create'); el.stage = $('#scr-stage'); el.ended = $('#scr-ended');
    el.hostKey = $('#host-key'); el.keyShow = $('#key-show'); el.keyError = $('#key-error'); el.btnKey = $('#btn-key');
    el.questions = $('#questions'); el.qCount = $('#questions-count'); el.createError = $('#create-error'); el.createHint = $('#create-hint'); el.btnCreate = $('#btn-create');
    el.stageLabel = $('#stage-q-label'); el.stageQ = $('#stage-q-text');
    el.qr = $('#qr'); el.roomCode = $('#room-code-big'); el.joinUrl = $('#join-url');
    el.cards = $('#cards'); el.empty = $('#cards-empty');
    el.cParticipants = $('#count-participants'); el.cAnswers = $('#count-answers'); el.cShown = $('#count-shown'); el.cHidden = $('#count-hidden');
    el.net = $('#net-status'); el.hint = $('#next-hint');
    el.btnNext = $('#btn-next'); el.btnShowAll = $('#btn-show-all'); el.btnHideAll = $('#btn-hide-all');
    el.btnPrevQ = $('#btn-prev-q'); el.btnNextQ = $('#btn-next-q'); el.btnClose = $('#btn-close');
    el.menu = $('#data-menu');
    el.confirm = $('#confirm'); el.confirmBox = $('#confirm-box'); el.confirmBody = $('#confirm-body');
    el.confirmTitle = $('#confirm-title'); el.confirmText = $('#confirm-text');
    el.btnConfirmYes = $('#btn-confirm-yes'); el.btnConfirmNo = $('#btn-confirm-no');
    el.overlay = $('#tab-overlay');

    /* Khóa trong URL → lưu rồi xóa khỏi thanh địa chỉ NGAY (màn này bị chiếu, R9) */
    let urlKey = '';
    try { urlKey = new URLSearchParams(location.search).get('key') || ''; } catch (e) { urlKey = ''; }
    if (urlKey) {
      S.host.setKey(urlKey.trim());
      try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* bỏ qua */ }
    }
    state.key = S.host.getKey();

    el.hostKey.addEventListener('input', renderKey);
    el.hostKey.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); checkKey(); } });
    el.questions.addEventListener('input', renderCreate);
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', syncBarHeight);
    /* Đóng menu khi bấm ra ngoài */
    document.addEventListener('click', e => { if (el.menu && el.menu.open && !el.menu.contains(e.target)) el.menu.open = false; });

    setupChannel();
    A.ping();
    route();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
