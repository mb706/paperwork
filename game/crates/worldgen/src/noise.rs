//! 2D simplex noise (10 §5.18), ported from simplex-noise 4.0.3 (`createNoise2D`, `buildPermutationTable`;
//! MIT, Jonas Wagner, after Stefan Gustavson) with `+ − ×` and `floor` only, so native code and every
//! WebAssembly engine compute the same bits. `F2` and `G2` are the package's constants (its `Math.sqrt(3)`,
//! correctly rounded, written out). The permutation table is built by the package's own shuffle from a
//! seeded [`SplitMix64`] stream instead of `Math.random`; test/golden values pin both (crate tests, and
//! `worldgen/tests/simplex.rs` against the package itself through Node).

/// `0.5 * (sqrt(3) - 1)`.
pub const F2: f64 = 0.366_025_403_784_438_6;
/// `(3 - sqrt(3)) / 6`.
pub const G2: f64 = 0.211_324_865_405_187_13;

/// The 12 gradients of simplex-noise's `grad2`, as (x, y) pairs.
const GRAD2: [(f64, f64); 12] = [
    (1.0, 1.0),
    (-1.0, 1.0),
    (1.0, -1.0),
    (-1.0, -1.0),
    (1.0, 0.0),
    (-1.0, 0.0),
    (1.0, 0.0),
    (-1.0, 0.0),
    (0.0, 1.0),
    (0.0, -1.0),
    (0.0, 1.0),
    (0.0, -1.0),
];

/// SplitMix64 (Steele, Lea and Flood 2014): the seeded stream behind permutation tables and worldgen's
/// per-cell draws. `next_f64` is in [0, 1) with 53 random bits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SplitMix64(pub u64);

impl SplitMix64 {
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        mix64(self.0)
    }

    pub fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / 9_007_199_254_740_992.0)
    }
}

/// SplitMix64's finalizer: a bijective 64-bit mix.
pub const fn mix64(mut z: u64) -> u64 {
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// One noise function: simplex-noise's permutation table and its precomputed gradient columns.
#[derive(Clone, Debug)]
pub struct Simplex2 {
    perm: [u8; 512],
    gx: [f64; 512],
    gy: [f64; 512],
}

impl Simplex2 {
    /// `createNoise2D(random)` with `random` = the stream's `next_f64`.
    pub fn new(random: &mut SplitMix64) -> Self {
        let perm = permutation_table(random);
        let mut gx = [0.0; 512];
        let mut gy = [0.0; 512];
        for i in 0..512 {
            let g = GRAD2[usize::from(perm[i]) % 12];
            gx[i] = g.0;
            gy[i] = g.1;
        }
        Self { perm, gx, gy }
    }

    pub fn from_seed(seed: u64) -> Self {
        Self::new(&mut SplitMix64(seed))
    }

    /// `noise2D(x, y)`, in [−1, 1].
    pub fn noise(&self, x: f64, y: f64) -> f64 {
        let s = (x + y) * F2;
        let i = fast_floor(x + s);
        let j = fast_floor(y + s);
        let t = (f64::from(i) + f64::from(j)) * G2;
        let x0 = x - (f64::from(i) - t);
        let y0 = y - (f64::from(j) - t);
        let (i1, j1) = if x0 > y0 { (1, 0) } else { (0, 1) };
        let x1 = x0 - f64::from(i1) + G2;
        let y1 = y0 - f64::from(j1) + G2;
        let x2 = x0 - 1.0 + 2.0 * G2;
        let y2 = y0 - 1.0 + 2.0 * G2;
        let ii = (i & 255) as usize;
        let jj = (j & 255) as usize;
        let p = &self.perm;
        let mut n0 = 0.0;
        let mut n1 = 0.0;
        let mut n2 = 0.0;
        let mut t0 = 0.5 - x0 * x0 - y0 * y0;
        if t0 >= 0.0 {
            let g = ii + usize::from(p[jj]);
            t0 *= t0;
            n0 = t0 * t0 * (self.gx[g] * x0 + self.gy[g] * y0);
        }
        let mut t1 = 0.5 - x1 * x1 - y1 * y1;
        if t1 >= 0.0 {
            let g = ii + i1 as usize + usize::from(p[jj + j1 as usize]);
            t1 *= t1;
            n1 = t1 * t1 * (self.gx[g] * x1 + self.gy[g] * y1);
        }
        let mut t2 = 0.5 - x2 * x2 - y2 * y2;
        if t2 >= 0.0 {
            let g = ii + 1 + usize::from(p[jj + 1]);
            t2 *= t2;
            n2 = t2 * t2 * (self.gx[g] * x2 + self.gy[g] * y2);
        }
        70.0 * (n0 + n1 + n2)
    }
}

/// `Math.floor(x) | 0`: the floor, wrapped to a 32-bit integer as JavaScript's `| 0` does.
fn fast_floor(x: f64) -> i32 {
    let f = x.floor();
    if f.is_finite() && f.abs() < 9.0e15 { (f as i64) as i32 } else { 0 }
}

/// `buildPermutationTable(random)`: the identity on 0–255, shuffled by `r = i + ~~(random() × (256 − i))`,
/// then repeated.
pub fn permutation_table(random: &mut SplitMix64) -> [u8; 512] {
    let mut p = [0u8; 512];
    for (i, v) in p.iter_mut().enumerate().take(256) {
        *v = i as u8;
    }
    for i in 0..255usize {
        let r = i + (random.next_f64() * (256 - i) as f64) as usize;
        p.swap(i, r);
    }
    for i in 256..512 {
        p[i] = p[i - 256];
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constants_are_the_packages() {
        // simplex-noise computes them from Math.sqrt(3), which IEEE 754 rounds correctly.
        let s3 = 3.0f64.sqrt();
        assert_eq!(F2.to_bits(), (0.5 * (s3 - 1.0)).to_bits());
        assert_eq!(G2.to_bits(), ((3.0 - s3) / 6.0).to_bits());
    }

    #[test]
    fn the_table_is_a_permutation_and_values_stay_in_range() {
        let n = Simplex2::from_seed(1945);
        let mut seen = [false; 256];
        for &v in &n.perm[..256] {
            seen[usize::from(v)] = true;
        }
        assert!(seen.iter().all(|&s| s));
        assert_eq!(n.perm[..256], n.perm[256..]);
        let mut lo = 0.0f64;
        let mut hi = 0.0f64;
        for k in 0..20_000 {
            let v = n.noise(f64::from(k) * 0.173 - 1000.0, f64::from(k % 97) * 0.311 - 15.0);
            assert!((-1.0..=1.0).contains(&v));
            if v < lo {
                lo = v;
            }
            if v > hi {
                hi = v;
            }
        }
        assert!(lo < -0.7 && hi > 0.7, "{lo} {hi}");
    }
}
