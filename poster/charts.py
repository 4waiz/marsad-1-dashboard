"""Budget charts for the MARSAD-1 poster (transparent PNGs, dark theme)."""

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT = Path(__file__).parent
TEXT = "#ece9f7"
MUTED = "#9b94b8"
COLORS = ["#7c9cff", "#4fd1a5", "#f5b941", "#ff8fb1", "#a07cff", "#ff6b7a", "#8ad8ff"]
plt.rcParams.update({"font.family": "DejaVu Sans", "text.color": TEXT, "axes.labelcolor": MUTED,
                     "xtick.color": MUTED, "ytick.color": MUTED, "axes.edgecolor": "#2a2440"})

subs = ["CDHS", "Payload", "ADCS", "COMMS", "EPS", "Thermal", "Structure"]
mass_g = [15, 11, 60, 25, 273, 11, 450]
power_mw = [1056, 465.3, 911.7, 401, 75.9, 1003.3, 3.3]


def donut(values, labels, center, unit, path):
    fig, ax = plt.subplots(figsize=(6, 4.2), dpi=220)
    wedges, _ = ax.pie(values, colors=COLORS, startangle=90, counterclock=False,
                       wedgeprops=dict(width=0.34, edgecolor="#14111f", linewidth=2))
    ax.text(0, 0.08, center, ha="center", va="center", fontsize=20, fontweight="bold", color=TEXT)
    ax.text(0, -0.17, unit, ha="center", va="center", fontsize=9, color=MUTED)
    total = sum(values)
    ax.legend(wedges, [f"{l}  {v:g} ({v / total * 100:.0f}%)" for l, v in zip(labels, values)],
              loc="center left", bbox_to_anchor=(1.0, 0.5), frameon=False, fontsize=9, labelcolor=TEXT)
    fig.savefig(path, transparent=True, bbox_inches="tight")
    plt.close(fig)


donut(mass_g, subs, "0.845 kg", "of 4.0 kg - 79% margin", OUT / "chart_mass.png")

# power: per-subsystem load + generation vs consumption
fig, (a1, a2) = plt.subplots(1, 2, figsize=(7.2, 3.6), dpi=220, gridspec_kw=dict(width_ratios=[1.6, 1]))
order = sorted(range(len(subs)), key=lambda i: power_mw[i])
a1.barh([subs[i] for i in order], [power_mw[i] for i in order], color=[COLORS[i] for i in order], height=0.62)
a1.set_xlabel("Power when ON (mW)")
for s in ("top", "right"):
    a1.spines[s].set_visible(False)
for y, i in enumerate(order):
    a1.text(power_mw[i] + 20, y, f"{power_mw[i]:.0f}", va="center", fontsize=8, color=TEXT)
a1.set_xlim(0, 1300)

a2.bar(["Generated", "Consumed"], [6.6, 3.917], color=["#f5b941", "#ff8fb1"], width=0.55)
a2.set_ylabel("W")
a2.set_ylim(0, 7.5)
for x, v in enumerate([6.6, 3.917]):
    a2.text(x, v + 0.15, f"{v:.2f} W", ha="center", fontsize=9, color=TEXT, fontweight="bold")
a2.text(0.5, 7.05, "+2.68 W margin", ha="center", fontsize=10, color="#4fd1a5", fontweight="bold")
for s in ("top", "right"):
    a2.spines[s].set_visible(False)
fig.tight_layout()
fig.savefig(OUT / "chart_power.png", transparent=True, bbox_inches="tight")
plt.close(fig)
print("charts written")
