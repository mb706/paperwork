"""The Era II harmonic gate, measured on offline renders (codex C7-r1 finding 11), with A4's methods.

    gamedev-python -I scripts/assets/audio/echo_gate.py <before>.wav <after>.wav [more pairs ...]

Each render is a stems render with its notes (render.ts with "stems": true, "log": true). Around each drone
change c (0.44, 0.57 and 0.68 of the piece), per render:
- the echo stem's level in [c, c + 2.8 s] (after the change, before the new section's first repeats),
  against its level while the organ section plays;
- A4's symbolic measure (design/audio/proto/analysis/dissonance.py `notes`): the interval classes of the pairs
  that involve the organ or its echo in [c − 0.3, c + 3], with each version's echo modelled (before: A4's
  gate, feedback only; after: return muted, tape erased);
- A4's acoustic measure (`rough`, Sethares' roughness over measured partials) in [c − 0.3, c + 3], of the
  harmonic layer the gate concerns (the organ, its echo and the drone, from the stems) and of the whole mix.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

GAME = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(GAME.parent / "design" / "audio" / "proto" / "analysis"))
from dissonance import DISS, roughness  # noqa: E402  (A4's measures)

BEAT = 60 / 83
DELAY = 4 * BEAT
FB = 0.36
LEAD, TAU, ERASE = 0.8, 0.15, 0.05  # era2.ts ECHO_GATE_LEAD, ECHO_GATE_TAU, ECHO_ERASE_LEAD
HARSH = (1, 2, 6, 10, 11)


def stems(path: Path) -> tuple[dict[str, np.ndarray], int, dict]:
    x, sr = sf.read(path, always_2d=True, dtype="float64")
    meta = json.loads(path.with_suffix(".notes.json").read_text())
    names = ["mix", *meta["stems"]]
    return {n: x[:, 2 * i:2 * i + 2].mean(axis=1) for i, n in enumerate(names)}, sr, meta


def db(x: np.ndarray) -> float:
    return float(10 * np.log10(np.mean(x ** 2) + 1e-20))


def symbolic(
    notes: list[dict], t0: float, t1: float, gated: bool, changes: list[float], echo_only: bool = False
) -> tuple[float, float]:
    """A4's `notes` measure in [t0, t1]: share of harsh intervals, mean dissonance index (pairs with the organ;
    `echo_only`: pairs with one of its echoes)."""
    voices = []
    for n in notes:
        if n["i"] not in ("organ", "drone", "vibes"):
            continue
        rel = 0.25 if n["i"] == "organ" else 1.2
        voices.append((n["t"], n["t"] + n["d"] + rel, n["m"], n["v"], n["i"] == "organ", False))
        if n["i"] != "organ":
            continue
        k, g = 1, FB
        while g > 10 ** (-30 / 20):
            a, b = n["t"] + k * DELAY, n["t"] + n["d"] + rel + k * DELAY
            w = n["v"] * g
            for c in changes:
                if n["t"] < c <= b:  # the copy reaches past a change it was recorded before
                    if gated:
                        b = min(b, c - ERASE)  # the tape is erased
                        if a < b:  # and the return fades from c − LEAD: weight at its loudest point
                            w *= np.exp(-max(0.0, max(a, c - 0.3) - (c - LEAD)) / TAU) if b > c - 0.3 else 1
                    elif k > 1 and n["t"] + (k - 1) * DELAY >= c - 0.5:
                        b = a  # A4's gate: no feedback from c − 0.5, so no later repeat
            if a < b:
                voices.append((a, b, n["m"], w, True, True))
            k += 1
            g *= FB
    hist = np.zeros(12)
    index = []
    for t in np.arange(t0, t1, 0.1):
        snd = [v for v in voices if v[0] <= t < v[1]]
        di = 0.0
        for i, x in enumerate(snd):
            for y in snd[i + 1:]:
                if not (x[4] or y[4]) or (echo_only and not (x[5] or y[5])):
                    continue
                ic = int(round(abs(x[2] - y[2]))) % 12
                w = np.sqrt(x[3] * y[3])
                hist[ic] += w
                di += w * DISS[ic]
        index.append(di)
    tot = hist.sum()
    return (float(sum(hist[i] for i in HARSH) / tot) if tot else 0.0), float(np.mean(index))


def window_rough(path: Path, t0: float, t1: float) -> float:
    t, r = roughness(str(path), t0, t1)
    return float(r.mean()) if len(r) else 0.0


def absolute_rough(x: np.ndarray, sr: int, t0: float, t1: float) -> float:
    """A4's roughness (Sethares over the 40 strongest partials, 50 Hz–6 kHz, 100 ms frames) without its
    normalisation by the total amplitude: how rough the layer is at its own level. The normalised figure is
    level-free, so taking a loud, smooth component away (the echo) raises it whenever quieter components
    beat (here the drones' crossfade); this one only falls when roughness is taken away."""
    n, hop = 8192, int(0.1 * sr)
    win = np.hanning(n)
    fr = np.fft.rfftfreq(n, 1 / sr)
    band = (fr >= 50) & (fr <= 6000)
    out = []
    for s0 in range(int(t0 * sr), min(len(x) - n, int(t1 * sr)), hop):
        sp = np.abs(np.fft.rfft(x[s0:s0 + n] * win)) * band / (n / 4)
        pk = np.where((sp[1:-1] > sp[:-2]) & (sp[1:-1] >= sp[2:]))[0] + 1
        if len(pk) < 2:
            out.append(0.0)
            continue
        pk = pk[np.argsort(sp[pk])[::-1][:40]]
        f = pk * sr / n
        amp = sp[pk]
        fi, fj = np.meshgrid(f, f)
        ai, aj = np.meshgrid(amp, amp)
        sc = 0.24 / (0.0207 * np.minimum(fi, fj) + 18.96)
        df = np.abs(fi - fj)
        out.append(float(np.triu(ai * aj * (np.exp(-3.51 * sc * df) - np.exp(-5.75 * sc * df)), 1).sum()))
    return float(np.mean(out)) if out else 0.0


def layer(st: dict[str, np.ndarray], sr: int, tmp: Path, name: str) -> Path:
    """The organ, its echo and the drone, as a file for A4's roughness."""
    out = tmp / f"{name}.wav"
    sf.write(out, st["organ"] + st["echo"] + st["drone"], sr, subtype="FLOAT")
    return out


def report(before: Path, after: Path) -> None:
    sb, sr, meta = stems(before)
    sa, _, _ = stems(after)
    d = meta["cfg"]["duration"]
    t_start = 0.05
    changes = [t_start + f * d for f in (0.44, 0.57, 0.68)]
    notes = meta["notes"]
    organ_on = (int((t_start + 0.32 * d) * sr), int((t_start + 0.42 * d) * sr))
    ref_b = db(sb["echo"][organ_on[0]:organ_on[1]])
    print(f"{before.stem} → {after.stem} ({d:.0f} s; changes at " + ", ".join(f"{c:.1f}" for c in changes) + " s)")
    print(f"  echo stem while the organ plays: {ref_b:.1f} dBFS")
    tmp = Path(tempfile.mkdtemp())
    lb, la = layer(sb, sr, tmp, "before"), layer(sa, sr, tmp, "after")
    for c in changes:
        a, b = int(c * sr), int((c + 2.8) * sr)
        eb, ea = db(sb["echo"][a:b]), db(sa["echo"][a:b])
        hb, mb = symbolic(notes, c - 0.3, c + 3, False, changes, echo_only=True)
        ha, ma = symbolic(notes, c - 0.3, c + 3, True, changes, echo_only=True)
        lrb, lra = window_rough(lb, c - 0.3, c + 3), window_rough(la, c - 0.3, c + 3)
        rb, ra = window_rough(before, c - 0.3, c + 3), window_rough(after, c - 0.3, c + 3)
        lay_b = sb["organ"] + sb["echo"] + sb["drone"]
        lay_a = sa["organ"] + sa["echo"] + sa["drone"]
        ab, aa = absolute_rough(lay_b, sr, c - 0.3, c + 3), absolute_rough(lay_a, sr, c - 0.3, c + 3)
        print(f"  change {c:6.1f} s: echo after it {eb - ref_b:+6.1f} → {ea - ref_b:+6.1f} dB re the section; "
              f"echo pairs: harsh {100 * hb:4.1f} → {100 * ha:4.1f} %, index {mb:.3f} → {ma:.3f}; "
              f"roughness organ+echo+drone {lrb:.4f} → {lra:.4f} (absolute {ab:.2e} → {aa:.2e}, "
              f"{10 * np.log10((aa + 1e-30) / (ab + 1e-30)):+.1f} dB), mix {rb:.4f} → {ra:.4f}")
    o0, o1 = t_start + 0.3 * d, t_start + 0.69 * d
    hb, mb = symbolic(notes, o0, o1, False, changes)
    ha, ma = symbolic(notes, o0, o1, True, changes)
    rb, ra = window_rough(before, o0, o1), window_rough(after, o0, o1)
    print(f"  the whole organ section: harsh intervals {100 * hb:.1f} → {100 * ha:.1f} %, index {mb:.3f} → {ma:.3f}; "
          f"roughness {rb:.4f} → {ra:.4f}")


def main() -> None:
    args = [Path(a) for a in sys.argv[1:]]
    for before, after in zip(args[::2], args[1::2]):
        report(before, after)


if __name__ == "__main__":
    main()
