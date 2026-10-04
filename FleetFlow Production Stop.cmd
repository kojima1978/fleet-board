@echo off
setlocal

set "FLEETFLOW_PROJECT=%~dp0."
set "FLEETFLOW_STOPPER=%~dp0scripts\production\Stop-Production.ps1"

if not exist "%FLEETFLOW_STOPPER%" (
  echo FleetFlow production stopper was not found:
  echo %FLEETFLOW_STOPPER%
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%FLEETFLOW_STOPPER%" -ProjectDirectory "%FLEETFLOW_PROJECT%" %*
exit /b %ERRORLEVEL%
