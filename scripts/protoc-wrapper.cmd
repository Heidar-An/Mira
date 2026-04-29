@echo off
setlocal EnableExtensions EnableDelayedExpansion

if not defined CARGO_HOME set "CARGO_HOME=%USERPROFILE%\.cargo"

for /f "delims=" %%I in ('dir /s /b "%CARGO_HOME%\registry\src\*protoc-bin-vendored-win32*\bin\protoc.exe" 2^>nul') do (
  "%%I" %*
  exit /b !ERRORLEVEL!
)

echo Unable to locate vendored protoc under %CARGO_HOME%\registry\src >&2
exit /b 1
