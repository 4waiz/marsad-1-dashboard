// ADCS & structure panel (Bilal Feroz): runs the attitude model alongside the orbit simulation, draws the
// spacecraft in the orbit frame with Three.js, and fills the attitude, pointing, disturbance-budget and
// mass-properties cards. Three.js is imported lazily so the rest of the dashboard never waits on the CDN.

import { COMPONENTS, GROUND_STATION, SUBSYSTEMS, SUB_COLORS } from "./data.js";
import { stateAt, gmst, RE } from "./orbit.js";
import { massProperties, cdsChecks, disturbanceBudget, ASSUME } from "./structure.js";
import { makeAttitude, targetFor, qrot, qconj, qFromCols, unit, cross, scale, norm, angle, dot, BODY, MODE_TARGET, D2R, R2D } from "./attitude.js";

const LAYOUT = await (await fetch(new URL("../cad/layout.json", import.meta.url))).json();
export const MASS = massProperties(LAYOUT.parts);
export const CHECKS = cdsChecks(MASS, LAYOUT, COMPONENTS);
export const DIST = disturbanceBudget(MASS, LAYOUT);

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 1) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const SUP = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const sci = (x, d = 2) => {
  const [m, e] = x.toExponential(d).split("e");
  return `${m} × 10${String(Number(e)).replace(/./g, (c) => SUP[c])}`;
};
const STATUS = { ok: ["st-ok", "Pass"], warn: ["st-warn", "Action"], crit: ["st-crit", "Fail"] };
const PHASE_TEXT = { pointing: "pointing", damping: "rate damping (B-dot)" };

// ---------- static cards: structure and disturbance budget ----------
function renderStructure() {
  const o = MASS.offset, p = MASS.principal, I = MASS.inertia;
  $("massDl").innerHTML = [
    ["Mass", `${fmt(MASS.kg, 3)} kg <span class="muted">of 4.000</span>`],
    ["CoM vs geometric centre", `${fmt(o[0], 1)}, ${fmt(o[1], 1)}, ${fmt(o[2], 1)} mm`],
    ["Principal inertia", `${p.map((x) => fmt(x * 1e3, 2)).join(" / ")} <span class="muted">g·m²</span>`],
    ["Long-axis ratio", `${fmt(p[2] / p[0], 1)} : 1 <span class="muted">gravity-gradient stable along Z</span>`],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
  $("inertiaTable").innerHTML = `<thead><tr><th>g·m²</th><th class="num">X</th><th class="num">Y</th><th class="num">Z</th></tr></thead><tbody>${I.map(
    (r, i) => `<tr><td>${"XYZ"[i]}</td>${r.map((x) => `<td class="num">${fmt(x * 1e3, 3)}</td>`).join("")}</tr>`
  ).join("")}</tbody>`;
  $("cdsTable").innerHTML = `<thead><tr><th>CDS check</th><th>Value</th><th>Limit</th><th>Status</th></tr></thead><tbody>${CHECKS.map((c) => {
    const [cls, word] = STATUS[c.status];
    return `<tr><td>${c.name}</td><td class="mono">${c.value}</td><td class="mono muted">${c.limit}</td><td class="${cls} stw">${word}</td></tr>${c.note ? `<tr class="note"><td colspan="4">${c.note}</td></tr>` : ""}`;
  }).join("")}</tbody>`;

  const d = DIST;
  $("distTable").innerHTML = `<thead><tr><th>Source</th><th class="num">Nominal</th><th class="num">Worst</th></tr></thead><tbody>${d.rows
    .map((r) => `<tr><td>${r.name}<span class="sub">${r.note}</span></td><td class="num">${sci(r.nominal)}</td><td class="num">${sci(r.worst)}</td></tr>`)
    .join("")}</tbody><tfoot><tr><td>Total (N·m)</td><td class="num">${sci(d.totalNom)}</td><td class="num">${sci(d.total)}</td></tr></tfoot>`;
  const pct = Math.min(100, (d.total / d.mtqMin) * 100);
  $("distSummary").innerHTML = `
    <div class="margin"><div class="row"><span>Magnetorquer authority</span><b>${sci(d.mtqMin)} – ${sci(d.mtqMax)} N·m</b></div>
    <div class="meter" title="worst-case disturbance as a share of the weakest magnetorquer torque"><i style="width:${Math.max(pct, 2)}%"></i></div>
    <div class="row"><span class="muted small">${ASSUME.mtqDipole} A·m² per axis × |B| ${fmt(d.bMin * 1e6, 1)}–${fmt(d.bMax * 1e6, 1)} µT</span><span class="muted small">margin ×${fmt(d.margin, 1)}</span></div></div>
    <dl class="state compact">
      <div><dt>Detumble from ${ASSUME.tipOffDegS} °/s</dt><dd>${fmt(d.detumbleS / 60, 0)} min · ${fmt(d.detumbleOrbits, 2)} orbit</dd></div>
      <div><dt>Tip-off momentum</dt><dd>${sci(d.h0)} N·m·s</dd></div>
    </dl>
    <p class="muted small">Worst case adds every source at its maximum. Detumble assumes B-dot delivers ${ASSUME.bdotEff * 100} % of the weakest magnetorquer torque on average; the attitude simulator agrees (median 22 min over 18 runs from 10 °/s). Lever arm = CoM offset + ${ASSUME.cpMarginMm} mm build and knowledge margin.</p>`;
}

// ---------- orbit-frame geometry ----------
function gsEci(date) {
  const la = GROUND_STATION.lat * D2R, lo = GROUND_STATION.lon * D2R, th = gmst(date);
  const e = [RE * Math.cos(la) * Math.cos(lo), RE * Math.cos(la) * Math.sin(lo), RE * Math.sin(la)];
  return [Math.cos(th) * e[0] - Math.sin(th) * e[1], Math.sin(th) * e[0] + Math.cos(th) * e[1], e[2]].map((x) => x * 1000);
}
function envAt(orbit, date) {
  const st = stateAt(orbit, date);
  return { r: st.r.map((x) => x * 1000), v: st.v.map((x) => x * 1000), sun: st.sun, gs: gsEci(date), eclipse: st.eclipse };
}
// ECI → view frame: x along-track, y zenith, z = −orbit normal (right-handed, Three.js Y up)
function lvlh(env) {
  const z = unit(env.r), x = unit(env.v);
  const h = unit(cross(env.r, env.v));
  return (v) => [dot(x, v), dot(z, v), -dot(h, v)];
}

export function createAdcs(orbit) {
  const att = makeAttitude({ inertia: MASS.inertia, mMax: ASSUME.mtqDipole });
  const s = att.state;
  let started = false;
  let fault = false;
  let view = null; // latest snapshot for the 3D view
  const out = { rate: 0, perr: null };

  const chart = new Chart($("chPoint"), {
    type: "line",
    data: { labels: [], datasets: [
      { label: "Pointing error (°)", borderColor: "#4fd1a5", backgroundColor: "rgba(79,209,165,0.08)", fill: true, yAxisID: "y", data: [] },
      { label: "Body rate (°/s)", borderColor: "#f5b941", yAxisID: "y1", data: [] },
    ].map((d) => ({ pointRadius: 0, borderWidth: 2, tension: 0.25, spanGaps: false, ...d })) },
    options: {
      maintainAspectRatio: false,
      responsive: true,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { maxTicksLimit: 8 } },
        y: { min: 0, suggestedMax: 30, title: { display: true, text: "°" } },
        y1: { position: "right", min: 0, suggestedMax: 2, grid: { drawOnChartArea: false }, title: { display: true, text: "°/s" } },
      },
      plugins: { limitLines: { lines: [{ y: ASSUME.pointingTolDeg, color: "#f5b941", label: `nadir req. ${ASSUME.pointingTolDeg}°` }] } },
    },
  });

  function step(dtSec, endDate, mode, mtqFault) {
    const n = Math.max(1, Math.ceil(dtSec));
    const h = dtSec / n;
    const t0 = endDate.getTime() - dtSec * 1000;
    if (!started) {
      const e = envAt(orbit, new Date(t0));
      s.q = targetFor(mode === "safe" ? "sun" : mode, e).q;
      started = true;
    }
    fault = mtqFault;
    let e = envAt(orbit, new Date(t0));
    for (let k = 0; k < n; k++) {
      const tk = t0 + (k + 1) * h * 1000;
      const next = envAt(orbit, new Date(tk));
      const ahead = h === 1 ? next : envAt(orbit, new Date(t0 + k * h * 1000 + 1000));
      att.step(h, e, ahead, mode, mode !== "safe" && !mtqFault);
      e = next;
    }
    out.rate = +(norm(s.w) * R2D).toFixed(2);
    out.perr = s.perr === null ? null : +(s.perr * R2D).toFixed(1);
    snapshot(e, mode);
    return out;
  }

  function snapshot(e, mode) {
    const toV = lvlh(e);
    const cols = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((b) => toV(qrot(s.q, b)));
    const q = qFromCols(...cols);
    const camEci = qrot(s.q, BODY.camera);
    const sunB = qrot(qconj(s.q), e.sun);
    view = {
      q: [q[1], q[2], q[3], q[0]], // Three.js order x, y, z, w
      sun: toV(e.sun),
      gs: mode === "gs" ? toV(unit(e.gs.map((x, i) => x - e.r[i]))) : null,
      eclipse: e.eclipse,
      at: performance.now(),
    };
    const offNadir = angle(camEci, scale(e.r, -1)) * R2D;
    const arrayAng = angle(BODY.array, sunB) * R2D;
    const lit = BODY.faces.reduce((a, f) => a + Math.max(0, dot(f, sunB)), 0);
    const phase = fault ? "MTQ FAULT · free tumble" : mode === "safe" ? "magnetorquers off" : PHASE_TEXT[s.phase];
    $("aMode").textContent = MODE_TARGET[mode];
    $("aPhase").textContent = phase;
    $("aPhase").className = fault ? "st-crit" : s.phase === "damping" && mode !== "safe" ? "st-warn" : "";
    $("aErr").textContent = out.perr === null ? "— (no target)" : `${fmt(out.perr, 1)}°`;
    $("aErr").className = out.perr !== null && mode === "nadir" && out.perr > ASSUME.pointingTolDeg ? "st-warn" : "";
    $("aNadir").textContent = `${fmt(offNadir, 1)}°`;
    $("aSun").textContent = e.eclipse ? "eclipse" : `${fmt(arrayAng, 0)}° · ${fmt(lit, 2)} faces lit`;
    $("aRate").textContent = `${fmt(out.rate, 2)} °/s`;
    $("aRate").className = out.rate > 4 ? "st-crit" : out.rate > 2 ? "st-warn" : "";
    $("aB").textContent = `${fmt(norm(s.b) * 1e6, 1)} µT`;
    $("aDipole").innerHTML = s.m.map((m, i) => {
      const w = (Math.min(1, Math.abs(m) / att.mMax) * 50).toFixed(1);
      return `<div class="dip"><span>${"XYZ"[i]}</span><div class="dbar"><i style="${m >= 0 ? `left:50%` : `right:50%`};width:${w}%"></i></div><b>${m >= 0 ? "+" : "−"}${fmt(Math.abs(m), 3)}</b></div>`;
    }).join("");
  }

  function sample(label, perr, rate) {
    chart.data.labels.push(label);
    chart.data.datasets[0].data.push(perr);
    chart.data.datasets[1].data.push(rate);
    if (chart.data.labels.length > 200) {
      chart.data.labels.shift();
      chart.data.datasets.forEach((d) => d.data.shift());
    }
    chart.update();
  }

  renderStructure();
  initView(() => view).catch(() => {
    $("attView").innerHTML = `<p class="muted small view-msg">3D view unavailable in this browser (WebGL). Attitude numbers below are still live.</p>`;
  });

  return {
    step,
    sample,
    spinUp: () => (s.w = [2.5, -3.0, 4.0].map((x) => x * D2R)), // ~5.6 °/s, a stuck-on coil
    quiet: () => (s.w = scale(s.w, 0.05)),
  };
}

// ---------- Three.js view ----------
function parseStl(THREE, buf, offset) {
  const dv = new DataView(buf);
  const n = dv.getUint32(80, true);
  const pos = new Float32Array(n * 9), nor = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50;
    const nx = dv.getFloat32(o, true), ny = dv.getFloat32(o + 4, true), nz = dv.getFloat32(o + 8, true);
    for (let v = 0; v < 3; v++) {
      for (let c = 0; c < 3; c++) pos[i * 9 + v * 3 + c] = dv.getFloat32(o + 12 + v * 12 + c * 4, true) - offset[c];
      nor.set([nx, ny, nz], i * 9 + v * 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return g;
}

async function initView(getView) {
  const box = $("attView");
  let THREE, OrbitControls;
  try {
    THREE = await import("three");
    ({ OrbitControls } = await import("three/addons/controls/OrbitControls.js"));
  } catch {
    box.innerHTML = `<p class="muted small view-msg">3D view unavailable: Three.js could not be loaded. Attitude numbers below are still live.</p>`;
    return;
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x07060d);
  box.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 10, 200000);
  camera.position.set(700, 380, 950);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 350;
  controls.maxDistance = 4000;

  // stars
  const sp = new Float32Array(1500 * 3);
  for (let i = 0; i < 1500; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(60000);
    sp.set([v.x, v.y, v.z], i * 3);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x9b94b8, size: 1.6, sizeAttenuation: false })));

  // Earth below, at the true altitude-to-radius ratio (550 km : 6378 km)
  const R = 13000, alt = R * (550 / 6378);
  const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), new THREE.MeshPhongMaterial({ color: 0x173b6e, emissive: 0x050d1c, shininess: 12 }));
  earth.position.set(0, -(R + alt), 0);
  scene.add(earth);
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.012, 96, 64), new THREE.MeshBasicMaterial({ color: 0x4f9cff, transparent: true, opacity: 0.18, side: THREE.BackSide }));
  atmo.position.copy(earth.position);
  scene.add(atmo);

  const ambient = new THREE.AmbientLight(0x8890b0, 0.55);
  const sunLight = new THREE.DirectionalLight(0xfff2d8, 2.4);
  scene.add(ambient, sunLight, sunLight.target);

  // spacecraft, centred on its CoM (mm)
  const sat = new THREE.Group();
  scene.add(sat);
  const skin = [];
  const mats = {
    structure: new THREE.MeshStandardMaterial({ color: 0xb9bdcc, metalness: 0.55, roughness: 0.42 }),
    solar_cells: new THREE.MeshStandardMaterial({ color: 0x1d2f7a, metalness: 0.35, roughness: 0.3, emissive: 0x040818 }),
    payload: new THREE.MeshStandardMaterial({ color: 0x1a1a22, metalness: 0.3, roughness: 0.5 }),
    antennas: new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 0.7, roughness: 0.35 }),
  };
  const base = new URL("../cad/", import.meta.url);
  await Promise.all(Object.keys(mats).map(async (k) => {
    try {
      const buf = await (await fetch(new URL(`${k}.stl`, base))).arrayBuffer();
      const mesh = new THREE.Mesh(parseStl(THREE, buf, MASS.com), mats[k]);
      sat.add(mesh);
      if (k === "structure" || k === "solar_cells") skin.push(mats[k]);
    } catch {
      /* a missing part just isn't drawn */
    }
  }));
  const internals = new THREE.Group();
  LAYOUT.parts
    .filter((p) => p.sub !== "Structure" && !p.name.startsWith("Solar array") && !p.bom.startsWith("Deployable"))
    .forEach((p) => {
      const color = SUB_COLORS[SUBSYSTEMS.indexOf(p.sub)] || "#ffffff";
      const m = new THREE.Mesh(new THREE.BoxGeometry(...p.size), new THREE.MeshStandardMaterial({ color, roughness: 0.6, emissive: color, emissiveIntensity: 0.25 }));
      m.position.set(...p.center.map((x, i) => x - MASS.com[i]));
      internals.add(m);
    });
  internals.visible = false;
  sat.add(internals);
  const com = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  sat.add(com);
  sat.add(new THREE.AxesHelper(260)); // body X red, Y green, Z blue, long enough to clear the hull

  const arrow = (color, len) => {
    const a = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), len, color, 34, 18);
    scene.add(a);
    return a;
  };
  const sunArrow = arrow(0xf5b941, 430);
  const nadirArrow = arrow(0x4fd1a5, 330);
  nadirArrow.setDirection(new THREE.Vector3(0, -1, 0));
  nadirArrow.position.set(0, -60, 0);
  const gsArrow = arrow(0x7c9cff, 380);
  const velArrow = arrow(0x9b94b8, 260);
  velArrow.setDirection(new THREE.Vector3(1, 0, 0));
  velArrow.position.set(0, 230, 0);

  $("showInternals").addEventListener("change", (ev) => {
    const on = ev.target.checked;
    internals.visible = on;
    skin.forEach((m) => {
      m.transparent = on;
      m.opacity = on ? 0.16 : 1;
      m.depthWrite = !on;
      m.needsUpdate = true;
    });
  });

  const resize = () => {
    const w = box.clientWidth, h = box.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(box);
  resize();

  // ease between the 1 Hz attitude snapshots
  const qFrom = new THREE.Quaternion(), qTo = new THREE.Quaternion(), sFrom = new THREE.Vector3(0, 1, 0), sTo = new THREE.Vector3(0, 1, 0);
  let lastAt = -1;
  let visible = false;
  let running = false;
  const frame = () => {
    if (!visible || document.hidden) {
      running = false;
      return;
    }
    const v = getView();
    if (v) {
      if (v.at !== lastAt) {
        qFrom.copy(sat.quaternion);
        sFrom.copy(sTo);
        qTo.set(...v.q);
        sTo.set(...v.sun).normalize();
        if (lastAt < 0) qFrom.copy(qTo), sFrom.copy(sTo);
        lastAt = v.at;
      }
      const a = Math.min(1, (performance.now() - v.at) / 1000);
      sat.quaternion.slerpQuaternions(qFrom, qTo, a);
      const sd = new THREE.Vector3().lerpVectors(sFrom, sTo, a).normalize();
      sunArrow.setDirection(sd);
      sunArrow.visible = !v.eclipse;
      sunLight.position.copy(sd).multiplyScalar(5000);
      sunLight.intensity = v.eclipse ? 0 : 2.4;
      ambient.intensity = v.eclipse ? 0.28 : 0.55;
      gsArrow.visible = !!v.gs;
      if (v.gs) gsArrow.setDirection(new THREE.Vector3(...v.gs));
    }
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  const kick = () => {
    if (visible && !document.hidden && !running) {
      running = true;
      requestAnimationFrame(frame);
    }
  };
  new IntersectionObserver(([en]) => {
    visible = en.isIntersecting;
    kick();
  }).observe(box);
  document.addEventListener("visibilitychange", kick);
}
