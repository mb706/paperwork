import { firefox } from '/home/mewse/.local/lib/node_modules/playwright/index.mjs';
try {
  const b = await firefox.launch();
  const p = await b.newPage();
  const r = await p.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); return { ua: navigator.userAgent, webgl2: !!gl, renderer: gl ? gl.getParameter(gl.RENDERER) : null, sin: Math.sin(1e10), exp: Math.exp(0.1), pow: Math.pow(1.5, 0.3) }; });
  console.log(JSON.stringify(r));
  await b.close();
} catch (e) { console.log('FIREFOX LAUNCH FAILED:', String(e).split('\n').slice(0,6).join(' | ')); }
