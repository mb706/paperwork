// What the placeholder page says about sim.wasm (src/app/main.ts): the handshake refuses the M0 scaffold module
// (ABI 0), and a module of this build's ABI gets a world.
import { ABI_VERSION } from '../src/shared/gen/schema.ts';

export const SIM_STATUS = new RegExp(`^sim\\.wasm ABI (0, refused|${ABI_VERSION}, world bound)`);
