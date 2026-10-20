// Sample loading and residency (10 §9.4 "Sample packs and loading", §9.7): files are fetched by priority,
// decoded at 32 kHz into Int16 and handed to the voice bank. Packs are per instrument; an era needs its
// instruments' packs. The current era's and the next era's packs stay decoded; older ones are freed unless
// a resident era shares them (the piano). Decode failures: one retry, then that file's AAC version; two
// failures switch the codec for every later file. A file that never decodes is silent and logged.
import type { VoiceEngine } from '../bank-client.ts';
import type { PackSource } from '../music/engine.ts';
import type { LoadedPack } from '../music/instruments.ts';
import type { Codec } from './codec.ts';
import { type Decoder, yieldToMain } from './decode.ts';
import type { AudioFile, MusicManifest } from './manifest.ts';

export type Priority = 'high' | 'low';
/** Fetches one file's bytes. The app may route this through the asset worker (10 §9.7). */
export type Fetcher = (url: string, priority: Priority) => Promise<ArrayBuffer>;

/** The default fetcher: plain fetch with the retry backoff of 10 §9.7 (1, 2, 4, 8 s). */
export const httpFetcher: Fetcher = async (url, priority) => {
  let wait = 1000;
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { priority } as RequestInit);
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return await r.arrayBuffer();
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((res) => setTimeout(res, wait));
      wait *= 2;
    }
  }
};

/** Bank buffer ids, reused after a free. */
export class IdAllocator {
  private next = 1;
  private readonly free: number[] = [];
  private readonly max: number;
  constructor(max: number = 4096) {
    this.max = max;
  }
  take(): number {
    const id = this.free.pop() ?? this.next++;
    if (id >= this.max) throw new Error('out of bank buffer ids');
    return id;
  }
  give(id: number): void {
    this.free.push(id);
  }
}

export interface LoadedFile {
  id: number;
  len: number;
  channels: number;
}

/** Fetch, decode with the fallbacks, and send to the bank. */
export class FileLoader {
  codec: Codec;
  private failures = 0;
  readonly errors: string[] = [];
  /** Bytes downloaded, per codec (the byte inventory's runtime side). */
  downloaded = 0;

  private readonly bank: VoiceEngine;
  private readonly decoder: Decoder;
  private readonly fetcher: Fetcher;
  private readonly baseUrl: string;
  readonly ids: IdAllocator;
  constructor(
    bank: VoiceEngine,
    decoder: Decoder,
    fetcher: Fetcher,
    baseUrl: string,
    ids: IdAllocator,
    codec: Codec,
  ) {
    this.bank = bank;
    this.decoder = decoder;
    this.fetcher = fetcher;
    this.baseUrl = baseUrl;
    this.ids = ids;
    this.codec = codec;
  }

  url(file: string, codec: Codec = this.codec): string {
    return `${this.baseUrl}${file}.${codec}`;
  }

  private async fetchDecode(f: AudioFile, codec: Codec, priority: Priority): Promise<Int16Array[]> {
    const bytes = await this.fetcher(this.url(f.file, codec), priority);
    this.downloaded += bytes.byteLength;
    return this.decoder.decode(bytes, { len: f.len, fp: f.fp, channels: f.channels });
  }

  async load(f: AudioFile, priority: Priority): Promise<LoadedFile | null> {
    let chans: Int16Array[] | null = null;
    const first = this.codec;
    try {
      chans = await this.fetchDecode(f, first, priority);
    } catch {
      try {
        chans = await this.fetchDecode(f, first, priority);
      } catch (e) {
        if (first === 'ogg') {
          this.failures++;
          if (this.failures >= 2) this.codec = 'm4a';
          try {
            chans = await this.fetchDecode(f, 'm4a', priority);
          } catch (e2) {
            this.errors.push(`${f.file}: ${String(e2)}`);
          }
        } else this.errors.push(`${f.file}: ${String(e)}`);
      }
    }
    if (!chans) {
      if (this.errors.length <= 20) console.warn(`audio: ${f.file} does not decode; it stays silent`);
      return null;
    }
    const id = this.ids.take();
    this.bank.buffer(id, chans, this.decoder.rate);
    return { id, len: f.len, channels: chans.length };
  }

  release(id: number): void {
    this.bank.free(id);
    this.ids.give(id);
  }
}

interface Resident {
  pack: LoadedPack;
  ids: number[];
  bytes: number;
  stereo: boolean;
}

export class PackLoader implements PackSource {
  manifest: MusicManifest | null = null;
  private readonly resident = new Map<string, Resident>();
  private readonly loading = new Map<string, Promise<void>>();
  private generation = 0;

  private readonly files: FileLoader;
  constructor(files: FileLoader) {
    this.files = files;
  }

  pack(name: string): LoadedPack | null {
    return this.resident.get(name)?.pack ?? null;
  }

  stereo(name: string): boolean {
    return this.resident.get(name)?.stereo ?? false;
  }

  packsOf(era: string): string[] {
    return this.manifest?.eras[era] ?? [];
  }

  ready(era: string): boolean {
    const packs = this.packsOf(era);
    return packs.length > 0 && packs.every((p) => this.resident.has(p));
  }

  /** Decoded Int16 bytes held (10 §9.4 budget: ≤ 96 MB). */
  residentBytes(): number {
    let b = 0;
    for (const r of this.resident.values()) b += r.bytes;
    return b;
  }

  loadEra(era: string, priority: Priority): Promise<void> {
    return Promise.all(this.packsOf(era).map((p) => this.load(p, priority))).then(() => undefined);
  }

  load(name: string, priority: Priority): Promise<void> {
    if (this.resident.has(name)) return Promise.resolve();
    const running = this.loading.get(name);
    if (running) return running;
    const entry = this.manifest?.packs[name];
    if (!entry) return Promise.reject(new Error(`no pack ${name}`));
    const gen = this.generation;
    const p = (async () => {
      const zones: LoadedPack['zones'] = [];
      const ids: number[] = [];
      let bytes = 0;
      let stereo = false;
      // zones load in order of need: the middle of the range first is no help, so in manifest order,
      // a few at a time (the decoder itself runs at most two at once)
      const queue = [...entry.zones];
      const worker = async () => {
        for (let z = queue.shift(); z; z = queue.shift()) {
          const f = await this.files.load(z, priority);
          if (!f) continue;
          if (gen !== this.generation) {
            this.files.release(f.id);
            continue;
          }
          ids.push(f.id);
          bytes += f.len * f.channels * 2;
          if (f.channels > 1) stereo = true;
          zones.push({
            id: f.id,
            root: z.root,
            layer: z.layer,
            seconds: z.len / (this.manifest?.rate ?? 32000),
          });
          await yieldToMain();
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      if (gen !== this.generation) return;
      if (zones.length === 0) throw new Error(`pack ${name}: no zone decoded`);
      this.resident.set(name, {
        pack: { kind: entry.kind, layers: entry.layers, makeupDb: entry.makeupDb, zones },
        ids,
        bytes,
        stereo,
      });
    })().finally(() => this.loading.delete(name));
    this.loading.set(name, p);
    return p;
  }

  /** Keeps only the packs these eras need (the current and the next); frees the rest. */
  retain(eras: readonly string[]): void {
    const keep = new Set(eras.flatMap((e) => this.packsOf(e)));
    for (const [name, r] of this.resident) {
      if (keep.has(name)) continue;
      for (const id of r.ids) this.files.release(id);
      this.resident.delete(name);
    }
  }

  /** Forgets everything (a new state generation resets audio state, 10 §15.6). */
  reset(): void {
    this.generation++;
    for (const r of this.resident.values()) for (const id of r.ids) this.files.release(id);
    this.resident.clear();
  }
}
