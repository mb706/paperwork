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
use schema::codec::{EResult, Fixed, List, Packed, Writer};
use schema::packet::{
    AudioWorking, ChunkEntities, ChunkObjects, ChunkResources, ChunkTiles, EntityView, Mover, PacketBuilder,
    PacketFlags, PacketSection, ResourceView, ViewFlags, ViewRequest, held_chunks,
};
use schema::projections::{
    Cadence, ProjectionKind, SLOW_CADENCE_TICKS, STATS_SUBSCRIPTIONS, SUBSCRIPTIONS, UI_SECTION_MAX,
    UiInvalidReason, UiRecord, UiStatus,
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
    req: SubReq,
    last_hash: Option<u64>,
    last_eval: Option<u32>,
    series: SeriesState,
    /// A refusal to send once, then the subscription is dropped (§15.5: limits, unsupported kinds).
    refusal: Option<UiInvalidReason>,
}

#[derive(Clone, Copy, Debug)]
struct HoverSub {
    serial: u32,
    last_hash: Option<u64>,
    done: bool,
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
    /// The held set's generated chunks, and the pristine ones no cache holds yet with their distance.
    keys: Vec<ChunkKey>,
    missing: Vec<(i64, ChunkKey)>,
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

/// The extraction state of `PresentationState` (§3.6): written by extraction and by `sim_subscribe` /
/// `sim_unsubscribe`, read by extraction.
#[derive(Clone, Debug)]
pub struct Extractor {
    held: Vec<(ChunkKey, Held)>,
    subs: Vec<(u32, Sub)>,
    /// Per sub_id: the records sent, over replacements too (§15.5 `version`).
    versions: Vec<(u32, u32)>,
    hover: Option<HoverSub>,
    first_sent: bool,
    last_tick: Option<u32>,
    ui_cursor: u32,
    /// The UI section's cap: `UI_SECTION_MAX`, smaller only in tests.
    ui_cap: usize,
    view_cache: ViewCache,
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
            scratch: Scratch::default(),
        }
    }
}

/// What one extraction needs besides the World and the request.
pub struct ExtractIo<'a> {
    pub events: &'a mut EventSink,
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

    /// `sim_subscribe` (§15.5): adds or replaces each request. `false` (`ERR_INPUT`, nothing changes) when one
    /// names sub_id 0, which belongs to the hover projection (rule 30). A request for a kind outside the
    /// capability manifest, or over a limit, becomes a subscription that sends one status-2 record and is
    /// dropped. The limits hold for the set a request leaves: a replacement is checked as if the subscription it
    /// replaces were gone, and a refused replacement ends that subscription too (rule 34).
    pub fn subscribe(&mut self, reqs: &[SubReq]) -> bool {
        if reqs.iter().any(|r| r.sub_id == 0) {
            return false;
        }
        for req in reqs {
            let mut refusal = None;
            if !projection_supported(req.kind) {
                refusal = Some(UiInvalidReason::Unsupported);
            } else {
                let others = self.subs.iter().filter(|(id, s)| *id != req.sub_id && s.refusal.is_none());
                let (n, stats) = others.fold((0, 0), |(n, k), (_, s)| {
                    (n + 1, k + usize::from(s.req.kind == ProjectionKind::Stats))
                });
                if n + 1 > SUBSCRIPTIONS
                    || (req.kind == ProjectionKind::Stats && stats + 1 > STATS_SUBSCRIPTIONS)
                {
                    refusal = Some(UiInvalidReason::OverLimit);
                }
            }
            let sub = Sub {
                req: req.clone(),
                last_hash: None,
                last_eval: None,
                series: SeriesState::fresh(),
                refusal,
            };
            match self.subs.binary_search_by_key(&req.sub_id, |x| x.0) {
                Ok(i) => self.subs[i].1 = sub,
                Err(i) => self.subs.insert(i, (req.sub_id, sub)),
            }
        }
        true
    }

    /// `sim_unsubscribe`: drops them; unknown ids are ignored.
    pub fn unsubscribe(&mut self, ids: &[u32]) {
        self.subs.retain(|(id, _)| !ids.contains(id));
    }

    /// The number of live subscriptions (tests).
    pub fn subscriptions(&self) -> usize {
        self.subs.len()
    }

    /// How many pristine chunks extraction has generated into its view cache (§4.4; tests, `simtool bench`).
    pub fn generated(&self) -> u64 {
        self.view_cache.generated
    }

    /// `sim_extract` (§15.4): the next packet, appended to `out`.
    pub fn extract(
        &mut self,
        w: &World,
        view: &ViewRequest,
        io: &mut ExtractIo<'_>,
        out: &mut Vec<u8>,
    ) -> EResult {
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
        let s = &mut self.scratch;
        for b in [
            &mut s.tiles,
            &mut s.entities,
            &mut s.objects,
            &mut s.resources,
            &mut s.movers,
            &mut s.events,
            &mut s.ui,
        ] {
            b.clear();
        }
        // Per-chunk deltas: the held set's generated chunks, ascending key.
        self.held.retain(|(k, _)| {
            let (cx, cy) = schema::chunk_xy(*k);
            rect.is_some_and(|r| r.contains(cx, cy))
        });
        let surface = SurfaceIndex(view.surface.0);
        let (mut nt, mut ne, mut no, mut nr) = (0u32, 0u32, 0u32, 0u32);
        if let Some(r) = rect {
            held_generated(w, surface, r, &mut s.keys);
            // §4.4: extraction cannot write the World. A pristine chunk that neither the World's cache nor the
            // view cache holds is generated into the view cache, at most EXTRACT_GENERATIONS per packet, nearest
            // the view's centre first; the rest follow in later packets (they are not held until sent).
            s.missing.clear();
            for &key in &s.keys {
                if w.chunks.get(surface, key).is_none()
                    && w.regen.peek(surface, key).is_none()
                    && self.view_cache.get(surface, key).is_none()
                {
                    s.missing.push((centre_distance2(view, key), key));
                }
            }
            s.missing.sort_unstable();
            for &(_, key) in s.missing.iter().take(EXTRACT_GENERATIONS) {
                if let Some(d) = w.regen.generate_detached(surface, key) {
                    self.view_cache.put(d);
                }
            }
            for &key in &s.keys {
                let modified = w.chunks.get(surface, key);
                let pristine = match modified {
                    Some(_) => None,
                    None => match w.regen.peek(surface, key).or_else(|| self.view_cache.get(surface, key)) {
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
                let at = self.held.binary_search_by_key(&key, |x| x.0);
                let sent = at.ok().map(|i| self.held[i].1);
                if sent.is_none_or(|h| h.tiles != now.tiles) {
                    let tiles: &[TileId; 1024] = match (modified, &pristine) {
                        (Some(c), _) => &c.rec.tiles,
                        (None, Some(d)) => &d.tiles,
                        (None, None) => unreachable!("a held chunk is modified or its content is at hand"),
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
                match at {
                    Ok(i) => self.held[i].1 = now,
                    Err(i) => self.held.insert(i, (key, now)),
                }
            }
        }
        // MOVERS: every character in a held chunk, ascending serial (rule 32).
        let mut nm = 0u32;
        if let Some(r) = rect {
            s.chars.clear();
            s.chars
                .extend(w.players.iter().filter(|p| !p.character.is_none()).map(|p| (p.character, p.index)));
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
        // EVENTS: everything queued since the last packet (§15.6).
        let (nev, dropped) = io.events.drain(&mut s.events);
        if dropped {
            flags = flags.union(PacketFlags::EVENTS_DROPPED);
        }
        // UI: the subscriptions due (§15.5).
        let nui = if self.first_sent { self.ui_records(w, view, tick, io.dbg)? } else { 0 };

        // AUDIO_WORKING: the working loops near the view, while audio is on (§15.6).
        let s = &mut self.scratch;
        s.audio.clear();
        let mut na = 0;
        if let Some(r) = rect
            && view.flags.contains(ViewFlags::AUDIO)
        {
            s.working.clear();
            w.working_sources(surface, &mut s.working);
            na = audio_working(view, r, &s.working, &mut s.sounds, &mut s.audio)?;
        }

        let s = &self.scratch;
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
        let mut wr = Writer::new(out);
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
        self.first_sent = true;
        self.last_tick = Some(tick);
        Ok(())
    }

    fn next_version(&mut self, id: u32) -> u32 {
        match self.versions.binary_search_by_key(&id, |x| x.0) {
            Ok(i) => {
                self.versions[i].1 = self.versions[i].1.wrapping_add(1);
                self.versions[i].1
            }
            Err(i) => {
                self.versions.insert(i, (id, 1));
                1
            }
        }
    }

    /// Writes one UI record unless the section would pass its cap; `false` when capped.
    fn write_record(
        &mut self,
        id: u32,
        kind: ProjectionKind,
        status: UiStatus,
        body: &[u8],
    ) -> Result<bool, schema::codec::EncodeError> {
        let len = 16 + body.len().div_ceil(4) * 4;
        if self.scratch.ui.len() + len > self.ui_cap {
            return Ok(false);
        }
        let version = self.next_version(id);
        UiRecord { sub_id: SubId(id), kind, status, version, body }
            .encode(&mut Writer::new(&mut self.scratch.ui))?;
        Ok(true)
    }

    fn ui_records(
        &mut self,
        w: &World,
        view: &ViewRequest,
        tick: u32,
        dbg: DebugInputs,
    ) -> Result<u32, schema::codec::EncodeError> {
        let mut count = 0u32;
        // The hover projection (sub_id 0): the view request's hovered serial, 0 for none.
        let hovered = view.hovered_serial.0;
        if hovered == 0 {
            self.hover = None;
        } else if self.hover.is_none_or(|h| h.serial != hovered) {
            self.hover = Some(HoverSub { serial: hovered, last_hash: None, done: false });
        }
        let mut order = std::mem::take(&mut self.scratch.order);
        order.clear();
        if self.hover.is_some() {
            order.push(0);
        }
        order.extend(self.subs.iter().map(|x| x.0));
        // Cyclic, from where the last capped section stopped.
        let start = order.iter().position(|&id| id >= self.ui_cursor).unwrap_or(0);
        order.rotate_left(start);
        self.ui_cursor = 0;
        let mut body = std::mem::take(&mut self.scratch.body);
        let mut proj = std::mem::take(&mut self.scratch.proj);
        let mut capped = None;
        for &id in &order {
            if id == 0 {
                let Some(h) = self.hover else { continue };
                if h.done {
                    continue;
                }
                let req = SubReq {
                    sub_id: 0,
                    kind: ProjectionKind::Hover,
                    target: h.serial,
                    p: [0; 4],
                    tail: None,
                };
                let built = build_record(w, &req, None, dbg, &mut proj, &mut body);
                match built {
                    Built::Gone => {
                        if !self.write_record(0, ProjectionKind::Hover, UiStatus::Gone, &[])? {
                            capped = Some(0);
                            break;
                        }
                        count += 1;
                        if let Some(h) = self.hover.as_mut() {
                            h.done = true;
                        }
                    }
                    Built::Ok => {
                        let hash = xxh64(&body);
                        if h.last_hash == Some(hash) {
                            continue;
                        }
                        if !self.write_record(0, ProjectionKind::Hover, UiStatus::Ok, &body)? {
                            capped = Some(0);
                            break;
                        }
                        count += 1;
                        if let Some(h) = self.hover.as_mut() {
                            h.last_hash = Some(hash);
                        }
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
                self.subs.remove(i);
                continue;
            }
            let every = kind.cadence() == Cadence::Every;
            let last = self.subs[i].1.last_eval;
            let due = every || last.is_none_or(|l| tick >= l.saturating_add(SLOW_CADENCE_TICKS as u32));
            if !due {
                continue;
            }
            let built =
                build_record(w, &self.subs[i].1.req, Some(&self.subs[i].1.series), dbg, &mut proj, &mut body);
            match built {
                Built::Gone => {
                    if !self.write_record(id, kind, UiStatus::Gone, &[])? {
                        capped = Some(id);
                        break;
                    }
                    count += 1;
                    self.subs.remove(i);
                }
                Built::Invalid(reason) => {
                    if !self.write_record(id, kind, UiStatus::Invalid, &reason.value().to_le_bytes())? {
                        capped = Some(id);
                        break;
                    }
                    count += 1;
                    self.subs.remove(i);
                }
                Built::Ok => {
                    self.subs[i].1.last_eval = Some(tick);
                    let hash = xxh64(&body);
                    if self.subs[i].1.last_hash == Some(hash) {
                        continue;
                    }
                    if !self.write_record(id, kind, UiStatus::Ok, &body)? {
                        self.subs[i].1.last_eval = None;
                        capped = Some(id);
                        break;
                    }
                    count += 1;
                    let s = &mut self.subs[i].1;
                    s.last_hash = Some(hash);
                    proj.adopt_series(&mut s.series);
                }
            }
        }
        if let Some(id) = capped {
            self.ui_cursor = id;
        }
        self.scratch.order = order;
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
