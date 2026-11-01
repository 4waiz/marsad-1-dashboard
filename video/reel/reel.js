// MARSAD-1 · flight-logic simulation explainer (SatForge step 45).
// 0-24 s motion graphics, 24.1-47.5 s real Tinkercad footage is laid over this reel by ffmpeg, then the outro.
import { run, E } from './engine.js';
import paper from './plates/paper.js';
import photo from './plates/photo.js';
import typewrite from './plates/typewrite.js';
import screen from './plates/screen.js';
import steps from './plates/steps.js';
import outro from './plates/outro.js';

const CIRCUIT_AT = 4.2;
const at = (t) => t - CIRCUIT_AT; // absolute voice time -> screen-plate time

run({
  width: 1920,
  height: 1080,
  fps: 30,
  background: 'var(--ink)',
  audio: 'audio/voiceover.wav',
  words: 'data/words.json',
  env: 'data/audio.json',
  timeline: () => [
    E(paper(), 0, 52.5),
    E(photo({ src: 'assets/hero_chatgpt.png', from: { x: 0.5, y: 0.25, zoom: 1 }, to: { x: 0.55, y: 0.32, zoom: 1.15 }, dim: 0.55, label: 'SATFORGE UAE 2026 · TEAM KANBAN' }), 0, CIRCUIT_AT, { tail: 0.4 }),
    E(typewrite({ eyebrow: 'MARSAD-1 · FLIGHT LOGIC', lines: ['Running in', 'simulation.'], accent: [1], size: 132, times: [0.6, 2.5] }), 0, CIRCUIT_AT),
    E(screen({
      src: 'assets/tinkercad_circuit.png', frame: 'window', url: 'tinkercad.com/things/cY2kWDnTdZB',
      keys: [
        { t: 0, x: 0.5, y: 0.5, zoom: 1 },
        { t: at(9.3), x: 0.6, y: 0.86, zoom: 1.9 },
        { t: at(13.8), x: 0.86, y: 0.75, zoom: 1.7 },
        { t: at(16.0), x: 0.47, y: 0.14, zoom: 1.7 },
        { t: at(17.6), x: 0.8, y: 0.45, zoom: 1.6 },
        { t: at(18.9), x: 0.5, y: 0.5, zoom: 1, move: 0.7 },
      ],
      callouts: [
        { t: at(4.4), until: at(9.0), x: 0.29, y: 0.28, w: 0.32, h: 0.42, label: 'Flight computer' },
        { t: at(9.4), until: at(11.5), x: 0.54, y: 0.9, w: 0.05, h: 0.1, label: 'Battery temp' },
        { t: at(11.7), until: at(13.6), x: 0.655, y: 0.91, w: 0.05, h: 0.08, label: 'Sun / eclipse' },
        { t: at(13.9), until: at(15.8), x: 0.92, y: 0.72, w: 0.075, h: 0.12, label: 'Battery voltage' },
        { t: at(16.1), until: at(17.4), x: 0.32, y: 0.0, w: 0.28, h: 0.14, label: 'Heater · Imaging · Downlink' },
        { t: at(17.6), until: at(18.8), x: 0.795, y: 0.29, w: 0.08, h: 0.36, label: 'Antenna servo' },
      ],
    }), CIRCUIT_AT, 19.2, { tail: 0.3 }),
    E(steps({
      items: [
        { label: 'SAFE', sub: 'eclipse or low battery' },
        { label: 'CHARGING', sub: 'sun-pointing' },
        { label: 'IMAGING', sub: 'battery > 60 %' },
        { label: 'GROUND PASS', sub: 'downlink window' },
      ],
      times: [21.3, 22.0, 22.8, 23.4],
    }), 19.2, 24.1),
    E(outro({ title: 'MARSAD-1', tagline: 'Team Kanban · SatForge UAE 2026', url: '4waiz.github.io/marsad-1-dashboard', at: 0.6 }), 47.5, 52.5),
  ],
});
