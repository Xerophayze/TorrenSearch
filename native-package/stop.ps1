$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $Root "data\torrensearch.pid"

if (Test-Path $PidFile) {
    $processId = [int](Get-Content -LiteralPath $PidFile -TotalCount 1)
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
} else {
    Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
        Where-Object { $_.CommandLine -like "*server.js*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

Write-Host "Stopped TorrenSearch backend if it was running."
Write-Host "Prowlarr, qBittorrent, and WireGuard are left running because they are normal native apps/services."
