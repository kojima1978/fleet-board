@echo off
setlocal
set "FLEETFLOW_PROJECT=%~dp0."
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\production\Export-Diagnostics.ps1" -ProjectDirectory "%FLEETFLOW_PROJECT%" %*
exit /b %ERRORLEVEL%
