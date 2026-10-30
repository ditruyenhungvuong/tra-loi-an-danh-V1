/* =========================================================
   Test google_apps_script.js bằng Node: giả lập SpreadsheetApp / CacheService / LockService /
   PropertiesService / Utilities / ContentService / Logger trong bộ nhớ rồi gọi doGet / doPost
   như Apps Script sẽ gọi. Chạy CÙNG bộ kịch bản contract của tests/test-mock-api.js
   (runContractScenarios) để chứng minh mock và script hành xử giống nhau, rồi kiểm thêm phần
   chỉ script có: 3 tab + tiêu đề + định dạng @, Answers đúng 5 cột, safeText_ ("=1+1" → "'=1+1"),
   cache (heartbeat không đọc Sheet), lock busy, host_key_not_set, server_error, test_/setup_/makeHostKey.
   Chạy: node tests/test-gas.js
   ========================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { runContractScenarios, makeT, TIME_RE } = require('./test-mock-api.js');
const { formatDate } = require(path.join(__dirname, '..', 'tools', 'mock-api.js'));

const APP = path.resolve(__dirname, '..');
const T = makeT();
const KEY = 'TESTHOSTKEY0123456789abcdefghijk';   // 32 ký tự như makeHostKey sinh

/* ===== Giả lập Sheet ===== */
const stats = { reads: 0, writes: 0 };
function makeSheet(name) {
  const s = { name, rows: [], frozen: 0, fmt: [], numFmt: [] };
  s.getLastRow = () => s.rows.length;
  s.appendRow = (r) => { stats.writes++; s.rows.push(r.slice()); };
  s.setFrozenRows = (n) => { s.frozen = n; };
  s.deleteRows = (start, n) => { stats.writes++; s.rows.splice(start - 1, n); };
  s.getRange = (r, c, nr, nc) => {
    if (typeof r === 'string') {   // 'A:A' chỉ dùng cho setNumberFormat
      return { setNumberFormat(f) { s.numFmt.push(r + '=' + f); return this; } };
    }
    nr = nr || 1; nc = nc || 1;
    return {
      getValues: () => { stats.reads++; return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const row = s.rows[r - 1 + i] || []; return row[c - 1 + j] == null ? '' : row[c - 1 + j]; })); },
      setValues: (vals) => { stats.writes++; vals.forEach((v, i) => { const row = s.rows[r - 1 + i] || (s.rows[r - 1 + i] = []); v.forEach((x, j) => { row[c - 1 + j] = x; }); }); },
      getValue: () => { stats.reads++; const row = s.rows[r - 1] || []; return row[c - 1] == null ? '' : row[c - 1]; },
      setValue(x) { stats.writes++; const row = s.rows[r - 1] || (s.rows[r - 1] = []); row[c - 1] = x; return this; },
      setNumberFormat(f) { s.numFmt.push(r + ',' + c + '=' + f); return this; },
      setFontWeight(x) { s.fmt.push(x); return this; }, setBackground(x) { s.fmt.push(x); return this; }, setFontColor(x) { s.fmt.push(x); return this; }
    };
  };
  return s;
}
const sheets = {};
const ss = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = makeSheet(n)) };

/* ===== Giả lập cache (có TTL theo đồng hồ giả), lock, properties, utilities ===== */
let clock = Date.now();
const cacheStore = {};
const cache = {
  get: (k) => { const e = cacheStore[k]; if (!e) return null; if (e.exp <= clock) { delete cacheStore[k]; return null; } return e.v; },
  put: (k, v, ttl) => { if (String(v).length > 100 * 1024) throw new Error('cache value > 100KB'); cacheStore[k] = { v: String(v), exp: clock + (ttl || 600) * 1000 }; },
  remove: (k) => { delete cacheStore[k]; },
  removeAll: (keys) => { if (!Array.isArray(keys)) throw new Error('removeAll cần mảng'); keys.forEach((k) => { delete cacheStore[k]; }); }
};
let cachePutFails = false;
const realPut = cache.put;
cache.put = (k, v, ttl) => { if (cachePutFails) throw new Error('cache down'); return realPut(k, v, ttl); };
let lockHeld = 0, lockRefuse = false, lockCalls = 0;
const props = {};
const sandbox = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ss },
  CacheService: { getScriptCache: () => cache },
  LockService: { getScriptLock: () => ({ tryLock() { lockCalls++; if (lockRefuse) return false; lockHeld++; return true; }, waitLock() { if (lockRefuse) throw new Error('timeout'); lockHeld++; }, releaseLock() { lockHeld--; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: (k) => { delete props[k]; } }) },
  Utilities: { formatDate: (d, tz, fmt) => { if (tz !== 'Asia/Ho_Chi_Minh' || fmt !== 'HH:mm:ss dd/MM/yyyy') throw new Error('formatDate sai múi/khuôn: ' + tz + ' ' + fmt); return formatDate(d.getTime()); }, getUuid: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, () => Math.floor(Math.random() * 16).toString(16)) },
  ContentService: { MimeType: { JSON: 'json', JAVASCRIPT: 'js' }, createTextOutput: (t) => ({ text: t, mime: null, setMimeType(m) { this.mime = m; return this; }, getContent() { return this.text; } }) },
  Logger: { log: (m) => { sandbox.__logs.push(String(m)); } },
  __logs: [],
  console
};
vm.createContext(sandbox);
const SRC = fs.readFileSync(path.join(APP, 'google_apps_script.js'), 'utf8');
vm.runInContext(SRC, sandbox, { filename: 'google_apps_script.js' });
sandbox.now_ = () => clock;   // đồng hồ giả: script gọi now_() ở mọi mốc thời gian

const G = (p) => sandbox.doGet({ parameter: p });
const P = (o) => sandbox.doPost({ postData: { contents: typeof o === 'string' ? o : JSON.stringify(o) } });
const J = (out) => JSON.parse(out.getContent());
const qsToObj = (qs) => { const o = {}; new URLSearchParams(qs).forEach((v, k) => { o[k] = v; }); return o; };

const api = {
  key: KEY,
  get: async (qs) => J(G(qsToObj(qs))),
  getRaw: async (qs) => { const out = G(qsToObj(qs)); return { text: out.getContent(), ct: out.mime }; },
  post: async (body) => J(P(body)),
  advance: async (sec) => { clock += sec * 1000; }
};

(async () => {
  /* ===== Trước khi có khóa ===== */
  T('chưa có HOST_KEY → createRoom trả host_key_not_set', J(P({ action: 'createRoom', key: KEY, questions: ['a'] })).error === 'host_key_not_set');
  T('chưa có HOST_KEY → getState trả host_key_not_set (không lộ dữ liệu)', J(P({ action: 'getState', key: '', room: '1234' })).error === 'host_key_not_set');
  T('chưa có HOST_KEY → ping vẫn chạy', J(G({ action: 'ping' })).pong === true);
  T('ping: MimeType JSON', G({ action: 'ping' }).mime === 'json');
  T('JSONP: MimeType JAVASCRIPT', G({ action: 'ping', callback: 'cb' }).mime === 'js');

  /* ===== makeHostKey / showHostLink ===== */
  const k1 = sandbox.makeHostKey();
  T('makeHostKey → 32 ký tự [A-Za-z0-9], lưu Script Properties HOST_KEY', /^[A-Za-z0-9]{32}$/.test(k1) && props.HOST_KEY === k1, k1);
  T('makeHostKey log link host.html?key=… với PUBLIC_URL', sandbox.__logs.some((l) => l.includes('host.html?key=' + k1) && l.includes('github.io/tra-loi-an-danh/')), sandbox.__logs.join(' | '));
  const k2 = sandbox.makeHostKey();
  T('makeHostKey lần hai → khóa khác, khóa cũ hết hiệu lực', k2 !== k1 && J(P({ action: 'createRoom', key: k1, questions: ['a'] })).error === 'host_key_invalid' && props.HOST_KEY === k2);
  T('showHostLink → trả khóa hiện tại, không đổi', sandbox.showHostLink() === k2 && props.HOST_KEY === k2);
  T('khóa ngắn 7 ký tự → host_key_invalid dù trùng (độ dài tối thiểu)', (() => { props.HOST_KEY = 'abcdefg'; const r = J(P({ action: 'createRoom', key: 'abcdefg', questions: ['a'] })).error; return r === 'host_key_invalid'; })());
  props.HOST_KEY = KEY;

  /* ===== setup_ tạo 3 tab ===== */
  T('trước setup_: chưa có tab nào', Object.keys(sheets).length === 0);
  sandbox.setup_();
  T('setup_ → 3 tab Rooms, Questions, Answers', ['Rooms', 'Questions', 'Answers'].every((n) => sheets[n]), Object.keys(sheets).join(','));
  T('Rooms tiêu đề 6 cột đúng tech design 3.1', JSON.stringify(sheets.Rooms.rows[0]) === JSON.stringify(['Mã phòng', 'Thời gian tạo', 'Câu hiện tại', 'Số câu hỏi', 'Trạng thái', 'Cập nhật lúc']), JSON.stringify(sheets.Rooms.rows[0]));
  T('Questions tiêu đề 3 cột', JSON.stringify(sheets.Questions.rows[0]) === JSON.stringify(['Mã phòng', 'Số câu', 'Nội dung']));
  T('Answers tiêu đề ĐÚNG 5 cột PRD mục 5: Thời gian · Mã phòng · Số câu · deviceId · Nội dung', JSON.stringify(sheets.Answers.rows[0]) === JSON.stringify(['Thời gian', 'Mã phòng', 'Số câu', 'deviceId', 'Nội dung']), JSON.stringify(sheets.Answers.rows[0]));
  T('Cột mã phòng (A của Rooms/Questions, B của Answers) và deviceId (D của Answers) = Văn bản thuần @', sheets.Rooms.numFmt.includes('A:A=@') && sheets.Questions.numFmt.includes('A:A=@') && sheets.Answers.numFmt.includes('B:B=@') && sheets.Answers.numFmt.includes('D:D=@'), JSON.stringify([sheets.Rooms.numFmt, sheets.Answers.numFmt]));
  T('Cột nội dung Questions C và Answers E = Văn bản thuần @ ("1/2", "100%", "7:30", "TRUE" giữ chữ) – review', sheets.Questions.numFmt.includes('C:C=@') && sheets.Answers.numFmt.includes('E:E=@'), JSON.stringify([sheets.Questions.numFmt, sheets.Answers.numFmt]));
  T('Tiêu đề: đóng băng hàng 1, nền #E3EAF3 chữ #1F3A5F, đậm', ['Rooms', 'Questions', 'Answers'].every((n) => sheets[n].frozen === 1 && sheets[n].fmt.includes('#E3EAF3') && sheets[n].fmt.includes('#1F3A5F') && sheets[n].fmt.includes('bold')));
  T('setup_ log nhắc khóa đã có', sandbox.__logs.some((l) => /setup_: khóa người dẫn đã có/.test(l)));
  const fmtCount = sheets.Rooms.numFmt.length;
  sandbox.setup_();
  T('setup_ chạy lại → không thêm tiêu đề, không đặt lại định dạng', sheets.Rooms.rows.length === 1 && sheets.Rooms.numFmt.length === fmtCount);

  /* ===== Cùng bộ kịch bản contract với mock ===== */
  const left = await runContractScenarios(api, T);

  /* ===== Kiểm trên "Sheet" ===== */
  const rooms = sheets.Rooms, questions = sheets.Questions, answers = sheets.Answers;
  T('Mọi dòng Answers đúng 5 cột; cột C số câu là number; cột B/D chuỗi; cột A đúng khuôn giờ', answers.rows.slice(1).every((r) => r.length === 5 && typeof r[2] === 'number' && typeof r[1] === 'string' && typeof r[3] === 'string' && TIME_RE.test(r[0])), JSON.stringify(answers.rows[1]));
  T('Không ô chuỗi nào trong Answers/Questions bắt đầu bằng = + - @ tab CR', answers.rows.concat(questions.rows).slice(1).every((row) => row.every((v) => typeof v !== 'string' || !/^[=+\-@\t\r]/.test(v))));
  T('safeText_: "=x" "+x" "-x" "@x" "\\tx" "\\rx" thêm nháy; "x" "1" "" giữ nguyên', ['=x', '+x', '-x', '@x', '\tx', '\rx'].every((v) => sandbox.safeText_(v) === "'" + v) && sandbox.safeText_('x') === 'x' && sandbox.safeText_('1') === '1' && sandbox.safeText_('') === '');
  T('Rooms: mã phòng ghi dạng chuỗi (giữ số 0 đầu), currentIndex/questionCount là number, status whitelist', rooms.rows.slice(1).every((r) => typeof r[0] === 'string' && /^\d{4}$/.test(r[0]) && typeof r[2] === 'number' && typeof r[3] === 'number' && (r[4] === 'open' || r[4] === 'closed') && TIME_RE.test(r[1]) && TIME_RE.test(r[5])), JSON.stringify(rooms.rows[1]));
  T('Phòng 25 h được dọn nhà: dòng Rooms ghi closed trên Sheet', rooms.rows.find((r) => r[0] === left.old)[4] === 'closed');
  T('Lock luôn được nhả (kể cả khi lỗi), và lock có được dùng', lockHeld === 0 && lockCalls > 0, lockHeld);

  /* ===== Cache: heartbeat không đọc Sheet khi trúng cache ===== */
  const code = left.fresh;
  const D1 = 'cachedevice0001';
  J(G({ action: 'heartbeat', room: code, device: D1 }));
  stats.reads = 0;
  for (let i = 0; i < 20; i++) J(G({ action: 'heartbeat', room: code, device: 'cachedevice' + String(i).padStart(4, '0') }));
  T('20 heartbeat liên tiếp khi trúng cache → 0 lần đọc Sheet (R1)', stats.reads === 0, stats.reads);
  stats.reads = 0;
  J(G({ action: 'getRoom', room: code }));
  T('getRoom trúng cache → 0 lần đọc Sheet', stats.reads === 0, stats.reads);
  Object.keys(cacheStore).forEach((k) => delete cacheStore[k]);   // giả CacheService bị dọn (R11)
  stats.reads = 0;
  let r = J(G({ action: 'heartbeat', room: code, device: D1 }));
  T('cache trượt → đọc Sheet, trả đúng phòng, rồi ghi lại cache', r.result === 'success' && r.room.code === code && stats.reads > 0 && cacheStore['rs:' + code]);
  stats.reads = 0;
  J(G({ action: 'heartbeat', room: code, device: D1 }));
  T('lần sau lại trúng cache', stats.reads === 0);
  T('presence sau khi cache bị dọn tự lành: 1 heartbeat → participants 1', J(P({ action: 'getState', key: KEY, room: code, since: 0 })).counts.participants === 1);
  T('cache ak: tồn tại sau submit; xóa cache vẫn kiểm trên Sheet → already_answered', (() => {
    J(P({ action: 'submitAnswer', room: code, device: D1, q: 1, text: 'một' }));
    const had = !!cacheStore['ak:' + code + '|1|' + D1];
    delete cacheStore['ak:' + code + '|1|' + D1];
    return had && J(P({ action: 'submitAnswer', room: code, device: D1, q: 1, text: 'hai' })).error === 'already_answered' && answers.rows.filter((x) => x[1] === code).length === 1;
  })());
  T('rs: cache có TTL 6 h: tua 7 h → trượt, đọc lại Sheet', (() => { clock += 7 * 3600 * 1000; stats.reads = 0; J(G({ action: 'getRoom', room: code })); return stats.reads > 0; })());
  T('mỗi thao tác người dẫn làm mới cache rs:', (() => { J(P({ action: 'setQuestion', key: KEY, room: code, index: 1 })); return JSON.parse(cacheStore['rs:' + code].v).currentIndex === 1; })());

  /* ===== Sửa tay trên Sheet ===== */
  const rowRoom = rooms.rows.find((x) => x[0] === code);
  T('setQuestion ghi Rooms!C (câu hiện tại) và F (cập nhật lúc)', rowRoom[2] === 1 && TIME_RE.test(rowRoom[5]));
  J(P({ action: 'submitAnswer', room: code, device: 'cachedevice0002', q: 1, text: 'hai' }));
  J(P({ action: 'submitAnswer', room: code, device: 'cachedevice0003', q: 1, text: 'ba' }));
  r = J(P({ action: 'getState', key: KEY, room: code, since: 0 }));
  T('3 câu trả lời, cursor 3', r.cursor === 3);
  const idx = answers.rows.findIndex((x) => x[1] === code && x[3] === 'cachedevice0002');
  answers.rows.splice(idx, 1);   // anh xóa tay một dòng trên Sheet
  r = J(P({ action: 'getState', key: KEY, room: code, since: 3 }));
  T('xóa tay 1 dòng Answers → getState since 3 trả reset:true với 2 câu, cursor 2', r.reset === true && r.answersNew.length === 2 && r.cursor === 2, JSON.stringify(r));
  answers.rows.push([new Date(clock), code, 1, 'datedevice0001', 'ô giờ bị Sheets đổi thành Date']);
  r = J(P({ action: 'getState', key: KEY, room: code, since: 0 }));
  T('ô Thời gian là Date (Sheets lỡ đổi) → vẫn trả chuỗi đúng khuôn', TIME_RE.test(r.answersNew[2].at), r.answersNew[2].at);
  rooms.rows.push([1234, formatDate(clock), 1, 1, 'open', formatDate(clock)]);   // mã bị Sheets đổi thành số
  questions.rows.push([1234, 1, 'Mã số']);
  T('Rooms có mã dạng number 1234 (định dạng sai) → getRoom 1234 vẫn tìm thấy qua String()', J(G({ action: 'getRoom', room: '1234' })).result === 'success');
  J(P({ action: 'deleteRoom', key: KEY, room: '1234' }));

  /* ===== deleteRoom xóa đúng khối, không đụng phòng khác ===== */
  const mk = (q) => J(P({ action: 'createRoom', key: KEY, questions: [q] })).room.code;
  const A = mk('A'), B = mk('B'), C = mk('C');
  const seq = [[A, 'a1'], [B, 'b1'], [B, 'b2'], [A, 'a2'], [C, 'c1'], [B, 'b3'], [B, 'b4'], [A, 'a3']];
  seq.forEach(([rm, t], i) => J(P({ action: 'submitAnswer', room: rm, device: 'blockdev' + String(i).padStart(6, '0'), q: 1, text: t })));
  const before = answers.rows.length;
  r = J(P({ action: 'deleteRoom', key: KEY, room: B }));
  T('deleteRoom B (dòng rải 3 khối) → deleted answers 4, questions 1, rooms 1', JSON.stringify(r.deleted) === '{"rooms":1,"questions":1,"answers":4}', JSON.stringify(r));
  T('Answers còn lại của A và C đúng thứ tự a1,a2,c1,a3', answers.rows.length === before - 4 && JSON.stringify(answers.rows.filter((x) => x[1] === A || x[1] === C).map((x) => x[4])) === '["a1","a2","c1","a3"]');
  T('getState A sau khi xóa B → 3 câu, cursor 3', J(P({ action: 'getState', key: KEY, room: A, since: 0 })).cursor === 3);
  T('Rooms/Questions không còn dòng của B', !rooms.rows.some((x) => x[0] === B) && !questions.rows.some((x) => x[0] === B));

  /* ===== Lock bận → busy; đọc không cần lock ===== */
  lockRefuse = true;
  T('lock bận: submitAnswer → busy', J(P({ action: 'submitAnswer', room: A, device: 'busydevice0001', q: 1, text: 'x' })).error === 'busy');
  T('lock bận: createRoom / setQuestion / closeRoom / deleteRoom → busy', ['createRoom', 'setQuestion', 'closeRoom', 'deleteRoom'].every((a) => J(P({ action: a, key: KEY, room: A, index: 1, questions: ['x'] })).error === 'busy'));
  T('lock bận: heartbeat, getRoom, getState vẫn chạy (không lock)', J(G({ action: 'heartbeat', room: A, device: 'busydevice0001' })).result === 'success' && J(G({ action: 'getRoom', room: A })).result === 'success' && J(P({ action: 'getState', key: KEY, room: A, since: 0 })).result === 'success');
  T('lock bận: validate vẫn chạy trước lock (text_required, không phải busy)', J(P({ action: 'submitAnswer', room: A, device: 'busydevice0001', q: 1, text: '' })).error === 'text_required');
  T('lock bận: already_answered từ cache trả trước khi lấy lock', J(P({ action: 'submitAnswer', room: A, device: 'blockdev000000', q: 1, text: 'x' })).error === 'already_answered');
  lockRefuse = false;
  T('busy không làm mất dòng: gửi lại sau đó → success', J(P({ action: 'submitAnswer', room: A, device: 'busydevice0001', q: 1, text: 'x' })).result === 'success');

  /* ===== Presence: 400 máy, cache lỗi (review mục 2) ===== */
  const big = mk('Đông');
  const hb400 = Array.from({ length: 400 }, (_, i) => J(G({ action: 'heartbeat', room: big, device: 'crowd' + String(i).padStart(10, '0') })));
  T('400 device heartbeat → 400 success', hb400.every((x) => x.result === 'success'), hb400.find((x) => x.result !== 'success'));
  T('pr: cache cap 300 mục, participants = 300 (bỏ mục cũ nhất)', Object.keys(JSON.parse(cacheStore['pr:' + big].v)).length === 300 && J(P({ action: 'getState', key: KEY, room: big, since: 0 })).counts.participants === 300);
  T('cap giữ mục mới nhất: device 399 còn, device 0 bị bỏ', (() => { const m = JSON.parse(cacheStore['pr:' + big].v); return 'crowd0000000399' in m && !('crowd0000000000' in m); })());
  cachePutFails = true;
  r = J(G({ action: 'heartbeat', room: big, device: 'crowd0000000001' }));
  T('cache put ném lỗi → heartbeat vẫn success (touchPresence_ nuốt lỗi)', r.result === 'success' && r.room.code === big, JSON.stringify(r));
  Object.keys(cacheStore).filter((k) => k.startsWith('rs:')).forEach((k) => delete cacheStore[k]);
  r = J(G({ action: 'getRoom', room: big }));
  T('cache put ném lỗi khi trượt rs: → getRoom vẫn success từ Sheet (putRoomState_ nuốt lỗi)', r.result === 'success' && r.room.code === big, JSON.stringify(r));
  r = J(P({ action: 'setQuestion', key: KEY, room: big, index: 1 }));
  T('cache put ném lỗi → setQuestion vẫn success, Sheet đã ghi', r.result === 'success' && rooms.rows.find((x) => x[0] === big)[2] === 1, JSON.stringify(r));
  cachePutFails = false;
  J(P({ action: 'deleteRoom', key: KEY, room: big }));

  /* ===== Xóa phòng → tạo lại trúng mã → device cũ gửi được (review mục 3) ===== */
  const realRandom = sandbox.randomCode_;
  sandbox.randomCode_ = () => '7777';
  let same = J(P({ action: 'createRoom', key: KEY, questions: ['Lần 1'] }));
  T('ép mã 7777 (giả randomCode_) → tạo được', same.result === 'success' && same.room.code === '7777', JSON.stringify(same));
  T('D1 gửi phòng 7777 lần 1 → success, cache ak: có', J(P({ action: 'submitAnswer', room: '7777', device: 'reusedevice001', q: 1, text: 'lần 1' })).result === 'success' && !!cacheStore['ak:7777|1|reusedevice001']);
  J(P({ action: 'submitAnswer', room: '7777', device: 'reusedevice002', q: 1, text: 'lần 1 máy 2' }));
  T('7777 đang tồn tại → tạo nữa với cùng mã → code_exhausted (không trùng dòng Rooms)', J(P({ action: 'createRoom', key: KEY, questions: ['Trùng'] })).error === 'code_exhausted');
  r = J(P({ action: 'deleteRoom', key: KEY, room: '7777' }));
  T('deleteRoom 7777 → xóa 2 answers và xóa cache ak: của phòng', r.deleted.answers === 2 && !cacheStore['ak:7777|1|reusedevice001'] && !cacheStore['ak:7777|1|reusedevice002']);
  same = J(P({ action: 'createRoom', key: KEY, questions: ['Lần 2'] }));
  T('tạo lại trúng mã 7777 trong 6 h → success', same.result === 'success' && same.room.code === '7777');
  r = J(P({ action: 'submitAnswer', room: '7777', device: 'reusedevice001', q: 1, text: 'lần 2' }));
  T('device cũ gửi vào phòng mới trùng mã → success (không already_answered giả)', r.result === 'success', JSON.stringify(r));
  T('getState phòng 7777 mới chỉ có câu "lần 2"', (() => { const s = J(P({ action: 'getState', key: KEY, room: '7777', since: 0 })); return s.cursor === 1 && s.answersNew[0].text === 'lần 2' && s.questions[0].text === 'Lần 2'; })());
  J(P({ action: 'deleteRoom', key: KEY, room: '7777' }));
  sandbox.randomCode_ = realRandom;

  /* ===== Lỗi bất ngờ → server_error ===== */
  const oldGet = ss.getSheetByName;
  ss.getSheetByName = () => { throw new Error('boom'); };
  sandbox.__logs = [];
  r = J(P({ action: 'getState', key: KEY, room: A, since: 0 }));
  T('exception trong doPost → server_error TRẦN (không detail khi DEBUG=false), ghi Logger, không throw, lock nhả', JSON.stringify(r) === '{"result":"error","error":"server_error"}' && sandbox.__logs.some((l) => /server_error: boom/.test(l)) && lockHeld === 0, JSON.stringify(r));
  sandbox.DEBUG = true;
  r = J(P({ action: 'getState', key: KEY, room: A, since: 0 }));
  T('DEBUG = true → server_error kèm detail', r.error === 'server_error' && /boom/.test(r.detail), JSON.stringify(r));
  sandbox.DEBUG = false;
  Object.keys(cacheStore).forEach((k) => delete cacheStore[k]);
  const outG = G({ action: 'heartbeat', room: A, device: 'busydevice0001', callback: 'cb' });
  T('exception trong doGet → server_error, vẫn JSONP', outG.getContent().startsWith('cb({"result":"error","error":"server_error"'), outG.getContent());
  ss.getSheetByName = oldGet;
  T('doPost không postData → no_data', J(sandbox.doPost({})).error === 'no_data' && J(sandbox.doPost(null)).error === 'no_data');
  T('doGet không e → public_read_disabled', J(sandbox.doGet()).error === 'public_read_disabled');

  /* ===== test_() trong editor ===== */
  const roomsBefore = rooms.rows.length, ansBefore = answers.rows.length, qBefore = questions.rows.length;
  sandbox.__logs = [];
  sandbox.test_();
  T('test_() chạy xong "test_: XONG", không để lại phòng thử', sandbox.__logs.some((l) => /test_: XONG/.test(l)) && !sandbox.__logs.some((l) => /LỖI/.test(l)) && rooms.rows.length === roomsBefore && answers.rows.length === ansBefore && questions.rows.length === qBefore, sandbox.__logs.filter((l) => /LỖI/.test(l)).join(' | ') || sandbox.__logs.slice(-2).join(' | '));
  T('test_() khi chưa có khóa → nhắc chạy makeHostKey, không lỗi', (() => { const saved = props.HOST_KEY; delete props.HOST_KEY; sandbox.__logs = []; sandbox.test_(); props.HOST_KEY = saved; return sandbox.__logs.some((l) => /makeHostKey/.test(l)); })());

  /* ===== Rà nguồn ===== */
  T('Script không còn COLUMNS/findSessionRow_ của template, có đủ hàm theo 4.12', !/findSessionRow_|var COLUMNS/.test(SRC) && ['ensureSheets_', 'checkHostKey_', 'makeHostKey', 'roomState_', 'putRoomState_', 'dropRoomState_', 'touchPresence_', 'countPresence_', 'doGet', 'doPost', 'test_', 'setup_', 'safeText_', 'json_'].every((f) => new RegExp('function ' + f + '\\(').test(SRC)));
  T('Script dùng Utilities.formatDate múi Asia/Ho_Chi_Minh, LockService, CacheService, PropertiesService', /Utilities\.formatDate/.test(SRC) && /Asia\/Ho_Chi_Minh/.test(SRC) && /LockService\.getScriptLock/.test(SRC) && /CacheService\.getScriptCache/.test(SRC) && /PropertiesService\.getScriptProperties/.test(SRC));
  T('Script không chứa khóa thật (chỉ đọc từ Script Properties)', !/demo-host-key/.test(SRC) && !/HOST_KEY\s*=\s*['"][^'"]+['"]/.test(SRC));
  T('Hướng dẫn cài đầu file có makeHostKey, Deploy Web App, Anyone, ?action=ping', /makeHostKey/.test(SRC.slice(0, 6000)) && /Bất kỳ ai \(Anyone\)/.test(SRC) && /\?action=ping/.test(SRC) && /Thực thi với tư cách/.test(SRC));
  T('Không chuỗi nào trong mọi tab bắt đầu bằng ký tự công thức (sau toàn bộ test)', Object.values(sheets).every((s) => s.rows.slice(1).every((row) => row.every((v) => typeof v !== 'string' || !/^[=+\-@\t\r]/.test(v)))));
  T('Lock cân bằng cuối cùng', lockHeld === 0);

  const s = T.state;
  console.log(`\n${s.pass} PASS, ${s.fail} FAIL (test-gas)`);
  process.exit(s.fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
