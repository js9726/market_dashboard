#!/usr/bin/env python3
"""Turn one of the bot's HTML reports into a PNG image that Discord shows inline.

    python packages/bot-box/tools/render_report.py --root <jie_wiki/outputs/bot-box> --file 2026-09-29/SMCI-report.html

Discord offers an .html attachment only as a download or code preview; an image shows in
the chat. The runner fixes --root to the bot's scratch folder; --file is a path inside it.
The PNG is written next to the HTML (same name, .png) and its absolute path is printed in
one JSON object, ready for the reply tool's files list.

Safety, because the page is rendered on Jie's PC:
- Only a .html file inside --root is read and only a .png beside it is written: the
  resolved path must stay inside the resolved root, and no part of it may be a link.
- The page is served from a one-file local web server, never opened as file://. A web
  page cannot load local files, so an <img>, <iframe> or CSS url() aimed at a file such as
  the Discord token cannot put it in the image. Every other path on that server is 404.
- The page is served with a Content-Security-Policy that allows no scripts, frames,
  plugins or fetches - only inline styles and data: images and fonts. The browser also
  runs with a throwaway profile and a dead proxy for any non-local network.

Headless Microsoft Edge (or Chrome) renders the page at a fixed width into a tall canvas;
Pillow trims the empty space below the content. A page taller than the cap is cut there
and says so. Exit 0 on success; 2 for a refused path; 3 when rendering fails.
"""
from __future__ import annotations

import argparse
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time

WIDTH = 880
MAX_HEIGHT = 9000
SCALE = 1.5
TIMEOUT_SECONDS = 60
MAX_HTML_BYTES = 5 * 1024 * 1024
BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]
# Sent with the page: no scripts, frames, plugins, forms or fetches of any kind; only the
# page's own inline styles and images/fonts embedded as data: URIs. The browser enforces it.
# (--blink-settings=scriptEnabled=false would do less and stops headless screenshots.)
CSP = ("default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; "
       "frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'")
FILE_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._ -]{0,80}(/[A-Za-z0-9][A-Za-z0-9._ -]{0,80}){0,3}\.html")


class Refused(Exception):
    pass


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    sys.stdout.flush()


def resolve_inside(root: Path, relative: str) -> tuple[Path, Path]:
    """The report and its PNG path, both proven to be inside root with no links on the way."""
    if not FILE_PATTERN.fullmatch(relative) or ".." in relative.split("/"):
        raise Refused("file must be a .html path inside the bot's outputs folder, like 2026-09-29/NAME.html")
    root = root.resolve(strict=True)
    walk = root
    for part in relative.split("/"):
        walk = walk / part
        if walk.is_symlink() or (walk.exists() and os.path.isjunction(walk)):
            raise Refused("links are not followed: " + relative)
    html = walk.resolve(strict=True)
    png = html.with_suffix(".png")
    for p in (html, png):
        if root not in p.parents:
            raise Refused("path leaves the outputs folder: " + relative)
    if not html.is_file():
        raise Refused("not a file: " + relative)
    if png.is_symlink():
        raise Refused("the .png target is a link: " + relative)
    if html.stat().st_size > MAX_HTML_BYTES:
        raise Refused("report is larger than {} MB".format(MAX_HTML_BYTES // (1024 * 1024)))
    return html, png


class OneFileServer:
    """Serves the report bytes at / and nothing else, on 127.0.0.1 only."""

    def __init__(self, body: bytes):
        payload = body

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                if self.path in ("/", "/index.html"):
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Security-Policy", CSP)
                    self.send_header("Content-Length", str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                else:
                    self.send_error(404)

            def log_message(self, *args):
                pass

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = "http://127.0.0.1:{}/".format(self.httpd.server_address[1])
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.httpd.shutdown()
        self.httpd.server_close()


def find_browser() -> str:
    for candidate in BROWSERS:
        if Path(candidate).is_file():
            return candidate
    raise RuntimeError("neither Microsoft Edge nor Google Chrome is installed")


def browser_command(browser: str, profile: Path, shot: Path, url: str) -> list[str]:
    return [browser, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
            "--no-default-browser-check", "--disable-extensions", "--disable-sync", "--mute-audio",
            "--proxy-server=127.0.0.1:9",
            "--user-data-dir=" + str(profile), "--force-device-scale-factor={}".format(SCALE),
            "--window-size={},{}".format(WIDTH, MAX_HEIGHT), "--screenshot=" + str(shot), url]


def wait_for_file(path: Path, seconds: float, step: float = 0.25) -> None:
    deadline = time.monotonic() + seconds
    last = -1
    while time.monotonic() < deadline:
        size = path.stat().st_size if path.is_file() else -1
        if size > 0 and size == last:
            return
        last = size
        time.sleep(step)


def trim(image):
    """Crop the empty background below the content; returns (image, truncated)."""
    from PIL import Image, ImageChops
    rgb = image.convert("RGB")
    background = rgb.getpixel((0, rgb.height - 1))
    box = ImageChops.difference(rgb, Image.new("RGB", rgb.size, background)).getbbox()
    if box is None:
        raise RuntimeError("the rendered page is blank")
    bottom = min(rgb.height, box[3] + int(24 * SCALE))
    return rgb.crop((0, 0, rgb.width, bottom)), box[3] >= rgb.height - 2


def render(html: Path, png: Path) -> dict:
    from PIL import Image
    browser = find_browser()
    work = Path(tempfile.mkdtemp(prefix="render-report-"))
    try:
        shot = work / "shot.png"
        with OneFileServer(html.read_bytes()) as server:
            done = subprocess.run(browser_command(browser, work / "profile", shot, server.url),
                                  stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  timeout=TIMEOUT_SECONDS)
            # msedge.exe can hand the work to a child process and exit at once, so wait for
            # the screenshot itself (present, and the same size twice) while the page is served.
            wait_for_file(shot, TIMEOUT_SECONDS)
        if not shot.is_file():
            raise RuntimeError("the browser did not produce a screenshot (exit {})".format(done.returncode))
        with Image.open(shot) as raw:
            image, truncated = trim(raw)
        partial = png.with_name(png.name + ".partial")
        image.save(partial, "PNG", optimize=True)
        os.replace(partial, png)
        return {"width": image.width, "height": image.height, "truncated": truncated}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
                                     allow_abbrev=False)
    parser.add_argument("--root", required=True, help="the bot's outputs folder (fixed by the runner)")
    parser.add_argument("--file", required=True, help="report path inside --root, e.g. 2026-09-29/SMCI-report.html")
    args = parser.parse_args(argv)
    try:
        html, png = resolve_inside(Path(args.root), args.file.replace("\\", "/"))
    except (Refused, OSError) as error:
        emit({"status": "REFUSED", "reason": str(error)})
        return 2
    try:
        size = render(html, png)
    except (RuntimeError, OSError, subprocess.TimeoutExpired, ImportError) as error:
        emit({"status": "FAILED", "reason": "{}: {}".format(error.__class__.__name__, error)})
        return 3
    emit({"status": "OK", "png": str(png), **size,
          "note": ("attach png with the reply tool's files; " +
                   ("the page was taller than the cap, so the image stops at {} px".format(size["height"])
                    if size["truncated"] else "the whole page is in the image"))})
    return 0


if __name__ == "__main__":
    sys.exit(main())
