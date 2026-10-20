// M0 scaffold of the sim worker's module loader: instantiate the compiled sim.wasm and read its ABI
// version (10 §15.8: `sim_abi_version() -> u32`, a plain value). The Shell work package replaces this
// with the real loader, the schema handshake and MemoryLease.

export async function instantiateScaffold(module: WebAssembly.Module): Promise<number> {
  const instance = await WebAssembly.instantiate(module, { env: {} });
  const version = instance.exports.sim_abi_version;
  if (typeof version !== 'function') throw new Error('sim.wasm exports no sim_abi_version');
  return (version() as number) >>> 0;
}
