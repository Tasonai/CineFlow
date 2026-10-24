@echo off
chcp 65001 >nul
title Сборка CineFlow.exe для Windows

cd /d "%~dp0\.."
echo Установка PyInstaller и pywebview (WebView2)...
pip install pyinstaller pywebview

echo Сборка автономного исполняемого файла CineFlow.exe...
pyinstaller --noconfirm --onefile --windowed --name "CineFlow" --add-data "public;public" --add-data "backend;backend" windows/desktop_webview2.py

echo ============================================================
echo ✅ Готово! Файл создан в папке: dist\CineFlow.exe
echo ============================================================
pause
