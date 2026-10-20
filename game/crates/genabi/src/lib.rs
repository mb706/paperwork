//! `gen.wasm`: the worldgen workers' ABI over the `worldgen` crate (10 §15.9). Generated from
//! `schema/abi.yaml` (C1b); until then the module only reports its ABI version.

/// The worldgen ABI version (10 §15.9). 0 = the M0 scaffold.
pub const ABI_VERSION: u32 = 0;

#[unsafe(no_mangle)]
pub extern "C" fn gen_abi_version() -> u32 {
    ABI_VERSION
}
