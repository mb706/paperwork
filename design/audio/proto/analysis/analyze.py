"""Judge a render without ears: numbers and one picture per file.

    gamedev-python -I design/audio/proto/analysis/analyze.py out/renders/era1-v1.wav [...] [--notes]

Per file it writes <out>/analysis/<name>.png (log-frequency spectrogram, band energies over time,
short-term loudness, onset density and, with a note log, a piano roll) and prints:
- integrated loudness, loudness range, true peak (ffmpeg ebur128), crest factor;
- band balance: sub <60, bass 60-250, low-mid 250-500 (mud), mid 500-2k, presence 2-5k (harshness),
  air >5k, as shares of energy, plus the worst 5-second window for low-mid and presence;
- stereo correlation, silence share, onset density (per 10 s);
- from <name>.notes.json: notes per instrument and range, polyphony, and every simultaneous minor
  second or minor ninth below C5 between sustained notes (the clashes worth looking at).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import librosa
import matplotlib.pyplot as plt
import numpy as np
import scipy.signal as ss
import soundfile as sf

FFMPEG = str(Path.home() / ".local/bin/ffmpeg")
BANDS = [("sub", 20, 60), ("bass", 60, 250), ("lowmid", 250, 500), ("mid", 500, 2000), ("presence", 2000, 5000), ("air", 5000, 20000)]


def ebur128(path: Path) -> dict:
    r = subprocess.run([FFMPEG, "-hide_banner", "-nostats", "-v", "verbose", "-i", str(path), "-af", "ebur128=peak=true:framelog=verbose", "-f", "null", "-"],
                       capture_output=True, text=True)
    err = r.stderr
    out = {}
    m = re.search(r"Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS", err)
    out["I"] = float(m.group(1)) if m else float("nan")
    m = re.search(r"Loudness range:\s+LRA:\s+([\d.]+) LU", err)
    out["LRA"] = float(m.group(1)) if m else float("nan")
    m = re.search(r"True peak:\s+Peak:\s+(-?[\d.inf]+) dBFS", err)
    out["TP"] = float(m.group(1)) if m else float("nan")
    st = [float(x) for x in re.findall(r"TARGET:.*?S:\s+(-?[\d.]+)", err)]
    out["S_max"] = max(st) if st else float("nan")
    out["S_series"] = st  # 10 Hz
    return out


def band_energy(x: np.ndarray, sr: int, hop: float = 0.5):
    m = x.mean(axis=1)
    n = int(sr * hop)
    frames = len(m) // n
    f, t, Z = ss.stft(m, sr, nperseg=8192, noverlap=8192 - n, boundary=None)
    P = np.abs(Z) ** 2
    out = {}
    for name, lo, hi in BANDS:
        sel = (f >= lo) & (f < hi)
        out[name] = P[sel].sum(axis=0)
    return t, out


def notes_report(notes_path: Path) -> tuple[list[str], dict]:
    data = json.loads(notes_path.read_text())
    notes = data["notes"]
    lines = []
    by = {}
    for n in notes:
        by.setdefault(n["i"], []).append(n)
    for k, ns in sorted(by.items()):
        ms = [n["m"] for n in ns]
        vs = [n["v"] for n in ns]
        lines.append(f"  {k:10s} {len(ns):4d} notes, MIDI {min(ms):.0f}-{max(ms):.0f}, vel {min(vs):.2f}-{max(vs):.2f}")
    # clashes: sustained notes (strings, winds, bass) overlapping in time, minor 2nd/9th apart, lower note < C5
    sustained = {"violins", "violas", "celli", "bass", "clarinet", "horn", "flute", "organ", "sine", "glass", "psaltery", "vibes_bowed", "drone"}
    sus = [n for n in notes if n["i"] in sustained]
    clashes = []
    for i, a in enumerate(sus):
        for b in sus[i + 1:]:
            if b["t"] >= a["t"] + a["d"] or a["t"] >= b["t"] + b["d"]:
                continue
            lo, hi = sorted((a["m"], b["m"]))
            iv = round(hi - lo)
            if iv % 12 == 1 and iv <= 13 and lo < 72:
                ov = min(a["t"] + a["d"], b["t"] + b["d"]) - max(a["t"], b["t"])
                if ov > 0.4:
                    clashes.append((max(a["t"], b["t"]), a["i"], a["m"], b["i"], b["m"], ov))
    if clashes:
        lines.append(f"  sustained m2/m9 clashes below C5: {len(clashes)}")
        for c in clashes[:12]:
            lines.append(f"    t={c[0]:6.1f}s {c[1]} {c[2]:.0f} vs {c[3]} {c[4]:.0f} for {c[5]:.1f}s")
    else:
        lines.append("  sustained m2/m9 clashes below C5: none")
    # low-mid crowding: sustained notes sounding at once with fundamentals in MIDI 45-59 (110-247 Hz),
    # and close intervals (a third or less) between sustained notes below E3 (52): the usual sources of mud
    ts = np.arange(0, max(n["t"] + n["d"] for n in notes) + 2, 0.25)
    crowd = np.zeros_like(ts)
    for n in sus:
        if 45 <= n["m"] < 60:
            crowd[(ts >= n["t"]) & (ts < n["t"] + n["d"])] += 1
    close = 0
    for i, a in enumerate(sus):
        for b in sus[i + 1:]:
            if b["t"] >= a["t"] + a["d"] or a["t"] >= b["t"] + b["d"]:
                continue
            lo, hi = sorted((a["m"], b["m"]))
            ov = min(a["t"] + a["d"], b["t"] + b["d"]) - max(a["t"], b["t"])
            if lo < 52 and 0 < hi - lo <= 4 and ov > 1.0:
                close += 1
    lines.append(f"  low-mid crowding (sustained, MIDI 45-59): max {crowd.max():.0f}, time with >=4: {100 * np.mean(crowd >= 4):.0f}%; close intervals below E3: {close}")
    # polyphony (sounding notes incl. 1 s release)
    ts = np.arange(0, max(n["t"] + n["d"] for n in notes) + 2, 0.25)
    poly = np.zeros_like(ts)
    for n in notes:
        poly[(ts >= n["t"]) & (ts < n["t"] + n["d"] + 1.0)] += 1
    lines.append(f"  polyphony: max {poly.max():.0f}, mean {poly.mean():.1f}")
    return lines, {"notes": notes, "by": by}


def analyze(path: Path, out_dir: Path) -> None:
    x, sr = sf.read(path, always_2d=True, dtype="float64")
    name = path.stem
    dur = len(x) / sr
    eb = ebur128(path)
    m = x.mean(axis=1)
    rms = np.sqrt(np.mean(m ** 2))
    crest = 20 * np.log10(np.abs(x).max() / (rms + 1e-12))
    t_b, bands = band_energy(x, sr)
    tot = sum(v.sum() for v in bands.values())
    share = {k: v.sum() / tot for k, v in bands.items()}
    frame_tot = sum(bands.values()) + 1e-20
    win = int(5 / 0.5)
    def worst(k):
        r = np.convolve(bands[k], np.ones(win), "valid") / (np.convolve(frame_tot, np.ones(win), "valid"))
        loud = np.convolve(frame_tot, np.ones(win), "valid")
        r = np.where(loud > loud.max() * 1e-3, r, 0)
        i = int(np.argmax(r))
        return r[i], t_b[i]
    lm, lm_t = worst("lowmid")
    pr, pr_t = worst("presence")
    L, R = x[:, 0], x[:, 1]
    corr = float(np.sum(L * R) / np.sqrt(np.sum(L ** 2) * np.sum(R ** 2) + 1e-20))
    # silence share (short-term loudness below -45 LUFS)
    st = np.array(eb["S_series"]) if eb["S_series"] else np.array([0.0])
    silence = float(np.mean(st < -45))
    # onsets
    y = librosa.resample(m.astype(np.float32), orig_sr=sr, target_sr=22050)
    on = librosa.onset.onset_detect(y=y, sr=22050, units="time", backtrack=False)
    dens = np.histogram(on, bins=np.arange(0, dur + 10, 10))[0]
    print(f"{name}: {dur:.1f} s | I {eb['I']:.1f} LUFS, LRA {eb['LRA']:.1f} LU, TP {eb['TP']:.1f} dBTP, S_max {eb['S_max']:.1f}, crest {crest:.1f} dB")
    print("  bands: " + ", ".join(f"{k} {100 * v:.1f}%" for k, v in share.items()))
    print(f"  worst 5 s: low-mid {100 * lm:.0f}% at {lm_t:.0f} s, presence {100 * pr:.1f}% at {pr_t:.0f} s | stereo corr {corr:.2f} | silence {100 * silence:.0f}%")
    print(f"  onsets per 10 s: {' '.join(str(d) for d in dens)}")
    notes_path = path.with_name(name + ".notes.json")
    roll = None
    if notes_path.exists():
        lines, roll = notes_report(notes_path)
        print("\n".join(lines))
    # ---- picture ----
    nrows = 4 if roll else 3
    fig, ax = plt.subplots(nrows, 1, figsize=(16, 3.2 * nrows + 1.5), sharex=True,
                           gridspec_kw={"height_ratios": [3, 1.2, 1.2] + ([2.4] if roll else [])})
    hop = 512
    C = np.abs(librosa.cqt(y, sr=22050, hop_length=hop, fmin=librosa.note_to_hz("A0"), n_bins=96, bins_per_octave=12))
    Cdb = librosa.amplitude_to_db(C, ref=np.max)
    tt = np.arange(Cdb.shape[1]) * hop / 22050
    ax[0].imshow(Cdb, aspect="auto", origin="lower", extent=[0, tt[-1], 21, 21 + 96], cmap="magma", vmin=-80, vmax=0)
    ax[0].set_ylabel("MIDI (CQT)")
    for mm, lab in [(36, "C2"), (48, "C3"), (60, "C4"), (72, "C5"), (84, "C6"), (96, "C7")]:
        ax[0].axhline(mm, color="w", lw=0.3, alpha=0.4)
        ax[0].text(0.5, mm + 0.5, lab, color="w", fontsize=7)
    ax[0].set_title(f"{name}  I={eb['I']:.1f} LUFS  TP={eb['TP']:.1f} dBTP  LRA={eb['LRA']:.1f}  crest={crest:.1f} dB")
    for k, v in bands.items():
        ax[1].plot(t_b, 10 * np.log10(v / tot * len(t_b) + 1e-12), label=k, lw=1)
    ax[1].legend(ncol=6, fontsize=7, loc="upper right")
    ax[1].set_ylabel("band dB")
    ax[1].set_ylim(-60, 15)
    ts = np.arange(len(st)) * 0.1
    ax[2].plot(ts, st, color="k", lw=0.8, label="short-term LUFS")
    ax[2].set_ylim(-60, -5)
    ax[2].axhline(-16, color="r", lw=0.5)
    ax2 = ax[2].twinx()
    ax2.bar(np.arange(len(dens)) * 10 + 5, dens, width=9, alpha=0.2, color="b")
    ax2.set_ylabel("onsets/10 s")
    ax[2].set_ylabel("LUFS (S)")
    if roll:
        cols = plt.cm.tab10.colors
        for i, (k, ns) in enumerate(sorted(roll["by"].items())):
            for n in ns:
                ax[3].plot([n["t"], n["t"] + n["d"]], [n["m"], n["m"]], color=cols[i % 10], lw=1.6, alpha=0.4 + 0.6 * n["v"])
            ax[3].plot([], [], color=cols[i % 10], label=k)
        ax[3].legend(ncol=8, fontsize=7, loc="upper right")
        ax[3].set_ylabel("MIDI")
    ax[-1].set_xlabel("s")
    fig.tight_layout()
    out_dir.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_dir / f"{name}.png", dpi=70)
    plt.close(fig)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[2] / "out" / "analysis")
    a = ap.parse_args()
    for f in a.files:
        analyze(f, a.out)


if __name__ == "__main__":
    main()
