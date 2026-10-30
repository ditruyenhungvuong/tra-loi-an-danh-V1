/* =========================================================
   Cấu hình triển khai – Trả lời ẩn danh
   MỌI THỨ Ở ĐÂY LÀ PUBLIC: trình duyệt tải file này nguyên văn, ai mở trang
   cũng đọc được. KHÔNG đặt khóa người dẫn, mã phòng hay bất kỳ bí mật nào.
   Khóa người dẫn đi qua link host.html?key=… (xem README) và nằm trong
   Script Properties của Apps Script, không bao giờ nằm trong code.
   ========================================================= */
window.APP_CONFIG = {
  APP_NAME: 'Trả lời ẩn danh',
  VERSION: '0.1.0',

  /* DÁN URL VÀO ĐÂY: URL Web App của Google Apps Script sau khi Deploy,
     dạng 'https://script.google.com/macros/s/<ID>/exec'. */
  GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwM7oZT0GgMPYZ3sdQA1fQ5KrHPp4m0fWNBJUZ6Yvg2TsYBdCDO7BdZmvTnTUQQNqXipg/exec',

  /* true → gọi tools/mock-api.js ở MOCK_URL thay cho Apps Script (chỉ khi phát triển).
     upload.bat và tests/check-static.js từ chối đẩy lên GitHub khi còn true. */
  MOCK: false,
  MOCK_URL: 'http://localhost:8788',

  /* Link gốc để ghép QR …?room=1234 và hiện trên màn chiếu.
     Để trống → tự lấy thư mục của trang đang mở (BASE_URL bên dưới), đúng cả khi chạy local
     lẫn trên GitHub Pages (https://ditruyenhungvuong.github.io/tra-loi-an-danh/). */
  PUBLIC_URL: '',
  /* Có link ngắn (bit.ly…) thì ghi để hiện thay link dài trên màn chiếu; rỗng → hiện BASE_URL. */
  SHORT_URL_LABEL: '',

  /* Vòng hỏi máy chủ. Màn dẫn 2,5 s; điện thoại 3,5 s (PRD cho 3–5 s). */
  POLL_HOST_MS: 2500,
  POLL_JOIN_MS: 3500,
  POLL_JITTER: 0.15,            // ±15 % để 50 máy không gõ cùng nhịp
  POLL_BACKOFF_MAX_MS: 30000,   // lỗi liên tiếp thì giãn ×2 tới mức này
  GET_TIMEOUT_MS: 8000,
  SUBMIT_TIMEOUT_MS: 8000,      // PRD US-5: ≤ 8 s phải hiện "Chưa gửi được"
  BUSY_RETRY_MS: 1500,          // máy chủ trả busy → tự gửi lại một lần sau 1,5 s + ngẫu nhiên 0–1 s

  /* Giới hạn – phải khớp google_apps_script.js */
  ROOM_CODE_LENGTH: 4,
  MAX_LEN: 280,                 // câu trả lời, đếm ký tự
  QUESTION_MAX_LENGTH: 500,
  QUESTIONS_MAX: 50,
  QUESTIONS_SUGGESTED: 10,      // quá số này chỉ nhắc "hơi nhiều", không chặn
  PRESENCE_TTL_SEC: 60,         // chỉ để hiện chữ giải thích; máy chủ mới là nơi quyết

  /* Phím "Tiếp ›" trên màn dẫn (event.code). PageDown để remote trình chiếu dùng được.
     Cố ý KHÔNG gán ←/PageUp cho "Câu trước" để không lùi nhầm cả lớp. */
  KEYS_NEXT: ['Space', 'ArrowRight', 'PageDown'],

  /* Tự tính bên dưới, không sửa tay */
  BASE_URL: ''
};

/* BASE_URL = thư mục chứa trang đang mở (bỏ tên file), ưu tiên PUBLIC_URL nếu có */
(function () {
  var C = window.APP_CONFIG;
  if (C.PUBLIC_URL) { C.BASE_URL = C.PUBLIC_URL; return; }
  try {
    var dir = location.pathname.replace(/[^\/]*$/, '');
    C.BASE_URL = (location.origin && location.origin !== 'null' ? location.origin : '') + dir;
  } catch (e) { C.BASE_URL = ''; }
})();
