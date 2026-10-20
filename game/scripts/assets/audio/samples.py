"""The instrument samples: fetch the CC0 sources at pinned commits, then prepare the shipping packs.

A port of A4's `design/audio/proto/samples/fetch_samples.py` and `prep_samples.py` (DIRECTION §6.4; 10 §9.4)
into the game's asset build. The processing is A4's, unchanged: trim to a 2 ms pre-roll, measure the real
pitch, level-match notes along the keyboard per layer, normalise velocity layers to the soft layer's
median plus a designed step, cap the length with a fade; the shipping profile (mono, one layer, short
tails for bowed and blown instruments) reuses the full profile's per-file gains, so the engine's trims stay
valid, and A4's empirical pack match (`analysis/packmatch.py`) is applied as `PACKMATCH_DB`.

Fetching: only the files the packs use, from the pinned trees. Each file is checked against the git blob
SHA-1 of the pinned tree (so a mirror, e.g. A4's `design/audio/out/samples/raw`, can be reused safely) and
recorded with its SHA-256 in `game/assets/audio/samples.lock.json`; later fetches check the SHA-256.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import scipy.signal as ss
import soundfile as sf
import soxr

GAME = Path(__file__).resolve().parents[3]
CACHE = GAME / ".cache" / "assets" / "audio"
RAW = CACHE / "raw"
LOCK = GAME / "assets" / "audio" / "samples.lock.json"
SR = 48000

LIBRARIES = {
    # Versilian Community Sample Library. CC0 1.0.
    "VCSL": {"repo": "sgossner/VCSL", "sha": "c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e", "licence": "CC0-1.0"},
    # Versilian Studios Chamber Orchestra 2, Community Edition. CC0 1.0.
    "VSCO-2-CE": {"repo": "sgossner/VSCO-2-CE", "sha": "440300901dfe9275fd84e0b7763af1f8443ae62e", "licence": "CC0-1.0"},
}

NOTE_RE = re.compile(r"(?<![A-Za-z])([A-G])(#|b)?(-?\d)(?!\d)")
PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


@dataclass
class Inst:
    lib: str
    dir: str  # directory inside the library
    pattern: str  # regex on the file name; group "layer" (optional) and a note name
    layers: dict[str, int] = field(default_factory=lambda: {"": 0})  # layer token -> index (0 = softest)
    layer_db: list[float] = field(default_factory=lambda: [0.0])
    max_len: float = 10.0
    fade: float = 2.0
    mono: bool = False
    smooth_level: bool = True
    min_midi: int = 0
    max_midi: int = 127
    highpass: float = 0.0
    kind: str = "oneshot"
    bitrate: str = "96k"
    keep_tuning: bool = False
    normalize_layers: bool = True
    # A4's fetch selection where it is narrower than `pattern` (fetch_samples.py SELECTION): the files a
    # pack is built from, so the level fit sees the same notes as A4's
    select: str | None = None


# A4's INSTRUMENTS (prep_samples.py), the ones the shipping profile uses.
INSTRUMENTS: dict[str, Inst] = {
    "piano": Inst("VCSL", "Chordophones/Zithers/Grand Piano, Steinway B/Sus",
                  r"JHPiano_Sus_Close_(?P<note>[A-G]#?\d)_vl(?P<layer>\d)_rr1\.wav",
                  layers={"2": 0, "3": 1}, layer_db=[-7.0, 0.0], max_len=9.0, fade=2.5, keep_tuning=True,
                  normalize_layers=False, select=r"JHPiano_Sus_Close_(C|D|E|F#|G#|A#)[2-7]_vl[23]_rr1\.wav"),
    "violins": Inst("VSCO-2-CE", "Strings/Violin Section/susVib",
                    r"VlnEns_susVib_(?P<note>[A-G]#?\d)_v(?P<layer>\d)\.wav",
                    layers={"1": 0, "2": 1}, layer_db=[0.0, 4.0], max_len=12.0, fade=1.5, kind="sustain"),
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
    "harp": Inst("VSCO-2-CE", "Strings/Harp", r"KSHarp_(?P<note>[A-G]#?\d)_(?P<layer>mp|mf|f)\.wav",
                 layers={"mp": 0, "mf": 0, "f": 0}, layer_db=[0.0], max_len=7.0, fade=2.0),
    "vibes": Inst("VCSL", "Idiophones/Struck Idiophones/Vibraphone/Soft Mallets",
                  r"Vibes_soft_(?P<note>[A-G]#?\d)_v(?P<layer>\d)_rr1_Main\.wav",
                  layers={"1": 0, "2": 1}, layer_db=[0.0, 4.0], max_len=9.0, fade=2.5),
    "glock": Inst("VCSL", "Idiophones/Struck Idiophones/Glockenspiel",
                  r"glock_(?P<layer>soft|medium)_(?P<note>[A-G]#?\d)_0\d\.wav",
                  layers={"soft": 0, "medium": 1}, layer_db=[0.0, 4.0], max_len=6.0, fade=2.0),
    "marimba": Inst("VCSL", "Idiophones/Struck Idiophones/Marimba",
                    r"Marimba_hit_Outrigger_(?P<note>[A-G]#?\d)_(?P<layer>soft|med)_01\.wav",
                    layers={"soft": 0, "med": 1}, layer_db=[0.0, 4.0], max_len=5.0, fade=1.5),
}

# A4's shipping profile (SHIP): what the game downloads.
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
}

# A4's empirical pack match: the shipping manifest's makeup_db after `packmatch.py` (design/audio/out/samples/
# ship/instruments.json, 2026-10-20) minus the makeup prep computes. It closes what a script cannot
# compute in advance: mono downmixes of spaced pairs and single layers (DIRECTION §6.4).
PACKMATCH_DB: dict[str, float] = {
    "piano": -0.05,
    "violins": -2.35,
    "violas": -5.36,
    "celli": -1.14,
    "bass": 3.11,
    "clarinet": 0.26,
    "harp": 0.89,
    "vibes": 0.0,
    "glock": 1.48,
    "marimba": 0.0,
}

# The SFX sources (the woodblock, claves, brake drums and ratchet; the chimes' vibraphone and glockenspiel)
SFX_SOURCES = [
    ("VCSL", r"Idiophones/Struck Idiophones/(Woodblock|Ratchet|Claves|Brake Drum)/.*\.wav"),
    ("VCSL", r"Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_A4_v2_rr1_Main\.wav"),
    ("VCSL", r"Idiophones/Struck Idiophones/Glockenspiel/glock_soft_C6_01\.wav"),
]
LICENCE_FILES = [("VCSL", r"LICENSE|README\.md"), ("VSCO-2-CE", r"LICENSE|README\.md|Readme\.txt")]


# ------------------------------------------------------------------ fetch


def git_blob_sha1(data: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def tree(lib: str, mirror: Path | None) -> list[dict]:
    """The pinned tree's blobs (cached; from the mirror's `_trees` when it has them)."""
    info = LIBRARIES[lib]
    name = f"{lib}-{info['sha'][:12]}.tree.json"
    cache = RAW / "_trees" / name
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        if mirror and (mirror / "_trees" / name).exists():
            shutil.copyfile(mirror / "_trees" / name, cache)
        else:
            url = f"https://api.github.com/repos/{info['repo']}/git/trees/{info['sha']}?recursive=1"
            req = urllib.request.Request(url, headers={"User-Agent": "paperwork-audio-build"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
            if data.get("truncated"):
                raise SystemExit(f"the tree for {lib} is truncated")
            cache.write_text(json.dumps(data))
    data = json.loads(cache.read_text())
    if data.get("sha") and data["sha"] != info["sha"]:
        raise SystemExit(f"{cache}: tree of {data['sha']}, expected {info['sha']}")
    return [e for e in data["tree"] if e["type"] == "blob"]


def wanted() -> list[tuple[str, dict]]:
    """Every file the build needs: the packs' sources, the SFX sources and the licences."""
    pats: list[tuple[str, re.Pattern]] = []
    for inst in INSTRUMENTS.values():
        pats.append((inst.lib, re.compile(re.escape(inst.dir) + "/" + (inst.select or inst.pattern))))
    for lib, p in SFX_SOURCES + LICENCE_FILES:
        pats.append((lib, re.compile(p)))
    out = []
    for lib in LIBRARIES:
        for b in tree(lib, MIRROR):
            if any(l == lib and p.fullmatch(b["path"]) for l, p in pats):
                out.append((lib, b))
    return out


MIRROR: Path | None = None


def fetch(mirror: Path | None = None) -> None:
    global MIRROR
    MIRROR = mirror
    lock = json.loads(LOCK.read_text()) if LOCK.exists() else {}
    files = wanted()
    changed = False
    t0 = time.time()
    for i, (lib, b) in enumerate(files):
        rel = f"{lib}/{b['path']}"
        dest = RAW / lib / b["path"]
        want_sha256 = lock.get(rel, {}).get("sha256")
        if dest.exists() and dest.stat().st_size == b["size"]:
            if want_sha256 and hashlib.sha256(dest.read_bytes()).hexdigest() == want_sha256:
                continue
        data = None
        src = mirror / lib / b["path"] if mirror else None
        if src and src.exists() and src.stat().st_size == b["size"]:
            data = src.read_bytes()
        else:
            info = LIBRARIES[lib]
            url = f"https://raw.githubusercontent.com/{info['repo']}/{info['sha']}/{urllib.parse.quote(b['path'])}"
            for attempt in range(4):
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": "paperwork-audio-build"})
                    with urllib.request.urlopen(req, timeout=120) as r:
                        data = r.read()
                    break
                except OSError as e:
                    print(f"  retry {attempt + 1} {rel}: {e}", file=sys.stderr)
                    time.sleep(2 * (attempt + 1))
            if data is None:
                raise SystemExit(f"failed: {url}")
        if git_blob_sha1(data) != b["sha"]:
            raise SystemExit(f"{rel}: content does not match the pinned tree (git blob {b['sha']})")
        sha256 = hashlib.sha256(data).hexdigest()
        if want_sha256 and want_sha256 != sha256:
            raise SystemExit(f"{rel}: SHA-256 {sha256} differs from the lock's {want_sha256}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        if rel not in lock:
            lock[rel] = {"size": b["size"], "git": b["sha"], "sha256": sha256, "licence": LIBRARIES[lib]["licence"]}
            changed = True
        if (i + 1) % 100 == 0:
            print(f"  fetched {i + 1}/{len(files)}")
    if changed:
        LOCK.parent.mkdir(parents=True, exist_ok=True)
        LOCK.write_text(json.dumps(dict(sorted(lock.items())), indent=1) + "\n")
    print(f"samples: {len(files)} files verified in {time.time() - t0:.1f} s")


# ------------------------------------------------------------------ prep (A4's prep_samples.py)


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
    for cand, amp, fk in sorted(best):
        if amp > top * 10 ** (-15 / 20):
            return 69 + 12 * np.log2(fk / 440)
    raise RuntimeError("no pitch")


def early_level_db(x: np.ndarray, sr: int) -> float:
    m = x.mean(axis=1)[: int(0.4 * sr)]
    b, a = ss.butter(2, 120 / (sr / 2), "high")
    y = ss.lfilter(b, a, m)
    return 10 * np.log10(np.mean(y ** 2) + 1e-20)


def process(name: str, inst: Inst, gains: dict[str, float] | None = None, write_dir: Path | None = None) -> dict:
    """A4's `process`: with `gains` (the full profile's) the shipping profile; writes 48 kHz float WAVs."""
    src = RAW / inst.lib / inst.dir
    files = sorted(p for p in src.glob("*.wav")
                   if re.fullmatch(inst.pattern, p.name) and (inst.select is None or re.fullmatch(inst.select, p.name)))
    if not files:
        raise SystemExit(f"{name}: no files in {src} (run the fetch step)")
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
            mm = x.mean(axis=1, keepdims=True)
            pw_st = float(np.mean(seg[:, 0] ** 2) + np.mean(seg[:, 1] ** 2))
            pw_m = float(np.mean(mm[: len(seg), 0] ** 2))
            x = mm * np.sqrt(pw_st / max(pw_m, 1e-20))
        recs.append(dict(path=p, layer=inst.layers[layer_tok], root=float(root), x=x, nominal=nominal))
    offs = [int(round((r["root"] - r["nominal"]) / 12)) * 12 for r in recs]
    off = max(set(offs), key=offs.count)
    kept = []
    for r in recs:
        r["nominal"] += off
        win = (0.3, 2.0) if inst.kind == "sustain" else (0.08, 0.8)
        r["root"] = float(r["nominal"]) if inst.keep_tuning else float(measure_pitch(r["x"], SR, r["nominal"], (0,), win))
        if inst.min_midi <= r["root"] <= inst.max_midi:
            r["level"] = early_level_db(r["x"], SR)
            kept.append(r)
    recs = kept
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
    base = [r["level"] + r["corr"] for r in recs if r["layer"] == 0]
    ref = float(np.median(base)) if base else 0.0
    if inst.normalize_layers:
        for li in sorted({r["layer"] for r in recs}):
            med = float(np.median([r["level"] + r["corr"] for r in recs if r["layer"] == li]))
            for r in recs:
                if r["layer"] == li:
                    r["corr"] += ref - med
    ldb = lambda r: inst.layer_db[r["layer"]] if r["layer"] < len(inst.layer_db) else 0.0  # noqa: E731
    peak_all = max(float(np.abs(r["x"]).max()) * 10 ** ((r["corr"] + ldb(r)) / 20) for r in recs)
    norm_db = 20 * np.log10(0.89 / peak_all)
    for r in recs:
        g = r["corr"] + ldb(r) + norm_db
        if gains is not None and r["path"].name in gains:
            g = gains[r["path"].name]
        r["gain_db"] = g
    pk = max(float(np.abs(r["x"]).max()) * 10 ** (r["gain_db"] / 20) for r in recs)
    makeup_db = max(0.0, 20 * np.log10(pk / 0.95))
    zones = []
    for r in recs:
        y = r["x"] * 10 ** ((r["gain_db"] - makeup_db) / 20)
        stem = f"{name}_{r['nominal']:03d}_l{r['layer']}"
        if write_dir is not None:
            write_dir.mkdir(parents=True, exist_ok=True)
            # pad to a multiple of 3 samples, so 48 kHz maps exactly onto the 32 kHz canonical timeline
            pad = (-len(y)) % 3
            if pad:
                y = np.concatenate([y, np.zeros((pad, y.shape[1]))])
            sf.write(write_dir / f"{stem}.wav", y.astype(np.float32), SR, subtype="FLOAT")
        rel = r["level"] + r["corr"] - ref  # the layer's offset as recorded (0 for normalised sources)
        level_db = round(rel + ldb(r), 2)
        zones.append(dict(stem=stem, src=f"{inst.lib}/{inst.dir}/{r['path'].name}", gain_db=round(float(r["gain_db"]), 3),
                          root=round(r["root"], 3), layer=r["layer"], channels=1 if inst.mono else 2, level_db=level_db))
    zones.sort(key=lambda z: (z["layer"], z["root"]))
    nl = max(z["layer"] for z in zones) + 1
    return dict(kind=inst.kind, layers=nl, zones=zones, makeup_db=round(float(makeup_db), 2), bitrate=inst.bitrate)


def prep(out: Path, only: list[str] | None = None) -> dict:
    """The full profile's gains (analysis only), then the shipping packs as 48 kHz masters in `out`."""
    full_gains_path = CACHE / "full-gains.json"
    full = json.loads(full_gains_path.read_text()) if full_gains_path.exists() else {}
    manifest = {}
    for name, inst in INSTRUMENTS.items():
        if only and name not in only:
            continue
        t0 = time.time()
        if name not in full:
            info = process(name, inst)
            full[name] = {"layers": info["layers"], "zones": info["zones"]}
            full_gains_path.parent.mkdir(parents=True, exist_ok=True)
            full_gains_path.write_text(json.dumps(full, indent=1))
        f = full[name]
        ship = Inst(**{**inst.__dict__, **SHIP[name]})
        gains = {Path(z["src"]).name: z["gain_db"] for z in f["zones"]}
        # one layer where the full pack has several: match the level the full pack has at velocity 0.4
        if len(set(ship.layers.values())) == 1 and f["layers"] > 1:
            by: dict[int, dict[int, float]] = {}
            for z in f["zones"]:
                by.setdefault(round(z["root"]), {})[z["layer"]] = z["level_db"]
            deltas = [v[1] - v[0] for v in by.values() if 0 in v and 1 in v]
            if deltas:
                d = float(np.median(deltas))
                fr = min(1.0, 0.4 ** 0.9 * (f["layers"] - 1))
                comp = 10 * np.log10(np.cos(fr * np.pi / 2) ** 2 + np.sin(fr * np.pi / 2) ** 2 * 10 ** (d / 10))
                tok = next(iter(ship.layers))
                chosen = inst.layers.get(tok, 0)
                own = 0.0 if chosen == 0 else d * chosen
                gains = {k: v + comp - own for k, v in gains.items()}
        info = process(name, ship, gains, out / name)
        manifest[name] = info
        print(f"  {name:10s} {len(info['zones']):3d} zones, layers={info['layers']}, computed makeup {info['makeup_db']:+.2f} dB "
              f"({time.time() - t0:.1f} s)")
    return manifest
