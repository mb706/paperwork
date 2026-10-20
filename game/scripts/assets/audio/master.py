"""Master an offline render into a recording the game streams (10 §9.4: the menu loop, the first piece of every
game, reduced audio's recorded music).

    gamedev-python -I scripts/assets/audio/master.py <render.wav> <name> [--lufs -18] [--tp -1] [--kbps 96]

A4's mastering (`design/audio/proto/analysis/master.py`): BS.1770-4 integrated loudness to the target, a
true-peak limiter (4x oversampled detection, 2 ms lookahead, 120 ms release) iterated until both hold,
a 20 ms fade at the end. The target is the in-game music level at 100 % (A4 §8: a piece measures −18 LUFS
integrated), so a recording and a live piece sound alike; the recording bypasses the music bus's glue
compressor (src/audio/mixer/graph.ts), so it is not compressed twice. The master is published through the
asset build's encoder (Opus and AAC, content-hashed) and recorded in .cache/assets/audio/recordings.json,
which build.py writes into public/audio/music.json.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import scipy.signal as ss
import soundfile as sf
from numba import njit
from scipy.ndimage import minimum_filter1d

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build  # noqa: E402


def k_weight(x: np.ndarray) -> np.ndarray:
    b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
    b2, a2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
    return ss.lfilter(b2, a2, ss.lfilter(b1, a1, x, axis=0), axis=0)


def integrated_lufs(x: np.ndarray) -> float:
    y = k_weight(x)
    blk, hop = 19200, 4800
    p = np.array([np.sum(y[s:s + blk] ** 2) / blk for s in range(0, len(y) - blk, hop)])
    g = p[-0.691 + 10 * np.log10(p + 1e-20) > -70]
    rel = -0.691 + 10 * np.log10(g.mean()) - 10
    g2 = g[-0.691 + 10 * np.log10(g + 1e-20) > rel]
    return float(-0.691 + 10 * np.log10(g2.mean()))


def true_peak_db(x: np.ndarray) -> float:
    return float(20 * np.log10(np.abs(ss.resample_poly(x, 4, 1, axis=0)).max() + 1e-12))


@njit(cache=False)
def _release(g, a):
    out = np.empty_like(g)
    cur = 1.0
    for i in range(len(g)):
        v = g[i]
        cur = v if v < cur else a * cur + (1 - a) * v
        out[i] = cur
    return out


def limit(x: np.ndarray, sr: int, ceiling_db: float, look_ms: float = 2.0, rel_ms: float = 120.0) -> np.ndarray:
    up = ss.resample_poly(x, 4, 1, axis=0)
    peak = np.abs(up).max(axis=1)
    need = np.minimum(1.0, 10 ** (ceiling_db / 20) / np.maximum(peak, 1e-12))
    need = need[: len(need) // 4 * 4].reshape(-1, 4).min(axis=1)
    if len(need) < len(x):
        need = np.pad(need, (0, len(x) - len(need)), constant_values=1.0)
    la = max(1, int(look_ms * 1e-3 * sr))
    g = minimum_filter1d(need, size=2 * la + 1, origin=0)
    out = _release(g, np.exp(-1.0 / (rel_ms * 1e-3 * sr)))
    win = np.hanning(2 * la + 1)
    win /= win.sum()
    out = np.minimum(out, np.convolve(out, win, mode="same"))
    return x * out[:, None]


def master(src: Path, name: str, lufs: float, tp: float, kbps: int) -> dict:
    x, sr = sf.read(src, always_2d=True, dtype="float64")
    if sr != 48000:
        raise SystemExit("render recordings at 48 kHz (the masters' rate)")
    x = x[:, :2]
    env = np.abs(x).max(axis=1)
    last = int(np.nonzero(env > 10 ** (-90 / 20))[0][-1]) if np.any(env > 0) else len(x) - 1
    x = x[: min(len(x), last + int(0.5 * sr))]
    ceiling = tp - 0.3
    y = x * 10 ** ((lufs - integrated_lufs(x)) / 20)
    for _ in range(6):
        y = limit(y, sr, ceiling)
        li, pk = integrated_lufs(y), true_peak_db(y)
        if abs(li - lufs) < 0.15 and pk <= ceiling + 0.05:
            break
        y *= 10 ** ((lufs - li) / 20)
    n = int(0.02 * sr)
    y[-n:] *= np.linspace(1, 0, n)[:, None]
    pad = (-len(y)) % 3
    if pad:
        y = np.concatenate([y, np.zeros((pad, 2))])
    out = build.MASTERS / "music" / f"{name}.wav"
    out.parent.mkdir(parents=True, exist_ok=True)
    sf.write(out, y.astype(np.float32), sr, subtype="FLOAT")
    entry = build.publish(f"music/{name}", out, f"{kbps}k", 2, "CC0-1.0", {})
    rec = {"file": entry["file"], "seconds": round(len(y) / sr, 2), "lufs": round(integrated_lufs(y), 2),
           "bytes": entry["bytes"]}
    path = build.CACHE / "recordings.json"
    recs = json.loads(path.read_text()) if path.exists() else {}
    recs[name] = rec
    path.write_text(json.dumps(recs, indent=1))
    print(f"{name}: {rec['seconds']} s, I {rec['lufs']} LUFS, TP {true_peak_db(y):.2f} dBTP, "
          f"Opus {rec['bytes']['ogg'] / 1024:.0f} KiB, AAC {rec['bytes']['m4a'] / 1024:.0f} KiB")
    return rec


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src", type=Path)
    ap.add_argument("name")
    ap.add_argument("--lufs", type=float, default=-18.0)
    ap.add_argument("--tp", type=float, default=-1.0)
    ap.add_argument("--kbps", type=int, default=96)
    a = ap.parse_args()
    master(a.src, a.name, a.lufs, a.tp, a.kbps)


if __name__ == "__main__":
    main()
