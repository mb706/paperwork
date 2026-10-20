"""Match a shipping pack's instrument levels to the full pack, empirically.

    gamedev-python -I design/audio/proto/analysis/packmatch.py <full>.notes.json <ship>.notes.json <ship>/instruments.json

Both renders must be the same piece and seed with "stems" on, one from each pack. For every channel,
the loudness difference (full - ship) is added to that instrument's makeup_db in the shipping
manifest. Mono downmixes of spaced-pair recordings change the spectrum (comb filtering), and a single
velocity layer cannot reproduce the full pack's crossfade, so this closes what prep_samples.py cannot
compute. One round gets within about 0.5 dB.
"""

import json
import sys
from pathlib import Path

# channel -> instrument, where they differ
CHANNEL_INSTRUMENT = {"marimbaA": "marimba", "marimbaB": "marimba", "pianoL": "piano", "pianoR": "piano"}


def main() -> None:
    full = json.loads(Path(sys.argv[1]).read_text())["stemLoudness"]
    ship = json.loads(Path(sys.argv[2]).read_text())["stemLoudness"]
    man_path = Path(sys.argv[3])
    man = json.loads(man_path.read_text())
    diffs: dict[str, list[float]] = {}
    for ch, v in full.items():
        if ch == "mix" or ch.startswith("reverb") or ch not in ship:
            continue
        inst = CHANNEL_INSTRUMENT.get(ch, ch)
        if inst not in man or v["I"] in (None, float("-inf")) or ship[ch]["I"] in (None, float("-inf")):
            continue
        diffs.setdefault(inst, []).append(v["I"] - ship[ch]["I"])
    for inst, ds in diffs.items():
        d = sum(ds) / len(ds)
        old = man[inst].get("makeup_db", 0.0)
        man[inst]["makeup_db"] = round(old + d, 2)
        print(f"  {inst:10s} full - ship = {d:+5.1f} dB -> makeup {old:+5.2f} -> {man[inst]['makeup_db']:+5.2f}")
    man_path.write_text(json.dumps(man, indent=1))


if __name__ == "__main__":
    main()
