import { MISSION, TEAM, MODES, COMPONENTS, BUDGET, DATA_BUDGET, GROUND_STATION, ASSETS, TARGET_BOX } from "./data.js";
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
let live = null; // latest telemetry object from the prototype, when connected
const sim = { soc: 78, tInt: 18, tBat: 14, tPanel: 20, storageMB: 412, mode: null, eclipse: null, inPass: false, lastSample: 0 };
const MAX_POINTS = 200;

function currentMode(st, el) {
  if (st.eclipse) return "safe";
  if (el > GROUND_STATION.minElevDeg) return "gs";
  const c = { lat: (TARGET_BOX.latMin + TARGET_BOX.latMax) / 2, lon: (TARGET_BOX.lonMin + TARGET_BOX.lonMax) / 2 };
  if (haversineKm(st, c) < 900) return "nadir";
  return "sun";
}

function stepPhysics(dtSec, mode, eclipse) {
  const jitter = () => 1 + (Math.random() - 0.5) * 0.06;
  const load = modeLoadW[MODE_IDX[mode]] * jitter();
  const gen = eclipse ? 0 : GEN_PEAK_W * SUN_FACTOR[mode] * jitter();
  sim.soc = Math.min(100, Math.max(0, sim.soc + ((gen * 0.92 - load) * dtSec) / 3600 / BUDGET.batteryWh * 100));
  const relax = (cur, target, tauMin) => cur + (target - cur) * (1 - Math.exp(-dtSec / (tauMin * 60)));
  sim.tInt = relax(sim.tInt, eclipse ? 6 : 24, 25);
  const heaterOn = mode === "safe" && sim.tBat < 8;
  sim.tBat = relax(sim.tBat, heaterOn ? 12 : sim.tInt - 2, 30);
  sim.tPanel = relax(sim.tPanel, eclipse ? -35 : 62, 8);
  const rateMBmin = mode === "nadir" ? 0.53 : mode === "gs" ? -1.8 : 0.003;
  sim.storageMB = Math.max(40, sim.storageMB + (rateMBmin * dtSec) / 60);
  return { load, gen, heaterOn };
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
function lineChart(id, datasets, opts = {}) {
  return new Chart($(id), {
    type: "line",
    data: { labels: [], datasets: datasets.map((d) => ({ pointRadius: 0, borderWidth: 2, tension: 0.25, ...d, data: [] })) },
    options: {
      maintainAspectRatio: false,
      responsive: true,
      interaction: { mode: "index", intersect: false },
      scales: { x: { ticks: { maxTicksLimit: 8 } }, y: opts.y || {} },
      plugins: { legend: { display: datasets.length > 1 } },
    },
  });
}
const chSoc = lineChart("chSoc", [{ label: "SoC", borderColor: "#4fd1a5", fill: true, backgroundColor: "rgba(79,209,165,0.08)" }], { y: { min: 0, max: 100 } });
const chPower = lineChart("chPower", [
  { label: "Generated", borderColor: "#f5b941" },
  { label: "Consumed", borderColor: "#ff8fb1" },
]);
const chTemp = lineChart("chTemp", [
  { label: "Internal", borderColor: "#7c9cff" },
  { label: "Battery", borderColor: "#4fd1a5" },
  { label: "Solar panel", borderColor: "#f5b941" },
]);
const chData = lineChart("chData", [{ label: "Storage", borderColor: "#a07cff", fill: true, backgroundColor: "rgba(160,124,255,0.08)" }], { y: { min: 0 } });
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

// ---------- main loop ----------
function tick(realDtSec) {
  const dt = realDtSec * warp;
  simTime = new Date(simTime.getTime() + dt * 1000);
  const st = stateAt(orbit, simTime);
  const el = elevationDeg(st.ecef, GROUND_STATION);
  const mode = live?.mode && MODE_IDX[live.mode] !== undefined ? live.mode : currentMode(st, el);

  if (sim.mode && mode !== sim.mode) logEvent(simTime, `${MODE_LABEL[sim.mode]} → <b>${MODE_LABEL[mode]}</b>`);
  if (sim.eclipse !== null && st.eclipse !== sim.eclipse) logEvent(simTime, st.eclipse ? "Eclipse entry" : "Eclipse exit — charging");
  const inPass = el > GROUND_STATION.minElevDeg;
  if (inPass !== sim.inPass) {
    logEvent(simTime, inPass ? `AOS ${GROUND_STATION.name} — downlinking bloom alerts` : `LOS ${GROUND_STATION.name}`);
    if (!inPass) nextPass = null;
  }
  sim.mode = mode;
  sim.eclipse = st.eclipse;
  sim.inPass = inPass;

  const p = stepPhysics(dt, mode, st.eclipse);
  const tele = {
    soc: live?.soc ?? sim.soc,
    gen: live?.gen ?? p.gen,
    load: live?.load ?? p.load,
    tInt: live?.tint ?? sim.tInt,
    tBat: live?.tbat ?? sim.tBat,
    tPanel: live?.tpanel ?? sim.tPanel,
    storage: live?.storage ?? sim.storageMB,
  };
  const lat = live?.lat ?? st.lat;
  const lon = live?.lon ?? st.lon;

  satMarker.setLatLng([lat, lon]);
  if (simTime.getTime() - lastTrackAt > 60000 * Math.max(1, warp / 10)) {
    drawTrack(simTime);
    lastTrackAt = simTime.getTime();
  }
  if (!nextPass || nextPass < simTime) nextPass = findNextPass(simTime);

  $("utc").textContent = hhmmss(simTime);
  $("kMode").textContent = MODE_LABEL[mode];
  $("kModeSub").textContent = st.eclipse ? "in Earth's shadow" : inPass ? `${fmt(el, 0)}° above Abu Dhabi` : "sunlit";
  $("kSoc").textContent = `${fmt(tele.soc, 1)}%`;
  $("kBus").textContent = `bus ${fmt(6.4 + (1.9 * tele.soc) / 100, 2)} V · ${tele.gen - tele.load >= 0 ? "charging" : "discharging"}`;
  $("sLat").textContent = `${fmt(lat, 2)}°`;
  $("sLon").textContent = `${fmt(lon, 2)}°`;
  $("sSun").textContent = st.eclipse ? "Eclipse" : "Sunlit";
  $("sEl").textContent = `${fmt(el, 1)}°`;
  $("sOrbit").textContent = st.orbitNumber;
  $("sNext").textContent = inPass ? "in pass now" : nextPass ? `${hhmm(nextPass)} UTC (+${Math.round((nextPass - simTime) / 60000)} min)` : "—";
  const cur = document.getElementById("tlCursor");
  if (cur) cur.style.left = `${st.orbitPhase * 100}%`;
  renderSubs(mode, p.heaterOn);

  sim.lastSample += dt;
  if (sim.lastSample >= 30 || live) {
    sim.lastSample = 0;
    pushSample(hhmm(simTime), [[tele.soc], [tele.gen, tele.load], [tele.tInt, tele.tBat, tele.tPanel], [tele.storage]]);
  }
}

// Pre-fill charts with one orbit of history so the page is informative on first load.
function warmUp() {
  const saved = warp;
  warp = 1;
  simTime = new Date(simTime.getTime() - orbit.periodSec * 1000 * 1.2);
  for (let i = 0; i < (orbit.periodSec * 1.2) / 30; i++) tick(30);
  warp = saved;
}

document.querySelectorAll("[data-warp]").forEach((b) =>
  b.addEventListener("click", () => {
    warp = Number(b.dataset.warp);
    document.querySelectorAll("[data-warp]").forEach((x) => x.classList.toggle("active", x === b));
  })
);

// ---------- Web Serial link to the ESP32 prototype ----------
$("serialBtn").addEventListener("click", async () => {
  if (!("serial" in navigator)) {
    alert("Web Serial is not available in this browser. Use Chrome or Edge on desktop.");
    return;
  }
  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    $("serialBtn").textContent = "Prototype connected";
    $("serialBtn").classList.add("live");
    $("srcChip").textContent = "LIVE · PROTOTYPE";
    $("srcChip").classList.add("live");
    logEvent(simTime, "<b>Prototype connected</b> over USB");
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
        if (line.startsWith("{")) {
          try { live = JSON.parse(line); } catch { /* ignore partial lines */ }
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
renderBloom({ mapId: "bloomMap", tableId: "alertTable", buttonId: "rescanBtn", tiles, tileOpts, assets: ASSETS });
warmUp();
drawTrack(simTime);
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  tick((now - last) / 1000);
  last = now;
}, 1000);
