#!/usr/bin/env python3
import os
import shutil
import tempfile
import unittest

from scripts.bump_cache_token import (
    bump_cache_token,
    generate_next_cache_token,
    get_current_cache_token,
)

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class TestBumpCacheToken(unittest.TestCase):
    def test_get_current_cache_token(self):
        token = get_current_cache_token(ROOT_DIR)
        self.assertRegex(token, r"^\d{8}v\d+$")

    def test_generate_next_cache_token(self):
        # Same day increment
        next_tok = generate_next_cache_token("20261103v125", "20261103")
        self.assertEqual(next_tok, "20261103v126")

        # Next day reset to v1
        next_tok_day2 = generate_next_cache_token("20261103v125", "20261104")
        self.assertEqual(next_tok_day2, "20261104v1")

        # Fallback if no current token
        next_tok_fallback = generate_next_cache_token("", "20261105")
        self.assertEqual(next_tok_fallback, "20261105v1")

    def test_bump_cache_token_in_temp_tree(self):
        with tempfile.TemporaryDirectory() as td:
            pub_dir = os.path.join(td, "public")
            js_dir = os.path.join(pub_dir, "js")
            tests_dir = os.path.join(td, "tests")
            os.makedirs(js_dir)
            os.makedirs(tests_dir)

            index_html = os.path.join(pub_dir, "index.html")
            with open(index_html, "w", encoding="utf-8") as f:
                f.write(
                    '<link rel="stylesheet" href="/css/app.css?v=20261103v125" />\n'
                    '<script type="module" src="/app.js?v=20261103v125"></script>\n'
                )

            app_js = os.path.join(pub_dir, "app.js")
            with open(app_js, "w", encoding="utf-8") as f:
                f.write('import { state } from "./js/state.js?v=20261103v125";\n')

            mod_js = os.path.join(js_dir, "catalog.js")
            with open(mod_js, "w", encoding="utf-8") as f:
                f.write('import { t } from "./i18n.js?v=20261103v125";\n')

            test_integrity = os.path.join(tests_dir, "test_frontend_integrity.py")
            with open(test_integrity, "w", encoding="utf-8") as f:
                f.write('self.assertIn("?v=20261103v125", html)\n')

            # Verify current token discovery in temp tree
            self.assertEqual(get_current_cache_token(td), "20261103v125")

            # Bump token
            res = bump_cache_token(new_token="20261103v126", root_dir=td, dry_run=False)
            self.assertEqual(res["old_token"], "20261103v125")
            self.assertEqual(res["new_token"], "20261103v126")
            self.assertGreaterEqual(res["updated_files_count"], 4)

            # Check contents
            with open(index_html, "r", encoding="utf-8") as f:
                content = f.read()
                self.assertIn("?v=20261103v126", content)
                self.assertNotIn("?v=20261103v125", content)

            with open(app_js, "r", encoding="utf-8") as f:
                content = f.read()
                self.assertIn("?v=20261103v126", content)
                self.assertNotIn("?v=20261103v125", content)

            with open(mod_js, "r", encoding="utf-8") as f:
                content = f.read()
                self.assertIn("?v=20261103v126", content)
                self.assertNotIn("?v=20261103v125", content)

            with open(test_integrity, "r", encoding="utf-8") as f:
                content = f.read()
                self.assertIn("?v=20261103v126", content)
                self.assertNotIn("?v=20261103v125", content)


if __name__ == "__main__":
    unittest.main()
