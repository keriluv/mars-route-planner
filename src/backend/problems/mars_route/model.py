from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
from scipy import ndimage
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    confusion_matrix,
    f1_score,
    roc_auc_score,
)

FEATURES = (
    "slope",
    "roughness",
    "texture",
    "gradient",
    "thermal",
)


@dataclass
class TrainingReport:
    metrics: dict
    feature_importance: dict


def feature_matrix(layers: dict, features=None) -> np.ndarray:
    names = FEATURES if features is None else features
    return np.stack([layers[name] for name in names], axis=-1).astype("float32")


def path_progress(layers: dict) -> np.ndarray:
    mask = layers["traverse_distance"] <= 0.0
    _, indices = ndimage.distance_transform_edt(~mask, return_indices=True)
    nearest_row = indices[0].astype("float32")
    low, high = float(nearest_row.min()), float(nearest_row.max())
    return (nearest_row - low) / max(high - low, 1.0)


def build_dataset(
    layers: dict,
    positive_buffer_m: float,
    negative_buffer_m: float,
    hazard_fraction: float = 0.7,
    seed: int = 7,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    valid = layers["valid"].astype(bool)
    distance_m = layers["traverse_distance"] * 1000.0
    positives = valid & (distance_m <= positive_buffer_m)
    candidates = valid & (distance_m > negative_buffer_m)

    rng = np.random.default_rng(seed)
    positive_rows, positive_columns = np.nonzero(positives)
    positive_count = positive_rows.size

    texture_threshold = float(np.percentile(layers["texture"][valid], 75))
    hazard = (layers["slope"] > 15.0) | (layers["texture"] > texture_threshold)
    hazard_candidates = np.nonzero(candidates & hazard)
    plain_candidates = np.nonzero(candidates & ~hazard)

    hazard_count = min(int(positive_count * hazard_fraction), hazard_candidates[0].size)
    plain_count = min(positive_count - hazard_count, plain_candidates[0].size)
    hazard_pick = rng.choice(hazard_candidates[0].size, hazard_count, replace=False)
    plain_pick = rng.choice(plain_candidates[0].size, plain_count, replace=False)

    negative_rows = np.concatenate(
        [hazard_candidates[0][hazard_pick], plain_candidates[0][plain_pick]]
    )
    negative_columns = np.concatenate(
        [hazard_candidates[1][hazard_pick], plain_candidates[1][plain_pick]]
    )

    rows = np.concatenate([positive_rows, negative_rows])
    columns = np.concatenate([positive_columns, negative_columns])
    labels = np.concatenate(
        [np.ones(positive_count, dtype="int8"), np.zeros(negative_rows.size, dtype="int8")]
    )
    progress = path_progress(layers)
    return rows, columns, labels, progress[rows, columns]


def train_model(
    layers: dict,
    positive_buffer_m: float,
    negative_buffer_m: float,
    n_estimators: int,
    max_depth: int,
    min_samples_leaf: int,
    hazard_fraction: float = 0.7,
    seed: int = 7,
) -> tuple[RandomForestClassifier, TrainingReport]:
    rows, columns, labels, progress = build_dataset(
        layers, positive_buffer_m, negative_buffer_m, hazard_fraction, seed
    )
    samples = feature_matrix(layers)[rows, columns]

    train_mask = progress < 0.7
    validation_mask = (progress >= 0.7) & (progress < 0.85)
    test_mask = progress >= 0.85

    model = RandomForestClassifier(
        n_estimators=n_estimators,
        max_depth=max_depth,
        min_samples_leaf=min_samples_leaf,
        class_weight="balanced",
        n_jobs=-1,
        random_state=seed,
    )
    model.fit(samples[train_mask], labels[train_mask])

    metrics = {}
    for name, mask in (("validation", validation_mask), ("test", test_mask)):
        if mask.sum() == 0 or labels[mask].min() == labels[mask].max():
            continue
        probabilities = model.predict_proba(samples[mask])[:, 1]
        predictions = (probabilities >= 0.5).astype("int8")
        matrix = confusion_matrix(labels[mask], predictions, labels=[0, 1])
        metrics[name] = {
            "samples": int(mask.sum()),
            "positives": int(labels[mask].sum()),
            "roc_auc": float(roc_auc_score(labels[mask], probabilities)),
            "average_precision": float(average_precision_score(labels[mask], probabilities)),
            "accuracy": float(accuracy_score(labels[mask], predictions)),
            "f1": float(f1_score(labels[mask], predictions)),
            "confusion_matrix": matrix.tolist(),
        }

    metrics["train"] = {
        "samples": int(train_mask.sum()),
        "roc_auc": float(
            roc_auc_score(labels[train_mask], model.predict_proba(samples[train_mask])[:, 1])
        ),
    }
    metrics["positives"] = int(labels.sum())
    metrics["negatives"] = int(labels.size - labels.sum())

    importance = {
        name: float(value) for name, value in zip(FEATURES, model.feature_importances_)
    }
    return model, TrainingReport(metrics=metrics, feature_importance=importance)


def save_model(model, report: TrainingReport, model_dir: Path) -> None:
    model_dir = Path(model_dir)
    model_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, model_dir / "terrain_model.joblib")
    (model_dir / "metrics.json").write_text(
        json.dumps(
            {"metrics": report.metrics, "feature_importance": report.feature_importance},
            indent=2,
        ),
        encoding="utf-8",
    )


def load_model(model_dir: Path):
    return joblib.load(Path(model_dir) / "terrain_model.joblib")


def predict_traversability(model, layers: dict) -> np.ndarray:
    features = feature_matrix(layers)
    flat = features.reshape(-1, features.shape[-1])
    probabilities = model.predict_proba(flat)[:, 1]
    return probabilities.reshape(layers["dem"].shape).astype("float32")
