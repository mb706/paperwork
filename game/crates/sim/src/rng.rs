//! Randomness (10 §4.3, B1-r1 18): pinned primitives, counter-based draws and the world's saved streams.
//!
//! - **Counter-based** draws, [`rand`]`(seed, a, b, c, d)`, for every per-event draw: the result depends only on
//!   its keys, never on update order or sleeping (§4.1 rule 6). `d` is the draw's `RngPurpose`.
//! - **Streams**: xoshiro128** whose four state words are four successive splitmix32 outputs started from
//!   `rand(seed, stream, 0, 0, 0xFFFFFFFF)`. The world's streams are saved in the `RNG` section (§8.1) and enter
//!   the per-tick digest in `RngStream` order (§4.8). M0 uses none; they exist for the systems that need a
//!   sequence (Wild, M5).
//!
//! All arithmetic is on `u32`, wrapping. Golden vectors from an independent implementation:
//! test/rng/vectors.py → test/rng/vectors.txt (the unit tests below).

use crate::r#gen::RngState;
use schema::{RngPurpose, RngStream};

/// Murmur3's finalizer (§4.3).
#[inline]
pub const fn fmix32(mut h: u32) -> u32 {
    h ^= h >> 16;
    h = h.wrapping_mul(0x85EB_CA6B);
    h ^= h >> 13;
    h = h.wrapping_mul(0xC2B2_AE35);
    h ^= h >> 16;
    h
}

/// The counter-based draw (§4.3): `h = fmix32(seed ^ 0x2545F491)`, then each key folded in with its own salt,
/// so permuted keys give different draws.
#[inline]
pub const fn rand(seed: u32, a: u32, b: u32, c: u32, d: u32) -> u32 {
    let mut h = fmix32(seed ^ 0x2545_F491);
    h = fmix32(h ^ a);
    h = fmix32(h.wrapping_add(0x9E37_79B9) ^ b);
    h = fmix32(h.wrapping_add(0x7F4A_7C15) ^ c);
    fmix32(h.wrapping_add(0x94D0_49BB) ^ d)
}

/// A draw as a probability in [0, 1): `h × 2⁻³²` (§4.3), exact in an f64.
#[inline]
pub fn unit(h: u32) -> f64 {
    f64::from(h) * (1.0 / 4_294_967_296.0)
}

/// `rand(seed, a, b, c, purpose)` with a typed purpose (§4.3: the fourth key is the `RngPurpose`).
#[inline]
pub fn draw(seed: u32, a: u32, b: u32, c: u32, purpose: RngPurpose) -> u32 {
    rand(seed, a, b, c, purpose.value())
}

/// One splitmix32 step (§4.3): advances `state` and returns the output.
#[inline]
pub fn splitmix32(state: &mut u32) -> u32 {
    *state = state.wrapping_add(0x9E37_79B9);
    let mut z = *state;
    z = (z ^ (z >> 16)).wrapping_mul(0x85EB_CA6B);
    z = (z ^ (z >> 13)).wrapping_mul(0xC2B2_AE35);
    z ^ (z >> 16)
}

/// xoshiro128** as published by Blackman and Vigna (§4.3).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Xoshiro128 {
    pub s: [u32; 4],
}

impl Xoshiro128 {
    /// The stream `stream` of the world seed `seed`: four successive splitmix32 outputs started from
    /// `rand(seed, stream, 0, 0, 0xFFFFFFFF)` (the purpose 0xFFFFFFFF is reserved for seeding).
    pub fn seeded(seed: u32, stream: u32) -> Self {
        let mut st = rand(seed, stream, 0, 0, RngPurpose::Seeding.value());
        let s = [splitmix32(&mut st), splitmix32(&mut st), splitmix32(&mut st), splitmix32(&mut st)];
        Self { s }
    }

    /// The next output.
    #[inline]
    pub fn next_u32(&mut self) -> u32 {
        let s = &mut self.s;
        let result = s[1].wrapping_mul(5).rotate_left(7).wrapping_mul(9);
        let t = s[1] << 9;
        s[2] ^= s[0];
        s[3] ^= s[1];
        s[1] ^= s[2];
        s[0] ^= s[3];
        s[2] ^= t;
        s[3] = s[3].rotate_left(11);
        result
    }
}

/// The world's streams (the `RNG` section, §8.1): ascending by `RngStream`, each created the first time a rule
/// uses it. Saved and hashed; the per-tick digest hashes every stream's four words in this order (§4.8).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct RngStreams {
    streams: Vec<RngState>,
}

impl RngStreams {
    /// From the `RNG` section's records, which the decoder has checked are strictly ascending.
    pub fn from_records(streams: Vec<RngState>) -> Self {
        Self { streams }
    }

    /// The records in their saved order.
    pub fn records(&self) -> &[RngState] {
        &self.streams
    }

    pub fn is_empty(&self) -> bool {
        self.streams.is_empty()
    }

    /// The next output of `stream`, seeding it from `seed` on first use.
    pub fn next(&mut self, seed: u32, stream: RngStream) -> u32 {
        let i = match self.streams.binary_search_by(|x| x.stream.cmp(&stream)) {
            Ok(i) => i,
            Err(i) => {
                let s = Xoshiro128::seeded(seed, u32::from(stream.value())).s;
                self.streams.insert(i, RngState { stream, state: s });
                i
            }
        };
        let mut x = Xoshiro128 { s: self.streams[i].state };
        let out = x.next_u32();
        self.streams[i].state = x.s;
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VECTORS: &str = include_str!("../../../test/rng/vectors.txt");

    fn hex(s: &str) -> u32 {
        u32::from_str_radix(s, 16).expect("hexadecimal")
    }

    #[test]
    fn primitives_match_the_independent_vectors() {
        let mut counts = [0usize; 5];
        for line in VECTORS.lines().filter(|l| !l.starts_with('#') && !l.trim().is_empty()) {
            let f: Vec<&str> = line.split_whitespace().collect();
            match f[0] {
                "fmix32" => {
                    assert_eq!(fmix32(hex(f[1])), hex(f[2]), "{line}");
                    counts[0] += 1;
                }
                "rand" => {
                    let v: Vec<u32> = f[1..].iter().map(|x| hex(x)).collect();
                    assert_eq!(rand(v[0], v[1], v[2], v[3], v[4]), v[5], "{line}");
                    counts[1] += 1;
                }
                "splitmix32" => {
                    let mut s = hex(f[1]);
                    let out = splitmix32(&mut s);
                    assert_eq!((s, out), (hex(f[2]), hex(f[3])), "{line}");
                    counts[2] += 1;
                }
                "stream" => {
                    let x = Xoshiro128::seeded(hex(f[1]), hex(f[2]));
                    let want: Vec<u32> = f[3..].iter().map(|x| hex(x)).collect();
                    assert_eq!(x.s.to_vec(), want, "{line}");
                    counts[3] += 1;
                }
                "next" => {
                    let mut x = Xoshiro128::seeded(hex(f[1]), hex(f[2]));
                    let got: Vec<u32> = (0..16).map(|_| x.next_u32()).collect();
                    let want: Vec<u32> = f[3..].iter().map(|x| hex(x)).collect();
                    assert_eq!(got, want, "{line}");
                    counts[4] += 1;
                }
                other => panic!("unknown vector kind {other}"),
            }
        }
        // §4.3: golden vectors for each primitive, and 16 outputs of two streams for seeds 0, 1 and 0xDEADBEEF.
        assert!(counts[0] >= 8 && counts[1] >= 27 && counts[2] >= 5, "{counts:?}");
        assert_eq!((counts[3], counts[4]), (6, 6));
    }

    #[test]
    fn permuted_keys_draw_differently() {
        assert_ne!(rand(7, 1, 2, 3, 4), rand(7, 2, 1, 3, 4));
        assert_ne!(rand(7, 1, 2, 3, 4), rand(7, 1, 2, 4, 3));
        assert_ne!(rand(7, 1, 2, 3, 4), rand(8, 1, 2, 3, 4));
        assert_eq!(draw(7, 1, 2, 3, RngPurpose::Quality), rand(7, 1, 2, 3, 1));
    }

    #[test]
    fn unit_is_exact_and_below_one() {
        assert_eq!(unit(0), 0.0);
        assert_eq!(unit(1 << 31), 0.5);
        assert!(unit(u32::MAX) < 1.0);
        assert_eq!(unit(u32::MAX), f64::from(u32::MAX) / 4_294_967_296.0);
    }

    #[test]
    fn streams_are_created_in_order_and_continue() {
        let mut w = RngStreams::default();
        let a0 = w.next(1945, RngStream::Ambient);
        let r0 = w.next(1945, RngStream::WorldgenRegions);
        let a1 = w.next(1945, RngStream::Ambient);
        let kinds: Vec<RngStream> = w.records().iter().map(|x| x.stream).collect();
        assert_eq!(kinds, vec![RngStream::WorldgenRegions, RngStream::Ambient], "ascending by stream id");
        let mut x = Xoshiro128::seeded(1945, u32::from(RngStream::Ambient.value()));
        assert_eq!((a0, a1), (x.next_u32(), x.next_u32()));
        let mut y = Xoshiro128::seeded(1945, u32::from(RngStream::WorldgenRegions.value()));
        assert_eq!(r0, y.next_u32());
    }
}
