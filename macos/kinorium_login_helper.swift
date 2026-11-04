import Cocoa
import WebKit

final class KinoriumLoginDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusLabel: NSTextField!
    private var pollTimer: Timer?
    private var timeoutTimer: Timer?
    private var finished = false
    private let isEnglish: Bool
    private var triedFallbackDomain = false

    init(isEnglish: Bool) {
        self.isEnglish = isEnglish
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)

        let winRect = NSRect(x: 0, y: 0, width: 520, height: 720)
        window = NSWindow(
            contentRect: winRect,
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = isEnglish ? "Sign in to Kinorium — CineFlow" : "Вход в Kinorium — CineFlow"
        window.center()
        window.delegate = self
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = NSColor(calibratedRed: 0.04, green: 0.04, blue: 0.05, alpha: 1.0)
        window.titlebarAppearsTransparent = true

        let container = NSView(frame: winRect)
        container.autoresizingMask = [.width, .height]

        let bannerHeight: CGFloat = 44
        let banner = NSView(frame: NSRect(x: 0, y: winRect.height - bannerHeight, width: winRect.width, height: bannerHeight))
        banner.autoresizingMask = [.width, .minYMargin]
        banner.wantsLayer = true
        banner.layer?.backgroundColor = NSColor(calibratedRed: 0.08, green: 0.08, blue: 0.09, alpha: 1.0).cgColor

        statusLabel = NSTextField(labelWithString: isEnglish
            ? "Sign in to your Kinorium account below — window closes automatically"
            : "Войдите в аккаунт Kinorium ниже — окно закроется автоматически")
        statusLabel.frame = NSRect(x: 16, y: 12, width: winRect.width - 120, height: 20)
        statusLabel.autoresizingMask = [.width]
        statusLabel.font = NSFont.systemFont(ofSize: 12.5, weight: .medium)
        statusLabel.textColor = NSColor(calibratedWhite: 0.88, alpha: 1.0)
        statusLabel.lineBreakMode = .byTruncatingTail
        banner.addSubview(statusLabel)

        let clearBtn = NSButton(frame: NSRect(x: winRect.width - 98, y: 8, width: 84, height: 26))
        clearBtn.autoresizingMask = [.minXMargin]
        clearBtn.title = isEnglish ? "Switch Acc" : "Сменить"
        clearBtn.bezelStyle = .rounded
        clearBtn.font = NSFont.systemFont(ofSize: 11, weight: .medium)
        clearBtn.target = self
        clearBtn.action = #selector(clearSessionAndReload)
        banner.addSubview(clearBtn)

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        webView = WKWebView(
            frame: NSRect(x: 0, y: 0, width: winRect.width, height: winRect.height - bannerHeight),
            configuration: config
        )
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"

        container.addSubview(banner)
        container.addSubview(webView)
        window.contentView = container

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        loadInitialPage()

        pollTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.probeAuthenticatedSession()
        }
        timeoutTimer = Timer.scheduledTimer(withTimeInterval: 600.0, repeats: false) { [weak self] _ in
            guard let self = self, !self.finished else { return }
            self.finished = true
            self.pollTimer?.invalidate()
            self.emitResult(["ok": false, "cancelled": true])
            self.window.close()
            NSApp.terminate(nil)
        }
    }

    private func loadInitialPage() {
        let urlStr = isEnglish ? "https://en.kinorium.com/#login" : "https://ru.kinorium.com/#login"
        if let url = URL(string: urlStr) {
            webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20))
        }
        // Automatically click the login button once homepage loads if user is not signed in yet
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.2) { [weak self] in
            self?.triggerLoginModalIfNeeded()
        }
    }

    @objc private func clearSessionAndReload() {
        let store = webView.configuration.websiteDataStore
        store.httpCookieStore.getAllCookies { [weak self] cookies in
            let group = DispatchGroup()
            for cookie in cookies {
                group.enter()
                store.httpCookieStore.delete(cookie) {
                    group.leave()
                }
            }
            group.notify(queue: .main) {
                store.fetchDataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes()) { records in
                    store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), for: records) {
                        self?.loadInitialPage()
                    }
                }
            }
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil,
           let targetURL = navigationAction.request.url,
           let scheme = targetURL.scheme?.lowercased(),
           (scheme == "http" || scheme == "https") {
            webView.load(navigationAction.request)
        }
        return nil
    }

    private func triggerLoginModalIfNeeded() {
        guard !finished else { return }
        let js = """
        (function() {
          if (typeof USER_ID !== 'undefined' && Number(USER_ID) > 0) return 'authed';
          if (typeof authWindow === 'function') { try { authWindow(); return 'authWindow'; } catch (_) {} }
          var btn = document.querySelector('.auth_button, .login_button, .header__login, a[href*="/login"], [data-type="login"], .auth_btn, .user_login');
          if (btn && typeof btn.click === 'function') { btn.click(); return 'clicked'; }
          return 'none';
        })();
        """
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        probeAuthenticatedSession()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
            self?.triggerLoginModalIfNeeded()
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if !triedFallbackDomain {
            triedFallbackDomain = true
            let alt = isEnglish ? "https://ru.kinorium.com/#login" : "https://en.kinorium.com/#login"
            if let u = URL(string: alt) {
                webView.load(URLRequest(url: u))
            }
        }
    }

    private func probeAuthenticatedSession() {
        guard !finished else { return }
        let detectJS = """
        (function() {
          var uid = '';
          if (typeof USER_ID !== 'undefined' && USER_ID && /^\\d+$/.test(String(USER_ID)) && Number(USER_ID) > 0) {
            uid = String(USER_ID);
          }
          if (!uid && typeof window.user_id !== 'undefined' && /^\\d+$/.test(String(window.user_id)) && Number(window.user_id) > 0) {
            uid = String(window.user_id);
          }
          if (!uid && typeof wsid === 'object' && wsid && /^\\d+$/.test(String(wsid.id || '')) && Number(wsid.id) > 0) {
            uid = String(wsid.id);
          }
          if (!uid) {
            var selectors = [
              'a.topMenu__avatar[href*="/user/"]',
              '.user_avatar a[href*="/user/"]',
              '.header a.avatar[href*="/user/"]',
              '.topPanel a.avatar[href*="/user/"]',
              'a.profile[href*="/user/"]'
            ];
            for (var i = 0; i < selectors.length; i++) {
              var el = document.querySelector(selectors[i]);
              if (!el) continue;
              var href = el.getAttribute('href') || '';
              var m = href.match(/\\/user\\/(\\d+)\\/?/);
              if (m && Number(m[1]) > 0) { uid = m[1]; break; }
            }
          }
          var nameEl = document.querySelector('.user_name, .header .username, .profile_name, .topMenu__user-name');
          var uname = nameEl ? (nameEl.textContent || '').trim() : '';
          return JSON.stringify({ user_id: uid, display_name: uname, url: location.href });
        })();
        """
        webView.evaluateJavaScript(detectJS) { [weak self] result, _ in
            guard let self = self, !self.finished, let jsonStr = result as? String,
                  let data = jsonStr.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let uid = obj["user_id"] as? String,
                  !uid.isEmpty,
                  let uidInt = Int(uid), uidInt > 0 else {
                return
            }
            let uname = (obj["display_name"] as? String) ?? ""
            self.captureCookiesAndFinish(userId: uid, displayName: uname)
        }
    }

    private static func cookieMatchesUserId(_ rawVal: String, userId: String) -> Bool {
        let decoded = rawVal.removingPercentEncoding ?? rawVal
        return decoded.contains("\"user_id\":\"\(userId)\"")
            || decoded.contains("\"user_id\":\(userId)")
            || decoded.contains("\"id\":\"\(userId)\"")
            || decoded.contains("\"id\":\(userId)")
    }

    private func captureCookiesAndFinish(userId: String, displayName: String) {
        guard !finished else { return }
        webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            guard let self = self, !self.finished else { return }
            let now = Date()
            let kinCookies = cookies.filter { c in
                if let exp = c.expiresDate, exp < now {
                    return false
                }
                let dom = c.domain.lowercased()
                let val = c.value.trimmingCharacters(in: .whitespacesAndNewlines)
                return dom.contains("kinorium.") && !val.isEmpty && val.lowercased() != "deleted"
            }.sorted { a, b in
                if a.name == "auth" && b.name == "auth" {
                    let aMatch = Self.cookieMatchesUserId(a.value, userId: userId)
                    let bMatch = Self.cookieMatchesUserId(b.value, userId: userId)
                    if aMatch != bMatch { return aMatch }
                }
                let aRoot = a.domain.hasPrefix(".kinorium.")
                let bRoot = b.domain.hasPrefix(".kinorium.")
                if aRoot != bRoot { return aRoot }
                return false
            }
            let hasValidAuth = kinCookies.contains { c in
                if c.name == "auth" {
                    return Self.cookieMatchesUserId(c.value, userId: userId) || c.value.count >= 16
                }
                if c.name == "session" {
                    return c.value.count >= 10
                }
                return false
            }
            guard hasValidAuth else { return }
            var pairs: [String] = []
            var seen = Set<String>()
            for c in kinCookies {
                if !seen.contains(c.name) {
                    seen.insert(c.name)
                    pairs.append("\(c.name)=\(c.value)")
                }
            }
            let cookieHeader = pairs.joined(separator: "; ")
            self.finished = true
            self.pollTimer?.invalidate()
            self.timeoutTimer?.invalidate()
            self.emitResult([
                "ok": true,
                "user_id": userId,
                "display_name": displayName,
                "cookie": cookieHeader
            ])
            DispatchQueue.main.async {
                self.window.close()
                NSApp.terminate(nil)
            }
        }
    }

    func windowWillClose(_ notification: Notification) {
        if !finished {
            finished = true
            pollTimer?.invalidate()
            timeoutTimer?.invalidate()
            emitResult(["ok": false, "cancelled": true])
            NSApp.terminate(nil)
        }
    }

    private func emitResult(_ payload: [String: Any]) {
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
           let str = String(data: data, encoding: .utf8) {
            print("CINEFLOW_KINORIUM_AUTH:\(str)")
            fflush(stdout)
        }
    }
}

let args = CommandLine.arguments
let isEn = args.contains("--en") || (args.firstIndex(of: "--lang").map { idx in
    idx + 1 < args.count && args[idx + 1].lowercased().hasPrefix("en")
} ?? false)

let app = NSApplication.shared
let delegate = KinoriumLoginDelegate(isEnglish: isEn)
app.delegate = delegate
app.run()
