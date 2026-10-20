// Decodes every section of a render packet (10 §15.4) into typed records with the generated codecs, and
// writes them back with the generated writers: the golden packets and the fake sim's packets must survive
// the round trip byte for byte. Also the text dump the golden set keeps beside each packet.
import { Dump, Reader, Writer } from '../../src/shared/gen/codec.ts';
import { dumpEvent, readEvent, writeEvent } from '../../src/shared/gen/events.ts';
import {
  AudioWorkingCodec,
  BeltGeomCodec,
  BeltItemsCodec,
  BeltRetireCodec,
  ChartChunkCodec,
  ChartPristineCodec,
  ChunkEntitiesCodec,
  ChunkObjectsCodec,
  ChunkResourcesCodec,
  ChunkTilesCodec,
  DynCodec,
  decodePacket,
  InserterHandCodec,
  MoverCodec,
  OverlayChunkCodec,
  OverlayStaffingCodec,
  type PacketHeader,
  PacketWriter,
} from '../../src/shared/gen/packet.ts';
import {
  CharacterCodec,
  DebugCodec,
  EntityPanelCodec,
  HoverCodec,
  HudCodec,
  InventoryCodec,
  StatsCodec,
  type UiRecord,
  UiRecordCodec,
} from '../../src/shared/gen/projections.ts';

/** A table of heterogeneous generated codecs: their record types are erased here, and checked by the round trip. */
type AnyCodec = {
  read(r: Reader, f?: string): unknown;
  write(w: Writer, v: never, f?: string): void;
  dump(d: Dump, v: never, p?: string): void;
};

/** The record codec of each fixed or message section (EVENTS and UI have their own framing). */
export const SECTION_CODECS: ReadonlyMap<number, AnyCodec> = new Map<number, AnyCodec>([
  [1, ChunkTilesCodec],
  [2, ChunkEntitiesCodec],
  [3, DynCodec],
  [4, InserterHandCodec],
  [5, BeltGeomCodec],
  [6, BeltItemsCodec],
  [7, MoverCodec],
  [8, OverlayChunkCodec],
  [9, OverlayStaffingCodec],
  [10, ChartChunkCodec],
  [13, AudioWorkingCodec],
  [14, ChunkObjectsCodec],
  [15, ChunkResourcesCodec],
  [16, BeltRetireCodec],
  [17, ChartPristineCodec],
]);

/** The record codec of each projection kind with a record (projections.yaml `kinds`). */
export const UI_CODECS: ReadonlyMap<
  number,
  AnyCodec & { decode(b: Uint8Array): unknown; encode(v: unknown): Uint8Array }
> =
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous generated codecs
  new Map<number, any>([
    [1, HudCodec],
    [2, CharacterCodec],
    [3, InventoryCodec],
    [4, EntityPanelCodec],
    [5, HoverCodec],
    [7, StatsCodec],
    [10, DebugCodec],
  ]);

export interface DecodedSection {
  type: number;
  name: string;
  records: unknown[];
}

export interface DecodedPacket {
  header: PacketHeader;
  sections: DecodedSection[];
}

/** Every section's records, decoded and checked by the generated readers (each must fill its section). */
export function decodeAll(bytes: Uint8Array): DecodedPacket {
  const p = decodePacket(bytes);
  const sections = p.sections.map((s) => {
    const r = new Reader(s.bytes);
    const records: unknown[] = [];
    for (let i = 0; i < s.count; i++) {
      if (s.type === 11) records.push(readEvent(r));
      else if (s.type === 12) {
        const rec = UiRecordCodec.read(r);
        if (rec.status === 0) {
          const c = UI_CODECS.get(rec.kind);
          if (!c) throw new Error(`a UI record of kind ${rec.kind}, which has no record`);
          c.decode(rec.body); // the body must decode exactly
        }
        records.push(rec);
      } else {
        const c = SECTION_CODECS.get(s.type);
        if (!c) throw new Error(`no codec for section ${s.type}`);
        records.push(c.read(r));
      }
    }
    r.finish(s.name);
    return { type: s.type, name: s.name, records };
  });
  return { header: p.header, sections };
}

/** Writes a decoded packet back with the generated writers (state_gen and view_seq as decoded). */
export function encodeAll(p: DecodedPacket): Uint8Array {
  const w = new Writer();
  const pw = new PacketWriter(w, p.sections.length, p.header.tick, p.header.flags, p.header.daylight);
  for (const s of p.sections) {
    pw.section(s.type);
    for (const rec of s.records) {
      if (s.type === 11) {
        const e = rec as ReturnType<typeof readEvent>;
        const { type: _t, len: _l, ...meta } = e.header;
        writeEvent(w, meta, e.payload);
      } else if (s.type === 12) UiRecordCodec.write(w, rec as UiRecord);
      else (SECTION_CODECS.get(s.type) as AnyCodec).write(w, rec as never);
    }
    pw.end(s.records.length);
  }
  pw.finish();
  const out = w.finish();
  new DataView(out.buffer).setUint32(8, p.header.state_gen, true);
  new DataView(out.buffer).setUint32(16, p.header.view_seq, true);
  return out;
}

/** The text dump of a packet: its header, then each record of each section (README "Dumps"). */
export function dumpPacket(bytes: Uint8Array): string {
  const p = decodeAll(bytes);
  const d = new Dump();
  const h = p.header;
  for (const [k, v] of Object.entries(h)) d.int(`header.${k}`, v as number);
  for (const s of p.sections) {
    d.line('section', `${s.name} ${s.records.length}`);
    s.records.forEach((rec, i) => {
      const at = `${s.name}[${i}]`;
      if (s.type === 11) {
        const e = rec as ReturnType<typeof readEvent>;
        for (const [k, v] of Object.entries(e.header)) d.int(`${at}.header.${k}`, v as number);
        const sub = new Dump();
        dumpEvent(sub, e.payload);
        for (const line of sub.out.trimEnd().split('\n')) d.out += `${at}.${line}\n`;
      } else if (s.type === 12) {
        const u = rec as UiRecord;
        d.int(`${at}.sub_id`, u.sub_id);
        d.int(`${at}.kind`, u.kind);
        d.int(`${at}.status`, u.status);
        d.int(`${at}.version`, u.version);
        if (u.status === 0)
          (UI_CODECS.get(u.kind) as AnyCodec).dump(
            d,
            UI_CODECS.get(u.kind)?.decode(u.body) as never,
            `${at}.body.`,
          );
        else d.bytes(`${at}.body`, u.body);
      } else (SECTION_CODECS.get(s.type) as AnyCodec).dump(d, rec as never, `${at}.`);
    });
  }
  return d.out;
}
