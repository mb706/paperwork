//! Shared helpers of the sim's integration tests: the golden set's files (test/golden/m0/), a small JSON
//! reader for its indexes, and hex.

use sim::SimContext;
use std::path::{Path, PathBuf};

pub fn golden_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test/golden/m0")
}

/// A golden file's bytes.
pub fn golden(rel: &str) -> Vec<u8> {
    let p = golden_dir().join(rel);
    std::fs::read(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

pub fn golden_text(rel: &str) -> String {
    String::from_utf8(golden(rel)).expect("UTF-8")
}

pub fn golden_exists(rel: &str) -> bool {
    golden_dir().join(rel).exists()
}

/// The golden prototypes.bin.
pub fn protos() -> Vec<u8> {
    golden("protos/prototypes.bin")
}

/// A module with the golden prototypes.
pub fn ctx() -> SimContext {
    let mut c = SimContext::new();
    c.init_protos(&protos(), schema::SimFlags::EMPTY).expect("the golden prototypes load");
    c
}

/// `sim_load`'s input for a save container (§8.1): its sections and the header's lineage.
pub fn container_input(bytes: &[u8]) -> Vec<u8> {
    let (header, frames) = sim::save::read_container(bytes).expect("a container");
    let r = u64::from_str_radix(json_str_field(header, "lineage").expect("a lineage"), 16).expect("hex");
    sim::save::load_input(&frames, r)
}

/// `sim_load`'s input for `SaveOutput` bytes (a golden state file).
pub fn state_input(bytes: &[u8]) -> Vec<u8> {
    let (frames, r) = sim::save::parse_save_output(bytes).expect("SaveOutput");
    sim::save::load_input(&frames, r)
}

/// The value of a top-level string field of a JSON object (the save header's keys are unique).
pub fn json_str_field<'a>(json: &'a str, key: &str) -> Option<&'a str> {
    let pat = format!("\"{key}\":\"");
    let at = json.find(&pat)? + pat.len();
    let end = json[at..].find('"')?;
    Some(&json[at..at + end])
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub fn unhex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex")).collect()
}

pub fn u64_hex(s: &str) -> u64 {
    u64::from_str_radix(s, 16).expect("hex u64")
}

/// A JSON value (enough for the golden indexes).
#[derive(Clone, Debug, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Json>),
    Obj(Vec<(String, Json)>),
}

impl Json {
    pub fn get(&self, k: &str) -> Option<&Json> {
        match self {
            Json::Obj(v) => v.iter().find(|x| x.0 == k).map(|x| &x.1),
            _ => None,
        }
    }

    pub fn str(&self) -> Option<&str> {
        match self {
            Json::Str(s) => Some(s),
            _ => None,
        }
    }

    pub fn arr(&self) -> &[Json] {
        match self {
            Json::Arr(v) => v,
            _ => &[],
        }
    }

    pub fn num(&self) -> Option<f64> {
        match self {
            Json::Num(n) => Some(*n),
            _ => None,
        }
    }
}

pub fn parse_json(s: &str) -> Json {
    let b = s.as_bytes();
    let mut i = 0;
    let v = value(b, &mut i);
    ws(b, &mut i);
    assert_eq!(i, b.len(), "trailing JSON");
    v
}

fn ws(b: &[u8], i: &mut usize) {
    while *i < b.len() && b[*i].is_ascii_whitespace() {
        *i += 1;
    }
}

fn value(b: &[u8], i: &mut usize) -> Json {
    ws(b, i);
    match b[*i] {
        b'{' => {
            *i += 1;
            let mut out = Vec::new();
            loop {
                ws(b, i);
                if b[*i] == b'}' {
                    *i += 1;
                    return Json::Obj(out);
                }
                let Json::Str(k) = value(b, i) else { panic!("a key") };
                ws(b, i);
                assert_eq!(b[*i], b':');
                *i += 1;
                let v = value(b, i);
                out.push((k, v));
                ws(b, i);
                if b[*i] == b',' {
                    *i += 1;
                }
            }
        }
        b'[' => {
            *i += 1;
            let mut out = Vec::new();
            loop {
                ws(b, i);
                if b[*i] == b']' {
                    *i += 1;
                    return Json::Arr(out);
                }
                out.push(value(b, i));
                ws(b, i);
                if b[*i] == b',' {
                    *i += 1;
                }
            }
        }
        b'"' => {
            *i += 1;
            let mut s = String::new();
            loop {
                let c = b[*i];
                *i += 1;
                match c {
                    b'"' => return Json::Str(s),
                    b'\\' => {
                        let e = b[*i];
                        *i += 1;
                        match e {
                            b'n' => s.push('\n'),
                            b't' => s.push('\t'),
                            b'r' => s.push('\r'),
                            b'b' => s.push('\u{8}'),
                            b'f' => s.push('\u{c}'),
                            b'u' => {
                                let h = std::str::from_utf8(&b[*i..*i + 4]).expect("hex");
                                let cp = u32::from_str_radix(h, 16).expect("hex");
                                *i += 4;
                                s.push(char::from_u32(cp).unwrap_or('\u{fffd}'));
                            }
                            other => s.push(other as char),
                        }
                    }
                    _ => {
                        // Multi-byte UTF-8: copy the whole sequence.
                        let start = *i - 1;
                        let len = if c < 0x80 {
                            1
                        } else if c >= 0xF0 {
                            4
                        } else if c >= 0xE0 {
                            3
                        } else {
                            2
                        };
                        s.push_str(std::str::from_utf8(&b[start..start + len]).expect("UTF-8"));
                        *i = start + len;
                    }
                }
            }
        }
        b't' => {
            *i += 4;
            Json::Bool(true)
        }
        b'f' => {
            *i += 5;
            Json::Bool(false)
        }
        b'n' => {
            *i += 4;
            Json::Null
        }
        _ => {
            let start = *i;
            while *i < b.len()
                && (b[*i] == b'-'
                    || b[*i] == b'+'
                    || b[*i] == b'.'
                    || b[*i] == b'e'
                    || b[*i] == b'E'
                    || b[*i].is_ascii_digit())
            {
                *i += 1;
            }
            Json::Num(std::str::from_utf8(&b[start..*i]).expect("ASCII").parse().expect("a number"))
        }
    }
}

/// `digests.txt`: (tick, d, slice, r) per tick.
pub fn digests() -> Vec<(u32, u64, u64, u64)> {
    golden_text("digests.txt")
        .lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .map(|l| {
            let f: Vec<&str> = l.split_whitespace().collect();
            (f[0].parse().expect("tick"), u64_hex(f[1]), u64_hex(f[2]), u64_hex(f[3]))
        })
        .collect()
}

/// One line of `states/hashes.txt`.
#[derive(Debug)]
pub struct StateHashLine {
    pub tick: u32,
    pub full: u64,
    pub r: u64,
    pub sections: Vec<(u32, u64)>,
}

pub fn state_hashes() -> Vec<StateHashLine> {
    golden_text("states/hashes.txt")
        .lines()
        .filter(|l| l.starts_with("tick "))
        .map(|l| {
            let f: Vec<&str> = l.split_whitespace().collect();
            let sections = f[5..]
                .iter()
                .map(|x| {
                    let (id, h) = x.split_once(':').expect("id:hash");
                    (id.parse().expect("id"), u64_hex(h))
                })
                .collect();
            StateHashLine {
                tick: f[1].parse().expect("tick"),
                full: u64_hex(f[2]),
                r: u64_hex(f[4]),
                sections,
            }
        })
        .collect()
}

/// The state ticks the golden set freezes.
pub const STATE_TICKS: [u32; 6] = [0, 1, 2, 300, 600, 3600];

pub fn state_file(t: u32) -> Vec<u8> {
    golden(&format!("states/tick-{t:04}.sections"))
}

/// `SaveOutput` bytes with one section's bytes replaced by `f(old bytes)`.
pub fn patch_section(save: &[u8], id: schema::SaveSection, f: impl FnOnce(&[u8]) -> Vec<u8>) -> Vec<u8> {
    let (frames, r) = sim::save::parse_save_output(save).expect("SaveOutput");
    let mut f = Some(f);
    let owned: Vec<(u32, Vec<u8>)> = frames
        .iter()
        .map(|x| {
            if x.id == id.value() {
                (x.id, (f.take().expect("one section"))(x.data))
            } else {
                (x.id, x.data.to_vec())
            }
        })
        .collect();
    let sections: Vec<(schema::SaveSection, Vec<u8>)> = owned
        .into_iter()
        .map(|(i, b)| (schema::SaveSection::from_value(i).expect("a known section"), b))
        .collect();
    let mut out = Vec::new();
    sim::save::write_save_output(&sections, r, &mut out).expect("writes");
    out
}

/// A column table's column `name`: its byte offset and width (§8.1's directory).
pub fn column(table: &[u8], name: &str) -> (usize, usize) {
    let u32_at = |at: usize| u32::from_le_bytes(table[at..at + 4].try_into().unwrap()) as usize;
    let rows = u32_at(0);
    let n = usize::from(u16::from_le_bytes([table[4], table[5]]));
    let mut at = 8;
    for _ in 0..n {
        let len = usize::from(table[at]);
        let cname = &table[at + 1..at + 1 + len];
        at += 1 + len + 2;
        let (off, bytes) = (u32_at(at), u32_at(at + 4));
        at += 8;
        if cname == name.as_bytes() {
            return (off, bytes / rows.max(1));
        }
    }
    panic!("no column {name}")
}

/// A table with row `row` of `u32`/`i32` column `name` set to `v` (raw little-endian bits).
pub fn set_column_u32(table: &[u8], name: &str, row: usize, v: u32) -> Vec<u8> {
    let (off, w) = column(table, name);
    assert_eq!(w, 4, "{name} is not a 4-byte column");
    let mut t = table.to_vec();
    t[off + 4 * row..off + 4 * row + 4].copy_from_slice(&v.to_le_bytes());
    t
}

/// A table's `u32` column value at `row`.
pub fn get_column_u32(table: &[u8], name: &str, row: usize) -> u32 {
    let (off, w) = column(table, name);
    assert_eq!(w, 4);
    u32::from_le_bytes(table[off + 4 * row..off + 4 * row + 4].try_into().unwrap())
}

/// `sim_load`'s input with remap tables (abi.yaml `LoadInput`, `RemapTable`): `(kind, ids, removed names)`.
pub fn load_input_with_remaps(save: &[u8], remaps: &[(u16, &[u16], &[&str])]) -> Vec<u8> {
    let (frames, r) = sim::save::parse_save_output(save).expect("SaveOutput");
    let plain = sim::save::load_input(&frames, r);
    // The plain input ends with u16 kind_count = 0 and u64 r: rewrite that tail.
    let mut out = plain[..plain.len() - 10].to_vec();
    out.extend_from_slice(&(remaps.len() as u16).to_le_bytes());
    for (kind, ids, removed) in remaps {
        out.extend_from_slice(&kind.to_le_bytes());
        out.extend_from_slice(&(ids.len() as u32).to_le_bytes());
        for id in *ids {
            out.extend_from_slice(&id.to_le_bytes());
        }
        out.extend_from_slice(&(removed.len() as u16).to_le_bytes());
        for name in *removed {
            out.push(name.len() as u8);
            out.extend_from_slice(name.as_bytes());
        }
    }
    out.extend_from_slice(&r.to_le_bytes());
    out
}
