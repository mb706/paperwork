//! Frozen regression goldens (10 §10.3 "Workflow"; C8): a golden is first asserted against the value Factorio or
//! the wiki gives, within its tolerance; once it passes, the exact value is frozen in `test/goldens/<file>.json`,
//! and any change to a frozen value needs `UPDATE_GOLDENS=1` (rewrites the files; review the diff) and a note in the
//! commit message. The TypeScript twin is `test/helpers/goldens.ts`. One file per test, so parallel tests never
//! write the same file. The format is a flat JSON object of numbers, keys sorted, one per line.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

fn path(file: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test/goldens").join(format!("{file}.json"))
}

fn read(file: &str) -> BTreeMap<String, f64> {
    let Ok(text) = std::fs::read_to_string(path(file)) else {
        return BTreeMap::new();
    };
    let mut out = BTreeMap::new();
    for line in text.lines() {
        let t = line.trim().trim_end_matches(',');
        let Some((k, v)) = t.split_once(':') else { continue };
        let k = k.trim().trim_matches('"');
        let v: f64 = v.trim().parse().unwrap_or_else(|_| panic!("test/goldens/{file}.json: {line}"));
        out.insert(k.to_owned(), v);
    }
    out
}

fn write(file: &str, values: &BTreeMap<String, f64>) {
    let body: Vec<String> = values.iter().map(|(k, v)| format!("  \"{k}\": {v:?}")).collect();
    std::fs::create_dir_all(path(file).parent().expect("a directory")).expect("test/goldens");
    std::fs::write(path(file), format!("{{\n{}\n}}\n", body.join(",\n"))).expect("writes the golden");
}

/// A golden group (one test's file).
pub struct Goldens {
    file: &'static str,
    values: BTreeMap<String, f64>,
    update: bool,
}

impl Goldens {
    pub fn open(file: &'static str) -> Self {
        Self { file, values: read(file), update: std::env::var("UPDATE_GOLDENS").is_ok_and(|v| v == "1") }
    }

    /// Checks `value` against Factorio's `expected` within `tolerance` (absolute), then against the frozen value.
    pub fn check(&mut self, name: &str, value: f64, expected: f64, tolerance: f64) {
        assert!(
            (value - expected).abs() <= tolerance,
            "{}: {name} = {value}, Factorio's value is {expected} ± {tolerance}",
            self.file
        );
        match self.values.get(name) {
            _ if self.update => {
                self.values.insert(name.to_owned(), value);
            }
            Some(&frozen) => assert!(
                frozen.to_bits() == value.to_bits(),
                "{}: {name} = {value}, frozen at {frozen} (UPDATE_GOLDENS=1 after review, and say why in the commit)",
                self.file
            ),
            None => panic!("{}: {name} = {value} is not frozen yet: run with UPDATE_GOLDENS=1", self.file),
        }
    }

    /// Writes the file under `UPDATE_GOLDENS=1` (call it last).
    pub fn finish(self) {
        if self.update {
            write(self.file, &self.values);
        }
    }
}
