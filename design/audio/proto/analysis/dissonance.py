"""Measure dissonance: symbolically (intervals, echo tails included) and acoustically (roughness).

    gamedev-python -I design/audio/proto/analysis/dissonance.py notes <render>.notes.json [--echo 2.892,0.52] [--from 42 --to 95]
    gamedev-python -I design/audio/proto/analysis/dissonance.py rough <a.wav> [<b.wav>] [--from 42 --to 95] [--png out.png]

notes: every sustained voice sounding at each 0.1 s step, with the tape echo's copies of the given
  channel modelled (each repeat `delay` s later at `feedback`^k, until -30 dB), weighted by gain.
  Prints the interval-class histogram of simultaneous pairs that involve the echoed instrument, and
  a weighted dissonance index (semitone class 1 = 1.0, 2 = 0.6, 6 = 0.6, 11 = 0.5, 10 = 0.4, thirds
  and sixths 0.1, fourths and fifths 0.05, unison and octave 0).
rough: Sethares' model of Plomp-Levelt sensory dissonance over measured partials: per 100 ms frame,
  the 40 strongest spectral peaks (50 Hz-6 kHz), summed over pairs as a_i a_j (e^-3.51 s df -
  e^-5.75 s df), s = 0.24 / (0.0207 f_min + 18.96), normalized by (sum a)^2 so it is level-free.
  With two files, plots both and a spectrogram of each over the window.
"""

import argparse
import json
from pathlib import Path

import numpy as np

DISS = {0: 0.0, 1: 1.0, 2: 0.6, 3: 0.1, 4: 0.1, 5: 0.05, 6: 0.6, 7: 0.05, 8: 0.1, 9: 0.1, 10: 0.4, 11: 0.5}
SUSTAINED = {"organ", "drone", "vibes", "violins", "violas", "celli", "bass", "clarinet", "glass", "horn", "flute", "sine"}


def notes_mode(a):
    d = json.loads(Path(a.file).read_text())
    notes = d["notes"]
    delay, fb = (float(x) for x in a.echo.split(","))
    voices = []  # (t0, t1, midi, weight, inst, is_echo_of_target)
    sustained = SUSTAINED | set(a.include.split(",")) if a.include else SUSTAINED
    for n in notes:
        if n["i"] not in sustained:
            continue
        w = n["v"]
        rel = 0.25 if n["i"] in ("organ", "sine") else 1.2  # release tails
        voices.append((n["t"], n["t"] + n["d"] + rel, n["m"], w, n["i"], n["i"] == a.target))
        if n["i"] == a.target and fb > 0:
            k, g = 1, fb
            while g > 10 ** (-30 / 20):
                voices.append((n["t"] + k * delay, n["t"] + n["d"] + rel + k * delay, n["m"], w * g, n["i"] + "~echo", True))
                k += 1
                g *= fb
    ts = np.arange(a.t0, a.t1, 0.1)
    hist = np.zeros(12)
    index = []
    for t in ts:
        snd = [v for v in voices if v[0] <= t < v[1]]
        di = 0.0
        for i, x in enumerate(snd):
            for y in snd[i + 1:]:
                if not (x[5] or y[5]):
                    continue  # only pairs that involve the target (organ or its echoes)
                ic = int(round(abs(x[2] - y[2]))) % 12
                w = np.sqrt(x[3] * y[3])
                hist[ic] += w
                di += w * DISS[ic]
        index.append(di)
    tot = hist.sum()
    names = ["P1/P8", "m2", "M2", "m3", "M3", "P4", "TT", "P5", "m6", "M6", "m7", "M7"]
    print(f"{Path(a.file).stem}: pairs involving '{a.target}' (echo {delay:.3f} s x {fb}), {a.t0:.0f}-{a.t1:.0f} s")
    print("  interval classes (share of weighted pair-time): " + ", ".join(f"{names[i]} {100 * hist[i] / tot:.1f}%" for i in range(12)))
    harsh = (hist[1] + hist[2] + hist[6] + hist[10] + hist[11]) / tot
    print(f"  seconds, sevenths and tritones: {100 * harsh:.1f}%; mean dissonance index {np.mean(index):.3f}, peak {np.max(index):.3f}")


def roughness(path, t0, t1):
    import soundfile as sf
    x, sr = sf.read(path, always_2d=True)
    m = x.mean(axis=1)
    n, hop = 8192, int(0.1 * sr)
    win = np.hanning(n)
    fr = np.fft.rfftfreq(n, 1 / sr)
    band = (fr >= 50) & (fr <= 6000)
    out_t, out_r = [], []
    for s in range(int(t0 * sr), min(len(m) - n, int(t1 * sr)), hop):
        spec = np.abs(np.fft.rfft(m[s:s + n] * win))
        if spec.max() <= 0:
            continue
        sp = spec * band
        pk = np.where((sp[1:-1] > sp[:-2]) & (sp[1:-1] >= sp[2:]))[0] + 1
        pk = pk[sp[pk] > spec.max() * 10 ** (-60 / 20)]
        if len(pk) < 2:
            out_t.append(s / sr)
            out_r.append(0.0)
            continue
        pk = pk[np.argsort(sp[pk])[::-1][:40]]
        # parabolic interpolation of each peak
        y0, y1, y2 = np.log(sp[pk - 1] + 1e-12), np.log(sp[pk] + 1e-12), np.log(sp[pk + 1] + 1e-12)
        dk = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2 + 1e-12)
        f = (pk + dk) * sr / n
        amp = sp[pk]
        fi, fj = np.meshgrid(f, f)
        ai, aj = np.meshgrid(amp, amp)
        fmin = np.minimum(fi, fj)
        df = np.abs(fi - fj)
        sc = 0.24 / (0.0207 * fmin + 18.96)
        dd = ai * aj * (np.exp(-3.51 * sc * df) - np.exp(-5.75 * sc * df))
        r = np.triu(dd, 1).sum() / (amp.sum() ** 2)
        out_t.append(s / sr)
        out_r.append(r)
    return np.array(out_t), np.array(out_r)


def rough_mode(a):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import soundfile as sf
    import scipy.signal as ss
    files = a.files
    res = []
    for f in files:
        t, r = roughness(f, a.t0, a.t1)
        res.append((f, t, r))
        print(f"{Path(f).stem}: roughness {a.t0:.0f}-{a.t1:.0f} s: mean {r.mean():.4f}, 90th pct {np.percentile(r, 90):.4f}, max {r.max():.4f}")
    if a.png:
        fig, ax = plt.subplots(1 + len(files), 1, figsize=(14, 3.2 * (1 + len(files))))
        for f, t, r in res:
            ax[0].plot(t, r, lw=0.9, label=Path(f).stem)
        ax[0].set_ylabel("roughness (Sethares, normalized)")
        ax[0].legend()
        for k, f in enumerate(files):
            x, sr = sf.read(f, always_2d=True)
            m = x.mean(axis=1)[int(a.t0 * sr):int(a.t1 * sr)]
            fq, tt, Z = ss.stft(m, sr, nperseg=8192, noverlap=8192 - 2400)
            D = 20 * np.log10(np.abs(Z) + 1e-9)
            sel = (fq >= 200) & (fq <= 4000)
            ax[k + 1].pcolormesh(tt + a.t0, fq[sel], D[sel], vmin=D.max() - 70, vmax=D.max(), cmap="magma", shading="auto")
            ax[k + 1].set_yscale("log")
            ax[k + 1].set_ylabel("Hz")
            ax[k + 1].set_title(Path(f).stem, fontsize=9)
        ax[-1].set_xlabel("s")
        fig.tight_layout()
        fig.savefig(a.png, dpi=70)
        print(f"wrote {a.png}")


def ref_mode(a):
    """Reference chords in the Era II organ's timbre (drawbar harmonics 1 2 3 4 6 8), through the same
    peak-picking and roughness pipeline, to give the organ-only numbers a scale."""
    import soundfile as sf
    import tempfile
    sr = 48000
    bars = {1: 1, 2: 0.55, 3: 0.12, 4: 0.16, 6: 0.04, 8: 0.05}
    hz = lambda m: 440 * 2 ** ((m - 69) / 12)
    chords = {
        "single C5": [72], "fifth A4-E5": [69, 76], "ET major third C5-E5": [72, 76], "JI major third C5-E5": [72, 72 + 12 * np.log2(5 / 4)],
        "A minor triad A4 C5 E5 (ET)": [69, 72, 76], "major second D5-E5": [74, 76], "cluster D5 E5 G5 A5": [74, 76, 79, 81],
        "unison E5 + E5 detuned 4.6 c": [76, 76.046],
    }
    t = np.arange(int(2.0 * sr)) / sr
    for name, ms in chords.items():
        y = np.zeros_like(t)
        for m in ms:
            for h, amp in bars.items():
                y += amp * np.sin(2 * np.pi * hz(m) * h * t)
        y /= np.abs(y).max() * 2
        with tempfile.NamedTemporaryFile(suffix=".wav") as f:
            sf.write(f.name, np.stack([y, y], axis=1), sr)
            _, r = roughness(f.name, 0.2, 1.7)
        print(f"  {name:32s} roughness {r.mean():.4f}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="mode", required=True)
    n = sub.add_parser("notes")
    n.add_argument("file")
    n.add_argument("--target", default="organ")
    n.add_argument("--include", default="", help="extra instruments to count, e.g. marimba,marimbaB")
    n.add_argument("--echo", default="2.892,0.52")
    n.add_argument("--from", dest="t0", type=float, default=0)
    n.add_argument("--to", dest="t1", type=float, default=150)
    r = sub.add_parser("rough")
    r.add_argument("files", nargs="+")
    r.add_argument("--from", dest="t0", type=float, default=0)
    r.add_argument("--to", dest="t1", type=float, default=150)
    r.add_argument("--png")
    sub.add_parser("ref")
    a = ap.parse_args()
    {"notes": notes_mode, "rough": rough_mode, "ref": ref_mode}[a.mode](a)


if __name__ == "__main__":
    main()
