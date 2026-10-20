// The save sections (10 §8.1, §4.8), Rust side (crates/sim/src/gen/sections.rs): the section table, the
// digest shard map, and the codecs of the record sections (the tables' column codecs are in pools.rs).
import { type Decl, type Field, pascal, type RecordDecl, type Schema, typeName } from './model.ts';
import { enumVariant, type RsOut, rsIdent, rsStr } from './rust.ts';

export function rustSections(s: Schema, o: RsOut, _pools: RsOut): void {
  o.rt('Reader', 'Writer', 'DResult', 'EResult', 'ErrorKind', 'enc_err');
  const ss = o.t(s.decls.get('SaveSection') as Decl);
  const serial = o.t(s.decls.get('Serial') as Decl);
  const ck = o.t(s.decls.get('ChunkKey') as Decl);
  const pi = o.t(s.decls.get('PlayerIndex') as Decl);
  const sv = s.save;
  const rule = (x: (typeof sv.sections)[number]) => {
    const r = x.shard;
    if (!r) return 'None';
    if (r.k === 'pieces') return `Some(ShardRule::Pieces { base: ${r.base}, step: ${r.step} })`;
    return `Some(ShardRule::${pascal(r.k)})`;
  };
  const parts: string[] = [];
  parts.push(`/// Digest shards (§4.8): every saved byte belongs to exactly one of SHARDS.
pub const SHARDS: u32 = ${sv.shards};
/// The size of a piece of a \`Pieces\` section (§4.8).
pub const SHARD_PIECE_BYTES: usize = 4096;

/// A save section's digest shard rule (§4.8, sections.yaml).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShardRule {
    /// A table row by its entity's serial; a pool row by its \`entity\`'s serial.
    Serial,
    /// A record by its chunk key.
    Chunk,
    /// (1,800 + 97 × index) mod SHARDS.
    Player,
    /// A record by its leading key field.
    Key,
    /// By \`serial\`, or by \`owner\` when serial is 0.
    Timer,
    /// A slot-heap block by the entity or player that owns it.
    Owner,
    /// The section's bytes in SHARD_PIECE_BYTES pieces, piece i at (base + i × step) mod SHARDS.
    Pieces { base: u32, step: u32 },
}

/// One save section this build writes (§8.1).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SectionInfo {
    pub section: ${ss},
    pub name: &'static str,
    /// The schema version at which its layout last changed.
    pub version: u16,
    pub hashed: bool,
    pub shard: Option<ShardRule>,
    /// A table's header (its row count) is one more piece, at this shard.
    pub header_shard: Option<u32>,
}

/// Every section this build writes, in ascending id (the order of saves and of the state hash, §4.8).
pub const SECTIONS: [SectionInfo; ${sv.sections.length}] = [
${sv.sections
  .map(
    (x) =>
      `    SectionInfo { section: ${ss}::${enumVariant(x.name.toLowerCase())}, name: ${rsStr(x.name)}, version: ${x.version}, hashed: ${x.hashed}, shard: ${rule(x)}, header_shard: ${x.headerShard === undefined ? 'None' : `Some(${x.headerShard})`} },`,
  )
  .join('\n')}
];

pub const fn shard_of_serial(s: ${serial}) -> u32 {
    s.0 % SHARDS
}

pub const fn shard_of_chunk(k: ${ck}) -> u32 {
    k.0 % SHARDS
}

pub const fn shard_of_player(p: ${pi}) -> u32 {
    (1800 + 97 * p.0 as u32) % SHARDS
}

pub const fn shard_of_key(k: u32) -> u32 {
    k % SHARDS
}

pub const fn shard_of_timer(serial: ${serial}, owner: u32) -> u32 {
    if serial.0 != 0 { serial.0 % SHARDS } else { owner % SHARDS }
}

/// The shard of piece \`i\` of a \`Pieces\` section.
pub const fn shard_of_piece(base: u32, step: u32, i: u32) -> u32 {
    base.wrapping_add(i.wrapping_mul(step)) % SHARDS
}
`);
  for (const x of sv.sections) {
    if (x.encoding !== 'records' && x.encoding !== 'record') continue;
    const rec = x.record as RecordDecl;
    const rt = o.t(rec);
    const fn = x.name.toLowerCase();
    if (x.encoding === 'record') {
      parts.push(`/// Writes ${x.name} (§8.1): \`u32 count\` = 1, then the record.
pub fn encode_${fn}(w: &mut Writer<'_>, v: &${rt}) -> EResult {
    w.u32(1);
    v.encode(w)
}

/// Reads ${x.name}: exactly one record (leniently: unknown field ids skipped, missing fields at defaults, §8.3).
pub fn decode_${fn}(data: &[u8]) -> DResult<${rt}> {
    let mut r = Reader::new(data);
    if r.u32(${rsStr(x.name)})? != 1 {
        return Err(r.err_at(0, ErrorKind::BadCount, ${rsStr(x.name)}));
    }
    let v = ${rt}::decode(&mut r, false)?;
    r.finish(${rsStr(x.name)})?;
    Ok(v)
}
`);
      continue;
    }
    const keys = (x.key ?? []).map((k) => rec.fields.find((f) => f.name === k) as Field);
    const keyTy = keys
      .map((k) => (k.ty.k === 'scalar' ? k.ty.s : typeName((k.ty as { d: Decl }).d)))
      .join(', ');
    keys.forEach((k) => {
      if (k.ty.k !== 'scalar') o.t((k.ty as { d: Decl }).d);
    });
    const keyExpr = `(${keys.map((k) => `x.${rsIdent(k.name)}`).join(', ')},)`;
    let shard = '';
    const r = x.shard;
    if (r?.k === 'chunk') {
      const keyField = rec.fields.find((f) => f.name === 'key');
      shard = keyField
        ? `shard_of_chunk(x.key)`
        : `shard_of_chunk(${o.t(s.decls.get('ChunkKey') as Decl) && 'schema::chunk_key'}(x.cx, x.cy))`;
    } else if (r?.k === 'player') shard = 'shard_of_player(x.index)';
    else if (r?.k === 'key')
      shard = `shard_of_key(${keys[0]?.ty.k === 'id' ? `x.${rsIdent(keys[0].name)}.0` : `x.${rsIdent(keys[0]?.name ?? '')}`})`;
    else if (r?.k === 'timer') shard = 'shard_of_timer(x.serial, x.owner)';
    parts.push(`/// ${x.name}'s canonical order (§8.1): records strictly ascending by (${(x.key ?? []).join(', ')}).
pub fn key_${fn}(x: &${rt}) -> (${keyTy},) {
    ${keyExpr}
}

${shard ? `/// The digest shard of a ${x.name} record (§4.8).\npub fn shard_${fn}(x: &${rt}) -> u32 {\n    ${shard}\n}\n` : ''}
/// Writes ${x.name} (§8.1): \`u32 count\`, then the records, which must be strictly ascending by key.
pub fn encode_${fn}(w: &mut Writer<'_>, records: &[${rt}]) -> EResult {
    if !records.windows(2).all(|p| key_${fn}(&p[0]) < key_${fn}(&p[1])) {
        return Err(enc_err(ErrorKind::Unsorted, ${rsStr(x.name)}));
    }
    w.u32(records.len() as u32);
    for x in records {
        x.encode(w)?;
    }
    Ok(())
}

/// Reads ${x.name}: refuses records out of order or twice (§8.1); fields leniently (§8.3).
pub fn decode_${fn}(data: &[u8]) -> DResult<Vec<${rt}>> {
    let mut r = Reader::new(data);
    let n = r.u32(${rsStr(x.name)})? as usize;
    let mut out: Vec<${rt}> = Vec::with_capacity(n.min(1 << 16));
    for _ in 0..n {
        let at = r.pos();
        let x = ${rt}::decode(&mut r, false)?;
        if out.last().is_some_and(|p| key_${fn}(p) >= key_${fn}(&x)) {
            return Err(r.err_at(at, ErrorKind::Unsorted, ${rsStr(x.name)}));
        }
        out.push(x);
    }
    r.finish(${rsStr(x.name)})?;
    Ok(out)
}
`);
  }
  o.push(parts.join('\n'));
  void ck;
}
