from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from backend.problems.mars_route.layers import load_layers  # noqa: E402
from backend.problems.mars_route.model import save_model, train_model  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="config/mission.yaml")
    args = parser.parse_args()

    config = yaml.safe_load((ROOT / args.config).read_text(encoding="utf-8"))
    layers = load_layers(ROOT / "data" / "processed" / "layers.npz")
    model, report = train_model(layers, **config["model"])
    save_model(model, report, ROOT / "models")

    print(json.dumps(report.metrics, indent=2))
    print(json.dumps(report.feature_importance, indent=2))


if __name__ == "__main__":
    main()
