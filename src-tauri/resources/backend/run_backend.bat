@echo off
setlocal

set APPDATA_DIR=%LOCALAPPDATA%\Sova
if not exist "%APPDATA_DIR%" mkdir "%APPDATA_DIR%"

set VENV=%APPDATA_DIR%\venv
set LOGFILE=%APPDATA_DIR%\backend.log

echo [SOVA][%DATE% %TIME%] ==== run_backend.bat started ==== >> "%LOGFILE%"
echo [SOVA] CWD=%CD% >> "%LOGFILE%"
echo [SOVA] DP0=%~dp0 >> "%LOGFILE%"

set PYTHON=py
%PYTHON% -3 -V >> "%LOGFILE%" 2>&1 || set PYTHON=python

%PYTHON% -V >> "%LOGFILE%" 2>&1
if errorlevel 1 (
  echo [SOVA] Python is not installed. Install Python 3.x and restart. >> "%LOGFILE%"
  exit /b 1
)

if not exist "%VENV%\Scripts\python.exe" (
  echo [SOVA] Creating venv in %VENV% >> "%LOGFILE%"
  %PYTHON% -3 -m venv "%VENV%" >> "%LOGFILE%" 2>&1
)

echo [SOVA] Upgrading pip... >> "%LOGFILE%"
"%VENV%\Scripts\python.exe" -m pip install -U pip >> "%LOGFILE%" 2>&1

echo [SOVA] Installing requirements... >> "%LOGFILE%"
"%VENV%\Scripts\pip.exe" install -r "%~dp0requirements.txt" >> "%LOGFILE%" 2>&1

cd /d "%~dp0"
set PYTHONPATH=%CD%
echo [SOVA] PYTHONPATH=%PYTHONPATH% >> "%LOGFILE%"

echo [SOVA] Starting uvicorn on 127.0.0.1:7861 >> "%LOGFILE%"
"%VENV%\Scripts\python.exe" -m uvicorn engine.app:app --host 127.0.0.1 --port 7861 >> "%LOGFILE%" 2>&1

echo [SOVA] uvicorn exited with code %ERRORLEVEL% >> "%LOGFILE%"
