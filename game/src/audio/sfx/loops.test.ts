// Working loops through the real voice bank (10 §9.4, §15.6): a burst of one-shots never takes a machine's
// sound away, and a loop whose voice ends unasked is started again from the next snapshot. Also the CPU
// benchmark's load: it must fill all 24 SFX voices (codex C7-r1 findings 2 and 14).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { decodePacket } from '../../shared/gen/packet.ts';
import { BankClient, type PortLike } from '../bank-client.ts';
import { makeRng } from '../core/rng.ts';
import { encodePacket } from '../feed/encode.ts';
import { GenPacketView } from '../feed/gen.ts';
import type { ProtoInfo, WorkingRecord } from '../feed/types.ts';
import type { SoundEntry, SoundsManifest } from '../loading/manifest.ts';
import { sfxLoad, withLoopAliases } from '../offline.ts';
import { BankCore } from '../worklet/bank-core.ts';
import type { FromBank, ToBank } from '../worklet/protocol.ts';
import { SfxSystem } from './sfx.ts';
import { SoundTable } from './sounds.ts';

const SR = 32000;

/** A bank on a synchronous port: replies, and the `ended` report after each message, as bank.ts posts them. */
function bank() {
  const core = new BankCore({ sampleRate: SR });
  const port: PortLike = {
    onmessage: null,
    postMessage(m: ToBank) {
      const deliver = (data: FromBank) => port.onmessage?.({ data } as MessageEvent<FromBank>);
      const r = core.onMessage(m);
      if (r) deliver(r);
      const e = core.takeEnded();
      if (e) deliver(e);
    },
  };
  return { core, client: new BankClient(port) };
}

/** Loads every sound's files into the core as synthetic buffers (a steady level, loops one second long). */
function load(core: BankCore, table: SoundTable): void {
  let id = 1;
  for (const s of table.byName.values())
    for (const f of s.def.files) {
      const len = f.loopEnd ? f.loopEnd + 1600 : SR / 2;
      core.onMessage({ t: 'buf', id, chans: [new Int16Array(len).fill(3000)], rate: SR });
      s.variants.push({ id, len, loopStart: f.loopStart ?? 0, loopEnd: f.loopEnd ?? 0 });
      id++;
    }
}

const outs = () =>
  Array.from({ length: BankCore.outputs() }, () => [new Float32Array(128), new Float32Array(128)]);
function renderFor(core: BankCore, clock: { t: number }, seconds: number, each?: (t: number) => void) {
  const o = outs();
  const end = clock.t + seconds;
  let nextTick = clock.t;
  while (clock.t < end) {
    if (each && clock.t >= nextTick) {
      each(clock.t);
      nextTick += 0.1;
    }
    core.process(o, Math.round(clock.t * SR));
    clock.t += 128 / SR;
  }
}

const file = (loop: boolean) => ({
  file: 'x',
  len: SR,
  channels: 1 as const,
  fp: { at: 0, data: [] },
  bytes: { ogg: 1, m4a: 1 },
  ...(loop ? { loopStart: 1600, loopEnd: SR } : {}),
});
const entry = (p: Partial<SoundEntry> & { loop: boolean }): SoundEntry => ({
  bus: 'effects',
  gainDb: 0,
  pitchJitter: 0,
  gainJitterDb: 0,
  rate: null,
  voices: 4,
  priority: 1,
  positional: true,
  licence: 'test',
  ...p,
  files: [file(p.loop)],
});

const PROTO: ProtoInfo = { entitySize: () => 1, minedKind: () => 'entity', isDeveloperReason: () => false };

describe('working loops on the voice bank', () => {
  test('a burst never takes their voices; loops lost unasked start again from the next snapshot (C7-r1 2)', () => {
    const manifest: SoundsManifest = {
      version: 1,
      rate: SR,
      prototypesHash: null,
      sounds: {
        boom: entry({ loop: false, voices: 24, priority: 9 }),
        'hum-a': entry({ loop: true, bus: 'environment', voices: 1, priority: 0 }),
        'hum-b': entry({ loop: true, bus: 'environment', voices: 1, priority: 0 }),
      },
      events: {},
      working: {},
      music: { eras: [] },
    };
    const { core, client } = bank();
    const table = new SoundTable(manifest);
    load(core, table);
    const clock = { t: 0 };
    const sfx = new SfxSystem(client, table, () => clock.t, PROTO, makeRng(3));
    const view = new GenPacketView();
    const hums = [...table.byName.values()].filter((s) => s.def.loop).map((s) => s.id);
    const snapshot: WorkingRecord[] = hums.map((sound) => ({ sound, n: 10, cx: 0, cy: 0, wsum: 5 }));
    let tick = 0;
    const packet = () => sfx.onPacket(view.set(decodePacket(encodePacket(1, ++tick, [], snapshot))));
    packet();
    client.flush();
    renderFor(core, clock, 0.2);
    expect(core.loopHandles().length).toBe(2);
    // forty louder, higher-priority one-shots at once
    for (let i = 0; i < 40; i++) sfx.play('boom', i, 0);
    renderFor(core, clock, 0.2);
    expect(core.loopHandles().length).toBe(2);
    expect(core.stats().activeSfx).toBe(24);
    // the loops vanish from under the SFX system (here: cleared behind its back)
    const before = core.loopHandles();
    core.onMessage({ t: 'clear', slot: 'sfx', fade: 0.01 });
    renderFor(core, clock, 0.1);
    expect(core.loopHandles()).toEqual([]);
    packet(); // the snapshot goes on naming them: on its own it changes nothing
    expect(core.loopHandles()).toEqual([]);
    sfx.tick(); // the scheduler's tick polls: the bank reports them
    expect(sfx.stats.lost).toBe(2);
    packet();
    client.flush();
    renderFor(core, clock, 0.2);
    const after = core.loopHandles();
    expect(after.length).toBe(2);
    expect(after.some((h) => before.includes(h))).toBe(false);
  });
});

// the built manifest of data/engine/sounds.yaml (the audio asset build)
const SOUNDS_JSON = join(import.meta.dirname, '../../../public/audio/sounds.json');

describe("the CPU benchmark's SFX load", () => {
  test.skipIf(!existsSync(SOUNDS_JSON))('fills all 24 SFX voices (C7-r1 14)', () => {
    // the benchmark's twelve working sounds (aliases of the M0 loops, as offline.ts makes them)
    const manifest = withLoopAliases(JSON.parse(readFileSync(SOUNDS_JSON, 'utf8')) as SoundsManifest, 12);
    const { core, client } = bank();
    const table = new SoundTable(manifest);
    load(core, table);
    const clock = { t: 0 };
    const proto: ProtoInfo = {
      entitySize: (p) => 1 + (p % 5),
      minedKind: (p) => (p % 2 === 1 ? 'resource' : 'entity'),
      isDeveloperReason: () => false,
    };
    const sfx = new SfxSystem(client, table, () => clock.t, proto, makeRng(7));
    const step = sfxLoad({ loops: 12, machines: 100, shotsPerSec: 6, burst: 20, burstEvery: 5 }, sfx, table);
    renderFor(core, clock, 12, (t) => {
      step(t);
      client.flush();
    });
    expect(core.stats().maxSfx).toBe(24);
  });
});
