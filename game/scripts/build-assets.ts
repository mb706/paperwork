// The asset build (10 §9, §2.3: `npm run assets`): plan, render, post-process, pack, encode, emit the sprite
// manifest (10 §15.7, version 2), check it (§9.5) and publish it. Incremental by content hash, cached in
// .cache/assets/.
//
//   npm run assets [-- --only id[,id…]] [--force] [--no-render] [--no-qc] [--check]
//
//   --only      render (or with --force re-render) only these sets; every other set must already be in the cache
//               for its current key, and the manifest is still built, checked and published whole
//   --force     re-render (and re-post) the sets that would render
//   --no-render never start Blender: every set's render must be cached (keys still use the real Blender version,
//               read from Blender or, when it cannot run, from the last one recorded in .cache/assets/)
//   --no-qc     skip the QC gates that need Blender or Chrome (calibration, contract examples, UI screenshots) and
//               the review material
//   --check     only the fixture checks, without Blender (fast; for CI)
//
// Steps (each Python step runs under gamedev-python; renders and encodes are pinned to socket 1, one heavy job
// at a time, because the host is shared — CLAUDE.md):
//   1. plan.py lists every set: model scripts, a greybox per entity, icons, fx (scripts/assets/plan.py), with each
//      script's transitive model imports as its sources, validated against the model contract.
//   2. Render: a set re-renders only when the SHA-256 of its sources, the Blender library, the entry point and the
//      job plumbing, the pipeline version or Blender's version changes (10 §9.1). Blender runs with
//      --python-exit-code 1, and every job's outputs are verified (record.json, every pass file it names) before
//      the batch is accepted; a set that rendered anew is post-processed anew (codex C6-r1 finding 8).
//   3. Post: ink, glow, trim, pieces and shadows per set (post.py), cached on the render key, its own code and the
//      Python toolchain.
//   4. Groups (§9.7): core, then each tier's unlocking technologies merged in data order up to 3 MB.
//   5. Pack: every frame in its own cell (the frame plus a gutter, position and size rounded to the array's
//      block alignment: 32 px for colour, so each 4×4 block down to level 3 belongs to one cell; §9.2 step 5),
//      MaxRects (maxrects-packer 2.7.4, best short side fit) per group and array.
//   6. assemble.py composes the pages, box-filters their levels and encodes KTX2 (encode.py: XUBC7 quality 90
//      for colour, light and icons, ETC1S -q 255 for shadows, with the upload contract's metadata); terrain.py,
//      fonts.py and ui.py make the terrain textures, the fonts and the UI skin. All of them only add
//      content-named files to public/: the published generation stays intact (finding 7).
//   7. The manifest and the byte inventory are written to .cache/assets/stage/, and the gates run on them:
//      inventory.py (§9.7's bytes), checks.py (§9.5), metrics.py --gate (§9.5 #4), and with QC the projection
//      calibration, the contract examples and the UI screenshots (no console errors).
//   8. Publish: inventory.json, then sprites.json, each by an atomic rename; only then are the files no
//      manifest names removed from public/, and stale render and post cache entries dropped.
//   9. QC review material in .cache/assets/qc/: contact sheets, GIFs, the preview scene and the budgets.
import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as MR from 'maxrects-packer';
import { canonicalJson, compareCodeUnits, compareTuples } from './lib/canonical.ts';
import { sha256Hex } from './lib/hash.ts';

const GAME = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(GAME, 'scripts', 'assets');
const BLENDER_SRC = join(GAME, 'assets', 'blender');
const CACHE = join(GAME, '.cache', 'assets');
const STAGE = join(CACHE, 'stage');
const PUBLIC = join(GAME, 'public');
const ATLASES = join(PUBLIC, 'atlases');
/** The directories of public/ the asset build owns; after a publish, files no manifest names are removed. */
const OWNED = ['atlases', 'sheets', 'fonts'];
/** Bump to re-render everything after a change of the pipeline's meaning that no hashed file shows. */
const PIPELINE_VERSION = 'c6-2';
const MANIFEST_VERSION = 2;
const AXES_VERSION = 1;
const GROUP_CAP_BYTES = 3_000_000;
const CORE_CAP_BYTES = 5_000_000;

const PYTHON = process.env.PAPERWORK_PYTHON ?? 'gamedev-python';
const BLENDER =
  process.env.PAPERWORK_BLENDER ??
  (existsSync(join(homedir(), '.local/opt/blender-current/blender'))
    ? join(homedir(), '.local/opt/blender-current/blender')
    : 'blender');
const RENDER_CPUS = process.env.PAPERWORK_ASSET_CPUS ?? '8-15,24-31';
const RENDER_THREADS = Number(process.env.PAPERWORK_ASSET_THREADS ?? 16);
const POST_WORKERS = Number(process.env.PAPERWORK_ASSET_WORKERS ?? 4);

interface PlanSet {
  set: string;
  kind: string;
  script: string | null;
  sources: string[];
  tech: string;
  tier: string;
  params: unknown;
  renderer: 'sprites' | 'icons' | 'fx';
}

interface Frame {
  id: number;
  array: 'colour' | 'shadow' | 'light' | 'icon';
  file?: string;
  w: number;
  h: number;
  ax: number;
  ay: number;
  pad?: number;
  parent?: number;
  sub?: [number, number, number, number];
}

interface Part {
  axes: string[];
  shape: number[];
  map?: Record<string, number[]>;
  table: number[][];
  [extra: string]: unknown;
}

interface PostSet {
  set: string;
  kind: string;
  frames: Frame[];
  parts: Record<string, Part | Part[]>;
  extra: Record<string, unknown>;
  size: [number, number];
}

interface Loaded {
  plan: PlanSet;
  post: PostSet;
  dir: string;
  group: string;
}

/** The atlas arrays of 10 §15.7 (their layer order is the manifest's), with each one's cell rule. */
const ARRAYS = [
  { kind: 'colour', pxPerTile: 64, pageSize: 2048, levels: 4, codec: 'xubc7', align: 32, gutter: 8 },
  { kind: 'shadow', pxPerTile: 32, pageSize: 1024, levels: 3, codec: 'etc1s', align: 16, gutter: 4 },
  { kind: 'light', pxPerTile: 16, pageSize: 512, levels: 2, codec: 'xubc7', align: 8, gutter: 2 },
  { kind: 'icon', pxPerTile: 64, pageSize: 1024, levels: 3, codec: 'xubc7', align: 16, gutter: 4 },
] as const;
type ArrayKind = (typeof ARRAYS)[number]['kind'];
const ARRAY_INDEX: Record<ArrayKind, number> = { colour: 0, shadow: 1, light: 2, icon: 3 };

function log(msg: string): void {
  console.log(`[assets] ${msg}`);
}

function run(cmd: string, args: string[], opts: { cpus?: string; quiet?: boolean } = {}): string {
  const argv = opts.cpus ? ['taskset', '-c', opts.cpus, cmd, ...args] : [cmd, ...args];
  const env = { ...process.env, OMP_NUM_THREADS: '2', OPENBLAS_NUM_THREADS: '2', MKL_NUM_THREADS: '2' };
  const r = spawnSync(argv[0] as string, argv.slice(1), {
    cwd: GAME,
    env,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0) {
    throw new Error(
      `${argv.join(' ')} failed (${r.status ?? r.signal ?? r.error?.message}):\n${out.slice(-6000)}`,
    );
  }
  if (!opts.quiet) {
    for (const line of out.split('\n'))
      if (
        /^\[(post|fx|render|icon|assemble|terrain|ui|fonts|check|qc|contact|metrics|fixture|budget|calibration|examples)\]/.test(
          line,
        )
      )
        console.log(line);
  }
  return out;
}

function py(script: string, args: string[], opts: { cpus?: string; quiet?: boolean } = {}): string {
  return run(PYTHON, [join(ASSETS, script), ...args], opts);
}

function fileHash(path: string): string {
  return sha256Hex(readFileSync(path));
}

function dirPyHash(dir: string): string {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.py'))
    .sort(compareCodeUnits);
  return sha256Hex(files.map((f) => `${f}:${fileHash(join(dir, f))}`).join('\n'));
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Atomic: a reader sees the old file or the new one, never a part. */
function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** Blender's version line, recorded in the cache so `--no-render` keys the same renders without Blender. */
function blenderVersion(needBlender: boolean): string {
  const saved = join(CACHE, 'blender-version.txt');
  const r = spawnSync(BLENDER, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const line = r.status === 0 ? (r.stdout ?? '').split('\n').find((l) => l.startsWith('Blender')) : undefined;
  if (line) {
    writeText(saved, `${line.trim()}\n`);
    return line.trim();
  }
  if (!needBlender && existsSync(saved)) return readFileSync(saved, 'utf8').trim();
  throw new Error(
    `cannot read Blender's version (${BLENDER} --version failed) and none is recorded in ${saved}`,
  );
}

interface Args {
  only: Set<string> | undefined;
  force: boolean;
  render: boolean;
  qc: boolean;
  checkOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { only: undefined, force: false, render: true, qc: true, checkOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--only') a.only = new Set((argv[++i] ?? '').split(',').filter((s) => s));
    else if (x === '--force') a.force = true;
    else if (x === '--no-render') a.render = false;
    else if (x === '--no-qc') a.qc = false;
    else if (x === '--check') a.checkOnly = true;
    else throw new Error(`build-assets: unknown argument ${x}`);
  }
  return a;
}

function ensureData(): { prototypesHash: string } {
  const bm = join(PUBLIC, 'data', 'build-manifest.json');
  if (!existsSync(bm)) {
    log('no public/data/build-manifest.json: running the data stage');
    run(process.execPath, [join(GAME, 'scripts', 'data-stage.ts')]);
  }
  return readJson<{ prototypesHash: string }>(bm);
}

// --------------------------------------------------------------------------------------------------------------
// Render and post, by content hash
// --------------------------------------------------------------------------------------------------------------

interface Keys {
  render: string;
  post: string;
}

/** A set's cache keys: the render's inputs (codex C6-r1 finding 6: the script and its transitive model imports,
 * lib/, the entry point and job plumbing, Blender), then the post step's code and Python toolchain on top. */
function setKeys(s: PlanSet, blender: string, libHash: string, toolchain: unknown): Keys {
  const sources = s.sources.map((p) => `${p}:${fileHash(join(GAME, p))}`);
  const jobs = fileHash(join(BLENDER_SRC, 'jobs.py'));
  const entry =
    s.renderer === 'sprites'
      ? `${fileHash(join(BLENDER_SRC, 'render.py'))}:${jobs}`
      : s.renderer === 'icons'
        ? `${fileHash(join(BLENDER_SRC, 'render_icons.py'))}:${jobs}`
        : '';
  const render = sha256Hex(
    canonicalJson({
      v: PIPELINE_VERSION,
      blender: s.renderer === 'fx' ? '' : blender,
      lib: s.renderer === 'fx' ? '' : libHash,
      entry,
      sources,
      set: s.set,
      kind: s.kind,
      params: s.params ?? null,
    }),
  );
  const postCode = ['post.py', 'ink.py', 'common.py', 'fx.py']
    .map((f) => `${f}:${fileHash(join(ASSETS, f))}`)
    .join('\n');
  const style = fileHash(join(BLENDER_SRC, 'lib', 'style.py'));
  const contract = fileHash(join(BLENDER_SRC, 'lib', 'contract.py'));
  const post = sha256Hex(canonicalJson({ render, postCode, style, contract, toolchain }));
  return { render, post };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Every file a render record names (strings ending in .png anywhere in it). */
function recordFiles(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') {
    if (v.endsWith('.png')) out.push(v);
  } else if (Array.isArray(v)) for (const x of v) recordFiles(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) recordFiles(x, out);
  return out;
}

/** Why a render directory is not a complete render of `set`, or undefined when it is. */
function renderProblem(dir: string, set: string): string | undefined {
  const rp = join(dir, 'record.json');
  if (!existsSync(rp)) return 'no record.json';
  let rec: { set?: string };
  try {
    rec = readJson<{ set?: string }>(rp);
  } catch (e) {
    return `record.json unreadable: ${e instanceof Error ? e.message : e}`;
  }
  if (rec.set !== set) return `record.json is of ${rec.set}`;
  const files = recordFiles(rec);
  if (files.length === 0) return 'record.json names no pass files';
  const head = Buffer.alloc(8);
  for (const f of files) {
    const p = join(dir, f);
    if (!existsSync(p) || statSync(p).size <= PNG_SIGNATURE.length) return `${f} is missing or empty`;
    const fd = openSync(p, 'r');
    try {
      readSync(fd, head, 0, 8, 0);
    } finally {
      closeSync(fd);
    }
    if (!head.equals(PNG_SIGNATURE)) return `${f} is not a PNG`;
  }
  return undefined;
}

function renderPending(sets: PlanSet[], keys: Map<string, Keys>, args: Args): void {
  const renderDir = (s: PlanSet): string => join(CACHE, 'render', (keys.get(s.set) as Keys).render);
  const postDir = (s: PlanSet): string => join(CACHE, 'post', (keys.get(s.set) as Keys).post);
  const missing = sets.filter((s) => s.renderer !== 'fx' && renderProblem(renderDir(s), s.set) !== undefined);
  const wanted = sets.filter(
    (s) =>
      s.renderer !== 'fx' &&
      (args.only === undefined || args.only.has(s.set) || args.only.has(s.set.split('/')[1] ?? '')),
  );
  const todo = args.render ? wanted.filter((s) => args.force || missing.includes(s)) : [];
  const blocked = missing.filter((s) => !todo.includes(s));
  if (blocked.length > 0) {
    const names = blocked.map((s) => s.set);
    throw new Error(
      `${names.length} set(s) have no render for their current key and ${args.render ? '--only excludes them' : '--no-render is set'}: ` +
        `${names.slice(0, 12).join(', ')}${names.length > 12 ? ', …' : ''} (run a full build)`,
    );
  }
  for (const renderer of ['sprites', 'icons'] as const) {
    const jobs = todo
      .filter((s) => s.renderer === renderer)
      .map((s) => ({
        set: s.set,
        kind: s.kind,
        script: s.script,
        sources: s.sources,
        params: s.params ?? null,
        out: renderDir(s),
        style: 'survey',
      }));
    if (jobs.length === 0) continue;
    const entry = join(BLENDER_SRC, renderer === 'sprites' ? 'render.py' : 'render_icons.py');
    for (let i = 0; i < jobs.length; i += 40) {
      const batch = jobs.slice(i, i + 40);
      const jf = join(CACHE, 'jobs', `${renderer}-${i}.json`);
      writeText(jf, canonicalJson(batch));
      log(`rendering ${batch.length} ${renderer} set(s): ${batch.map((j) => j.set).join(', ')}`);
      const t0 = performance.now();
      run(
        BLENDER,
        [
          '-b',
          '--factory-startup',
          '-noaudio',
          '--python-exit-code',
          '1',
          '--python',
          entry,
          '--',
          '--jobs',
          jf,
          '--threads',
          String(RENDER_THREADS),
        ],
        { cpus: RENDER_CPUS },
      );
      // accept the batch only when every job left a complete render; a new render invalidates its post output
      for (const j of batch) {
        const why = renderProblem(j.out, j.set);
        if (why !== undefined) throw new Error(`render of ${j.set} is incomplete (${why}): ${j.out}`);
        const s = sets.find((x) => x.set === j.set) as PlanSet;
        rmSync(postDir(s), { recursive: true, force: true });
      }
      log(`  rendered in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    }
  }
}

/** One post.py worker over a batch file; resolves when it exits cleanly. */
function postWorker(jobFile: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const env = { ...process.env, OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1' };
    const c = spawn('taskset', ['-c', RENDER_CPUS, PYTHON, join(ASSETS, 'post.py'), '--batch', jobFile], {
      cwd: GAME,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    c.stdout.on('data', (d: Buffer) => process.stdout.write(d));
    c.stderr.on('data', (d: Buffer) => {
      err += d.toString();
    });
    c.on('error', (e) => reject(e));
    c.on('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`post.py --batch ${jobFile} failed (${code ?? signal}):\n${err.slice(-6000)}`));
    });
  });
}

async function postPending(sets: PlanSet[], keys: Map<string, Keys>, force: boolean): Promise<void> {
  const postDir = (s: PlanSet): string => join(CACHE, 'post', (keys.get(s.set) as Keys).post);
  const pending = sets.filter((s) => force || !existsSync(join(postDir(s), 'set.json')));
  for (const s of pending.filter((x) => x.renderer === 'fx'))
    py('fx.py', [s.set, postDir(s)], { cpus: RENDER_CPUS });
  const jobs = pending
    .filter((s) => s.renderer !== 'fx')
    .map((s) => ({
      render_dir: join(CACHE, 'render', (keys.get(s.set) as Keys).render),
      out_dir: postDir(s),
      script: s.renderer === 'icons' || !s.script ? null : join(BLENDER_SRC, s.script),
      params: s.params ?? null,
    }));
  if (jobs.length === 0) return;
  const n = Math.max(1, Math.min(POST_WORKERS, jobs.length));
  const batches: (typeof jobs)[] = Array.from({ length: n }, () => []);
  for (const [i, j] of jobs.entries()) (batches[i % n] as typeof jobs).push(j);
  log(`post-processing ${jobs.length} set(s) in ${n} worker(s)`);
  const t0 = performance.now();
  await Promise.all(
    batches.map((b, i) => {
      const jf = join(CACHE, 'jobs', `post-${i}.json`);
      writeText(jf, canonicalJson(b));
      return postWorker(jf);
    }),
  );
  log(`  post-processed in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}

// --------------------------------------------------------------------------------------------------------------
// Groups and packing
// --------------------------------------------------------------------------------------------------------------

/** Estimated bytes on the wire of a set's Normal levels (§9.6's measured 3.06 bits per content pixel at Normal,
 * three levels) plus its shadows: only for merging technologies into groups; the inventory is the gate. */
function estimateBytes(p: PostSet): number {
  let b = 0;
  for (const f of p.frames) {
    if (f.parent !== undefined) continue;
    const px = f.w * f.h;
    if (f.array === 'colour') b += (px / 4) * (3.06 / 8) * (1 + 1 / 4 + 1 / 16);
    else if (f.array === 'shadow') b += px * (0.65 / 8);
    else b += px * (3.0 / 8);
  }
  return b;
}

function assignGroups(loaded: Loaded[], techOrder: string[]): void {
  const byTier = new Map<string, Map<string, Loaded[]>>();
  for (const l of loaded) {
    if (l.plan.tier === 'core') {
      l.group = 'core';
      continue;
    }
    const t = byTier.get(l.plan.tier) ?? new Map<string, Loaded[]>();
    byTier.set(l.plan.tier, t);
    const list = t.get(l.plan.tech) ?? [];
    list.push(l);
    t.set(l.plan.tech, list);
  }
  for (const tier of [...byTier.keys()].sort(compareCodeUnits)) {
    const techs = byTier.get(tier) as Map<string, Loaded[]>;
    const order = [...techs.keys()].sort((a, b) => techOrder.indexOf(a) - techOrder.indexOf(b));
    let n = 1;
    let bytes = 0;
    for (const tech of order) {
      const list = techs.get(tech) as Loaded[];
      const b = list.reduce((s, l) => s + estimateBytes(l.post), 0);
      if (bytes > 0 && bytes + b > GROUP_CAP_BYTES) {
        n++;
        bytes = 0;
      }
      bytes += b;
      for (const l of list) l.group = `${tier}/${n}`;
    }
  }
}

interface Cell {
  set: string;
  local: number;
  dir: string;
  file: string;
  pad: number;
  w: number;
  h: number;
  cw: number;
  ch: number;
  x: number;
  y: number;
}

interface Page {
  array: number;
  group: string;
  index: number;
  cells: Cell[];
}

const ceilTo = (v: number, a: number): number => Math.ceil(v / a) * a;

async function pack(loaded: Loaded[]): Promise<Page[]> {
  const mr = (await import('maxrects-packer/dist/maxrects-packer.mjs' as string)) as typeof MR;
  const groups = [...new Set(loaded.map((l) => l.group))].sort((a, b) =>
    a === 'core' ? -1 : b === 'core' ? 1 : compareCodeUnits(a, b),
  );
  const pages: Page[] = [];
  for (const arr of ARRAYS) {
    for (const g of groups) {
      const cells: Cell[] = [];
      for (const l of loaded.filter((x) => x.group === g)) {
        for (const f of l.post.frames) {
          if (f.array !== arr.kind || f.parent !== undefined) continue;
          cells.push({
            set: l.plan.set,
            local: f.id,
            dir: l.dir,
            file: f.file as string,
            pad: f.pad as number,
            w: f.w,
            h: f.h,
            cw: ceilTo(f.w + 2 * arr.gutter, arr.align),
            ch: ceilTo(f.h + 2 * arr.gutter, arr.align),
            x: 0,
            y: 0,
          });
        }
      }
      if (cells.length === 0) continue;
      cells.sort((a, b) =>
        compareTuples([-(a.cw * a.ch), -a.ch, a.set, a.local], [-(b.cw * b.ch), -b.ch, b.set, b.local]),
      );
      const packer = new mr.MaxRectsPacker(arr.pageSize, arr.pageSize, 0, {
        smart: false,
        pot: false,
        square: false,
        allowRotation: false,
        border: 0,
        logic: mr.PACKING_LOGIC.MAX_EDGE,
      });
      for (const c of cells) {
        if (c.cw > arr.pageSize || c.ch > arr.pageSize)
          throw new Error(`${c.set}: a ${c.w}×${c.h} frame does not fit a ${arr.kind} page`);
        packer.add(c.cw, c.ch, c);
      }
      packer.bins.forEach((bin, i) => {
        const pc: Cell[] = [];
        for (const r of bin.rects) {
          const c = r.data as Cell;
          c.x = r.x;
          c.y = r.y;
          if (c.x % arr.align !== 0 || c.y % arr.align !== 0)
            throw new Error(`pack: cell of ${c.set} off the ${arr.align}-px grid`);
          pc.push(c);
        }
        pc.sort((a, b) => compareTuples([a.y, a.x], [b.y, b.x]));
        pages.push({ array: ARRAY_INDEX[arr.kind], group: g, index: i, cells: pc });
      });
    }
  }
  return pages;
}

// --------------------------------------------------------------------------------------------------------------
// The manifest
// --------------------------------------------------------------------------------------------------------------

interface PageFiles {
  array: number;
  group: string;
  index: number;
  files: string[];
  bytes: number[];
  sha256: string[];
}

interface Assembled {
  pages: PageFiles[];
  dom: Record<string, unknown>;
}

function buildManifest(
  loaded: Loaded[],
  pages: Page[],
  assembled: Assembled,
  prototypesHash: string,
  extra: Record<string, unknown>,
) {
  // page index within its array (layer order: groups in page order) and each cell's position
  const layerOf = new Map<Page, number>();
  const perArray = ARRAYS.map(() => 0);
  for (const p of pages) {
    const layer = perArray[p.array] ?? 0;
    layerOf.set(p, layer);
    perArray[p.array] = layer + 1;
  }
  const cellOf = new Map<string, { page: Page; cell: Cell }>();
  for (const p of pages) for (const c of p.cells) cellOf.set(`${c.set}#${c.local}`, { page: p, cell: c });
  const frames: number[][] = [];
  const sets: Record<string, unknown> = {};
  const sorted = [...loaded].sort((a, b) => compareCodeUnits(a.plan.set, b.plan.set));
  for (const l of sorted) {
    const local = new Map<number, number>();
    const globalId = (fid: number): number => {
      const got = local.get(fid);
      if (got !== undefined) return got;
      const f = l.post.frames[fid] as Frame;
      const own = f.parent !== undefined ? (l.post.frames[f.parent] as Frame) : f;
      const where = cellOf.get(`${l.plan.set}#${own.id}`);
      if (!where) throw new Error(`manifest: frame ${fid} of ${l.plan.set} was not packed`);
      const arr = ARRAYS[where.page.array] as (typeof ARRAYS)[number];
      const fx = where.cell.x + arr.gutter + (f.sub ? f.sub[0] : 0);
      const fy = where.cell.y + arr.gutter + (f.sub ? f.sub[1] : 0);
      const id = frames.length;
      frames.push([where.page.array, layerOf.get(where.page) as number, fx, fy, f.w, f.h, f.ax, f.ay]);
      local.set(fid, id);
      return id;
    };
    const remap = (p: Part): Part => ({ ...p, table: p.table.map((e) => e.map(globalId)) });
    const parts: Record<string, unknown> = {};
    for (const [name, p] of Object.entries(l.post.parts).sort((a, b) => compareCodeUnits(a[0], b[0]))) {
      parts[name] = Array.isArray(p) ? p.map(remap) : remap(p);
    }
    const kind = l.plan.kind === 'icon' ? 'icon' : l.plan.set.startsWith('greybox/') ? 'entity' : l.post.kind;
    const s: Record<string, unknown> = { kind, group: l.group, parts };
    if (kind === 'entity' || kind === 'inserter') s.size = l.post.size;
    for (const [k, v] of Object.entries(l.post.extra)) s[k] = v;
    sets[l.plan.set] = s;
  }
  const pageList = ARRAYS.map((_, ai) =>
    assembled.pages
      .filter((p) => p.array === ai)
      .map((p) => ({ group: p.group, files: p.files, bytes: p.bytes, sha256: p.sha256 })),
  );
  return {
    version: MANIFEST_VERSION,
    axesVersion: AXES_VERSION,
    prototypesHash,
    style: 'survey-1',
    arrays: ARRAYS.map((a) => ({
      kind: a.kind,
      pxPerTile: a.pxPerTile,
      pageSize: a.pageSize,
      levels: a.levels,
      codec: a.codec,
    })),
    pages: pageList,
    frames,
    sets,
    dom: assembled.dom,
    ...extra,
  };
}

// --------------------------------------------------------------------------------------------------------------
// Publication (codex C6-r1 finding 7)
// --------------------------------------------------------------------------------------------------------------

/** Every file under public/ that a manifest names, directly or through the fonts index. */
function referencedFiles(manifest: {
  pages: { files: string[] }[][];
  terrain?: { tiles: Record<string, { file: string }> };
  dom?: Record<string, unknown>;
}): Set<string> {
  const keep = new Set<string>(['atlases/sprites.json', 'atlases/inventory.json']);
  for (const arr of manifest.pages) for (const p of arr) for (const f of p.files) keep.add(f);
  for (const t of Object.values(manifest.terrain?.tiles ?? {})) keep.add(t.file);
  const dom = (manifest.dom ?? {}) as {
    icons?: Record<string, string[]>;
    ui?: Record<string, string>;
    fonts?: string;
  };
  for (const files of Object.values(dom.icons ?? {})) for (const f of files) keep.add(f);
  for (const f of Object.values(dom.ui ?? {})) keep.add(f);
  if (dom.fonts) {
    keep.add(dom.fonts);
    const index = readJson<{ faces: { file: string; licence: string }[] }>(join(PUBLIC, dom.fonts));
    for (const face of index.faces) {
      keep.add(face.file);
      keep.add(face.licence);
    }
  }
  return keep;
}

/** Make the staged generation the published one: the inventory, then the manifest, each by one rename. */
function publish(): void {
  mkdirSync(ATLASES, { recursive: true });
  for (const f of ['inventory.json', 'sprites.json']) {
    const tmp = join(ATLASES, `${f}.${process.pid}.tmp`);
    writeFileSync(tmp, readFileSync(join(STAGE, f)));
    renameSync(tmp, join(ATLASES, f));
  }
}

/** After a publish: remove what the published manifest does not name from the directories the build owns. */
function collectPublic(keep: Set<string>): void {
  let n = 0;
  for (const d of OWNED) {
    const dir = join(PUBLIC, d);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (keep.has(`${d}/${f}`)) continue;
      rmSync(join(dir, f), { recursive: true, force: true });
      n++;
    }
  }
  if (n > 0) log(`public: removed ${n} file(s) no manifest names`);
}

/** Drops render and post cache entries that no set of the plan uses any more (the old keys of edited sets). */
function gcCache(keys: Map<string, Keys>): void {
  const pick = { render: (k: Keys) => k.render, post: (k: Keys) => k.post };
  for (const sub of ['render', 'post'] as const) {
    const keep = new Set([...keys.values()].map(pick[sub]));
    const dir = join(CACHE, sub);
    if (!existsSync(dir)) continue;
    let n = 0;
    for (const e of readdirSync(dir)) {
      if (keep.has(e)) continue;
      rmSync(join(dir, e), { recursive: true, force: true });
      n++;
    }
    if (n > 0) log(`cache: dropped ${n} stale ${sub} entries`);
  }
}

/** Drops decoded pages (.cache/assets/unpack/<file>.<format>, emulate.py's) of files no manifest names any more. */
function gcUnpack(keep: Set<string>): void {
  const dir = join(CACHE, 'unpack');
  if (!existsSync(dir)) return;
  const names = new Set([...keep].map((f) => f.slice(f.lastIndexOf('/') + 1)));
  let n = 0;
  for (const e of readdirSync(dir)) {
    if (names.has(e.slice(0, e.lastIndexOf('.')))) continue;
    rmSync(join(dir, e), { recursive: true, force: true });
    n++;
  }
  if (n > 0) log(`cache: dropped ${n} stale decoded pages`);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const t0 = performance.now();
  mkdirSync(CACHE, { recursive: true });
  if (args.checkOnly) {
    py('checks.py', ['--fixtures-only']);
    return 0;
  }
  const { prototypesHash } = ensureData();
  const planPath = join(CACHE, 'plan.json');
  py('plan.py', ['--out', planPath], { quiet: true });
  const plan = readJson<{ sets: PlanSet[]; tech_order: string[]; toolchain: unknown }>(planPath);
  log(`${plan.sets.length} sets planned`);
  const blender = blenderVersion(args.render);
  const libHash = dirPyHash(join(BLENDER_SRC, 'lib'));
  const keys = new Map<string, Keys>();
  for (const s of plan.sets) keys.set(s.set, setKeys(s, blender, libHash, plan.toolchain));
  renderPending(plan.sets, keys, args);
  await postPending(plan.sets, keys, args.force && args.only === undefined);
  const loaded: Loaded[] = plan.sets.map((s) => {
    const dir = join(CACHE, 'post', (keys.get(s.set) as Keys).post);
    const sj = join(dir, 'set.json');
    if (!existsSync(sj)) throw new Error(`no post output for ${s.set} (render it first)`);
    return { plan: s, post: readJson<PostSet>(sj), dir, group: 'core' };
  });
  assignGroups(loaded, plan.tech_order);
  const pages = await pack(loaded);
  const layoutPath = join(CACHE, 'layout.json');
  writeText(
    layoutPath,
    canonicalJson({ arrays: ARRAYS, pages: pages.map((p) => ({ ...p, cells: p.cells })) }),
  );
  log(
    `packed ${pages.length} page(s): ${ARRAYS.map((a, i) => `${a.kind} ${pages.filter((p) => p.array === i).length}`).join(', ')}`,
  );
  // everything below only adds content-named files to public/ until the gates have passed
  py('assemble.py', ['--layout', layoutPath, '--out', join(CACHE, 'assembled.json')], { cpus: RENDER_CPUS });
  const assembled = readJson<Assembled>(join(CACHE, 'assembled.json'));
  py('terrain.py', ['--out', join(CACHE, 'terrain.json')], { cpus: RENDER_CPUS });
  const terrain = readJson<Record<string, unknown>>(join(CACHE, 'terrain.json'));
  // the fonts first: the skin's stylesheet carries their @font-face rules
  py('fonts.py', ['--out', join(CACHE, 'fonts.json')], { cpus: RENDER_CPUS });
  const fonts = readJson<{ index: string }>(join(CACHE, 'fonts.json'));
  py('ui.py', ['--out', join(CACHE, 'ui.json'), '--fonts', join(CACHE, 'fonts.json')], { cpus: RENDER_CPUS });
  const ui = readJson<{ css: string; fibre: string; glyphs: string }>(join(CACHE, 'ui.json'));
  assembled.dom = {
    ...assembled.dom,
    ui: { css: ui.css, fibre: ui.fibre, glyphs: ui.glyphs },
    fonts: fonts.index,
  };
  const manifest = buildManifest(loaded, pages, assembled, prototypesHash, { terrain });
  rmSync(STAGE, { recursive: true, force: true });
  const staged = join(STAGE, 'sprites.json');
  writeText(staged, canonicalJson(manifest, 1));
  // the gates (each exits non-zero on a failure, which stops the build before anything is published)
  py('inventory.py', [
    '--manifest',
    staged,
    '--out',
    join(STAGE, 'inventory.json'),
    '--gate-core',
    String(CORE_CAP_BYTES),
    '--gate-group',
    String(GROUP_CAP_BYTES),
  ]);
  py('checks.py', ['--manifest', staged, '--layout', layoutPath]);
  py('metrics.py', ['--manifest', staged, '--gate'], { cpus: RENDER_CPUS });
  if (args.qc) {
    // the projection calibration (renders its model with Blender unless --no-render) and the contract examples
    run(PYTHON, [join(GAME, 'test', 'assets', 'projection.py'), ...(args.render ? [] : ['--no-render'])]);
    run(PYTHON, [join(GAME, 'test', 'assets', 'examples.py'), ...(args.render ? [] : ['--no-render'])]);
    // the UI skin in a Factorio-layout window, screenshotted in Chrome at device pixel ratios 1 and 2: no console
    // errors (a missing font, sheet or glyph fails)
    py('ui_demo.py', ['--manifest', staged], { quiet: true });
    for (const dpr of ['1', '2'])
      run(process.execPath, [
        join(ASSETS, 'shoot.mjs'),
        'qc-ui.html',
        join(CACHE, 'qc', `ui-demo-${dpr}x.png`),
        '--dpr',
        dpr,
        '--size',
        '1130x420',
      ]);
  }
  // every file the staged manifest names must exist before it is published
  const keep = referencedFiles(manifest);
  const published = new Set(['atlases/sprites.json', 'atlases/inventory.json']);
  const absent = [...keep].filter((f) => !published.has(f) && !existsSync(join(PUBLIC, f)));
  if (absent.length > 0) throw new Error(`publish: the manifest names missing files: ${absent.join(', ')}`);
  publish();
  collectPublic(keep);
  gcCache(keys);
  gcUnpack(keep);
  log(`published public/atlases/sprites.json (${Object.keys(manifest.sets).length} sets)`);
  if (args.qc) {
    // review material in .cache/assets/qc/: contact sheets and GIFs, the preview scene, the budgets
    py('contact.py', [], { cpus: RENDER_CPUS });
    for (const [zoom, dpr, night] of [
      ['1', '1', '0'],
      ['2', '1', '0'],
      ['1', '2', '0'],
      ['1', '1', '1'],
    ] as const)
      py('preview.py', ['--zoom', zoom, '--dpr', dpr, '--night', night], { cpus: RENDER_CPUS });
    py('budget.py', [], { quiet: true });
  }
  log(`done in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  return 0;
}

export { buildManifest, ceilTo, estimateBytes, referencedFiles };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    },
  );
}
