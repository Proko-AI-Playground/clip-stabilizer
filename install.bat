@echo off
echo ============================================
echo   Clip Stabilizer - Installer
echo ============================================
echo.

:: Enable unsigned CEP extensions (required for development)
echo Enabling unsigned extensions for CEP...
reg add "HKCU\SOFTWARE\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\SOFTWARE\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
echo Done.
echo.

:: Set target directory
set TARGET=%APPDATA%\Adobe\CEP\extensions\com.clipstabilizer.panel

:: Remove old installation if exists
if exist "%TARGET%" (
    echo Removing old installation...
    rmdir /s /q "%TARGET%"
)

:: Copy extension files
echo Installing extension...
xcopy /e /i /y "%~dp0com.clipstabilizer.panel" "%TARGET%" >nul

echo.
echo ============================================
echo   Installation complete!
echo ============================================
echo.
echo Next steps:
echo   1. Make sure FFmpeg is installed and in your PATH
echo      (Download from https://ffmpeg.org/download.html)
echo   2. Restart Premiere Pro
echo   3. Go to Window ^> Extensions ^> Clip Stabilizer
echo.
echo To verify FFmpeg is available, run: ffmpeg -version
echo.

:: Check if ffmpeg is available
where ffmpeg >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo WARNING: FFmpeg not found in PATH!
    echo The extension requires FFmpeg to extract video frames.
    echo Please install FFmpeg and add it to your system PATH.
    echo.
)

pause
