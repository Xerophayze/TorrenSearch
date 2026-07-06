@echo off
setlocal

set "SCRIPT_ROOT=%~dp0"
set "ROOT=%~dp0..\..\"
set "PORT=8787"
if not "%~1"=="" set "PORT=%~1"

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_ROOT%Start-TorrenSearch-Full.ps1" -Lan -Port %PORT%

endlocal
