from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image
from scipy import ndimage

MARS_RADIUS_M = 3396190.0


@dataclass(frozen=True)
class Geometry:
    bbox: tuple[float, float, float, float]
    size: int
    dx_m: float
    dy_m: float
    lon: np.ndarray
    lat: np.ndarray

    @property
    def extent(self) -> tuple[float, float, float, float]:
        west, south, east, north = self.bbox
        return west, east, south, north


def make_geometry(bbox, size: int) -> Geometry:
    west, south, east, north = bbox
    dlon = (east - west) / size
    dlat = (north - south) / size
    lon = west + (np.arange(size) + 0.5) * dlon
    lat = north - (np.arange(size) + 0.5) * dlat
    m_per_deg_lat = np.pi / 180.0 * MARS_RADIUS_M
    m_per_deg_lon = m_per_deg_lat * np.cos(np.deg2rad((south + north) / 2.0))
    return Geometry(bbox, size, dlon * m_per_deg_lon, dlat * m_per_deg_lat, lon, lat)


def resize(array: np.ndarray, size: int) -> np.ndarray:
    if array.ndim == 2:
        image = Image.fromarray(array.astype("float32"), mode="F")
        return np.asarray(image.resize((size, size), Image.BILINEAR), dtype="float32")
    channels = [resize(array[..., index], size) for index in range(array.shape[2])]
    return np.stack(channels, axis=-1)


def local_std(array: np.ndarray, window: int) -> np.ndarray:
    values = array.astype("float64")
    mean = ndimage.uniform_filter(values, window, mode="nearest")
    mean_square = ndimage.uniform_filter(values * values, window, mode="nearest")
    return np.sqrt(np.maximum(mean_square - mean * mean, 0.0)).astype("float32")


def slope_degrees(dem: np.ndarray, dy_m: float, dx_m: float) -> np.ndarray:
    gradient_y, gradient_x = np.gradient(dem.astype("float64"), dy_m, dx_m)
    return np.degrees(np.arctan(np.hypot(gradient_x, gradient_y))).astype("float32")


def gradient_magnitude(array: np.ndarray) -> np.ndarray:
    values = array.astype("float32")
    gradient_y, gradient_x = np.gradient(values)
    return np.hypot(gradient_x, gradient_y).astype("float32")


def points_distance_km(lon: np.ndarray, lat: np.ndarray, points, geom: Geometry) -> np.ndarray:
    m_per_deg_lat = np.pi / 180.0 * MARS_RADIUS_M
    m_per_deg_lon = m_per_deg_lat * np.cos(np.deg2rad(float(np.mean(lat))))
    best = np.full(lon.shape, np.inf, dtype="float32")
    for point_lon, point_lat in points:
        delta_lon = (lon - point_lon) * m_per_deg_lon
        delta_lat = (lat - point_lat) * m_per_deg_lat
        distance = np.hypot(delta_lon, delta_lat)
        best = np.minimum(best, distance.astype("float32"))
    return best / 1000.0


def rasterize_boxes(boxes, geom: Geometry) -> np.ndarray:
    mask = np.zeros((geom.size, geom.size), dtype=bool)
    west, south, east, north = geom.bbox
    for box_west, box_south, box_east, box_north in boxes:
        column0 = int(np.floor((box_west - west) / (east - west) * geom.size))
        column1 = int(np.ceil((box_east - west) / (east - west) * geom.size))
        row0 = int(np.floor((north - box_north) / (north - south) * geom.size))
        row1 = int(np.ceil((north - box_south) / (north - south) * geom.size))
        column0, column1 = max(column0, 0), min(column1, geom.size)
        row0, row1 = max(row0, 0), min(row1, geom.size)
        if column1 > column0 and row1 > row0:
            mask[row0:row1, column0:column1] = True
    return mask


def rasterize_paths(paths, geom: Geometry) -> np.ndarray:
    mask = np.zeros((geom.size, geom.size), dtype=bool)
    west, south, east, north = geom.bbox
    for path in paths:
        coordinates = np.asarray(path, dtype="float64")
        column = ((coordinates[:, 0] - west) / (east - west) * geom.size).astype(int)
        row = ((north - coordinates[:, 1]) / (north - south) * geom.size).astype(int)
        valid = (column >= 0) & (column < geom.size) & (row >= 0) & (row < geom.size)
        mask[row[valid], column[valid]] = True
    return mask


def distance_km_from_mask(mask: np.ndarray, dx_m: float, dy_m: float) -> np.ndarray:
    distance = ndimage.distance_transform_edt(~mask, sampling=(dy_m, dx_m))
    return (distance / 1000.0).astype("float32")


def build_layers(raw_dir: Path, out_dir: Path, bbox, size: int) -> dict:
    raw_dir = Path(raw_dir)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    geom = make_geometry(bbox, size)

    dem_full = tifffile.imread(raw_dir / "gale_dem.tif").astype("float32")
    dem_full[dem_full < -1e30] = np.nan
    dem = resize(dem_full, size)
    dem_full_size = dem_full.shape[0]
    dem_dx = geom.dx_m * size / dem_full.shape[1]
    dem_dy = geom.dy_m * size / dem_full.shape[0]
    slope_full = slope_degrees(np.nan_to_num(dem_full, nan=float(np.nanmedian(dem_full))), dem_dy, dem_dx)
    roughness_full = local_std(np.nan_to_num(dem_full, nan=float(np.nanmedian(dem_full))), 7)
    slope = resize(slope_full, size)
    roughness = resize(roughness_full, size)

    optical_full = np.asarray(Image.open(raw_dir / "gale_optical.jpg").convert("L"), dtype="float32")
    texture_full = local_std(optical_full, 7)
    gradient_full = gradient_magnitude(optical_full)
    optical = resize(optical_full, size)
    texture = resize(texture_full, size)
    gradient = resize(gradient_full, size)

    thermal = resize(np.asarray(Image.open(raw_dir / "gale_themis_ir.png").convert("L"), dtype="float32"), size)

    viking = tifffile.imread(raw_dir / "gale_viking.tif").astype("float32")
    red = resize(viking[..., 0], size)
    blue = resize(viking[..., 2], size)
    color_index = (red - blue) / np.maximum(red + blue, 1.0)

    minerals = json.loads((raw_dir / "hydrous_minerals.json").read_text(encoding="utf-8"))
    mineral_points = [(item["lon"], item["lat"]) for item in minerals["features"]]
    if mineral_points:
        mineral_distance = points_distance_km(geom.lon[None, :], geom.lat[:, None], mineral_points, geom)
    else:
        mineral_distance = np.full((size, size), np.nan, dtype="float32")

    crism = json.loads((raw_dir / "crism_sites.json").read_text(encoding="utf-8"))
    crism_boxes = [
        (item["west"], item["south"], item["east"], item["north"])
        for item in crism["features"]
    ]
    spectral_coverage = rasterize_boxes(crism_boxes, geom).astype("float32")

    traverse = json.loads((raw_dir / "curiosity_traverse.json").read_text(encoding="utf-8"))
    traverse_mask = rasterize_paths(traverse["paths"], geom)
    traverse_distance = distance_km_from_mask(traverse_mask, geom.dx_m, geom.dy_m)

    valid = np.isfinite(dem) & np.isfinite(slope) & np.isfinite(optical)
    layers = {
        "dem": dem.astype("float32"),
        "slope": slope.astype("float32"),
        "roughness": roughness.astype("float32"),
        "optical": optical.astype("float32"),
        "texture": texture.astype("float32"),
        "gradient": gradient.astype("float32"),
        "thermal": thermal.astype("float32"),
        "color_index": color_index.astype("float32"),
        "spectral_coverage": spectral_coverage.astype("float32"),
        "mineral_distance": mineral_distance.astype("float32"),
        "traverse_distance": traverse_distance.astype("float32"),
        "valid": valid.astype("uint8"),
    }
    np.savez_compressed(out_dir / "layers.npz", **layers)
    metadata = {
        "bbox": list(bbox),
        "size": size,
        "dx_m": geom.dx_m,
        "dy_m": geom.dy_m,
        "extent": list(geom.extent),
        "cell_area_m2": geom.dx_m * geom.dy_m,
        "sources": {
            "dem": "MOLA/HRSC blended DEM 200 m (Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw), Mars Trek",
            "optical": "MOLA/HRSC color shaded relief 200 m (Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp), Mars Trek",
            "thermal": "THEMIS daytime IR 100 m mosaic, ASU JMARS",
            "color_index": "Viking MDIM 2.1 color mosaic 232 m, Mars Trek",
            "spectral_coverage": "CRISM MTRDR targeted footprints (humex FRT sites), Mars Trek",
            "minerals": "OMEGA/CRISM hydrous mineral detections, Mars Trek",
            "traverse": "Curiosity traverse, Mars Trek",
        },
    }
    (out_dir / "layers_meta.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return layers


def load_layers(path: Path) -> dict:
    with np.load(path) as data:
        return {key: data[key] for key in data.files}
