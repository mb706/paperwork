//! The Rust kernel must reproduce the TS kernel's state hashes bit for bit, with and without sleeping.
//! Prepare with `node harness/golden.ts` (writes ../target/golden.txt and the tiny worlds).
use sim::World;
use std::path::Path;

#[test]
fn matches_ts_golden_hashes() {
    let golden = Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/golden.txt");
    let Ok(text) = std::fs::read_to_string(&golden) else {
        panic!("missing {}: run `node harness/golden.ts` first", golden.display());
    };
    let mut checked = 0;
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        let f: Vec<&str> = line.split_whitespace().collect();
        let (file, ticks, mode, want) = (f[0], f[1].parse::<i32>().unwrap(), f[2], f[3]);
        let bytes = std::fs::read(file).expect("world file");
        let mut w = World::new(&bytes);
        w.set_no_sleep(mode == "nosleep");
        w.run(ticks as u32);
        let got = format!("{:08x}", w.hash());
        assert_eq!(got, want, "{file} after {ticks} ticks ({mode})");
        checked += 1;
    }
    assert!(checked >= 16, "only {checked} golden lines");
}
