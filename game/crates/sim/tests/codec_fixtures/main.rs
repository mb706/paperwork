//! The codec fixtures, Rust side (10 §15.1 "Cross-language fixtures", D18 g). `npm run gen` writes
//! test/fixtures/codec/ with the reference codec (scripts/schema-gen/refcodec.ts); Vitest holds the
//! generated TypeScript to the same files (test/codec/fixtures.test.ts). Here the generated Rust must:
//! - decode every sample of actions.bin and records.bin, re-encode it to the same bytes, and dump it to the
//!   reference dump (compared by hash), for every struct, message and record of the schema;
//! - give every limit probe of probes.txt exactly its verdict (error kind, field and byte offset);
//! - decode each hand-written fixture of spec/*.hex to the dump written beside it (`@dump` lines).
//!
//! The dispatch by type name is generated: generated.rs, from scripts/schema-gen/fixtures-rust.ts.
#![allow(clippy::disallowed_methods)] // a test reads its fixtures

mod generated;

use generated::{
    NAMES, decode_action_framed, decode_by_name, fnv1a32, from_hex, parse_fixture_entries, parse_probes,
    round_trip, round_trip_action, verdict,
};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

fn dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test/fixtures/codec")
}

fn fixture(name: &str) -> Vec<u8> {
    let p = dir().join(name);
    fs::read(&p).unwrap_or_else(|e| panic!("{}: {e} (run npm run gen)", p.display()))
}

/// The first lines of a dump, for a failure message.
fn head(dump: &str) -> String {
    dump.lines().take(12).collect::<Vec<_>>().join("\n    ")
}

#[test]
fn every_sample_round_trips_to_the_reference_dump() {
    let mut failures = Vec::new();
    let mut seen = BTreeSet::new();
    let mut count = 0;
    for file in ["actions.bin", "records.bin"] {
        for e in parse_fixture_entries(&fixture(file)).expect("fixture framing") {
            count += 1;
            seen.insert(e.name.clone());
            let got = if file == "actions.bin" {
                round_trip_action(&e.bytes)
            } else {
                round_trip(&e.name, &e.bytes).unwrap_or_else(|| Err("no such type".to_owned()))
            };
            match got {
                Ok(dump) if fnv1a32(dump.as_bytes()) == e.dump_hash => {}
                Ok(dump) => failures.push(format!(
                    "{} ({}): the dump differs from the reference dump; it begins\n    {}",
                    e.name,
                    e.variant,
                    head(&dump)
                )),
                Err(m) => failures.push(format!("{} ({}): {m}", e.name, e.variant)),
            }
        }
    }
    assert!(failures.is_empty(), "{} of {count} samples fail:\n{}", failures.len(), failures.join("\n"));
    let missing: Vec<&str> = NAMES.iter().copied().filter(|n| !seen.contains(*n)).collect();
    assert!(missing.is_empty(), "types without samples: {missing:?}");
}

#[test]
fn every_probe_gets_its_verdict() {
    let text = String::from_utf8(fixture("probes.txt")).expect("UTF-8");
    let probes = parse_probes(&text);
    assert!(probes.len() > 1000, "probes.txt has only {} probes", probes.len());
    let mut failures = Vec::new();
    for p in &probes {
        let got = if p.kind == "action" {
            verdict(&decode_action_framed(&p.bytes))
        } else if let Some(r) = decode_by_name(&p.target, &p.bytes) {
            verdict(&r)
        } else {
            "no such type".to_owned()
        };
        if got != p.verdict {
            failures.push(format!("{}:{} {}: got `{got}`, want `{}`", p.kind, p.target, p.name, p.verdict));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} probes fail:\n{}",
        failures.len(),
        probes.len(),
        failures.join("\n")
    );
}

/// A hand-written fixture (game/schema/README.md, "Fixtures"): `@type <name>`, `@action` or
/// `@closure <params>`, hex lines, then `@dump` and the expected dump lines, `@ok <summary>` or
/// `@error <verdict>`. `#` starts a comment line, and a directive may end in ` # comment`.
struct HexCase {
    file: String,
    line: usize,
    target: String,
    params: String,
    bytes: Vec<u8>,
    expect: Expect,
}

enum Expect {
    Dump(String),
    Ok(String),
    Error(String),
}

fn directive(l: &str) -> &str {
    l.split(" #").next().unwrap_or("").trim()
}

fn parse_hex_file(file: &str, text: &str) -> Vec<HexCase> {
    let mut out: Vec<HexCase> = Vec::new();
    let mut cur: Option<HexCase> = None;
    let mut hex = String::new();
    let mut in_dump = false;
    let mut flush = |cur: &mut Option<HexCase>, hex: &mut String| {
        if let Some(mut c) = cur.take() {
            c.bytes = from_hex(hex);
            out.push(c);
        }
        hex.clear();
    };
    for (i, raw) in text.lines().enumerate() {
        let l = raw.trim_end();
        if l.starts_with('#') || l.is_empty() {
            continue;
        }
        if l.starts_with('@') {
            let d = directive(l);
            let (word, rest) = d.split_once(' ').unwrap_or((d, ""));
            let rest = rest.trim().to_owned();
            let start = |target: &str, params: String| HexCase {
                file: file.to_owned(),
                line: i + 1,
                target: target.to_owned(),
                params,
                bytes: Vec::new(),
                expect: Expect::Dump(String::new()),
            };
            in_dump = false;
            match word {
                "@type" => {
                    flush(&mut cur, &mut hex);
                    cur = Some(start(&rest, String::new()));
                }
                "@action" => {
                    flush(&mut cur, &mut hex);
                    cur = Some(start("@action", String::new()));
                }
                "@closure" => {
                    flush(&mut cur, &mut hex);
                    cur = Some(start("@closure", rest));
                }
                "@dump" => in_dump = true,
                "@ok" => {
                    if let Some(c) = cur.as_mut() {
                        c.expect = Expect::Ok(format!("ok {rest}").trim().to_owned());
                    }
                }
                "@error" => {
                    if let Some(c) = cur.as_mut() {
                        c.expect = Expect::Error(rest);
                    }
                }
                "@end" => flush(&mut cur, &mut hex),
                _ => panic!("{file}:{}: unknown directive {word}", i + 1),
            }
        } else if in_dump {
            if let Some(Expect::Dump(d)) = cur.as_mut().map(|c| &mut c.expect) {
                d.push_str(l);
                d.push('\n');
            }
        } else {
            hex.push_str(l.split("//").next().unwrap_or(""));
        }
    }
    flush(&mut cur, &mut hex);
    out
}

/// Runs the preflight with `tick=… last_seq=p:s,… system_seq=… blobs=h,…` and spells its verdict:
/// `ok batches=N actions=M`, `framing @<at>` or `blob_missing @<at>`.
fn closure_verdict(params: &str, bytes: &[u8]) -> String {
    let mut tick = 0u32;
    let mut last_seq = [0u32; schema::PLAYERS];
    let mut system_seq = 0u32;
    let mut blobs: Vec<Vec<u8>> = Vec::new();
    for kv in params.split_whitespace() {
        let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
        match k {
            "tick" => tick = v.parse().expect("tick"),
            "system_seq" => system_seq = v.parse().expect("system_seq"),
            "last_seq" => {
                for pair in v.split(',').filter(|x| !x.is_empty()) {
                    let (p, q) = pair.split_once(':').expect("player:seq");
                    last_seq[p.parse::<usize>().expect("player")] = q.parse().expect("seq");
                }
            }
            "blobs" => blobs = v.split(',').filter(|x| !x.is_empty()).map(from_hex).collect(),
            _ => panic!("unknown @closure parameter {k}"),
        }
    }
    match schema::preflight(bytes, tick, &last_seq, system_seq, &|h| blobs.iter().any(|b| b == h)) {
        Ok(s) => format!("ok batches={} actions={}", s.batches, s.actions),
        Err(schema::PreflightError::Framing { at, .. }) => format!("framing @{at}"),
        Err(schema::PreflightError::BlobMissing { at }) => format!("blob_missing @{at}"),
    }
}

/// An expected refusal matches a verdict exactly, or by its kind when it names only the kind.
fn refusal_matches(want: &str, got: &str) -> bool {
    if want.contains(' ') { got == want } else { got.split(' ').next() == Some(want) }
}

#[test]
fn hand_written_fixtures_decode_to_their_dumps() {
    let spec = dir().join("spec");
    let mut files: Vec<PathBuf> = fs::read_dir(&spec)
        .unwrap_or_else(|e| panic!("{}: {e}", spec.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "hex"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no spec/*.hex fixtures");
    let mut failures = Vec::new();
    let mut count = 0;
    for f in &files {
        let name = f.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let text = fs::read_to_string(f).expect("UTF-8");
        for c in parse_hex_file(&name, &text) {
            count += 1;
            let at = format!("{}:{} {}", c.file, c.line, c.target);
            if c.target == "@closure" {
                let got = closure_verdict(&c.params, &c.bytes);
                let ok = match &c.expect {
                    Expect::Ok(want) => got == *want,
                    Expect::Error(want) => refusal_matches(want, &got),
                    Expect::Dump(_) => false,
                };
                if !ok {
                    failures.push(format!("{at}: got `{got}`"));
                }
                continue;
            }
            let verdict_of = |b: &[u8]| {
                if c.target == "@action" {
                    verdict(&decode_action_framed(b))
                } else {
                    decode_by_name(&c.target, b).map_or_else(|| "no such type".to_owned(), |r| verdict(&r))
                }
            };
            let trip = if c.target == "@action" {
                round_trip_action(&c.bytes)
            } else {
                round_trip(&c.target, &c.bytes).unwrap_or_else(|| Err("no such type".to_owned()))
            };
            match (&c.expect, trip) {
                (Expect::Dump(want), Ok(dump)) if *want == dump => {}
                (Expect::Dump(want), Ok(dump)) => {
                    failures.push(format!("{at}: dump differs:\n--- want\n{want}--- got\n{dump}"));
                }
                (Expect::Dump(_) | Expect::Ok(_), Err(m)) => failures.push(format!("{at}: {m}")),
                (Expect::Ok(_), Ok(_)) => {}
                (Expect::Error(want), _) => {
                    let got = verdict_of(&c.bytes);
                    if !refusal_matches(want, &got) {
                        failures.push(format!("{at}: got `{got}`, want `{want}`"));
                    }
                }
            }
        }
    }
    assert!(count > 0, "the spec/*.hex fixtures hold no cases");
    assert!(
        failures.is_empty(),
        "{} of {count} hand-written fixtures fail:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

#[test]
fn schema_hash_matches_the_typescript_side() {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src/shared/gen/schema.ts");
    let ts = fs::read_to_string(&p).expect("schema.ts");
    let want = format!("export const SCHEMA_HASH = '{}';", schema::SCHEMA_HASH_HEX);
    assert!(ts.contains(&want), "src/shared/gen/schema.ts has another SCHEMA_HASH: run npm run gen");
    let hex: String = schema::SCHEMA_HASH.iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(hex, schema::SCHEMA_HASH_HEX);
}
