@echo off
setlocal
cd /d "%~dp0"
title FarmLedger - reset a password

rem Gives one account a new temporary password. Works only on the computer that holds the database.
echo FarmLedger password reset
echo The account gets a temporary password, is unlocked, and all its old sign-ins end.
echo.
set /p EMAIL=Email of the account to reset (for example owner@farm.local):
if "%EMAIL%"=="" (echo No email given. & pause & exit /b 1)
call npm run --silent user:reset-password -w apps/api -- "%EMAIL%"
echo.
pause
