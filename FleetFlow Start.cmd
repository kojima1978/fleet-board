@echo off
setlocal

rem "%~dp0" ends with a backslash. Passing that value as a quoted native
rem argument can break PowerShell's command-line parsing, so append a dot.
set "FLEETFLOW_PROJECT=%~dp0."
set "FLEETFLOW_LAUNCHER=%~dp0nfc-bridge\start-fleetflow.ps1"

if not exist "%FLEETFLOW_LAUNCHER%" (
  echo FleetFlow launcher was not found:
  echo %FLEETFLOW_LAUNCHER%
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%FLEETFLOW_LAUNCHER%" -ProjectDirectory "%FLEETFLOW_PROJECT%" %*
exit /b %ERRORLEVEL%
