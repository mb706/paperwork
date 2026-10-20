"""Turn raw library samples into the instrument packs the music engine loads.

    gamedev-python -I design/audio/proto/samples/prep_samples.py [--only NAME ...] [--format opus|wav]

For each instrument in INSTRUMENTS:
- read the raw WAVs (fetch_samples.py), resample to 48 kHz, trim the lead-in to a 2 ms pre-roll;
- measure the real pitch (libraries number octaves differently, and some notes are a few cents off);
- level-match notes along the keyboard per velocity layer (a smooth fit, so the natural register
  balance stays but single loud or quiet notes are corrected), and set layer gains;
- cap the length with a fade, encode (Opus 96 kbps by default, as the game would ship it);
- write out/samples/prep/instruments.json: zones with file, root (fractional MIDI), layer and gain.

The engine (proto/engine/sampler.js) picks the nearest root, transposes by playbackRate and
crossfades layers by velocity. Nothing here is specific to WebAudio.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import scipy.signal as ss
import soundfile as sf
import soxr

ROOT = Path(__file__).resolve().parents[2]  # design/audio
RAW = ROOT / "out" / "samples" / "raw"
PREP = ROOT / "out" / "samples" / "prep"
SR = 48000
FFMPEG = str(Path.home() / ".local/bin/ffmpeg")

NOTE_RE = re.compile(r"(?<![A-Za-z])([A-G])(#|b)?(-?\d)(?!\d)")
PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


@dataclass
class Inst:
    lib: str
    dir: str  # directory inside the library
    pattern: str  # regex on the file name; group "layer" (optional) and a note name
    layers: dict[str, int] = field(default_factory=lambda: {"": 0})  # layer token -> index (0 = softest)
    layer_db: list[float] = field(default_factory=lambda: [0.0])  # gain per layer index, after matching
    max_len: float = 10.0  # seconds kept after the onset
    fade: float = 2.0  # fade-out length at the end of what is kept
    mono: bool = False
    smooth_level: bool = True  # level-match along the keyboard
    note_from: str = "name"  # "name": note name in the file name (octave measured); "map": use note_map
    note_map: dict[str, int] | None = None
    min_midi: int = 0
    max_midi: int = 127
    highpass: float = 0.0  # Hz; removes rumble from some recordings
    kind: str = "oneshot"  # "oneshot" (decays) or "sustain" (bowed, blown; the engine re-articulates)
    bitrate: str = "96k"
    keep_tuning: bool = False  # True: root = nominal note (keeps a piano's stretched tuning)
    # Velocity layers recorded at their natural levels differ by up to 30 dB (VSCO 2 violas). Left so,
    # the engine's crossfade is dominated by the loud layer even when playing softly. normalize_layers
    # equalizes the layers' median levels first; layer_db then sets a small designed step (velocity
    # gain supplies the dynamics). Sources already normalized by the library (the Steinway) skip it.
    normalize_layers: bool = True


INSTRUMENTS: dict[str, Inst] = {
    # Steinway B, pedal down, close pair. VCSL notes: "levels normalized; use a velocity curve".
    "piano": Inst("VCSL", "Chordophones/Zithers/Grand Piano, Steinway B/Sus",
                  r"JHPiano_Sus_Close_(?P<note>[A-G]#?\d)_vl(?P<layer>\d)_rr1\.wav",
                  layers={"2": 0, "3": 1}, layer_db=[-7.0, 0.0], max_len=9.0, fade=2.5, keep_tuning=True,
                  normalize_layers=False),
    "violins": Inst("VSCO-2-CE", "Strings/Violin Section/susVib",
                    r"VlnEns_susVib_(?P<note>[A-G]#?\d)_v(?P<layer>\d)\.wav",
                    layers={"1": 0, "2": 1}, layer_db=[0.0, 4.0], max_len=12.0, fade=1.5, kind="sustain",
                    smooth_level=True),
    "violas": Inst("VSCO-2-CE", "Strings/Viola Section/susvib",
                   r"ViolaEns_susvib_(?P<note>[A-G]#?\d)_v(?P<layer>\d)_1\.wav",
                   layers={"1": 0, "2": 1}, layer_db=[0.0, 4.0], max_len=12.0, fade=1.5, kind="sustain"),
    "celli": Inst("VSCO-2-CE", "Strings/Cello Section/susvib",
                  r"susvib_(?P<note>[A-G]#?\d)_v(?P<layer>\d)_1\.wav",
                  layers={"1": 0, "3": 1}, layer_db=[0.0, 4.0], max_len=12.0, fade=1.5, kind="sustain"),
    "bass": Inst("VSCO-2-CE", "Strings/Solo Contrabass/SusNV",
                 r"BKCtbss_SusNV_(?P<note>[A-G]#?\d)_v(?P<layer>\d)_rr1\.wav",
                 layers={"1": 0, "3": 1}, layer_db=[0.0, 4.0], max_len=12.0, fade=1.5, kind="sustain",
                 highpass=28.0),
    "clarinet": Inst("VSCO-2-CE", "Woodwinds/Clarinet/susLong",
                     r"DCClar_susLong_(?P<note>[A-G]#?\d)_v(?P<layer>\d)_rr1_sum\.wav",
                     layers={"1": 0, "2": 1, "3": 2}, layer_db=[0.0, 3.0, 6.0], max_len=12.0, fade=1.0,
                     kind="sustain"),
    "horn": Inst("VSCO-2-CE", "Brass/F Horn/sus",
                 r"MOHorn_sus_(?P<note>[A-G]#?\d)_v(?P<layer>\d)_1\.wav",
                 layers={"1": 0, "2": 1}, layer_db=[0.0, 4.0], max_len=12.0, fade=1.0, kind="sustain"),
    "flute": Inst("VSCO-2-CE", "Woodwinds/Flute/susNV",
                  r"LDFlute_susNV_(?P<note>[A-G]#?\d)_v(?P<layer>\d)_1\.wav",
                  layers={"1": 0, "2": 1, "3": 1}, layer_db=[0.0, 4.0], max_len=12.0, fade=1.0, kind="sustain"),
    "harp": Inst("VSCO-2-CE", "Strings/Harp", r"KSHarp_(?P<note>[A-G]#?\d)_(?P<layer>mp|mf|f)\.wav",
                 layers={"mp": 0, "mf": 0, "f": 0}, layer_db=[0.0], max_len=7.0, fade=2.0),
    "vibes": Inst("VCSL", "Idiophones/Struck Idiophones/Vibraphone/Soft Mallets",
                  r"Vibes_soft_(?P<note>[A-G]#?\d)_v(?P<layer>\d)_rr1_Main\.wav",
                  layers={"1": 0, "2": 1}, layer_db=[0.0, 4.0], max_len=9.0, fade=2.5),
    "vibes_bowed": Inst("VCSL", "Idiophones/Struck Idiophones/Vibraphone/Bowed",
                        r"Vibes_bowed_(?P<note>[A-G]#?\d)_rr1_Main\.wav", max_len=12.0, fade=3.0),
    "glock": Inst("VCSL", "Idiophones/Struck Idiophones/Glockenspiel",
                  r"glock_(?P<layer>soft|medium)_(?P<note>[A-G]#?\d)_0\d\.wav",
                  layers={"soft": 0, "medium": 1}, layer_db=[0.0, 4.0], max_len=6.0, fade=2.0),
    "chimes": Inst("VCSL", "Idiophones/Struck Idiophones/Hand Chimes",
                   r"sus_(?P<note>[A-G]#?\d)_r01_main\.wav", max_len=10.0, fade=3.0),
    "marimba": Inst("VCSL", "Idiophones/Struck Idiophones/Marimba",
                    r"Marimba_hit_Outrigger_(?P<note>[A-G]#?\d)_(?P<layer>soft|med)_01\.wav",
                    layers={"soft": 0, "med": 1}, layer_db=[0.0, 4.0], max_len=5.0, fade=1.5),
    "glass": Inst("VCSL", "Idiophones/Friction Idiophones/Wine Glasses/Sustains/Slow",
                  r"glass\d_(?P<note>[A-G]#?\d)_Slow_\d_[Mm]ain\.wav", max_len=14.0, fade=3.0, kind="sustain"),
    "psaltery": Inst("VCSL", "Chordophones/Zithers/Psaltery, Bowed and Plucked/LongBow",
                     r"BowedPsaltery_(?P<note>[A-G]#?\d)_Main_LongBow_rr\d\.wav", max_len=10.0, fade=2.0,
                     kind="sustain"),
    "fmpiano": Inst("VCSL", "Electrophones/TX81Z/FM Piano",
                    r"FMPiano_(?P<note>[A-G]#?\d)_vl(?P<layer>\d)\.wav",
                    layers={"1": 0, "2": 1}, layer_db=[0.0, 4.0], max_len=7.0, fade=2.0),
}


# The shipping profile: what the game would download. Bowed and blown instruments are mono with one
# (soft) layer and 6 s samples (the engine re-bows longer notes); only the ranges the rules use are
# kept; Opus at 40-64 kbps. Stereo width comes from panning and the reverb.
SHIP: dict[str, dict] = {
    "piano": dict(max_len=7.0, fade=2.0, bitrate="64k", min_midi=36, max_midi=98),
    "violins": dict(mono=True, layers={"1": 0}, layer_db=[0.0], max_len=6.0, fade=1.2, bitrate="40k", min_midi=55, max_midi=88),
    "violas": dict(mono=True, layers={"1": 0}, layer_db=[0.0], max_len=6.0, fade=1.2, bitrate="40k", min_midi=46, max_midi=76),
    "celli": dict(mono=True, layers={"1": 0}, layer_db=[0.0], max_len=6.0, fade=1.2, bitrate="40k", min_midi=36, max_midi=68),
    "bass": dict(mono=True, layers={"1": 0}, layer_db=[0.0], max_len=6.0, fade=1.2, bitrate="40k", min_midi=28, max_midi=52),
    "clarinet": dict(mono=True, layers={"2": 0}, layer_db=[0.0], max_len=6.0, fade=1.0, bitrate="40k", min_midi=55, max_midi=84),
    "harp": dict(mono=True, max_len=5.0, fade=1.5, bitrate="40k", min_midi=40, max_midi=90),
    "glock": dict(mono=True, layers={"soft": 0}, layer_db=[0.0], max_len=4.0, fade=1.5, bitrate="40k"),
    "vibes": dict(mono=True, max_len=6.0, fade=2.0, bitrate="48k"),
    "marimba": dict(mono=True, max_len=3.0, fade=1.0, bitrate="40k"),
    "fmpiano": dict(mono=True, layers={"2": 0}, layer_db=[0.0], max_len=5.0, fade=1.5, bitrate="40k", min_midi=36, max_midi=90),
    "glass": dict(mono=True, max_len=8.0, fade=2.0, bitrate="40k"),
}


def name_to_midi(name: str) -> int:
    m = NOTE_RE.search(name)
    if not m:
        raise ValueError(name)
    pc = PC[m.group(1)] + (1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0)
    return 12 * (int(m.group(3)) + 1) + pc


def onset_index(x: np.ndarray, sr: int) -> int:
    env = np.abs(x).max(axis=1)
    peak = env.max()
    idx = int(np.argmax(env > peak * 0.02))
    return max(0, idx - int(0.002 * sr))


def measure_pitch(x: np.ndarray, sr: int, nominal: int, octaves=(-24, -12, 0, 12, 24),
                  win: tuple[float, float] = (0.08, 0.8)) -> float:
    """Fractional MIDI pitch near nominal (the octave is decided by the spectrum)."""
    m = x.mean(axis=1)
    a = int(win[0] * sr)
    seg = m[a:a + int(win[1] * sr)]
    if len(seg) < int(0.2 * sr):
        seg = m[: int(0.5 * sr)]
    n = 1 << 20
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n))
    fr = np.fft.rfftfreq(n, 1 / sr)
    best = None
    for octv in octaves:
        cand = nominal + octv
        f = 440 * 2 ** ((cand - 69) / 12)
        if f < 20 or f > 12000:
            continue
        lo, hi = np.searchsorted(fr, f * 2 ** (-0.6 / 12)), np.searchsorted(fr, f * 2 ** (0.6 / 12))
        k = lo + int(np.argmax(spec[lo:hi]))
        # parabolic interpolation
        if 0 < k < len(spec) - 1:
            y0, y1, y2 = np.log(spec[k - 1:k + 2] + 1e-12)
            dk = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2 + 1e-12)
        else:
            dk = 0.0
        fk = fr[k] + dk * (fr[1] - fr[0])
        best = best or []
        best.append((cand, spec[k], fk))
    if not best:
        return float(nominal)
    top = max(b[1] for b in best)
    # the lowest candidate whose peak is within 15 dB of the strongest is the fundamental
    for cand, amp, fk in sorted(best):
        if amp > top * 10 ** (-15 / 20):
            return 69 + 12 * np.log2(fk / 440)
    raise RuntimeError("no pitch")


def early_level_db(x: np.ndarray, sr: int, midi: float) -> float:
    """Loudness proxy: RMS of the first 400 ms, A-weighting-like tilt so bass notes do not dominate."""
    m = x.mean(axis=1)[: int(0.4 * sr)]
    # a gentle pre-filter: 2nd-order highpass at 120 Hz + high-shelf-ish via first difference blend
    b, a = ss.butter(2, 120 / (sr / 2), "high")
    y = ss.lfilter(b, a, m)
    return 10 * np.log10(np.mean(y ** 2) + 1e-20)


def process(name: str, inst: Inst, fmt: str, prep: Path, gains: dict[str, float] | None = None) -> dict:
    """gains: source file -> gain in dB from the full profile; when given, used instead of computing
    (a shipping pack is the full pack's processing on a subset, so the engine's trims stay valid)."""
    src = RAW / inst.lib / inst.dir
    files = sorted(p for p in src.glob("*.wav") if re.fullmatch(inst.pattern, p.name))
    if not files:
        raise SystemExit(f"{name}: no files in {src}")
    out_dir = prep / name
    out_dir.mkdir(parents=True, exist_ok=True)
    recs = []
    for p in files:
        m = re.fullmatch(inst.pattern, p.name)
        layer_tok = m.groupdict().get("layer") or ""
        if layer_tok not in inst.layers:
            continue
        x, sr = sf.read(p, always_2d=True, dtype="float64")
        if x.shape[1] > 2:
            x = x[:, :2]
        if x.shape[1] == 1:
            x = np.repeat(x, 2, axis=1)
        if sr != SR:
            x = soxr.resample(x, sr, SR, quality="VHQ")
        if inst.highpass > 0:
            b, a = ss.butter(2, inst.highpass / (SR / 2), "high")
            x = ss.lfilter(b, a, x, axis=0)
        x -= x.mean(axis=0, keepdims=True) * 0  # keep; DC handled by highpass where needed
        on = onset_index(x, SR)
        x = x[on:]
        nominal = name_to_midi(m.group("note"))
        root = measure_pitch(x, SR, nominal)
        n = min(len(x), int(inst.max_len * SR))
        x = x[:n].copy()
        fl = min(int(inst.fade * SR), n // 3)
        x[n - fl:] *= np.cos(np.linspace(0, np.pi / 2, fl))[:, None] ** 2
        if inst.mono:
            # power-preserving downmix: through a centred StereoPanner a mono signal m carries power m^2,
            # the stereo original L^2 + R^2; a plain (L+R)/2 of a spaced pair loses up to 6 dB
            seg = x[: int(1.5 * SR)]
            m = x.mean(axis=1, keepdims=True)
            pw_st = float(np.mean(seg[:, 0] ** 2) + np.mean(seg[:, 1] ** 2))
            pw_m = float(np.mean(m[: len(seg), 0] ** 2))
            x = m * np.sqrt(pw_st / max(pw_m, 1e-20))
        recs.append(dict(path=p, layer=inst.layers[layer_tok], root=float(root), x=x, nominal=nominal))
    # the library's octave convention is constant per instrument: take the majority offset,
    # then re-measure every note within +-60 cents of nominal + offset
    offs = [int(round((r["root"] - r["nominal"]) / 12)) * 12 for r in recs]
    off = max(set(offs), key=offs.count)
    kept = []
    for r in recs:
        r["nominal"] += off
        win = (0.3, 2.0) if inst.kind == "sustain" else (0.08, 0.8)
        r["root"] = float(r["nominal"]) if inst.keep_tuning else float(measure_pitch(r["x"], SR, r["nominal"], (0,), win))
        if inst.min_midi <= r["root"] <= inst.max_midi:
            r["level"] = early_level_db(r["x"], SR, r["root"])
            kept.append(r)
    recs = kept
    # level matching per layer: fit a quadratic of level vs pitch, correct each note to the fit
    for li in sorted({r["layer"] for r in recs}):
        rs = [r for r in recs if r["layer"] == li]
        if inst.smooth_level and len(rs) >= 4:
            pts = np.array([r["root"] for r in rs])
            lv = np.array([r["level"] for r in rs])
            deg = 2 if len(rs) >= 6 else 1
            fit = np.polyval(np.polyfit(pts, lv, deg), pts)
            for r, f in zip(rs, fit):
                r["corr"] = float(np.clip(f - r["level"], -9, 9))
        else:
            for r in rs:
                r["corr"] = 0.0
    # reference level: the softest layer's median after correction
    base = [r["level"] + r["corr"] for r in recs if r["layer"] == 0]
    ref = float(np.median(base)) if base else 0.0
    if inst.normalize_layers:
        for li in sorted({r["layer"] for r in recs}):
            med = float(np.median([r["level"] + r["corr"] for r in recs if r["layer"] == li]))
            for r in recs:
                if r["layer"] == li:
                    r["corr"] += ref - med  # every layer at the soft layer's median; layer_db adds the step
    peak_all = max(float(np.abs(r["x"]).max()) * 10 ** ((r["corr"] + (inst.layer_db[r["layer"]] if r["layer"] < len(inst.layer_db) else 0.0)) / 20) for r in recs)
    norm_db = 20 * np.log10(0.89 / peak_all)
    # final gain per file (computed, or the full profile's), then an instrument-wide attenuation if any
    # file would exceed 0.95; the engine restores it from makeup_db, so levels are unchanged
    for r in recs:
        g = r["corr"] + (inst.layer_db[r["layer"]] if r["layer"] < len(inst.layer_db) else 0.0) + norm_db
        if gains is not None and r["path"].name in gains:
            g = gains[r["path"].name]
        r["gain_db"] = g
    pk = max(float(np.abs(r["x"]).max()) * 10 ** (r["gain_db"] / 20) for r in recs)
    makeup_db = max(0.0, 20 * np.log10(pk / 0.95))
    zones = []
    for r in recs:
        rel = r["level"] + r["corr"] - ref  # layer offset as recorded (0 for normalized sources)
        gain_db = r["gain_db"]
        y = r["x"] * 10 ** ((gain_db - makeup_db) / 20)
        stem = f"{name}_{r['nominal']:03d}_l{r['layer']}"
        wav = out_dir / f"{stem}.wav"
        sf.write(wav, y.astype(np.float32), SR, subtype="FLOAT")
        if fmt == "opus":
            enc = out_dir / f"{stem}.opus"
            subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav), "-c:a", "libopus",
                            "-b:a", inst.bitrate, "-vbr", "on", "-application", "audio", str(enc)], check=True)
            wav.unlink()
            fname = enc.name
        else:
            fname = wav.name
        zones.append(dict(file=f"{name}/{fname}", src=r["path"].name, gain_db=round(float(gain_db), 3), root=round(r["root"], 3), layer=r["layer"],
                          len=round(len(y) / SR, 3), peak=round(float(np.abs(y).max()), 4),
                          level_db=round(rel + inst.layer_db[r["layer"]] if r["layer"] < len(inst.layer_db) else rel, 2)))
    zones.sort(key=lambda z: (z["layer"], z["root"]))
    nl = max(z["layer"] for z in zones) + 1
    return dict(kind=inst.kind, layers=nl, zones=zones, ref_level_db=round(ref, 2), norm_db=round(float(norm_db), 2),
                octave_offset=off, makeup_db=round(float(makeup_db), 2))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--format", choices=["opus", "wav"], default="opus")
    ap.add_argument("--profile", choices=["full", "ship"], default="full")
    a = ap.parse_args()
    prep = PREP if a.profile == "full" else PREP.parent / "ship"
    prep.mkdir(parents=True, exist_ok=True)
    man_path = prep / "instruments.json"
    manifest = json.loads(man_path.read_text()) if man_path.exists() else {}
    for name, inst in INSTRUMENTS.items():
        if a.only and name not in a.only:
            continue
        gains = None
        if a.profile == "ship":
            if name not in SHIP:
                continue
            inst = Inst(**{**inst.__dict__, **SHIP[name]})
            full = json.loads((PREP / "instruments.json").read_text()).get(name)
            if not full or "src" not in full["zones"][0]:
                raise SystemExit(f"{name}: build the full profile first (it defines the gains)")
            gains = {z["src"]: z["gain_db"] for z in full["zones"]}
            # one layer where the full pack has several: the engine crossfades the full pack's layers by
            # velocity, so match the level the full pack has at a typical velocity (0.4)
            if len(set(inst.layers.values())) == 1 and full["layers"] > 1:
                by = {}
                for z in full["zones"]:
                    by.setdefault(round(z["root"]), {})[z["layer"]] = z["level_db"]
                deltas = [v[1] - v[0] for v in by.values() if 0 in v and 1 in v]
                if deltas:
                    d = float(np.median(deltas))
                    f = 0.4 ** 0.9 * (full["layers"] - 1)
                    f = min(1.0, f)
                    comp = 10 * np.log10(np.cos(f * np.pi / 2) ** 2 + np.sin(f * np.pi / 2) ** 2 * 10 ** (d / 10))
                    chosen_full_layer = None
                    # the ship layer is one of the full layers; its own offset to layer 0 is in d terms
                    tok = next(iter(inst.layers))
                    full_def = INSTRUMENTS[name]
                    chosen_full_layer = full_def.layers.get(tok, 0)
                    own = 0.0 if chosen_full_layer == 0 else d * chosen_full_layer
                    gains = {k: v + comp - own for k, v in gains.items()}
                    print(f"  {name}: one layer (full layer {chosen_full_layer}); layer step {d:+.1f} dB; level match {comp - own:+.1f} dB")
        info = process(name, inst, a.format, prep, gains)
        manifest[name] = info
        man_path.write_text(json.dumps(manifest, indent=1))
        roots = [z["root"] for z in info["zones"]]
        offs = [abs(z["root"] - round(z["root"])) * 100 for z in info["zones"]]
        print(f"{name:12s} {len(info['zones']):3d} zones, layers={info['layers']}, "
              f"roots {min(roots):.1f}..{max(roots):.1f}, max detune {max(offs):.0f} c, "
              f"peaks <= {max(z['peak'] for z in info['zones']):.2f}")
    man_path.write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
