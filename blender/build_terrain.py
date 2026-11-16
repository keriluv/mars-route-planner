"""Blender (bpy) — 3D model of Gale Crater with the safe route.

Creates in Blender:
  * a terrain mesh from the exported DEM (web/data/layers.json, 300 × 300)
  * the relief base map as a texture
  * the model route as a blue tube and the short route as a gray tube
  * flags at the base (Bradbury Landing) and at the goal (Mount Sharp summit)
and exports everything to blender/gale_terrain.glb for use in Three.js or in presentations.

Usage (Blender 3.6 or 4.x):
  blender --background --python blender/build_terrain.py -- --exag 2.5
or open Blender → Scripting tab → open this file → Run Script.
"""
import base64
import json
import math
import struct
import sys
from pathlib import Path

import bpy  # type: ignore

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
SIZE = 100.0                     # the terrain measures 100 × 100 Blender units (≈ 53 km)
KM_PER_UNIT = 53.2 / SIZE

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
EXAG = float(argv[argv.index("--exag") + 1]) if "--exag" in argv else 2.5


def decode(layer):
    raw = base64.b64decode(layer["b64"])
    if layer["dtype"] == "u16":
        vals = struct.unpack("<%dH" % (len(raw) // 2), raw)
        top = 65535
    else:
        vals = raw
        top = 255
    return [layer["min"] + v / top * (layer["max"] - layer["min"]) for v in vals]


layers = json.loads((WEB / "data" / "layers.json").read_text(encoding="utf-8"))
routes = json.loads((WEB / "data" / "routes.json").read_text(encoding="utf-8"))
targets = json.loads((WEB / "data" / "targets.json").read_text(encoding="utf-8"))
G = layers["grid"]
dem = decode(layers["dem"])
zmin = layers["dem"]["min"]
BBOX = (137.18, -5.45, 138.08, -4.55)


def to_xyz(lon, lat, lift=0.3):
    w, s, e, n = BBOX
    u, v = (lon - w) / (e - w), (n - lat) / (n - s)
    c = min(G - 1, max(0, int(u * G)))
    r = min(G - 1, max(0, int(v * G)))
    z = (dem[r * G + c] - zmin) / 1000 / KM_PER_UNIT * EXAG
    return ((u - 0.5) * SIZE, -(v - 0.5) * SIZE, z + lift)


# ---------- clean scene ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------- terrain ----------
verts, faces, uvs = [], [], []
for r in range(G):
    for c in range(G):
        z = (dem[r * G + c] - zmin) / 1000 / KM_PER_UNIT * EXAG
        verts.append(((c / (G - 1) - 0.5) * SIZE, -(r / (G - 1) - 0.5) * SIZE, z))
for r in range(G - 1):
    for c in range(G - 1):
        i = r * G + c
        faces.append((i, i + G, i + G + 1, i + 1))
mesh = bpy.data.meshes.new("GaleTerrain")
mesh.from_pydata(verts, [], faces)
mesh.update(); print("mesh ok", flush=True)
uv = mesh.uv_layers.new(name="UV")
loop_vi = [0] * len(mesh.loops)
mesh.loops.foreach_get("vertex_index", loop_vi)
flat = []
for vi in loop_vi:
    r, c = divmod(vi, G)
    flat += (c / (G - 1), 1 - r / (G - 1))
uv.data.foreach_set("uv", flat)
mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
terrain = bpy.data.objects.new("Terrain_Gale", mesh)
scene.collection.objects.link(terrain)

mat = bpy.data.materials.new("Mars_Relief")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = bpy.data.images.load(str(WEB / "assets" / "basemap_relief.jpg"))
mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.95
terrain.data.materials.append(mat); print("material ok", flush=True)


# ---------- routes as tubes ----------
def route_tube(name, pts, color, radius):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    spl = curve.splines.new("POLY")
    step = max(1, len(pts) // 600)
    sel = pts[::step] + [pts[-1]]
    spl.points.add(len(sel) - 1)
    for i, p in enumerate(sel):
        x, y, z = to_xyz(p[0], p[1])
        spl.points[i].co = (x, y, z, 1)
    obj = bpy.data.objects.new(name, curve)
    m = bpy.data.materials.new(name + "_mat")
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = color
    curve.materials.append(m)
    scene.collection.objects.link(obj)
    return obj


route_tube("Route_model", routes["summit"]["points"], (0.12, 0.39, 0.86, 1), 0.25)
print("tube1 ok", flush=True)
route_tube("Route_short", routes["summit_short"]["points"], (0.75, 0.75, 0.75, 1), 0.15)

# ---------- flags ----------
for o in targets:
    if o["type"] not in ("base", "goal"):
        continue
    x, y, z = to_xyz(o["lon"], o["lat"], 0)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.08, depth=4, location=(x, y, z + 2))
    pole = bpy.context.active_object
    pole.name = "Pole_" + o["id"]
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.8, depth=1.4, location=(x, y, z + 4.4))
    bpy.context.active_object.name = "Flag_" + o["id"]

# ---------- light and camera ----------
bpy.ops.object.light_add(type="SUN", location=(-40, 40, 80))
bpy.context.active_object.data.energy = 3.5
bpy.context.active_object.rotation_euler = (math.radians(40), 0, math.radians(-135))
bpy.ops.object.camera_add(location=(-105, -125, 95))
cam = bpy.context.active_object
target = bpy.data.objects.new("Centro", None)
target.location = (4, -4, 4)
scene.collection.objects.link(target)
track = cam.constraints.new("TRACK_TO")
track.target = target
track.track_axis = "TRACK_NEGATIVE_Z"
track.up_axis = "UP_Y"
scene.camera = cam

# ---------- export ----------
print("scene ok", flush=True)
out = ROOT / "blender" / "gale_terrain.glb"
bpy.ops.export_scene.gltf(filepath=str(out), export_format="GLB")
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / "blender" / "gale_terrain.blend"))
print("Exportado:", out)
