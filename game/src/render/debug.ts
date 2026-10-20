// F5's timings HUD (I §4.21 `show-fps`, `show-time-usage`; 10 §6.12): FPS and UPS, the main thread's milliseconds
// per frame by step, what was drawn, GPU memory by mode and format, and the asset pipeline's progress. A developer
// overlay (I §2.10 marks F4 and F5 "dev"), so its labels are not player-facing text.

import type { Renderer } from './renderer.ts';

interface LoaderLike {
  stats: {
    files: number;
    requested: number;
    delivered: number;
    bytes: number;
    retries: number;
    transcodeMs: number;
  };
}

let lastTick = 0;
let lastTime = 0;
let ups = 0;

export function debugHud(r: Renderer, loader: LoaderLike | null): string {
  const s = r.stats;
  const now = performance.now();
  const tick = r.mirror.tick;
  if (lastTime > 0 && now - lastTime >= 500) {
    ups = ((tick - lastTick) * 1000) / (now - lastTime);
    lastTick = tick;
    lastTime = now;
  } else if (lastTime === 0) {
    lastTick = tick;
    lastTime = now;
  }
  const m = r.memory();
  const f = (x: number) => x.toFixed(2).padStart(6);
  const lines = [
    `FPS ${s.fps.toFixed(1).padStart(5)}   UPS ${ups.toFixed(1).padStart(5)}   tick ${tick}`,
    `frame ${f(s.total)} ms  (pump ${f(s.pump)}  build ${f(s.build)}  upload ${f(s.upload)}  submit ${f(s.submit)})`,
    `sprites ${s.sprites}  belt items ${s.beltItems}  entities ${s.entities}  draws ${s.draws}  vertex ${s.uploadedKb.toFixed(0)} kB`,
    `chunks ${s.chunks} (terrain ${s.terrainChunks}, shores built ${s.shoresBuilt})  greyboxed ${s.greyboxed}`,
    `zoom ${r.camera.zoom.toFixed(2)}  dpr ${r.camera.dpr}  camera ${r.camera.cx.toFixed(2)}, ${r.camera.cy.toFixed(2)}`,
    `GPU ${m.totalMb.toFixed(1)} of ${m.budgetMb} MB (${m.mode}, ${m.colour}/${m.shadow}, layers ${m.layers})`,
    `  atlases ${m.atlasMb.toFixed(1)}  terrain ${m.terrainMb.toFixed(1)}  targets ${m.targetsMb.toFixed(1)}  buffers ${m.buffersMb.toFixed(1)}  other ${m.otherMb.toFixed(1)}`,
  ];
  if (loader) {
    const l = loader.stats;
    lines.push(
      `assets ${l.delivered}/${l.requested} files of ${l.files}, ${(l.bytes / 1048576).toFixed(2)} MB, transcode ${l.transcodeMs.toFixed(0)} ms, retries ${l.retries}`,
    );
  }
  return lines.join('\n');
}
