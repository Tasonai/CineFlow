**Что нового в Velarium 2.7.17:**
• **Исправлена блокировка `runtime\_bz2.pyd` при автообновлении на Windows**: устранена ошибка, из-за которой фоновый процесс `runtime\pythonw.exe` при запуске установщика изнутри приложения попадал в исключения родительской цепочки PID и продолжал удерживать бинарные модули Python (`_bz2.pyd`, `python311.dll`).
• **Проверка снятия блокировок файлов на уровне ядра Windows**: перед началом распаковки файлов помощник остановки теперь дожидается фактического освобождения на запись (`GENERIC_WRITE`) всех библиотек и модулей `runtime\`, `Velarium.exe`, `WebView2Loader.dll` и `ffmpeg.exe`, а также приводит короткие пути Windows к каноническому виду.
• **Изолированный запуск обновления и атомарная замена на macOS**: проверенные по `SHA-256` пакеты запускаются из отдельного временного каталога `%TEMP%`, а на macOS обновление выполняется через системный сценарий POSIX `/bin/sh` и `ditto` с откатом при ошибках.
• **Резиновая полноэкранная вёрстка (7–12 колонок постеров)**: широкоформатный интерфейс в стиле Netflix и Apple TV плавно адаптируется под полную ширину больших мониторов.

<!-- EN -->

**What's new in Velarium 2.7.17:**
• **Fixed `runtime\_bz2.pyd` File Lock During Windows In-App Updates**: resolved an issue where `runtime\pythonw.exe` matched the grandparent PID filter when `Setup.exe` was launched from inside Velarium, keeping Python extension modules (`_bz2.pyd`, `python311.dll`) locked during extraction.
• **Kernel-Level Write-Unlock Verification Before File Extraction**: the bundled shutdown helper now normalizes Windows 8.3 paths and verifies `GENERIC_WRITE` availability across `runtime\`, `Velarium.exe`, `WebView2Loader.dll`, and `ffmpeg.exe` before handing control back to NSIS.
• **Isolated Update Staging & Atomic macOS Bundle Swap**: `SHA-256`-verified installers run from a dedicated OS temp directory with detached file descriptors, and macOS `.dmg` updates execute via pure POSIX `/bin/sh` and `ditto` with automatic rollback.
• **Fluid Full-Bleed Widescreen Layout (7–12 Poster Columns)**: full-bleed Netflix & Apple TV widescreen layout scaling cleanly across large displays.
