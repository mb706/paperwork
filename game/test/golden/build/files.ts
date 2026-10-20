// Every file of the golden set (test/golden/m0/), as bytes, from one run of the reference model. The text
// files are review aids: dumps in the codec fixtures' `path=value` format, compacted where a raw dump would
// be thousands of lines of zeros (chunk tiles are drawn as a 32 × 32 character map instead).
import { createHash } from 'node:crypto';
import { SaveOutputCodec, SubscribeInputCodec } from '../../../src/shared/gen/abi.ts';
import { closureActions, decodeAction, dumpAction } from '../../../src/shared/gen/actions.ts';
import { Dump, Writer } from '../../../src/shared/gen/codec.ts';
import {
  parseClosureLog,
  readSaveContainer,
  SectionFrameCodec,
  writeClosureLog,
} from '../../../src/shared/gen/container.ts';
import { ViewRequestCodec } from '../../../src/shared/gen/packet.ts';
import { decodeContainerPool, decodeEntityTable } from '../../../src/shared/gen/pools.ts';
import {
  DigestResultCodec,
  InspectResultCodec,
  ProjectionKind,
  QueryKind,
  StateHashCodec,
  type SubRequest,
} from '../../../src/shared/gen/projections.ts';
import { SCHEMA_HASH } from '../../../src/shared/gen/schema.ts';
import {
  decodeChunks,
  decodeGenerated,
  decodeGlobals,
  decodePlayers,
  decodeSlotHeap,
  decodeStats,
  SECTIONS,
} from '../../../src/shared/gen/sections.ts';
import {
  ChunkCodec,
  GeneratedChunkCodec,
  GlobalsCodec,
  PlayerCodec,
  SlotHeapCodec,
  StatCodec,
} from '../../../src/shared/gen/state.ts';
import { dumpPacket, UI_CODECS } from '../../helpers/packets.ts';
import { Module, saveOutput } from '../model/module.ts';
import { buildRecord, debugRecord, runQuery } from '../model/projections.ts';
import { lineage0, Sim, Status } from '../model/sim.ts';
import { members, sliceHash } from '../model/slices.ts';
import { World } from '../model/world.ts';
import { hex64, xxh64 } from '../model/xxh64.ts';
import { collisionWorld } from './collisions.ts';
import {
  abiCases,
  closureCases,
  logCases,
  type NegativeCase,
  STATUS,
  saveCases,
  staleModule,
  staleProtos,
} from './negatives.ts';
import { worldgenDataHash } from './protos.ts';
import { goldenSubs, goldenView, PACKET_TICKS, type RunResult, run, STATE_TICKS } from './run.ts';
import { blobBytes, sha256Hex, TICKS } from './scenario.ts';
import { START } from './start.ts';
import { traces } from './trace-defs.ts';
import { dumpOut, type IndexedCall, initInput, invoke, loadInput, record, STATUS_NAME } from './traces.ts';

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const pad4 = (t: number) => String(t).padStart(4, '0');

/** `sim_save`'s output (abi.yaml `SaveOutput`): the sections, then the lineage r the save carries (§4.8 item 4). */
export function saveOutputBytes(
  sections: readonly { id: number; bytes: Uint8Array }[],
  r: bigint,
): Uint8Array {
  return saveOutput(
    sections.map(({ id, bytes }) => {
      const info = SECTIONS.find((s) => s.id === id);
      if (!info) throw new Error(`unknown section ${id}`);
      return { id, version: info.version, flags: info.hashed ? 1 : 0, data: bytes };
    }),
    r,
  );
}

/** u32 count, then each section in the container's framing, codec raw (SaveOutput without the lineage). */
export function sectionsBytes(sections: readonly { id: number; bytes: Uint8Array }[]): Uint8Array {
  const w = new Writer();
  w.u32(sections.length, 'sections');
  for (const { id, bytes } of sections) {
    const info = SECTIONS.find((s) => s.id === id);
    if (!info) throw new Error(`unknown section ${id}`);
    SectionFrameCodec.write(w, {
      id,
      version: info.version,
      codec: 0,
      flags: info.hashed ? 1 : 0,
      raw_length: bytes.length,
      data: bytes,
    });
  }
  return w.finish();
}

/** Drops dump lines of all-zero floats (the statistics rings' empty points). */
const noZeroPoints = (s: string): string =>
  s
    .split('\n')
    .filter((l) => !/\.(produced|consumed)\[\d+\]=f32:00000000$/.test(l))
    .join('\n');

/** Rewrites runs of `<prefix>.tiles[j]=v` dump lines as 32 rows of 32 tile ids in base 36 (a map). */
export function compactTiles(dump: string): string {
  const out: string[] = [];
  let run: { prefix: string; ids: number[] } | null = null;
  const flush = () => {
    if (!run) return;
    for (let y = 0; y < run.ids.length / 32; y++)
      out.push(
        `${run.prefix}.tiles.row${String(y).padStart(2, '0')}=${run.ids
          .slice(y * 32, y * 32 + 32)
          .map((t) => t.toString(36))
          .join('')}`,
      );
    run = null;
  };
  for (const line of dump.split('\n')) {
    const m = /^(.*)\.tiles\[(\d+)\]=(\d+)$/.exec(line);
    if (m) {
      const prefix = m[1] as string;
      if (!run || run.prefix !== prefix) {
        flush();
        run = { prefix, ids: [] };
      }
      run.ids.push(Number(m[3]));
      continue;
    }
    flush();
    out.push(line);
  }
  flush();
  return out.join('\n');
}

/** A readable dump of the hashed sections (README "Dumps"). */
export function dumpSections(sections: readonly { id: number; bytes: Uint8Array }[]): string {
  const out: string[] = [];
  const get = (id: number) => (sections.find((s) => s.id === id) as { bytes: Uint8Array }).bytes;
  const d = (f: (d: Dump) => void): string => {
    const x = new Dump();
    f(x);
    return x.out;
  };
  out.push('# ENTITY_TABLE');
  decodeEntityTable(get(1)).forEach((row, i) => {
    out.push(
      Object.entries(row)
        .map(([k, v]) => `entity_table[${i}].${k}=${v}`)
        .join('\n'),
    );
  });
  out.push(
    '# GLOBALS',
    d((x) => GlobalsCodec.dump(x, decodeGlobals(get(2)), 'globals.')),
  );
  out.push(
    '# SLOT_HEAP',
    d((x) => SlotHeapCodec.dump(x, decodeSlotHeap(get(3)), 'slot_heap.')),
  );
  out.push('# CHUNKS (tiles drawn as a 32 × 32 map of tile ids in base 36)');
  for (const c of decodeChunks(get(5))) {
    const { tiles, ...rest } = c;
    const lines = d((x) => ChunkCodec.dump(x, { ...c }, `chunk[${c.key}].`))
      .split('\n')
      .filter((l) => !/\.tiles\[\d+\]=/.test(l));
    out.push(lines.join('\n').trimEnd());
    for (let y = 0; y < 32; y++)
      out.push(
        `chunk[${c.key}].tiles.row${String(y).padStart(2, '0')}=${tiles
          .slice(y * 32, y * 32 + 32)
          .map((t) => t.toString(36))
          .join('')}`,
      );
    void rest;
  }
  out.push('# TIMERS, RNG, WORLDGEN_PENDING: empty in M0 (u32 count 0)');
  out.push('# PLAYERS');
  for (const p of decodePlayers(get(11)))
    out.push(d((x) => PlayerCodec.dump(x, p, `player[${p.index}].`)).trimEnd());
  out.push('# STATS (all-zero ring points left out)');
  for (const s of decodeStats(get(13)))
    out.push(noZeroPoints(d((x) => StatCodec.dump(x, s, `stat[${s.key}].`))).trimEnd());
  out.push('# GENERATED');
  for (const g of decodeGenerated(get(17)))
    out.push(d((x) => GeneratedChunkCodec.dump(x, g, `generated[${g.key}].`)).trimEnd());
  out.push('# POOL_CONTAINER');
  decodeContainerPool(get(32)).forEach((row, i) => {
    out.push(`container[${i}].entity=${row.entity}\ncontainer[${i}].inv=${row.inv}`);
  });
  return `${out.join('\n')}\n`;
}

const KIND = new Map<number, string>(Object.entries(ProjectionKind).map(([k, v]) => [v as number, k]));

/** The standalone records of every M0 projection at a tick (evaluated fresh: STATS series whole). */
function projectionFiles(r: RunResult, t: number, files: Map<string, Uint8Array>): void {
  const sim = r.sims.get(t);
  if (!sim) throw new Error(`no state at ${t}`);
  const chests = sim.w.liveEntities().map((e) => e.serial);
  const req = (kind: number, target: number, p0 = 0, p1 = 0, p2 = 0): SubRequest => ({
    sub_id: 1,
    kind,
    flags: 0,
    target,
    p0,
    p1,
    p2,
    p3: 0,
  });
  const set: [string, SubRequest][] = [
    ['hud', req(ProjectionKind.hud, 0)],
    ['character-p0', req(ProjectionKind.character, 0)],
    ['character-p1', req(ProjectionKind.character, 1)],
    ...chests.flatMap((s): [string, SubRequest][] => [
      [`inventory-${s}`, req(ProjectionKind.inventory, s, 2)],
      [`entity-panel-${s}`, req(ProjectionKind.entity_panel, s)],
      [`hover-${s}`, req(ProjectionKind.hover, s)],
    ]),
    ['stats-s5', req(ProjectionKind.stats, 0, 0, 0, 1)],
    ['stats-m1', req(ProjectionKind.stats, 0, 1, 0, 1)],
    ['stats-all', req(ProjectionKind.stats, 0, 8, 0, 1)],
  ];
  const index: string[] = [
    `# Projection records at tick ${t}, each evaluated as a fresh subscription (STATS: whole series).`,
  ];
  for (const [name, q] of set) {
    const { built } = buildRecord(sim, q, null);
    const head = `${name} kind=${KIND.get(q.kind)} target=${q.target} p0=${q.p0} p1=${q.p1} p2=${q.p2}`;
    if (built.status === 0) {
      files.set(`projections/tick-${pad4(t)}/${name}.bin`, built.body);
      const d = new Dump();
      (UI_CODECS.get(q.kind) as { dump(d: Dump, v: unknown, p: string): void }).dump(
        d,
        UI_CODECS.get(q.kind)?.decode(built.body),
        '',
      );
      index.push(`## ${head} status=ok bytes=${built.body.length}`, noZeroPoints(d.out).trimEnd());
    } else index.push(`## ${head} status=${built.status === 1 ? 'gone' : `invalid reason=${built.reason}`}`);
  }
  // DEBUG: memory_bytes, the pools' capacity and phase_us are implementation-defined (masked); d and r are pinned.
  files.set(`projections/tick-${pad4(t)}/debug.bin`, debugRecord(sim));
  const dd = new Dump();
  (UI_CODECS.get(ProjectionKind.debug) as { dump(d: Dump, v: unknown, p: string): void }).dump(
    dd,
    UI_CODECS.get(ProjectionKind.debug)?.decode(debugRecord(sim)),
    '',
  );
  index.push('## debug kind=debug (masked: memory_bytes, pools[].capacity, phase_us)', dd.out.trimEnd());
  files.set(`projections/tick-${pad4(t)}.txt`, text(`${index.join('\n')}\n`));

  // Queries (§15.5): inspect each chest and one serial that is no entity, the state hash, the digest.
  const q: string[] = [`# Query results at tick ${t}.`];
  const qp = (serial: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, serial, true);
    return b;
  };
  for (const s of [...chests, 1]) {
    const a = runQuery(sim, QueryKind.inspect, 0, qp(s));
    if (!a.ok) throw new Error('inspect failed');
    files.set(`queries/tick-${pad4(t)}/inspect-${s}.bin`, a.body);
    const d = new Dump();
    InspectResultCodec.dump(d, InspectResultCodec.decode(a.body), '');
    q.push(`## inspect ${s}`, d.out.trimEnd());
  }
  for (const [name, kind, codec] of [
    ['hash', QueryKind.hash, StateHashCodec],
    ['digest', QueryKind.digest, DigestResultCodec],
  ] as const) {
    const a = runQuery(sim, kind, 0, new Uint8Array());
    if (!a.ok) throw new Error(`${name} failed`);
    files.set(`queries/tick-${pad4(t)}/${name}.bin`, a.body);
    const d = new Dump();
    (codec as { dump(d: Dump, v: unknown, p: string): void }).dump(
      d,
      (codec as { decode(b: Uint8Array): unknown }).decode(a.body),
      '',
    );
    q.push(`## ${name}`, d.out.trimEnd());
  }
  const unsupported = runQuery(sim, QueryKind.rates, 0, new Uint8Array());
  q.push(
    `## rates (outside M0's manifest): ok=${unsupported.ok} reason=${unsupported.ok ? '' : unsupported.reason}`,
  );
  files.set(`queries/tick-${pad4(t)}.txt`, text(`${q.join('\n')}\n`));
}

function closureLogText(r: RunResult): string {
  const out: string[] = [
    '# The closure log, record by record: each batch, then each action with its seq and dump.',
  ];
  for (const [t, closure] of [...r.stamped.closures.entries()].sort((a, b) => a[0] - b[0])) {
    out.push(`tick ${t} (${closure.length} bytes)`);
    for (const a of closureActions(closure)) {
      const who = a.system ? 'system' : `player ${a.player}`;
      let body: string;
      try {
        const d = new Dump();
        dumpAction(d, decodeAction(a.type, a.payload));
        body = d.out.trimEnd().split('\n').join(' ');
      } catch {
        body = `malformed type=${a.type} payload=${Buffer.from(a.payload).toString('hex')}`;
      }
      out.push(`  ${who} seq ${a.seq}: ${body}`);
    }
  }
  return `${out.join('\n')}\n`;
}

/**
 * What the generated decoders make of a malformed ABI input (§15.8: a malformed request is ERR_INPUT; records
 * are read strictly, C1b decision 8), or the prototypes check (ERR_PROTOS).
 */
/**
 * An ABI negative case, executed (GATE-r1 finding 11): a fresh Module of the reference model, booted with the
 * golden prototypes and start save unless the call is sim_init itself, then the call; the status it returns,
 * after checking that the refusal left the state as it was.
 */
function abiVerdict(r: RunResult, call: string, b: Uint8Array): string {
  const m = new Module();
  if (call !== 'sim_init' && !call.startsWith('gen_')) {
    const boot = [
      invoke(m, { call: 'sim_init', in: initInput(r.protos.bin) }),
      invoke(m, {
        call: 'sim_load',
        in: loadInput(readSaveContainer(r.start.bytes).frames, r.start.lineage),
      }),
    ];
    if (boot.some((x) => x.status !== 0)) throw new Error('the boot failed');
  }
  const before = m.sim?.w.stateHash().hash ?? null;
  const res = invoke(m, { call, in: b });
  const after = m.sim?.w.stateHash().hash ?? null;
  if (res.status !== 0 && before !== after) throw new Error(`${call}: a refusal changed the state`);
  return STATUS_NAME.get(res.status) ?? String(res.status);
}

function negativeFiles(r: RunResult, log: Uint8Array, files: Map<string, Uint8Array>): NegativeCase[] {
  const cases: NegativeCase[] = [
    ...closureCases(),
    ...logCases(log),
    ...saveCases(r.start.bytes),
    ...abiCases(r.protos.bin),
  ];
  // Verify every case the model can judge, so the expectations are the model's, not a guess.
  const build = { worldgenVersion: START.worldgenVersion, worldgenDataHash: worldgenDataHash(r.protos.bin) };
  for (const c of cases) {
    if (c.file?.startsWith('closures/')) {
      const sim = new Sim(World.load(r.model, readSaveContainer(r.start.bytes).frames), r.start.lineage);
      const res = sim.tick(c.bytes as Uint8Array, new Set());
      const want = STATUS[c.expect as keyof typeof STATUS];
      if (res.status !== want)
        throw new Error(`${c.file}: the model returns ${res.status}, the case expects ${c.expect}`);
      if (sim.w.stateHash().hash !== (r.stateHashes.get(0) as { hash: bigint }).hash)
        throw new Error(`${c.file} changed the world`);
      if (res.status === Status.ok) throw new Error('a negative closure passed');
    } else if (c.file?.startsWith('logs/')) {
      try {
        parseClosureLog(c.bytes as Uint8Array);
        throw new Error(`${c.file} parsed`);
      } catch (e) {
        const k = (e as { kind?: string }).kind;
        if (!k) throw e;
        c.expect = `${k} ${(e as { field: string }).field} @${(e as { at: number }).at}`;
      }
    } else if (c.file?.startsWith('abi/') && c.bytes) {
      const verdict = abiVerdict(r, c.call, c.bytes);
      if (verdict !== c.expect)
        throw new Error(`${c.file}: the model's module says ${verdict}, the case expects ${c.expect}`);
    } else if (c.file?.startsWith('saves/')) {
      let verdict: string;
      try {
        const frames = readSaveContainer(c.bytes as Uint8Array).frames;
        verdict = World.check(frames, build);
        if (verdict === 'ok') World.load(r.model, frames);
      } catch (e) {
        const k = (e as { kind?: string }).kind;
        if (!k) throw e;
        verdict = k === 'schema_mismatch' ? 'err_load_schema' : `refused by the container reader (${k})`;
      }
      if (verdict !== c.expect)
        throw new Error(`${c.file}: the model says ${verdict}, the case expects ${c.expect}`);
    }
    if (c.file && c.bytes) files.set(`negative/${c.file}`, c.bytes);
  }
  files.set('negative/module/stale-schema.wasm', staleModule());
  files.set('negative/protos/stale-schema.bin', staleProtos(r.protos.bin));
  cases.push(
    {
      file: 'module/stale-schema.wasm',
      call: 'the shell: compile, instantiate, sim_schema_hash',
      expect: 'refused by the handshake',
      why: 'another schema hash (§15.1)',
    },
    {
      file: 'protos/stale-schema.bin',
      call: 'sim_init (InitInput around it)',
      expect: 'err_protos',
      why: "the header's schema hash is another schema's (§15.2)",
    },
  );
  const index = cases.map((c) => ({ file: c.file, call: c.call, expect: c.expect, why: c.why }));
  files.set('negative/index.json', text(`${JSON.stringify(index, null, 2)}\n`));
  return cases;
}

export interface Golden {
  files: Map<string, Uint8Array>;
  run: RunResult;
}

export function goldenFiles(): Golden {
  const r = run();
  const files = new Map<string, Uint8Array>();
  files.set('protos/prototypes.bin', r.protos.bin);
  files.set('protos/prototypes.json', r.protos.json);
  files.set('start.save', r.start.bytes);

  // The closure log (§8.5) with every digest and the blob.
  const blob = blobBytes();
  const log = writeClosureLog({
    header: {
      action_schema_version: 1,
      flags: 1,
      start_tick: 0,
      end_tick: TICKS,
      build_hash: { bytes: new Uint8Array(32) },
      prototypes_hash: { bytes: new Uint8Array(createHash('sha256').update(r.protos.bin).digest()) },
      start_state_hash: (r.stateHashes.get(0) as { hash: bigint }).hash,
      digest_first_tick: 1,
    },
    records: [...r.stamped.closures.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([tick, closure]) => ({ tick, closure })),
    digests: r.digests,
    blobs: [{ sha256: { bytes: new Uint8Array(Buffer.from(sha256Hex(blob), 'hex')) }, bytes: blob }],
  });
  parseClosureLog(log);
  files.set('closure-log.pwlog', log);
  files.set('closure-log.txt', text(closureLogText(r)));
  files.set(
    'digests.txt',
    text(
      `# tick, then d_t, slice_t and r_t (§4.8 items 1–3), hex. r_0 = ${hex64(r.start.lineage)} (start.save's lineage); slice t hashes shard t mod 3600 (README rules 37–41)\n${r.rolls.map((x, i) => `${i + 1} ${hex64(x.d)} ${hex64(x.slice)} ${hex64(x.r)}`).join('\n')}\n`,
    ),
  );
  // The bytes d_t hashes at the state ticks and wherever its lists change shape (§4.8's sequence, exactly).
  files.set(
    'digest-preimages.txt',
    text(
      `# tick, then the exact bytes XXH64 hashes for d_t (TickDigestHead ‖ RngWords* ‖ TickDigestBody ‖ PlayerDigest* ‖ TickDigestTail), hex\n${[
        ...r.preimages.entries(),
      ]
        .sort((a, b) => a[0] - b[0])
        .map(([t, b]) => `${t} ${Buffer.from(b).toString('hex')}`)
        .join('\n')}\n`,
    ),
  );
  // Every shard's slice hash of the state after tick 600, and the members behind them (README rules 37–41).
  {
    const sim600 = r.sims.get(600) as Sim;
    const all = members(sim600.w);
    const lines = [
      '# shard, then XXH64 of its members (the slice hash of a tick t with t mod 3600 = shard), hex',
    ];
    for (let shard = 0; shard < 3600; shard++) lines.push(`${shard} ${hex64(sliceHash(sim600.w, shard))}`);
    files.set('slices/tick-0600.txt', text(`${lines.join('\n')}\n`));
    const ml = ['# section, key, shard, length, XXH64 of the member bytes (hex), in (section, key) order'];
    for (const m of all) {
      const b = m.bytes();
      ml.push(`${m.section} ${m.key} ${m.shard} ${b.length} ${hex64(xxh64(b))}`);
    }
    files.set('slices/tick-0600-members.txt', text(`${ml.join('\n')}\n`));
    // Rows reused out of serial order, with serials and free rows colliding in shard 3 (GATE-r2 finding 1).
    const cw = collisionWorld(r.model, r.start.bytes);
    files.set('slices/collisions.sections', saveOutputBytes(cw.sections(), lineage0(START.seed)));
    const cl = [
      '# shard, then the slice hash of the state in collisions.sections (rule 41: members sorted by section and key), hex',
    ];
    for (let shard = 0; shard < 3600; shard++) cl.push(`${shard} ${hex64(sliceHash(cw, shard))}`);
    files.set('slices/collisions.txt', text(`${cl.join('\n')}\n`));
    const cm = ['# section, key, shard, length, XXH64 of the member bytes (hex), in (section, key) order'];
    for (const m of members(cw)) {
      const b = m.bytes();
      cm.push(`${m.section} ${m.key} ${m.shard} ${b.length} ${hex64(xxh64(b))}`);
    }
    files.set('slices/collisions-members.txt', text(`${cm.join('\n')}\n`));
  }
  // Valid logs a reader must accept (§8.5): the empty log, and the golden log without its digests.
  files.set(
    'logs/empty.pwlog',
    writeClosureLog({
      header: {
        action_schema_version: 1,
        flags: 0,
        start_tick: 0,
        end_tick: 0,
        build_hash: { bytes: new Uint8Array(32) },
        prototypes_hash: { bytes: new Uint8Array(32) },
        start_state_hash: 0n,
        digest_first_tick: 0,
      },
      records: [],
      digests: [],
      blobs: [],
    }),
  );
  const noDigests = parseClosureLog(log);
  files.set(
    'logs/no-digests.pwlog',
    writeClosureLog({
      header: { ...noDigests.header, flags: 0, digest_first_tick: 0 },
      records: noDigests.records,
      digests: [],
      blobs: noDigests.blobs,
    }),
  );

  const outcomes = r.outcomes.map(
    (o) =>
      `${String(o.tick).padStart(4)}  ${o.player === 0xffff ? 'system  ' : `player ${o.player}`}  seq ${String(o.seq).padStart(3)}  ${o.result.padEnd(36)}  ${o.why}`,
  );
  files.set(
    'scenario.txt',
    text(
      `# Every action of the closure log, what it tests, and what the reference model did with it.\n${outcomes.join('\n')}\n`,
    ),
  );

  files.set('view.bin', ViewRequestCodec.encode(goldenView(2)));
  files.set('subs.bin', SubscribeInputCodec.encode({ subs: goldenSubs() }));

  const hashes: string[] = ["# The full state hash (§4.8) and each section's, at each state tick (hex)."];
  for (const t of STATE_TICKS) {
    const s = r.states.get(t) as { id: number; bytes: Uint8Array }[];
    files.set(`states/tick-${pad4(t)}.sections`, saveOutputBytes(s, r.lineages.get(t) as bigint));
    files.set(`states/tick-${pad4(t)}.txt`, text(dumpSections(s)));
    const h = r.stateHashes.get(t) as { hash: bigint; sections: { id: number; hash: bigint }[] };
    hashes.push(
      `tick ${t} ${hex64(h.hash)} r ${hex64(r.lineages.get(t) as bigint)} ${h.sections.map((x) => `${x.id}:${hex64(x.hash)}`).join(' ')}`,
    );
  }
  hashes.push(
    `lineage r0 ${hex64(lineage0(START.seed))} (start.save's: XXH64(u32 seed ‖ u32 0), §4.8 item 3)`,
  );
  files.set('states/hashes.txt', text(`${hashes.join('\n')}\n`));

  for (const p of r.packets) {
    files.set(`packets/${p.name}.bin`, p.bytes);
    files.set(`packets/${p.name}.txt`, text(compactTiles(noZeroPoints(dumpPacket(p.bytes)))));
  }
  void PACKET_TICKS;
  for (const t of STATE_TICKS) projectionFiles(r, t, files);
  negativeFiles(r, log, files);
  traceFiles(r, files);
  void SCHEMA_HASH;
  return { files, run: r };
}

/**
 * The ABI traces (README "ABI traces"): m0/abi/traces.json indexes every trace's calls; inputs and envelopes
 * are files beside it (an input shared by several calls is written once, under abi/inputs/), each envelope with
 * a review dump.
 */
function traceFiles(r: RunResult, files: Map<string, Uint8Array>): void {
  const defs = traces({ protosBin: r.protos.bin, protos: r.model, startSave: r.start.bytes });
  const inputs = new Map<string, string>(); // sha256 → path
  const counts = new Map<string, number>();
  for (const t of defs)
    for (const c of t.calls)
      if (c.in && c.in.length > 0) counts.set(sha256Hex(c.in), (counts.get(sha256Hex(c.in)) ?? 0) + 1);
  let shared = 0;
  const index = defs.map((t) => {
    const rec = record(t);
    const calls: IndexedCall[] = rec.map((c, i) => {
      const n = String(i + 1).padStart(2, '0');
      let inPath: string | null = null;
      if (c.in && c.in.length > 0) {
        const h = sha256Hex(c.in);
        inPath = inputs.get(h) ?? null;
        if (!inPath) {
          inPath =
            (counts.get(h) ?? 0) > 1
              ? `abi/inputs/${c.call}-${String(++shared).padStart(2, '0')}.bin`
              : `abi/traces/${t.name}/${n}-${c.call}.in.bin`;
          inputs.set(h, inPath);
          files.set(inPath, c.in);
        }
      }
      let outPath: string | null = null;
      if (c.out) {
        outPath = `abi/traces/${t.name}/${n}-${c.call}.out.bin`;
        files.set(outPath, c.out);
        files.set(outPath.replace(/\.bin$/, '.txt'), text(`${reviewDump(c.call, c.out)}\n`));
      }
      const e: IndexedCall = { call: c.call, in: inPath, status: c.status, out: outPath };
      if (c.params) e.params = c.params;
      if (c.state) e.state = c.state;
      if (c.note) e.note = c.note;
      return e;
    });
    return { name: t.name, why: t.why, calls };
  });
  files.set(
    'abi/traces.json',
    text(
      `${JSON.stringify({ version: 1, note: 'README.md "ABI traces": replay each trace against a fresh module', traces: index }, null, 2)}\n`,
    ),
  );
}

/**
 * A trace envelope's review dump: a save as its decoded sections (like states/), a packet or record with its
 * codec, compacted; past 4,000 lines the dump stops (the .bin beside it is complete).
 */
function reviewDump(call: string, b: Uint8Array): string {
  let d: string;
  if (call === 'sim_save') {
    const v = SaveOutputCodec.decode(b);
    d = `lineage r ${hex64(v.r)}\n${dumpSections(v.sections.map((f) => ({ id: f.id, bytes: f.data })))}`;
  } else d = compactTiles(noZeroPoints(dumpOut(call, b)));
  const lines = d.trimEnd().split('\n');
  return lines.length <= 4000
    ? lines.join('\n')
    : `${lines.slice(0, 4000).join('\n')}\n… ${lines.length - 4000} more lines (the .bin beside this file is complete)`;
}
