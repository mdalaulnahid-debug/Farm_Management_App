@echo off
setlocal
cd /d "%~dp0"
title FarmLedger - restore a backup

rem Puts a backup back as the farm's database. Close FarmLedger first.
echo FarmLedger restore
echo Close the FarmLedger window first. The backup is checked before anything changes,
echo and the current database is kept as a copy.
call npm run --silent db:restore -w apps/api
set /p NAME=File name of the backup to restore (or press Enter to cancel):
if "%NAME%"=="" (echo Cancelled. & pause & exit /b 0)
call npm run --silent db:restore -w apps/api -- "%NAME%"
echo.
pause
