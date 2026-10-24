import os
import unittest

from backend.qrcode_svg import build_qr_matrix, generate_qr_svg
from backend.remuxer import RemuxStreamEngine

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class TestQrCodeAndRemuxEngine(unittest.TestCase):
    def test_qr_matrix_and_svg_generation(self):
        url = "http://192.168.1.42:8765"
        matrix = build_qr_matrix(url)
        self.assertEqual(len(matrix), 25)
        self.assertEqual(len(matrix[0]), 25)
        # Top-left, top-right, bottom-left 7x7 finder corners must be dark
        self.assertEqual(matrix[0][0], 1)
        self.assertEqual(matrix[0][-1], 1)
        self.assertEqual(matrix[-1][0], 1)

        svg = generate_qr_svg(url, quiet_zone=3)
        self.assertTrue(svg.startswith("<svg"))
        self.assertIn('viewBox="0 0 31 31"', svg)
        self.assertIn("<path d=", svg)

    def test_remux_command_copy_hevc_and_surround_downmix(self):
        eng = RemuxStreamEngine(BASE_DIR)
        cmd = eng.build_remux_command(
            source_url="http://127.0.0.1:8090/stream/movie.mkv",
            audio_index=1,
            start_sec=120.5,
            video_codec="hevc",
            channels=6,
            audio_codec="eac3",
            force_h264=False,
        )
        self.assertIn("-tag:v", cmd)
        self.assertIn("hvc1", cmd)
        self.assertIn("-af", cmd)
        c_v_idx = cmd.index("-c:v")
        self.assertEqual(cmd[c_v_idx + 1], "copy")
        c_a_idx = cmd.index("-c:a")
        self.assertIn(cmd[c_a_idx + 1], ("aac_at", "aac"))

    def test_remux_command_stereo_aac_zero_copy(self):
        eng = RemuxStreamEngine(BASE_DIR)
        cmd = eng.build_remux_command(
            source_url="http://127.0.0.1:8090/stream/episode.mp4",
            audio_index=0,
            start_sec=0.0,
            video_codec="h264",
            channels=2,
            audio_codec="aac",
            force_h264=False,
        )
        c_a_idx = cmd.index("-c:a")
        self.assertEqual(cmd[c_a_idx + 1], "copy")
        self.assertNotIn("-af", cmd)

    def test_remux_command_hardware_h264_fallback(self):
        eng = RemuxStreamEngine(BASE_DIR)
        cmd = eng.build_remux_command(
            source_url="http://127.0.0.1:8090/stream/remux.mkv",
            audio_index=0,
            start_sec=15.0,
            video_codec="vc1",
            channels=2,
            audio_codec="ac3",
            force_h264=True,
        )
        c_v_idx = cmd.index("-c:v")
        self.assertIn(cmd[c_v_idx + 1], ("h264_videotoolbox", "libx264"))


if __name__ == "__main__":
    unittest.main()
