@echo off
chcp 65001 >nul
setlocal

rem ============================================================
rem  upload.bat - day app "Tra loi an danh" len GitHub Pages
rem  Cach dung: bam dup file nay. Moi lan chay = mot lan cap nhat.
rem  Co the truyen loi commit:  upload.bat "Sua mau nut"
rem  Repo: https://github.com/ditruyenhungvuong/tra-loi-an-danh-V1
rem  Web:  https://ditruyenhungvuong.github.io/tra-loi-an-danh-V1/
rem
rem  Thong bao viet khong dau vi cua so cmd mac dinh khong hien
rem  tieng Viet co dau (theo docs/style/architecture-pattern.md muc 12).
rem ============================================================

rem Luon chay dung thu muc chua file nay, du bam dup tu dau
cd /d "%~dp0"

set "REPO=ditruyenhungvuong/tra-loi-an-danh-V1"
set "BRANCH=main"
set "PAGES=https://ditruyenhungvuong.github.io/tra-loi-an-danh-V1/"
set "CONFIG=js\config.js"
set "MSG=Cap nhat app Tra loi an danh"
if not "%~1"=="" set "MSG=%~1"

echo.
echo ======== DANG TAI CODE LEN GITHUB: %REPO% ========
echo Thu muc: %CD%
echo.

rem ---------- [0/5] Kiem tra cau hinh truoc khi day ----------
rem App chay that phai tro vao Google Apps Script, khong duoc tro vao mock local.
rem Neu config.js dang MOCK: true hay GOOGLE_SCRIPT_URL rong thi dung lai, khong day.
echo [0/5] Kiem tra %CONFIG%...
if not exist "%CONFIG%" goto :noconfig
findstr /R /C:"^ *MOCK: *true" "%CONFIG%" >nul 2>&1
if %errorlevel% equ 0 goto :mockon
findstr /R /C:"^ *GOOGLE_SCRIPT_URL: *''" "%CONFIG%" >nul 2>&1
if %errorlevel% equ 0 goto :nourl
findstr /R /C:"^ *GOOGLE_SCRIPT_URL: *\"\"" "%CONFIG%" >nul 2>&1
if %errorlevel% equ 0 goto :nourl
findstr /C:"script.google.com/macros/" "%CONFIG%" >nul 2>&1
if %errorlevel% neq 0 (
    echo       [?] GOOGLE_SCRIPT_URL khong giong dia chi Apps Script ^(script.google.com/macros/...^).
    echo           Van tiep tuc, nhung neu app khong gui duoc thi xem lai dong nay.
)
echo       Cau hinh on: MOCK dang tat, da co GOOGLE_SCRIPT_URL.

rem ---------- [1/5] Kiem tra da cai Git chua ----------
git --version >nul 2>&1
if %errorlevel% neq 0 goto :nogit

rem ---------- [2/5] Khoi tao Git trong thu muc app ----------
if exist ".git\" goto :hasgit
echo [2/5] Khoi tao Git lan dau...
git init >nul
git branch -M %BRANCH%
git remote add origin https://github.com/%REPO%.git
goto :identity

:hasgit
echo [2/5] Git da co san, cap nhat dia chi repo...
git remote set-url origin https://github.com/%REPO%.git 2>nul || git remote add origin https://github.com/%REPO%.git
git branch -M %BRANCH%

:identity
rem Git can biet ten + email nguoi commit. Chua co thi hoi mot lan, luu rieng cho thu muc nay.
set "GITNAME="
set "GITEMAIL="
for /f "delims=" %%n in ('git config user.name 2^>nul') do set "GITNAME=%%n"
for /f "delims=" %%e in ('git config user.email 2^>nul') do set "GITEMAIL=%%e"
if not defined GITNAME call :askname
if not defined GITEMAIL call :askemail

rem ---------- [3/5] Gom file ----------
echo [3/5] Dang gom toan bo file...
git add -A

rem ---------- [4/5] Commit ----------
echo [4/5] Dang tao ban commit...
git diff --cached --quiet
if %errorlevel% equ 0 (
    echo       Khong co thay doi moi so voi lan truoc, chi day lai ban hien tai.
    goto :push
)
git commit -m "%MSG%" >nul
if %errorlevel% neq 0 (
    echo [!] Tao commit that bai. Chay lai upload.bat de xem loi chi tiet o tren.
    goto :end
)
echo       Da tao commit: %MSG%

rem ---------- [5/5] Push ----------
:push
echo [5/5] Dang day code len GitHub ^(co the hien cua so dang nhap GitHub^)...
git push -u origin %BRANCH%
if %errorlevel% neq 0 goto :pushfail

echo.
echo [V] HOAN THANH.
echo     Ma nguon:  https://github.com/%REPO%
echo     Trang web: %PAGES%
echo     Man dan:   %PAGES%host.html?key=... ^(dung link anh da chep tu makeHostKey^)
echo     ^(Lan dau can bat GitHub Pages: Settings ^> Pages ^> Branch: main / root ^> Save.
echo      Sau do doi 1-2 phut roi mo link tren. Cac lan sau tu cap nhat.^)
goto :end

rem ============================================================
rem  Cac nhanh dung lai vi cau hinh chua san sang
rem ============================================================
:noconfig
echo.
echo [!] KHONG DAY. Khong thay file %CONFIG% trong thu muc nay.
echo     Co the dang chay upload.bat o sai thu muc, hoac app chua co phan giao dien.
echo     Thu muc hien tai: %CD%
echo.
goto :end

:mockon
echo.
echo [!] KHONG DAY. File %CONFIG% dang de MOCK: true ^(che do chay thu tren may^).
echo     Neu day len nhu vay, app tren web se tim server gia o localhost va KHONG hoat dong.
echo.
echo     Cach sua: mo %CONFIG%, tim dong   MOCK: true,   doi thanh   MOCK: false,
echo     luu lai, roi bam dup upload.bat lan nua.
echo.
goto :end

:nourl
echo.
echo [!] KHONG DAY. File %CONFIG% chua co GOOGLE_SCRIPT_URL ^(dang de rong^).
echo     Thieu dia chi nay thi app tren web khong gui va khong nhan duoc gi.
echo.
echo     Cach sua:
echo       1. Mo Google Sheet ^> Extensions ^> Apps Script ^> Deploy ^> Manage deployments,
echo          chep "Web app URL" ^(dang https://script.google.com/macros/s/.../exec^).
echo       2. Mo %CONFIG%, dan vao giua hai dau nhay cua dong GOOGLE_SCRIPT_URL: '...',
echo          luu lai, roi bam dup upload.bat lan nua.
echo.
goto :end

rem ============================================================
rem  Cac nhanh loi
rem ============================================================
:nogit
echo [!] May nay chua cai Git, nen chua day code len duoc.
echo.
echo     Cach cai ^(lam mot lan^):
echo       1. Mo trang: https://git-scm.com/download/win
echo       2. Tai ban "64-bit Git for Windows Setup" va chay, bam Next het.
echo       3. Cai xong, DONG cua so nay, roi bam dup upload.bat lai.
echo.
goto :end

:pushfail
echo.
echo [!] KHONG DAY DUOC. Thuong do mot trong ba ly do:
echo.
echo     1. Repo chua ton tai tren GitHub:
echo        Mo https://github.com/new , dat ten "tra-loi-an-danh-V1", chon Public,
echo        KHONG tick "Add a README", bam Create repository, roi chay lai.
echo.
echo     2. Tai khoan Git tren may chua co quyen voi repo %REPO%:
echo        Mo https://github.com/%REPO%/settings/access
echo        bam "Add people", them tai khoan GitHub dang dung tren may nay, roi chay lai.
echo.
echo     3. Tren GitHub co thay doi ma may chua co ^(sua truc tiep tren web^):
echo        Chay lenh:  git pull --rebase origin %BRANCH%   roi bam dup upload.bat lai.
echo.
goto :end

rem ============================================================
rem  Chuong trinh con: hoi ten / email neu Git chua biet
rem ============================================================
:askname
set /p "GITNAME=Nhap ten cua anh de ghi vao lich su (vi du: BS Thong): "
if not defined GITNAME set "GITNAME=ditruyenhungvuong"
git config user.name "%GITNAME%"
goto :eof

:askemail
set /p "GITEMAIL=Nhap email GitHub cua anh (Enter de bo qua): "
if not defined GITEMAIL set "GITEMAIL=ditruyenhungvuong@users.noreply.github.com"
git config user.email "%GITEMAIL%"
goto :eof

:end
echo.
pause
endlocal
