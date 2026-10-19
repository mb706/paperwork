"""Run every experiment for R1-G, write markdown tables, render figures."""
from __future__ import annotations

import bisect
import json
import math
import os
from dataclasses import replace

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import Patch

from takeoff import Params, simulate, summary, gen_doubling, GEN, PHYS, CAP, INF
from arc import Prelude, whole_game, field_line, Field, overhang_params, factory_rate, capped_rate

FIG = "/home/mewse/browsergame/design/round1/G-figures"
OUT = "/tmp/claude-1002/r1g/out"
os.makedirs(FIG, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

# ---- dataviz tokens (reference palette, light) ------------------------------
SURF, INK, INK2, MUTED, GRID, BASE = "#fcfcfb", "#0b0b0b", "#52514e", "#898781", "#e1e0d9", "#c3c2b7"
CAT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]
ORD4 = ["#86b6ef", "#3987e5", "#1c5cab", "#0d366b"]
ORD5 = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"]
BIND_COL = {"compute": CAT[0], "power": CAT[1], "cooling": CAT[2], "labs": CAT[3]}

plt.rcParams.update({
    "figure.facecolor": SURF, "axes.facecolor": SURF, "savefig.facecolor": SURF,
    "font.family": "DejaVu Sans", "font.size": 9,
    "axes.edgecolor": BASE, "axes.linewidth": 0.8, "axes.labelcolor": INK2,
    "axes.titlecolor": INK, "axes.titlesize": 10, "axes.titleweight": "bold",
    "axes.titlelocation": "left",
    "axes.spines.top": False, "axes.spines.right": False,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6, "grid.linestyle": "-",
    "xtick.color": MUTED, "ytick.color": MUTED, "xtick.labelcolor": INK2, "ytick.labelcolor": INK2,
    "legend.frameon": False, "legend.fontsize": 8.5, "legend.labelcolor": INK2,
    "lines.linewidth": 1.4, "lines.solid_capstyle": "round", "lines.solid_joinstyle": "round",
})
DPI = 150


def fmt_dur(sec):
    if sec is None or (isinstance(sec, float) and (math.isnan(sec) or math.isinf(sec))):
        return "–"
    if sec < 1:
        return f"{sec:.2f} s"
    if sec < 90:
        return f"{sec:.0f} s"
    if sec < 5400:
        return f"{sec/60:.1f} min"
    return f"{sec/3600:.1f} h"


def fmt_num(x):
    if x >= 1e6:
        return f"{x:.2e}"
    if x >= 100:
        return f"{x:,.0f}"
    return f"{x:.2f}"


def foot(fig, text):
    fig.text(0.01, -0.01, text, color=MUTED, fontsize=7.5, ha="left", va="top")


def series(res, key, upto=None):
    log = res["log"]
    if upto is not None:
        log = [x for x in log if x["t"] <= upto + 1e-9]
    return [x["t"] for x in log], [x[key] for x in log]


tables = []


def table(title, header, rows):
    s = [f"**{title}**", "", "| " + " | ".join(header) + " |",
         "|" + "|".join("---" for _ in header) + "|"]
    for r in rows:
        s.append("| " + " | ".join(str(c) for c in r) + " |")
    tables.append("\n".join(s))


BASE_P = Params()
OVH = {"small": 25, "medium": 100, "large": 400, "huge": 1500}


def run_ovh(n, **kw):
    p = replace(overhang_params(n, BASE_P, BASE_P.n_univ), **kw)
    return simulate(p, log_every=kw.pop("log_every", 2.0) if "log_every" in kw else 2.0)


# =============================================================================
# 1. Reference run: medium overhang, active player
# =============================================================================
ref = simulate(replace(BASE_P), log_every=1.0)
ref_s = summary(ref)
ref_dt = gen_doubling(ref)

rows = []
log = ref["log"]
ts_log = [x["t"] for x in log]
prev = 0.0
gd = {round(t, 6): (dt, R) for t, dt, R in ref_dt}
for name, kind, t, cost in ref["done"]:
    i = min(bisect.bisect_left(ts_log, t), len(log) - 1)
    x = log[max(i - 1, 0)]
    if kind == GEN or kind == CAP or kind == PHYS:
        dtd = next((d for (tt, d, R) in ref_dt if abs(tt - t) < 1e-6), None)
        rows.append([name, f"{t/60:.2f}", fmt_dur(t - prev), fmt_dur(dtd) if dtd else "",
                     fmt_num(log[i]["R"]), x["bind"], x["halls"], f"{x['P_avail']:.0f}"])
    prev = t
table("Reference takeoff (medium overhang = 100 halls, active player): every tech",
      ["Tech", "Done at (min)", "Took", "Doubling time of R", "R after (units/s)",
       "Binding before", "Halls", "Power for compute (MW)"], rows)

# =============================================================================
# 2. Policies (the brakes)
# =============================================================================
POL = [("greedy", "Active player"), ("slow", "Half-speed builder"),
       ("no_cooling", "Never builds cooling"), ("no_power", "Never builds power"),
       ("autopilot", "Chain runs, no building"), ("frozen", "No hardware change")]
pol_res = {}
rows = []
for key, label in POL:
    r = ref if key == "greedy" else simulate(replace(BASE_P, policy=key), log_every=2.0)
    pol_res[key] = r
    s = summary(r)
    b = s["bind"]
    rows.append([label, f"{s['t_end_min']:.1f}", f"{s['t_end_min']/ref_s['t_end_min']:.2f}×",
                 f"{s['last20_min']:.1f}", f"{s['last10_min']*60:.0f}",
                 " / ".join(f"{int(round(100*b.get(k,0)))}" for k in ["compute", "power", "cooling", "labs"])])
table("Brakes: the same closure state, different builders",
      ["Builder", "Takeoff (min)", "vs active", "Last 20 techs (min)", "Last 10 techs (s)",
       "Time bound by compute / power / cooling / labs (%)"], rows)

# =============================================================================
# 3. Overhang scenarios and sweep
# =============================================================================
ovh_res = {}
rows = []
for name, n in OVH.items():
    a = run_ovh(n)
    f = run_ovh(n, policy="frozen")
    ovh_res[name] = a
    sa, sf = summary(a), summary(f)
    dts = gen_doubling(a)
    rows.append([name, n, f"{5*n}", f"{sa['R0']:.2f}", f"{sa['t_end_min']:.1f}",
                 f"{sf['t_end_min']:.1f}", f"{sa['last20_min']:.1f}",
                 fmt_dur(dts[0][1]) if dts else "–", fmt_dur(dts[-1][1]) if dts else "–"])
table("Overhang at closure → takeoff",
      ["Overhang", "Halls at closure", "MW idle compute", "R at closure (units/s)",
       "Takeoff, active (min)", "Takeoff, no building (min)", "Last 20 techs (min)",
       "First doubling time", "Final doubling time"], rows)

sweep_n = [10, 15, 25, 40, 60, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000]
sweep = []
for n in sweep_n:
    a = summary(run_ovh(n, max_t=20 * 3600))["t_end_min"]
    f = summary(run_ovh(n, policy="frozen", max_t=40 * 3600))["t_end_min"]
    sweep.append((n, a, f))
table("Overhang sweep (takeoff duration, min)", ["Halls at closure", "Active player", "No building"],
      [[n, f"{a:.1f}", f"{f:.1f}"] for n, a, f in sweep])

# =============================================================================
# 4. Returns to research r (g = 1.5 fixed, m = g^r) and research order
# =============================================================================
R_LIST = [0.6, 0.8, 1.0, 1.25, 1.5, 1.71, 2.0, 2.5, 3.0]
r_rows, r_curves = [], {}
for rr in R_LIST:
    m = 1.5 ** rr
    a = simulate(replace(BASE_P, m=m, max_t=30 * 3600), log_every=5.0)
    gf = simulate(replace(BASE_P, m=m, order="gens_first", max_t=30 * 3600), log_every=5.0)
    f = simulate(replace(BASE_P, m=m, policy="frozen", max_t=60 * 3600), log_every=5.0)
    sa, sg, sf = summary(a), summary(gf), summary(f)
    r_curves[rr] = a
    r_rows.append((rr, m, sa["t_end_min"], sg["t_end_min"], sf["t_end_min"], sa["last20_min"]))
table("Returns to research r = ln m / ln g (g = 1.5): world setting",
      ["r", "m (per Generation)", "Active, hardware techs interleaved (min)",
       "Active, Generations first (min)", "No building (min)", "Last 20 techs, active (min)"],
      [[f"{rr:.2f}", f"{m:.3f}", f"{a:.0f}", f"{g:.0f}",
        ("never" if math.isinf(f) else f"{f:.0f}"), f"{l20:.1f}"] for rr, m, a, g, f, l20 in r_rows])

# =============================================================================
# 5. Whole game, plateau trade-offs, field line, after victory
# =============================================================================
G = whole_game(post_t=2 * 3600)
tk = G["takeoff"]
t0 = G["t_close"]
t_cap_abs = t0 + tk["t_end"]

# plateau trade-offs
rows = []
for label, pre in [("Typical: 0.6 halls/min during the plateau", Prelude()),
                   ("Idle plateau: 0.2 halls/min", Prelude(hall_rate_pre=0.2)),
                   ("Compute-first: 1.5 halls/min", Prelude(hall_rate_pre=1.5)),
                   ("Talent-first: claim universities twice as fast", Prelude(staff_growth_per_h=0.16)),
                   ("Talent-first and compute-first", Prelude(staff_growth_per_h=0.16, hall_rate_pre=1.5)),
                   ("Compute-first + 30 min launch delay", Prelude(hall_rate_pre=1.5, launch_delay_min=30)),
                   ("Compute-first + 90 min launch delay", Prelude(hall_rate_pre=1.5, launch_delay_min=90))]:
    gg = whole_game(pre)
    s = summary(gg["takeoff"])
    plat = (gg["t_close"] - pre.t_bind_h * 3600) / 60
    rows.append([label, f"{plat:.0f}", gg["halls0"], f"{s['t_end_min']:.1f}",
                 f"{plat + s['t_end_min']:.0f}", f"{(gg['t_close'] + s['t_end_min']*60)/3600:.2f}"])
table("The talent plateau makes the overhang (staffing binds at 11 h → capstone)",
      ["Plateau play", "Plateau incl. delay (min)", "Halls at closure", "Takeoff (min)",
       "Staffing binds → capstone (min)", "Capstone at (game h)"], rows)

# field line
rows = []
field_runs = {}
for v0 in [2.0, 2.5, 2.75, 2.9, 3.0, 3.25]:
    line, ta, tc = field_line(G, Field(v0_per_h=v0), t_end_s=t0 + 30 * 3600)
    field_runs[v0] = (line, ta, tc)
    Fc = next((F for (t, F, Y) in line if t >= t0), float("nan"))
    rows.append([f"{v0}", f"{Fc:.1f} ({1945+Fc:.0f})", fmt_dur(ta) if ta else "–",
                 fmt_dur(tc) if tc else "–",
                 ("you" if (tc is None or tc > t_cap_abs) else "the field") +
                 (f" by {fmt_dur(abs((tc or 1e12) - t_cap_abs))}" if tc else "")])
table("The field's frontier line (typical player: closure %.1f h, capstone %.2f h)" % (t0 / 3600, t_cap_abs / 3600),
      ["v₀ (field-years/h)", "Field year at your closure", "Field loop closes at",
       "Field takeoff complete at", "First to finish"], rows)

# after victory
post_rows = []
log = tk["log"]
ts = [x["t"] for x in log]
Rs = [x["R"] for x in log]
for after in [0, 10, 20, 30, 60, 90, 115]:
    tt = tk["t_end"] + after * 60
    i = min(bisect.bisect_left(ts, tt), len(ts) - 1)
    j = bisect.bisect_left(ts, tt - 600)
    dtd = 600 * math.log(2) / math.log(Rs[i] / Rs[j]) if Rs[i] > Rs[j] else float("inf")
    post_rows.append([f"+{after}", fmt_num(Rs[i]), log[i]["halls"], f"{log[i]['P_avail']:.0f}",
                      fmt_dur(dtd)])
table("After the capstone: Generation N+ (×1.1 per level, cost ×2), builder continues",
      ["Minutes after capstone", "R (units/s)", "Halls", "Power for compute (MW)",
       "Doubling time (10-min window)"], post_rows)

# =============================================================================
# FIGURES
# =============================================================================

# ---- G1: the whole game ----------------------------------------------------
pre = G["pre"]
tB = pre.t_bind_h * 3600
mats = G["mats"]
fig, axs = plt.subplots(3, 1, figsize=(9, 8.4), sharex=True,
                        gridspec_kw=dict(height_ratios=[1.25, 1, 1], hspace=0.12))
grid_t = [i * 120.0 for i in range(int(t_cap_abs / 120) + 2)]
axs[0].plot([t / 3600 for t in grid_t], [factory_rate(t, pre) for t in grid_t], color=MUTED, lw=1.0,
            label="What the factory's papers could feed")
pre_t = [t for t in grid_t if t <= t0]
axs[0].plot([t / 3600 for t in pre_t], [capped_rate(t, pre) for t in pre_t], color=CAT[0], lw=1.6,
            label="Research before the loop (seminars staffed by towns)")
tt, RR = series(tk, "R", upto=tk["t_end"])
axs[0].plot([(t0 + t) / 3600 for t in tt], RR, color=CAT[2], lw=1.6,
            label="Research after the loop closes (System cards × Generation)")
axs[0].set_yscale("log")
axs[0].set_ylabel("Research rate\n(units/s, log)")
axs[0].legend(loc="upper left")
for x, lab in [(tB / 3600, "staffing binds"), (t0 / 3600, "loop closes"), (t_cap_abs / 3600, "capstone")]:
    for a in axs:
        a.axvline(x, color=BASE, lw=0.8)
    axs[0].text(x, 2e6, " " + lab, color=INK2, fontsize=7.5, rotation=90, va="top", ha="right")
axs[0].set_title("The whole game: factory-bound → talent-bound → takeoff (typical player)")
# (b) doubling time
Td = pre.T_d_h * 60
axs[1].plot([0, tB / 3600], [Td, Td], color=CAT[0], lw=1.6)
gam = pre.staff_growth_per_h
cap_t = [tB + i * 300 for i in range(int((t0 - tB) / 300) + 1)]
axs[1].plot([t / 3600 for t in cap_t], [math.log(2) * (1 + gam * (t - tB) / 3600) / gam * 60 for t in cap_t],
            color=CAT[1], lw=1.6)
gdt = [x for x in gen_doubling(tk) if x[0] <= tk["t_end"]]
axs[1].plot([(t0 + t) / 3600 for t, d, R in gdt], [d / 60 for t, d, R in gdt], color=CAT[2], lw=1.6,
            marker="o", ms=3.5, mec=SURF, mew=0.8)
axs[1].set_yscale("log")
axs[1].set_ylabel("Doubling time of research\n(minutes, log)")
axs[1].annotate("2 h", (5, Td), textcoords="offset points", xytext=(0, 5), color=INK2, fontsize=8)
axs[1].annotate(f"{math.log(2) * (1 + gam * (t0 - tB) / 3600) / gam:.0f} h", (t0 / 3600, math.log(2) * (1 + gam * (t0 - tB) / 3600) / gam * 60),
                textcoords="offset points", xytext=(-26, 6), color=INK2, fontsize=8)
axs[1].annotate(f"{gdt[0][1]/60:.0f} min", ((t0 + gdt[0][0]) / 3600, gdt[0][1] / 60),
                textcoords="offset points", xytext=(6, 2), color=INK2, fontsize=8)
axs[1].annotate(f"{gdt[-1][1]:.1f} s", ((t0 + gdt[-1][0]) / 3600, gdt[-1][1] / 60),
                textcoords="offset points", xytext=(-34, -4), color=INK2, fontsize=8)
# (c) time per tech
techs_all = [(m[2], m[1]) for m in mats] + \
            [(t0 + t, "takeoff") for _, k, t, _ in tk["done"] if k != INF and t <= tk["t_end"] + 1e-6]
prev = 0.0
xs, ys, cs = [], [], []
for t, k in techs_all:
    xs.append(t / 3600)
    ys.append(max(t - prev, 0.05) / 60)
    cs.append(CAT[0] if k == "pre" else CAT[1] if k == "capped" else CAT[2])
    prev = t
axs[2].scatter(xs, ys, s=18, c=cs, edgecolors=SURF, linewidths=0.6, zorder=3)
axs[2].set_yscale("log")
axs[2].set_ylabel("Time per tech\n(minutes, log)")
axs[2].set_xlabel("Game time (hours)")
axs[2].legend(handles=[Line2D([], [], marker="o", ls="", color=c, ms=5, label=l) for c, l in
                       [(CAT[0], "Factory-bound (~15 techs/h)"), (CAT[1], "Talent-bound"),
                        (CAT[2], "Takeoff")]], loc="lower left", ncol=3)
axs[2].set_xlim(0, t_cap_abs / 3600 + 0.35)
foot(fig, "Pre-loop pacing is an assumption (Factorio-like, experienced player); the takeoff is simulated "
          f"(r = 1.71, {G['halls0']} halls at closure, active builder). Source: /tmp/claude-1002/r1g/figs.py")
fig.savefig(f"{FIG}/G1-whole-game.png", dpi=DPI, bbox_inches="tight")
plt.close(fig)

# ---- G2: takeoff anatomy ---------------------------------------------------
fig, axs = plt.subplots(4, 1, figsize=(9, 9.6), sharex=True,
                        gridspec_kw=dict(height_ratios=[1.3, 0.45, 1, 0.9], hspace=0.30))
T = ref["t_end"]
tt, RR = series(ref, "R", upto=T)
tm = [t / 60 for t in tt]
axs[0].plot(tm, RR, color=CAT[0], lw=1.6)
for name, kind, t, cost in ref["done"]:
    if kind == GEN:
        axs[0].plot([t / 60], [RR[min(bisect.bisect_left(tt, t), len(RR) - 1)]], marker="o", ms=4,
                    color=CAT[0], mec=SURF, mew=1.0)
for name, kind, t, cost in ref["done"]:
    if name in ("Generation 1", "Generation 5", "Generation 10", "Fusion power",
                "Accelerator 2", "Capstone"):
        y = RR[min(bisect.bisect_left(tt, t), len(RR) - 1)]
        axs[0].annotate(name, (t / 60, y), textcoords="offset points",
                        xytext=(-6, 8) if name != "Capstone" else (-52, 2),
                        fontsize=7.5, color=INK2, ha="right" if name != "Capstone" else "left")
axs[0].set_yscale("log")
axs[0].set_ylabel("Research rate R\n(units/s, log)")
axs[0].set_title(f"Takeoff anatomy: 100 halls at closure, active builder — capstone at {T/60:.1f} min")
# (b) binding constraint band + utilisation
tb, bb = series(ref, "bind", upto=T)
for (t1, b1), t2 in zip(zip(tb[:-1], bb[:-1]), tb[1:]):
    axs[1].axvspan(t1 / 60, t2 / 60, ymin=0.0, ymax=1.0, color=BIND_COL[b1], lw=0, alpha=0.9)
axs[1].set_yticks([])
axs[1].set_ylabel("What binds")
axs[1].grid(False)
axs[1].legend(handles=[Patch(color=BIND_COL[k], label=k) for k in ["compute", "power", "cooling", "labs"]],
              loc="lower left", bbox_to_anchor=(0.0, 1.0), ncol=4, fontsize=8, borderaxespad=0.2)
# (c) power, cooling, demand
td, D = series(ref, "D", upto=T)
_, Pv = series(ref, "P_avail", upto=T)
_, Q = series(ref, "Q", upto=T)
axs[2].plot([t / 60 for t in td], D, color=INK2, lw=1.6, label="Compute demand at full load")
axs[2].plot([t / 60 for t in td], Pv, color=CAT[1], lw=1.6, label="Power available to compute")
axs[2].plot([t / 60 for t in td], Q, color=CAT[2], lw=1.6, label="Cooling capacity")
axs[2].set_ylabel("MW")
axs[2].legend(loc="upper left")
# (d) compute
_, HT = series(ref, "halls_by_tier", upto=T)
for k, col in enumerate(ORD4):
    axs[3].plot([t / 60 for t in td], [h[k] for h in HT], color=col, lw=1.6,
                label=f"Tier {k+1} (speed {BASE_P.hall_tiers[k][0]:g}, {BASE_P.hall_tiers[k][1]:g} MW)")
axs[3].set_ylabel("Halls by accelerator tier")
axs[3].set_xlabel("Minutes since the loop closed")
axs[3].legend(loc="upper left")
foot(fig, "Hardware techs arrive between Generations (Two-phase cooling after Gen 1, Accelerator 2 after Gen 2, …). "
          "Utilisation u = min(1, P/D, Q/D).")
fig.savefig(f"{FIG}/G2-takeoff-anatomy.png", dpi=DPI, bbox_inches="tight")
plt.close(fig)

# ---- G3: doubling time per generation, four overhangs -------------------------
fig, ax = plt.subplots(figsize=(8.2, 4.6))
for (name, n), col in zip(OVH.items(), ORD4):
    d = gen_doubling(ovh_res[name])
    ax.plot(range(1, len(d) + 1), [x[1] / 60 for x in d], color=col, lw=1.6, marker="o", ms=4,
            mec=SURF, mew=1.0, label=f"{name}: {n} halls")
ax.axhline(120, color=BASE, lw=0.8)
ax.text(20.3, 120, "pre-loop: 2 h", color=INK2, fontsize=8, va="center")
ax.axhline(1, color=BASE, lw=0.8)
ax.text(20.3, 1, "1 min", color=INK2, fontsize=8, va="center")
ax.set_yscale("log")
ax.set_xticks(range(1, 21))
ax.set_xlim(0.5, 22.5)
ax.set_xlabel("Generation completed")
ax.set_ylabel("Doubling time of R (minutes, log)")
ax.set_title("The doubling time collapses every generation; the overhang sets where it starts")
ax.legend(loc="lower left")
foot(fig, "Active builder; doubling time measured across each Generation interval.")
fig.savefig(f"{FIG}/G3-doubling-time.png", dpi=DPI, bbox_inches="tight")
plt.close(fig)

# ---- G4: overhang sweep ----------------------------------------------------
fig, ax = plt.subplots(figsize=(8.2, 4.6))
ns = [n for n, a, f in sweep]
ax.plot(ns, [a for n, a, f in sweep], color=CAT[0], lw=1.6, marker="o", ms=4, mec=SURF, mew=1.0,
        label="Active builder")
ax.plot(ns, [f for n, a, f in sweep], color=CAT[1], lw=1.6, marker="o", ms=4, mec=SURF, mew=1.0,
        label="No building during takeoff")
ax.axhline(10, color=BASE, lw=0.8)
ax.text(ns[0], 10, " Hard takeoff (H's achievement): under 10 min", color=INK2, fontsize=8, va="bottom")
for name, n in OVH.items():
    a = next(a for nn, a, f in sweep if nn == n) if n in ns else None
ax.set_xscale("log")
ax.set_yscale("log")
ax.set_xlabel("Halls running at closure (5 MW each; log)")
ax.set_ylabel("Takeoff: closure → capstone (min, log)")
ax.set_title("Hardware overhang: the more idle compute at closure, the faster the takeoff")
ax.legend(loc="upper right")
for n, lab in [(25, "small"), (100, "medium"), (400, "large"), (1500, "huge")]:
    ax.axvline(n, color=GRID, lw=0.8, zorder=0)
    ax.text(n, ax.get_ylim()[0] * 1.08, lab, color=MUTED, fontsize=7.5, ha="center")
foot(fig, "Small overhangs are hardware-led (building dominates); large ones are software-led (building barely matters).")
fig.savefig(f"{FIG}/G4-overhang.png", dpi=DPI, bbox_inches="tight")
plt.close(fig)

# ---- G5: returns to research --------------------------------------------------
fig, axs = plt.subplots(1, 2, figsize=(11, 4.6), gridspec_kw=dict(wspace=0.25))
for rr, col in zip([0.8, 1.0, 1.25, 1.71, 2.5], ORD5):
    res = r_curves[rr]
    tt, RR = series(res, "R", upto=res["t_end"])
    axs[0].plot([t / 60 for t in tt], RR, color=col, lw=1.6, label=f"r = {rr}")
    axs[0].plot([res["t_end"] / 60], [RR[-1]], marker="o", ms=4.5, color=col, mec=SURF, mew=1.0)
axs[0].set_yscale("log")
axs[0].set_xlabel("Minutes since the loop closed")
axs[0].set_ylabel("Research rate R (units/s, log)")
axs[0].set_title("Trajectories by returns to research (active builder)")
axs[0].legend(loc="lower right")
rs = [x[0] for x in r_rows]
axs[1].plot(rs, [x[2] for x in r_rows], color=CAT[0], lw=1.6, marker="o", ms=4, mec=SURF, mew=1.0,
            label="Active, hardware techs interleaved")
axs[1].plot(rs, [x[3] for x in r_rows], color=CAT[1], lw=1.6, marker="o", ms=4, mec=SURF, mew=1.0,
            label="Active, Generations first")
fin = [(x[0], x[4]) for x in r_rows if not math.isinf(x[4])]
axs[1].plot([a for a, b in fin], [b for a, b in fin], color=CAT[2], lw=1.6, marker="o", ms=4, mec=SURF,
            mew=1.0, label="No building")
axs[1].axvline(1.0, color=BASE, lw=0.8)
axs[1].text(1.02, 0.03, "r = 1", color=INK2, fontsize=8, transform=axs[1].get_xaxis_transform())
axs[1].axvline(math.log(2) / math.log(1.5), color=BASE, lw=0.8)
axs[1].text(1.73, 0.03, "default 1.71", color=INK2, fontsize=8, transform=axs[1].get_xaxis_transform())
axs[1].set_yscale("log")
axs[1].set_xlabel("r = ln m / ln g")
axs[1].set_ylabel("Takeoff (min, log)")
axs[1].set_title("Which strategy wins depends on r")
axs[1].legend(loc="upper right")
foot(fig, "g = 1.5 per Generation fixed; m = g^r. Below r ≈ 1.8 hardware techs pay; above it, rushing Generations wins.")
fig.savefig(f"{FIG}/G5-returns.png", dpi=DPI, bbox_inches="tight")
plt.close(fig)

# ---- G6: brakes / builders ----------------------------------------------------
fig, ax = plt.subplots(figsize=(8.6, 4.8))
for (key, label), col in zip(POL, CAT):
    res = pol_res[key]
    tt, RR = series(res, "R", upto=res["t_end"])
    ax.plot([t / 60 for t in tt], RR, color=col, lw=1.6, label=f"{label} ({res['t_end']/60:.0f} min)")
    ax.plot([res["t_end"] / 60], [RR[-1]], marker="o", ms=4.5, color=col, mec=SURF, mew=1.0)
ax.set_yscale("log")
ax.set_xlabel("Minutes since the loop closed")
ax.set_ylabel("Research rate R (units/s, log)")
ax.set_title("Brakes: what the player builds during the takeoff decides its length")
ax.legend(loc="upper left")
foot(fig, "Same closure state (100 halls); dots mark the capstone.")
fig.savefig(f"{FIG}/G6-brakes.png", dpi=DPI, bbox_inches="tight")
plt.close(fig)

# ---- G7: after victory ----------------------------------------------------------
fig, axs = plt.subplots(2, 1, figsize=(9, 6), sharex=True, gridspec_kw=dict(hspace=0.12))
tt, RR = series(tk, "R")
axs[0].plot([t / 60 for t in tt], RR, color=CAT[0], lw=1.6)
axs[0].axvline(tk["t_end"] / 60, color=BASE, lw=0.8)
axs[0].text(tk["t_end"] / 60, RR[0], " capstone", color=INK2, fontsize=8, rotation=90, va="bottom")
axs[0].set_yscale("log")
axs[0].set_ylabel("Research rate R\n(units/s, log)")
axs[0].set_title("After victory: the doubling time bottoms out and climbs back (energy-bound)")
# doubling time with a sliding 10-min window (post) and per-gen (pre)
gdt = gen_doubling(tk)
pre_pts = [(t / 60, d / 60) for t, d, R in gdt if t <= tk["t_end"]]
axs[1].plot([a for a, b in pre_pts], [b for a, b in pre_pts], color=CAT[0], lw=1.6, marker="o", ms=3.5,
            label="Across each Generation")
post_pts = []
for k in range(len(tt)):
    t = tt[k]
    if t < tk["t_end"] + 120:
        continue
    j = bisect.bisect_left(tt, t - 600)
    if RR[k] > RR[j]:
        post_pts.append((t / 60, 600 * math.log(2) / math.log(RR[k] / RR[j]) / 60))
axs[1].plot([a for a, b in post_pts], [b for a, b in post_pts], color=CAT[1], lw=1.6,
            label="10-minute window after the capstone")
axs[1].axhline(120, color=BASE, lw=0.8)
axs[1].text(tt[-1] / 60, 120, "pre-loop 2 h", color=INK2, fontsize=8, va="bottom", ha="right")
axs[1].set_yscale("log")
axs[1].set_ylabel("Doubling time\n(minutes, log)")
axs[1].set_xlabel("Minutes since the loop closed")
axs[1].legend(loc="lower right")
axs[1].axvline(tk["t_end"] / 60, color=BASE, lw=0.8)
foot(fig, "Generation N+ after the capstone: ×1.1 per level at cost ×2 (r ≈ 0.14). Growth is then set by power and matter.")
fig.savefig(f"{FIG}/G7-after-victory.png", dpi=DPI, bbox_inches="tight")
plt.close(fig)

# ---- G8: field line ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(8.6, 4.6))
line, ta, tc = field_runs[2.0]
mats = G["mats"]
n_all = len(mats)
ty = [m[2] / 3600 for m in mats]
yy = [1945 + 80.0 * (i + 1) / n_all for i in range(n_all)]
gen_done = [d for d in tk["done"] if d[1] in (GEN, CAP) and d[2] <= tk["t_end"] + 1e-6]
ty += [(t0 + d[2]) / 3600 for d in gen_done]
yy += [min(2025 + 0.5 * (i + 1), 2035) for i in range(len(gen_done))]
ax.step(ty, yy, where="post", color=CAT[0], lw=1.6,
        label="Your year (newest tech; each Generation = 0.5 year, capstone = 2035)")
for v0, col in [(2.0, CAT[1]), (2.9, CAT[2])]:
    line, ta, tc = field_runs[v0]
    sel = [(t / 3600, 1945 + F) for t, F, Y in line if t / 3600 <= 24]
    ax.plot([a for a, b in sel], [min(b, 2035) for a, b in sel], color=col, lw=1.6,
            label=f"Field, v₀ = {v0:g} field-years/h" + (" (Race preset)" if v0 == 2.9 else " (default)"))
ax.axvline(t0 / 3600, color=BASE, lw=0.8)
ax.text(t0 / 3600, 1950, " your loop closes", color=INK2, fontsize=8, rotation=90, va="bottom")
ax.axvline(t_cap_abs / 3600, color=BASE, lw=0.8)
ax.text(t_cap_abs / 3600, 1950, " your capstone", color=INK2, fontsize=8, rotation=90, va="bottom")
ax.axhline(2035, color=BASE, lw=0.8)
ax.text(0.2, 2035, "Capstone (Generation 20)", color=INK2, fontsize=8, va="bottom")
ax.set_ylim(1945, 2040)
ax.set_xlim(0, 24)
ax.set_xlabel("Game time (hours)")
ax.set_ylabel("Year")
ax.set_title("The field's frontier line (R1-C): diffusion drags it after you; then it takes off on its own")
ax.legend(loc="lower right")
foot(fig, "dF/dt = v₀·γ(F) + β·dY_pub/dt, β = 0.5; Frontier papers are internal and do not leak. "
          "γ = (m/g)^((F−80)/0.5) after 2025: one field Generation per 0.5 field-year.")
fig.savefig(f"{FIG}/G8-field-line.png", dpi=DPI, bbox_inches="tight")
plt.close(fig)

# ---- finite-time exponent check -------------------------------------------------
fz = simulate(replace(BASE_P, policy="frozen"), log_every=1.0)
gens = [(t, R) for (t, d, R) in gen_doubling(fz)]
tstar = fz["t_end"]
import numpy as np
xs = np.log([tstar - t for t, R in gens[2:-3]])
ys = np.log([R for t, R in gens[2:-3]])
slope = np.polyfit(xs, ys, 1)[0]

# run-report statistics for the reference run
times = [t for _, k, t, _ in ref["done"] if k != INF]
def peak_per_hour(times, window):
    best = 0
    for i, t in enumerate(times):
        n = sum(1 for x in times if t - window < x <= t)
        best = max(best, n)
    return best * 3600 / window
tt_ = ref["task_time"]
tot_ = sum(tt_.values())
table("Run-report figures, reference run",
      ["Statistic", "Value"],
      [["Takeoff (closure → capstone)", fmt_dur(ref["t_end"])],
       ["Accelerators at closure (100 halls × 20 + 1,000 stocked)", "3,000"],
       ["Peak research, technologies per hour (best 10-min window)", f"{peak_per_hour(times, 600):.0f}"],
       ["Peak research, technologies per hour (best 1-min window)", f"{peak_per_hour(times, 60):.0f}"],
       ["Doubling time: first Generation → last", f"{fmt_dur(ref_dt[0][1])} → {fmt_dur(ref_dt[-1][1])}"],
       ["Builder's time on power / cooling / chain / hall space / seminars",
        " / ".join(f"{100*tt_.get(k,0)/tot_:.0f}%" for k in ["power", "cool", "chain", "slots", "labs"])]])

with open(f"{OUT}/tables.md", "w") as fh:
    fh.write("\n\n".join(tables))
    fh.write(f"\n\nFinite-time exponent (frozen hardware): fitted slope d lnR / d ln(t*-t) = {slope:.2f}; "
             f"theory -r/(r-1) = {-1.7095/0.7095:.2f}\n")
json.dump(dict(ref=ref_s, slope=slope, t_close_h=t0 / 3600, t_cap_h=t_cap_abs / 3600,
               halls0=G["halls0"]), open(f"{OUT}/summary.json", "w"), indent=1, default=str)
print("ok", ref_s, "slope", slope)
