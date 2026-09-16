#!/usr/bin/env python3
"""
send_telegram_document.py - deliver the journal artifact to the trading Telegram bot.

Why this exists
---------------
The existing Telegram lane (`/api/telegram/trading-journal`) only calls `sendMessage`, so
the daily push has always been a text summary. The artifact Jie actually reads is the desk
HTML, and a summary is not that. Telegram's Bot API supports `sendDocument` (50 MB), which
carries both HTML and PDF, and PDF previews inline on mobile - so the page can land in the
same chat as the alert instead of living only on disk.

Token handling
--------------
The bot token is stored as a Windows DPAPI ciphertext (hex, CurrentUser scope) at
``%LOCALAPPDATA%\\Jie\\secrets\\trading-telegram\\bot-token.dpapi``. It is decrypted through
PowerShell at call time, held only in memory, never logged, never written to disk, and
never passed as a shell argument (it goes into the URL of an in-process HTTPS request).
The chat id is non-secret and lives in ``config.json``.

HTML vs PDF
-----------
Prefer PDF: Telegram renders it inline, so the desk is readable without downloading. Send
the HTML too when the interactive page matters. Convert with headless Chrome:

    chrome --headless --disable-gpu --print-to-pdf=<out.pdf> --print-to-pdf-no-header <file-url>

Usage
-----
    python send_telegram_document.py --file <path> [--caption "..."] [--dry-run]

``--dry-run`` resolves the token and chat id and validates the file, but sends nothing.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import pathlib
import subprocess
import sys
import urllib.request
import uuid

SECRETS = pathlib.Path.home() / "AppData" / "Local" / "Jie" / "secrets" / "trading-telegram"
TOKEN_FILE = SECRETS / "bot-token.dpapi"
CONFIG_FILE = SECRETS / "config.json"
TELEGRAM_MAX_BYTES = 50 * 1024 * 1024


class SendError(RuntimeError):
    pass


def _decrypt_token() -> str:
    """Decrypt the DPAPI ciphertext via PowerShell. Returns the token; never logs it."""
    if not TOKEN_FILE.exists():
        raise SendError(f"token file not found: {TOKEN_FILE}")
    ps = (
        "$ErrorActionPreference='Stop';"
        f"$hex=(Get-Content -Raw '{TOKEN_FILE}').Trim();"
        "$ss=ConvertTo-SecureString $hex;"
        "$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss);"
        "[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b));"
        "[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)"
    )
    proc = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
        capture_output=True, text=True,
    )
    if proc.returncode != 0 or not proc.stdout.strip():
        # stderr may echo the command but never the plaintext.
        raise SendError(f"DPAPI decrypt failed (rc={proc.returncode}). "
                        "The ciphertext is CurrentUser-scoped: it only decrypts as Jie on this machine.")
    token = proc.stdout.strip()
    if ":" not in token:
        raise SendError("decrypted value does not look like a bot token")
    return token


def _chat_id() -> str:
    cfg = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    chat = cfg.get("ownerChatId")
    if not chat:
        raise SendError(f"ownerChatId missing from {CONFIG_FILE}")
    return str(chat)


def _multipart(fields: dict, filename: str, payload: bytes, ctype: str) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    out = bytearray()
    for key, value in fields.items():
        out += (f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n').encode()
    out += (f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="document"; filename="{filename}"\r\n'
            f"Content-Type: {ctype}\r\n\r\n").encode()
    out += payload + f"\r\n--{boundary}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={boundary}"


def send_document(path: pathlib.Path, caption: str = "", dry_run: bool = False) -> dict:
    if not path.is_file():
        raise SendError(f"not a file: {path}")
    payload = path.read_bytes()
    if not payload:
        raise SendError(f"{path.name} is empty")
    if len(payload) > TELEGRAM_MAX_BYTES:
        raise SendError(f"{path.name} is {len(payload)} bytes, over Telegram's 50 MB document limit")

    token, chat = _decrypt_token(), _chat_id()
    ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"

    if dry_run:
        return {"dry_run": True, "file": str(path), "bytes": len(payload),
                "content_type": ctype, "chat_id": chat, "token_resolved": True}

    fields = {"chat_id": chat}
    if caption:
        # Telegram caps captions at 1024 characters.
        fields["caption"] = caption[:1024]
        fields["parse_mode"] = "HTML"
    body, content_type = _multipart(fields, path.name, payload, ctype)
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendDocument",
        data=body, method="POST", headers={"Content-Type": content_type},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        # Scrub the token out of any error text before it can reach a log.
        raise SendError(f"sendDocument failed: {str(exc).replace(token, '<token>')}") from None
    if not result.get("ok"):
        raise SendError(f"Telegram rejected the document: {result}")
    msg = result.get("result", {})
    return {"ok": True, "message_id": msg.get("message_id"),
            "chat_id": (msg.get("chat") or {}).get("id"),
            "file_name": (msg.get("document") or {}).get("file_name"),
            "file_size": (msg.get("document") or {}).get("file_size")}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", required=True)
    ap.add_argument("--caption", default="")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    try:
        out = send_document(pathlib.Path(a.file), a.caption, a.dry_run)
    except SendError as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
