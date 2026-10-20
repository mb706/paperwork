"""Contact sheet and numbers for the SFX prototypes (out/sfx/*.wav).

    gamedev-python -I design/audio/proto/sfx/sheet.py

Writes out/analysis/sfx-sheet.png: one panel per file (waveform over a log-frequency spectrogram),
labelled with duration, peak, loudness (BS.1770, gated), spectral centroid and the share of energy
in 2-5 kHz (the region that tires the ear when a sound repeats). Prints the same as a table, and
checks every loop for a seam: the jump across the wrap point against the typical sample-to-sample
step inside the loop.
"""

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import scipy.signal as ss
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "out" / "sfx"


def lufs(x, sr):
    b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
    b2, a2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
    y = ss.lfilter(b2, a2, ss.lfilter(b1, a1, x))
    blk = int(0.4 * sr)
    if len(y) < blk:
        y = np.pad(y, (0, blk - len(y)))
    p = np.array([np.mean(y[s:s + blk] ** 2) for s in range(0, len(y) - blk + 1, int(0.1 * sr))])
    p = p[p > 0]
    return -0.691 + 10 * np.log10(p.max()) if len(p) else float("-inf")  # momentary max


def main():
    files = sorted(OUT.glob("*.wav"))
    man = json.loads((OUT / "manifest.json").read_text())
    loops = {k for k, v in man.items() if v["loop"]}
    n = len(files)
    cols = 6
    rows = (n + cols - 1) // cols
    fig, axes = plt.subplots(rows, cols, figsize=(cols * 3.2, rows * 2.6))
    print(f"{'file':24s} {'dur':>5s} {'peak':>6s} {'LUFS-M':>7s} {'K-cent':>8s} {'2-5k':>5s}")
    for ax, f in zip(axes.flat, files):
        x, sr = sf.read(f)
        S = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
        fr = np.fft.rfftfreq(len(x), 1 / sr)
        # centroid of the K-weighted spectrum (closer to what is heard than the raw power centroid)
        b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
        b2, a2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
        xk = ss.lfilter(b2, a2, ss.lfilter(b1, a1, x))
        Sk = np.abs(np.fft.rfft(xk * np.hanning(len(xk)))) ** 2
        cen = (Sk * fr).sum() / Sk.sum()
        pres = S[(fr >= 2000) & (fr < 5000)].sum() / S.sum()
        pk = 20 * np.log10(np.abs(x).max())
        lm = lufs(x, sr)
        print(f"{f.stem:24s} {len(x) / sr:5.2f} {pk:6.1f} {lm:7.1f} {cen:8.0f} {100 * pres:4.1f}%")
        nper = 512 if len(x) > 4096 else 256
        fq, tt, Z = ss.stft(x, sr, nperseg=nper, noverlap=nper * 3 // 4)
        D = 20 * np.log10(np.abs(Z) + 1e-9)
        ax.pcolormesh(tt, fq, D, vmin=D.max() - 70, vmax=D.max(), cmap="magma", shading="auto")
        ax.set_yscale("symlog", linthresh=200)
        ax.set_ylim(40, 16000)
        ax2 = ax.twinx()
        ax2.plot(np.arange(len(x)) / sr, x, color="c", lw=0.3, alpha=0.6)
        ax2.set_ylim(-1, 1)
        ax2.set_yticks([])
        ax.set_title(f"{f.stem}\n{len(x) / sr:.2f}s pk{pk:.0f} M{lm:.0f} c{cen / 1000:.1f}k p{100 * pres:.0f}%", fontsize=7)
        ax.tick_params(labelsize=5)
    for ax in axes.flat[n:]:
        ax.axis("off")
    fig.tight_layout()
    out = ROOT / "out" / "analysis" / "sfx-sheet.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, dpi=75)
    print(f"wrote {out}")
    # loop seams: the jump across the wrap against steps inside the loop
    for name in sorted(loops):
        x, sr = sf.read(OUT / f"{name}.wav")
        d = np.abs(np.diff(x))
        wrap = abs(x[0] - x[-1])
        print(f"loop {name}: wrap step {wrap:.5f} vs median step {np.median(d):.5f}, 99.9th pct {np.percentile(d, 99.9):.5f}"
              f" -> {'seamless' if wrap <= np.percentile(d, 99) else 'CHECK'}")


if __name__ == "__main__":
    main()
