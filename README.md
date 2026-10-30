# Trả lời ẩn danh

App cho lớp tập huấn: anh chiếu một câu hỏi, mọi người quét QR bằng điện thoại và gõ câu trả lời, không cần tên, không cần tài khoản. Câu trả lời **không tự hiện**; anh bấm "Tiếp ›" thì mới hiện thêm một câu, nguyên văn, trên màn chiếu.

- Cỡ **M** (hai màn nối nhau), biến thể **Xanh navy** cho nhân viên y tế. HTML/CSS/JS tĩnh, không build, deploy GitHub Pages. Dữ liệu trên Google Sheet của `bsngvanthong@gmail.com`.
- **Trang tham gia** (cho lớp): `https://ditruyenhungvuong.github.io/tra-loi-an-danh/`
- **Trang người dẫn** (chỉ anh): `https://ditruyenhungvuong.github.io/tra-loi-an-danh/host.html?key=…` – phần `?key=` là khóa riêng, lấy ở mục 3. **Giữ link này như mật khẩu.**
- Hai link trên chỉ chạy sau khi làm xong mục 3 và mục 4.
- Tài liệu gốc: [PRD](../../docs/specs/tra-loi-an-danh-prd.md) · [Tech design](../../docs/specs/tra-loi-an-danh-tech-design.md) · [ADR 0002 – polling Apps Script](../../docs/adr/0002-polling-apps-script-realtime.md) · [ADR 0003 – khóa người dẫn](../../docs/adr/0003-host-key-in-url.md) · [Style guide](../../docs/style/style-guide.md).

Thứ tự làm để dùng thật: **mục 3** (Sheet + Apps Script + khóa) → **mục 4** (dán URL, đẩy lên GitHub Pages) → **mục 6** (thử tải) → **mục 2** (dùng trong buổi). Mục 7 chỉ dành cho lúc sửa code.

---

## 1. Hai màn hình

| Màn | Ai dùng | Thấy gì |
|---|---|---|
| `index.html` (trang tham gia) | Học viên, trên điện thoại | Ô gõ mã 4 số (hoặc quét QR là vào thẳng) → câu hỏi hiện tại + ô gõ 280 ký tự + nút "Gửi ›" → "Đã gửi ✓" → chờ câu tiếp. Khi anh kết thúc: lời cám ơn. |
| `host.html` (trang người dẫn) | Anh, trên laptop nối máy chiếu | Màn tạo phòng → màn chiếu (câu hỏi to, QR, mã phòng, danh sách câu đã hiện, thanh điều khiển) → màn "Cám ơn cả lớp". |

Người tham gia **không** thấy câu của người khác trên điện thoại. Họ chỉ thấy trên màn chiếu, và chỉ thấy câu anh đã bấm hiện.

---

## 2. Cách dùng trong buổi

**Mục tiêu:** một buổi 30–50 người, anh điều khiển hết từ một laptop.

### Trước lớp 5 phút
1. Mở laptop, **chưa bật máy chiếu** (hoặc chiếu màn khác).
2. Mở bookmark "Màn dẫn" (link `host.html?key=…`). App lưu khóa vào máy rồi xóa `?key=` khỏi thanh địa chỉ ngay, nhưng vẫn không nên mở link này khi đang chiếu.
   - Lần sau mở `host.html` không cần `?key=`, máy đã nhớ.
   - Nếu máy không nhớ (xóa lịch sử, đổi trình duyệt), app hiện màn "Khóa người dẫn": dán phần sau `?key=` vào ô rồi bấm "Vào ›".
3. Màn "Tạo phòng mới": gõ câu hỏi, **mỗi dòng một câu**, thứ tự dòng là thứ tự hỏi. Gợi ý tối đa 10 câu (quá thì chỉ nhắc, không chặn); tối đa 50 câu, mỗi câu 500 ký tự.
4. Bấm **"Tạo phòng ›"**. Trong khoảng 3 giây sang màn chiếu: câu 1 to ở trên, QR và mã 4 số ở góc, thanh điều khiển ở dưới.
5. Giờ bật máy chiếu. Mở sớm 5 phút để Google Apps Script "ấm"; lần gọi đầu có thể chậm 1–3 giây.

**Kết quả mong đợi:** màn chiếu hiện "Câu 1/N", QR, mã phòng, dòng "👥 0 người đang tham gia · ✉️ 0 câu trả lời · đã hiện 0/0".

### Trong lớp
1. Mọi người quét QR, hoặc mở link trên màn và gõ mã 4 số. Số "người đang tham gia" tăng dần (tính người có mở trang trong 60 giây gần nhất).
2. Mỗi người gõ một câu và bấm "Gửi ›". Số "câu trả lời" tăng. **Chưa có gì hiện lên màn.**
3. Khi thấy đủ, bấm **"Tiếp ›"** để hiện một câu, theo thứ tự gửi sớm nhất trước. Câu mới có viền nhấn và tự cuộn vào tầm nhìn.
   - Phím tắt: **Space**, **→** hoặc **PageDown** (remote trình chiếu). Không gán ← để khỏi lùi nhầm.
   - **"Hiện tất cả"** hiện hết. **"Ẩn"** dọn sạch màn, đếm "đã hiện" về 0, dữ liệu không mất.
   - Nút **✕** nhỏ trên từng card: ẩn riêng câu đó (câu đùa, câu có tên người thật). Câu này không hiện lại khi bấm "Tiếp" nữa.
4. Bấm **"Câu tiếp ›"** để sang câu hỏi sau. Điện thoại tự đổi câu trong vòng 5 giây. **"‹ Câu trước"** quay lại câu cũ, số đã hiện của câu cũ giữ nguyên.
5. Mỗi người chỉ gửi **một câu cho mỗi câu hỏi**. Gửi lần hai → điện thoại báo đã gửi rồi.

### Kết thúc
1. Bấm **"Kết thúc phòng"** → hộp hỏi "Kết thúc thì mọi người không gửi thêm được. Dữ liệu vẫn còn để tải." → bấm **"Tôi hiểu, kết thúc"**.
2. Màn chiếu sang "Cám ơn cả lớp" với tổng số câu. Điện thoại hiện lời cám ơn trong vòng 5 giây.
3. Bấm **"Tải CSV"** (có ở màn cám ơn, hoặc trong menu "Dữ liệu phòng ▾" trên thanh điều khiển). File tên `tra-loi-an-danh-<mã phòng>-<giờ>.csv`, mở bằng Excel không lỗi dấu. Cột: Thời gian · Mã phòng · Số câu · Câu hỏi · Nội dung. **Không có** cột deviceId.
4. Bấm **"Xóa toàn bộ phòng"** → hộp đỏ, nút "Tôi hiểu, xóa toàn bộ (10)" đếm ngược 10 giây → bấm lần hai mới xóa. Xóa cả câu hỏi và câu trả lời của phòng trên Sheet, về màn tạo phòng.
   - Nên xóa phòng cũ sau mỗi buổi để tab `Answers` gọn; tab càng dài, màn dẫn đọc càng chậm.
   - Muốn giữ dữ liệu trên Sheet thì bỏ qua bước này. Phòng đã kết thúc không ai gửi thêm được.

### Lưu ý
- **Dùng một laptop cho cả buổi.** Đổi laptop giữa buổi thì không mở lại được phòng đang chạy (v0.1 chưa có danh sách phòng cũ). Dữ liệu vẫn còn trên Sheet.
- **Không chiếu link có khóa.** Ai có link là tạo, chuyển câu, xóa phòng được. Không gửi link vào nhóm lớp. Nghi lộ thì đổi khóa (mục 5).
- **Không sửa tay tab `Rooms` giữa buổi.** Script nhớ trạng thái phòng trong bộ đệm tới 6 giờ; sửa tay, màn sẽ không khớp.
- **F5 không mất phòng.** Màn dẫn dựng lại đúng câu hiện tại và số đã hiện.
- **Mở nhầm hai cửa sổ `host.html`:** cửa sổ sau hiện "Màn dẫn đang mở ở cửa sổ khác" và tạm dừng. Bấm "Dùng cửa sổ này" nếu muốn điều khiển ở đó.
- Phòng tự đóng sau 24 giờ. Mỗi phòng nhận tối đa 500 câu trả lời.
- Điện thoại mất mạng lúc gửi: chữ còn nguyên, hiện "Chưa gửi được. Mạng hơi chậm, bạn thử lại nhé." và nút "Gửi lại". Mở trong Zalo/Messenger mà không gửi được: app gợi ý mở bằng Chrome hoặc Safari.

---

## 3. Cài Google Sheet + Apps Script (làm một lần)

Phần này anh tự làm trên tài khoản `bsngvanthong@gmail.com`, khoảng 10 phút, đúng thứ tự. Nội dung lấy nguyên từ hướng dẫn ở đầu file `google_apps_script.js`. Đội không có quyền trên tài khoản này nên các bước dưới **chưa kiểm chứng trên Sheet thật**; script đã chạy đủ bộ test giả lập Sheet trên máy (`tests/test-gas.js`, 182 test xanh, mục 7.3) và có hàm `test_` để anh tự kiểm trong editor.

**Mục tiêu:** có (a) một link màn dẫn có khóa và (b) một URL `.../exec` để dán vào app.

### Bước 1 – Tạo Google Sheet
1. Vào `https://sheets.new` (đang đăng nhập `bsngvanthong@gmail.com`).
2. Đặt tên file, ví dụ "Trả lời ẩn danh".
3. Không cần tạo tab hay gõ tiêu đề. Script tự tạo 3 tab `Rooms`, `Questions`, `Answers`, tự đặt cột mã phòng thành Văn bản thuần để mã `0042` không thành `42`. Tab "Trang tính1" có sẵn cứ để đó. Script cũng đặt cột nội dung (Answers cột E, Questions cột C) thành Văn bản thuần để câu như "1/2" hay "100%" không bị đổi thành ngày hay số. **Nếu anh đã tạo tab bằng bản script cũ** thì chọn cột E của Answers và cột C của Questions → Định dạng → Số → Văn bản thuần.

### Bước 2 – Dán script
1. Trên Sheet: menu **Tiện ích mở rộng** (Extensions) → **Apps Script**.
2. Trong file `Code.gs`, xóa hết code mẫu, dán **toàn bộ** nội dung file `google_apps_script.js` (trong thư mục này) vào.
3. Bấm biểu tượng đĩa mềm (Lưu) hoặc Ctrl+S.

### Bước 3 – Tạo khóa người dẫn
Chỉ ai có khóa này mới tạo, điều khiển và xóa phòng được. Khóa nằm trong **Thuộc tính tập lệnh** (Script Properties) của Apps Script, không nằm trong code, không nằm trong Sheet.

1. Trên thanh công cụ, ô chọn hàm (cạnh nút **Chạy**/Run) chọn `makeHostKey` rồi bấm **Chạy**.
2. Lần đầu Google hỏi quyền: **Xem lại quyền** → chọn tài khoản → **Nâng cao** (Advanced) → **Đi tới … (không an toàn)** → **Cho phép**. Đây là script của chính anh nên cảnh báo này là bình thường.
3. Mở **Nhật ký thực thi** (Execution log) ở dưới. Thấy dòng:
   `Link màn dẫn: https://ditruyenhungvuong.github.io/tra-loi-an-danh/host.html?key=…`
4. Chép link này, lưu vào nơi kín: bookmark trên laptop dẫn (đặt tên trung tính, ví dụ "Màn dẫn"), hoặc ghi chú riêng. **Giữ như mật khẩu.**
   - Muốn xem lại link mà không đổi khóa: chạy hàm `showHostLink`.
   - Lỡ lộ: chạy lại `makeHostKey`, xem mục 5.

### Bước 4 – Tạo tab và chạy thử trong editor
1. Chọn hàm `setup_` → **Chạy**. Quay lại Sheet thấy 3 tab `Rooms`, `Questions`, `Answers` có tiêu đề màu navy nhạt.
2. Chọn hàm `test_` → **Chạy**. Nhật ký thực thi hiện các dòng `test_: OK …` và cuối cùng `test_: XONG`. Hàm này tạo một phòng thử, gửi vài câu, đổi câu, đóng rồi tự xóa phòng. Sheet không còn gì của phòng thử.
   - Thấy `test_: chưa có khóa người dẫn` → quay lại bước 3.

### Bước 5 – Triển khai thành Ứng dụng web
1. Nút **Triển khai** (Deploy) góc trên phải → **Triển khai mới** (New deployment).
2. Bấm bánh răng cạnh "Chọn loại" → **Ứng dụng web** (Web app).
3. Điền:
   - Mô tả: gõ gì cũng được, ví dụ `v1`.
   - **Thực thi với tư cách** (Execute as): **Tôi** (Me).
   - **Ai có quyền truy cập** (Who has access): **Bất kỳ ai** (Anyone). Phải là "Bất kỳ ai", **không** phải "Bất kỳ ai có tài khoản Google", nếu không điện thoại người tham gia bị bắt đăng nhập.
4. Bấm **Triển khai**. Nếu hỏi quyền thì cho phép như bước 3.2.
5. Chép dòng **URL ứng dụng web** (dạng `https://script.google.com/macros/s/.../exec`). Đây là `GOOGLE_SCRIPT_URL` cho mục 4.

### Bước 6 – Kiểm tra nhanh trên trình duyệt
1. Mở `<URL>?action=ping` → thấy `{"result":"success","pong":true,"version":"1"}`.
2. Mở `<URL>?action=getRoom&room=0000` → thấy `room_not_found` (chưa có phòng, đúng ý).
3. Mở `<URL>` không có gì phía sau → thấy `public_read_disabled`. Đúng ý: không ai đọc được câu trả lời qua đường link.

### Lần sau sửa code script mà vẫn giữ URL
Dán code mới → Lưu → **Triển khai** → **Quản lý bản triển khai** → biểu tượng bút chì → Phiên bản: **Phiên bản mới** → **Triển khai**. URL giữ nguyên, không phải sửa `config.js`. Khóa người dẫn cũng giữ nguyên.

---

## 4. Đưa app lên web (GitHub Pages)

**Mục tiêu:** hai link ở đầu README chạy được.

### 4.1 Dán URL script vào `js/config.js`
1. Mở `js/config.js` bằng Notepad.
2. Dòng `GOOGLE_SCRIPT_URL: '',` → dán URL `.../exec` của bước 5 vào giữa hai dấu nháy.
3. Dòng `MOCK: true,` → đổi thành `MOCK: false,`.
4. Lưu file.

`upload.bat` **từ chối đẩy** khi còn `MOCK: true` hoặc `GOOGLE_SCRIPT_URL` rỗng, và nói rõ phải sửa dòng nào. Mọi thứ trong `config.js` là public (trình duyệt tải nguyên văn), nên **không bao giờ** dán khóa người dẫn vào đây.

Người sửa code có thể rà lần cuối trước khi đẩy: `"<node.exe>" tests\check-static.js --strict` (mục 7.3). Có `--strict`, `MOCK: true` bị coi là lỗi thay vì cảnh báo.

Các tham số khác trong `config.js`, chỉ đổi khi cần:

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `PUBLIC_URL` | `''` (tự lấy thư mục trang đang mở) | Link gốc để ghép QR `…?room=1234`. Để trống là đúng cả trên Pages lẫn local. |
| `SHORT_URL_LABEL` | `''` | Có link ngắn (bit.ly…) thì ghi vào để hiện trên màn chiếu thay link dài. Chỉ là chữ hiển thị; QR vẫn dùng link thật. |
| `POLL_HOST_MS` / `POLL_JOIN_MS` | 2500 / 3500 | Nhịp hỏi máy chủ của màn dẫn / điện thoại (ms). Lớp đông hơn 50 người có thể tăng `POLL_JOIN_MS` lên 5000. |
| `KEYS_NEXT` | Space, →, PageDown | Phím tắt "Tiếp ›". |
| `ROOM_CODE_LENGTH`, `MAX_LEN`, `QUESTIONS_MAX` | 4, 280, 50 | Phải khớp `google_apps_script.js`; đổi phải đổi cả hai nơi. |

### 4.2 Tạo repo GitHub (một lần)
1. Mở `https://github.com/new` (đăng nhập tài khoản `ditruyenhungvuong`).
2. Repository name: `tra-loi-an-danh`. Chọn **Public**. **Không** tick "Add a README file".
3. Bấm **Create repository**.

### 4.3 Chạy `upload.bat`
1. Bấm đúp `upload.bat` trong thư mục này. Cửa sổ đen hiện 5 bước: kiểm `config.js` → kiểm Git → khởi tạo Git → gom file → commit → push.
2. Lần đầu Git có thể hỏi tên và email (Enter để dùng mặc định) và mở cửa sổ đăng nhập GitHub.
3. Thấy `[V] HOAN THANH` là xong. Muốn ghi lời commit riêng: `upload.bat "Sua cau hoi mau"`.
4. **Lần đầu** phải bật Pages: trên GitHub vào repo → **Settings** → **Pages** → Branch: `main`, thư mục `/ (root)` → **Save**. Đợi 1–2 phút rồi mở link.

Mỗi lần sửa code, bấm đúp `upload.bat` lần nữa. Pages tự cập nhật sau 1–2 phút (F5 kèm Ctrl nếu còn thấy bản cũ).

Máy chưa có Git: `upload.bat` dừng và chỉ link tải `https://git-scm.com/download/win`. Push thất bại: `upload.bat` liệt kê ba lý do thường gặp và cách sửa.

*Đội đã đọc và kiểm từng nhánh của `upload.bat`, nhưng chưa chạy push thật vì repo và tài khoản GitHub là của anh.*

---

## 5. Đổi khóa người dẫn khi nghi lộ

**Khi nào:** link `host.html?key=…` lỡ chiếu lên màn, gửi nhầm vào nhóm, laptop mất, hoặc ai đó chuyển câu / xóa phòng mà không phải anh.

1. Mở Sheet → **Tiện ích mở rộng** → **Apps Script** → chọn hàm `makeHostKey` → **Chạy**.
2. Mở **Nhật ký thực thi**, chép link mới. Khóa cũ **hết hiệu lực ngay**.
3. Bookmark lại link mới trên laptop dẫn. Mở link mới một lần để máy nhớ khóa mới.
4. Không cần deploy lại, không sửa `config.js`, không chạy `upload.bat`. Khóa không nằm trong code.

Máy nào còn giữ khóa cũ sẽ thấy "Mình chưa nhận ra bạn là người dẫn. Kiểm tra lại link nhé." và bị đưa về màn dán khóa ở lần bấm kế tiếp. Phòng đang mở vẫn còn nguyên trên Sheet; anh mở lại bằng khóa mới trên cùng laptop thì vào tiếp được.

Muốn tự đặt khóa thay vì để sinh ngẫu nhiên: Apps Script → bánh răng **Cài đặt dự án** → **Thuộc tính tập lệnh** → sửa `HOST_KEY` (16–64 ký tự, chỉ chữ và số). Link màn dẫn khi đó là `…/host.html?key=<khóa anh đặt>`.

---

## 6. Thử tải trước buổi thật đầu tiên

Apps Script cho khoảng 30 lượt chạy đồng thời. Với 50 điện thoại hỏi mỗi 3,5 giây, ước tính dùng 3–7 lượt (tech design mục 7). Ước tính cần đo thật một lần trước khi đứng lớp.

**Mục tiêu:** chạy `tools/load-test.js` vào script thật, thấy chữ `ĐÁNH GIÁ: ĐẠT`.

### Chuẩn bị
- Node: máy anh không có Node trong PATH. Dùng bản portable có sẵn:
  `C:\Users\SF\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe` (v24).
- Nên dùng **Sheet thử** (tạo Sheet thứ hai, làm lại mục 3 trong 10 phút) để không lẫn với dữ liệu lớp. Dùng Sheet thật cũng được nếu không có lớp nào đang chạy: load-test tự xóa phòng thử khi chạy hết. Nếu bấm Ctrl+C giữa chừng, phòng thử (mã in ở dòng đầu) còn trên Sheet; xóa tay các dòng mang mã đó ở 3 tab khi không có lớp.
- Khóa người dẫn: phần sau `?key=` trong link màn dẫn.

### Chạy
Mở **cmd** tại thư mục `apps\tra-loi-an-danh`, gõ (một dòng):

```
"C:\Users\SF\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" tools\load-test.js --url=https://script.google.com/macros/s/<ID>/exec --key=<khóa> --n=30 --minutes=5
```

Rồi lần hai với `--n=50 --minutes=5 --burst=10`.

Tham số: `--url` (bắt buộc) · `--key` (khóa người dẫn) · `--n` số điện thoại ảo · `--minutes` thời gian chạy (hoặc `--duration` giây) · `--burst` số giây cửa sổ gửi dồn (mặc định 10).

Kịch bản: tạo phòng 3 câu → N máy ảo hỏi máy chủ mỗi 3,5 s, một màn dẫn ảo hỏi mỗi 2,5 s → ở 25 % thời gian, N máy gửi dồn câu 1 trong `--burst` giây → ở 55 % chuyển sang câu 2 và đo bao lâu mọi máy thấy → ở 65 % gửi dồn lần hai → kết thúc, xóa phòng.

### Đọc kết quả
Cuối màn in bảng p50/p95/max từng action và dòng:

```
ĐÁNH GIÁ: ĐẠT (ngưỡng: p95 heartbeat < 2 s, p95 submit < 5 s, lỗi < 1 %, không busy sau retry, lan truyền p95 ≤ 5 s)
```

| Thấy | Làm gì |
|---|---|
| `ĐẠT` ở cả N = 30 và N = 50 | Dùng được cho lớp ≤ 50 người. |
| `CHƯA ĐẠT` ở N = 50, `ĐẠT` ở N = 30 | Tăng `POLL_JOIN_MS` lên 5000 trong `config.js`, chạy `upload.bat`, thử lại. Lớp ≤ 30 vẫn dùng được ngay. |
| `CHƯA ĐẠT` ở N = 30, hoặc nhiều lỗi `timeout` / `busy` sau retry | Báo đội. Theo ADR 0002, đây là ngưỡng cân nhắc chuyển nền thời-gian-thực (Firebase); chỉ cần viết lại `js/api.js`, hai màn không đổi. |
| Lớp dự kiến > 80 người, hoặc cần điện thoại đổi câu dưới 1 giây | Cân nhắc Firebase ngay, không cần thử. |

Ghi kết quả vào `docs/qa/tra-loi-an-danh-load.md` (QA ghi, hoặc anh dán nguyên màn kết quả).

*Đã kiểm chứng:* lệnh trên chạy xanh vào mock local (`--n 10 --duration 12` → `ĐẠT`, 0 lỗi). *Chưa kiểm chứng:* vào script thật, vì đội không có URL và khóa của anh.

Ngoài máy ảo, ADR 0002 yêu cầu **thử thật một lần với ≥ 10 điện thoại đồng nghiệp** trên 4G và wifi bệnh viện, vì WebView, tiết kiệm pin và mạng chập chờn không mô phỏng được. Xem mục 9.

---

## 7. Chạy local (khi sửa code)

Dành cho người sửa code. Không cần Sheet thật: có `tools/mock-api.js` giả lập Apps Script y hệt contract.

### 7.1 Web server tĩnh: `tools/serve.ps1`
Mở PowerShell tại thư mục app:

```
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

- Cổng mặc định **8766** (app Check-in dùng 8765, không trùng). Tùy chọn `-Port 9000`, `-NoBrowser`, `-OpenHost` (mở màn dẫn thay vì màn tham gia).
- Tự tìm `python` → `py` → `npx serve` → `php`, cái nào có thì dùng. Máy này có Python 3.13.
- Chỉ lắng nghe `127.0.0.1`, không mở ra mạng LAN.
- Không có công cụ nào: script in cách cài Python.

Hoặc dùng `.claude/launch.json` ở thư mục gốc dự án: hai cấu hình `tra-loi-an-danh` (python 8766) và `tra-loi-mock-api` (node 8788).

*Chưa kiểm chứng trong phiên viết README này* (phiên bị chặn chạy PowerShell với `-ExecutionPolicy Bypass`); devops đã viết và chạy ở task T3.

### 7.2 Mock Apps Script: `tools/mock-api.js`
```
"C:\Users\SF\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" tools\mock-api.js
```

- Cổng **8788**, khóa người dẫn demo **`demo-host-key-0000`** (chỉ mock nhận khóa này).
- `js/config.js` phải đang `MOCK: true` (mặc định trong repo) và `MOCK_URL: 'http://localhost:8788'`.
- Mở hai cửa sổ: màn dẫn `http://localhost:8766/host.html?key=demo-host-key-0000` và màn tham gia `http://localhost:8766/index.html?room=<mã>` (hoặc `index.html` rồi gõ mã).
- Tùy chọn thử lỗi: `--slow` (mọi request trễ 2 s, thử timeout 8 s), `--latency 800`, `--flaky` (20 % cắt kết nối, thử "Gửi lại"), `--busy` (30 % gửi trả `busy`, thử tự gửi lại), `--quiet`. Biến môi trường `PORT`, `HOST_KEY`, `MOCK_DATA` (ghi state ra file; mặc định chỉ bộ nhớ, **không ghi vào thư mục Drive**).
- Trước khi đẩy lên web: trả `MOCK: false`. `upload.bat` tự chặn nếu quên.

*Đã kiểm chứng:* mock chạy, load-test vào mock ĐẠT.

### 7.3 Bộ test
Bốn bộ, tổng **774 test xanh, 0 đỏ** ở vòng QA 27/10/2026 (báo cáo: [`docs/qa/tra-loi-an-danh-qa.md`](../../docs/qa/tra-loi-an-danh-qa.md)). Không bộ nào cần mạng ngoài hay Sheet thật; không bộ nào ghi file vào thư mục app.

| Lệnh (chạy tại thư mục app, `<node.exe>` là Node portable ở 7.2) | Kiểm gì | Số test |
|---|---|---|
| `"<node.exe>" tests\check-static.js [--strict]` | `node --check` 10 file JS; HTML đủ id/`data-act`; microcopy nguyên văn PRD; giọng "bạn/mình", không từ y khoa; `config.js` không chứa khóa; không `onclick=`/`alert(`; `esc()` ở chỗ render; hằng 280/500/50 và regex khớp giữa config, HTML, mock, script. `MOCK: true` → cảnh báo; có `--strict` → lỗi (dùng trước deploy). | 251 |
| `"<node.exe>" tests\test-mock-api.js` | Mock đúng contract tech design mục 4 (cùng mã lỗi, cùng shape, lock xếp hàng). | 136 |
| `"<node.exe>" tests\test-gas.js` | `google_apps_script.js` chạy trong Node với Sheet/Cache/Lock giả lập, cùng bộ kịch bản với mock; thêm: 3 tab đúng tiêu đề và định dạng `@`, `Answers` đúng 5 cột, `=1+1` được thêm `'`, heartbeat không đọc Sheet, lock bận → `busy`, thiếu khóa → `host_key_not_set`, `setup_`/`test_`/`makeHostKey`. | 182 |
| `"<node.exe>" tests\e2e.js [--only=<kịch bản>] [--out=<thư mục>]` | Chrome headless thật qua DevTools Protocol: một tab host 1280×720 + mỗi "điện thoại" một context riêng 375×667; mock chạy trong process (cổng 8790), server tĩnh riêng (8767) ép `MOCK: true` lúc trả `config.js` (file trên đĩa không đổi). 7 kịch bản: `main` (tạo phòng → vào → gửi → Tiếp → chuyển câu → kết thúc → CSV → xóa), `enter` (gõ mã), `offline` (mất mạng → Gửi lại), `xss`, `twotabs`, `reduced`, `layout`. Mỗi dòng Given/When/Then ở PRD mục 6 có ít nhất một test. | 205 |

Chạy cả bốn bằng một lệnh, **từ cmd.exe** (không phải PowerShell):

```
tests\run-all.cmd
```

- `NODE` mặc định là Node portable ở 7.2; máy khác thì `set NODE=<đường dẫn node.exe>` trước.
- Cần Chrome ở `C:\Program Files\Google\Chrome\Application\chrome.exe` (hoặc `set CHROME=...`).
- Tùy chọn `set QR_PYTHON=<python có OpenCV>`: E2E giải mã QR trên màn chiếu độc lập bằng `cv2`. Không đặt thì ghi NOTE bỏ qua.
- Tham số thêm sau `run-all.cmd` được chuyển cho `e2e.js`, ví dụ `tests\run-all.cmd --only=main`.
- Kết quả E2E, ảnh chụp, console log ghi vào `%TEMP%\tra-loi-an-danh-qa\` (`e2e-results.txt`, `main-stage-5cards.png`, `layout-375-*.png`…).
- Cuối màn: `KET QUA: TAT CA XANH` hoặc `KET QUA: CO TEST DO`.

*Đã chạy lại trong phiên viết README:* `check-static.js` (0 lỗi, 3 cảnh báo, trong đó một cảnh báo là `MOCK: true` đúng với trạng thái local), `test-mock-api.js` (136 PASS), `test-gas.js` (182 PASS), `e2e.js --only=main` (107 PASS, 0 FAIL, 62 giây, Chrome headless trên máy này). Chưa chạy lại `run-all.cmd` trọn bộ trong phiên này; số 774 lấy từ báo cáo QA.

### 7.4 Cấu trúc thư mục
```
apps/tra-loi-an-danh/
├─ index.html              trang tham gia (điện thoại, 375 px)
├─ host.html               trang người dẫn (laptop, 1280×720 trở lên)
├─ css/
│  ├─ styles.css           tokens navy + thành phần chung
│  ├─ join.css             riêng trang tham gia
│  └─ host.css             riêng trang dẫn (màn chiếu)
├─ js/
│  ├─ config.js            tham số public: URL script, MOCK, nhịp poll, phím tắt
│  ├─ api.js               mọi lời gọi mạng (fetch + JSONP dự phòng); đổi nền chỉ sửa file này
│  ├─ store.js             localStorage: tlad_device, tlad_join, tlad_host_key, tlad_host
│  ├─ ui.js                esc(), toast, tiện ích DOM
│  ├─ join.js              logic trang tham gia
│  └─ host.js              logic trang dẫn: reveal, CSV, hai tab, phím tắt
├─ vendor/qrcode.min.js    tạo QR dạng SVG (xem mục 10)
├─ google_apps_script.js   backend, dán vào Apps Script (mục 3)
├─ tools/
│  ├─ serve.ps1            web server tĩnh 8766
│  ├─ mock-api.js          giả lập Apps Script 8788
│  └─ load-test.js         thử tải (mục 6)
├─ tests/
│  ├─ check-static.js      rà tĩnh: cú pháp, id, microcopy, config, giọng viết
│  ├─ test-mock-api.js     contract test cho mock
│  ├─ test-gas.js          test script trong Node với Sheet giả lập
│  ├─ e2e.js               Chrome headless, 7 kịch bản host + join
│  ├─ lib/                 cdp.js (DevTools Protocol), static-server.js
│  └─ run-all.cmd          chạy cả bốn bộ từ cmd.exe
├─ upload.bat              đẩy lên GitHub Pages (mục 4)
├─ .gitignore
└─ README.md
```

---

## 8. Đặc tả → đã làm

Theo 7 tính năng P0 ở PRD mục 5. Cột "đã làm" rút từ code. QA đã kiểm từng dòng Given/When/Then của PRD mục 6 bằng E2E, kết quả PASS vòng 2 (774/774): [`docs/qa/tra-loi-an-danh-qa.md`](../../docs/qa/tra-loi-an-danh-qa.md). Tám bug QA tìm được (B-01…B-08) đã sửa và kiểm lại; còn mở B-09 (mục 9, việc 13).

| # | Tính năng (PRD mục 5) | Đã làm |
|---|---|---|
| 1 | **Tạo phòng** (US-7): ô nhiều dòng, mỗi dòng một câu; mã 4 số không trùng; ghi Sheet; F5 không mất phòng. | `#questions` + đếm "n câu hỏi · gợi ý tối đa 10"; nút disabled khi trống; `createRoom` có khóa; script sinh mã 4 số không trùng bất kỳ dòng nào trong `Rooms` (kể cả phòng đã đóng); phòng và số đã hiện lưu `tlad_host`, F5 dựng lại từ `getState`. |
| 2 | **Màn chiếu** (US-8): câu hỏi to, QR `…?room=1234`, mã to, link gõ tay, thanh đếm người / câu / đã hiện; poll 2–3 s. | Lưới `stage-grid`; QR SVG từ `vendor/qrcode.min.js`; `#room-code-big`, `#join-url` (hiện `SHORT_URL_LABEL` nếu có); `getState` mỗi 2,5 s ±15 %, chỉ khi tab đang điều khiển; "👥 n người đang tham gia · ✉️ m câu trả lời · đã hiện a/m"; "Chưa có câu trả lời nào. Mời mọi người quét QR nhé." khi trống. |
| 3 | **Hiện tuần tự** (US-9, US-12): "Tiếp ›" một câu theo thứ tự gửi; "Hiện tất cả"; "Ẩn"; ✕ từng card; Space/→; trạng thái "đã hiện" chỉ ở máy dẫn. | `reveal[q] = {revealed, hidden}` theo từng câu, lưu `localStorage`, không lên Sheet; thứ tự = thứ tự dòng server; card mới có viền nhấn, cuộn vào tầm nhìn, tắt chuyển động khi `prefers-reduced-motion`; `KEYS_NEXT` Space/→/PageDown, bỏ qua khi focus ở ô nhập; hint "Đã hiện hết. Chờ thêm câu mới hoặc chuyển câu hỏi nhé."; mọi chuỗi qua `esc()`, `white-space: pre-wrap`. |
| 4 | **Chuyển câu và kết thúc** (US-10): "Câu tiếp ›" / "‹ Câu trước"; "Câu k/N"; đếm đã hiện theo từng câu; "Kết thúc phòng" hỏi lại. | `setQuestion` có khóa; "Câu trước" giữ reveal cũ; hộp xác nhận "Tôi hiểu, kết thúc"; `closeRoom` → màn "Cám ơn cả lớp" + "m câu trả lời cho n câu hỏi."; điện thoại thấy trong một vòng poll. |
| 5 | **Màn tham gia** (US-1, 2, 3, 5): vào bằng QR hoặc 4 số; 280 ký tự; "Gửi ›"; "Đã gửi ✓"; thất bại giữ chữ + "Gửi lại"; poll 3–5 s; đổi câu tự chuyển; một câu mỗi câu hỏi. | `?room=` vào thẳng, có khung "Đang vào phòng…"; ô mã `inputmode="numeric"`, `maxlength 4`; bộ đếm ẩn < 200, nổi từ 260, cam ở 280; `heartbeat` 3,5 s ±15 %, tab ẩn không poll, lỗi giãn ×2 tới 30 s; timeout 8 s → "Chưa gửi được…" + "Gửi lại", chữ còn nguyên; `busy` tự gửi lại một lần; `already_answered` coi như đã gửi; `question_changed` giữ chữ, hiện "Người dẫn vừa chuyển câu…" + "Xóa chữ đang gõ"; trong WebView Zalo/Messenger lỗi mạng → gợi ý mở Chrome/Safari; JSONP dự phòng cho GET. |
| 6 | **Ẩn danh và minh bạch** (US-4): không tên, không SĐT; `deviceId` ngẫu nhiên; `Answers` đúng 5 cột; dòng minh bạch cố định; "Đừng ghi tên người thật nhé." | `tlad_device` 16 ký tự `[a-z0-9]`; script regex `^[a-z0-9]{8,32}$`; `Answers` = Thời gian · Mã phòng · Số câu · deviceId · Nội dung, không IP, không user-agent; "người đang tham gia" chỉ trong bộ đệm script, không ghi Sheet; dòng minh bạch nguyên văn PRD ngay trên nút gửi; `config.js` không chứa khóa; GET không action → `public_read_disabled`; `getState` (đọc câu trả lời) bắt buộc có khóa, qua POST. |
| 7 | **Xuất và xóa** (US-11): "Tải CSV" kèm câu hỏi, không deviceId; "Xóa toàn bộ phòng" bấm hai lần; toast "Đã xóa dữ liệu phòng {mã}." | CSV dựng ở trình duyệt từ `getState(since 0)`, UTF-8 BOM, cột Thời gian · Mã phòng · Số câu · Câu hỏi · Nội dung, ô bắt đầu `= + - @` được thêm `'`; menu "Dữ liệu phòng ▾" (Chép link vào phòng · Tải CSV · Xóa toàn bộ phòng); xóa cần bấm "Tôi hiểu, xóa toàn bộ (10)" trong 10 s; `deleteRoom` xóa ở cả 3 tab; về màn tạo phòng. |

Thêm ngoài PRD, có trong tech design: khóa người dẫn qua `host.html?key=` + Script Properties (ADR 0003); chặn formula injection `safeText_` ở script; `room_full` 500 câu/phòng; phòng tự đóng sau 24 h; hai tab host cùng mở → overlay "Dùng cửa sổ này"; hộp xác nhận thay `alert()`; không `onclick` inline.

---

## 9. Chưa làm / cần làm trước khi dùng thật

| # | Việc | Ai | Ghi chú |
|---|---|---|---|
| 1 | **Cài Apps Script, chạy `makeHostKey`, deploy, gửi URL `/exec`** (mục 3) | anh Thông | Chưa làm thì app chưa chạy được ở đâu ngoài mock. |
| 2 | **Dán URL vào `config.js`, `MOCK: false`, tạo repo, bật Pages, chạy `upload.bat`** (mục 4) | anh Thông (hoặc đội khi có URL) | `config.js` trong repo đang `MOCK: true`, `GOOGLE_SCRIPT_URL: ''`. |
| 3 | **Thử tải 30 rồi 50 máy ảo vào script thật** (mục 6), ghi `docs/qa/tra-loi-an-danh-load.md` | QA / anh Thông | ADR 0002 bắt buộc trước buổi thật đầu tiên. Mới chạy vào mock. |
| 4 | **Thử điện thoại thật**: ≥ 10 máy đồng nghiệp, iOS Safari + Android Chrome, 4G và wifi bệnh viện; quét QR từ cuối phòng ở 1280×720. | QA / anh Thông | WebView, tiết kiệm pin, mạng chập chờn không mô phỏng được bằng Node. |
| 5 | **Thử mở link trong Zalo** (và Messenger): có vào phòng được không, có gửi được không. | QA / anh Thông | Vài WebView chặn POST/redirect của Apps Script (R12). App có JSONP cho đọc và câu gợi ý "mở bằng Chrome hoặc Safari" cho gửi, nhưng cần thử thật. |
| 6 | **Link ngắn** để gõ tay từ màn chiếu (bit.ly hoặc tên miền riêng) → ghi vào `SHORT_URL_LABEL`. | anh Thông quyết | Link Pages hơi dài. Không có cũng được: QR là đường chính. |
| 7 | Bộ lọc câu nhạy cảm (US-15, P1): tự gắn cờ SĐT, tên viết hoa, từ nhạy cảm, giữ lại chờ anh duyệt. | đội, sau khi anh quyết | Hiện thay bằng: câu không tự hiện, ✕ ẩn ngay, "Ẩn" dọn màn. Nếu dùng app cho câu hỏi về cảm xúc, nên bật việc này và thêm dòng hỗ trợ ở chân trang (PRD mục 4). |
| 8 | Danh sách phòng cũ, mở lại / dùng lại bộ câu hỏi (US-13, P1). | đội, sau khi anh quyết | Vì chưa có nên **dùng một laptop cho cả buổi**; đổi máy giữa buổi không mở lại được phòng. |
| 9 | Điều khiển "Tiếp" / "Câu tiếp" từ điện thoại trong khi laptop chiếu (US-14, P1). | đội, sau khi anh quyết | Tạm thời dùng remote trình chiếu: Space / → / PageDown. |
| 10 | "Xóa dấu vết trên máy này" cho người tham gia (US-6, P1). | đội | Code đã có (`data-act="forget"`), nút đang ẩn (`hidden`) ở màn kết thúc. Bật là một dòng HTML. |
| 11 | Mã phòng **6 số** nếu nhiều lớp chạy song song hoặc anh lo bị đoán. | anh Thông quyết → đội | Đổi `ROOM_CODE_LENGTH` trong `config.js` **và** `ROOM_RE` + `ROOM_CODE_LENGTH` trong script, deploy phiên bản mới. Hiện có sẵn: 500 câu/phòng, một máy một câu, câu không tự hiện. |
| 12 | Nhiều người dẫn với khóa riêng. | đội, sau | Hiện một khóa dùng chung cho mọi phòng; ai có khóa điều khiển được mọi phòng đang mở. |
| 13 | **B-09 – Quét QR bằng điện thoại thật với link thật.** `vendor/qrcode.min.js` là bản tự viết (mục 11). QA đã giải mã đúng bằng OpenCV với link local (QR phiên bản 3). Link thật `https://ditruyenhungvuong.github.io/tra-loi-an-danh/?room=1234` dài hơn (QR phiên bản 4–5), chưa thử. Trước buổi đầu: quét bằng ít nhất 2 điện thoại thật (iPhone + Android) từ cuối phòng. Không quét được → đội thay bằng bản gốc `qrcode-generator` (MIT, API giống hệt, `host.js` không đổi). | anh Thông / QA → đội nếu lỗi | Ghép với việc 4. |
| 14 | Chụp ảnh màn hình sau khi deploy, dán vào README. | đội | |
| 15 | Múi giờ dự án Apps Script: **Cài đặt dự án** → (GMT+07:00) Hồ Chí Minh. | anh Thông, chỉ để biết | Script đã tự dùng `Asia/Ho_Chi_Minh` khi ghi giờ, không đặt cũng không sai. |

---

## 10. Dữ liệu và quyền riêng tư

### Ba tab trên Sheet (script tự tạo)

| Tab | Cột | Ghi chú |
|---|---|---|
| `Rooms` | Mã phòng · Thời gian tạo · Câu hiện tại · Số câu hỏi · Trạng thái · Cập nhật lúc | Một dòng một phòng. Trạng thái `open` / `closed`. Phòng `open` quá 24 h tự coi là `closed`. **Không sửa tay giữa buổi.** |
| `Questions` | Mã phòng · Số câu · Nội dung | Mỗi câu hỏi một dòng. |
| `Answers` | Thời gian · Mã phòng · Số câu · deviceId · Nội dung | **Đúng 5 cột**, không thêm. Mỗi câu trả lời một dòng; không IP, không tên, không user-agent, không tọa độ. |

- Cột mã phòng, deviceId, cột giờ và cột nội dung đặt Văn bản thuần (`@`) để không bị đổi thành số, ngày hay boolean.
- Giờ là **giờ server** (`Asia/Ho_Chi_Minh`, khuôn `HH:mm:ss dd/MM/yyyy`), không lấy giờ điện thoại.
- `deviceId` là chuỗi ngẫu nhiên 16 ký tự sinh trên điện thoại, chỉ để một máy không gửi hai lần cho một câu. Không suy ra được người. Nó **không** có trong CSV.
- "Người đang tham gia" đếm trong bộ đệm của script (quên sau 60 giây), **không ghi Sheet**.
- Mọi chuỗi người gõ (câu hỏi, câu trả lời) bắt đầu bằng `=`, `+`, `-`, `@` được thêm `'` trước khi ghi, để Sheet không chạy công thức. CSV cũng vậy.

### Ai thấy gì

| Ai | Thấy |
|---|---|
| Anh (chủ Sheet) và người anh chia sẻ Sheet | Mọi thứ trong 3 tab, kể cả câu chưa hiện và deviceId. |
| Cả lớp (màn chiếu) | Câu hỏi, QR, mã phòng, số người, số câu; **chỉ những câu anh đã bấm hiện**, không kèm tên. |
| Người tham gia (điện thoại) | Câu hỏi hiện tại và câu mình đã gửi. Không thấy câu của người khác. |
| Ai có link `host.html?key=…` | Tạo, chuyển câu, đọc toàn bộ câu trả lời, kết thúc, xóa mọi phòng đang mở. Vì vậy giữ link như mật khẩu. |
| Ai chỉ có URL script (public) | `ping`, trạng thái phòng khi biết đúng mã, gửi câu trả lời. **Không đọc được câu trả lời nào**: GET không action trả `public_read_disabled`; `getState` bắt buộc có khóa. |

### Trên máy người dùng (`localStorage`)
- Điện thoại: `tlad_device` (id ngẫu nhiên), `tlad_join` (mã phòng đang vào và câu đã gửi cho từng câu hỏi). Không hiển thị ở đâu. Nút "Xóa dấu vết trên máy này" đang ẩn (mục 9, việc 10); máy dùng chung thì xóa dữ liệu trang web của trình duyệt.
- Laptop dẫn: `tlad_host_key` (khóa, dạng rõ) và `tlad_host` (phòng hiện tại, số đã hiện). Laptop dùng chung → xóa dữ liệu trang web sau buổi, hoặc đổi khóa (mục 5).

Dòng minh bạch trên điện thoại, ngay trên nút gửi, nói đúng những điều trên: "Câu trả lời của bạn hiện lên màn chiếu, không kèm tên. Không ai biết ai gửi. Gửi rồi thì không sửa được, bạn đọc lại một lần nhé." Nếu anh chia sẻ Sheet cho người khác, câu này vẫn đúng vì không có tên để lộ.

---

## 11. Giấy phép

- Code app (HTML, CSS, JS, Apps Script) viết mới cho anh Thông bởi đội App Creator, dùng tự do trong các app của anh.
- `vendor/qrcode.min.js` là **bản viết lại tối giản, không phải bản gốc** thư viện `qrcode-generator`. Viết theo thuật toán chuẩn ISO/IEC 18004 (mode byte UTF-8, bốn mức sửa lỗi L/M/Q/H, phiên bản 1–10, chọn mask theo điểm phạt chuẩn, xuất SVG). API bắt chước `qrcode-generator` của Kazuhiko Arase (giấy phép MIT) để sau này thay bằng bản gốc mà `host.js` không phải sửa. Giấy phép: viết mới cho app này, dùng tự do; tên hàm giữ giống bản gốc để tương thích. Có hàm `qrcode.__selfTest()` để tự kiểm. Lý do không dùng bản gốc: máy dựng app không có npm và đội không tải thư viện từ mạng khi chưa chắc. QA đã giải mã QR của bản này bằng OpenCV, đúng link (mục 9, việc 13 ghi việc còn lại).
- Font Be Vietnam Pro nạp từ Google Fonts (giấy phép OFL).
