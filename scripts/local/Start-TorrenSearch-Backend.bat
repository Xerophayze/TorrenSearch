@echo off
setlocal

set "ROOT=%~dp0..\..\"
set "PORT=8787"
set "HOST=0.0.0.0"
set "DATA_DIR=%ROOT%.data\torrensearch"

if not "%~1"=="" set "PORT=%~1"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found in PATH.
  echo Install Node.js or run this from a terminal where node is available.
  pause
  exit /b 1
)

cd /d "%ROOT%"
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

echo Starting TorrenSearch backend on port %PORT%...
echo.
echo Local URL:
echo   http://127.0.0.1:%PORT%
echo.
echo LAN URLs:
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } | ForEach-Object { '  http://' + $_.IPAddress + ':%PORT%' }"
echo.
echo This binds to all network adapters. Use only on trusted networks.
echo For internet port forwarding, protect the proxy with PROXY_TOKEN.
echo Press Ctrl+C to stop.
echo.

start "" "http://127.0.0.1:%PORT%"
node "%ROOT%server.js"

endlocal
