@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "result=1"
set "buildOnly="
set "entered="

:parse
if "%~1"=="" goto prepare
if /i "%~1"=="-BuildOnly" goto buildonly
if /i "%~1"=="--build-only" goto buildonly
if /i "%~1"=="-Help" goto help
if /i "%~1"=="--help" goto help
echo ERROR: Unknown option: %~1
goto finish
:buildonly
set "buildOnly=1"
shift
goto parse

:prepare
pushd "%~dp0"
if errorlevel 1 goto finish
set "entered=1"
for %%C in (node.exe npm.cmd cargo.exe rustc.exe) do (
    where %%C >nul 2>nul
    if errorlevel 1 (
        echo ERROR: Missing %%C. Install Node.js 22+ and Rust MSVC, then reopen the terminal.
        goto finish
    )
)
node.exe -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
    echo ERROR: Node.js 22 or newer is required.
    goto finish
)
set "target="
for /f "tokens=2" %%T in ('rustc.exe -vV ^| findstr /b "host:"') do set "target=%%T"
set "arch="
if "%target%"=="x86_64-pc-windows-msvc" set "arch=x64"
if "%target%"=="aarch64-pc-windows-msvc" set "arch=arm64"
if "%target%"=="i686-pc-windows-msvc" set "arch=x86"
if not defined arch (
    echo ERROR: A Windows MSVC Rust toolchain is required. See README.md.
    goto finish
)
set "CARGO_TARGET_DIR=%CD%\src-tauri\target"

:prepareNative
echo.
echo ==^> Preparing bundled video decoder ^(^<platform^>^)
node.exe scripts\prepare-native.mjs
if errorlevel 1 goto failed

:deps
echo.
echo ==^> Installing frontend dependencies
call npm.cmd ci
if errorlevel 1 goto failed

echo.
echo ==^> Building Windows release installer
call npm.cmd run tauri -- build --target "%target%" --bundles nsis
if errorlevel 1 goto failed

set "version="
for /f "delims=" %%V in ('node.exe -p "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8')).version"') do set "version=%%V"
if not defined version (
    echo ERROR: Cannot read the application version.
    goto finish
)
set "installer=%CARGO_TARGET_DIR%\%target%\release\bundle\nsis\xfileviewer_%version%_%arch%-setup.exe"
if not exist "%installer%" (
    echo ERROR: Installer not found: "%installer%"
    goto finish
)
echo Installer: "%installer%"
if defined buildOnly goto success

echo.
echo ==^> Installing xfileviewer; close any running instance first
start "" /wait "%installer%" /S
if errorlevel 1 goto failed
echo Installation complete. Launch xfileviewer from the Start menu.
:success
set "result=0"
goto finish

:failed
echo ERROR: Command failed. Review the output above.
echo For linker or SDK errors, install Visual Studio Build Tools with Desktop development with C++.
goto finish

:help
echo Usage: install.bat [-BuildOnly] [-Help]
echo Installs npm dependencies, builds a release NSIS package, then installs it for the current user.
echo The bundled libmpv decoder ships with the installer; no extra Windows codec is required.
echo Set XFILEVIEWER_NO_PAUSE=1 to skip the final pause.
set "result=0"

:finish
if defined entered popd
if not defined XFILEVIEWER_NO_PAUSE pause
exit /b %result%