@echo off
setlocal EnableDelayedExpansion
title EXE Deploy - MediLog NG
echo ==========================================
echo  MediLog NG - EXE BUILD LOCAL (no upload^)
echo  Usage: Exe-Deploy.bat [1^|2^|3^|patch^|minor^|major]
echo         No arg = ask interactively. Press Enter = same version, fresh EXE.
echo  Builds release\ exe locally only. Upload to GitHub manually to release.
echo ==========================================
echo.

:: Project root = two levels up from scripts\dev_test
cd /d "%~dp0..\.."
if not exist "package.json" (
    echo [ERROR] Could not find project root.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)

:: Optional version bump - command-line arg or interactive prompt
:: Usage: Exe-Deploy.bat [1^|2^|3^|patch^|minor^|major]  (no arg = prompt)
set BUMP=
if not "%~1"=="" (
    if /I "%~1"=="1" set BUMP=patch
    if /I "%~1"=="patch" set BUMP=patch
    if /I "%~1"=="2" set BUMP=minor
    if /I "%~1"=="minor" set BUMP=minor
    if /I "%~1"=="3" set BUMP=major
    if /I "%~1"=="major" set BUMP=major
    if defined BUMP echo [1/5] Version bump from command line: %BUMP%
)
if not defined BUMP (
    if not "%~1"=="" (
        echo [WARN] Unknown arg "%~1" - expected 1/2/3 or patch/minor/major.
    )
    echo.
    echo [1/5] Choose version bump:
    echo   1 = patch (e.g. 0.1.0 → 0.1.1)
    echo   2 = minor (e.g. 0.1.0 → 0.2.0)
    echo   3 = major (e.g. 0.1.0 → 1.0.0)
    echo   Press Enter = fresh EXE, same version
    set /p CHOICE=Enter choice (1/2/3):
    if /I "!CHOICE!"=="1" set BUMP=patch
    if /I "!CHOICE!"=="2" set BUMP=minor
    if /I "!CHOICE!"=="3" set BUMP=major
)
if defined BUMP (
    echo [1/5] Bumping version: %BUMP%...
    call node scripts/bump-version.mjs %BUMP%
    if errorlevel 1 (
        echo [ERROR] Version bump failed.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
        exit /b 1
    )
) else (
    echo [1/5] No version bump - fresh EXE, same version.
)

echo [2/5] Checking Node.js + dependencies...
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
if not exist "node_modules\electron-builder" (
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
        exit /b 1
    )
)
for /f %%v in ('node -p "require('./package.json').version"') do set VER=%%v
if "%VER%"=="" (
    echo [ERROR] Could not read version.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
echo Target version: v%VER%

echo [3/5] Cleaning stale output + stamping build (full rebuild, no leftovers)...
if exist "dist" rmdir /s /q "dist"
if exist "dist" (
    echo [ERROR] Could not delete dist\ - close dev server or editor locking it, then retry.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
call node scripts/stamp-build.mjs
if errorlevel 1 (
    echo [ERROR] Build stamp failed. Nothing published.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
echo [OK] dist\ cleared, build stamped. Rebuilding inside build step...

echo [4/5] Building EXE locally (no GitHub upload^)...
echo (npm run dist:win = vite build + electron-builder --publish never^)
call npm run dist:win
if errorlevel 1 (
    echo [ERROR] EXE build failed. Retry on errors above.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
if not exist "dist\index.html" (
    echo [WARNING] dist\index.html missing after build - check build output above.
)

echo [5/5] Done.
echo.
echo ==========================================
echo  SUCCESS! EXE v%VER% built locally - NOT uploaded.
echo  File: release\MediLogNG-Setup-%VER%.exe
echo.
echo  To release manually: GitHub repo ^> Releases ^> Draft new
echo   release ^> tag v%VER% ^> attach from release\:
echo    MediLogNG-Setup-%VER%.exe + .blockmap + latest.yml
echo ==========================================
echo.
echo  Next: install the exe locally to test, or upload to GitHub to
echo   let installed apps auto-update.
echo.
echo  Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
