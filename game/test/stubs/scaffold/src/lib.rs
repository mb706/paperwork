//! The M0 scaffold's `sim.wasm` and `gen.wasm` as a stale cache would still serve them (C3's test fixture):
//! `sim_abi_version` and `gen_abi_version` answer 0, and the module imports nothing. Since the real modules
//! export the full ABI by default, the shell's handshake test needs this to see a scaffold refused as such
//! (10 §15.1: reason `scaffold`).

/// The scaffold sim.wasm's one export.
#[unsafe(no_mangle)]
pub extern "C" fn sim_abi_version() -> u32 {
    0
}

/// The scaffold gen.wasm's one export.
#[unsafe(no_mangle)]
pub extern "C" fn gen_abi_version() -> u32 {
    0
}
