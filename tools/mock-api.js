/**
 * mock-api.js – giả lập Google Apps Script của app "Trả lời ẩn danh"
 * để frontend và QA chạy local, không cần Sheet thật. Node thuần, không npm.
 *
 * Chạy:   node tools/mock-api.js                  (cổng 8788, khóa người dẫn demo-host-key-0000)
 *         node tools/mock-api.js --slow           (mọi request trễ 2000 ms, để thử timeout 8 s)
 *         node tools/mock-api.js --latency 800    (mọi request trễ 800 ms)
 *         node tools/mock-api.js --flaky          (20 % request bị cắt kết nối, để thử "Gửi lại")
 *         node tools/mock-api.js --fail-rate 0.5  (50 % request bị cắt kết nối)
 *         node tools/mock-api.js --busy           (30 % submitAnswer trả busy, để thử retry)
 *         node tools/mock-api.js --quiet          (không in từng request)
 *         PORT=9000 HOST_KEY=abc node tools/mock-api.js
 *         MOCK_DATA=%TEMP%\tlad-mock.json node tools/mock-api.js   (ghi state ra file; mặc định CHỈ bộ nhớ)
 * Dán vào js/config.js:  MOCK: true, MOCK_URL: 'http://localhost:8788/'
 * Link màn dẫn: http://localhost:8766/host.html?key=demo-host-key-0000
 *
 * Contract y hệt google_apps_script.js (tech design mục 4): cùng thứ tự validate, cùng mã lỗi,
 * cùng shape, JSONP cho GET, Access-Control-Allow-Origin *. "Lock" là hàng đợi tuần tự cho
 * thao tác ghi, mỗi thao tác 30 ms, để load-test thấy đúng hành vi xếp hàng.
 * KHÔNG ghi file vào thư mục dự án (Google Drive đồng bộ gây treo); chỉ ghi khi đặt MOCK_DATA.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

/* ===== Hằng số (khớp google_apps_script.js) ===== */

const ROOM_RE = /^\d{4}$/;
const ROOM_CODE_LENGTH = 4;
const DEVICE_RE = /^[a-z0-9]{8,32}$/;
const ANSWER_MAX = 280;
const QUESTION_MAX = 500;
const QUESTIONS_MAX = 50;
const MAX_ANSWERS_PER_ROOM = 500;
const ROOM_TTL_HOURS = 24;
const DEFAULT_PRESENCE_TTL_SEC = 60;
const ALLOW_PUBLIC_READ = false;
const API_VERSION = '1';
const DEFAULT_HOST_KEY = 'demo-host-key-0000';
const DEFAULT_PORT = 8788;
const DEFAULT_LOCK_MS = 30;
const PRESENCE_MAX_DEVICES = 300;
const DEBUG = process.env.MOCK_DEBUG === '1';   // server_error kèm detail khi chạy local

/* ===== Tiện ích (viết giống script) ===== */

/** Giờ VN (+7, không DST) → 'HH:mm:ss dd/MM/yyyy'. */
function formatDate(ms) {
  const d = new Date(ms + 7 * 3600 * 1000);
  const p = (n) => ('0' + n).slice(-2);
  return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + ' ' +
         p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
}
function parseDate(s) {
  const m = /^(\d\d):(\d\d):(\d\d) (\d\d)\/(\d\d)\/(\d{4})$/.exec(String(s == null ? '' : s));
  if (!m) return NaN;
  return Date.UTC(+m[6], +m[5] - 1, +m[4], +m[1] - 7, +m[2], +m[3]);
}
function len(s) { return String(s).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '_').length; }
function safeText(s) {
  const t = String(s == null ? '' : s);
  const c = t.charCodeAt(0);
  return (/^[=+\-@]/.test(t) || c === 9 || c === 13) ? "'" + t : t;
}
function err(code, extra) { return Object.assign({ result: 'error', error: code }, extra || {}); }
function vRoom(v) { const s = String(v == null ? '' : v).trim(); return ROOM_RE.test(s) ? s : null; }
function vDevice(v) { const s = String(v == null ? '' : v).trim(); return DEVICE_RE.test(s) ? s : null; }
function vInt(v) {
  if (v == null || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return (isFinite(n) && n === Math.floor(n) && n >= 1) ? n : null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ===== "Sheet" + "cache" trong bộ nhớ ===== */

/**
 * Tạo một mock độc lập (test có thể tạo nhiều cái). opts:
 *   hostKey (''/null → host_key_not_set), presenceTtlSec, lockMs, busyRate, now() đồng hồ giả, dataFile.
 */
function createMock(opts) {
  opts = opts || {};
  const now = opts.now || (() => Date.now());
  const hostKey = opts.hostKey === undefined ? DEFAULT_HOST_KEY : opts.hostKey;
  const presenceTtl = opts.presenceTtlSec || DEFAULT_PRESENCE_TTL_SEC;
  const lockMs = opts.lockMs == null ? DEFAULT_LOCK_MS : opts.lockMs;
  const busyRate = opts.busyRate || 0;
  const dataFile = opts.dataFile || '';
  const presenceMax = opts.presenceMaxDevices || PRESENCE_MAX_DEVICES;
  // Hàm sinh mã có thể tiêm (test ép mã trùng); mặc định ngẫu nhiên 4 chữ số
  const randomCode = opts.randomCode || (() => { let s = ''; for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += Math.floor(Math.random() * 10); return s; });

  // Ba "tab", mỗi dòng là mảng đúng thứ tự cột như Sheet
  const sheet = { rooms: [], questions: [], answers: [] };
  const presence = {};   // code → { device: epochSec }
  const answered = {};   // 'room|q|device' → true (cache ak:)

  function load() {
    if (!dataFile) return;
    try {
      const d = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      if (d && Array.isArray(d.rooms)) { sheet.rooms = d.rooms; sheet.questions = d.questions || []; sheet.answers = d.answers || []; }
    } catch (e) { /* chưa có file: bắt đầu trống */ }
  }
  function save() {
    if (!dataFile) return;
    try { fs.writeFileSync(dataFile, JSON.stringify(sheet, null, 1), 'utf8'); }
    catch (e) { console.warn('mock-api: không ghi được ' + dataFile + ': ' + e.message); }
  }

  // Lock giả: hàng đợi tuần tự, mỗi thao tác ghi tốn lockMs
  let chain = Promise.resolve();
  function withLock(fn) {
    const p = chain.then(() => sleep(lockMs)).then(fn);
    chain = p.catch(() => {});
    return p;
  }

  function nowStr() { return formatDate(now()); }
  function isExpired(st) { const t = parseDate(st.createdAt); return !isNaN(t) && now() - t > ROOM_TTL_HOURS * 3600 * 1000; }

  function roomState(code) {
    let row = null;
    for (let i = sheet.rooms.length - 1; i >= 0; i--) if (sheet.rooms[i][0] === code) { row = sheet.rooms[i]; break; }
    if (!row) return null;
    const questions = sheet.questions.filter((q) => q[0] === code).map((q) => ({ index: q[1], text: q[2] })).sort((a, b) => a.index - b.index);
    const st = { code, status: row[4] === 'closed' ? 'closed' : 'open', currentIndex: row[2], questionCount: row[3], createdAt: row[1], questions };
    if (st.status === 'open' && isExpired(st)) st.status = 'closed';
    return st;
  }
  function roomView(st) { return { code: st.code, status: st.status, currentIndex: st.currentIndex, questionCount: st.questionCount, createdAt: st.createdAt }; }
  function currentQuestion(st) {
    if (st.status !== 'open') return null;
    const q = st.questions[st.currentIndex - 1];
    return q ? { index: q.index, text: q.text } : null;
  }
  function answersOf(code) {
    return sheet.answers.filter((r) => r[1] === code).map((r) => ({ id: code + '|' + r[2] + '|' + r[3], q: r[2], text: r[4], at: r[0] }));
  }
  /** Như touchPresence_ của script: bỏ mục quá TTL, quá presenceMax thì bỏ mục cũ nhất. */
  function touchPresence(code, device) {
    const nowSec = Math.floor(now() / 1000);
    const map = presence[code] || {};
    delete map[device];                  // đưa device hiện tại xuống cuối (mới nhất theo thứ tự chèn)
    map[device] = nowSec;
    let keep = Object.entries(map).map(([d, t], i) => [d, t, i]).filter(([, t]) => nowSec - t <= presenceTtl);
    if (keep.length > presenceMax) keep = keep.sort((a, b) => (b[1] - a[1]) || (b[2] - a[2])).slice(0, presenceMax);
    presence[code] = Object.fromEntries(keep.map(([d, t]) => [d, t]));
  }
  function countPresence(code) {
    const nowSec = Math.floor(now() / 1000);
    const map = presence[code] || {};
    let n = 0;
    for (const d in map) if (nowSec - map[d] <= presenceTtl) n++;
    return n;
  }
  function checkHostKey(key) {
    if (!hostKey) return 'host_key_not_set';
    const k = typeof key === 'string' ? key : '';
    if (k.length < 16 || k.length > 64 || k !== hostKey) return 'host_key_invalid';
    return '';
  }

  /* ----- GET ----- */
  function getRoom(p, touch) {
    const code = vRoom(p.room);
    if (!code) return err('room_invalid');
    let device = null;
    if (touch) { device = vDevice(p.device); if (!device) return err('device_invalid'); }
    const st = roomState(code);
    if (!st) return err('room_not_found');
    if (touch && st.status === 'open') touchPresence(code, device);
    return { result: 'success', room: roomView(st), currentQuestion: currentQuestion(st), maxLen: ANSWER_MAX };
  }

  /** params: object thường hoặc URLSearchParams. Đồng bộ. */
  function handleGet(params) {
    const g = (k) => (params && typeof params.get === 'function') ? params.get(k) : (params ? params[k] : null);
    const action = String(g('action') == null ? '' : g('action')).trim();
    if (!action) return ALLOW_PUBLIC_READ ? err('unknown_action') : err('public_read_disabled');
    if (action === 'ping') return { result: 'success', pong: true, version: API_VERSION };
    if (action === 'getRoom') return getRoom({ room: g('room') }, false);
    if (action === 'heartbeat') return getRoom({ room: g('room'), device: g('device') }, true);
    return err('unknown_action');
  }

  /* ----- POST ----- */
  async function submitAnswer(d) {
    const code = vRoom(d.room);
    if (!code) return err('room_invalid');
    const device = vDevice(d.device);
    if (!device) return err('device_invalid');
    const q = vInt(d.q);
    if (!q) return err('question_invalid');
    const text = String(d.text == null ? '' : d.text).trim();
    if (!text) return err('text_required');
    if (len(text) > ANSWER_MAX) return err('text_too_long');
    const st = roomState(code);
    if (!st) return err('room_not_found');
    if (st.status !== 'open') return err('room_closed');
    if (q > st.questionCount) return err('question_invalid');
    if (q !== st.currentIndex) return err('question_changed', { currentIndex: st.currentIndex, currentQuestion: currentQuestion(st) });
    const id = code + '|' + q + '|' + device;
    if (answered[id]) return err('already_answered');
    if (busyRate && Math.random() < busyRate) return err('busy');
    return withLock(() => {
      let count = 0, dup = false;
      for (const r of sheet.answers) {
        if (r[1] !== code) continue;
        count++;
        if (r[2] === q && r[3] === device) dup = true;
      }
      if (dup) { answered[id] = true; return err('already_answered'); }
      if (count >= MAX_ANSWERS_PER_ROOM) return err('room_full');
      const at = nowStr();
      sheet.answers.push([at, code, q, device, safeText(text)]);
      answered[id] = true;
      save();
      return { result: 'success', id, q, at };
    });
  }

  async function createRoom(d) {
    const ke = checkHostKey(d.key);
    if (ke) return err(ke);
    const list = Array.isArray(d.questions) ? d.questions : [];
    const qs = list.map((x) => String(x == null ? '' : x).trim()).filter(Boolean);
    if (!qs.length) return err('questions_required');
    if (qs.length > QUESTIONS_MAX) return err('questions_too_many');
    if (qs.some((t) => len(t) > QUESTION_MAX)) return err('question_too_long');
    return withLock(() => {
      const at = nowStr();
      const used = {};
      for (const r of sheet.rooms) {
        used[r[0]] = true;
        if (r[4] === 'open' && isExpired({ createdAt: r[1] })) { r[4] = 'closed'; r[5] = at; delete presence[r[0]]; }
      }
      let code = null;
      for (let k = 0; k < 20 && !code; k++) {
        const cand = randomCode();
        if (!used[cand]) code = cand;
      }
      if (!code) return err('code_exhausted');
      sheet.rooms.push([code, at, 1, qs.length, 'open', at]);
      const questions = qs.map((t, i) => ({ index: i + 1, text: safeText(t) }));
      questions.forEach((q) => sheet.questions.push([code, q.index, q.text]));
      delete presence[code];
      save();
      return { result: 'success', room: { code, status: 'open', currentIndex: 1, questionCount: qs.length, createdAt: at }, questions };
    });
  }

  function getState(d) {
    const ke = checkHostKey(d.key);
    if (ke) return err(ke);
    const code = vRoom(d.room);
    if (!code) return err('room_invalid');
    const st = roomState(code);
    if (!st) return err('room_not_found');
    let since = Number(d.since);
    since = (isFinite(since) && since >= 0) ? Math.floor(since) : 0;
    const list = answersOf(code);
    const reset = list.length < since;
    return {
      result: 'success', room: roomView(st), questions: st.questions, currentQuestion: currentQuestion(st),
      answersNew: reset ? list : list.slice(since), cursor: list.length, reset,
      counts: { participants: countPresence(code), answersTotal: list.length }
    };
  }

  function findRoomRow(code) {
    for (let i = sheet.rooms.length - 1; i >= 0; i--) if (sheet.rooms[i][0] === code) return sheet.rooms[i];
    return null;
  }

  async function setQuestion(d) {
    const ke = checkHostKey(d.key);
    if (ke) return err(ke);
    const code = vRoom(d.room);
    if (!code) return err('room_invalid');
    const index = vInt(d.index);
    if (!index) return err('question_invalid');
    const st = roomState(code);
    if (!st) return err('room_not_found');
    if (st.status !== 'open') return err('room_closed');
    if (index > st.questionCount) return err('question_invalid');
    return withLock(() => {
      const row = findRoomRow(code);
      if (!row) return err('room_not_found');
      row[2] = index; row[5] = nowStr();
      st.currentIndex = index;
      save();
      return { result: 'success', room: roomView(st), currentQuestion: currentQuestion(st) };
    });
  }

  async function closeRoom(d) {
    const ke = checkHostKey(d.key);
    if (ke) return err(ke);
    const code = vRoom(d.room);
    if (!code) return err('room_invalid');
    const st = roomState(code);
    if (!st) return err('room_not_found');
    return withLock(() => {
      const row = findRoomRow(code);
      if (!row) return err('room_not_found');
      row[4] = 'closed'; row[5] = nowStr();
      st.status = 'closed';
      delete presence[code];
      save();
      return { result: 'success', room: roomView(st), counts: { answersTotal: answersOf(code).length } };
    });
  }

  async function deleteRoom(d) {
    const ke = checkHostKey(d.key);
    if (ke) return err(ke);
    const code = vRoom(d.room);
    if (!code) return err('room_invalid');
    return withLock(() => {
      const before = { rooms: sheet.rooms.length, questions: sheet.questions.length, answers: sheet.answers.length };
      // Xóa khóa "đã trả lời" của phòng trước (như dropAnsweredKeys_), kẻo phòng mới trúng mã chặn device cũ
      sheet.answers.filter((r) => r[1] === code).forEach((r) => { delete answered[code + '|' + r[2] + '|' + r[3]]; });
      sheet.rooms = sheet.rooms.filter((r) => r[0] !== code);
      sheet.questions = sheet.questions.filter((r) => r[0] !== code);
      sheet.answers = sheet.answers.filter((r) => r[1] !== code);
      delete presence[code];
      save();
      return { result: 'success', deleted: { rooms: before.rooms - sheet.rooms.length, questions: before.questions - sheet.questions.length, answers: before.answers - sheet.answers.length } };
    });
  }

  /** body: chuỗi JSON (text/plain). Trả Promise<object>. */
  async function handlePost(body) {
    if (!body) return err('no_data');
    let d;
    try { d = JSON.parse(body); } catch (e) { return err('bad_json'); }
    if (!d || typeof d !== 'object' || Array.isArray(d)) return err('bad_json');
    const action = String(d.action == null ? '' : d.action).trim();
    switch (action) {
      case 'submitAnswer': return submitAnswer(d);
      case 'createRoom':   return createRoom(d);
      case 'getState':     return getState(d);
      case 'setQuestion':  return setQuestion(d);
      case 'closeRoom':    return closeRoom(d);
      case 'deleteRoom':   return deleteRoom(d);
      default:             return err('unknown_action');
    }
  }

  load();
  return { handleGet, handlePost, sheet, presence, hostKey, dataFile };
}

/* ===== HTTP ===== */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store'
};

function send(res, obj, callback) {
  const text = JSON.stringify(obj);
  const headers = Object.assign({}, CORS);
  const fn = String(callback == null ? '' : callback).replace(/[^0-9A-Za-z_$.]/g, '');
  if (fn) {
    headers['Content-Type'] = 'text/javascript; charset=utf-8';
    res.writeHead(200, headers);
    res.end(fn + '(' + text + ');');
    return;
  }
  headers['Content-Type'] = 'application/json; charset=utf-8';
  res.writeHead(200, headers);
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(body));
    req.on('error', () => resolve(body));
  });
}

/** Mở server. opts: port, latencyMs, failRate, quiet + mọi tùy chọn của createMock. Trả Promise<{server, mock, port, close()}>. */
function startServer(opts) {
  opts = opts || {};
  const mock = opts.mock || createMock(opts);
  const latency = opts.latencyMs || 0;
  const failRate = opts.failRate || 0;
  const quiet = !!opts.quiet;
  const log = (s) => { if (!quiet) console.log(s); };

  const server = http.createServer(async (req, res) => {
    const t0 = Date.now();
    const url = new URL(req.url, 'http://localhost');
    const callback = url.searchParams.get('callback') || '';
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
    const body = req.method === 'POST' ? await readBody(req) : '';
    if (latency) await sleep(latency);
    if (failRate && Math.random() < failRate) { req.socket.destroy(); log(`${req.method} ${req.url} → (cắt kết nối giả) ${Date.now() - t0}ms`); return; }
    let out;
    try {
      if (req.method === 'POST') out = await mock.handlePost(body);
      else if (req.method === 'GET') out = mock.handleGet(url.searchParams);
      else out = err('method_not_allowed');
    } catch (e) {
      // Như serverError_ của script: log, trả server_error trần (detail chỉ khi DEBUG)
      console.error('mock-api: server_error ' + (e && e.message));
      out = DEBUG ? err('server_error', { detail: String(e && e.message).slice(0, 200) }) : err('server_error');
    }
    send(res, out, callback);
    let brief = out.result === 'success' ? 'ok' : 'error=' + out.error;
    let what = req.method === 'GET' ? url.search : '';
    if (req.method === 'POST') { try { const d = JSON.parse(body); what = d.action + (d.room ? ' ' + d.room : ''); } catch (e) { what = '?'; } }
    log(`${req.method} ${what} → ${brief} ${Date.now() - t0}ms`);
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(opts.port == null ? DEFAULT_PORT : opts.port, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, mock, port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

function parseArgs(argv) {
  const a = { port: Number(process.env.PORT) || DEFAULT_PORT, hostKey: process.env.HOST_KEY === undefined ? DEFAULT_HOST_KEY : process.env.HOST_KEY,
    dataFile: process.env.MOCK_DATA ? path.resolve(process.env.MOCK_DATA) : '', presenceTtlSec: Number(process.env.PRESENCE_TTL_SEC) || 0,
    latencyMs: 0, failRate: 0, busyRate: 0, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--slow') a.latencyMs = 2000;
    else if (k === '--latency') { a.latencyMs = Number(v) || 0; i++; }
    else if (k === '--flaky') a.failRate = 0.2;
    else if (k === '--fail-rate') { a.failRate = Number(v) || 0; i++; }
    else if (k === '--busy') a.busyRate = 0.3;
    else if (k === '--busy-rate') { a.busyRate = Number(v) || 0; i++; }
    else if (k === '--port') { a.port = Number(v) || a.port; i++; }
    else if (k === '--key') { a.hostKey = v; i++; }
    else if (k === '--quiet') a.quiet = true;
  }
  return a;
}

if (require.main === module) {
  const a = parseArgs(process.argv.slice(2));
  startServer(a).then(({ port, mock }) => {
    console.log(`mock-api: http://localhost:${port}/  khóa người dẫn: ${mock.hostKey || '(chưa đặt → host_key_not_set)'}`);
    console.log(`mock-api: dữ liệu ${mock.dataFile ? 'ghi vào ' + mock.dataFile : 'chỉ trong bộ nhớ (tắt là mất)'}`
      + (a.latencyMs ? ` · trễ ${a.latencyMs} ms` : '') + (a.failRate ? ` · cắt kết nối ${Math.round(a.failRate * 100)} %` : '')
      + (a.busyRate ? ` · busy ${Math.round(a.busyRate * 100)} % submit` : ''));
    console.log(`mock-api: màn dẫn http://localhost:8766/host.html?key=${mock.hostKey}  · Ctrl+C để tắt`);
  }).catch((e) => { console.error('mock-api: không mở được cổng: ' + e.message); process.exit(1); });
}

module.exports = { createMock, startServer, parseArgs, formatDate, parseDate, safeText, len };
