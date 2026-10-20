//! The sim's integration tests, one binary (each test binary links the crate again, and the `ntest` profile
//! links with fat LTO, so one binary keeps `npm test` fast):
//! - `golden_core`: the parts of the frozen M0 golden set that need no systems (C2a);
//! - `golden_rules`: the golden set's ticks: every digest, preimage and state of the closure log (C2b);
//! - `world_core`: the entity lifecycle under churn, generations, spatial queries;
//! - `harness`: the D18 harness (NO_SLEEP, reloads, heavy mode) and its divergence reports;
//! - `sched_equivalence`: the scheduler's NO_SLEEP and reload equivalence on a toy factory;
//! - `alloc_free`: the steady-state tick allocates nothing (§2.5);
//! - `scale`: an ignored timing probe.
#![allow(clippy::disallowed_methods, clippy::disallowed_macros)] // tests read fixtures; the probe prints

mod alloc_free;
mod bench_scenarios;
mod boundary;
#[allow(dead_code)]
mod common;
mod golden_boundary;
mod golden_core;
mod golden_rules;
mod harness;
mod review_c2a;
mod review_c2b;
mod review_c2c;
mod scale;
mod sched_equivalence;
mod world_core;
