//! The D18 harness (10 §4.1 D18, §10.2, §10.4 #2–#5): runs one start state and one closure stream several
//! ways and compares **full canonical state**, not only digests.
//!
//! - [`record`] runs a [`SimContext`] for a number of ticks and keeps, per tick, d_t and r_t, and the
//!   canonical state bytes (the hashed sections, `sim_save`'s output without its lineage) at the ticks a
//!   [`Schedule`] names: every tick for the first 2,000, then every 600 and the last (B1-r1 20). A load restarts
//!   the dense window: every tick of the 2,000 after a reload is kept too (§10.4 #3, "the first 2,000 ticks after
//!   the load"; the M0 exit audit, C9), in the reference and in every variant ([`record_windows`],
//!   [`check_equivalence`] keeps the union of the variants' windows).
//! - [`Variant`] says how the run differs from the reference: NO_SLEEP (D18 b), a save and a load into a fresh
//!   module at a tick (join equivalence, D18 a; §10.4 #2–#3), or heavy mode (D18 c: every k ticks a save and a
//!   load into a fresh module that carries on). Every replacement is checked at once: the fresh module's canonical
//!   state must equal the one it was saved from, and the state kept for that tick is the fresh module's.
//! - [`compare`] finds the first tick where two traces differ and names the first differing section and field,
//!   decoded by the generated readers ([`diff_states`]).
//!
//! The [`TestSequencer`] writes closures for scenarios (§10.2, §15.3), and [`Scenario`] is the scenario DSL
//! over it (sequencer.rs, scenario.rs).

pub mod bench;
pub mod layout;
pub mod multi;
mod scenario;
mod sequencer;

pub use scenario::{ItemStats, LayoutOpts, Recorded, Scenario};
pub use sequencer::TestSequencer;

use crate::context::SimContext;
use crate::r#gen::{
    decode_chunks, decode_generated, decode_globals, decode_players, decode_rng, decode_slot_heap,
    decode_stats, decode_timers, decode_worldgen_pending,
};
use crate::save::parse_save_output;
use crate::{SimError, SimResult};
use schema::codec::Dump;
use schema::{SaveSection, SimFlags};

/// Which ticks keep their full canonical state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Schedule {
    /// Every tick up to and including this one (§10.2: the first 2,000).
    pub every_tick_until: u32,
    /// Then every this many ticks (§10.4 #3: every 600), and always the last.
    pub then_every: u32,
}

impl Default for Schedule {
    fn default() -> Self {
        Self { every_tick_until: 2000, then_every: 600 }
    }
}

impl Schedule {
    /// Whether tick `t` (absolute; the run started at `t0` and ends at `last`) keeps its state: dense for the first
    /// `every_tick_until` ticks of the run and of each window (a window from w covers w … w + `every_tick_until`,
    /// the reload's own tick included), then every `then_every`, and the last.
    fn keeps(&self, t: u32, t0: u32, last: u32, windows: &[u32]) -> bool {
        let rel = t - t0;
        rel <= self.every_tick_until
            || t == last
            || (self.then_every > 0 && rel.is_multiple_of(self.then_every))
            || windows.iter().any(|&w| t >= w && t - w <= self.every_tick_until)
    }
}

/// The ticks after which a variant loads its world into a fresh module and a dense window restarts (D18 a's
/// reload; heavy mode's reloads are checked at once instead, see [`record_windows`]).
pub fn windows_of(variants: &[Variant]) -> Vec<u32> {
    variants.iter().filter_map(|v| if let Variant::Reload { at } = *v { Some(at) } else { None }).collect()
}

/// One tick of a run.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TickRecord {
    pub tick: u32,
    pub d: u64,
    pub r: u64,
    /// The canonical state after the tick (`SaveOutput` bytes without the trailing lineage).
    pub state: Option<Vec<u8>>,
}

/// A run's records, the start first (tick of the start state, d 0).
pub type Trace = Vec<TickRecord>;

/// The canonical state bytes of a module's world: `sim_save`'s sections, without the lineage.
pub fn canonical_state(ctx: &SimContext) -> SimResult<Vec<u8>> {
    let mut b = ctx.checkpoint()?;
    b.truncate(b.len() - 8);
    Ok(b)
}

/// A fresh module with `protos_bin` and the world `save` (`SaveOutput` bytes: sections and lineage).
pub fn start_from(protos_bin: &[u8], save: &[u8], flags: SimFlags) -> SimResult<SimContext> {
    let mut ctx = SimContext::new();
    ctx.init_protos(protos_bin, flags)?;
    let (frames, r) =
        parse_save_output(save).map_err(|e| SimError::new(schema::SimStatus::ErrInput, format!("{e}")))?;
    ctx.load(&crate::save::load_input(&frames, r))?;
    Ok(ctx)
}

/// Moves a module's world into a fresh module through `sim_save` and `sim_load` (what a join does).
pub fn reload(protos_bin: &[u8], ctx: &SimContext) -> SimResult<SimContext> {
    let save = ctx.checkpoint()?;
    start_from(protos_bin, &save, ctx.flags())
}

/// The closures of a run: the closure of tick t, and the blobs to supply before it.
pub trait Closures {
    fn closure(&self, tick: u32) -> Vec<u8>;
    fn blobs(&self, _tick: u32) -> Vec<Vec<u8>> {
        Vec::new()
    }
}

/// No actions at all.
#[derive(Clone, Copy, Debug)]
pub struct Idle;

impl Closures for Idle {
    fn closure(&self, _tick: u32) -> Vec<u8> {
        Vec::new()
    }
}

/// How a run differs from the reference.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Variant {
    /// The reference: as written.
    Plain,
    /// D18 b: every entity updated every tick, all wake logic bypassed (§4.6).
    NoSleep,
    /// D18 a: after tick `at`, `sim_save` and `sim_load` into a fresh module, then carry on.
    Reload { at: u32 },
    /// D18 c: every `every` ticks, a save and a load into a fresh module that carries on.
    Heavy { every: u32 },
}

/// Runs `ticks` ticks from the start state and records them. `hook` runs after every tick (tests use it to
/// break a run on purpose). The dense windows are the variant's own ([`windows_of`]); to compare it with another
/// run, record both with the union through [`record_windows`] (as [`check_equivalence`] does).
pub fn record_with(
    protos_bin: &[u8],
    start: &[u8],
    closures: &dyn Closures,
    ticks: u32,
    variant: Variant,
    schedule: Schedule,
    hook: &mut dyn FnMut(u32, &mut SimContext),
) -> SimResult<Trace> {
    record_windows(protos_bin, start, closures, ticks, variant, schedule, &windows_of(&[variant]), hook)
}

/// [`record_with`] with the dense windows given: every tick w … w + `schedule.every_tick_until` keeps its state for
/// each w in `windows` (the reloads of the runs this one is compared with). A reload (D18 a, or heavy mode's) is
/// checked at once: the fresh module's canonical state must equal the state it was saved from (else an error that
/// names the first differing field), and the state kept for that tick is the fresh module's.
#[allow(clippy::too_many_arguments)]
pub fn record_windows(
    protos_bin: &[u8],
    start: &[u8],
    closures: &dyn Closures,
    ticks: u32,
    variant: Variant,
    schedule: Schedule,
    windows: &[u32],
    hook: &mut dyn FnMut(u32, &mut SimContext),
) -> SimResult<Trace> {
    let flags = if variant == Variant::NoSleep { SimFlags::NO_SLEEP } else { SimFlags::EMPTY };
    let mut ctx = start_from(protos_bin, start, flags)?;
    let t0 = ctx.world().map_or(0, crate::World::current_tick);
    let last = t0 + ticks;
    let mut trace =
        vec![TickRecord { tick: t0, d: 0, r: ctx.lineage(), state: Some(canonical_state(&ctx)?) }];
    for t in t0 + 1..=last {
        for b in closures.blobs(t) {
            let mut input = crate::sha256::sha256(&b).to_vec();
            input.extend_from_slice(&b);
            ctx.blob_put(&input)?;
        }
        ctx.tick(&closures.closure(t))?;
        hook(t, &mut ctx);
        // the tick's digest and lineage are the module's that ran it (a fresh one has run no tick)
        let (d, r) = (ctx.last_digest(), ctx.lineage());
        let reload_now = match variant {
            Variant::Reload { at } => t == at,
            Variant::Heavy { every } => every > 0 && (t - t0) % every == 0,
            Variant::Plain | Variant::NoSleep => false,
        };
        if reload_now {
            let before = canonical_state(&ctx)?;
            ctx = reload(protos_bin, &ctx)?;
            let after = canonical_state(&ctx)?;
            if after != before {
                return Err(SimError::new(
                    schema::SimStatus::ErrInput,
                    format!(
                        "{variant:?}: the reload after tick {t} changed the state: {}",
                        diff_states(&before, &after).unwrap_or_else(|| "the states differ".into())
                    ),
                ));
            }
        }
        let state = if schedule.keeps(t, t0, last, windows) { Some(canonical_state(&ctx)?) } else { None };
        trace.push(TickRecord { tick: t, d, r, state });
    }
    Ok(trace)
}

/// [`record_with`] without a hook.
pub fn record(
    protos_bin: &[u8],
    start: &[u8],
    closures: &dyn Closures,
    ticks: u32,
    variant: Variant,
    schedule: Schedule,
) -> SimResult<Trace> {
    record_with(protos_bin, start, closures, ticks, variant, schedule, &mut |_, _| {})
}

/// Where two runs first differ.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Divergence {
    pub tick: u32,
    pub what: String,
}

impl core::fmt::Display for Divergence {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "the runs differ after tick {}: {}", self.tick, self.what)
    }
}

/// Compares two traces tick by tick: d_t, r_t, and the canonical state at every tick either kept. A tick that
/// one trace kept and the other did not is an error, not a skipped comparison: record both with the same
/// schedule and windows ([`record_windows`]).
pub fn compare(a: &Trace, b: &Trace) -> Result<(), Divergence> {
    if a.len() != b.len() {
        return Err(Divergence { tick: 0, what: format!("{} ticks against {}", a.len(), b.len()) });
    }
    for (x, y) in a.iter().zip(b) {
        let tick = x.tick;
        if x.state.is_some() != y.state.is_some() {
            return Err(Divergence {
                tick,
                what: "only one run kept its state here: record both with the same windows".into(),
            });
        }
        if let (Some(sa), Some(sb)) = (&x.state, &y.state)
            && sa != sb
        {
            return Err(Divergence {
                tick,
                what: diff_states(sa, sb).unwrap_or_else(|| "the states differ".into()),
            });
        }
        if x.d != y.d {
            return Err(Divergence { tick, what: format!("d_t {:016x} against {:016x}", x.d, y.d) });
        }
        if x.r != y.r {
            return Err(Divergence { tick, what: format!("r_t {:016x} against {:016x}", x.r, y.r) });
        }
    }
    Ok(())
}

/// Runs the reference and each variant and compares them (§10.2 `check_equivalence`).
pub fn check_equivalence(
    protos_bin: &[u8],
    start: &[u8],
    closures: &dyn Closures,
    ticks: u32,
    variants: &[Variant],
) -> Result<(), String> {
    let schedule = Schedule::default();
    // every run keeps the union of the reloads' dense windows, so each reload is compared tick by tick for the
    // 2,000 ticks after it however late it comes (§10.4 #3)
    let windows = windows_of(variants);
    let none = &mut |_: u32, _: &mut SimContext| {};
    let reference =
        record_windows(protos_bin, start, closures, ticks, Variant::Plain, schedule, &windows, none)
            .map_err(|e| e.to_string())?;
    for &v in variants {
        let run = record_windows(protos_bin, start, closures, ticks, v, schedule, &windows, none)
            .map_err(|e| format!("{v:?}: {e}"))?;
        compare(&reference, &run).map_err(|d| format!("{v:?}: {d}"))?;
    }
    Ok(())
}

/// The first difference between two canonical states (`SaveOutput` bytes, with or without the lineage):
/// the section, then the first differing line of the sections' dumps (decoded by the generated readers).
pub fn diff_states(a: &[u8], b: &[u8]) -> Option<String> {
    let fa = frames_of(a)?;
    let fb = frames_of(b)?;
    for (x, y) in fa.iter().zip(&fb) {
        if x.0 != y.0 {
            return Some(format!("section {} against section {}", x.0, y.0));
        }
        if x.1 == y.1 {
            continue;
        }
        let name = crate::r#gen::SECTIONS.iter().find(|i| i.section.value() == x.0).map_or("?", |i| i.name);
        let (da, db) = (dump_section(x.0, &x.1), dump_section(x.0, &y.1));
        for (i, (la, lb)) in da.lines().zip(db.lines()).enumerate() {
            if la != lb {
                return Some(format!("section {name}, line {i}: {la} against {lb}"));
            }
        }
        return Some(format!(
            "section {name}: {} bytes against {} (dumps of {} and {} lines)",
            x.1.len(),
            y.1.len(),
            da.lines().count(),
            db.lines().count()
        ));
    }
    if fa.len() != fb.len() {
        return Some(format!("{} sections against {}", fa.len(), fb.len()));
    }
    None
}

/// The sections of `SaveOutput` bytes; the trailing lineage may be absent.
fn frames_of(b: &[u8]) -> Option<Vec<(u32, Vec<u8>)>> {
    let mut whole = b.to_vec();
    let parsed =
        parse_save_output(&whole).ok().map(|(f, _)| f.iter().map(|x| (x.id, x.data.to_vec())).collect());
    if parsed.is_some() {
        return parsed;
    }
    whole.extend_from_slice(&[0; 8]);
    parse_save_output(&whole).ok().map(|(f, _)| f.iter().map(|x| (x.id, x.data.to_vec())).collect())
}

/// A section's text dump: records through their generated `dump`, column tables column by column.
pub fn dump_section(id: u32, bytes: &[u8]) -> String {
    let mut d = Dump::default();
    let Some(s) = SaveSection::from_value(id) else {
        return hex(bytes);
    };
    macro_rules! records {
        ($decode:ident, $name:literal) => {
            match $decode(bytes) {
                Ok(v) => {
                    for (i, x) in v.iter().enumerate() {
                        x.dump(&mut d, &format!("{}[{i}].", $name));
                    }
                }
                Err(e) => return format!("undecodable: {e}"),
            }
        };
    }
    match s {
        SaveSection::Globals => match decode_globals(bytes) {
            Ok(g) => g.dump(&mut d, "globals."),
            Err(e) => return format!("undecodable: {e}"),
        },
        SaveSection::SlotHeap => match decode_slot_heap(bytes) {
            Ok(h) => h.dump(&mut d, "slot_heap."),
            Err(e) => return format!("undecodable: {e}"),
        },
        SaveSection::Chunks => records!(decode_chunks, "chunks"),
        SaveSection::Timers => records!(decode_timers, "timers"),
        SaveSection::Rng => records!(decode_rng, "rng"),
        SaveSection::Players => records!(decode_players, "players"),
        SaveSection::Stats => records!(decode_stats, "stats"),
        SaveSection::WorldgenPending => records!(decode_worldgen_pending, "worldgen_pending"),
        SaveSection::Generated => records!(decode_generated, "generated"),
        SaveSection::EntityTable | SaveSection::PoolContainer => return dump_table(bytes),
        SaveSection::Cold
        | SaveSection::Charted
        | SaveSection::Thermal
        | SaveSection::Networks
        | SaveSection::Research
        | SaveSection::Blueprints
        | SaveSection::Undo
        | SaveSection::ClosureLog
        | SaveSection::Thumbnail => return hex(bytes),
    }
    d.out
}

/// A column table, one line per (row, column), read by its directory (§8.1).
fn dump_table(t: &[u8]) -> String {
    if t.len() < 8 {
        return hex(t);
    }
    let u32_at = |at: usize| u32::from_le_bytes([t[at], t[at + 1], t[at + 2], t[at + 3]]) as usize;
    let rows = u32_at(0);
    let n = usize::from(u16::from_le_bytes([t[4], t[5]]));
    let mut cols = Vec::new();
    let mut at = 8;
    for _ in 0..n {
        let len = usize::from(t[at]);
        let name = String::from_utf8_lossy(&t[at + 1..at + 1 + len]).into_owned();
        let code = t[at + 1 + len];
        at += 1 + len + 2;
        let (off, bytes) = (u32_at(at), u32_at(at + 4));
        at += 8;
        cols.push((name, code, off, bytes.checked_div(rows).unwrap_or(0)));
    }
    let mut out = format!("rows={rows}\n");
    for i in 0..rows {
        for (name, code, off, w) in &cols {
            let b = &t[off + i * w..off + (i + 1) * w];
            let mut v = [0u8; 8];
            v[..b.len()].copy_from_slice(b);
            let raw = u64::from_le_bytes(v);
            let value = match code {
                5 => format!("{}", raw as u8 as i8),
                6 => format!("{}", raw as u16 as i16),
                7 => format!("{}", raw as u32 as i32),
                8 => format!("{}", raw as i64),
                9 => format!("f32:{:08x}", raw as u32),
                10 => format!("f64:{raw:016x}"),
                _ => format!("{raw}"),
            };
            out.push_str(&format!("row[{i}].{name}={value}\n"));
        }
    }
    out
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
