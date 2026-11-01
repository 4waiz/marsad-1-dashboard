# MARSAD-1 · Mission Dashboard

**Team Kanban (BSSDT4) — SatForge UAE 2026 National University Satellite Engineering Challenge**

MARSAD-1 (مرصد, "observatory") is a 3U CubeSat in a 550 km sun-synchronous orbit that maps
harmful algal blooms (red tides) and chlorophyll-a along the UAE coast of the Arabian Gulf and
Gulf of Oman, giving desalination plants, fisheries and coastal authorities early warning.

**Live dashboard:** https://4waiz.github.io/marsad-1-dashboard/


## Deliverables

| Item | Link |
|---|---|
| Live dashboard | https://4waiz.github.io/marsad-1-dashboard/ |
| Tinkercad circuit | https://www.tinkercad.com/things/cY2kWDnTdZB |
| Tinkercad 3D design | https://www.tinkercad.com/things/4Qi0WBiqTus |
| Simulation video | https://4waiz.github.io/marsad-1-dashboard/video/MARSAD-1_simulation.mp4 |
| Prototype demo video | https://4waiz.github.io/marsad-1-dashboard/video/MARSAD-1_prototype_demo.mp4 |
| Recorded presentation (3:57) | https://4waiz.github.io/marsad-1-dashboard/video/MARSAD-1_presentation.mp4 |
| Phase 1 report (PDF) | https://4waiz.github.io/marsad-1-dashboard/report/MARSAD-1_Phase1_Report.pdf |
| Phase 1 report (web) | https://4waiz.github.io/marsad-1-dashboard/report/ |
| A2 poster (PNG) | https://4waiz.github.io/marsad-1-dashboard/poster/MARSAD-1_poster_A2.png |
| Final technical report (PDF) | https://4waiz.github.io/marsad-1-dashboard/report/final/MARSAD-1_Final_Technical_Report.pdf |
| Final technical report (web) | https://4waiz.github.io/marsad-1-dashboard/report/final/ |
| Final poster (Canva) | https://canva.link/66027wdcw95hqls |

Sources: `cad/` (STL generator + Blender render script), `poster/` (HTML poster + charts), `report/`, `video/` (kanban-motion reel, voiceover script, cue sheet).
The poster hero image was generated with ChatGPT image generation; the simulation video narration is synthetic (Kokoro).
In the prototype demo video, the lab and orbit shots are AI-generated visualisations of the planned hardware build (ChatGPT images animated with Vidu) and are labelled as such on screen. The Tinkercad simulation and the dashboard fault-injection tests are real screen recordings. Edit sources are in `video/demo/` (`build.sh`, `script.txt`, `cues.json`).
The recorded presentation uses a synthetic narrator (Kokoro); its slides, script and build script are in `video/presentation/`.

## What the dashboard shows

| Section | Contents |
|---|---|
| Header | Mission name, link state (SIM / LIVE · USB / STALE / LINK LOST), last-packet age, active-alarm badge, mission UTC |
| Status | Eight status tiles (mode, SoC, bus voltage, battery/internal/panel temperature, load, storage) with units, limits, a gauge with nominal/warning/critical zones and a text status word |
| Alarms & readings | Latched alarms with UTC timestamps and acknowledge, alarm history, fault injection (low battery, cold battery, link loss, sensor glitch), and a latest-readings table with limits, status and per-field age |
| Data contract | The JSON-lines packet format (fields, types, units, limits, required) shared by the simulator, the Tinkercad sketch and the ESP32-S3 firmware |
| Operations | Live ground track (SSO propagator), spacecraft state, eclipse, Abu Dhabi ground-station passes, current CONOPS mode, subsystem status, event log |
| Telemetry | Battery state of charge, generated vs consumed power, internal/battery/panel temperatures, onboard storage — simulated from the design budgets, or live from the prototype over USB |
| Bloom watch | Chlorophyll-a (NDCI) map over UAE waters and alert status for desalination plants and fisheries (demo field until prototype imagery is processed) |
| CONOPS | 95-min orbit timeline (40 min sun-pointing, 10 min imaging, 10 min ground pass, 35 min eclipse) and the component × mode matrix |
| Budgets | Power, energy per mode, mass, cost by subsystem, and margins |
| Components | Full bill of materials (17 line items) |
| Mission & team | Mission statement, success criteria, orbit, team roles |

Time warp (1×–300×) speeds the simulation up so a full orbit can be watched in a few minutes.

**Status colours:** green = nominal, amber = warning, red = critical, grey = stale or no data, violet = invalid value. The status is always written out as well, so colour is never the only cue.
A field goes stale 3 s after its last update; no packets for 3 s marks the link STALE and for 10 s LINK LOST.
Values outside the sensor's physical range or of the wrong type are flagged INVALID and never plotted. Chart lines break where data is missing.

**Testing:** use the fault-injection buttons. They act on the simulated spacecraft, so the dashboard only sees the resulting packets.

## Design summary

| Budget | Value | Limit / margin |
|---|---|---|
| Power | 3.92 W load (all-on), 3.02 Wh per orbit | 6 × 1.1 W cells = 6.6 W → +2.68 W |
| Mass | 0.845 kg | 4.0 kg (3U) → 3.16 kg margin |
| Volume | 500.6 cm³ | 3000 cm³ |
| Cost | 1,420 AED | 3,000 AED → 1,580 AED margin |
| Data | 75 MB/day generated, 1.42 MB/day downlinked | 2 GB onboard |

## Tinkercad circuit

**Circuit:** https://www.tinkercad.com/things/cY2kWDnTdZB — *Team Kanban – Circuit Design - Awaiz Ahmed*

Arduino Uno stand-in for the flight computer (`firmware/tinkercad_prototype/tinkercad_prototype.ino`):

| Pin | Part | Role |
|---|---|---|
| A0 | TMP36 | Battery temperature |
| A1 | Photoresistor + 10 kΩ pull-down | Sun sensor (sunlit / eclipse) |
| A3 | Potentiometer (3.3 V) | Battery-voltage stand-in → state of charge |
| D13 | Red LED + 220 Ω | Battery heater |
| D7 | Green LED + 220 Ω | Payload imaging (nadir mode) |
| D4 | Blue LED + 220 Ω | UHF downlink / ground pass |
| D9 | Micro servo | Antenna deployment (5 s after boot) |

The sketch runs the CONOPS mode logic (safe / sun-pointing / nadir imaging / ground pass) and prints the same
JSON telemetry the dashboard reads.

## Prototype link

`firmware/marsad_telemetry/marsad_telemetry.ino` runs on the ESP32-S3 and prints one JSON line per
second following the data contract (`soc`, `v`, `load`, `tint`, `tbat`, `ndci`, `heater`, …). Open the dashboard in Chrome or Edge,
plug the board in, and press **Connect prototype (USB)** — the telemetry panels switch to live data.

## Team

- **Awaiz Ahmed** — Mission lead, CDHS & flight software, dashboard
- **Mohammad Umar** — EPS lead, power budget & solar array
- **Bilal Feroz** — ADCS & structure, 3D design
- **Maryam Alnaqbi** — Payload & comms, bloom science

## Run locally

Any static server works, e.g. `python -m http.server` in this folder, then open http://localhost:8000.
