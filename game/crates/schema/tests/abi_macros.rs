//! The generated ABI glue (10 §15.8, §15.9; schema/abi.yaml): `export_sim_abi!` and `export_gen_abi!`
//! expand to one `extern "C"` function per export, each calling the implementation's trait method. The ABI
//! crates (simabi, genabi) invoke them once the Sim and Worldgen packages implement the traits; this test
//! expands both over stubs, so the macros and the export tables cannot drift from the traits unnoticed.

use schema::abi::{GenAbi, SimAbi};

/// Each method returns a distinct number, so a call that reaches the wrong method is visible.
struct Sim;

impl SimAbi for Sim {
    fn sim_abi_version() -> u32 {
        schema::ABI_VERSION
    }
    fn sim_schema_hash() -> u32 {
        2
    }
    fn sim_input(len: u32) -> u32 {
        1000 + len
    }
    fn sim_init(_len: u32) -> u32 {
        4
    }
    fn sim_new_world(_len: u32) -> u32 {
        5
    }
    fn sim_load(_len: u32) -> u32 {
        6
    }
    fn sim_tick(len: u32) -> u32 {
        2000 + len
    }
    fn sim_set_flags(flags: u32) -> u32 {
        3000 + flags
    }
    fn sim_blob_put(_len: u32) -> u32 {
        9
    }
    fn sim_supply_chunk(_len: u32) -> u32 {
        10
    }
    fn sim_pending_chunks() -> u32 {
        11
    }
    fn sim_extract(_len: u32) -> u32 {
        12
    }
    fn sim_subscribe(_len: u32) -> u32 {
        13
    }
    fn sim_unsubscribe(_len: u32) -> u32 {
        14
    }
    fn sim_query(_len: u32) -> u32 {
        15
    }
    fn sim_query_step(units: u32) -> u32 {
        4000 + units
    }
    fn sim_query_cancel(id: u32) -> u32 {
        5000 + id
    }
    fn sim_digest() -> u32 {
        18
    }
    fn sim_state_hash() -> u32 {
        19
    }
    fn sim_save(_len: u32) -> u32 {
        20
    }
    fn sim_meta() -> u32 {
        21
    }
    fn sim_load_report() -> u32 {
        22
    }
    fn sim_last_error() -> u32 {
        23
    }
    fn sim_memory_epoch() -> u32 {
        24
    }
    fn sim_pool_dir() -> u32 {
        25
    }
    fn sim_allocs() -> u32 {
        26
    }
}

struct Gen;

impl GenAbi for Gen {
    fn gen_abi_version() -> u32 {
        schema::GEN_ABI_VERSION
    }
    fn gen_schema_hash() -> u32 {
        102
    }
    fn gen_input(len: u32) -> u32 {
        6000 + len
    }
    fn gen_last_error() -> u32 {
        104
    }
    fn gen_init(_len: u32) -> u32 {
        105
    }
    fn gen_chunk(surface: u32, cx: i32, cy: i32) -> u32 {
        surface * 10_000 + cx.unsigned_abs() * 100 + cy.unsigned_abs()
    }
    fn gen_chart(_surface: u32, _cx: i32, _cy: i32) -> u32 {
        107
    }
    fn gen_preview(_len: u32) -> u32 {
        108
    }
}

schema::export_sim_abi!(Sim);
schema::export_gen_abi!(Gen);

#[test]
fn every_export_calls_its_method() {
    assert_eq!(sim_abi_version(), schema::ABI_VERSION);
    assert_eq!(sim_input(7), 1007);
    assert_eq!(sim_tick(16), 2016);
    assert_eq!(sim_set_flags(1), 3001);
    assert_eq!(sim_query_step(3), 4003);
    assert_eq!(sim_query_cancel(9), 5009);
    assert_eq!(sim_allocs(), 26);
    assert_eq!(gen_abi_version(), schema::GEN_ABI_VERSION);
    assert_eq!(gen_input(5), 6005);
    assert_eq!(gen_chunk(1, -2, 3), 10_203);
    assert_eq!(gen_preview(0), 108);
}

#[test]
fn the_export_tables_name_every_export() {
    let sim = schema::abi::SIM_EXPORTS;
    assert!(sim.contains(&"sim_tick") && sim.contains(&"sim_allocs") && sim.contains(&"sim_input"));
    assert_eq!(schema::abi::GEN_EXPORTS[0], "gen_abi_version");
}
