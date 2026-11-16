"""Runs all the browser tests (Playwright) one after another and summarizes the result.

Requirements: pip install playwright (uses the installed Edge/Chrome; it does not download browsers).
Usage:
    python tests/run_web_tests.py            # all
    python tests/run_web_tests.py e2e fase4  # only some

The Phase 4 test server uses its own Python (the first one that has yaml, numpy and scipy); it can be
forced with the MARS_SERVER_PYTHON variable.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SUITES = {
    "fase1": "Radiation (layer, indicator, critical alert, return to shelter)",
    "fase2": "Model confidence and limitations",
    "fase3": "Configurable EVA workday and sols",
    "fase4": "Shared notices (file://, backend, SQLite, JSONL)",
    "e2e": "Complete end-to-end traverse",
}


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # the Windows console uses cp1252 by default
    chosen = [a for a in sys.argv[1:] if a in SUITES] or list(SUITES)
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    rows, failed = [], False
    for name in chosen:
        script = HERE / ("web_e2e.py" if name == "e2e" else f"web_{name}.py")
        t0 = time.time()
        out = subprocess.run([sys.executable, str(script)], capture_output=True, text=True, encoding="utf-8", env=env, cwd=str(HERE.parent))
        m = re.findall(r"(\d+)/(\d+) checks passed", out.stdout)
        ok = out.returncode == 0 and bool(m)
        failed |= not ok
        rows.append((name, SUITES[name], f"{m[-1][0]}/{m[-1][1]}" if m else "no result", "OK" if ok else "FAIL", time.time() - t0))
        if not ok:
            print(f"--- {name}: output ---\n" + "\n".join(l for l in out.stdout.splitlines() if l.startswith("FAIL")) + "\n" + out.stderr[-1500:])
    print("\nBrowser test summary")
    for name, desc, res, st, secs in rows:
        print(f"  {st:5} {name:6} {res:>7}  {secs:5.0f} s  {desc}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
