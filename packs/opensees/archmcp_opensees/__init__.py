"""ArchMCP OpenSeesPy server.

Tools:
  opensees_info          version + workspace + safety settings
  opensees_run_script    run an OpenSeesPy script in an isolated run folder (timeout, captured output)
  opensees_list_runs     previous runs
  opensees_read_file     read a file a run produced (text, size limited, confined to the workspace)
  opensees_examples      starter scripts (cantilever, portal frame)

SAFETY: structural-analysis results must be checked by a qualified engineer; never use them for design sign-off
without independent verification. Scripts run with the user's permissions, so by default a static check rejects
scripts that import file/process/network modules (OPENSEES_MCP_SAFE_MODE=0 turns that off).
"""
from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from mcp.server.fastmcp import FastMCP

__version__ = "0.1.0"

mcp = FastMCP("archmcp-opensees")

SAFE_MODE = os.environ.get("OPENSEES_MCP_SAFE_MODE", "1") != "0"
MAX_OUTPUT = 20_000
MAX_FILE = 200_000
DEFAULT_TIMEOUT = int(os.environ.get("OPENSEES_MCP_TIMEOUT", "120"))

# Modules a structural-analysis script does not need; each one opens a door to the rest of the PC.
_BLOCKED_IMPORTS = {
    "os", "subprocess", "socket", "shutil", "ctypes", "multiprocessing", "http", "urllib", "ftplib", "smtplib",
    "requests", "httpx", "pathlib", "importlib", "pty", "winreg", "msvcrt", "webbrowser", "pickle", "marshal", "builtins",
}
_BLOCKED_CALLS = {"eval", "exec", "compile", "open", "__import__", "input", "breakpoint"}
_ALLOWED_OPEN_NOTE = "file output: use opensees recorders or print(); direct open() is blocked in safe mode"


def workspace() -> Path:
    base = os.environ.get("OPENSEES_MCP_WORKSPACE")
    root = Path(base) if base else Path.home() / "Documents" / "ArchMCP" / "opensees"
    (root / "runs").mkdir(parents=True, exist_ok=True)
    return root


def check_script(code: str) -> list[str]:
    """Returns a list of problems; empty means the script passed the safe-mode check."""
    problems: list[str] = []
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return [f"syntax error: {e}"]
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name.split(".")[0] in _BLOCKED_IMPORTS:
                    problems.append(f"line {node.lineno}: import of '{a.name}' is blocked in safe mode")
        elif isinstance(node, ast.ImportFrom) and node.module and node.module.split(".")[0] in _BLOCKED_IMPORTS:
            problems.append(f"line {node.lineno}: import from '{node.module}' is blocked in safe mode")
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _BLOCKED_CALLS:
            problems.append(f"line {node.lineno}: call to '{node.func.id}()' is blocked in safe mode ({_ALLOWED_OPEN_NOTE})")
        # note: ops.system(...) is a legitimate OpenSees command; os/subprocess are blocked as imports instead
        elif isinstance(node, ast.Attribute) and node.attr in {"__subclasses__", "__globals__", "__builtins__", "__code__", "__closure__"}:
            problems.append(f"line {node.lineno}: attribute '{node.attr}' is blocked in safe mode")
    return problems


def _safe_name(name: str) -> str:
    cleaned = "".join(c if c.isalnum() or c in "-_" else "-" for c in name.strip())[:40]
    return cleaned or "model"


def _run_dir(run: str) -> Path:
    root = (workspace() / "runs").resolve()
    p = (root / run).resolve()
    if root not in p.parents and p != root:
        raise ValueError("run is outside the workspace")
    return p


@mcp.tool()
def opensees_info() -> dict:
    """OpenSeesPy version, workspace folder and safety settings."""
    try:
        import openseespy.opensees as ops  # noqa: F401
        from importlib.metadata import version
        ver = version("openseespy")
    except Exception as e:  # not importable on this machine
        ver = f"NOT AVAILABLE: {e}"
    return {"archmcp_opensees": __version__, "openseespy": ver, "workspace": str(workspace()),
            "safe_mode": SAFE_MODE, "default_timeout_s": DEFAULT_TIMEOUT,
            "warning": "Results must be verified by a qualified structural engineer before any design use."}


@mcp.tool()
def opensees_run_script(code: str, name: str = "model", timeout_s: int = DEFAULT_TIMEOUT) -> dict:
    """Run an OpenSeesPy (Python) script in a fresh, isolated run folder and return its output.

    The script should `import openseespy.opensees as ops`, build the model, analyse it and print results.
    Files written by recorders land in the run folder (see opensees_list_runs / opensees_read_file)."""
    if SAFE_MODE:
        problems = check_script(code)
        if problems:
            return {"ok": False, "rejected_by_safe_mode": problems}
    run_id = f"{time.strftime('%Y%m%d-%H%M%S')}-{_safe_name(name)}"
    rd = _run_dir(run_id)
    rd.mkdir(parents=True, exist_ok=True)
    script = rd / "model.py"
    script.write_text(code, encoding="utf-8")
    boot = ("import os,site,runpy;d=os.environ.get('ARCHMCP_SITE');"
            "d and site.addsitedir(d);runpy.run_path('model.py',run_name='__main__')")
    t0 = time.time()
    try:
        proc = subprocess.run([sys.executable, "-I", "-c", boot], cwd=rd, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=max(1, min(int(timeout_s), 3600)),
                              env={**os.environ, "PYTHONUTF8": "1"})
        out = {"ok": proc.returncode == 0, "exit_code": proc.returncode,
               "stdout": proc.stdout[-MAX_OUTPUT:], "stderr": proc.stderr[-MAX_OUTPUT:]}
    except subprocess.TimeoutExpired:
        out = {"ok": False, "error": f"timed out after {timeout_s}s"}
    out.update(run=run_id, seconds=round(time.time() - t0, 2),
               files=sorted(p.name for p in rd.iterdir() if p.is_file()))
    return out


@mcp.tool()
def opensees_list_runs(limit: int = 20) -> list[dict]:
    """Most recent runs and the files each produced."""
    root = workspace() / "runs"
    runs = sorted((p for p in root.iterdir() if p.is_dir()), key=lambda p: p.name, reverse=True)[:max(1, min(limit, 100))]
    return [{"run": p.name, "files": sorted(f.name for f in p.iterdir() if f.is_file())} for p in runs]


@mcp.tool()
def opensees_read_file(run: str, filename: str) -> dict:
    """Read a text file produced by a run (size limited, confined to the workspace)."""
    try:
        rd = _run_dir(run)
        target = (rd / filename).resolve()
    except (ValueError, OSError):
        return {"ok": False, "error": "invalid run or file name"}
    if rd not in target.parents or not target.is_file():
        return {"ok": False, "error": "file not found in that run"}
    data = target.read_bytes()[:MAX_FILE]
    return {"ok": True, "truncated": target.stat().st_size > MAX_FILE, "content": data.decode("utf-8", errors="replace")}


_EXAMPLES = {
    "cantilever": '''import openseespy.opensees as ops
ops.wipe(); ops.model('basic', '-ndm', 2, '-ndf', 3)
L, E, A, I, P = 3.0, 200e9, 0.01, 8e-5, -10e3
ops.node(1, 0, 0); ops.node(2, L, 0); ops.fix(1, 1, 1, 1)
ops.geomTransf('Linear', 1)
ops.element('elasticBeamColumn', 1, 1, 2, A, E, I, 1)
ops.timeSeries('Linear', 1); ops.pattern('Plain', 1, 1); ops.load(2, 0.0, P, 0.0)
ops.system('BandSPD'); ops.numberer('RCM'); ops.constraints('Plain')
ops.integrator('LoadControl', 1.0); ops.algorithm('Linear'); ops.analysis('Static'); ops.analyze(1)
print('tip deflection (m):', ops.nodeDisp(2, 2), ' analytical PL^3/3EI =', P*L**3/(3*E*I))''',
}


@mcp.tool()
def opensees_examples(name: str = "cantilever") -> dict:
    """Starter scripts. Currently: cantilever (tip deflection vs. the analytical result)."""
    return {"available": sorted(_EXAMPLES), "script": _EXAMPLES.get(name, "")}


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
