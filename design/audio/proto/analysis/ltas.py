"""Long-term average spectrum against a fitted spectral tilt, per window.

    gamedev-python -I design/audio/proto/analysis/ltas.py <wav> [--win 8]

For each window, fits a line to the 1/3-octave spectrum (dB vs log f) between 100 Hz and 10 kHz and
reports the bands that sit above the line: a 2-5 kHz bump of more than ~3 dB reads as harsh, a
200-500 Hz bump as boxy or muddy. Also prints the tilt (dB/octave); calm acoustic music sits
around -4 to -6 dB/octave above 500 Hz.
"""
import argparse

import numpy as np
import soundfile as sf

ap = argparse.ArgumentParser()
ap.add_argument("wav")
ap.add_argument("--win", type=float, default=8.0)
a = ap.parse_args()
x, sr = sf.read(a.wav, always_2d=True)
m = x.mean(axis=1)
centers = 1000 * 2.0 ** (np.arange(-10, 11) / 3)  # 1/3 octaves 100 Hz .. 10 kHz
n = int(a.win * sr)
print(f"{'t':>5s} {'tilt':>6s}  " + " ".join(f"{c:6.0f}" for c in centers))
allspec = []
for s0 in range(0, len(m) - n, n):
    seg = m[s0:s0 + n] * np.hanning(n)
    P = np.abs(np.fft.rfft(seg)) ** 2
    f = np.fft.rfftfreq(n, 1 / sr)
    band = np.array([P[(f >= c * 2 ** (-1 / 6)) & (f < c * 2 ** (1 / 6))].sum() for c in centers])
    if band.sum() <= 0:
        continue
    db = 10 * np.log10(band / band.max() + 1e-12)
    oc = np.log2(centers / 1000)
    sel = centers >= 500
    k, b0 = np.polyfit(oc[sel], db[sel], 1)
    dev = db - (k * oc + b0)
    allspec.append(band)
    print(f"{s0 / sr:5.0f} {k:6.1f}  " + " ".join(f"{d:+6.1f}" for d in dev))
band = np.sum(allspec, axis=0)
db = 10 * np.log10(band / band.max())
oc = np.log2(centers / 1000)
sel = centers >= 500
k, b0 = np.polyfit(oc[sel], db[sel], 1)
print(f"whole file: tilt above 500 Hz {k:.1f} dB/oct; level per band (dB re max):")
print("  " + " ".join(f"{c:.0f}:{d:.0f}" for c, d in zip(centers, db)))
