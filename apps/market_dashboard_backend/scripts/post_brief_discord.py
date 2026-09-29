"""Post today's DeepSeek pre-open brief to Discord #j_asistant through a channel webhook.

    python scripts/post_brief_discord.py --data-dir data [--dry-run]

Reads data/morning_brief_meta.json and data/morning_brief_deepseek.json, written by
morning_brief.py earlier in the same workflow run, and posts one message with Discord embeds:
mood and posture, the alert, indices, sentiment, technicals, sectors, the standout setup,
the watchlist, earnings and the calendar.

It never posts a stale brief as today's: if the meta file says DeepSeek did not generate
today (US Eastern date), or the brief has no market data, a short notice says so instead,
with a link to the workflow run. A brief generated after the 09:30 ET open is labelled.

The webhook URL comes from DISCORD_BRIEF_WEBHOOK_URL (a GitHub secret) and is never printed.
No webhook configured means nothing is posted (exit 0). Mentions are disabled, so text from
the model can never ping anyone. Exit 1 only when a configured post fails.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
WEBHOOK = re.compile(r"https://(discord|discordapp)\.com/api/webhooks/\d{17,20}/[A-Za-z0-9_-]{30,100}")
OPEN = dt.time(9, 30)
COLORS = {"GO": 0x16A34A, "WAIT": 0xD97706, "TRIM_TIGHTEN": 0xDC2626, "RISK_OFF": 0xDC2626, "CASH": 0x6B7280}
LIMIT = {"title": 256, "description": 4096, "field_name": 256, "field_value": 1024, "footer": 2048, "total": 5800}


def clip(text, limit: int) -> str:
    text = " ".join(str(text or "").split()) if "\n" not in str(text or "") else str(text or "").strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def num(v, fmt="{:,.2f}"):
    try:
        return fmt.format(float(v))
    except (TypeError, ValueError):
        return None


def pct(v):
    s = num(v, "{:+.2f}")
    return s + "%" if s else None


def load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def run_url() -> str | None:
    server, repo, run = (os.environ.get(k) for k in ("GITHUB_SERVER_URL", "GITHUB_REPOSITORY", "GITHUB_RUN_ID"))
    return "{}/{}/actions/runs/{}".format(server, repo, run) if server and repo and run else None


def brief_state(meta, brief, now_et: dt.datetime):
    """('ok'|'failed'|'no_data', built_at_et or None, reason)."""
    built = None
    if isinstance(meta, dict) and meta.get("built_at"):
        try:
            built = dt.datetime.fromisoformat(str(meta["built_at"]).replace("Z", "+00:00")).astimezone(ET)
        except ValueError:
            built = None
    generated = bool(((meta or {}).get("providers") or {}).get("deepseek", {}).get("generated"))
    if not generated or built is None or built.date() != now_et.date():
        return "failed", built, "DeepSeek did not produce a brief in today's run"
    if not isinstance(brief, dict):
        return "failed", built, "the DeepSeek brief file is missing or unreadable"
    indices = brief.get("indices") or []
    has_prices = any(isinstance(i, dict) and i.get("changePct") is not None for i in indices)
    alert = str(brief.get("alert") or "")
    if not has_prices or "DATA UNAVAILABLE" in alert.upper():
        return "no_data", built, "the brief came back without market data"
    return "ok", built, ""


def item_text(item) -> str:
    if not isinstance(item, dict):
        return clip(item, 200)
    head = next((str(item[k]) for k in ("ticker", "symbol", "time", "name", "event") if item.get(k)), "")
    rest = []
    for k in ("event", "name", "level", "changePct", "abc", "catalyst", "note", "reason"):
        v = item.get(k)
        if v in (None, "", []) or str(v) == head:
            continue
        rest.append(pct(v) if k == "changePct" else (num(v) if k == "level" and num(v) else str(v)))
    return clip((head + (": " if head and rest else "") + " · ".join(r for r in rest if r)), 200)


def field(name, lines, code=False) -> dict | None:
    lines = [ln for ln in lines if ln]
    if not lines:
        return None
    if code:
        body = "```\n" + "\n".join(lines) + "\n```"
        while len(body) > LIMIT["field_value"] and len(lines) > 1:
            lines = lines[:-1]
            body = "```\n" + "\n".join(lines) + "\n```"
    else:
        body = clip("\n".join(lines), LIMIT["field_value"])
    return {"name": clip(name, LIMIT["field_name"]), "value": body, "inline": False}


def brief_payload(brief: dict, built: dt.datetime, now_et: dt.datetime, snapshot_at: str | None) -> dict:
    mood = brief.get("mood") or {}
    posture = str(mood.get("posture") or "").upper()
    head = "**{} · posture {}**".format(mood.get("label") or "?", posture or "?")
    desc = [head, clip(mood.get("summary"), 1500)]
    if brief.get("alert"):
        desc.append("⚠️ " + clip(str(brief["alert"]).lstrip("⚠️ !* ").strip(), 600))
    if built.time() >= OPEN:
        desc.append("_Generated {:%H:%M} ET, after the US open: treat as a late read._".format(built))
    idx = []
    for i in brief.get("indices") or []:
        if isinstance(i, dict) and (i.get("level") is not None or i.get("changePct") is not None):
            idx.append("{:<5} {:>11} {:>8}".format(str(i.get("symbol", ""))[:5], num(i.get("level")) or "",
                                                   pct(i.get("changePct")) or ""))
    fg, br = brief.get("fearGreed") or {}, brief.get("breadth") or {}
    sentiment = []
    if fg.get("score") is not None:
        sentiment.append("Fear & Greed {} ({})".format(fg.get("score"), fg.get("label") or ""))
    if br.get("up") is not None or br.get("down") is not None:
        sentiment.append("Breadth up {} / down {}".format(br.get("up"), br.get("down")))
    sectors = sorted([s for s in brief.get("sectorsThemes") or [] if isinstance(s, dict) and s.get("changePct") is not None],
                     key=lambda s: float(s["changePct"]), reverse=True)
    sector_lines = ["{:<5} {:>8}".format(str(s.get("symbol", ""))[:5], pct(s.get("changePct"))) for s in sectors[:3]]
    if len(sectors) > 3:
        sector_lines += ["  ...", *["{:<5} {:>8}".format(str(s.get("symbol", ""))[:5], pct(s.get("changePct")))
                                   for s in sectors[-2:]]]
    so = brief.get("standout") or {}
    standout = []
    if so.get("ticker"):
        standout.append(" ".join(p for p in ("**{}**".format(so["ticker"]), str(so.get("side") or ""),
                                             "score {}".format(so["score"]) if so.get("score") is not None else "",
                                             "grade {}".format(so["grade"]) if so.get("grade") else "") if p))
        levels = " · ".join("{} {}".format(k, num(so.get(k))) for k in ("entry", "stop", "target") if num(so.get(k)))
        if levels:
            standout.append(levels + ("  (R:R {})".format(so.get("rrr")) if so.get("rrr") else ""))
    if so.get("thesis"):
        standout.append(clip(so["thesis"], 500))
    earn = brief.get("earnings") or {}
    earnings = []
    for key, label in (("bmo", "Before open"), ("amc", "After close")):
        names = [item_text(e) for e in (earn.get(key) or [])][:8]
        if names:
            earnings.append("{}: {}".format(label, ", ".join(n.split(":")[0] for n in names)))
    fields = [
        field("Indices", idx, code=True),
        field("Sentiment", sentiment),
        field("Technicals", [clip(brief.get("technicalsNarrative"), 700)] if brief.get("technicalsNarrative") else []),
        field("Sectors (best / worst)", sector_lines, code=True),
        field("Sector read", [clip(brief.get("sectorsNarrative"), 500)] if brief.get("sectorsNarrative") else []),
        field("Standout", standout),
        # Only rows with a price or a move; "no live price supplied" rows are noise in a chat.
        field("Watchlist", [item_text(w) for w in (brief.get("watchlist") or [])
                            if isinstance(w, dict) and (w.get("level") is not None or w.get("changePct") is not None)][:6]),
        field("Movers", [item_text(m) for m in (brief.get("movers") or [])[:5]]),
        field("Earnings", earnings),
        field("Calendar", [item_text(c) for c in (brief.get("calendar") or [])[:5]]),
    ]
    embed = {
        "title": clip("Pre-open brief · {:%a %d %b %Y} · DeepSeek".format(now_et), LIMIT["title"]),
        "description": clip("\n".join(d for d in desc if d), LIMIT["description"]),
        "color": COLORS.get(posture, 0x2563EB),
        "fields": [f for f in fields if f],
        "footer": {"text": clip("DeepSeek V4 Flash · market data as of {} UTC · generated {:%H:%M} ET · "
                                "not financial advice".format((snapshot_at or "unknown")[:16].replace("T", " "), built),
                                LIMIT["footer"])},
    }
    if run_url():
        embed["url"] = run_url()
    # Keep the whole embed under Discord's 6,000-character cap by dropping trailing fields.
    while embed_size(embed) > LIMIT["total"] and embed["fields"]:
        embed["fields"].pop()
    return {"username": "Pre-open brief", "embeds": [embed], "allowed_mentions": {"parse": []}}


def embed_size(embed: dict) -> int:
    return (len(embed.get("title", "")) + len(embed.get("description", "")) + len(embed["footer"]["text"])
            + sum(len(f["name"]) + len(f["value"]) for f in embed.get("fields", [])))


def notice_payload(state: str, reason: str, now_et: dt.datetime) -> dict:
    text = "⚠️ **Pre-open brief {:%a %d %b}: not available.** {}.".format(now_et, reason)
    if state == "no_data":
        text += " Nothing from it is shown, so no stale or empty numbers go out."
    if run_url():
        text += "\nRun: <{}>".format(run_url())
    return {"username": "Pre-open brief", "content": clip(text, 1900), "allowed_mentions": {"parse": []}}


def post(url: str, payload: dict, opener=urllib.request.urlopen) -> None:
    data = json.dumps(payload).encode("utf-8")
    for attempt in range(3):
        request = urllib.request.Request(url + "?wait=true", data=data, method="POST",
                                         headers={"Content-Type": "application/json",
                                                  "User-Agent": "market-dashboard-brief (bot-box, 1.0)"})
        try:
            with opener(request, timeout=20) as response:
                if 200 <= response.status < 300:
                    return
                raise RuntimeError("Discord answered HTTP {}".format(response.status))
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt < 2:
                try:
                    wait = float(json.loads(error.read().decode("utf-8")).get("retry_after", 2))
                except (ValueError, AttributeError):
                    wait = 2.0
                time.sleep(min(wait, 30))
                continue
            raise RuntimeError("Discord answered HTTP {}".format(error.code)) from None
    raise RuntimeError("Discord kept rate-limiting the webhook")


def build(data_dir: Path, now_et: dt.datetime):
    meta = load(data_dir / "morning_brief_meta.json")
    brief = load(data_dir / "morning_brief_deepseek.json")
    snapshot = load(data_dir / "snapshot.json") or {}
    state, built, reason = brief_state(meta, brief, now_et)
    if state == "ok":
        return state, brief_payload(brief, built, now_et, snapshot.get("built_at"))
    return state, notice_payload(state, reason, now_et)


def main(argv=None, now=None, opener=urllib.request.urlopen) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", default="data")
    ap.add_argument("--dry-run", action="store_true", help="print the message instead of posting it")
    args = ap.parse_args(argv)
    now_et = (now or dt.datetime.now(dt.timezone.utc)).astimezone(ET)
    state, payload = build(Path(args.data_dir), now_et)
    if args.dry_run:
        print(json.dumps(payload, indent=2))   # ASCII-escaped: safe on any console
        return 0
    url = (os.environ.get("DISCORD_BRIEF_WEBHOOK_URL") or "").strip()
    if not url:
        print("[discord] DISCORD_BRIEF_WEBHOOK_URL is not set; nothing posted")
        return 0
    if not WEBHOOK.fullmatch(url):
        print("[discord] DISCORD_BRIEF_WEBHOOK_URL is not a Discord webhook URL; nothing posted")
        return 1
    try:
        post(url, payload, opener)
    except (RuntimeError, OSError) as error:
        print("[discord] post failed: {}".format(error))   # the URL is never printed
        return 1
    print("[discord] posted the pre-open brief ({})".format(state))
    return 0


if __name__ == "__main__":
    sys.exit(main())
