//! The simulation (10 §4–§5): the World and every system, saves, digests, extraction, projections and
//! queries. Only `World::tick(closure)` mutates the World (D1); everything else reads `&World`.
//!
//! M0's World arrives with the Sim work package, on the contracts of 10 §15 (C1b's schema).
#![forbid(unsafe_code)]
#![deny(clippy::wildcard_enum_match_arm)]

/// GENERATED from `game/schema/` by `scripts/schema-gen.ts`: the SoA pools and save sections.
pub mod r#gen;
