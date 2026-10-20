//! Rounding costs half up to whole units (10 §5.12): det::unit_count against the hand-written goldens
//! of test/fixtures/expr/unit-counts.txt, which pin the TypeScript twin too (C1a-r1 finding 7).
#![allow(clippy::disallowed_methods)] // a test reads its fixture

use std::path::Path;

#[test]
fn unit_count_matches_the_goldens() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test/fixtures/expr/unit-counts.txt");
    let text = std::fs::read_to_string(path).expect("test/fixtures/expr/unit-counts.txt");
    let mut n = 0;
    for line in text.lines() {
        let line = line.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let v: f64 = parts.next().expect("value").parse().expect("a decimal double");
        let want: f64 = parts.next().expect("count").parse().expect("a decimal double");
        assert_eq!(det::unit_count(v).to_bits(), want.to_bits(), "unit_count({v})");
        n += 1;
    }
    assert!(n >= 14, "only {n} goldens");
}
