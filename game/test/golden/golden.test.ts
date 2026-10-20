// The frozen M0 golden integration set (10 §15.10): the reference model reproduces it byte for byte, it is
// frozen (a changed file needs a version bump), and every record in it round-trips through the generated
// decoders and encoders.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Reader } from '../../src/shared/gen/codec.ts';
import { parseClosureLog, readSaveContainer, validateSaveHeader } from '../../src/shared/gen/container.ts';
import { decodePacket, PacketFlags } from '../../src/shared/gen/packet.ts';
import { DigestResultCodec, InspectResultCodec, StateHashCodec } from '../../src/shared/gen/projections.ts';
import { SCHEMA_HASH } from '../../src/shared/gen/schema.ts';
import { decodeAll, encodeAll, UI_CODECS } from '../helpers/packets.ts';
import { type Golden, goldenFiles } from './build/files.ts';
import {
  committedFiles,
  externalFiles,
  filesDigest,
  GAME_DIR,
  M0,
  type Manifest,
  readVersions,
} from './build/main.ts';
import { loadProtos } from './model/protos.ts';
import { World } from './model/world.ts';
import { hex64 } from './model/xxh64.ts';

const read = (p: string) => new Uint8Array(readFileSync(join(M0, p)));
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const manifest = (): Manifest => JSON.parse(readFileSync(join(M0, 'MANIFEST.json'), 'utf8')) as Manifest;

describe('the golden set is frozen', () => {
  it("lists exactly its files, with their SHA-256, and the tiny atlas's", () => {
    const m = manifest();
    expect(committedFiles()).toEqual(Object.keys(m.files).sort());
    for (const [p, h] of Object.entries(m.files)) expect(sha256(read(p)), p).toBe(h);
    expect(externalFiles(), 'the tiny atlas changed: review, then --write --bump').toEqual(m.external);
  });

  it('records the manifest in its version ledger: a changed file needs a version bump', () => {
    const m = manifest();
    const versions = readVersions();
    const latest = versions[versions.length - 1];
    expect(latest?.version, 'MANIFEST.json names the latest version').toBe(m.version);
    expect(
      filesDigest(m.files, m.external),
      'the files changed without a version bump: review, then --write --bump',
    ).toBe(latest?.digest);
    versions.forEach((v, i) => {
      expect(v.version).toBe(i + 1);
    });
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
  it('the closure log: 600 ticks, a digest per tick, its blob', () => {
    const log = parseClosureLog(read('closure-log.pwlog'));
    expect(log.header.start_tick).toBe(0);
    expect(log.header.end_tick).toBe(600);
    expect(log.digests.length).toBe(600);
    expect(log.blobs.length).toBe(1);
    const digests = new TextDecoder().decode(read('digests.txt')).trim().split('\n').slice(1);
    digests.forEach((line, i) => {
      expect(line).toBe(`${i + 1} ${hex64(log.digests[i] as bigint)}`);
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
    expect((ex.sim_abi_version as () => number)()).toBe(1);
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
  });

  it('is a version-2 manifest of rgba8 pages that exist with their declared sizes', () => {
    const m = sprites();
    expect(m.version).toBe(2);
    m.pages.forEach((pages: { files: string[]; bytes: number[] }[], ai: number) => {
      expect(m.arrays[ai].codec).toBe('rgba8');
      for (const page of pages) page.files.forEach((f, i) => expect(atlas(f).length, f).toBe(page.bytes[i]));
    });
  });
});

void Reader;
