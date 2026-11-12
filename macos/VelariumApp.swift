import Cocoa
import WebKit
import MediaPlayer
import UserNotifications

final class NativeBridgeProxy: NSObject, WKScriptMessageHandler {
    weak var owner: VelariumAppController?
    init(owner: VelariumAppController) {
        self.owner = owner
        super.init()
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.handleScriptMessage(message)
    }
}

// MARK: - Server Daemon Supervisor

final class ServerDaemonSupervisor {
    let serverPort: Int
    let projectRoot: String
    let dataDir: String
    private(set) var serverProcess: Process?
    private(set) var spawnedServerOurselves = false

    init(serverPort: Int, projectRoot: String, dataDir: String) {
        self.serverPort = serverPort
        self.projectRoot = projectRoot
        self.dataDir = dataDir
    }

    func killStaleServerOnPort() {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/sh")
        task.arguments = ["-c", "/usr/sbin/lsof -ti tcp:\(serverPort) -sTCP:LISTEN | /usr/bin/xargs kill -TERM 2>/dev/null || true"]
        try? task.run()
        task.waitUntilExit()
    }

    func checkServerAlive(requireMatchingVersion: Bool = false, completion: @escaping (Bool, Bool) -> Void) {
        guard let url = URL(string: "http://127.0.0.1:\(serverPort)/api/system/status") else {
            completion(false, false)
            return
        }
        let expectedVer = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? ""
        var req = URLRequest(url: url)
        req.timeoutInterval = 1.0
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            if let http = resp as? HTTPURLResponse, http.statusCode == 200,
               let d = data,
               let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
               let appName = obj["app"] as? String,
               (appName == "velarium" || appName == "cineflow") {
                let runningVer = (obj["version"] as? String) ?? ""
                if requireMatchingVersion && !expectedVer.isEmpty && !runningVer.isEmpty && runningVer != expectedVer {
                    completion(false, true)
                } else {
                    completion(true, false)
                }
            } else {
                completion(false, false)
            }
        }.resume()
    }

    func ensureBackendServerRunning(onReady: @escaping () -> Void) {
        checkServerAlive(requireMatchingVersion: true) { [weak self] alive, versionMismatch in
            guard let self = self else { return }
            if alive {
                onReady()
                return
            }
            if versionMismatch {
                self.killStaleServerOnPort()
                Thread.sleep(forTimeInterval: 0.45)
            }
            self.spawnBackendServerProcess()
            self.waitForServerReady(attemptsLeft: 45, onReady: onReady)
        }
    }

    func spawnBackendServerProcess() {
        let serverScript = (projectRoot as NSString).appendingPathComponent("server.py")
        guard FileManager.default.fileExists(atPath: serverScript) else { return }

        let targetDataDir = dataDir.isEmpty ? (projectRoot as NSString).appendingPathComponent("data") : dataDir
        try? FileManager.default.createDirectory(atPath: targetDataDir, withIntermediateDirectories: true)
        let logPath = (targetDataDir as NSString).appendingPathComponent("velarium-macos.log")
        if !FileManager.default.fileExists(atPath: logPath) {
            FileManager.default.createFile(atPath: logPath, contents: nil)
        }

        let proc = Process()
        let pyCandidates = ["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"]
        let chosenPy = pyCandidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) ?? "/usr/bin/python3"
        proc.executableURL = URL(fileURLWithPath: chosenPy)
        proc.arguments = [serverScript]
        proc.currentDirectoryURL = URL(fileURLWithPath: projectRoot)

        var env = ProcessInfo.processInfo.environment
        let binDir = (projectRoot as NSString).appendingPathComponent("backend/bin")
        let curPath = env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
        env["PATH"] = "\(binDir):/opt/homebrew/bin:/usr/local/bin:\(curPath)"
        env["VELARIUM_DATA_DIR"] = targetDataDir
        env["PYTHONUNBUFFERED"] = "1"
        proc.environment = env

        let logHandle = FileHandle(forWritingAtPath: logPath)
        if let lh = logHandle {
            lh.seekToEndOfFile()
            proc.standardOutput = lh
            proc.standardError = lh
        }

        do {
            try proc.run()
            self.serverProcess = proc
            self.spawnedServerOurselves = true
        } catch {
            NSLog("[Velarium] Failed to spawn server.py: \(error)")
        }
        try? logHandle?.close()
    }

    func waitForServerReady(attemptsLeft: Int, onReady: @escaping () -> Void) {
        if attemptsLeft <= 0 {
            onReady()
            return
        }
        checkServerAlive { [weak self] alive, _ in
            if alive {
                onReady()
            } else {
                DispatchQueue.global().asyncAfter(deadline: .now() + 0.18) {
                    self?.waitForServerReady(attemptsLeft: attemptsLeft - 1, onReady: onReady)
                }
            }
        }
    }

    func stopSpawnedServerIfNeeded() {
        guard spawnedServerOurselves, let proc = serverProcess, proc.isRunning else { return }
        proc.terminate()
        self.serverProcess = nil
        self.spawnedServerOurselves = false
    }

    func restartServer(isLaunchAgentInstalled: Bool, onReady: @escaping () -> Void) {
        let hadSpawnedProc = (serverProcess != nil)
        stopSpawnedServerIfNeeded()
        if !hadSpawnedProc {
            if isLaunchAgentInstalled {
                let p = Process()
                p.executableURL = URL(fileURLWithPath: "/bin/launchctl")
                p.arguments = ["kickstart", "-k", "gui/\(getuid())/app.velarium.cinema"]
                try? p.run()
                p.waitUntilExit()

                // Also kick legacy label if present during upgrade
                let pLegacy = Process()
                pLegacy.executableURL = URL(fileURLWithPath: "/bin/launchctl")
                pLegacy.arguments = ["bootout", "gui/\(getuid())/app.cineflow.cinema"]
                try? pLegacy.run()
                pLegacy.waitUntilExit()
            } else {
                killStaleServerOnPort()
            }
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.ensureBackendServerRunning(onReady: onReady)
        }
    }
}

// MARK: - Kinorium Auth Sheet Controller

final class KinoriumAuthSheetController: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    private var kinAuthWindow: NSWindow?
    private var kinAuthWebView: WKWebView?
    private var kinAuthTimer: Timer?
    private var kinAuthFinished = false
    weak var ownerWebView: WKWebView?

    init(ownerWebView: WKWebView?) {
        self.ownerWebView = ownerWebView
        super.init()
    }

    func updateOwnerWebView(_ wv: WKWebView?) {
        self.ownerWebView = wv
    }

    func open(isEnglish: Bool) {
        if let existing = kinAuthWindow {
            existing.makeKeyAndOrderFront(nil)
            return
        }
        kinAuthFinished = false
        let rect = NSRect(x: 0, y: 0, width: 520, height: 700)
        let win = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        win.title = isEnglish ? "Sign in to Kinorium — Velarium" : "Вход в Kinorium — Velarium"
        win.appearance = NSAppearance(named: .darkAqua)
        win.backgroundColor = NSColor(calibratedRed: 0.04, green: 0.04, blue: 0.05, alpha: 1.0)
        win.titlebarAppearsTransparent = true
        win.isReleasedWhenClosed = false
        win.delegate = self
        win.center()

        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .nonPersistent()
        let wv = WKWebView(frame: rect, configuration: cfg)
        wv.autoresizingMask = [.width, .height]
        wv.navigationDelegate = self
        wv.uiDelegate = self
        win.contentView = wv

        kinAuthWindow = win
        kinAuthWebView = wv

        let startUrl = isEnglish ? "https://en.kinorium.com/#login" : "https://ru.kinorium.com/#login"
        if let u = URL(string: startUrl) {
            wv.load(URLRequest(url: u))
        }
        win.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        kinAuthTimer?.invalidate()
        kinAuthTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.probeKinoriumAuthSheet()
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript(
            "(function(){ try { if (typeof USER_ID === 'undefined' || !Number(USER_ID)) { const btn = document.querySelector('.login_window, .user_login, a[href*=\"/login\"], .header .login'); if (btn && !window.__cfKinLoginOpened) { window.__cfKinLoginOpened = true; btn.click(); } } } catch(_){} })();",
            completionHandler: nil
        )
        probeKinoriumAuthSheet()
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil {
            webView.load(navigationAction.request)
        }
        return nil
    }

    private func probeKinoriumAuthSheet() {
        guard !kinAuthFinished, let wv = kinAuthWebView else { return }
        let js = """
        (function() {
          var uid = '';
          if (typeof USER_ID !== 'undefined' && USER_ID && /^\\d+$/.test(String(USER_ID)) && Number(USER_ID) > 0) uid = String(USER_ID);
          if (!uid && typeof wsid === 'object' && wsid && /^\\d+$/.test(String(wsid.id || '')) && Number(wsid.id) > 0) uid = String(wsid.id);
          if (!uid) {
            var el = document.querySelector('a.topMenu__avatar[href*="/user/"], .user_avatar a[href*="/user/"], .header a.avatar[href*="/user/"], a.profile[href*="/user/"]');
            if (el) {
              var m = (el.getAttribute('href') || '').match(/\\/user\\/(\\d+)\\/?/);
              if (m && Number(m[1]) > 0) uid = m[1];
            }
          }
          return uid;
        })();
        """
        wv.evaluateJavaScript(js) { [weak self] res, _ in
            guard let self = self, !self.kinAuthFinished else { return }
            let domUid = (res as? String) ?? ""
            wv.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
                let validCookies = cookies.filter { c in
                    let dom = c.domain.lowercased()
                    let val = c.value.trimmingCharacters(in: .whitespacesAndNewlines)
                    return dom.contains("kinorium.") && !val.isEmpty && val.lowercased() != "deleted"
                }
                let hasAuthOrSession = validCookies.contains { $0.name == "auth" || $0.name == "session" }
                guard hasAuthOrSession else { return }
                var resolvedUid = domUid
                if resolvedUid.isEmpty || (Int(resolvedUid) ?? 0) <= 0 {
                    for c in validCookies where c.name == "auth" {
                        let decoded = c.value.removingPercentEncoding ?? c.value
                        if let data = decoded.data(using: .utf8),
                           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                            let rawId = String(describing: obj["user_id"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                            if let n = Int(rawId), n > 0 {
                                resolvedUid = String(n)
                                break
                            }
                        }
                        if let pipeIdx = decoded.firstIndex(of: "|") {
                            let cand = String(decoded[..<pipeIdx]).trimmingCharacters(in: .whitespacesAndNewlines)
                            if let n = Int(cand), n > 0 {
                                resolvedUid = String(n)
                                break
                            }
                        }
                    }
                }
                guard !resolvedUid.isEmpty, (Int(resolvedUid) ?? 0) > 0 else { return }
                var pairs: [String] = []
                var seen = Set<String>()
                for c in validCookies {
                    if !seen.contains(c.name) {
                        seen.insert(c.name)
                        pairs.append("\(c.name)=\(c.value)")
                    }
                }
                guard !pairs.isEmpty else { return }
                self.kinAuthFinished = true
                self.kinAuthTimer?.invalidate()
                self.kinAuthTimer = nil
                let cookieHeader = pairs.joined(separator: "; ")
                DispatchQueue.main.async {
                    self.kinAuthWindow?.close()
                    self.kinAuthWindow = nil
                    self.kinAuthWebView = nil
                    self.submitCapturedKinoriumSession(userId: resolvedUid, cookie: cookieHeader)
                }
            }
        }
    }

    func windowWillClose(_ notification: Notification) {
        if let w = notification.object as? NSWindow, w === kinAuthWindow {
            let wasCancelled = !kinAuthFinished
            kinAuthTimer?.invalidate()
            kinAuthTimer = nil
            kinAuthWindow = nil
            kinAuthWebView?.navigationDelegate = nil
            kinAuthWebView?.uiDelegate = nil
            kinAuthWebView = nil
            if wasCancelled {
                DispatchQueue.main.async { [weak self] in
                    self?.ownerWebView?.evaluateJavaScript(
                        "if (window.__velariumOnNativeKinoriumAuth) { window.__velariumOnNativeKinoriumAuth({ cancelled: true }); }",
                        completionHandler: nil
                    )
                }
            }
        }
    }

    private func submitCapturedKinoriumSession(userId: String, cookie: String) {
        let payload: [String: Any] = [
            "ok": true,
            "user_id": userId,
            "session_cookie": cookie
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let jsonStr = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.ownerWebView?.evaluateJavaScript(
                "if (window.__velariumOnNativeKinoriumAuth) { window.__velariumOnNativeKinoriumAuth(\(jsonStr)); }",
                completionHandler: nil
            )
        }
    }

    func closeIfOpen() {
        kinAuthTimer?.invalidate()
        kinAuthTimer = nil
        kinAuthWindow?.close()
        kinAuthWindow = nil
        kinAuthWebView?.navigationDelegate = nil
        kinAuthWebView?.uiDelegate = nil
        kinAuthWebView = nil
    }
}

final class VelariumAppController: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, UNUserNotificationCenterDelegate {
    private let serverPort: Int = 8765
    private var projectRoot: String = ""
    private var dataDir: String = ""
    private var daemonSupervisor: ServerDaemonSupervisor!
    private var kinoriumAuthSheet: KinoriumAuthSheetController?
    private var isQuitting = false
    private let startInBackground: Bool
    private var isEnglishUI: Bool = false

    private var mainWindow: NSWindow!
    private var webView: WKWebView!
    private var embeddedStreamWebView: WKWebView?
    private var embeddedStreamCurrentUrl: String = ""
    private var loadingOverlay: NSView?
    private var loadingLabel: NSTextField?
    private var statusItem: NSStatusItem!
    private var nowPlayingMenuItem: NSMenuItem!
    private var autostartMenuItem: NSMenuItem!
    private var statusOpenItem: NSMenuItem?
    private var statusPlayPauseItem: NSMenuItem?
    private var statusDownloadsItem: NSMenuItem?
    private var statusTvModeItem: NSMenuItem?
    private var statusBrowserItem: NSMenuItem?
    private var statusRestartItem: NSMenuItem?
    private var statusQuitItem: NSMenuItem?

    private var lastNowPlayingActive = false
    private var lastNowPlayingTitle = ""
    private var lastNowPlayingPlaying = false

    private var cachedArtworkUrl: String = ""
    private var cachedArtwork: MPMediaItemArtwork?
    private var downloadDestinations: [ObjectIdentifier: URL] = [:]

    init(startInBackground: Bool) {
        self.startInBackground = startInBackground
        super.init()
        let resolved = Self.resolveRuntimePaths()
        self.projectRoot = resolved.root
        self.dataDir = resolved.dataDir
        self.isEnglishUI = Self.detectSavedLanguageIsEnglish(dataDir: self.dataDir)
        self.daemonSupervisor = ServerDaemonSupervisor(
            serverPort: self.serverPort,
            projectRoot: self.projectRoot,
            dataDir: self.dataDir
        )
    }

    private func tr(_ ru: String, _ en: String) -> String {
        return isEnglishUI ? en : ru
    }

    private static func detectSavedLanguageIsEnglish(dataDir: String) -> Bool {
        let cfgPath = (dataDir as NSString).appendingPathComponent("server_settings.json")
        if let data = try? Data(contentsOf: URL(fileURLWithPath: cfgPath)),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let lang = obj["app_lang"] as? String {
            return lang.lowercased().hasPrefix("en")
        }
        let sysLang = Locale.preferredLanguages.first?.lowercased() ?? "ru"
        return sysLang.hasPrefix("en")
    }

    private static func defaultStandaloneDataDir() -> String {
        let fm = FileManager.default
        if let envData = ProcessInfo.processInfo.environment["VELARIUM_DATA_DIR"] ?? ProcessInfo.processInfo.environment["CINEFLOW_DATA_DIR"],
           !envData.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return envData
        }
        if let appSup = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
            let newDir = appSup.appendingPathComponent("Velarium/data").path
            let legacyDir = appSup.appendingPathComponent("CineFlow/data").path
            if !fm.fileExists(atPath: newDir) && fm.fileExists(atPath: legacyDir) {
                try? fm.createDirectory(atPath: appSup.appendingPathComponent("Velarium").path, withIntermediateDirectories: true)
                try? fm.moveItem(atPath: legacyDir, toPath: newDir)
            }
            return newDir
        }
        return (NSHomeDirectory() as NSString).appendingPathComponent("Library/Application Support/Velarium/data")
    }

    private static func resolveRuntimePaths() -> (root: String, dataDir: String) {
        let fm = FileManager.default
        let env = ProcessInfo.processInfo.environment
        if let envRoot = env["VELARIUM_ROOT"],
           fm.fileExists(atPath: (envRoot as NSString).appendingPathComponent("server.py")) {
            let dDir = env["VELARIUM_DATA_DIR"] ?? (envRoot as NSString).appendingPathComponent("data")
            return (envRoot, dDir)
        }
        // Check if Velarium.app sits inside a local workspace (e.g., dist/Velarium.app -> ../server.py)
        let bundlePath = Bundle.main.bundlePath
        let parent1 = (bundlePath as NSString).deletingLastPathComponent
        let parent2 = (parent1 as NSString).deletingLastPathComponent
        for cand in [parent1, parent2] {
            if fm.fileExists(atPath: (cand as NSString).appendingPathComponent("server.py")) {
                let dDir = env["VELARIUM_DATA_DIR"] ?? (cand as NSString).appendingPathComponent("data")
                return (cand, dDir)
            }
        }
        // Self-contained standalone macOS bundle (Contents/Resources/app/server.py)
        if let resPath = Bundle.main.resourcePath {
            let bundledAppDir = (resPath as NSString).appendingPathComponent("app")
            if fm.fileExists(atPath: (bundledAppDir as NSString).appendingPathComponent("server.py")) {
                return (bundledAppDir, defaultStandaloneDataDir())
            }
            let ptrFile = (resPath as NSString).appendingPathComponent("project_root.txt")
            if let saved = try? String(contentsOfFile: ptrFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
               !saved.isEmpty,
               fm.fileExists(atPath: (saved as NSString).appendingPathComponent("server.py")) {
                let dDir = env["VELARIUM_DATA_DIR"] ?? (saved as NSString).appendingPathComponent("data")
                return (saved, dDir)
            }
        }
        let cwd = fm.currentDirectoryPath
        return (cwd, env["VELARIUM_DATA_DIR"] ?? (cwd as NSString).appendingPathComponent("data"))
    }

    private func loadReleaseNotesMarkdown(currentVer: String) -> String {
        let fallbackRu = """
        **Что нового в Velarium \(currentVer):**
        • **Живой Markdown-список изменений в установщике и приложении**: окно обновления `.dmg` на macOS, мастер установки Windows и вкладка «О программе» теперь отображают актуальный форматированный список изменений из `RELEASE_NOTES.md`.
        • **Бесшовное обновление по воздуху (OTA) в 1 клик**: автоматическая проверка новых релизов на GitHub, фоновая загрузка с проверкой контрольной суммы `SHA-256`, автоматическая замена старого фонового процесса `server.py` на порту `8765` и установка новой версии в `/Applications/Velarium.app` в 1 клик.
        • **Защита от блокировки IP на Кинориуме (`403 Forbidden`)**: добавлен умный ограничитель частоты запросов (Rate Limiter) и автоматический предохранитель при временных блокировках, исключающий перегрузку серверов Кинориума фоновыми проверками старых сериалов.
        • **Гарантированная доотправка отметок и оценок**: все отметки просмотров фильмов, сериалов и оценки эпизодов, поставленные во время офлайна или временной блокировки сети, автоматически доотправляются в ваш профиль Кинориума при восстановлении связи.
        • **Точное определение актёров «В кадре» (X-Ray)** и мгновенный запуск локального сервера.
        """
        let fallbackEn = """
        **What's new in Velarium \(currentVer):**
        • **Live Markdown Release Notes in Installer & App**: the macOS `.dmg` upgrade dialog, Windows setup wizard, and the in-app "About" updater card now render formatted release notes directly from `RELEASE_NOTES.md`.
        • **Seamless 1-Click Over-The-Air (OTA) Updates**: automatic release checks via GitHub, background installer download with `SHA-256` verification, automatic replacement of stale `server.py` processes on port `8765`, and 1-click installation into `/Applications/Velarium.app`.
        • **Kinorium IP Ban Protection (`403 Forbidden`)**: smart request rate limiter and automatic 10-minute circuit breaker preventing background episode sync storms across historical series.
        • **Guaranteed Offline & Unblock Resync**: all watched marks and episode ratings made while offline or during a temporary IP block are automatically pushed to your Kinorium profile once connectivity is restored.
        • **Accurate "In Scene" (X-Ray) Cast Detection** and instant local server startup.
        """
        var candidates: [String] = []
        if let resPath = Bundle.main.path(forResource: "RELEASE_NOTES", ofType: "md") {
            candidates.append(resPath)
        }
        candidates.append((projectRoot as NSString).appendingPathComponent("RELEASE_NOTES.md"))
        for path in candidates {
            if let raw = try? String(contentsOfFile: path, encoding: .utf8), !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                let parts = raw.components(separatedBy: "<!-- EN -->")
                if parts.count >= 2 {
                    let ruPart = parts[0].trimmingCharacters(in: .whitespacesAndNewlines)
                    let enPart = parts[1].trimmingCharacters(in: .whitespacesAndNewlines)
                    return tr(ruPart.isEmpty ? fallbackRu : ruPart, enPart.isEmpty ? fallbackEn : enPart)
                }
                return raw.trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        return tr(fallbackRu, fallbackEn)
    }

    private func formatMarkdownForTextView(_ markdown: String) -> NSAttributedString {
        let result = NSMutableAttributedString()
        let baseFont = NSFont.systemFont(ofSize: 12.0)
        let boldFont = NSFont.boldSystemFont(ofSize: 12.0)
        let codeFont = NSFont.monospacedSystemFont(ofSize: 11.5, weight: .medium)
        let paraStyle = NSMutableParagraphStyle()
        paraStyle.lineSpacing = 3.0
        paraStyle.paragraphSpacing = 5.0

        let lines = markdown.components(separatedBy: .newlines)
        for (lineIdx, rawLine) in lines.enumerated() {
            var line = rawLine
            if line.hasPrefix("### ") { line = String(line.dropFirst(4)) }
            else if line.hasPrefix("## ") { line = String(line.dropFirst(3)) }
            else if line.hasPrefix("# ") { line = String(line.dropFirst(2)) }

            let lineAttr = NSMutableAttributedString()
            var cursor = line.startIndex
            while cursor < line.endIndex {
                if line[cursor...].hasPrefix("**"),
                   let closeRange = line.range(of: "**", range: line.index(cursor, offsetBy: 2)..<line.endIndex) {
                    let inner = String(line[line.index(cursor, offsetBy: 2)..<closeRange.lowerBound])
                    lineAttr.append(NSAttributedString(string: inner, attributes: [
                        .font: boldFont,
                        .foregroundColor: NSColor.labelColor,
                        .paragraphStyle: paraStyle
                    ]))
                    cursor = closeRange.upperBound
                } else if line[cursor] == "`",
                          let closeTick = line[line.index(after: cursor)...].firstIndex(of: "`") {
                    let inner = String(line[line.index(after: cursor)..<closeTick])
                    lineAttr.append(NSAttributedString(string: inner, attributes: [
                        .font: codeFont,
                        .foregroundColor: NSColor.labelColor,
                        .paragraphStyle: paraStyle
                    ]))
                    cursor = line.index(after: closeTick)
                } else {
                    let ch = String(line[cursor])
                    lineAttr.append(NSAttributedString(string: ch, attributes: [
                        .font: baseFont,
                        .foregroundColor: NSColor.labelColor,
                        .paragraphStyle: paraStyle
                    ]))
                    cursor = line.index(after: cursor)
                }
            }
            result.append(lineAttr)
            if lineIdx < lines.count - 1 {
                result.append(NSAttributedString(string: "\n", attributes: [
                    .font: baseFont,
                    .paragraphStyle: paraStyle
                ]))
            }
        }
        return result
    }

    private func checkAndOfferApplicationsUpgradeIfNeeded() -> Bool {
        if startInBackground { return false }
        let fm = FileManager.default
        let currentBundlePath = (Bundle.main.bundlePath as NSString).standardizingPath
        let targetAppPath = "/Applications/Velarium.app"
        let legacyAppPath = "/Applications/CineFlow.app"
        if currentBundlePath == targetAppPath { return false }
        // Only prompt when launched from mounted DMG (/Volumes/...) or Downloads
        let isFromDmgOrDownloads = currentBundlePath.hasPrefix("/Volumes/") || currentBundlePath.contains("/Downloads/")
        if !isFromDmgOrDownloads { return false }
        let existingPath = fm.fileExists(atPath: targetAppPath) ? targetAppPath : (fm.fileExists(atPath: legacyAppPath) ? legacyAppPath : "")
        guard !existingPath.isEmpty else { return false }

        let currentVer = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "2.7.17"
        var installedVer = "2.5.x"
        let targetPlistPath = (existingPath as NSString).appendingPathComponent("Contents/Info.plist")
        if let plistData = try? Data(contentsOf: URL(fileURLWithPath: targetPlistPath)),
           let plistObj = try? PropertyListSerialization.propertyList(from: plistData, options: [], format: nil) as? [String: Any],
           let ver = plistObj["CFBundleShortVersionString"] as? String, !ver.isEmpty {
            installedVer = ver
        }

        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = tr(
            "Обнаружена установленная версия Velarium (\(installedVer))",
            "Installed Velarium (\(installedVer)) Detected"
        )
        alert.informativeText = tr(
            "Хотите обновить установленное приложение Velarium в папке /Applications до версии \(currentVer)? Все ваши профили, списки Kinorium, история просмотра и загрузки сохранятся.",
            "Would you like to update Velarium in /Applications to version \(currentVer)? All your profiles, Kinorium lists, watch history, and downloads will be preserved."
        )
        alert.addButton(withTitle: tr("Обновить до \(currentVer)", "Update to \(currentVer)"))
        alert.addButton(withTitle: tr("Запустить без обновления", "Run Without Updating"))

        let rawMd = loadReleaseNotesMarkdown(currentVer: currentVer)
        let scrollView = NSScrollView(frame: NSRect(x: 0, y: 0, width: 460, height: 185))
        scrollView.hasVerticalScroller = true
        scrollView.borderType = .bezelBorder
        let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: 440, height: 185))
        textView.isEditable = false
        textView.isSelectable = true
        textView.textContainerInset = NSSize(width: 8, height: 8)
        let attrMd = formatMarkdownForTextView(rawMd)
        if let storage = textView.textStorage {
            storage.setAttributedString(attrMd)
        } else {
            textView.string = rawMd
        }
        scrollView.documentView = textView
        alert.accessoryView = scrollView

        NSApp.activate(ignoringOtherApps: true)
        let resp = alert.runModal()
        if resp == .alertFirstButtonReturn {
            do {
                daemonSupervisor.killStaleServerOnPort()
                for procPattern in ["/Applications/Velarium.app/Contents/", "/Applications/CineFlow.app/Contents/"] {
                    let killTask = Process()
                    killTask.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
                    killTask.arguments = ["-f", procPattern]
                    try? killTask.run()
                    killTask.waitUntilExit()
                }
                Thread.sleep(forTimeInterval: 0.5)

                let stageAppPath = "/Applications/.Velarium.app.new.\(ProcessInfo.processInfo.processIdentifier)"
                let backupAppPath = "/Applications/.Velarium.app.old.\(ProcessInfo.processInfo.processIdentifier)"
                if fm.fileExists(atPath: stageAppPath) {
                    try? fm.removeItem(atPath: stageAppPath)
                }
                let dittoTask = Process()
                dittoTask.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
                dittoTask.arguments = [currentBundlePath, stageAppPath]
                try dittoTask.run()
                dittoTask.waitUntilExit()
                if dittoTask.terminationStatus != 0 {
                    try? fm.removeItem(atPath: stageAppPath)
                    throw NSError(domain: "VelariumUpgrade", code: Int(dittoTask.terminationStatus), userInfo: [
                        NSLocalizedDescriptionKey: "ditto failed with exit code \(dittoTask.terminationStatus)"
                    ])
                }
                let xattrTask = Process()
                xattrTask.executableURL = URL(fileURLWithPath: "/usr/bin/xattr")
                xattrTask.arguments = ["-cr", stageAppPath]
                try? xattrTask.run()
                xattrTask.waitUntilExit()

                if fm.fileExists(atPath: backupAppPath) {
                    try? fm.removeItem(atPath: backupAppPath)
                }
                if fm.fileExists(atPath: targetAppPath) {
                    try fm.moveItem(atPath: targetAppPath, toPath: backupAppPath)
                }
                if fm.fileExists(atPath: legacyAppPath) {
                    try? fm.removeItem(atPath: legacyAppPath)
                }
                do {
                    try fm.moveItem(atPath: stageAppPath, toPath: targetAppPath)
                    if fm.fileExists(atPath: backupAppPath) {
                        try? fm.removeItem(atPath: backupAppPath)
                    }
                } catch {
                    if fm.fileExists(atPath: backupAppPath) && !fm.fileExists(atPath: targetAppPath) {
                        try? fm.moveItem(atPath: backupAppPath, toPath: targetAppPath)
                    }
                    try? fm.removeItem(atPath: stageAppPath)
                    throw error
                }
                NSWorkspace.shared.openApplication(
                    at: URL(fileURLWithPath: targetAppPath),
                    configuration: NSWorkspace.OpenConfiguration(),
                    completionHandler: nil
                )
                NSApp.terminate(nil)
                return true
            } catch {
                let errAlert = NSAlert()
                errAlert.alertStyle = .warning
                errAlert.messageText = tr("Не удалось обновить /Applications/Velarium.app", "Could not update /Applications/Velarium.app")
                errAlert.informativeText = error.localizedDescription
                errAlert.runModal()
            }
        }
        return false
    }

    private func relocateLegacyApplicationBundleIfNeeded() -> Bool {
        let fm = FileManager.default
        let currentBundlePath = (Bundle.main.bundlePath as NSString).standardizingPath
        let legacyAppPath = "/Applications/CineFlow.app"
        let targetAppPath = "/Applications/Velarium.app"
        guard currentBundlePath == legacyAppPath else { return false }

        _ = Self.defaultStandaloneDataDir()
        do {
            if fm.fileExists(atPath: targetAppPath) {
                try? fm.removeItem(atPath: targetAppPath)
            }
            try fm.moveItem(atPath: legacyAppPath, toPath: targetAppPath)
            let chflagsTask = Process()
            chflagsTask.executableURL = URL(fileURLWithPath: "/usr/bin/chflags")
            chflagsTask.arguments = ["nohidden", targetAppPath]
            try? chflagsTask.run()
            chflagsTask.waitUntilExit()

            let xattrTask = Process()
            xattrTask.executableURL = URL(fileURLWithPath: "/usr/bin/xattr")
            xattrTask.arguments = ["-cr", targetAppPath]
            try? xattrTask.run()
            xattrTask.waitUntilExit()

            NSWorkspace.shared.openApplication(
                at: URL(fileURLWithPath: targetAppPath),
                configuration: NSWorkspace.OpenConfiguration(),
                completionHandler: nil
            )
            NSApp.terminate(nil)
            return true
        } catch {
            NSLog("[Velarium] Could not auto-relocate /Applications/CineFlow.app to /Applications/Velarium.app: \(error)")
            return false
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if relocateLegacyApplicationBundleIfNeeded() {
            return
        }
        NSApp.setActivationPolicy(startInBackground ? .accessory : .regular)
        if checkAndOfferApplicationsUpgradeIfNeeded() {
            return
        }
        if Bundle.main.bundleIdentifier != nil {
            UNUserNotificationCenter.current().delegate = self
        }
        setupApplicationMenu()
        setupStatusBarMenu()
        setupMainWindow()
        setupMediaRemoteCommands()

        ensureBackendServerRunning { [weak self] in
            DispatchQueue.main.async {
                self?.loadVelariumUI()
            }
        }

        if !startInBackground {
            showMainWindow()
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showMainWindow()
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        isQuitting = true
        closeEmbeddedStreamWebView()
        kinoriumAuthSheet?.closeIfOpen()
        stopSpawnedServerIfNeeded()
    }

    // MARK: - Menus & Status Bar

    private func setupApplicationMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        let aboutItem = NSMenuItem(title: tr("О программе Velarium", "About Velarium"), action: #selector(openAboutFromMenu), keyEquivalent: "")
        aboutItem.target = self
        appMenu.addItem(aboutItem)
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: tr("Настройки…", "Settings…"), action: #selector(openSettingsFromMenu), keyEquivalent: ",")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: tr("Скрыть Velarium", "Hide Velarium"), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: tr("Выйти из Velarium", "Quit Velarium"), action: #selector(quitAppCompletely), keyEquivalent: "q")
        appMenuItem.submenu = appMenu

        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: tr("Правка", "Edit"))
        editMenu.addItem(withTitle: tr("Отменить", "Undo"), action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: tr("Повторить", "Redo"), action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: tr("Вырезать", "Cut"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: tr("Копировать", "Copy"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: tr("Вставить", "Paste"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: tr("Выбрать все", "Select All"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu

        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: tr("Вид", "View"))
        viewMenu.addItem(withTitle: tr("Палитра команд и поиск…", "Command Palette & Search…"), action: #selector(openCommandPaletteFromMenu), keyEquivalent: "k")
        let rouletteItem = NSMenuItem(title: tr("Что посмотреть? (Рулетка)", "What to Watch? (Roulette)"), action: #selector(openRouletteFromMenu), keyEquivalent: "r")
        rouletteItem.keyEquivalentModifierMask = [.command, .shift]
        viewMenu.addItem(rouletteItem)
        viewMenu.addItem(withTitle: tr("Статистика и история", "Statistics & Watch History"), action: #selector(openStatsFromMenu), keyEquivalent: "y")
        viewMenu.addItem(NSMenuItem.separator())
        viewMenu.addItem(withTitle: tr("Обновить страницу", "Reload Page"), action: #selector(reloadWebView), keyEquivalent: "r")
        viewMenu.addItem(withTitle: tr("Режим ТВ (TV Mode)", "TV Mode"), action: #selector(toggleTvModeFromMenu), keyEquivalent: "t")
        viewMenu.addItem(withTitle: tr("Офлайн-загрузки", "Offline Downloads"), action: #selector(openDownloadsFromMenu), keyEquivalent: "j")
        viewMenu.addItem(NSMenuItem.separator())
        let fullScreenItem = NSMenuItem(title: tr("Полный экран", "Enter Full Screen"), action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreenItem.keyEquivalentModifierMask = [.control, .command]
        viewMenu.addItem(fullScreenItem)
        viewMenuItem.submenu = viewMenu

        let windowMenuItem = NSMenuItem()
        mainMenu.addItem(windowMenuItem)
        let windowMenu = NSMenu(title: tr("Окно", "Window"))
        windowMenu.addItem(withTitle: tr("Свернуть", "Minimize"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: tr("Закрыть в строку меню", "Close to Menu Bar"), action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenuItem.submenu = windowMenu

        NSApp.mainMenu = mainMenu
    }

    private func setupStatusBarMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let btn = statusItem.button {
            if #available(macOS 11.0, *), let img = NSImage(systemSymbolName: "play.tv.fill", accessibilityDescription: "Velarium") {
                img.isTemplate = true
                btn.image = img
            } else {
                btn.title = "VL"
            }
            btn.toolTip = tr("Velarium — Домашний кинотеатр", "Velarium — Unified Home Cinema")
        }

        let menu = NSMenu()
        nowPlayingMenuItem = NSMenuItem(title: tr("Velarium • Сервер активен", "Velarium • Server Active"), action: nil, keyEquivalent: "")
        nowPlayingMenuItem.isEnabled = false
        menu.addItem(nowPlayingMenuItem)
        menu.addItem(NSMenuItem.separator())

        let openItem = NSMenuItem(title: tr("Открыть Velarium", "Open Velarium"), action: #selector(showMainWindow), keyEquivalent: "o")
        openItem.target = self
        menu.addItem(openItem)
        statusOpenItem = openItem

        let playPauseItem = NSMenuItem(title: tr("Воспроизведение / Пауза", "Play / Pause"), action: #selector(togglePlayPauseFromMenu), keyEquivalent: "")
        playPauseItem.target = self
        menu.addItem(playPauseItem)
        statusPlayPauseItem = playPauseItem

        let dlItem = NSMenuItem(title: tr("Офлайн-загрузки («Скачать в дорогу»)", "Offline Downloads"), action: #selector(openDownloadsFromMenu), keyEquivalent: "")
        dlItem.target = self
        menu.addItem(dlItem)
        statusDownloadsItem = dlItem

        let tvItem = NSMenuItem(title: tr("Переключить режим ТВ (TV Mode)", "Toggle TV Mode"), action: #selector(toggleTvModeFromMenu), keyEquivalent: "")
        tvItem.target = self
        menu.addItem(tvItem)
        statusTvModeItem = tvItem

        let browserItem = NSMenuItem(title: tr("Открыть в браузере", "Open in Default Browser"), action: #selector(openInDefaultBrowser), keyEquivalent: "")
        browserItem.target = self
        menu.addItem(browserItem)
        statusBrowserItem = browserItem

        menu.addItem(NSMenuItem.separator())

        autostartMenuItem = NSMenuItem(title: tr("Запускать при входе в macOS", "Launch at macOS Login"), action: #selector(toggleLaunchAtLogin), keyEquivalent: "")
        autostartMenuItem.target = self
        autostartMenuItem.state = isLaunchAgentInstalled() ? .on : .off
        menu.addItem(autostartMenuItem)

        let restartSrvItem = NSMenuItem(title: tr("Перезапустить фоновый сервер", "Restart Background Server"), action: #selector(restartBackendServer), keyEquivalent: "")
        restartSrvItem.target = self
        menu.addItem(restartSrvItem)
        statusRestartItem = restartSrvItem

        menu.addItem(NSMenuItem.separator())

        let quitItem = NSMenuItem(title: tr("Выйти из Velarium", "Quit Velarium"), action: #selector(quitAppCompletely), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)
        statusQuitItem = quitItem

        statusItem.menu = menu
    }

    private func refreshLocalizedMenus() {
        setupApplicationMenu()
        statusItem?.button?.toolTip = tr("Velarium — Домашний кинотеатр", "Velarium — Unified Home Cinema")
        statusOpenItem?.title = tr("Открыть Velarium", "Open Velarium")
        statusPlayPauseItem?.title = tr("Воспроизведение / Пауза", "Play / Pause")
        statusDownloadsItem?.title = tr("Офлайн-загрузки («Скачать в дорогу»)", "Offline Downloads")
        statusTvModeItem?.title = tr("Переключить режим ТВ (TV Mode)", "Toggle TV Mode")
        statusBrowserItem?.title = tr("Открыть в браузере", "Open in Default Browser")
        autostartMenuItem?.title = tr("Запускать при входе в macOS", "Launch at macOS Login")
        statusRestartItem?.title = tr("Перезапустить фоновый сервер", "Restart Background Server")
        statusQuitItem?.title = tr("Выйти из Velarium", "Quit Velarium")
        loadingLabel?.stringValue = tr("Velarium • Запуск домашнего кинотеатра…", "Velarium • Starting Home Cinema…")
        refreshNowPlayingMenuTitle()
    }

    private func refreshNowPlayingMenuTitle() {
        guard let item = nowPlayingMenuItem else { return }
        if !lastNowPlayingActive || lastNowPlayingTitle.isEmpty {
            item.title = tr("Velarium • Сервер активен", "Velarium • Server Active")
            return
        }
        let statePrefix = lastNowPlayingPlaying ? tr("Смотрит", "Playing") : tr("Пауза", "Paused")
        let shortTitle = lastNowPlayingTitle.count > 34 ? String(lastNowPlayingTitle.prefix(34)) + "…" : lastNowPlayingTitle
        item.title = "\(statePrefix): \(shortTitle)"
    }

    // MARK: - Main WKWebView Window

    private func setupMainWindow() {
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let targetW = min(1480.0, max(1024.0, screenFrame.width * 0.90))
        let targetH = min(920.0, max(680.0, screenFrame.height * 0.88))
        let winRect = NSRect(x: 0, y: 0, width: targetW, height: targetH)

        mainWindow = NSWindow(
            contentRect: winRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        mainWindow.title = "Velarium"
        mainWindow.minSize = NSSize(width: 920, height: 600)
        mainWindow.appearance = NSAppearance(named: .darkAqua)
        mainWindow.backgroundColor = NSColor(calibratedRed: 0.04, green: 0.04, blue: 0.05, alpha: 1.0)
        mainWindow.titlebarAppearsTransparent = true
        mainWindow.collectionBehavior = [.fullScreenPrimary]
        mainWindow.delegate = self
        mainWindow.center()

        let contentController = WKUserContentController()
        let bridge = NativeBridgeProxy(owner: self)
        contentController.add(bridge, name: "velariumNative")

        let bootScript = WKUserScript(
            source: "window.__VELARIUM_MACOS_APP__ = true;",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        contentController.addUserScript(bootScript)

        let config = WKWebViewConfiguration()
        config.userContentController = contentController
        config.websiteDataStore = .default()
        config.allowsAirPlayForMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.setValue(true, forKey: "allowsPictureInPictureMediaPlayback")
        if #available(macOS 12.3, *) {
            config.preferences.isElementFullscreenEnabled = true
        }

        let rootView = NSView(frame: winRect)
        rootView.autoresizingMask = [.width, .height]

        webView = WKWebView(frame: winRect, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }

        let overlay = NSView(frame: winRect)
        overlay.autoresizingMask = [.width, .height]
        overlay.wantsLayer = true
        overlay.layer?.backgroundColor = NSColor(calibratedRed: 0.04, green: 0.04, blue: 0.05, alpha: 1.0).cgColor
        let lbl = NSTextField(labelWithString: tr("Velarium • Запуск домашнего кинотеатра…", "Velarium • Starting Home Cinema…"))
        lbl.font = NSFont.systemFont(ofSize: 16, weight: .semibold)
        lbl.textColor = NSColor(calibratedWhite: 0.85, alpha: 1.0)
        lbl.alignment = .center
        lbl.frame = NSRect(x: 0, y: (targetH / 2.0) - 14.0, width: targetW, height: 28.0)
        lbl.autoresizingMask = [.width, .minYMargin, .maxYMargin]
        overlay.addSubview(lbl)
        loadingLabel = lbl
        loadingOverlay = overlay

        rootView.addSubview(webView)
        rootView.addSubview(overlay)
        mainWindow.contentView = rootView

        kinoriumAuthSheet = KinoriumAuthSheetController(ownerWebView: webView)
    }

    @objc private func showMainWindow() {
        if NSApp.activationPolicy() != .regular {
            NSApp.setActivationPolicy(.regular)
        }
        mainWindow.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if sender === mainWindow && !isQuitting {
            embeddedStreamWebView?.evaluateJavaScript(
                "try { document.querySelectorAll('video,audio').forEach(m => m.pause()); } catch(_){}",
                completionHandler: nil
            )
            webView?.evaluateJavaScript(
                "(function(){ try { const v = document.getElementById('video-player') || document.getElementById('native-video'); if (v && !v.paused && !document.pictureInPictureElement && v.webkitPresentationMode !== 'picture-in-picture') { v.pause(); } } catch(_){} })();",
                completionHandler: nil
            )
            mainWindow.orderOut(nil)
            return false
        }
        return true
    }

    func windowDidEnterFullScreen(_ notification: Notification) {
        webView?.evaluateJavaScript("try { window.dispatchEvent(new Event('resize')); } catch(_){}", completionHandler: nil)
    }

    func windowDidExitFullScreen(_ notification: Notification) {
        webView?.evaluateJavaScript(
            "(function(){ try { const st = document.getElementById('video-stage'); if (st) st.classList.remove('is-stage-pseudo-fullscreen', 'is-pseudo-fullscreen'); document.documentElement.classList.remove('is-stage-pseudo-fullscreen', 'is-stage-fullscreen', 'vc-fs-cursor-none'); document.body.classList.remove('is-stage-pseudo-fullscreen-body'); window.dispatchEvent(new Event('resize')); } catch(_){} })();",
            completionHandler: nil
        )
    }

    private func loadVelariumUI() {
        guard let url = URL(string: "http://127.0.0.1:\(serverPort)/") else { return }
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView === self.webView {
            loadingOverlay?.removeFromSuperview()
            loadingOverlay = nil
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if webView === embeddedStreamWebView, navigationAction.targetFrame == nil {
            if let targetUrl = navigationAction.request.url,
               let scheme = targetUrl.scheme?.lowercased(),
               (scheme == "https" || scheme == "http") {
                webView.load(navigationAction.request)
            }
            return nil
        }
        if let targetUrl = navigationAction.request.url,
           let scheme = targetUrl.scheme?.lowercased(),
           (scheme == "https" || scheme == "http") {
            NSWorkspace.shared.open(targetUrl)
        }
        return nil
    }

    // MARK: - WKDownloadDelegate (<a download> MP4, PNG Snapshot & JSON Backup Export)

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, preferences: WKWebpagePreferences, decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        if let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() {
            let webSchemes: Set<String> = ["http", "https", "blob", "about", "data"]
            if !webSchemes.contains(scheme) {
                if webView === self.webView,
                   navigationAction.navigationType == .linkActivated,
                   scheme == "mailto" {
                    NSWorkspace.shared.open(url)
                }
                decisionHandler(.cancel, preferences)
                return
            }
        }
        if webView === self.webView && navigationAction.shouldPerformDownload {
            decisionHandler(.download, preferences)
            return
        }
        if webView === self.webView, let url = navigationAction.request.url {
            if navigationAction.targetFrame?.isMainFrame == true,
               let scheme = url.scheme?.lowercased(),
               (scheme == "http" || scheme == "https") {
                let host = (url.host ?? "").lowercased()
                let isLocalBackend = (host == "127.0.0.1" || host == "localhost") && (url.port == nil || url.port == serverPort)
                if !isLocalBackend {
                    NSWorkspace.shared.open(url)
                    decisionHandler(.cancel, preferences)
                    return
                }
            }
            let path = url.path
            let query = url.query ?? ""
            if url.scheme == "blob" || path.hasPrefix("/api/download-mp4") || query.contains("download=1") {
                decisionHandler(.download, preferences)
                return
            }
        }
        decisionHandler(.allow, preferences)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard webView === self.webView else {
            decisionHandler(.allow)
            return
        }
        if let http = navigationResponse.response as? HTTPURLResponse {
            let disp = (http.value(forHTTPHeaderField: "Content-Disposition") ?? "").lowercased()
            if disp.contains("attachment") {
                decisionHandler(.download)
                return
            }
        }
        if navigationResponse.isForMainFrame && !navigationResponse.canShowMIMEType {
            decisionHandler(.download)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let fm = FileManager.default
        let downloadsDir = fm.urls(for: .downloadsDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: (NSHomeDirectory() as NSString).appendingPathComponent("Downloads"))
        try? fm.createDirectory(at: downloadsDir, withIntermediateDirectories: true)

        let rawName = suggestedFilename.trimmingCharacters(in: .whitespacesAndNewlines)
        let safeBase = (rawName.isEmpty ? "Velarium-Export" : rawName)
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
        let ext = (safeBase as NSString).pathExtension
        let stem = ext.isEmpty ? safeBase : (safeBase as NSString).deletingPathExtension

        var candidate = downloadsDir.appendingPathComponent(safeBase)
        var counter = 1
        while fm.fileExists(atPath: candidate.path) {
            let numbered = ext.isEmpty ? "\(stem) (\(counter))" : "\(stem) (\(counter)).\(ext)"
            candidate = downloadsDir.appendingPathComponent(numbered)
            counter += 1
        }
        downloadDestinations[ObjectIdentifier(download)] = candidate
        completionHandler(candidate)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let savedURL = downloadDestinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let fileName = savedURL.lastPathComponent
        let msg = tr("Сохранено в папку «Загрузки»: \(fileName)", "Saved to Downloads: \(fileName)")
        if let msgData = try? JSONSerialization.data(withJSONObject: [msg]),
           let msgArr = String(data: msgData, encoding: .utf8) {
            DispatchQueue.main.async { [weak self] in
                self?.webView?.evaluateJavaScript(
                    "(function(m){ try { const el = document.getElementById('toast-container'); if (el) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m[0]; el.appendChild(t); setTimeout(() => t.remove(), 3600); } } catch(_){} })(\(msgArr));",
                    completionHandler: nil
                )
            }
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadDestinations.removeValue(forKey: ObjectIdentifier(download))
    }

    // MARK: - Backend Daemon Management

    private func ensureBackendServerRunning(onReady: @escaping () -> Void) {
        daemonSupervisor.ensureBackendServerRunning(onReady: onReady)
    }

    private func stopSpawnedServerIfNeeded() {
        daemonSupervisor.stopSpawnedServerIfNeeded()
    }

    // MARK: - Media Keys & Control Center Now Playing

    private func setupMediaRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.isEnabled = true
        center.playCommand.addTarget { [weak self] _ in
            self?.dispatchPlayerCommand("play")
            return .success
        }

        center.pauseCommand.isEnabled = true
        center.pauseCommand.addTarget { [weak self] _ in
            self?.dispatchPlayerCommand("pause")
            return .success
        }

        center.togglePlayPauseCommand.isEnabled = true
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.dispatchPlayerCommand("togglePlayPause")
            return .success
        }

        center.nextTrackCommand.isEnabled = true
        center.nextTrackCommand.addTarget { [weak self] _ in
            self?.dispatchPlayerCommand("nextTrack")
            return .success
        }

        center.previousTrackCommand.isEnabled = true
        center.previousTrackCommand.addTarget { [weak self] _ in
            self?.dispatchPlayerCommand("prevTrack")
            return .success
        }

        center.skipForwardCommand.isEnabled = true
        center.skipForwardCommand.preferredIntervals = [10]
        center.skipForwardCommand.addTarget { [weak self] _ in
            self?.dispatchPlayerCommand("skipForward", value: 10.0)
            return .success
        }

        center.skipBackwardCommand.isEnabled = true
        center.skipBackwardCommand.preferredIntervals = [10]
        center.skipBackwardCommand.addTarget { [weak self] _ in
            self?.dispatchPlayerCommand("skipBackward", value: 10.0)
            return .success
        }

        center.changePlaybackPositionCommand.isEnabled = true
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            if let posEv = event as? MPChangePlaybackPositionCommandEvent {
                self?.dispatchPlayerCommand("seekTo", value: posEv.positionTime)
                return .success
            }
            return .commandFailed
        }
    }

    private func dispatchPlayerCommand(_ cmd: String, value: Double = 0.0) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let wv = self.webView else { return }
            guard let argsData = try? JSONSerialization.data(withJSONObject: [cmd, value]),
                  let argsJson = String(data: argsData, encoding: .utf8) else { return }
            let js = "if (window.__velariumHandleNativeMediaCommand) { window.__velariumHandleNativeMediaCommand.apply(null, \(argsJson)); }"
            wv.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func updateNowPlaying(from payload: [String: Any]) {
        let active = (payload["active"] as? Bool) ?? true
        if !active {
            lastNowPlayingActive = false
            lastNowPlayingTitle = ""
            lastNowPlayingPlaying = false
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            if #available(macOS 10.13, *) {
                MPNowPlayingInfoCenter.default().playbackState = .stopped
            }
            refreshNowPlayingMenuTitle()
            return
        }

        let title = (payload["title"] as? String) ?? "Velarium"
        let subtitle = (payload["subtitle"] as? String) ?? ""
        let duration = (payload["duration"] as? Double) ?? 0.0
        let currentTime = (payload["currentTime"] as? Double) ?? 0.0
        let isPlaying = (payload["playing"] as? Bool) ?? false
        let rate = (payload["playbackRate"] as? Double) ?? 1.0
        let posterUrl = (payload["poster"] as? String) ?? ""

        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: subtitle.isEmpty ? "Velarium" : subtitle,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: currentTime,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? rate : 0.0
        ]
        if duration > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = duration
        }
        if let art = cachedArtwork, cachedArtworkUrl == posterUrl {
            info[MPMediaItemPropertyArtwork] = art
        }

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        if #available(macOS 10.13, *) {
            MPNowPlayingInfoCenter.default().playbackState = isPlaying ? .playing : .paused
        }

        lastNowPlayingActive = true
        lastNowPlayingTitle = title
        lastNowPlayingPlaying = isPlaying
        refreshNowPlayingMenuTitle()

        if !posterUrl.isEmpty && posterUrl != cachedArtworkUrl, let u = URL(string: posterUrl) {
            cachedArtworkUrl = posterUrl
            URLSession.shared.dataTask(with: u) { [weak self] data, _, _ in
                guard let self = self, let d = data, let img = NSImage(data: d) else { return }
                let art = MPMediaItemArtwork(boundsSize: img.size) { _ in img }
                DispatchQueue.main.async {
                    self.cachedArtwork = art
                    if var cur = MPNowPlayingInfoCenter.default().nowPlayingInfo {
                        cur[MPMediaItemPropertyArtwork] = art
                        MPNowPlayingInfoCenter.default().nowPlayingInfo = cur
                    }
                }
            }.resume()
        }
    }

    // MARK: - Script Message Handler (JS <-> Native Bridge)

    func handleScriptMessage(_ message: WKScriptMessage) {
        let originHost = message.frameInfo.securityOrigin.host.lowercased()
        let originPort = message.frameInfo.securityOrigin.port
        guard message.frameInfo.isMainFrame,
              (originHost == "127.0.0.1" || originHost == "localhost"),
              originPort == Int(serverPort),
              let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }

        switch action {
        case "nowPlaying":
            updateNowPlaying(from: body)
        case "appLangChanged":
            let lang = (body["lang"] as? String) ?? "ru"
            let nextEn = lang.lowercased().hasPrefix("en")
            if nextEn != isEnglishUI {
                isEnglishUI = nextEn
                DispatchQueue.main.async { [weak self] in
                    self?.refreshLocalizedMenus()
                }
            }
        case "kinoriumOneClickLogin":
            let lang = (body["lang"] as? String) ?? "ru"
            openBuiltInKinoriumLoginWindow(isEnglish: lang.lowercased().hasPrefix("en"))
        case "openExternalUrl":
            if let uStr = body["url"] as? String,
               let u = URL(string: uStr),
               let scheme = u.scheme?.lowercased(),
               (scheme == "https" || scheme == "http") {
                NSWorkspace.shared.open(u)
            }
        case "notifyEpisode":
            let nTitle = (body["title"] as? String) ?? "Velarium"
            let nBody = (body["body"] as? String) ?? ""
            let nKey = (body["key"] as? String) ?? UUID().uuidString
            deliverNativeEpisodeNotification(title: nTitle, body: nBody, identifier: nKey)
        case "setWindowFullscreen":
            let wantFs = (body["fullscreen"] as? Bool) ?? false
            DispatchQueue.main.async { [weak self] in
                guard let win = self?.mainWindow else { return }
                let isFs = win.styleMask.contains(.fullScreen)
                if isFs != wantFs {
                    win.toggleFullScreen(nil)
                }
            }
        case "openEmbeddedStream":
            let uStr = (body["url"] as? String) ?? ""
            let rectDict = (body["rect"] as? [String: Any]) ?? [:]
            DispatchQueue.main.async { [weak self] in
                self?.openOrUpdateEmbeddedStream(urlString: uStr, rectDict: rectDict)
            }
        case "syncEmbeddedStreamRect":
            let rectDict = (body["rect"] as? [String: Any]) ?? [:]
            DispatchQueue.main.async { [weak self] in
                self?.syncEmbeddedStreamFrame(rectDict: rectDict)
            }
        case "reloadEmbeddedStream":
            DispatchQueue.main.async { [weak self] in
                self?.embeddedStreamWebView?.reload()
            }
        case "backEmbeddedStream":
            DispatchQueue.main.async { [weak self] in
                if let wv = self?.embeddedStreamWebView, wv.canGoBack {
                    wv.goBack()
                }
            }
        case "closeEmbeddedStream":
            DispatchQueue.main.async { [weak self] in
                self?.closeEmbeddedStreamWebView()
            }
        default:
            break
        }
    }

    private func computeEmbeddedStreamNSRect(from rectDict: [String: Any]) -> NSRect? {
        guard let rootView = mainWindow?.contentView else { return nil }
        let hidden = (rectDict["hidden"] as? Bool) ?? false
        if hidden { return nil }
        let domX = (rectDict["x"] as? Double) ?? 0.0
        let domY = (rectDict["y"] as? Double) ?? 0.0
        let domW = (rectDict["width"] as? Double) ?? 0.0
        let domH = (rectDict["height"] as? Double) ?? 0.0
        guard domW >= 80.0, domH >= 60.0 else { return nil }
        let bounds = rootView.bounds
        let vw = max(1.0, (rectDict["vw"] as? Double) ?? Double(bounds.width))
        let vh = max(1.0, (rectDict["vh"] as? Double) ?? Double(bounds.height))
        let scaleX = Double(bounds.width) / vw
        let scaleY = Double(bounds.height) / vh
        let scaledX = domX * scaleX
        let scaledW = domW * scaleX
        let scaledH = domH * scaleY
        let flippedY = Double(bounds.height) - ((domY * scaleY) + scaledH)
        return NSRect(x: scaledX, y: max(0.0, flippedY), width: scaledW, height: scaledH)
    }

    private func openOrUpdateEmbeddedStream(urlString: String, rectDict: [String: Any]) {
        guard let rootView = mainWindow?.contentView,
              let targetUrl = URL(string: urlString),
              let scheme = targetUrl.scheme?.lowercased(),
              scheme == "https" || scheme == "http" else { return }

        if embeddedStreamWebView == nil {
            let cfg = WKWebViewConfiguration()
            cfg.websiteDataStore = .default()
            cfg.allowsAirPlayForMediaPlayback = true
            cfg.mediaTypesRequiringUserActionForPlayback = []
            cfg.preferences.setValue(true, forKey: "allowsPictureInPictureMediaPlayback")
            if #available(macOS 12.3, *) {
                cfg.preferences.isElementFullscreenEnabled = true
            }
            let wv = WKWebView(frame: .zero, configuration: cfg)
            wv.navigationDelegate = self
            wv.uiDelegate = self
            wv.wantsLayer = true
            wv.layer?.cornerRadius = 10.0
            wv.layer?.masksToBounds = true
            wv.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15"
            rootView.addSubview(wv)
            embeddedStreamWebView = wv
        }

        syncEmbeddedStreamFrame(rectDict: rectDict)
        if embeddedStreamCurrentUrl != urlString {
            embeddedStreamCurrentUrl = urlString
            embeddedStreamWebView?.load(URLRequest(url: targetUrl))
        }
    }

    private func syncEmbeddedStreamFrame(rectDict: [String: Any]) {
        guard let wv = embeddedStreamWebView else { return }
        if let frame = computeEmbeddedStreamNSRect(from: rectDict) {
            wv.isHidden = false
            wv.frame = frame
        } else {
            wv.isHidden = true
        }
    }

    private func closeEmbeddedStreamWebView() {
        embeddedStreamCurrentUrl = ""
        guard let wv = embeddedStreamWebView else { return }
        wv.evaluateJavaScript("try { document.querySelectorAll('video,audio').forEach(m => m.pause()); } catch(_){}", completionHandler: nil)
        wv.stopLoading()
        wv.navigationDelegate = nil
        wv.uiDelegate = nil
        wv.removeFromSuperview()
        embeddedStreamWebView = nil
    }

    private func deliverNativeEpisodeNotification(title: String, body: String, identifier: String) {
        guard Bundle.main.bundleIdentifier != nil else { return }
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default
            let req = UNNotificationRequest(identifier: "velarium.ep.\(identifier)", content: content, trigger: nil)
            center.add(req, withCompletionHandler: nil)
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        if #available(macOS 11.0, *) {
            completionHandler([.banner, .sound])
        } else {
            completionHandler([.alert, .sound])
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        DispatchQueue.main.async { [weak self] in
            self?.showMainWindow()
        }
        completionHandler()
    }

    // MARK: - Built-in One-Click Kinorium Login Sheet inside Velarium.app

    private func openBuiltInKinoriumLoginWindow(isEnglish: Bool) {
        kinoriumAuthSheet?.open(isEnglish: isEnglish)
    }

    func windowWillClose(_ notification: Notification) {
        kinoriumAuthSheet?.windowWillClose(notification)
    }

    // MARK: - Menu Actions

    @objc private func reloadWebView() {
        closeEmbeddedStreamWebView()
        webView?.reload()
    }

    @objc private func togglePlayPauseFromMenu() {
        showMainWindow()
        dispatchPlayerCommand("togglePlayPause")
    }

    @objc private func openAboutFromMenu() {
        showMainWindow()
        if let wv = webView {
            let js = """
            (() => {
              document.getElementById('open-settings-btn')?.click();
              document.querySelector('#settings-tabs .settings-tab[data-stab="about"]')?.click();
            })();
            """
            wv.evaluateJavaScript(js, completionHandler: nil)
        } else {
            let creditsText = tr(
                "Единый локальный онлайн-кинотеатр. Посвящается всем голд дигерам.",
                "Unified local home cinema. Dedicated to all gold diggers."
            )
            NSApp.orderFrontStandardAboutPanel(options: [.credits: NSAttributedString(string: creditsText)])
        }
    }

    @objc private func openSettingsFromMenu() {
        showMainWindow()
        webView?.evaluateJavaScript("document.getElementById('open-settings-btn')?.click();", completionHandler: nil)
    }

    @objc private func openCommandPaletteFromMenu() {
        showMainWindow()
        webView?.evaluateJavaScript("document.getElementById('search-kbd-hint')?.click();", completionHandler: nil)
    }

    @objc private func openRouletteFromMenu() {
        showMainWindow()
        webView?.evaluateJavaScript("document.getElementById('btn-open-roulette-modal')?.click();", completionHandler: nil)
    }

    @objc private func openStatsFromMenu() {
        showMainWindow()
        webView?.evaluateJavaScript("document.getElementById('btn-open-stats-modal')?.click();", completionHandler: nil)
    }

    @objc private func openDownloadsFromMenu() {
        showMainWindow()
        webView?.evaluateJavaScript("document.getElementById('btn-open-downloads-modal')?.click();", completionHandler: nil)
    }

    @objc private func toggleTvModeFromMenu() {
        showMainWindow()
        webView?.evaluateJavaScript("document.getElementById('btn-toggle-tv-mode')?.click();", completionHandler: nil)
    }

    @objc private func openInDefaultBrowser() {
        if let u = URL(string: "http://127.0.0.1:\(serverPort)/") {
            NSWorkspace.shared.open(u)
        }
    }

    private func isLaunchAgentInstalled() -> Bool {
        let plist = (NSHomeDirectory() as NSString).appendingPathComponent("Library/LaunchAgents/app.velarium.cinema.plist")
        return FileManager.default.fileExists(atPath: plist)
    }

    @objc private func toggleLaunchAtLogin() {
        let targetState = !isLaunchAgentInstalled()
        guard let url = URL(string: "http://127.0.0.1:\(serverPort)/api/system/autostart") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["enabled": targetState])
        URLSession.shared.dataTask(with: req) { [weak self] _, _, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.autostartMenuItem.state = self.isLaunchAgentInstalled() ? .on : .off
            }
        }.resume()
    }

    @objc private func restartBackendServer() {
        daemonSupervisor.restartServer(isLaunchAgentInstalled: isLaunchAgentInstalled()) { [weak self] in
            DispatchQueue.main.async {
                self?.reloadWebView()
            }
        }
    }

    @objc private func quitAppCompletely() {
        isQuitting = true
        stopSpawnedServerIfNeeded()
        NSApp.terminate(nil)
    }
}

let bgFlag = CommandLine.arguments.contains("--background")
let app = NSApplication.shared
let controller = VelariumAppController(startInBackground: bgFlag)
app.delegate = controller
app.run()
