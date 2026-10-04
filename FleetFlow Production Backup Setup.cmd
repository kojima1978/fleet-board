@echo off
setlocal
set "FLEETFLOW_PROJECT=%~dp0."
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\production\Configure-BackupSync.ps1" -ProjectDirectory "%FLEETFLOW_PROJECT%"
if errorlevel 1 pause
exit /b %ERRORLEVEL%
