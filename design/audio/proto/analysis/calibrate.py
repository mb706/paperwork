"""Calibrate a piece's channel trims from a stems render.

    gamedev-python -I design/audio/proto/analysis/calibrate.py <render>.notes.json <piece.js> [--apply]

Reads the per-channel loudness that render.mjs measured in the page (BS.1770, gated, relative to
the mix) and the piece's TARGETS (relative levels the balance should have), and prints each
channel's error. With --apply it rewrites the piece's `export const TRIMS = {...}` table, moving each
trim by 90% of its error (the mix changes as trims change, so two or three rounds converge).
"""

import json
import re
import sys
from pathlib import Path

# The balance of each era, in LU relative to the mix while the channel plays (gated loudness).
TARGETS = {
    "era1": {"piano": -7.0, "clarinet": -8.5, "violins": -13.5, "violas": -14.5, "celli": -15.5, "bass": -17.5, "harp": -12.5, "glock": -19.5},
    "era2": {"marimbaA": -9.8, "marimbaB": -9.8, "vibes": -10.6, "piano": -6.4, "organ": -9.4, "echo": -10.6, "drone": -14.3, "bell": -10.5},
    "takeoff": {"piano": -12.2, "pianoL": -10.9, "pianoR": -10.9, "vibes": -13.0, "fmpiano": -12.7, "glock": -20.2, "sine": -17.0,
                "violins": -16.2, "violas": -14.4, "celli": -16.4, "bass": -22.4, "glass": -17.3},
}


def main() -> None:
    notes = Path(sys.argv[1])
    piece = Path(sys.argv[2])
    apply = "--apply" in sys.argv
    data = json.loads(notes.read_text())
    loud = data["stemLoudness"]
    mix = loud["mix"]["I"]
    key = piece.stem
    targets = TARGETS[key]
    src = piece.read_text()
    m = re.search(r"export const TRIMS = \{\n(.*?)\n\};", src, re.S)
    trims = {k: float(v) for k, v in re.findall(r"^\s+(\w+): (-?[\d.]+),?$", m.group(1), re.M)}
    worst = 0.0
    for ch, tgt in targets.items():
        if ch not in loud or loud[ch]["I"] is None or loud[ch]["I"] == float("-inf"):
            continue
        rel = loud[ch]["I"] - mix
        err = tgt - rel
        worst = max(worst, abs(err))
        print(f"  {ch:10s} now {rel:+6.1f} LU, target {tgt:+6.1f}, error {err:+5.1f} -> trim {trims[ch]:+6.1f} -> {trims[ch] + 0.9 * err:+6.1f}")
        if apply:
            trims[ch] = round(trims[ch] + 0.9 * err, 1)
    print(f"{key}: mix {mix:.1f} LUFS, worst error {worst:.1f} LU")
    if apply:
        body = "".join(f"  {k}: {v},\n" for k, v in trims.items())
        src = src[: m.start()] + "export const TRIMS = {\n" + body + "};" + src[m.end():]
        piece.write_text(src)


if __name__ == "__main__":
    main()
