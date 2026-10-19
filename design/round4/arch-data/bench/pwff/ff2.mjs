import { firefox, chromium } from '/home/mewse/.local/lib/node_modules/playwright/index.mjs';
const probe = () => { const xs=[]; for (let i=1;i<=2000;i++){ const x=i*0.7311+1e-3*i*i; xs.push(Math.sin(x), Math.cos(x), Math.exp(x/300), Math.log(x), Math.pow(x, 0.37), Math.atan2(x, 3.1), Math.tanh(x/50), Math.cbrt(x)); }
  const gl = document.createElement('canvas').getContext('webgl2'); return { webgl2: !!gl, renderer: gl ? gl.getParameter(gl.RENDERER) : null, xs }; };
const ff = await firefox.launch({ firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false, 'webgl.enable-webgl2': true } });
const pf = await ff.newPage(); const rf = await pf.evaluate(probe); await ff.close();
const ch = await chromium.launch({ executablePath: '/home/mewse/.local/opt/chrome-current/chrome' });
const pc = await ch.newPage(); const rc = await pc.evaluate(probe); await ch.close();
let diff = 0; const fns=['sin','cos','exp','log','pow','atan2','tanh','cbrt']; const perFn = {};
for (let i=0;i<rf.xs.length;i++) if (rf.xs[i] !== rc.xs[i]) { diff++; const f=fns[i%8]; perFn[f]=(perFn[f]||0)+1; }
console.log(JSON.stringify({ firefoxWebGL2: rf.webgl2, firefoxRenderer: rf.renderer, chromeWebGL2: rc.webgl2, samples: rf.xs.length, differing: diff, perFn }));
