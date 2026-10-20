// What the placeholder page says about sim.wasm (src/app/app.ts `placeholder`): a module of this build's ABI
// gets a world (the real modules export the full ABI by default since C3-r1; the scaffold is refused).
import { ABI_VERSION } from '../src/shared/gen/schema.ts';

export const SIM_STATUS = new RegExp(`^sim\\.wasm ABI ${ABI_VERSION}, world bound at tick 0$`);
