//! The simulation (10 §4–§5): the World and every system, saves, digests, extraction, projections and
//! queries. Only `World::tick(closure)` and loading mutate a World (D1); everything else reads `&World`.
//!
//! Layout (C2a, the core):
//! - [`world`]: the World, its entity lifecycle and derived indexes (§4.4–§4.5); [`chunks`], [`spatial`]
//!   (box and tile queries), [`heap`] (the slot heap), [`players`], [`handle`] (handles and the serial
//!   index), [`rng`] (§4.3), [`sched`] (§4.6);
//! - [`save`]: the save sections, `sim_save`/`sim_load`'s formats, the full state hash (§4.8, §8.1–§8.3) and
//!   [`remap`] (§8.3); [`digest`]: d_t, the slices and the rolling digest r (§4.8);
//! - [`tick`]: `World::tick`'s phases (§4.6); [`context`]: the module's state behind the ABI (§3.6, §15.8);
//! - [`testkit`]: the equivalence harness of D18 (NO_SLEEP, save/load, heavy mode) and state diffs;
//! - [`hash`] (XXH64) and [`sha256`].
#![forbid(unsafe_code)]
#![deny(clippy::wildcard_enum_match_arm)]

pub mod chunks;
pub mod context;
pub mod digest;
/// GENERATED from `game/schema/` by `scripts/schema-gen.ts`: the SoA pools and save sections.
pub mod r#gen;
pub mod handle;
pub mod hash;
pub mod heap;
pub mod players;
pub mod presentation;
pub mod remap;
pub mod rng;
pub mod save;
pub mod sched;
pub mod sha256;
pub mod spatial;
pub mod testkit;
pub mod tick;
pub mod world;

pub use context::{SimContext, SimMetaOut};
pub use schema::SimStatus;
pub use world::World;

/// A refused call: the ABI status (§15.8) and a message for `sim_last_error`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SimError {
    pub status: SimStatus,
    pub message: String,
}

impl SimError {
    pub fn new(status: SimStatus, message: impl Into<String>) -> Self {
        Self { status, message: message.into() }
    }
}

impl core::fmt::Display for SimError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{}: {}", self.status.name(), self.message)
    }
}

/// `Result` with a [`SimError`].
pub type SimResult<T> = Result<T, SimError>;
