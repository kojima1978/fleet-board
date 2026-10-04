@echo off
setlocal
set "FLEETFLOW_PROJECT=%~dp0."
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\production\Initialize-Production.ps1" -ProjectDirectory "%FLEETFLOW_PROJECT%" %*
if errorlevel 1 exit /b %ERRORLEVEL%
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\production\Update-Production.ps1" -ProjectDirectory "%FLEETFLOW_PROJECT%" %*
exit /b %ERRORLEVEL%
