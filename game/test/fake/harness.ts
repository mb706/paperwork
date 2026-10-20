// Drives the fake sim (src/simworker/fake.ts) in-process through the §3.2 protocol, with a manual clock, for
// tests and for the debug snapshot.

import { join } from 'node:path';
import { formatDiagnostic } from '../../scripts/data-stage/diagnostics.ts';
import { runDataStage } from '../../scripts/data-stage/index.ts';
import { NewWorldCodec } from '../../src/shared/gen/abi.ts';
import { type Action, actionBytes } from '../../src/shared/gen/actions.ts';
import type { PrototypesJson } from '../../src/shared/gen/protos.ts';
import { PROTOCOL_VERSION, SCHEMA_HASH } from '../../src/shared/gen/schema.ts';
import type { MainToSim, SimToMain } from '../../src/shared/protocol.ts';
import { FakeSim } from '../../src/simworker/fake.ts';
import { GAME, SPEC } from '../helpers/paths.ts';

let cached: PrototypesJson | null = null;
let cachedBin: Uint8Array | null = null;

/** The fake's prototype build: the data stage's M1 filter and the sound fixture, as /data/fake/ serves it. */
export function fakeProtos(): PrototypesJson {
  if (cached) return cached;
  const r = runDataStage({
    gameDir: GAME,
    specDir: SPEC,
    manifest: 'm1',
    allowIncomplete: true,
    schemaHash: SCHEMA_HASH,
    protocolVersion: PROTOCOL_VERSION,
    // As the dev server builds it (scripts/fake-data-plugin.ts): with a complete sound table.
    engineFiles: { 'sounds.yaml': join(GAME, 'test', 'fixtures', 'fake', 'sounds.yaml') },
  });
  if (r.diagnostics.errors.length > 0) throw new Error(r.diagnostics.errors.map(formatDiagnostic).join('\n'));
  const bytes = r.outputs.get('public/data/prototypes.json');
  if (!bytes) throw new Error('no prototypes.json');
  cached = JSON.parse(new TextDecoder().decode(bytes)) as PrototypesJson;
  cachedBin = r.outputs.get('public/data/prototypes.bin') ?? null;
  return cached;
}

/** The same build's prototypes.bin. */
export function fakeProtosBin(): Uint8Array | null {
  fakeProtos();
  return cachedBin;
}

export class Harness {
  readonly sim: FakeSim;
  readonly out: SimToMain[] = [];
  readonly packets: Uint8Array[] = [];
  private seq = 0;
  /** The manual clock (ms) and the wakes the fake scheduled on it. */
  clock = 0;
  private timers: { at: number; f: () => void }[] = [];
  constructor(protos = fakeProtos()) {
    this.sim = new FakeSim({
      post: (m) => {
        this.out.push(m);
        if (m.t === 'pkt') {
          const len = new DataView(m.buf).getUint32(24, true);
          this.packets.push(new Uint8Array(m.buf.slice(0, len)));
          void this.sim.handle({ t: 'ack', buf: m.buf });
        }
      },
      now: () => this.clock,
      wake: (ms, f) => {
        const t = { at: this.clock + ms, f };
        this.timers.push(t);
        return t;
      },
      cancel: (h) => {
        this.timers = this.timers.filter((t) => t !== h);
      },
      protos: async () => protos,
      protosBin: async () => fakeProtosBin(),
    });
  }
  async send(m: MainToSim): Promise<void> {
    await this.sim.handle(m);
  }
  /** Boots, pauses (test mode) and creates a world in generation `gen`. */
  async start(gen = 1, seed = 1945): Promise<void> {
    await this.send({
      t: 'boot',
      build: { build: 'm1', buildHash: '0'.repeat(64), dev: true },
      module: null,
      ioPort: null,
      genPorts: [],
    });
    await this.send({ t: 'seq', op: 'pause' });
    await this.send({ t: 'world', gen, op: 'new', settings: { ...NewWorldCodec.defaults(), seed } });
  }
  async act(gen: number, ...actions: Action[]): Promise<void> {
    const parts = actions.map(actionBytes);
    const total = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      total.set(p, at);
      at += p.length;
    }
    await this.send({ t: 'act', gen, firstSeq: this.seq + 1, actions: total.buffer });
    this.seq += actions.length;
  }
  /**
   * Advances the manual clock in 1-ms steps, running the wakes due at each. A wake scheduled while they run
   * waits for the next step, as a self-posted message does: so a short wait costs 1 ms, never a spin.
   */
  advance(ms: number): void {
    for (let i = 0; i < ms; i++) {
      this.clock += 1;
      const due = this.timers.filter((x) => x.at <= this.clock);
      this.timers = this.timers.filter((x) => x.at > this.clock);
      for (const t of due) t.f();
    }
  }
  async step(n: number): Promise<Uint8Array> {
    await this.send({ t: 'seq', op: { step: n } });
    return this.packets[this.packets.length - 1] as Uint8Array;
  }
}
