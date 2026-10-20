"""Judge the engine's renders without ears (A4 §13; 10 §9.4): numbers and pictures, against a reference.

    gamedev-python -I scripts/assets/audio/analyze.py compare <render.wav> <reference.wav> [--png out.png] [--name N]
    gamedev-python -I scripts/assets/audio/analyze.py stems <render.wav> <render.notes.json> [--ref ref.notes.json]
    gamedev-python -I scripts/assets/audio/analyze.py loudness <file> [...]

compare: integrated loudness (BS.1770-4, gated), loudness range, true peak (4x oversampled), clipped and
  denormal samples, the long-term spectrum's tilt above 500 Hz and its 1/3-octave difference against the
  reference, band shares, and the correlation of the short-term loudness curves (structure); a PNG with
  both spectrograms (log frequency), the 1/3-octave spectra and the loudness curves.
stems: each stem's integrated loudness relative to the mix (A4's balance check), optionally against a
  reference render's stems (A4's notes.json `stemLoudness`).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import scipy.signal as ss
import soundfile as sf
import soxr


def load(path: Path) -> tuple[np.ndarray, int]:
    if path.suffix in (".opus", ".ogg", ".m4a"):
        import subprocess
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            wav = Path(d) / "x.wav"
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(path), "-c:a", "pcm_f32le", str(wav)],
                           check=True)
            x, sr = sf.read(wav, always_2d=True, dtype="float64")
    else:
        x, sr = sf.read(path, always_2d=True, dtype="float64")
    return x, sr


def to48(x: np.ndarray, sr: int) -> np.ndarray:
    return x if sr == 48000 else soxr.resample(x, sr, 48000, quality="VHQ")


def k_weight(x: np.ndarray) -> np.ndarray:
    b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
    b2, a2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
    return ss.lfilter(b2, a2, ss.lfilter(b1, a1, x, axis=0), axis=0)


def block_power(y: np.ndarray, blk: int, hop: int) -> np.ndarray:
    e = np.sum(y ** 2, axis=1)
    c = np.concatenate([[0.0], np.cumsum(e)])
    starts = np.arange(0, len(y) - blk + 1, hop)
    return (c[starts + blk] - c[starts]) / blk


def integrated(x48: np.ndarray) -> float:
    y = k_weight(x48[:, :2])
    p = block_power(y, 19200, 4800)
    lk = -0.691 + 10 * np.log10(p + 1e-30)
    g = p[lk > -70]
    if not len(g):
        return float("-inf")
    rel = -0.691 + 10 * np.log10(g.mean()) - 10
    g2 = g[-0.691 + 10 * np.log10(g) > rel]
    return float(-0.691 + 10 * np.log10(g2.mean()))


def short_term(x48: np.ndarray) -> np.ndarray:
    """Short-term loudness (3 s windows) every 0.5 s."""
    y = k_weight(x48[:, :2])
    p = block_power(y, 144000, 24000)
    return -0.691 + 10 * np.log10(p + 1e-30)


def lra(st: np.ndarray) -> float:
    g = st[st > -70]
    if not len(g):
        return 0.0
    rel = -0.691 + 10 * np.log10(np.mean(10 ** ((g + 0.691) / 10))) - 20
    g = g[g > rel]
    return float(np.percentile(g, 95) - np.percentile(g, 10)) if len(g) else 0.0


def true_peak(x48: np.ndarray) -> float:
    up = ss.resample_poly(x48[:, :2], 4, 1, axis=0)
    return float(20 * np.log10(np.abs(up).max() + 1e-12))


CENTERS = 1000 * 2.0 ** (np.arange(-14, 13) / 3)  # 1/3 octaves, 40 Hz .. 16 kHz


def third_octaves(x: np.ndarray, sr: int) -> np.ndarray:
    m = x[:, :2].mean(axis=1)
    f, p = ss.welch(m, sr, nperseg=16384)
    out = []
    for c in CENTERS:
        sel = (f >= c * 2 ** (-1 / 6)) & (f < c * 2 ** (1 / 6))
        out.append(p[sel].sum() if sel.any() else np.nan)
    return 10 * np.log10(np.array(out) + 1e-30)


def tilt(db: np.ndarray) -> float:
    sel = (CENTERS >= 500) & (CENTERS <= 10000) & np.isfinite(db)
    k, _ = np.polyfit(np.log2(CENTERS[sel] / 1000), db[sel], 1)
    return float(k)


BANDS = [("sub", 20, 60), ("bass", 60, 250), ("lowmid", 250, 500), ("mid", 500, 2000), ("presence", 2000, 5000), ("air", 5000, 16000)]


def band_shares(x: np.ndarray, sr: int) -> dict[str, float]:
    m = x[:, :2].mean(axis=1)
    f, p = ss.welch(m, sr, nperseg=8192)
    tot = p[(f >= 20) & (f < 16000)].sum()
    return {n: float(p[(f >= lo) & (f < hi)].sum() / tot) for n, lo, hi in BANDS}


def describe(path: Path) -> dict:
    x, sr = load(path)
    x48 = to48(x, sr)
    st = short_term(x48)
    flat = x[:, :2].ravel()
    nz = flat[flat != 0]
    return {
        "file": path.name,
        "sr": sr,
        "seconds": round(len(x) / sr, 2),
        "I": round(integrated(x48), 2),
        "LRA": round(lra(st), 1),
        "TP": round(true_peak(x48), 2),
        "samplePeak": round(float(20 * np.log10(np.abs(flat).max() + 1e-12)), 2),
        "clipped": int(np.sum(np.abs(flat) >= 1.0)),
        "denormals": int(np.sum(np.abs(nz) < np.finfo(np.float32).tiny)),
        "nonFinite": int(np.sum(~np.isfinite(flat))),
        "tilt": round(tilt(third_octaves(x, sr)), 2),
        "bands": {k: round(v, 4) for k, v in band_shares(x, sr).items()},
        "_st": st,
        "_x": x,
    }


def compare(a: Path, b: Path, png: Path | None, name: str) -> None:
    A, B = describe(a), describe(b)
    for d in (A, B):
        print(f"{d['file']:40s} {d['sr']} Hz {d['seconds']:7.2f} s  I {d['I']:7.2f} LUFS  LRA {d['LRA']:4.1f} LU  "
              f"TP {d['TP']:6.2f} dBTP  clipped {d['clipped']}  denormals {d['denormals']}  non-finite {d['nonFinite']}  "
              f"tilt {d['tilt']:+.2f} dB/oct")
        print("    bands " + "  ".join(f"{k} {100 * v:5.2f}%" for k, v in d["bands"].items()))
    ta = third_octaves(A["_x"], A["sr"])
    tb = third_octaves(B["_x"], B["sr"])
    # spectra normalised to the same total, so the difference is the shape
    da = ta - 10 * np.log10(np.nansum(10 ** (ta / 10)))
    db = tb - 10 * np.log10(np.nansum(10 ** (tb / 10)))
    diff = da - db
    lim = CENTERS <= 12000
    print("    1/3-octave shape difference (render − reference, dB):")
    print("      " + " ".join(f"{c:.0f}:{d:+.1f}" for c, d in zip(CENTERS[lim], diff[lim])))
    sel = (CENTERS >= 63) & (CENTERS <= 8000)
    print(f"    max |difference| 63 Hz–8 kHz {np.nanmax(np.abs(diff[sel])):.1f} dB; rms {np.sqrt(np.nanmean(diff[sel] ** 2)):.1f} dB")
    n = min(len(A["_st"]), len(B["_st"]))
    sa, sb = A["_st"][:n], B["_st"][:n]
    ok = (sa > -70) & (sb > -70)
    r = float(np.corrcoef(sa[ok], sb[ok])[0, 1]) if ok.sum() > 3 else float("nan")
    off = float(np.median(sa[ok] - sb[ok])) if ok.any() else float("nan")
    print(f"    short-term loudness: correlation {r:.3f}, median offset {off:+.2f} LU, rms deviation after offset "
          f"{np.sqrt(np.mean((sa[ok] - sb[ok] - off) ** 2)):.2f} LU")
    if png:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        fig, ax = plt.subplots(4, 1, figsize=(12, 13), gridspec_kw={"height_ratios": [3, 3, 2, 2]})
        for i, (d, lbl) in enumerate(((A, f"engine: {a.name}"), (B, f"reference: {b.name}"))):
            m = d["_x"][:, :2].mean(axis=1)
            f, t, S = ss.spectrogram(m, d["sr"], nperseg=4096, noverlap=3072)
            S = 10 * np.log10(S + 1e-14)
            vmax = np.percentile(S, 99.5)
            ax[i].pcolormesh(t, f, S, shading="auto", vmin=vmax - 80, vmax=vmax, cmap="magma")
            ax[i].set_yscale("log")
            ax[i].set_ylim(40, min(16000, d["sr"] / 2))
            ax[i].set_title(lbl)
            ax[i].set_ylabel("Hz")
        ax[2].semilogx(CENTERS, da, label="engine")
        ax[2].semilogx(CENTERS, db, label="reference")
        ax[2].set_title("long-term 1/3-octave spectrum (normalised)")
        ax[2].legend()
        ax[2].grid(True, alpha=0.3)
        tt = np.arange(n) * 0.5
        ax[3].plot(tt, sa, label="engine")
        ax[3].plot(tt, sb, label="reference")
        ax[3].set_title("short-term loudness (LUFS)")
        ax[3].set_ylim(-60, max(-5, float(np.max(np.concatenate([sa, sb]))) + 3))
        ax[3].legend()
        fig.suptitle(name)
        fig.tight_layout()
        fig.savefig(png, dpi=80)
        print(f"    picture: {png}")


def stems(render: Path, notes: Path, ref: Path | None) -> None:
    x, sr = load(render)
    x48 = to48(x, sr)
    meta = json.loads(notes.read_text())
    names = ["mix", *meta["stems"]]
    mix = integrated(x48[:, 0:2])
    refl = None
    if ref:
        sl = json.loads(ref.read_text()).get("stemLoudness") or {}
        if sl:
            rmix = sl["mix"]["I"]
            refl = {k.split(":")[0]: v["I"] - rmix for k, v in sl.items()}
    print(f"{render.name}: mix {mix:.2f} LUFS")
    for i, n in enumerate(names):
        I = integrated(x48[:, 2 * i:2 * i + 2])
        rel = I - mix
        r = f"   ref {refl[n]:+6.1f}  Δ {rel - refl[n]:+5.1f}" if refl and n in refl else ""
        print(f"  {n:10s} I {I:7.2f}  rel {rel:+6.1f} LU{r}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["compare", "stems", "loudness"])
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("--png", type=Path)
    ap.add_argument("--ref", type=Path)
    ap.add_argument("--name", default="")
    a = ap.parse_args()
    if a.mode == "compare":
        compare(a.files[0], a.files[1], a.png, a.name)
    elif a.mode == "stems":
        stems(a.files[0], a.files[1], a.ref)
    else:
        for f in a.files:
            d = describe(f)
            print(f"{f.name}: I {d['I']:.2f} LUFS, LRA {d['LRA']:.1f} LU, TP {d['TP']:.2f} dBTP, clipped {d['clipped']}, "
                  f"denormals {d['denormals']}, tilt {d['tilt']:+.2f} dB/oct")


if __name__ == "__main__":
    main()
