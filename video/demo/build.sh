#!/usr/bin/env bash
# Assemble the MARSAD-1 prototype demo video from the Vidu clips, the real Tinkercad
# footage and the real dashboard recording, locked to the Kokoro voiceover timings.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p seg out
F_B="C\:/Windows/Fonts/segoeuib.ttf"
F_R="C\:/Windows/Fonts/segoeui.ttf"
F_M="C\:/Windows/Fonts/consolab.ttf"
ENC="-c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 -an"
NORM="scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,fps=30"

# small pill in the top-left corner saying what kind of footage this is
tag() { # $1 text, $2 colour
  echo "drawtext=fontfile='$F_M':text='$1':fontsize=22:fontcolor=0x0a0912:box=1:boxcolor=$2@0.95:boxborderw=12:x=w-tw-56:y=h-th-82"
}
AI=$(tag "AI VISUALISATION - PLANNED BENCH BUILD" 0xf5b941)
REAL_SIM=$(tag "REAL RECORDING - TINKERCAD SIMULATION" 0x4fd1a5)
REAL_DASH=$(tag "REAL RECORDING - LIVE DASHBOARD - 2X SPEED" 0x4fd1a5)
AI_ORBIT=$(tag "AI VISUALISATION - MISSION CONCEPT" 0xf5b941)

# clip: in out duration speed extra-filters
clip() { # $1 src $2 start $3 dur(out) $4 speed $5 filters $6 out
  local pts="setpts=(PTS-STARTPTS)/$4"
  ffmpeg -v error -y -ss "$2" -t "$(python -c "print($3*$4)")" -i "$1" -vf "$pts,$NORM,tpad=stop_mode=clone:stop_duration=2,trim=duration=$3,$5" $ENC "$6"
}

# 0.0-7.4 opening: orbit + title
clip clips/v5_orbit_open.mp4 0 7.4 1 "$AI_ORBIT,drawtext=fontfile='$F_B':text='MARSAD-1':fontsize=150:fontcolor=white:shadowcolor=black@0.6:shadowx=3:shadowy=3:x=(w-tw)/2:y=h*0.62:alpha='min(1,max(0,(t-0.5)/0.6))',drawtext=fontfile='$F_R':text='Prototype demonstration  ·  Team Kanban  ·  SatForge UAE 2026':fontsize=40:fontcolor=white:shadowcolor=black@0.7:shadowx=2:shadowy=2:x=(w-tw)/2:y=h*0.62+170:alpha='min(1,max(0,(t-1.1)/0.6))',fade=t=in:st=0:d=0.6" seg/s0.mp4
# 7.4-14.5 bench
clip clips/v1_bench.mp4 0 7.1 0.705 "$AI" seg/s1.mp4  # 5.04 s clip slowed to fill the line
# 14.5-19.6 macro
clip clips/v2_macro.mp4 0 5.1 1 "$AI" seg/s2.mp4
# 19.6-22.9 antenna
clip clips/v3_antenna.mp4 0.3 3.3 1 "$AI" seg/s3.mp4
# 22.9-27.5 water samples
clip clips/v4_beakers.mp4 0 4.6 1 "$AI" seg/s4.mp4
# 27.5-45.4 real Tinkercad simulation (already captioned)
clip ../work/footage_seg.mp4 0 17.9 1 "$REAL_SIM,fade=t=out:st=17.5:d=0.4" seg/s5.mp4

# 45.4-69.4 real dashboard recording with fault injection
cap() { echo "drawtext=fontfile='$F_B':text='$1':fontsize=44:fontcolor=white:box=1:boxcolor=0x0a0912@0.9:boxborderw=22:x=48:y=h-th-60"; }
D=../work/dash_rec.mp4
clip $D 2.5 5.6 1 "$REAL_DASH,$(cap 'Mission control - live status, alarms, data contract'),fade=t=in:st=0:d=0.4" seg/d1.mp4
clip $D 14.0 7.4 1.89 "$REAL_DASH,$(cap 'Fault injected - low battery, then cold battery')" seg/d2.mp4
clip $D 32.0 6.2 2.0 "$REAL_DASH,$(cap 'Fault injected - link loss - STALE, then LINK LOST')" seg/d3.mp4
clip $D 45.5 4.8 1 "$REAL_DASH,$(cap 'Faults cleared - back to nominal'),fade=t=out:st=4.4:d=0.4" seg/d4.mp4

# 69.4-74.6 closing orbit
clip clips/v6_orbit_close.mp4 0 5.2 1 "$AI_ORBIT,fade=t=in:st=0:d=0.4,fade=t=out:st=4.8:d=0.4" seg/s6.mp4

# 74.6-80.0 outro card
ffmpeg -v error -y -f lavfi -i "color=c=0x0a0912:s=1920x1080:r=30:d=5.4" -vf "\
drawtext=fontfile='$F_B':text='MARSAD-1':fontsize=120:fontcolor=0x4fd1a5:x=(w-tw)/2:y=250,\
drawtext=fontfile='$F_R':text='Team Kanban  ·  Awaiz Ahmed  ·  Mohammad Umar  ·  Bilal Feroz  ·  Maryam Alnaqbi':fontsize=36:fontcolor=white:x=(w-tw)/2:y=420,\
drawtext=fontfile='$F_M':text='4waiz.github.io/marsad-1-dashboard':fontsize=38:fontcolor=0x4fd1a5:x=(w-tw)/2:y=500,\
drawtext=fontfile='$F_R':text='Lab and orbit shots are AI-generated visualisations (ChatGPT images, Vidu video) of the planned hardware build.':fontsize=28:fontcolor=0x9b94b8:x=(w-tw)/2:y=720,\
drawtext=fontfile='$F_R':text='The Tinkercad simulation and the dashboard fault tests are real, unedited screen recordings. Narration is synthetic (Kokoro).':fontsize=28:fontcolor=0x9b94b8:x=(w-tw)/2:y=764,\
fade=t=in:st=0:d=0.5" $ENC seg/s7.mp4

printf "file '%s.mp4'\n" s0 s1 s2 s3 s4 s5 d1 d2 d3 d4 s6 s7 > seg/list.txt
ffmpeg -v error -y -f concat -safe 0 -i seg/list.txt -c copy out/picture.mp4
ffprobe -v error -show_entries format=duration -of csv=p=0 out/picture.mp4
