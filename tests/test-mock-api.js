/* =========================================================
   Contract test cho tools/mock-api.js – mock phải hành xử y hệt google_apps_script.js
   (tech design mục 4). Bộ kịch bản `runContractScenarios(api)` được tests/test-gas.js dùng lại
   với script thật chạy trong Node, nên hai bên pass cùng một bộ là bằng chứng mock = script.
   Mock chạy trong process trên cổng tự chọn (8790 dành cho e2e, 8788 cho dev) với đồng hồ giả (để thử presence hết hạn và phòng 24 h),
   không ghi file nào vào thư mục dự án.
   Chạy: node tests/test-mock-api.js
   ========================================================= */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const TIME_RE = /^\d\d:\d\d:\d\d \d\d\/\d\d\/\d{4}$/;
const D1 = 'k3f9device0001', D2 = 'k3f9device0002', D3 = 'k3f9device0003';

function makeT() {
  const st = { pass: 0, fail: 0 };
  const T = (name, ok, detail) => {
    if (ok) st.pass++; else st.fail++;
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (!ok && detail !== undefined ? '  → ' + String(detail).slice(0, 240) : ''));
  };
  T.state = st;
  return T;
}

/**
 * Kịch bản contract dùng chung. api = {
 *   get(qs) → Promise<obj>            GET ?qs (qs không có dấu ? đầu)
 *   getRaw(qs) → Promise<{text, ct}>  bản thô để kiểm JSONP (có thể null)
 *   post(body) → Promise<obj>         body object hoặc chuỗi thô ('' = không có dữ liệu)
 *   advance(sec) → Promise            tua đồng hồ server
 *   key                               khóa người dẫn đúng
 * }
 */
async function runContractScenarios(api, T) {
  const { get, post, advance, key } = api;
  const host = (action, extra) => post(Object.assign({ action, key }, extra));

  /* ----- GET cơ bản ----- */
  T('ping → {result,pong,version:"1"}', JSON.stringify(await get('action=ping')) === '{"result":"success","pong":true,"version":"1"}', JSON.stringify(await get('action=ping')));
  T('GET không action → public_read_disabled', (await get('')).error === 'public_read_disabled');
  T('GET action lạ → unknown_action', (await get('action=dump')).error === 'unknown_action');
  T('GET action=getState (đường người dẫn) qua GET → unknown_action, không lộ câu trả lời', (await get('action=getState&room=1234')).error === 'unknown_action');
  if (api.getRaw) {
    const jp = await api.getRaw('action=ping&callback=__tladCb1');
    T('JSONP: callback hợp lệ bọc đúng tên hàm, kiểu javascript', jp.text === '__tladCb1({"result":"success","pong":true,"version":"1"});' && /javascript|js/.test(jp.ct), jp.text + ' ' + jp.ct);
    const bad = await api.getRaw('action=ping&callback=' + encodeURIComponent('x();alert(1)//'));
    T('JSONP: callback bẩn bị lọc còn chữ/số', bad.text.startsWith('xalert1({'), bad.text);
    const noCb = await api.getRaw('action=ping');
    T('Không callback → JSON thuần', noCb.text.startsWith('{') && /json/.test(noCb.ct), noCb.ct);
  }
  T('getRoom mã "12" → room_invalid', (await get('action=getRoom&room=12')).error === 'room_invalid');
  T('getRoom mã "abcd" → room_invalid', (await get('action=getRoom&room=abcd')).error === 'room_invalid');
  T('getRoom thiếu room → room_invalid', (await get('action=getRoom')).error === 'room_invalid');
  T('getRoom 0000 khi chưa có phòng → room_not_found', (await get('action=getRoom&room=0000')).error === 'room_not_found');
  T('heartbeat device "ABC" → device_invalid (trước khi tìm phòng)', (await get('action=heartbeat&room=0000&device=ABC')).error === 'device_invalid');
  T('heartbeat thiếu device → device_invalid', (await get('action=heartbeat&room=0000')).error === 'device_invalid');

  /* ----- POST cơ bản ----- */
  T('POST rỗng → no_data', (await post('')).error === 'no_data');
  T('POST JSON hỏng → bad_json', (await post('{oops')).error === 'bad_json');
  T('POST mảng → bad_json', (await post('[1,2]')).error === 'bad_json');
  T('POST không action → unknown_action', (await post({ room: '1234' })).error === 'unknown_action');
  T('POST action lạ → unknown_action', (await post({ action: 'dump', key })).error === 'unknown_action');

  /* ----- Khóa người dẫn ----- */
  for (const a of ['createRoom', 'getState', 'setQuestion', 'closeRoom', 'deleteRoom']) {
    T(a + ' không key → host_key_invalid', (await post({ action: a, room: '1234', questions: ['x'], index: 1 })).error === 'host_key_invalid');
    T(a + ' sai key → host_key_invalid', (await post({ action: a, key: 'sai-khoa-xxxxxxxxxx', room: '1234', questions: ['x'], index: 1 })).error === 'host_key_invalid');
  }
  T('createRoom key là số → host_key_invalid', (await post({ action: 'createRoom', key: 12345678, questions: ['x'] })).error === 'host_key_invalid');

  /* ----- createRoom validate ----- */
  T('createRoom questions [] → questions_required', (await host('createRoom', { questions: [] })).error === 'questions_required');
  T('createRoom questions ["  ", ""] → questions_required', (await host('createRoom', { questions: ['  ', ''] })).error === 'questions_required');
  T('createRoom questions là chuỗi → questions_required', (await host('createRoom', { questions: 'một câu' })).error === 'questions_required');
  T('createRoom thiếu questions → questions_required', (await host('createRoom', {})).error === 'questions_required');
  T('createRoom 51 câu → questions_too_many', (await host('createRoom', { questions: Array.from({ length: 51 }, (_, i) => 'Câu ' + i) })).error === 'questions_too_many');
  T('createRoom 50 câu + 5 dòng trống → success 50 câu', (await host('createRoom', { questions: Array.from({ length: 50 }, (_, i) => 'Câu ' + i).concat(['', ' ', '', '', '']) })).room.questionCount === 50);
  T('createRoom câu 501 ký tự → question_too_long', (await host('createRoom', { questions: ['ok', 'a'.repeat(501)] })).error === 'question_too_long');
  T('createRoom câu 500 emoji (1000 code unit) → success (đếm code point)', (await host('createRoom', { questions: ['😀'.repeat(500)] })).result === 'success');

  /* ----- Luồng đầy đủ ----- */
  const c = await host('createRoom', { questions: ['Câu 1', '', '  Câu 2  ', '=1+1'] });
  T('createRoom → success, mã 4 số, open, câu 1/3, createdAt đúng khuôn giờ server', c.result === 'success' && /^\d{4}$/.test(c.room.code) && c.room.status === 'open' && c.room.currentIndex === 1 && c.room.questionCount === 3 && TIME_RE.test(c.room.createdAt), JSON.stringify(c));
  T('createRoom: bỏ dòng trống, trim, câu "=1+1" thành "\'=1+1" (chống formula)', JSON.stringify(c.questions) === JSON.stringify([{ index: 1, text: 'Câu 1' }, { index: 2, text: 'Câu 2' }, { index: 3, text: "'=1+1" }]), JSON.stringify(c.questions));
  const room = c.room.code;
  const codes = new Set([room]);
  for (let i = 0; i < 5; i++) codes.add((await host('createRoom', { questions: ['x'] })).room.code);
  T('6 phòng tạo liên tiếp có mã khác nhau', codes.size === 6, [...codes].join(','));

  let r = await get('action=getRoom&room=' + room);
  T('getRoom → room + currentQuestion 1 + maxLen 280, không có answers', r.result === 'success' && r.room.code === room && r.currentQuestion.index === 1 && r.currentQuestion.text === 'Câu 1' && r.maxLen === 280 && !('answers' in r) && !('answersNew' in r), JSON.stringify(r));
  T('getRoom mã có khoảng trắng " ' + room + ' " → vẫn nhận (trim)', (await get('action=getRoom&room=' + encodeURIComponent(' ' + room + ' '))).result === 'success');

  r = await get(`action=heartbeat&room=${room}&device=${D1}`);
  T('heartbeat D1 → response y hệt getRoom', r.result === 'success' && r.currentQuestion.index === 1 && r.maxLen === 280 && JSON.stringify(Object.keys(r).sort()) === '["currentQuestion","maxLen","result","room"]', JSON.stringify(r));
  await get(`action=heartbeat&room=${room}&device=${D2}`);
  await get(`action=heartbeat&room=${room}&device=${D2}`);
  r = await host('getState', { room, since: 0 });
  T('getState since 0 → participants 2 (D2 gọi hai lần đếm một), answersNew [], cursor 0, reset false, 3 câu hỏi', r.result === 'success' && r.counts.participants === 2 && r.counts.answersTotal === 0 && r.answersNew.length === 0 && r.cursor === 0 && r.reset === false && r.questions.length === 3 && r.currentQuestion.index === 1, JSON.stringify(r));
  T('getState trả room đúng shape', JSON.stringify(Object.keys(r.room).sort()) === '["code","createdAt","currentIndex","questionCount","status"]');

  /* ----- presence hết hạn ----- */
  await advance(61);
  await get(`action=heartbeat&room=${room}&device=${D1}`);
  T('sau 61 s chỉ D1 heartbeat lại → participants 1', (await host('getState', { room, since: 0 })).counts.participants === 1);
  await advance(30);
  T('30 s sau D1 vẫn được tính (≤ 60 s)', (await host('getState', { room, since: 0 })).counts.participants === 1);
  await advance(31);
  T('61 s không heartbeat → participants 0', (await host('getState', { room, since: 0 })).counts.participants === 0);
  await get(`action=getRoom&room=${room}`);
  T('getRoom không tính là có mặt', (await host('getState', { room, since: 0 })).counts.participants === 0);
  await get(`action=heartbeat&room=${room}&device=${D1}`);
  await get(`action=heartbeat&room=${room}&device=${D2}`);
  await get(`action=heartbeat&room=${room}&device=${D3}`);

  /* ----- submitAnswer validate (thứ tự: room → device → q → text → phòng) ----- */
  const sub = (extra) => post(Object.assign({ action: 'submitAnswer', room, device: D1, q: 1, text: 'trắng xanh' }, extra));
  T('submit room "12" → room_invalid', (await sub({ room: '12' })).error === 'room_invalid');
  T('submit device "ABC" → device_invalid', (await sub({ device: 'ABC' })).error === 'device_invalid');
  T('submit device 33 ký tự → device_invalid', (await sub({ device: 'a'.repeat(33) })).error === 'device_invalid');
  T('submit q 0 → question_invalid', (await sub({ q: 0 })).error === 'question_invalid');
  T('submit q "x" → question_invalid', (await sub({ q: 'x' })).error === 'question_invalid');
  T('submit q 1.5 → question_invalid', (await sub({ q: 1.5 })).error === 'question_invalid');
  T('submit thiếu q → question_invalid', (await (async () => { const b = { action: 'submitAnswer', room, device: D1, text: 'x' }; return post(b); })()).error === 'question_invalid');
  T('submit text "" → text_required', (await sub({ text: '' })).error === 'text_required');
  T('submit text "   \\n " → text_required', (await sub({ text: '   \n ' })).error === 'text_required');
  T('submit thiếu text → text_required', (await post({ action: 'submitAnswer', room, device: D1, q: 1 })).error === 'text_required');
  T('submit 281 ký tự → text_too_long', (await sub({ text: 'a'.repeat(281) })).error === 'text_too_long');
  T('submit 280 emoji (560 code unit) → không text_too_long (đếm code point)', (await sub({ text: '😀'.repeat(280), device: 'emojidevice001' })).result === 'success');
  T('submit q 4 (> N=3) → question_invalid', (await sub({ q: 4 })).error === 'question_invalid');
  T('submit room 0000 không có → room_not_found', (await sub({ room: '0000' })).error === 'room_not_found');
  r = await sub({ q: 2 });
  T('submit q 2 khi đang câu 1 → question_changed + currentIndex 1 + currentQuestion', r.error === 'question_changed' && r.currentIndex === 1 && r.currentQuestion.index === 1 && r.currentQuestion.text === 'Câu 1', JSON.stringify(r));

  /* ----- submit thành công, trùng, formula ----- */
  r = await sub({});
  T('submit D1 → success, id room|1|D1, q 1, at giờ server', r.result === 'success' && r.id === `${room}|1|${D1}` && r.q === 1 && TIME_RE.test(r.at), JSON.stringify(r));
  T('submit D1 lại (cùng chữ) → already_answered', (await sub({})).error === 'already_answered');
  T('submit D1 lại (chữ khác) → already_answered, không ghi đè', (await sub({ text: 'khác' })).error === 'already_answered');
  T('submit D1 với q "1" dạng chuỗi → vẫn already_answered (cùng khóa)', (await sub({ q: '1' })).error === 'already_answered');
  T('submit D2 "=HYPERLINK(...)" → success', (await sub({ device: D2, text: '=HYPERLINK("http://evil";"bấm")' })).result === 'success');
  T('submit D3 "  xin chào\\nbạn  " → success (trim hai đầu, giữ xuống dòng)', (await sub({ device: D3, text: '  xin chào\nbạn  ' })).result === 'success');

  r = await host('getState', { room, since: 0 });
  T('getState since 0 → 4 câu theo thứ tự nhận, cursor 4, answersTotal 4, participants 3', r.answersNew.length === 4 && r.cursor === 4 && r.counts.answersTotal === 4 && r.counts.participants === 3 && r.answersNew[1].id === `${room}|1|${D1}` && r.answersNew[2].id === `${room}|1|${D2}` && r.answersNew[3].id === `${room}|1|${D3}`, JSON.stringify(r.answersNew));
  T('answersNew[i] shape {id,q,text,at}, không có device riêng', r.answersNew.every((a) => JSON.stringify(Object.keys(a).sort()) === '["at","id","q","text"]' && a.q === 1 && TIME_RE.test(a.at)));
  T('câu "=HYPERLINK" lưu thành "\'=HYPERLINK…" (formula injection chặn)', r.answersNew[2].text === "'=HYPERLINK(\"http://evil\";\"bấm\")", r.answersNew[2].text);
  T('câu D3 giữ xuống dòng, bỏ khoảng trắng hai đầu', r.answersNew[3].text === 'xin chào\nbạn', JSON.stringify(r.answersNew[3].text));
  T('câu D1 nguyên văn "trắng xanh"', r.answersNew[1].text === 'trắng xanh');
  T('getState since 4 → answersNew [], cursor 4', (await host('getState', { room, since: 4 })).answersNew.length === 0 && (await host('getState', { room, since: 4 })).cursor === 4);
  r = await host('getState', { room, since: 2 });
  T('getState since 2 → 2 câu mới (D2, D3)', r.answersNew.length === 2 && r.answersNew[0].id.endsWith(D2) && r.reset === false);
  r = await host('getState', { room, since: 10 });
  T('getState since 10 > cursor → reset true, trả toàn bộ 4', r.reset === true && r.answersNew.length === 4 && r.cursor === 4, JSON.stringify(r));
  T('getState since -1 / "abc" / thiếu → như 0', (await host('getState', { room, since: -1 })).answersNew.length === 4 && (await host('getState', { room, since: 'abc' })).answersNew.length === 4 && (await host('getState', { room })).answersNew.length === 4);
  T('getState since "2" chuỗi → 2 câu', (await host('getState', { room, since: '2' })).answersNew.length === 2);
  T('getState room "abcd" → room_invalid', (await host('getState', { room: 'abcd' })).error === 'room_invalid');
  T('getState room 0000 → room_not_found', (await host('getState', { room: '0000' })).error === 'room_not_found');

  /* ----- setQuestion ----- */
  T('setQuestion index 0 → question_invalid', (await host('setQuestion', { room, index: 0 })).error === 'question_invalid');
  T('setQuestion index 4 → question_invalid', (await host('setQuestion', { room, index: 4 })).error === 'question_invalid');
  T('setQuestion index "x" → question_invalid', (await host('setQuestion', { room, index: 'x' })).error === 'question_invalid');
  T('setQuestion room 0000 → room_not_found', (await host('setQuestion', { room: '0000', index: 1 })).error === 'room_not_found');
  T('setQuestion room "1" → room_invalid', (await host('setQuestion', { room: '1', index: 1 })).error === 'room_invalid');
  r = await host('setQuestion', { room, index: 2 });
  T('setQuestion 2 → success, currentIndex 2, currentQuestion "Câu 2"', r.result === 'success' && r.room.currentIndex === 2 && r.currentQuestion.index === 2 && r.currentQuestion.text === 'Câu 2', JSON.stringify(r));
  r = await get(`action=heartbeat&room=${room}&device=${D1}`);
  T('heartbeat sau đó → currentIndex 2', r.room.currentIndex === 2 && r.currentQuestion.index === 2);
  r = await sub({ q: 1, device: 'latedevice0001' });
  T('gửi câu 1 sau khi chuyển → question_changed + currentIndex 2', r.error === 'question_changed' && r.currentIndex === 2 && r.currentQuestion.index === 2, JSON.stringify(r));
  T('D1 gửi câu 2 → success (một máy mỗi câu hỏi một câu)', (await sub({ q: 2, text: 'câu hai' })).result === 'success');
  T('getState since 4 → 1 câu mới q 2', (await (async () => { const s = await host('getState', { room, since: 4 }); return s.answersNew.length === 1 && s.answersNew[0].q === 2 && s.cursor === 5; })()));
  T('setQuestion "3" chuỗi → nhận, currentIndex 3', (await host('setQuestion', { room, index: '3' })).room.currentIndex === 3);
  T('setQuestion về 1 → currentIndex 1, câu trả lời cũ còn (cursor 5)', (await host('setQuestion', { room, index: 1 })).room.currentIndex === 1 && (await host('getState', { room, since: 0 })).cursor === 5);

  /* ----- closeRoom ----- */
  T('closeRoom room "abcd" → room_invalid', (await host('closeRoom', { room: 'abcd' })).error === 'room_invalid');
  T('closeRoom room 0000 → room_not_found', (await host('closeRoom', { room: '0000' })).error === 'room_not_found');
  r = await host('closeRoom', { room });
  T('closeRoom → success, status closed, counts.answersTotal 5', r.result === 'success' && r.room.status === 'closed' && r.counts.answersTotal === 5, JSON.stringify(r));
  T('closeRoom lần hai → vẫn success (idempotent)', (await host('closeRoom', { room })).result === 'success');
  r = await get(`action=heartbeat&room=${room}&device=${D1}`);
  T('heartbeat phòng đóng → success, status closed, currentQuestion null', r.result === 'success' && r.room.status === 'closed' && r.currentQuestion === null, JSON.stringify(r));
  T('getRoom phòng đóng → status closed', (await get(`action=getRoom&room=${room}`)).room.status === 'closed');
  T('submit sau khi đóng → room_closed', (await sub({ q: 1, device: 'afterclose0001' })).error === 'room_closed');
  T('setQuestion sau khi đóng → room_closed', (await host('setQuestion', { room, index: 2 })).error === 'room_closed');
  r = await host('getState', { room, since: 0 });
  T('getState phòng đóng vẫn trả đủ 5 câu để tải CSV, participants 0 (đã xóa presence)', r.result === 'success' && r.room.status === 'closed' && r.answersNew.length === 5 && r.counts.participants === 0, JSON.stringify(r.counts));

  /* ----- deleteRoom ----- */
  T('deleteRoom room "abcd" → room_invalid', (await host('deleteRoom', { room: 'abcd' })).error === 'room_invalid');
  r = await host('deleteRoom', { room });
  T('deleteRoom → deleted {rooms:1, questions:3, answers:5}', r.result === 'success' && JSON.stringify(r.deleted) === '{"rooms":1,"questions":3,"answers":5}', JSON.stringify(r));
  T('getRoom sau xóa → room_not_found', (await get(`action=getRoom&room=${room}`)).error === 'room_not_found');
  T('heartbeat sau xóa → room_not_found', (await get(`action=heartbeat&room=${room}&device=${D1}`)).error === 'room_not_found');
  T('getState sau xóa → room_not_found', (await host('getState', { room, since: 0 })).error === 'room_not_found');
  T('submit sau xóa → room_not_found', (await sub({ device: 'afterdelete001' })).error === 'room_not_found');
  T('closeRoom sau xóa → room_not_found', (await host('closeRoom', { room })).error === 'room_not_found');
  T('deleteRoom lần hai → success với số 0', JSON.stringify((await host('deleteRoom', { room })).deleted) === '{"rooms":0,"questions":0,"answers":0}');

  /* ----- Phòng khác không bị ảnh hưởng khi xóa ----- */
  const other = (await host('createRoom', { questions: ['Khác'] })).room.code;
  await post({ action: 'submitAnswer', room: other, device: D1, q: 1, text: 'của phòng khác' });
  const victim = (await host('createRoom', { questions: ['Nạn nhân'] })).room.code;
  await post({ action: 'submitAnswer', room: victim, device: D1, q: 1, text: 'bị xóa' });
  await host('deleteRoom', { room: victim });
  r = await host('getState', { room: other, since: 0 });
  T('xóa phòng B không ảnh hưởng phòng A (cursor theo phòng)', r.result === 'success' && r.cursor === 1 && r.answersNew[0].text === 'của phòng khác', JSON.stringify(r));
  T('D1 đã trả lời phòng A vẫn gửi được ở phòng mới (khóa theo room|q|device)', (await (async () => { const n = (await host('createRoom', { questions: ['Mới'] })).room.code; return post({ action: 'submitAnswer', room: n, device: D1, q: 1, text: 'ok' }); })()).result === 'success');

  /* ----- room_full 500 ----- */
  const full = (await host('createRoom', { questions: ['Đầy'] })).room.code;
  const results = [];
  for (let i = 0; i < 500; i += 50) {
    results.push(...await Promise.all(Array.from({ length: 50 }, (_, j) => post({ action: 'submitAnswer', room: full, device: 'fulldev' + String(i + j).padStart(8, '0'), q: 1, text: 'câu ' + (i + j) }))));
  }
  T('500 máy khác nhau gửi → 500 success', results.every((x) => x.result === 'success'), results.filter((x) => x.result !== 'success').slice(0, 2).map((x) => x.error).join(','));
  T('máy thứ 501 → room_full', (await post({ action: 'submitAnswer', room: full, device: 'fulldev99999999', q: 1, text: 'thừa' })).error === 'room_full');
  T('máy đã gửi gửi lại khi đầy → already_answered (không phải room_full)', (await post({ action: 'submitAnswer', room: full, device: 'fulldev00000003', q: 1, text: 'lại' })).error === 'already_answered');
  T('getState phòng đầy → cursor 500', (await host('getState', { room: full, since: 0 })).cursor === 500);
  await host('deleteRoom', { room: full });

  /* ----- Phòng tự đóng sau 24 h ----- */
  const old = (await host('createRoom', { questions: ['Cũ'] })).room.code;
  await advance(23 * 3600);
  T('phòng 23 h vẫn open', (await get(`action=getRoom&room=${old}`)).room.status === 'open');
  await advance(2 * 3600);
  r = await get(`action=heartbeat&room=${old}&device=${D1}`);
  T('phòng 25 h → heartbeat thấy closed, currentQuestion null', r.room.status === 'closed' && r.currentQuestion === null, JSON.stringify(r));
  T('gửi vào phòng 25 h → room_closed', (await post({ action: 'submitAnswer', room: old, device: D1, q: 1, text: 'muộn' })).error === 'room_closed');
  const fresh = await host('createRoom', { questions: ['Mới sau dọn nhà'] });
  T('createRoom sau đó (dọn nhà) → success và phòng mới open', fresh.result === 'success' && fresh.room.status === 'open');
  T('phòng cũ sau dọn nhà vẫn closed qua getState', (await host('getState', { room: old, since: 0 })).room.status === 'closed');
  return { old, fresh: fresh.room.code };
}

/* ===== Chạy với mock ===== */
async function main() {
  const T = makeT();
  const mock = require(path.join(__dirname, '..', 'tools', 'mock-api.js'));
  const APP = path.resolve(__dirname, '..');
  const PORT = 0;   // cổng tự chọn: 8790 dành cho e2e của QA, 8788 cho mock dev
  let clock = Date.now();
  const srv = await mock.startServer({ port: PORT, quiet: true, lockMs: 1, now: () => clock });
  const base = 'http://127.0.0.1:' + srv.port + '/';
  const api = {
    key: 'demo-host-key-0000',
    get: async (qs) => (await fetch(base + (qs ? '?' + qs : ''))).json(),
    getRaw: async (qs) => { const r = await fetch(base + '?' + qs); return { text: await r.text(), ct: r.headers.get('content-type'), cors: r.headers.get('access-control-allow-origin') }; },
    post: async (body) => (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: typeof body === 'string' ? body : JSON.stringify(body) })).json(),
    advance: async (sec) => { clock += sec * 1000; }
  };
  try {
    T('mock khởi động trên cổng tự chọn ' + srv.port, (await api.get('action=ping')).pong === true);
    await runContractScenarios(api, T);

    /* Riêng cho mock: CORS, OPTIONS, không ghi file, host_key_not_set, MOCK_DATA, --busy */
    T('CORS: Access-Control-Allow-Origin *', (await api.getRaw('action=ping')).cors === '*');
    const opt = await fetch(base, { method: 'OPTIONS' });
    T('OPTIONS → 204 với CORS', opt.status === 204 && opt.headers.get('access-control-allow-origin') === '*');
    T('mock không tạo file nào trong thư mục app (tools/, tests/, gốc)', !fs.readdirSync(path.join(APP, 'tools')).some((f) => /\.json$/.test(f)) && !fs.readdirSync(APP).some((f) => /mock.*\.json$/.test(f)));
    T('mock-api.js không có đường dẫn file mặc định (chỉ ghi khi MOCK_DATA)', !/tmpdir\(\)/.test(fs.readFileSync(path.join(APP, 'tools', 'mock-api.js'), 'utf8')));
    T('parseArgs: mặc định cổng 8788, khóa demo-host-key-0000, không file', (() => { const a = mock.parseArgs([]); return a.port === 8788 && a.hostKey === 'demo-host-key-0000' && a.dataFile === ''; })());
    T('parseArgs: --slow → 2000 ms, --latency 300, --flaky 0.2, --fail-rate 0.5, --busy 0.3', (() => { const a = mock.parseArgs(['--slow']); const b = mock.parseArgs(['--latency', '300', '--fail-rate', '0.5']); const c = mock.parseArgs(['--flaky', '--busy']); return a.latencyMs === 2000 && b.latencyMs === 300 && b.failRate === 0.5 && c.failRate === 0.2 && c.busyRate === 0.3; })());

    const noKey = mock.createMock({ hostKey: '', lockMs: 0 });
    T('mock HOST_KEY rỗng → host_key_not_set cho mọi thao tác người dẫn', (await noKey.handlePost(JSON.stringify({ action: 'createRoom', key: 'x', questions: ['a'] }))).error === 'host_key_not_set' && (await noKey.handlePost(JSON.stringify({ action: 'getState', room: '1234' }))).error === 'host_key_not_set');
    T('mock HOST_KEY rỗng: ping vẫn chạy', noKey.handleGet({ action: 'ping' }).pong === true);

    const busy = mock.createMock({ busyRate: 1, lockMs: 0 });
    const bc = await busy.handlePost(JSON.stringify({ action: 'createRoom', key: 'demo-host-key-0000', questions: ['a'] }));
    T('--busy 100 %: submitAnswer → busy, createRoom vẫn chạy', bc.result === 'success' && (await busy.handlePost(JSON.stringify({ action: 'submitAnswer', room: bc.room.code, device: D1, q: 1, text: 'x' }))).error === 'busy');

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tlad-mock-'));
    const dataFile = path.join(tmp, 'state.json');
    const persist = mock.createMock({ dataFile, lockMs: 0 });
    const pc = await persist.handlePost(JSON.stringify({ action: 'createRoom', key: 'demo-host-key-0000', questions: ['bền'] }));
    await persist.handlePost(JSON.stringify({ action: 'submitAnswer', room: pc.room.code, device: D1, q: 1, text: 'còn' }));
    const reloaded = mock.createMock({ dataFile, lockMs: 0 });
    T('MOCK_DATA: tắt mở lại vẫn còn phòng và câu trả lời', reloaded.handleGet({ action: 'getRoom', room: pc.room.code }).result === 'success' && (await reloaded.handlePost(JSON.stringify({ action: 'getState', key: 'demo-host-key-0000', room: pc.room.code, since: 0 }))).cursor === 1);
    T('MOCK_DATA: tab Answers đúng 5 cột', JSON.parse(fs.readFileSync(dataFile, 'utf8')).answers.every((row) => row.length === 5));
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* bỏ qua */ }

    // Review mục 2: 400 device heartbeat → vẫn success, presence cap 300
    const crowd = mock.createMock({ lockMs: 0 });
    const cr = await crowd.handlePost(JSON.stringify({ action: 'createRoom', key: 'demo-host-key-0000', questions: ['đông'] }));
    const hb = Array.from({ length: 400 }, (_, i) => crowd.handleGet({ action: 'heartbeat', room: cr.room.code, device: 'crowd' + String(i).padStart(10, '0') }));
    T('400 device heartbeat → 400 success', hb.every((x) => x.result === 'success'));
    T('presence cap 300: participants = 300, giữ mục mới nhất', (await crowd.handlePost(JSON.stringify({ action: 'getState', key: 'demo-host-key-0000', room: cr.room.code, since: 0 }))).counts.participants === 300 && 'crowd0000000399' in crowd.presence[cr.room.code] && !('crowd0000000000' in crowd.presence[cr.room.code]));

    // Review mục 3: xóa phòng → tạo lại trúng mã → device cũ gửi được
    const reuse = mock.createMock({ lockMs: 0, randomCode: () => '7777' });
    const hp = (o) => reuse.handlePost(JSON.stringify(Object.assign({ key: 'demo-host-key-0000' }, o)));
    T('ép mã 7777 → createRoom 7777', (await hp({ action: 'createRoom', questions: ['Lần 1'] })).room.code === '7777');
    T('D1 gửi lần 1 → success', (await hp({ action: 'submitAnswer', room: '7777', device: 'reusedevice001', q: 1, text: 'lần 1' })).result === 'success');
    T('7777 còn → tạo cùng mã → code_exhausted', (await hp({ action: 'createRoom', questions: ['Trùng'] })).error === 'code_exhausted');
    T('deleteRoom 7777 → answers 1', (await hp({ action: 'deleteRoom', room: '7777' })).deleted.answers === 1);
    T('tạo lại 7777 → success', (await hp({ action: 'createRoom', questions: ['Lần 2'] })).room.code === '7777');
    const again = await hp({ action: 'submitAnswer', room: '7777', device: 'reusedevice001', q: 1, text: 'lần 2' });
    T('device cũ gửi vào phòng mới trùng mã → success (không already_answered giả)', again.result === 'success', JSON.stringify(again));
    T('getState 7777 mới chỉ có "lần 2"', (await (async () => { const s = await hp({ action: 'getState', room: '7777', since: 0 }); return s.cursor === 1 && s.answersNew[0].text === 'lần 2'; })()));

    // server_error: handler ném → JSON server_error trần, không sập server
    const brokenGet = srv.mock.handleGet;
    srv.mock.handleGet = () => { throw new Error('boom'); };
    const se = await api.get('action=ping');
    srv.mock.handleGet = brokenGet;
    T('handler ném lỗi → {result:error, error:server_error} trần, server còn sống', JSON.stringify(se) === '{"result":"error","error":"server_error"}' && (await api.get('action=ping')).pong === true, JSON.stringify(se));

    // Lock giả xếp hàng: 10 submit đồng thời với lockMs 1 → đều success, không trùng dòng
    const lk = mock.createMock({ lockMs: 1 });
    const lr = await lk.handlePost(JSON.stringify({ action: 'createRoom', key: 'demo-host-key-0000', questions: ['xếp hàng'] }));
    const burst = await Promise.all(Array.from({ length: 10 }, (_, i) => lk.handlePost(JSON.stringify({ action: 'submitAnswer', room: lr.room.code, device: 'burstdev' + String(i).padStart(6, '0'), q: 1, text: 'c' + i }))));
    const dupBurst = await Promise.all(Array.from({ length: 5 }, () => lk.handlePost(JSON.stringify({ action: 'submitAnswer', room: lr.room.code, device: 'samedevice0001', q: 1, text: 'đúp' }))));
    T('lock giả: 10 submit đồng thời → 10 success, thứ tự dòng = thứ tự xong', burst.every((x) => x.result === 'success') && lk.sheet.answers.filter((r) => r[1] === lr.room.code).length === 15 - 4);
    T('lock giả: 5 request cùng device đồng thời → đúng 1 success + 4 already_answered', dupBurst.filter((x) => x.result === 'success').length === 1 && dupBurst.filter((x) => x.error === 'already_answered').length === 4, JSON.stringify(dupBurst.map((x) => x.result + ':' + (x.error || ''))));
  } finally {
    await srv.close();
  }
  const s = T.state;
  console.log(`\n${s.pass} PASS, ${s.fail} FAIL (test-mock-api)`);
  process.exit(s.fail ? 1 : 0);
}

module.exports = { runContractScenarios, makeT, TIME_RE };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
