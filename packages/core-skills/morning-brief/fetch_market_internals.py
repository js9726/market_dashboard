#!/usr/bin/env python3
"""
fetch_market_internals.py — collect the image-only market-internals charts.

The problem this solves
-----------------------
`market_edge.py` prints URLs and tells the operator to "open the link and read the one
thing named". Running it therefore completes nothing: on 2026-09-14 the run recorded
`DP CONFIRMATION: UNAVAILABLE` and "MCO/MCSI remain manual and were not read", and the
report treated image-only content as inherently unavailable.

It is not. StockCharts serves these as plain PNGs over HTTP, and an agent that can look
at an image can read them. This script fetches them into the dated run folder so the
reads become a normal, evidenced step.

What it does NOT do
-------------------
It does not interpret the charts. Download is collection; the read is a separate act
that requires actually looking at the saved image. In particular:

  * Record the chart's own AS-OF DATE from the image header. The free StockCharts
    McClellan series are END-OF-DAY: during a live session they still show the PREVIOUS
    session. Labelling Friday's NYMO as today's is a data-freshness error.
  * NEVER quote a sigma / standard-deviation value. Nothing here computes a mean or a
    standard deviation over the underlying series, so any "x sigma" statement would be
    invented. Report the raw level and the direction of change only.

Usage
-----
    python fetch_market_internals.py --run-dir <evidence/trading/daily-runs/YYYY-MM-DD>
    python fetch_market_internals.py --run-dir ... --only mcclellan
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import struct
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
SC = "https://stockcharts.com"
DP_GALLERY = f"{SC}/freecharts/dpgallery.html"

# Ratio-adjusted McClellan series. These are the two the market-timing doctrine names.
MCCLELLAN = {
    "NYMO": f"{SC}/c-sc/sc?s=%24NYMO&p=D&b=5&g=0&i=0",
    "NYSI": f"{SC}/c-sc/sc?s=%24NYSI&p=D&b=5&g=0&i=0",
}
MIN_BYTES = 5_000


def _get(url: str, referer: str | None = None, timeout: int = 30) -> tuple[int, str, bytes]:
    headers = {"User-Agent": UA}
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, (resp.headers.get("Content-Type") or ""), resp.read()


def _png_size(data: bytes) -> tuple[int, int] | None:
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", data[16:24])


def _save(data: bytes, path: pathlib.Path) -> dict:
    """Validate the envelope before claiming a chart was collected."""
    if len(data) < MIN_BYTES:
        return {"ok": False, "reason": f"payload only {len(data)} bytes"}
    size = _png_size(data)
    if not size:
        return {"ok": False, "reason": "payload is not a PNG"}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return {"ok": True, "path": str(path), "bytes": len(data),
            "width": size[0], "height": size[1]}


def fetch_mcclellan(run_dir: pathlib.Path) -> list[dict]:
    out = []
    for name, url in MCCLELLAN.items():
        rec: dict = {"chart": name, "url": url,
                     "fetched_at": datetime.now().isoformat(timespec="seconds")}
        try:
            status, ctype, data = _get(url)
            if status != 200 or "image" not in ctype:
                rec.update(ok=False, reason=f"HTTP {status}, content-type {ctype!r}")
            else:
                rec.update(_save(data, run_dir / "internals" / f"{name}.png"))
        except urllib.error.HTTPError as exc:
            rec.update(ok=False, reason=f"HTTP {exc.code}")
        except Exception as exc:
            rec.update(ok=False, reason=f"{type(exc).__name__}: {exc}")
        rec["read_status"] = "collected_not_read"
        out.append(rec)
    return out


def fetch_decisionpoint(run_dir: pathlib.Path, limit: int = 4) -> list[dict]:
    """Pull the DecisionPoint gallery's own chart images.

    The gallery page is HTML with <img src="/c-sc/sc?..."> entries, so it is machine
    reachable. Free access truncates to three overlays per chart, which is enough for
    the 20/50/200 structure the DecisionPoint doctrine reads.
    """
    out: list[dict] = []
    try:
        status, ctype, body = _get(DP_GALLERY)
        if status != 200:
            return [{"chart": "dp_gallery", "ok": False, "reason": f"HTTP {status}"}]
        html = body.decode("utf-8", "replace")
    except Exception as exc:
        return [{"chart": "dp_gallery", "ok": False,
                 "reason": f"{type(exc).__name__}: {exc}"}]

    srcs = [s for s in re.findall(r'src="([^"]+)"', html) if "/c-sc/sc?" in s]
    seen: set[str] = set()
    for i, src in enumerate(srcs):
        if len(out) >= limit:
            break
        url = src if src.startswith("http") else f"{SC}{src}"
        key = re.sub(r"[?&]id=[^&]*", "", url)
        if key in seen:
            continue
        seen.add(key)
        sym = re.search(r"s=\$?([A-Z]+)", urllib.parse.unquote(url))
        period = re.search(r"[?&]p=([DWM])", url)
        label = f"DP_{sym.group(1) if sym else 'chart'}_{period.group(1) if period else str(i)}"
        rec: dict = {"chart": label, "url": url,
                     "fetched_at": datetime.now().isoformat(timespec="seconds")}
        try:
            st, ct, data = _get(url, referer=DP_GALLERY)
            if st != 200 or "image" not in ct:
                rec.update(ok=False, reason=f"HTTP {st}, content-type {ct!r}")
            else:
                rec.update(_save(data, run_dir / "internals" / f"{label}.png"))
        except Exception as exc:
            rec.update(ok=False, reason=f"{type(exc).__name__}: {exc}")
        rec["read_status"] = "collected_not_read"
        out.append(rec)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--only", choices=("mcclellan", "decisionpoint"), default=None)
    ap.add_argument("--dp-limit", type=int, default=4)
    args = ap.parse_args()

    run_dir = pathlib.Path(args.run_dir)
    results: list[dict] = []
    if args.only in (None, "mcclellan"):
        results += fetch_mcclellan(run_dir)
    if args.only in (None, "decisionpoint"):
        results += fetch_decisionpoint(run_dir, args.dp_limit)

    manifest = run_dir / "internals" / "manifest.json"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(json.dumps(results, indent=2), encoding="utf-8", newline="\n")

    ok = [r for r in results if r.get("ok")]
    bad = [r for r in results if not r.get("ok")]
    for r in ok:
        print(f"  collected {r['chart']:18s} {r['width']}x{r['height']}  {r['path']}")
    for r in bad:
        print(f"  FAILED    {r['chart']:18s} {r.get('reason')}")
    print(f"\n{len(ok)} collected, {len(bad)} failed -> {manifest}")
    print("\nThese are COLLECTED, not READ. Open each image and record:")
    print("  * the chart's own as-of date from its header (free McClellan data is")
    print("    END-OF-DAY and shows the PREVIOUS session during a live market);")
    print("  * the raw level and the direction of change.")
    print("  Do NOT quote a sigma value - nothing here computes one.")
    return 0 if ok and not bad else (0 if ok else 1)


if __name__ == "__main__":
    raise SystemExit(main())
