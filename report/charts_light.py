"""Light-background budget charts for the MARSAD-1 Phase 1 report."""

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT = Path(__file__).parent
TEXT = "#14212b"
MUTED = "#5b6b76"
COLORS = ["#3b6fd8", "#1f9e7a", "#e0a020", "#e0567a", "#7b55d6", "#d94848", "#3fa7d6"]
plt.rcParams.update({"font.family": "DejaVu Sans", "text.color": TEXT, "axes.labelcolor": MUTED,
                     "xtick.color": MUTED, "ytick.color": MUTED, "axes.edgecolor": "#c9d3d8"})

subs = ["CDHS", "Payload", "ADCS", "COMMS", "EPS", "Thermal", "Structure"]
mass_g = [15, 11, 60, 25, 273, 11, 450]
power_mw = [1056, 465.3, 911.7, 401, 75.9, 1003.3, 3.3]
modes = ["Sun-pointing\n40 min", "Nadir imaging\n10 min", "Ground pass\n10 min", "Safe / eclipse\n35 min"]
mode_mwh = [1093.8, 419.8, 409.0, 1097.6]
mode_colors = ["#e0a020", "#1f9e7a", "#3b6fd8", "#7b55d6"]

# mass donut
fig, ax = plt.subplots(figsize=(6.2, 3.6), dpi=200)
wedges, _ = ax.pie(mass_g, colors=COLORS, startangle=90, counterclock=False,
                   wedgeprops=dict(width=0.34, edgecolor="white", linewidth=2))
ax.text(0, 0.08, "0.845 kg", ha="center", va="center", fontsize=17, fontweight="bold")
ax.text(0, -0.17, "of 4.0 kg (3U)", ha="center", va="center", fontsize=9, color=MUTED)
total = sum(mass_g)
ax.legend(wedges, [f"{l}  {v} g ({v / total * 100:.0f}%)" for l, v in zip(subs, mass_g)],
          loc="center left", bbox_to_anchor=(1.0, 0.5), frameon=False, fontsize=9)
fig.savefig(OUT / "chart_mass_light.png", bbox_inches="tight", facecolor="white")
plt.close(fig)

# power per subsystem + gen vs load
fig, (a1, a2) = plt.subplots(1, 2, figsize=(7.4, 3.3), dpi=200, gridspec_kw=dict(width_ratios=[1.6, 1]))
order = sorted(range(len(subs)), key=lambda i: power_mw[i])
a1.barh([subs[i] for i in order], [power_mw[i] for i in order], color=[COLORS[i] for i in order], height=0.62)
a1.set_xlabel("Power when ON (mW)")
a1.set_xlim(0, 1300)
for y, i in enumerate(order):
    a1.text(power_mw[i] + 20, y, f"{power_mw[i]:.0f}", va="center", fontsize=8)
a2.bar(["Generated", "Peak load"], [6.6, 3.917], color=["#e0a020", "#e0567a"], width=0.55)
a2.set_ylabel("W")
a2.set_ylim(0, 7.6)
for x, v in enumerate([6.6, 3.917]):
    a2.text(x, v + 0.15, f"{v:.2f} W", ha="center", fontsize=9, fontweight="bold")
a2.text(0.5, 7.1, "+2.68 W margin", ha="center", fontsize=10, color="#1f9e7a", fontweight="bold")
for a in (a1, a2):
    for s in ("top", "right"):
        a.spines[s].set_visible(False)
fig.tight_layout()
fig.savefig(OUT / "chart_power_light.png", bbox_inches="tight", facecolor="white")
plt.close(fig)

print("light charts written")
