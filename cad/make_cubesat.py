"""Generate the MARSAD-1 3U CubeSat model as colour-separated STL parts (mm, Z up).

Each part file carries two tiny alignment markers at the overall bounding-box corners so
that importers which re-centre every file (e.g. Tinkercad) keep the parts aligned.

    python make_cubesat.py   ->  structure.stl, solar_cells.stl, payload.stl, antennas.stl
"""

import math
import struct
from pathlib import Path

OUT = Path(__file__).parent

W = 100.0      # CubeSat face width (CDS: 100 x 100 mm)
H = 340.5      # 3U height
RAIL = 8.5     # rail cross-section
BOUNDS_MIN = (0.0, 0.0, -12.0)
BOUNDS_MAX = (270.0, 270.0, 344.5)


def box(x0, x1, y0, y1, z0, z1):
    v = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    # vertex index = 4*ix + 2*iy + iz
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    tris = []
    for a, b, c, d in quads:
        tris += [(v[a], v[b], v[c]), (v[a], v[c], v[d])]
    return tris


def cylinder(cx, cy, r, z0, z1, n=48):
    tris = []
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        p0 = (cx + r * math.cos(a0), cy + r * math.sin(a0))
        p1 = (cx + r * math.cos(a1), cy + r * math.sin(a1))
        tris += [((*p0, z0), (*p1, z1), (*p1, z0)), ((*p0, z0), (*p0, z1), (*p1, z1))]
        tris += [((cx, cy, z0), (*p1, z0), (*p0, z0)), ((cx, cy, z1), (*p0, z1), (*p1, z1))]
    return tris


def markers():
    s = 0.3
    (ax, ay, az), (bx, by, bz) = BOUNDS_MIN, BOUNDS_MAX
    return box(ax, ax + s, ay, ay + s, az, az + s) + box(bx - s, bx, by - s, by, bz - s, bz)


def write_stl(name, tris):
    def normal(a, b, c):
        u = [b[i] - a[i] for i in range(3)]
        w = [c[i] - a[i] for i in range(3)]
        n = (u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0])
        length = math.sqrt(sum(x * x for x in n)) or 1.0
        return tuple(x / length for x in n)

    tris = tris + markers()
    with open(OUT / name, "wb") as f:
        f.write(f"MARSAD-1 {name}".encode().ljust(80, b" "))
        f.write(struct.pack("<I", len(tris)))
        for t in tris:
            f.write(struct.pack("<3f", *normal(*t)))
            for p in t:
                f.write(struct.pack("<3f", *p))
            f.write(b"\0\0")
    print(f"{name}: {len(tris)} triangles")


def structure():
    t = []
    for x0 in (0, W - RAIL):
        for y0 in (0, W - RAIL):
            t += box(x0, x0 + RAIL, y0, y0 + RAIL, 0, H)            # corner rails
    t += box(2, W - 2, 2, W - 2, 0, 4)                              # bottom (+Z face plate)
    t += box(2, W - 2, 2, W - 2, H - 4, H)                          # top plate
    t += box(3, W - 3, 3, W - 3, 4, H - 4)                          # body skin behind the cells
    for z in (112.5, 226.5):                                        # 1U separator rings
        t += box(0, W, 0, W, z, z + 3)
    t += box(W - 14, W - 6, 6, 14, H, H + 2)                        # separation / kill switches
    t += box(6, 14, W - 14, W - 6, H, H + 2)
    return t


def solar_cells():
    t = []
    bases = (6.0, 118.5, 232.5)                                     # one panel per U
    cols = ((11, 49), (51, 89))
    rows = ((0, 32), (35, 67), (70, 102))
    for b in bases:
        for (c0, c1) in cols:
            for (r0, r1) in rows:
                z0, z1 = b + r0, b + r1
                t += box(c0, c1, 1.2, 3, z0, z1)                    # -Y face
                t += box(c0, c1, W - 3, W - 1.2, z0, z1)            # +Y face
                t += box(1.2, 3, c0, c1, z0, z1)                    # -X face
                t += box(W - 3, W - 1.2, c0, c1, z0, z1)            # +X face
    return t


def payload():
    t = []
    t += cylinder(50, 38, 15, -10, 0)                               # OV5640 lens barrel (nadir)
    t += cylinder(50, 38, 10, -12, -10)                             # lens glass
    t += box(40, 60, 66, 80, -6, 0)                                 # AS7341 spectral sensor window
    return t


def antennas():
    t = []
    t += box(W, 270, 48, 52, H - 12, H - 11)                        # deployed 433 MHz tape antenna (+X)
    t += box(48, 52, W, 270, H - 12, H - 11)                        # second element (+Y)
    t += box(35, 65, 35, 65, H, H + 4)                              # GPS patch antenna on top face
    t += box(W - 4, W, 46, 54, H - 16, H - 7)                       # antenna hinge blocks
    t += box(46, 54, W - 4, W, H - 16, H - 7)
    return t


if __name__ == "__main__":
    write_stl("structure.stl", structure())
    write_stl("solar_cells.stl", solar_cells())
    write_stl("payload.stl", payload())
    write_stl("antennas.stl", antennas())
