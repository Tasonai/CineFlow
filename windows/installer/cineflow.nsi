; ============================================================================
; CineFlow 2.7.1 — Official Windows x64 Installer Script (NSIS 3 Modern UI 2)
; Developer / Publisher: Atoma
; ============================================================================

Unicode True

!ifndef APP_VERSION
  !define APP_VERSION "2.7.1"
!endif
!ifndef APP_VERSION_QUAD
  !define APP_VERSION_QUAD "2.7.1.0"
!endif
!define APP_NAME "CineFlow"
!define APP_PUBLISHER "Atoma"
!define APP_COPYRIGHT "Copyright (C) 2026 Atoma"
!define APP_REG_KEY "Software\Atoma\CineFlow"
!define UNINST_REG_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\CineFlow"
!define RUN_REG_KEY "Software\Microsoft\Windows\CurrentVersion\Run"

!ifndef STAGE_CORE_DIR
  !define STAGE_CORE_DIR "..\..\build\win-stage-core"
!endif
!ifndef STAGE_MEDIA_DIR
  !define STAGE_MEDIA_DIR "..\..\build\win-stage-media"
!endif
!ifndef ASSETS_DIR
  !define ASSETS_DIR "..\assets"
!endif
!ifndef INSTALLER_DIR
  !define INSTALLER_DIR "."
!endif
!ifndef OUT_INSTALLER_EXE
  !define OUT_INSTALLER_EXE "..\..\dist\CineFlow-Setup-${APP_VERSION}-x64.exe"
!endif

Name "${APP_NAME} ${APP_VERSION}"
OutFile "${OUT_INSTALLER_EXE}"
InstallDir "$LOCALAPPDATA\Programs\CineFlow"
InstallDirRegKey HKCU "${APP_REG_KEY}" "InstallDir"
RequestExecutionLevel user
ManifestDPIAware true
BrandingText "${APP_NAME} ${APP_VERSION}  |  ${APP_PUBLISHER}"
ShowInstDetails show
ShowUninstDetails show
SetCompressor /SOLID lzma
SetCompressorDictSize 32

; PE Version Information embedded into CineFlow-Setup-2.7.1-x64.exe
VIProductVersion "${APP_VERSION_QUAD}"
VIFileVersion "${APP_VERSION_QUAD}"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "ProductVersion" "${APP_VERSION}"
VIAddVersionKey "FileVersion" "${APP_VERSION_QUAD}"
VIAddVersionKey "CompanyName" "${APP_PUBLISHER}"
VIAddVersionKey "LegalCopyright" "${APP_COPYRIGHT}"
VIAddVersionKey "FileDescription" "${APP_NAME} ${APP_VERSION} Setup (Windows x64)"
VIAddVersionKey "OriginalFilename" "CineFlow-Setup-${APP_VERSION}-x64.exe"

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"

; Variables for custom Application Language & Upgrade wizard pages
Var DialogAppLang
Var LabelAppLangIntro
Var RadioAppLangRu
Var LabelAppLangRuDesc
Var RadioAppLangEn
Var LabelAppLangEnDesc
Var LabelAppLangFooter
Var SelectedAppLang
Var AppLangInitialized

Var IsUpgradeMode
Var InstalledVersion
Var ExpressUpgrade
Var DialogUpgrade
Var LabelUpgradeStatus
Var RadioUpgradeFast
Var RadioUpgradeCustom
Var LabelUpgradeNotes
Var EditUpgradeChangelog
Var DynamicWelcomeTitle
Var DynamicWelcomeText
Var DynamicFinishTitle
Var DynamicFinishText

; ============================================================================
; Modern UI 2 Visual & Branding Configuration
; ============================================================================
!define MUI_ICON "${ASSETS_DIR}\cineflow.ico"
!define MUI_UNICON "${ASSETS_DIR}\cineflow.ico"

!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "${ASSETS_DIR}\wizard-header.bmp"
!define MUI_HEADERIMAGE_UNBITMAP "${ASSETS_DIR}\wizard-header.bmp"

!define MUI_WELCOMEFINISHPAGE_BITMAP "${ASSETS_DIR}\wizard-welcome.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${ASSETS_DIR}\wizard-welcome.bmp"

!define MUI_ABORTWARNING

; Installer Language Dialog configuration (always shown first in .onInit)
!define MUI_LANGDLL_ALLLANGUAGES
!define MUI_LANGDLL_WINDOWTITLE "${APP_NAME} ${APP_VERSION} — ${APP_PUBLISHER}"
!define MUI_LANGDLL_INFO "Выберите язык установки:$\r$\nSelect Setup language:"
!define MUI_LANGDLL_REGISTRY_ROOT "HKCU"
!define MUI_LANGDLL_REGISTRY_KEY "${APP_REG_KEY}"
!define MUI_LANGDLL_REGISTRY_VALUENAME "InstallerLanguage"
!define MUI_LANGDLL_ALWAYSSHOW

; ============================================================================
; Installer Wizard Pages
; ============================================================================

; 1. Welcome & Product Overview Page
!define MUI_WELCOMEPAGE_TITLE "$DynamicWelcomeTitle"
!define MUI_WELCOMEPAGE_TEXT "$DynamicWelcomeText"
!insertmacro MUI_PAGE_WELCOME

; 2. Custom Page: Existing Installation Detection, Upgrade Mode & What's New Changelog
Page custom UpgradePageCreate UpgradePageLeave

; 3. Product Information, Local Privacy & License Agreement Page
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipPageIfExpressUpgrade
!define MUI_PAGE_HEADER_TEXT "$(LicenseHeaderTitle)"
!define MUI_PAGE_HEADER_SUBTEXT "$(LicenseHeaderSub)"
!define MUI_LICENSEPAGE_CHECKBOX
!insertmacro MUI_PAGE_LICENSE $(LicenseFile)

; 4. Custom Page: Application Interface Language Selection (RU / EN)
Page custom AppLangPageCreate AppLangPageLeave

; 5. Components & Shortcuts Selection Page
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipPageIfExpressUpgrade
!define MUI_PAGE_HEADER_TEXT "$(CompHeaderTitle)"
!define MUI_PAGE_HEADER_SUBTEXT "$(CompHeaderSub)"
!define MUI_COMPONENTSPAGE_SMALLDESC
!insertmacro MUI_PAGE_COMPONENTS

; 6. Destination Directory Page
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipPageIfExpressUpgrade
!define MUI_PAGE_HEADER_TEXT "$(DirHeaderTitle)"
!define MUI_PAGE_HEADER_SUBTEXT "$(DirHeaderSub)"
!insertmacro MUI_PAGE_DIRECTORY

; 7. Installation Progress Page
!define MUI_PAGE_HEADER_TEXT "$(InstHeaderTitle)"
!define MUI_PAGE_HEADER_SUBTEXT "$(InstHeaderSub)"
!insertmacro MUI_PAGE_INSTFILES

; 8. Completion & Launch Page
!define MUI_FINISHPAGE_TITLE "$DynamicFinishTitle"
!define MUI_FINISHPAGE_TEXT "$DynamicFinishText"
!define MUI_FINISHPAGE_TEXT_LARGE
!define MUI_FINISHPAGE_RUN "$INSTDIR\CineFlow.exe"
!define MUI_FINISHPAGE_RUN_TEXT "$(FinishRunText)"
!define MUI_FINISHPAGE_NOREBOOTSUPPORT
!insertmacro MUI_PAGE_FINISH

; ============================================================================
; Uninstaller Wizard Pages
; ============================================================================
!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

; ============================================================================
; Supported Installer Languages (Russian first + English)
; ============================================================================
!insertmacro MUI_LANGUAGE "Russian"
!insertmacro MUI_LANGUAGE "English"
SetFont /LANG=${LANG_RUSSIAN} "Segoe UI" 8
SetFont /LANG=${LANG_ENGLISH} "Segoe UI" 8

; ============================================================================
; Localized Installer Copy (Zero dotted Russian abbreviations, zero emojis)
; ============================================================================
LicenseLangString LicenseFile ${LANG_RUSSIAN} "${INSTALLER_DIR}\license_ru.txt"
LicenseLangString LicenseFile ${LANG_ENGLISH} "${INSTALLER_DIR}\license_en.txt"

LangString WelcomeTitle ${LANG_RUSSIAN} "Установка CineFlow ${APP_VERSION}"
LangString WelcomeTitle ${LANG_ENGLISH} "Welcome to CineFlow ${APP_VERSION} Setup"

LangString WelcomeTitleUpgrade ${LANG_RUSSIAN} "Обновление CineFlow до версии ${APP_VERSION}"
LangString WelcomeTitleUpgrade ${LANG_ENGLISH} "Update CineFlow to Version ${APP_VERSION}"

LangString WelcomeText ${LANG_RUSSIAN} "Мастер установит локальный кинотеатр CineFlow ${APP_VERSION} (x64) на ваш компьютер.$\r$\n$\r$\nРазработчик: ${APP_PUBLISHER}$\r$\nСистема: Windows 10 / 11 (x64), Python 3.11$\r$\n$\r$\nВозможности выпуска:$\r$\n• Синхронизация Kinorium в один клик и профили$\r$\n• Потоковое 1080p / 4K HDR и офлайн-загрузки$\r$\n• Ремукс звука FFmpeg, субтитры и Stremio$\r$\n• Пульт со смартфона по QR, ТВ-режим и DLNA$\r$\n$\r$\nНажмите «Далее» для продолжения установки."
LangString WelcomeText ${LANG_ENGLISH} "This wizard will install CineFlow ${APP_VERSION} (x64) on your computer.$\r$\n$\r$\nDeveloper: ${APP_PUBLISHER}$\r$\nRuntime: Windows 10 / 11 (x64), Python 3.11$\r$\n$\r$\nKey Features:$\r$\n• One-click Kinorium sign-in and Profiles$\r$\n• 1080p / 4K HDR streaming and Offline Downloads$\r$\n• Live FFmpeg audio sync, Subtitles, and Stremio$\r$\n• Wi-Fi QR Phone Remote, TV Mode, and DLNA$\r$\n$\r$\nClick Next to continue."

LangString WelcomeTextUpgrade ${LANG_RUSSIAN} "Обнаружена установленная копия CineFlow ($InstalledVersion) в папке:$\r$\n$INSTDIR$\r$\n$\r$\nМастер обновит приложение до версии ${APP_VERSION} (x64), сохранив все ваши профили, списки Kinorium, историю просмотра и офлайн-загрузки.$\r$\n$\r$\nНа следующем шаге вы сможете ознакомиться со списком изменений и выполнить быстрое обновление.$\r$\n$\r$\nНажмите «Далее» для просмотра списка изменений."
LangString WelcomeTextUpgrade ${LANG_ENGLISH} "An existing installation of CineFlow ($InstalledVersion) was detected in:$\r$\n$INSTDIR$\r$\n$\r$\nSetup will update CineFlow to version ${APP_VERSION} (x64) while preserving all your profiles, Kinorium lists, watch history, and offline downloads.$\r$\n$\r$\nOn the next page you can review what is new and run a fast in-place update.$\r$\n$\r$\nClick Next to view the changelog."

LangString UpgradeHeaderTitle ${LANG_RUSSIAN} "Обновление CineFlow (${APP_VERSION})"
LangString UpgradeHeaderTitle ${LANG_ENGLISH} "Update CineFlow (${APP_VERSION})"

LangString UpgradeHeaderSub ${LANG_RUSSIAN} "Обнаружена версия $InstalledVersion — список изменений в ${APP_VERSION}"
LangString UpgradeHeaderSub ${LANG_ENGLISH} "Installed version $InstalledVersion detected — What is new in ${APP_VERSION}"

LangString UpgradeStatusInfo ${LANG_RUSSIAN} "Установленная версия: CineFlow $InstalledVersion  ->  Новая версия: CineFlow ${APP_VERSION}$\r$\nПапка установки: $INSTDIR"
LangString UpgradeStatusInfo ${LANG_ENGLISH} "Installed version: CineFlow $InstalledVersion  ->  New version: CineFlow ${APP_VERSION}$\r$\nDestination folder: $INSTDIR"

LangString UpgradeOptFast ${LANG_RUSSIAN} "Обновить установленную версию CineFlow (рекомендуется, все данные сохранятся)"
LangString UpgradeOptFast ${LANG_ENGLISH} "Update existing CineFlow installation (recommended, keeps all personal data)"

LangString UpgradeOptCustom ${LANG_RUSSIAN} "Изменить параметры установки, язык интерфейса или ярлыки"
LangString UpgradeOptCustom ${LANG_ENGLISH} "Customize installation settings, interface language, or shortcuts"

LangString UpgradeNotesCaption ${LANG_RUSSIAN} "Список изменений по сравнению с предыдущей версией:"
LangString UpgradeNotesCaption ${LANG_ENGLISH} "What is new compared to the previous version:"

LangString UpgradeChangelogText ${LANG_RUSSIAN} "Изменения в выпуске CineFlow ${APP_VERSION}:$\r$\n$\r$\n• Внешние стриминговые сервисы (Player.pl, Netflix, Apple TV+, Prime Video, Disney+, Max):$\r$\n  - При выборе подключённого сервиса в верхней панели главной страницы отображается полный актуальный каталог его сериалов и фильмов в приоритетном порядке.$\r$\n  - В верхней панели плеера рядом с HDRezka, Stremio и 4K теперь отображаются вкладки всех подключённых стриминговых сервисов для быстрого переключения на любом фильме или сериале (включая глобальный поиск).$\r$\n  - Автоматическое определение прямых ссылок на тайтл в подключённых сервисах.$\r$\n$\r$\n• Мобильный пульт управления (Wi-Fi QR):$\r$\n  - Добавлен полноценный режим Картинка-в-картинке (PiP) с автозапуском воспроизведения и нативный полноэкранный режим на весь экран монитора.$\r$\n  - Отключено случайное масштабирование экрана при быстром двойном нажатии на кнопки пульта.$\r$\n$\r$\n• Интерфейс и установщик Windows:$\r$\n  - Исправлено межбуквенное расстояние и рендеринг шрифтов Segoe UI на Windows 10/11 (устранено слипание букв в заголовках и карточках).$\r$\n  - Адаптирована вёрстка окон установщика под экраны с масштабированием 125%–150% DPI.$\r$\n  - Автоматическое определение установленной версии и обновление в один клик с сохранением пользовательских данных."
LangString UpgradeChangelogText ${LANG_ENGLISH} "What is new in CineFlow ${APP_VERSION}:$\r$\n$\r$\n• External Streaming Services (Player.pl, Netflix, Apple TV+, Prime Video, Disney+, Max):$\r$\n  - Selecting a connected streaming service on the main screen now loads and prioritizes its full catalog of series and movies.$\r$\n  - Connected streaming services now appear directly in the top Player source switcher alongside HDRezka, Stremio, and 4K for every title (including Global Search results).$\r$\n  - Automatic direct title link resolution across connected services.$\r$\n$\r$\n• Wi-Fi QR Phone Remote:$\r$\n  - Added full Picture-in-Picture (PiP) activation with automatic playback readiness and true monitor-wide fullscreen toggle.$\r$\n  - Disabled accidental viewport zooming on rapid double-tap gestures.$\r$\n$\r$\n• Windows Typography & Setup Wizard:$\r$\n  - Improved Segoe UI kerning and letter-spacing across headings, cards, and modals on Windows 10/11.$\r$\n  - High-DPI layout fixes for 125%–150% Windows scaling.$\r$\n  - Automatic existing installation detection with one-click upgrade and changelog preview."

LangString LicenseHeaderTitle ${LANG_RUSSIAN} "Описание и условия использования"
LangString LicenseHeaderTitle ${LANG_ENGLISH} "Product Overview & License Terms"

LangString LicenseHeaderSub ${LANG_RUSSIAN} "CineFlow ${APP_VERSION} — Разработчик: ${APP_PUBLISHER}"
LangString LicenseHeaderSub ${LANG_ENGLISH} "CineFlow ${APP_VERSION} — Developer: ${APP_PUBLISHER}"

LangString AppLangHeaderTitle ${LANG_RUSSIAN} "Язык интерфейса приложения"
LangString AppLangHeaderTitle ${LANG_ENGLISH} "Application Interface Language"

LangString AppLangHeaderSub ${LANG_RUSSIAN} "Выберите основной язык внутри CineFlow ${APP_VERSION}"
LangString AppLangHeaderSub ${LANG_ENGLISH} "Choose the default language inside CineFlow ${APP_VERSION}"

LangString AppLangIntro ${LANG_RUSSIAN} "Выберите язык интерфейса, на котором откроется кинотеатр CineFlow после установки:"
LangString AppLangIntro ${LANG_ENGLISH} "Select the default interface language that CineFlow will use on first launch:"

LangString AppLangOptRuTitle ${LANG_RUSSIAN} "Русский — русский интерфейс, описания и постеры"
LangString AppLangOptRuTitle ${LANG_ENGLISH} "Russian (Русский) — Russian interface and posters"

LangString AppLangOptRuDesc ${LANG_RUSSIAN} "Названия, описания сюжетов, постеры и выбор аудиодорожек по умолчанию на русском языке."
LangString AppLangOptRuDesc ${LANG_ENGLISH} "Displays Russian navigation, localized titles, posters, and Russian audio by default."

LangString AppLangOptEnTitle ${LANG_RUSSIAN} "English — английский интерфейс и оригинальные постеры"
LangString AppLangOptEnTitle ${LANG_ENGLISH} "English — English interface and original posters"

LangString AppLangOptEnDesc ${LANG_RUSSIAN} "Английский интерфейс, международные названия, оригинальные постеры и озвучка."
LangString AppLangOptEnDesc ${LANG_ENGLISH} "Displays full English UI, international titles, original posters, and original audio."

LangString AppLangFooterNote ${LANG_RUSSIAN} "Язык приложения (RU / EN) можно в любой момент переключить в верхней панели CineFlow."
LangString AppLangFooterNote ${LANG_ENGLISH} "You can switch the app language (RU / EN) at any time in the CineFlow top bar."

LangString CompHeaderTitle ${LANG_RUSSIAN} "Компоненты установки"
LangString CompHeaderTitle ${LANG_ENGLISH} "Installation Components"

LangString CompHeaderSub ${LANG_RUSSIAN} "Выберите модули и ярлыки для CineFlow ${APP_VERSION}"
LangString CompHeaderSub ${LANG_ENGLISH} "Choose modules and shortcuts for CineFlow ${APP_VERSION}"

LangString SecCoreName ${LANG_RUSSIAN} "CineFlow ${APP_VERSION} и Python 3.11 (основа)"
LangString SecCoreName ${LANG_ENGLISH} "CineFlow ${APP_VERSION} & Python 3.11 (Core)"

LangString SecMediaName ${LANG_RUSSIAN} "Движок 4K HDR (TorrServer + FFmpeg)"
LangString SecMediaName ${LANG_ENGLISH} "4K HDR Engine (TorrServer + FFmpeg)"

LangString SecDesktopName ${LANG_RUSSIAN} "Ярлык на рабочем столе"
LangString SecDesktopName ${LANG_ENGLISH} "Desktop Shortcut"

LangString SecStartMenuName ${LANG_RUSSIAN} "Ярлыки в меню «Пуск»"
LangString SecStartMenuName ${LANG_ENGLISH} "Start Menu Shortcuts"

LangString SecAutostartName ${LANG_RUSSIAN} "Автозапуск сервера при входе в Windows"
LangString SecAutostartName ${LANG_ENGLISH} "Start Background Server at Sign-In"

LangString DescSecCore ${LANG_RUSSIAN} "Лаунчер CineFlow.exe, локальный сервер и среда Python 3.11 (${APP_PUBLISHER})."
LangString DescSecCore ${LANG_ENGLISH} "Native CineFlow.exe launcher, local server, and Python 3.11 (${APP_PUBLISHER})."

LangString DescSecMedia ${LANG_RUSSIAN} "Модули TorrServer MatriX и FFmpeg 9 для потоков 4K HDR, ремукса аудио и загрузок."
LangString DescSecMedia ${LANG_ENGLISH} "TorrServer MatriX and FFmpeg 9 for 4K HDR streaming, audio remux, and downloads."

LangString DescSecDesktop ${LANG_RUSSIAN} "Создаёт ярлык запуска CineFlow на рабочем столе Windows."
LangString DescSecDesktop ${LANG_ENGLISH} "Places a CineFlow launch shortcut on your Windows Desktop."

LangString DescSecStartMenu ${LANG_RUSSIAN} "Создаёт папку CineFlow в меню «Пуск» с ярлыками запуска и удаления."
LangString DescSecStartMenu ${LANG_ENGLISH} "Creates a CineFlow folder in the Start Menu with launch and uninstall links."

LangString DescSecAutostart ${LANG_RUSSIAN} "Тихий запуск локального сервера при входе в Windows для просмотра с ТВ и телефона."
LangString DescSecAutostart ${LANG_ENGLISH} "Starts the local CineFlow server in the background when signing in to Windows."

LangString DirHeaderTitle ${LANG_RUSSIAN} "Папка установки"
LangString DirHeaderTitle ${LANG_ENGLISH} "Destination Folder"

LangString DirHeaderSub ${LANG_RUSSIAN} "Укажите каталог установки CineFlow ${APP_VERSION}"
LangString DirHeaderSub ${LANG_ENGLISH} "Choose the folder where CineFlow ${APP_VERSION} will be installed"

LangString InstHeaderTitle ${LANG_RUSSIAN} "Установка CineFlow ${APP_VERSION}"
LangString InstHeaderTitle ${LANG_ENGLISH} "Installing CineFlow ${APP_VERSION}"

LangString InstHeaderSub ${LANG_RUSSIAN} "Пожалуйста, подождите, пока файлы CineFlow копируются"
LangString InstHeaderSub ${LANG_ENGLISH} "Please wait while CineFlow ${APP_VERSION} is being installed"

LangString FinishTitle ${LANG_RUSSIAN} "Установка CineFlow ${APP_VERSION} завершена"
LangString FinishTitle ${LANG_ENGLISH} "CineFlow ${APP_VERSION} Setup Complete"

LangString FinishTitleUpgrade ${LANG_RUSSIAN} "Обновление CineFlow ${APP_VERSION} завершено"
LangString FinishTitleUpgrade ${LANG_ENGLISH} "CineFlow ${APP_VERSION} Update Complete"

LangString FinishText ${LANG_RUSSIAN} "Приложение CineFlow ${APP_VERSION} (x64) успешно установлено.$\r$\n$\r$\nРазработчик: ${APP_PUBLISHER}$\r$\nПапка: $INSTDIR$\r$\n$\r$\nНажмите «Готово», чтобы закрыть мастер установки."
LangString FinishText ${LANG_ENGLISH} "CineFlow ${APP_VERSION} (x64) has been successfully installed.$\r$\n$\r$\nDeveloper: ${APP_PUBLISHER}$\r$\nFolder: $INSTDIR$\r$\n$\r$\nClick Finish to close Setup."

LangString FinishTextUpgrade ${LANG_RUSSIAN} "Приложение CineFlow успешно обновлено с версии $InstalledVersion до ${APP_VERSION} (x64).$\r$\nВсе ваши профили, списки Kinorium и загрузки сохранены.$\r$\n$\r$\nПапка: $INSTDIR$\r$\nНажмите «Готово», чтобы закрыть мастер обновления."
LangString FinishTextUpgrade ${LANG_ENGLISH} "CineFlow has been updated from version $InstalledVersion to ${APP_VERSION} (x64).$\r$\nAll your profiles, Kinorium lists, and downloads were preserved.$\r$\n$\r$\nFolder: $INSTDIR$\r$\nClick Finish to close Setup."

LangString FinishRunText ${LANG_RUSSIAN} "Запустить CineFlow ${APP_VERSION} сейчас"
LangString FinishRunText ${LANG_ENGLISH} "Launch CineFlow ${APP_VERSION} now"

LangString MsgWin64Required ${LANG_RUSSIAN} "Для работы CineFlow ${APP_VERSION} требуется 64-разрядная версия Windows 10 или Windows 11 (x64)."
LangString MsgWin64Required ${LANG_ENGLISH} "CineFlow ${APP_VERSION} requires a 64-bit edition of Windows 10 or Windows 11 (x64)."

LangString UninstPromptKeepData ${LANG_RUSSIAN} "Сохранить ваши домашние профили, списки синхронизации Kinorium, историю просмотра и офлайн-загрузки в папке данных?$\r$\n$\r$\nНажмите «Да», чтобы сохранить личные данные для будущих обновлений, или «Нет» для полного удаления всех данных."
LangString UninstPromptKeepData ${LANG_ENGLISH} "Would you like to keep your household profiles, Kinorium sync state, watch history, and offline downloads?$\r$\n$\r$\nClick Yes to preserve your personal data for future installations, or No to delete everything completely."

LangString AppDisplayComment ${LANG_RUSSIAN} "CineFlow ${APP_VERSION} — Единый локальный онлайн-кинотеатр (Разработчик: ${APP_PUBLISHER})"
LangString AppDisplayComment ${LANG_ENGLISH} "CineFlow ${APP_VERSION} — Unified Local Cinema Hub (Developer: ${APP_PUBLISHER})"

LangString StartMenuUninstallName ${LANG_RUSSIAN} "Удалить CineFlow"
LangString StartMenuUninstallName ${LANG_ENGLISH} "Uninstall CineFlow"

; ============================================================================
; Installer Initialization, Upgrade Detection & Custom Wizard Pages
; ============================================================================
Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP|MB_OK "CineFlow ${APP_VERSION} requires 64-bit Windows 10/11 (x64).$\r$\nДля работы CineFlow ${APP_VERSION} требуется 64-разрядная Windows 10/11."
    Abort
  ${EndIf}

  StrCpy $AppLangInitialized "0"
  StrCpy $SelectedAppLang ""
  StrCpy $IsUpgradeMode "0"
  StrCpy $ExpressUpgrade "0"
  StrCpy $InstalledVersion ""

  ; Display Installer Language Selection Dialog right at the start
  !insertmacro MUI_LANGDLL_DISPLAY

  ; Detect if CineFlow is already installed on this machine
  ReadRegStr $0 HKCU "${APP_REG_KEY}" "InstallDir"
  ${If} $0 == ""
    ReadRegStr $0 HKCU "${UNINST_REG_KEY}" "InstallLocation"
  ${EndIf}
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\CineFlow.exe"
    StrCpy $INSTDIR $0
    StrCpy $IsUpgradeMode "1"
    StrCpy $ExpressUpgrade "1"
  ${ElseIf} ${FileExists} "$INSTDIR\CineFlow.exe"
    StrCpy $IsUpgradeMode "1"
    StrCpy $ExpressUpgrade "1"
  ${EndIf}

  ${If} $IsUpgradeMode == "1"
    ReadRegStr $InstalledVersion HKCU "${APP_REG_KEY}" "Version"
    ${If} $InstalledVersion == ""
      ReadRegStr $InstalledVersion HKCU "${UNINST_REG_KEY}" "DisplayVersion"
    ${EndIf}
    ${If} $InstalledVersion == ""
      StrCpy $InstalledVersion "2.5.x"
    ${EndIf}
    StrCpy $DynamicWelcomeTitle "$(WelcomeTitleUpgrade)"
    StrCpy $DynamicWelcomeText "$(WelcomeTextUpgrade)"
    StrCpy $DynamicFinishTitle "$(FinishTitleUpgrade)"
    StrCpy $DynamicFinishText "$(FinishTextUpgrade)"
  ${Else}
    StrCpy $DynamicWelcomeTitle "$(WelcomeTitle)"
    StrCpy $DynamicWelcomeText "$(WelcomeText)"
    StrCpy $DynamicFinishTitle "$(FinishTitle)"
    StrCpy $DynamicFinishText "$(FinishText)"
  ${EndIf}

  ; Read previously saved app_lang preference if upgrading, else match chosen installer language
  ReadRegStr $0 HKCU "${APP_REG_KEY}" "AppLanguage"
  ${If} $0 == "en"
  ${OrIf} $0 == "ru"
    StrCpy $SelectedAppLang $0
  ${Else}
    ${If} $LANGUAGE == ${LANG_RUSSIAN}
      StrCpy $SelectedAppLang "ru"
    ${Else}
      StrCpy $SelectedAppLang "en"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function SkipPageIfExpressUpgrade
  ${If} $IsUpgradeMode == "1"
  ${AndIf} $ExpressUpgrade == "1"
    Abort
  ${EndIf}
FunctionEnd

Function UpgradePageCreate
  ${If} $IsUpgradeMode != "1"
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "$(UpgradeHeaderTitle)" "$(UpgradeHeaderSub)"

  nsDialogs::Create 1018
  Pop $DialogUpgrade
  ${If} $DialogUpgrade == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 22u "$(UpgradeStatusInfo)"
  Pop $LabelUpgradeStatus

  ${NSD_CreateRadioButton} 4u 24u 96% 12u "$(UpgradeOptFast)"
  Pop $RadioUpgradeFast
  ${NSD_AddStyle} $RadioUpgradeFast ${WS_GROUP}

  ${NSD_CreateRadioButton} 4u 38u 96% 12u "$(UpgradeOptCustom)"
  Pop $RadioUpgradeCustom

  ${If} $ExpressUpgrade == "1"
    ${NSD_Check} $RadioUpgradeFast
  ${Else}
    ${NSD_Check} $RadioUpgradeCustom
  ${EndIf}

  ${NSD_CreateLabel} 0 54u 100% 11u "$(UpgradeNotesCaption)"
  Pop $LabelUpgradeNotes

  nsDialogs::CreateControl "EDIT" \
    ${DEFAULT_STYLES}|${WS_VSCROLL}|${WS_TABSTOP}|${ES_AUTOVSCROLL}|${ES_MULTILINE}|${ES_READONLY}|${ES_WANTRETURN} \
    ${__NSD_Text_EXSTYLE} \
    0 67u 100% 68u "$(UpgradeChangelogText)"
  Pop $EditUpgradeChangelog

  nsDialogs::Show
FunctionEnd

Function UpgradePageLeave
  ${NSD_GetState} $RadioUpgradeCustom $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $ExpressUpgrade "0"
  ${Else}
    StrCpy $ExpressUpgrade "1"
  ${EndIf}
FunctionEnd

Function AppLangPageCreate
  ${If} $IsUpgradeMode == "1"
  ${AndIf} $ExpressUpgrade == "1"
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "$(AppLangHeaderTitle)" "$(AppLangHeaderSub)"

  nsDialogs::Create 1018
  Pop $DialogAppLang
  ${If} $DialogAppLang == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 22u "$(AppLangIntro)"
  Pop $LabelAppLangIntro

  ${NSD_CreateRadioButton} 6u 26u 94% 14u "$(AppLangOptRuTitle)"
  Pop $RadioAppLangRu
  ${NSD_AddStyle} $RadioAppLangRu ${WS_GROUP}

  ${NSD_CreateLabel} 18u 42u 90% 24u "$(AppLangOptRuDesc)"
  Pop $LabelAppLangRuDesc

  ${NSD_CreateRadioButton} 6u 70u 94% 14u "$(AppLangOptEnTitle)"
  Pop $RadioAppLangEn

  ${NSD_CreateLabel} 18u 86u 90% 24u "$(AppLangOptEnDesc)"
  Pop $LabelAppLangEnDesc

  ${NSD_CreateLabel} 0 116u 100% 22u "$(AppLangFooterNote)"
  Pop $LabelAppLangFooter

  ${If} $SelectedAppLang == "en"
    ${NSD_Check} $RadioAppLangEn
  ${Else}
    ${NSD_Check} $RadioAppLangRu
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function AppLangPageLeave
  ${NSD_GetState} $RadioAppLangEn $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $SelectedAppLang "en"
  ${Else}
    StrCpy $SelectedAppLang "ru"
  ${EndIf}
FunctionEnd

; ============================================================================
; Installation Sections
; ============================================================================
Section "$(SecCoreName)" SecCore
  SectionIn RO

  ; Stop any running CineFlow processes inside target $INSTDIR before updating files
  ${If} ${FileExists} "$INSTDIR\CineFlow.exe"
    DetailPrint "Stopping running CineFlow background processes..."
    nsExec::ExecToLog '"$INSTDIR\CineFlow.exe" --stop'
  ${EndIf}

  SetOutPath "$INSTDIR"
  File /r "${STAGE_CORE_DIR}\*.*"

  ; Ensure clean user data directory exists (never overwrites user kinorium_state.json)
  CreateDirectory "$INSTDIR\data"

  ; Persist chosen Application Language (ru / en) into $INSTDIR\data\server_settings.json
  DetailPrint "Applying initial CineFlow interface language ($SelectedAppLang)..."
  nsExec::ExecToLog '"$INSTDIR\runtime\pythonw.exe" "$INSTDIR\windows\apply_install_prefs.py" --install-dir "$INSTDIR" --app-lang "$SelectedAppLang"'

  ; Save installation metadata in HKCU\Software\Atoma\CineFlow
  WriteRegStr HKCU "${APP_REG_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${APP_REG_KEY}" "Version" "${APP_VERSION}"
  WriteRegStr HKCU "${APP_REG_KEY}" "Developer" "${APP_PUBLISHER}"
  WriteRegStr HKCU "${APP_REG_KEY}" "AppLanguage" "$SelectedAppLang"

  ; Generate Uninstaller executable
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Register full metadata in Windows Apps & Features (Installed Apps)
  WriteRegStr HKCU "${UNINST_REG_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINST_REG_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINST_REG_KEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "${UNINST_REG_KEY}" "DisplayIcon" "$INSTDIR\CineFlow.exe,0"
  WriteRegStr HKCU "${UNINST_REG_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_REG_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINST_REG_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegStr HKCU "${UNINST_REG_KEY}" "Comments" "$(AppDisplayComment)"
  WriteRegDWORD HKCU "${UNINST_REG_KEY}" "VersionMajor" 2
  WriteRegDWORD HKCU "${UNINST_REG_KEY}" "VersionMinor" 6
  WriteRegDWORD HKCU "${UNINST_REG_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_REG_KEY}" "NoRepair" 1

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_REG_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "$(SecMediaName)" SecMediaEngine
  SetOutPath "$INSTDIR\backend\bin"
  File /r "${STAGE_MEDIA_DIR}\*.*"

  ; Refresh EstimatedSize after installing media engine binaries
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_REG_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "$(SecDesktopName)" SecDesktop
  SetOutPath "$INSTDIR"
  CreateShortcut "$DESKTOP\CineFlow.lnk" "$INSTDIR\CineFlow.exe" "" "$INSTDIR\CineFlow.exe" 0 SW_SHOWNORMAL "" "$(AppDisplayComment)"
SectionEnd

Section "$(SecStartMenuName)" SecStartMenu
  SetOutPath "$INSTDIR"
  CreateDirectory "$SMPROGRAMS\CineFlow"
  CreateShortcut "$SMPROGRAMS\CineFlow\CineFlow.lnk" "$INSTDIR\CineFlow.exe" "" "$INSTDIR\CineFlow.exe" 0 SW_SHOWNORMAL "" "$(AppDisplayComment)"
  CreateShortcut "$SMPROGRAMS\CineFlow\$(StartMenuUninstallName).lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\Uninstall.exe" 0
SectionEnd

Section /o "$(SecAutostartName)" SecAutostart
  WriteRegStr HKCU "${RUN_REG_KEY}" "CineFlow" '"$INSTDIR\CineFlow.exe" --background'
SectionEnd

; ============================================================================
; Interactive Component Hover Descriptions
; ============================================================================
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecCore} "$(DescSecCore)"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMediaEngine} "$(DescSecMedia)"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "$(DescSecDesktop)"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecStartMenu} "$(DescSecStartMenu)"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecAutostart} "$(DescSecAutostart)"
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ============================================================================
; Uninstaller Logic
; ============================================================================
Function un.onInit
  !insertmacro MUI_UNGETLANGUAGE
FunctionEnd

Section "Uninstall"
  ; Cleanly stop running CineFlow background server / TorrServer processes
  ${If} ${FileExists} "$INSTDIR\CineFlow.exe"
    nsExec::ExecToLog '"$INSTDIR\CineFlow.exe" --stop'
  ${EndIf}

  ; Remove shortcuts & registry entries
  Delete "$DESKTOP\CineFlow.lnk"
  RMDir /r "$SMPROGRAMS\CineFlow"
  DeleteRegValue HKCU "${RUN_REG_KEY}" "CineFlow"
  DeleteRegKey HKCU "${UNINST_REG_KEY}"
  DeleteRegKey HKCU "${APP_REG_KEY}"

  ; Remove application code, launcher, runtime, and media binaries
  Delete "$INSTDIR\CineFlow.exe"
  Delete "$INSTDIR\Uninstall.exe"
  Delete "$INSTDIR\server.py"
  Delete "$INSTDIR\README.md"
  RMDir /r "$INSTDIR\backend"
  RMDir /r "$INSTDIR\public"
  RMDir /r "$INSTDIR\runtime"
  RMDir /r "$INSTDIR\windows"

  ; Ask user whether to preserve personal data directory (unless running silent /S)
  ${IfNot} ${Silent}
    ${If} ${FileExists} "$INSTDIR\data\*.*"
      MessageBox MB_YESNO|MB_ICONQUESTION "$(UninstPromptKeepData)" IDYES KeepUserData
      RMDir /r "$INSTDIR\data"
      KeepUserData:
    ${EndIf}
  ${EndIf}

  ; Remove $INSTDIR if completely empty
  RMDir "$INSTDIR"
SectionEnd
