@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0launch.ps1" -Reconnect -ShowStatus
exit /b %ERRORLEVEL%
