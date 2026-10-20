// The IO worker's service (10 §3.1, §8.1–§8.6): it compresses (fflate, deflate level 6, §8.1), hashes (WebCrypto
// SHA-256, §8.2 "Integrity") and stores the save container, so the sim worker only copies sections out of linear
// memory and the game keeps running while a save is written (§8.4). Reading verifies the SHA-256 kept with the
// metadata (or the one a pinned base names) and inflates the sections back into `sim_load`'s input (§15.8).
// Requests come from the main thread and from each sim worker's port (src/shared/io-protocol.ts).
//
// Writes need the saves' ownership (§8.2 "One tab at a time", ownership.ts): `fence()` is this tab's epoch while
// it owns them, and storage checks it at every commit. Bug bundles are assembled here (C3-r1 14): the main
// thread hands over the base, the log and the digests by transfer, and builds no container.
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
  type BundleBase,
  CHECKPOINT_NAME,
  type CheckpointManifest,
  type IoReply,
  type IoRequest,
  type SaveInfo,
} from '../shared/io-protocol.ts';
import { type Fence, NotOwnerError, type Storage } from './storage.ts';

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

/** A buffer that is exactly `u`'s bytes: its own buffer when it spans it (no copy), else a copy. */
const own = (u: Uint8Array): ArrayBuffer =>
  u.byteOffset === 0 && u.byteLength === u.buffer.byteLength
    ? (u.buffer as ArrayBuffer)
    : (u.slice().buffer as ArrayBuffer);

export class IoService {
  private readonly store: Storage;
  private readonly env: IoEnv;
  /** This tab's epoch while it owns the saves (ownership.ts), else null: writes are refused. */
  private readonly fence: () => Fence | null;
  private persistAsked = false;

  constructor(store: Storage, env: IoEnv, fence: () => Fence | null) {
    this.store = store;
    this.env = env;
    this.fence = fence;
  }

  get kind(): 'opfs' | 'idb' {
    return this.store.kind;
  }

  async handle(req: IoRequest): Promise<{ reply: IoReply; transfer: Transferable[] }> {
    try {
      return await this.serve(req);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        reply:
          e instanceof NotOwnerError
            ? { t: 'failed', id: req.id, message, notOwner: true }
            : { t: 'failed', id: req.id, message },
        transfer: [],
      };
    }
  }

  /** The fence for a write; refused when another tab owns the saves. */
  private owner(): Fence {
    const f = this.fence();
    if (!f) throw new NotOwnerError();
    return f;
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
        const got = await this.readChecked(req.name, req.file, req.sha256);
        const { header, sections } = this.unpack(got.bytes);
        const buf = own(sections);
        return { reply: { t: 'read', id: req.id, info: got.info, header, sections: buf }, transfer: [buf] };
      }
      case 'unpack': {
        const bytes = new Uint8Array(req.bytes);
        const { header, sections } = this.unpack(bytes);
        const info = this.infoOf('', 'manual', header, bytes.length, hex(await this.env.sha256(bytes)));
        const buf = own(sections);
        return { reply: { t: 'read', id: req.id, info, header, sections: buf }, transfer: [buf] };
      }
      case 'list': {
        const saves = (await this.store.list()).sort((a, b) =>
          a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : a.name < b.name ? -1 : 1,
        );
        return { reply: { t: 'list', id: req.id, saves }, transfer: none };
      }
      case 'delete':
        await this.store.remove(req.name, this.owner());
        return { reply: { t: 'deleted', id: req.id }, transfer: none };
      case 'export': {
        const got = await this.readChecked(req.name, req.file, req.sha256);
        const buf = own(got.bytes);
        return { reply: { t: 'exported', id: req.id, bytes: buf }, transfer: [buf] };
      }
      case 'import': {
        // §8.2 "Export and import": the container must read (format, header, frames, sections inflating to
        // their lengths); a newer format is refused by the reader.
        const fence = this.owner();
        const bytes = new Uint8Array(req.bytes);
        const { header } = this.unpack(bytes);
        const info = this.infoOf(req.name, 'manual', header, bytes.length, hex(await this.env.sha256(bytes)));
        const stored = await this.store.write(info, bytes, fence);
        return { reply: { t: 'imported', id: req.id, info: stored }, transfer: none };
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
          this.owner(),
        );
        return { reply: { t: 'reported', id: req.id, stored }, transfer: none };
      }
      case 'pin':
        this.store.pin(req.version.name, req.version.file, req.holder);
        return { reply: { t: 'pinned', id: req.id }, transfer: none };
      case 'unpin':
        await this.store.unpin(req.file, req.holder, this.fence());
        return { reply: { t: 'pinned', id: req.id }, transfer: none };
      case 'unpinAll':
        await this.store.unpinAll(req.holder, this.fence());
        return { reply: { t: 'pinned', id: req.id }, transfer: none };
      case 'bundle':
        return this.bundle(req);
    }
  }

  /** A stored save or exact version, checked against its SHA-256 (the pinned one when given). */
  private async readChecked(
    name: string,
    file?: string,
    sha256?: string,
  ): Promise<{ info: SaveInfo; bytes: Uint8Array }> {
    const got = await this.store.read(name, file);
    if (!got) throw new Error(file ? `version ${file} of save ${name} is gone` : `no save named ${name}`);
    const want = sha256 ?? got.info.sha256;
    if (hex(await this.env.sha256(got.bytes)) !== want)
      throw new Error(`save ${name} does not match its SHA-256: the stored bytes are damaged`);
    return { info: sha256 ? { ...got.info, sha256 } : got.info, bytes: got.bytes };
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

  /** `sim_save`'s output as a §8.1 container: every section deflated (level 6) unless that is not smaller. */
  private container(save: ArrayBuffer, header: SaveHeader): { header: SaveHeader; bytes: Uint8Array } {
    const out = SaveOutputCodec.decode(new Uint8Array(save));
    const h: SaveHeader = { ...header, lineage: out.r.toString(16).padStart(16, '0') };
    const frames: SectionFrame[] = out.sections.map((f) => {
      if (f.codec !== 0) return f;
      const z = deflateSync(f.data, { level: DEFLATE_LEVEL });
      return z.length < f.data.length ? { ...f, codec: 1, data: z } : f;
    });
    return { header: h, bytes: writeSaveContainer(h, frames) };
  }

  private async storeSave(req: IoRequest & { t: 'store' }): Promise<SaveInfo> {
    const fence = this.owner();
    const { header, bytes: container } = this.container(req.save, req.header);
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
    const stored = await this.store.write(info, container, fence);
    if (req.pin) {
      // The new base is pinned before the old one goes: a trap now finds one or the other, both intact.
      this.store.pin(stored.name, stored.file as string, req.pin.holder);
      if (req.pin.unpin) await this.store.unpin(req.pin.unpin, req.pin.holder, fence);
    }
    return stored;
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

  /** A bug bundle (§8.5): the base's container, the log and the digests, stored and/or handed back. */
  private async bundle(
    req: IoRequest & { t: 'bundle' },
  ): Promise<{ reply: IoReply; transfer: Transferable[] }> {
    const save = await this.baseContainer(req.base);
    const log = new Uint8Array(req.log);
    const digests = new Uint8Array(req.digests);
    let stored = false;
    if (req.store) {
      const fence = this.fence();
      if (fence)
        stored = await this.store.report(
          req.name,
          [
            { name: 'save.save', bytes: save },
            { name: 'closures.pwlog', bytes: log },
            { name: 'digests.bin', bytes: digests },
            { name: 'report.json', bytes: new Uint8Array(req.meta) },
          ],
          fence,
        );
    }
    if (!req.want)
      return {
        reply: { t: 'bundled', id: req.id, stored, save: null, log: null, digests: null },
        transfer: [],
      };
    const s = own(save);
    return {
      reply: { t: 'bundled', id: req.id, stored, save: s, log: req.log, digests: req.digests },
      transfer: [s, req.log, req.digests],
    };
  }

  private async baseContainer(base: BundleBase): Promise<Uint8Array> {
    if (base.kind === 'start') return this.container(base.save, base.header).bytes;
    const v = base.version;
    return (await this.readChecked(v.name, v.file, v.sha256)).bytes;
  }
}
