// The Rust side of the codec fixtures (crates/sim/tests/codec_fixtures/generated.rs, a module of the sim
// crate's integration test codec_fixtures, so nothing of it is in the libraries): decoding, re-encoding and
// dumping every struct, message and record by its schema name, for the round trips of
// test/fixtures/codec/{actions,records}.bin, the limit probes of probes.txt and the hand-written spec/*.hex
// fixtures, and the parsers of those files. crates/sim/tests/codec_fixtures/main.rs runs them. The checks are data-driven: the fixtures carry the reference codec's bytes and the hash of its
// dump, so no sample value is spelled out in Rust.
import type { Decl, Schema } from './model.ts';
import { type RsOut, rsStr } from './rust.ts';

export function rustFixtures(s: Schema, o: RsOut): void {
  o.rt('Reader', 'Writer', 'DecodeError', 'DResult', 'EResult', 'Dump', 'Fixed', 'Packed', 'ErrorKind');
  const names: string[] = [];
  const trips: string[] = [];
  const decodes: string[] = [];
  for (const name of s.names) {
    const d = s.decls.get(name) as Decl;
    if (d.kind !== 'struct' && d.kind !== 'message' && d.kind !== 'record') continue;
    const t = o.t(d);
    const n = rsStr(d.name);
    names.push(`    ${n},`);
    if (d.kind === 'struct') {
      trips.push(`        ${n} => fixed::<${t}>(bytes, ${n}, ${t}::dump),`);
      decodes.push(`        ${n} => fixed_exact::<${t}>(bytes, ${n}),`);
    } else if (d.kind === 'message') {
      trips.push(`        ${n} => message(bytes, ${t}::decode_exact, ${t}::encode, ${t}::dump),`);
      decodes.push(`        ${n} => ${t}::decode_exact(bytes).map(|_| ()),`);
    } else {
      trips.push(`        ${n} => record(bytes, ${t}::decode_exact, ${t}::encode, ${t}::dump),`);
      decodes.push(`        ${n} => ${t}::decode_exact(bytes, true).map(|_| ()),`);
    }
  }
  o.push(`/// Every struct, message and record of the schema, by name: the types the fixtures and probes name.
pub const NAMES: [&str; ${names.length}] = [
${names.join('\n')}
];

/// One entry of actions.bin or records.bin.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FixtureEntry {
    /// The type's schema name (an action's payload message for actions.bin).
    pub name: String,
    pub variant: &'static str,
    /// FNV-1a of the reference codec's dump of the value.
    pub dump_hash: u32,
    pub bytes: Vec<u8>,
}

/// Parses actions.bin or records.bin: entries of u16 name length, name, u8 variant, u32 dump hash, u32
/// length, bytes (scripts/schema-gen/fixtures.ts).
pub fn parse_fixture_entries(b: &[u8]) -> Result<Vec<FixtureEntry>, DecodeError> {
    let mut r = Reader::new(b);
    let mut out = Vec::new();
    while !r.is_empty() {
        let n = usize::from(r.u16("entry")?);
        let name = String::from_utf8_lossy(r.take(n, "entry")?).into_owned();
        let variant = match r.u8("entry")? {
            0 => "zero",
            1 => "mixed",
            _ => "max",
        };
        let dump_hash = r.u32("entry")?;
        let len = r.u32("entry")? as usize;
        out.push(FixtureEntry { name, variant, dump_hash, bytes: r.take(len, "entry")?.to_vec() });
    }
    Ok(out)
}

/// One limit probe of probes.txt.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Probe {
    /// \`struct\`, \`message\`, \`record\` or \`action\`.
    pub kind: String,
    /// The type's schema name (the action's name for an action probe).
    pub target: String,
    pub name: String,
    /// "ok", or "<error kind> <field> @<byte offset>".
    pub verdict: String,
    pub bytes: Vec<u8>,
}

/// Parses probes.txt: \`<kind>:<target> <name> <verdict…> <hex>\` lines; \`#\` starts a comment line.
pub fn parse_probes(text: &str) -> Vec<Probe> {
    text.lines()
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(|l| {
            let t: Vec<&str> = l.split(' ').collect();
            let (kind, target) = t[0].split_once(':').unwrap_or(("", t[0]));
            Probe {
                kind: kind.to_owned(),
                target: target.to_owned(),
                name: t[1].to_owned(),
                verdict: t[2..t.len() - 1].join(" "),
                bytes: from_hex(t[t.len() - 1]),
            }
        })
        .collect()
}

/// Bytes from hexadecimal digits (whitespace ignored); a stray digit reads as 0.
pub fn from_hex(hex: &str) -> Vec<u8> {
    let digits: Vec<u8> = hex.bytes().filter(|c| !c.is_ascii_whitespace()).collect();
    digits
        .chunks(2)
        .map(|p| u8::from_str_radix(core::str::from_utf8(p).unwrap_or("00"), 16).unwrap_or(0))
        .collect()
}

/// A decode result as probes.txt spells it.
pub fn verdict<T>(r: &Result<T, DecodeError>) -> String {
    match r {
        Ok(_) => "ok".to_owned(),
        Err(e) => format!("{} {} @{}", e.kind.name(), e.field, e.at),
    }
}

/// FNV-1a (32-bit), the hash the fixtures carry of each reference dump.
pub fn fnv1a32(bytes: &[u8]) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for &b in bytes {
        h = (h ^ u32::from(b)).wrapping_mul(0x0100_0193);
    }
    h
}

fn fail(e: impl core::fmt::Display) -> String {
    e.to_string()
}

fn same(out: &[u8], bytes: &[u8]) -> Result<(), String> {
    if out == bytes {
        return Ok(());
    }
    let at = out.iter().zip(bytes).position(|(a, b)| a != b).unwrap_or(out.len().min(bytes.len()));
    Err(format!("re-encoding differs at byte {at}: {} bytes against the fixture's {}", out.len(), bytes.len()))
}

fn dumped<T>(v: &T, dump: fn(&T, &mut Dump, &str)) -> String {
    let mut d = Dump::default();
    dump(v, &mut d, "");
    d.out
}

fn fixed<T: Fixed>(bytes: &[u8], name: &'static str, dump: fn(&T, &mut Dump, &str)) -> Result<String, String> {
    let mut r = Reader::new(bytes);
    let v = T::read(&mut r, name).map_err(fail)?;
    r.finish(name).map_err(fail)?;
    let mut out = Vec::new();
    v.write(&mut Writer::new(&mut out), name).map_err(fail)?;
    same(&out, bytes)?;
    Ok(dumped(&v, dump))
}

fn message<'a, T>(
    bytes: &'a [u8],
    decode: fn(&'a [u8]) -> DResult<T>,
    encode: fn(&T, &mut Writer<'_>) -> EResult,
    dump: fn(&T, &mut Dump, &str),
) -> Result<String, String> {
    let v = decode(bytes).map_err(fail)?;
    let mut out = Vec::new();
    encode(&v, &mut Writer::new(&mut out)).map_err(fail)?;
    same(&out, bytes)?;
    Ok(dumped(&v, dump))
}

fn record<T>(
    bytes: &[u8],
    decode: fn(&[u8], bool) -> DResult<T>,
    encode: fn(&T, &mut Writer<'_>) -> EResult,
    dump: fn(&T, &mut Dump, &str),
) -> Result<String, String> {
    let v = decode(bytes, true).map_err(fail)?;
    let mut out = Vec::new();
    encode(&v, &mut Writer::new(&mut out)).map_err(fail)?;
    same(&out, bytes)?;
    Ok(dumped(&v, dump))
}

/// Decodes \`bytes\` as one whole value of the named type (records strictly), re-encodes it (which must give
/// the same bytes) and returns its dump. None for a name that is not a struct, message or record.
pub fn round_trip(name: &str, bytes: &[u8]) -> Option<Result<String, String>> {
    Some(match name {
${trips.join('\n')}
        _ => return None,
    })
}

/// Reads one fixed-size value that fills \`bytes\` exactly.
fn fixed_exact<T: Fixed>(bytes: &[u8], name: &'static str) -> Result<(), DecodeError> {
    let mut r = Reader::new(bytes);
    T::read(&mut r, name)?;
    r.finish(name)
}

/// Decodes \`bytes\` as one whole value of the named type (records strictly), for the limit probes.
pub fn decode_by_name(name: &str, bytes: &[u8]) -> Option<Result<(), DecodeError>> {
    Some(match name {
${decodes.join('\n')}
        _ => return None,
    })
}

/// Decodes a framed action (\`u16 type, u16 len, payload\`) with Action::decode, as the probes expect.
pub fn decode_action_framed(bytes: &[u8]) -> Result<schema::Action<'_>, DecodeError> {
    if bytes.len() < 4 {
        return Err(DecodeError { kind: ErrorKind::Truncated, field: "Action", at: 0 });
    }
    let ty = u16::from_le_bytes([bytes[0], bytes[1]]);
    schema::Action::decode(ty, &bytes[4..])
}

/// Round-trips a framed action: decode, re-encode framed (which must give the same bytes), dump.
pub fn round_trip_action(bytes: &[u8]) -> Result<String, String> {
    let a = decode_action_framed(bytes).map_err(fail)?;
    let mut out = Vec::new();
    a.encode_framed(&mut Writer::new(&mut out)).map_err(fail)?;
    same(&out, bytes)?;
    let mut d = Dump::default();
    a.dump(&mut d);
    Ok(d.out)
}
`);
}
