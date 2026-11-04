# Правила проекта CineFlow

## Сборка установщиков (macOS и Windows)

- **Никогда не запускать сборку установщиков автоматически** после внесения правок, исправления ошибок или добавления функций.
- Скрипты упаковки `macos/build_macos_app.py` (`dist/CineFlow.app`, `dist/CineFlow.dmg`) и `windows/build_windows_installer.py` (`dist/CineFlow-Setup-*.exe`) запускать **строго и только по прямому запросу пользователя** в текущем сообщении (например, когда пользователь явно просит собрать установщик под macOS, под Windows или под обе системы).
- При сборке установщиков готовые файлы (`.dmg`, `.exe`, `SHA256SUMS.txt`, `latest.json`) обязательно помещать/дублировать в соответствующую папку локального репозитория: `/Users/tasonai/Developer/CineFlow/dist/`.
- При обычных изменениях кода выполнять только правку исходных файлов, обновление версии кеша статики (при изменении фронтенда), прогон тестов `python3 run_tests.py` и при необходимости перезапуск локального сервера `server.py`.

## Версионирование при сборке установщиков (`X.Y.Z`)

- Каждый раз, когда пользователь **даёт команду собрать установщик** (под Windows, macOS или обе ОС), перед запуском сборки обязательно **инкрементировать версию приложения**:
  - По умолчанию (при исправлении багов и текущих доработках) увеличивать **третий (патч) номер** версии на `+1`: например, `2.6.0` → `2.6.1` → `2.6.2` и т.д.
  - Первый (`X`) или второй (`Y`) номер версии менять **только по явному указанию пользователя** при крупных/основательных релизах.
- При обновлении версии синхронно обновлять её во всех файлах проекта и тестах:
  - `RELEASE_NOTES.md` (актуальный список изменений в формате Markdown для встраивания в установщики macOS `.dmg`, Windows `Setup.exe`, `dist/latest.json` и GitHub Releases)
  - `server.py` (`APP_VERSION`)
  - `public/index.html` (`#about-val-version`) и `public/js/state.js` (`appVersion`), `public/js/settings.js`
  - `macos/CineFlowApp.swift` и `macos/build_macos_app.py` (`CFBundleShortVersionString`, `CFBundleVersion`)
  - `windows/build_windows_installer.py` (`APP_VERSION`, `APP_VERSION_QUAD`)
  - `windows/installer/cineflow.nsi` (`!define APP_VERSION`, `!define APP_VERSION_QUAD`)
  - `windows/launcher/cineflow_launcher.rc` (`FILEVERSION`, `PRODUCTVERSION`, `FileVersion`, `ProductVersion`), `windows/launcher/cineflow_launcher.manifest`, `windows/launcher/cineflow_launcher.c`
  - `windows/installer/license_ru.txt`, `windows/installer/license_en.txt`, `windows/build-windows-exe.bat`, `windows/Start-Cinema-Windows.bat`
  - `tests/test_frontend_integrity.py`, `tests/test_audit_fixes.py`, `tests/test_roadmap_features.py`

## Описание релиза для GitHub Releases при каждой сборке установщика

- Каждый раз, когда выполняется сборка новой версии установщика (`macOS`, `Windows` или обе ОС), в итоговом ответе пользователю **обязательно предоставлять готовый блок для GitHub Releases**:
  1. **Tag**: `vX.Y.Z`
  2. **Release title**: `CineFlow X.Y.Z`
  3. **Describe this release (Описание)** — готовый для копирования в 1 клик текст изменений (понятным пользовательским языком, чтобы он красиво отображался внутри окна автообновления CineFlow).
  4. **Список файлов из `dist/`** для прикрепления к релизу (`CineFlow.dmg`, `CineFlow-Setup-X.Y.Z.exe`, `SHA256SUMS.txt`, `latest.json`).
