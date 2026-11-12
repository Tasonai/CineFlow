@echo off
chcp 65001 >nul
title Сборка установщика Velarium 2.7.18 для Windows (Atoma)

cd /d "%~dp0\.."
echo Запуск сборки установщика Velarium 2.7.18 (Windows x64)...
python windows\build_windows_installer.py
if errorlevel 1 (
    echo Ошибка при сборке установщика Velarium.
    pause
    exit /b 1
)

echo ============================================================
echo Готово! Установщик создан: dist\Velarium-Setup-2.7.18-x64.exe
echo ============================================================
pause
