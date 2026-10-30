#!/usr/bin/env bash
# ============================================================
#  upload.sh - đẩy app "Trả lời ẩn danh" lên GitHub Pages (Ubuntu/Linux)
#  Bản tương đương upload.bat cho máy Ubuntu. Mỗi lần chạy = một lần cập nhật.
#  Cách dùng (trong Terminal):   ./upload.sh
#  Có thể truyền lời commit:      ./upload.sh "Sua mau nut"
#  Repo: https://github.com/ditruyenhungvuong/tra-loi-an-danh-V1
#  Web:  https://ditruyenhungvuong.github.io/tra-loi-an-danh-V1/
# ============================================================

# ===== Cấu hình riêng của app (chỉ sửa khối này khi chép sang app khác) =====
REPO="ditruyenhungvuong/tra-loi-an-danh-V1"
BRANCH="main"
PAGES="https://ditruyenhungvuong.github.io/tra-loi-an-danh-V1/"
MSG="Cap nhat app Tra loi an danh"
# File chứa GOOGLE_SCRIPT_URL / MOCK để soát trước khi đẩy. Để trống = bỏ bước soát.
CONFIG="js/config.js"
# 1 = bắt buộc có GOOGLE_SCRIPT_URL; 0 = cho phép để trống (app vẫn chạy không gửi)
REQUIRE_URL=1
# Dòng in thêm khi xong (ví dụ link màn dẫn). Để trống nếu không cần.
EXTRA_DONE="Màn dẫn:   ${PAGES}host.html?key=... (dùng link anh đã chép từ makeHostKey)"

# ===== Chuẩn bị =====
[ -n "${1:-}" ] && MSG="$1"
# Luôn chạy đúng thư mục chứa file này, dù gọi từ đâu
cd "$(dirname "$(readlink -f "$0")")" || exit 1
SELF="$(basename "$0")"

echo
echo "======== ĐANG TẢI CODE LÊN GITHUB: $REPO ========"
echo "Thư mục: $PWD"
echo

# ===== [0/5] Soát cấu hình trước khi đẩy =====
# App chạy thật phải trỏ vào Google Apps Script, không được trỏ vào mock local.
if [ -n "$CONFIG" ]; then
  echo "[0/5] Kiểm tra $CONFIG..."
  if [ ! -f "$CONFIG" ]; then
    echo
    echo "[!] KHÔNG ĐẨY. Không thấy file $CONFIG trong thư mục này."
    echo "    Có thể đang chạy $SELF ở sai thư mục. Thư mục hiện tại: $PWD"
    exit 1
  fi
  if grep -Eq '^[[:space:]]*MOCK:[[:space:]]*true' "$CONFIG"; then
    echo
    echo "[!] KHÔNG ĐẨY. File $CONFIG đang để MOCK: true (chế độ chạy thử trên máy)."
    echo "    Đẩy lên như vậy thì app trên web sẽ tìm server giả ở localhost và KHÔNG hoạt động."
    echo "    Cách sửa: mở $CONFIG, đổi   MOCK: true,   thành   MOCK: false,   lưu lại rồi chạy lại."
    exit 1
  fi
  # Lấy giá trị GOOGLE_SCRIPT_URL ở dòng không phải comment (dạng  KEY: '...'  hoặc  const KEY = '...')
  URL_LINE="$(grep -E "^[[:space:]]*(const[[:space:]]+)?GOOGLE_SCRIPT_URL[[:space:]]*[:=]" "$CONFIG" | head -1)"
  URL_VAL="$(printf '%s' "$URL_LINE" | sed -E "s/^[^'\"]*['\"]([^'\"]*)['\"].*/\1/")"
  [ "$URL_VAL" = "$URL_LINE" ] && URL_VAL=""
  if printf '%s' "$URL_VAL" | grep -Eq 'localhost|127\.0\.0\.1'; then
    echo
    echo "[!] KHÔNG ĐẨY. GOOGLE_SCRIPT_URL đang trỏ vào máy local: $URL_VAL"
    echo "    Đổi lại thành URL Apps Script thật (hoặc '' nếu app cho phép), lưu rồi chạy lại."
    exit 1
  fi
  if [ -z "$URL_VAL" ]; then
    if [ "$REQUIRE_URL" = "1" ]; then
      echo
      echo "[!] KHÔNG ĐẨY. File $CONFIG chưa có GOOGLE_SCRIPT_URL (đang để rỗng)."
      echo "    Thiếu địa chỉ này thì app trên web không gửi và không nhận được gì."
      echo "    Cách sửa:"
      echo "      1. Mở Google Sheet > Extensions > Apps Script > Deploy > Manage deployments,"
      echo "         chép \"Web app URL\" (dạng https://script.google.com/macros/s/.../exec)."
      echo "      2. Dán vào giữa hai dấu nháy của dòng GOOGLE_SCRIPT_URL trong $CONFIG, lưu rồi chạy lại."
      exit 1
    fi
    echo "      [?] GOOGLE_SCRIPT_URL đang rỗng: app trên web sẽ chạy nhưng không gửi dữ liệu."
  elif ! printf '%s' "$URL_VAL" | grep -q 'script.google.com/macros/'; then
    echo "      [?] GOOGLE_SCRIPT_URL không giống địa chỉ Apps Script (script.google.com/macros/...)."
    echo "          Vẫn tiếp tục, nhưng nếu app không gửi được thì xem lại dòng này."
  else
    echo "      Cấu hình ổn: MOCK đang tắt, đã có GOOGLE_SCRIPT_URL."
  fi
fi

# ===== [1/5] Kiểm tra đã cài Git chưa =====
if ! command -v git >/dev/null 2>&1; then
  echo "[!] Máy này chưa cài Git. Cài một lần bằng lệnh:"
  echo "      sudo apt install -y git"
  echo "    rồi chạy lại ./$SELF"
  exit 1
fi

# ===== [2/5] Khởi tạo / nối Git trong thư mục app =====
if [ -d .git ]; then
  echo "[2/5] Git đã có sẵn, cập nhật địa chỉ repo..."
  git remote set-url origin "https://github.com/$REPO.git" 2>/dev/null \
    || git remote add origin "https://github.com/$REPO.git"
  git branch -M "$BRANCH"
else
  echo "[2/5] Khởi tạo Git lần đầu..."
  git init -q
  git branch -M "$BRANCH"
  git remote add origin "https://github.com/$REPO.git"
  # File chép từ Windows/Drive có xuống dòng CRLF: commit lên GitHub dạng LF như bên Surface
  git config core.autocrlf input
  # Repo trên GitHub đã có code (đẩy từ Surface) thì nối vào lịch sử đó, không tạo lịch sử mới
  if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
    echo "      Repo trên GitHub đã có code, đang nối vào lịch sử nhánh $BRANCH..."
    if git fetch -q origin "$BRANCH" && git reset -q "origin/$BRANCH"; then
      git branch -q --set-upstream-to="origin/$BRANCH" "$BRANCH"
    else
      echo "[!] Không tải được lịch sử từ GitHub. Xem lỗi ở trên rồi chạy lại."
      rm -rf .git
      exit 1
    fi
  fi
fi

# Git cần biết tên + email người commit. Chưa có thì hỏi một lần, lưu riêng cho thư mục này.
if [ -z "$(git config user.name)" ]; then
  read -r -p "Nhập tên của anh để ghi vào lịch sử (ví dụ: BS Thong): " GITNAME
  git config user.name "${GITNAME:-ditruyenhungvuong}"
fi
if [ -z "$(git config user.email)" ]; then
  read -r -p "Nhập email GitHub của anh (Enter để bỏ qua): " GITEMAIL
  git config user.email "${GITEMAIL:-ditruyenhungvuong@users.noreply.github.com}"
fi

# ===== [3/5] Gom file =====
echo "[3/5] Đang gom toàn bộ file..."
git add -A
# Giữ quyền chạy cho upload.sh để clone về máy khác vẫn ./upload.sh được
git update-index --chmod=+x "$SELF" 2>/dev/null

# Chốt an toàn: lần này có XÓA file nào trên GitHub không (ví dụ thư mục chỉ là bản chép thiếu ảnh)
DELETED="$(git diff --cached --diff-filter=D --name-only)"
if [ -n "$DELETED" ]; then
  echo
  echo "[!] Lần đẩy này sẽ XÓA $(printf '%s\n' "$DELETED" | wc -l) file khỏi GitHub (và khỏi trang web):"
  printf '%s\n' "$DELETED" | head -20 | sed 's/^/      - /'
  [ "$(printf '%s\n' "$DELETED" | wc -l)" -gt 20 ] && echo "      ..."
  read -r -p "    Gõ  co  để đồng ý xóa, Enter để dừng lại: " OK
  if [ "$OK" != "co" ]; then
    git reset -q
    echo "    Đã dừng, chưa đẩy gì. Chép lại các file thiếu vào thư mục rồi chạy lại."
    exit 1
  fi
fi

# ===== [4/5] Commit =====
echo "[4/5] Đang tạo bản commit..."
if git diff --cached --quiet; then
  echo "      Không có thay đổi mới so với lần trước, chỉ đẩy lại bản hiện tại."
elif git commit -q -m "$MSG"; then
  echo "      Đã tạo commit: $MSG"
else
  echo "[!] Tạo commit thất bại. Xem lỗi chi tiết ở trên."
  exit 1
fi

# ===== [5/5] Push =====
echo "[5/5] Đang đẩy code lên GitHub..."
if git push -u origin "$BRANCH"; then
  echo
  echo "[V] HOÀN THÀNH."
  echo "    Mã nguồn:  https://github.com/$REPO"
  echo "    Trang web: $PAGES"
  [ -n "$EXTRA_DONE" ] && echo "    $EXTRA_DONE"
  echo "    (Lần đầu cần bật GitHub Pages: Settings > Pages > Branch: main / root > Save."
  echo "     Sau đó đợi 1-2 phút rồi mở link trên. Các lần sau tự cập nhật.)"
  exit 0
fi

echo
echo "[!] KHÔNG ĐẨY ĐƯỢC. Thường do một trong bốn lý do:"
echo
echo "    1. Máy này chưa đăng nhập GitHub (GitHub không nhận mật khẩu thường khi đẩy code)."
echo "       Làm một lần:"
echo "         sudo apt install -y gh"
echo "         gh auth login        (chọn GitHub.com > HTTPS > Login with a web browser)"
echo "         gh auth setup-git"
echo "       rồi chạy lại ./$SELF"
echo
echo "    2. Repo chưa tồn tại trên GitHub:"
echo "       Mở https://github.com/new , đặt tên \"${REPO#*/}\", chọn Public,"
echo "       KHÔNG tick \"Add a README\", bấm Create repository, rồi chạy lại."
echo
echo "    3. Tài khoản đang đăng nhập chưa có quyền với repo $REPO:"
echo "       Mở https://github.com/$REPO/settings/access"
echo "       bấm \"Add people\", thêm tài khoản GitHub đang dùng trên máy này, rồi chạy lại."
echo
echo "    4. Trên GitHub có thay đổi mà máy chưa có (đẩy từ Surface hoặc sửa trên web):"
echo "       Chạy lệnh:  git pull --rebase origin $BRANCH   rồi chạy lại ./$SELF"
echo
exit 1
