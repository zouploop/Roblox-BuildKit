@echo off
setlocal
REM Take over the configured bridge port before starting the standalone server.
cd /d "%~dp0"
if not defined BUILDKIT_PORT set "BUILDKIT_PORT=44760"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\free-buildkit-port.ps1"
if errorlevel 1 (
    echo Cannot release the BuildKit port. Close its owner or retry with appropriate permissions.
    pause
    exit /b 1
)

echo Starting buildkit MCP server + viewer...
node dist/index.js
pause
