from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
CACHE = ROOT / "data" / "cache"

BBOX = (137.18, -5.45, 138.08, -4.55)
REGION_BBOX = (136.60, -6.10, 138.90, -3.90)
DEM_SIZE = 1200
OPTICAL_SIZE = 1200
CONTEXT_SIZE = 1400

TREK = "https://trek.nasa.gov/mars/trekarcgis/rest/services"
REMS_BASE = "https://atmos.nmsu.edu/PDS/data/mslrem_1001/DATA"
REMS_SOLS = (100, 4500)

MARS_RADIUS_M = 3396190.0


def fetch(url: str, timeout: int = 180) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "mars-route-planner/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def download(url: str, destination: Path, timeout: int = 600) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and destination.stat().st_size > 0:
        return destination
    request = urllib.request.Request(url, headers={"User-Agent": "mars-route-planner/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response, destination.open("wb") as handle:
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            handle.write(chunk)
    return destination


def export_image(service: str, size: int, fmt: str, pixel_type: str, bbox=BBOX) -> bytes:
    west, south, east, north = bbox
    params = urllib.parse.urlencode(
        {
            "bbox": f"{west},{south},{east},{north}",
            "bboxSR": "104905",
            "imageSR": "104905",
            "size": f"{size},{size}",
            "format": fmt,
            "pixelType": pixel_type,
            "interpolation": "RSP_BilinearInterpolation",
            "f": "image",
        }
    )
    return fetch(f"{TREK}/{service}/ImageServer/exportImage?{params}", timeout=600)


def write_geotiff(path: Path, array: np.ndarray, bbox=BBOX) -> None:
    west, south, east, north = bbox
    height, width = array.shape[:2]
    scale = ((east - west) / width, (north - south) / height, 0.0)
    tiepoint = (0.0, 0.0, 0.0, west, north, 0.0)
    tags = [
        (33550, "d", 3, scale, False),
        (33922, "d", 6, tiepoint, False),
    ]
    tifffile.imwrite(path, array, extratags=tags, compression="zlib")


def download_dem() -> None:
    payload = export_image(
        "Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw", DEM_SIZE, "tiff", "F32"
    )
    tmp = CACHE / "dem_export.tif"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_bytes(payload)
    dem = tifffile.imread(tmp).astype("float32")
    dem[dem < -1e30] = np.nan
    write_geotiff(RAW / "gale_dem.tif", dem)
    tmp.unlink(missing_ok=True)


def download_optical() -> None:
    payload = export_image(
        "Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp", OPTICAL_SIZE, "jpg", "U8"
    )
    (RAW / "gale_optical.jpg").write_bytes(payload)


def download_context() -> None:
    payload = export_image(
        "Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp",
        CONTEXT_SIZE,
        "jpg",
        "U8",
        bbox=REGION_BBOX,
    )
    (RAW / "gale_context.jpg").write_bytes(payload)


def download_viking() -> None:
    payload = export_image(
        "Mars_Viking_MDIM21_ClrMosaic_global_232m", OPTICAL_SIZE, "tiff", "U8"
    )
    tmp = CACHE / "viking.tif"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_bytes(payload)
    array = tifffile.imread(tmp)
    write_geotiff(RAW / "gale_viking.tif", array.astype("uint8"))
    tmp.unlink(missing_ok=True)


def download_themis() -> None:
    pgm = CACHE / "thm_lat00_lon120.pgm"
    download(
        "http://jmars.asu.edu/data/thm_dir_100m/large/lat00_lon120.pgm",
        pgm,
        timeout=3600,
    )
    west, south, east, north = BBOX
    with Image.open(pgm) as image:
        width, height = image.size
        x0 = int(round((west - 120.0) / 60.0 * width))
        x1 = int(round((east - 120.0) / 60.0 * width))
        y0 = int(round((0.0 - north) / 30.0 * height))
        y1 = int(round((0.0 - south) / 30.0 * height))
        crop = image.crop((x0, y0, x1, y1))
        crop.save(RAW / "gale_themis_ir.png")


def download_traverse() -> None:
    params = urllib.parse.urlencode(
        {
            "geometry": f"{BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]}",
            "geometryType": "esriGeometryEnvelope",
            "inSR": "104905",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "*",
            "returnGeometry": "true",
            "outSR": "104905",
            "f": "json",
        }
    )
    payload = json.loads(fetch(f"{TREK}/curiosity_path/MapServer/0/query?{params}", timeout=300))
    paths = payload["features"][0]["geometry"]["paths"]
    coordinates = [[[float(x), float(y)] for x, y in path] for path in paths]
    (RAW / "curiosity_traverse.json").write_text(
        json.dumps({"paths": coordinates}, indent=1), encoding="utf-8"
    )


def query_features(service: str, bbox, layer: int = 0) -> list[dict]:
    params = urllib.parse.urlencode(
        {
            "geometry": f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}",
            "geometryType": "esriGeometryEnvelope",
            "inSR": "104905",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "*",
            "returnGeometry": "true",
            "outSR": "104905",
            "f": "json",
        }
    )
    payload = json.loads(fetch(f"{TREK}/{service}/MapServer/{layer}/query?{params}"))
    return payload.get("features", [])


def download_minerals() -> None:
    features = []
    for feature in query_features(
        "Hydrous_Mineral_Detections_OMEGA_CRISM_clon0", (136.8, -5.6, 138.4, -4.2)
    ):
        attributes = feature["attributes"]
        features.append(
            {
                "lon": attributes["Longitude"],
                "lat": attributes["Latitude"],
                "type": attributes["Type"],
                "instrument": attributes["Instrument"],
            }
        )
    (RAW / "hydrous_minerals.json").write_text(
        json.dumps({"features": features}, indent=1), encoding="utf-8"
    )

    crism = []
    for feature in query_features("mars_mro_crism_mtrdr_c0a_humex_frt_sites", BBOX):
        attributes = feature["attributes"]
        crism.append(
            {
                "product_id": attributes["ProductId"],
                "west": attributes["WestLon"],
                "south": attributes["MinLat"],
                "east": attributes["EastLon"],
                "north": attributes["MaxLat"],
                "instrument": attributes["InstId"],
                "start": attributes["UTCstart"],
            }
        )
    (RAW / "crism_sites.json").write_text(
        json.dumps({"features": crism}, indent=1), encoding="utf-8"
    )


def download_rems() -> None:
    target = RAW / "rems"
    target.mkdir(parents=True, exist_ok=True)
    listing = fetch(f"{REMS_BASE}/", timeout=120).decode("utf-8", "ignore")
    folders = [
        (name, int(low), int(high))
        for name, low, high in re.findall(r"(SOL_(\d+)_(\d+)/)", listing)
    ]
    for sol in REMS_SOLS:
        folder = next((name for name, low, high in folders if low <= sol <= high), None)
        if folder is None:
            continue
        sol_url = f"{REMS_BASE}/{folder}SOL{sol:05d}/"
        try:
            sol_listing = fetch(sol_url, timeout=120).decode("utf-8", "ignore")
        except Exception:
            continue
        names = sorted(
            set(re.findall(r"(RME_\d+RNV\d+[A-Z0-9_]*\.(?:TAB|LBL|xml))", sol_listing))
        )
        sol_dir = target / f"SOL{sol:05d}"
        for name in names:
            download(sol_url + name, sol_dir / name, timeout=300)


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    print("DEM")
    download_dem()
    print("Optical")
    download_optical()
    print("Context")
    download_context()
    print("Viking")
    download_viking()
    print("THEMIS")
    download_themis()
    print("Traverse")
    download_traverse()
    print("Minerals")
    download_minerals()
    print("REMS")
    download_rems()
    meta = {
        "site": "Mount Sharp (Aeolis Mons), Gale Crater",
        "bbox": list(BBOX),
        "region_bbox": list(REGION_BBOX),
        "crs": "Mars 2000 planetocentric (EPSG:104905)",
        "dem_size": DEM_SIZE,
        "optical_size": OPTICAL_SIZE,
        "context_size": CONTEXT_SIZE,
        "mars_radius_m": MARS_RADIUS_M,
    }
    (RAW / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print("Done")


if __name__ == "__main__":
    main()
