// MARSAD-1 attitude dynamics and magnetorquer-only control (no wheels). Rigid body with the layout's
// inertia tensor, gravity-gradient and residual-dipole torques, aligned-dipole geomagnetic field.
// Quaternions are [w, x, y, z] and rotate body vectors into ECI. Units: SI, angles in rad.

import { MU, RE_M, B0 } from "./structure.js";

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

// ---------- vector / quaternion helpers ----------
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => scale(a, 1 / (norm(a) || 1));
export const angle = (a, b) => Math.acos(Math.min(1, Math.max(-1, dot(unit(a), unit(b)))));
const matVec = (m, v) => m.map((r) => dot(r, v));

export const qmul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
export const qconj = (q) => [q[0], -q[1], -q[2], -q[3]];
export const qnorm = (q) => {
  const n = Math.hypot(...q) || 1;
  return q.map((x) => x / n);
};
export const qrot = (q, v) => qmul(qmul(q, [0, ...v]), qconj(q)).slice(1);

// Quaternion of a rotation matrix whose columns are the body axes expressed in the reference frame.
export function qFromCols(c1, c2, c3) {
  const m = [[c1[0], c2[0], c3[0]], [c1[1], c2[1], c3[1]], [c1[2], c2[2], c3[2]]];
  const tr = m[0][0] + m[1][1] + m[2][2];
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [s / 4, (m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s];
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    q = [(m[2][1] - m[1][2]) / s, s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s];
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    q = [(m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s];
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    q = [(m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4];
  }
  return qnorm(q);
}

// TRIAD: attitude that puts body axis b1 on reference r1 exactly and b2 as close as possible to r2.
export function triad(b1, b2, r1, r2) {
  const t1 = unit(b1), t2 = unit(cross(b1, b2)), t3 = cross(t1, t2);
  const s1 = unit(r1), s2 = unit(cross(r1, r2)), s3 = cross(s1, s2);
  // R = S T^T maps body → ECI; build it from its columns R e_k
  const col = (k) => add(add(scale(s1, t1[k]), scale(s2, t2[k])), scale(s3, t3[k]));
  return qFromCols(col(0), col(1), col(2));
}

function inv3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

// Aligned dipole (axis along -Z ECI, which is also -Z ECEF): B = B0 (Re/r)^3 [3 (m·r̂) r̂ − m].
export function fieldEci(rM) {
  const rn = norm(rM);
  const rh = scale(rM, 1 / rn);
  const m = [0, 0, -1];
  const k = B0 * (RE_M / rn) ** 3;
  return scale(sub(scale(rh, 3 * dot(m, rh)), m), k);
}

// ---------- body geometry ----------
export const BODY = {
  array: unit([1, 1, 0]), // +X/+Y edge: both body-mounted array faces at 45° to the sun
  camera: [0, 0, -1], // OV5640 + AS7341 boresight, -Z face
  faces: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]], // the four long faces carry cells
};
export const MODE_TARGET = {
  sun: "+X+Y array → Sun",
  nadir: "−Z camera → nadir",
  gs: "−Z → Abu Dhabi GS",
  safe: "free drift (MTQ off)",
};

// Target attitude for a CONOPS mode at orbit state env = { r, v (m, m/s ECI), sun (unit ECI), gs (m ECI) }.
export function targetFor(mode, env) {
  const nadir = scale(unit(env.r), -1);
  const h = unit(cross(env.r, env.v));
  if (mode === "sun") return { q: triad(BODY.array, [0, 0, 1], env.sun, h), b: BODY.array, ref: env.sun };
  if (mode === "gs" && env.gs) {
    const los = unit(sub(env.gs, env.r));
    return { q: triad(BODY.camera, [1, 0, 0], los, env.v), b: BODY.camera, ref: los };
  }
  if (mode === "nadir" || mode === "gs") return { q: triad(BODY.camera, [1, 0, 0], nadir, env.v), b: BODY.camera, ref: nadir };
  return null;
}

// ---------- the spacecraft ----------
// Gains tuned offline over 8 residual-dipole cases × 4 epochs × 5 orbits of the CONOPS timeline (see README): wn natural frequency (rad/s),
// slew rate capped at maxRateDeg, rate damping above dampDeg[0] °/s until below dampDeg[1] °/s.
// residual = uncompensated dipole of the COTS electronics (A·m²).
export function makeAttitude({ inertia, mMax = 0.2, wn = 0.015, zeta = 0.7, maxRateDeg = 0.7, yawW = 0.2, dampDeg = [1.5, 1.0], residual = [0.0012, -0.0008, 0.0012] }) {
  const [dampEnter, dampExit] = dampDeg.map((x) => x * D2R);
  const I = inertia;
  const Iinv = inv3(I);
  const Imin = Math.min(I[0][0], I[1][1], I[2][2]);
  const kd = 2 * zeta * wn;
  const kp = wn / (2 * zeta); // ω_ref = ω_target + kp·θ, i.e. a PD loop with natural frequency wn
  const maxRate = maxRateDeg * D2R;
  const s = { q: [1, 0, 0, 0], w: [0, 0, 0], m: [0, 0, 0], b: [0, 0, 0], perr: null, mode: "sun", mtq: true, phase: "pointing" };

  // A magnetorquer can only push perpendicular to B. Pick the dipole whose torque gives the angular acceleration
  // closest to the command, least squares through I⁻¹ (the plain m = B × τ / |B|² law dumps the missing part
  // onto the low-inertia long axis and spins it up). W weights the boresight axis by yawW: its angle is free.
  function dipoleFor(alpha, b, bore, yawW) {
    const S = [[0, b[2], -b[1]], [-b[2], 0, b[0]], [b[1], -b[0], 0]]; // m × B = S m
    const k = 1 - Math.sqrt(yawW);
    const W = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? 1 : 0) - k * bore[i] * bore[j]));
    const WI = W.map((r) => [0, 1, 2].map((j) => r[0] * Iinv[0][j] + r[1] * Iinv[1][j] + r[2] * Iinv[2][j]));
    const M = WI.map((r) => [0, 1, 2].map((j) => r[0] * S[0][j] + r[1] * S[1][j] + r[2] * S[2][j]));
    const a = matVec(W, alpha);
    const MtM = [0, 1, 2].map((i) => [0, 1, 2].map((j) => M[0][i] * M[0][j] + M[1][i] * M[1][j] + M[2][i] * M[2][j]));
    const eps = 1e-6 * (MtM[0][0] + MtM[1][1] + MtM[2][2]);
    for (let i = 0; i < 3; i++) MtM[i][i] += eps;
    const rhs = [0, 1, 2].map((i) => M[0][i] * a[0] + M[1][i] * a[1] + M[2][i] * a[2]);
    const m = matVec(inv3(MtM), rhs);
    const bh = unit(b);
    return sub(m, scale(bh, dot(m, bh))); // minimum norm: a component along B makes no torque
  }

  // One integration step of dt seconds. env as in targetFor; envNext is the same 1 s later (target rate feed-forward).
  function step(dt, env, envNext, mode, mtqOn) {
    const bE = fieldEci(env.r);
    const bB = qrot(qconj(s.q), bE);
    let tau = [0, 0, 0];
    s.m = [0, 0, 0];
    s.perr = null;
    const tgt = targetFor(mode, env);
    if (tgt) s.perr = angle(qrot(s.q, tgt.b), tgt.ref);
    // rate damping first (after tip-off, a fault or a bad slew), pointing once the body is quiet
    const rate = norm(s.w);
    if (s.phase === "damping" ? rate < dampExit : rate > dampEnter) s.phase = s.phase === "damping" ? "pointing" : "damping";
    if (mtqOn && (tgt || s.phase === "damping")) {
      let m;
      if (s.phase === "damping") {
        // B-dot style rate damping, m = K (ω × B) / |B|²: always dissipative. K = 12·n·I_min (orbit rate n) was
        // the fastest of a sweep; much higher gains saturate and lock the spin along B, which they cannot damp.
        const n = Math.sqrt(MU / norm(env.r) ** 3);
        m = scale(cross(s.w, bB), (12 * n * Imin) / dot(bB, bB));
      } else {
        // two-axis pointing: put the boresight on the target, damp the rate about it, leave its angle free
        const rB = qrot(qconj(s.q), tgt.ref);
        const ax = cross(tgt.b, rB);
        const th = norm(ax) > 1e-12 ? scale(unit(ax), s.perr) : [0, 0, 0];
        const ref1 = targetFor(mode, envNext).ref;
        const wT = qrot(qconj(s.q), cross(tgt.ref, sub(ref1, tgt.ref))); // rate of the target direction (rad/s)
        let cmd = scale(th, kp);
        if (norm(cmd) > maxRate) cmd = scale(unit(cmd), maxRate);
        m = dipoleFor(scale(sub(add(wT, cmd), s.w), kd), bB, tgt.b, yawW);
      }
      const peak = Math.max(...m.map(Math.abs));
      if (peak > mMax) m = scale(m, mMax / peak);
      s.m = m;
      tau = cross(m, bB);
    }
    // environment: gravity gradient + residual dipole
    const rB = unit(qrot(qconj(s.q), env.r));
    const gg = scale(cross(rB, matVec(I, rB)), (3 * MU) / norm(env.r) ** 3);
    tau = add(add(tau, gg), cross(residual, bB));
    // RK4 on Euler's equations (torque held over the step); explicit Euler would pump energy into a free tumble
    const f = (w) => matVec(Iinv, sub(tau, cross(w, matVec(I, w))));
    const w0 = s.w;
    const k1 = f(w0), k2 = f(add(w0, scale(k1, dt / 2))), k3 = f(add(w0, scale(k2, dt / 2))), k4 = f(add(w0, scale(k3, dt)));
    s.w = add(w0, scale(add(add(k1, scale(k2, 2)), add(scale(k3, 2), k4)), dt / 6));
    const wm = scale(add(w0, s.w), 0.5);
    const wn2 = norm(wm);
    if (wn2 > 0) {
      const half = (wn2 * dt) / 2;
      const ax = scale(wm, Math.sin(half) / wn2);
      s.q = qnorm(qmul(s.q, [Math.cos(half), ...ax]));
    }
    s.b = bB;
    s.mode = mode;
    s.mtq = mtqOn;
  }

  return { state: s, step, inertia: I, mMax };
}
