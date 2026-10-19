import r2w_takeoff as R
import takeoff as T
T.tech_list = R.tech_list
T.apply_tech = R.patched_apply
for oh in ("small", "medium", "large", "huge"):
    res = R.run(oh)
    log = res["log"]
    hall_h = 0.0
    sem_h = 0.0
    for a, b in zip(log[:-1], log[1:]):
        dt_h = (b["t"] - a["t"]) / 3600
        hall_h += a["halls"] * dt_h
        # Researcher seminars: capacity L_cap cards/s at 30 s/unit, seminar speed 3.5 x 2.5 boost
        sem_h += (a["L_cap"] * 30 / (3.5 * 2.5)) * dt_h
    T_min = res["t_end"] / 60
    base = 0.01 * 4  # per building-hour at tier 4
    for label, v, O in (("Standard, O=0", 0.0, 0), ("Verified, O=2", 0.5, 2), ("Audited, O=4", 0.75, 4)):
        n = base * (hall_h + sem_h) * (1 - v) * (1 - 0.2 * O)
        print(f"{oh:6s} takeoff {T_min:5.1f} min: hall-hours {hall_h:6.1f}, Researcher-seminar-hours {sem_h:5.1f} -> {label}: {n:.1f} compromises")
