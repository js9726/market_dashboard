"""Tests for tools/render_report.py: path confinement, the one-file server, trimming, and a
live leak test that a report cannot pull a local file into its image.

The live tests need Microsoft Edge or Chrome and Pillow; they are skipped when either is
missing. Nothing is sent over the network.

    python -m unittest discover -s packages/bot-box/tests -p "test_render_report.py" -v
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.request

TOOLS = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))
import render_report as rr  # noqa: E402

try:
    from PIL import Image
    HAVE_PIL = True
except ImportError:  # pragma: no cover
    HAVE_PIL = False
try:
    rr.find_browser()
    HAVE_BROWSER = True
except RuntimeError:  # pragma: no cover
    HAVE_BROWSER = False

RED = "#ff0000"


class Paths(unittest.TestCase):
    def setUp(self):
        t = tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        self.base = Path(t.name)
        self.root = self.base / "outputs" / "bot-box"
        (self.root / "2026-09-29").mkdir(parents=True)
        (self.root / "2026-09-29" / "A-report.html").write_text("<p>hi</p>", encoding="utf-8")
        (self.base / "outside.html").write_text("<p>no</p>", encoding="utf-8")

    def test_inside_root_resolves_with_png_beside(self):
        html, png = rr.resolve_inside(self.root, "2026-09-29/A-report.html")
        self.assertEqual(png, html.with_suffix(".png"))
        self.assertIn(self.root.resolve(), html.parents)

    def test_escapes_and_bad_names_are_refused(self):
        for rel in ("../outside.html", "2026-09-29/../../outside.html", "C:/x.html", "/x.html", "x.png",
                    "2026-09-29/missing.html", ".hidden.html", "a/b/c/d/e.html"):
            with self.subTest(rel=rel), self.assertRaises((rr.Refused, OSError)):
                rr.resolve_inside(self.root, rel)

    @unittest.skipUnless(hasattr(os, "symlink"), "no symlinks")
    def test_links_are_refused(self):
        link = self.root / "link.html"
        try:
            os.symlink(self.base / "outside.html", link)
        except OSError:
            self.skipTest("symlinks need privileges on this machine")
        with self.assertRaises(rr.Refused):
            rr.resolve_inside(self.root, "link.html")

    @unittest.skipUnless(os.name == "nt", "junctions are Windows-only")
    def test_junction_out_of_the_root_is_refused(self):
        outside = self.base / "elsewhere"
        outside.mkdir()
        (outside / "B-report.html").write_text("<p>x</p>", encoding="utf-8")
        junction = self.root / "jump"
        subprocess.run(["cmd", "/c", "mklink", "/J", str(junction), str(outside)], check=True,
                       capture_output=True)
        with self.assertRaises(rr.Refused):
            rr.resolve_inside(self.root, "jump/B-report.html")

    def test_main_reports_refusal_as_json_exit_2(self):
        out = subprocess.run([sys.executable, "-B", str(TOOLS / "render_report.py"), "--root", str(self.root),
                              "--file", "../outside.html"], capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 2)
        self.assertEqual(json.loads(out.stdout)["status"], "REFUSED")


class Server(unittest.TestCase):
    def test_serves_only_the_report_with_a_strict_policy(self):
        with rr.OneFileServer(b"<p>report</p>") as srv:
            with urllib.request.urlopen(srv.url, timeout=5) as r:
                self.assertEqual(r.read(), b"<p>report</p>")
                csp = r.headers["Content-Security-Policy"]
            for bad in ("x", "../", "C:/Users", "%2e%2e/secret", "favicon.ico"):
                with self.subTest(path=bad), self.assertRaises(urllib.error.HTTPError) as cm:
                    urllib.request.urlopen(srv.url + bad, timeout=5)
                self.assertEqual(cm.exception.code, 404)
        self.assertIn("default-src 'none'", csp)
        self.assertNotIn("script-src", csp)          # scripts fall back to default-src 'none'
        self.assertIn("frame-src 'none'", csp)

    def test_browser_flags(self):
        cmd = rr.browser_command("edge.exe", Path("p"), Path("s.png"), "http://127.0.0.1:1/")
        self.assertIn("--headless=new", cmd)
        self.assertIn("--proxy-server=127.0.0.1:9", cmd)
        self.assertTrue(any(a.startswith("--user-data-dir=") for a in cmd))
        self.assertFalse(any(a.startswith("file:") for a in cmd))


@unittest.skipUnless(HAVE_PIL, "Pillow missing")
class Trim(unittest.TestCase):
    def test_trims_background_below_content(self):
        im = Image.new("RGB", (100, 1000), (20, 20, 20))
        for y in range(100, 300):
            im.putpixel((50, y), (200, 200, 200))
        out, truncated = rr.trim(im)
        self.assertLess(out.height, 400)
        self.assertGreaterEqual(out.height, 300)
        self.assertFalse(truncated)

    def test_content_to_the_bottom_is_truncated(self):
        im = Image.new("RGB", (10, 100), (0, 0, 0))
        im.putpixel((5, 99), (255, 255, 255))
        im.putpixel((0, 99), (0, 0, 0))
        out, truncated = rr.trim(im)
        self.assertTrue(truncated)

    def test_blank_page_is_an_error(self):
        with self.assertRaises(RuntimeError):
            rr.trim(Image.new("RGB", (10, 10), (1, 2, 3)))


@unittest.skipUnless(HAVE_PIL and HAVE_BROWSER, "needs Edge/Chrome and Pillow")
class Live(unittest.TestCase):
    def setUp(self):
        t = tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        self.base = Path(t.name)
        self.root = self.base / "outputs" / "bot-box"
        self.root.mkdir(parents=True)
        # A "secret" page painted solid red: if any of it reaches the image, red pixels appear.
        self.secret = self.base / "secret.html"
        self.secret.write_text("<body style='margin:0;background:%s'><div style='height:600px'></div>" % RED,
                               encoding="utf-8")
        red_png = self.base / "secret.png"
        Image.new("RGB", (400, 400), (255, 0, 0)).save(red_png)
        self.red_png = red_png

    def render(self, body):
        (self.root / "r.html").write_text(body, encoding="utf-8")
        out = subprocess.run([sys.executable, "-B", str(TOOLS / "render_report.py"), "--root", str(self.root),
                              "--file", "r.html"], capture_output=True, text=True, timeout=120)
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)
        report = json.loads(out.stdout)
        with Image.open(report["png"]) as im:
            return report, im.convert("RGB")

    def red_pixels(self, im):
        return sum(1 for p in im.get_flattened_data() if p[0] > 200 and p[1] < 60 and p[2] < 60)

    def test_normal_report_renders_and_is_trimmed(self):
        report, im = self.render("<body style='background:#fff'><h1>Report</h1><p>line</p>"
                                 "<div style='height:300px;background:#123456'></div></body>")
        self.assertEqual(report["status"], "OK")
        self.assertFalse(report["truncated"])
        self.assertLess(im.height, 2000)
        self.assertTrue(Path(report["png"]).is_file())
        self.assertEqual(Path(report["png"]).parent, self.root.resolve())

    def test_control_embedded_image_does_render_red(self):
        # Proves the red detector works and that data: images (allowed) still render.
        import base64
        import io
        buf = io.BytesIO()
        Image.new("RGB", (200, 200), (255, 0, 0)).save(buf, "PNG")
        data = base64.b64encode(buf.getvalue()).decode("ascii")
        report, im = self.render("<body style='background:#fff'><img src='data:image/png;base64,{}' "
                                 "width=200 height=200><p>x</p></body>".format(data))
        self.assertGreater(self.red_pixels(im), 10000)

    def test_local_files_cannot_leak_into_the_image(self):
        uri, png_uri = self.secret.as_uri(), self.red_png.as_uri()
        body = ("<body style='background:#fff'><p>probe</p>"
                "<iframe src='{0}' width=400 height=400></iframe>"
                "<object data='{0}' width=400 height=400></object>"
                "<embed src='{0}' width=400 height=400>"
                "<img src='{1}' width=400 height=400>"
                "<div style=\"width:400px;height:400px;background:url('{1}')\"></div>"
                "<link rel=stylesheet href='{0}'>"
                "<script>document.body.style.background='{2}'</script>"
                "<div style='height:50px'></div></body>").format(uri, png_uri, RED)
        report, im = self.render(body)
        self.assertEqual(self.red_pixels(im), 0, "local file or script content reached the image")


if __name__ == "__main__":
    unittest.main()
