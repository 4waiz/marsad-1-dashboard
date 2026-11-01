// Lightweight circular-orbit propagator for a sun-synchronous orbit.
// Good enough for a ground-track / eclipse / pass visualisation; not for flight dynamics.

const MU = 398600.4418; // km^3/s^2
export const RE = 6378.137; // km
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function makeOrbit({ altitudeKm, inclinationDeg, ltanHours, epoch }) {
  const a = RE + altitudeKm;
  const n = Math.sqrt(MU / a ** 3); // rad/s
  return {
    a,
    n,
    inc: inclinationDeg * D2R,
    ltanHours,
    epoch: epoch.getTime(),
    periodSec: (2 * Math.PI) / n,
    velocityKms: Math.sqrt(MU / a),
  };
}

function daysJ2000(date) {
  return (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 86400000;
}

// Unit vector to the sun in ECI and its right ascension (low-precision almanac).
export function sunEci(date) {
  const d = daysJ2000(date);
  const L = (280.46 + 0.9856474 * d) * D2R;
  const g = (357.528 + 0.9856003 * d) * D2R;
  const lam = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 0.0000004 * d) * D2R;
  const v = [Math.cos(lam), Math.cos(eps) * Math.sin(lam), Math.sin(eps) * Math.sin(lam)];
  return { v, ra: Math.atan2(v[1], v[0]) };
}

export function gmst(date) {
  const d = daysJ2000(date);
  return ((280.46061837 + 360.98564736629 * d) % 360) * D2R;
}

export function stateAt(orbit, date) {
  const t = (date.getTime() - orbit.epoch) / 1000;
  const sun = sunEci(date);
  // SSO: ascending node keeps a fixed local time relative to the sun
  const raan = sun.ra + (orbit.ltanHours - 12) * 15 * D2R;
  const u = orbit.n * t;
  const cu = Math.cos(u), su = Math.sin(u), ci = Math.cos(orbit.inc), si = Math.sin(orbit.inc);
  const cO = Math.cos(raan), sO = Math.sin(raan);
  const r = [
    orbit.a * (cO * cu - sO * su * ci),
    orbit.a * (sO * cu + cO * su * ci),
    orbit.a * (su * si),
  ];
  const vel = [
    orbit.a * orbit.n * (-cO * su - sO * cu * ci),
    orbit.a * orbit.n * (-sO * su + cO * cu * ci),
    orbit.a * orbit.n * (cu * si),
  ];
  const th = gmst(date);
  const ecef = [Math.cos(th) * r[0] + Math.sin(th) * r[1], -Math.sin(th) * r[0] + Math.cos(th) * r[1], r[2]];
  const rn = Math.hypot(...ecef);
  const lat = Math.asin(ecef[2] / rn) * R2D;
  const lon = Math.atan2(ecef[1], ecef[0]) * R2D;

  // cylindrical earth shadow
  const s = r[0] * sun.v[0] + r[1] * sun.v[1] + r[2] * sun.v[2];
  const perp = Math.hypot(r[0] - s * sun.v[0], r[1] - s * sun.v[1], r[2] - s * sun.v[2]);
  const eclipse = s < 0 && perp < RE;

  return { lat, lon, ecef, r, v: vel, sun: sun.v, eclipse, orbitNumber: Math.floor(t / orbit.periodSec) + 1, orbitPhase: ((t % orbit.periodSec) + orbit.periodSec) % orbit.periodSec / orbit.periodSec };
}

export function elevationDeg(ecef, site) {
  const la = site.lat * D2R, lo = site.lon * D2R;
  const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const g = up.map((c) => c * RE);
  const rho = [ecef[0] - g[0], ecef[1] - g[1], ecef[2] - g[2]];
  const rn = Math.hypot(...rho);
  return Math.asin((rho[0] * up[0] + rho[1] * up[1] + rho[2] * up[2]) / rn) * R2D;
}

// Ground-range radius (km) of the visibility circle for a minimum elevation.
export function visibilityRadiusKm(altitudeKm, minElevDeg) {
  const e = minElevDeg * D2R;
  const rho = Math.acos((RE / (RE + altitudeKm)) * Math.cos(e)) - e;
  return rho * RE;
}

export function haversineKm(a, b) {
  const dLat = (b.lat - a.lat) * D2R, dLon = (b.lon - a.lon) * D2R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * RE * Math.asin(Math.sqrt(h));
}

// Split a list of [lat, lon] into segments that don't wrap across the antimeridian.
export function splitTrack(points) {
  const segs = [];
  let cur = [];
  for (let i = 0; i < points.length; i++) {
    if (i > 0 && Math.abs(points[i][1] - points[i - 1][1]) > 180) {
      segs.push(cur);
      cur = [];
    }
    cur.push(points[i]);
  }
  if (cur.length) segs.push(cur);
  return segs;
}
