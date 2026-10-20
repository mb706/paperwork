//! XXH64 (10 §4.8): the full state hash, the per-tick digest d_t, the slice hash and the rolling digest r_t,
//! the change detection of UI records (§15.5), and worldgen's world hash (§15.9). It lives in `det` because
//! `sim` and `worldgen` (and so `gen.wasm`) both need it. Written from the xxHash specification
//! (`doc/xxhash_spec.md`, "XXH64 algorithm description"), so native code and every WebAssembly engine agree;
//! checked against the reference implementation's outputs (the vectors the golden model pins,
//! test/golden/model/xxh64.test.ts).
//!
//! Two forms: [`xxh64`] for a byte slice, and [`Xxh64`], a streaming hasher that gives the same value for
//! the same bytes however they are split, so a digest can be computed from pieces without a buffer.

const P1: u64 = 0x9E37_79B1_85EB_CA87;
const P2: u64 = 0xC2B2_AE3D_27D4_EB4F;
const P3: u64 = 0x1656_67B1_9E37_79F9;
const P4: u64 = 0x85EB_CA77_C2B2_AE63;
const P5: u64 = 0x27D4_EB2F_1656_67C5;

#[inline]
fn round(acc: u64, lane: u64) -> u64 {
    acc.wrapping_add(lane.wrapping_mul(P2)).rotate_left(31).wrapping_mul(P1)
}

#[inline]
fn merge_round(acc: u64, val: u64) -> u64 {
    (acc ^ round(0, val)).wrapping_mul(P1).wrapping_add(P4)
}

#[inline]
fn read_u64(b: &[u8], at: usize) -> u64 {
    let mut a = [0u8; 8];
    a.copy_from_slice(&b[at..at + 8]);
    u64::from_le_bytes(a)
}

#[inline]
fn read_u32(b: &[u8], at: usize) -> u32 {
    let mut a = [0u8; 4];
    a.copy_from_slice(&b[at..at + 4]);
    u32::from_le_bytes(a)
}

/// The tail of the algorithm: the remaining < 32 bytes, then the avalanche.
fn finish(mut h: u64, tail: &[u8]) -> u64 {
    let mut p = 0;
    while p + 8 <= tail.len() {
        h = (h ^ round(0, read_u64(tail, p))).rotate_left(27).wrapping_mul(P1).wrapping_add(P4);
        p += 8;
    }
    if p + 4 <= tail.len() {
        h = (h ^ u64::from(read_u32(tail, p)).wrapping_mul(P1))
            .rotate_left(23)
            .wrapping_mul(P2)
            .wrapping_add(P3);
        p += 4;
    }
    while p < tail.len() {
        h = (h ^ u64::from(tail[p]).wrapping_mul(P5)).rotate_left(11).wrapping_mul(P1);
        p += 1;
    }
    h ^= h >> 33;
    h = h.wrapping_mul(P2);
    h ^= h >> 29;
    h = h.wrapping_mul(P3);
    h ^= h >> 32;
    h
}

/// XXH64 of `data` with `seed` (§4.8 uses seed 0 everywhere).
pub fn xxh64_seeded(data: &[u8], seed: u64) -> u64 {
    let len = data.len();
    let mut p = 0;
    let mut h;
    if len >= 32 {
        let mut v =
            [seed.wrapping_add(P1).wrapping_add(P2), seed.wrapping_add(P2), seed, seed.wrapping_sub(P1)];
        while p + 32 <= len {
            v[0] = round(v[0], read_u64(data, p));
            v[1] = round(v[1], read_u64(data, p + 8));
            v[2] = round(v[2], read_u64(data, p + 16));
            v[3] = round(v[3], read_u64(data, p + 24));
            p += 32;
        }
        h = converge(&v);
    } else {
        h = seed.wrapping_add(P5);
    }
    h = h.wrapping_add(len as u64);
    finish(h, &data[p..])
}

fn converge(v: &[u64; 4]) -> u64 {
    let mut h = v[0]
        .rotate_left(1)
        .wrapping_add(v[1].rotate_left(7))
        .wrapping_add(v[2].rotate_left(12))
        .wrapping_add(v[3].rotate_left(18));
    for &x in v {
        h = merge_round(h, x);
    }
    h
}

/// XXH64 of `data`, seed 0.
pub fn xxh64(data: &[u8]) -> u64 {
    xxh64_seeded(data, 0)
}

/// A streaming XXH64: [`Xxh64::digest`] equals [`xxh64_seeded`] of everything written, however it was split.
/// It never allocates.
#[derive(Clone, Debug)]
pub struct Xxh64 {
    seed: u64,
    v: [u64; 4],
    /// Bytes written so far.
    total: u64,
    /// The pending bytes of an incomplete 32-byte stripe.
    buf: [u8; 32],
    used: usize,
}

impl Default for Xxh64 {
    fn default() -> Self {
        Self::new()
    }
}

impl Xxh64 {
    /// A hasher with seed 0.
    pub const fn new() -> Self {
        Self::with_seed(0)
    }

    pub const fn with_seed(seed: u64) -> Self {
        Self {
            seed,
            v: [seed.wrapping_add(P1).wrapping_add(P2), seed.wrapping_add(P2), seed, seed.wrapping_sub(P1)],
            total: 0,
            buf: [0; 32],
            used: 0,
        }
    }

    fn stripe(&mut self, b: &[u8]) {
        self.v[0] = round(self.v[0], read_u64(b, 0));
        self.v[1] = round(self.v[1], read_u64(b, 8));
        self.v[2] = round(self.v[2], read_u64(b, 16));
        self.v[3] = round(self.v[3], read_u64(b, 24));
    }

    /// Hashes `data` after everything written before.
    pub fn write(&mut self, mut data: &[u8]) {
        self.total = self.total.wrapping_add(data.len() as u64);
        if self.used > 0 {
            let take = (32 - self.used).min(data.len());
            self.buf[self.used..self.used + take].copy_from_slice(&data[..take]);
            self.used += take;
            data = &data[take..];
            if self.used < 32 {
                return;
            }
            let b = self.buf;
            self.stripe(&b);
            self.used = 0;
        }
        while data.len() >= 32 {
            self.stripe(&data[..32]);
            data = &data[32..];
        }
        self.buf[..data.len()].copy_from_slice(data);
        self.used = data.len();
    }

    pub fn u8(&mut self, v: u8) {
        self.write(&[v]);
    }

    pub fn u16(&mut self, v: u16) {
        self.write(&v.to_le_bytes());
    }

    pub fn u32(&mut self, v: u32) {
        self.write(&v.to_le_bytes());
    }

    pub fn u64(&mut self, v: u64) {
        self.write(&v.to_le_bytes());
    }

    /// The hash of everything written (the hasher can keep going).
    pub fn digest(&self) -> u64 {
        let h = if self.total >= 32 { converge(&self.v) } else { self.seed.wrapping_add(P5) };
        finish(h.wrapping_add(self.total), &self.buf[..self.used])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Outputs of the reference implementation (python-xxhash 3.5.0), as test/golden/model/xxh64.test.ts pins.
    const VECTORS: [(&str, u64); 5] = [
        ("", 0xef46_db37_51d8_e999),
        ("a", 0xd24e_c4f1_a98c_6e5b),
        ("abc", 0x44bc_2cf5_ad77_0999),
        ("message digest", 0x066e_d728_fcee_b3be),
        ("abcdefghijklmnopqrstuvwxyz", 0xcfe1_f278_fa89_835c),
    ];

    fn ramp(n: usize) -> Vec<u8> {
        (0..n).map(|i| (i & 0xff) as u8).collect()
    }

    #[test]
    fn matches_the_reference_vectors() {
        for (s, want) in VECTORS {
            assert_eq!(xxh64(s.as_bytes()), want, "{s:?}");
        }
        assert_eq!(xxh64(&ramp(768)), 0x8e03_c838_c596_036f, "768 bytes: every lane path");
        assert_eq!(xxh64_seeded(b"abc", 0x9e37_79b9_7f4a_7c15), 0x2ed0_f59d_6b43_ac8b, "a seed");
    }

    #[test]
    fn streaming_equals_one_shot_however_split() {
        let data = ramp(1000);
        for len in [0, 1, 3, 4, 7, 8, 31, 32, 33, 63, 64, 65, 100, 768, 1000] {
            let want = xxh64(&data[..len]);
            for step in [1, 2, 3, 5, 7, 8, 13, 31, 32, 33, 64, 1000] {
                let mut h = Xxh64::new();
                for c in data[..len].chunks(step) {
                    h.write(c);
                }
                assert_eq!(h.digest(), want, "len {len} in pieces of {step}");
            }
        }
        let mut h = Xxh64::with_seed(0x9e37_79b9_7f4a_7c15);
        h.write(b"a");
        h.write(b"bc");
        assert_eq!(h.digest(), 0x2ed0_f59d_6b43_ac8b);
    }

    #[test]
    fn typed_writes_are_little_endian() {
        let mut h = Xxh64::new();
        h.u32(1945);
        h.u32(0);
        let mut b = Vec::new();
        b.extend_from_slice(&1945u32.to_le_bytes());
        b.extend_from_slice(&0u32.to_le_bytes());
        assert_eq!(h.digest(), xxh64(&b));
        // r₀ of the golden start (seed 1945, §4.8 item 3): test/golden/m0/digests.txt's header.
        assert_eq!(h.digest(), 0x5f10_b3b0_1346_51d2);
    }
}
