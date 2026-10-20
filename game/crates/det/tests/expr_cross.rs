//! The expression cross-check (10 §15.2, §15.11): the Rust interpreter must reproduce the TypeScript
//! reference interpreter on every formula of the design data at every checked point, and the hand-written
//! golden values of the edge cases. The fixture is written by the data stage (`npm run data`):
//! game/test/fixtures/expr/cases.txt; scripts/data-stage/emit/expr-fixture.ts documents its format.
#![allow(clippy::disallowed_methods)] // a test reads its fixture

use det::expr::{Range, eval};
use std::fs;
use std::path::Path;

fn f64_bits(hex: &str) -> f64 {
    f64::from_bits(u64::from_str_radix(hex, 16).expect("16 hex digits"))
}

fn bytes(hex: &str) -> Vec<u8> {
    (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("hex")).collect()
}

/// FNV-1a 32 over each result's f64 bits (little-endian) and its flags byte.
struct Fnv32(u32);

impl Fnv32 {
    fn byte(&mut self, b: u8) {
        self.0 = (self.0 ^ u32::from(b)).wrapping_mul(0x0100_0193);
    }
    fn result(&mut self, value: f64, flags: u8) {
        for b in value.to_bits().to_le_bytes() {
            self.byte(b);
        }
        self.byte(flags);
    }
}

/// The points of a case, in the fixture's order: `L=a..b`, or `grid=n` over one or two variables.
fn points(spec: &str, var_count: usize) -> Vec<Vec<f64>> {
    if let Some(levels) = spec.strip_prefix("L=") {
        let (a, b) = levels.split_once("..").expect("L=a..b");
        let (a, b): (u32, u32) = (a.parse().expect("level"), b.parse().expect("level"));
        return (a..=b).map(|l| vec![f64::from(l)]).collect();
    }
    let n: u32 = spec.strip_prefix("grid=").expect("grid=n").parse().expect("steps");
    let step = |k: u32| f64::from(k) / f64::from(n);
    match var_count {
        1 => (0..=n).map(|k| vec![step(k)]).collect(),
        2 => (0..=n).flat_map(|a| (0..=n).map(move |b| vec![step(a), step(b)])).collect(),
        other => panic!("grids over {other} variables are not supported"),
    }
}

#[test]
fn rust_matches_the_reference_interpreter() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test/fixtures/expr/cases.txt");
    let text = fs::read_to_string(&path).expect("test/fixtures/expr/cases.txt (run `npm run data`)");
    let (mut cases, mut edges, mut failures) = (0, 0, Vec::new());
    for line in text.lines().filter(|l| !l.starts_with('#') && !l.is_empty()) {
        let f: Vec<&str> = line.split(' ').collect();
        match f[0] {
            "case" => {
                cases += 1;
                let (name, range) = (f[1], Range { lo: f64_bits(f[3]), hi: f64_bits(f[4]) });
                let code = bytes(f[6]);
                let want_count: usize = f[7].parse().expect("count");
                assert!(want_count > 0, "{name}: a case without points checks nothing");
                let mut hash = Fnv32(0x811c_9dc5);
                let mut units = Fnv32(0x811c_9dc5);
                let pts = points(f[5], usize::from(code[2]));
                let mut values = Vec::with_capacity(pts.len());
                for vars in &pts {
                    let v = eval(&code, vars, range).expect("valid bytecode");
                    hash.result(v.value, v.flags);
                    units.result(det::unit_count(v.value), 0);
                    values.push(v.value);
                }
                if f[10] != "-" && format!("{:08x}", units.0) != f[10] {
                    failures.push(format!("{name}: unit counts hash {:08x}, want {}", units.0, f[10]));
                }
                if pts.len() != want_count || format!("{:08x}", hash.0) != f[8] {
                    let samples: Vec<String> = f[9]
                        .split(',')
                        .map(|s| {
                            let (i, want) = s.split_once(':').expect("index:bits");
                            let i: usize = i.parse().expect("index");
                            let have =
                                values.get(i).map_or(String::from("-"), |v| format!("{:016x}", v.to_bits()));
                            format!("[{i}] want {want} have {have}")
                        })
                        .collect();
                    failures.push(format!(
                        "{name}: {} points, hash {:08x}; {}",
                        pts.len(),
                        hash.0,
                        samples.join(", ")
                    ));
                }
            }
            "edge" => {
                edges += 1;
                let (name, range) = (f[1], Range { lo: f64_bits(f[2]), hi: f64_bits(f[3]) });
                let vars: Vec<f64> =
                    if f[4] == "-" { Vec::new() } else { f[4].split(',').map(f64_bits).collect() };
                let v = eval(&bytes(f[5]), &vars, range).expect("valid bytecode");
                let (want, want_flags): (f64, u8) = (f64_bits(f[6]), f[7].parse().expect("flags"));
                if v.value.to_bits() != want.to_bits() || v.flags != want_flags {
                    failures.push(format!(
                        "{name}: want {:016x} flags {want_flags}, have {:016x} flags {}",
                        want.to_bits(),
                        v.value.to_bits(),
                        v.flags
                    ));
                }
            }
            other => panic!("unknown fixture line kind {other}"),
        }
    }
    assert!(cases > 0 && edges > 0, "the fixture holds {cases} cases and {edges} edge cases");
    assert!(failures.is_empty(), "{} mismatches:\n{}", failures.len(), failures.join("\n"));
}
