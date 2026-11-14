from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from backend.problems.mars_route.layers import build_layers, load_layers  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="config/mission.yaml")
    args = parser.parse_args()

    config = yaml.safe_load((ROOT / args.config).read_text(encoding="utf-8"))
    layers = build_layers(
        ROOT / "data" / "raw",
        ROOT / "data" / "processed",
        tuple(config["bbox"]),
        int(config["grid_size"]),
    )
    meta = json.loads((ROOT / "data" / "processed" / "layers_meta.json").read_text(encoding="utf-8"))
    valid = layers["valid"].astype(bool)
    print(f"Grilla: {layers['dem'].shape[0]} x {layers['dem'].shape[1]}")
    print(f"Celda: {meta['dx_m']:.2f} m x {meta['dy_m']:.2f} m")
    print(f"Validos: {100.0 * valid.mean():.1f} %")
    print(f"Elevacion: {np.nanmin(layers['dem']):.0f} a {np.nanmax(layers['dem']):.0f} m")
    print(f"Pendiente media: {np.nanmean(layers['slope']):.1f} deg, maxima: {np.nanmax(layers['slope']):.1f} deg")
    reloaded = load_layers(ROOT / "data" / "processed" / "layers.npz")
    print(f"Capas guardadas: {', '.join(sorted(reloaded))}")


if __name__ == "__main__":
    main()
