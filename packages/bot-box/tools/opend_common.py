"""Shared plumbing for the private bot's read-only OpenD tools (positions, quotes, trades).

Every tool that talks to the local moomoo OpenD gateway goes through run(): the gateway
port is checked before the SDK connects, the SDK's own chatter is sent to stderr so stdout
carries exactly one JSON object, and the whole read runs under a watchdog. Anything that
stops a reliable read - gateway down, not logged in, an SDK error, no answer in time -
prints status UNAVAILABLE with the reason and no data (exit 3). Nothing here trades: the
only trade-context calls in these tools are get_acc_list, position_list_query,
history_deal_list_query, order_fee_query and close (tests/test_opend_tools.py checks).
"""
from __future__ import annotations

import contextlib
from datetime import datetime, timezone
import json
import math
import os
import socket
import sys
import threading

HOST, PORT = "127.0.0.1", 11111
CONNECT_SECONDS = 3
WATCHDOG_SECONDS = 45
EXIT_UNAVAILABLE = 3
# The real stdout, captured before anything redirects it. redirect_stdout is process-wide,
# so while a worker thread sends SDK chatter to stderr, a timeout report written through
# sys.stdout would land on stderr too.
OUT = sys.stdout


class Unavailable(Exception):
    """The data cannot be read reliably; the message says why."""


def now_utc():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def emit(payload):
    OUT.buffer.write((json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    OUT.buffer.flush()


def unavailable(reason):
    emit({"status": "UNAVAILABLE", "reason": reason, "source": "moomoo OpenD", "checked_at_utc": now_utc()})
    return EXIT_UNAVAILABLE


def number(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def check_gateway():
    try:
        with socket.create_connection((HOST, PORT), timeout=CONNECT_SECONDS):
            pass
    except OSError as error:
        raise Unavailable("OpenD is not reachable at {}:{} ({})".format(HOST, PORT, error.__class__.__name__))


def sdk_output():
    """SDK imports and calls print connection logs; keep them off stdout."""
    return contextlib.redirect_stdout(sys.stderr)


def global_state(OpenQuoteContext, RET_OK, need_trading=False):
    quote = OpenQuoteContext(host=HOST, port=PORT)
    try:
        ret, state = quote.get_global_state()
    finally:
        quote.close()
    if ret != RET_OK:
        raise Unavailable("OpenD state query failed")
    if not state.get("qot_logined") or (need_trading and not state.get("trd_logined")):
        raise Unavailable("OpenD is not logged in to quotes{}".format(" and trading" if need_trading else ""))
    return state


def live_account(trade, RET_OK, TrdEnv):
    """The one live, US-enabled account; never printed."""
    ret, accounts = trade.get_acc_list()
    if ret != RET_OK:
        raise Unavailable("account list query failed")
    live = accounts[(accounts["trd_env"] == TrdEnv.REAL)
                    & accounts["trdmarket_auth"].apply(lambda markets: "US" in list(markets))]
    if len(live) != 1:
        raise Unavailable("expected exactly one live US-enabled account, found {}".format(len(live)))
    return int(live.iloc[0]["acc_id"])


def run(read, render):
    """read() does the SDK work; render(result) builds the output object."""
    result = {}

    def work():
        try:
            check_gateway()
            result["value"] = read()
        except Unavailable as error:
            result["unavailable"] = str(error)
        except Exception as error:      # the SDK raises assorted errors; never guess past one
            result["unavailable"] = "moomoo query error ({})".format(error.__class__.__name__)

    worker = threading.Thread(target=work, daemon=True)
    worker.start()
    worker.join(WATCHDOG_SECONDS)
    if worker.is_alive():
        code = unavailable("OpenD did not answer within {} s".format(WATCHDOG_SECONDS))
        os._exit(code)                  # SDK threads may still be waiting on the gateway
    if "unavailable" in result:
        return unavailable(result["unavailable"])
    emit(render(result["value"]))
    return 0
