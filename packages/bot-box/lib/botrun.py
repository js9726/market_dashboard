"""Trusted entry point for every program the private bot may run (review finding B6).

The bot's permissions allow one program-running command shape and nothing else:

    "<absolute python>" -I "<absolute path>/packages/bot-box/lib/botrun.py" <tool> [args]

`-I` keeps this runner free of PYTHON* variables, the current directory and user site
packages. The runner - not the command text - then decides what executes:

- a tool name maps to one fixed script inside the two canonical repositories; paths,
  scratch files and unknown names are refused;
- the script and every code file in its directory tree (which it may import) must be
  tracked by Git and identical to HEAD, and no untracked code may sit beside it, so a
  file the bot wrote - in scratch or anywhere else - never runs or shadows an import;
- the script and its directory must resolve inside the repository (no links out);
- arguments are checked against a per-tool schema; no tool has an output option;
- the child runs as `python -E -B -X pycache_prefix=<fresh temp dir> <script>` from
  the script's own directory with every PYTHON* variable removed, so the current
  directory, PYTHONPATH/PYTHONSTARTUP and stale bytecode cannot substitute code.
  User site packages stay enabled because the tools' libraries (moomoo, pandas,
  yfinance) are installed there; the bot cannot write to that directory.

    python -I lib/botrun.py --list
    python -I lib/botrun.py --check measure_tickers --tickers VEEV   (verify, do not run)
"""
from __future__ import annotations

from datetime import date
import os
from pathlib import Path
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
}
REPEATABLE = {("carry_forward", "--drop")}


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


def _git(repo, *args):
    git = shutil.which("git")
    if git is None:
        raise Refused("git is not available to verify the tool")
    return subprocess.run([git, "-C", str(repo), *args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace")


def _importable(rel_path, rel_dir, packages):
    """True if a repository path is code the tool could import from its own directory:
    a module file directly beside it, or anything inside a package directly beside it."""
    parts = Path(rel_path).relative_to(rel_dir).parts
    if "__pycache__" in parts or Path(rel_path).suffix.lower() not in CODE_SUFFIXES:
        return False
    return len(parts) == 1 or parts[0] in packages or (len(parts) == 2 and parts[1].startswith("__init__."))


def verify_identity(repo, relative):
    """Refuse unless the script and every importable file beside it are tracked, identical to
    HEAD and inside the repository. Ignored and untracked files count as untrusted."""
    repo = Path(repo).resolve()
    script = repo / relative
    if not script.is_file():
        raise Refused("tool script is missing: " + relative)
    resolved, folder = script.resolve(), script.parent.resolve()
    if resolved != script.absolute() or folder != script.parent.absolute() or repo not in folder.parents:
        raise Refused("tool script resolves outside its repository: " + relative)
    rel_dir = Path(relative).parent.as_posix()
    if _git(repo, "ls-files", "--error-unmatch", "--", relative).returncode != 0:
        raise Refused("tool script is not tracked by Git: " + relative)
    packages = {p.name for p in folder.iterdir() if p.is_dir() and any(
        (p / ("__init__" + s)).exists() for s in (".py", ".pyc", ".pyd"))}
    changed = _git(repo, "diff", "--name-only", "HEAD", "--", rel_dir)
    if changed.returncode != 0:
        raise Refused("could not compare the tool's directory with the last commit")
    modified = [p for p in changed.stdout.splitlines() if _importable(p, rel_dir, packages)]
    if modified:
        raise Refused("code beside the tool differs from the last commit: " + modified[0])
    others = _git(repo, "ls-files", "--others", "--", rel_dir).stdout.splitlines()
    stray = [p for p in others if _importable(p, rel_dir, packages)]
    if stray:
        raise Refused("untracked code sits beside the tool and could shadow its imports: " + stray[0])
    return resolved


def child_environment():
    return {k: v for k, v in os.environ.items() if not k.upper().startswith("PYTHON")}


def run_tool(tool, args, check_only=False):
    if tool not in TOOLS:
        raise Refused("unknown tool {!r}; run --list".format(tool[:60]))
    repo, relative, _, _ = TOOLS[tool]
    arguments = validate_args(tool, list(args))
    script = verify_identity(repo, relative)
    if check_only:
        print("ok: {} -> {} {}".format(tool, script, " ".join(arguments)))
        return 0
    with tempfile.TemporaryDirectory(prefix="botrun-pyc-") as pycache:
        command = [sys.executable, "-E", "-B", "-X", "pycache_prefix=" + pycache, str(script), *arguments]
        # No tool reads input; an empty stdin means nothing can wait interactively.
        return subprocess.run(command, cwd=script.parent, env=child_environment(),
                              stdin=subprocess.DEVNULL).returncode


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
