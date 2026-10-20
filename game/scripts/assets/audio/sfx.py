"""The sound effects: A4's prototypes (design/audio/proto/sfx/sfx.py), synthesised for the game's asset build.

The sound designs below are A4's, copied verbatim (DIRECTION §7: the palette of physical information
handling; soft attacks, energy at 300 Hz-2 kHz, nothing above ~7 kHz that repeats, 3-4 variants, loops
built circularly). What differs is the plumbing: sources come from the build's verified sample cache,
masters are 48 kHz float WAVs in the build cache, and a loop's master carries 100 ms margins of its own
circular continuation on both sides, so the loop points (never the file boundary, 10 §9.4) sit inside the
file and neither a decoder's edges nor a resampler's can touch the seam.

Sources: synthesis (damped modes, shaped noise, pitch-dropping thumps) and CC0 percussion from VCSL
(woodblock, ratchet, claves, brake drum, vibraphone, glockenspiel).
"""

from __future__ import annotations

import json
import zlib
from pathlib import Path

import numpy as np
import scipy.signal as ss
import soundfile as sf
import soxr

GAME = Path(__file__).resolve().parents[3]
RAW = GAME / ".cache" / "assets" / "audio" / "raw" / "VCSL"
SR = 48000
PERC = RAW / "Idiophones" / "Struck Idiophones"
LOOP_MARGIN = 0.1
# the raw files a generator read (VCSL paths), collected per variant for the licence record
USED: list[str] = []


# ---------------------------------------------------------------- primitives

def secs(n: float) -> int:
    return int(round(n * SR))


def sos(kind: str, f, order: int = 2):
    return ss.butter(order, np.array(f) / (SR / 2), btype=kind, output="sos")


def filt(x, kind, f, order=2):
    return ss.sosfilt(sos(kind, f, order), x)


def env_exp(n: int, tau: float, attack: float = 0.0005) -> np.ndarray:
    t = np.arange(n) / SR
    a = 1 - np.exp(-t / max(attack, 1e-5))
    return a * np.exp(-t / tau)


def modal(dur: float, modes, rng, detune: float = 0.0) -> np.ndarray:
    """Sum of exponentially damped sinusoids: [(freq Hz, tau s, amp), ...]."""
    n = secs(dur)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for f, tau, a in modes:
        ff = f * (1 + detune * rng.uniform(-1, 1))
        y += a * np.sin(2 * np.pi * ff * t + rng.uniform(0, 2 * np.pi)) * np.exp(-t / tau)
    return y * (1 - np.exp(-t / 0.0004))


def thump(dur: float, f0: float, f1: float, tau: float) -> np.ndarray:
    """A body thump: a sine gliding down from f0 to f1, decaying with tau."""
    n = secs(dur)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t / (tau * 0.6))
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t / tau) * (1 - np.exp(-t / 0.0015))


def noise(n: int, rng) -> np.ndarray:
    return rng.standard_normal(n)


def grains(dur: float, count: int, band, glen, rng, decay: float = 0.08) -> np.ndarray:
    """Granular crunch (gravel, grass, paper): short band-passed noise grains, decaying density."""
    n = secs(dur)
    y = np.zeros(n)
    for _ in range(count):
        t0 = rng.exponential(decay)
        if t0 >= dur:
            continue
        g = secs(rng.uniform(*glen))
        s = secs(t0)
        if s + g >= n:
            continue
        w = np.hanning(g) * noise(g, rng)
        y[s:s + g] += w * rng.uniform(0.3, 1.0) * np.exp(-t0 / decay)
    return filt(y, "bandpass", band)


def load(rel: str, mono: bool = True) -> np.ndarray:
    USED.append(str((PERC / rel).relative_to(RAW.parent)))
    x, sr = sf.read(PERC / rel, always_2d=True, dtype="float64")
    if sr != SR:
        x = soxr.resample(x, sr, SR, quality="VHQ")
    x = x.mean(axis=1) if mono else x
    env = np.abs(x)
    on = max(0, int(np.argmax(env > env.max() * 0.02)) - secs(0.001))
    return x[on:]


def load_inst(rel: str) -> np.ndarray:
    USED.append(str((RAW / rel).relative_to(RAW.parent)))
    x, sr = sf.read(RAW / rel, always_2d=True, dtype="float64")
    if sr != SR:
        x = soxr.resample(x, sr, SR, quality="VHQ")
    x = x.mean(axis=1)
    env = np.abs(x)
    on = max(0, int(np.argmax(env > env.max() * 0.02)) - secs(0.001))
    return x[on:]


def pitch(x: np.ndarray, semis: float) -> np.ndarray:
    """Resample to transpose (shorter and higher, or longer and lower), like tape."""
    r = 2 ** (semis / 12)
    return soxr.resample(x, SR * r, SR, quality="VHQ") if abs(semis) > 1e-6 else x


def fit(x: np.ndarray, dur: float, fade: float = 0.01) -> np.ndarray:
    n = secs(dur)
    y = np.zeros(n)
    m = min(n, len(x))
    y[:m] = x[:m]
    f = min(secs(fade), m)
    y[m - f:m] *= np.linspace(1, 0, f)
    return y


def mix(n: int, *parts) -> np.ndarray:
    """parts: (signal, start seconds, gain dB)."""
    y = np.zeros(n)
    for x, t, db in parts:
        s = secs(t)
        m = min(len(x), n - s)
        if m > 0:
            y[s:s + m] += x[:m] * 10 ** (db / 20)
    return y


def room(x: np.ndarray, rng, t60: float = 0.35, wet: float = 0.18) -> np.ndarray:
    """A small room: exponentially decaying noise IR (no early-reflection pattern), mixed in."""
    n = secs(t60 * 1.2)
    t = np.arange(n) / SR
    ir = noise(n, rng) * np.exp(-6.9 * t / t60)
    ir = filt(ir, "lowpass", 5000)
    ir /= np.sqrt(np.sum(ir ** 2))
    w = ss.fftconvolve(x, ir)[: len(x) + n // 2]
    y = np.concatenate([x, np.zeros(len(w) - len(x))])
    return y + wet * w


def circ_filt(y: np.ndarray, kind, f, order=2) -> np.ndarray:
    """Filter a loop in its steady state (three periods, keep the middle): the seam stays continuous."""
    n = len(y)
    return filt(np.tile(y, 3), kind, f, order)[n:2 * n]


def circular(events, L: float, rng) -> np.ndarray:
    """Place events [(signal, t)] on a loop of length L, wrapping tails around: a seamless loop."""
    n = secs(L)
    y = np.zeros(n)
    for x, t in events:
        s = secs(t) % n
        for i in range(0, len(x), n):
            seg = x[i:i + n]
            idx = (s + i + np.arange(len(seg))) % n
            np.add.at(y, idx, seg)
    return y


def circular_noise(L: float, rng, band, xf: float = 0.4) -> np.ndarray:
    """Band-limited noise of length L whose end flows into its start (equal-power crossfade)."""
    n, k = secs(L), secs(xf)
    x = noise(n + k, rng)
    x = filt(np.concatenate([x[-secs(0.5):], x]), "bandpass", band, 2)[secs(0.5):]
    head, tail = x[:k], x[n:n + k]
    a = np.sin(np.linspace(0, np.pi / 2, k)) ** 2
    y = x[:n].copy()
    y[:k] = head * np.sqrt(a) + tail * np.sqrt(1 - a)
    return y


# ---------------------------------------------------------------- the sounds

def ui_click(rng, v):
    """A soft card-stock or bakelite key: a short woodblock tock, darkened, with a faint high tick."""
    wb = load(f"Woodblock/wood_click_pp_rr{1 + v % 3}.wav")
    wb = pitch(wb, rng.uniform(-2.0, -1.0))
    wb = filt(filt(fit(wb, 0.06, 0.03), "lowpass", 3800), "highpass", 350)
    tick = modal(0.03, [(2400 * rng.uniform(0.96, 1.04), 0.004, 0.5), (3900, 0.003, 0.2)], rng)
    body = thump(0.04, 340, 260, 0.008)
    return mix(secs(0.07), (wb, 0, 0), (tick, 0.0005, -18), (body, 0, -20))


def ui_hover(rng, v):
    """Barely there: a dry brush of paper."""
    n = secs(0.03)
    x = filt(noise(n, rng), "bandpass", [900, 2600]) * env_exp(n, 0.006, 0.001)
    return 0.6 * x + 0.5 * modal(0.03, [(1450 * rng.uniform(0.97, 1.03), 0.005, 1)], rng)


def _build(rng, v, size):
    p = {"small": (0.3, 300, 190, 0.03, "Claves/Claves1_Hit_v1_rr1_Mid.wav", -4, 2),
         "medium": (0.45, 240, 140, 0.04, "Brake Drum/BrakeDrum1_Hammer_v1_rr1_Mid.wav", -7, 0),
         "large": (0.65, 190, 105, 0.055, "Brake Drum/BrakeDrum2_Hammer1_v1_rr1_Mid.wav", -10, 0)}[size]
    dur, f0, f1, tau, contact, csemi, cdb = p
    n = secs(dur)
    body = thump(dur, f0 * rng.uniform(0.95, 1.05), f1, tau)
    c = pitch(load(contact), csemi + rng.uniform(-0.7, 0.7))
    c = filt(fit(c, dur * 0.8, 0.08) * env_exp(secs(dur * 0.8), 0.06 if size != "small" else 0.03), "lowpass", 4200)
    settle = grains(0.25, 18, [700, 2500], (0.002, 0.006), rng, decay=0.05)
    parts = [(body, 0, -9), (c, 0.002, cdb), (settle, 0.01, -14)]
    if size != "small":
        latch = filt(fit(load("Ratchet/Ratchet1_Crank_rr1_Mid.wav"), 0.05, 0.02), "lowpass", 3500)
        parts.append((latch, dur * 0.42 + rng.uniform(0, 0.03), -14))
    return room(mix(n, *parts), rng, 0.3, 0.12)[: n + secs(0.15)]


def build_small(rng, v):
    return _build(rng, v, "small")


def build_medium(rng, v):
    return _build(rng, v, "medium")


def build_large(rng, v):
    return _build(rng, v, "large")


def deconstruct(rng, v):
    """Unbolting (a ratchet turned back), then the lift."""
    r = load("Ratchet/Ratchet1_Slow_rr1_Mid.wav")
    s = secs(rng.uniform(0.2, 0.5))
    r = filt(fit(r[s:], 0.32, 0.06), "bandpass", [250, 3200]) * np.linspace(1, 0.6, secs(0.32))
    n = secs(0.3)
    sweep = noise(n, rng)
    sweep = ss.sosfilt(sos("bandpass", [400, 1400]), sweep) * np.hanning(n) ** 1.5
    pick = filt(fit(load("Claves/Claves2_Hit_v1_rr1_Mid.wav"), 0.04, 0.02), "lowpass", 3000)
    return room(mix(secs(0.75), (r, 0, -2), (sweep, 0.3, -14), (pick, 0.6, -10)), rng, 0.3, 0.1)


def mine_ore(rng, v):
    """A pick on stone: a short stony knock, a little crumble, a low thud."""
    base = rng.uniform(560, 760)
    knock = modal(0.12, [(base, 0.03, 1), (base * 1.83, 0.018, 0.6), (base * 2.95, 0.012, 0.35), (base * 4.1, 0.008, 0.2)], rng, 0.02)
    crumble = grains(0.22, 40, [1200, 4000], (0.0015, 0.004), rng, decay=0.06)
    thud = thump(0.15, 110, 70, 0.03)
    y = mix(secs(0.3), (knock, 0, -2), (crumble, 0.006, -12), (thud, 0, -6))
    return room(filt(y, "lowpass", 6500), rng, 0.25, 0.1)


def inserter_swing(rng, v):
    """An electromechanical arm: a short servo whir up and down, a soft grab at the end."""
    dur = rng.uniform(0.36, 0.42)
    n = secs(dur)
    t = np.arange(n) / SR
    prof = np.sin(np.pi * t / dur) ** 0.8  # speed profile of the swing
    f = 95 + 75 * prof
    ph = 2 * np.pi * np.cumsum(f) / SR
    saw = sum(np.sin(k * ph) / k for k in range(1, 9))
    whir = filt(saw, "bandpass", [300, 1300]) * prof
    gear = filt(noise(n, rng), "bandpass", [600, 2000]) * prof * (0.6 + 0.4 * np.sin(2 * np.pi * 37 * t))
    grab = filt(fit(load("Claves/Claves1_Hit_v1_rr1_Mid.wav"), 0.03, 0.015), "lowpass", 2500)
    y = mix(secs(dur + 0.08), (whir, 0, -3), (gear, 0, -20), (grab, dur - 0.01, -9))
    return filt(y, "highpass", 90)


def keypunch_loop(rng, v):
    """An IBM 026-style keypunch working: card feed, a burst of punches, eject; motor under it all.
    Built circularly over 4 s, so the loop seam is continuous."""
    L = 4.0
    ev = []
    # card feed: a low 'shhk-chunk'
    feed = mix(secs(0.25), (filt(noise(secs(0.12), rng), "bandpass", [500, 1800]) * env_exp(secs(0.12), 0.03, 0.01), 0, -6),
               (thump(0.12, 150, 90, 0.025), 0.09, -9), (filt(fit(load("Woodblock/wood_click_mp.wav"), 0.04, 0.02), "lowpass", 2500), 0.095, -14))
    ev.append((feed, 0.05))
    # punches: about 13 strokes per second for 1.6 s, a pause, then 0.8 s more (two fields of a card)
    def stroke():
        # a punch: a short, darkened click on a small body thump (softened: it repeats for hours)
        k = filt(noise(secs(0.014), rng), "bandpass", [1200, 2400]) * env_exp(secs(0.014), 0.003, 0.0008)
        b = thump(0.03, 320, 240, 0.007)
        return mix(secs(0.035), (k, 0, -10), (b, 0, -9))
    t = 0.45
    for seg_len in (1.6, 0.8):
        end = t + seg_len
        while t < end:
            ev.append((stroke() * rng.uniform(0.75, 1.0), t + rng.normal(0, 0.003)))
            t += 1 / 13.0
        t += 0.35
    # eject and stack: a flap of card stock
    flap = filt(noise(secs(0.08), rng), "bandpass", [700, 2600]) * env_exp(secs(0.08), 0.015, 0.004)
    ev.append((mix(secs(0.12), (flap, 0, -8), (thump(0.06, 200, 140, 0.012), 0.01, -14)), 3.55))
    y = circular(ev, L, rng)
    # motor: 60 Hz family (240 whole cycles in 4 s) and a soft whir
    tt = np.arange(secs(L)) / SR
    hum = 0.5 * np.sin(2 * np.pi * 60 * tt) + 0.3 * np.sin(2 * np.pi * 120 * tt + 0.5) + 0.12 * np.sin(2 * np.pi * 180 * tt + 1.1)
    whir = circular_noise(L, rng, [180, 700])
    y = y + 0.05 * hum + 0.035 * whir / np.std(whir)
    return circ_filt(y, "lowpass", 5500)


def belt_loop(rng, v):
    """A belt on rollers: a soft rumble and steady, uneven roller ticks. 2.4 s, circular."""
    L = 2.4
    ev = []
    for i in range(int(15 * L)):  # 15 ticks per second, 36 in the loop
        k = modal(0.03, [(rng.uniform(820, 1000), 0.006, 1), (rng.uniform(1900, 2300), 0.003, 0.3)], rng)
        ev.append((k * rng.uniform(0.25, 1.0), i / 15 + rng.normal(0, 0.004)))
    y = circular(ev, L, rng)
    rumble = circular_noise(L, rng, [55, 260])
    y = 0.4 * y / np.abs(y).max() + 0.6 * rumble / np.abs(rumble).max()
    return circ_filt(y, "lowpass", 5000)


def research_complete(rng, v):
    """The motif's first interval (A4 to D5, the opening of the 1945 piece) on vibraphone, a glockenspiel
    above. The alert uses the same two notes falling."""
    vib = load_inst("Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_A4_v2_rr1_Main.wav")
    a4 = fit(vib, 2.6, 1.2)
    d5 = fit(pitch(vib, 5), 2.6, 1.2)
    gl = load_inst("Idiophones/Struck Idiophones/Glockenspiel/glock_soft_C6_01.wav")
    d6 = fit(pitch(gl, 2), 2.2, 1.0)
    y = mix(secs(2.8), (a4, 0, -1), (d5, 0.17, 0), (d6, 0.175, -15))
    return room(y, rng, 1.2, 0.22)[: secs(3.0)]


def alert(rng, v):
    """D5 falling to A4: the research interval inverted. A little brighter (hard-mallet attack)."""
    vib = load_inst("Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_A4_v2_rr1_Main.wav")
    d5 = fit(pitch(vib, 5), 1.6, 0.8)
    a4 = fit(vib, 1.6, 0.8)
    strike = modal(0.02, [(2350, 0.004, 1)], rng)
    y = mix(secs(1.8), (d5, 0, 0), (strike, 0, -20), (a4, 0.2, -1), (strike, 0.2, -22))
    return room(y, rng, 0.8, 0.15)[: secs(1.9)]


def error(rng, v):
    """Cannot: a dull relay thunk with a short muted buzz. Low, short, never shrill."""
    n = secs(0.16)
    t = np.arange(n) / SR
    buzz = np.sign(np.sin(2 * np.pi * 110 * t)) * env_exp(n, 0.04, 0.004)
    buzz = filt(buzz, "lowpass", 900)
    y = mix(secs(0.18), (thump(0.1, 160, 110, 0.02), 0, 0), (buzz, 0.005, -9),
            (fit(load("Woodblock/wood_click_pp_rr1.wav"), 0.03, 0.015), 0, -14))
    return filt(y, "lowpass", 2500)


def _step(rng, surface):
    n = secs(0.3)
    if surface == "grass":
        heel = thump(0.06, 160, 100, 0.014)
        crunch = grains(0.12, 30, [900, 3200], (0.002, 0.006), rng, decay=0.04)
        toe = grains(0.08, 14, [1000, 3400], (0.0015, 0.005), rng, decay=0.03)
        y = mix(n, (heel, 0, 0), (crunch, 0.003, -8), (toe, rng.uniform(0.06, 0.09), -12))
        return filt(y, "lowpass", 4500)
    heel = thump(0.05, 210, 150, 0.01)
    click = filt(noise(secs(0.015), rng), "bandpass", [800, 2400]) * env_exp(secs(0.015), 0.003)
    scuff = filt(noise(secs(0.05), rng), "bandpass", [1000, 3000]) * np.hanning(secs(0.05))
    y = mix(n, (heel, 0, 0), (click, 0.001, -8), (scuff, rng.uniform(0.07, 0.1), -18))
    return room(filt(y, "lowpass", 4500), rng, 0.4, 0.1)[:n]


def footstep_grass(rng, v):
    return _step(rng, "grass")


def footstep_concrete(rng, v):
    return _step(rng, "concrete")


# name: (function, variants, normalization ("peak", dBFS) or ("lufs", LUFS-I), loop)
SOUNDS = {
    "ui_click": (ui_click, 3, ("peak", -14), False),
    "ui_hover": (ui_hover, 2, ("peak", -28), False),
    "build_small": (build_small, 3, ("peak", -10), False),
    "build_medium": (build_medium, 3, ("peak", -8), False),
    "build_large": (build_large, 2, ("peak", -7), False),
    "deconstruct": (deconstruct, 3, ("peak", -10), False),
    "mine_ore": (mine_ore, 4, ("peak", -9), False),
    "inserter_swing": (inserter_swing, 4, ("peak", -18), False),
    "keypunch_loop": (keypunch_loop, 1, ("lufs", -28), True),
    "belt_loop": (belt_loop, 1, ("lufs", -32), True),
    "research_complete": (research_complete, 1, ("peak", -8), False),
    "alert": (alert, 1, ("peak", -8), False),
    "error": (error, 1, ("peak", -12), False),  # A4 made 2 variants, but the generator ignores its rng: identical
    "footstep_grass": (footstep_grass, 4, ("peak", -20), False),
    "footstep_concrete": (footstep_concrete, 4, ("peak", -20), False),
}


def lufs_i(x: np.ndarray) -> float:
    b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
    b2, a2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
    y = ss.lfilter(b2, a2, ss.lfilter(b1, a1, x))
    # mono counts as one channel at weight 1, as for stereo L or R; two copies (dual mono) would add 3 dB
    blk, hop = secs(0.4), secs(0.1)
    if len(y) < blk:
        y = np.pad(y, (0, blk - len(y)))
    p = np.array([np.mean(y[s:s + blk] ** 2) for s in range(0, len(y) - blk + 1, hop)])
    p = p[-0.691 + 10 * np.log10(p + 1e-20) > -70]
    if not len(p):
        return float("-inf")
    rel = -0.691 + 10 * np.log10(p.mean()) - 10
    p = p[-0.691 + 10 * np.log10(p) > rel]
    return float(-0.691 + 10 * np.log10(p.mean()))



def generate(out: Path, only: list[str] | None = None, seed: int = 1945) -> dict:
    """Writes every variant's master to `out` and returns {name: {variants, loop, norm, sources}}."""
    out.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for name, (fn, nvar, norm, loop) in SOUNDS.items():
        if only and name not in only:
            continue
        files = []
        for v in range(nvar):
            rng = np.random.default_rng([seed, zlib.crc32(name.encode()), v])  # stable across runs (A4's seeds)
            USED.clear()
            y = fn(rng, v)
            y = y - np.mean(y)
            if not loop:
                f = min(secs(0.008), len(y) // 4)
                y[-f:] *= np.linspace(1, 0, f)
            if norm[0] == "peak":
                y *= 10 ** (norm[1] / 20) / (np.abs(y).max() + 1e-12)
            else:
                y *= 10 ** ((norm[1] - lufs_i(y)) / 20)
                if np.abs(y).max() > 0.7:
                    y *= 0.7 / np.abs(y).max()
            stem = f"{name}_{v + 1}" if nvar > 1 else name
            entry = dict(stem=stem, peak_db=round(20 * np.log10(np.abs(y).max()), 1), lufs=round(lufs_i(y), 1),
                         sources=sorted(set(USED)))
            if loop:
                # the circular continuation on both sides: [tail | loop | head]
                m = secs(LOOP_MARGIN)
                body = len(y)
                y = np.concatenate([y[-m:], y, y[:m]])
                entry.update(loop_start=m, loop_end=m + body)
            pad = (-len(y)) % 3  # 48 kHz lengths that map exactly onto 32 kHz
            if pad:
                y = np.concatenate([y, np.zeros(pad)])
            sf.write(out / f"{stem}.wav", y.astype(np.float32), SR, subtype="FLOAT")
            entry["len48"] = len(y)
            files.append(entry)
        manifest[name] = dict(variants=files, loop=loop, norm=list(norm))
        print(f"  {name:20s} {nvar} variant(s): " + ", ".join(f"pk {f['peak_db']} LUFS {f['lufs']}" for f in files))
    return manifest
