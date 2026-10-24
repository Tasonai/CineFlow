@echo off
chcp 65001 >nul
title CineFlow — Unified Cinema (Poland PL Edition)

echo ============================================================
echo 🎬 Запуск CineFlow Unified Cinema для Windows (WebView2 DRM)
echo ============================================================

cd /d "%~dp0\.."

:: Запускаем локальный бэкенд (Split-Proxy HDRezka + JustWatch PL + Kinorium Scrobbler)
start "CineFlow Backend" /min python server.py

:: Ждем инициализации сервера
timeout /t 2 /nobreak >nul

:: Открываем приложение в нативном безрамочном окне Microsoft Edge (App Mode с поддержкой Widevine L1 и PlayReady 4K HDR)
start "" msedge.exe --app=http://127.0.0.1:8765 --window-size=1440,900
exit
