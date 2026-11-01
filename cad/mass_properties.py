"""MARSAD-1 mass properties, CDS checks and ADCS disturbance-torque budget from layout.json.

Offline cross-check of js/structure.js (the dashboard computes the same numbers in the browser).
Every part is a solid box; inertia is about the centre of mass in the CAD/body axes.

    python mass_properties.py
"""

import json
import math
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
MU = 3.986004418e14       # m^3/s^2
RE = 6378137.0            # m
B0 = 3.01e-5              # T, equatorial surface field of the aligned dipole
GEO_CENTER = np.array([50.0, 50.0, 170.25])  # mm

# keep in sync with ASSUME in js/structure.js
ALT_KM = 550
POINTING_TOL_DEG = 10
RHO_NOM, RHO_MAX, CD = 6e-13, 2e-12, 2.2
SRP, REFLECT = 4.54e-6, 0.6
CP_MARGIN_MM = 10
RESIDUAL_DIPOLE = 0.005
MTQ_DIPOLE = 0.2
TIP_OFF_DEG_S = 10
BDOT_EFF = 0.3


def mass_properties(parts):
    g = np.array([p["g"] for p in parts])
    c = np.array([p["center"] for p in parts])
    s = np.array([p["size"] for p in parts]) / 1000
    kg = g.sum() / 1000
    com = (g[:, None] * c).sum(0) / g.sum()
    inertia = np.zeros((3, 3))
    for m, center, (a, b, h) in zip(g / 1000, c, s):
        d = (center - com) / 1000
        own = np.diag([m * (b * b + h * h) / 12, m * (a * a + h * h) / 12, m * (a * a + b * b) / 12])
        inertia += own + m * (d @ d * np.eye(3) - np.outer(d, d))
    principal = np.sort(np.linalg.eigvalsh(inertia))
    return kg, com, com - GEO_CENTER, inertia, principal


def sci(x):
    return f"{x:.2e}"


def main():
    layout = json.loads((HERE / "layout.json").read_text(encoding="utf8"))
    parts, frame = layout["parts"], layout["frame"]
    kg, com, off, inertia, principal = mass_properties(parts)

    print("MARSAD-1 mass properties (cad/layout.json)\n")
    print(f"{'part':34s} {'g':>6s}  {'x':>6s} {'y':>6s} {'z':>6s}")
    for p in parts:
        x, y, z = p["center"]
        print(f"{p['name']:34s} {p['g']:6.1f}  {x:6.1f} {y:6.1f} {z:6.1f}")
    print(f"\nmass                {kg:.3f} kg")
    print(f"CoM (CAD, mm)       {com[0]:.2f} {com[1]:.2f} {com[2]:.2f}")
    print(f"CoM offset (mm)     {off[0]:.2f} {off[1]:.2f} {off[2]:.2f}   (limits +/-20 / +/-20 / +/-70)")
    print("inertia about CoM (kg.m^2)")
    for row in inertia:
        print("   " + "  ".join(f"{v: .4e}" for v in row))
    print(f"principal (kg.m^2)   {principal[0]:.4e} {principal[1]:.4e} {principal[2]:.4e}")

    stowed = [p for p in parts if not p.get("deployed")]
    lo = np.min([np.array(p["center"]) - np.array(p["size"]) / 2 for p in stowed], axis=0)
    hi = np.max([np.array(p["center"]) + np.array(p["size"]) / 2 for p in stowed], axis=0)
    span = hi - lo
    print("\nCDS 3U checks")
    checks = [
        ("envelope (stowed)", f"{span[0]:.1f} x {span[1]:.1f} x {span[2]:.1f} mm", all(span <= [frame["width"], frame["width"], frame["length"]])),
        ("rails >= 8.5 mm", f"{frame['rail']} mm", frame["rail"] >= 8.5),
        ("mass <= 4.0 kg", f"{kg:.3f} kg", kg <= 4.0),
        ("CoM X/Y within +/-20 mm", f"{off[0]:.1f} / {off[1]:.1f} mm", abs(off[0]) <= 20 and abs(off[1]) <= 20),
        ("CoM Z within +/-70 mm", f"{off[2]:.1f} mm", abs(off[2]) <= 70),
    ]
    for name, value, ok in checks:
        print(f"   {'PASS' if ok else 'FAIL'}  {name:24s} {value}")
    for k, v in frame.get("protrusionsMm", {}).items():
        print(f"   ACTION {k} stands {v} mm past the rail ends")

    r = RE + ALT_KM * 1000
    v = math.sqrt(MU / r)
    period = 2 * math.pi * math.sqrt(r**3 / MU)
    area = frame["width"] * frame["length"] / 1e6
    arm = (np.linalg.norm(off) + CP_MARGIN_MM) / 1000
    d_i = principal[2] - principal[0]
    k = (RE / r) ** 3
    b_min, b_max = B0 * k, 2 * B0 * k
    gg = lambda deg: 3 * MU / (2 * r**3) * d_i * abs(math.sin(math.radians(2 * deg)))
    aero = lambda rho: 0.5 * rho * CD * area * v * v * arm
    srp = SRP * area * (1 + REFLECT) * arm
    rows = [
        ("gravity gradient", gg(POINTING_TOL_DEG), gg(45)),
        ("aerodynamic", aero(RHO_NOM), aero(RHO_MAX)),
        ("solar radiation", srp, srp),
        ("residual dipole", RESIDUAL_DIPOLE * b_min, RESIDUAL_DIPOLE * b_max),
    ]
    total = sum(w for _, _, w in rows)
    mtq_min, mtq_max = MTQ_DIPOLE * b_min, MTQ_DIPOLE * b_max
    h0 = principal[2] * math.radians(TIP_OFF_DEG_S)
    t_det = h0 / (BDOT_EFF * mtq_min)
    print(f"\nDisturbance torques at {ALT_KM} km (N.m)        nominal     worst")
    for name, nom, worst in rows:
        print(f"   {name:36s} {sci(nom):>10s} {sci(worst):>10s}")
    print(f"   {'total':36s} {sci(sum(n for _, n, _ in rows)):>10s} {sci(total):>10s}")
    print(f"magnetorquer authority  {sci(mtq_min)} - {sci(mtq_max)} N.m   (|B| {b_min * 1e6:.1f}-{b_max * 1e6:.1f} uT)")
    print(f"margin                  x{mtq_min / total:.1f}")
    print(f"detumble from {TIP_OFF_DEG_S} deg/s    {t_det:.0f} s = {t_det / 60:.0f} min = {t_det / period:.2f} orbit")


if __name__ == "__main__":
    main()
