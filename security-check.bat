@echo off
setlocal
cd /d "%~dp0"
title FarmLedger - security check

rem Read-only: lists settings that are not safe yet (network, passwords, backups) and how to fix each.
call npm run --silent security:check -w apps/api
echo.
pause
