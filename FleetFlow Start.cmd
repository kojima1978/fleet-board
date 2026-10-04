@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0nfc-bridge\start-fleetflow.ps1" -ProjectDirectory "%~dp0"
