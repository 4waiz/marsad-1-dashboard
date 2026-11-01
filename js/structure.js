// Structure & ADCS sizing for MARSAD-1: mass properties, CubeSat Design Specification (CDS) checks and the
// disturbance-torque budget, all computed from the structural layout in cad/layout.json (mm in, SI out).
// cad/mass_properties.py repeats these numbers offline — keep the two in sync.

export const MU = 3.986004418e14; // m^3/s^2
export const RE_M = 6378137; // m
export const B0 = 3.01e-5; // T, equatorial surface field of the aligned-dipole model
export const GEO_CENTER = [50, 50, 170.25]; // mm, geometric centre of the 3U envelope in the CAD frame

// Every assumption behind the budget, shown next to the numbers on the dashboard.
export const ASSUME = {
  altKm: 550,
  pointingTolDeg: 10, // nadir-imaging pointing requirement
  rhoNom: 6e-13, // kg/m^3, mean density at 550 km
  rhoMax: 2e-12, // kg/m^3, solar maximum
  cd: 2.2,
  srp: 4.54e-6, // N/m^2, solar flux / c at 1 AU
  reflect: 0.6, // reflectance factor q
  cpMarginMm: 10, // added to the CoM offset for the cp–cg lever arm (build and knowledge uncertainty)
  residualDipole: 0.005, // A·m^2, COTS electronics without magnetic cleanliness control
  mtqDipole: 0.2, // A·m^2 per axis, air-core magnetorquer board
  tipOffDegS: 10, // deployment tip-off rate to detumble
  bdotEff: 0.3, // fraction of the peak magnetorquer torque B-dot delivers on average
};

const sq = (x) => x * x;

// Principal moments and axes of a symmetric 3x3 matrix (cyclic Jacobi).
export function eigSym3(m) {
  const a = m.map((r) => r.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = sq(a[0][1]) + sq(a[0][2]) + sq(a[1][2]);
    if (off < 1e-30) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
      const c = Math.cos(th), s = Math.sin(th);
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: v }; // eigenvector i = column i
}

// Mass, centre of mass and inertia tensor about the CoM (body axes = CAD axes), each part a solid box.
export function massProperties(parts) {
  const kg = parts.reduce((s, p) => s + p.g, 0) / 1000;
  const com = [0, 1, 2].map((i) => parts.reduce((s, p) => s + p.g * p.center[i], 0) / (kg * 1000));
  const I = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of parts) {
    const m = p.g / 1000;
    const [a, b, c] = p.size.map((x) => x / 1000);
    const d = p.center.map((x, i) => (x - com[i]) / 1000);
    const own = [m * (b * b + c * c) / 12, m * (a * a + c * c) / 12, m * (a * a + b * b) / 12];
    const d2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) I[i][j] += (i === j ? own[i] + m * d2 : 0) - m * d[i] * d[j];
  }
  const eig = eigSym3(I);
  const order = [0, 1, 2].sort((x, y) => eig.values[x] - eig.values[y]);
  return {
    kg,
    com,
    offset: com.map((x, i) => x - GEO_CENTER[i]),
    inertia: I,
    principal: order.map((k) => eig.values[k]),
    axes: order.map((k) => [0, 1, 2].map((r) => eig.vectors[r][k])),
  };
}

// CDS 3U checks. status: ok | warn (action needed before the flight build) | crit.
export function cdsChecks(mp, layout, bom) {
  const f = layout.frame;
  const stowed = layout.parts.filter((p) => !p.deployed);
  const lo = [0, 1, 2].map((i) => Math.min(...stowed.map((p) => p.center[i] - p.size[i] / 2)));
  const hi = [0, 1, 2].map((i) => Math.max(...stowed.map((p) => p.center[i] + p.size[i] / 2)));
  const span = hi.map((h, i) => h - lo[i]);
  const side = Math.max(0, -lo[0], -lo[1], hi[0] - f.width, hi[1] - f.width);
  const bomG = bom.reduce((s, c) => s + c.g * c.qty, 0);
  const layG = layout.parts.reduce((s, p) => s + p.g, 0);
  const itemsOff = bom.filter((c) => Math.abs(layout.parts.filter((p) => p.bom === c.name).reduce((s, p) => s + p.g, 0) - c.g * c.qty) > 1e-6);
  const prot = f.protrusionsMm || {};
  const protMax = Math.max(0, ...Object.values(prot));
  const o = mp.offset;
  const st = (ok) => (ok ? "ok" : "crit");
  return [
    { name: "Envelope (stowed)", value: `${span[0].toFixed(1)} × ${span[1].toFixed(1)} × ${span[2].toFixed(1)} mm`, limit: `≤ ${f.width} × ${f.width} × ${f.length} mm`, status: st(span[0] <= f.width + 1e-9 && span[1] <= f.width + 1e-9 && span[2] <= f.length + 1e-9) },
    { name: "Rails", value: `${f.rail} × ${f.rail} mm, full length`, limit: "≥ 8.5 mm square", status: st(f.rail >= 8.5) },
    { name: "Side-face protrusion", value: `${side.toFixed(1)} mm`, limit: "≤ 6.5 mm", status: st(side <= 6.5) },
    { name: "Mass", value: `${mp.kg.toFixed(3)} kg`, limit: "≤ 4.000 kg", status: st(mp.kg <= 4.0) },
    { name: "CoM offset X / Y", value: `${o[0].toFixed(1)} / ${o[1].toFixed(1)} mm`, limit: "within ±20 mm", status: st(Math.abs(o[0]) <= 20 && Math.abs(o[1]) <= 20) },
    { name: "CoM offset Z", value: `${o[2].toFixed(1)} mm`, limit: "within ±70 mm", status: st(Math.abs(o[2]) <= 70) },
    { name: "Layout mass = BOM", value: `${layG.toFixed(1)} g vs ${bomG} g`, limit: "every BOM line placed", status: st(Math.abs(layG - bomG) < 1e-6 && !itemsOff.length), note: itemsOff.length ? `mismatch: ${itemsOff.map((c) => c.name).join(", ")}` : "" },
    {
      name: "±Z faces inside rail ends",
      value: Object.entries(prot).map(([k, v]) => `${k} ${v} mm`).join(" · ") || "0 mm",
      limit: "0 mm past the rail ends",
      status: protMax > 0 ? "warn" : "ok",
      note: protMax > 0 ? "Lens barrel and GPS patch stand proud of the rail ends; recess them or add rail standoffs before the flight build so only the rails touch the deployer." : "",
    },
  ];
}

// Worst-case environmental torques at the mission altitude against the magnetorquer authority.
export function disturbanceBudget(mp, layout, a = ASSUME) {
  const r = RE_M + a.altKm * 1000;
  const v = Math.sqrt(MU / r);
  const period = 2 * Math.PI * Math.sqrt(r ** 3 / MU);
  const area = (layout.frame.width * layout.frame.length) / 1e6; // m^2, largest face
  const arm = (Math.hypot(...mp.offset) + a.cpMarginMm) / 1000; // m
  const dI = mp.principal[2] - mp.principal[0];
  const gg = (deg) => ((3 * MU) / (2 * r ** 3)) * dI * Math.abs(Math.sin((2 * deg * Math.PI) / 180));
  const aero = (rho) => 0.5 * rho * a.cd * area * v * v * arm;
  const scale = (RE_M / r) ** 3;
  const bMin = B0 * scale, bMax = 2 * B0 * scale;
  const rows = [
    { key: "gg", name: "Gravity gradient", note: `ΔI = ${dI.toExponential(2)} kg·m², ${a.pointingTolDeg}° off nadir (45° worst)`, nominal: gg(a.pointingTolDeg), worst: gg(45) },
    { key: "aero", name: "Aerodynamic drag", note: `ρ ${a.rhoNom.toExponential(0)} (solar max ${a.rhoMax.toExponential(0)}) kg/m³, Cd ${a.cd}, ${(area * 1e4).toFixed(0)} cm², arm ${(arm * 1000).toFixed(1)} mm`, nominal: aero(a.rhoNom), worst: aero(a.rhoMax) },
    { key: "srp", name: "Solar radiation", note: `${a.srp.toExponential(2)} N/m², q ${a.reflect}, same arm`, nominal: a.srp * area * (1 + a.reflect) * arm, worst: a.srp * area * (1 + a.reflect) * arm },
    { key: "mag", name: "Residual dipole", note: `${a.residualDipole} A·m² × |B| ${(bMin * 1e6).toFixed(1)}–${(bMax * 1e6).toFixed(1)} µT`, nominal: a.residualDipole * bMin, worst: a.residualDipole * bMax },
  ];
  const total = rows.reduce((s, x) => s + x.worst, 0);
  const totalNom = rows.reduce((s, x) => s + x.nominal, 0);
  const mtqMin = a.mtqDipole * bMin, mtqMax = a.mtqDipole * bMax;
  const h0 = mp.principal[2] * ((a.tipOffDegS * Math.PI) / 180);
  const detumbleS = h0 / (a.bdotEff * mtqMin);
  return { r, v, period, area, arm, bMin, bMax, rows, total, totalNom, mtqMin, mtqMax, margin: mtqMin / total, h0, detumbleS, detumbleOrbits: detumbleS / period };
}
