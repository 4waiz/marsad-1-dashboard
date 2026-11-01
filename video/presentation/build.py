"""Assemble the MARSAD-1 recorded presentation.

Slides are rendered PNGs (slides.html) with transparent windows; footage goes underneath.
Segment boundaries come from the voiceover line timings in data/lines.json.

    python build.py            # writes out/picture.mp4, then mux with out/mix.wav
"""

import json
import subprocess
from pathlib import Path

HERE = Path(__file__).parent
FPS = 30
W, H = 1920, 1080
SEG = HERE / "seg"
SEG.mkdir(exist_ok=True)
(HERE / "out").mkdir(exist_ok=True)

DEMO = HERE / "../demo/clips"
WORK = HERE / "../work"
ASSETS = HERE / "../../assets"
FB = "C\\:/Windows/Fonts/segoeuib.ttf"
FM = "C\\:/Windows/Fonts/consolab.ttf"

lines = json.loads((HERE / "data/lines.json").read_text())["lines"]
L = lambda i: lines[i]["s"] - 0.2  # cut just before a line starts
END = lines[-1]["e"] + 5.2

ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS), "-an"]
NORM = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps={FPS}"


def ff(args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def frames(t):
    return round(t * FPS)


def kenburns(still, dur, out, zoom=0.05, overlay=None, fade_in=False):
    """Slow push-in on a still, optionally with a slide PNG on top."""
    n = frames(dur)
    z = f"scale=3840:-2,zoompan=z='1+{zoom}*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={n}:s={W}x{H}:fps={FPS}"
    if overlay:
        fc = f"[0:v]{z}[b];[b][1:v]overlay=0:0{',fade=t=in:st=0:d=0.5' if fade_in else ''}[v]"
        ff(["-loop", "1", "-i", str(still), "-loop", "1", "-i", str(overlay), "-filter_complex", fc, "-map", "[v]", "-frames:v", str(n), *ENC, str(out)])
    else:
        ff(["-loop", "1", "-i", str(still), "-vf", z, "-frames:v", str(n), *ENC, str(out)])


def states(pngs, dur, out, zoom=0.025):
    """Switch between slide states at given times, with one continuous gentle zoom over the whole slide.
    pngs: list of (png, seconds)."""
    lst = SEG / (out.stem + ".txt")
    lst.write_text("".join(f"file '{Path(p).resolve().as_posix()}'\nduration {d:.4f}\n" for p, d in pngs) + f"file '{Path(pngs[-1][0]).resolve().as_posix()}'\n")
    n = frames(dur)
    vf = f"fps={FPS},scale=w='{W}*(1+{zoom}*n/{n})':h='{H}*(1+{zoom}*n/{n})':eval=frame,crop={W}:{H}"
    ff(["-f", "concat", "-safe", "0", "-i", str(lst), "-vf", vf, "-frames:v", str(n), *ENC, str(out)])


def windowed(slide, rect, clips, dur, out):
    """Footage in a window under a slide PNG. clips: list of (src, start, seconds, speed) played in sequence;
    a src ending in .png is shown as a slow-zooming still."""
    x, y, w, h = rect
    parts = []
    for k, (src, ss, sec, speed) in enumerate(clips):
        p = SEG / f"{out.stem}_w{k}.mp4"
        if str(src).endswith(".png"):
            n = frames(sec)
            ff(["-loop", "1", "-i", str(src), "-vf", f"scale={w * 2}:-2,zoompan=z='1+0.06*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={n}:s={w}x{h}:fps={FPS}", "-frames:v", str(n), *ENC, str(p)])
        else:
            ff(["-ss", str(ss), "-t", str(sec * speed + 0.5), "-i", str(src), "-vf",
                f"setpts=(PTS-STARTPTS)/{speed},scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1,fps={FPS},tpad=stop_mode=clone:stop_duration=2",
                "-frames:v", str(frames(sec)), *ENC, str(p)])
        parts.append(p)
    lst = SEG / f"{out.stem}_w.txt"
    lst.write_text("".join(f"file '{p.resolve().as_posix()}'\n" for p in parts))
    win = SEG / f"{out.stem}_win.mp4"
    ff(["-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(win)])
    n = frames(dur)
    fc = f"color=c=0x0a0912:s={W}x{H}:r={FPS}[c];[0:v]tpad=stop_mode=clone:stop_duration=5[wv];[c][wv]overlay={x}:{y}:shortest=0[b];[b][1:v]overlay=0:0[v]"
    ff(["-i", str(win), "-loop", "1", "-i", str(slide), "-filter_complex", fc, "-map", "[v]", "-frames:v", str(n), *ENC, str(out)])


def footage(src, ss, sec, speed, caption, tag, out, fade_in=False):
    cap = f"drawtext=fontfile='{FB}':text='{caption}':fontsize=44:fontcolor=white:box=1:boxcolor=0x0a0912@0.9:boxborderw=22:x=48:y=h-th-60"
    tg = f"drawtext=fontfile='{FM}':text='{tag}':fontsize=22:fontcolor=0x0a0912:box=1:boxcolor=0x4fd1a5@0.95:boxborderw=12:x=w-tw-56:y=h-th-82"
    vf = f"setpts=(PTS-STARTPTS)/{speed},{NORM},tpad=stop_mode=clone:stop_duration=2,{cap},{tg}" + (",fade=t=in:st=0:d=0.3" if fade_in else "")
    ff(["-ss", str(ss), "-t", str(sec * speed + 0.5), "-i", str(src), "-vf", vf, "-frames:v", str(frames(sec)), *ENC, str(out)])


# ---------- timeline (seconds) ----------
b = [0, L(1), L(4), L(7), L(13), L(16), L(20), L(22), L(28), L(30), END]
print("slide starts:", [round(x, 2) for x in b])
P = HERE / "png"
segs = []


def seg(name):
    p = SEG / f"{name}.mp4"
    segs.append(p)
    return p


# 1 title over the opening orbit clip
n1 = b[1] - b[0]
ff(["-i", str(DEMO / "v5_orbit_open.mp4"), "-loop", "1", "-i", str(P / "s1.png"), "-filter_complex",
    f"[0:v]setpts=(PTS-STARTPTS)/{8.0 / n1:.4f},{NORM},tpad=stop_mode=clone:stop_duration=3[b];[b][1:v]overlay=0:0,fade=t=in:st=0:d=0.8[v]",
    "-map", "[v]", "-frames:v", str(frames(n1)), *ENC, str(seg("p01"))])

# 2 problem over the bloom still
kenburns(HERE / "stills/bloom_top.png", b[2] - b[1], seg("p02"), overlay=P / "s2.png")

# 3 mission, orbit clip in the window (forward, then backward, then forward)
win3 = (1010, 250, 820, 462)
d3 = b[3] - b[2]
rev = SEG / "v5_rev.mp4"
ff(["-i", str(DEMO / "v5_orbit_open.mp4"), "-vf", "reverse", *ENC, str(rev)])
windowed(P / "s3.png", win3, [(DEMO / "v5_orbit_open.mp4", 0, 8.0, 1), (rev, 0, 8.0, 1), (DEMO / "v5_orbit_open.mp4", 0, 8.0, 1), (rev, 0, d3 - 24 + 0.1, 1)], d3, seg("p03"))

# 4 architecture, highlight each subsystem as it is named
t4 = [b[3], L(8), L(9), L(10), L(11), L(12), b[4]]
states([(P / f"s4_{h}.png", t4[h + 1] - t4[h]) for h in range(6)], b[4] - b[3], seg("p04"))

# 5 CONOPS and budgets
t5 = [b[4], L(14), L(15), b[5]]
states([(P / f"s5_{h + 1}.png", t5[h + 1] - t5[h]) for h in range(3)], b[5] - b[4], seg("p05"))

# 6 implementation: circuit still, then the real Tinkercad run from boot as "Here it runs" starts
win6 = (880, 230, 960, 540)
d6 = b[6] - b[5]
boot = L(19) - 1.8 - b[5]
windowed(P / "s6.png", win6, [(ASSETS / "tinkercad_circuit.png", 0, boot, 1), (WORK / "sim.mp4", 4.5, d6 - boot + 0.1, 1)], d6, seg("p06"))

# 7 bench build visualisation
d7 = b[7] - b[6]
windowed(P / "s7.png", win6, [(DEMO / "v1_bench.mp4", 0, 5.0, 1), (DEMO / "v2_macro.mp4", 0, 4.3, 1), (DEMO / "v3_antenna.mp4", 0.3, 3.6, 1), (DEMO / "v4_beakers.mp4", 0, d7 - 12.9 + 0.1, 1)], d7, seg("p07"))

# 8 live dashboard recording with fault injection, cut to the narration
R = WORK / "dash_rec.mp4"
TAG = "REAL RECORDING - LIVE DASHBOARD"
t8 = [b[7], L(24), L(25), L(26), L(27), b[8]]
footage(R, 0.0, t8[1] - t8[0], 1.0, "Mission control dashboard - built to the SpacePoint design manual", TAG, seg("p08a"), fade_in=True)
footage(R, 14.5, t8[2] - t8[1], 7.0 / (t8[2] - t8[1]), "Fault injected - low battery", TAG + " - SPED UP", seg("p08b"))
footage(R, 22.0, t8[3] - t8[2], 5.5 / (t8[3] - t8[2]), "Fault injected - cold battery", TAG + " - SPED UP", seg("p08c"))
footage(R, 32.5, t8[4] - t8[3], 12.0 / (t8[4] - t8[3]), "Fault injected - link loss - STALE, then LINK LOST", TAG + " - SPED UP", seg("p08d"))
footage(R, 45.8, t8[5] - t8[4], 1.0, "Faults cleared - back to nominal", TAG, seg("p08e"))

# 9 results
t9 = [b[8], L(29), b[9]]
states([(P / "s9_1.png", t9[1] - t9[0]), (P / "s9_2.png", t9[2] - t9[1])], b[9] - b[8], seg("p09"))

# 10 next steps and thanks, over the satellite still, fading out
d10 = b[10] - b[9]
tmp = SEG / "p10_raw.mp4"
kenburns(HERE / "stills/sat.png", d10, tmp, overlay=P / "s10.png")
ff(["-i", str(tmp), "-vf", f"fade=t=out:st={d10 - 1.0:.2f}:d=1.0", *ENC, str(seg("p10"))])

(SEG / "list.txt").write_text("".join(f"file '{p.name}'\n" for p in segs))
ff(["-f", "concat", "-safe", "0", "-i", str(SEG / "list.txt"), "-c", "copy", str(HERE / "out/picture.mp4")])
print("total", END)
