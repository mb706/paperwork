//! The simplex port against simplex-noise 4.0.3 itself (10 §5.18): the fixture test/worldgen/simplex-4.0.3.txt
//! holds the package's permutation tables and noise values for SplitMix64-seeded tables (written and checked
//! by test/worldgen/simplex.test.ts); the port must give the same bits.
#![allow(clippy::disallowed_methods)] // the test reads its fixture

use worldgen::noise::{Simplex2, SplitMix64, permutation_table};

#[test]
fn the_port_gives_simplex_noise_4_0_3s_bits() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../test/worldgen/simplex-4.0.3.txt");
    let text = std::fs::read_to_string(path).expect("the fixture");
    let mut noise: Option<Simplex2> = None;
    let (mut seeds, mut values) = (0, 0);
    for line in text.lines().filter(|l| !l.starts_with('#')) {
        if let Some(h) = line.strip_prefix("seed ") {
            let seed = u64::from_str_radix(h, 16).expect("hex");
            noise = Some(Simplex2::from_seed(seed));
            let perm = permutation_table(&mut SplitMix64(seed));
            let want = text
                .lines()
                .skip_while(|l| *l != line)
                .nth(1)
                .and_then(|l| l.strip_prefix("perm "))
                .expect("a perm line");
            let want: Vec<u8> = want.split(' ').map(|x| x.parse().expect("a byte")).collect();
            assert_eq!(&perm[..256], &want[..], "seed {h}: the permutation table");
            seeds += 1;
            continue;
        }
        if line.starts_with("perm ") {
            continue;
        }
        let f: Vec<u64> = line.split(' ').map(|x| u64::from_str_radix(x, 16).expect("bits")).collect();
        let (x, y) = (f64::from_bits(f[0]), f64::from_bits(f[1]));
        let v = noise.as_ref().expect("a seed first").noise(x, y);
        assert_eq!(v.to_bits(), f[2], "noise({x}, {y}) = {v}, the package {}", f64::from_bits(f[2]));
        values += 1;
    }
    assert_eq!(seeds, 4);
    assert!(values >= 4 * 200, "{values}");
}
