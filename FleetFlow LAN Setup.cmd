@echo off
setlocal

set "FLEETFLOW_PROJECT=%~dp0."
set "FLEETFLOW_LAN_SETUP=%~dp0scripts\production\Configure-LanAccess.ps1"

if not exist "%FLEETFLOW_LAN_SETUP%" (
  echo FleetFlow LAN setup was not found:
  echo %FLEETFLOW_LAN_SETUP%
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%FLEETFLOW_LAN_SETUP%" -ProjectDirectory "%FLEETFLOW_PROJECT%" %*
exit /b %ERRORLEVEL%
