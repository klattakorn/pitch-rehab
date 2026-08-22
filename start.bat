@echo off
REM ===================================================================
REM  RehabFootball - start everything.
REM  Double-click this file, or run  start.bat  from a terminal.
REM ===================================================================
setlocal
cd /d "%~dp0"

echo.
echo   REHABFOOTBALL
echo   Rehab. Return. Perform.
echo.

REM --- one-time setup, skipped once it has been done ------------------
python -c "import fastapi" >nul 2>&1
if errorlevel 1 (
  echo   Installing Python packages, one moment...
  python -m pip install -r requirements.txt --quiet --disable-pip-version-check
  if errorlevel 1 goto :pyfail
)

if not exist "web\node_modules" (
  echo   Installing web packages, this takes a minute the first time...
  pushd web
  call npm install --no-audit --no-fund
  popd
  if errorlevel 1 goto :webfail
)

if not exist "web\public\mediapipe" (
  echo   Copying MediaPipe files so the demo works offline...
  pushd web
  call node scripts\vendor-assets.mjs
  popd
  if errorlevel 1 goto :modelfail
)

REM --- https, so a phone camera works --------------------------------
REM Browsers only allow camera access on a secure origin. localhost is
REM exempt; the 192.168.x.x address a phone needs is not. A self-signed
REM certificate is what closes that gap.
if not exist "web\.cert\cert.pem" (
  echo   Making a certificate so phones can use their camera...
  pushd web
  call node scripts\make-cert.mjs
  popd
)

set "SCHEME=http"
if exist "web\.cert\cert.pem" set "SCHEME=https"

REM --- start both servers in their own windows -------------------------
echo   Starting the API on http://localhost:8000
start "RehabFootball API" cmd /k "python -m uvicorn app.main:app --port 8000 --reload"

echo   Starting the app on %SCHEME%://localhost:5173
start "RehabFootball Web" cmd /k "cd web && npx vite --port 5173"

echo.
echo   Waiting for the app to come up...
set /a tries=0
:wait
set /a tries+=1
REM `timeout` needs a console; `ping` sleeps the same way anywhere.
ping -n 2 127.0.0.1 >nul 2>&1
curl -s -k -o nul %SCHEME%://localhost:5173/ 2>nul
if not errorlevel 1 goto :ready
if %tries% lss 45 goto :wait
echo   Still not up. Check the two windows that opened for an error.
goto :end

:ready
echo.
echo   Ready. Opening your browser.
echo.
echo     App    %SCHEME%://localhost:5173
echo     API    http://localhost:8000/docs
echo.

if not "%SCHEME%"=="https" goto :nophone

echo   ON YOUR PHONE - same wifi as this laptop:
REM Node knows the addresses. Parsing ipconfig would only work on an
REM English-language Windows, because it translates its own labels.
pushd web
for /f "usebackq delims=" %%A in (`node scripts\make-cert.mjs --urls`) do echo     %%A
popd
echo.
echo   The phone will warn about the certificate once - that is expected.
echo   Android: Advanced, then Proceed.   iPhone: Show Details, then visit.
echo.
goto :howtostop

:nophone
echo   Phone camera will NOT work - the app is on plain http.
echo   Run:  cd web ^&^& node scripts\make-cert.mjs
echo   then start again.
echo.

:howtostop
echo   To stop: close the two server windows.
echo.
start %SCHEME%://localhost:5173
goto :end

:pyfail
echo.
echo   Could not install the Python packages.
echo   Check that Python is installed:  python --version
goto :end

:webfail
echo.
echo   Could not install the web packages.
echo   Check that Node is installed:  node --version
goto :end

:modelfail
echo.
echo   Could not copy the MediaPipe files.
echo   The pose model needs to be at  models\pose_landmarker_full.task
echo   Download it once from:
echo     https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task
goto :end

:end
endlocal
