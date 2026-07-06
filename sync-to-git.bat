@echo off
setlocal EnableDelayedExpansion

REM ============================================================
REM  sync-to-git.bat - TorrenSearch project
REM  Repository: https://github.com/Xerophayze/TorrenSearch.git
REM  Supports: push, pull, and status
REM  Run from the TorrenSearch project root folder.
REM ============================================================

set "REPO_DIR=%~dp0"
if "%REPO_DIR:~-1%"=="\" set "REPO_DIR=%REPO_DIR:~0,-1%"
set "REMOTE=origin"
set "BRANCH=main"
set "REPO_URL=https://github.com/Xerophayze/TorrenSearch.git"

call :ensure_repo
if errorlevel 1 goto :done
call :ensure_identity
if errorlevel 1 goto :done

echo.
echo  ================================================
echo   TorrenSearch - GitHub Sync
echo   Repo: %REPO_URL%
echo  ================================================
echo.
echo   1. Push   (commit local changes and push to GitHub)
echo   2. Pull   (pull latest changes from GitHub)
echo   3. Status (show git status and recent log)
echo   4. Exit
echo.
set /p "CHOICE=Select an option [1-4]: "

if "!CHOICE!"=="1" goto :do_push
if "!CHOICE!"=="2" goto :do_pull
if "!CHOICE!"=="3" goto :do_status
if "!CHOICE!"=="4" goto :done
echo Invalid choice. Exiting.
goto :done

REM ============================================================
:ensure_repo
REM ============================================================
where git >nul 2>nul
if errorlevel 1 (
    echo ERROR: Git was not found in PATH.
    echo Install Git for Windows, then rerun this script.
    exit /b 1
)

if not exist "%REPO_DIR%\.git\HEAD" (
    echo Initializing Git repository...
    git -C "%REPO_DIR%" init
    if errorlevel 1 exit /b 1
)

git -C "%REPO_DIR%" config --global --add safe.directory "%REPO_DIR%" >nul 2>nul

git -C "%REPO_DIR%" branch --show-current > "%TEMP%\torrensearch_branch.txt" 2>nul
set /p CURRENT_BRANCH=<"%TEMP%\torrensearch_branch.txt"
del "%TEMP%\torrensearch_branch.txt" >nul 2>nul
if "!CURRENT_BRANCH!"=="" (
    git -C "%REPO_DIR%" checkout -B %BRANCH% >nul 2>nul
) else if /I not "!CURRENT_BRANCH!"=="%BRANCH%" (
    echo Current branch is !CURRENT_BRANCH!. Switching/renaming to %BRANCH%...
    git -C "%REPO_DIR%" branch -M %BRANCH%
    if errorlevel 1 exit /b 1
)

git -C "%REPO_DIR%" remote get-url %REMOTE% > "%TEMP%\torrensearch_remote.txt" 2>nul
if errorlevel 1 (
    echo Adding GitHub remote %REMOTE%...
    git -C "%REPO_DIR%" remote add %REMOTE% %REPO_URL%
    if errorlevel 1 exit /b 1
) else (
    set /p CURRENT_REMOTE=<"%TEMP%\torrensearch_remote.txt"
    if /I not "!CURRENT_REMOTE!"=="%REPO_URL%" (
        echo Updating GitHub remote %REMOTE%...
        git -C "%REPO_DIR%" remote set-url %REMOTE% %REPO_URL%
        if errorlevel 1 exit /b 1
    )
)
del "%TEMP%\torrensearch_remote.txt" >nul 2>nul
exit /b 0

REM ============================================================
:ensure_identity
REM ============================================================
set "GIT_USER_NAME="
set "GIT_USER_EMAIL="

for /f "usebackq delims=" %%A in (`git -C "%REPO_DIR%" config user.name 2^>nul`) do set "GIT_USER_NAME=%%A"
for /f "usebackq delims=" %%A in (`git -C "%REPO_DIR%" config user.email 2^>nul`) do set "GIT_USER_EMAIL=%%A"

if not "!GIT_USER_NAME!"=="" if not "!GIT_USER_EMAIL!"=="" exit /b 0

echo.
echo Git needs a name and email for commits in this repository.
echo This will be saved locally in this repo only, not globally.
echo.

if "!GIT_USER_NAME!"=="" (
    set /p "GIT_USER_NAME=Commit author name [Xerophayze]: "
    if "!GIT_USER_NAME!"=="" set "GIT_USER_NAME=Xerophayze"
)

if "!GIT_USER_EMAIL!"=="" (
    set /p "GIT_USER_EMAIL=Commit author email: "
    if "!GIT_USER_EMAIL!"=="" (
        echo ERROR: Commit author email is required.
        echo GitHub accepts either your account email or a GitHub noreply address.
        pause
        exit /b 1
    )
)

git -C "%REPO_DIR%" config user.name "!GIT_USER_NAME!"
if errorlevel 1 exit /b 1
git -C "%REPO_DIR%" config user.email "!GIT_USER_EMAIL!"
if errorlevel 1 exit /b 1

exit /b 0

REM ============================================================
:do_push
REM ============================================================
call :ensure_repo
if errorlevel 1 goto :done
call :ensure_identity
if errorlevel 1 goto :done

echo.
echo --- Checking for changes ---
git -C "%REPO_DIR%" status --short
echo.

echo --- Staging all changes ---
git -C "%REPO_DIR%" add -A
if errorlevel 1 (
    echo ERROR: git add failed.
    pause
    exit /b 1
)

echo --- Safety check: scanning staged files for exposed secrets/runtime files ---
call :check_secrets
if errorlevel 1 goto :done

git -C "%REPO_DIR%" diff --cached --quiet
if not errorlevel 1 (
    echo Nothing to commit - no staged changes.
    echo.
    git -C "%REPO_DIR%" rev-parse --verify HEAD >nul 2>nul
    if errorlevel 1 (
        echo No commits exist yet, so there is nothing to push.
        goto :done
    )
    echo Pushing any unpushed commits...
    git -C "%REPO_DIR%" push -u %REMOTE% %BRANCH%
    if errorlevel 1 (
        echo ERROR: git push failed. You may need to pull first or authenticate with GitHub.
        pause
        exit /b 1
    )
    echo Push complete.
    goto :done
)

echo.
set /p "COMMIT_MSG=Enter commit message (or press Enter for default): "
if "!COMMIT_MSG!"=="" set "COMMIT_MSG=chore: sync TorrenSearch changes"

echo --- Committing ---
git -C "%REPO_DIR%" commit -m "!COMMIT_MSG!"
if errorlevel 1 (
    echo ERROR: git commit failed.
    pause
    exit /b 1
)

echo.
echo --- Pushing to GitHub ---
git -C "%REPO_DIR%" push -u %REMOTE% %BRANCH%
if errorlevel 1 (
    echo ERROR: git push failed. You may need to pull first or authenticate with GitHub.
    pause
    exit /b 1
)

echo.
echo Push complete!
goto :done

REM ============================================================
:do_pull
REM ============================================================
call :ensure_repo
if errorlevel 1 goto :done

echo.
echo --- Fetching from GitHub ---
git -C "%REPO_DIR%" fetch %REMOTE%
if errorlevel 1 (
    echo ERROR: git fetch failed. Check your network or GitHub credentials.
    pause
    exit /b 1
)

echo.
echo --- Pulling %REMOTE%/%BRANCH% into %BRANCH% ---
git -C "%REPO_DIR%" pull %REMOTE% %BRANCH%
if errorlevel 1 (
    echo ERROR: git pull failed. You may have merge conflicts to resolve.
    pause
    exit /b 1
)

echo.
echo Pull complete!
goto :done

REM ============================================================
:do_status
REM ============================================================
call :ensure_repo
if errorlevel 1 goto :done

echo.
echo --- Git Remote ---
git -C "%REPO_DIR%" remote -v
echo.
echo --- Git Status ---
git -C "%REPO_DIR%" status
echo.
echo --- Recent Commits ---
git -C "%REPO_DIR%" log --oneline -10 2>nul
echo.
pause
goto :done

REM ============================================================
:check_secrets
REM Abort if sensitive runtime files are not ignored or if known secret
REM patterns appear in publishable files.
REM ============================================================
set "FOUND_SECRET="

for %%F in (
    "%REPO_DIR%\.env"
    "%REPO_DIR%\synology\.env"
    "%REPO_DIR%\native-package\data\settings.json"
    "%REPO_DIR%\native-package\data\monitor-state.json"
    "%REPO_DIR%\native-package\logs\torrensearch.out.log"
    "%REPO_DIR%\native-package\logs\torrensearch.err.log"
    "%REPO_DIR%\standalone-package\.env"
    "%REPO_DIR%\standalone-package\data\torrensearch\settings.json"
    "%REPO_DIR%\TorrenSearch_Architecture_Guide.docx"
) do (
    if exist %%F (
        git -C "%REPO_DIR%" check-ignore -q %%F 2>nul
        if errorlevel 1 (
            echo.
            echo  *** SENSITIVE OR GENERATED FILE IS NOT IGNORED ***
            echo  %%F
            echo  Add it to .gitignore before pushing.
            echo.
            set "FOUND_SECRET=1"
        )
    )
)

if defined FOUND_SECRET (
    echo Aborting push to protect sensitive data.
    pause
    exit /b 1
)

git -C "%REPO_DIR%" grep -n -I -E "qbt_[A-Za-z0-9]+|prowlarrKey[^\n]*[0-9a-fA-F]{24,}|WIREGUARD_PRIVATE_KEY=[A-Za-z0-9+/=]{30,}|WIREGUARD_PRESHARED_KEY=[A-Za-z0-9+/=]{30,}" -- . ":(exclude).git" ":(exclude).data" ":(exclude)native-package/data" ":(exclude)native-package/logs" ":(exclude)TorrenSearch_Architecture_Guide.docx" > "%TEMP%\torrensearch_secret_scan.txt" 2>nul
if not errorlevel 1 (
    echo.
    echo  *** POSSIBLE SECRET PATTERN FOUND ***
    type "%TEMP%\torrensearch_secret_scan.txt"
    del "%TEMP%\torrensearch_secret_scan.txt" >nul 2>nul
    echo.
    echo Aborting push. Review the matches above.
    pause
    exit /b 1
)
del "%TEMP%\torrensearch_secret_scan.txt" >nul 2>nul

echo  No exposed secrets detected. Safe to continue.
exit /b 0

REM ============================================================
:done
REM ============================================================
echo.
pause
