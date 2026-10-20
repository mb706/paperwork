// The audio CPU budget (10 §9.4, §11; B2's method, design/asset-study/audiocpu/bench.mjs): the runtime's
// engine plays live in headless Chrome and the audio threads' CPU is read from /proc every second, configs
// interleaved over rounds. Also the offline-render load that bench.html can measure on a player's machine
// (§9.4: render time as a share of the audio's duration, mean and worst second).
//
// The clock: this host's intel_pstate governor clocks a core by its load, and an audio thread busy 15 % of
// the time runs at 1.6-2.4 GHz rather than the 2.6 GHz base clock that §11's ÷ 2.4 assumes. So every second
// also records the clock of the core each audio thread last ran on (scaling_cur_freq, weighted by the
// thread's CPU time), and rows give the share both as measured and scaled to 2.6 GHz.
//
//   taskset -c 0-7 node scripts/assets/audio/bench.ts <configs.json> [seconds=140] [rounds=2] [first round=0]
//
// A config: {"name": "era2+sfx", "piece": "era2", "params": {"seed": 1962}, "duration": 150, "activity": 0.7,
//   "sfx": {"loops": 12, "machines": 100, "shotsPerSec": 6, "burst": 20, "burstEvery": 5}}; "mode": "offline"
// measures the offline load instead; no "piece" plays only the SFX. Results: .cache/assets/audio/bench/.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type AudioDev, devServer, GAME, openPage } from './render.ts';

const HZ = 100;
interface Thread {
  name: string;
  type: string;
  cpu: number;
  /** The CPU it last ran on. */
  core: number;
}

/** Every renderer and utility thread of Chrome with its CPU ticks (B2's scan). */
function threads(): Map<string, Thread> {
  const out = new Map<string, Thread>();
  for (const pid of readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    let cmd: string;
    try {
      cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    } catch {
      continue;
    }
    if (!cmd.includes('chrome') || !(cmd.includes('--type=renderer') || cmd.includes('--type=utility')))
      continue;
    const type = cmd.includes('--type=renderer')
      ? 'renderer'
      : cmd.includes('audio')
        ? 'audiosvc'
        : 'utility';
    let tids: string[];
    try {
      tids = readdirSync(`/proc/${pid}/task`);
    } catch {
      continue;
    }
    for (const tid of tids) {
      try {
        const st = readFileSync(`/proc/${pid}/task/${tid}/stat`, 'utf8');
        const name = st.slice(st.indexOf('(') + 1, st.lastIndexOf(')'));
        const f = st.slice(st.lastIndexOf(')') + 2).split(' ');
        out.set(`${pid}/${tid}`, { name, type, cpu: Number(f[11]) + Number(f[12]), core: Number(f[36]) });
      } catch {}
    }
  }
  return out;
}

const isAudio = (t: Thread) => t.type === 'audiosvc' || /audio|worklet|convolv|reverb/i.test(t.name);
const mhz = () => {
  const v = readFileSync('/proc/cpuinfo', 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('cpu MHz'))
    .slice(0, 8)
    .map((l) => Number(l.split(':')[1]));
  return v.reduce((a, b) => a + b, 0) / v.length;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A core's current clock (MHz). */
const coreMhz = (c: number) => {
  try {
    return Number(readFileSync(`/sys/devices/system/cpu/cpu${c}/cpufreq/scaling_cur_freq`, 'utf8')) / 1000;
  } catch {
    return Number.NaN;
  }
};
const BASE_MHZ = 2600;

const cfgPath = process.argv[2] as string;
const secs = Number(process.argv[3] ?? 140);
const rounds = Number(process.argv[4] ?? 2);
// the first round's index: an odd one starts in reverse order (to finish an interrupted session)
const first = Number(process.argv[5] ?? 0);
const cfgs = JSON.parse(readFileSync(cfgPath, 'utf8')) as (Record<string, unknown> & {
  name: string;
  mode?: string;
})[];
const results: Record<string, unknown>[] = [];
const { server, url } = await devServer();
try {
  for (let r = first; r < first + rounds; r++) {
    for (const cfg of r % 2 === 0 ? cfgs : [...cfgs].reverse()) {
      const { page, close, errors } = await openPage(url);
      try {
        if (cfg.mode === 'offline') {
          const m0 = mhz();
          const res = await page.evaluate(
            (c) => (globalThis as unknown as { __audioDev: AudioDev }).__audioDev.render(c),
            // no `name`: the page would save the render through a hook only render.ts provides
            { ...cfg, name: undefined, duration: cfg.duration ?? secs },
          );
          const load = (100 * res.ms) / 1000 / res.seconds;
          const worst = Math.max(...res.perSecondMs) / 10;
          const row = {
            round: r,
            name: cfg.name,
            mode: 'offline',
            loadPct: +load.toFixed(2),
            worstSecondPct: +worst.toFixed(2),
            seconds: res.seconds,
            mhz: Math.round((m0 + mhz()) / 2),
            errors: [...res.errors, ...errors],
          };
          results.push(row);
          console.log(
            `${cfg.name.padEnd(28)} r${r} offline load ${row.loadPct}% (worst second ${row.worstSecondPct}%) ${row.mhz} MHz`,
          );
          continue;
        }
        await page.evaluate(
          (c) => (globalThis as unknown as { __audioDev: AudioDev }).__audioDev.play(c),
          cfg,
        );
        await wait(4000);
        const a = threads();
        const s0 = await page.evaluate(() =>
          (globalThis as unknown as { __audioDev: AudioDev }).__audioDev.liveStats(),
        );
        const m0 = mhz();
        const t0 = Date.now();
        const perSec: number[] = [];
        // the audio threads' clock: MHz weighted by their CPU time
        let mhzW = 0;
        let mhzT = 0;
        let prev = a;
        let prevT = Date.now();
        for (let i = 0; i < secs; i++) {
          await wait(1000);
          const cur = threads();
          const now = Date.now();
          let s = 0;
          for (const [k, v] of cur) {
            if (!isAudio(v)) continue;
            const d = (v.cpu - (prev.get(k)?.cpu ?? v.cpu)) / HZ;
            s += d;
            const m = coreMhz(v.core);
            if (d > 0 && Number.isFinite(m)) {
              mhzW += m * d;
              mhzT += d;
            }
          }
          perSec.push(s / ((now - prevT) / 1000));
          prev = cur;
          prevT = now;
        }
        const wall = (Date.now() - t0) / 1000;
        const s1 = await page.evaluate(() =>
          (globalThis as unknown as { __audioDev: AudioDev }).__audioDev.liveStats(),
        );
        const b = threads();
        let audio = 0;
        const top: { name: string; type: string; pct: number }[] = [];
        for (const [k, v] of b) {
          const d = (v.cpu - (a.get(k)?.cpu ?? v.cpu)) / HZ / wall;
          if (isAudio(v)) audio += d;
          if (d > 0.002) top.push({ name: v.name, type: v.type, pct: +(100 * d).toFixed(2) });
        }
        top.sort((x, y) => y.pct - x.pct);
        const sorted = [...perSec].sort((x, y) => x - y);
        const mainMs = (s1?.scheduler.ms ?? 0) - (s0?.scheduler.ms ?? 0);
        const audioMhz = mhzT > 0 ? mhzW / mhzT : Number.NaN;
        const at26 = (pct: number) => +((pct * audioMhz) / BASE_MHZ).toFixed(2);
        const row = {
          round: r,
          name: cfg.name,
          audioPct: +(100 * audio).toFixed(2),
          audioMhz: Math.round(audioMhz),
          audioPctAt26: at26(100 * audio),
          worstSecondPctAt26: at26(100 * (sorted.at(-1) ?? 0)),
          worstSecondPct: +(100 * (sorted.at(-1) ?? 0)).toFixed(2),
          p95SecondPct: +(100 * (sorted[Math.floor(0.95 * (sorted.length - 1))] ?? 0)).toFixed(2),
          mainPct: +((100 * mainMs) / 1000 / wall).toFixed(3),
          maxTickMs: s1?.scheduler.maxMs ?? 0,
          dropped: s1?.dropped ?? 0,
          bank: s1?.bank ?? null,
          mhz: Math.round((m0 + mhz()) / 2),
          threads: top.slice(0, 6),
          errors,
        };
        results.push(row);
        console.log(
          `${cfg.name.padEnd(28)} r${r} audio ${row.audioPct}% (worst second ${row.worstSecondPct}%, p95 ${row.p95SecondPct}%) ` +
            `main ${row.mainPct}% (max tick ${row.maxTickMs.toFixed(1)} ms) voices max ${row.bank?.maxActive ?? '-'} ` +
            `(SFX ${row.bank?.maxSfx ?? '-'}) ` +
            `stolen ${row.bank?.stolen ?? 0} dropped ${row.dropped}; audio threads at ${row.audioMhz} MHz: ` +
            `${row.audioPctAt26}% / ${row.worstSecondPctAt26}% at 2.6 GHz`,
        );
        console.log(
          `    ${top
            .slice(0, 4)
            .map((t) => `${t.type}:${t.name} ${t.pct}%`)
            .join(' | ')}${errors.length ? `  ERR ${errors[0]}` : ''}`,
        );
        await page.evaluate(() => (globalThis as unknown as { __audioDev: AudioDev }).__audioDev.stop());
      } finally {
        await close();
      }
    }
  }
} finally {
  await server.close();
}
const out = join(GAME, '.cache/assets/audio/bench');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, basename(cfgPath)), JSON.stringify(results, null, 1));
