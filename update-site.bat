@echo off
REM ===================================================================
REM  Pitch Rehab - publish the app to the web.
REM  Double-click this file. It re-records the demo data, checks the
REM  build, commits, and pushes. Cloudflare does the rest.
REM ===================================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

REM Python prints arrows in its summaries; a piped Windows console defaults to
REM a code page that cannot hold them, and the script dies on the last line.
set "PYTHONIOENCODING=utf-8"

echo.
echo   PITCH REHAB
echo   Publishing to the web
echo.

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 goto :nogit

git remote get-url origin >nul 2>&1
if errorlevel 1 goto :noremote

REM --- 1. re-record what the site shows -------------------------------
REM The hosted site has no backend. web\src\demo\snapshot.json is not a
REM fallback there, it is the entire content -- so a change to a protocol or
REM a criterion reaches nobody until this is re-run. Doing it every time
REM costs half a minute and removes the one mistake that fails silently.
echo   Re-recording the demo data...
echo.
python scripts\make_snapshot.py
if errorlevel 1 goto :snapfail
echo.

REM --- 2. prove it builds before anything is pushed --------------------
REM Better to find a broken build here than in a log five minutes after you
REM have closed the laptop. This uploads nothing.
echo   Checking the build...
pushd web
call npm run build
popd
if errorlevel 1 goto :buildfail

REM --- 3. what actually changed ----------------------------------------
echo.
git status --short
echo.

REM Whether anything changed at all, without piping to `find`. On a machine
REM with Git's Unix tools on the PATH -- one of the options its installer
REM offers -- `find /c /v ""` runs GNU find instead of the Windows one and
REM sets off across the whole C: drive. git alone is enough.
set "DIRTY="
for /f "delims=" %%i in ('git status --porcelain') do set "DIRTY=1"

set "AHEAD=0"
for /f %%i in ('git rev-list --count @{upstream}..HEAD 2^>nul') do set "AHEAD=%%i"

if not defined DIRTY if "%AHEAD%"=="0" goto :nothingtodo

REM --- 4. commit -------------------------------------------------------
if not defined DIRTY goto :push

echo   Describe what changed. Keep it short - it becomes the commit message.
echo.
set "MSG="
set /p "MSG=  What changed? "
if not defined MSG set "MSG=Update the app"
REM A double quote would end the -m argument early and leave git reading the
REM rest as a filename. Nothing else in a sentence troubles cmd once it is
REM inside quotes, so dropping these is enough.
set "MSG=!MSG:"=!"
if not defined MSG set "MSG=Update the app"

REM `set /p` leaves errorlevel at 1 when there is no console to read from --
REM run from a pipe or a scheduler, say. Clear it, so the checks below are
REM reporting on git rather than on the prompt.
cmd /c exit 0

git add -A
if errorlevel 1 goto :gitfail
git commit -m "!MSG!"
if errorlevel 1 goto :gitfail

REM --- 5. push ---------------------------------------------------------
:push
echo.
echo   Pushing...
echo.

REM No upstream on the first push, and git will not guess one.
git rev-parse --abbrev-ref --symbolic-full-name @{upstream} >nul 2>&1
if errorlevel 1 (
  for /f %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
  git push -u origin !BRANCH!
) else (
  git push
)
if errorlevel 1 goto :pushfail

echo.
echo   ===============================================================
echo     Pushed. Cloudflare is building it now.
echo.
echo     Live in about a minute at:
echo       https://pitch-rehab.pages.dev
echo.
echo     Watch the build, or read the log if it fails:
echo       https://dash.cloudflare.com
echo.
echo     The address never changes, so a link you have already sent
echo     starts serving this version on its own.
echo   ===============================================================
echo.
echo   Note: this does not update a phone that already has the Android
echo   app installed. That needs  cd web ^&^& npm run apk  and a reinstall.
goto :end

:nothingtodo
echo   Nothing to publish - what is live already matches this.
goto :end

:nogit
echo   This folder is not a git repository, so there is nothing to push to.
echo   Publishing works by pushing to GitHub; see docs\WEB.md.
goto :end

:noremote
echo   No GitHub remote is set, so there is nowhere to push to.
echo.
echo   Set one once:
echo     git remote add origin https://github.com/YOURNAME/pitch-rehab.git
echo.
echo   See docs\WEB.md.
goto :end

:snapfail
echo.
echo   Could not re-record the demo data, so publishing stopped here.
echo   Nothing has been pushed.
echo.
echo   Check Python works:  python --version
echo   Then try by hand:    python scripts\make_snapshot.py
echo.
echo   If your change does not touch what the site shows - only styling, or
echo   wording in the app - the existing recording is still correct and you
echo   can publish the normal way:  git add -A ^&^& git commit ^&^& git push
goto :end

:buildfail
echo.
echo   The build failed, so nothing has been pushed. That is the point of
echo   checking here - the same failure would have happened on Cloudflare,
echo   quietly, after you walked away.
echo.
echo   The error is above. If it mentions node_modules, run start.bat once.
goto :end

:gitfail
echo.
echo   Git would not commit. The message is above.
echo   Nothing has been pushed.
goto :end

:pushfail
echo.
echo   The push failed. Your work is committed and safe - only the upload
echo   did not happen, so it is fine to run this again.
echo.
echo   If it asked you to sign in, finish that in the browser and re-run.
echo   If it says the remote has commits you do not:  git pull --rebase
goto :end

:end
echo.
echo   Press any key to close this window.
pause >nul
endlocal
