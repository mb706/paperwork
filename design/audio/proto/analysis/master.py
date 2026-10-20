"""Master a render: integrated loudness to a target, true peak under a ceiling, then encode.

    gamedev-python -I design/audio/proto/analysis/master.py <in.wav> <name> [--lufs -16] [--tp -1.0] [--kbps 128]

1. BS.1770-4 integrated loudness (K-weighting, 400 ms blocks, absolute and relative gates).
2. Static gain to the target.
3. A true-peak limiter: 4x oversampled peak detection, 2 ms lookahead (sliding minimum of the
   required gain, so attacks are never late), 120 ms release. Iterated until the target and the
   ceiling hold together (limiting lowers loudness a little).
4. Writes out/masters/<name>.wav (24-bit) and demos/<name>.opus (libopus), then decodes the Opus
   and re-measures it, because lossy coding can raise true peak; if it does, the ceiling is lowered
   and the file re-encoded.
"""

from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path

import numpy as np
import scipy.signal as ss
import soundfile as sf
from numba import njit

ROOT = Path(__file__).resolve().parents[2]  # design/audio
FFMPEG = str(Path.home() / ".local/bin/ffmpeg")


def k_weight(x: np.ndarray, sr: int) -> np.ndarray:
    if sr != 48000:
        raise ValueError("48 kHz only")
    b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
    b2, a2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
    return ss.lfilter(b2, a2, ss.lfilter(b1, a1, x, axis=0), axis=0)


def integrated_lufs(x: np.ndarray, sr: int) -> float:
    y = k_weight(x, sr)
    blk, hop = int(0.4 * sr), int(0.1 * sr)
    p = np.array([np.sum(y[s:s + blk] ** 2) / blk for s in range(0, len(y) - blk, hop)])
    lk = -0.691 + 10 * np.log10(p + 1e-20)
    g = p[lk > -70]
    rel = -0.691 + 10 * np.log10(g.mean()) - 10
    g2 = g[-0.691 + 10 * np.log10(g + 1e-20) > rel]
    return float(-0.691 + 10 * np.log10(g2.mean()))


def true_peak_db(x: np.ndarray) -> float:
    up = ss.resample_poly(x, 4, 1, axis=0)
    return float(20 * np.log10(np.abs(up).max() + 1e-12))


def limit(x: np.ndarray, sr: int, ceiling_db: float, look_ms: float = 2.0, rel_ms: float = 120.0) -> np.ndarray:
    os_ = 4
    up = ss.resample_poly(x, os_, 1, axis=0)
    peak = np.abs(up).max(axis=1)
    c = 10 ** (ceiling_db / 20)
    need = np.minimum(1.0, c / np.maximum(peak, 1e-12))  # required gain per oversampled sample
    # back to the base rate: the strictest requirement within each base sample
    need = need[: len(need) // os_ * os_].reshape(-1, os_).min(axis=1)
    if len(need) < len(x):
        need = np.pad(need, (0, len(x) - len(need)), constant_values=1.0)
    la = max(1, int(look_ms * 1e-3 * sr))
    # sliding minimum over the lookahead window (attack is never late)
    from scipy.ndimage import minimum_filter1d
    g = minimum_filter1d(need, size=2 * la + 1, origin=0)
    # release: one-pole smoothing upward only
    out = _release(g, np.exp(-1.0 / (rel_ms * 1e-3 * sr)))
    # a short attack smoothing (raised cosine over the lookahead) so gain changes are not steps
    win = np.hanning(2 * la + 1)
    win /= win.sum()
    out = np.minimum(out, np.convolve(out, win, mode="same"))
    return x * out[:, None]


@njit(cache=False)
def _release(g, a):
    out = np.empty_like(g)
    cur = 1.0
    for i in range(len(g)):
        v = g[i]
        cur = v if v < cur else a * cur + (1 - a) * v
        out[i] = cur
    return out


def ffmeasure(path: Path) -> tuple[float, float]:
    r = subprocess.run([FFMPEG, "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True)
    i = float(re.search(r"Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS", r.stderr).group(1))
    tp = float(re.search(r"True peak:\s+Peak:\s+(-?[\d.inf]+) dBFS", r.stderr).group(1))
    return i, tp


def master(src: Path, name: str, lufs: float, tp: float, kbps: int, fade_in: float = 0.0) -> None:
    x, sr = sf.read(src, always_2d=True, dtype="float64")
    # trim trailing digital silence beyond 0.5 s, keep a short tail
    env = np.abs(x).max(axis=1)
    last = int(np.nonzero(env > 10 ** (-90 / 20))[0][-1]) if np.any(env > 0) else len(x) - 1
    x = x[: min(len(x), last + int(0.5 * sr))]
    ceiling = tp - 0.3
    y = x
    for it in range(6):
        gain = lufs - integrated_lufs(y if it else x, sr) if it == 0 else lufs - integrated_lufs(y, sr)
        y = limit((x if it == 0 else y) * 10 ** (gain / 20), sr, ceiling)
        li, pk = integrated_lufs(y, sr), true_peak_db(y)
        if abs(li - lufs) < 0.15 and pk <= ceiling + 0.05:
            break
    # final fade of the last 20 ms (no click at the end)
    n = int(0.02 * sr)
    y[-n:] *= np.linspace(1, 0, n)[:, None]
    out_wav = ROOT / "out" / "masters" / f"{name}.wav"
    out_wav.parent.mkdir(parents=True, exist_ok=True)
    sf.write(out_wav, y, sr, subtype="PCM_24")
    demos = ROOT / "demos"
    demos.mkdir(exist_ok=True)
    for attempt in range(4):
        opus = demos / f"{name}.opus"
        subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(out_wav), "-c:a", "libopus", "-b:a", f"{kbps}k",
                        "-vbr", "on", "-application", "audio", "-metadata", f"title={name}", str(opus)], check=True)
        oi, otp = ffmeasure(opus)
        if otp <= tp:
            break
        # lossy coding raised the peak: lower the ceiling and redo the limiter
        ceiling -= (otp - tp) + 0.1
        y = limit(y, sr, ceiling)
        sf.write(out_wav, y, sr, subtype="PCM_24")
    wi, wtp = ffmeasure(out_wav)
    # how hard did the limiter work? (gain reduction relative to the static gain)
    gr = 20 * np.log10(np.maximum(np.abs(y).max(axis=1), 1e-9) / np.maximum(np.abs(x * 10 ** ((lufs - integrated_lufs(x, sr)) / 20)).max(axis=1), 1e-9))[: -int(0.05 * sr)]
    loud = (np.abs(x).max(axis=1) > 10 ** (-60 / 20))[: -int(0.05 * sr)]
    print(f"  limiter: max GR {-gr[loud].min():.1f} dB, time with GR > 1 dB: {100 * np.mean(gr[loud] < -1):.2f}%")
    print(f"{name}: WAV I {wi:.1f} LUFS TP {wtp:.1f} dBTP | Opus {kbps}k I {oi:.1f} LUFS TP {otp:.1f} dBTP | "
          f"{len(y) / sr:.1f} s, {opus.stat().st_size / 1024:.0f} KiB")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src", type=Path)
    ap.add_argument("name")
    ap.add_argument("--lufs", type=float, default=-16.0)
    ap.add_argument("--tp", type=float, default=-1.0)
    ap.add_argument("--kbps", type=int, default=128)
    a = ap.parse_args()
    master(a.src, a.name, a.lufs, a.tp, a.kbps)


if __name__ == "__main__":
    main()
