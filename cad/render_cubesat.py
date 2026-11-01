"""Blender render of the MARSAD-1 CubeSat parts.

    blender -b -P render_cubesat.py -- <out_dir>
"""

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).parent
OUT = Path(sys.argv[sys.argv.index("--") + 1]) if "--" in sys.argv else HERE

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

PARTS = {
    "structure": dict(color=(0.72, 0.74, 0.78), metallic=0.9, rough=0.32),
    "solar_cells": dict(color=(0.03, 0.06, 0.22), metallic=0.4, rough=0.12),
    "payload": dict(color=(0.02, 0.02, 0.025), metallic=0.3, rough=0.2),
    "antennas": dict(color=(0.85, 0.62, 0.18), metallic=1.0, rough=0.25),
}

for name, m in PARTS.items():
    bpy.ops.wm.stl_import(filepath=str(HERE / f"{name}.stl"), global_scale=0.01)
    obj = bpy.context.selected_objects[0]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*m["color"], 1)
    bsdf.inputs["Metallic"].default_value = m["metallic"]
    bsdf.inputs["Roughness"].default_value = m["rough"]
    obj.data.materials.append(mat)

# world: deep space gradient
world = bpy.data.worlds.new("space")
scene.world = world
world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs["Color"].default_value = (0.006, 0.006, 0.02, 1)
bg.inputs["Strength"].default_value = 1.0


def light(name, loc, energy, size, color=(1, 1, 1)):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = loc
    direction = Vector((0.5, 0.5, 1.7)) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


light("key", (4.0, -3.0, 4.0), 900, 3, (1.0, 0.95, 0.88))       # sun
light("fill", (-3.5, -2.0, 1.0), 220, 4, (0.55, 0.7, 1.0))       # earthshine
light("rim", (-1.0, 4.0, 3.5), 500, 2, (0.8, 0.9, 1.0))

cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 50
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

try:
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 96
    scene.cycles.use_denoising = True
except (TypeError, AttributeError):
    scene.render.engine = next(i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items if "EEVEE" in i.identifier)

scene.render.resolution_x = 1600
scene.render.resolution_y = 1600
scene.render.film_transparent = False
scene.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in bpy.types.ColorManagedViewSettings.bl_rna.properties["view_transform"].enum_items] else "Filmic"


def shot(path, loc, target):
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


shot(OUT / "cubesat_hero.png", (5.2, -4.4, 3.2), (0.95, 0.95, 1.75))
shot(OUT / "cubesat_nadir.png", (3.6, -3.0, -2.2), (0.6, 0.6, 1.0))
print("rendered", OUT)
