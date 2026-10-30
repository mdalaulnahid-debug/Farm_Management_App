@echo off
setlocal
cd /d "%~dp0"
title FarmLedger ERP

where node >nul 2>nul || (echo Node.js 20 or newer is required: https://nodejs.org & pause & exit /b 1)

if not exist "node_modules\" (
  echo [1/4] Installing FarmLedger for the first run...
  call npm install || goto :fail
)
if not exist "apps\api\.env" (
  echo [2/4] Creating configuration apps\api\.env ...
  copy "apps\api\.env.example" "apps\api\.env" >nul
)
if not exist "apps\api\prisma\farmledger.db" (
  echo [3/4] Creating the database and loading starting data...
  call npm run db:setup -w apps/api || goto :fail
)
rem Apply any new tables/columns from updates (additive; existing data is kept).
call npm run db:push -w apps/api >nul || goto :fail
if not exist "apps\web\dist\index.html" (
  echo [4/4] Building the web app...
  call npm run build || goto :fail
)
echo.
echo FarmLedger ERP is running at  http://localhost:4000
echo Other computers on this network can use  http://THIS-PC-IP:4000
echo Keep this window open while the farm team is using it.
echo.
start "" http://localhost:4000
call npm start
goto :eof

:fail
echo Setup failed. Read the error above.
pause
exit /b 1
