@echo off
REM ===================================================================
REM  Pitch Rehab - put the Android app on your phone.
REM  Double-click this file. Scan the code. That is the whole thing.
REM ===================================================================
setlocal
cd /d "%~dp0"

echo.
echo   PITCH REHAB
echo   Sending the app to your phone
echo.

if not exist "pitch-rehab.apk" (
  echo   No app has been built yet.
  echo.
  echo   Build one first - it takes a few minutes:
  echo     cd web
  echo     npm run apk
  echo.
  goto :end
)

if not exist "web\node_modules" (
  echo   The web packages are missing. Run start.bat once first.
  echo.
  goto :end
)

REM The server prints a QR code, waits for the phone, and stops itself.
pushd web
call node scripts\serve-apk.mjs
popd

:end
echo.
echo   Press any key to close this window.
pause >nul
endlocal
