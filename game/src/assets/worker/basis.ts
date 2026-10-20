// The Basis Universal 2.50 transcoder (10 §9.2: `basis_transcoder.wasm`, Apache-2.0, pinned with the encoder
// `basisu` 2.50 that made the atlases; vendored from ~/.local/opt/basisu-2.50/webgl/transcoder, licence beside it).
// Its glue is a classic Emscripten script, not a module, so the worker inlines its text and evaluates it once; the
// WebAssembly is a hashed asset that streams in. It initialises in about 180 ms here, in parallel with loading.
//   basis_transcoder.js    sha256 720dd9bd09c7cada6d87f1b7b70cec713df04da88cd641ac3212559353834dc8
//   basis_transcoder.wasm  sha256 a0f65d4a30ecb3269d01ead7d0a3477d2b0208146d083625a90623f473f6c139
// The stock build carries every codec (1,061 kB, 361 kB brotli); a trimmed build is the asset pipeline's follow-up.

import glue from './basis/basis_transcoder.js?raw';
import wasmUrl from './basis/basis_transcoder.wasm?url';
import type { BasisModule } from './transcode.ts';

type BasisFactory = (args: { locateFile: (path: string) => string }) => Promise<BasisModule>;

let pending: Promise<BasisModule> | null = null;

/** The transcoder, initialised once per worker. */
export function loadBasis(): Promise<BasisModule> {
  pending ??= (async () => {
    // the Emscripten glue is a classic script: evaluated once, from the worker's own bundle
    const factory = new Function(`${glue}\nreturn BASIS;`)() as BasisFactory;
    const url = new URL(wasmUrl, self.location.href).href;
    const m = await factory({ locateFile: () => url });
    m.initializeBasis();
    return m;
  })();
  return pending;
}

export const TRANSCODER = 'basis_transcoder 2.50 (stock)';
