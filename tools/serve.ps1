<#
  tools/serve.ps1 - chay web server tinh cho app "Tra loi an danh" tren may minh.

  Cach chay (mo PowerShell tai thu muc app, hoac bam chuot phai > Run with PowerShell):
      powershell -ExecutionPolicy Bypass -File tools\serve.ps1
  Tuy chon:
      -Port 9000      doi cong (mac dinh 8766; app Check-in dung 8765 nen khong trung)
      -NoBrowser      khong tu mo trinh duyet (dung cho kiem thu tu dong)
      -OpenHost       mo man dan (host.html?key=...) thay vi man tham gia

  Script nam trong tools/ nhung phuc vu thu muc cha (chinh la thu muc app).
  Thu lan luot: python -> py -> npx serve -> php. Cai nao co thi dung.
  Server chi lang nghe 127.0.0.1 (chi may nay truy cap duoc), khong mo ra
  mang LAN benh vien, vi thu muc app co the chua du lieu thu.

  Muon thu ca hai man tren may minh: dat MOCK: true trong js/config.js, chay them
  tools/mock-api.js (cong 8788) bang Node portable, roi mo hai dia chi script in ra.
  Khoa demo-host-key-0000 chi dung duoc voi mock; nho tra MOCK: false truoc khi day
  (upload.bat se tu chan neu quen).
  Bam Ctrl+C de tat server.
#>
param(
    [int]$Port = 8766,
    [switch]$NoBrowser,
    [switch]$OpenHost
)

$ErrorActionPreference = 'Stop'

# Thu muc app = thu muc cha cua tools/
$Root    = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Url     = "http://localhost:$Port/"
$UrlJoin = "${Url}index.html"
$UrlHost = "${Url}host.html?key=demo-host-key-0000"

# Kiem tra mot lenh co ton tai va chay duoc khong (tranh "python" gia cua Microsoft Store)
function Test-Tool {
    param([string]$Name, [string[]]$ProbeArgs)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { return $false }
    try {
        $out = & $Name @ProbeArgs 2>&1
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

# Danh sach ung vien theo thu tu uu tien.
# Dung '.' lam thu muc vi server duoc chay voi WorkingDirectory = $Root
# (tranh loi duong dan co khoang trang nhu "G:\My Drive\...").
# Moi cong cu deu bi ep lang nghe 127.0.0.1: mac dinh python/npx serve bind 0.0.0.0,
# tuc la ca mang LAN deu doc duoc thu muc app. Khong duoc bo cac tham so bind nay.
$Bind = '127.0.0.1'
$candidates = @(
    @{ Name = 'python'; Probe = @('--version'); Args = @('-m', 'http.server', "$Port", '--bind', $Bind, '--directory', '.') },
    @{ Name = 'py';     Probe = @('--version'); Args = @('-m', 'http.server', "$Port", '--bind', $Bind, '--directory', '.') },
    @{ Name = 'npx';    Probe = @('--version'); Args = @('--yes', 'serve', '-l', "tcp://${Bind}:$Port", '.') },
    @{ Name = 'php';    Probe = @('--version'); Args = @('-S', "${Bind}:$Port", '-t', '.') }
)

# Start-Process ghep tham so bang khoang trang ma khong tu them dau nhay,
# nen tham so nao co khoang trang thi boc trong "..."
function Quote-Args {
    param([string[]]$Items)
    return ($Items | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } })
}

$chosen = $null
foreach ($c in $candidates) {
    if (Test-Tool -Name $c.Name -ProbeArgs $c.Probe) { $chosen = $c; break }
}

if (-not $chosen) {
    Write-Host ''
    Write-Host '[!] May nay chua co Python, Node hay PHP nen chua chay server duoc.' -ForegroundColor Yellow
    Write-Host '    Cach cai Python (lam mot lan, nhanh nhat):'
    Write-Host '      1. Mo https://www.python.org/downloads/windows/ va tai ban moi nhat.'
    Write-Host '      2. Khi cai, nho TICK "Add python.exe to PATH" roi bam Install Now.'
    Write-Host '      3. Dong PowerShell, mo lai, chay lai lenh:'
    Write-Host '         powershell -ExecutionPolicy Bypass -File tools\serve.ps1'
    Write-Host ''
    exit 1
}

Write-Host ''
Write-Host "Thu muc phuc vu : $Root"
Write-Host "Dung cong cu    : $($chosen.Name)"
Write-Host "Man tham gia    : $UrlJoin" -ForegroundColor Green
Write-Host "Man dan         : $UrlHost" -ForegroundColor Green
Write-Host "                  (khoa demo chi dung voi mock: MOCK: true + tools/mock-api.js cong 8788)"
Write-Host "Chi may nay truy cap duoc ($Bind), khong mo ra mang LAN."
Write-Host 'Bam Ctrl+C de tat server.'
Write-Host ''

# Chay server trong cung cua so (Ctrl+C se tat duoc), doi cong mo roi moi mo trinh duyet
$proc = Start-Process -FilePath $chosen.Name -ArgumentList (Quote-Args $chosen.Args) -WorkingDirectory $Root -NoNewWindow -PassThru
$null = $proc.Handle   # cham Handle de sau nay doc duoc ExitCode

try {
    $ready = $false
    for ($i = 0; $i -lt 40 -and -not $ready; $i++) {
        Start-Sleep -Milliseconds 250
        if ($proc.HasExited) { break }
        try {
            $tcp = New-Object System.Net.Sockets.TcpClient
            $tcp.Connect('127.0.0.1', $Port)
            $tcp.Close()
            $ready = $true
        } catch { }
    }

    if ($proc.HasExited) {
        Write-Host "[!] Server thoat ngay khi khoi dong (ma $($proc.ExitCode)). Cong $Port co dang bi chiem khong? Thu: -Port 8768" -ForegroundColor Yellow
        exit 1
    }

    if ($ready -and -not $NoBrowser) {
        if ($OpenHost) { Start-Process $UrlHost } else { Start-Process $UrlJoin }
    }
    if (-not $ready) { Write-Host "[?] Chua thay cong $Port mo, nhung server van dang chay. Tu mo: $UrlJoin" -ForegroundColor Yellow }

    Wait-Process -Id $proc.Id
} finally {
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
}
