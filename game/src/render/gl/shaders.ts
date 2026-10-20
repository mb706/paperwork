// GLSL ES 3.00 sources of the frame's passes (10 §6.2, §9.8, §9.9). The style's numbers arrive as uniforms
// (style.ts), so a style is a table, not shader edits. Conventions: sprite positions are device px from the canvas
// centre; `uOrigin` is that centre (whole pixels); targets are sampled with GL's bottom-left origin throughout.

/** Layers a sprite array may have; uMinLod holds one value per layer (10 §9.7: the level-0 clamp). */
export const MAX_LAYERS = 64;

const HEADER = `#version 300 es
precision highp float;
precision highp int;
`;

/** The batcher's vertex: pos 2×f32, uv 2×u16 (normalised), layer + flags 2×u16, tint RGBA8 (10 §6.3). */
export const SPRITE_VS = `${HEADER}
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aUv;
layout(location = 2) in uvec2 aLayerFlags;
layout(location = 3) in vec4 aTint;
uniform vec2 uOrigin;
uniform vec2 uTarget;
uniform float uTargetScale;
uniform float uMinLod[${MAX_LAYERS}];
out vec3 vUv;
out vec4 vTint;
flat out float vMinLod;
void main() {
  vec2 p = (aPos + uOrigin) * uTargetScale;
  gl_Position = vec4(p.x / uTarget.x * 2.0 - 1.0, 1.0 - p.y / uTarget.y * 2.0, 0.0, 1.0);
  uint layer = min(aLayerFlags.x, ${MAX_LAYERS - 1}u);
  vUv = vec3(aUv, float(aLayerFlags.x));
  vTint = aTint;
  vMinLod = uMinLod[layer];
}
`;

/**
 * The level of detail from the screen-space derivatives in level-0 texels, clamped from below by the layer's
 * uMinLod (a page whose High level 0 has not arrived samples its Normal levels, 10 §9.7), then shifted by the
 * mode's dropped levels (Normal and Low allocate without them, §6.13).
 */
const LOD = `
uniform float uPageSize;
uniform float uLevelOffset;
float spriteLod(vec2 uv) {
  vec2 t = uv * uPageSize;
  vec2 dx = dFdx(t);
  vec2 dy = dFdy(t);
  float lod = 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1e-8));
  return max(max(lod, vMinLod) - uLevelOffset, 0.0);
}
`;

/** Colour and icon pages: premultiplied, display-encoded values (blend ONE, ONE_MINUS_SRC_ALPHA). */
export const SPRITE_FS = `${HEADER}
precision mediump sampler2DArray;
uniform sampler2DArray uTex;
in vec3 vUv;
in vec4 vTint;
flat in float vMinLod;
out vec4 oColour;
${LOD}
void main() {
  vec4 c = textureLod(uTex, vUv, spriteLod(vUv.xy));
  oColour = c * vTint;
}
`;

/** Shadow masks into the R8 target, MAX-blended so overlaps never double-darken (10 §6.2 step 3). */
export const SHADOW_FS = `${HEADER}
precision mediump sampler2DArray;
uniform sampler2DArray uTex;
in vec3 vUv;
in vec4 vTint;
flat in float vMinLod;
out vec4 oColour;
${LOD}
void main() {
  float m = textureLod(uTex, vUv, spriteLod(vUv.xy)).r * vTint.a;
  oColour = vec4(m, 0.0, 0.0, 0.0);
}
`;

/** Glow sprites added into the light target, scaled by DYN.light (the tint), 10 §9.8. */
export const LIGHT_FS = SPRITE_FS;

/** Solid quads (debug overlays): the tint is the premultiplied colour. */
export const SOLID_FS = `${HEADER}
in vec3 vUv;
in vec4 vTint;
flat in float vMinLod;
out vec4 oColour;
void main() {
  oColour = vTint;
}
`;

/** A full-screen triangle from gl_VertexID; no attributes. */
export const FULLSCREEN_VS = `${HEADER}
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * SHADOW_COMPOSITE (10 §9.8): world-anchored hatching at −45° through the shadow mask, plus a darkening, written
 * as a premultiplied "over" (blend ONE, ONE_MINUS_SRC_ALPHA) so it needs no read of the scene:
 *   colour' = (colour (1 − ink h) + inkColour ink h)(1 − darken m).
 * uPhase is fract((cx − cy) · √½ ÷ period), computed in f64, so the lines never swim and stay precise anywhere.
 */
export const HATCH_FS = `${HEADER}
precision highp sampler2D;
uniform sampler2D uShadow;
uniform vec2 uHalfScale;
uniform vec2 uSize;
uniform vec2 uOrigin;
uniform float uS;
uniform float uPhase;
uniform float uPeriod;
uniform float uWidth;
uniform float uInk;
uniform float uDarken;
uniform float uGain;
uniform vec3 uInkColour;
out vec4 oColour;
void main() {
  vec2 fc = gl_FragCoord.xy;
  float m = clamp(texture(uShadow, fc * uHalfScale).r * uGain, 0.0, 1.0);
  if (m <= 0.0) discard;
  vec2 px = vec2(fc.x, uSize.y - fc.y);
  vec2 d = (px - uOrigin) / uS;
  float u = uPhase + (d.x - d.y) * 0.70710678 / uPeriod;
  float dist = (0.5 - abs(fract(u) - 0.5)) * uPeriod;
  float aa = 0.75 / uS;
  float line = 1.0 - smoothstep(0.5 * uWidth - aa, 0.5 * uWidth + aa, dist);
  float h = mix(uWidth / uPeriod, line, smoothstep(2.0, 3.0, uPeriod * uS)) * m;
  float dark = 1.0 - uDarken * m;
  oColour = vec4(uInkColour * (uInk * h * dark), 1.0 - (1.0 - uInk * h) * dark);
}
`;

/**
 * The one full-screen pass of 10 §6.2 step 7 (§9.8): by day the warm stain, at night the cyanotype LUT with the
 * light's reveal, blended by the night strength n. The only place the night grade is applied.
 */
export const GRADE_FS = `${HEADER}
precision highp sampler2D;
precision highp sampler3D;
uniform sampler2D uScene;
uniform sampler2D uLight;
uniform sampler3D uLut;
uniform vec2 uHalfScale;
uniform float uNight;
uniform float uStain;
uniform float uReveal;
uniform float uLightAdd;
uniform float uLutSize;
out vec4 oColour;
void main() {
  vec2 fc = gl_FragCoord.xy;
  vec3 colour = texelFetch(uScene, ivec2(fc), 0).rgb;
  vec3 L = max(texture(uLight, fc * uHalfScale).rgb, vec3(0.0));
  float a = clamp(max(L.r, max(L.g, L.b)), 0.0, 1.0);
  vec3 hue = L / max(a, 1e-4);
  vec3 day = colour * (1.0 - uStain * a * (1.0 - min(hue, vec3(1.0))));
  if (uNight <= 0.0) {
    oColour = vec4(day, 1.0);
    return;
  }
  vec3 cyan = texture(uLut, colour * ((uLutSize - 1.0) / uLutSize) + 0.5 / uLutSize).rgb;
  float reveal = clamp(a * uReveal, 0.0, 1.0);
  vec3 night = mix(cyan, colour, reveal);
  night = 1.0 - (1.0 - night) * (1.0 - clamp(L * uLightAdd, 0.0, 1.0));
  oColour = vec4(mix(day, night, uNight), 1.0);
}
`;

/** Terrain: one quad per chunk (10 §6.5): pos, chunk-local tile coordinates, the chunk, its data layers. */
export const TERRAIN_VS = `${HEADER}
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aLocal;
layout(location = 2) in ivec2 aChunk;
layout(location = 3) in ivec2 aLayers;
uniform vec2 uOrigin;
uniform vec2 uTarget;
out vec2 vLocal;
flat out ivec2 vChunk;
flat out ivec2 vLayers;
void main() {
  vec2 p = aPos + uOrigin;
  gl_Position = vec4(p.x / uTarget.x * 2.0 - 1.0, 1.0 - p.y / uTarget.y * 2.0, 0.0, 1.0);
  vLocal = aLocal;
  vChunk = aChunk;
  vLayers = aLayers;
}
`;

/**
 * Terrain (10 §6.5, §9.9): every pixel takes the strongest tile type of a 0.55-tile blend of the tile masks, looked up
 * at a position warped by world-anchored value noise (0.32 tile on 1.6-tile cells, lattice values from §15.7's
 * position hash); crisp types skip the warp and get an inked kerb. Where the chunk has a shore texture, its signed
 * distance decides water against land, so the shoreline and the lining (lines at fixed distances, one device pixel
 * wide, fading with distance and below 0.5×) follow the same edge as the materials. The woodland tint washes under
 * tree clusters. Tile types without a material draw a wash of a near material, or a flat colour.
 */
export const TERRAIN_FS = `${HEADER}
precision highp usampler2DArray;
precision mediump sampler2DArray;
precision highp sampler2D;
uniform usampler2DArray uIds;
uniform sampler2DArray uSdf;
uniform sampler2DArray uMats;
uniform sampler2D uTiles;
uniform float uS;
uniform float uMatTiles;
uniform float uWarp;
uniform float uWarpCell;
uniform vec3 uKerb;
uniform float uKerbAlpha;
uniform vec3 uLiningInk;
uniform float uLiningAlpha;
uniform float uLining[8];
uniform float uLiningFade;
uniform vec3 uShore;
uniform float uShoreAlpha;
uniform float uShorePx;
uniform vec3 uWoodland;
uniform float uWoodlandAlpha;
in vec2 vLocal;
flat in ivec2 vChunk;
flat in ivec2 vLayers;
out vec4 oColour;

const int B = 3;           // the tile-id texture's border, tiles
const float G0 = 0.72329;  // the 0.55-tile Gaussian over the tile lattice: centre, neighbours
const float G1 = 0.13835;

uint idAt(ivec2 t) {
  ivec2 c = clamp(t + B, ivec2(0), ivec2(31 + 2 * B));
  return texelFetch(uIds, ivec3(c, vLayers.x), 0).r;
}
vec4 info(uint id) {
  return texelFetch(uTiles, ivec2(int(id), 0), 0);
}
int flagsOf(uint id) {
  return int(info(id).a) >> 8;
}
bool crisp(uint id) { return (flagsOf(id) & 1) != 0; }
bool water(uint id) { return (flagsOf(id) & 2) != 0; }

uint posHash(int x, int y) {
  uint h = (uint(x) * 0x27d4eb2du) ^ (uint(y) * 0x165667b1u);
  h ^= h >> 15u;
  h *= 0x85ebca77u;
  h ^= h >> 13u;
  return h;
}
vec2 lattice(ivec2 p) {
  uint h = posHash(p.x, p.y);
  return vec2(float(h & 0xffffu), float(h >> 16u)) / 65535.0 - 0.5;
}
vec2 warpAt(vec2 local) {
  vec2 g = local / uWarpCell;
  vec2 gf = fract(g);
  ivec2 base = vChunk * 20 + ivec2(floor(g));
  vec2 s = gf * gf * (3.0 - 2.0 * gf);
  vec2 a = mix(lattice(base), lattice(base + ivec2(1, 0)), s.x);
  vec2 b = mix(lattice(base + ivec2(0, 1)), lattice(base + ivec2(1, 1)), s.x);
  return mix(a, b, s.y) * (2.0 * uWarp);
}
float w4(int a, float f) {
  if (a == -1) return (1.0 - f) * G1;
  if (a == 0) return (1.0 - f) * G0 + f * G1;
  if (a == 1) return (1.0 - f) * G1 + f * G0;
  return f * G1;
}

void main() {
  vec2 local = vLocal;
  ivec2 cell = ivec2(floor(local));
  uint here = idAt(cell);
  uint type = here;
  bool isCrisp = crisp(here);
  vec2 p = local;
  // the shore distance (tiles, negative in water) and the woodland, when the chunk has them
  float sd = 1e3;
  float wood = 0.0;
  if (!isCrisp) {
    p = local + warpAt(local);
    vec2 q = p - 0.5;
    ivec2 i0 = ivec2(floor(q));
    vec2 f = q - floor(q);
    uint c0 = idAt(i0);
    uint c1 = idAt(i0 + ivec2(1, 0));
    uint c2 = idAt(i0 + ivec2(0, 1));
    uint c3 = idAt(i0 + ivec2(1, 1));
    if (vLayers.y >= 0) {
      vec2 st = (p + float(B)) * 4.0 / float(4 * (32 + 2 * B));
      vec2 s = texture(uSdf, vec3(st, float(vLayers.y))).rg;
      sd = (s.r * 255.0 - 128.0) / 32.0;
      wood = s.g;
    }
    bool wantWater = vLayers.y >= 0 && sd < 0.0;
    bool same = c0 == c1 && c1 == c2 && c2 == c3 && !crisp(c0);
    if (same && (vLayers.y < 0 || water(c0) == wantWater)) {
      type = c0;
    } else {
      uint cand[4] = uint[4](c0, c1, c2, c3);
      float best = -1.0;
      float bestAny = -1.0;
      uint pick = here;
      uint pickAny = here;
      for (int k = 0; k < 4; k++) {
        uint c = cand[k];
        if (crisp(c)) continue;
        float m = 0.0;
        for (int b = -1; b <= 2; b++) {
          float wy = w4(b, f.y);
          for (int a = -1; a <= 2; a++)
            if (idAt(i0 + ivec2(a, b)) == c) m += w4(a, f.x) * wy;
        }
        if (m > bestAny) { bestAny = m; pickAny = c; }
        if ((vLayers.y < 0 || water(c) == wantWater) && m > best) { best = m; pick = c; }
      }
      type = best >= 0.0 ? pick : (bestAny >= 0.0 ? pickAny : here);
    }
  }
  vec4 ti = info(type);
  float mat = mod(ti.a, 256.0);
  vec3 col = mat < 255.0 ? texture(uMats, vec3(local / uMatTiles, mat)).rgb * ti.rgb : ti.rgb;
  if (wood > 0.0) col *= mix(vec3(1.0), uWoodland, uWoodlandAlpha * wood);
  if (vLayers.y >= 0 && !isCrisp) {
    if (sd < 0.0) {
      float dd = -sd;
      float lines = 0.0;
      for (int i = 0; i < 8; i++) {
        float L = uLining[i];
        lines = max(lines, clamp(1.0 - abs(dd - L) * uS, 0.0, 1.0) * (1.0 - L / 4.0));
      }
      col = mix(col, uLiningInk, uLiningAlpha * lines * uLiningFade);
    } else {
      float sh = clamp(uShorePx - abs(sd * uS - 0.5), 0.0, 1.0);
      col = mix(col, uShore, uShoreAlpha * sh);
    }
  }
  if (isCrisp) {
    // an inked kerb where a crisp tile meets another type (10 §9.9)
    vec2 fr = fract(local) * uS;
    float kw = max(1.0, uS / 32.0);
    float k = 0.0;
    if (idAt(cell + ivec2(-1, 0)) != here) k = max(k, 1.0 - smoothstep(kw - 0.5, kw + 0.5, fr.x));
    if (idAt(cell + ivec2(1, 0)) != here) k = max(k, 1.0 - smoothstep(kw - 0.5, kw + 0.5, uS - fr.x));
    if (idAt(cell + ivec2(0, -1)) != here) k = max(k, 1.0 - smoothstep(kw - 0.5, kw + 0.5, fr.y));
    if (idAt(cell + ivec2(0, 1)) != here) k = max(k, 1.0 - smoothstep(kw - 0.5, kw + 0.5, uS - fr.y));
    col = mix(col, uKerb, uKerbAlpha * k);
  }
  oColour = vec4(col, 1.0);
}
`;
