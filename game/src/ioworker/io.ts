// The IO worker's service (10 §3.1, §8.1–§8.6): it compresses (fflate, deflate level 6, §8.1), hashes (WebCrypto
// SHA-256, §8.2 "Integrity") and stores the save container, so the sim worker only copies sections out of linear
// memory and the game keeps running while a save is written (§8.4). Reading verifies the SHA-256 kept with the
// metadata and inflates the sections back into `sim_load`'s input (§15.8). Requests come from the main thread
// and from each sim worker's port (src/shared/io-protocol.ts).
import { deflateSync, inflateSync } from 'fflate';
import { SaveOutputCodec } from '../shared/gen/abi.ts';
import { Writer } from '../shared/gen/codec.ts';
import {
  readSaveContainer,
  type SaveHeader,
  type SectionFrame,
  SectionFrameCodec,
  writeSaveContainer,
} from '../shared/gen/container.ts';
import {
  autosaveName,
  CHECKPOINT_NAME,
  type CheckpointManifest,
  type IoReply,
  type IoRequest,
  type SaveInfo,
} from '../shared/io-protocol.ts';
import type { Storage } from './storage.ts';

/** fflate's level for saves (§8.1: deflate, level 6). */
export const DEFLATE_LEVEL = 6;
/** A checkpoint's transfer chunks (§8.6, 11 §4.3: 16 or 64 KiB). */
export const CHECKPOINT_CHUNK = 65536;

export interface IoEnv {
  sha256(bytes: Uint8Array): Promise<Uint8Array>;
  /** Milliseconds, for timings. */
  now(): number;
  /** navigator.storage's quota and persistence (§8.2), where the platform has them. */
  estimate?(): Promise<{ usage: number; quota: number }>;
  persist?(): Promise<boolean>;
  persisted?(): Promise<boolean>;
}

const hex = (b: Uint8Array): string => {
  let s = '';
  for (const x of b) s += (x < 16 ? '0' : '') + x.toString(16);
  return s;
};

/** `sim_load`'s sections region: `u32 count`, then each frame raw (codec 0, stored = raw length). */
export function sectionsRegion(frames: readonly SectionFrame[]): Uint8Array {
  const w = new Writer();
  w.u32(frames.length, 'sections');
  for (const f of frames) SectionFrameCodec.write(w, f);
  return w.finish();
}

/** A frame's bytes inflated (codec 1) or as they are (codec 0), checked against its raw length. */
export function rawFrame(f: SectionFrame): SectionFrame {
  if (f.codec === 0) {
    if (f.data.length !== f.raw_length)
      throw new Error(`section ${f.id}: ${f.data.length} bytes, raw length ${f.raw_length}`);
    return f;
  }
  const data = inflateSync(f.data);
  if (data.length !== f.raw_length)
    throw new Error(`section ${f.id} inflates to ${data.length} bytes, not ${f.raw_length}`);
  return { ...f, codec: 0, data };
}

export class IoService {
  private readonly store: Storage;
  private readonly env: IoEnv;
  private persistAsked = false;

  constructor(store: Storage, env: IoEnv) {
    this.store = store;
    this.env = env;
  }

  get kind(): 'opfs' | 'idb' {
    return this.store.kind;
  }

  async handle(req: IoRequest): Promise<{ reply: IoReply; transfer: Transferable[] }> {
    try {
      return await this.serve(req);
    } catch (e) {
      return {
        reply: { t: 'failed', id: req.id, message: e instanceof Error ? e.message : String(e) },
        transfer: [],
      };
    }
  }

  private async serve(req: IoRequest): Promise<{ reply: IoReply; transfer: Transferable[] }> {
    const none: Transferable[] = [];
    switch (req.t) {
      case 'store': {
        const t0 = this.env.now();
        const info = await this.storeSave(req);
        return { reply: { t: 'stored', id: req.id, info, ms: this.env.now() - t0 }, transfer: none };
      }
      case 'read': {
        const got = await this.store.read(req.name);
        if (!got) throw new Error(`no save named ${req.name}`);
        if (hex(await this.env.sha256(got.bytes)) !== got.info.sha256)
          throw new Error(`save ${req.name} does not match its SHA-256: the stored bytes are damaged`);
        const { header, sections } = this.unpack(got.bytes);
        const buf = sections.buffer as ArrayBuffer;
        return { reply: { t: 'read', id: req.id, info: got.info, header, sections: buf }, transfer: [buf] };
      }
      case 'unpack': {
        const bytes = new Uint8Array(req.bytes);
        const { header, sections } = this.unpack(bytes);
        const info = this.infoOf('', 'manual', header, bytes.length, hex(await this.env.sha256(bytes)));
        const buf = sections.buffer as ArrayBuffer;
        return { reply: { t: 'read', id: req.id, info, header, sections: buf }, transfer: [buf] };
      }
      case 'list': {
        const saves = (await this.store.list()).sort((a, b) =>
          a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : a.name < b.name ? -1 : 1,
        );
        return { reply: { t: 'list', id: req.id, saves }, transfer: none };
      }
      case 'delete':
        await this.store.remove(req.name);
        return { reply: { t: 'deleted', id: req.id }, transfer: none };
      case 'export': {
        const got = await this.store.read(req.name);
        if (!got) throw new Error(`no save named ${req.name}`);
        const buf = got.bytes.slice().buffer as ArrayBuffer;
        return { reply: { t: 'exported', id: req.id, bytes: buf }, transfer: [buf] };
      }
      case 'import': {
        // §8.2 "Export and import": the container must read (format, header, frames, sections inflating to
        // their lengths); a newer format is refused by the reader.
        const bytes = new Uint8Array(req.bytes);
        const { header } = this.unpack(bytes);
        const info = this.infoOf(req.name, 'manual', header, bytes.length, hex(await this.env.sha256(bytes)));
        await this.store.write(info, bytes);
        return { reply: { t: 'imported', id: req.id, info }, transfer: none };
      }
      case 'estimate': {
        const e = (await this.env.estimate?.()) ?? { usage: 0, quota: 0 };
        const persisted = (await this.env.persisted?.()) ?? false;
        return {
          reply: { t: 'estimate', id: req.id, usage: e.usage, quota: e.quota, persisted },
          transfer: none,
        };
      }
      case 'persist': {
        const persisted = (await this.env.persist?.()) ?? false;
        return { reply: { t: 'persisted', id: req.id, persisted }, transfer: none };
      }
      case 'report': {
        const stored = await this.store.report(
          req.name,
          req.files.map((f) => ({ name: f.name, bytes: new Uint8Array(f.bytes) })),
        );
        return { reply: { t: 'reported', id: req.id, stored }, transfer: none };
      }
    }
  }

  /** The header and `sim_load`'s sections region of a container. */
  unpack(bytes: Uint8Array): { header: SaveHeader; sections: Uint8Array } {
    const c = readSaveContainer(bytes);
    return { header: c.header, sections: sectionsRegion(c.frames.map(rawFrame)) };
  }

  private infoOf(
    name: string,
    reason: SaveInfo['reason'],
    h: SaveHeader,
    bytes: number,
    sha256: string,
  ): SaveInfo {
    return {
      name,
      reason,
      bytes,
      sha256,
      tick: h.tick,
      seed: h.seed,
      playTimeTicks: h.playTimeTicks,
      savedAt: h.savedAt,
      prototypesHash: h.prototypesHash,
      store: this.store.kind,
    };
  }

  /** The name a nameless save gets: the next autosave slot (the first free, else the oldest), or the checkpoint. */
  private async slot(reason: SaveInfo['reason'], slots: number): Promise<string> {
    if (reason === 'checkpoint') return CHECKPOINT_NAME;
    let oldest: SaveInfo | null = null;
    for (let i = 1; i <= Math.max(1, slots); i++) {
      const info = await this.store.info(autosaveName(i));
      if (!info) return autosaveName(i);
      if (!oldest || info.savedAt < oldest.savedAt) oldest = info;
    }
    return (oldest as SaveInfo).name;
  }

  private async storeSave(req: IoRequest & { t: 'store' }): Promise<SaveInfo> {
    const out = SaveOutputCodec.decode(new Uint8Array(req.save));
    const header: SaveHeader = { ...req.header, lineage: out.r.toString(16).padStart(16, '0') };
    // §8.1: every section deflated (level 6), unless that does not make it smaller.
    const frames: SectionFrame[] = out.sections.map((f) => {
      if (f.codec !== 0) return f;
      const z = deflateSync(f.data, { level: DEFLATE_LEVEL });
      return z.length < f.data.length ? { ...f, codec: 1, data: z } : f;
    });
    const container = writeSaveContainer(header, frames);
    const sha256 = hex(await this.env.sha256(container));
    const name = req.name ?? (await this.slot(req.reason, req.slots ?? 3));
    const est = await this.env.estimate?.();
    if (est && est.quota > 0 && est.usage + container.length > est.quota)
      throw new Error(
        `the save needs ${container.length} bytes and the storage quota has ${est.quota - est.usage}`,
      );
    if (!this.persistAsked) {
      // §8.2: persistent storage is requested at the first save.
      this.persistAsked = true;
      void this.env.persist?.();
    }
    const info = this.infoOf(name, req.reason, header, container.length, sha256);
    info.savedAt = header.savedAt;
    if (req.reason === 'checkpoint')
      info.manifest = this.manifest(name, header, container.length, sha256, req.stateHash);
    await this.store.write(info, container);
    return info;
  }

  /** §8.6's manifest: kept beside the container (in the save's metadata), never inside it. */
  private manifest(
    name: string,
    h: SaveHeader,
    bytes: number,
    sha256: string,
    stateHash?: string,
  ): CheckpointManifest {
    return {
      id: name,
      tick: h.tick,
      buildHash: h.buildHash,
      protocolVersion: h.protocolVersion,
      schemaHash: h.schemaHash,
      prototypesHash: h.prototypesHash,
      lineage: h.lineage,
      stateHash: stateHash ?? '',
      bytes,
      chunkSize: CHECKPOINT_CHUNK,
      chunkCount: Math.ceil(bytes / CHECKPOINT_CHUNK),
      sha256,
    };
  }
}
