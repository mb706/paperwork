//! Pure chunk generation (10 §5.18): terrain, water, ore spots, climate and towns, as functions of the
//! seed, the map settings and the prototypes. No World access and no I/O; the sim links it for inline
//! commits and `genabi` builds it into `gen.wasm` for the worldgen pool (D12).
//!
//! M0's worldgen v0 (terrain, water, ore spots; no towns) arrives with the Sim work package.
#![forbid(unsafe_code)]
