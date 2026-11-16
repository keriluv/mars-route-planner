#!/usr/bin/env python3
"""
Cuts a global Mars DEM (GeoTIFF, e.g. MOLA 463 m) into tiles for mars-3d-terrain.html.

Tile scheme (same as Mars Trek):
  zoom z -> 2^(z+1) columns x 2^z rows, row 0 at the north, column 0 at lon -180.
Encoding: "Terrarium" RGB PNG (lossless):
  elevation_m = R*256 + G + B/256 - 32768

Usage:
  pip install rasterio numpy pillow
  python tile_dem.py FILE.tif --max-zoom 6
"""
import argparse
import os
import sys

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import Window
from PIL import Image

TILE = 256


def encode_terrarium(elev):
    v = np.clip(elev.astype(np.float64) + 32768.0, 0, 65535.999)
    fl = np.floor(v)
    r = np.floor(fl / 256)
    g = fl % 256
    b = np.floor((v - fl) * 256)
    return np.stack([r, g, b], axis=-1).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tif")
    ap.add_argument("--out", default="dem_tiles", help="output folder (default dem_tiles)")
    ap.add_argument("--max-zoom", type=int, default=6)
    ap.add_argument("--lon-start", type=float, default=0.0,
                    help="longitude of the file's left edge: 0 (0-360 map, usual in MOLA/USGS) "
                         "or -180 if the map goes from -180 to 180")
    ap.add_argument("--scale", type=float, default=1.0, help="factor to convert the values to meters")
    args = ap.parse_args()

    ds = rasterio.open(args.tif)
    b = ds.bounds
    W, H = b.right - b.left, b.top - b.bottom
    nodata = ds.nodata
    print(f"File: {ds.width}x{ds.height} px, type {ds.dtypes[0]}, nodata={nodata}")
    print(f"Bounds: {b}")
    print(f"Assuming global coverage; left edge = lon {args.lon_start}")

    os.makedirs(args.out, exist_ok=True)

    ratio = ds.width / ds.height
    if abs(ratio - 2.0) > 0.05:
        print(f"WARNING: the file measures {ds.width}x{ds.height} (ratio {ratio:.2f}:1). "
              f"A global equirectangular map should be 2:1. It may cover only part of Mars "
              f"or use another projection; the result will most likely come out distorted.")

    def read_win(c0, r0, c1, r1, ow, oh):
        c0, c1 = max(0.0, c0), min(float(ds.width), c1)
        r0, r1 = max(0.0, r0), min(float(ds.height), r1)
        win = Window(c0, r0, max(c1 - c0, 1e-6), max(r1 - r0, 1e-6))
        arr = ds.read(1, window=win, out_shape=(oh, ow), resampling=Resampling.bilinear).astype(np.float32)
        if nodata is not None:
            arr[arr == nodata] = 0
        arr[~np.isfinite(arr)] = 0
        return arr * args.scale

    def read_tile(lon0, lat0, lon1, lat1, out_w=TILE, out_h=TILE):
        # Everything in the file's own pixels (assumes global coverage): no dependence on bounds/CRS
        span = lon1 - lon0
        col0 = ((lon0 - args.lon_start) % 360.0) / 360.0 * ds.width
        col1 = col0 + span / 360.0 * ds.width
        row0 = (90.0 - lat1) / 180.0 * ds.height
        row1 = (90.0 - lat0) / 180.0 * ds.height
        if col1 <= ds.width + 1e-6:
            return read_win(col0, row0, col1, row1, out_w, out_h)
        # the window crosses the right edge: it is joined with the left edge
        frac = (ds.width - col0) / (col1 - col0)
        n1 = min(max(1, round(out_w * frac)), out_w - 1)
        a = read_win(col0, row0, ds.width, row1, n1, out_h)
        bpart = read_win(0, row0, col1 - ds.width, row1, out_w - n1, out_h)
        return np.concatenate([a, bpart], axis=1)

    # Global preview to check orientation (Olympus Mons should appear at lon -134)
    prev = read_tile(-180, -90, 180, 90, 1024, 512)
    lo, hi = np.percentile(prev, 0.5), np.percentile(prev, 99.5)
    g = np.clip((prev - lo) / (hi - lo + 1e-9), 0, 1) * 255
    Image.fromarray(g.astype(np.uint8)).save(os.path.join(args.out, "preview.png"))
    print(f"Approx. elevation min/max (percentiles): {lo:.0f} / {hi:.0f} m")
    print(f"Preview: {os.path.join(args.out, 'preview.png')}  (check it before continuing)")

    total = sum(2 ** (z + 1) * 2 ** z for z in range(args.max_zoom + 1))
    done = 0
    for z in range(args.max_zoom + 1):
        td = 180.0 / 2 ** z
        for r in range(2 ** z):
            d = os.path.join(args.out, str(z), str(r))
            os.makedirs(d, exist_ok=True)
            lat1 = 90.0 - r * td
            lat0 = lat1 - td
            for c in range(2 ** (z + 1)):
                lon0 = -180.0 + c * td
                arr = read_tile(lon0, lat0, lon0 + td, lat1)
                Image.fromarray(encode_terrarium(arr), "RGB").save(os.path.join(d, f"{c}.png"), optimize=False)
                done += 1
            if done % 200 < 2 ** (z + 1):
                print(f"\r  {done}/{total} tiles (zoom {z})", end="", flush=True)
    print(f"\nDone. Tiles in: {os.path.abspath(args.out)}")


if __name__ == "__main__":
    sys.exit(main())
