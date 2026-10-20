//! The rule scenarios (10 §10.8; M0 runs R23–R29) and M0's other scenarios, one test binary. Each scenario
//! runs through the scenario DSL (`sim::testkit::Scenario`), asserts its rule, and then
//! - **D18 (a, b, c)**: its recorded closures run again under NO_SLEEP, through a save and a load at a seeded
//!   tick and half way, and in heavy mode; the full canonical state after every tick (the first 2,000) and
//!   every d_t and r_t must equal the run as written ([`finish`]);
//! - **D18 (e)**: its run is a recorded session in `test/logs/` (closure log, start state, final hash); the
//!   `replay` module replays every log there to its digests and hash, and test/sim-wasm replays them in
//!   WebAssembly. `UPDATE_SCENARIO_LOGS=1` rewrites the logs; otherwise a scenario whose run no longer gives
//!   its log fails.
#![allow(clippy::disallowed_methods, clippy::disallowed_macros)] // fixtures are files; failures print

#[allow(dead_code)]
#[path = "../core/common.rs"]
mod common;
mod fuzz;
mod helpers;
mod m0;
mod r23_r27;
mod r28;
mod r29;
mod replay;
mod review_c2b;
