param(
    [switch]$SkipVpn,
    [switch]$SkipProwlarr,
    [switch]$SkipQbittorrent
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Write-Step($Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-Command($Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Install-WingetPackage($Id, $Name) {
    Write-Step "Checking $Name"
    $existing = winget list --id $Id --exact --disable-interactivity 2>$null
    if ($LASTEXITCODE -eq 0 -and ($existing -match [regex]::Escape($Id))) {
        Write-Host "$Name is already installed."
        return
    }

    Write-Step "Installing $Name"
    winget install --id $Id --exact --accept-package-agreements --accept-source-agreements --disable-interactivity
}

Write-Step "Preparing native TorrenSearch package"

foreach ($Dir in @("data", "logs", "vpn")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Root $Dir) | Out-Null
}

$SettingsFile = Join-Path $Root "data\settings.json"
if (-not (Test-Path $SettingsFile)) {
    Copy-Item -LiteralPath (Join-Path $Root "settings.seed.json") -Destination $SettingsFile
}

if (-not (Test-Command "winget")) {
    throw "winget was not found. Install App Installer from Microsoft Store or install Node/Prowlarr/qBittorrent/WireGuard manually."
}

Install-WingetPackage "OpenJS.NodeJS.LTS" "Node.js LTS"
if (-not $SkipQbittorrent) { Install-WingetPackage "qBittorrent.qBittorrent" "qBittorrent" }
if (-not $SkipProwlarr) { Install-WingetPackage "TeamProwlarr.Prowlarr" "Prowlarr" }
if (-not $SkipVpn) { Install-WingetPackage "WireGuard.WireGuard" "WireGuard" }

Write-Step "Setup complete"
$NextSteps = Join-Path $Root "NEXT_STEPS.txt"
Write-Host "Opening next-step instructions: $NextSteps"
if (Test-Path $NextSteps) {
    Invoke-Item $NextSteps
}
Write-Host "Use run.bat for local-only mode, or run-lan.bat for phone/LAN access."
