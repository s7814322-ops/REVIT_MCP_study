@echo off
rem Set the Abby update check to local midnight every day.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Set-AbbyUpdateSchedule.ps1"
set "abbyExit=%errorlevel%"
pause
exit /b %abbyExit%
