//! Extraction (10 §15.4–§15.6, §3.4, §3.6): `sim_extract` reads `&World` and the module's presentation state and
//! writes one complete packet, header included (`state_gen` and `view_seq` left zero for the shell). What the
//! main thread holds (the held set, each held chunk's sent versions, the subscriptions' last records) advances
//! only when a packet is written, so a skipped extraction loses nothing. As the golden reference model does
//! (test/golden/model/extract.ts; golden README rules 31–34):
//!
//! - **The first packet** of a world is `FULL` and carries no chunk and no subscription record (rule 31).
//! - **Per-chunk deltas**: every generated chunk of the held set, ascending key; a part is sent when the chunk
//!   enters the held set or its view version changed; all four parts when it enters, empty lists included.
//!   Pristine chunks (view versions 1) come from the World's regeneration cache when a rule has read them, else
//!   from extraction's own view cache, which generates at most 8 a packet, nearest the view's centre first (§4.4).
//! - **`MOVERS`**: every character whose position lies in a held chunk, ascending serial (rule 32).
//! - **`EVENTS`**: the queue, drained (`EVENTS_DROPPED` when it overflowed).
//! - **`UI`**: the subscriptions due, in `sub_id` order from where the last capped section stopped, the hover
//!   projection (sub_id 0) first; a record is sent when its XXH64 differs from the last one sent (rule 34).
//! - **`AUDIO_WORKING`** (§15.6), with `ViewFlags::AUDIO`: one record per working-sound id among the working
//!   entities near the view. Nothing in M0 works (§2.4's manifest), so the section stays absent until M1's
//!   machines report themselves through [`World::working_sources`].
//! - `COALESCED` when more than one tick ran since the last packet; `daylight` 65,535 (rule 7). `DYN`, `HANDS`,
//!   belts, overlays and charts have no M0 source.

use crate::hash::xxh64;
use crate::presentation::EventSink;
use crate::project::{Built, DebugInputs, ProjScratch, SeriesState, SubReq, build_record};
use crate::rules::{Move, fine, resource_band};
use crate::world::World;
use schema::ChunkData;
use schema::codec::{EncodeError, Fixed, List, Packed, Writer};
use schema::packet::{
    AudioWorking, ChunkEntities, ChunkObjects, ChunkResources, ChunkTiles, EntityView, Mover, PacketBuilder,
    PacketFlags, PacketSection, ResourceView, ViewFlags, ViewRequest, held_chunks,
};
use schema::projections::{
    Cadence, ProjectionKind, SLOW_CADENCE_TICKS, STATS_SUBSCRIPTIONS, SUBSCRIPTIONS, SubRequest,
    UI_SECTION_MAX, UiInvalidReason, UiRecord, UiStatus,
};
use schema::{
    ChunkKey, Direction, EntityViewFlags, IconIndex, MoverFlags, MoverKind, PLAYERS, PlayerIndex, Serial,
    SoundId, Status, SubId, SurfaceIndex, Tick, TileId, chunk_key, projection_supported,
};
use std::sync::Arc;

/// M0 has no day cycle (§5.7 arrives in M1): full daylight in every packet (rule 7).
pub const M0_DAYLIGHT: u16 = 65_535;
// The limits are projections.yaml's (§15.5): at most `SUBSCRIPTIONS` besides the hover, of which at most
// `STATS_SUBSCRIPTIONS` are STATS; the UI section at most `UI_SECTION_MAX` bytes per packet; a slow kind evaluated
// at most every `SLOW_CADENCE_TICKS`.

/// The view versions the main thread holds for one chunk.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Held {
    tiles: u32,
    entities: u32,
    objects: u32,
    resources: u32,
}

#[derive(Clone, Debug)]
struct Sub {
    /// The request; a refusal keeps no tail.
    req: SubReq,
    last_hash: Option<u64>,
    last_eval: Option<u32>,
    /// The declared sources' revision when the record was last built (§15.5 "Source revisions").
    last_rev: Option<u64>,
    series: SeriesState,
    /// A refusal to send once, then the subscription is dropped (§15.5: limits, unsupported kinds).
    refusal: Option<UiInvalidReason>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct HoverSub {
    serial: u32,
    last_hash: Option<u64>,
    last_rev: Option<u64>,
    done: bool,
}

/// What a delivered packet changes in a subscription (staged until the packet is delivered, §15.4).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SubChange {
    /// Its refusal, gone or invalid record went out: the subscription ends.
    End,
    /// Evaluated at the staged tick: `sent` is the hash of the record written, if one was; `rev` the declared
    /// sources' revision the record was built at.
    Evaluated { sent: Option<u64>, rev: Option<u64> },
    /// Evaluated, its record changed, but the section was full: due again at the next extraction.
    Capped,
}

/// A packet built and not yet delivered, with everything it changes in what the main thread holds (C2c-r1
/// finding 4: §15.4's "what was sent advances only when a packet is"). `commit` applies it once the module has
/// handed the packet over; a new extraction or a change of the subscriptions drops it.
#[derive(Clone, Debug, Default)]
struct Staged {
    ready: bool,
    packet: Vec<u8>,
    tick: u32,
    held: Vec<((SurfaceIndex, ChunkKey), Held)>,
    hover: Option<HoverSub>,
    ui_cursor: u32,
    /// `(sub_id, version)` of each record written.
    versions: Vec<(u32, u32)>,
    subs: Vec<(u32, SubChange)>,
    /// STATS series states to swap in, `(sub_id, state)`.
    series: Vec<(u32, SeriesState)>,
}

/// Buffers extraction reuses.
#[derive(Clone, Debug, Default)]
struct Scratch {
    tiles: Vec<u8>,
    entities: Vec<u8>,
    objects: Vec<u8>,
    resources: Vec<u8>,
    movers: Vec<u8>,
    events: Vec<u8>,
    ui: Vec<u8>,
    body: Vec<u8>,
    views: Vec<EntityView>,
    rows: Vec<(Serial, u32)>,
    res: Vec<ResourceView>,
    chars: Vec<(Serial, PlayerIndex)>,
    order: Vec<u32>,
    proj: ProjScratch,
    working: Vec<WorkingSource>,
    sounds: Vec<SoundSum>,
    audio: Vec<u8>,
    /// The held set's generated chunks, and the unsent pristine ones no cache holds yet with their distance.
    keys: Vec<ChunkKey>,
    missing: Vec<(i64, ChunkKey)>,
    /// `sim_subscribe`'s plan: the table's `(sub_id, kind, refused)` as the batch would leave it.
    meta: Vec<(u32, ProjectionKind, bool)>,
    /// Shared evaluation (§15.5): per order position, the earlier position with the same request, and the
    /// records built this extraction that a later subscription reuses.
    twin: Vec<Option<usize>>,
    shared: Vec<(usize, Built, u64, usize, usize)>,
    shared_bodies: Vec<u8>,
    /// STATS series states not in use, so staging swaps instead of allocating.
    series_pool: Vec<SeriesState>,
}

/// The pristine chunks extraction may generate per packet (§4.4, B1-r1 16).
pub const EXTRACT_GENERATIONS: usize = 8;
/// The view cache's size: a held set at the widest zoom is about 60 chunks (§6.12), so two views fit easily.
pub const VIEW_CACHE_CHUNKS: usize = 512;

/// Extraction's own bounded cache of the pristine chunks it generated (§4.4: "a bounded cache in
/// `PresentationState`"), oldest evicted first.
#[derive(Clone, Debug, Default)]
pub struct ViewCache {
    /// Ascending by `(surface, key)`, with an insertion stamp.
    entries: Vec<(SurfaceIndex, ChunkKey, u64, Arc<ChunkData>)>,
    stamp: u64,
    /// How many chunks extraction generated (tests and `simtool bench`).
    generated: u64,
}

impl ViewCache {
    fn get(&self, surface: SurfaceIndex, key: ChunkKey) -> Option<Arc<ChunkData>> {
        self.entries
            .binary_search_by(|x| (x.0, x.1).cmp(&(surface, key)))
            .ok()
            .map(|i| self.entries[i].3.clone())
    }

    fn put(&mut self, data: Arc<ChunkData>) {
        self.stamp += 1;
        self.generated += 1;
        let k = (data.surface, data.key);
        match self.entries.binary_search_by(|x| (x.0, x.1).cmp(&k)) {
            Ok(i) => self.entries[i] = (k.0, k.1, self.stamp, data),
            Err(i) => {
                self.entries.insert(i, (k.0, k.1, self.stamp, data));
                if self.entries.len() > VIEW_CACHE_CHUNKS {
                    let oldest = (0..self.entries.len()).min_by_key(|&j| self.entries[j].2).unwrap_or(0);
                    self.entries.remove(oldest);
                }
            }
        }
    }
}

/// The held set's generated chunks on `surface` in ascending key: the rectangle's chunks, or the generated list's
/// when that is shorter, so a huge view rectangle costs no more than the world holds (`CHUNKS ⊆ GENERATED`).
fn held_generated(w: &World, surface: SurfaceIndex, r: schema::packet::ChunkRect, out: &mut Vec<ChunkKey>) {
    out.clear();
    let area = (i64::from(r.cx1) - i64::from(r.cx0) + 1) * (i64::from(r.cy1) - i64::from(r.cy0) + 1);
    let generated = w.chunks.generated();
    if area <= generated.len() as i64 {
        // chunk_key is (cx, cy) in that order: cx outer, cy inner is ascending.
        for cx in r.cx0..=r.cx1 {
            for cy in r.cy0..=r.cy1 {
                let key = chunk_key(cx, cy);
                if w.chunks.is_generated(surface, key) {
                    out.push(key);
                }
            }
        }
    } else {
        out.extend(generated.iter().filter(|g| g.surface == surface).map(|g| g.key).filter(|&k| {
            let (cx, cy) = schema::chunk_xy(k);
            r.contains(cx, cy)
        }));
    }
}

/// The squared distance, in half tiles, from the view's centre to a chunk's centre.
fn centre_distance2(view: &ViewRequest, key: ChunkKey) -> i64 {
    let (cx, cy) = schema::chunk_xy(key);
    let dx = i64::from(cx) * 64 + 32 - (i64::from(view.x0) + i64::from(view.x1));
    let dy = i64::from(cy) * 64 + 32 - (i64::from(view.y0) + i64::from(view.y1));
    dx * dx + dy * dy
}

/// A working entity's loop (§15.6): its sound and position in tiles.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WorkingSource {
    pub sound: SoundId,
    pub x: f64,
    pub y: f64,
}

/// One sound's running sums while `AUDIO_WORKING` is aggregated.
#[derive(Clone, Copy, Debug, PartialEq)]
struct SoundSum {
    sound: SoundId,
    n: u32,
    sx: f64,
    sy: f64,
    wsum: f64,
}

impl World {
    /// The working entities' loops on `surface` (§15.6), for `AUDIO_WORKING`. M0 has no working entity: chests do
    /// not work and the character's sounds are events (§2.4's manifest), so this adds nothing until M1.
    pub fn working_sources(&self, _surface: SurfaceIndex, _out: &mut Vec<WorkingSource>) {}
}

/// `AUDIO_WORKING` (§15.6) from `sources`: per sound id (ascending) with n > 0 among the sources inside the view
/// rectangle grown by R ÷ 2 on every side and inside the held set, their count, their centroid relative to the
/// view centre in tiles, and wsum = Σ 1 ÷ (1 + (d ÷ R)²) with d each one's distance from the view centre and R
/// the request's `audio_half_range`. Returns the record count; nothing without a positive range.
fn audio_working(
    view: &ViewRequest,
    held: schema::packet::ChunkRect,
    sources: &[WorkingSource],
    sums: &mut Vec<SoundSum>,
    out: &mut Vec<u8>,
) -> Result<u32, schema::codec::EncodeError> {
    sums.clear();
    let r = f64::from(view.audio_half_range);
    if r.is_nan() || r <= 0.0 {
        return Ok(0);
    }
    let (cx, cy) =
        ((f64::from(view.x0) + f64::from(view.x1)) / 2.0, (f64::from(view.y0) + f64::from(view.y1)) / 2.0);
    let (x0, x1) = (f64::from(view.x0) - r / 2.0, f64::from(view.x1) + r / 2.0);
    let (y0, y1) = (f64::from(view.y0) - r / 2.0, f64::from(view.y1) + r / 2.0);
    for w in sources {
        if !(w.x >= x0 && w.x < x1 && w.y >= y0 && w.y < y1) {
            continue;
        }
        if !held.contains(
            crate::chunks::tile_chunk(w.x.floor() as i32),
            crate::chunks::tile_chunk(w.y.floor() as i32),
        ) {
            continue;
        }
        let (dx, dy) = (w.x - cx, w.y - cy);
        let weight = 1.0 / (1.0 + (dx * dx + dy * dy) / (r * r));
        let at = match sums.binary_search_by_key(&w.sound, |s| s.sound) {
            Ok(i) => i,
            Err(i) => {
                sums.insert(i, SoundSum { sound: w.sound, n: 0, sx: 0.0, sy: 0.0, wsum: 0.0 });
                i
            }
        };
        let s = &mut sums[at];
        s.n += 1;
        s.sx += dx;
        s.sy += dy;
        s.wsum += weight;
    }
    for s in sums.iter() {
        let n = f64::from(s.n);
        AudioWorking {
            sound: s.sound,
            n: u16::try_from(s.n).unwrap_or(u16::MAX),
            cx: (s.sx / n) as f32,
            cy: (s.sy / n) as f32,
            wsum: s.wsum as f32,
        }
        .write(&mut Writer::new(out), "AudioWorking")?;
    }
    Ok(sums.len() as u32)
}

/// Refused requests waiting for their status-2 record, at most this many (C2c-r1 finding 1). With the 32 live
/// subscriptions they bound what the table holds; a refusal keeps no tail.
pub const REFUSALS_MAX: usize = SUBSCRIPTIONS;
/// The most requests one `sim_subscribe` carries: each one lives or waits as a refusal.
pub const SUBSCRIBE_BATCH_MAX: usize = SUBSCRIPTIONS + REFUSALS_MAX;

/// Why `sim_subscribe` refused a batch; nothing changes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SubscribeError {
    /// `ERR_INPUT`: a request for `sub_id` 0, the hover projection's (rule 30).
    HoverId,
    /// `ERR_LIMIT`: more than [`SUBSCRIBE_BATCH_MAX`] requests, or more than [`REFUSALS_MAX`] refusals waiting.
    Limit,
}

/// The table's counts that §15.5's limits read: live subscriptions, live STATS ones, refusals waiting.
#[derive(Clone, Copy, Debug, Default)]
struct Counts {
    live: usize,
    stats: usize,
    refused: usize,
}

impl Counts {
    fn of(entries: impl Iterator<Item = (ProjectionKind, bool)>) -> Self {
        let mut c = Self::default();
        for (kind, refused) in entries {
            c.add(kind, refused);
        }
        c
    }

    fn add(&mut self, kind: ProjectionKind, refused: bool) {
        if refused {
            self.refused += 1;
        } else {
            self.live += 1;
            self.stats += usize::from(kind == ProjectionKind::Stats);
        }
    }

    fn remove(&mut self, kind: ProjectionKind, refused: bool) {
        if refused {
            self.refused -= 1;
        } else {
            self.live -= 1;
            self.stats -= usize::from(kind == ProjectionKind::Stats);
        }
    }

    /// §15.5's limits for a request of `kind`, the entry it replaces already removed (rule 34).
    fn refusal_for(&self, kind: ProjectionKind) -> Option<UiInvalidReason> {
        if !projection_supported(kind) {
            Some(UiInvalidReason::Unsupported)
        } else if self.live + 1 > SUBSCRIPTIONS
            || (kind == ProjectionKind::Stats && self.stats + 1 > STATS_SUBSCRIPTIONS)
        {
            Some(UiInvalidReason::OverLimit)
        } else {
            None
        }
    }
}

/// The declared sources' revision of a record (projections.yaml `sources`, §15.5): an inventory's version for
/// `INVENTORY` and `HOVER` (whose other source, the entity's status, is constant for M0's chests). `None` for a
/// kind without sources, or a target that is gone, which is then always built.
fn source_rev(w: &World, kind: ProjectionKind, target: u32) -> Option<u64> {
    match kind {
        ProjectionKind::Inventory | ProjectionKind::Hover => {
            let row = w.entity(Serial(target)).map(crate::handle::slot)?;
            let inv = w.containers.inv[w.entities.pool_slot[row as usize] as usize];
            Some(u64::from(w.heap.version(inv)))
        }
        ProjectionKind::Hud
        | ProjectionKind::Character
        | ProjectionKind::EntityPanel
        | ProjectionKind::Research
        | ProjectionKind::Stats
        | ProjectionKind::Electric
        | ProjectionKind::World
        | ProjectionKind::Debug => None,
    }
}

/// Whether two subscriptions share their evaluation (§15.5): the same kind, target, parameters and tail, and a
/// record that depends on nothing of the subscription's own. A STATS record with series (`p2` bit 0) holds the
/// points appended since that subscription's last record, so it is built per subscription.
fn shares(a: &SubReq, b: &SubReq) -> bool {
    let series = a.kind == ProjectionKind::Stats && a.p[2] & 1 != 0;
    !series && a.kind == b.kind && a.target == b.target && a.p == b.p && a.tail == b.tail
}

/// The extraction state of `PresentationState` (§3.6): written by `sim_subscribe` / `sim_unsubscribe` and by
/// delivered packets, read by extraction.
#[derive(Clone, Debug)]
pub struct Extractor {
    /// The held set: per `(surface, chunk)`, the view versions the main thread holds (C2c-r1 finding 6).
    held: Vec<((SurfaceIndex, ChunkKey), Held)>,
    subs: Vec<(u32, Sub)>,
    /// Per live `sub_id` (and the hover's 0): the records sent, over replacements too (§15.5 `version`).
    versions: Vec<(u32, u32)>,
    hover: Option<HoverSub>,
    first_sent: bool,
    last_tick: Option<u32>,
    ui_cursor: u32,
    /// The UI section's cap: `UI_SECTION_MAX`, smaller only in tests.
    ui_cap: usize,
    view_cache: ViewCache,
    staged: Staged,
    /// How many records extraction has built (tests: source revisions and shared evaluation skip builds).
    builds: u64,
    scratch: Scratch,
}

impl Default for Extractor {
    fn default() -> Self {
        Self {
            held: Vec::new(),
            subs: Vec::new(),
            versions: Vec::new(),
            hover: None,
            first_sent: false,
            last_tick: None,
            ui_cursor: 0,
            ui_cap: UI_SECTION_MAX,
            view_cache: ViewCache::default(),
            staged: Staged::default(),
            builds: 0,
            scratch: Scratch::default(),
        }
    }
}

/// What one extraction reads besides the World and the request.
pub struct ExtractIo<'a> {
    pub events: &'a EventSink,
    pub moves: &'a [Move; PLAYERS],
    pub dbg: DebugInputs,
}

impl Extractor {
    pub fn new() -> Self {
        Self::default()
    }

    /// Tests: a smaller UI section cap, to exercise the deferral of §15.5 with M0's small records.
    pub fn set_ui_cap(&mut self, bytes: usize) {
        self.ui_cap = bytes;
    }

    /// `sim_subscribe` (§15.5): adds or replaces each request, in order. A request for `sub_id` 0 is refused
    /// (rule 30). A request for a kind outside the capability manifest, or over a limit, waits as a refusal
    /// that sends one status-2 record and is dropped. The limits hold for the set a request leaves: a
    /// replacement is checked as if the subscription it replaces were gone, and a refused replacement ends that
    /// subscription too (rule 34). Bounded (C2c-r1 finding 1): a batch of more than [`SUBSCRIBE_BATCH_MAX`]
    /// requests, or one that would leave more than [`REFUSALS_MAX`] refusals waiting, is refused whole before
    /// anything is copied.
    pub fn subscribe(&mut self, reqs: &[SubRequest<'_>]) -> Result<(), SubscribeError> {
        if reqs.iter().any(|r| r.sub_id.0 == 0) {
            return Err(SubscribeError::HoverId);
        }
        if reqs.len() > SUBSCRIBE_BATCH_MAX {
            return Err(SubscribeError::Limit);
        }
        // The plan, on the table's metadata: a refused batch changes and copies nothing.
        let meta = &mut self.scratch.meta;
        meta.clear();
        meta.extend(self.subs.iter().map(|(id, s)| (*id, s.req.kind, s.refusal.is_some())));
        let mut c = Counts::of(meta.iter().map(|m| (m.1, m.2)));
        for r in reqs {
            let at = meta.binary_search_by_key(&r.sub_id.0, |m| m.0);
            if let Ok(i) = at {
                c.remove(meta[i].1, meta[i].2);
            }
            let refused = c.refusal_for(r.kind).is_some();
            c.add(r.kind, refused);
            if c.refused > REFUSALS_MAX {
                return Err(SubscribeError::Limit);
            }
            match at {
                Ok(i) => meta[i] = (r.sub_id.0, r.kind, refused),
                Err(i) => meta.insert(i, (r.sub_id.0, r.kind, refused)),
            }
        }
        // The same decisions on the table.
        self.drop_stage();
        let mut c = Counts::of(self.subs.iter().map(|(_, s)| (s.req.kind, s.refusal.is_some())));
        for r in reqs {
            let id = r.sub_id.0;
            let at = self.subs.binary_search_by_key(&id, |x| x.0);
            if let Ok(i) = at {
                let old = &self.subs[i].1;
                c.remove(old.req.kind, old.refusal.is_some());
            }
            let refusal = c.refusal_for(r.kind);
            c.add(r.kind, refusal.is_some());
            let mut req = SubReq {
                sub_id: id,
                kind: r.kind,
                target: r.target,
                p: [r.p0, r.p1, r.p2, r.p3],
                tail: None,
            };
            if refusal.is_none() {
                req.tail = r.tail.map(<[u8]>::to_vec);
            }
            let sub = Sub {
                req,
                last_hash: None,
                last_eval: None,
                last_rev: None,
                series: SeriesState::fresh(),
                refusal,
            };
            match at {
                Ok(i) => self.subs[i].1 = sub,
                Err(i) => self.subs.insert(i, (id, sub)),
            }
        }
        Ok(())
    }

    /// `sim_unsubscribe`: drops them and their record counts; unknown ids are ignored.
    pub fn unsubscribe(&mut self, ids: &[u32]) {
        self.drop_stage();
        self.subs.retain(|(id, _)| !ids.contains(id));
        self.reclaim_versions();
    }

    /// Forgets the record counts of `sub_id`s that ended (C2c-r1 finding 1); the hover's stays.
    fn reclaim_versions(&mut self) {
        let subs = &self.subs;
        self.versions.retain(|(id, _)| *id == 0 || subs.binary_search_by_key(id, |x| x.0).is_ok());
    }

    /// The number of subscriptions, refusals waiting included (tests).
    pub fn subscriptions(&self) -> usize {
        self.subs.len()
    }

    /// How many `sub_id`s have a record count (tests).
    pub fn versions(&self) -> usize {
        self.versions.len()
    }

    /// How many pristine chunks extraction has generated into its view cache (§4.4; tests, `simtool bench`).
    pub fn generated(&self) -> u64 {
        self.view_cache.generated
    }

    /// How many records extraction has built, the hover's included (tests).
    pub fn builds(&self) -> u64 {
        self.builds
    }

    /// Drops a staged packet that was not delivered, keeping its series buffers.
    fn drop_stage(&mut self) {
        let st = &mut self.staged;
        st.ready = false;
        self.scratch.series_pool.extend(st.series.drain(..).map(|(_, x)| x));
    }

    /// `sim_extract` (§15.4), first half: builds the next packet and stages what it changes; nothing the main
    /// thread is assumed to hold advances until [`Self::commit`]. Returns the packet.
    pub fn stage(&mut self, w: &World, view: &ViewRequest, io: &ExtractIo<'_>) -> Result<&[u8], EncodeError> {
        self.drop_stage();
        let tick = w.current_tick();
        let mut flags = PacketFlags::EMPTY;
        if !self.first_sent {
            flags = flags.union(PacketFlags::FULL);
        }
        if self.last_tick.is_some_and(|l| tick.wrapping_sub(l) > 1) {
            flags = flags.union(PacketFlags::COALESCED);
        }
        // The first packet holds nothing: the main thread's state starts empty (rule 31).
        let rect = if self.first_sent { held_chunks(view) } else { None };
        let surface = SurfaceIndex(view.surface.0);
        let Self { held, view_cache, staged: st, scratch: s, .. } = self;
        for b in [
            &mut s.tiles,
            &mut s.entities,
            &mut s.objects,
            &mut s.resources,
            &mut s.movers,
            &mut s.events,
            &mut s.ui,
            &mut s.audio,
        ] {
            b.clear();
        }
        st.held.clear();
        let is_held =
            |key: ChunkKey| held.binary_search_by_key(&(surface, key), |x| x.0).ok().map(|i| held[i].1);
        let (mut nt, mut ne, mut no, mut nr) = (0u32, 0u32, 0u32, 0u32);
        if let Some(r) = rect {
            held_generated(w, surface, r, &mut s.keys);
            // §4.4: extraction cannot write the World. A pristine chunk not sent yet that neither the World's cache
            // nor the view cache holds is generated into the view cache, at most EXTRACT_GENERATIONS per packet,
            // nearest the view's centre first; the rest follow in later packets. A pristine chunk already sent is
            // unchanged (its view versions are 1 until a rule modifies it), so it needs no content (C2c-r1
            // finding 5: evicted, already-sent chunks no longer take the budget from unsent ones).
            s.missing.clear();
            for &key in &s.keys {
                if w.chunks.get(surface, key).is_none()
                    && is_held(key).is_none()
                    && w.regen.peek(surface, key).is_none()
                    && view_cache.get(surface, key).is_none()
                {
                    s.missing.push((centre_distance2(view, key), key));
                }
            }
            s.missing.sort_unstable();
            for &(_, key) in s.missing.iter().take(EXTRACT_GENERATIONS) {
                if let Some(d) = w.regen.generate_detached(surface, key) {
                    view_cache.put(d);
                }
            }
            for &key in &s.keys {
                let modified = w.chunks.get(surface, key);
                let sent = is_held(key);
                let pristine = match (modified, sent) {
                    (Some(_), _) => None,
                    (None, Some(h)) => {
                        st.held.push(((surface, key), h));
                        continue;
                    }
                    (None, None) => match w.regen.peek(surface, key).or_else(|| view_cache.get(surface, key))
                    {
                        Some(d) => Some(d),
                        None => continue,
                    },
                };
                let now =
                    modified.map_or(Held { tiles: 1, entities: 1, objects: 1, resources: 1 }, |c| Held {
                        tiles: c.view.tiles,
                        entities: c.view.entities,
                        objects: c.view.objects,
                        resources: c.view.resources,
                    });
                if sent.is_none_or(|h| h.tiles != now.tiles) {
                    let tiles: &[TileId; 1024] = match (modified, &pristine) {
                        (Some(c), _) => &c.rec.tiles,
                        (None, Some(d)) => &d.tiles,
                        (None, None) => unreachable!("a chunk to send is modified or its content is at hand"),
                    };
                    ChunkTiles { chunk_key: key, surface, flags: 0, version: now.tiles, tiles: *tiles }
                        .write(&mut Writer::new(&mut s.tiles), "ChunkTiles")?;
                    nt += 1;
                }
                if sent.is_none_or(|h| h.entities != now.entities) {
                    s.views.clear();
                    if let Some(c) = modified {
                        s.rows.clear();
                        s.rows.extend(c.entities.iter().map(|&row| (w.entities.serial[row as usize], row)));
                        s.rows.sort_unstable();
                        for &(serial, row) in &s.rows {
                            let r = row as usize;
                            s.views.push(EntityView {
                                serial,
                                x2: w.entities.x2[r],
                                y2: w.entities.y2[r],
                                proto: w.entities.proto[r],
                                alt_icon: IconIndex::NONE,
                                dir: w.entities.dir[r],
                                flip: w.entities.flip[r],
                                quality: w.entities.quality[r],
                                variant: 0,
                                status: Status::None, // chests report no status (rule 35)
                                flags: EntityViewFlags::EMPTY,
                            });
                        }
                    }
                    ChunkEntities {
                        chunk_key: key,
                        surface,
                        version: now.entities,
                        entities: List::from_slice(&s.views),
                    }
                    .encode(&mut Writer::new(&mut s.entities))?;
                    ne += 1;
                }
                if sent.is_none_or(|h| h.objects != now.objects) {
                    // M0 has no world objects and nothing drops on the ground: always empty.
                    ChunkObjects { chunk_key: key, surface, version: now.objects, objects: List::EMPTY }
                        .encode(&mut Writer::new(&mut s.objects))?;
                    no += 1;
                }
                if sent.is_none_or(|h| h.resources != now.resources) {
                    s.res.clear();
                    let list = match (modified, &pristine) {
                        (Some(c), _) => c.rec.resources.as_slice(),
                        (None, Some(d)) => d.resources.as_slice(),
                        (None, None) => &[],
                    };
                    s.res.extend(list.iter().map(|r| ResourceView {
                        tile: r.tile,
                        resource: r.resource,
                        band: resource_band(r.amount),
                    }));
                    ChunkResources {
                        chunk_key: key,
                        surface,
                        version: now.resources,
                        resources: List::from_slice(&s.res),
                    }
                    .encode(&mut Writer::new(&mut s.resources))?;
                    nr += 1;
                }
                st.held.push(((surface, key), now));
            }
        }
        // MOVERS: every character on the view's surface in a held chunk, ascending serial (rule 32).
        let mut nm = 0u32;
        if let Some(r) = rect {
            s.chars.clear();
            s.chars.extend(
                w.players
                    .iter()
                    .filter(|p| !p.character.is_none() && p.surface == surface)
                    .map(|p| (p.character, p.index)),
            );
            s.chars.sort_unstable();
            let proto = schema::EntityId(w.character_proto() as u16);
            for &(serial, pi) in &s.chars {
                let p = w.player(pi);
                let (cx, cy) = (
                    crate::chunks::tile_chunk(p.x.floor() as i32),
                    crate::chunks::tile_chunk(p.y.floor() as i32),
                );
                if !r.contains(cx, cy) {
                    continue;
                }
                let m = io.moves[usize::from(pi.0)];
                let mining = p.mining.mode != crate::r#gen::MiningMode::None;
                Mover {
                    serial,
                    proto,
                    kind: MoverKind::Character,
                    flags: if mining { MoverFlags::MINING } else { MoverFlags::EMPTY },
                    x: fine(p.x),
                    y: fine(p.y),
                    vx: fine(m.dx) as i16,
                    vy: fine(m.dy) as i16,
                    base_tick: Tick(tick),
                    orientation: u16::from(direction_value(p.walking_dir)) * 4096,
                    aux: pi.0,
                }
                .write(&mut Writer::new(&mut s.movers), "Mover")?;
                nm += 1;
            }
        }
        // EVENTS: everything queued since the last delivered packet (§15.6); the queue empties on delivery.
        let (nev, dropped) = io.events.peek(&mut s.events);
        if dropped {
            flags = flags.union(PacketFlags::EVENTS_DROPPED);
        }
        // AUDIO_WORKING: the working loops near the view, while audio is on (§15.6).
        let mut na = 0;
        if let Some(r) = rect
            && view.flags.contains(ViewFlags::AUDIO)
        {
            s.working.clear();
            w.working_sources(surface, &mut s.working);
            na = audio_working(view, r, &s.working, &mut s.sounds, &mut s.audio)?;
        }
        // UI: the subscriptions due (§15.5).
        let nui = if self.first_sent { self.stage_ui(w, view, tick, io.dbg)? } else { 0 };

        let Self { staged: st, scratch: s, .. } = self;
        let sections: [(PacketSection, u32, &Vec<u8>); 8] = [
            (PacketSection::ChunkTiles, nt, &s.tiles),
            (PacketSection::ChunkEntities, ne, &s.entities),
            (PacketSection::Movers, nm, &s.movers),
            (PacketSection::Events, nev as u32, &s.events),
            (PacketSection::Ui, nui, &s.ui),
            (PacketSection::AudioWorking, na, &s.audio),
            (PacketSection::ChunkObjects, no, &s.objects),
            (PacketSection::ChunkResources, nr, &s.resources),
        ];
        let present = sections.iter().filter(|x| x.1 > 0).count();
        st.packet.clear();
        let mut wr = Writer::new(&mut st.packet);
        let mut pb = PacketBuilder::begin(&mut wr, present, tick, flags, M0_DAYLIGHT);
        for (t, n, bytes) in sections {
            if n == 0 {
                continue;
            }
            pb.section(&mut wr, t)?;
            wr.bytes(bytes);
            pb.end(&mut wr, n)?;
        }
        pb.finish(&mut wr)?;
        st.tick = tick;
        st.ready = true;
        Ok(&self.staged.packet)
    }

    /// `sim_extract`, second half: the staged packet was delivered, so what it carries is now held (§15.4): the
    /// chunks' versions, the subscriptions' records, versions, hashes and series, the hover, the UI cursor; and
    /// the event queue empties. Without a staged packet, nothing happens.
    pub fn commit(&mut self, events: &mut EventSink) {
        if !self.staged.ready {
            return;
        }
        let st = &mut self.staged;
        st.ready = false;
        std::mem::swap(&mut self.held, &mut st.held);
        self.hover = st.hover;
        self.ui_cursor = st.ui_cursor;
        self.first_sent = true;
        self.last_tick = Some(st.tick);
        for &(id, v) in &st.versions {
            match self.versions.binary_search_by_key(&id, |x| x.0) {
                Ok(i) => self.versions[i].1 = v,
                Err(i) => self.versions.insert(i, (id, v)),
            }
        }
        let mut ended = false;
        for &(id, change) in &st.subs {
            let Ok(i) = self.subs.binary_search_by_key(&id, |x| x.0) else { continue };
            match change {
                SubChange::End => {
                    self.subs.remove(i);
                    ended = true;
                }
                SubChange::Evaluated { sent, rev } => {
                    let s = &mut self.subs[i].1;
                    s.last_eval = Some(st.tick);
                    s.last_rev = rev;
                    if sent.is_some() {
                        s.last_hash = sent;
                    }
                }
                SubChange::Capped => self.subs[i].1.last_eval = None,
            }
        }
        for (id, mut series) in st.series.drain(..) {
            if let Ok(i) = self.subs.binary_search_by_key(&id, |x| x.0) {
                std::mem::swap(&mut self.subs[i].1.series, &mut series);
            }
            self.scratch.series_pool.push(series);
        }
        if ended {
            self.reclaim_versions();
        }
        events.clear();
    }

    /// Writes one UI record unless the section would pass its cap (`false`); its version is staged.
    fn write_record(
        &mut self,
        id: u32,
        kind: ProjectionKind,
        status: UiStatus,
        body: &[u8],
    ) -> Result<bool, EncodeError> {
        let len = 16 + body.len().div_ceil(4) * 4;
        if self.scratch.ui.len() + len > self.ui_cap {
            return Ok(false);
        }
        let sent = self.versions.binary_search_by_key(&id, |x| x.0).map_or(0, |i| self.versions[i].1);
        let version = sent.wrapping_add(1);
        UiRecord { sub_id: SubId(id), kind, status, version, body }
            .encode(&mut Writer::new(&mut self.scratch.ui))?;
        self.staged.versions.push((id, version));
        Ok(true)
    }

    /// Stages the UI section (§15.5): the hover projection (sub_id 0) and the subscriptions due, cyclically from
    /// where the last capped section stopped; returns the record count.
    fn stage_ui(
        &mut self,
        w: &World,
        view: &ViewRequest,
        tick: u32,
        dbg: DebugInputs,
    ) -> Result<u32, EncodeError> {
        let mut count = 0u32;
        self.staged.versions.clear();
        self.staged.subs.clear();
        // The hover projection: the view request's hovered serial, 0 for none.
        let hovered = view.hovered_serial.0;
        let mut hover = match self.hover {
            _ if hovered == 0 => None,
            Some(h) if h.serial == hovered => Some(h),
            _ => Some(HoverSub { serial: hovered, last_hash: None, last_rev: None, done: false }),
        };
        let mut order = std::mem::take(&mut self.scratch.order);
        order.clear();
        if hover.is_some() {
            order.push(0);
        }
        order.extend(self.subs.iter().map(|x| x.0));
        let start = order.iter().position(|&id| id >= self.ui_cursor).unwrap_or(0);
        order.rotate_left(start);
        // Shared evaluation (§15.5): each subscription's first earlier twin in this order.
        let mut twin = std::mem::take(&mut self.scratch.twin);
        twin.clear();
        for (k, &id) in order.iter().enumerate() {
            let me = (id != 0).then(|| self.subs.binary_search_by_key(&id, |x| x.0).ok()).flatten();
            let t = me.and_then(|i| {
                let a = &self.subs[i].1;
                (a.refusal.is_none())
                    .then(|| {
                        order[..k].iter().position(|&o| {
                            o != 0
                                && self.subs.binary_search_by_key(&o, |x| x.0).is_ok_and(|j| {
                                    let b = &self.subs[j].1;
                                    b.refusal.is_none() && shares(&a.req, &b.req)
                                })
                        })
                    })
                    .flatten()
            });
            twin.push(t);
        }
        self.scratch.shared.clear();
        self.scratch.shared_bodies.clear();
        let mut body = std::mem::take(&mut self.scratch.body);
        let mut proj = std::mem::take(&mut self.scratch.proj);
        let mut capped = None;
        for (k, &id) in order.iter().enumerate() {
            if id == 0 {
                let Some(h) = hover else { continue };
                if h.done {
                    continue;
                }
                let rev = source_rev(w, ProjectionKind::Hover, h.serial);
                if rev.is_some() && h.last_hash.is_some() && h.last_rev == rev {
                    continue; // its sources are unchanged since its last record
                }
                let req = SubReq {
                    sub_id: 0,
                    kind: ProjectionKind::Hover,
                    target: h.serial,
                    p: [0; 4],
                    tail: None,
                };
                self.builds += 1;
                match build_record(w, &req, None, dbg, &mut proj, &mut body) {
                    Built::Gone => {
                        if !self.write_record(0, ProjectionKind::Hover, UiStatus::Gone, &[])? {
                            capped = Some(0);
                            break;
                        }
                        count += 1;
                        hover = Some(HoverSub { done: true, ..h });
                    }
                    Built::Ok => {
                        let hash = xxh64(&body);
                        if h.last_hash == Some(hash) {
                            hover = Some(HoverSub { last_rev: rev, ..h });
                            continue;
                        }
                        if !self.write_record(0, ProjectionKind::Hover, UiStatus::Ok, &body)? {
                            capped = Some(0);
                            break;
                        }
                        count += 1;
                        hover = Some(HoverSub { last_hash: Some(hash), last_rev: rev, ..h });
                    }
                    Built::Invalid(_) => {}
                }
                continue;
            }
            let Ok(i) = self.subs.binary_search_by_key(&id, |x| x.0) else { continue };
            let kind = self.subs[i].1.req.kind;
            if let Some(reason) = self.subs[i].1.refusal {
                if !self.write_record(id, kind, UiStatus::Invalid, &reason.value().to_le_bytes())? {
                    capped = Some(id);
                    break;
                }
                count += 1;
                self.staged.subs.push((id, SubChange::End));
                continue;
            }
            let every = kind.cadence() == Cadence::Every;
            let last = self.subs[i].1.last_eval;
            let due = every || last.is_none_or(|l| tick >= l.saturating_add(SLOW_CADENCE_TICKS as u32));
            if !due {
                continue;
            }
            let rev = source_rev(w, kind, self.subs[i].1.req.target);
            if rev.is_some() && self.subs[i].1.last_hash.is_some() && self.subs[i].1.last_rev == rev {
                continue; // its sources are unchanged since its last record (§15.5)
            }
            // Its twin's evaluation, when one was built this extraction; else its own.
            let reuse = twin[k].and_then(|t| self.scratch.shared.iter().find(|x| x.0 == t).copied());
            let (built, hash) = match reuse {
                Some((_, built, hash, at, len)) => {
                    body.clear();
                    body.extend_from_slice(&self.scratch.shared_bodies[at..at + len]);
                    (built, hash)
                }
                None => {
                    self.builds += 1;
                    let built = build_record(
                        w,
                        &self.subs[i].1.req,
                        Some(&self.subs[i].1.series),
                        dbg,
                        &mut proj,
                        &mut body,
                    );
                    let hash = xxh64(&body);
                    if twin[k + 1..].contains(&Some(k)) {
                        let at = self.scratch.shared_bodies.len();
                        self.scratch.shared_bodies.extend_from_slice(&body);
                        self.scratch.shared.push((k, built, hash, at, body.len()));
                    }
                    (built, hash)
                }
            };
            match built {
                Built::Gone | Built::Invalid(_) => {
                    let (status, reason) = match built {
                        Built::Invalid(r) => (UiStatus::Invalid, r.value().to_le_bytes()),
                        Built::Gone | Built::Ok => (UiStatus::Gone, [0, 0]),
                    };
                    let b: &[u8] = if status == UiStatus::Invalid { &reason } else { &[] };
                    if !self.write_record(id, kind, status, b)? {
                        capped = Some(id);
                        break;
                    }
                    count += 1;
                    self.staged.subs.push((id, SubChange::End));
                }
                Built::Ok => {
                    if self.subs[i].1.last_hash == Some(hash) {
                        self.staged.subs.push((id, SubChange::Evaluated { sent: None, rev }));
                        continue;
                    }
                    if !self.write_record(id, kind, UiStatus::Ok, &body)? {
                        self.staged.subs.push((id, SubChange::Capped));
                        capped = Some(id);
                        break;
                    }
                    count += 1;
                    self.staged.subs.push((id, SubChange::Evaluated { sent: Some(hash), rev }));
                    if reuse.is_none() && proj.has_series() {
                        let mut next = self.scratch.series_pool.pop().unwrap_or_default();
                        proj.take_series(&mut next);
                        self.staged.series.push((id, next));
                    }
                }
            }
        }
        self.staged.ui_cursor = capped.unwrap_or(0);
        self.staged.hover = hover;
        self.scratch.order = order;
        self.scratch.twin = twin;
        self.scratch.body = body;
        self.scratch.proj = proj;
        Ok(count)
    }
}

/// A direction's value (0–15).
fn direction_value(d: Direction) -> u8 {
    d.value()
}

#[cfg(test)]
mod tests {
    use super::*;
    use schema::codec::Reader;
    use schema::packet::ChunkRect;

    fn view(r: f32) -> ViewRequest {
        ViewRequest {
            view_seq: 0,
            surface: SurfaceIndex(0),
            flags: ViewFlags::AUDIO,
            x0: -10,
            y0: -5,
            x1: 10,
            y1: 5,
            zoom: 1.0,
            hovered_serial: Serial(0),
            audio_half_range: r,
            chart_x0: 0,
            chart_y0: 0,
            chart_x1: 0,
            chart_y1: 0,
        }
    }

    fn records(bytes: &[u8], n: u32) -> Vec<AudioWorking> {
        let mut r = Reader::new(bytes);
        (0..n).map(|_| AudioWorking::read(&mut r, "AudioWorking").expect("a record")).collect()
    }

    /// §15.6: per sound id (ascending), the sources in the view grown by R ÷ 2 and in the held set; their count,
    /// centroid relative to the view centre and Σ 1 ÷ (1 + (d ÷ R)²).
    #[test]
    fn audio_working_aggregates_the_loops_near_the_view() {
        let src = |sound: u16, x: f64, y: f64| WorkingSource { sound: SoundId(sound), x, y };
        let sources = [
            src(3, 0.0, 0.0),    // the centre: weight 1
            src(3, 8.0, 0.0),    // d = R: weight ½ (−6 dB)
            src(1, 13.9, 8.9),   // inside the grown rectangle [−14, 14) × [−9, 9)
            src(1, 14.0, 0.0),   // its upper bound is exclusive
            src(2, -20.0, 0.0),  // far outside
            src(4, -13.0, -8.0), // inside the rectangle, in chunk (−1, −1)
        ];
        let held = ChunkRect { cx0: 0, cy0: 0, cx1: 0, cy1: 0 };
        let (mut sums, mut out) = (Vec::new(), Vec::new());
        let held_all = ChunkRect { cx0: -2, cy0: -2, cx1: 1, cy1: 1 };
        let n = audio_working(&view(8.0), held_all, &sources, &mut sums, &mut out).expect("encodes");
        let all = records(&out, n);
        assert_eq!(all.iter().map(|a| (a.sound.0, a.n)).collect::<Vec<_>>(), [(1, 1), (3, 2), (4, 1)]);
        out.clear();
        let n = audio_working(&view(8.0), held, &sources, &mut sums, &mut out).expect("encodes");
        let got = records(&out, n);
        assert_eq!(got.len(), 2, "{got:?}");
        assert_eq!((got[0].sound, got[0].n), (SoundId(1), 1));
        assert_eq!((got[0].cx, got[0].cy), (13.9, 8.9));
        let w1 = 1.0 / (1.0 + (13.9f64 * 13.9 + 8.9 * 8.9) / 64.0);
        assert_eq!(got[0].wsum, w1 as f32);
        assert_eq!(
            (got[1].sound, got[1].n, got[1].cx, got[1].cy, got[1].wsum),
            (SoundId(3), 2, 4.0, 0.0, 1.5)
        );
        // No range, no loops.
        out.clear();
        assert_eq!(audio_working(&view(0.0), held, &sources, &mut sums, &mut out).expect("encodes"), 0);
        assert!(out.is_empty());
    }
}
