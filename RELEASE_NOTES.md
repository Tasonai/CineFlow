**Что нового в Velarium 2.7.18:**
• **Полное устранение ошибки записи `runtime\_bz2.pyd` при обновлении на Windows 10 и Windows 11**: устаревший 32-разрядный плагин `nsExec` заменён на прямой системный вызов `ExecWait`, благодаря чему защитник Windows 11 и Smart App Control больше не блокируют запуск помощника остановки фоновых процессов перед копированием файлов.
• **Освобождение библиотек через системный диспетчер `Windows Restart Manager` и таблицу портов TCP**: перед распаковкой установщик запрашивает у ядра Windows список всех процессов, удерживающих модули в папках `runtime\` и `backend\bin\` или порты `8765` и `8090`, и гарантированно завершает фоновый сервер `pythonw.exe`.
• **Атомарный обход заблокированных файлов на уровне тома NTFS**: если антивирус или системная служба временно удерживает дескриптор `.pyd`, `.dll` или `.exe`, мастер установки переносит старый бинарный файл в скрытый каталог `.old_bins` на том же диске и записывает новую версию без окон ошибок.
• **Контроль актуальности фонового сервера и резиновая полноэкранная вёрстка (7–12 колонок)**: при запуске `Velarium.exe` автоматически сверяет версию локального сервера и перезапускает устаревший процесс после обновления, а широкоформатный каталог адаптируется под всю ширину экрана.

<!-- EN -->

**What's new in Velarium 2.7.18:**
• **Eliminated `runtime\_bz2.pyd` Write Errors During Windows 10 & Windows 11 Updates**: replaced the legacy 32-bit `nsExec` stub with native `ExecWait` execution so Windows 11 Defender and Smart App Control never block the pre-install shutdown helper.
• **Kernel `Restart Manager` (`rstrtmgr.dll`) & TCP Port Table Process Release**: before extracting files, Setup queries the Windows kernel for every process holding open handles or image mappings inside `runtime\` and `backend\bin\` or listening on ports `8765` and `8090`, cleanly stopping background `pythonw.exe` instances.
• **Atomic Same-Volume NTFS Locked-Binary Relocation**: if an antivirus scanner or system service briefly holds a `.pyd`, `.dll`, or `.exe` handle open, Setup atomically moves the old binary aside into `.old_bins` on the same volume and writes the new file without modal write-error dialogs.
• **Automatic Stale-Server Replacement & Fluid Widescreen Layout (7–12 Columns)**: `Velarium.exe` verifies the running local backend version on launch and seamlessly replaces stale processes after an update, paired with full-bleed widescreen poster grids.
