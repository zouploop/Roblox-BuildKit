@echo off
setlocal
REM Single canonical way to launch the buildkit MCP server standalone (outside Claude
REM Code's own MCP-managed process). Refuses to start a second copy — orphaned duplicate
REM processes from repeated manual launches is exactly the mess this exists to prevent.
cd /d "%~dp0"
if not defined BUILDKIT_PORT set "BUILDKIT_PORT=44760"

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %BUILDKIT_PORT% -State Listen -ErrorAction SilentlyContinue) { exit 1 }"
if %ERRORLEVEL% EQU 1 (
    echo Already running: something is listening on port %BUILDKIT_PORT%.
    echo Kill it first if you want a fresh instance ^(check Task Manager for node.exe, or PID via: netstat -ano ^| findstr %BUILDKIT_PORT%^).
    pause
    exit /b 1
)

echo Starting buildkit MCP server + viewer...
node dist/index.js
pause
