// The frozen M0 golden integration set (10 §15.10): the reference model reproduces it byte for byte, it is
// frozen (a changed file needs a version bump), and every record in it round-trips through the generated
// decoders and encoders.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { SaveOutputCodec } from '../../src/shared/gen/abi.ts';
import { Reader } from '../../src/shared/gen/codec.ts';
import { parseClosureLog, readSaveContainer, validateSaveHeader } from '../../src/shared/gen/container.ts';
import { decodePacket, PacketFlags } from '../../src/shared/gen/packet.ts';
import { DigestResultCodec, InspectResultCodec, StateHashCodec } from '../../src/shared/gen/projections.ts';
import { ABI_VERSION, SCHEMA_HASH } from '../../src/shared/gen/schema.ts';
import { decodeAll, encodeAll, UI_CODECS } from '../helpers/packets.ts';
import { type Golden, goldenFiles } from './build/files.ts';
import {
  committedFiles,
  contractFiles,
  externalFiles,
  filesDigest,
  GAME_DIR,
  ledgerProblems,
  M0,
  type Manifest,
  readVersions,
} from './build/main.ts';
import { dumpOut, type IndexedCall, replay } from './build/traces.ts';
import { loadProtos } from './model/protos.ts';
import { Sim } from './model/sim.ts';
import { World } from './model/world.ts';
import { hex64, u64le, xxh64 } from './model/xxh64.ts';

const read = (p: string) => new Uint8Array(readFileSync(join(M0, p)));

/** states/tick-NNNN.sections: sim_save's output (abi.yaml SaveOutput), its frames and lineage. */
class SaveOutputReader {
  frames: { id: number; version: number; data: Uint8Array }[];
  r: bigint;
  constructor(b: Uint8Array) {
    const v = SaveOutputCodec.decode(b);
    this.frames = v.sections.map((f) => ({ id: f.id, version: f.version, data: f.data }));
    this.r = v.r;
  }
}
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const manifest = (): Manifest => JSON.parse(readFileSync(join(M0, 'MANIFEST.json'), 'utf8')) as Manifest;

describe('the golden set is frozen', () => {
  it("lists exactly its files, with their SHA-256, the tiny atlas's and the contract inputs'", () => {
    const m = manifest();
    expect(committedFiles()).toEqual(Object.keys(m.files).sort());
    for (const [p, h] of Object.entries(m.files)) expect(sha256(read(p)), p).toBe(h);
    expect(externalFiles(), 'the tiny atlas changed: review, then --write --bump').toEqual(m.external);
    expect(
      contractFiles(),
      'the README or the reference model changed: review, then --write --bump value --approval …',
    ).toEqual(m.contract);
  });

  it('records the manifest in its version ledger: a changed file needs a version bump', () => {
    const m = manifest();
    const versions = readVersions();
    const latest = versions[versions.length - 1];
    expect(latest?.version, 'MANIFEST.json names the latest version').toBe(m.version);
    expect(
      filesDigest(m.files, m.external, m.contract),
      'the files changed without a version bump: review, then --write --bump',
    ).toBe(latest?.digest);
    // Decision 14: every bump since version 2 has a kind, a value bump an approval, a real reason, and the lines
    // form a hash chain.
    expect(ledgerProblems(versions)).toEqual([]);
  });

  it('keeps its history append-only against the reviewed base (dev, or the last commit on dev)', () => {
    const git = (args: string[]) => spawnSync('git', args, { cwd: GAME_DIR, encoding: 'utf8' });
    if (git(['rev-parse', '--git-dir']).status !== 0) return; // not a git checkout
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
    const hasDev = git(['rev-parse', '--verify', '--quiet', 'refs/heads/dev']).status === 0;
    const base = branch === 'dev' || !hasDev ? 'HEAD' : git(['merge-base', 'HEAD', 'dev']).stdout.trim();
    const shown = git(['show', `${base}:game/test/golden/m0/VERSIONS.txt`]);
    if (shown.status !== 0) return; // the base has no ledger yet
    const reviewed = readVersions(shown.stdout).map((v) => v.line);
    const now = readVersions().map((v) => v.line);
    expect(now.slice(0, reviewed.length), 'a reviewed ledger line was edited or removed').toEqual(reviewed);
  });

  it('was built against this schema', () => {
    expect(
      manifest().schemaHash,
      'the schema changed: regenerate the golden set (--write), review, --bump',
    ).toBe(SCHEMA_HASH);
  });
});

describe('the reference model reproduces the golden set', () => {
  let g: Golden;
  beforeAll(() => {
    g = goldenFiles();
  }, 120_000);

  it('byte for byte, every file', () => {
    const have = committedFiles();
    expect([...g.files.keys()].sort()).toEqual(have);
    for (const [p, b] of g.files) expect(sha256(b), p).toBe(sha256(read(p)));
  });

  it('runs every scenario step to the outcome its report states', () => {
    const text = new TextDecoder().decode(read('scenario.txt'));
    for (const o of g.run.outcomes) expect(text).toContain(`seq ${String(o.seq).padStart(3)}  ${o.result}`);
  });
});

describe('the golden files decode with the generated readers', () => {
  it('the closure log: 3,600 ticks (a whole shard cycle), a digest per tick, its blob', () => {
    const log = parseClosureLog(read('closure-log.pwlog'));
    expect(log.header.start_tick).toBe(0);
    expect(log.header.end_tick).toBe(3600);
    expect(log.digests.length).toBe(3600);
    expect(log.blobs.length).toBe(1);
    const digests = new TextDecoder().decode(read('digests.txt')).trim().split('\n').slice(1);
    digests.forEach((line, i) => {
      expect(line.split(' ').slice(0, 2).join(' ')).toBe(`${i + 1} ${hex64(log.digests[i] as bigint)}`);
    });
    expect(hex64(log.header.start_state_hash)).toBe(
      new TextDecoder().decode(read('states/hashes.txt')).split('\n')[1]?.split(' ')[2],
    );
    // The valid variants a reader must accept (§8.5).
    expect(parseClosureLog(read('logs/empty.pwlog')).records.length).toBe(0);
    expect(parseClosureLog(read('logs/no-digests.pwlog')).digests.length).toBe(0);
  });

  it('the start save: a valid header, sections that load, the state hash of states/hashes.txt', () => {
    const { header, frames } = readSaveContainer(read('start.save'));
    validateSaveHeader(header);
    expect(header.schemaHash).toBe(SCHEMA_HASH);
    expect(header.prototypesHash).toBe(sha256(read('protos/prototypes.bin')));
    const w = World.load(loadProtos(read('protos/prototypes.bin')), frames);
    const want = new TextDecoder().decode(read('states/hashes.txt')).split('\n')[1]?.split(' ')[2];
    expect(hex64(w.stateHash().hash)).toBe(want);
  });

  it.each(['tick-0000-full', 'tick-0000', 'tick-0001', 'tick-0600'])(
    'packet %s round-trips through the decoders and encoders',
    (name) => {
      const bytes = read(`packets/${name}.bin`);
      expect(encodeAll(decodeAll(bytes))).toEqual(bytes);
      const p = decodePacket(bytes);
      expect(p.header.state_gen).toBe(0); // the module leaves state_gen and view_seq for the shell (§15.4)
      expect(p.header.view_seq).toBe(0);
      expect((p.header.flags & PacketFlags.full) !== 0).toBe(name === 'tick-0000-full');
    },
  );

  it('every projection record and query result round-trips', () => {
    let n = 0;
    for (const p of committedFiles().filter((x) => x.startsWith('projections/') && x.endsWith('.bin'))) {
      const name = p.split('/').pop() as string;
      const kind = name.startsWith('hud')
        ? 1
        : name.startsWith('character')
          ? 2
          : name.startsWith('inventory')
            ? 3
            : name.startsWith('entity-panel')
              ? 4
              : name.startsWith('hover')
                ? 5
                : name.startsWith('stats')
                  ? 7
                  : 10;
      const c = UI_CODECS.get(kind) as { decode(b: Uint8Array): unknown; encode(v: unknown): Uint8Array };
      const b = read(p);
      expect(c.encode(c.decode(b)), p).toEqual(b);
      n++;
    }
    for (const p of committedFiles().filter((x) => x.startsWith('queries/') && x.endsWith('.bin'))) {
      const c = p.includes('inspect')
        ? InspectResultCodec
        : p.includes('hash')
          ? StateHashCodec
          : DigestResultCodec;
      const b = read(p);
      expect(
        (c as { encode(v: unknown): Uint8Array }).encode((c as { decode(b: Uint8Array): unknown }).decode(b)),
        p,
      ).toEqual(b);
      n++;
    }
    expect(n).toBeGreaterThan(100);
  });

  it('the negative cases are indexed, each with its file', () => {
    const index = JSON.parse(new TextDecoder().decode(read('negative/index.json'))) as {
      file: string | null;
      expect: string;
    }[];
    for (const c of index) if (c.file) expect(committedFiles()).toContain(`negative/${c.file}`);
    expect(index.filter((c) => c.file?.startsWith('closures/')).length).toBeGreaterThanOrEqual(17);
  });

  it('the stale module is a valid module whose schema hash is not this schema', async () => {
    const bytes = read('negative/module/stale-schema.wasm');
    expect(WebAssembly.validate(bytes)).toBe(true);
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const ex = instance.exports as Record<string, unknown>;
    const mem = new Uint8Array((ex.memory as WebAssembly.Memory).buffer);
    const at = (ex.sim_schema_hash as () => number)();
    const len = new DataView(mem.buffer).getUint32(at, true);
    expect(len).toBe(32);
    const hash = Buffer.from(mem.subarray(at + 4, at + 36)).toString('hex');
    expect(hash).not.toBe(SCHEMA_HASH);
    expect((ex.sim_abi_version as () => number)()).toBe(ABI_VERSION);
  });
});

describe('the digests (§4.8; README rules 37–41)', () => {
  const lines = () =>
    new TextDecoder()
      .decode(read('digests.txt'))
      .trim()
      .split('\n')
      .slice(1)
      .map((l) => l.split(' '));
  const big = (h: string) => BigInt(`0x${h}`);

  it('r rolls from the start lineage: r_t = XXH64(r_t−1 ‖ d_t ‖ slice_t) at every tick', () => {
    let r = big(readSaveContainer(read('start.save')).header.lineage);
    for (const [t, d, slice, rt] of lines()) {
      const b = new Uint8Array(24);
      b.set(u64le(r), 0);
      b.set(u64le(big(d as string)), 8);
      b.set(u64le(big(slice as string)), 16);
      r = xxh64(b);
      expect(hex64(r), `tick ${t}`).toBe(rt);
    }
  });

  it("d_t is XXH64 of §4.8's byte sequence, assembled here by hand at the state ticks", () => {
    const pre = new Map(
      new TextDecoder()
        .decode(read('digest-preimages.txt'))
        .trim()
        .split('\n')
        .slice(1)
        .map((l) => l.split(' ') as [string, string]),
    );
    const log = parseClosureLog(read('closure-log.pwlog'));
    const protos = loadProtos(read('protos/prototypes.bin'));
    for (const t of [1, 2, 300, 600, 3600]) {
      const bytes = new Uint8Array(Buffer.from(pre.get(String(t)) as string, 'hex'));
      expect(hex64(xxh64(bytes)), `tick ${t}`).toBe(lines()[t - 1]?.[1]);
      // §4.8: u32 tick, u64 closure hash, (no RNG streams), u32 entity count, the two counter lists with their
      // u32 counts, per online player u16 index, f64 x, f64 y, u32 inventory version, u16 research, f64 progress.
      const out = new SaveOutputReader(read(`states/tick-${String(t).padStart(4, '0')}.sections`));
      const w = World.load(protos, out.frames);
      const v = new DataView(bytes.buffer);
      let at = 0;
      expect(v.getUint32(at, true)).toBe(t);
      at += 4;
      const closure = log.records.find((x) => x.tick === t)?.closure ?? new Uint8Array();
      expect(v.getBigUint64(at, true)).toBe(xxh64(closure));
      at += 8;
      expect(v.getUint32(at, true)).toBe(w.liveEntities().length);
      at += 4;
      for (let list = 0; list < 2; list++) {
        const n = v.getUint32(at, true);
        at += 4 + n * 12;
      }
      for (const p of w.players.filter((q) => q.online).sort((a, b) => a.index - b.index)) {
        expect(v.getUint16(at, true)).toBe(p.index);
        expect(v.getFloat64(at + 2, true)).toBe(p.x);
        expect(v.getFloat64(at + 10, true)).toBe(p.y);
        expect(v.getUint32(at + 18, true)).toBe(p.inventory_version);
        at += 22;
      }
      expect(v.getUint16(at, true)).toBe(0xffff);
      expect(v.getFloat64(at + 2, true)).toBe(0);
      expect(at + 10).toBe(bytes.length);
    }
  });

  it("slices/tick-0600.txt's shard 600 is tick 600's slice, and the members file lists each member once", () => {
    const slices = new TextDecoder().decode(read('slices/tick-0600.txt')).trim().split('\n').slice(1);
    expect(slices.length).toBe(3600);
    expect(slices[600]?.split(' ')[1]).toBe(lines()[599]?.[2]);
    const members = new TextDecoder()
      .decode(read('slices/tick-0600-members.txt'))
      .trim()
      .split('\n')
      .slice(1);
    const keys = members.map((l) => l.split(' ').slice(0, 2).join(' '));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('a save carries its lineage: loaded at tick 300, ticks 301–3,600 give the same d_t and r_t', () => {
    const protos = loadProtos(read('protos/prototypes.bin'));
    const out = new SaveOutputReader(read('states/tick-0300.sections'));
    const sim = new Sim(World.load(protos, out.frames), out.r);
    const log = parseClosureLog(read('closure-log.pwlog'));
    const blobs = new Set(log.blobs.map((b) => Buffer.from(b.sha256.bytes).toString('hex')));
    const all = lines();
    for (let t = 301; t <= 3600; t++) {
      const closure = log.records.find((x) => x.tick === t)?.closure ?? new Uint8Array();
      expect(sim.tick(closure, blobs).status).toBe(0);
      expect(hex64(sim.lastDigest), `d at ${t}`).toBe(all[t - 1]?.[1]);
      expect(hex64(sim.r), `r at ${t}`).toBe(all[t - 1]?.[3]);
    }
  }, 60_000);
});

describe('the ABI traces (abi/traces.json)', () => {
  const index = () =>
    JSON.parse(new TextDecoder().decode(read('abi/traces.json'))) as {
      traces: { name: string; calls: IndexedCall[] }[];
    };

  it('every trace replays against a fresh module: statuses, envelopes and state assertions', () => {
    for (const t of index().traces) expect(replay(t.calls, read), t.name).toEqual([]);
  });

  it('the remap load lands on the golden start state, with a new lineage over it', () => {
    const traces = index().traces;
    const boot = traces.find((t) => t.name === 'boot-and-order')?.calls ?? [];
    const remap = traces.find((t) => t.name === 'remap-load')?.calls ?? [];
    const out = (calls: IndexedCall[], call: string) =>
      read(calls.find((c) => c.call === call)?.out as string);
    expect(out(remap, 'sim_state_hash')).toEqual(out(boot, 'sim_state_hash'));
  });

  it('every envelope and packet decodes with its generated codec', () => {
    for (const t of index().traces)
      for (const c of t.calls)
        if (c.out) {
          const b = read(c.out);
          if (c.call === 'sim_extract') expect(encodeAll(decodeAll(b))).toEqual(b);
          else expect(() => dumpOut(c.call, b)).not.toThrow();
        }
  });
});

describe("the tiny atlas (C6's fixture, test/fixtures/sprites/)", () => {
  const atlas = (p: string) => new Uint8Array(readFileSync(join(GAME_DIR, 'test/fixtures/sprites', p)));
  const sprites = () => JSON.parse(new TextDecoder().decode(atlas('manifest.json')));

  it('has a set for every sprite name the golden packets draw (or its greybox) and every M0 icon', () => {
    const m = sprites();
    const protos = JSON.parse(new TextDecoder().decode(read('protos/prototypes.json')));
    const need = [
      ...protos.entity.map((e: { sprite: string }) => e.sprite),
      ...protos.entity
        .filter((e: { type: string }) => e.type !== 'character')
        .map((e: { name: string }) => `greybox/${e.name}`),
      ...protos.resource.map((r: { sprite: string }) => r.sprite),
      ...protos.item.map((i: { icon: string }) => i.icon),
    ];
    for (const name of need) expect(Object.keys(m.sets), name).toContain(name);
    // Every set-name table entry prototypes.json resolves through (§15.7 lookup contracts) has its set too.
    for (const name of protos.treeSpecies as string[]) expect(Object.keys(m.sets), name).toContain(name);
  });

  it("was built for the golden prototypes: §15.7's prototypesHash check passes without a bypass", () => {
    // GATE-r1 finding 12. Regenerate with `gamedev-python scripts/assets/fixture.py` after `npm run data`.
    expect(sprites().prototypesHash).toBe(sha256(read('protos/prototypes.bin')));
  });

  it('is a version-2 manifest of rgba8 pages that exist with their declared sizes', () => {
    const m = sprites();
    expect(m.version).toBe(2);
    m.pages.forEach((pages: { files: string[]; bytes: number[] }[], ai: number) => {
      expect(m.arrays[ai].codec).toBe('rgba8');
      for (const page of pages)
        page.files.forEach((f, i) => {
          expect(atlas(f).length, f).toBe(page.bytes[i]);
        });
    });
  });
});

void Reader;
