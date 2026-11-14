"""Launcher for the Mars route interactive simulator."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from backend.problems.mars_route.main import main


if __name__ == "__main__":
    main()
