/* =========================================================
   E2E – Trả lời ẩn danh (QA). Chrome headless thật qua DevTools Protocol, hai vai trên nhiều tab:
   - tab host (1280×720, context riêng) + các tab join (375×667, mỗi tab một browser context riêng
     = một "điện thoại" khác với localStorage riêng, deviceId riêng).
   - mock API chạy NGAY TRONG PROCESS (require('../tools/mock-api.js').startServer) ở cổng 8790
     → test đọc thẳng "Sheet" trong bộ nhớ (mock.sheet.answers 5 cột) để kiểm dữ liệu.
   - server tĩnh riêng cổng 8767, ép MOCK: true + MOCK_URL lúc trả js/config.js (file trên đĩa giữ nguyên).
   - Google Fonts bị chặn qua Fetch domain → không phụ thuộc mạng ngoài. Thời gian poll dùng đúng
     config thật (2,5 s / 3,5 s) để các mốc "≤ 3 s / ≤ 5 s / ≤ 8 s" của PRD được đo thật.
   - Presence TTL của mock đặt 10 s (thay 60 s) chỉ để kiểm cơ chế giảm số người trong thời gian test.
   Mỗi dòng Given/When/Then ở PRD mục 6 ánh xạ ≥ 1 test, tên test bắt đầu bằng "US-x".

   Chạy:  node tests/e2e.js [--out=<thư mục kết quả>] [--only=<kịch bản,kịch bản>]
   Kịch bản: main | enter | offline | xss | twotabs | reduced | layout
   Kết quả, screenshot, console log → %TEMP%\tra-loi-an-danh-qa\ (không ghi vào thư mục app / Google Drive).
   Kết thúc: tắt server, tắt đúng Chrome của test theo PID.
   Biến môi trường tùy chọn: QR_PYTHON=<python có cv2> để giải mã QR độc lập (không có → NOTE bỏ qua).
   ========================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { launch, sleep } = require('./lib/cdp');
const { startStatic } = require('./lib/static-server');
const { startServer } = require('../tools/mock-api.js');

const APP = path.resolve(__dirname, '..');
const argv = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2] || true] : [a, true]; }));
const OUT = path.resolve(argv.out || path.join(os.tmpdir(), 'tra-loi-an-danh-qa'));
fs.mkdirSync(OUT, { recursive: true });
const ONLY = argv.only ? String(argv.only).split(',') : null;

const STATIC_PORT = 8767;
const MOCK_PORT = 8790;
const PRESENCE_TTL_TEST = 10;
const HOST_KEY = 'qa-host-key-2026-abcdef';          // 24 ký tự, hợp lệ 16–64
const BASE = 'http://127.0.0.1:' + STATIC_PORT + '/';
const MOCK_URL = 'http://127.0.0.1:' + MOCK_PORT;
const JOIN_URL = code => BASE + 'index.html?room=' + code;
const HOST_URL = BASE + 'host.html';

/* Microcopy nguyên văn PRD Phụ lục A / UX mục 6 */
const TXT = {
  notFound: 'Mình không tìm thấy phòng này. Bạn kiểm tra lại mã trên màn chiếu nhé.',
  endedTitle: 'Phòng này đã kết thúc', endedLead: 'Cám ơn bạn đã tham gia.',
  thanksTitle: 'Cám ơn bạn', thanksLead: 'Buổi hôm nay đã xong. Cám ơn bạn đã góp một câu.',
  sendNeed: '💡 Gõ một câu rồi gửi nhé.', sendReady: '✨ Đọc lại một lần rồi gửi nhé.',
  transparency: 'Câu trả lời của bạn hiện lên màn chiếu, không kèm tên. Không ai biết ai gửi. Gửi rồi thì không sửa được, bạn đọc lại một lần nhé.',
  nameNote: 'Đừng ghi tên người thật nhé.',
  wait: 'Chờ câu tiếp theo nhé.', dup: 'Bạn đã gửi câu này rồi. Chờ câu tiếp theo nhé.',
  changed: 'Người dẫn vừa chuyển câu. Câu bạn đang gõ sẽ gửi cho câu mới này. Bạn xem lại hoặc xóa nhé.',
  sendFail: 'Chưa gửi được. Mạng hơi chậm, bạn thử lại nhé.', reconnect: 'Đang kết nối lại…',
  createNeed: '💡 Nhập ít nhất một câu hỏi nhé.', keyBad: 'Mình chưa nhận ra bạn là người dẫn. Kiểm tra lại link nhé.',
  empty: 'Chưa có câu trả lời nào. Mời mọi người quét QR nhé.',
  hintDone: 'Đã hiện hết. Chờ thêm câu mới hoặc chuyển câu hỏi nhé.', hintKeys: 'Space / → = Tiếp',
  confirmClose: 'Kết thúc thì mọi người không gửi thêm được. Dữ liệu vẫn còn để tải.', confirmCloseYes: 'Tôi hiểu, kết thúc',
  endedHost: 'Cám ơn cả lớp', csvDone: 'Đã tải CSV.', hidToast: 'Đã ẩn một câu.',
  deleted: code => 'Đã xóa dữ liệu phòng ' + code + '.'
};
const Q3 = ['Hãy nhìn quanh bạn và tìm 5 màu sắc đang có ở đây.', 'Điều gì làm bạn mỉm cười sáng nay?', 'Một việc nhỏ bạn muốn làm cho đồng nghiệp tuần này?'];
const LONG_280 = (() => { let s = 'Dòng một của câu trả lời dài, có xuống dòng và chữ tiếng Việt đầy đủ dấu.\nDòng hai nói thêm về màu áo blouse của chị ngồi cạnh, màu bảng, màu trần nhà và màu nền chiếu.\nDòng ba kết lại: '; while (s.length < 280) s += 'ổn-'; return s.slice(0, 280); })();

/* ===== Ghi kết quả ===== */
const results = [];
let scenarioName = '';
let fails = 0, warns = 0;
function T(name, ok, detail) {
  if (!ok) fails++;
  const line = (ok ? 'PASS ' : 'FAIL ') + '[' + scenarioName + '] ' + name + (detail !== undefined ? '  → ' + String(detail).replace(/\s+/g, ' ').slice(0, 240) : '');
  results.push(line); console.log(line);
}
function W(name, ok, detail) {
  if (!ok) warns++;
  const line = (ok ? 'PASS ' : 'WARN ') + '[' + scenarioName + '] ' + name + (detail !== undefined ? '  → ' + String(detail).replace(/\s+/g, ' ').slice(0, 240) : '');
  results.push(line); console.log(line);
}
function note(text) { results.push('NOTE [' + scenarioName + '] ' + text); console.log('NOTE ' + text); }

/* ===== Script cài vào trang TRƯỚC khi app chạy: bắt console, alert, CSV, trạng thái nút lúc bấm gửi ===== */
const HOOK = `(() => {
  window.__qa = { warns: [], errors: [], alerts: 0, vibrates: 0, csv: null, csvBom: false, csvName: '', sendClick: null, fetches: [], clickAt: 0, sentAt: 0 };
  const of = window.fetch.bind(window);
  window.fetch = (url, init) => { const rec = { url: String(url).slice(0, 80), method: init && init.method || 'GET', body: init && init.body ? String(init.body).slice(0, 60) : '', t0: performance.now(), t1: 0 }; __qa.fetches.push(rec); return of(url, init).then(r => { rec.t1 = performance.now(); return r; }, e => { rec.t1 = performance.now(); rec.err = String(e); throw e; }); };
  document.addEventListener('DOMContentLoaded', () => { const el = document.getElementById('sent'); if (el) new MutationObserver(() => { if (!el.hidden && !__qa.sentAt) __qa.sentAt = performance.now(); }).observe(el, { attributes: true, attributeFilter: ['hidden'] }); });
  const ow = console.warn.bind(console), oe = console.error.bind(console);
  console.warn = (...a) => { __qa.warns.push(a.map(String).join(' ')); ow(...a); };
  console.error = (...a) => { __qa.errors.push(a.map(String).join(' ')); oe(...a); };
  window.addEventListener('error', e => __qa.errors.push('window.onerror: ' + e.message));
  window.addEventListener('unhandledrejection', e => __qa.errors.push('unhandledrejection: ' + (e.reason && e.reason.message || e.reason)));
  window.alert = () => { __qa.alerts++; }; window.confirm = () => { __qa.alerts++; return true; }; window.prompt = () => { __qa.alerts++; return ''; };
  try { Object.defineProperty(navigator, 'vibrate', { value: () => { __qa.vibrates++; return true; }, configurable: true }); } catch (e) {}
  const oc = URL.createObjectURL.bind(URL);
  URL.createObjectURL = blob => { try { blob.arrayBuffer().then(buf => { const u = new Uint8Array(buf); __qa.csvBom = u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF; __qa.csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(buf); }); } catch (e) {} return 'blob:qa-fake'; };
  const ocl = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) { __qa.csvName = this.download; return; } return ocl.call(this); };
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#btn-send');
    if (b) { __qa.clickAt = performance.now(); } if (b) setTimeout(() => { __qa.sendClick = { disabled: b.disabled, label: b.textContent, sending: b.classList.contains('sending'), readonly: document.getElementById('answer').readOnly }; }, 0);
  }, true);
})();`;

/* ===== Mock + static (dùng chung cả phiên) ===== */
let mockSrv = null, staticSrv = null, browser = null;
const sheet = () => mockSrv.mock.sheet;
const answersOf = code => sheet().answers.filter(r => r[1] === code);
const roomRow = code => sheet().rooms.filter(r => r[0] === code).slice(-1)[0] || null;
async function api(body) { return (await fetch(MOCK_URL + '/', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })).json(); }
const postAnswer = (room, device, q, text) => api({ action: 'submitAnswer', room, device, q, text });
async function apiCreateRoom(questions) { const r = await api({ action: 'createRoom', key: HOST_KEY, questions }); if (r.result !== 'success') throw new Error('createRoom: ' + r.error); return r.room.code; }

/* ===== Mở tab ===== */
const pagesOpen = [];
async function openPage(kind, opts) {
  const o = opts || {};
  const isHost = kind === 'host';
  const page = await browser.newPage({ isolated: !o.contextId, contextId: o.contextId, width: o.width || (isHost ? 1280 : 375), height: o.height || (isHost ? 720 : 667), mobile: !isHost, scale: 1 });
  page.kind = kind;
  page.consoleErrors = []; page.netErrors = []; page.consoleAll = [];
  page.on('Runtime.consoleAPICalled', p => { const s = p.type + ': ' + p.args.map(a => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '); page.consoleAll.push(s); if (p.type === 'error') page.consoleErrors.push(s); });
  page.on('Runtime.exceptionThrown', p => page.consoleErrors.push('exception: ' + (p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text)));
  page.on('Log.entryAdded', p => { const s = p.entry.level + ': ' + p.entry.text + (p.entry.url ? ' @' + p.entry.url : ''); if (p.entry.level === 'error') { if (/net::ERR|Failed to load resource/.test(s)) page.netErrors.push(s); else page.consoleErrors.push(s); } });
  /* Google Fonts → CSS rỗng (không mạng ngoài) */
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*fonts.googleapis.com/*' }, { urlPattern: '*fonts.gstatic.com/*' }] });
  page.on('Fetch.requestPaused', async p => {
    if (page.holdPattern && p.request.url.includes(page.holdPattern)) { page.held.push(p.requestId); return; }
    try { await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/css' }], body: Buffer.from('/* fonts giả lập */').toString('base64') }); } catch (e) { /* đã hủy */ }
  });
  page.held = []; page.holdPattern = null;
  if (o.reducedMotion) await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
  pagesOpen.push(page);
  return page;
}
/* Giữ (không trả lời) các request khớp mẫu – để mô phỏng "chưa kịp poll" */
async function holdRequests(page, pattern) {
  page.holdPattern = pattern; page.held = [];
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*fonts.googleapis.com/*' }, { urlPattern: '*fonts.gstatic.com/*' }, { urlPattern: '*' + pattern + '*' }] });
}
async function releaseRequests(page) {
  page.holdPattern = null;
  for (const id of page.held) { try { await page.send('Fetch.continueRequest', { requestId: id }); } catch (e) { /* đã hết */ } }
  page.held = [];
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*fonts.googleapis.com/*' }, { urlPattern: '*fonts.gstatic.com/*' }] });
}
async function closeAll() { for (const p of pagesOpen.splice(0)) { try { await p.close(); } catch (e) { /* bỏ qua */ } } }

/* ===== Tiện ích đọc trang ===== */
const text = (page, sel) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
const prop = (page, sel, p) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e[${JSON.stringify(p)}] : null; })()`);
const VIS = sel => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.hidden && !e.closest('[hidden]') && e.getClientRects().length > 0; })()`;
const isVisible = (page, sel) => page.evaluate(VIS(sel));
const qa = page => page.evaluate('JSON.parse(JSON.stringify(window.__qa))');
async function waitFor(page, expr, timeoutMs, step) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 3000)) {
    let v = null;
    try { v = await page.evaluate(expr); } catch (e) { v = null; }
    if (v) return v;
    await sleep(step || 50);
  }
  return null;
}
const waitVisible = (page, sel, ms) => waitFor(page, VIS(sel), ms);
const waitText = (page, sel, want, ms) => waitFor(page, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.textContent.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(want)}; })()`, ms);
async function focusType(page, sel, str) {
  await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); return true; })()`);
  await page.type(str);
}
const counts = page => page.evaluate(`(() => { const t = s => (document.querySelector(s) || { textContent: '' }).textContent.replace(/\\s+/g, ' ').trim(); const d = s => !!document.querySelector(s).disabled;
  return { p: t('#count-participants'), a: t('#count-answers'), s: t('#count-shown'), h: t('#count-hidden'), hHidden: document.querySelector('#count-hidden').hidden, net: document.querySelector('#scr-stage #net-status').hidden, hint: t('#next-hint'), label: t('#stage-q-label'), q: t('#stage-q-text'),
    next: d('#btn-next'), showAll: d('#btn-show-all'), hideAll: d('#btn-hide-all'), prevQ: d('#btn-prev-q'), nextQ: d('#btn-next-q'), close: d('#btn-close'), closeSolid: document.querySelector('#btn-close').classList.contains('bar-solid'),
    cards: [...document.querySelectorAll('#cards li')].map(li => ({ id: li.dataset.id, text: li.querySelector('.card-text').textContent, latest: li.classList.contains('is-latest') })), empty: !document.querySelector('#cards-empty').hidden }; })()`);
const joinState = page => page.evaluate(`(() => { const t = s => { const e = document.querySelector(s); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; }; const v = s => { const e = document.querySelector(s); return !!e && !e.hidden && !e.closest('[hidden]') && e.getClientRects().length > 0; };
  return { screen: ['scr-loading', 'scr-enter', 'scr-room', 'scr-closed'].filter(id => !document.getElementById(id).hidden).join(','), label: t('#q-label'), q: t('#q-text'), form: v('#answer-form'), sent: v('#sent'), sentBody: t('#sent-body'), sentBoxVisible: v('#sent-text'), sentNote: t('#sent-note'),
    draft: (document.getElementById('answer') || {}).value, btn: t('#btn-send'), btnDisabled: document.getElementById('btn-send').disabled, hint: t('#send-hint'), changed: v('#q-changed'), changedText: t('#q-changed'), sendErr: v('#send-error'), sendErrText: t('#send-error'), net: v('#scr-room #net-status'),
    count: t('#answer-count'), countHidden: document.getElementById('answer-count').hidden, closedTitle: t('#closed-title'), closedLead: t('#closed-lead'), enterErr: t('#enter-error'), code: (document.getElementById('room-code') || {}).value, active: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : '' }; })()`);
const lsKeys = page => page.evaluate('Object.keys(localStorage).sort()');
const deviceOf = page => page.evaluate("localStorage.getItem('tlad_device')");

/* ===== Bước chuẩn: mở host, tạo phòng, mở join, gửi ===== */
async function hostOpen(opts) {
  const page = await openPage('host', opts);
  await page.navigate(HOST_URL + '?key=' + HOST_KEY);
  await waitVisible(page, '#scr-create', 3000);
  return page;
}
async function createRoom(page, lines) {
  await focusType(page, '#questions', lines.join('\n'));
  await page.click('#btn-create');
  const t0 = Date.now();
  const ok = await waitFor(page, "!document.getElementById('scr-stage').hidden && !document.querySelector('.stage-wrap').classList.contains('loading') && /^\\d{4}$/.test(document.getElementById('room-code-big').textContent)", 5000);
  return { code: ok ? await text(page, '#room-code-big') : null, ms: Date.now() - t0 };
}
async function joinOpen(code, opts) {
  const page = await openPage('join', opts);
  const t0 = Date.now();
  await page.navigate(JOIN_URL(code));
  const ok = await waitFor(page, "!document.getElementById('scr-room').hidden || !document.getElementById('scr-closed').hidden || (!document.getElementById('scr-enter').hidden && document.getElementById('enter-error').textContent)", 5000);
  page.enterMs = Date.now() - t0;
  return page;
}
async function joinSend(page, str) {
  await focusType(page, '#answer', str);
  await waitFor(page, "!document.getElementById('btn-send').disabled", 1500);
  await page.click('#btn-send');
  return !!(await waitVisible(page, '#sent', 4000));
}
async function hostStepQ(page, dir) {
  const before = await text(page, '#stage-q-label');
  await page.click(dir > 0 ? '#btn-next-q' : '#btn-prev-q');
  const ok = await waitFor(page, `document.getElementById('stage-q-label').textContent !== ${JSON.stringify(before)} && document.getElementById('btn-next-q').textContent !== '…'`, 8000);
  if (!ok) note('hostStepQ: nhãn câu không đổi sau 8 s (máy chậm?)');
  return Date.now();
}
function checkConsole(pages, label) {
  for (const p of pages) {
    T((label || '') + ' console ' + p.kind + ': 0 console.error / exception', p.consoleErrors.length === 0, p.consoleErrors.join(' | '));
    if (p.netErrors.length) note(p.kind + ': ' + p.netErrors.length + ' lỗi tải mạng (mong đợi khi thử mất mạng): ' + p.netErrors.slice(0, 2).join(' | '));
  }
}

/* ================= KỊCH BẢN main ================= */
async function scenarioMain() {
  const host = await hostOpen();
  /* --- US-7 tạo phòng --- */
  T('US-7 màn tạo phòng: textarea trống → nút disabled, hint "Nhập ít nhất một câu hỏi nhé."', (await prop(host, '#btn-create', 'disabled')) === true && (await text(host, '#create-hint')) === TXT.createNeed, await text(host, '#create-hint'));
  T('US-7 URL đã xóa ?key= ngay khi tải (replaceState)', !(await host.evaluate('location.search')).includes('key'), await host.evaluate('location.href'));
  T('US-7 khóa nằm trong localStorage tlad_host_key, không trong config', (await host.evaluate("localStorage.getItem('tlad_host_key')")) === HOST_KEY);
  await focusType(host, '#questions', '   \n\n  ');
  T('US-7 chỉ khoảng trắng/dòng trống → vẫn disabled, đếm "0 câu hỏi"', (await prop(host, '#btn-create', 'disabled')) === true && /^0 câu hỏi/.test(await text(host, '#questions-count')), await text(host, '#questions-count'));
  await host.evaluate("document.getElementById('questions').value = ''; document.getElementById('questions').dispatchEvent(new Event('input')); true");
  const created = await createRoom(host, Q3);
  const code = created.code;
  T('US-7 nhập 3 dòng + Tạo phòng › → ≤ 3 s sang màn chiếu với mã 4 số', !!code && created.ms <= 3000, code + ' sau ' + created.ms + ' ms');
  if (!code) throw new Error('không tạo được phòng');
  const rr = roomRow(code);
  T('US-7 tab Rooms có dòng [mã, tạo lúc, câu 1, 3 câu, open]', !!rr && rr[2] === 1 && rr[3] === 3 && rr[4] === 'open', JSON.stringify(rr));
  T('US-7 tab Questions có 3 dòng đúng thứ tự', JSON.stringify(sheet().questions.filter(r => r[0] === code).map(r => r[2])) === JSON.stringify(Q3));
  T('US-7 câu hỏi 1 hiện to, nhãn "Câu 1/3"', (await text(host, '#stage-q-text')) === Q3[0] && (await text(host, '#stage-q-label')) === 'Câu 1/3');
  const qrInfo = await host.evaluate(`(() => { const svg = document.querySelector('#qr svg'); if (!svg) return null; const b = svg.getBoundingClientRect(); const code = document.getElementById('room-code-big').textContent;
    const url = APP_CONFIG.BASE_URL + '?room=' + code; const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
    const d = document.createElement('div'); d.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true, alt: 'QR vào phòng ' + code });
    const same = d.innerHTML === document.getElementById('qr').innerHTML;
    const fills = [...svg.querySelectorAll('[fill]')].map(e => e.getAttribute('fill').toLowerCase()); return { w: b.width, h: b.height, same, url, modules: qr.getModuleCount(), fills: [...new Set(fills)], self: qrcode.__selfTest ? qrcode.__selfTest() : null }; })()`);
  T('US-7 QR là SVG, mã hóa đúng BASE_URL?room=<mã> (tái tạo cùng dữ liệu khớp 100 %)', !!qrInfo && qrInfo.same && qrInfo.url === BASE + '?room=' + code, JSON.stringify(qrInfo && { url: qrInfo.url, same: qrInfo.same, modules: qrInfo.modules }));
  T('US-8 QR ≥ 160 px ở 1280×720, màu đen/trắng thuần', !!qrInfo && qrInfo.w >= 160 && qrInfo.h >= 160 && qrInfo.fills.every(f => ['#000', '#000000', '#fff', '#ffffff', 'black', 'white'].includes(f)), JSON.stringify(qrInfo && { w: qrInfo.w, fills: qrInfo.fills }));
  T('QR: thư viện tự kiểm (__selfTest) ok', !!qrInfo && qrInfo.self && qrInfo.self.ok, JSON.stringify(qrInfo && qrInfo.self));
  await host.screenshot(path.join(OUT, 'main-stage-empty.png'));
  await qrDecodeCheck(host, BASE + '?room=' + code, 'main');
  T('US-8 chưa có câu trả lời → "Chưa có câu trả lời nào. Mời mọi người quét QR nhé."', (await text(host, '#cards-empty')) === TXT.empty && (await isVisible(host, '#cards-empty')));
  let c = await counts(host);
  T('US-8 thanh đếm lúc đầu "👥 0 người đang tham gia · ✉️ 0 câu trả lời · đã hiện 0/0"; Tiếp/Hiện tất cả/Ẩn disabled; Câu trước disabled', c.p === '👥 0 người đang tham gia' && c.a === '✉️ 0 câu trả lời' && c.s === 'đã hiện 0/0' && c.next && c.showAll && c.hideAll && c.prevQ && !c.nextQ && !c.close, JSON.stringify(c));
  T('US-8 hint phím "Space / → = Tiếp"', c.hint === TXT.hintKeys, c.hint);

  /* --- US-1 vào bằng QR --- */
  const j1 = await joinOpen(code);
  let s1 = await joinState(j1);
  T('US-1 quét QR ?room= → ≤ 3 s thấy câu hỏi + ô gõ, không màn chào, không popup', s1.screen === 'scr-room' && s1.form && s1.q === Q3[0] && s1.label === 'Câu 1/3' && j1.enterMs <= 3000, s1.screen + ' sau ' + j1.enterMs + ' ms');
  T('US-1 không hỏi tên: không input text nào ngoài ô mã (ẩn) và textarea', (await j1.evaluate("[...document.querySelectorAll('input:not([type=checkbox])')].filter(i => !i.closest('[hidden]')).length")) === 0 && (await j1.evaluate("document.querySelectorAll('dialog[open], [role=dialog]:not([hidden]), audio, video').length")) === 0);
  T('US-1 tab join đang visible (poll chạy)', (await j1.evaluate('document.visibilityState')) === 'visible');
  const ks = await lsKeys(j1);
  T('US-1 localStorage lần đầu chỉ có tlad_device + tlad_join (room)', JSON.stringify(ks) === JSON.stringify(['tlad_device', 'tlad_join']) && /^[a-z0-9]{16}$/.test(await deviceOf(j1)) && (await j1.evaluate("JSON.parse(localStorage.getItem('tlad_join')).room")) === code, JSON.stringify(ks));
  T('US-1 focus đặt vào câu hỏi (h1#q-text), không autofocus ô gõ', s1.active === 'q-text', s1.active);
  /* --- US-4 minh bạch --- */
  const trans = await j1.evaluate("(() => { const t = document.getElementById('transparency'), n = document.getElementById('name-note'), b = document.getElementById('btn-send'), a = document.getElementById('answer'); return { t: t.textContent.trim(), n: n.textContent.trim(), tAbove: t.getBoundingClientRect().bottom <= b.getBoundingClientRect().top, nBelowInput: n.getBoundingClientRect().top >= a.getBoundingClientRect().bottom, vis: !t.hidden && !n.hidden }; })()");
  T('US-4 dòng minh bạch nguyên văn, ngay trên nút gửi', trans.t === TXT.transparency && trans.tAbove && trans.vis, JSON.stringify(trans));
  T('US-4 dòng "Đừng ghi tên người thật nhé." dưới ô gõ', trans.n === TXT.nameNote && trans.nBelowInput);
  /* --- US-2 ô trống / khoảng trắng / 280 --- */
  T('US-2 ô trống → nút disabled, hint "Gõ một câu rồi gửi nhé.", bộ đếm ẩn', s1.btnDisabled && s1.hint === TXT.sendNeed && s1.countHidden, s1.hint);
  await focusType(j1, '#answer', '   \n ');
  s1 = await joinState(j1);
  T('US-2 chỉ khoảng trắng → vẫn disabled, hint như trống', s1.btnDisabled && s1.hint === TXT.sendNeed);
  await j1.evaluate("(() => { const a = document.getElementById('answer'); a.value = ''; a.dispatchEvent(new Event('input')); a.focus(); return true; })()");
  await j1.type('x'.repeat(290));
  s1 = await joinState(j1);
  const countColor = await j1.evaluate("getComputedStyle(document.getElementById('answer-count')).color");
  T('US-2 gõ 290 ký tự → ô giữ 280, bộ đếm "280/280" hiện, màu cam ấm không đỏ', s1.draft.length === 280 && s1.count === '280/280' && !s1.countHidden && countColor === 'rgb(154, 90, 34)', s1.draft.length + ' ' + s1.count + ' ' + countColor);
  T('US-2 không có chữ/viền đỏ (--danger) nào trên màn trả lời', (await j1.evaluate("[...document.querySelectorAll('#scr-room *')].filter(el => { const cs = getComputedStyle(el); return [cs.color, cs.borderColor, cs.backgroundColor].some(c => c === 'rgb(179, 38, 30)' || c === 'rgb(252, 232, 230)'); }).length")) === 0);
  await j1.evaluate("(() => { const a = document.getElementById('answer'); a.value = ''; a.dispatchEvent(new Event('input')); return true; })()");
  /* --- US-2 gửi thật --- */
  const ANS1 = 'trắng xanh đỏ đen nâu';
  await focusType(j1, '#answer', ANS1);
  s1 = await joinState(j1);
  T('US-2 có chữ → nút .ready, hint "✨ Đọc lại một lần rồi gửi nhé."', !s1.btnDisabled && s1.hint === TXT.sendReady && (await j1.evaluate("document.getElementById('btn-send').classList.contains('ready')")), s1.hint);
  const tSend = Date.now();
  await j1.click('#btn-send');
  const sentOk = await waitVisible(j1, '#sent', 4000);
  const dtSent = Date.now() - tSend;
  const clickSnap = (await qa(j1)).sendClick;
  T('US-2 bấm Gửi › → nút khóa NGAY (disabled + "Đang gửi…", textarea readonly)', !!clickSnap && clickSnap.disabled && clickSnap.label === 'Đang gửi…' && clickSnap.readonly, JSON.stringify(clickSnap));
  s1 = await joinState(j1);
  const qa1 = await qa(j1);
  const postRec = qa1.fetches.filter(f => f.method === 'POST').slice(-1)[0] || {};
  const inPage = qa1.sentAt && qa1.clickAt ? Math.round(qa1.sentAt - qa1.clickAt) : -1;
  T('US-2 ≤ 3 s card đổi "Đã gửi ✓" + nguyên câu + "Chờ câu tiếp theo nhé."', !!sentOk && inPage >= 0 && inPage <= 3000 && s1.sent && !s1.form && (await text(j1, '#sent-title')) === 'Đã gửi ✓' && s1.sentBody === ANS1 && s1.sentNote === TXT.wait, 'đo trong trang: click→#sent ' + inPage + ' ms (tiêu chí ≤ 3000), POST submitAnswer ' + Math.round((postRec.t1 || 0) - (postRec.t0 || 0)) + ' ms; khung CDP ' + dtSent + ' ms) ' + JSON.stringify({ body: s1.sentBody, note: s1.sentNote }));
  T('US-2 focus chuyển vào "Đã gửi ✓"', s1.active === 'sent-title', s1.active);
  T('US-2 rung nhẹ navigator.vibrate khi gửi thành công', (await qa(j1)).vibrates === 1);
  const dev1 = await deviceOf(j1);
  let rows = answersOf(code);
  T('US-2 tab Answers đúng MỘT dòng mới, 5 cột [Thời gian, Mã phòng, Số câu, deviceId, Nội dung]', rows.length === 1 && rows[0].length === 5 && /^\d\d:\d\d:\d\d \d\d\/\d\d\/\d{4}$/.test(rows[0][0]) && rows[0][1] === code && rows[0][2] === 1 && rows[0][3] === dev1 && rows[0][4] === ANS1, JSON.stringify(rows));
  T('US-4 Sheet không có cột nào ngoài 5 (không IP, UA, tên)', sheet().answers.every(r => r.length === 5));
  T('US-1 localStorage sau khi gửi: tlad_join.answered["1"] = câu đã gửi, vẫn chỉ 2 khóa', JSON.stringify(await lsKeys(j1)) === JSON.stringify(['tlad_device', 'tlad_join']) && (await j1.evaluate("JSON.parse(localStorage.getItem('tlad_join')).answered['1']")) === ANS1);

  /* --- US-2 bấm đúp --- */
  const j2 = await joinOpen(code);
  await focusType(j2, '#answer', 'xanh lá, vàng, trắng');
  await waitFor(j2, "!document.getElementById('btn-send').disabled", 1500);
  await j2.click('#btn-send', 2);
  await waitVisible(j2, '#sent', 4000);
  await sleep(300);
  const dev2 = await deviceOf(j2);
  T('US-2 bấm đúp rất nhanh → Sheet vẫn một dòng cho room|câu|device', answersOf(code).filter(r => r[3] === dev2).length === 1 && answersOf(code).length === 2, answersOf(code).length + ' dòng');
  T('US-1 hai máy có deviceId khác nhau', dev1 !== dev2);

  /* --- US-8 3 điện thoại vào, 2 đã gửi --- */
  const j3 = await joinOpen(code);
  const t8 = Date.now();
  const okCounts = await waitFor(host, "document.getElementById('count-participants').textContent.includes('3 người') && document.getElementById('count-answers').textContent.includes('2 câu')", 7000);
  c = await counts(host);
  T('US-8 3 máy vào, 2 gửi → "3 người đang tham gia · 2 câu trả lời · đã hiện 0/2" trong ≤ 5 s', !!okCounts && c.p === '👥 3 người đang tham gia' && c.a === '✉️ 2 câu trả lời' && c.s === 'đã hiện 0/2', JSON.stringify([c.p, c.a, c.s]) + ' sau ' + (Date.now() - t8) + ' ms (đã gồm thời gian mở tab)');
  T('US-8 có câu chưa hiện → Tiếp › và Hiện tất cả mở, Ẩn disabled (a = 0)', !c.next && !c.showAll && c.hideAll);
  T('US-9 câu trả lời KHÔNG tự hiện trên màn chiếu (0 card, vẫn hộp rỗng)', c.cards.length === 0 && c.empty);

  /* --- US-9: thêm 3 câu nữa qua API (giả 3 máy), tổng 5 --- */
  await postAnswer(code, 'qadevice00000003', 1, LONG_280);
  await postAnswer(code, 'qadevice00000004', 1, '=HYPERLINK("http://evil","bấm")');
  await postAnswer(code, 'qadevice00000005', 1, 'đỏ');
  await waitFor(host, "document.getElementById('count-answers').textContent.includes('5 câu')", 6000);
  T('US-9 đã nhận 5 câu, đã hiện 0/5', (await counts(host)).s === 'đã hiện 0/5');
  await host.click('#btn-next');
  c = await counts(host);
  T('US-9 Tiếp › → đúng MỘT card, nguyên văn câu gửi sớm nhất, viền nhấn .is-latest, "đã hiện 1/5"', c.cards.length === 1 && c.cards[0].text === ANS1 && c.cards[0].latest && c.s === 'đã hiện 1/5' && !c.empty, JSON.stringify(c.cards) + ' ' + c.s);
  const latestStyle = await host.evaluate("(() => { const li = document.querySelector('#cards li.is-latest'); const cs = getComputedStyle(li); return { border: cs.borderTopWidth + ' ' + cs.borderTopColor, bg: cs.backgroundColor, font: cs.fontSize, anim: cs.animationName }; })()");
  T('US-9 card mới viền navy 3px, nền navy nhạt, chữ ≥ 28px', latestStyle.border === '3px rgb(31, 58, 95)' && latestStyle.bg === 'rgb(227, 234, 243)' && parseFloat(latestStyle.font) >= 28, JSON.stringify(latestStyle));
  await host.click('#btn-next');
  c = await counts(host);
  T('US-9 Tiếp › lần hai → card thứ hai, viền nhấn chuyển sang card mới, 2/5', c.cards.length === 2 && c.cards[1].latest && !c.cards[0].latest && c.s === 'đã hiện 2/5', JSON.stringify(c.cards.map(x => x.latest)));
  /* phím tắt */
  await host.evaluate('document.activeElement && document.activeElement.blur(); true');
  await host.key('Space');
  c = await counts(host);
  T('US-9 phím Space = Tiếp (card 3 = câu 280 ký tự)', c.cards.length === 3 && c.cards[2].text === LONG_280, c.cards.length + ' card');
  await sleep(600); // cuộn mượt
  const longCard = await host.evaluate("(() => { const li = document.querySelector('#cards li.is-latest'); const p = li.querySelector('.card-text'); const cs = getComputedStyle(p); const a = document.querySelector('.answers').getBoundingClientRect(); const b = li.getBoundingClientRect(); return { text: p.textContent, lines: Math.round(p.getBoundingClientRect().height / parseFloat(cs.lineHeight)), clipped: p.scrollHeight > p.clientHeight + 1 || li.scrollHeight > li.clientHeight + 1, overflow: cs.overflow + '/' + cs.textOverflow + '/' + cs.whiteSpace, inView: b.top >= a.top - 1 && b.bottom <= a.bottom + 1, topIn: b.top >= a.top - 1 && b.top < a.bottom, cardH: Math.round(b.height), areaH: Math.round(a.height), visibleRatio: Math.round(100 * (Math.min(b.bottom, a.bottom) - Math.max(b.top, a.top)) / b.height) }; })()");
  T('US-9 câu 280 ký tự có xuống dòng: card xuống dòng đầy đủ, không cắt, không "…" (pre-wrap)', longCard.text === LONG_280 && !longCard.clipped && longCard.lines >= 4 && /pre-wrap/.test(longCard.overflow) && !/ellipsis/.test(longCard.overflow), JSON.stringify({ lines: longCard.lines, clipped: longCard.clipped, overflow: longCard.overflow }));
  T('US-9 card mới được cuộn vào tầm nhìn: PHẦN ĐẦU card phải nhìn thấy (card cao hơn vùng thì căn mép trên, không căn mép dưới)', longCard.topIn, JSON.stringify({ cardH: longCard.cardH, areaH: longCard.areaH, visibleRatio: longCard.visibleRatio, topIn: longCard.topIn }) + ' – scrollIntoView({block:\'nearest\'}) căn mép dưới, dòng đầu bị khuất phía trên');
  T('B-01 card 280 ký tự nhìn thấy TRỌN trên 720p mà không cuộn (card ' + longCard.cardH + 'px / vùng ' + longCard.areaH + 'px), có class .long, chữ ≥ 28px', longCard.inView && longCard.cardH < longCard.areaH && (await host.evaluate("(() => { const li = document.querySelector('#cards li.is-latest'); return li.classList.contains('long') && parseFloat(getComputedStyle(li).fontSize) >= 28; })()")), 'thấy ' + longCard.visibleRatio + ' %');
  await host.key('ArrowRight');
  c = await counts(host);
  T('US-9 phím → = Tiếp (card 4 = câu bắt đầu bằng "=")', c.cards.length === 4 && /HYPERLINK/.test(c.cards[3].text), c.cards[3] && c.cards[3].text);
  note('Câu bắt đầu "=" hiện trên màn là "' + (c.cards[3] && c.cards[3].text.slice(0, 12)) + '…" – backend thêm dấu \' chống formula injection (điểm lệch dev đã báo).');
  await host.key('PageDown');
  c = await counts(host);
  T('US-9 phím PageDown = Tiếp (remote trình chiếu) → 5/5', c.cards.length === 5 && c.s === 'đã hiện 5/5', c.s);
  T('US-9 đã hiện 5/5 → Tiếp › disabled, Hiện tất cả disabled, hint "Đã hiện hết…"', c.next && c.showAll && !c.hideAll && c.hint === TXT.hintDone, c.hint);
  await host.key('Space');
  T('US-9 Space khi hết → không có gì đổi', (await counts(host)).cards.length === 5);
  /* Space khi focus ở ô nhập → không Tiếp */
  await host.evaluate("(() => { const i = document.createElement('input'); i.id = 'qa-tmp-input'; document.body.appendChild(i); i.focus(); return true; })()");
  await postAnswer(code, 'qadevice00000006', 1, 'màu áo blouse của chị ngồi cạnh');
  await waitFor(host, "document.getElementById('count-answers').textContent.includes('6 câu')", 6000);
  c = await counts(host);
  T('US-9 có câu mới gửi tới → nút Tiếp mở lại, đếm 5/6, hint về phím; card KHÔNG tự hiện', !c.next && c.s === 'đã hiện 5/6' && c.hint === TXT.hintKeys && c.cards.length === 5, c.s + ' ' + c.hint);
  await host.key('Space');
  T('US-9 Space khi focus ở ô nhập → KHÔNG Tiếp', (await counts(host)).cards.length === 5);
  await host.evaluate("document.getElementById('qa-tmp-input').remove(); true");
  /* Hiện tất cả / Ẩn */
  await host.click('#btn-show-all');
  c = await counts(host);
  const sheetBefore = JSON.stringify(answersOf(code));
  T('US-9 Hiện tất cả → 6 card đúng thứ tự nhận, đếm 6/6', c.cards.length === 6 && c.s === 'đã hiện 6/6' && c.cards.map(x => x.text).join('|') === answersOf(code).map(r => r[4]).join('|'), c.s);
  await host.click('#btn-hide-all');
  c = await counts(host);
  T('US-9 Ẩn → vùng rỗng (hộp "Chưa có câu trả lời…"), đếm 0/6, Sheet không đổi', c.cards.length === 0 && c.empty && c.s === 'đã hiện 0/6' && JSON.stringify(answersOf(code)) === sheetBefore, c.s);
  /* ✕ */
  await host.click('#btn-show-all');
  const cardsBeforeHide = (await counts(host)).cards;
  const hideId = cardsBeforeHide[1].id;
  const expectNextFocusId = cardsBeforeHide[2].id;   // card kế (nextElementSibling) của card bị ✕
  await host.click('#cards li[data-id="' + hideId.replace(/"/g, '\\"') + '"] .card-hide');
  const focusAfterHide = await host.evaluate("(() => { const a = document.activeElement; return { tag: a ? a.tagName : '', id: a ? a.id : '', cls: a ? a.className : '', dataId: a ? a.getAttribute('data-id') : null }; })()");
  c = await counts(host);
  const toast1 = await text(host, '#toast');
  T('US-9 ✕ trên card → card biến mất, đếm giảm cả tử lẫn mẫu 5/5, "· 1 đã ẩn", toast "Đã ẩn một câu."', c.cards.length === 5 && !c.cards.some(x => x.id === hideId) && c.s === 'đã hiện 5/5' && c.h === '· 1 đã ẩn' && !c.hHidden && toast1 === TXT.hidToast && c.a === '✉️ 6 câu trả lời', JSON.stringify([c.s, c.h, toast1, c.a]));
  T('US-9 ✕: Sheet không đổi', JSON.stringify(answersOf(code)) === sheetBefore);
  const toastRect = await host.evaluate("(() => { const t = document.getElementById('toast').getBoundingClientRect(); const over = [...document.querySelectorAll('.bar-actions button, .bar-actions summary')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && !(r.right < t.left || r.left > t.right || r.bottom < t.top || r.top > t.bottom); }).map(b => b.id || 'summary'); return { top: Math.round(t.top), over }; })()");
  await sleep(350); // toast trượt lên .3s
  const toastRect2 = await host.evaluate("(() => { const t = document.getElementById('toast').getBoundingClientRect(); const bar = document.querySelector('.control-bar').getBoundingClientRect(); return { show: document.getElementById('toast').classList.contains('show'), bottom: Math.round(t.bottom), barTop: Math.round(bar.top), text: document.getElementById('toast').textContent }; })()");
  T('B-05 toast trên màn dẫn nằm phía trên thanh điều khiển, không đè nút', toastRect.over.length === 0 && toastRect2.show && toastRect2.bottom <= toastRect2.barTop, JSON.stringify(toastRect2) + ' đè: ' + toastRect.over.join(','));
  await host.click('#btn-hide-all');
  for (let i = 0; i < 6; i++) await host.click('#btn-next').catch(() => {});
  c = await counts(host);
  T('US-9 sau Ẩn rồi Tiếp 6 lần → câu đã ✕ KHÔNG hiện lại (5 card), nút Tiếp disabled ở 5/5', c.cards.length === 5 && !c.cards.some(x => x.id === hideId) && c.next, c.cards.length + ' card');
  T('US-9 focus sau ✕ sang ✕ của card kế (hoặc nút Tiếp khi không còn card), không rơi về body', (focusAfterHide.cls === 'card-hide' && focusAfterHide.dataId === expectNextFocusId) || focusAfterHide.id === 'btn-next', JSON.stringify(focusAfterHide) + ' kỳ vọng data-id=' + expectNextFocusId);
  await host.screenshot(path.join(OUT, 'main-stage-5cards.png'));

  /* --- US-7 F5 màn chiếu giữ phòng, câu, số đã hiện và danh sách đã ẩn --- */
  await host.reload();
  const reopened = await waitFor(host, "!document.getElementById('scr-stage').hidden && !document.querySelector('.stage-wrap').classList.contains('loading')", 5000);
  c = await counts(host);
  T('US-7 F5 màn chiếu → vẫn phòng đó, câu 1/3, "đã hiện 5/5 · 1 đã ẩn", 5 card, card ✕ vẫn ẩn', !!reopened && (await text(host, '#room-code-big')) === code && c.label === 'Câu 1/3' && c.s === 'đã hiện 5/5' && c.h === '· 1 đã ẩn' && c.cards.length === 5 && !c.cards.some(x => x.id === hideId), JSON.stringify([c.label, c.s, c.h, c.cards.length]));
  T('US-7 F5: URL không chứa key', !(await host.evaluate('location.href')).includes('key='));

  /* --- US-3 / US-10 chuyển câu --- */
  await focusType(j3, '#answer', 'đang gõ dở câu một');
  const tNext = await hostStepQ(host, 1);
  c = await counts(host);
  T('US-10 Câu tiếp › → màn chiếu "Câu 2/3", vùng rỗng, đếm 0/0, Câu trước mở', c.label === 'Câu 2/3' && c.q === Q3[1] && c.cards.length === 0 && c.empty && c.s === 'đã hiện 0/0' && !c.prevQ, JSON.stringify([c.label, c.s]));
  T('US-10 tab Rooms cập nhật câu hiện tại = 2', roomRow(code)[2] === 2);
  T('US-10 focus về câu hỏi sau khi chuyển câu', (await host.evaluate('document.activeElement.id')) === 'stage-q-text');
  const ch1 = await waitFor(j1, "document.getElementById('q-label').textContent === 'Câu 2/3'", 7000);
  const dt1 = Date.now() - tNext;
  s1 = await joinState(j1);
  T('US-3 máy đã gửi câu 1 → ≤ 5 s hiện câu 2, ô gõ trống, form mở lại', !!ch1 && dt1 <= 5000 && s1.form && !s1.sent && s1.q === Q3[1] && s1.draft === '' && !s1.changed, dt1 + ' ms ' + JSON.stringify([s1.label, s1.draft, s1.changed]));
  T('US-3 vùng câu hỏi aria-live="polite" chứa cả nhãn và câu', (await j1.evaluate("document.getElementById('q-live').getAttribute('aria-live') === 'polite' && document.getElementById('q-live').contains(document.getElementById('q-label')) && document.getElementById('q-live').contains(document.getElementById('q-text'))")));
  const ch3 = await waitFor(j3, "document.getElementById('q-label').textContent === 'Câu 2/3'", 7000);
  const s3 = await joinState(j3);
  T('US-3 máy ĐANG GÕ câu 1 → hiện câu 2, chữ không mất, dòng "Người dẫn vừa chuyển câu…" + nút gửi mở', !!ch3 && s3.draft === 'đang gõ dở câu một' && s3.changed && s3.changedText.startsWith(TXT.changed) && !s3.btnDisabled, JSON.stringify([s3.draft, s3.changed, s3.btnDisabled]));
  T('B-02 khi người dẫn chuyển câu lúc đang gõ, focus KHÔNG bị kéo khỏi ô gõ', s3.active === 'answer', 'activeElement=' + s3.active);
  await j3.click('#q-changed [data-act="clear-draft"]');
  const s3b = await joinState(j3);
  T('US-3 "Xóa chữ đang gõ" → ô trống, hộp nhắc tự ẩn, focus về ô gõ', s3b.draft === '' && !s3b.changed && s3b.active === 'answer', JSON.stringify([s3b.draft, s3b.changed, s3b.active]));
  /* --- US-3 xung đột: j2 chưa poll kịp (giữ heartbeat), gửi câu cũ --- */
  /* Ranh giới API (máy "chưa kịp poll"): gửi q=1 khi phòng đã sang câu 2 */
  const conflict = await j2.evaluate(`APP_API.submitAnswer({ room: ${JSON.stringify(code)}, device: 'qadevice00000099', q: 1, text: 'gửi muộn cho câu 1' })`);
  T('US-3 gửi câu 1 khi phòng đã sang câu 2 → backend từ chối question_changed kèm currentQuestion=2, KHÔNG ghi vào câu đã qua', conflict.error === 'question_changed' && conflict.currentIndex === 2 && conflict.currentQuestion && conflict.currentQuestion.index === 2 && answersOf(code).filter(r => r[2] === 1).length === 6, JSON.stringify(conflict));
  /* j3 (form mở, ở câu 2 với nháp) gửi câu cũ qua UI: giữ heartbeat, host chuyển sang câu 3, j3 bấm gửi */
  await focusType(j3, '#answer', 'câu này gõ cho câu hai');
  await holdRequests(j3, 'action=heartbeat');
  for (let i = 0; i < 100 && !j3.held.length; i++) await sleep(100);
  await hostStepQ(host, 1);
  T('US-10 ở câu 3/3 → Câu tiếp › disabled, Kết thúc phòng đổi sang kiểu nổi (.bar-solid)', (await counts(host)).nextQ && (await counts(host)).closeSolid && (await counts(host)).label === 'Câu 3/3');
  await j3.click('#btn-send');
  const s3c = await waitFor(j3, "!document.getElementById('q-changed').hidden && document.getElementById('q-label').textContent === 'Câu 3/3'", 4000) && await joinState(j3);
  T('US-3 bấm Gửi đúng lúc người dẫn vừa chuyển câu → giữ chữ, đổi sang câu 3, dòng "Người dẫn vừa chuyển câu…", nút mở', !!s3c && s3c.draft === 'câu này gõ cho câu hai' && s3c.q === Q3[2] && s3c.changed && !s3c.btnDisabled && !s3c.sent, JSON.stringify(s3c && [s3c.label, s3c.draft, s3c.changed, s3c.btnDisabled]));
  await releaseRequests(j3);
  await sleep(200);
  T('US-3 không có dòng nào ghi cho câu 2 từ máy 3 (không ghi vào câu đã qua mà không báo)', answersOf(code).filter(r => r[2] === 2).length === 0);
  await j3.click('#btn-send');
  await waitVisible(j3, '#sent', 4000);
  T('US-3 gửi lại cho câu 3 → Đã gửi ✓, Sheet có dòng câu 3', (await joinState(j3)).sent && answersOf(code).filter(r => r[2] === 3).length === 1);
  /* j1 gửi câu 3 nữa để có 2 câu */
  await waitFor(j1, "document.getElementById('q-label').textContent === 'Câu 3/3'", 7000);
  await joinSend(j1, 'ghé hỏi thăm một câu');
  /* --- US-3 Câu trước về câu 1: máy đã gửi câu 1 thấy "Đã gửi ✓" --- */
  await hostStepQ(host, -1);
  await hostStepQ(host, -1);
  c = await counts(host);
  T('US-10 ‹ Câu trước về câu 1 → hiện lại đúng 5 card đã hiện trước đó, "5/5 · 1 đã ẩn"', c.label === 'Câu 1/3' && c.cards.length === 5 && c.s === 'đã hiện 5/5' && c.h === '· 1 đã ẩn', JSON.stringify([c.label, c.cards.length, c.s, c.h]));
  const back1 = await waitFor(j1, "document.getElementById('q-label').textContent === 'Câu 1/3' && !document.getElementById('sent').hidden", 7000);
  s1 = await joinState(j1);
  T('US-3 máy đã gửi câu 1 → về câu 1 ở trạng thái "Đã gửi ✓" với nguyên câu, không cho gửi lại', !!back1 && s1.sent && !s1.form && s1.sentBody === ANS1 && s1.sentNote === TXT.wait, JSON.stringify([s1.sent, s1.sentBody]));

  /* --- US-11 CSV --- */
  await host.click('#data-menu summary');
  await waitVisible(host, '#btn-csv', 1000);
  await host.click('#btn-csv');
  const csvOk = await waitFor(host, '__qa.csv !== null', 4000);
  const q1 = await qa(host);
  const csv = q1.csv || '';
  const lines = csv.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
  T('US-11 Tải CSV → có BOM UTF-8, dòng đầu "Thời gian","Mã phòng","Số câu","Câu hỏi","Nội dung"; toast "Đã tải CSV."', !!csvOk && q1.csvBom && csv.charCodeAt(0) === 0xFEFF && lines[0] === '"Thời gian","Mã phòng","Số câu","Câu hỏi","Nội dung"' && (await text(host, '#toast')) === TXT.csvDone, lines[0]);
  T('US-11 CSV đủ ' + answersOf(code).length + ' dòng dữ liệu, KHÔNG có deviceId, có câu hỏi, xuống dòng CRLF', lines.length - 1 === answersOf(code).length && !csv.includes(dev1) && !csv.includes(dev2) && !csv.includes('qadevice') && csv.includes('"' + Q3[0] + '"') && csv.includes('\r\n'), lines.length - 1 + ' dòng');
  T("US-11 CSV: ô bắt đầu = có ' phía trước (chống Excel chạy công thức), ô có xuống dòng được bọc \"…\"", /"'=HYPERLINK\(""http:\/\/evil"",""bấm""\)"/.test(csv) && csv.includes('"' + LONG_280.replace(/"/g, '""') + '"'), (csv.match(/"'[^"]*HYPERLINK[^\n]*/) || ['không thấy'])[0].slice(0, 80));
  T('US-11 tên file tra-loi-an-danh-<mã>-<yyyyMMdd-HHmm>.csv', new RegExp('^tra-loi-an-danh-' + code + '-\\d{8}-\\d{4}\\.csv$').test(q1.csvName), q1.csvName);
  T('US-11 menu đóng sau khi tải', (await prop(host, '#data-menu', 'open')) === false);

  /* --- US-8 một máy đóng trang → số người giảm (TTL test 10 s) --- */
  await j2.close(); pagesOpen.splice(pagesOpen.indexOf(j2), 1);
  const tDrop = Date.now();
  const dropped = await waitFor(host, "document.getElementById('count-participants').textContent.includes('2 người')", (PRESENCE_TTL_TEST + 8) * 1000, 300);
  T('US-8 một máy đóng trang → sau TTL (' + PRESENCE_TTL_TEST + ' s trong test, 60 s thật) số người giảm còn 2', !!dropped, 'sau ' + Math.round((Date.now() - tDrop) / 100) / 10 + ' s');

  /* --- US-10 Kết thúc phòng (xác nhận) --- */
  await host.click('#btn-close');
  const confirmShown = await waitVisible(host, '#confirm', 1000);
  T('US-10 Kết thúc phòng → hộp xác nhận nguyên văn + nút "Tôi hiểu, kết thúc", focus ở "Để sau", không đỏ', !!confirmShown && (await text(host, '#confirm-text')) === TXT.confirmClose && (await text(host, '#btn-confirm-yes')) === TXT.confirmCloseYes && (await text(host, '#confirm-title')) === 'Kết thúc phòng ' + code + '?' && (await host.evaluate('document.activeElement.id')) === 'btn-confirm-no' && (await host.evaluate("getComputedStyle(document.getElementById('btn-confirm-yes')).backgroundColor")) === 'rgb(31, 58, 95)', await text(host, '#confirm-text'));
  await host.evaluate('document.activeElement && document.activeElement.blur(); true');
  await host.key('Space');
  await host.key('ArrowRight');
  T('US-9 Space / → khi hộp xác nhận mở (focus không ở nút) → không Tiếp, không đóng hộp', (await counts(host)).cards.length === 5 && (await isVisible(host, '#confirm')));
  await host.evaluate("document.getElementById('btn-confirm-no').focus(); true");
  await host.key('Tab');
  T('US-10 Tab trong hộp xác nhận xoay giữa hai nút (bẫy focus)', (await host.evaluate('document.activeElement.id')) === 'btn-confirm-yes');
  await host.key('Escape');
  T('US-10 Esc đóng hộp xác nhận, focus về nút Kết thúc', !(await isVisible(host, '#confirm')) && (await host.evaluate('document.activeElement.id')) === 'btn-close');
  await host.click('#btn-close');
  await waitVisible(host, '#confirm', 1000);
  const tClose = Date.now();
  await host.click('#btn-confirm-yes');
  const endedOk = await waitVisible(host, '#scr-ended', 4000);
  const total = answersOf(code).length;
  T('US-10 "Tôi hiểu, kết thúc" → màn "Cám ơn cả lớp" + "' + total + ' câu trả lời cho 3 câu hỏi."', !!endedOk && (await text(host, '#ended-title')) === TXT.endedHost && (await text(host, '#ended-summary')) === total + ' câu trả lời cho 3 câu hỏi.' && roomRow(code)[4] === 'closed', await text(host, '#ended-summary'));
  T('US-10 focus vào "Cám ơn cả lớp"', (await host.evaluate('document.activeElement.id')) === 'ended-title');
  const thanks1 = await waitFor(j1, "!document.getElementById('scr-closed').hidden", 7000);
  const dtThanks = Date.now() - tClose;
  s1 = await joinState(j1);
  T('US-10 điện thoại → "Cám ơn bạn · Buổi hôm nay đã xong…" trong ≤ 5 s, không ô gõ', !!thanks1 && dtThanks <= 5000 && s1.closedTitle === TXT.thanksTitle && s1.closedLead === TXT.thanksLead && !(await isVisible(j1, '#answer')), dtThanks + ' ms ' + s1.closedTitle);
  T('US-10 máy đang gõ (j3) cũng thấy cám ơn', !!(await waitFor(j3, "!document.getElementById('scr-closed').hidden", 7000)));
  const postCloseSubmit = await postAnswer(code, 'qadevice00000009', 3, 'gửi sau khi đóng');
  T('US-10 phòng đã đóng → không gửi thêm được (room_closed), dữ liệu còn nguyên', postCloseSubmit.error === 'room_closed' && answersOf(code).length === total);
  /* F5 host sau khi đóng */
  await host.reload();
  const endedAgain = await waitVisible(host, '#scr-ended', 5000);
  T('F5 host sau khi phòng đóng → vẫn màn "Cám ơn cả lớp" (điểm lệch dev đã báo), vẫn tải CSV được', !!endedAgain && (await isVisible(host, '#btn-csv-end')), await host.evaluate("['scr-key','scr-create','scr-stage','scr-ended'].filter(id => !document.getElementById(id).hidden).join()"));
  await host.click('#btn-csv-end');
  T('US-11 Tải CSV ở màn kết → có file, đủ dòng', !!(await waitFor(host, '__qa.csv !== null', 4000)) && ((await qa(host)).csv.split('\r\n').filter(Boolean).length - 1) === total);

  /* --- US-11 Xóa toàn bộ phòng: bấm hai lần trong 10 s --- */
  await host.click('#btn-delete-end');
  await waitVisible(host, '#confirm', 1000);
  const delText = await text(host, '#btn-confirm-yes');
  const delBox = await host.evaluate("(() => { const b = document.getElementById('btn-confirm-yes'); return { bg: getComputedStyle(b).backgroundColor, danger: document.getElementById('confirm-box').classList.contains('danger'), title: document.getElementById('confirm-title').textContent, text: document.getElementById('confirm-text').textContent }; })()");
  T('US-11 Xóa toàn bộ phòng → hộp đỏ, nút "Tôi hiểu, xóa toàn bộ (10)" đếm ngược, nội dung nhắc tải CSV', /^Tôi hiểu, xóa toàn bộ \((9|10)\)$/.test(delText) && delBox.bg === 'rgb(179, 38, 30)' && delBox.danger && delBox.title === 'Xóa toàn bộ phòng ' + code + '?' && delBox.text.includes(total + ' câu trả lời') && delBox.text.includes('Chưa tải CSV thì tải trước nhé.'), JSON.stringify([delText, delBox]));
  await sleep(10600);
  T('US-11 không bấm lần hai trong 10 s → hộp tự đóng, không xóa', !(await isVisible(host, '#confirm')) && !!roomRow(code));
  await host.click('#btn-delete-end');
  await waitVisible(host, '#confirm', 1000);
  await holdRequests(host, '127.0.0.1:' + MOCK_PORT);
  await host.click('#btn-confirm-yes');
  await sleep(700); // qua ít nhất 2 nhịp đếm ngược 250 ms
  const delLabel = await text(host, '#btn-confirm-yes');
  T('B-07 khi đang xóa (máy chủ chậm), nhãn "Đang xóa…" giữ nguyên, không bị đếm ngược ghi đè', delLabel === 'Đang xóa…' && (await prop(host, '#btn-confirm-yes', 'disabled')) === true, delLabel);
  await releaseRequests(host);
  const createdAgain = await waitVisible(host, '#scr-create', 4000);
  T('US-11 "Tôi hiểu, xóa toàn bộ" → Rooms/Questions/Answers không còn dòng của mã, về màn tạo phòng, toast "Đã xóa dữ liệu phòng ' + code + '."', !!createdAgain && !roomRow(code) && sheet().questions.filter(r => r[0] === code).length === 0 && answersOf(code).length === 0 && (await text(host, '#toast')) === TXT.deleted(code), await text(host, '#toast'));
  T('US-11 localStorage host không còn tlad_host (vẫn còn khóa)', (await host.evaluate("localStorage.getItem('tlad_host')")) === null && (await host.evaluate("localStorage.getItem('tlad_host_key')")) === HOST_KEY);
  const del2 = await api({ action: 'deleteRoom', key: HOST_KEY, room: code });
  T('US-11 xóa phòng lần hai (API) → vẫn success với số 0, không lỗi', del2.result === 'success' && del2.deleted.rooms === 0 && del2.deleted.answers === 0, JSON.stringify(del2));
  T('Toàn kịch bản: không alert/confirm/prompt của trình duyệt ở host và join', (await qa(host)).alerts === 0 && (await qa(j1)).alerts === 0 && (await qa(j3)).alerts === 0);
  checkConsole([host, j1, j3], 'main');
}

/* ================= KỊCH BẢN enter: gõ mã, không tìm thấy, đã kết thúc, bị xóa, khóa sai ================= */
async function scenarioEnter() {
  const code = await apiCreateRoom(Q3.slice(0, 2));
  const j = await openPage('join');
  await j.navigate(BASE + 'index.html');
  await waitVisible(j, '#scr-enter', 3000);
  let s = await joinState(j);
  T('US-1 mở trang không tham số → màn Vào phòng, nút disabled, hint "💡 Gõ đủ 4 số rồi vào nhé.", không autofocus', s.screen === 'scr-enter' && (await prop(j, '#btn-enter', 'disabled')) === true && (await text(j, '#enter-hint')) === '💡 Gõ đủ 4 số rồi vào nhé.' && s.active !== 'room-code', s.active);
  T('US-1 ô mã: inputmode=numeric, maxlength 4, placeholder "Ví dụ 1234"', (await j.evaluate("(() => { const i = document.getElementById('room-code'); return i.getAttribute('inputmode') === 'numeric' && i.maxLength === 4 && i.placeholder === 'Ví dụ 1234' && i.getAttribute('pattern') === '[0-9]*'; })()")));
  T('US-1 localStorage lúc này chỉ có tlad_device', JSON.stringify(await lsKeys(j)) === JSON.stringify(['tlad_device']), JSON.stringify(await lsKeys(j)));
  await j.evaluate("document.getElementById('room-code').focus(); true");
  for (const ch of [' ', '9', ' ', '9', 'a', '9', ' ', '9', ' ']) await j.type(ch);
  s = await joinState(j);
  T('US-1 gõ từng ký tự " 9 9a9 9 " → tự bỏ khoảng trắng và chữ: "9999", hint đủ, nút .ready', s.code === '9999' && (await text(j, '#enter-hint')) === '✨ Đủ rồi, bạn bấm vào phòng nhé.' && (await prop(j, '#btn-enter', 'disabled')) === false, s.code);
  await j.evaluate("(() => { const i = document.getElementById('room-code'); i.focus(); i.value = ''; i.dispatchEvent(new Event('input')); return true; })()");
  await j.type(' 12 34');
  const pasted = (await joinState(j)).code;
  T('B-03 chèn cả cụm " 12 34" (insertText, 6 ký tự có khoảng trắng) vào ô → "1234"', pasted === '1234', 'ra "' + pasted + '"');
  await j.evaluate("(() => { const i = document.getElementById('room-code'); i.focus(); i.value = ''; i.dispatchEvent(new Event('input')); return true; })()");
  const pasted2 = await j.evaluate("(() => { const i = document.getElementById('room-code'); const dt = new DataTransfer(); dt.setData('text/plain', ' 56 78 '); i.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return i.value; })()");
  T('B-03 sự kiện paste " 56 78 " → "5678", nút sẵn sàng', pasted2 === '5678' && (await prop(j, '#btn-enter', 'disabled')) === false, 'ra "' + pasted2 + '"');
  await j.evaluate("(() => { const i = document.getElementById('room-code'); i.focus(); i.value = '12'; i.dispatchEvent(new Event('input')); return true; })()");
  await j.type('3a4');
  T('B-03 chèn "3a4" sau "12" → "1234" (giữ vị trí con trỏ)', (await joinState(j)).code === '1234', (await joinState(j)).code);
  await j.evaluate("(() => { const i = document.getElementById('room-code'); i.focus(); i.value = ''; i.dispatchEvent(new Event('input')); return true; })()");
  await j.type('9999');
  await j.click('#btn-enter');
  const nf = await waitFor(j, "document.getElementById('enter-error').textContent.length > 0", 4000);
  await sleep(350); // transition color .2s
  s = await joinState(j);
  const nfColor = await j.evaluate("getComputedStyle(document.getElementById('enter-error')).color");
  T('US-1 mã 9999 không tồn tại → "Mình không tìm thấy phòng này…", ở lại màn nhập mã, giữ mã, màu cam ấm', !!nf && s.enterErr === TXT.notFound && s.screen === 'scr-enter' && s.code === '9999' && nfColor === 'rgb(154, 90, 34)', s.enterErr + ' ' + nfColor);
  T('US-1 không lộ danh sách phòng khác (trang không chứa mã phòng đang mở)', !(await j.evaluate('document.body.innerText')).includes(code));
  await j.evaluate("(() => { const i = document.getElementById('room-code'); i.focus(); i.value = ''; i.dispatchEvent(new Event('input')); return true; })()");
  await j.type(code.slice(0, 3));
  T('US-1 3 số → nút disabled lại, lỗi cũ biến mất', (await prop(j, '#btn-enter', 'disabled')) === true && (await text(j, '#enter-error')) === '');
  await j.type(code.slice(3));
  await j.key('Enter');
  const entered = await waitVisible(j, '#scr-room', 4000);
  s = await joinState(j);
  T('US-1 gõ mã đúng + Enter → vào phòng, câu 1/2', !!entered && s.q === Q3[0] && s.label === 'Câu 1/2', s.label);
  T('US-1 localStorage: tlad_join.room = mã vừa vào', (await j.evaluate("JSON.parse(localStorage.getItem('tlad_join')).room")) === code);
  /* phòng bị xóa khi đang mở */
  await api({ action: 'deleteRoom', key: HOST_KEY, room: code });
  const tDel = Date.now();
  const gone = await waitFor(j, "!document.getElementById('scr-closed').hidden", 9000);
  s = await joinState(j);
  T('US-11 phòng bị xóa khi người tham gia còn mở → "Phòng này đã kết thúc · Cám ơn bạn đã tham gia." không vỡ, không ô gõ', !!gone && s.closedTitle === TXT.endedTitle && s.closedLead === TXT.endedLead && !(await isVisible(j, '#answer')), (Date.now() - tDel) + ' ms ' + s.closedTitle);
  T('US-11 phòng bị xóa: không hiện hình cám ơn (biến thể "đã kết thúc")', (await prop(j, '#closed-illu', 'hidden')) === true);
  /* phòng đã kết thúc: vào bằng mã và QR */
  const code2 = await apiCreateRoom(['Câu hỏi của phòng đã đóng']);
  await api({ action: 'closeRoom', key: HOST_KEY, room: code2 });
  await j.navigate(JOIN_URL(code2));
  const closedByQr = await waitVisible(j, '#scr-closed', 4000);
  s = await joinState(j);
  T('US-1 phòng đã kết thúc, vào bằng QR → "Phòng này đã kết thúc. Cám ơn bạn đã tham gia." không ô gõ', !!closedByQr && s.closedTitle === TXT.endedTitle && s.closedLead === TXT.endedLead && !(await isVisible(j, '#answer')) && !(await isVisible(j, '#room-code')), s.closedTitle);
  await j.navigate(BASE + 'index.html');
  await waitVisible(j, '#scr-enter', 3000);
  await focusType(j, '#room-code', code2);
  await j.click('#btn-enter');
  T('US-1 phòng đã kết thúc, vào bằng mã → cùng màn kết thúc', !!(await waitVisible(j, '#scr-closed', 4000)) && (await text(j, '#closed-title')) === TXT.endedTitle);
  /* QR phòng không tồn tại */
  await j.navigate(JOIN_URL('0000'));
  const nf2 = await waitFor(j, "!document.getElementById('scr-enter').hidden && document.getElementById('enter-error').textContent.length > 0", 4000);
  s = await joinState(j);
  T('US-1 QR tới phòng không tồn tại → về màn nhập mã, mã điền sẵn "0000" để sửa, câu không tìm thấy', !!nf2 && s.code === '0000' && s.enterErr === TXT.notFound, JSON.stringify([s.code, s.enterErr]));
  T('US-1 QR mã sai dạng (?room=12ab) → không vỡ, về màn nhập mã', await (async () => { await j.navigate(BASE + 'index.html?room=12ab'); await waitVisible(j, '#scr-enter', 3000); return (await joinState(j)).screen === 'scr-enter'; })());
  /* --- US-7 khóa người dẫn sai: H0 và màn tạo --- */
  const h = await openPage('host');
  await h.navigate(HOST_URL);
  await waitVisible(h, '#scr-key', 3000);
  T('US-7 host.html không khóa, máy chưa nhớ → màn Khóa người dẫn, nút disabled, "Không chiếu màn này lên lớp."', (await prop(h, '#btn-key', 'disabled')) === true && (await h.evaluate('document.body.innerText')).includes('Không chiếu màn này lên lớp.'));
  await focusType(h, '#host-key', 'sai-khoa-nguoi-dan-123456');
  T('US-7 ô khóa type=password, "Hiện khóa" đổi sang text', (await prop(h, '#host-key', 'type')) === 'password' && await (async () => { await h.click('#key-show'); return (await prop(h, '#host-key', 'type')) === 'text'; })());
  await h.click('#btn-key');
  const bad = await waitFor(h, "document.getElementById('key-error').textContent.length > 0", 4000);
  T('US-7 khóa sai → "Mình chưa nhận ra bạn là người dẫn. Kiểm tra lại link nhé.", ở lại H0, giữ chữ', !!bad && (await text(h, '#key-error')) === TXT.keyBad && (await isVisible(h, '#scr-key')) && (await prop(h, '#host-key', 'value')) === 'sai-khoa-nguoi-dan-123456', await text(h, '#key-error'));
  T('US-7 khóa sai không được lưu', (await h.evaluate("localStorage.getItem('tlad_host_key')")) === null);
  await h.evaluate("(() => { const i = document.getElementById('host-key'); i.focus(); i.value = ''; i.dispatchEvent(new Event('input')); return true; })()");
  await h.type(HOST_KEY);
  await h.key('Enter');
  T('US-7 khóa đúng + Enter → sang màn tạo phòng, khóa được nhớ', !!(await waitVisible(h, '#scr-create', 4000)) && (await h.evaluate("localStorage.getItem('tlad_host_key')")) === HOST_KEY);
  /* khóa sai qua ?key= rồi tạo phòng */
  await h.navigate(HOST_URL + '?key=khoa-sai-trong-link-0000');
  await waitVisible(h, '#scr-create', 3000);
  await focusType(h, '#questions', 'Một câu hỏi');
  await h.click('#btn-create');
  const badCreate = await waitFor(h, "!document.getElementById('create-error').hidden", 4000);
  T('US-7 link ?key= sai → tạo phòng bị từ chối, màn hiện "Mình chưa nhận ra bạn là người dẫn…" + link "Nhập khóa khác", giữ câu hỏi đã gõ', !!badCreate && (await text(h, '#create-error')).startsWith(TXT.keyBad) && (await isVisible(h, '#create-error [data-act="key-other"]')) && (await prop(h, '#questions', 'value')) === 'Một câu hỏi', await text(h, '#create-error'));
  T('US-7 tab Rooms không có phòng mới từ khóa sai', !sheet().rooms.some(r => sheet().questions.some(q => q[0] === r[0] && q[2] === 'Một câu hỏi')));
  await h.click('#create-error [data-act="key-other"]');
  T('US-7 "Nhập khóa khác" → về H0, khóa sai bị xóa', !!(await waitVisible(h, '#scr-key', 2000)) && (await h.evaluate("localStorage.getItem('tlad_host_key')")) === null);
  await h.navigate(HOST_URL + '?key=' + HOST_KEY);
  await waitVisible(h, '#scr-create', 3000);
  await h.evaluate("(() => { const t = document.getElementById('questions'); t.value = Array.from({ length: 51 }, (_, i) => 'Câu ' + (i + 1)).join(String.fromCharCode(10)); t.dispatchEvent(new Event('input')); return true; })()");
  T('B-08 51 câu → hint "Nhiều hơn 50 câu rồi. Bớt lại còn 50 câu nhé.", nút disabled, không cắt lặng', (await text(h, '#create-hint')) === '💡 Nhiều hơn 50 câu rồi. Bớt lại còn 50 câu nhé.' && (await prop(h, '#btn-create', 'disabled')) === true, await text(h, '#create-hint'));
  await h.evaluate("(() => { const t = document.getElementById('questions'); t.value = 'Câu ngắn' + String.fromCharCode(10) + 'x'.repeat(501); t.dispatchEvent(new Event('input')); return true; })()");
  T('B-08 câu số 2 dài 501 ký tự → hint "Câu số 2 dài hơn 500 ký tự…", nút disabled', (await text(h, '#create-hint')) === '💡 Câu số 2 dài hơn 500 ký tự. Rút gọn một chút nhé.' && (await prop(h, '#btn-create', 'disabled')) === true, await text(h, '#create-hint'));
  await h.evaluate("(() => { const t = document.getElementById('questions'); t.value = 'Câu ngắn' + String.fromCharCode(10) + 'x'.repeat(500); t.dispatchEvent(new Event('input')); return true; })()");
  T('B-08 đúng 500 ký tự → nút mở lại', (await prop(h, '#btn-create', 'disabled')) === false);
  T('API: getState không khóa → host_key_invalid, không lộ câu trả lời', (await api({ action: 'getState', room: code2, since: 0 })).error === 'host_key_invalid');
  T('API: GET không action → public_read_disabled', (await (await fetch(MOCK_URL + '/')).json()).error === 'public_read_disabled');
  T('Không alert ở hai trang', (await qa(j)).alerts === 0 && (await qa(h)).alerts === 0);
  checkConsole([j, h], 'enter');
}

/* ================= KỊCH BẢN offline: mất mạng khi gửi / khi chờ, gửi lại, trùng sau F5 ================= */
async function scenarioOffline() {
  const code = await apiCreateRoom(Q3.slice(0, 2));
  const j = await joinOpen(code);
  T('(chuẩn bị) vào phòng', (await joinState(j)).screen === 'scr-room');
  const OFF = { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
  const ON = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
  /* mất mạng khi chờ */
  await j.send('Network.emulateNetworkConditions', OFF);
  const tOff = Date.now();
  const reconnect = await waitFor(j, "!document.querySelector('#scr-room #net-status').hidden", 12000, 200);
  let s = await joinState(j);
  T('US-5 mất mạng khi chờ → dòng nhỏ "Đang kết nối lại…", trang không vỡ, vẫn ở màn trả lời', !!reconnect && s.screen === 'scr-room' && (await text(j, '#scr-room #net-status')) === TXT.reconnect, (Date.now() - tOff) + ' ms');
  const warnsOff = (await qa(j)).warns;
  T('US-5 poll thất bại chỉ console.warn (có "heartbeat thất bại"), không console.error', warnsOff.some(w => /heartbeat thất bại/.test(w)) && j.consoleErrors.length === 0, warnsOff.slice(-1)[0]);
  /* mất mạng khi gửi */
  const DRAFT = 'câu này gõ lúc mất mạng, đừng mất nhé';
  await focusType(j, '#answer', DRAFT);
  const tSend = Date.now();
  await j.click('#btn-send');
  const failShown = await waitVisible(j, '#send-error', 9000);
  const dtFail = Date.now() - tSend;
  s = await joinState(j);
  await sleep(350);
  const errColor = await j.evaluate("getComputedStyle(document.getElementById('send-error')).color");
  T('US-5 tắt mạng + Gửi › → ≤ 8 s hiện "Chưa gửi được. Mạng hơi chậm, bạn thử lại nhé." + nút "Gửi lại"; chữ còn nguyên; không alert', !!failShown && dtFail <= 8000 && s.sendErrText === TXT.sendFail && s.btn === 'Gửi lại' && !s.btnDisabled && s.draft === DRAFT && (await qa(j)).alerts === 0, dtFail + ' ms ' + JSON.stringify([s.btn, s.draft]));
  T('US-5 hộp lỗi màu cam ấm, không đỏ chói; focus về nút Gửi lại', errColor === 'rgb(154, 90, 34)' && s.active === 'btn-send', errColor + ' ' + s.active);
  T('US-5 lúc này Sheet chưa có dòng nào của phòng', answersOf(code).length === 0);
  /* bật mạng lại */
  await j.send('Network.emulateNetworkConditions', ON);
  const back = await waitFor(j, "document.querySelector('#scr-room #net-status').hidden", 12000, 200);
  T('US-5 có mạng lại → "Đang kết nối lại…" tự hết', !!back, back ? 'ok' : 'vẫn hiện sau 12 s');
  await j.click('#btn-send');
  const sentOk = await waitVisible(j, '#sent', 4000);
  s = await joinState(j);
  const dev = await deviceOf(j);
  T('US-5 bấm "Gửi lại" → Đã gửi ✓ như US-2, Sheet đúng một dòng', !!sentOk && s.sentBody === DRAFT && answersOf(code).length === 1 && answersOf(code)[0][3] === dev && answersOf(code)[0][4] === DRAFT, answersOf(code).length + ' dòng');
  /* trùng sau F5 (store quên answered nhưng device giữ) */
  await j.reload();
  await waitVisible(j, '#scr-room', 4000);
  s = await joinState(j);
  T('US-2 F5 sau khi gửi → vẫn "Đã gửi ✓" (app nhớ), hộp lặp câu, tick tĩnh', s.sent && s.sentBody === DRAFT && (await j.evaluate("document.querySelector('#sent .success-checkmark').classList.contains('still')")), JSON.stringify([s.sent, s.sentBody]));
  await j.evaluate("(() => { const jn = JSON.parse(localStorage.getItem('tlad_join')); jn.answered = {}; localStorage.setItem('tlad_join', JSON.stringify(jn)); return true; })()");
  await j.reload();
  await waitVisible(j, '#scr-room', 4000);
  await focusType(j, '#answer', 'gửi lần hai cho cùng câu');
  await waitFor(j, "!document.getElementById('btn-send').disabled", 1500);
  await j.click('#btn-send');
  const dupShown = await waitVisible(j, '#sent', 4000);
  s = await joinState(j);
  T('US-2 gửi lại cho cùng câu sau F5 (máy quên) → bị từ chối trùng: "Bạn đã gửi câu này rồi. Chờ câu tiếp theo nhé.", Sheet vẫn một dòng', !!dupShown && s.sentNote === TXT.dup && answersOf(code).length === 1 && answersOf(code)[0][4] === DRAFT, s.sentNote + ' / ' + answersOf(code).length + ' dòng');
  T('B-06 bị từ chối trùng khi máy không còn nhớ chữ → ẩn hộp "Câu bạn vừa gửi" (không hiện chữ sai)', !s.sentBoxVisible, 'hộp hiện: ' + s.sentBoxVisible + ' "' + s.sentBody + '"');
  /* busy → tự gửi lại một lần (API ở ranh giới client, mock không có cờ busy theo request → kiểm bằng stub fetch) */
  const busyFlow = await j.evaluate(`(async () => { const of = window.fetch; let n = 0; window.fetch = (u, i) => { n++; if (n === 1) return Promise.resolve(new Response(JSON.stringify({ result: 'error', error: 'busy' }), { headers: { 'Content-Type': 'application/json' } })); return of(u, i); };
    const t0 = performance.now(); const r = await APP_API.submitAnswer({ room: ${JSON.stringify(code)}, device: localStorage.getItem('tlad_device'), q: 1, text: 'x' }); window.fetch = of; return { n, err: r.error, dt: Math.round(performance.now() - t0) }; })()`);
  T('API client: máy chủ trả busy → tự gửi lại một lần sau 1,5–2,5 s (lần hai: already_answered)', busyFlow.n === 2 && busyFlow.err === 'already_answered' && busyFlow.dt >= 1400 && busyFlow.dt <= 3500, JSON.stringify(busyFlow));
  T('Không alert', (await qa(j)).alerts === 0);
  checkConsole([j], 'offline');
}

/* ================= KỊCH BẢN xss: nội dung có HTML/script lên màn chiếu ================= */
async function scenarioXss() {
  const host = await hostOpen();
  const { code } = await createRoom(host, ['<b>Câu hỏi</b> có <i>HTML</i> & "nháy"']);
  T('XSS: câu hỏi có HTML hiện đúng chữ trên màn chiếu, không tạo <b>', (await text(host, '#stage-q-text')) === '<b>Câu hỏi</b> có <i>HTML</i> & "nháy"' && (await host.evaluate("document.querySelector('#stage-q-text b, #stage-q-text i') === null")));
  const j = await joinOpen(code);
  T('XSS: câu hỏi có HTML hiện đúng chữ trên điện thoại', (await text(j, '#q-text')) === '<b>Câu hỏi</b> có <i>HTML</i> & "nháy"' && (await j.evaluate("document.querySelector('#q-text b') === null")));
  const P1 = '<img src=x onerror=alert(1)>';
  const P2 = '<script>alert(1)</script>';
  const P3 = '"><svg onload=alert(1)><li data-id="x';
  const P4 = '=1+1 công thức';
  const P5 = 'a'.repeat(280);
  await joinSend(j, P1);
  const s = await joinState(j);
  T('XSS: hộp "Câu bạn vừa gửi" hiện đúng chữ, không tạo <img>', s.sentBody === P1 && (await j.evaluate("document.querySelector('#sent-body img') === null")) && (await j.evaluate("document.getElementById('sent-body').innerHTML")) === '&lt;img src=x onerror=alert(1)&gt;');
  await postAnswer(code, 'qadevice00000011', 1, P2);
  await postAnswer(code, 'qadevice00000012', 1, P3);
  await postAnswer(code, 'qadevice00000013', 1, P4);
  await postAnswer(code, 'qadevice00000014', 1, P5);
  await waitFor(host, "document.getElementById('count-answers').textContent.includes('5 câu')", 6000);
  await host.click('#btn-show-all');
  const c = await counts(host);
  const dom = await host.evaluate("(() => ({ bad: document.querySelectorAll('#cards img, #cards script, #cards svg, #cards b').length, lis: document.querySelectorAll('#cards > li').length, ids: [...document.querySelectorAll('#cards li')].map(l => l.dataset.id), scrollX: document.documentElement.scrollWidth, w: innerWidth, answersX: document.querySelector('.answers').scrollWidth <= document.querySelector('.answers').clientWidth + 1 }))()");
  T('US-2 XSS: 5 card hiện đúng chữ nguyên văn (kể cả <script>, <img onerror>, đóng thẻ sớm)', c.cards.map(x => x.text).join('|') === [P1, P2, P3, "'" + P4, P5].join('|'), JSON.stringify(c.cards.map(x => x.text.slice(0, 40))));
  T('US-2 XSS: không có <img>/<script>/<svg> nào được tạo trong vùng card, đúng 5 <li>, data-id không bị phá', dom.bad === 0 && dom.lis === 5 && dom.ids.every(id => id.startsWith(code + '|1|')), JSON.stringify(dom));
  T('US-2 XSS: không alert nào chạy ở host', (await qa(host)).alerts === 0 && host.consoleErrors.length === 0);
  T('US-2 XSS: không vỡ bố cục (không cuộn ngang; chuỗi 280 chữ không dấu cách vẫn trong card)', dom.scrollX <= dom.w && dom.answersX, JSON.stringify([dom.scrollX, dom.w, dom.answersX]));
  T('R5: Sheet lưu "=1+1" với dấu \' phía trước (safeText), các chuỗi khác nguyên văn', answersOf(code).some(r => r[4] === "'" + P4) && answersOf(code).some(r => r[4] === P2));
  await host.screenshot(path.join(OUT, 'xss-stage.png'));
  checkConsole([host, j], 'xss');
}

/* ================= KỊCH BẢN twotabs: hai tab host cùng phòng (R8) ================= */
async function scenarioTwoTabs() {
  const h1 = await hostOpen();
  const { code } = await createRoom(h1, Q3.slice(0, 1));
  await postAnswer(code, 'qadevice00000021', 1, 'một');
  await postAnswer(code, 'qadevice00000022', 1, 'hai');
  await waitFor(h1, "document.getElementById('count-answers').textContent.includes('2 câu')", 6000);
  await h1.click('#btn-next');
  const h2 = await openPage('host', { contextId: h1.sharedContextId });
  await h2.navigate(HOST_URL);
  const stage2 = await waitFor(h2, "!document.getElementById('scr-stage').hidden && !document.querySelector('.stage-wrap').classList.contains('loading')", 5000);
  const c2 = await counts(h2);
  T('R8 tab host thứ hai mở cùng phòng (nhớ từ localStorage), thấy đúng 1/2 đã hiện', !!stage2 && (await text(h2, '#room-code-big')) === code && c2.s === 'đã hiện 1/2' && c2.cards.length === 1, JSON.stringify([c2.s, c2.cards.length]));
  const overlay1 = await waitVisible(h1, '#tab-overlay', 3000);
  T('R8 tab cũ phủ overlay "Màn dẫn đang mở ở cửa sổ khác" + nút "Dùng cửa sổ này"; tab mới không overlay', !!overlay1 && (await text(h1, '#overlay-title')) === 'Màn dẫn đang mở ở cửa sổ khác' && !(await isVisible(h2, '#tab-overlay')));
  await h1.evaluate('document.activeElement && document.activeElement.blur(); true');
  await h1.key('Space');
  T('R8 tab bị phủ không nhận phím Tiếp', (await counts(h1)).cards.length === 1);
  await h2.evaluate('document.activeElement && document.activeElement.blur(); true');
  await h2.key('Space');
  T('R8 tab mới bấm Tiếp → 2/2', (await counts(h2)).s === 'đã hiện 2/2');
  await h1.click('#btn-claim');
  const overlay2 = await waitVisible(h2, '#tab-overlay', 3000);
  const c1 = await counts(h1);
  T('R8 "Dùng cửa sổ này" ở tab cũ → tab cũ mở lại, đồng bộ reveal 2/2; tab mới bị phủ', !!overlay2 && !(await isVisible(h1, '#tab-overlay')) && c1.s === 'đã hiện 2/2' && c1.cards.length === 2, JSON.stringify([c1.s, c1.cards.length]));
  T('R8 focus về câu hỏi sau khi nhận quyền', (await h1.evaluate('document.activeElement.id')) === 'stage-q-text');
  checkConsole([h1, h2], 'twotabs');
}

/* ================= KỊCH BẢN reduced: prefers-reduced-motion ================= */
async function scenarioReduced() {
  const host = await hostOpen({ reducedMotion: true });
  const { code } = await createRoom(host, Q3.slice(0, 1));
  T('US-9 reduced-motion: --card-in = 0ms', (await host.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--card-in').trim()")) === '0ms');
  await postAnswer(code, 'qadevice00000031', 1, 'card tĩnh');
  await waitFor(host, "document.getElementById('count-answers').textContent.includes('1 câu')", 6000);
  await host.click('#btn-next');
  const card = await host.evaluate("(() => { const li = document.querySelector('#cards li'); const cs = getComputedStyle(li); return { enter: li.classList.contains('enter'), anim: cs.animationName, dur: cs.animationDuration, opacity: cs.opacity, scroll: getComputedStyle(document.querySelector('.answers')).scrollBehavior }; })()");
  T('US-9 reduced-motion: card hiện tĩnh (không class .enter, animation none/0, opacity 1), vùng card scroll auto', !card.enter && (card.anim === 'none' || parseFloat(card.dur) <= 0.01) && card.opacity === '1' && card.scroll === 'auto', JSON.stringify(card));
  const j = await joinOpen(code, { reducedMotion: true });
  const btnAnim = await j.evaluate("(() => { const b = document.getElementById('btn-send'); return getComputedStyle(b).animationName; })()");
  await joinSend(j, 'tick tĩnh');
  const tick = await j.evaluate("(() => { const s = document.querySelector('#sent .success-checkmark'); const c = document.querySelector('#sent .checkmark-circle'); return { still: s.classList.contains('still'), anim: getComputedStyle(s).animationName, dash: getComputedStyle(c).strokeDashoffset, sentAnim: getComputedStyle(document.getElementById('sent')).animationName }; })()");
  T('UX 9 reduced-motion điện thoại: tick tĩnh (vẽ xong ngay), #sent không fadeIn, nút không gentlePulse', tick.still && (tick.anim === 'none') && parseFloat(tick.dash) === 0 && tick.sentAnim === 'none' && btnAnim === 'none', JSON.stringify(tick) + ' btn=' + btnAnim);
  checkConsole([host, j], 'reduced');
}

/* ================= KỊCH BẢN layout: 375px và 1280×720, 15 card dài, chạm ≥ 44px ================= */
async function scenarioLayout() {
  const host = await hostOpen();
  const { code } = await createRoom(host, [Q3[0], 'Một câu hỏi rất dài để thử cỡ chữ .long trên màn chiếu, vượt một trăm hai mươi ký tự cho chắc, xem có xuống dòng đẹp và không tràn ra ngoài khung không nhé.']);
  const stage = await host.evaluate("(() => { const r = s => { const b = document.querySelector(s).getBoundingClientRect(); return { top: b.top, right: b.right, bottom: b.bottom, left: b.left, width: b.width, height: b.height }; }; const fs = s => parseFloat(getComputedStyle(document.querySelector(s)).fontSize); return { w: innerWidth, h: innerHeight, scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight, bodyOverflow: getComputedStyle(document.body).overflow, q: fs('#stage-q-text'), code: fs('#room-code-big'), meta: fs('.qr-panel .stage-meta'), counter: fs('.counter'), qr: r('#qr svg').width, next: r('#btn-next'), bar: r('.control-bar'), qrRect: r('.qr-panel'), ctrl: [...document.querySelectorAll('.control-bar button, .control-bar summary')].filter(b => b.getBoundingClientRect().width > 0).map(b => ({ id: b.id || 'summary', h: b.getBoundingClientRect().height, bottom: b.getBoundingClientRect().bottom, visible: true })), answersArea: Math.round(document.querySelector('.answers').getBoundingClientRect().height) }; })()");
  T('US-8 1280×720: không cuộn ngang, không cuộn dọc cả trang (chỉ vùng card cuộn)', stage.w === 1280 && stage.scrollW <= 1280 && stage.scrollH <= 720 && stage.bodyOverflow === 'hidden', JSON.stringify([stage.scrollW, stage.scrollH, stage.bodyOverflow]));
  T('US-8 cỡ chữ: câu hỏi ≥ 40px, mã phòng ≥ 56px, "Quét để vào" ≥ 20px, thanh đếm ≥ 20px, QR ≥ 160px', stage.q >= 40 && stage.code >= 56 && stage.meta >= 20 && stage.counter >= 20 && stage.qr >= 160, JSON.stringify({ q: stage.q, code: stage.code, meta: stage.meta, counter: stage.counter, qr: stage.qr }));
  note('Vùng card ở 720p cao ' + stage.answersArea + 'px (UX chốt rail 300px + câu hỏi 56px; card dài dùng .long một cột để nằm trọn).');
  T('US-8 QR ở nửa trên màn (không bị đầu người che)', stage.qrRect.top < 360 && stage.qrRect.right <= 1280, JSON.stringify({ top: Math.round(stage.qrRect.top), right: Math.round(stage.qrRect.right), bottom: Math.round(stage.qrRect.bottom) }));
  T('US-8 mọi nút thanh điều khiển ≥ 44px, nằm trong màn (bottom ≤ 720), Tiếp › ≥ 56px và ≥ 200px rộng', stage.ctrl.every(b => b.h >= 44 && b.bottom <= 720 && b.visible) && stage.next.height >= 56 && stage.next.width >= 200, JSON.stringify(stage.ctrl.map(b => b.id + ':' + Math.round(b.h) + '/' + Math.round(b.bottom))));
  await hostStepQ(host, 1);
  const longQ = await host.evaluate("(() => { const q = document.getElementById('stage-q-text'); return { long: q.classList.contains('long'), fs: parseFloat(getComputedStyle(q).fontSize), overflow: q.scrollWidth <= q.clientWidth + 1, scrollW: document.documentElement.scrollWidth }; })()");
  T('UX: câu hỏi > 120 ký tự → .long (chữ nhỏ hơn, vẫn ≥ 40px), không tràn ngang', longQ.long && longQ.fs >= 40 && longQ.fs < 56 && longQ.overflow && longQ.scrollW <= 1280, JSON.stringify(longQ));
  await hostStepQ(host, -1);
  /* 15 card dài */
  for (let i = 0; i < 15; i++) await postAnswer(code, 'qadevice000000' + String(40 + i), 1, 'Card ' + (i + 1) + ' · ' + LONG_280.slice(0, 272 - String(i + 1).length));
  for (let i = 0; i < 3; i++) await postAnswer(code, 'qadevice000000' + String(60 + i), 1, 'ngắn ' + (i + 1));
  await waitFor(host, "document.getElementById('count-answers').textContent.includes('18 câu')", 6000);
  await host.click('#btn-show-all');
  await sleep(700);
  const grid = await host.evaluate("(() => { const a = document.querySelector('.answers'); const ar = a.getBoundingClientRect(); const lis = [...document.querySelectorAll('#cards li')]; const longs = lis.filter(l => l.classList.contains('long')), shorts = lis.filter(l => !l.classList.contains('long')); const colsLong = new Set(longs.map(l => Math.round(l.getBoundingClientRect().left))).size; const colsShort = new Set(shorts.map(l => Math.round(l.getBoundingClientRect().left))).size; const fullRow = longs.every(l => l.getBoundingClientRect().width >= a.clientWidth - 12); const maxLongH = Math.max(...longs.map(l => l.getBoundingClientRect().height)); const cols = colsLong; const clipped = lis.filter(l => { const p = l.querySelector('.card-text'); return p.scrollHeight > p.clientHeight + 1 || l.scrollHeight > l.clientHeight + 1 || getComputedStyle(p).textOverflow === 'ellipsis'; }).length; const latest = document.querySelector('#cards li.is-latest').getBoundingClientRect(); const texts = lis.map(l => l.querySelector('.card-text').textContent.length); return { n: lis.length, nLong: longs.length, nShort: shorts.length, colsLong, colsShort, fullRow, maxLongH, clipped, scrollable: a.scrollHeight > a.clientHeight, scrollX: a.scrollWidth <= a.clientWidth + 1, latestInView: latest.top >= ar.top - 1 && latest.bottom <= ar.bottom + 1, latestTopIn: latest.top >= ar.top - 1 && latest.top < ar.bottom, latestH: Math.round(latest.height), areaH: Math.round(ar.height), minLen: Math.min(...texts), docScrollW: document.documentElement.scrollWidth }; })()");
  T('US-9 15 card 280 ký tự (.long) chiếm cả hàng 1 cột + 3 card ngắn 2 cột; không card nào bị cắt/ellipsis; vùng card cuộn dọc, không cuộn ngang', grid.n === 18 && grid.nLong === 15 && grid.nShort === 3 && grid.colsLong === 1 && grid.fullRow && grid.colsShort === 2 && grid.clipped === 0 && grid.scrollable && grid.scrollX && grid.docScrollW <= 1280, JSON.stringify(grid));
  T('B-01 card .long cao nhất (' + grid.maxLongH + 'px) thấp hơn vùng card (' + grid.areaH + 'px)', grid.maxLongH < grid.areaH);
  T('US-9 sau Hiện tất cả, card mới nhất (cuối) được cuộn tới (phần đầu card trong tầm nhìn)', grid.latestTopIn, JSON.stringify({ latestH: grid.latestH, areaH: grid.areaH }));
  T('B-01 sau Hiện tất cả, card mới nhất nằm trọn trong vùng card', grid.latestInView, JSON.stringify({ latestH: grid.latestH, areaH: grid.areaH }));
  await host.screenshot(path.join(OUT, 'layout-15cards.png'));
  await host.click('#btn-hide-all');
  for (let i = 0; i < 18; i++) { await host.evaluate('document.activeElement && document.activeElement.blur(); true'); await host.key('ArrowRight'); await sleep(60); }
  /* chờ cuộn mượt dừng hẳn (máy chậm) thay vì chờ cố định */
  await waitFor(host, "(() => { const a = document.querySelector('.answers'); const t = a.scrollTop; if (window.__qaLastTop === t) { window.__qaStable = (window.__qaStable || 0) + 1; } else { window.__qaStable = 0; } window.__qaLastTop = t; return window.__qaStable >= 4; })()", 4000, 100);
  const seq = await host.evaluate("(() => { const a = document.querySelector('.answers').getBoundingClientRect(); const l = document.querySelector('#cards li.is-latest').getBoundingClientRect(); return { n: document.querySelectorAll('#cards li').length, inView: l.top >= a.top - 1 && l.bottom <= a.bottom + 1, topIn: l.top >= a.top - 1 && l.top < a.bottom, visibleRatio: Math.round(100 * (Math.min(l.bottom, a.bottom) - Math.max(l.top, a.top)) / l.height), scrollTop: document.querySelector('.answers').scrollTop }; })()");
  T('US-9 Tiếp 18 lần: vùng card đã cuộn tới card cuối, card nằm trọn trong tầm nhìn', seq.n === 18 && seq.inView && seq.scrollTop > 0, JSON.stringify(seq));
  await host.screenshot(path.join(OUT, 'layout-15cards-seq.png'));
  /* B-01 hành vi cuộn: lấy mẫu scrollTop của .answers mỗi frame (rAF) quanh thao tác.
     Tiếp › → mượt (nhiều giá trị trung gian); Hiện tất cả → tức thì (nhảy một bước). */
  const startSampler = () => host.evaluate("(() => { const a = document.querySelector('.answers'); window.__qaStop = false; window.__qaScroll = [a.scrollTop]; const f = () => { window.__qaScroll.push(a.scrollTop); if (!window.__qaStop && window.__qaScroll.length < 600) requestAnimationFrame(f); }; requestAnimationFrame(f); return true; })()");
  const readSampler = () => host.evaluate("(() => { window.__qaStop = true; const s = window.__qaScroll; const a = document.querySelector('.answers'); return { distinct: new Set(s.map(v => Math.round(v))).size, first: Math.round(s[0]), last: Math.round(s[s.length - 1]), max: Math.round(a.scrollHeight - a.clientHeight), frames: s.length, cssBehavior: getComputedStyle(a).scrollBehavior }; })()");
  const scrollTopInstant = () => host.evaluate("(() => { const a = document.querySelector('.answers'); a.scrollTo({ top: 0, behavior: 'instant' }); return a.scrollTop; })()");
  await scrollTopInstant();
  await postAnswer(code, 'qadevice00000070', 1, 'card 19 ở cuối danh sách');
  await waitFor(host, "document.getElementById('count-answers').textContent.includes('19 câu')", 6000);
  await startSampler();
  await host.evaluate('document.activeElement && document.activeElement.blur(); true');
  await host.key('ArrowRight');
  await sleep(1500);
  const sm = await readSampler();
  T('B-01 Tiếp › (từ đầu danh sách tới card 19 ở cuối) cuộn MƯỢT: scrollTop đổi dần qua ≥ 4 giá trị, tới cuối', sm.distinct >= 4 && sm.last > sm.first && sm.last >= sm.max - 20, JSON.stringify(sm));
  await scrollTopInstant();
  await startSampler();
  await host.click('#btn-hide-all');
  await host.click('#btn-show-all');
  await sleep(1500);
  const jp = await readSampler();
  T('B-01 Hiện tất cả cuộn TỨC THÌ tới card cuối: scrollTop nhảy một bước (≤ 2 giá trị), không mượt', jp.distinct <= 2 && jp.last >= jp.max - 20, JSON.stringify(jp) + (jp.cssBehavior === 'smooth' ? ' – .answers có CSS scroll-behavior: smooth nên behavior:\'auto\' vẫn mượt; cần \'instant\'' : ''));
  /* 375px */
  const j = await joinOpen(code);
  const measure = async label => {
    const m = await j.evaluate("(() => { const vis = e => !e.hidden && !e.closest('[hidden]') && e.getClientRects().length > 0; const btns = [...document.querySelectorAll('button, a[href], input, textarea, summary')].filter(vis).map(b => ({ id: b.id || b.className.split(' ')[0] || b.tagName, h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width })); return { scrollW: document.documentElement.scrollWidth, w: innerWidth, btns, vh: innerHeight }; })()");
    T('UX 13 375px [' + label + ']: không cuộn ngang', m.scrollW <= m.w, m.scrollW + '/' + m.w);
    T('UX 3 375px [' + label + ']: mọi nút/ô chính ≥ 44px cao (trừ skip-link ẩn và link chữ inline)', m.btns.filter(b => b.id !== 'skip-link' && b.id !== 'link').every(b => b.h >= 44), JSON.stringify(m.btns.map(b => b.id + ':' + Math.round(b.h))));
    return m;
  };
  const m1 = await measure('J1 trả lời');
  const firstScreen = await j.evaluate("(() => { const vh = innerHeight; const at = s => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return b.top >= 0 && b.bottom <= vh; }; return { badge: at('#q-label'), q: at('#q-text'), ta: at('#answer'), note: at('#name-note'), btn: at('#btn-send') }; })()");
  T('UX 3.1 375×667 chưa cuộn thấy: badge câu, câu hỏi, textarea, "Đừng ghi tên…"', firstScreen.badge && firstScreen.q && firstScreen.ta && firstScreen.note, JSON.stringify(firstScreen));
  T('UX: textarea ≥ 120px, chữ 17px (iOS không zoom)', (await j.evaluate("(() => { const a = document.getElementById('answer'); return a.getBoundingClientRect().height >= 120 && parseFloat(getComputedStyle(a).fontSize) >= 17; })()")));
  await j.screenshot(path.join(OUT, 'layout-375-j1.png'), true);
  /* J1 với hộp chuyển câu + lỗi */
  await focusType(j, '#answer', 'đang gõ');
  await hostStepQ(host, 1);
  await waitFor(j, "!document.getElementById('q-changed').hidden", 7000);
  const m1b = await measure('J1 có hộp "Người dẫn vừa chuyển câu"');
  T('B-04 375px: nút "Xóa chữ đang gõ" (link trong hộp nhắc) ≥ 44px', m1b.btns.filter(b => b.id === 'link').length === 1 && m1b.btns.filter(b => b.id === 'link').every(b => b.h >= 44), JSON.stringify(m1b.btns.filter(b => b.id === 'link')));
  await j.screenshot(path.join(OUT, 'layout-375-j1-changed.png'), true);
  await hostStepQ(host, -1);
  await waitFor(j, "document.getElementById('q-label').textContent === 'Câu 1/2'", 7000);
  await j.evaluate("(() => { const a = document.getElementById('answer'); a.value = ''; a.dispatchEvent(new Event('input')); return true; })()");
  await joinSend(j, 'đã gửi để đo J2');
  await measure('J2 đã gửi');
  await j.screenshot(path.join(OUT, 'layout-375-j2.png'), true);
  await j.navigate(BASE + 'index.html');
  await waitVisible(j, '#scr-enter', 3000);
  await measure('J0 vào phòng');
  await api({ action: 'closeRoom', key: HOST_KEY, room: code });
  await j.navigate(JOIN_URL(code));
  await waitVisible(j, '#scr-closed', 4000);
  await measure('J3 kết thúc');
  await j.screenshot(path.join(OUT, 'layout-375-j3.png'), true);
  /* Màn chiếu ở 1000px (laptop nhỏ) không cuộn ngang */
  await host.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 640, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  const small = await host.evaluate("({ scrollW: document.documentElement.scrollWidth, w: innerWidth, screen: ['scr-stage','scr-ended'].filter(id => !document.getElementById(id).hidden).join() })");
  T('Màn dẫn 1024×640 (laptop nhỏ): không cuộn ngang', small.scrollW <= small.w, JSON.stringify(small));
  checkConsole([host, j], 'layout');
}

/* ===== Giải mã QR độc lập bằng OpenCV (tùy chọn) ===== */
async function qrDecodeCheck(host, wantUrl, tag) {
  const py = process.env.QR_PYTHON || 'python';
  const probe = spawnSync(py, ['-c', 'import cv2'], { encoding: 'utf8' });
  if (probe.status !== 0) { note('QR decode độc lập: bỏ qua (không có python+cv2; đặt QR_PYTHON=<python có cv2>)'); return; }
  const r = await host.evaluate("(() => { const b = document.querySelector('#qr').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()");
  const shot = await host.send('Page.captureScreenshot', { format: 'png', clip: { x: r.x - 8, y: r.y - 8, width: r.w + 16, height: r.h + 16, scale: 3 } });
  const file = path.join(OUT, tag + '-qr.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  const dec = spawnSync(py, ['-I', '-c', 'import cv2,sys\nimg=cv2.imread(sys.argv[1])\nd=cv2.QRCodeDetector()\ns,_,_=d.detectAndDecode(img)\nsys.stdout.write(s or "")', file], { encoding: 'utf8' });
  T('US-7 QR giải mã bằng OpenCV (độc lập thư viện vẽ) → đúng link ' + wantUrl, dec.status === 0 && dec.stdout.trim() === wantUrl, 'decode="' + dec.stdout.trim() + '" ' + (dec.stderr || '').slice(0, 100));
}

/* ===== Chạy ===== */
const SCENARIOS = { main: scenarioMain, enter: scenarioEnter, offline: scenarioOffline, xss: scenarioXss, twotabs: scenarioTwoTabs, reduced: scenarioReduced, layout: scenarioLayout };
(async () => {
  const t0 = Date.now();
  mockSrv = await startServer({ port: MOCK_PORT, quiet: true, hostKey: HOST_KEY, presenceTtlSec: PRESENCE_TTL_TEST });
  staticSrv = await startStatic({ port: STATIC_PORT, appDir: APP, mockUrl: MOCK_URL });
  T('Mock trong process ở ' + MOCK_URL + ', static ở ' + BASE + ' (không đụng 8766/8788)', (await (await fetch(MOCK_URL + '/?action=ping')).json()).pong === true && (await fetch(BASE + 'index.html')).status === 200);
  const cfgServed = await (await fetch(BASE + 'js/config.js')).text();
  T('config.js trả về có MOCK: true + MOCK_URL cổng test; file trên đĩa không đổi', cfgServed.includes('MOCK: true') && cfgServed.includes(JSON.stringify(MOCK_URL)) && fs.readFileSync(path.join(APP, 'js/config.js'), 'utf8').includes("MOCK_URL: 'http://localhost:8788'"));
  browser = await launch({ userDataDir: path.join(OUT, 'chrome-ud') });
  for (const name of Object.keys(SCENARIOS)) {
    if (ONLY && !ONLY.includes(name)) continue;
    scenarioName = name;
    console.log('\n=== Kịch bản ' + name + ' ===');
    try { await SCENARIOS[name](); } catch (e) { T('kịch bản chạy trọn (không exception)', false, e && e.stack || e); }
    for (const p of pagesOpen) { try { fs.appendFileSync(path.join(OUT, 'console-' + name + '-' + p.kind + '.log'), p.consoleAll.concat(p.netErrors).join('\n') + '\n'); } catch (e) { /* bỏ qua */ } }
    await closeAll();
  }
  scenarioName = 'tổng';
  T('Không có file dữ liệu nào bị ghi vào thư mục app', !fs.existsSync(path.join(APP, 'tools', 'mock-data.json')) && !fs.existsSync(path.join(APP, 'mock-data.json')));
  fs.writeFileSync(path.join(OUT, 'e2e-results.txt'), results.join('\n') + '\n');
  const pass = results.filter(r => r.startsWith('PASS')).length;
  console.log('\n' + pass + ' PASS, ' + fails + ' FAIL, ' + warns + ' WARN (e2e, ' + Math.round((Date.now() - t0) / 1000) + ' s) → ' + path.join(OUT, 'e2e-results.txt'));
  await shutdown();
  process.exit(fails ? 1 : 0);
})().catch(async e => { console.error('e2e: lỗi khung chạy', e); await shutdown(); process.exit(1); });

async function shutdown() {
  try { await closeAll(); } catch (e) { /* bỏ qua */ }
  if (browser) { try { browser.kill(); } catch (e) { /* bỏ qua */ } }
  if (staticSrv) { try { await staticSrv.close(); } catch (e) { /* bỏ qua */ } }
  if (mockSrv) { try { await mockSrv.close(); } catch (e) { /* bỏ qua */ } }
}
