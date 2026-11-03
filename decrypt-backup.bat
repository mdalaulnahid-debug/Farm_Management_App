@echo off
setlocal
cd /d "%~dp0"
title FarmLedger - decrypt a backup

rem Makes a readable copy of an encrypted backup (.db.enc) next to it. The live database is not touched.
echo FarmLedger: decrypt an encrypted backup
set /p FILE=Full path of the .db.enc file (or press Enter to cancel):
if "%FILE%"=="" (echo Cancelled. & pause & exit /b 0)
call npm run --silent backup:decrypt -w apps/api -- "%FILE%"
echo.
pause
