@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
title Velarium 2.7.11 — Atoma

cd /d "%~dp0\.."

if exist "%CD%\Velarium.exe" (
    start "" "%CD%\Velarium.exe"
    exit /b 0
)

echo ============================================================
echo Запуск Velarium 2.7.11 для Windows (Разработчик: Atoma)
echo ============================================================

if exist "%CD%\runtime\pythonw.exe" (
    start "" "%CD%\runtime\pythonw.exe" -X utf8 "%CD%\server.py" --launchd
) else (
    start "Velarium Backend" /min python -X utf8 server.py
)

timeout /t 1 /nobreak >nul
start "" msedge.exe --app=http://127.0.0.1:8765 --window-size=1280,780 --enable-gpu-rasterization --enable-oop-rasterization --ignore-gpu-blocklist --enable-features=CanvasOopRasterization,D3D11VideoDecoder,DirectComposition --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-features=CalculateNativeWinOcclusion,Translate --no-first-run --no-default-browser-check --proxy-bypass-list=<-loopback> --disable-extensions --disable-component-update --disable-sync --disable-default-apps --disable-domain-reliability --disk-cache-size=268435456 --autoplay-policy=no-user-gesture-required
exit /b 0
