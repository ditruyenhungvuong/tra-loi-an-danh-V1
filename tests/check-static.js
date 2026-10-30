/* =========================================================
   Rà tĩnh (QA) – Trả lời ẩn danh. Không cần trình duyệt.
   - node --check cho 7 file JS của app (config, ui, store, api, join, host, google_apps_script) + mock + load-test.
   - HTML có đủ id / data-act theo tech design mục 6 (theo danh sách thực tế dev đã báo).
   - Microcopy nguyên văn PRD Phụ lục A có mặt trong HTML/JS.
   - js/config.js không chứa khóa người dẫn / mã phòng; không onclick= / alert( trong HTML/JS.
   - MOCK: true → CẢNH BÁO (chạy local là đúng; upload.bat đã chặn). Thêm --strict thì coi là lỗi (trước khi deploy).
   - Giọng viết trang tham gia: "bạn"/"mình", không "chị"/"anh/chị", không từ y khoa.
   - Hằng số đồng bộ: 280 / 500 / 50 / regex mã phòng và deviceId giữa config, HTML, mock, Apps Script.
   Chạy: node tests/check-static.js [--strict]
   ========================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const APP = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');
const read = f => fs.readFileSync(path.join(APP, f), 'utf8');
const exists = f => fs.existsSync(path.join(APP, f));

const indexHtml = read('index.html');
const hostHtml = read('host.html');
const cfg = read('js/config.js');
const ui = read('js/ui.js');
const store = read('js/store.js');
const api = read('js/api.js');
const join = read('js/join.js');
const host = read('js/host.js');
const gas = read('google_apps_script.js');
const mock = read('tools/mock-api.js');
const stylesCss = read('css/styles.css');
const hostCss = read('css/host.css');
const joinCss = read('css/join.css');

let fails = 0, warns = 0;
const T = (name, ok, detail) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  → ' + String(detail).replace(/\s+/g, ' ').slice(0, 220) : '')); };
const W = (name, ok, detail) => { if (!ok) warns++; console.log((ok ? 'PASS ' : 'WARN ') + name + (detail !== undefined ? '  → ' + String(detail).replace(/\s+/g, ' ').slice(0, 220) : '')); };
const stripHtmlComments = s => s.replace(/<!--[\s\S]*?-->/g, '');
const stripJsComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');

/* ===== 1. Cú pháp ===== */
const JS_FILES = ['js/config.js', 'js/ui.js', 'js/store.js', 'js/api.js', 'js/join.js', 'js/host.js', 'google_apps_script.js', 'tools/mock-api.js', 'tools/load-test.js', 'vendor/qrcode.min.js'];
for (const f of JS_FILES) {
  const r = spawnSync(process.execPath, ['--check', path.join(APP, f)], { encoding: 'utf8' });
  T('node --check ' + f, r.status === 0, r.stderr.trim());
}
T('Thứ tự nạp script index.html: config → ui → store → api → join', /config\.js[\s\S]*ui\.js[\s\S]*store\.js[\s\S]*api\.js[\s\S]*join\.js/.test(indexHtml) && !/type="module"/.test(indexHtml));
T('Thứ tự nạp script host.html: config → ui → store → api → qrcode → host', /config\.js[\s\S]*ui\.js[\s\S]*store\.js[\s\S]*api\.js[\s\S]*vendor\/qrcode\.min\.js[\s\S]*host\.js/.test(hostHtml) && !/type="module"/.test(hostHtml));
T('Không dùng ?. / ?? trong JS app (WebView cũ)', ![ui, store, api, join, host].some(s => /\?\.[a-zA-Z(\[]|\?\?/.test(stripJsComments(s))));

/* ===== 2. id / data-act theo tech design mục 6 (đã cập nhật theo điểm lệch dev báo) ===== */
const attr = (html, id) => { const m = html.match(new RegExp('<[a-z]+[^>]*\\bid="' + id + '"[^>]*>')); return m ? m[0] : null; };
const hasId = (html, id) => !!attr(html, id);
const INDEX_IDS = ['main', 'toast', 'scr-loading', 'scr-enter', 'room-code', 'btn-enter', 'enter-error', 'enter-hint', 'scr-room', 'q-live', 'q-label', 'q-text', 'q-changed',
  'answer-form', 'answer', 'answer-count', 'name-note', 'transparency', 'send-error', 'send-hint', 'btn-send', 'sent', 'sent-title', 'sent-text', 'sent-body', 'sent-note', 'net-status', 'scr-closed', 'closed-title', 'closed-lead', 'btn-forget'];
for (const id of INDEX_IDS) T('index.html có #' + id, hasId(indexHtml, id));
const HOST_IDS = ['main', 'toast', 'scr-key', 'host-key', 'key-show', 'btn-key', 'key-error', 'scr-create', 'questions', 'questions-count', 'create-error', 'create-hint', 'btn-create',
  'scr-stage', 'stage-q-label', 'stage-q-text', 'qr', 'room-code-big', 'join-url', 'cards-empty', 'cards', 'count-participants', 'count-answers', 'count-shown', 'count-hidden', 'net-status', 'next-hint',
  'btn-prev-q', 'btn-next', 'btn-show-all', 'btn-hide-all', 'btn-next-q', 'btn-close', 'data-menu', 'btn-copy-link', 'btn-csv', 'btn-delete',
  'scr-ended', 'ended-title', 'ended-summary', 'btn-csv-end', 'btn-new', 'btn-delete-end', 'confirm', 'confirm-box', 'confirm-body', 'confirm-title', 'confirm-text', 'btn-confirm-no', 'btn-confirm-yes', 'tab-overlay', 'overlay-title', 'btn-claim'];
for (const id of HOST_IDS) T('host.html có #' + id, hasId(hostHtml, id));
const DATA_ACT_INDEX = { 'btn-enter': 'enter', 'btn-send': 'send', 'btn-forget': 'forget' };
for (const id in DATA_ACT_INDEX) T('index.html #' + id + ' có data-act="' + DATA_ACT_INDEX[id] + '"', (attr(indexHtml, id) || '').includes('data-act="' + DATA_ACT_INDEX[id] + '"'));
T('index.html có nút data-act="clear-draft" trong #q-changed', /id="q-changed"[\s\S]*?data-act="clear-draft"[\s\S]*?<\/p>/.test(indexHtml));
const DATA_ACT_HOST = { 'btn-key': 'key', 'key-show': 'toggle-key', 'btn-create': 'create', 'btn-prev-q': 'prev-q', 'btn-next': 'next', 'btn-show-all': 'show-all', 'btn-hide-all': 'hide-all', 'btn-next-q': 'next-q', 'btn-close': 'close',
  'btn-copy-link': 'copy-link', 'btn-csv': 'csv', 'btn-delete': 'delete', 'btn-csv-end': 'csv', 'btn-new': 'new', 'btn-delete-end': 'delete', 'btn-confirm-no': 'confirm-no', 'btn-confirm-yes': 'confirm-yes', 'btn-claim': 'claim' };
for (const id in DATA_ACT_HOST) T('host.html #' + id + ' có data-act="' + DATA_ACT_HOST[id] + '"', (attr(hostHtml, id) || '').includes('data-act="' + DATA_ACT_HOST[id] + '"'));
T('host.js: card có data-act="hide" + data-id + aria-label (render bằng JS)', /data-act="hide" data-id="' \+ esc\(a\.id\) \+ '" aria-label="/.test(host));
const roomCode = attr(indexHtml, 'room-code') || '';
T('#room-code: type=text inputmode=numeric pattern=[0-9]* maxlength=4 autocomplete=one-time-code enterkeyhint=go', ['type="text"', 'inputmode="numeric"', 'pattern="[0-9]*"', 'maxlength="4"', 'autocomplete="one-time-code"', 'enterkeyhint="go"'].every(a => roomCode.includes(a)), roomCode);
T('#room-code không autofocus (bàn phím che màn 375px)', !/autofocus/.test(stripHtmlComments(indexHtml)) && !/autofocus/.test(stripHtmlComments(hostHtml)));
const answer = attr(indexHtml, 'answer') || '';
T('#answer: maxlength=280, aria-describedby có answer-count + transparency', answer.includes('maxlength="280"') && /aria-describedby="[^"]*answer-count[^"]*"/.test(answer) && /aria-describedby="[^"]*transparency[^"]*"/.test(answer), answer);
T('#q-live aria-live="polite"', (attr(indexHtml, 'q-live') || '').includes('aria-live="polite"'));
T('#enter-error, #enter-hint, #send-hint, #answer-count, #net-status (index) aria-live="polite"', ['enter-error', 'enter-hint', 'send-hint', 'answer-count', 'net-status'].every(id => (attr(indexHtml, id) || '').includes('aria-live="polite"')));
T('#toast role=status aria-live=polite ở cả hai trang', [indexHtml, hostHtml].every(h => /id="toast"[^>]*role="status"[^>]*aria-live="polite"/.test(h)));
T('#host-key type=password', (attr(hostHtml, 'host-key') || '').includes('type="password"'));
T('#confirm role=dialog aria-modal hidden', /id="confirm"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*hidden/.test(hostHtml));
T('#tab-overlay hidden lúc tải', /id="tab-overlay"[^>]*hidden/.test(hostHtml));
T('.counter-bar aria-live="polite" (host)', /class="counter-bar"[^>]*aria-live="polite"/.test(hostHtml));
T('Vùng card #cards KHÔNG aria-live (tránh ồn)', !/id="cards"[^>]*aria-live/.test(hostHtml));
T('Label sr-only: Mã phòng, Câu trả lời của bạn, Khóa người dẫn, Danh sách câu hỏi', /for="room-code">Mã phòng</.test(indexHtml) && /for="answer">Câu trả lời của bạn</.test(indexHtml) && /for="host-key">Khóa người dẫn</.test(hostHtml) && /for="questions">Danh sách câu hỏi</.test(hostHtml));
T('lang="vi", viewport không maximum-scale, không user-scalable=no', [indexHtml, hostHtml].every(h => /<html lang="vi">/.test(h) && !/maximum-scale|user-scalable=no/.test(h)));
T('meta robots noindex ở cả hai trang (không lên Google)', [indexHtml, hostHtml].every(h => /name="robots" content="noindex"/.test(h)));

/* ===== 3. Microcopy nguyên văn PRD Phụ lục A ===== */
const A1_HTML = ['💬 Trả lời ẩn danh', '>Vào phòng<', 'Gõ 4 số trên màn chiếu, hoặc quét QR là vào thẳng.', 'placeholder="Ví dụ 1234"', '>Vào phòng ›<'];
const A1_JS = ['Mình không tìm thấy phòng này. Bạn kiểm tra lại mã trên màn chiếu nhé.', 'Phòng này đã kết thúc', 'Cám ơn bạn đã tham gia.'];
const A2_HTML = ['placeholder="Gõ câu trả lời của bạn ở đây…"', 'Câu trả lời của bạn hiện lên màn chiếu, không kèm tên. Không ai biết ai gửi. Gửi rồi thì không sửa được, bạn đọc lại một lần nhé.',
  'Đừng ghi tên người thật nhé.', '>Gửi ›<', '>Đã gửi ✓<', 'Chờ câu tiếp theo nhé.', 'Người dẫn vừa chuyển câu. Câu bạn đang gõ sẽ gửi cho câu mới này. Bạn xem lại hoặc xóa nhé.',
  'Chưa gửi được. Mạng hơi chậm, bạn thử lại nhé.', 'Đang kết nối lại…', 'Xóa dấu vết trên máy này'];
const A2_JS = ['Gõ một câu rồi gửi nhé.', 'Bạn đã gửi câu này rồi. Chờ câu tiếp theo nhé.', 'Gửi lại', 'Cám ơn bạn', 'Buổi hôm nay đã xong. Cám ơn bạn đã góp một câu.', "'Câu ' + k + '/' + n", "len + '/' + MAX"];
const A3_HTML = ['>Tạo phòng mới<', 'Mỗi dòng một câu hỏi. Thứ tự dòng là thứ tự hỏi.', 'placeholder="Hãy nhìn quanh bạn và tìm 5 màu sắc đang có ở đây."', '>Tạo phòng ›<'];
const A3_JS = ['Nhập ít nhất một câu hỏi nhé.', 'Mình chưa nhận ra bạn là người dẫn. Kiểm tra lại link nhé.'];
const A4_HTML = ['Quét để vào', 'hoặc mở <span id="join-url"></span> và gõ mã', 'Chưa có câu trả lời nào. Mời mọi người quét QR nhé.', '>Tiếp ›<', '>Hiện tất cả<', '>Ẩn<', '>‹ Câu trước<', '>Câu tiếp ›<', '>Kết thúc phòng<', '>Cám ơn cả lớp<', 'Dữ liệu phòng', '>Tải CSV<', '>Xóa toàn bộ phòng<'];
const A4_JS = ["'👥 ' + n + ' người đang tham gia'", "'✉️ ' + m + ' câu trả lời'", "'đã hiện ' + a + '/' + m", 'Đã hiện hết. Chờ thêm câu mới hoặc chuyển câu hỏi nhé.',
  'Kết thúc thì mọi người không gửi thêm được. Dữ liệu vẫn còn để tải.', 'Tôi hiểu, kết thúc', "m + ' câu trả lời cho ' + n + ' câu hỏi.'", "'Tôi hiểu, xóa toàn bộ (' + s + ')'", 'Đã tải CSV.', "'Đã xóa dữ liệu phòng ' + code + '.'"];
for (const s of A1_HTML) T('A.1 index.html có "' + s + '"', indexHtml.includes(s));
for (const s of A1_JS) T('A.1 join.js có "' + s + '"', join.includes(s));
for (const s of A2_HTML) T('A.2 index.html có "' + s + '"', indexHtml.includes(s));
for (const s of A2_JS) T('A.2 join.js có "' + s + '"', join.includes(s));
for (const s of A3_HTML) T('A.3 host.html có "' + s + '"', hostHtml.includes(s));
for (const s of A3_JS) T('A.3 host.js có "' + s + '"', host.includes(s));
for (const s of A4_HTML) T('A.4/A.5 host.html có "' + s + '"', hostHtml.includes(s));
for (const s of A4_JS) T('A.4/A.5 host.js có "' + s + '"', host.includes(s));
T('A.3 "Trống" hint tạo phòng có mặt trong HTML lúc tải', hostHtml.includes('Nhập ít nhất một câu hỏi nhé.'));
T('A.2 hint ô trống có mặt trong HTML lúc tải', indexHtml.includes('Gõ một câu rồi gửi nhé.'));
T('UX 6.4 H0: "Khóa người dẫn", "Dán khóa đã nhận. Máy này sẽ nhớ cho lần sau.", "Không chiếu màn này lên lớp."', ['>Khóa người dẫn<', 'Dán khóa đã nhận. Máy này sẽ nhớ cho lần sau.', 'Không chiếu màn này lên lớp.'].every(s => hostHtml.includes(s)));
T('UX 6.6 ✕ aria-label "Ẩn câu trả lời này", toast "Đã ẩn một câu."', host.includes("hideLabel: 'Ẩn câu trả lời này'") && host.includes("'Đã ẩn một câu.'"));
T('UX 6.6 hint phím "Space / → = Tiếp"', hostHtml.includes('Space / → = Tiếp'));
T('UX: hộp xác nhận có nút "Để sau"', hostHtml.includes('>Để sau<'));

/* ===== 4. Giọng viết trang tham gia (style guide mục 2): "bạn"/"mình", không "chị", không y khoa ===== */
const joinText = stripHtmlComments(indexHtml).replace(/<[^>]+>/g, ' ') + ' ' + [...stripJsComments(join).matchAll(/'([^'\\]*(?:\\.[^'\\]*)*)'/g)].map(m => m[1]).join(' ');
T('Giọng: trang tham gia không dùng "chị"/"anh/chị"/"em" lẻ', !/\b(chị|anh\/chị|Anh\/chị|Chị)\b/.test(joinText), (joinText.match(/.{0,30}\b(chị|anh\/chị)\b.{0,30}/) || [''])[0]);
T('Giọng: không từ y khoa (bệnh nhân, chẩn đoán, triệu chứng, điều trị, rối loạn, trầm cảm, lo âu)', !/bệnh nhân|chẩn đoán|triệu chứng|điều trị|rối loạn|trầm cảm|lo âu/i.test(joinText + stripHtmlComments(hostHtml).replace(/<[^>]+>/g, ' ')));
T('Giọng: không ép tích cực ("hãy vui", "cố lên", "phải")', !/hãy vui|cố lên|bạn phải/i.test(joinText));
T('Giọng: dòng chữ "Không cần tên, không cần tài khoản." ở màn vào phòng', indexHtml.includes('Không cần tên, không cần tài khoản.'));

/* ===== 5. An toàn: config không chứa khóa, không onclick/alert, esc() ở chỗ render ===== */
const cfgCode = stripJsComments(cfg);
T("config.js: không có khóa người dẫn ('demo-host-key', HOST_KEY, key:)", !/demo-host-key|HOST_KEY|\bkey\s*:/i.test(cfgCode), (cfgCode.match(/.{0,40}(demo-host-key|HOST_KEY|\bkey\s*:).{0,40}/i) || [''])[0]);
T('config.js: không có mã phòng 4 số gán sẵn (ROOM: / room:)', !/\b(ROOM|room)\s*:\s*['"]?\d{4}/.test(cfgCode));
T('config.js: chỉ gán window.APP_CONFIG + tính BASE_URL, không fetch/XMLHttpRequest', !/fetch\(|XMLHttpRequest/.test(cfgCode));
T('config.js: có GOOGLE_SCRIPT_URL, MOCK, MOCK_URL, POLL_HOST_MS, POLL_JOIN_MS, KEYS_NEXT', ['GOOGLE_SCRIPT_URL', 'MOCK:', 'MOCK_URL', 'POLL_HOST_MS', 'POLL_JOIN_MS', 'KEYS_NEXT'].every(k => cfgCode.includes(k)));
const mockOn = /MOCK:\s*true/.test(cfgCode);
if (STRICT) T('config.js: MOCK: false trước khi deploy (--strict)', !mockOn, 'đang MOCK: true');
else W('config.js: MOCK đang ' + (mockOn ? 'TRUE – chỉ đúng khi chạy local; đổi MOCK: false trước khi upload (upload.bat tự chặn)' : 'false'), !mockOn);
W('config.js: GOOGLE_SCRIPT_URL ' + (/GOOGLE_SCRIPT_URL:\s*''/.test(cfgCode) ? 'còn trống – cần dán URL Web App trước khi dùng thật' : 'đã có'), !/GOOGLE_SCRIPT_URL:\s*''/.test(cfgCode));
T('upload.bat chặn đẩy khi MOCK: true', /MOCK: *true/.test(read('upload.bat')) && /findstr/.test(read('upload.bat')));
for (const [name, src] of [['index.html', indexHtml], ['host.html', hostHtml], ['join.js', join], ['host.js', host], ['ui.js', ui], ['api.js', api], ['store.js', store]]) {
  const code = name.endsWith('.html') ? stripHtmlComments(src) : stripJsComments(src);
  T(name + ': không onclick= / alert( / confirm( / prompt(', !/onclick\s*=|\balert\s*\(|\bconfirm\s*\(|\bprompt\s*\(/.test(code), (code.match(/.{0,40}(onclick\s*=|\balert\s*\(|\bconfirm\s*\(|\bprompt\s*\().{0,40}/) || [''])[0]);
  T(name + ': không javascript: URL, không document.write, không eval', !/javascript:|document\.write|\beval\s*\(/.test(code));
}
T('ui.esc: thoát & < > " \'', /'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'/.test(ui));
T('host.js: card-text và data-id qua esc()', /'<p class="card-text">' \+ esc\(a\.text\) \+ '<\/p>'/.test(host) && /data-id="' \+ esc\(a\.id\) \+ '"/.test(host));
T('join.js: sent-body qua esc()', /el\.sentBody\.innerHTML = hasText \? esc\(text\) : ''/.test(join));
T('join.js/host.js: câu hỏi gán bằng textContent (không innerHTML)', /el\.qText\.textContent = /.test(join) && /el\.stageQ\.textContent = text/.test(host));
T('host.js: innerHTML chỉ ở renderCards, renderQR (SVG của thư viện), setCreateError (chuỗi tĩnh đã esc)', (stripJsComments(host).match(/\.innerHTML\s*=/g) || []).length <= 5, (stripJsComments(host).match(/\.innerHTML\s*=/g) || []).length + ' chỗ');
T('host.js: xóa ?key= khỏi URL bằng history.replaceState ngay lúc tải', /history\.replaceState\(null, '', location\.pathname \+ location\.hash\)/.test(host));
T('api.js: lời gọi người dẫn chỉ POST, key trong body', /createRoom: \(key, questions\) => postJSON\(\{ action: 'createRoom', key, questions \}\)/.test(api) && !/action=getState|action=createRoom|key=/.test(stripJsComments(api)));
T('api.js: POST Content-Type text/plain;charset=utf-8 (không preflight)', api.includes("'Content-Type': 'text/plain;charset=utf-8'"));
T('api.js: mọi hàm trả Promise luôn resolve (normalize + catch → network/timeout)', /ERR\(err && err\.name === 'AbortError' \? 'timeout' : 'network'\)/.test(api) && /function normalize\(r\)/.test(api));
T('store.js: mọi localStorage trong try/catch; chỉ 4 khóa tlad_*', /KEYS = \{ device: 'tlad_device', join: 'tlad_join', hostKey: 'tlad_host_key', host: 'tlad_host' \}/.test(store) && !/localStorage\.(get|set|remove)Item\([^)]*\)(?![\s\S]{0,40}catch)/.test(store.replace(/try \{[^}]*\}/g, '')));
T('store.js: không lưu tên, SĐT, câu trả lời của người khác (chỉ answered của chính máy)', !/name|phone|sdt|ip\b/i.test(stripJsComments(store)));
T('join.js: không gửi giờ máy, user-agent hay gì ngoài room/device/q/text', /body = \{ action: 'submitAnswer', room: p\.room, device: p\.device, q: p\.q, text: p\.text \}/.test(api));
T('join.js: không có Web Speech (speechSynthesis)', !/speechSynthesis|SpeechRecognition/.test(join + host + ui));

/* ===== 6. Hằng số đồng bộ ===== */
T('280: config MAX_LEN, HTML maxlength, mock ANSWER_MAX, GAS ANSWER_MAX', /MAX_LEN: 280/.test(cfg) && answer.includes('maxlength="280"') && /ANSWER_MAX = 280/.test(mock) && /ANSWER_MAX = 280/.test(gas));
T('500 / 50: QUESTION_MAX, QUESTIONS_MAX khớp config – mock – GAS', /QUESTION_MAX_LENGTH: 500/.test(cfg) && /QUESTIONS_MAX: 50/.test(cfg) && /QUESTION_MAX = 500/.test(mock) && /QUESTIONS_MAX = 50/.test(mock) && /QUESTION_MAX = 500/.test(gas) && /QUESTIONS_MAX = 50/.test(gas));
T('Regex mã phòng ^\\d{4}$ và deviceId ^[a-z0-9]{8,32}$ giống nhau ở mock, GAS, store', /\/\^\\d\{4\}\$\//.test(mock) && /\/\^\\d\{4\}\$\//.test(gas) && /\/\^\[a-z0-9\]\{8,32\}\$\//.test(mock) && /\/\^\[a-z0-9\]\{8,32\}\$\//.test(gas) && /\/\^\[a-z0-9\]\{8,32\}\$\//.test(store));
T('safeText_ ở GAS và mock cùng luật (= + - @ \\t \\r → thêm \')', /\/\^\[=\+\\-@\]\/\.test\(t\) \|\| c === 9 \|\| c === 13/.test(gas) && /\/\^\[=\+\\-@\]\/\.test\(t\) \|\| c === 9 \|\| c === 13/.test(mock));
T('GAS: Answers đúng 5 cột (HEADERS) và appendRow 5 giá trị', /\['Thời gian', 'Mã phòng', 'Số câu', 'deviceId', 'Nội dung'\]/.test(gas) && /appendRow\(\[at, code, q, device, safeText_\(text\)\]\)/.test(gas));
T('GAS: định dạng văn bản @ cho cột mã phòng / deviceId', /setNumberFormat\('@'\)/.test(gas));
T('GAS: khóa người dẫn chỉ đọc từ Script Properties, có makeHostKey', /getScriptProperties\(\)\.getProperty\(HOST_KEY_PROP\)/.test(gas) && /HOST_KEY_PROP = 'HOST_KEY'/.test(gas) && /function makeHostKey\(\)/.test(gas) && !/demo-host-key/.test(gas));
T('CSV (host.js): BOM, 5 cột không deviceId, \' trước = + - @, bọc "…"', host.includes("'\\uFEFF'") && /\['Thời gian', 'Mã phòng', 'Số câu', 'Câu hỏi', 'Nội dung'\]/.test(host) && /\/\^\[=\+\\-@\]\/\.test\(s\)\) s = "'" \+ s/.test(host) && !/deviceId|a\.device/.test(host.slice(host.indexOf('function buildCsv'), host.indexOf('async function copyLink'))));
T('Phím tắt: KEYS_NEXT = Space, ArrowRight, PageDown; không gán ←/PageUp', /KEYS_NEXT: \['Space', 'ArrowRight', 'PageDown'\]/.test(cfg) && !/ArrowLeft|PageUp/.test(stripJsComments(host)));

/* ===== 7. CSS ===== */
T('CSS: có prefers-reduced-motion ở styles.css, host.css, join.css', [stylesCss, hostCss, joinCss].every(c => /prefers-reduced-motion:\s*reduce/.test(c)));
T('CSS: card câu trả lời pre-wrap + overflow-wrap anywhere, không text-overflow ellipsis', /\.card-text \{[^}]*white-space: pre-wrap;[^}]*overflow-wrap: anywhere/.test(hostCss) && !/text-overflow/.test(hostCss));
T('CSS: biến màn chiếu --stage-q ≥ 40px, --stage-code ≥ 56px, --stage-qr ≥ 160px', /--stage-q:\s*clamp\(40px/.test(stylesCss) && /--stage-code:\s*clamp\(56px/.test(stylesCss) && /--stage-qr:\s*clamp\(160px/.test(stylesCss));
T('CSS: ✕ card 44×44, nút bar ≥ 48px, Tiếp 56px', /\.card-hide \{[^}]*width: 44px; height: 44px/.test(hostCss) && /\.btn\.bar-ghost \{[^}]*min-height: 48px/.test(hostCss) && /\.btn\.bar-primary \{[^}]*min-height: 56px/.test(hostCss));
T('CSS: textarea trả lời 17px (iOS không zoom), ô mã ≥ 17px', /\.answer-input \{ font-size: 17px/.test(joinCss) && /#room-code \{ font-size: 22px/.test(joinCss));
T('CSS: ô 280/280 dùng --warm-ink, không --danger', /\.counter\.full \{ color: var\(--warm-ink\)/.test(joinCss) && !/\.counter[^{]*\{[^}]*--danger/.test(joinCss));
T('CSS: đỏ (--danger) chỉ ở xóa phòng (.menu-danger, .link.danger, .btn.danger, .urgent-box)', !/--danger/.test(joinCss) && (hostCss.match(/--danger/g) || []).length <= 2);

/* ===== 8. File phụ ===== */
T('vendor/qrcode.min.js định nghĩa global qrcode(…) có addData/make/createSvgTag', /global\.qrcode\s*=|window\.qrcode\s*=/.test(read('vendor/qrcode.min.js')) && /createSvgTag/.test(read('vendor/qrcode.min.js')));
W('vendor/qrcode.min.js là BẢN VIẾT LẠI (không phải qrcode-generator gốc) – QR cần được giải mã kiểm chứng (E2E có test decode)', !/KHÔNG PHẢI BẢN GỐC/.test(read('vendor/qrcode.min.js')));
T('.gitignore có desktop.ini', /desktop\.ini/.test(read('.gitignore')));
W('README.md có mặt', exists('README.md'));
T('Không có file dữ liệu mock trong thư mục app', !exists('tools/mock-data.json') && !exists('mock-data.json'));

console.log('\n' + (fails ? 'FAIL' : 'PASS') + ': ' + fails + ' lỗi, ' + warns + ' cảnh báo (check-static)');
process.exit(fails ? 1 : 0);
