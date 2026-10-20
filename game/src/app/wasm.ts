// Compiling the WebAssembly modules (10 §2.3, §9.7): the main thread compiles each module once per page with
// `compileStreaming(fetch(url))`, which compiles while the bytes arrive, and posts the WebAssembly.Module to every
// fresh worker (modules are structured-cloneable, not transferable). `compileStreaming` rejects a response whose
// type is not `application/wasm`; on that TypeError the loader falls back to `compile(arrayBuffer)` and logs the
// misconfigured host once (codex B2-r1 finding 12).

let warned = false;

export async function compileModule(
  url: string,
  warn: (msg: string) => void = console.warn,
): Promise<WebAssembly.Module> {
  try {
    return await WebAssembly.compileStreaming(fetch(url));
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
    if (!warned) {
      warned = true;
      warn(
        `${url} is not served as application/wasm: compiling from its bytes (configure the host's MIME types)`,
      );
    }
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return WebAssembly.compile(await r.arrayBuffer());
  }
}
