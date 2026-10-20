//! The M0 projections (10 §15.5; projections.yaml): each kind's record, built from `&World` only (D1, D9), as
//! the golden reference model builds it (test/golden/model/projections.ts; golden README rules 34–36). A record
//! that cannot be built is `gone` (its target does not exist) or `invalid` with a developer reason.
//!
//! - `HUD`: the tick only in M0. `CHARACTER`: a player's character, main inventory, hand, crafting queue and
//!   mining (rule 35: no quickbar in M0, no declared sources). `INVENTORY`, `ENTITY_PANEL`, `HOVER`: a chest's
//!   slots, panel and contents. `STATS`: window totals and series (rule 26). `DEBUG`: counts, digests and the
//!   pools (memory, capacities and phase times are implementation-defined; the golden set masks them).

use crate::r#gen::Player;
use crate::rules::inventory::{Inv, hand_origin};
use crate::stats::{ALL_PRECISION, RING_POINTS, TICKS_PER_POINT, all_span};
use crate::world::World;
use schema::codec::{EResult, List, MsgList, Packed, Writer};
use schema::projections::{
    Character, CharacterFlags, CraftQueueView, Debug, EntityPanel, Hover, Hud, HudFlags, Inventory,
    InventoryView, ItemCount, PanelFlags, PoolStat, ProjectionKind, STATS_KEYS, STATS_SERIES_KEYS, StatEntry,
    StatSeries, Stats, StatsFlags, UiInvalidReason,
};
use schema::{
    EntityId, InventoryType, ItemKey, PlayerIndex, PoolKind, RecipeId, Serial, SlotView, StatKey, StatKind,
    StatPrecision, StatTab, Status, TechId, Tick, projection_supported,
};

/// A subscription's request (§15.5), owned.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SubReq {
    pub sub_id: u32,
    pub kind: ProjectionKind,
    pub target: u32,
    pub p: [u32; 4],
    /// The list parameters, when the request flags a tail.
    pub tail: Option<Vec<u8>>,
}

impl SubReq {
    pub fn from_request(r: &schema::projections::SubRequest<'_>) -> Self {
        Self {
            sub_id: r.sub_id.0,
            kind: r.kind,
            target: r.target,
            p: [r.p0, r.p1, r.p2, r.p3],
            tail: r.tail.map(<[u8]>::to_vec),
        }
    }
}

/// What a STATS subscription keeps between records (§15.5: whole first, then the points appended since): per
/// key, the next point to send and the span its ring had then (rule 26: a ring whose span changed is sent whole).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SeriesState {
    pub whole: bool,
    pub next: Vec<(StatKey, u32)>,
    pub span: Vec<(StatKey, u32)>,
}

impl SeriesState {
    pub fn fresh() -> Self {
        Self { whole: true, ..Self::default() }
    }

    fn get(list: &[(StatKey, u32)], k: StatKey) -> Option<u32> {
        list.binary_search_by_key(&k, |x| x.0).ok().map(|i| list[i].1)
    }

    fn set(list: &mut Vec<(StatKey, u32)>, k: StatKey, v: u32) {
        match list.binary_search_by_key(&k, |x| x.0) {
            Ok(i) => list[i].1 = v,
            Err(i) => list.insert(i, (k, v)),
        }
    }
}

/// A built record: its body is in the caller's buffer when `Ok`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Built {
    Ok,
    Gone,
    Invalid(UiInvalidReason),
}

/// Buffers the projections reuse.
#[derive(Clone, Debug, Default)]
pub struct ProjScratch {
    slots: Vec<SlotView>,
    queue: Vec<CraftQueueView>,
    counts: Vec<ItemCount>,
    keys: Vec<StatKey>,
    entries: Vec<StatEntry>,
    produced: Vec<Vec<f32>>,
    consumed: Vec<Vec<f32>>,
    /// The STATS series state the last built record leads to, when `has_next`.
    next_series: SeriesState,
    has_next: bool,
}

impl ProjScratch {
    /// Adopts the series state of the last built STATS record into `into` (a swap: no allocation).
    pub fn adopt_series(&mut self, into: &mut SeriesState) {
        if self.has_next {
            std::mem::swap(&mut self.next_series, into);
            self.has_next = false;
        }
    }
}

/// The digests DEBUG reports, the linear memory it measures (the module's) and the last profiled tick's phases.
#[derive(Clone, Copy, Debug, Default)]
pub struct DebugInputs {
    pub d: u64,
    pub r: u64,
    pub memory_bytes: u32,
    pub phase_us: Option<[f32; crate::tick::PHASES]>,
}

fn enc<T>(r: EResult) -> Result<(), T>
where
    T: From<()>,
{
    r.map_err(|_| T::from(()))
}

/// The slot views of an inventory (no filters in M0).
fn slot_views(w: &World, inv: &Inv, out: &mut Vec<SlotView>) {
    out.clear();
    out.extend(w.heap.block(inv.r)[..inv.size as usize].iter().map(|s| SlotView {
        key: s.key,
        filter: ItemKey::NONE,
        count: s.count,
    }));
}

impl World {
    fn live_row(&self, serial: u32) -> Option<u32> {
        if serial == 0 {
            return None;
        }
        self.entity(Serial(serial)).map(crate::handle::slot)
    }
}

/// Builds the record of `req` into `out` (cleared first). `series` is the subscription's STATS state; the one
/// the record leads to stays in `scratch` for the caller to adopt ([`ProjScratch::adopt_series`]) only if it
/// sends the record.
pub fn build_record(
    w: &World,
    req: &SubReq,
    series: Option<&SeriesState>,
    dbg: DebugInputs,
    scratch: &mut ProjScratch,
    out: &mut Vec<u8>,
) -> Built {
    out.clear();
    scratch.has_next = false;
    if !projection_supported(req.kind) {
        return Built::Invalid(UiInvalidReason::Unsupported);
    }
    let r = match req.kind {
        ProjectionKind::Hud => hud(w, out),
        ProjectionKind::Character => character(w, req.target, scratch, out),
        ProjectionKind::Inventory => inventory(w, req, scratch, out),
        ProjectionKind::EntityPanel => entity_panel(w, req.target, scratch, out),
        ProjectionKind::Hover => hover(w, req.target, scratch, out),
        ProjectionKind::Stats => return stats(w, req, series, scratch, out),
        ProjectionKind::Debug => debug(w, dbg, out),
        ProjectionKind::Research | ProjectionKind::Electric | ProjectionKind::World => {
            Ok(Built::Invalid(UiInvalidReason::Unsupported))
        }
    };
    r.unwrap_or_else(|()| panic!("a {} record does not encode", req.kind.name()))
}

fn hud(w: &World, out: &mut Vec<u8>) -> Result<Built, ()> {
    enc(Hud {
        tick: Tick(w.current_tick()),
        research_tech: TechId::NONE,
        research_level: 0,
        research_progress: 0.0,
        takeoff_level: 0,
        flags: HudFlags::EMPTY,
        field: 0.0,
        literature: 0.0,
        your_year: 0.0,
        years_ahead: 0.0,
        activity_w: 0.0,
        doubling_time_s: 0.0,
        alerts: List::EMPTY,
    }
    .encode(&mut Writer::new(out)))?;
    Ok(Built::Ok)
}

fn character(w: &World, target: u32, scratch: &mut ProjScratch, out: &mut Vec<u8>) -> Result<Built, ()> {
    let Some(p) = u16::try_from(target).ok().and_then(|i| w.players.get(PlayerIndex(i))) else {
        return Ok(Built::Gone);
    };
    // A watermark record (rule 12) has no character: the window has nothing to show.
    if p.character.is_none() {
        return Ok(Built::Gone);
    }
    let main = main_inv(w, p);
    slot_views(w, &main, &mut scratch.slots);
    scratch.queue.clear();
    for (i, e) in p.crafting_queue.iter().enumerate() {
        scratch.queue.push(CraftQueueView {
            recipe: e.recipe,
            count: e.count,
            progress: if i == 0 { e.progress as f32 } else { 0.0 },
            flags: schema::projections::CraftFlags::from_bits_retain(e.flags.bits()),
        });
    }
    let mining = p.mining.mode != crate::r#gen::MiningMode::None;
    let flags = CharacterFlags::EMPTY
        .with(CharacterFlags::ONLINE, p.online)
        .with(CharacterFlags::HAND_GHOST, p.hand.ghost)
        .with(CharacterFlags::MINING, mining)
        .with(CharacterFlags::AUTO_SORT, p.auto_sort)
        .with(CharacterFlags::PICK_GHOST_CURSOR, p.pick_ghost_cursor);
    enc(Character {
        player: p.index,
        flags,
        quickbar_page: 0,
        serial: p.character,
        input_gen: p.input_gen,
        hand_origin: hand_origin(&p.hand).map_or(0xFFFF, |o| o as u16),
        hand_key: p.hand.key,
        hand_count: p.hand.count,
        mining_progress: if mining { p.mining.progress as f32 } else { 0.0 },
        main: List::from_slice(&scratch.slots),
        quickbar: List::EMPTY, // M0 keeps no quickbar (its actions are outside the capability manifest)
        queue: List::from_slice(&scratch.queue),
    }
    .encode(&mut Writer::new(out)))?;
    Ok(Built::Ok)
}

/// A player's main inventory (the hand's origin reserved).
fn main_inv(w: &World, p: &Player) -> Inv {
    let size = w.main_size();
    Inv { r: p.main, size, bar: size, origin: hand_origin(&p.hand) }
}

/// A chest's inventory view: its slots and its limit bar (the size when unlimited).
fn chest_view<'a>(w: &World, row: u32, slots: &'a mut Vec<SlotView>) -> InventoryView<'a> {
    let inv = w.chest_inv(row);
    slot_views(w, &inv, slots);
    InventoryView { inv: InventoryType::Chest, bar: inv.bar as u16, slots: List::from_slice(slots) }
}

fn inventory(w: &World, req: &SubReq, scratch: &mut ProjScratch, out: &mut Vec<u8>) -> Result<Built, ()> {
    let Some(row) = w.live_row(req.target) else {
        return Ok(Built::Gone);
    };
    if req.p[0] != u32::from(InventoryType::Chest.value()) {
        return Ok(Built::Invalid(UiInvalidReason::BadParameters));
    }
    let view = chest_view(w, row, &mut scratch.slots);
    enc(Inventory { serial: Serial(req.target), view }.encode(&mut Writer::new(out)))?;
    Ok(Built::Ok)
}

fn entity_panel(w: &World, target: u32, scratch: &mut ProjScratch, out: &mut Vec<u8>) -> Result<Built, ()> {
    let Some(row) = w.live_row(target) else {
        return Ok(Built::Gone);
    };
    let proto = w.entities.proto[row as usize];
    let views = [chest_view(w, row, &mut scratch.slots)];
    // M0 fills a chest's fields (projections.yaml): no status, recipe, progress or energy.
    enc(EntityPanel {
        serial: Serial(target),
        proto,
        status: Status::None,
        flags: PanelFlags::EMPTY,
        recipe: RecipeId(0xFFFF),
        progress: 0.0,
        crafts_per_s: 0.0,
        productivity_bar: 0.0,
        energy_satisfaction: 0.0,
        energy_buffer_j: 0.0,
        energy_draw_w: 0.0,
        inventories: MsgList::from_slice(&views),
    }
    .encode(&mut Writer::new(out)))?;
    Ok(Built::Ok)
}

fn hover(w: &World, target: u32, scratch: &mut ProjScratch, out: &mut Vec<u8>) -> Result<Built, ()> {
    let Some(row) = w.live_row(target) else {
        return Ok(Built::Gone);
    };
    let inv = w.chest_inv(row);
    // The contents: each key's total, ascending.
    scratch.counts.clear();
    for s in &w.heap.block(inv.r)[..inv.size as usize] {
        if s.count <= 0 {
            continue;
        }
        match scratch.counts.binary_search_by_key(&s.key, |c| c.key) {
            Ok(i) => scratch.counts[i].count += s.count,
            Err(i) => scratch.counts.insert(i, ItemCount { key: s.key, count: s.count }),
        }
    }
    let proto: EntityId = w.entities.proto[row as usize];
    enc(Hover {
        serial: Serial(target),
        proto,
        status: Status::None,
        contents: List::from_slice(&scratch.counts),
    }
    .encode(&mut Writer::new(out)))?;
    Ok(Built::Ok)
}

/// A precision's window total (§15.5 STATS; the golden model's decision): the window's 300 points (oldest first,
/// summed as f64) plus the open accumulator; `all` is the exact all-time total.
fn window_total(r: &crate::r#gen::StatRing, produced: bool, exact: f64) -> f64 {
    if usize::from(r.precision.value()) == ALL_PRECISION {
        return exact;
    }
    let pts = if produced { &r.produced } else { &r.consumed };
    let mut s = 0.0;
    let from = r.points.saturating_sub(RING_POINTS);
    for j in from..r.points {
        s += f64::from(pts[(j % RING_POINTS) as usize]);
    }
    s + if produced { r.acc_produced } else { r.acc_consumed }
}

fn stats(
    w: &World,
    req: &SubReq,
    series: Option<&SeriesState>,
    scratch: &mut ProjScratch,
    out: &mut Vec<u8>,
) -> Built {
    let [p0, p1, p2, _] = req.p;
    if p0 > 8 || p1 > 3 || p2 & !1 != 0 {
        return Built::Invalid(UiInvalidReason::BadParameters);
    }
    let ProjScratch { keys, entries, produced, consumed, next_series, has_next, .. } = scratch;
    // The keys: the tail's (distinct, ascending, at most STATS_KEYS), or every key of the tab.
    keys.clear();
    match req.tail.as_deref() {
        Some(t) if !t.is_empty() => {
            if t.len() % 4 != 0 || t.len() / 4 > STATS_KEYS {
                return Built::Invalid(UiInvalidReason::BadParameters);
            }
            for c in t.as_chunks::<4>().0 {
                keys.push(StatKey(u32::from_le_bytes(*c)));
            }
            keys.sort_unstable();
            keys.dedup();
        }
        _ => {
            let kind = [StatKind::Item, StatKind::Fluid, StatKind::Entity, StatKind::Heat][p1 as usize];
            keys.extend(w.stats().iter().filter(|s| s.key.0 >> 24 == kind as u32).map(|s| s.key));
        }
    }
    let ring = |key: StatKey| {
        let i = w.stat_position(key)?;
        Some((&w.stats()[i], &w.stats()[i].rings[p0 as usize]))
    };
    entries.clear();
    for &key in keys.iter() {
        entries.push(match ring(key) {
            Some((s, r)) => StatEntry {
                key,
                produced: window_total(r, true, s.produced_total),
                consumed: window_total(r, false, s.consumed_total),
            },
            None => StatEntry { key, produced: 0.0, consumed: 0.0 },
        });
    }
    // The subscription's next series state, built in the scratch from its current one (no allocation once the
    // buffers have grown); the extractor adopts it by a swap when it sends the record.
    match series {
        Some(s) => {
            next_series.next.clone_from(&s.next);
            next_series.span.clone_from(&s.span);
        }
        None => {
            next_series.next.clear();
            next_series.span.clear();
        }
    }
    next_series.whole = false;
    let span =
        if p0 as usize == ALL_PRECISION { all_span(w.current_tick()) } else { TICKS_PER_POINT[p0 as usize] };
    let n = if p2 & 1 != 0 { keys.len().min(STATS_SERIES_KEYS) } else { 0 };
    while produced.len() < n {
        produced.push(Vec::new());
        consumed.push(Vec::new());
    }
    let mut froms = [0u16; STATS_SERIES_KEYS];
    for (k, &key) in keys.iter().take(n).enumerate() {
        let r = ring(key).map(|x| x.1);
        let points = r.map_or(0, |r| r.points);
        let oldest = points.saturating_sub(RING_POINTS);
        let same = series.is_some_and(|s| !s.whole && SeriesState::get(&s.span, key) == Some(span));
        let want = if same { series.and_then(|s| SeriesState::get(&s.next, key)).unwrap_or(0) } else { 0 };
        let from = if want > oldest { want } else { oldest };
        let (pp, cc) = (&mut produced[k], &mut consumed[k]);
        pp.clear();
        cc.clear();
        if let Some(r) = r {
            for j in from..points {
                pp.push(r.produced[(j % RING_POINTS) as usize]);
                cc.push(r.consumed[(j % RING_POINTS) as usize]);
            }
        }
        froms[k] = (from % 65_536) as u16;
        SeriesState::set(&mut next_series.next, key, points);
        SeriesState::set(&mut next_series.span, key, span);
    }
    let empty = StatSeries { key: StatKey(0), from: 0, produced: List::EMPTY, consumed: List::EMPTY };
    let mut list = [empty; STATS_SERIES_KEYS];
    for (k, x) in list.iter_mut().enumerate().take(n) {
        *x = StatSeries {
            key: keys[k],
            from: froms[k],
            produced: List::from_slice(&produced[k]),
            consumed: List::from_slice(&consumed[k]),
        };
    }
    let body = Stats {
        precision: StatPrecision::from_value(p0 as u8).expect("0–8"),
        tab: StatTab::from_value(p1 as u8).expect("0–3"),
        flags: StatsFlags::from_bits_retain(p2 as u8),
        entries: List::from_slice(entries),
        series: MsgList::from_slice(&list[..n]),
    };
    body.encode(&mut Writer::new(out)).unwrap_or_else(|e| panic!("a STATS record does not encode: {e}"));
    *has_next = true;
    Built::Ok
}

fn debug(w: &World, dbg: DebugInputs, out: &mut Vec<u8>) -> Result<Built, ()> {
    let rows = w.containers.rows();
    let pools = [PoolStat {
        pool: PoolKind::Container,
        rows,
        capacity: w.containers.entity.capacity() as u32,
        active: 0,
    }];
    enc(Debug {
        tick: Tick(w.current_tick()),
        entity_count: w.entity_count(),
        memory_bytes: dbg.memory_bytes,
        d: dbg.d,
        r: dbg.r,
        pools: List::from_slice(&pools),
        phase_us: dbg.phase_us.as_ref().map_or(List::EMPTY, |us| List::from_slice(us)),
    }
    .encode(&mut Writer::new(out)))?;
    Ok(Built::Ok)
}
