**Что нового в Velarium 2.7.16:**
• **Надёжное автообновление без вылета установщика (Windows и macOS)**: исправлена ошибка, при которой запуск обновления изнутри приложения завершал процесс самого установщика вместе с закрытием окна Velarium. Проверенный по `SHA-256` пакет теперь изолируется в системном временном каталоге `%TEMP%` без удержания дескрипторов рабочей папки и порта `8765`.
• **Безопасная остановка фоновых процессов при обновлении с прошлых версий**: мастер установки Windows больше не вызывает старый исполняемый файл с диска, а использует встроенный модуль остановки с защитой родительской цепочки PID и папки пользовательских данных `data`.
• **Атомарное обновление на macOS без зависимости от Xcode Command Line Tools**: фоновая замена `/Applications/Velarium.app` переведена на чистый системный сценарий POSIX `/bin/sh` и `ditto` с автоматическим откатом из резервной копии при любой ошибке копирования.
• **Резиновая полноэкранная вёрстка (7–12 колонок постеров)**: сохранён полноэкранный широкоформатный интерфейс в стиле Netflix и Apple TV с автоматическим перерасчётом сетки на больших мониторах.

<!-- EN -->

**What's new in Velarium 2.7.16:**
• **Reliable In-App Auto-Update Without Installer Self-Termination (Windows & macOS)**: fixed an issue where launching an update from inside Velarium caused the shutdown helper to terminate the staged installer right after closing the app window. `SHA-256`-verified installers are now staged in an isolated OS temp directory with detached file descriptors.
• **Safe Process Shutdown Across Legacy Upgrades**: the Windows NSIS setup wizard now extracts and runs its own bundled process-stop helper with parent/grandparent PID protection and strict `data` folder exclusion, ensuring clean upgrades even from `2.7.14` and `2.7.15`.
• **Atomic macOS Bundle Swap Without Xcode Command Line Tools**: background `.dmg` installation now runs via pure POSIX `/bin/sh` and `ditto` with automatic backup rollback if bundle replacement fails.
• **Fluid Full-Bleed Widescreen Layout (7–12 Poster Columns)**: includes the full-bleed Netflix & Apple TV widescreen layout with responsive `matchMedia` grid scaling across large displays.
