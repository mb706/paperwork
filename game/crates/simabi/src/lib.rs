//! `sim.wasm`: the C ABI of 10 §15.8 over the `sim` crate, and the panic hook. The exports and their
//! records are generated from `schema/abi.yaml` (C1b); until then the module only reports its ABI
//! version, so the build, the feature gate and the loader can be exercised end to end.

/// The ABI version (10 §15.8), bumped on any change to the export table. 0 = the M0 scaffold, which
/// exports nothing else.
pub const ABI_VERSION: u32 = 0;

#[unsafe(no_mangle)]
pub extern "C" fn sim_abi_version() -> u32 {
    ABI_VERSION
}
