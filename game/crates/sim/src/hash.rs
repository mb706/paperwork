//! XXH64 (10 §4.8), from `det` (shared with `worldgen`'s world hash): [`xxh64`] for a byte slice and
//! [`Xxh64`], a streaming hasher that gives the same value however the bytes are split.

pub use det::xxh64::{Xxh64, xxh64, xxh64_seeded};
