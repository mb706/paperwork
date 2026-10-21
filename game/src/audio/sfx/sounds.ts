// The sound table (10 §15.6, "Sounds are data"): the asset build's `sounds.json` joined with the data
// stage's sound ids by name. Sound ids are dense u16, sorted by name (code-unit order), so the stand-in
// table below computes the same ids the data stage writes into prototypes.bin; when prototypes.json
// carries the id → name table, `withIds` uses it and refuses a manifest built for other prototypes.

import type { SoundEntry, SoundsManifest } from '../loading/manifest.ts';
import type { FileLoader, Priority } from '../loading/packs.ts';
import { SFX_BUSES } from '../worklet/protocol.ts';

export interface LoadedVariant {
  id: number;
  len: number;
  loopStart: number;
  loopEnd: number;
}

export interface Sound {
  id: number;
  name: string;
  def: SoundEntry;
  bus: number;
  variants: LoadedVariant[];
  /** The variant played last (never twice in a row, A4 §7.3 rule 1). */
  last: number;
  /** Recent play times (s), for the rate limit. */
  recent: number[];
}

const codeUnitOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export class SoundTable {
  readonly byName = new Map<string, Sound>();
  readonly byId: (Sound | undefined)[] = [];
  private warned = new Set<string>();

  readonly manifest: SoundsManifest;

  /** `ids`: the data stage's id → name table (prototypes.json); null: ids by sorted name (the stand-in). */
  constructor(manifest: SoundsManifest, ids: readonly string[] | null = null) {
    this.manifest = manifest;
    const names = ids ?? Object.keys(manifest.sounds).sort(codeUnitOrder);
    names.forEach((name, id) => {
      const def = manifest.sounds[name];
      if (!def) {
        this.warnOnce(name, `audio: sound ${name} has no files in sounds.json; it is silent`);
        return;
      }
      const s: Sound = { id, name, def, bus: SFX_BUSES.indexOf(def.bus), variants: [], last: -1, recent: [] };
      this.byName.set(name, s);
      this.byId[id] = s;
    });
  }

  /** Checks the manifest against the prototypes (10 §15.6): dev builds refuse a mismatch. */
  static check(manifest: SoundsManifest, prototypesHash: string | null): string | null {
    if (!manifest.prototypesHash || !prototypesHash) return null;
    return manifest.prototypesHash === prototypesHash
      ? null
      : `sounds.json was built for prototypes ${manifest.prototypesHash.slice(0, 12)}, not ${prototypesHash.slice(0, 12)}`;
  }

  warnOnce(key: string, msg: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(msg);
  }

  /** Whether `load` has finished: before that, a sound without decoded files is still on its way (C9). */
  loaded = false;

  /** Loads every sound's files into the bank (the SFX load with the first frame of a game, 10 §9.7). */
  async load(files: FileLoader, priority: Priority = 'high'): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const s of this.byName.values()) {
      if (s.variants.length > 0) continue;
      for (const f of s.def.files)
        jobs.push(
          files.load(f, priority).then((r) => {
            if (r)
              s.variants.push({ id: r.id, len: r.len, loopStart: f.loopStart ?? 0, loopEnd: f.loopEnd ?? 0 });
          }),
        );
    }
    await Promise.all(jobs);
    this.loaded = true;
  }

  get(name: string): Sound | undefined {
    const s = this.byName.get(name);
    if (!s) this.warnOnce(name, `audio: no sound named ${name}`);
    return s;
  }
}
