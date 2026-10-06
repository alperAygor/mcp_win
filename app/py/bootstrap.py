"""ArchMCP Python launcher for downloadable packs. Standard library only; run as:  python -I -S bootstrap.py [args...]

  ARCHMCP_SITE    the pack's own site-packages (every dependency the pack needs lives there)
  ARCHMCP_PATH    optional extra import root (the pack's `app` folder)
  ARCHMCP_MODULE  "package.module:function"   - import it and call the function
  ARCHMCP_SCRIPT  "path/to/script.py"         - run it as __main__ (its folder becomes the working directory)

-S keeps the interpreter's own site-packages out of sys.path, and the pack folder goes FIRST, so a pack can never pick
up (or be broken by) another MCP's versions of mcp, pydantic, ...: this is what makes dependency conflicts impossible.
"""
import importlib
import os
import runpy
import site
import sys


def prepare_path() -> None:
    site_dir = os.environ.get("ARCHMCP_SITE")
    if site_dir and os.path.isdir(site_dir):
        before = len(sys.path)
        site.addsitedir(site_dir)           # also processes .pth files (pywin32 needs this)
        added = sys.path[before:]
        del sys.path[before:]
        sys.path[0:0] = added               # pack first
    extra = os.environ.get("ARCHMCP_PATH")
    if extra and os.path.isdir(extra):
        sys.path.insert(0, extra)


def main() -> None:
    prepare_path()
    module = os.environ.get("ARCHMCP_MODULE")
    script = os.environ.get("ARCHMCP_SCRIPT")
    if module:
        name, _, func = module.partition(":")
        sys.argv = [name] + sys.argv[1:]
        getattr(importlib.import_module(name), func or "main")()
    elif script:
        folder = os.path.dirname(os.path.abspath(script))
        os.chdir(folder)
        sys.path.insert(0, folder)
        sys.argv = [script] + sys.argv[1:]
        runpy.run_path(script, run_name="__main__")
    else:
        sys.exit("ARCHMCP_MODULE or ARCHMCP_SCRIPT must be set")


if __name__ == "__main__":
    main()
