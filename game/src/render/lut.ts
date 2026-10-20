// The cyanotype LUT (10 §9.8, A3 §4.4), computed at start-up into a 32³ RGBA8 3D texture (128 kB): lum = Rec. 709
// luminance of the day colour; cyan = pale + (deep − pale) · clamp((lum − 0.12) ÷ 0.80, 0, 1); then
// cyan · 0.82 + day · (0.45, 0.55, 0.85) · 0.18, so belts and machines keep a trace of their coding.

import { CYANOTYPE_DEEP, CYANOTYPE_LUT_SIZE, CYANOTYPE_PALE, NIGHT } from './style.ts';

/** The cyanotype of one display-encoded colour (0–1), as the LUT stores it. */
export function cyanotype(r: number, g: number, b: number, out: Float64Array): Float64Array {
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const t = Math.min(1, Math.max(0, (lum - NIGHT.lumLow) / NIGHT.lumRange));
  for (let c = 0; c < 3; c++) {
    const pale = CYANOTYPE_PALE[c] as number;
    const deep = CYANOTYPE_DEEP[c] as number;
    const day = c === 0 ? r : c === 1 ? g : b;
    out[c] = (pale + (deep - pale) * t) * NIGHT.keep + day * (NIGHT.traceTint[c] as number) * NIGHT.trace;
  }
  return out;
}

/** The LUT's texels, r fastest (TEXTURE_3D layout: x = red, y = green, z = blue). */
export function cyanotypeLut(n = CYANOTYPE_LUT_SIZE): Uint8Array {
  const out = new Uint8Array(n * n * n * 4);
  const c = new Float64Array(3);
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        cyanotype(r / (n - 1), g / (n - 1), b / (n - 1), c);
        const o = ((b * n + g) * n + r) * 4;
        out[o] = Math.round((c[0] as number) * 255);
        out[o + 1] = Math.round((c[1] as number) * 255);
        out[o + 2] = Math.round((c[2] as number) * 255);
        out[o + 3] = 255;
      }
  return out;
}
