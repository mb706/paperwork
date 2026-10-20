// The audio dev page (10 §2.2 src/dev/): the runtime by hand (start, the music program and keys, the
// sliders, every sound, a factory's SFX load), and the hooks the audio tools and tests drive through
// Playwright (`window.__audioDev`): offline renders through the real engine, live playback for the CPU
// benchmark, the decode and loop-seam checks, and the reduced path.
import { AudioSystem, CATEGORIES, EVENT, encodePacket, StandinPacket } from '../audio/index.ts';
import { Decoder } from '../audio/loading/decode.ts';
import type { MusicManifest, SoundsManifest } from '../audio/loading/manifest.ts';
import { type LiveRun, playLive, type RenderConfig, renderOffline } from '../audio/offline.ts';
import bankUrl from '../audio/worklet/bank.ts?worker&url';
import { BankCore } from '../audio/worklet/bank-core.ts';
import fdnUrl from '../audio/worklet/fdn.ts?worker&url';
import { F, GROUP, KIND, NF, OUT_SFX, SFX_DEST } from '../audio/worklet/protocol.ts';

const BASE = '/audio/';
const worklets = { bank: bankUrl, fdn: fdnUrl };
const params = new URLSearchParams(location.search);
const audio = new AudioSystem({ worklets, baseUrl: BASE, reduced: params.has('reduced'), seed: 1945 });
void audio.preload();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- the page

audio.onState((s) => {
  (document.querySelector('[data-testid="audio-state"]') as HTMLElement).textContent =
    `${s}${audio.mode === 'reduced' ? ' (reduced)' : ''}`;
});
$('unlock').addEventListener('click', () => audio.unlock());
$('menu').addEventListener('click', () => audio.playMenu());
$('game').addEventListener('click', () => audio.startGame(Date.now() % 100000));
$('end').addEventListener('click', () => audio.endGame());
$('next').addEventListener('click', () => audio.nextTrack());
$('prev').addEventListener('click', () => audio.previousTrack());
$('pause').addEventListener('click', () => audio.pauseResumeMusic());

const feed = () => {
  const year = Number(($('year') as HTMLInputElement).value);
  const watts = 10 ** Number(($('watts') as HTMLInputElement).value);
  $('yearv').textContent = String(year);
  $('wattsv').textContent =
    watts >= 1e6 ? `${(watts / 1e6).toFixed(1)} MW` : `${(watts / 1e3).toFixed(0)} kW`;
  audio.onMusicFeed({
    literatureYear: year,
    consumptionW: watts,
    doublingTime: 0,
    closed: false,
    victory: false,
  });
};
$('year').addEventListener('input', feed);
$('watts').addEventListener('input', feed);
setInterval(feed, 1000);

for (const c of CATEGORIES) {
  const label = document.createElement('label');
  label.innerHTML = `<span>${c}</span><input type="range" min="0" max="100" value="${Math.round(audio.settings.volume[c] * 100)}"><span>${Math.round(audio.settings.volume[c] * 100)}</span><input type="checkbox" title="mute">`;
  const [range, check] = label.querySelectorAll('input') as unknown as [HTMLInputElement, HTMLInputElement];
  range.addEventListener('input', () => {
    audio.setVolume(c, Number(range.value) / 100);
    (label.children[2] as HTMLElement).textContent = range.value;
  });
  check.addEventListener('change', () => audio.setMuted(c, check.checked));
  $('volumes').append(label);
}

fetch(`${BASE}sounds.json`)
  .then((r) => r.json() as Promise<SoundsManifest>)
  .then((m) => {
    for (const name of Object.keys(m.sounds)) {
      const b = document.createElement('button');
      b.textContent = name;
      b.addEventListener('click', () => {
        if (m.sounds[name]?.positional) audio.at(name, (Math.random() - 0.5) * 40, 0);
        else audio.ui(name);
      });
      $('sounds').append(b);
    }
  })
  .catch(() => {});

// a factory's load through the real packet path: 100 working machines in view, one-shots and bursts
let loadTimer: ReturnType<typeof setInterval> | null = null;
let tick = 0;
$('load').addEventListener('click', (e) => {
  const on = !loadTimer;
  (e.target as HTMLElement).classList.toggle('on', on);
  if (!on) {
    if (loadTimer) clearInterval(loadTimer);
    loadTimer = null;
    return;
  }
  const loops = audio.sfx ? [...audio.sfx.table.byName.values()].filter((s) => s.def.loop) : [];
  loadTimer = setInterval(() => {
    tick += 1;
    const events = [];
    if (Math.random() < 0.1)
      events.push({ type: EVENT.entity_built, tick, proto: 0, x: (Math.random() - 0.5) * 40, y: 0 });
    if (tick % 300 === 0)
      for (let i = 0; i < 20; i++) events.push({ type: EVENT.entity_built, tick, proto: 0, x: i - 10, y: 3 });
    const working = loops.map((s, i) => ({ sound: s.id, n: 50, cx: i * 20 - 10, cy: 0, wsum: 35 }));
    audio.onPacket(new StandinPacket(encodePacket(1, tick, events, working)));
  }, 1000 / 60);
});
let map = false;
$('map').addEventListener('click', (e) => {
  map = !map;
  (e.target as HTMLElement).classList.toggle('on', map);
  audio.setView({ cx: 0, cy: 0, halfWidth: 32, zoom: 1, mapView: map });
});
let paused = false;
$('paused').addEventListener('click', (e) => {
  paused = !paused;
  (e.target as HTMLElement).classList.toggle('on', paused);
  audio.setPaused(paused);
});

setInterval(async () => {
  const s = await audio.status();
  $('status').textContent = JSON.stringify(s, null, 1);
}, 1000);

// ---------------------------------------------------------------- hooks for the tools and tests

async function manifests(): Promise<{ music: MusicManifest | null; sounds: SoundsManifest | null }> {
  const get = async <T>(n: string) => {
    const r = await fetch(`${BASE}${n}`);
    return r.ok ? ((await r.json()) as T) : null;
  };
  return { music: await get<MusicManifest>('music.json'), sounds: await get<SoundsManifest>('sounds.json') };
}

/**
 * ITU-R BS.1770-4 integrated loudness (K-weighted, gated) of the first two channels; 48 kHz only (the
 * standard's filter coefficients). After A4's render page.
 */
function loudness(buf: AudioBuffer): number {
  if (buf.sampleRate !== 48000) return Number.NaN;
  const kw = (x: Float32Array) => {
    const y = new Float64Array(x.length);
    const stage = (b: number[], a: number[], inp: ArrayLike<number>, out: Float64Array) => {
      let x1 = 0;
      let x2 = 0;
      let y1 = 0;
      let y2 = 0;
      for (let i = 0; i < inp.length; i++) {
        const v =
          (b[0] as number) * (inp[i] as number) +
          (b[1] as number) * x1 +
          (b[2] as number) * x2 -
          (a[1] as number) * y1 -
          (a[2] as number) * y2;
        x2 = x1;
        x1 = inp[i] as number;
        y2 = y1;
        y1 = v;
        out[i] = v;
      }
    };
    stage(
      [1.53512485958697, -2.69169618940638, 1.19839281085285],
      [1, -1.69065929318241, 0.73248077421585],
      x,
      y,
    );
    stage([1, -2, 1], [1, -1.99004745483398, 0.99007225036621], y.slice(), y);
    return y;
  };
  const a = kw(buf.getChannelData(0));
  const b = kw(buf.getChannelData(Math.min(1, buf.numberOfChannels - 1)));
  const pw: number[] = [];
  for (let s0 = 0; s0 + 19200 <= a.length; s0 += 4800) {
    let sum = 0;
    for (let i = s0; i < s0 + 19200; i++) sum += (a[i] as number) ** 2 + (b[i] as number) ** 2;
    pw.push(sum / 19200);
  }
  const lk = (p: number) => -0.691 + 10 * Math.log10(p);
  const abs = pw.filter((p) => lk(p) > -70);
  if (abs.length === 0) return Number.NEGATIVE_INFINITY;
  const ug = abs.reduce((x, p) => x + p, 0) / abs.length;
  const rel = abs.filter((p) => lk(p) > lk(ug) - 10);
  return lk(rel.reduce((x, p) => x + p, 0) / rel.length);
}

/** A float32 WAV of the first `channels` channels. */
function wav(buf: AudioBuffer, channels = buf.numberOfChannels): ArrayBuffer {
  const n = buf.length;
  const bytes = 44 + n * channels * 4;
  const dv = new DataView(new ArrayBuffer(bytes));
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  dv.setUint32(4, bytes - 8, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 3, true);
  dv.setUint16(22, channels, true);
  dv.setUint32(24, buf.sampleRate, true);
  dv.setUint32(28, buf.sampleRate * channels * 4, true);
  dv.setUint16(32, channels * 4, true);
  dv.setUint16(34, 32, true);
  w(36, 'data');
  dv.setUint32(40, n * channels * 4, true);
  const data = Array.from({ length: channels }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < channels; c++) {
      dv.setFloat32(o, (data[c] as Float32Array)[i] as number, true);
      o += 4;
    }
  return dv.buffer;
}

declare global {
  interface Window {
    __audioDev: typeof dev;
    /** Exposed by the Node tools (page.exposeFunction): receives a file in base64 chunks. */
    __save?: (name: string, chunk: string, last: boolean) => Promise<void>;
  }
}

async function save(name: string, data: ArrayBuffer): Promise<void> {
  const save = window.__save;
  if (!save) throw new Error('no __save hook');
  const u8 = new Uint8Array(data);
  const CH = 3 << 20;
  for (let i = 0; i < u8.length || i === 0; i += CH) {
    let s = '';
    const part = u8.subarray(i, i + CH);
    for (let k = 0; k < part.length; k += 0x8000) s += String.fromCharCode(...part.subarray(k, k + 0x8000));
    await save(name, btoa(s), i + CH >= u8.length);
  }
}

let live: LiveRun | null = null;

const dev = {
  audio,
  /** An offline render through the real engine; saves `<name>.wav` (and notes) through `__save`. */
  async render(cfg: RenderConfig & { name?: string; saveChannels?: number }) {
    const m = await manifests();
    const r = await renderOffline({ worklets, baseUrl: BASE, ...m }, cfg);
    if (cfg.name) {
      await save(`${cfg.name}.wav`, wav(r.buffer, cfg.saveChannels ?? r.buffer.numberOfChannels));
      const notes = new TextEncoder().encode(JSON.stringify({ cfg, stems: r.stems, notes: r.notes }));
      await save(`${cfg.name}.notes.json`, notes.buffer as ArrayBuffer);
    }
    let peak = 0;
    let denormals = 0;
    let nonFinite = 0;
    for (let c = 0; c < Math.min(2, r.buffer.numberOfChannels); c++)
      for (const x of r.buffer.getChannelData(c)) {
        const a = Math.abs(x);
        if (a > peak) peak = a;
        if (a !== 0 && a < 1.1754943508222875e-38) denormals++;
        if (!Number.isFinite(x)) nonFinite++;
      }
    return {
      lufs: loudness(r.buffer),
      seconds: r.buffer.duration,
      sampleRate: r.buffer.sampleRate,
      ms: r.ms,
      decodeMs: r.decodeMs,
      perSecondMs: r.perSecondMs,
      notes: r.notes.length,
      dropped: r.dropped,
      stems: r.stems,
      peak,
      denormals,
      nonFinite,
      errors: r.errors,
    };
  },
  /** Live playback for the realtime CPU benchmark. */
  async play(cfg: RenderConfig) {
    await live?.stop();
    const m = await manifests();
    live = await playLive({ worklets, baseUrl: BASE, ...m }, cfg);
    return { sampleRate: live.ctx.sampleRate, baseLatency: live.ctx.baseLatency };
  },
  async liveStats() {
    return live ? live.stats() : null;
  },
  async stop() {
    await live?.stop();
    live = null;
  },
  /** Decodes every file of both packs at 32 kHz and compares with the canonical timeline (10 §9.4). */
  async decodeCheck(codec: 'ogg' | 'm4a') {
    const m = await manifests();
    const files = [
      ...Object.values(m.music?.packs ?? {}).flatMap((p) => p.zones),
      ...Object.values(m.sounds?.sounds ?? {}).flatMap((s) => s.files),
    ];
    const dec = new Decoder(32000);
    const rows: { file: string; len: number; decoded: number; offset: number; ok: boolean }[] = [];
    for (const f of files) {
      const bytes = await (await fetch(`${BASE}${f.file}.${codec}`)).arrayBuffer();
      const ctx = new OfflineAudioContext(1, 1, 32000);
      let decoded = -1;
      try {
        decoded = (await ctx.decodeAudioData(bytes.slice(0))).length;
      } catch {
        rows.push({ file: f.file, len: f.len, decoded: -1, offset: 0, ok: false });
        continue;
      }
      const before = dec.misaligned.length;
      const chans = await dec.decode(bytes, { len: f.len, fp: f.fp });
      const offset =
        dec.misaligned.length > before ? (dec.misaligned[dec.misaligned.length - 1] as number) : 0;
      rows.push({ file: f.file, len: f.len, decoded, offset, ok: chans[0]?.length === f.len });
    }
    return rows;
  },
  /**
   * Every loop through the bank's own loop path (BankCore on this thread): decoded at 32 kHz, aligned, then
   * played across three seams; the step at each seam against the signal's own steps, and the spectral flux.
   */
  async loopTest(codec: 'ogg' | 'm4a') {
    const m = await manifests();
    const out: Record<string, unknown>[] = [];
    const dec = new Decoder(32000);
    for (const [name, s] of Object.entries(m.sounds?.sounds ?? {})) {
      if (!s.loop) continue;
      for (const f of s.files) {
        const bytes = await (await fetch(`${BASE}${f.file}.${codec}`)).arrayBuffer();
        const chans = await dec.decode(bytes, { len: f.len, fp: f.fp });
        const core = new BankCore({ sampleRate: 32000 });
        core.onMessage({ t: 'buf', id: 1, chans, rate: 32000 });
        const L = (f.loopEnd ?? 0) - (f.loopStart ?? 0);
        const rec = new Float64Array(NF);
        rec[F.KIND] = KIND.SAMPLE;
        rec[F.SRC] = 1;
        rec[F.DEST] = SFX_DEST;
        rec[F.GROUP] = GROUP.SFX;
        rec[F.RATE] = 1;
        rec[F.GAIN] = 1;
        rec[F.OFFSET] = (f.loopStart ?? 0) / 32000;
        rec[F.LOOP_S] = f.loopStart ?? 0;
        rec[F.LOOP_E] = f.loopEnd ?? 0;
        rec[F.OFF] = Number.POSITIVE_INFINITY;
        rec[F.STOP] = Number.POSITIVE_INFINITY;
        rec[F.TYPE] = 1;
        rec[F.CAP] = 4;
        core.onMessage({ t: 'notes', n: 1, data: rec });
        const total = 3 * L + 256;
        const y = new Float32Array(total);
        for (let fr = 0; fr < total; fr += 128) {
          const o = Array.from({ length: BankCore.outputs() }, () => [
            new Float32Array(128),
            new Float32Array(128),
          ]);
          core.process(o, fr);
          y.set(
            ((o[OUT_SFX(0)] as Float32Array[])[0] as Float32Array).subarray(0, Math.min(128, total - fr)),
            fr,
          );
        }
        const steps: number[] = [];
        for (let i = 1; i < total; i++) steps.push(Math.abs((y[i] as number) - (y[i - 1] as number)));
        const sorted = steps.slice().sort((a, b) => a - b);
        const p99 = sorted[Math.floor(sorted.length * 0.99)] as number;
        const seams = [L, 2 * L].map((sIdx) =>
          Math.max(...[-1, 0, 1].map((d) => steps[sIdx + d - 1] as number)),
        );
        // spectral flux at the joins against the median flux (256-sample frames, hop 128)
        const flux = (at: number) => {
          const frame = (o: number) => {
            const mag: number[] = [];
            for (let k = 1; k < 64; k++) {
              let re = 0;
              let im = 0;
              for (let i = 0; i < 256; i++) {
                const x = (y[o + i] as number) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 255));
                re += x * Math.cos((2 * Math.PI * k * i) / 256);
                im -= x * Math.sin((2 * Math.PI * k * i) / 256);
              }
              mag.push(Math.hypot(re, im));
            }
            return mag;
          };
          const a = frame(at - 256);
          const b = frame(at);
          return a.reduce((s2, v, k) => s2 + Math.max(0, (b[k] as number) - v), 0);
        };
        const ref = [0.3, 0.45, 0.6, 0.75].map((q) => flux(Math.round(L * q)));
        out.push({
          name,
          file: f.file,
          decodedLen: chans[0]?.length,
          len: f.len,
          p99: +p99.toFixed(5),
          seams: seams.map((x) => +x.toFixed(5)),
          seamFlux: [L, 2 * L].map((at) => +flux(at).toFixed(4)),
          refFlux: ref.map((x) => +x.toFixed(4)),
          ok: Math.max(...seams) <= p99 * 1.5,
        });
      }
    }
    return out;
  },
};

window.__audioDev = dev;
