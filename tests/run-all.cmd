@echo off
rem =========================================================
rem  Chạy toàn bộ test QA của app Trả lời ẩn danh.
rem    1. tests\check-static.js   rà cú pháp, id/data-act, microcopy, config, giọng viết
rem    2. tests\test-mock-api.js  contract của tools\mock-api.js
rem    3. tests\test-gas.js       google_apps_script.js chạy trong Node với SpreadsheetApp giả
rem    4. tests\e2e.js            Chrome headless, host + join nhiều tab, mock trong process (cổng 8790 / 8767)
rem  Máy không có Node trong PATH: đặt biến NODE, hoặc để trống để dùng Node portable mặc định:
rem    set NODE=C:\Users\SF\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe
rem    tests\run-all.cmd
rem  Tùy chọn: set QR_PYTHON=<python có OpenCV> để E2E giải mã QR độc lập (không có thì ghi NOTE bỏ qua).
rem  Cần Chrome tại C:\Program Files\Google\Chrome\Application\chrome.exe (hoặc đặt CHROME=...).
rem  Kết quả E2E, screenshot, console log ghi vào %TEMP%\tra-loi-an-danh-qa\ (không ghi vào thư mục app).
rem  Không sửa file nào của app; js/config.js có thể đang MOCK: true (check-static chỉ cảnh báo; thêm --strict để coi là lỗi).
rem =========================================================
setlocal
cd /d "%~dp0\.."
if "%NODE%"=="" set NODE=C:\Users\SF\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe
if not exist "%NODE%" set NODE=node
set FAIL=0

echo === 1/4 Ra tinh (cu phap, id, microcopy, config, giong viet) ===
"%NODE%" tests\check-static.js %STATIC_ARGS% || set FAIL=1

echo.
echo === 2/4 Contract tools\mock-api.js ===
"%NODE%" tests\test-mock-api.js || set FAIL=1

echo.
echo === 3/4 google_apps_script.js (gia lap SpreadsheetApp) ===
"%NODE%" tests\test-gas.js || set FAIL=1

echo.
echo === 4/4 E2E Chrome headless (7 kich ban) ===
"%NODE%" tests\e2e.js %* || set FAIL=1

if exist tools\mock-data.json del /q tools\mock-data.json

echo.
if "%FAIL%"=="1" (echo KET QUA: CO TEST DO & exit /b 1) else (echo KET QUA: TAT CA XANH & exit /b 0)
