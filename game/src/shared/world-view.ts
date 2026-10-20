// The world view's contract (C4-r1 12): what the UI (C5), audio and dev tools read and drive of the world on screen,
// without importing src/render/ (check-arch lets ui/ import only shared/). src/app/attach-renderer.ts implements it
// over the renderer and hands it out from the composition root (main.ts: `const world = await attachRenderer(app)`).
//
// Ownership:
//   - the app (C3) owns the page's lifecycle and the worlds: the world view follows `app.host`'s `packet` and
//     `generation` events (a new generation empties the view model) and sends the view request through
//     `app.host.setView`; its frame loop runs while it is attached;
//   - the renderer (C4) owns the camera, the view model (the mirror of 10 §3.4, §15.4) and picking;
//   - the UI (C5) owns input: it zooms (`zoomBy`, `setZoom`), follows (`follow`), hovers (`setHovered`), picks
//     (`pickAt`, `camera.toWorld`) and reads the model; the world view's own stand-in input (the wheel, F4, F5, F9) is
//     detached when the UI's input layer mounts (`devInput.detach()`, or `attachRenderer(app, { devInput: false })`).
// Everything here is read-only for its users, and valid until the next packet: copy what you keep.
// Types only, and chunkId: every layer may import it.

/**
 * The view model's key of chunk (cx, cy): (cx << 16) | (cy & 0xffff), a small integer (V8 Smi) for |cx| < 16,384
 * chunks, so a lookup boxes nothing. The wire's chunk_key, ((cx + 32768) << 16 | (cy + 32768)) >>> 0, is above 2³⁰
 * for nearly every chunk, and V8 boxes such a number each time it is passed to Map.get. Exact (if boxed) beyond.
 */
export function chunkId(cx: number, cy: number): number {
  return (cx << 16) | (cy & 0xffff);
}

/** The view model's key (chunkId) of a wire chunk_key. */
export function chunkIdOfKey(key: number): number {
  return chunkId((key >>> 16) - 32768, (key & 0xffff) - 32768);
}

/**
 * One held chunk's records as the last packets left them (10 §15.4): tiles, and the EntityView, ObjectView and
 * resource records in their wire layouts (read them with the generated codecs' OFFSET tables, src/shared/gen).
 */
export interface ViewChunk {
  /** The wire's chunk_key. */
  readonly key: number;
  /** chunkId(cx, cy): the key of `ViewModel.chunks`. */
  readonly id: number;
  readonly cx: number;
  readonly cy: number;
  /** 1,024 tile ids, row-major (index = y × 32 + x), or null until CHUNK_TILES arrives. */
  readonly tiles: Uint8Array | null;
  /** EntityView records (EntityViewCodec, 24 bytes each). */
  readonly entityView: DataView;
  readonly entityCount: number;
  /** ObjectView records (ObjectViewCodec, 16 bytes each). */
  readonly objectView: DataView;
  readonly objectCount: number;
  /** Resource records (8 bytes each: tile u16, resource u16, band u8). */
  readonly resourceView: DataView;
  readonly resourceCount: number;
}

/** A snapshot section (DYN, HANDS, MOVERS): `count` records in their wire layout. */
export interface ViewSnapshot {
  readonly view: DataView;
  readonly count: number;
}

/** The view model (10 §3.4): the render packets applied in order, for the held set of the last view request. */
export interface ViewModel {
  /** Bumped when the world is replaced (a FULL packet, a new state generation): drop caches keyed by chunk or serial. */
  readonly epoch: number;
  readonly tick: number;
  /** 0 (night) … 1 (day). */
  readonly daylight: number;
  /** Packets applied (a change counter). */
  readonly packets: number;
  readonly chunks: ReadonlyMap<number, ViewChunk>;
  readonly dyn: ViewSnapshot;
  readonly hands: ViewSnapshot;
  readonly movers: ViewSnapshot;
  /** The index of a serial's DYN record, −1 when it has none. */
  dynOf(serial: number): number;
  /** The index of a serial's HANDS record, −1 when it has none. */
  handsOf(serial: number): number;
}

/**
 * The camera the last frame was drawn with (snapped to whole device pixels), in the canvas's CSS pixels: the
 * renderer owns it; this is what a click or a label must use (10 §15.7's projection).
 */
export interface WorldCamera {
  /** The centre, tiles. */
  readonly cx: number;
  readonly cy: number;
  readonly zoom: number;
  /** The canvas's CSS size. */
  readonly width: number;
  readonly height: number;
  /** CSS px per tile now (32 × zoom). */
  readonly scale: number;
  /** CSS px from the canvas's top-left corner (event.clientX − rect.left …) to tiles. */
  toWorld(px: number, py: number): { x: number; y: number };
  /** Tiles to CSS px from the canvas's top-left corner. */
  toScreen(wx: number, wy: number): { x: number; y: number };
  /** The visible tile rectangle, x1 and y1 exclusive (the view request's x0 … y1, §15.4). */
  visible(): { x0: number; y0: number; x1: number; y1: number };
}

/** What is under a point (I §3.1): an entity by selection box and priority, else a resource tile, else the tile. */
export type WorldPick =
  | { kind: 'entity'; serial: number; proto: number; x2: number; y2: number; dir: number; flags: number }
  | { kind: 'resource'; tx: number; ty: number; resource: number; band: number }
  | { kind: 'tile'; tx: number; ty: number };

/** The world view, as the UI and the other packages use it (src/app/attach-renderer.ts). */
export interface WorldViewApi {
  readonly camera: WorldCamera;
  readonly model: ViewModel;
  /** Whether a world is shown: a state generation is bound and a packet of it applied. */
  active(): boolean;
  /** The object under (px, py), CSS px from the canvas's top-left corner; null where no world is held. */
  pickAt(px: number, py: number): WorldPick | null;
  /** The followed character's position (tiles), extrapolated as drawn, or null. */
  character(): { x: number; y: number } | null;
  /** Zooms by wheel notches (×1.1 each, I §3.15), within the world's range (0.3 … 3). */
  zoomBy(notches: number): void;
  setZoom(z: number): void;
  /** Follows player `player`'s character (MOVERS.aux); null: a free camera, centred on (x, y) when given. */
  follow(player: number | null, x?: number, y?: number): void;
  /** The hovered entity (0: none): the view request's hovered_serial, which drives the hover projection (§15.4). */
  setHovered(serial: number): void;
  /** Called after every drawn frame with its time (labels and flying text follow the camera); returns the remover. */
  onFrame(f: (now: number) => void): () => void;
  /** The stand-in input (wheel zoom, F4, F5, F9) until the UI's input layer owns these controls. */
  readonly devInput: { attach(): void; detach(): void };
  /**
   * Gameplay readiness (10 §9.7): the core art is uploaded, so the first frame may show; rejects when a core file
   * failed four times (the loading screen's error; `retryArt()` asks again).
   */
  ready(): Promise<void>;
  retryArt(): void;
}
