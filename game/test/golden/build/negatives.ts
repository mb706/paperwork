// The golden set's negative cases (10 §15.10): closures that fail each preflight check, truncated and
// trailing closure logs and saves, a save from another worldgen version, a malformed record for every ABI
// input, prototypes and a module with a stale schema hash. Each case names the status the sim must return.
import { createHash } from 'node:crypto';
import { NewWorldCodec, SaveInputCodec } from '../../../src/shared/gen/abi.ts';
import { actionBytes, encodeClosure } from '../../../src/shared/gen/actions.ts';
import { Writer } from '../../../src/shared/gen/codec.ts';
import {
  readSaveContainer,
  type SaveHeader,
  type SectionFrame,
  writeSaveContainer,
} from '../../../src/shared/gen/container.ts';
import { ViewRequestCodec } from '../../../src/shared/gen/packet.ts';
import { SCHEMA_HASH } from '../../../src/shared/gen/schema.ts';
import {
  decodeChunks,
  decodeGlobals,
  encodeChunks,
  encodeGlobals,
} from '../../../src/shared/gen/sections.ts';

/** `SimStatus` names (§15.8). */
export const STATUS = {
  ok: 0,
  err_framing: 1,
  err_blob_missing: 2,
  err_load_format: 3,
  err_load_schema: 4,
  err_protos: 5,
  err_order: 6,
  err_input: 7,
  err_limit: 8,
  err_worldgen: 9,
} as const;

export interface NegativeCase {
  /** A file under negative/, or null when the case is described by `call` alone. */
  file: string | null;
  bytes?: Uint8Array;
  /** The export (or the reader) the case is for, and how to apply it. */
  call: string;
  expect: keyof typeof STATUS | string;
  why: string;
}

const u8 = (...xs: number[]) => new Uint8Array(xs);
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** A raw batch header (§15.3), for cases the generated encoder refuses to write. */
function batch(o: {
  version?: number;
  flags?: number;
  player: number;
  tick: number;
  first: number;
  count: number;
  reserved?: number;
}): Uint8Array {
  const w = new Writer();
  w.u8(o.version ?? 1, 'v');
  w.u8(o.flags ?? 0, 'f');
  w.u16(o.player, 'p');
  w.u32(o.tick, 't');
  w.u32(o.first, 's');
  w.u16(o.count, 'c');
  w.u16(o.reserved ?? 0, 'r');
  return w.finish();
}

const walk = actionBytes({ type: 'start_walking', input_gen: 0, dir: 4 });
const stop = actionBytes({ type: 'stop_walking', input_gen: 0 });

/**
 * Closures for tick 1 against the start save (tick 0; every last_seq and last_system_seq 0), each failing one
 * preflight rule (§15.3): ERR_FRAMING, or ERR_BLOB_MISSING; the tick does not run and nothing changes.
 */
export function closureCases(): NegativeCase[] {
  const ok1 = encodeClosure([{ player: 0, system: false, tick: 1, firstSeq: 1, actions: [walk] }]);
  const cases: [string, Uint8Array, keyof typeof STATUS, string][] = [
    ['truncated-header', ok1.subarray(0, 10), 'err_framing', 'rule 1: 10 bytes, a batch header is 16'],
    [
      'trailing-bytes',
      cat(ok1, u8(0, 0, 0)),
      'err_framing',
      'rule 1: the batches do not consume the closure',
    ],
    [
      'bad-version',
      cat(batch({ version: 2, player: 0, tick: 1, first: 1, count: 1 }), walk),
      'err_framing',
      'rule 2: version is not ACTION_SCHEMA_VERSION',
    ],
    [
      'bad-flags',
      cat(batch({ flags: 2, player: 0, tick: 1, first: 1, count: 1 }), walk),
      'err_framing',
      'rule 2: an undeclared batch flag',
    ],
    [
      'reserved-nonzero',
      cat(batch({ reserved: 1, player: 0, tick: 1, first: 1, count: 1 }), walk),
      'err_framing',
      'rule 2: reserved is not zero',
    ],
    [
      'wrong-tick',
      cat(batch({ player: 0, tick: 2, first: 1, count: 1 }), walk),
      'err_framing',
      'rule 2: the batch is stamped for tick 2',
    ],
    ['empty-batch', batch({ player: 0, tick: 1, first: 1, count: 0 }), 'err_framing', 'rule 2: count 0'],
    [
      'player-32',
      cat(batch({ player: 32, tick: 1, first: 1, count: 1 }), walk),
      'err_framing',
      'rule 2: player 32 without SYSTEM',
    ],
    [
      'system-flag-player-0',
      cat(
        batch({ flags: 1, player: 0, tick: 1, first: 1, count: 1 }),
        actionBytes({ type: 'debug_dump', dump_id: 1 }),
      ),
      'err_framing',
      'rule 2: SYSTEM with a player index',
    ],
    [
      'action-past-batch',
      cat(batch({ player: 0, tick: 1, first: 1, count: 2 }), walk),
      'err_framing',
      'rule 3: the second action header lies outside the closure',
    ],
    [
      'payload-past-end',
      cat(batch({ player: 0, tick: 1, first: 1, count: 1 }), walk.subarray(0, 6)),
      'err_framing',
      'rule 3: the payload runs past the closure',
    ],
    [
      'system-action-in-player-batch',
      cat(batch({ player: 0, tick: 1, first: 1, count: 1 }), actionBytes({ type: 'debug_dump', dump_id: 1 })),
      'err_framing',
      'rule 3: a system type in a player batch',
    ],
    [
      'player-action-in-system-batch',
      cat(batch({ flags: 1, player: 0xffff, tick: 1, first: 1, count: 1 }), walk),
      'err_framing',
      'rule 3: a player type in a system batch',
    ],
    [
      'seq-not-rising',
      cat(batch({ player: 0, tick: 1, first: 0, count: 1 }), walk),
      'err_framing',
      "rule 4 (D21, R27): first_seq 0 is not above player 0's last_seq 0",
    ],
    [
      'seq-repeats-across-batches',
      cat(
        batch({ player: 0, tick: 1, first: 1, count: 2 }),
        walk,
        stop,
        batch({ player: 1, tick: 1, first: 1, count: 1 }),
        walk,
        batch({ player: 0, tick: 1, first: 2, count: 1 }),
        stop,
      ),
      'err_framing',
      'rule 4: player 0 reuses seq 2 in a later batch of the same tick',
    ],
    [
      'system-seq-not-rising',
      cat(
        batch({ flags: 1, player: 0xffff, tick: 1, first: 0, count: 1 }),
        actionBytes({ type: 'debug_dump', dump_id: 1 }),
      ),
      'err_framing',
      'rule 4: a system seq not above last_system_seq',
    ],
    [
      'seq-overflow',
      cat(batch({ player: 0, tick: 1, first: 0xffffffff, count: 2 }), walk, stop),
      'err_framing',
      'rule 4: first_seq + count − 1 passes u32::MAX',
    ],
    [
      'blob-missing',
      encodeClosure([
        {
          player: 0,
          system: false,
          tick: 1,
          firstSeq: 1,
          actions: [
            actionBytes({
              type: 'place_blueprint',
              pos: { x2: 1, y2: 1 },
              dir: 0,
              flip: false,
              mode: 0,
              record: { blob: new Uint8Array(32).fill(7) },
            }),
          ],
        },
      ]),
      'err_blob_missing',
      'rule 5: the action names a blob no sim_blob_put supplied',
    ],
  ];
  // Rule 1's size limit: a closure of CLOSURE_MAX + 4 bytes made of valid-looking batches.
  const big: Uint8Array[] = [];
  const pad = actionBytes({ type: 'console_command', text: 'x'.repeat(1024) });
  let size = 0;
  let first = 1;
  while (size <= 1048576) {
    const b = cat(batch({ player: 0, tick: 1, first, count: 60 }), ...Array.from({ length: 60 }, () => pad));
    big.push(b);
    size += b.length;
    first += 60;
  }
  cases.push([
    'larger-than-closure-max',
    cat(...big),
    'err_framing',
    `rule 1: ${size} bytes, over CLOSURE_MAX (1,048,576)`,
  ]);
  return cases.map(([name, bytes, expect, why]) => ({
    file: `closures/${name}.bin`,
    bytes,
    call: 'sim_tick (tick 1, after loading start.save)',
    expect,
    why,
  }));
}

/** Closure logs (§8.5): the valid variants the golden set must parse and the refusals it must report. */
export function logCases(log: Uint8Array): NegativeCase[] {
  const v = new DataView(log.buffer, log.byteOffset, log.byteLength);
  const set32 = (b: Uint8Array, at: number, x: number) => {
    const c = b.slice();
    new DataView(c.buffer).setUint32(at, x, true);
    return c;
  };
  const recordCount = v.getUint32(88, true);
  const cases: [string, Uint8Array, string, string][] = [
    ['truncated', log.subarray(0, log.length - 1), 'truncated', 'the blob region is one byte short'],
    ['trailing', cat(log, u8(0)), 'trailing', 'a byte after the last region'],
    ['header-only-truncated', log.subarray(0, 100), 'truncated', 'a header cut short'],
    [
      'record-count-too-high',
      set32(log, 88, recordCount + 1),
      'truncated',
      'one more record than the record region holds',
    ],
    ['end-before-start', set32(log, 12, 0), 'range', 'end_tick 0 below records at ticks 1 … 600'],
    [
      'digest-range-outside',
      set32(log, 96, 0),
      'range',
      'the digests would start at tick 0, which is start_tick',
    ],
  ];
  return cases.map(([name, bytes, expect, why]) => ({
    file: `logs/${name}.pwlog`,
    bytes,
    call: 'parseClosureLog (§8.5)',
    expect,
    why,
  }));
}

/** A save container with one section replaced (frames in ascending id). */
function withSection(save: Uint8Array, id: number, data: Uint8Array, version?: number): Uint8Array {
  const { header, frames } = readSaveContainer(save);
  const out: SectionFrame[] = frames.map((f) =>
    f.id === id ? { ...f, data, raw_length: data.length, version: version ?? f.version } : f,
  );
  return writeSaveContainer(header as SaveHeader, out);
}

/** Saves the sim refuses (§8.1, §8.3, §4.4), and the variant it must accept. */
export function saveCases(save: Uint8Array): NegativeCase[] {
  const { frames } = readSaveContainer(save);
  const globals = decodeGlobals((frames.find((f) => f.id === 2) as SectionFrame).data);
  const chunks = decodeChunks((frames.find((f) => f.id === 5) as SectionFrame).data);
  const other = encodeGlobals({ ...globals, worldgen_version: globals.worldgen_version + 1 });
  const otherData = encodeGlobals({
    ...globals,
    worldgen_data_hash: { bytes: new Uint8Array(32).fill(0xaa) },
  });
  // One chunk left only in GENERATED: pristine, so the build would have to regenerate it.
  const pristine = encodeChunks(chunks.slice(1));
  const tableTypo = (frames.find((f) => f.id === 1) as SectionFrame).data.slice();
  // ENTITY_TABLE's directory: `proto` is the first column; its type code (2, u16) becomes 3 (u32).
  tableTypo[8 + 1 + 'proto'.length] = 3;
  const cases: [string, Uint8Array, string, string][] = [
    [
      'truncated',
      save.subarray(0, save.length - 8),
      'refused by the container reader (truncated)',
      'the last section frame is cut short',
    ],
    [
      'trailing',
      cat(save, u8(1, 2, 3)),
      'refused by the container reader (truncated)',
      'bytes after the last frame that are no frame',
    ],
    [
      'other-worldgen-version',
      withSection(withSection(save, 2, other), 5, pristine),
      'err_worldgen',
      'worldgen version 2 with a pristine chunk: the build cannot regenerate it (§4.4, §8.3)',
    ],
    [
      'other-worldgen-data',
      withSection(withSection(save, 2, otherData), 5, pristine),
      'err_worldgen',
      'another worldgen data hash with a pristine chunk',
    ],
    [
      'other-worldgen-version-baked',
      withSection(save, 2, other),
      'ok',
      'model decision: every generated chunk is stored (a baked save, §4.4), so the save loads',
    ],
    [
      'column-type-mismatch',
      withSection(save, 1, tableTypo),
      'err_load_schema',
      "ENTITY_TABLE's proto column stored as u32 (schema_mismatch)",
    ],
    [
      'newer-section-version',
      withSection(save, 2, (frames.find((f) => f.id === 2) as SectionFrame).data, 99),
      'err_load_format',
      'GLOBALS at section version 99: a newer format',
    ],
  ];
  return cases.map(([name, bytes, expect, why]) => ({
    file: `saves/${name}.save`,
    bytes,
    call: 'sim_load (its sections, codec raw)',
    expect,
    why,
  }));
}

/** A malformed input record for every ABI export that reads one (§15.8), and the call-order refusals. */
export function abiCases(protosBin: Uint8Array): NegativeCase[] {
  const le32 = (x: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, x, true);
    return b;
  };
  const nw = NewWorldCodec.encode(NewWorldCodec.defaults());
  const unknownField = (() => {
    // new_world with an extra field id 9: strict ABI records refuse unknown ids (C1b decision 8).
    const body = cat(nw.subarray(4), u8(9, 0), le32(1), u8(0));
    return cat(le32(body.length), body);
  })();
  const view = ViewRequestCodec.encode({
    view_seq: 1,
    surface: 0,
    flags: 0,
    x0: 0,
    y0: 0,
    x1: 10,
    y1: 10,
    zoom: 1,
    hovered_serial: 0,
    audio_half_range: 5,
    chart_x0: 0,
    chart_y0: 0,
    chart_x1: 0,
    chart_y1: 0,
  });
  const badView = view.slice();
  badView[6] = 0x80; // ViewFlags bit 7: undeclared
  const staleProtos = protosBin.slice();
  for (let i = 12; i < 44; i++) staleProtos[i] = (staleProtos[i] as number) ^ 0xff;
  const cases: [string, string, Uint8Array | null, string, string][] = [
    [
      'init-protos-len-past-end',
      'sim_init',
      cat(le32(protosBin.length + 1), protosBin, le32(0), le32(0)),
      'err_input',
      'protos_len one past the bytes',
    ],
    [
      'init-undeclared-flag',
      'sim_init',
      cat(le32(protosBin.length), protosBin, le32(8), le32(0)),
      'err_input',
      'SimFlags bit 3',
    ],
    [
      'init-stale-protos',
      'sim_init',
      cat(le32(staleProtos.length), staleProtos, le32(0), le32(0)),
      'err_protos',
      "prototypes.bin's schema hash is another schema's",
    ],
    [
      'new-world-truncated',
      'sim_new_world',
      nw.subarray(0, nw.length - 1),
      'err_input',
      'the record is one byte short',
    ],
    ['new-world-unknown-field', 'sim_new_world', unknownField, 'err_input', 'field id 9 is not declared'],
    ['new-world-missing-field', 'sim_new_world', cat(le32(0)), 'err_input', 'no fields at all (strict)'],
    [
      'load-section-count',
      'sim_load',
      cat(le32(2), le32(0)),
      'err_input',
      'two sections announced, none present',
    ],
    [
      'load-kind-count',
      'sim_load',
      cat(le32(0), u8(10, 0), new Uint8Array(8)),
      'err_input',
      'kind_count 10 (at most 9 ProtoKinds)',
    ],
    ['blob-put-short', 'sim_blob_put', new Uint8Array(31), 'err_input', 'shorter than its 32-byte hash'],
    [
      'supply-chunk-truncated',
      'sim_supply_chunk',
      u8(8, 0, 0, 0, 1, 0),
      'err_input',
      'a chunk_data record cut short',
    ],
    ['extract-short', 'sim_extract', view.subarray(0, 51), 'err_input', 'a 51-byte view request (52)'],
    ['extract-undeclared-flag', 'sim_extract', badView, 'err_input', 'ViewFlags bit 7'],
    ['subscribe-count', 'sim_subscribe', u8(2, 0), 'err_input', 'two requests announced, none present'],
    [
      'subscribe-bad-kind',
      'sim_subscribe',
      cat(u8(1, 0), le32(1), u8(99, 0, 0, 0), new Uint8Array(20)),
      'err_input',
      'projection kind 99',
    ],
    [
      'subscribe-sub-id-0',
      'sim_subscribe',
      cat(u8(1, 0), le32(0), u8(1, 0, 0, 0), new Uint8Array(20)),
      'err_input',
      'model decision: sub_id 0 is the hover projection',
    ],
    ['unsubscribe-count', 'sim_unsubscribe', u8(3, 0), 'err_input', 'three ids announced, none present'],
    ['query-short', 'sim_query', u8(1, 0, 0, 0, 7), 'err_input', 'a query header cut short'],
    ['query-bad-kind', 'sim_query', cat(le32(1), u8(99, 0, 0, 0)), 'err_input', 'query kind 99'],
    ['save-undeclared-flag', 'sim_save', cat(le32(2)), 'err_input', 'SaveFlags bit 1'],
    [
      'save-wrong-length',
      'sim_save',
      cat(SaveInputCodec.encode({ flags: 0 }), u8(0)),
      'err_input',
      'a 5-byte SaveInput',
    ],
    [
      'set-flags-undeclared',
      'sim_set_flags(8)',
      null,
      'err_input',
      'SimFlags bit 3 (a parameter, not a record)',
    ],
    [
      'tick-before-world',
      'sim_init, then sim_tick of an empty closure',
      null,
      'err_order',
      'no world exists yet',
    ],
    [
      'load-report-without-load',
      'sim_init, sim_new_world, then sim_load_report',
      null,
      'err_order',
      'the last world call was not sim_load',
    ],
    [
      'query-limit',
      'sim_query × 5 (hash), no step in between',
      null,
      'err_limit',
      'at most 4 queries run at once (§15.5)',
    ],
  ];
  return cases.map(([name, call, bytes, expect, why]) =>
    bytes ? { file: `abi/${name}.bin`, bytes, call, expect, why } : { file: null, call, expect, why },
  );
}

// --------------------------------------------------------------------------------------------- the module

/** Signed LEB128 (the WebAssembly encoding of i32.const). */
function sleb(v: number): number[] {
  const out: number[] = [];
  for (;;) {
    const b = v & 0x7f;
    v >>= 7;
    if ((v === 0 && (b & 0x40) === 0) || (v === -1 && (b & 0x40) !== 0)) {
      out.push(b);
      return out;
    }
    out.push(b | 0x80);
  }
}
const uleb = (v: number): number[] => {
  const out: number[] = [];
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    out.push(b);
  } while (v !== 0);
  return out;
};
const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()];
const name = (s: string): number[] => [...uleb(s.length), ...new TextEncoder().encode(s)];
const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];

/**
 * A module whose `sim_schema_hash` is another schema's (§15.1 "runtime handshake"): the shell must refuse to
 * run it, naming both hashes. Hand-assembled (WebAssembly binary format 1): it exports `memory`,
 * `sim_abi_version` (1), `sim_schema_hash` (an envelope at 64: u32 32, then SCHEMA_HASH with every byte
 * inverted), `sim_input`, `sim_last_error` and `sim_memory_epoch`, and nothing else.
 */
export function staleModule(): Uint8Array {
  const hash = Buffer.from(SCHEMA_HASH, 'hex').map((b) => b ^ 0xff);
  const i32 = (v: number) => [0x41, ...sleb(v), 0x0b];
  const body = (expr: number[]) => [...uleb(expr.length + 1), 0x00, ...expr];
  const bytes = [
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    ...section(
      1,
      vec([
        [0x60, 0x00, 0x01, 0x7f],
        [0x60, 0x01, 0x7f, 0x01, 0x7f],
      ]),
    ),
    ...section(3, vec([[0], [0], [1], [0], [0]])),
    ...section(5, vec([[0x00, 0x01]])),
    ...section(
      7,
      vec([
        [...name('memory'), 0x02, 0],
        [...name('sim_abi_version'), 0x00, 0],
        [...name('sim_schema_hash'), 0x00, 1],
        [...name('sim_input'), 0x00, 2],
        [...name('sim_last_error'), 0x00, 3],
        [...name('sim_memory_epoch'), 0x00, 4],
      ]),
    ),
    ...section(10, vec([body(i32(1)), body(i32(64)), body(i32(1024)), body(i32(0)), body(i32(0))])),
    ...section(11, vec([[0x00, ...i32(64), ...uleb(36), 32, 0, 0, 0, ...hash]])),
  ];
  return new Uint8Array(bytes);
}

/** The prototypes.bin header's schema hash, inverted (the reader refuses it: ERR_PROTOS). */
export function staleProtos(protosBin: Uint8Array): Uint8Array {
  const b = protosBin.slice();
  for (let i = 12; i < 44; i++) b[i] = (b[i] as number) ^ 0xff;
  return b;
}

export const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
