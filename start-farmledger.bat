@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\" (
  echo Installing FarmLedger dependencies for the first run...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed. Check the error above.
    pause
    exit /b 1
  )
)
echo Starting FarmLedger. Keep this window open while using the website.
call npm run dev
pause
