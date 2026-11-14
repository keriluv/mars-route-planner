from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from backend.problems.mars_conditions.rems import parse_sol  # noqa: E402

SOLS = (100, 4500)


def main() -> None:
    for sol in SOLS:
        sol_dir = ROOT / "data" / "raw" / "rems" / f"SOL{sol:05d}"
        out_csv = ROOT / "data" / "processed" / f"rems_sol{sol:05d}.csv"
        count = parse_sol(sol_dir, out_csv)
        print(f"Sol {sol}: {count} registros -> {out_csv.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
