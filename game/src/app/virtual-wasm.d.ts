// The cargo plugin's virtual modules (scripts/cargo-plugin.ts): the URL of each WebAssembly module, the
// wasmdev build in the dev server and the content-hashed release module in a build.
declare module 'virtual:sim-wasm' {
  const url: string;
  export default url;
}
declare module 'virtual:gen-wasm' {
  const url: string;
  export default url;
}
