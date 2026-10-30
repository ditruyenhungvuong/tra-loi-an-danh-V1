/**
 * load-test.js – thử tải backend "Trả lời ẩn danh" (mock hoặc Apps Script thật, ADR 0002 "cách thử tải").
 * Node thuần, không npm. Chạy vào Sheet THỬ, không vào Sheet thật.
 *
 *   node tools/load-test.js --url http://localhost:8788 --n 50 --duration 20
 *   node tools/load-test.js --url=https://script.google.com/macros/s/<ID>/exec --key=<khóa host thử> --n=30 --minutes=5 --burst=10
 *
 * Tham số: --url (bắt buộc) · --key (mặc định demo-host-key-0000 của mock) · --n số điện thoại ảo (50)
 *          --duration giây (60) hoặc --minutes phút · --burst giây cửa sổ gửi dồn (10) · --m số câu gửi dồn (= n)
 * Kịch bản trong `duration`:
 *   0 %   createRoom 3 câu hỏi; N máy heartbeat mỗi 3,5 s ± 15 %; 1 host getState mỗi 2,5 s (since = cursor)
 *   25 %  gửi dồn: M máy submitAnswer câu 1 rải trong `burst` giây (busy → gửi lại 1 lần sau 1,5 s + ngẫu nhiên)
 *   55 %  host setQuestion 2, đo bao lâu mọi máy thấy currentIndex 2 qua heartbeat (lan truyền)
 *   65 %  gửi dồn lần hai (câu 2)
 *   100 % closeRoom, deleteRoom. In p50/p95/max, tỉ lệ lỗi từng action, số busy, retry thành công, lan truyền p95.
 * Đạt (tech design mục 7): p95 heartbeat < 2 s, p95 submit < 5 s, lỗi < 1 %, không busy sau retry, lan truyền p95 ≤ 5 s.
 */
'use strict';

function parseArgs(argv) {
  const a = { url: '', key: 'demo-host-key-0000', n: 50, duration: 60, burst: 10, m: 0 };
  for (let i = 0; i < argv.length; i++) {
    let k = argv[i], v = argv[i + 1];
    const eq = k.indexOf('=');
    if (eq > 0) { v = k.slice(eq + 1); k = k.slice(0, eq); } else i++;
    if (k === '--url') a.url = v;
    else if (k === '--key') a.key = v;
    else if (k === '--n') a.n = Number(v) || a.n;
    else if (k === '--duration') a.duration = Number(v) || a.duration;
    else if (k === '--minutes') a.duration = (Number(v) || 1) * 60;
    else if (k === '--burst') a.burst = Number(v) || a.burst;
    else if (k === '--m') a.m = Number(v) || 0;
    else i--;
  }
  if (!a.m) a.m = a.n;
  a.url = a.url.replace(/\/+$/, '');
  return a;
}

const A = parseArgs(process.argv.slice(2));
if (!A.url) { console.error('Thiếu --url. Ví dụ: node tools/load-test.js --url http://localhost:8788 --n 50 --duration 20'); process.exit(2); }

const TIMEOUT_MS = 8000;
const JOIN_POLL_MS = 3500, HOST_POLL_MS = 2500, JITTER = 0.15, BUSY_RETRY_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => ms * (1 + (Math.random() * 2 - 1) * JITTER);
const rndDevice = () => Array.from({ length: 16 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');

/* ===== Thống kê ===== */
const stats = {};   // action → { lat: [], ok, err: {code: n} }
function rec(action, ms, result) {
  const s = stats[action] || (stats[action] = { lat: [], ok: 0, err: {} });
  s.lat.push(ms);
  if (result.result === 'success') s.ok++;
  else s.err[result.error || 'unknown'] = (s.err[result.error || 'unknown'] || 0) + 1;
}
function pct(arr, p) { if (!arr.length) return 0; const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; }

/* ===== Gọi API như js/api.js: GET cho điện thoại, POST text/plain, timeout 8 s, luôn resolve ===== */
async function call(action, method, params) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let out;
  try {
    let res;
    if (method === 'GET') {
      const qs = new URLSearchParams(Object.assign({ action }, params)).toString();
      res = await fetch(A.url + '?' + qs, { signal: ctrl.signal, redirect: 'follow' });
    } else {
      res = await fetch(A.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ action }, params)), signal: ctrl.signal, redirect: 'follow' });
    }
    const text = await res.text();
    try { out = JSON.parse(text); } catch (e) { out = { result: 'error', error: 'bad_response_' + res.status }; }
  } catch (e) {
    out = { result: 'error', error: e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally { clearTimeout(timer); }
  rec(action, Date.now() - t0, out);
  return out;
}

/* ===== Kịch bản ===== */
let running = true;
let busyCount = 0, retryOk = 0, retryFail = 0;
const phones = Array.from({ length: A.n }, (_, i) => ({ i, device: rndDevice(), seenIndex: 1, seenAt: 0 }));
let setQuestionAt = 0;

async function phoneLoop(ph, room) {
  await sleep(Math.random() * JOIN_POLL_MS);   // vào phòng rải trong 3,5 s đầu
  while (running) {
    const r = await call('heartbeat', 'GET', { room, device: ph.device });
    if (r.result === 'success') {
      if (r.room.currentIndex !== ph.seenIndex) { ph.seenIndex = r.room.currentIndex; ph.seenAt = Date.now(); }
    }
    await sleep(jitter(JOIN_POLL_MS));
  }
}

async function hostLoop(room, state) {
  while (running) {
    const r = await call('getState', 'POST', { key: A.key, room, since: state.cursor });
    if (r.result === 'success') { state.cursor = r.cursor; state.total = r.counts.answersTotal; state.participants = Math.max(state.participants, r.counts.participants); }
    await sleep(jitter(HOST_POLL_MS));
  }
}

async function submitOnce(ph, room, q) {
  let r = await call('submitAnswer', 'POST', { room, device: ph.device, q, text: 'máy ' + ph.i + ' trả lời câu ' + q + ' lúc ' + new Date().toISOString() });
  if (r.error === 'busy') {
    busyCount++;
    await sleep(BUSY_RETRY_MS + Math.random() * 1000);
    r = await call('submitAnswer', 'POST', { room, device: ph.device, q, text: 'máy ' + ph.i + ' gửi lại câu ' + q });
    if (r.result === 'success' || r.error === 'already_answered') retryOk++; else retryFail++;
  }
  return r;
}

async function burst(room, q, label) {
  const chosen = phones.slice(0, A.m);
  console.log(`[${elapsed()}] ${label}: ${chosen.length} máy gửi câu ${q} trong ${A.burst} s`);
  const rs = await Promise.all(chosen.map((ph) => sleep(Math.random() * A.burst * 1000).then(() => submitOnce(ph, room, q))));
  const ok = rs.filter((r) => r.result === 'success').length;
  console.log(`[${elapsed()}] ${label} xong: ${ok}/${chosen.length} success` + (ok < chosen.length ? ', lỗi: ' + JSON.stringify(rs.filter((r) => r.result !== 'success').reduce((m, r) => { m[r.error] = (m[r.error] || 0) + 1; return m; }, {})) : ''));
}

const T0 = Date.now();
const elapsed = () => ((Date.now() - T0) / 1000).toFixed(1) + 's';

(async () => {
  console.log(`load-test: url=${A.url} n=${A.n} m=${A.m} duration=${A.duration}s burst=${A.burst}s`);
  const ping = await call('ping', 'GET', {});
  if (ping.result !== 'success') { console.error('ping thất bại: ' + JSON.stringify(ping)); process.exit(1); }
  const created = await call('createRoom', 'POST', { key: A.key, questions: ['Thử tải câu 1', 'Thử tải câu 2', 'Thử tải câu 3'] });
  if (created.result !== 'success') { console.error('createRoom thất bại: ' + JSON.stringify(created)); process.exit(1); }
  const room = created.room.code;
  console.log(`[${elapsed()}] phòng ${room} tạo xong; ${A.n} máy bắt đầu heartbeat, host bắt đầu getState`);

  const hostState = { cursor: 0, total: 0, participants: 0 };
  const loops = phones.map((ph) => phoneLoop(ph, room));
  loops.push(hostLoop(room, hostState));

  const D = A.duration * 1000;
  const burstWindow = Math.min(A.burst, Math.max(1, A.duration / 4));
  A.burst = burstWindow;

  await sleep(D * 0.25);
  await burst(room, 1, 'Gửi dồn 1');

  await sleep(Math.max(0, T0 + D * 0.55 - Date.now()));
  setQuestionAt = Date.now();
  const sq = await call('setQuestion', 'POST', { key: A.key, room, index: 2 });
  console.log(`[${elapsed()}] setQuestion 2 → ${sq.result}${sq.error ? ' ' + sq.error : ''}`);

  await sleep(Math.max(0, T0 + D * 0.65 - Date.now()));
  await burst(room, 2, 'Gửi dồn 2');

  await sleep(Math.max(0, T0 + D - Date.now()));
  running = false;
  await Promise.all(loops.map((p) => p.catch(() => {})));

  const closed = await call('closeRoom', 'POST', { key: A.key, room });
  const final = await call('getState', 'POST', { key: A.key, room, since: 0 });
  const del = await call('deleteRoom', 'POST', { key: A.key, room });

  /* ===== Báo cáo ===== */
  console.log('\n=== KẾT QUẢ ===');
  console.log('action'.padEnd(14) + 'số lượt'.padStart(8) + 'lỗi'.padStart(6) + 'p50'.padStart(8) + 'p95'.padStart(8) + 'max'.padStart(8) + '   mã lỗi');
  let totalReq = 0, totalErr = 0;
  for (const [action, s] of Object.entries(stats)) {
    const errN = Object.values(s.err).reduce((a, b) => a + b, 0);
    // already_answered / question_changed là hành vi đúng của contract, không tính là lỗi tải
    const realErr = Object.entries(s.err).filter(([k]) => !['already_answered', 'question_changed'].includes(k)).reduce((a, [, v]) => a + v, 0);
    totalReq += s.lat.length; totalErr += realErr;
    console.log(action.padEnd(14) + String(s.lat.length).padStart(8) + String(realErr).padStart(6) + (pct(s.lat, 0.5) + 'ms').padStart(8) + (pct(s.lat, 0.95) + 'ms').padStart(8) + (Math.max(...s.lat) + 'ms').padStart(8) + '   ' + (errN ? JSON.stringify(s.err) : ''));
  }
  const seen = phones.filter((p) => p.seenAt >= setQuestionAt).map((p) => p.seenAt - setQuestionAt);
  const secs = (Date.now() - T0) / 1000;
  console.log(`\nTổng ${totalReq} request trong ${secs.toFixed(0)} s (${(totalReq / secs).toFixed(1)} req/s), lỗi thật ${totalErr} (${(100 * totalErr / Math.max(1, totalReq)).toFixed(2)} %)`);
  console.log(`busy: ${busyCount} lần, gửi lại thành công ${retryOk}, gửi lại thất bại ${retryFail}`);
  console.log(`Lan truyền "đổi câu" tới ${seen.length}/${A.n} máy: p50 ${pct(seen, 0.5)} ms, p95 ${pct(seen, 0.95)} ms, max ${seen.length ? Math.max(...seen) : 0} ms`);
  console.log(`Host thấy tối đa ${hostState.participants} người đang tham gia (kỳ vọng ${A.n}); câu trả lời trên server lúc kết: ${final.result === 'success' ? final.counts.answersTotal : '?'} (gửi thành công ${(stats.submitAnswer || { ok: 0 }).ok})`);
  console.log(`closeRoom ${closed.result}, deleteRoom ${del.result} ${del.deleted ? JSON.stringify(del.deleted) : ''}`);
  const hb = stats.heartbeat ? pct(stats.heartbeat.lat, 0.95) : 0, sb = stats.submitAnswer ? pct(stats.submitAnswer.lat, 0.95) : 0;
  const pass = hb < 2000 && sb < 5000 && totalErr / Math.max(1, totalReq) < 0.01 && retryFail === 0 && (!seen.length || pct(seen, 0.95) <= 5000);
  console.log(`\nĐÁNH GIÁ: ${pass ? 'ĐẠT' : 'CHƯA ĐẠT'} (ngưỡng: p95 heartbeat < 2 s, p95 submit < 5 s, lỗi < 1 %, không busy sau retry, lan truyền p95 ≤ 5 s)`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
