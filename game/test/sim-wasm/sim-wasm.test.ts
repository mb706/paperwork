// The simulation in WebAssembly (10 §4.1: native code and every engine compute the same bits). Runs sim.wasm
// (built by cargo with the full ABI) against the golden set's no-system parts and the regression cases of
// codex's review C2a-r1 (test/sim-wasm/cases/, written by the native test `review_c2a`), so the native and the
// wasm32 answers are compared on the same inputs.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { GAME } from '../helpers/paths.ts';
import { buildModule, initInput, stateInput, WasmSim } from './module.ts';

const GOLDEN = join(GAME, 'test', 'golden', 'm0');
const CASES = join(GAME, 'test', 'sim-wasm', 'cases');
const golden = (rel: string): Uint8Array => new Uint8Array(readFileSync(join(GOLDEN, rel)));
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

let module: WebAssembly.Module;
let protos: Uint8Array;

beforeAll(() => {
  module = buildModule();
  protos = golden('protos/prototypes.bin');
}, 600_000);

/** A fresh instance with the golden prototypes. */
function fresh(): WasmSim {
  const s = new WasmSim(module);
  expect(s.status('sim_init', initInput(protos))).toBe('ok');
  return s;
}

/** `sim_load`'s input for a save container (§8.1): its frames and the header's lineage. */
function containerInput(save: Uint8Array): Uint8Array {
  const v = new DataView(save.buffer, save.byteOffset, save.byteLength);
  const headerLength = v.getUint32(12, true);
  const header = new TextDecoder().decode(save.subarray(16, 16 + headerLength));
  const lineage = BigInt(`0x${(/"lineage":"([0-9a-f]{16})"/.exec(header) as RegExpExecArray)[1]}`);
  const frames: Uint8Array[] = [];
  let at = 16 + headerLength;
  while (at < save.length) {
    const stored = v.getUint32(at + 12, true);
    const next = at + 16 + stored + ((8 - (stored % 8)) % 8);
    frames.push(save.subarray(at, next));
    at = next;
  }
  const size = 4 + frames.reduce((n, f) => n + f.length, 0) + 2 + 8;
  const out = new Uint8Array(size);
  const o = new DataView(out.buffer);
  o.setUint32(0, frames.length, true);
  let p = 4;
  for (const f of frames) {
    out.set(f, p);
    p += f.length;
  }
  o.setUint16(p, 0, true);
  o.setBigUint64(p + 2, lineage, true);
  return out;
}

describe('sim.wasm: the golden set without systems', () => {
  it('loads start.save and saves it to states/tick-0000.sections with its hashes', () => {
    const s = fresh();
    expect(s.status('sim_load', containerInput(golden('start.save')))).toBe('ok');
    const saved = s.envelope('sim_save', new Uint8Array(4));
    expect(saved.status).toBe('ok');
    expect(hex(saved.out as Uint8Array)).toBe(hex(golden('states/tick-0000.sections')));
    expect(s.stateHash()?.toString(16).padStart(16, '0')).toBe('49a36d5a1c7b89c3');
    expect(s.panics).toEqual([]);
  });

  it('round-trips every frozen state with the hashes of states/hashes.txt', () => {
    const lines = readFileSync(join(GOLDEN, 'states', 'hashes.txt'), 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('tick '));
    expect(lines.length).toBe(6);
    for (const line of lines) {
      const f = line.split(' ');
      const tick = Number(f[1]);
      const state = golden(`states/tick-${String(tick).padStart(4, '0')}.sections`);
      const s = fresh();
      expect(s.status('sim_load', stateInput(state)), `tick ${tick}`).toBe('ok');
      expect(hex(s.envelope('sim_save', new Uint8Array(4)).out as Uint8Array), `tick ${tick}`).toBe(
        hex(state),
      );
      expect(s.stateHash()?.toString(16).padStart(16, '0'), `tick ${tick}`).toBe(f[2]);
    }
  });

  it('replays the boot-and-order and remap-load traces, and watermarks up to the join', () => {
    const traces = JSON.parse(readFileSync(join(GOLDEN, 'abi', 'traces.json'), 'utf8')) as {
      traces: {
        name: string;
        calls: {
          call: string;
          in: string | null;
          params?: number[];
          status: string;
          out: string | null;
          state?: string;
        }[];
      }[];
    };
    for (const [name, upTo] of [
      ['boot-and-order', Number.POSITIVE_INFINITY],
      ['remap-load', Number.POSITIVE_INFINITY],
      ['watermarks', 9],
    ] as const) {
      const t = traces.traces.find((x) => x.name === name);
      if (!t) throw new Error(`no trace ${name}`);
      const s = new WasmSim(module);
      t.calls.slice(0, upTo).forEach((c, i) => {
        const input = c.in ? golden(c.in) : new Uint8Array();
        const before = s.stateHash();
        let status: string;
        let out: Uint8Array | null = null;
        if (['sim_set_flags'].includes(c.call)) status = s.statusArgs(c.call, ...(c.params ?? []));
        else if (
          [
            'sim_meta',
            'sim_load_report',
            'sim_digest',
            'sim_state_hash',
            'sim_pending_chunks',
            'sim_save',
          ].includes(c.call)
        ) {
          const r = c.call === 'sim_save' ? s.envelope(c.call, input) : s.envelope(c.call);
          status = r.status;
          out = r.out;
        } else status = s.status(c.call, input);
        expect(status, `${name} call ${i} (${c.call})`).toBe(c.status);
        if (c.out) expect(hex(out as Uint8Array), `${name} call ${i} (${c.call})`).toBe(hex(golden(c.out)));
        const after = s.stateHash();
        if (c.state === 'unchanged') expect(after, `${name} call ${i}`).toBe(before);
        if (c.state === 'changed') expect(after, `${name} call ${i}`).not.toBe(before);
      });
      expect(s.panics).toEqual([]);
    }
  });

  it('refuses every negative closure and save as natively', () => {
    const index = JSON.parse(readFileSync(join(GOLDEN, 'negative', 'index.json'), 'utf8')) as {
      file: string;
      expect: string;
    }[];
    let n = 0;
    for (const c of index) {
      if (!c.file.startsWith('closures/')) continue;
      const s = fresh();
      expect(s.status('sim_load', containerInput(golden('start.save')))).toBe('ok');
      const before = hex(s.envelope('sim_save', new Uint8Array(4)).out as Uint8Array);
      expect(s.status('sim_tick', golden(`negative/${c.file}`)), c.file).toBe(c.expect);
      expect(hex(s.envelope('sim_save', new Uint8Array(4)).out as Uint8Array), c.file).toBe(before);
      n++;
    }
    expect(n).toBe(19);
  });
});

describe('sim.wasm: codex C2a-r1 regressions', () => {
  it('answers every malformed load as the native code does (findings 1, 2, 4)', () => {
    const index = JSON.parse(readFileSync(join(CASES, 'index.json'), 'utf8')) as {
      name: string;
      input: string;
      expect: string;
    }[];
    expect(index.length).toBeGreaterThanOrEqual(12);
    for (const c of index) {
      const s = fresh();
      const status = s.status('sim_load', new Uint8Array(readFileSync(join(CASES, c.input))));
      expect(status, `${c.name}: ${s.lastError().message}`).toBe(c.expect);
      expect(s.panics, c.name).toEqual([]);
    }
  });

  it('bounds the blobs held for a tick (finding 5)', () => {
    const s = fresh();
    expect(s.status('sim_load', containerInput(golden('start.save')))).toBe('ok');
    const put = (bytes: Uint8Array): string => {
      const input = new Uint8Array(32 + bytes.length);
      input.set(createHash('sha256').update(bytes).digest(), 0);
      input.set(bytes, 32);
      return s.status('sim_blob_put', input);
    };
    const word = (i: number) => new Uint8Array(new Uint32Array([i]).buffer);
    for (let i = 0; i < 64; i++) expect(put(word(i))).toBe('ok');
    expect(put(word(0))).toBe('ok');
    expect(put(word(9999))).toBe('err_limit');
    expect(s.status('sim_tick', new Uint8Array())).toBe('ok');
    expect(put(new Uint8Array(8 * 1024 * 1024 + 1))).toBe('err_input');
    for (let i = 0; i < 4; i++) {
      const b = new Uint8Array(8 * 1024 * 1024);
      b[0] = i;
      expect(put(b)).toBe('ok');
    }
    expect(put(new Uint8Array([1]))).toBe('err_limit');
  });
});
