//! `Protos::load` (10 §15.2) on the data stage's M0 build: test/fixtures/protos/m0.bin, which `npm run data`
//! writes and `npm run check` keeps fresh. The file loads, the engine's character is the last entity with
//! its numbers (game/data/engine/prototypes.yaml), and a malformed file is refused: a wrong magic or schema
//! hash, a truncation, a contents record that lacks a block the engine reads (C1a-r1 finding 5), and
//! malformed expression programs.
#![allow(clippy::disallowed_methods)] // a test reads its fixture

use schema::codec::ErrorKind;
use schema::protos::{Protos, expr_programs};
use schema::{EntityId, EntityType, ProtoKind};
use std::fs;
use std::path::Path;

fn m0() -> Vec<u8> {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test/fixtures/protos/m0.bin");
    fs::read(&p).unwrap_or_else(|e| panic!("{}: {e} (run npm run data)", p.display()))
}

fn refusal(bytes: &[u8]) -> ErrorKind {
    match Protos::load(bytes) {
        Ok(_) => panic!("loaded a malformed prototypes.bin"),
        Err(e) => e.kind,
    }
}

#[test]
fn loads_the_m0_build() {
    let p = Protos::load(&m0()).expect("m0.bin loads (run npm run gen, then npm run data)");
    assert_eq!(p.names.entity, ["iron-chest", "character"]);
    assert_eq!(p.names.item, ["iron-chest", "iron-ore", "iron-plate"]);
    let c = p.well_known.character.expect("the character is in the M0 build");
    assert_eq!(c, EntityId(1));
    let i = usize::from(c.0);
    assert_eq!(p.entity.r#type[i], EntityType::Character);
    assert_eq!(p.entity.running_speed[i], 0.15);
    assert_eq!(p.entity.reach_distance[i], 10.0);
    assert_eq!(p.entity.build_distance[i], 10.0);
    assert_eq!(p.entity.resource_reach_distance[i], 2.7);
    assert_eq!(p.entity.item_pickup_distance[i], 1.0);
    assert_eq!(p.entity.inventory_slots[i], 80);
    assert_eq!(p.entity.mining_speed[i], 0.5);
    assert_eq!(p.entity.inventory_slots[0], 32);
    assert_eq!(p.names.find(ProtoKind::Entity, "iron-chest"), Some(0));
    // META: the start inventory (8 iron plates) and the contents record.
    assert_eq!(p.start.inventory.len(), 1);
    assert_eq!(p.start.inventory[0].count, 8);
    assert!(p.contents.meta.iter().any(|b| b == "start.inventory"));
}

#[test]
fn refuses_a_malformed_file() {
    let good = m0();
    let mut b = good.clone();
    b[0] ^= 1;
    assert_eq!(refusal(&b), ErrorKind::BadMagic);
    let mut b = good.clone();
    b[12] ^= 1; // the schema hash
    assert_eq!(refusal(&b), ErrorKind::SchemaMismatch);
    assert_eq!(refusal(&good[..good.len() - 1]), ErrorKind::Truncated);
    let mut b = good.clone();
    b.push(0);
    assert_eq!(refusal(&b), ErrorKind::Trailing);
}

#[test]
fn refuses_a_file_that_lacks_a_block_the_engine_reads() {
    // Rename the contents record's `start.inventory` (same length, still sorted): the file then claims
    // a block this engine does not read, and lacks the one it does (capabilities REQUIRED_DATA).
    let mut b = m0();
    let needle = b"start.inventory";
    let at =
        b.windows(needle.len()).position(|w| w == needle).expect("the contents record names start.inventory");
    assert!(b.windows(needle.len()).skip(at + 1).all(|w| w != needle), "start.inventory appears once");
    b[at + needle.len() - 1] = b'z';
    assert_eq!(refusal(&b), ErrorKind::MissingField);
}

#[test]
fn refuses_malformed_expression_programs() {
    // u16 byte_count, u8 var_count, u8 max_stack, ops (§15.2; schema/protos.yaml `expr`).
    let konst = |v: f64| {
        let mut x = vec![0x01];
        x.extend_from_slice(&v.to_le_bytes());
        x
    };
    let program = |vars: u8, max: u8, ops: &[u8]| {
        let mut p = Vec::new();
        p.extend_from_slice(&(ops.len() as u16).to_le_bytes());
        p.push(vars);
        p.push(max);
        p.extend_from_slice(ops);
        p
    };
    let ok = [konst(2.0), konst(3.0), vec![0x12, 0xFF]].concat(); // 2 × 3
    let two = [program(0, 2, &ok), program(1, 1, &[0x02, 0x00, 0xFF])].concat();
    assert_eq!(expr_programs(&two), Ok(vec![0, 4 + ok.len() as u32]));
    let bad: [(&str, Vec<u8>); 8] = [
        ("unknown op", program(0, 1, &[0x77, 0xFF])),
        ("underflow", program(0, 1, &[0x10, 0xFF])),
        ("no END", program(0, 1, &konst(1.0))),
        ("two values at END", program(0, 2, &[konst(1.0), konst(2.0), vec![0xFF]].concat())),
        ("VAR out of range", program(1, 1, &[0x02, 0x01, 0xFF])),
        ("stack over max", program(0, 1, &[konst(1.0), konst(2.0), vec![0x10, 0xFF]].concat())),
        ("NaN constant", program(0, 1, &[konst(f64::NAN), vec![0xFF]].concat())),
        ("runs past EXPR", {
            let mut p = program(0, 1, &[0xFF]);
            p[0] = 9;
            p
        }),
    ];
    for (what, b) in bad {
        assert!(expr_programs(&b).is_err(), "accepted a program with {what}");
    }
}
