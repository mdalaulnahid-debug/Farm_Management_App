@echo off
setlocal
cd /d "%~dp0"
title FarmLedger - make a backup key

rem Makes the key that encrypts backup copies leaving this computer. Print it and seal it in the safe.
call npm run --silent backup:new-key -w apps/api
echo.
pause
