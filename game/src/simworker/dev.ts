// Dev-build conventions between the shell and sim.wasm.

/**
 * The dev-only panic (10 §12 M0 exit: "a dev-only panic shows the trap notice, reloads the last autosave and
 * leaves a bundle that reproduces the panic natively"): `__game` asks the shell (`dev {op: 'panic'}`), and the
 * LocalSequencer puts `debug_dump` with this id into the next tick's closure. A `simcheck` build of sim.wasm
 * panics on it inside `sim_tick`; release builds treat it as any `debug_dump` (nothing in the World, §15.3).
 * Because the request travels in the closure, the bundle's closure log replays it: `simtool replay` reproduces
 * the panic at the same tick. C3's proposal to the sim package; the stub module (test/stubs) implements it.
 */
export const DEV_PANIC_DUMP_ID = 0xffffffff;
