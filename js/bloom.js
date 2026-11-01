// Bloom-watch panel: renders a chlorophyll-a field over UAE waters and per-asset alerts.
// Until the prototype payload produces real NDCI maps, the field is a seeded synthetic
// one (background + drifting bloom patches), clearly labelled as demo data in the UI.

import { haversineKm } from "./orbit.js";

// Rough sea polygons (lat, lon) hugging the UAE coast, so cells don't land on land.
const GULF = [
  [24.05, 51.85], [24.0, 52.3], [24.1, 52.7], [24.1, 53.4], [24.3, 53.9], [24.5, 54.35], [24.85, 54.85],
  [25.0, 55.05], [25.27, 55.3], [25.35, 55.4], [25.5, 55.55], [25.8, 55.95], [26.05, 56.08], [26.3, 56.25],
  [26.35, 55.6], [26.2, 54.6], [26.25, 53.6], [26.1, 52.6], [25.6, 52.0], [24.9, 51.85],
];
const OMAN = [
  [26.2, 56.45], [25.62, 56.33], [25.34, 56.4], [25.12, 56.4], [24.95, 56.4], [24.5, 56.65],
  [24.3, 57.4], [25.4, 57.6], [26.0, 57.2],
];

function inPoly(lat, lon, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function color(v) {
  const stops = [[0, [27, 58, 107]], [4, [31, 138, 122]], [10, [155, 211, 74]], [20, [245, 185, 65]], [30, [255, 107, 122]]];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i];
      const t = (v - a) / (b - a);
      return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * t)).join(",")})`;
    }
  }
  return "rgb(255,107,122)";
}

export function renderBloom({ mapId, tableId, buttonId, tiles, tileOpts, assets }) {
  const map = L.map(mapId, { zoomControl: true }).setView([25.0, 54.9], 7);
  L.tileLayer(tiles, tileOpts).addTo(map);
  const cellLayer = L.layerGroup().addTo(map);
  assets.forEach((a) =>
    L.circleMarker([a.lat, a.lon], { radius: 5, color: "#fff", weight: 1.5, fillColor: "#0a0912", fillOpacity: 1 })
      .bindTooltip(a.name)
      .addTo(map)
  );

  const STEP = 0.1;
  const cells = [];
  for (let lat = 23.9; lat < 26.5; lat += STEP)
    for (let lon = 51.8; lon < 57.7; lon += STEP) {
      const c = { lat: lat + STEP / 2, lon: lon + STEP / 2 };
      if (inPoly(c.lat, c.lon, GULF) || inPoly(c.lat, c.lon, OMAN)) cells.push(c);
    }

  let day = 0;
  function draw() {
    const r = rng(20261101 + day * 7919);
    const patches = [
      { lat: 25.25 + (r() - 0.5) * 0.5, lon: 56.6 + (r() - 0.5) * 0.4, amp: 14 + r() * 18, s: 0.22 + r() * 0.12 },
      { lat: 24.75 + (r() - 0.5) * 0.4, lon: 54.4 + (r() - 0.5) * 0.6, amp: 6 + r() * 14, s: 0.25 + r() * 0.15 },
      { lat: 24.4 + (r() - 0.5) * 0.3, lon: 52.6 + (r() - 0.5) * 0.8, amp: 3 + r() * 8, s: 0.3 },
      { lat: 25.6 + (r() - 0.5) * 0.3, lon: 55.6 + (r() - 0.5) * 0.4, amp: 2 + r() * 10, s: 0.18 },
    ];
    cellLayer.clearLayers();
    for (const c of cells) {
      let v = 1.2 + r() * 1.6;
      for (const p of patches) v += p.amp * Math.exp(-(((c.lat - p.lat) ** 2 + (c.lon - p.lon) ** 2) / (2 * p.s ** 2)));
      c.v = v;
      L.rectangle([[c.lat - STEP / 2, c.lon - STEP / 2], [c.lat + STEP / 2, c.lon + STEP / 2]], { stroke: false, fillColor: color(v), fillOpacity: 0.72 })
        .bindTooltip(`chl-a ≈ ${v.toFixed(1)} mg/m³`)
        .addTo(cellLayer);
    }
    const rows = assets.map((a) => {
      const near = cells.filter((c) => haversineKm(a, c) <= 15);
      const peak = near.length ? Math.max(...near.map((c) => c.v)) : 0;
      const st = peak >= 20 ? ["WARNING", "status-warn"] : peak >= 10 ? ["WATCH", "status-watch"] : ["NORMAL", "status-ok"];
      return `<tr><td>${a.name}</td><td class="num">${peak.toFixed(1)}</td><td class="${st[1]}">${st[0]}</td></tr>`;
    });
    document.querySelector(`#${tableId} tbody`).innerHTML = rows.join("");
  }

  document.getElementById(buttonId).addEventListener("click", () => {
    day += 1;
    draw();
  });
  draw();
}
