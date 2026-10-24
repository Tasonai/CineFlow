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
        for p in targets:
            with open(p, "r", encoding="utf-8") as f:
                for line_no, line in enumerate(f, 1):
                    self.assertIsNone(bad_abbr.search(line), f"Forbidden dotted abbreviation at {p}:{line_no}")
                    self.assertIsNone(emoji_re.search(line), f"Forbidden emoji character at {p}:{line_no}")


if __name__ == "__main__":
    unittest.main()
