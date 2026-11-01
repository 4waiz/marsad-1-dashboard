// Ground-segment health checks: validate each telemetry field against the data contract and its limits.
import { CONTRACT, STALE_SEC } from "./data.js";

export const FIELD = Object.fromEntries(CONTRACT.map((c) => [c.key, c]));
export const STATUS_TEXT = { ok: "Nominal", warn: "Warning", crit: "Critical", stale: "Stale", missing: "No data", invalid: "Invalid" };

const num = (c, v) => Number(v).toLocaleString("en-US", { minimumFractionDigits: c.dp ?? 1, maximumFractionDigits: c.dp ?? 1 });

export function formatValue(c, v) {
  if (v === undefined || v === null) return "—";
  if (c.type === "boolean") return v === true ? "ON" : v === false ? "OFF" : String(v);
  if (c.type === "number") return typeof v === "number" && Number.isFinite(v) ? num(c, v) : String(v);
  return String(v);
}

// Returns { status, reason } for one value; status is ok | warn | crit | invalid.
export function evaluate(c, v) {
  if (c.type === "number") {
    if (typeof v !== "number" || !Number.isFinite(v)) return { status: "invalid", reason: `not a number (${JSON.stringify(v)})` };
    if (c.range && (v < c.range[0] || v > c.range[1])) return { status: "invalid", reason: `outside sensor range ${c.range[0]}–${c.range[1]} ${c.unit}` };
    const u = c.unit ? ` ${c.unit}` : "";
    if (c.critLow != null && v < c.critLow) return { status: "crit", reason: `below critical limit ${c.critLow}${u}` };
    if (c.critHigh != null && v > c.critHigh) return { status: "crit", reason: `above critical limit ${c.critHigh}${u}` };
    if (c.warnLow != null && v < c.warnLow) return { status: "warn", reason: `below warning limit ${c.warnLow}${u}` };
    if (c.warnHigh != null && v > c.warnHigh) return { status: "warn", reason: `above warning limit ${c.warnHigh}${u}` };
    return { status: "ok", reason: "" };
  }
  if (c.type === "boolean" && typeof v !== "boolean") return { status: "invalid", reason: "expected true/false" };
  if (c.type === "enum" && !c.values.includes(v)) return { status: "invalid", reason: `expected one of ${c.values.join(", ")}` };
  return { status: "ok", reason: "" };
}

// Status of a field given the latest store { key: { v, at } } and the current time (ms).
export function fieldStatus(latest, key, nowMs) {
  const c = FIELD[key];
  const e = latest[key];
  if (!e) return { status: "missing", reason: "never received", age: null };
  const age = (nowMs - e.at) / 1000;
  if (age > STALE_SEC) return { status: "stale", reason: `no update for ${age.toFixed(0)} s`, age };
  return { ...evaluate(c, e.v), age };
}

export function limitText(c) {
  const u = c.unit ? ` ${c.unit}` : "";
  const pair = (lo, hi) => [lo != null ? `<${lo}` : null, hi != null ? `>${hi}` : null].filter(Boolean).join(" / ");
  const parts = [];
  if (c.nominal) parts.push(`nom ${c.nominal[0]}–${c.nominal[1]}${u}`);
  const w = pair(c.warnLow, c.warnHigh);
  const k = pair(c.critLow, c.critHigh);
  if (w) parts.push(`warn ${w}`);
  if (k) parts.push(`crit ${k}`);
  if (!parts.length && c.range) parts.push(`range ${c.range[0]}–${c.range[1]}${u}`);
  if (c.type === "enum") parts.push(c.values.join(" | "));
  return parts.join(" · ") || "—";
}
