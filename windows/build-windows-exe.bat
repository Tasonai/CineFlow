@echo off
chcp 65001 >nul
title Сборка установщика CineFlow 2.7.1 для Windows (Atoma)

cd /d "%~dp0\.."
echo Запуск сборки установщика CineFlow 2.7.1 (Windows x64)...
python windows\build_windows_installer.py
if errorlevel 1 (
    echo Ошибка при сборке установщика CineFlow.
    pause
    exit /b 1
)

echo ============================================================
echo Готово! Установщик создан: dist\CineFlow-Setup-2.7.1-x64.exe
echo ============================================================
pause
