// MARSAD-1 mission design data — mirrors the Team Kanban design locked in on the
// SpacePoint Madar mission designer (Setup, Components, CONOPS, Data, Power, Mass, Cost).

export const MISSION = {
  name: "MARSAD-1",
  meaning: "مرصد — \"observatory\" in Arabic",
  team: "Team Kanban",
  teamCode: "BSSDT4",
  competition: "SatForge UAE 2026 — Qualifiers Stage",
  objective:
    "Detect and map harmful algal blooms (red tides) and chlorophyll-a concentration along the UAE coastline of the Arabian Gulf and Gulf of Oman using multispectral imaging, giving early warning to desalination plants, fisheries and coastal authorities.",
  success:
    "Downlink at least one usable, cloud-free multispectral image of UAE coastal waters per day and deliver a chlorophyll-a bloom map to the ground team within 24 hours, for 6 consecutive months.",
  duration: "12 months",
  tasks:
    "Nadir-pointed multispectral imaging during sunlit passes over the Gulf, onboard compression and bloom detection (NDCI), and downlink of alerts and data over UAE ground-station passes, with UHF telemetry and commanding.",
  orbit: { type: "SSO", altitudeKm: 550, inclinationDeg: 97.6, periodMin: 95, orbitsPerDay: 15, ltdn: "10:30" },
  size: "3U CubeSat (4 kg / 3000 cm³ limit)",
};

export const TEAM = [
  { name: "Awaiz Ahmed", role: "Mission lead · CDHS & flight software · Dashboard" },
  { name: "Mohammad Umar", role: "EPS lead · Power budget & solar array" },
  { name: "Bilal Feroz", role: "ADCS & Structure · 3D design" },
  { name: "Maryam Alnaqbi", role: "Payload & Comms · Bloom science" },
];

// CONOPS modes in minutes per 95-min orbit
export const MODES = [
  { key: "sun", name: "Sun pointing (charging)", min: 40, color: "#f5b941" },
  { key: "nadir", name: "Nadir / payload imaging", min: 10, color: "#4fd1a5" },
  { key: "gs", name: "Ground-station pass", min: 10, color: "#7c9cff" },
  { key: "safe", name: "Safe / eclipse", min: 35, color: "#a07cff" },
];

// v (V), ma (mA), g (mass per unit), aed (cost per unit), on: [sun, nadir, gs, safe]
export const COMPONENTS = [
  { name: "ESP32-S3 On-Board Computer", sub: "CDHS", v: 3.3, ma: 240, qty: 1, g: 10, aed: 60, dims: [69, 26, 10], on: [1, 1, 1, 1], data: "Telemetry", vendor: "DigiKey" },
  { name: "OV5640 5MP Imaging Camera", sub: "Payload", v: 3.3, ma: 140, qty: 1, g: 8, aed: 45, dims: [32, 32, 20], on: [0, 1, 0, 0], data: "Image", vendor: "Arducam" },
  { name: "AS7341 11-Channel Spectral Sensor", sub: "Payload", v: 3.3, ma: 1, qty: 1, g: 3, aed: 65, dims: [25, 18, 3], on: [0, 1, 0, 0], data: "Science Data", vendor: "Adafruit" },
  { name: "ICM-20948 9-DoF IMU", sub: "ADCS", v: 3.3, ma: 4, qty: 1, g: 3, aed: 55, dims: [25, 18, 3], on: [1, 1, 1, 1], data: "Telemetry", vendor: "SparkFun" },
  { name: "Magnetorquer Set (3-axis) + DRV8833", sub: "ADCS", v: 5, ma: 150, qty: 1, g: 45, aed: 120, dims: [90, 90, 10], on: [1, 1, 1, 0], data: "Housekeeping", vendor: "DigiKey" },
  { name: "u-blox NEO-M8N GPS Receiver", sub: "ADCS", v: 3.3, ma: 45, qty: 1, g: 12, aed: 75, dims: [36, 26, 8], on: [0, 1, 1, 0], data: "GPS/Nav", vendor: "u-blox" },
  { name: "SX1278 LoRa 433 MHz Transceiver", sub: "COMMS", v: 3.3, ma: 120, qty: 1, g: 5, aed: 35, dims: [17, 16, 3], on: [0, 0, 1, 0], data: "TT&C", vendor: "DigiKey" },
  { name: "Deployable 433 MHz Tape Antenna", sub: "COMMS", v: 5, ma: 1, qty: 1, g: 20, aed: 40, dims: [170, 10, 2], on: [0, 0, 1, 0], data: "Housekeeping", vendor: "Amazon.ae" },
  { name: "6V 1W Solar Panel", sub: "EPS", v: 6, ma: 1, qty: 6, g: 25, aed: 25, dims: [110, 60, 3], on: [1, 1, 1, 0], data: "Housekeeping", vendor: "Amazon.ae" },
  { name: "2S Li-ion 18650 Pack (7.4V 3400mAh)", sub: "EPS", v: 7.4, ma: 1, qty: 1, g: 95, aed: 90, dims: [70, 37, 19], on: [1, 1, 1, 1], data: "Housekeeping", vendor: "DigiKey" },
  { name: "CN3791 MPPT Charger + 2S BMS", sub: "EPS", v: 7.4, ma: 5, qty: 1, g: 10, aed: 40, dims: [40, 25, 8], on: [1, 1, 1, 1], data: "Housekeeping", vendor: "AliExpress" },
  { name: "MP1584 Buck Converters (5V/3.3V)", sub: "EPS", v: 7.4, ma: 3, qty: 2, g: 8, aed: 20, dims: [22, 17, 4], on: [1, 1, 1, 1], data: "Housekeeping", vendor: "DigiKey" },
  { name: "INA219 Current/Voltage Monitor", sub: "EPS", v: 3.3, ma: 1, qty: 1, g: 2, aed: 25, dims: [25, 22, 3], on: [1, 1, 1, 1], data: "Housekeeping", vendor: "Adafruit" },
  { name: "MicroSD Storage Module (32 GB)", sub: "CDHS", v: 3.3, ma: 80, qty: 1, g: 5, aed: 35, dims: [42, 24, 12], on: [0, 1, 1, 0], data: "Housekeeping", vendor: "Amazon.ae" },
  { name: "BME280 + DS18B20 Temp Sensors", sub: "Thermal", v: 3.3, ma: 1, qty: 1, g: 6, aed: 30, dims: [20, 15, 5], on: [1, 1, 1, 1], data: "Housekeeping", vendor: "SparkFun" },
  { name: "Kapton Battery Heater Pad", sub: "Thermal", v: 5, ma: 200, qty: 1, g: 5, aed: 35, dims: [50, 50, 1], on: [0, 0, 0, 1], data: "Housekeeping", vendor: "Amazon.ae" },
  { name: "3U Al-6061 Frame + PC/104 Stack", sub: "Structure", v: 3.3, ma: 1, qty: 1, g: 450, aed: 480, dims: [340, 100, 5], on: [1, 1, 1, 1], data: "Housekeeping", vendor: "CubeSatShop" },
];

// Data budget per day (KB) as locked in on the portal
export const DATA_BUDGET = {
  perOrbitMB: 5.0,
  perDayMB: 75.0,
  storedPerDayMB: 74.78,
  sentPerDayMB: 1.42,
  storageGB: 2.0,
};

export const BUDGET = {
  solarCells: 6,
  wattsPerCell: 1.1,
  totalLoadW: 3.917,
  energyPerOrbitWh: 3.017,
  massKg: 0.845,
  massLimitKg: 4.0,
  volumeCm3: 500.6,
  volumeLimitCm3: 3000,
  costAED: 1420,
  costLimitAED: 3000,
  batteryWh: 25.16,
};

// UAE ground station (Abu Dhabi) and monitored coastal assets (approximate locations)
export const GROUND_STATION = { name: "Abu Dhabi GS", lat: 24.45, lon: 54.38, minElevDeg: 10 };

export const ASSETS = [
  { name: "Taweelah desalination", lat: 24.77, lon: 54.69 },
  { name: "Jebel Ali desalination", lat: 25.06, lon: 55.11 },
  { name: "Fujairah desalination", lat: 25.12, lon: 56.35 },
  { name: "Mirfa desalination", lat: 24.13, lon: 53.44 },
  { name: "Khor Fakkan fisheries", lat: 25.34, lon: 56.36 },
  { name: "Umm Al Quwain lagoon", lat: 25.57, lon: 55.6 },
];

export const TARGET_BOX = { latMin: 22.5, latMax: 27.5, lonMin: 51.0, lonMax: 57.5 };
