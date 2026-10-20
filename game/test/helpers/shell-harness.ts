// Drives the sim worker's shell (src/simworker/shell.ts) in-process through the §3.2 protocol, with a manual
// clock: the stub module, the real one, or the reference model behind the ABI. Posted messages are copied (the
// shell reuses its message objects); packets are copied, then acked at once unless `hold` keeps them.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NewWorldCodec } from '../../src/shared/gen/abi.ts';
import { Writer } from '../../src/shared/gen/codec.ts';
import { readSaveContainer, type SaveHeader, SectionFrameCodec } from '../../src/shared/gen/container.ts';
import { decodePacket, type Packet } from '../../src/shared/gen/packet.ts';
import type { BuildManifest, MainToSim, SaveMeta, SimToMain } from '../../src/shared/protocol.ts';
import { handshake, type SimInstance } from '../../src/simworker/module.ts';
import { type ShellHost, SimShell } from '../../src/simworker/shell.ts';
import { type ModelExports, modelExports } from './model-module.ts';
import { GAME } from './paths.ts';

export const golden = (p: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(readFileSync(join(GAME, 'test', 'golden', 'm0', p))) as Uint8Array<ArrayBuffer>;
export const goldenProtos = (): Uint8Array => golden('protos/prototypes.bin');
export const sha256hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** A dev build manifest for these prototypes. */
export function manifest(protos = goldenProtos(), extra: Partial<BuildManifest> = {}): BuildManifest {
  return { build: 'm0', buildHash: '0'.repeat(64), dev: true, prototypesHash: sha256hex(protos), ...extra };
}

/** A save container as `world load` takes it: the sections region and the meta (§15.8, §3.2). */
export function loadMessage(container: Uint8Array, name?: string): { sections: ArrayBuffer; meta: SaveMeta } {
  const c = readSaveContainer(container);
  const w = new Writer();
  w.u32(c.frames.length, 'sections');
  for (const f of c.frames) SectionFrameCodec.write(w, f);
  const sections = w.finish().slice().buffer as ArrayBuffer;
  const meta: SaveMeta = {
    lineage: c.header.lineage,
    prototypesHash: c.header.prototypesHash,
    tick: c.header.tick,
    header: c.header as SaveHeader,
  };
  if (name) meta.name = name;
  return { sections, meta };
}

export interface HarnessOptions {
  /** 'stub' (default: the module given to boot), or the reference model behind the ABI. */
  model?: boolean;
  protos?: Uint8Array;
  dev?: boolean;
}

export class ShellHarness {
  readonly shell: SimShell;
  readonly out: SimToMain[] = [];
  readonly packets: { bytes: Uint8Array; packet: Packet }[] = [];
  /** Packets held back (not acked): their buffers. */
  readonly held: ArrayBuffer[] = [];
  hold = false;
  /** The model's exports, when the harness runs the reference model. */
  model: ModelExports | null = null;
  clock = 0;
  /** Wakes run so far (C3-r1 4: a blocked extraction must not spin). */
  fired = 0;
  private timers: { at: number; f: () => void }[] = [];

  constructor(opts: HarnessOptions = {}) {
    const protos = opts.protos ?? goldenProtos();
    const host: ShellHost = {
      post: (m, _transfer) => this.receive(m),
      now: () => this.clock,
      wake: (ms, f) => {
        const t = { at: this.clock + Math.max(ms, 0), f };
        this.timers.push(t);
        return t;
      },
      cancel: (h) => {
        this.timers = this.timers.filter((t) => t !== h);
      },
      protos: async () => protos,
      sha256: async (b) => new Uint8Array(createHash('sha256').update(b).digest()),
    };
    if (opts.model) {
      host.instantiate = async (_m, _hooks, dev) => {
        this.model = modelExports();
        return handshake(this.model as unknown as Record<string, unknown>, null, dev) as SimInstance;
      };
    }
    this.shell = new SimShell(host);
  }

  private receive(m: SimToMain): void {
    if (m.t === 'pkt') {
      const len = new DataView(m.buf).getUint32(24, true);
      const bytes = new Uint8Array(m.buf.slice(0, len));
      this.packets.push({ bytes, packet: decodePacket(bytes) });
      this.out.push({ t: 'pkt', buf: bytes.buffer as ArrayBuffer });
      if (this.hold) this.held.push(m.buf);
      else void this.shell.handle({ t: 'ack', buf: m.buf });
      return;
    }
    this.out.push(structuredClone(m));
  }

  /** Acks every held packet. */
  release(): void {
    for (const b of this.held.splice(0)) void this.shell.handle({ t: 'ack', buf: b });
  }

  async send(m: MainToSim): Promise<void> {
    await this.shell.handle(m);
  }

  /** Messages of one type. */
  of<T extends SimToMain['t']>(t: T): Extract<SimToMain, { t: T }>[] {
    return this.out.filter((m) => m.t === t) as Extract<SimToMain, { t: T }>[];
  }

  last<T extends SimToMain['t']>(t: T): Extract<SimToMain, { t: T }> | undefined {
    const all = this.of(t);
    return all[all.length - 1];
  }

  /** Runs the timers due in the next `ms` milliseconds, 1 ms at a time (a self-post costs one step). */
  advance(ms: number): void {
    for (let i = 0; i < ms; i++) {
      this.clock += 1;
      const due = this.timers.filter((x) => x.at <= this.clock);
      this.timers = this.timers.filter((x) => x.at > this.clock);
      for (const t of due) {
        this.fired += 1;
        t.f();
      }
    }
  }

  /** Boots with `module` (ignored by the model harness). */
  async boot(
    module: WebAssembly.Module | null,
    build = manifest(),
    ports: Partial<MainToSim & { t: 'boot' }> = {},
  ): Promise<void> {
    await this.send({ t: 'boot', build, module, ioPort: null, genPorts: [], ...ports } as MainToSim);
  }

  /** A new world in generation `gen`, paused (test mode). */
  async newWorld(gen = 1, seed = 1945, paused = true): Promise<void> {
    if (paused) await this.send({ t: 'seq', op: 'pause' });
    await this.send({ t: 'world', gen, op: 'new', settings: { ...NewWorldCodec.defaults(), seed } });
  }

  async load(container: Uint8Array, gen = 1, name?: string, paused = true): Promise<void> {
    if (paused) await this.send({ t: 'seq', op: 'pause' });
    const { sections, meta } = loadMessage(container, name);
    await this.send({ t: 'world', gen, op: 'load', sections, meta });
  }

  /** `seq step` (test mode): n ticks now, then one packet. */
  step(n: number): Promise<void> {
    return this.send({ t: 'seq', op: { step: n } });
  }

  errors(): string[] {
    return this.out.flatMap((m) =>
      m.t === 'log' && m.level === 'error' ? [m.msg] : m.t === 'error' ? [`${m.op}: ${m.message}`] : [],
    );
  }
}

/** Lets MessagePort deliveries and promise continuations run. */
export const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
