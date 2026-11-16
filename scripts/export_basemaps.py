"""Packages the base maps as data: URIs in a script (web/data/basemaps_data.js).

Why: when index.html is opened by double-clicking (file://) the browser marks any image
loaded from a file as "tainted" and WebGL refuses to use it as a texture ("Tainted canvases may not be loaded"):
the 3D relief used to render black. An image that comes from a data: URI can be used. The script is loaded
on demand the first time the 3D relief is opened.

Usage: python scripts/export_basemaps.py
"""
from __future__ import annotations

import base64
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "web" / "assets"
NAMES = ["basemap_relief", "basemap_color", "basemap_jezero_relief", "basemap_jezero_color"]


def main() -> None:
    data = {n: "data:image/jpeg;base64," + base64.b64encode((ASSETS / f"{n}.jpg").read_bytes()).decode("ascii") for n in NAMES}
    out = ROOT / "web" / "data" / "basemaps_data.js"
    out.write_text("window.MARS_BASEMAPS=" + json.dumps(data) + ";\n", encoding="utf-8")
    print(f"Written {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB, {len(NAMES)} maps)")


if __name__ == "__main__":
    main()
