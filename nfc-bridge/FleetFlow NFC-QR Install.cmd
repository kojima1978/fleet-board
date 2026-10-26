@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -KeepExistingConfiguration
set "fleetflowExitCode=%ERRORLEVEL%"
if not "%fleetflowExitCode%"=="0" pause
exit /b %fleetflowExitCode%
