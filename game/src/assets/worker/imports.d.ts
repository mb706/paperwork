// Vite's asset imports in the asset worker: `?raw` inlines a file's text, `?url` gives its (hashed) URL.
declare module '*?raw' {
  const text: string;
  export default text;
}
declare module '*?url' {
  const url: string;
  export default url;
}
