"""Download the instrument samples the Paperwork music engine uses.

Only the files listed in SELECTION are fetched, from commits pinned below, so the set is
reproducible. Every library's licence file is fetched next to its samples.

    gamedev-python -I design/audio/proto/samples/fetch_samples.py [--out DIR] [--only LIB] [--dry-run]

Default output: design/audio/out/samples/raw/<library>/<path in repo>. That tree is gitignored.
Files are data: nothing downloaded is executed or imported.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # design/audio
DEFAULT_OUT = ROOT / "out" / "samples" / "raw"

LIBRARIES = {
    # Versilian Community Sample Library. CC0 1.0.
    "VCSL": {"repo": "sgossner/VCSL", "sha": "c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e"},
    # Versilian Studios Chamber Orchestra 2, Community Edition. CC0 1.0.
    "VSCO-2-CE": {"repo": "sgossner/VSCO-2-CE", "sha": "440300901dfe9275fd84e0b7763af1f8443ae62e"},
}

# (library, regex on the repo path). Anchored; matched against the pinned tree.
SELECTION: list[tuple[str, str]] = [
    # Licences and notes
    ("VCSL", r"LICENSE|README\.md"),
    ("VSCO-2-CE", r"LICENSE|README\.md|Readme\.txt"),
    ("VCSL", r"Chordophones/Zithers/Grand Piano, Steinway B/NORMALIZED\.txt"),
    # Era I: piano (Steinway B, sustain pedal down, close pair), two soft velocity layers, C2..A#7
    ("VCSL", r"Chordophones/Zithers/Grand Piano, Steinway B/Sus/JHPiano_Sus_Close_(C|D|E|F#|G#|A#)[2-7]_vl[23]_rr1\.wav"),
    # Era I: string sections (vibrato sustains) and the double bass (non-vibrato)
    ("VSCO-2-CE", r"Strings/(Violin Section/susVib|Viola Section/susvib|Cello Section/susvib|Solo Contrabass/SusNV)/.*\.wav"),
    # Era I: clarinet, horn, flute sustains; harp
    ("VSCO-2-CE", r"Woodwinds/Clarinet/susLong/.*\.wav"),
    ("VSCO-2-CE", r"Brass/F Horn/sus/.*\.wav"),
    ("VSCO-2-CE", r"Woodwinds/Flute/susNV/.*\.wav"),
    ("VSCO-2-CE", r"Strings/Harp/.*\.wav"),
    # Era I-II: mallets and bells
    ("VCSL", r"Idiophones/Struck Idiophones/Vibraphone/(Soft Mallets|Bowed)/.*\.wav"),
    ("VCSL", r"Idiophones/Struck Idiophones/Glockenspiel/glock_(soft|medium)_.*\.wav"),
    ("VCSL", r"Idiophones/Struck Idiophones/Hand Chimes/.*\.wav"),
    ("VCSL", r"Idiophones/Struck Idiophones/Marimba/.*_(soft|med)_01\.wav"),
    ("VCSL", r"Idiophones/Friction Idiophones/Wine Glasses/Sustains/Slow/.*\.wav"),
    ("VCSL", r"Chordophones/Zithers/Psaltery, Bowed and Plucked/LongBow/.*\.wav"),
    # Era III: a real 1987 FM synthesizer (Yamaha TX81Z), two velocity layers
    ("VCSL", r"Electrophones/TX81Z/FM Piano/.*_vl[12]\.wav"),
    # SFX raw material (foley from CC0 percussion recordings)
    ("VCSL", r"Idiophones/Struck Idiophones/(Woodblock|Ratchet|Claves|Slapstick|Anvil|Brake Drum|Shaker, Small|Cabasa)/.*\.wav"),
]


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "paperwork-audio-fetch"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def tree(lib: str, cache_dir: Path) -> list[dict]:
    info = LIBRARIES[lib]
    cache = cache_dir / f"{lib}-{info['sha'][:12]}.tree.json"
    if not cache.exists():
        url = f"https://api.github.com/repos/{info['repo']}/git/trees/{info['sha']}?recursive=1"
        data = fetch_json(url)
        if data.get("truncated"):
            raise SystemExit(f"tree for {lib} is truncated; fetch per directory instead")
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(data))
    data = json.loads(cache.read_text())
    return [e for e in data["tree"] if e["type"] == "blob"]


def download(lib: str, path: str, size: int, out: Path) -> bool:
    dest = out / lib / path
    if dest.exists() and dest.stat().st_size == size:
        return False
    info = LIBRARIES[lib]
    url = f"https://raw.githubusercontent.com/{info['repo']}/{info['sha']}/{urllib.parse.quote(path)}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "paperwork-audio-fetch"})
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
            if tmp.stat().st_size != size:
                raise OSError(f"size mismatch {tmp.stat().st_size} != {size}")
            tmp.rename(dest)
            return True
        except OSError as e:  # includes URLError
            print(f"  retry {attempt + 1} {path}: {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    raise SystemExit(f"failed: {url}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--only", choices=sorted(LIBRARIES))
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    total = 0
    for lib in LIBRARIES:
        if a.only and lib != a.only:
            continue
        blobs = tree(lib, a.out / "_trees")
        pats = [re.compile(p) for (l, p) in SELECTION if l == lib]
        chosen = [b for b in blobs if any(p.fullmatch(b["path"]) for p in pats)]
        size = sum(b["size"] for b in chosen)
        total += size
        print(f"{lib}: {len(chosen)} files, {size / 1e6:.1f} MB")
        if a.dry_run:
            continue
        for i, b in enumerate(chosen):
            if download(lib, b["path"], b["size"], a.out):
                print(f"  [{i + 1}/{len(chosen)}] {b['path']}")
    print(f"total {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
