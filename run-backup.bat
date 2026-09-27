@echo off
REM Stable entry point for the nightly backup Task Scheduler job.
REM
REM Point Task Scheduler's action at THIS file, in a location that never
REM changes (e.g. C:\CrazyPhoneCRM\run-backup.bat, outside any versioned
REM app folder) -- then you never need to touch Task Scheduler again, no
REM matter how many times you redeploy to a new app folder.
REM
REM How it works: rather than hardcoding a path to backup.js, this asks
REM NSSM where the RepairLog service is CURRENTLY running from -- the same
REM AppDirectory setting your redeploy procedure already updates -- and
REM runs backup.js from there. One source of truth, always in sync.
REM
REM One-time setup:
REM   1. Edit NSSM_PATH below if nssm.exe isn't at the path shown.
REM   2. Point Task Scheduler's action at this file's full path.
REM   3. Run it once by hand (double-click, or "nssm... " isn't needed --
REM      just run this .bat directly) to confirm it prints "Local backup
REM      saved: ..." rather than an error.

setlocal enabledelayedexpansion

set "NSSM_PATH=C:\nssm\win64\nssm.exe"

if not exist "%NSSM_PATH%" (
  echo ERROR: nssm.exe not found at %NSSM_PATH% -- edit NSSM_PATH at the top of this file.
  exit /b 1
)

set "APPDIR="
for /f "usebackq delims=" %%i in (`"%NSSM_PATH%" get RepairLog AppDirectory`) do set "APPDIR=%%i"

if not defined APPDIR (
  echo ERROR: Could not read RepairLog's AppDirectory from nssm. Is the service installed?
  exit /b 1
)

if not exist "%APPDIR%\backup.js" (
  echo ERROR: %APPDIR%\backup.js not found. RepairLog's AppDirectory may be stale.
  exit /b 1
)

echo Running backup from: %APPDIR%
cd /d "%APPDIR%"
node backup.js
