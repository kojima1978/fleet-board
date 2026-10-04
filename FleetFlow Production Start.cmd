@echo off
setlocal

set "FLEETFLOW_PROJECT=%~dp0."
set "FLEETFLOW_INITIALIZER=%~dp0scripts\production\Initialize-Production.ps1"
set "FLEETFLOW_LAUNCHER=%~dp0nfc-bridge\start-fleetflow.ps1"

if not exist "%FLEETFLOW_INITIALIZER%" (
  echo FleetFlow production initializer was not found:
  echo %FLEETFLOW_INITIALIZER%
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%FLEETFLOW_INITIALIZER%" -ProjectDirectory "%FLEETFLOW_PROJECT%" %*
if errorlevel 1 exit /b %ERRORLEVEL%

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%FLEETFLOW_LAUNCHER%" -ProjectDirectory "%FLEETFLOW_PROJECT%" -Production %*
exit /b %ERRORLEVEL%
