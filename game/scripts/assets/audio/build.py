"""The audio asset build (10 §9.4, §9.6–§9.7; C7): samples and SFX into public/audio/.

    gamedev-python scripts/assets/audio/build.py [--mirror DIR] [--steps fetch,prep,sfx,encode] [--force]

Run from game/. Heavy steps belong on socket 1 (`taskset -c 8-15,24-31`).

1. fetch: the CC0 sources at pinned commits into .cache/assets/audio/raw (verified against the pinned git
   trees and the SHA-256 lock, game/assets/audio/samples.lock.json). `--mirror` reuses a local copy, e.g.
   A4's design/audio/out/samples/raw, instead of downloading about 1 GB.
2. prep: the shipping instrument packs (samples.py, A4's processing) as 48 kHz masters.
3. sfx: A4's SFX prototypes (sfx.py) as 48 kHz masters; loops with 100 ms circular margins.
4. encode: every master to Ogg Opus and AAC (.m4a) at the pack's bitrate, named by content hash and cached
   in .cache/assets/audio/enc; the canonical 32 kHz length and start fingerprint of each (10 §9.4).
5. manifests: public/audio/music.json and sounds.json (from game/data/engine/sounds.yaml), the probe,
   inventory.json (bytes per group) and the build gates: decoded residency of each adjacent era pair
   ≤ 90 MB, each later era's download ≤ 3 MB, the SFX set ≤ 1 MB.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import soxr
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
import samples  # noqa: E402
import sfx  # noqa: E402

GAME = Path(__file__).resolve().parents[3]
CACHE = GAME / ".cache" / "assets" / "audio"
MASTERS = CACHE / "masters"
ENC = CACHE / "enc"
PUBLIC = GAME / "public" / "audio"
SOUNDS_YAML = GAME / "data" / "engine" / "sounds.yaml"
FFMPEG = shutil.which("ffmpeg") or str(Path.home() / ".local/bin/ffmpeg")
RATE = 32000
ENCODER_VERSION = "opus+aac v1"

# the packs each era's rule set uses (src/audio/music/pieces/era*.ts; checked by the runtime)
ERA_PACKS = {
    "era1": ["piano", "violins", "violas", "celli", "bass", "clarinet", "harp", "glock"],
    "era2": ["marimba", "vibes", "piano"],
}
GATES = {"pair_mb": 90.0, "later_era_mb": 3.0, "sfx_mb": 1.0}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical(master: Path) -> tuple[int, dict, int]:
    """The 32 kHz canonical length and start fingerprint of a 48 kHz master, and its channel count."""
    x, sr = sf.read(master, always_2d=True, dtype="float64")
    if sr != 48000 or len(x) % 3:
        raise SystemExit(f"{master}: masters are 48 kHz with lengths divisible by 3")
    y = soxr.resample(x, 48000, RATE, quality="VHQ")
    n = len(x) * 2 // 3
    y = y[:n] if len(y) >= n else np.concatenate([y, np.zeros((n - len(y), y.shape[1]))])
    m = np.abs(y[:, 0])
    peak = float(m.max())
    at = int(np.argmax(m > 0.01 * peak)) if peak > 0 else 0
    at = min(at, max(0, n - 64))
    fp = [int(round(float(v) * 32768)) for v in y[at:at + 64, 0]]
    return n, {"at": at, "data": fp}, x.shape[1]


def encode(master: Path, bitrate: str, channels: int) -> tuple[str, dict[str, Path]]:
    """Encodes a master to .ogg (Opus) and .m4a (AAC), cached by content hash. Returns (hash8, paths)."""
    key = hashlib.sha256(master.read_bytes() + f"|{bitrate}|{channels}|{ENCODER_VERSION}".encode()).hexdigest()
    out = {}
    ENC.mkdir(parents=True, exist_ok=True)
    for ext, args in (
        ("ogg", ["-c:a", "libopus", "-b:a", bitrate, "-vbr", "on", "-application", "audio"]),
        # AAC: the same bitrate plus a quarter (AAC is less efficient at low rates; 10 §9.4 "about 25 % larger")
        ("m4a", ["-c:a", "aac", "-b:a", f"{int(int(bitrate.rstrip('k')) * 1.25)}k", "-movflags", "+faststart"]),
    ):
        dest = ENC / f"{key}.{ext}"
        if not dest.exists():
            tmp = dest.with_suffix(f".tmp.{ext}")
            subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(master), "-ac", str(channels),
                            *args, "-map_metadata", "-1", "-fflags", "+bitexact", str(tmp)], check=True)
            tmp.rename(dest)
        out[ext] = dest
    return key[:12], out


def publish(rel_stem: str, master: Path, bitrate: str, channels: int, licence: str, extra: dict) -> dict:
    """Encodes and copies one file into public/audio; returns its manifest entry."""
    h, paths = encode(master, bitrate, channels)
    rel = f"{rel_stem}.{h}"
    sizes = {}
    for ext, p in paths.items():
        dest = PUBLIC / f"{rel}.{ext}"
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.exists() or dest.stat().st_size != p.stat().st_size:
            shutil.copyfile(p, dest)
        sizes[ext] = p.stat().st_size
    n, fp, _ = canonical(master)
    return {"file": rel, "len": n, "channels": channels, "fp": fp, "bytes": sizes, **extra}


def build_samples(force: bool) -> dict:
    prep_json = CACHE / "prep.json"
    out = MASTERS / "inst"
    if force or not prep_json.exists():
        if out.exists():
            shutil.rmtree(out)
        packs = samples.prep(out)
        prep_json.write_text(json.dumps(packs, indent=1))
    packs = json.loads(prep_json.read_text())
    manifest = {}
    for name, p in packs.items():
        zones = []
        for z in p["zones"]:
            entry = publish(f"inst/{name}/{z['stem']}", out / name / f"{z['stem']}.wav", p["bitrate"], z["channels"],
                            "CC0-1.0", {"root": z["root"], "layer": z["layer"], "src": z["src"]})
            zones.append(entry)
        lib = zones[0]["src"].split("/")[0] if zones else ""
        # the files are scaled by the computed makeup; the runtime restores it plus A4's pack match (samples.py)
        makeup = round(p["makeup_db"] + samples.PACKMATCH_DB.get(name, 0.0), 2)
        manifest[name] = {"kind": p["kind"], "layers": p["layers"], "makeupDb": makeup, "zones": zones,
                          "licence": f"CC0-1.0 ({lib}, {samples.LIBRARIES[lib]['repo']}@{samples.LIBRARIES[lib]['sha'][:12]})"}
    return manifest


def build_sfx(force: bool, defs: dict) -> dict:
    sfx_json = CACHE / "sfx.json"
    out = MASTERS / "sfx"
    if force or not sfx_json.exists():
        if out.exists():
            shutil.rmtree(out)
        gen = sfx.generate(out)
        sfx_json.write_text(json.dumps(gen, indent=1))
    gen = json.loads(sfx_json.read_text())
    sounds = {}
    for name, d in sorted(defs.items()):
        g = gen.get(d["source"])
        if g is None:
            raise SystemExit(f"sounds.yaml: {name}: no SFX generator named {d['source']}")
        files = []
        for v in g["variants"]:
            extra = {}
            if g["loop"]:
                # the loop points on the 32 kHz canonical timeline (masters: 48 kHz, margins included)
                extra = {"loopStart": v["loop_start"] * 2 // 3, "loopEnd": v["loop_end"] * 2 // 3}
            files.append(publish(f"sfx/{v['stem']}", out / f"{v['stem']}.wav", d.get("bitrate", "64k"), 1, "CC0-1.0", extra))
        sounds[name] = {
            "bus": d["bus"],
            "gainDb": d.get("gain_db", 0.0),
            "pitchJitter": d.get("pitch_jitter", 0.03),
            "gainJitterDb": d.get("gain_jitter_db", 1.5),
            "rate": {"count": d["rate"][0], "windowMs": d["rate"][1]} if d.get("rate") else None,
            "voices": d.get("voices", 4),
            "priority": d.get("priority", 1),
            "positional": d.get("positional", True),
            "loop": bool(g["loop"]),
            "files": files,
            "licence": "Paperwork's own synthesis; CC0 percussion from VCSL (sgossner/VCSL@c1ea7bcc3c73)",
        }
    return sounds


def probe() -> dict:
    """A 0.1 s probe (10 §9.4): a quiet 440 Hz tone, so a decoder that works yields non-zero samples."""
    master = MASTERS / "probe.wav"
    master.parent.mkdir(parents=True, exist_ok=True)
    n = 4800
    t = np.arange(n) / 48000
    y = 0.1 * np.sin(2 * np.pi * 440 * t) * np.hanning(n)
    sf.write(master, y.astype(np.float32), 48000, subtype="FLOAT")
    h, paths = encode(master, "32k", 1)
    for ext, p in paths.items():
        shutil.copyfile(p, PUBLIC / f"probe.{ext}")
    return {"file": "probe", "bytes": {ext: p.stat().st_size for ext, p in paths.items()}}


def recordings() -> dict:
    """Offline renders published by render.ts (the charter piece), if present."""
    rec_json = CACHE / "recordings.json"
    return json.loads(rec_json.read_text()) if rec_json.exists() else {}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mirror", type=Path)
    ap.add_argument("--steps", default="fetch,prep,sfx,encode")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    steps = set(a.steps.split(","))
    t0 = time.time()
    cfg = yaml.safe_load(SOUNDS_YAML.read_text())
    if "fetch" in steps:
        samples.fetch(a.mirror)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    music = {"version": 1, "rate": RATE, "packs": {}, "eras": ERA_PACKS, "recordings": recordings()}
    sounds_manifest = None
    if "encode" in steps:
        music["packs"] = build_samples(a.force and "prep" in steps)
        sounds = build_sfx(a.force and "sfx" in steps, cfg["sounds"])
        bm = GAME / "public" / "data" / "build-manifest.json"
        proto_hash = json.loads(bm.read_text()).get("prototypesHash") if bm.exists() else None
        sounds_manifest = {
            "version": 1,
            "rate": RATE,
            "prototypesHash": proto_hash,
            "sounds": sounds,
            "events": {k: v for k, v in cfg["events"].items()},
            "working": cfg.get("working", {}),
            "music": {"eras": cfg["music"]["eras"]},
        }
        p = probe()
        (PUBLIC / "music.json").write_text(json.dumps(music, indent=1) + "\n")
        (PUBLIC / "sounds.json").write_text(json.dumps(sounds_manifest, indent=1) + "\n")
        clean(music, sounds)
        inventory(music, sounds, p)
    print(f"audio build: done in {time.time() - t0:.1f} s")


def clean(music: dict, sounds: dict) -> None:
    """Removes files in public/audio that no manifest references (older builds' content hashes)."""
    keep = {"probe"}
    for p in music["packs"].values():
        keep.update(z["file"] for z in p["zones"])
    for s in sounds.values():
        keep.update(f["file"] for f in s["files"])
    keep.update(r["file"] for r in music["recordings"].values())
    removed = 0
    for sub in ("inst", "sfx", "music"):
        for f in (PUBLIC / sub).rglob("*") if (PUBLIC / sub).exists() else []:
            if f.is_file() and str(f.relative_to(PUBLIC).with_suffix("")) not in keep:
                f.unlink()
                removed += 1
    if removed:
        print(f"  removed {removed} stale files")


def inventory(music: dict, sounds: dict, probe_entry: dict) -> None:
    """Bytes per group and codec, decoded residency, and the build gates."""
    def pack_bytes(name: str, codec: str) -> int:
        return sum(z["bytes"][codec] for z in music["packs"][name]["zones"])

    def pack_decoded(name: str) -> int:
        return sum(z["len"] * z["channels"] * 2 for z in music["packs"][name]["zones"])

    inv = {"groups": {}, "decoded": {}, "gates": {}}
    for codec in ("ogg", "m4a"):
        g = inv["groups"].setdefault(codec, {})
        g["sfx"] = sum(f["bytes"][codec] for s in sounds.values() for f in s["files"])
        g["probe"] = probe_entry["bytes"][codec]
        seen: set[str] = set()
        for era, packs in ERA_PACKS.items():
            g[era] = sum(pack_bytes(p, codec) for p in packs if p in music["packs"] and p not in seen)
            seen.update(packs)
        for name, r in music["recordings"].items():
            g[f"recording:{name}"] = r["bytes"][codec]
    for era, packs in ERA_PACKS.items():
        inv["decoded"][era] = sum(pack_decoded(p) for p in packs if p in music["packs"])
    eras = list(ERA_PACKS)
    pairs = {}
    for a, b in zip(eras, eras[1:]):
        union = set(ERA_PACKS[a]) | set(ERA_PACKS[b])
        pairs[f"{a}+{b}"] = sum(pack_decoded(p) for p in union if p in music["packs"])
    sfx_decoded = sum(f["len"] * 2 for s in sounds.values() for f in s["files"])
    inv["decoded"]["pairs"] = pairs
    inv["decoded"]["sfx"] = sfx_decoded
    fails = []
    for k, v in pairs.items():
        if v / 2**20 > GATES["pair_mb"]:
            fails.append(f"decoded {k} {v / 2**20:.1f} MB > {GATES['pair_mb']} MB")
    for era in eras[1:]:
        for codec in ("ogg", "m4a"):
            mb = inv["groups"][codec][era] / 2**20
            if mb > GATES["later_era_mb"]:
                fails.append(f"{era} download ({codec}) {mb:.2f} MB > {GATES['later_era_mb']} MB")
    sfx_mb = inv["groups"]["ogg"]["sfx"] / 2**20
    if sfx_mb > GATES["sfx_mb"]:
        fails.append(f"SFX download {sfx_mb:.2f} MB > {GATES['sfx_mb']} MB")
    inv["gates"] = {"limits": GATES, "failures": fails}
    (PUBLIC / "inventory.json").write_text(json.dumps(inv, indent=1) + "\n")
    for codec in ("ogg", "m4a"):
        print(f"  {codec}: " + ", ".join(f"{k} {v / 2**20:.2f} MB" for k, v in inv["groups"][codec].items()))
    print("  decoded: " + ", ".join(f"{k} {v / 2**20:.1f} MB" for k, v in inv["decoded"].items() if not isinstance(v, dict))
          + "; pairs " + ", ".join(f"{k} {v / 2**20:.1f} MB" for k, v in pairs.items()))
    if fails:
        raise SystemExit("audio build gates failed:\n  " + "\n  ".join(fails))


if __name__ == "__main__":
    main()
