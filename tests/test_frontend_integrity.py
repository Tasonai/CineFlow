import glob
import json
import os
import re
import subprocess
import tempfile
import unittest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
JSC_BIN = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"


class TestFrontendIntegrity(unittest.TestCase):
    def test_pwa_manifest_and_icons_exist(self):
        manifest_path = os.path.join(PUBLIC_DIR, "manifest.webmanifest")
        self.assertTrue(os.path.isfile(manifest_path))
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
        self.assertEqual(manifest.get("display"), "standalone")
        icons = manifest.get("icons") or []
        self.assertGreaterEqual(len(icons), 3)
        for ic in icons:
            rel = str(ic.get("src") or "").lstrip("/")
            self.assertTrue(os.path.isfile(os.path.join(PUBLIC_DIR, rel)), f"Missing icon: {rel}")
        self.assertTrue(os.path.isfile(os.path.join(PUBLIC_DIR, "icons", "apple-touch-icon.png")))

    def test_es_module_imports_exports_and_cache_version_uniformity(self):
        js_files = [os.path.join(PUBLIC_DIR, "app.js")] + sorted(
            glob.glob(os.path.join(PUBLIC_DIR, "js", "*.js"))
        )
        index_path = os.path.join(PUBLIC_DIR, "index.html")
        with open(index_path, "r", encoding="utf-8") as f:
            html = f.read()

        html_versions = set(re.findall(r"\?v=([A-Za-z0-9_.-]+)", html))
        self.assertEqual(len(html_versions), 1, f"Inconsistent ?v= in index.html: {html_versions}")
        expected_v = next(iter(html_versions))

        exports_map = {}
        for p in js_files:
            with open(p, "r", encoding="utf-8") as f:
                src = f.read()
            exps = set()
            for m in re.finditer(r"export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)", src):
                exps.add(m.group(1))
            for m in re.finditer(r"export\s*\{([^}]+)\}", src):
                for part in m.group(1).split(","):
                    part = part.strip()
                    if part:
                        exps.add(part.split(" as ")[-1].strip())
            exports_map[os.path.normpath(p)] = exps

        for p in js_files:
            with open(p, "r", encoding="utf-8") as f:
                src = f.read()
            for m in re.finditer(r"import\s*\{([^}]+)\}\s*from\s*[\"']([^\"']+)[\"']", src, re.S):
                names_raw, spec = m.group(1), m.group(2)
                self.assertIn(f"?v={expected_v}", spec, f"{p} has mismatched version in {spec}")
                spec_clean = spec.split("?")[0]
                target = os.path.normpath(os.path.join(os.path.dirname(p), spec_clean))
                self.assertIn(target, exports_map, f"Missing target {target} imported by {p}")
                for part in names_raw.split(","):
                    part = part.strip()
                    if not part:
                        continue
                    orig = part.split(" as ")[0].strip()
                    self.assertIn(orig, exports_map[target], f"Symbol {orig!r} not exported by {target}")

    def test_webkit_jsc_module_graph_syntax(self):
        if not os.path.isfile(JSC_BIN):
            self.skipTest("JavaScriptCore CLI not present on this platform")
        js_files = [os.path.join(PUBLIC_DIR, "app.js")] + sorted(
            glob.glob(os.path.join(PUBLIC_DIR, "js", "*.js"))
        )
        with tempfile.TemporaryDirectory() as td:
            os.makedirs(os.path.join(td, "js"), exist_ok=True)
            for p in js_files:
                rel = os.path.relpath(p, PUBLIC_DIR)
                with open(p, "r", encoding="utf-8") as f:
                    cleaned = re.sub(r"\?v=[A-Za-z0-9_.-]+", "", f.read())
                with open(os.path.join(td, rel), "w", encoding="utf-8") as f:
                    f.write(cleaned)
            res = subprocess.run([JSC_BIN, "-m", os.path.join(td, "app.js")], capture_output=True, text=True)
            out = (res.stdout or "") + "\n" + (res.stderr or "")
            self.assertNotIn("SyntaxError", out)
            self.assertNotIn("ResolveError", out)

    def test_no_dotted_russian_abbreviations_or_emojis_in_ui(self):
        bad_abbr = re.compile(r"(?<![А-Яа-яЁё])(сек|мин|эп|стр|г)\.")
        emoji_re = re.compile(r"[\U0001F300-\U0001FAFF\u2600-\u27BF]")
        targets = [os.path.join(PUBLIC_DIR, "index.html"), os.path.join(PUBLIC_DIR, "app.js")] + sorted(
            glob.glob(os.path.join(PUBLIC_DIR, "js", "*.js"))
        )
        swift_path = os.path.join(BASE_DIR, "macos", "CineFlowApp.swift")
        if os.path.isfile(swift_path):
            targets.append(swift_path)
        for p in targets:
            with open(p, "r", encoding="utf-8") as f:
                for line_no, line in enumerate(f, 1):
                    self.assertIsNone(bad_abbr.search(line), f"Forbidden dotted abbreviation at {p}:{line_no}")
                    self.assertIsNone(emoji_re.search(line), f"Forbidden emoji character at {p}:{line_no}")

    def test_accessibility_safe_area_and_semantic_classes(self):
        index_path = os.path.join(PUBLIC_DIR, "index.html")
        with open(index_path, "r", encoding="utf-8") as f:
            html = f.read()
        self.assertIn("viewport-fit=cover", html)
        self.assertIn("atv-person-topbar", html)
        self.assertIn('id="stab-about"', html)
        self.assertIn("Atoma", html)
        self.assertIn("2026", html)
        self.assertIn("Windows", html)
        self.assertIn("2.7.0", html)

        for svg_rel in ("favicon.svg", os.path.join("icons", "icon.svg")):
            with open(os.path.join(PUBLIC_DIR, svg_rel), "r", encoding="utf-8") as f:
                svg_src = f.read()
            self.assertNotIn("linearGradient", svg_src)
            self.assertNotIn("radialGradient", svg_src)
            hex_cols = re.findall(r"#([0-9A-Fa-f]{6})\b", svg_src)
            self.assertGreaterEqual(len(hex_cols), 2, f"Expected hex fills/strokes in {svg_rel}")
            for hc in hex_cols:
                r_hex, g_hex, b_hex = hc[0:2].lower(), hc[2:4].lower(), hc[4:6].lower()
                self.assertTrue(
                    r_hex == g_hex == b_hex,
                    f"Non-monochrome color #{hc} found in {svg_rel}",
                )
        for modal_id in ("quick-peek-modal", "person-modal", "stats-modal", "settings-modal"):
            m = re.search(rf'<div[^>]*id="{modal_id}"[^>]*>', html)
            self.assertIsNotNone(m, f"Missing modal #{modal_id}")
            tag = m.group(0)
            self.assertIn('role="dialog"', tag, f"Missing role=dialog on #{modal_id}")
            self.assertIn('aria-modal="true"', tag, f"Missing aria-modal=true on #{modal_id}")

        css_combined = ""
        for css_file in sorted(glob.glob(os.path.join(PUBLIC_DIR, "css", "*.css"))):
            with open(css_file, "r", encoding="utf-8") as f:
                css_combined += "\n" + f.read()
        self.assertIn("prefers-reduced-motion: reduce", css_combined)
        self.assertIn("env(safe-area-inset-", css_combined)
        self.assertIn("html.is-ios-device .atv-vc-vol-slider", css_combined)

        for clean_js in ("modals.js", "settings.js"):
            p = os.path.join(PUBLIC_DIR, "js", clean_js)
            with open(p, "r", encoding="utf-8") as f:
                js_src = f.read()
            non_bar_styles = re.sub(r'style="width:\$\{[^}]+\}%"', "", js_src)
            self.assertNotIn('style="', non_bar_styles, f"Unexpected static inline style attribute in {clean_js}")

        with open(os.path.join(PUBLIC_DIR, "js", "catalog.js"), "r", encoding="utf-8") as f:
            cat_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "js", "catalog-cards.js"), "r", encoding="utf-8") as f:
            cat_cards_src = f.read()
        cat_combined = cat_src + cat_cards_src
        self.assertIn("const PAGE_SIZE = 12;", cat_combined)
        self.assertIn('decoding="async"', cat_combined)

        # Classic macOS matte design: zero Liquid Glass blur passes and zero visible focus outlines
        self.assertNotIn("backdrop-filter: blur(", css_combined)
        for line in css_combined.splitlines():
            s = line.strip()
            if s.startswith("outline:"):
                self.assertEqual(s, "outline: none;", f"Unexpected outline rule in CSS: {s}")

        # Single-season static label, minimalist Settings layout & cleaned header audio bar
        self.assertIn('id="season-static-val"', html)
        self.assertIn('id="season-group-prefix"', html)
        self.assertIn('id="settings-footer"', html)
        self.assertIn('id="backup-desc-lead"', html)
        self.assertIn('id="backup-lbl-file"', html)
        self.assertIn('class="atv-set-row"', html)
        self.assertNotIn('id="stab-integrations-desc"', html)
        self.assertNotIn('id="hdr-rezka-audio-bar"', html)

        with open(os.path.join(PUBLIC_DIR, "js", "settings.js"), "r", encoding="utf-8") as f:
            settings_src = f.read()
        self.assertNotIn("srv-toggle-label", settings_src)
        self.assertNotIn("status-badge-ok", settings_src)
        self.assertNotIn("atv-stremio-badge", settings_src)

        with open(os.path.join(PUBLIC_DIR, "js", "player.js"), "r", encoding="utf-8") as f:
            player_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "js", "player-seasons.js"), "r", encoding="utf-8") as f:
            player_seasons_src = f.read()
        self.assertIn("is-single-season", player_seasons_src)
        self.assertIn("seasonSel.disabled = isSingleSeason;", player_seasons_src)
        self.assertIn('setSleepTimer("off")', player_src)
        self.assertNotIn("|| 2024", player_src)

        # Minimalist Stats modal, Quick Peek & Player Kinorium similar blocks, and honest year fallbacks
        self.assertIn('class="atv-stats-profile-meta" id="stats-profile-badge"', html)
        self.assertIn('id="qp-similar-wrap"', html)
        self.assertIn('id="modal-similar-source"', html)
        with open(os.path.join(PUBLIC_DIR, "js", "modals.js"), "r", encoding="utf-8") as f:
            modals_src = f.read()
        self.assertNotIn("|| 2024", modals_src)
        self.assertNotIn("ratings: { kinorium: fv.score", modals_src)

    def test_v25_ui_ux_offline_profiles_tv_and_macos_invariants(self):
        with open(os.path.join(PUBLIC_DIR, "index.html"), "r", encoding="utf-8") as f:
            html = f.read()
        self.assertIn('id="tab-btn-offline"', html)
        self.assertIn('id="qp-btn-offline"', html)
        self.assertIn('id="tv-cast-lan-callout"', html)
        self.assertIn("srv-toggle-slider", html)
        self.assertNotIn("atv-switch", html)

        with open(os.path.join(PUBLIC_DIR, "js", "features.js"), "r", encoding="utf-8") as f:
            feat_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "js", "features-cast.js"), "r", encoding="utf-8") as f:
            feat_cast_src = f.read()
        self.assertIn('id="btn-tv-enable-lan"', feat_src + feat_cast_src)

        css_combined = ""
        for css_file in sorted(glob.glob(os.path.join(PUBLIC_DIR, "css", "*.css"))):
            with open(css_file, "r", encoding="utf-8") as f:
                css_combined += "\n" + f.read()
        self.assertIn(".st-offline", css_combined)
        self.assertIn(".atv-tv-lan-callout", css_combined)
        self.assertIn(".atv-prof-field .atv-cselect-btn", css_combined)
        self.assertIn(".atv-search-quick-random.active-hit", css_combined)
        self.assertIn(".atv-prof-pin-controls input:not(:placeholder-shown)", css_combined)

        swift_path = os.path.join(BASE_DIR, "macos", "CineFlowApp.swift")
        if os.path.isfile(swift_path):
            with open(swift_path, "r", encoding="utf-8") as f:
                swift_src = f.read()
            self.assertIn("WKDownloadDelegate", swift_src)
            self.assertIn("getElementById('open-settings-btn')", swift_src)
            self.assertIn("togglePlayPause", swift_src)
            self.assertIn("windowWillClose", swift_src)
            self.assertIn("appLangChanged", swift_src)

    def test_v26_responsive_offline_tv_and_native_wrappers_invariants(self):
        with open(os.path.join(PUBLIC_DIR, "index.html"), "r", encoding="utf-8") as f:
            html = f.read()
        self.assertIn("?v=20261105v2", html)

        css_combined = ""
        for css_file in sorted(glob.glob(os.path.join(PUBLIC_DIR, "css", "*.css"))):
            with open(css_file, "r", encoding="utf-8") as f:
                css_combined += "\n" + f.read()
        self.assertIn("min(300px, 46dvh)", css_combined)
        self.assertIn("html.is-kids-profile", css_combined)
        self.assertIn("#qp-btn-offline.is-saved-offline", css_combined)
        self.assertIn(".atv-ep-pill.is-saved-offline::after", css_combined)

        with open(os.path.join(PUBLIC_DIR, "js", "features.js"), "r", encoding="utf-8") as f:
            feat_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "js", "settings.js"), "r", encoding="utf-8") as f:
            set_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "js", "player.js"), "r", encoding="utf-8") as f:
            play_src = f.read()
        self.assertIn("ensureKidsPinVerifiedForAdminAction", feat_src)
        self.assertIn("ensureKidsPinVerifiedForAdminAction", set_src)
        self.assertIn("findAllOfflineDownloadsForTitle", play_src)

        swift_path = os.path.join(BASE_DIR, "macos", "CineFlowApp.swift")
        if os.path.isfile(swift_path):
            with open(swift_path, "r", encoding="utf-8") as f:
                swift_src = f.read()
            self.assertNotIn(".fullSizeContentView", swift_src)
            self.assertIn("t.className = 'toast'", swift_src)
            self.assertIn("allowsPictureInPictureMediaPlayback", swift_src)
            self.assertIn(".nonPersistent()", swift_src)

        wv_py = os.path.join(BASE_DIR, "windows", "desktop_webview2.py")
        if os.path.isfile(wv_py):
            with open(wv_py, "r", encoding="utf-8") as f:
                wv_src = f.read()
            self.assertIn('background_color="#0a0a0c"', wv_src)
            self.assertIn("text_select=True", wv_src)

        launcher_c = os.path.join(BASE_DIR, "windows", "launcher", "cineflow_launcher.c")
        if os.path.isfile(launcher_c):
            with open(launcher_c, "r", encoding="utf-8") as f:
                lc_src = f.read()
            self.assertIn("--user-data-dir=", lc_src)

    def test_v28_dropdowns_popovers_and_grid_layout_guards(self):
        """Ensure dropdown portals, header/stage popovers, and CSS grids never trap fixed boxes or overflow."""
        css_combined = ""
        for css_file in sorted(glob.glob(os.path.join(PUBLIC_DIR, "css", "*.css"))):
            with open(css_file, "r", encoding="utf-8") as f:
                css_combined += "\n" + f.read()

        # CSS grid tracks with horizontal scroll children must use minmax(0, 1fr)
        self.assertIn("grid-template-columns: minmax(0, 1fr) 332px;", css_combined)
        self.assertIn("grid-template-columns: 220px minmax(0, 1fr);", css_combined)
        self.assertIn("grid-template-columns: 180px minmax(0, 1fr);", css_combined)
        self.assertIn("grid-template-columns: 316px minmax(0, 1fr);", css_combined)

        # Prevent residual transform on .atv-custom-controls & .atv-cinema-sheet from trapping position:fixed popovers
        self.assertIn(".atv-video-stage.vc-popover-open .atv-custom-controls", css_combined)
        self.assertIn(".atv-video-stage-wrap.vc-popover-open", css_combined)
        self.assertIn("#player-modal:not(.hidden) .atv-cinema-sheet:has(.atv-vc-popover:not(.hidden))", css_combined)
        self.assertIn(".atv-notif-popover.atv-prof-popover", css_combined)

        with open(os.path.join(PUBLIC_DIR, "js", "utils.js"), "r", encoding="utf-8") as f:
            utils_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "app.js"), "r", encoding="utf-8") as f:
            app_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "js", "player.js"), "r", encoding="utf-8") as f:
            player_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "js", "player-ui-controls.js"), "r", encoding="utf-8") as f:
            player_ui_src = f.read()
        player_combined_ui = player_src + player_ui_src
        with open(os.path.join(PUBLIC_DIR, "js", "features.js"), "r", encoding="utf-8") as f:
            feat_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "js", "features-profiles.js"), "r", encoding="utf-8") as f:
            feat_prof_src = f.read()
        feat_combined = feat_src + feat_prof_src

        self.assertIn("export function closeFloatingPopovers(", utils_src)
        self.assertIn("export function clampFloatingPopover(", utils_src)
        self.assertIn("export function clampStagePopover(", utils_src)
        self.assertIn("function _resetPopoverInlineBox(", utils_src)
        self.assertIn("function _flushOutOfFlowLayout(", utils_src)
        self.assertIn('closeFloatingPopovers({ keepGearPopover: insideGear, keepCustomSelect: true })', utils_src)
        self.assertIn("closeFloatingPopovers(", app_src)
        self.assertIn("clampStagePopover(", player_combined_ui)
        self.assertIn('stage.parentElement?.classList.toggle("vc-popover-open"', player_combined_ui)
        self.assertIn('closeFloatingPopovers({ exceptId: "profile-switcher-popover" })', feat_combined)

    def test_v29_unified_matte_design_system(self):
        """Ensure all CSS, JS fallbacks, icons, and native wrappers follow the unified neutral matte design system."""
        css_combined = ""
        for css_file in sorted(glob.glob(os.path.join(PUBLIC_DIR, "css", "*.css"))):
            with open(css_file, "r", encoding="utf-8") as f:
                css_combined += "\n" + f.read()

        banned_css_hexes = [
            "#0a84ff",
            "#64d2ff",
            "#30d158",
            "#4ee173",
            "#ffd60a",
            "#ff9f0a",
            "#e5484d",
            "#2c2f3a",
            "#2b2e39",
            "#17181d",
            "#17181e",
            "#161922",
            "#3f6212",
            "#334155",
        ]
        css_lower = css_combined.lower()
        for hx in banned_css_hexes:
            self.assertNotIn(hx, css_lower, f"Off-palette hex {hx} found in CSS")

        # Disabled buttons, neutral sheets, and missing wifi icon guardrails
        self.assertIn(".atv-btn-primary:disabled", css_combined)
        self.assertIn("--danger-solid: #ef4444;", css_combined)
        self.assertIn("html.is-kids-profile .atv-cselect-wrap:has(> #select-friend-filter)", css_combined)
        self.assertIn("#btn-open-downloads-modal.has-active-dl", css_combined)
        self.assertNotIn("#btn-open-downloads.has-active-dl", css_combined)

        with open(os.path.join(PUBLIC_DIR, "js", "utils.js"), "r", encoding="utf-8") as f:
            utils_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "js", "player.js"), "r", encoding="utf-8") as f:
            player_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "js", "player-streams.js"), "r", encoding="utf-8") as f:
            player_streams_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "js", "player-ui-controls.js"), "r", encoding="utf-8") as f:
            player_ui_src = f.read()
        player_combined = player_src + player_streams_src + player_ui_src
        with open(os.path.join(PUBLIC_DIR, "js", "catalog.js"), "r", encoding="utf-8") as f:
            catalog_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "js", "catalog-cards.js"), "r", encoding="utf-8") as f:
            catalog_cards_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "js", "catalog-hero.js"), "r", encoding="utf-8") as f:
            catalog_hero_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "js", "catalog-notifications.js"), "r", encoding="utf-8") as f:
            catalog_notif_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "js", "catalog-discovery.js"), "r", encoding="utf-8") as f:
            catalog_discovery_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "js", "catalog-filters.js"), "r", encoding="utf-8") as f:
            catalog_filters_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "js", "catalog-media-resolver.js"), "r", encoding="utf-8") as f:
            catalog_resolver_src = f.read()
        catalog_combined = (
            catalog_src
            + catalog_cards_src
            + catalog_hero_src
            + catalog_notif_src
            + catalog_discovery_src
            + catalog_filters_src
            + catalog_resolver_src
        )
        with open(os.path.join(PUBLIC_DIR, "js", "audio-dsp.js"), "r", encoding="utf-8") as f:
            dsp_src = f.read()

        self.assertIn("wifi: `<svg", utils_src)
        self.assertNotIn("#334155", player_combined)
        self.assertNotIn("#334155", dsp_src)
        self.assertNotIn("#3f6212", catalog_combined)
        self.assertNotIn("#161922", catalog_combined)
        self.assertIn('class="atv-trailer-fallback"', player_combined)
        self.assertIn('class="release-info"', player_combined)

        with open(os.path.join(PUBLIC_DIR, "index.html"), "r", encoding="utf-8") as f:
            html_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "js", "i18n.js"), "r", encoding="utf-8") as f:
            i18n_src = f.read()
        self.assertIn("посвящается всем голд дигерам", html_src.lower())
        self.assertIn("посвящается всем голд дигерам", i18n_src.lower())

        # Wave 3, 4 & 5 UI/UX invariants: hit-slop expansion, explicit button types, tablist & popover ARIA, remote A11y
        self.assertIn(".atv-vc-bookmark-pin::before", css_combined)
        self.assertIn(".atv-search-clear::before", css_combined)
        self.assertIn(".atv-close-btn-sm::before", css_combined)
        self.assertIn(".atv-sub-dict-close::before", css_combined)
        self.assertIn('id="media-type-bar" role="tablist"', html_src)
        self.assertIn('id="notifications-bell-btn" aria-haspopup="true" aria-expanded="false"', html_src)
        self.assertIn('id="btn-player-gear" aria-haspopup="true" aria-expanded="false"', html_src)
        for m in re.finditer(r"<button\b[^>]*>", html_src):
            self.assertIn("type=", m.group(0))

        with open(os.path.join(PUBLIC_DIR, "js", "remote.js"), "r", encoding="utf-8") as f:
            remote_src = f.read()
        self.assertIn('class="atv-remote-bottom-tabs" role="tablist"', remote_src)
        self.assertIn('data-dpad="up" aria-label=', remote_src)
        self.assertIn('id="rm-catalog-search" enterkeyhint="search" aria-label=', remote_src)
        self.assertIn('class="atv-cselect-search" enterkeyhint="search" aria-label=', utils_src)

        # Wave 6 UI/UX invariants: eye icon, menuitem & keyboard nav in context menu, toast live region, in-stage episodes layout
        self.assertIn("eye: `<svg", utils_src)
        self.assertIn('toast.setAttribute("role", "status")', utils_src)
        self.assertIn('id="toast-container" class="atv-toast-container" role="region" aria-live="polite"', html_src)
        self.assertIn('role="menuitem" class="atv-context-menu-item"', catalog_combined)
        self.assertIn('class="atv-vc-ep-row-main atv-vc-pop-item-main"', player_combined)
        self.assertIn('seasonsBar.setAttribute("role", "tablist")', player_combined)

        # Wave 7 UI/UX invariants: role="switch" on all toggle switches, TV cast tablist/tab ARIA, touch poster-more-btn, break-ui guards
        with open(os.path.join(PUBLIC_DIR, "js", "settings.js"), "r", encoding="utf-8") as f:
            settings_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "js", "features.js"), "r", encoding="utf-8") as f:
            features_src = f.read()
        self.assertIn('id="cfg-lan-toggle" role="switch" aria-labelledby="lan-toggle-title"', html_src)
        self.assertIn('id="cfg-autostart-toggle" role="switch" aria-labelledby="autostart-toggle-title"', html_src)
        self.assertIn('id="dl-pref-auto-cleanup" role="switch"', html_src)
        self.assertIn('id="dl-pref-auto-next" role="switch"', html_src)
        self.assertIn('id="prof-edit-kids" role="switch"', html_src)
        self.assertIn('id="tv-cast-tabs-bar" role="tablist"', html_src)
        self.assertIn('id="btn-cast-tab-phone" role="tab" aria-selected="true"', html_src)
        self.assertIn('role="switch" class="srv-enable-checkbox"', settings_src)
        self.assertIn('role="switch" class="stremio-addon-toggle"', settings_src)
        self.assertIn('role="switch" data-ob-srv=', settings_src)
        self.assertIn("@media (hover: none), (pointer: coarse)", css_combined)
        self.assertIn(".atv-prof-card:focus-visible", css_combined)
        self.assertIn(".atv-cast-mode-tab:focus-visible", css_combined)
        self.assertIn("_kidsPinTriggerEl", features_src)
        self.assertIn('phoneBtn.setAttribute("aria-selected"', remote_src)

        # Wave 8 UI/UX invariants: combobox/listbox live search, notifications/stats/settings tablist ARIA, hit-slop & touch guards
        with open(os.path.join(PUBLIC_DIR, "app.js"), "r", encoding="utf-8") as f:
            app_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "js", "modals.js"), "r", encoding="utf-8") as f:
            modals_src = f.read()
        self.assertIn('id="global-search"', html_src)
        self.assertIn('role="combobox"', html_src)
        self.assertIn('aria-controls="search-live-popover"', html_src)
        self.assertIn('id="search-live-popover" role="listbox"', html_src)
        self.assertIn("aria-activedescendant", app_src)
        self.assertIn('id="notifications-tabs" role="tablist"', html_src)
        self.assertIn('id="notif-tab-updates" data-ntab="updates" role="tab"', html_src)
        self.assertIn('id="notifications-list" role="tabpanel"', html_src)
        self.assertIn('id="stats-modal-body" role="tabpanel"', html_src)
        self.assertIn('id="stab-integrations" role="tabpanel"', html_src)
        self.assertIn('tabUpd?.setAttribute("aria-selected"', catalog_combined)
        self.assertIn('tabAn?.setAttribute("aria-selected"', modals_src)
        self.assertIn(".atv-poster-item:focus-within .atv-user-score-badge", css_combined)
        self.assertIn(".atv-search-recent-del::before", css_combined)
        self.assertIn(".atv-xray-close::before", css_combined)
        self.assertIn(".atv-upnext-remove:focus-visible", css_combined)

        # Pass-8 Backend-Frontend integration invariants: player Kinorium status & scrobble error guards, TorrServer loader recovery
        with open(os.path.join(PUBLIC_DIR, "js", "player-seasons.js"), "r", encoding="utf-8") as f:
            player_seasons_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "js", "player-rating.js"), "r", encoding="utf-8") as f:
            player_rating_src = f.read()
        with open(os.path.join(PUBLIC_DIR, "js", "player-scrobble.js"), "r", encoding="utf-8") as f:
            player_scrobble_src = f.read()
        player_combined_all = player_src + player_seasons_src + player_streams_src + player_rating_src + player_scrobble_src
        self.assertGreaterEqual(player_combined_all.count("if (!res.ok || kStatus?.ok === false || kStatus?.error)"), 5)
        self.assertIn("if (!tres.ok || !tjson || !tjson.ok || !tjson.stream_url)", player_combined_all)
        self.assertIn("const offlineHook = data.offline_automation || data.offline_hook;", player_combined_all)

        # Wave 9 UI/UX Design Audit invariants: 44x44px hit-slop, initial modal focus, custom select listbox ARIA, and zero unguarded :hover
        self.assertIn(".atv-close-btn::before", css_combined)
        self.assertIn(".atv-close-btn:focus-visible", css_combined)
        self.assertIn(".atv-poster-more-btn::before", css_combined)
        self.assertIn(".atv-search-hit-play::before", css_combined)
        self.assertIn(".atv-hero-arrow::before", css_combined)
        self.assertIn(".atv-hscroll-nav-btn::before", css_combined)
        self.assertIn('id="person-role-tabs" role="tablist"', html_src)
        self.assertIn('id="person-filmography-grid" role="tabpanel"', html_src)
        self.assertIn('btn.setAttribute("aria-controls", "qp-ep-list")', modals_src)
        self.assertIn('btn.setAttribute("aria-controls", "atv-cselect-portal")', utils_src)
        self.assertIn('id="atv-cselect-opt-${idx}"', utils_src)
        for css_file in sorted(os.listdir(os.path.join(PUBLIC_DIR, "css"))):
            if not css_file.endswith(".css"):
                continue
            with open(os.path.join(PUBLIC_DIR, "css", css_file), "r", encoding="utf-8") as f:
                css_text = f.read()
            media_stack = []
            brace_depth = 0
            unguarded_hover = []
            for idx, line in enumerate(css_text.splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith("@media"):
                    media_stack.append((brace_depth, stripped))
                if (
                    ":hover" in stripped
                    and not stripped.startswith("/*")
                    and not stripped.startswith("*")
                    and not stripped.startswith("@media")
                ):
                    in_safe_media = any(
                        ("hover: hover" in m[1] or "hover: none" in m[1] or "prefers-reduced-motion" in m[1])
                        for m in media_stack
                    )
                    if not in_safe_media:
                        unguarded_hover.append((idx, stripped))
                brace_depth += line.count("{") - line.count("}")
                while media_stack and brace_depth <= media_stack[-1][0]:
                    media_stack.pop()
            self.assertEqual(
                unguarded_hover,
                [],
                f"{css_file} has unguarded :hover selectors outside @media (hover: hover) and (pointer: fine): {unguarded_hover}",
            )


if __name__ == "__main__":
    unittest.main()
