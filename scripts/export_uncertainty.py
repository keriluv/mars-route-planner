"""Uncertainty of the traversability random forest: disagreement between trees.

For each cell, each of the 300 trees is asked for the probability of "traversable terrain"
and the amount of disagreement is measured (standard deviation). If they all agree, confidence is high; if
some say "easy" and others "hard", it is low.

IMPORTANT: disagreement between trees does NOT measure all of the uncertainty. Outside the training
corridor the trees can agree and be wrong together. That is why the script also
computes what share of the terrain falls outside the range of variables the model saw during training.

Requires data/processed/layers.npz (python scripts/build_layers.py) and models/terrain_model.joblib.
Generates:
  web/data/uncertainty_data.js  -> window.MARS_EXTRA ("confidence" layer at 300 × 300, loaded as a script)
  models/uncertainty_summary.json -> figures for docs/ and for the dashboard
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from export_web import GRID, b64, block_mean, q8  # noqa: E402
from marsroute.layers import load_layers  # noqa: E402
from marsroute.model import FEATURES, build_dataset, feature_matrix, load_model  # noqa: E402

STD_CAP = 0.5  # a deviation of 0.5 is the maximum possible between probabilities from 0 to 1


def tree_spread(model, X: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Mean and standard deviation of the per-tree probabilities, without storing the 300 maps."""
    n = len(model.estimators_)
    s = np.zeros(X.shape[0], dtype="float64")
    s2 = np.zeros(X.shape[0], dtype="float64")
    for tree in model.estimators_:
        p = tree.predict_proba(X)[:, 1].astype("float64")
        s += p
        s2 += p * p
    mean = s / n
    return mean, np.sqrt(np.maximum(s2 / n - mean * mean, 0.0))


def main() -> None:
    config = yaml.safe_load((ROOT / "config" / "mission.yaml").read_text(encoding="utf-8"))
    layers = load_layers(ROOT / "data" / "processed" / "layers.npz")
    model = load_model(ROOT / "models")
    shape = layers["dem"].shape
    X = feature_matrix(layers).reshape(-1, len(FEATURES))

    mean, std = tree_spread(model, X)
    ref = model.predict_proba(X)[:, 1]
    assert np.allclose(mean, ref, atol=1e-4), "the per-tree mean does not match predict_proba"
    mean, std = mean.reshape(shape), std.reshape(shape)
    confidence = 1.0 - np.clip(std / STD_CAP, 0.0, 1.0)

    # what share of the terrain falls outside what the model saw? (range of each feature in training)
    rows, cols, _labels, progress = build_dataset(
        layers, config["model"]["positive_buffer_m"], config["model"]["negative_buffer_m"],
        config["model"].get("hazard_fraction", 0.7), config["model"].get("seed", 7))
    train = feature_matrix(layers)[rows, cols][progress < 0.7]
    lo, hi = train.min(axis=0), train.max(axis=0)
    feats = feature_matrix(layers)
    outside_any = np.zeros(shape, dtype=bool)
    outside_by_feature = {}
    for i, name in enumerate(FEATURES):
        out = (feats[..., i] < lo[i]) | (feats[..., i] > hi[i])
        outside_by_feature[name] = float(out.mean())
        outside_any |= out

    dist_km = layers["traverse_distance"]
    bands = {"within 1 km of the traverse": dist_km <= 1.0, "1 to 10 km": (dist_km > 1.0) & (dist_km <= 10.0),
             "beyond 10 km": dist_km > 10.0}
    by_band = {k: {"cells_pct": float(100 * m.mean()), "mean_tree_std": float(std[m].mean()),
                   "mean_confidence": float(confidence[m].mean()), "out_of_range_pct": float(100 * outside_any[m].mean()),
                   "mean_traversability": float(mean[m].mean())} for k, m in bands.items() if m.any()}

    # over the routes exported to the web (lon/lat points → 44 m cell)
    bbox = config["bbox"]
    routes_file = ROOT / "web" / "data" / "routes.json"
    route_stats = {}
    if routes_file.exists():
        routes = json.loads(routes_file.read_text(encoding="utf-8"))
        for name, r in routes.items():
            pts = r["points"] if isinstance(r, dict) and "points" in r else r
            if not isinstance(pts, list) or not pts:
                continue
            ci = np.clip(((np.array([p[0] for p in pts]) - bbox[0]) / (bbox[2] - bbox[0]) * shape[1]).astype(int), 0, shape[1] - 1)
            ri = np.clip(((bbox[3] - np.array([p[1] for p in pts])) / (bbox[3] - bbox[1]) * shape[0]).astype(int), 0, shape[0] - 1)
            route_stats[name] = {"mean_confidence": float(confidence[ri, ci].mean()), "out_of_range_pct": float(100 * outside_any[ri, ci].mean()),
                                 "points": len(pts)}

    summary = {
        "trees": len(model.estimators_),
        "tree_std": {"media": float(std.mean()), "p50": float(np.percentile(std, 50)), "p90": float(np.percentile(std, 90)),
                         "max": float(std.max())},
        "low_confidence_cells_pct": float(100 * (confidence < 0.5).mean()),
        "out_of_training_range_pct": float(100 * outside_any.mean()),
        "out_of_range_by_feature_pct": {k: 100 * v for k, v in outside_by_feature.items()},
        "training_range": {n: [float(lo[i]), float(hi[i])] for i, n in enumerate(FEATURES)},
        "by_distance_to_traverse": by_band, "routes": route_stats,
        "note": "Disagreement between trees does not cover the extrapolation error outside the training corridor.",
    }
    (ROOT / "models" / "uncertainty_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")

    conf_s = block_mean(confidence.astype("float32"), GRID)
    extra = {
        "confidence": {"b64": b64(q8(conf_s, 0, 1)), "dtype": "u8", "min": 0, "max": 1, "unit": "index"},
        "summary": {k: summary[k] for k in ("trees", "tree_std", "low_confidence_cells_pct", "out_of_training_range_pct",
                                              "by_distance_to_traverse", "routes")},
    }
    out = ROOT / "web" / "data" / "uncertainty_data.js"
    out.write_text("window.MARS_EXTRA=" + json.dumps(extra, ensure_ascii=False) + ";\n", encoding="utf-8")
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    print(f"\nWritten {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
