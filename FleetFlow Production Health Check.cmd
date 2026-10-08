@echo off
setlocal

set "FLEETFLOW_PROJECT=%~dp0."
set "FLEETFLOW_HEALTH=%~dp0scripts\production\Test-ProductionHealth.ps1"

if not exist "%FLEETFLOW_HEALTH%" (
  echo FleetFlow health check was not found:
  echo %FLEETFLOW_HEALTH%
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%FLEETFLOW_HEALTH%" -ProjectDirectory "%FLEETFLOW_PROJECT%" %*
exit /b %ERRORLEVEL%
