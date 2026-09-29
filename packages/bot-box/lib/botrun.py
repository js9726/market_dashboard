"""Trusted entry point for every program the private bot may run (review finding B6).

The bot's permissions allow one program-running command shape and nothing else:

    "<absolute python>" -I "<absolute path>/packages/bot-box/lib/botrun.py" <tool> [args]

`-I` keeps this runner free of PYTHON* variables, the current directory and user site
packages. The runner - not the command text - then decides what executes:

- a tool name maps to one fixed script inside the two canonical repositories; paths,
  scratch files and unknown names are refused;
- a tool never runs from the working tree. The runner copies the code files of the
  tool's directory, as they are in the last commit (HEAD), straight from Git's object
  store into a fresh temporary folder and runs the tool there. Untracked, ignored,
  modified or staged files in the checkout - including anything the bot wrote - are
  never executed or imported, and they cannot make a tool unavailable either. Links in
  the checkout are never followed; a link committed as tool code is refused;
- arguments are checked against a per-tool schema; no tool has an output option; a
  location a tool would otherwise derive from its own path (lint_wiki's wiki root) is
  added by the runner, never by the bot;
- the child runs as `python -E -B -X pycache_prefix=<fresh temp dir> <copied script>`
  from the copy's folder with every PYTHON* variable removed, so the current directory,
  PYTHONPATH/PYTHONSTARTUP and stale bytecode cannot substitute code. User site
  packages stay enabled because the tools' libraries (moomoo, pandas, yfinance) are
  installed there; the bot cannot write to that directory. wiki_search runs with the
  wiki retrieval environment's Python (jie_wiki/scripts/retrieval/.venv, ignored and
  equally out of the bot's reach) because its tokenizer is installed only there;
- wiki_search is pinned to keyword-only search (no index, key, network or write) and
  the bot's question is passed as one argument after "--".

    python -I lib/botrun.py --list
    python -I lib/botrun.py --check measure_tickers --tickers VEEV   (verify, do not run)
    python -I lib/botrun.py --check-all        (preflight: every tool's committed code)
"""
from __future__ import annotations

from datetime import date
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve()
DASH_ROOT = HERE.parents[3]                 # market_dashboard/packages/bot-box/lib/botrun.py
WIKI_ROOT = DASH_ROOT.parent / "jie_wiki"

TICKER = r"[A-Z][A-Z0-9.\-]{0,11}"
TICKERS = re.compile(r"{0}(,{0}){{0,39}}\Z".format(TICKER))
CODE_SUFFIXES = {".py", ".pyc", ".pyo", ".pyd", ".pth", ".so", ".dll", ".zip", ".egg"}
REGULAR_FILE_MODES = {"100644", "100755"}


class Refused(Exception):
    """A request the runner will not execute. The message is safe to show the bot."""


# A validator returns the value to pass on (possibly normalised) or None to refuse.
def _choice(*values):
    return lambda v: v if v in values else None


def _match(pattern):
    compiled = re.compile(pattern)
    return lambda v: v if compiled.fullmatch(v) else None


def _number(low, high):
    def check(value):
        if not re.fullmatch(r"[0-9]+(\.[0-9]+)?(e[0-9]+)?", value):
            return None
        return value if low <= float(value) <= high else None
    return check


def _iso_date(value):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return None
    try:
        date.fromisoformat(value)
    except ValueError:
        return None
    return value


def _data_dir(value):
    """A directory the tool reads. It must resolve inside one of the two repositories and is
    passed on as an absolute path, because the tool runs from its own directory."""
    if not value or value.startswith("-") or "\x00" in value:
        return None
    try:
        path = Path(value)
        resolved = (path if path.is_absolute() else WIKI_ROOT / path).resolve()
    except (OSError, RuntimeError, ValueError):
        return None
    roots = (WIKI_ROOT.resolve(), DASH_ROOT.resolve())
    if not resolved.is_dir() or not any(resolved == r or r in resolved.parents for r in roots):
        return None
    return str(resolved)


def _text(limit):
    """Free text passed as one argument (never through a shell): 1..limit characters, no
    control characters, not blank."""
    return lambda v: v if 0 < len(v) <= limit and v.strip() and not re.search(r"[\x00-\x1f\x7f]", v) else None


FLAG = object()  # an option that takes no value
TICKER_LIST = _match(r"{0}(,{0}){{0,39}}".format(TICKER))
OPTIONAL_TICKER_LIST = _match(r"(|{0}(,{0}){{0,39}})".format(TICKER))

# tool -> (repository root, script path, {option: validator or FLAG}, required options)
TOOLS = {
    "measure_tickers": (DASH_ROOT, "packages/bot-box/tools/measure_tickers.py",
                        {"--tickers": TICKER_LIST, "--peers": OPTIONAL_TICKER_LIST,
                         "--source": _choice("auto", "opend", "yahoo")}, {"--tickers"}),
    "breadth_ma": (DASH_ROOT, "packages/core-skills/morning-brief/breadth_ma.py",
                   {"--universe": _choice("sp500", "liquid-us"), "--min-cap": _number(0, 1e13),
                    "--min-price": _number(0, 1e6), "--min-vol": _number(0, 1e11), "--json": FLAG}, set()),
    "market_edge": (DASH_ROOT, "packages/core-skills/morning-brief/market_edge.py",
                    {"--ticker": _match(TICKER), "--json": FLAG}, set()),
    "industry_proxies": (DASH_ROOT, "packages/core-skills/morning-brief/industry_proxies.py",
                         {"--tickers": TICKER_LIST, "--host": _choice("127.0.0.1"),
                          "--port": _match(r"[1-9][0-9]{3,4}")}, set()),
    "lint_wiki": (WIKI_ROOT, "scripts/lint_wiki.py", {}, set()),
    "carry_forward": (WIKI_ROOT, "skills/tradingview-daily-screener/scripts/carry_forward.py",
                      {"--verdicts-dir": _data_dir, "--asof": _iso_date, "--universe": TICKER_LIST,
                       "--lookback": _match(r"[1-9][0-9]?"), "--held": OPTIONAL_TICKER_LIST,
                       "--drop": _match(r"{0}=[^\x00-\x1f]{{1,200}}".format(TICKER)), "--json": FLAG},
                      {"--verdicts-dir", "--asof", "--universe"}),
    # Read-only moomoo positions; no options, so the bot cannot change what it reads.
    "positions": (DASH_ROOT, "packages/bot-box/tools/positions.py", {}, set()),
    # Keyword search of the current wiki files: no index, key, network or write.
    "wiki_search": (WIKI_ROOT, "scripts/retrieval/query.py",
                    {"--question": _text(300), "--limit": _match(r"[1-9]|1[0-9]|20")}, {"--question"}),
    # Gate 3 (2026-09-29).
    # Hybrid wiki RAG on the existing Gemini index, read-only (--no-repair): it refuses when
    # the index is out of date, and the bot then falls back to wiki_search.
    "wiki_rag": (WIKI_ROOT, "scripts/retrieval/query.py",
                 {"--question": _text(300), "--limit": _match(r"[1-9]|1[0-9]|20")}, {"--question"}),
    "quotes": (DASH_ROOT, "packages/bot-box/tools/quotes.py", {"--tickers": TICKER_LIST}, {"--tickers"}),
    "trades": (DASH_ROOT, "packages/bot-box/tools/trades.py", {"--days": _match(r"[1-9]|[1-8][0-9]|90")}, set()),
    "screener": (DASH_ROOT, "packages/bot-box/tools/screener.py",
                 {"--screener": _match(r"[a-z0-9][a-z0-9-]{0,39}"), "--limit": _match(r"[1-9]|[1-4][0-9]|50")},
                 set()),
    "theme_radar": (DASH_ROOT, "packages/core-skills/morning-brief/theme_radar.py",
                    {"--json": FLAG, "--book": TICKER_LIST}, set()),
    # 2026-09-29: working orders and stop coverage (read-only OpenD), and HTML report -> PNG.
    "orders": (DASH_ROOT, "packages/bot-box/tools/orders.py", {}, set()),
    # Writes one PNG beside the report, inside outputs/bot-box only (the runner fixes --root).
    "render_report": (DASH_ROOT, "packages/bot-box/tools/render_report.py",
                      {"--file": _match(r"[A-Za-z0-9][A-Za-z0-9._ -]{0,80}(/[A-Za-z0-9][A-Za-z0-9._ -]{0,80}){0,3}\.html")},
                      {"--file"}),
}
REPEATABLE = {("carry_forward", "--drop")}
# Arguments the runner appends itself: the copy runs outside the repository, so a tool
# that would locate data from its own path is told the canonical location instead.
# wiki_search is pinned to keyword-only mode here, whatever the bot asks.
_RETRIEVAL_PYTHON = [WIKI_ROOT / "scripts/retrieval/.venv/Scripts/python.exe",
                     WIKI_ROOT / "scripts/retrieval/.venv/bin/python"]
FIXED_ARGS = {"lint_wiki": ["--wiki-root", str(WIKI_ROOT / "wiki")],
              "wiki_search": ["--repo", str(WIKI_ROOT), "--provider", "gemini", "--lexical-only", "--json"],
              # The index is named explicitly because the copy runs outside the repository.
              "wiki_rag": ["--repo", str(WIKI_ROOT), "--provider", "gemini",
                           "--index", str(WIKI_ROOT / "scripts/retrieval/.index-gemini"), "--no-repair", "--json"],
              # The canonical screener definitions; the bot cannot choose another file.
              "screener": ["--config", str(DASH_ROOT / "apps/market_dashboard_backend/scripts/tv-screeners.json")],
              # The bot's only writable folder; render_report refuses anything outside it.
              "render_report": ["--root", str(WIKI_ROOT / "outputs/bot-box")]}
# An option whose value the tool takes as its positional argument, placed last after "--".
POSITIONAL = {"wiki_search": "--question", "wiki_rag": "--question"}
# A tool that needs libraries this interpreter lacks runs with its own environment's Python
# (trusted like user site-packages: an ignored folder the bot cannot write to).
INTERPRETERS = {"wiki_search": _RETRIEVAL_PYTHON, "wiki_rag": _RETRIEVAL_PYTHON}


def validate_args(tool, args):
    """Return the argument list if every token fits the tool's schema, else refuse."""
    _, _, schema, required = TOOLS[tool]
    seen, out, i = set(), [], 0
    while i < len(args):
        token = args[i]
        name, eq, inline = token.partition("=")
        if not name.startswith("--") or name not in schema:
            raise Refused("{} does not accept {!r}".format(tool, token[:40]))
        if name in seen and (tool, name) not in REPEATABLE:
            raise Refused("{} option {} given twice".format(tool, name))
        seen.add(name)
        check = schema[name]
        if check is FLAG:
            if eq:
                raise Refused("{} option {} takes no value".format(tool, name))
            out.append(name)
            i += 1
            continue
        if eq:
            value = inline
            i += 1
        else:
            if i + 1 >= len(args):
                raise Refused("{} option {} needs a value".format(tool, name))
            value = args[i + 1]
            i += 2
        checked = None if value.startswith("-") else check(value)
        if checked is None:
            raise Refused("{} option {} has an invalid value".format(tool, name))
        out += [name, checked]
    missing = required - seen
    if missing:
        raise Refused("{} needs {}".format(tool, ", ".join(sorted(missing))))
    return out


def _git(repo, *args, stdin=None):
    """Run git on a canonical repository. GIT_* variables are dropped and replacement
    objects ignored, so nothing outside the repository can redirect what is read."""
    git = shutil.which("git")
    if git is None:
        raise Refused("git is not available to read the tool")
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith("GIT_")}
    return subprocess.run([git, "--no-replace-objects", "-C", str(repo), *args], input=stdin,
                          capture_output=True, env=env)


def snapshot(repo, relative, into):
    """Copy the code files of the tool's directory, as committed at HEAD, from Git's object
    store into `into`. Returns (commit, copied script, file count). Nothing is read from
    the working tree, so untracked, ignored, modified or linked files there never run."""
    head = _git(repo, "rev-parse", "--verify", "HEAD^{commit}")
    if head.returncode != 0:
        raise Refused("could not read the last commit of " + Path(repo).name)
    commit = head.stdout.decode("ascii").strip()
    rel_dir = PurePosixPath(relative).parent
    listing = _git(repo, "ls-tree", "-r", "-z", "--full-tree", commit, "--", rel_dir.as_posix() + "/")
    if listing.returncode != 0:
        raise Refused("could not list the tool's committed files")
    entries = []
    for record in listing.stdout.split(b"\0"):
        if not record:
            continue
        meta, _, raw_path = record.partition(b"\t")
        mode, _, sha = meta.decode("ascii").split()
        path = PurePosixPath(raw_path.decode("utf-8"))
        if path.suffix.lower() not in CODE_SUFFIXES:
            continue
        if mode not in REGULAR_FILE_MODES:
            raise Refused("committed tool code contains a link or submodule: " + path.as_posix())
        parts = path.relative_to(rel_dir).parts
        if ".." in parts:
            raise Refused("committed tool path is not inside its directory: " + path.as_posix())
        entries.append((parts, sha))
    script_parts = PurePosixPath(relative).relative_to(rel_dir).parts
    if script_parts not in [parts for parts, _ in entries]:
        raise Refused("tool script is not in the last commit: " + relative)
    batch = _git(repo, "cat-file", "--batch", stdin="".join(sha + "\n" for _, sha in entries).encode("ascii"))
    data, pos = batch.stdout, 0
    for parts, sha in entries:
        end = data.find(b"\n", pos)
        header = data[pos:end].decode("ascii", "replace").split() if end >= 0 else []
        if batch.returncode != 0 or len(header) != 3 or header[0] != sha or header[1] != "blob":
            raise Refused("could not read committed file " + "/".join(parts))
        size = int(header[2])
        target = Path(into).joinpath(*parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data[end + 1:end + 1 + size])
        pos = end + 1 + size + 1
    return commit, Path(into).joinpath(*script_parts), len(entries)


def child_environment():
    return {k: v for k, v in os.environ.items() if not k.upper().startswith("PYTHON")}


def tool_arguments(tool, args):
    """The checked bot arguments, then the runner's own, then any positional value."""
    arguments = validate_args(tool, list(args))
    positional = []
    if tool in POSITIONAL:
        at = arguments.index(POSITIONAL[tool])
        positional = ["--", arguments[at + 1]]
        del arguments[at:at + 2]
    return arguments + FIXED_ARGS.get(tool, []) + positional


def interpreter(tool):
    for candidate in INTERPRETERS.get(tool, []):
        if candidate.is_file():
            return str(candidate)
    if tool in INTERPRETERS:
        raise Refused("the Python environment for {} is missing".format(tool))
    return sys.executable


def run_tool(tool, args, check_only=False):
    if tool not in TOOLS:
        raise Refused("unknown tool {!r}; run --list".format(tool[:60]))
    repo, relative, _, _ = TOOLS[tool]
    arguments = tool_arguments(tool, args)
    python = interpreter(tool)
    with tempfile.TemporaryDirectory(prefix="botrun-", ignore_cleanup_errors=True) as temp:
        commit, script, count = snapshot(repo, relative, Path(temp) / "code")
        if check_only:
            print("ok: {} -> {} at {} ({} code files) {}".format(
                tool, relative, commit[:12], count, " ".join(arguments)).rstrip())
            return 0
        command = [python, "-E", "-B", "-X", "pycache_prefix=" + str(Path(temp) / "pycache"),
                   str(script), *arguments]
        # No tool reads input; an empty stdin means nothing can wait interactively.
        return subprocess.run(command, cwd=script.parent, env=child_environment(),
                              stdin=subprocess.DEVNULL).returncode


def check_all():
    """Preflight: copy every tool's committed code without running anything."""
    refused = 0
    for tool in sorted(TOOLS):
        repo, relative, _, _ = TOOLS[tool]
        try:
            interpreter(tool)
            with tempfile.TemporaryDirectory(prefix="botrun-", ignore_cleanup_errors=True) as temp:
                commit, _, count = snapshot(repo, relative, Path(temp) / "code")
            print("ok       {:<17} {} at {} ({} code files)".format(tool, relative, commit[:12], count))
        except Refused as refusal:
            refused += 1
            print("REFUSED  {:<17} {}".format(tool, refusal))
    return 2 if refused else 0


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    if argv[0] == "--list":
        for name, (repo, relative, schema, required) in sorted(TOOLS.items()):
            options = " ".join(sorted(schema)) or "(no options)"
            print("{:<17} {}  [{}]".format(name, (repo / relative).as_posix(), options))
        return 0
    if argv == ["--check-all"]:
        return check_all()
    check_only = argv[0] == "--check"
    if check_only:
        argv = argv[1:]
    if not argv:
        print("BOTRUN REFUSED: name a tool; run --list", file=sys.stderr)
        return 2
    try:
        return run_tool(argv[0], argv[1:], check_only)
    except Refused as refusal:
        print("BOTRUN REFUSED: {}".format(refusal), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
