import { MISSION, TEAM, MODES, COMPONENTS, BUDGET, DATA_BUDGET, GROUND_STATION, ASSETS, TARGET_BOX, CONTRACT, STALE_SEC, LOST_SEC } from "./data.js";
import { FIELD, STATUS_TEXT, formatValue, fieldStatus, limitText } from "./health.js";
import { makeOrbit, stateAt, elevationDeg, visibilityRadiusKm, haversineKm, splitTrack } from "./orbit.js";
import { renderBloom } from "./bloom.js";

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 1) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (d) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
const hhmmss = (d) => `${hhmm(d)}:${pad(d.getUTCSeconds())}`;

// ---------- design-derived numbers ----------
const unitPower = (c) => c.v * c.ma; // mW, same convention as the Madar power budget
const MODE_IDX = { sun: 0, nadir: 1, gs: 2, safe: 3 };
const modeLoadW = MODES.map((_, i) => COMPONENTS.filter((c) => c.on[i]).reduce((s, c) => s + unitPower(c), 0) / 1000);
const GEN_PEAK_W = BUDGET.solarCells * BUDGET.wattsPerCell;
const SUN_FACTOR = { sun: 0.85, nadir: 0.55, gs: 0.6, safe: 0 };
const SUBSYSTEMS = ["CDHS", "Payload", "ADCS", "COMMS", "EPS", "Thermal", "Structure"];
const SUB_COLORS = ["#7c9cff", "#4fd1a5", "#f5b941", "#ff8fb1", "#a07cff", "#ff6b7a", "#8ad8ff"];

// ---------- chart defaults ----------
Chart.defaults.color = "#9b94b8";
Chart.defaults.borderColor = "#2a2440";
Chart.defaults.font.family = "'Space Grotesk', system-ui, sans-serif";
Chart.defaults.plugins.legend.labels.boxWidth = 10;
Chart.defaults.animation = false;

// ---------- simulation state ----------
const orbit = makeOrbit({ altitudeKm: 550, inclinationDeg: 97.6, ltanHours: 22.5, epoch: new Date(Date.UTC(2026, 10, 1)) });
let simTime = new Date();
let warp = 60;
const sim = { soc: 78, tInt: 18, tBat: 14, tPanel: 20, storageMB: 412, heater: false, mode: null, eclipse: null, inPass: false, lastSample: 0 };
const faults = { lowBatt: false, cold: false, link: false, glitch: false };
const MAX_POINTS = 200;
const bootAt = performance.now();

// Same priority order as the flight software: power safety first, then the ground pass, then imaging.
function currentMode(st, el, soc) {
  if (st.eclipse || soc < 20) return "safe";
  if (el > GROUND_STATION.minElevDeg) return "gs";
  const c = { lat: (TARGET_BOX.latMin + TARGET_BOX.latMax) / 2, lon: (TARGET_BOX.lonMin + TARGET_BOX.lonMax) / 2 };
  if (haversineKm(st, c) < 900) return "nadir";
  return "sun";
}

function stepPhysics(dtSec, realDtSec, mode, eclipse) {
  const jitter = () => 1 + (Math.random() - 0.5) * 0.06;
  const load = modeLoadW[MODE_IDX[mode]] * jitter() + (sim.heater ? 1.0 : 0);
  const gen = eclipse ? 0 : GEN_PEAK_W * SUN_FACTOR[mode] * jitter();
  sim.soc = Math.min(100, Math.max(0, sim.soc + ((gen * 0.92 - load) * dtSec) / 3600 / BUDGET.batteryWh * 100));
  const relax = (cur, target, tauMin) => cur + (target - cur) * (1 - Math.exp(-dtSec / (tauMin * 60)));
  const force = (cur, target, tauSec) => cur + (target - cur) * (1 - Math.exp(-realDtSec / tauSec));
  sim.tInt = relax(sim.tInt, eclipse ? 6 : 24, 25);
  if (sim.tBat < 6) sim.heater = true;
  else if (sim.tBat > 10) sim.heater = false;
  sim.tBat = relax(sim.tBat, sim.heater ? 14 : sim.tInt - 2, 30);
  sim.tPanel = relax(sim.tPanel, eclipse ? -35 : 62, 8);
  const rateMBmin = mode === "nadir" ? 0.53 : mode === "gs" ? -1.8 : 0.003;
  sim.storageMB = Math.max(40, sim.storageMB + (rateMBmin * dtSec) / 60);
  // injected faults act on the spacecraft model in real seconds, so they show up at any time warp
  if (faults.lowBatt) sim.soc = force(sim.soc, 12, 2);
  if (faults.cold) {
    sim.heater = true;
    sim.tBat = force(sim.tBat, -6, 5);
  }
  return { load, gen };
}

// What the spacecraft would downlink this second, following the data contract.
function simPacket(st, mode, p) {
  const pkt = {
    t: Math.round((performance.now() - bootAt) / 1000),
    mode,
    soc: +sim.soc.toFixed(1),
    v: +(6.0 + (2.4 * sim.soc) / 100).toFixed(2),
    gen: +p.gen.toFixed(2),
    load: +p.load.toFixed(2),
    tbat: +sim.tBat.toFixed(1),
    tint: +sim.tInt.toFixed(1),
    tpanel: +sim.tPanel.toFixed(1),
    storage: Math.round(sim.storageMB),
    sun: st.eclipse ? 2 : 86,
    lat: +st.lat.toFixed(2),
    lon: +st.lon.toFixed(2),
    heater: sim.heater,
    antenna: true,
  };
  if (mode === "nadir") pkt.ndci = +(0.05 + 0.04 * Math.sin(simTime.getTime() / 4e5)).toFixed(3);
  if (faults.glitch) {
    pkt.soc = 137.5; // impossible value → INVALID
    pkt.v = "ERR"; // wrong type → INVALID
    delete pkt.tbat; // dropped field → goes STALE
  }
  return pkt;
}

// ---------- orbit map ----------
const tiles = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const tileOpts = { attribution: "Tiles &copy; Esri — Esri, HERE, Garmin, &copy; OpenStreetMap contributors", maxZoom: 16 };
const map = L.map("orbitMap", { worldCopyJump: true, zoomControl: true, attributionControl: true }).setView([20, 40], 2);
L.tileLayer(tiles, tileOpts).addTo(map);
L.rectangle([[TARGET_BOX.latMin, TARGET_BOX.lonMin], [TARGET_BOX.latMax, TARGET_BOX.lonMax]], { color: "#f5b941", weight: 1, fillOpacity: 0.08 }).addTo(map);
L.circle([GROUND_STATION.lat, GROUND_STATION.lon], { radius: visibilityRadiusKm(550, 10) * 1000, color: "#7c9cff", weight: 1, fillOpacity: 0.06 }).addTo(map);
L.circleMarker([GROUND_STATION.lat, GROUND_STATION.lon], { radius: 4, color: "#7c9cff", fillOpacity: 1 }).bindTooltip(GROUND_STATION.name).addTo(map);
const pastLayer = L.layerGroup().addTo(map);
const futureLayer = L.layerGroup().addTo(map);
const satIcon = L.divIcon({ className: "", html: '<div style="width:14px;height:14px;background:#4fd1a5;border-radius:3px;box-shadow:0 0 12px #4fd1a5;transform:rotate(45deg)"></div>', iconSize: [14, 14] });
const satMarker = L.marker([0, 0], { icon: satIcon }).addTo(map);
let lastTrackAt = 0;

function drawTrack(now) {
  const step = 30000;
  const past = [], future = [];
  for (let t = -orbit.periodSec * 1000; t <= orbit.periodSec * 1000; t += step) {
    const s = stateAt(orbit, new Date(now.getTime() + t));
    (t <= 0 ? past : future).push([s.lat, s.lon]);
  }
  pastLayer.clearLayers();
  futureLayer.clearLayers();
  splitTrack(past).forEach((seg) => L.polyline(seg, { color: "#4fd1a5", weight: 2, opacity: 0.8 }).addTo(pastLayer));
  splitTrack(future).forEach((seg) => L.polyline(seg, { color: "#4fd1a5", weight: 1.5, opacity: 0.6, dashArray: "4 6" }).addTo(futureLayer));
}

let nextPass = null;
function findNextPass(from) {
  for (let t = 0; t < 36 * 3600; t += 20) {
    const d = new Date(from.getTime() + t * 1000);
    if (elevationDeg(stateAt(orbit, d).ecef, GROUND_STATION) > GROUND_STATION.minElevDeg) return d;
  }
  return null;
}

// ---------- telemetry charts ----------
// Dashed horizontal lines for warning / critical limits.
Chart.register({
  id: "limitLines",
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea: a, scales: { y } } = chart;
    (opts.lines || []).forEach((l) => {
      const py = y.getPixelForValue(l.y);
      if (py < a.top || py > a.bottom) return;
      ctx.save();
      ctx.strokeStyle = l.color;
      ctx.fillStyle = l.color;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(a.left, py);
      ctx.lineTo(a.right, py);
      ctx.stroke();
      ctx.font = "10px 'JetBrains Mono', monospace";
      ctx.fillText(l.label, a.left + 4, py - 3);
      ctx.restore();
    });
  },
});
const WARN = "#f5b941", CRIT = "#ff5d6c";

function lineChart(id, datasets, opts = {}) {
  return new Chart($(id), {
    type: "line",
    data: { labels: [], datasets: datasets.map((d) => ({ pointRadius: 0, borderWidth: 2, tension: 0.25, ...d, data: [] })) },
    options: {
      maintainAspectRatio: false,
      responsive: true,
      interaction: { mode: "index", intersect: false },
      scales: { x: { ticks: { maxTicksLimit: 8 } }, y: opts.y || {} },
      plugins: { legend: { display: datasets.length > 1 }, limitLines: { lines: opts.limits || [] } },
    },
  });
}
const chSoc = lineChart("chSoc", [{ label: "SoC", borderColor: "#4fd1a5", fill: true, backgroundColor: "rgba(79,209,165,0.08)" }], { y: { min: 0, max: 100 }, limits: [{ y: 40, color: WARN, label: "warn 40 %" }, { y: 20, color: CRIT, label: "crit 20 % → SAFE" }] });
const chPower = lineChart("chPower", [
  { label: "Generated", borderColor: "#f5b941" },
  { label: "Consumed", borderColor: "#ff8fb1" },
], { limits: [{ y: 4.5, color: WARN, label: "load warn 4.5 W" }] });
const chTemp = lineChart("chTemp", [
  { label: "Internal", borderColor: "#7c9cff" },
  { label: "Battery", borderColor: "#4fd1a5" },
  { label: "Solar panel", borderColor: "#f5b941" },
], { limits: [{ y: 45, color: CRIT, label: "battery crit 45 °C" }, { y: 5, color: WARN, label: "battery warn 5 °C" }, { y: 0, color: CRIT, label: "battery crit 0 °C" }] });
const chData = lineChart("chData", [{ label: "Storage", borderColor: "#a07cff", fill: true, backgroundColor: "rgba(160,124,255,0.08)" }], { y: { min: 0 }, limits: [{ y: 1600, color: WARN, label: "warn 1600 MB" }] });
const teleCharts = [chSoc, chPower, chTemp, chData];

function pushSample(label, values) {
  teleCharts.forEach((c, ci) => {
    c.data.labels.push(label);
    values[ci].forEach((v, di) => c.data.datasets[di].data.push(v));
    if (c.data.labels.length > MAX_POINTS) {
      c.data.labels.shift();
      c.data.datasets.forEach((d) => d.data.shift());
    }
    c.update();
  });
}

// ---------- status panel ----------
const subsList = $("subsList");
function renderSubs(mode, heaterOn) {
  const i = MODE_IDX[mode];
  subsList.innerHTML = SUBSYSTEMS.map((s) => {
    const parts = COMPONENTS.filter((c) => c.sub === s);
    const onCount = parts.filter((c) => c.on[i] || (c.name.includes("Heater") && heaterOn)).length;
    const p = parts.filter((c) => c.on[i]).reduce((a, c) => a + unitPower(c), 0);
    return `<li><span class="${onCount ? "on" : "off"}">${s}</span><b>${onCount ? fmt(p, 0) + " mW" : "idle"}</b></li>`;
  }).join("");
}
const logEl = $("eventLog");
function logEvent(t, msg) {
  const li = document.createElement("li");
  li.innerHTML = `<b>${hhmm(t)}</b> ${msg}`;
  logEl.prepend(li);
  while (logEl.children.length > 30) logEl.lastChild.remove();
}
const MODE_LABEL = { sun: "Sun pointing", nadir: "Nadir imaging", gs: "Ground pass", safe: "Safe / eclipse" };

// ---------- CONOPS ----------
function renderConops() {
  const total = MODES.reduce((s, m) => s + m.min, 0);
  $("timeline").innerHTML =
    MODES.map((m) => `<div class="seg" style="width:${(m.min / total) * 100}%;background:${m.color}" title="${m.name}: ${m.min} min">${m.name.split(" (")[0]} · ${m.min}m</div>`).join("") +
    '<div class="cursor" id="tlCursor"></div>';
  const head = `<thead><tr><th>Component</th>${MODES.map((m) => `<th class="mode">${m.name.split(" (")[0]}<br><span class="muted">${m.min} min</span></th>`).join("")}<th class="num">Active min</th><th class="num">mWh / orbit</th></tr></thead>`;
  const rows = COMPONENTS.map((c) => {
    const active = MODES.reduce((s, m, i) => s + (c.on[i] ? m.min : 0), 0);
    return `<tr><td>${c.name}</td>${c.on.map((o) => `<td class="dot"><span class="${o ? "y" : ""}"></span></td>`).join("")}<td class="num">${active}</td><td class="num">${fmt((unitPower(c) * active) / 60, 1)}</td></tr>`;
  }).join("");
  const energy = MODES.reduce((s, m, i) => s + modeLoadW[i] * m.min * 1000 / 60, 0);
  $("conopsTable").innerHTML = `${head}<tbody>${rows}</tbody><tfoot><tr><td><b>Mode load</b></td>${modeLoadW.map((w) => `<td class="num">${fmt(w, 2)} W</td>`).join("")}<td></td><td class="num"><b>${fmt(energy, 0)}</b></td></tr></tfoot>`;
}

// ---------- budgets ----------
function bySub(fn) {
  return SUBSYSTEMS.map((s) => COMPONENTS.filter((c) => c.sub === s).reduce((a, c) => a + fn(c), 0));
}
function doughnut(id, values) {
  return new Chart($(id), {
    type: "doughnut",
    data: { labels: SUBSYSTEMS, datasets: [{ data: values, backgroundColor: SUB_COLORS, borderColor: "#14111f", borderWidth: 2 }] },
    options: { maintainAspectRatio: false, cutout: "62%", plugins: { legend: { position: "bottom" } } },
  });
}
function renderBudgets() {
  doughnut("chPowSub", bySub(unitPower));
  doughnut("chMass", bySub((c) => c.g * c.qty));
  doughnut("chCost", bySub((c) => c.aed * c.qty));
  new Chart($("chEnergyMode"), {
    type: "bar",
    data: {
      labels: MODES.map((m) => m.name.split(" (")[0]),
      datasets: [{ data: MODES.map((m, i) => (modeLoadW[i] * m.min * 1000) / 60), backgroundColor: MODES.map((m) => m.color), borderRadius: 6 }],
    },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });

  const days = (DATA_BUDGET.storageGB * 1024) / DATA_BUDGET.storedPerDayMB;
  const m = [
    { name: "Power", used: BUDGET.totalLoadW, cap: GEN_PEAK_W, unit: "W", note: `margin +${fmt(GEN_PEAK_W - BUDGET.totalLoadW, 2)} W` },
    { name: "Mass", used: BUDGET.massKg, cap: BUDGET.massLimitKg, unit: "kg", note: `margin ${fmt(BUDGET.massLimitKg - BUDGET.massKg, 2)} kg` },
    { name: "Volume", used: BUDGET.volumeCm3, cap: BUDGET.volumeLimitCm3, unit: "cm³", note: `margin ${fmt(BUDGET.volumeLimitCm3 - BUDGET.volumeCm3, 0)} cm³` },
    { name: "Cost", used: BUDGET.costAED, cap: BUDGET.costLimitAED, unit: "AED", note: `margin ${fmt(BUDGET.costLimitAED - BUDGET.costAED, 0)} AED` },
  ];
  $("margins").innerHTML =
    m.map((x) => `<div class="margin"><div class="row"><span>${x.name}</span><b>${fmt(x.used, x.unit === "AED" || x.unit === "cm³" ? 0 : 2)} / ${fmt(x.cap, x.unit === "AED" || x.unit === "cm³" ? 0 : 2)} ${x.unit}</b></div><div class="meter"><i style="width:${Math.min(100, (x.used / x.cap) * 100)}%"></i></div><div class="row"><span class="muted small">${fmt((x.used / x.cap) * 100, 0)}% used</span><span class="muted small">${x.note}</span></div></div>`).join("") +
    `<p class="muted small" style="grid-column:1/-1;margin:0">Data: ${DATA_BUDGET.perDayMB} MB/day generated, ${DATA_BUDGET.sentPerDayMB} MB/day downlinked over LoRa; the 2 GB card holds ~${fmt(days, 0)} days of raw imagery, so only bloom-flagged scenes are kept after each pass.</p>`;
}

// ---------- BOM ----------
function renderBom(filter = "") {
  const rows = COMPONENTS.filter((c) => !filter || c.sub === filter);
  const tot = rows.reduce((a, c) => ({ g: a.g + c.g * c.qty, aed: a.aed + c.aed * c.qty, p: a.p + unitPower(c) }), { g: 0, aed: 0, p: 0 });
  $("bomTable").innerHTML = `<thead><tr><th>Component</th><th>Subsystem</th><th class="num">Qty</th><th class="num">V</th><th class="num">mA</th><th class="num">Power mW</th><th class="num">Mass g</th><th>L×W×H mm</th><th class="num">Cost AED</th><th>Data</th><th>Vendor</th></tr></thead>
  <tbody>${rows.map((c) => `<tr><td>${c.name}</td><td><span class="tag">${c.sub}</span></td><td class="num">${c.qty}</td><td class="num">${c.v}</td><td class="num">${c.ma}</td><td class="num">${fmt(unitPower(c), 1)}</td><td class="num">${c.g * c.qty}</td><td>${c.dims.join("×")}</td><td class="num">${c.aed * c.qty}</td><td>${c.data}</td><td>${c.vendor}</td></tr>`).join("")}</tbody>
  <tfoot><tr><td>Total (${rows.length} line items)</td><td></td><td></td><td></td><td></td><td class="num">${fmt(tot.p, 1)}</td><td class="num">${tot.g}</td><td></td><td class="num">${tot.aed}</td><td></td><td></td></tr></tfoot>`;
}
const subFilter = $("subFilter");
SUBSYSTEMS.forEach((s) => subFilter.insertAdjacentHTML("beforeend", `<option>${s}</option>`));
subFilter.addEventListener("change", () => renderBom(subFilter.value));

// ---------- mission & team ----------
function renderMission() {
  const items = [
    ["Mission", `${MISSION.name} — ${MISSION.meaning}`],
    ["Primary objective", MISSION.objective],
    ["Success criterion", MISSION.success],
    ["Minimum lifetime", MISSION.duration],
    ["Operations", MISSION.tasks],
    ["Orbit", `Sun-synchronous, ${MISSION.orbit.altitudeKm} km, i = ${MISSION.orbit.inclinationDeg}°, ${MISSION.orbit.ltdn} LTDN · ${MISSION.orbit.periodMin} min period · ${MISSION.orbit.orbitsPerDay} orbits/day`],
    ["Platform", MISSION.size],
    ["Why it matters", "Red-tide events in 2008–09 and since have forced UAE desalination plants to cut output and caused large fish kills. Daily, low-cost bloom maps give operators days of warning to adjust intakes and pre-treatment."],
  ];
  $("missionDl").innerHTML = items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
  $("teamList").innerHTML = TEAM.map((t) => `<li><div class="avatar">${t.name.split(" ").map((p) => p[0]).join("")}</div><div>${t.name}<span>${t.role}</span></div></li>`).join("");
}

// ---------- ground segment: packets in, status out ----------
let source = "sim"; // "sim" until a prototype is connected over USB, then "live"
let latest = {}; // key → { v, at }: newest value of every field and when it arrived
let lastPktAt = null;
let pktCount = 0;
let rejected = 0;
let newSinceSample = false;
let warming = false;

function ingest(pkt) {
  if (faults.link) return; // nothing reaches the ground station
  const now = performance.now();
  for (const [k, v] of Object.entries(pkt)) if (FIELD[k]) latest[k] = { v, at: now };
  lastPktAt = now;
  pktCount++;
  newSinceSample = true;
}

// Value of a field if it is fresh and valid, else null (so charts show a gap).
const fresh = (key) => {
  const f = fieldStatus(latest, key, performance.now());
  return f.status === "ok" || f.status === "warn" || f.status === "crit" ? latest[key].v : null;
};

// Status tiles
const TILES = [
  { key: "mode", label: "Mode" },
  { key: "soc", label: "Battery SoC" },
  { key: "v", label: "Bus voltage" },
  { key: "tbat", label: "Battery temp" },
  { key: "load", label: "Load power" },
  { key: "tint", label: "Internal temp" },
  { key: "tpanel", label: "Solar panel temp" },
  { key: "storage", label: "Storage used" },
];
function gaugeZones(c) {
  const [lo, hi] = c.scale;
  const pct = (x) => ((Math.min(hi, Math.max(lo, x)) - lo) / (hi - lo)) * 100;
  const zone = (cls, a, b) => `<i class="zone ${cls}" style="left:${pct(a)}%;width:${pct(b) - pct(a)}%"></i>`;
  let z = c.nominal ? zone("n", c.nominal[0], c.nominal[1]) : "";
  if (c.warnLow != null) z += zone("w", c.critLow ?? lo, c.warnLow);
  if (c.critLow != null) z += zone("c", lo, c.critLow);
  if (c.warnHigh != null) z += zone("w", c.warnHigh, c.critHigh ?? hi);
  if (c.critHigh != null) z += zone("c", c.critHigh, hi);
  return z;
}
$("tiles").innerHTML = TILES.map(({ key, label }) => {
  const c = FIELD[key];
  return `<div class="tile st-missing" id="tile-${key}" role="group" aria-label="${label}">
    <div class="t-top"><span class="t-lbl">${label}</span><span class="t-st" id="tst-${key}">No data</span></div>
    <div class="t-val"><span id="tv-${key}">—</span>${c.unit ? `<small>${c.unit}</small>` : ""}</div>
    ${c.scale ? `<div class="gauge" aria-hidden="true">${gaugeZones(c)}<i class="mark" id="tm-${key}" style="left:0%"></i></div>` : ""}
    <div class="t-sub" id="tsub-${key}"></div>
    <div class="t-lim">${c.type === "enum" ? "sun · nadir · gs · safe" : limitText(c)}</div>
  </div>`;
}).join("");

function tileSub(key, st) {
  const gen = fresh("gen");
  const load = fresh("load");
  switch (key) {
    case "mode":
      return st.status === "ok" ? (sim.eclipse ? "in Earth's shadow" : sim.inPass ? "over Abu Dhabi GS" : "sunlit") : st.reason;
    case "soc":
      if (st.status === "crit") return "SAFE mode enforced";
      return gen !== null && load !== null ? (gen - load >= 0 ? "charging" : "discharging") : st.reason;
    case "tbat":
      return fresh("heater") !== null ? `heater ${fresh("heater") ? "ON" : "OFF"}${st.reason ? " · " + st.reason : ""}` : st.reason;
    case "load":
      return gen !== null && load !== null ? `solar ${gen.toFixed(2)} W · net ${gen - load >= 0 ? "+" : ""}${(gen - load).toFixed(2)} W` : st.reason;
    case "storage":
      return fresh("storage") !== null ? `${((fresh("storage") / 2048) * 100).toFixed(0)} % of 2 GB` : st.reason;
    default:
      return st.reason;
  }
}

function setStatusClass(el, status) {
  el.className = `${el.className.replace(/\bst-\w+/g, "").trim()} st-${status}`;
}

// Alarms latch on entry to warn/crit/invalid and stay in the history, with times, after they clear.
const alarms = []; // { key, level, msg, raised, cleared, ack }
const active = {}; // key → alarm
const LEVEL_TEXT = { warn: "WARNING", crit: "CRITICAL", invalid: "INVALID" };
function raise(key, level, msg) {
  const cur = active[key];
  if (cur && cur.level === level) return;
  if (cur) cur.cleared = new Date(simTime);
  const a = { key, level, msg, raised: new Date(simTime), cleared: null, ack: false };
  alarms.unshift(a);
  active[key] = a;
  if (alarms.length > 60) alarms.pop();
  if (!warming) logEvent(simTime, `<span class="st-${level}">${LEVEL_TEXT[level]}</span> ${msg}`);
}
function clear(key) {
  const cur = active[key];
  if (!cur) return;
  cur.cleared = new Date(simTime);
  delete active[key];
  if (!warming) logEvent(simTime, `Cleared: ${cur.msg}`);
}

function linkState(nowMs) {
  if (lastPktAt === null) return { status: "missing", label: "NO DATA" };
  const age = (nowMs - lastPktAt) / 1000;
  if (age > LOST_SEC) return { status: "crit", label: "LINK LOST", age };
  if (age > STALE_SEC) return { status: "stale", label: "STALE", age };
  return { status: "ok", label: source === "live" ? "LIVE · USB" : "SIM", age };
}

function refreshStatus() {
  const now = performance.now();
  const link = linkState(now);
  const pill = $("linkPill");
  pill.textContent = link.label;
  setStatusClass(pill, link.status === "stale" ? "warn" : link.status);
  $("pktAge").textContent = link.age === undefined ? "—" : link.age < 60 ? `${link.age.toFixed(1)} s ago` : `${Math.floor(link.age / 60)} min ago`;
  $("srcChip").textContent = link.status === "crit" ? "LINK LOST" : source === "live" ? "LIVE · PROTOTYPE" : "SIMULATED";
  $("pktMeta").textContent = `${pktCount} packets · ${rejected} rejected · ${source === "live" ? "USB prototype" : "simulator"}`;

  if (link.status === "crit") raise("link", "crit", `Telemetry link lost — no packets for ${LOST_SEC} s`);
  else if (link.status === "stale") raise("link", "warn", `Telemetry stale — no packets for ${STALE_SEC} s`);
  else clear("link");

  const statuses = {};
  CONTRACT.forEach((c) => {
    const st = fieldStatus(latest, c.key, now);
    statuses[c.key] = st;
    const val = latest[c.key]?.v;
    if (st.status === "warn" || st.status === "crit") raise(c.key, st.status, `${c.label} ${formatValue(c, val)}${c.unit ? " " + c.unit : ""} ${st.reason}`);
    else if (st.status === "invalid") raise(c.key, "invalid", `${c.label} ${st.reason}`);
    else if (st.status === "missing" && c.required && lastPktAt !== null) raise(c.key, "warn", `${c.label} missing from packets (required field)`);
    else if (st.status === "ok") clear(c.key);
    // a stale field keeps its last alarm state; the link alarm covers a silent spacecraft
  });

  TILES.forEach(({ key }) => {
    const c = FIELD[key];
    const st = statuses[key];
    const val = latest[key]?.v;
    setStatusClass($(`tile-${key}`), st.status);
    $(`tst-${key}`).textContent = STATUS_TEXT[st.status];
    $(`tv-${key}`).textContent = key === "mode" && MODE_LABEL[val] ? MODE_LABEL[val] : formatValue(c, val);
    $(`tsub-${key}`).textContent = tileSub(key, st);
    const m = document.getElementById(`tm-${key}`);
    if (m && typeof val === "number" && Number.isFinite(val)) {
      const [lo, hi] = c.scale;
      m.style.left = `${((Math.min(hi, Math.max(lo, val)) - lo) / (hi - lo)) * 100}%`;
    }
  });

  $("readTable").innerHTML = `<thead><tr><th>Signal</th><th class="num">Value</th><th>Unit</th><th>Limits</th><th>Status</th><th class="num">Age</th></tr></thead><tbody>${CONTRACT.map((c) => {
    const st = statuses[c.key];
    return `<tr class="st-${st.status}"><td>${c.label}</td><td>${formatValue(c, latest[c.key]?.v)}</td><td>${c.unit || ""}</td><td class="lim">${limitText(c)}</td><td class="stc st-${st.status}" title="${st.reason}">${STATUS_TEXT[st.status]}</td><td class="age">${st.age == null ? "—" : st.age.toFixed(1) + " s"}</td></tr>`;
  }).join("")}</tbody>`;

  renderAlarms();
}

function renderAlarms() {
  const act = alarms.filter((a) => !a.cleared);
  const crit = act.some((a) => a.level === "crit" && !a.ack);
  const badge = $("alarmBadge");
  badge.textContent = act.length ? `${act.length} alarm${act.length > 1 ? "s" : ""}` : "No alarms";
  setStatusClass(badge, !act.length ? "ok" : crit ? "crit" : "warn");
  $("alarmActive").innerHTML = act.length
    ? act.map((a) => `<li class="st-${a.level}${a.ack ? " acked" : ""}"><span class="lvl">${LEVEL_TEXT[a.level]}</span><span class="msg">${a.msg}</span><time>${hhmmss(a.raised)}</time></li>`).join("")
    : `<li class="none">All monitored values nominal</li>`;
  $("alarmLog").innerHTML = alarms
    .slice(0, 25)
    .map((a) => `<li><b>${hhmmss(a.raised)}</b> <span class="lvl st-${a.level}">${LEVEL_TEXT[a.level]}</span>${a.msg}${a.cleared ? ` <span class="st-ok">· cleared ${hhmmss(a.cleared)}</span>` : ""}</li>`)
    .join("");
}
$("ackBtn").addEventListener("click", () => {
  alarms.forEach((a) => (a.ack = true));
  renderAlarms();
});

// Fault injection
const FAULT_TEXT = { lowBatt: "Low battery", cold: "Cold battery (heater fault)", link: "Link loss", glitch: "Sensor glitch" };
document.querySelectorAll("[data-fault]").forEach((b) =>
  b.addEventListener("click", () => {
    const f = b.dataset.fault;
    faults[f] = !faults[f];
    b.setAttribute("aria-pressed", String(faults[f]));
    logEvent(simTime, `<b>Test</b> fault ${faults[f] ? "injected" : "removed"}: ${FAULT_TEXT[f]}`);
    refreshStatus();
  })
);
$("clearFaults").addEventListener("click", () => {
  Object.keys(faults).forEach((f) => (faults[f] = false));
  document.querySelectorAll("[data-fault]").forEach((b) => b.setAttribute("aria-pressed", "false"));
  Object.assign(sim, { soc: Math.max(sim.soc, 78), tBat: Math.max(sim.tBat, 14), heater: false });
  logEvent(simTime, "<b>Test</b> all faults cleared, spacecraft model reset to nominal");
});

// Data contract card
function renderContract() {
  $("contractTable").innerHTML = `<thead><tr><th>Field</th><th>Type</th><th>Unit</th><th>Limits</th><th>Req.</th><th>Meaning</th></tr></thead><tbody>${CONTRACT.map(
    (c) => `<tr><td>${c.key}</td><td>${c.type}</td><td>${c.unit || "—"}</td><td class="lim">${limitText(c)}</td><td>${c.required ? "yes" : ""}</td><td class="desc">${c.desc}</td></tr>`
  ).join("")}</tbody>`;
  $("examplePkt").textContent = JSON.stringify({ t: 5412, mode: "nadir", soc: 82.4, v: 7.98, gen: 3.61, load: 2.95, tbat: 17.2, tint: 21.6, tpanel: 48.3, storage: 436, sun: 86, ndci: 0.071, lat: 25.12, lon: 55.4, heater: false, antenna: true }, null, 1);
}

// ---------- main loop ----------
function tick(realDtSec) {
  const dt = realDtSec * warp;
  simTime = new Date(simTime.getTime() + dt * 1000);
  const st = stateAt(orbit, simTime);
  const el = elevationDeg(st.ecef, GROUND_STATION);
  const simMode = currentMode(st, el, sim.soc);

  if (sim.eclipse !== null && st.eclipse !== sim.eclipse && !warming) logEvent(simTime, st.eclipse ? "Eclipse entry" : "Eclipse exit — charging");
  const inPass = el > GROUND_STATION.minElevDeg;
  if (inPass !== sim.inPass) {
    if (!warming) logEvent(simTime, inPass ? `AOS ${GROUND_STATION.name} — downlinking bloom alerts` : `LOS ${GROUND_STATION.name}`);
    if (!inPass) nextPass = null;
  }
  sim.eclipse = st.eclipse;
  sim.inPass = inPass;

  const p = stepPhysics(dt, realDtSec, simMode, st.eclipse);
  if (source === "sim") ingest(simPacket(st, simMode, p));

  // Everything below is drawn from received packets only; stale or missing fields show as gaps.
  const pktMode = fresh("mode");
  const mode = pktMode || sim.mode || simMode;
  if (sim.mode && mode !== sim.mode && !warming) logEvent(simTime, `${MODE_LABEL[sim.mode]} → <b>${MODE_LABEL[mode]}</b>`);
  sim.mode = mode;

  const lat = fresh("lat") ?? st.lat;
  const lon = fresh("lon") ?? st.lon;
  satMarker.setLatLng([lat, lon]);
  if (simTime.getTime() - lastTrackAt > 60000 * Math.max(1, warp / 10)) {
    drawTrack(simTime);
    lastTrackAt = simTime.getTime();
  }
  if (!nextPass || nextPass < simTime) nextPass = findNextPass(simTime);

  $("utc").textContent = hhmmss(simTime);
  $("sLat").textContent = `${fmt(lat, 2)}°`;
  $("sLon").textContent = `${fmt(lon, 2)}°`;
  $("sSun").textContent = st.eclipse ? "Eclipse" : "Sunlit";
  $("sEl").textContent = `${fmt(el, 1)}°`;
  $("sOrbit").textContent = st.orbitNumber;
  $("sNext").textContent = inPass ? "in pass now" : nextPass ? `${hhmm(nextPass)} UTC (+${Math.round((nextPass - simTime) / 60000)} min)` : "—";
  const cur = document.getElementById("tlCursor");
  if (cur) cur.style.left = `${st.orbitPhase * 100}%`;
  renderSubs(mode, fresh("heater") === true);

  sim.lastSample += dt;
  if (sim.lastSample >= 30 || (source === "live" && newSinceSample)) {
    sim.lastSample = 0;
    newSinceSample = false;
    const label = source === "live" ? hhmmss(new Date()) : hhmm(simTime);
    pushSample(label, [[fresh("soc")], [fresh("gen"), fresh("load")], [fresh("tint"), fresh("tbat"), fresh("tpanel")], [fresh("storage")]]);
  }
}

// Pre-fill charts with one orbit of history so the page is informative on first load.
function warmUp() {
  const saved = warp;
  warp = 1;
  warming = true;
  simTime = new Date(simTime.getTime() - orbit.periodSec * 1000 * 1.2);
  for (let i = 0; i < (orbit.periodSec * 1.2) / 30; i++) {
    tick(30);
    lastPktAt = performance.now(); // warm-up packets all arrive "now"
    Object.values(latest).forEach((e) => (e.at = lastPktAt));
  }
  warp = saved;
  warming = false;
}

document.querySelectorAll("[data-warp]").forEach((b) =>
  b.addEventListener("click", () => {
    warp = Number(b.dataset.warp);
    document.querySelectorAll("[data-warp]").forEach((x) => x.classList.toggle("active", x === b));
  })
);

// ---------- Web Serial link to the prototype (ESP32-S3 firmware or the Tinkercad/Arduino sketch) ----------
$("serialBtn").addEventListener("click", async () => {
  if (!("serial" in navigator)) {
    alert("Web Serial is not available in this browser. Use Chrome or Edge on desktop.");
    return;
  }
  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    source = "live";
    latest = {}; // never mix simulated values into live telemetry
    lastPktAt = null;
    $("serialBtn").textContent = "Prototype connected";
    $("serialBtn").classList.add("live");
    $("srcChip").classList.add("live");
    logEvent(simTime, "<b>Prototype connected</b> over USB — showing live packets only");
    const reader = port.readable.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("{")) continue; // EVENT lines and boot text
        try {
          ingest(JSON.parse(line));
        } catch {
          rejected++;
          logEvent(simTime, `Rejected malformed packet (${line.length} bytes)`);
        }
      }
    }
  } catch (e) {
    logEvent(simTime, `Serial: ${e.message}`);
  }
});

renderConops();
renderBudgets();
renderBom();
renderMission();
renderContract();
renderBloom({ mapId: "bloomMap", tableId: "alertTable", buttonId: "rescanBtn", tiles, tileOpts, assets: ASSETS });
warmUp();
drawTrack(simTime);
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  tick((now - last) / 1000);
  last = now;
}, 1000);
refreshStatus();
setInterval(refreshStatus, 250);
