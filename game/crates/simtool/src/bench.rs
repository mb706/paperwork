//! `simtool bench` (10 §10.6): the M0 scenarios of `sim::testkit::bench`, timed natively with §10.6's method,
//! compared with their thresholds, and appended to `bench/history.jsonl`.
//!
//! **Method** (§10.6, A1): warm up 6,000 ticks, time 3,600 ticks one by one, then 600 with per-phase timers
//! (`PROFILE` and this process's clock); repeat 3 times and pool the timed ticks. `--quick` (`ci`'s budget gate)
//! warms up 600 ticks and times one repetition. Pin the run (`taskset -c 0-15`) and check the load first.
//!
//! **Gates.** A full run checks §10.6's thresholds ([`bench::thresholds`]); `--quick`, `ci`'s budget gate, checks
//! the tails ([`bench::budgets`]: every tick p99 against §11's 2 ms, each operation's worst call). A metric
//! passes when it meets its limit on the reference machine times [`HOST_FACTOR`] (this host is about 2.4 × slower,
//! §11; a count is not scaled); the table shows both. `bench` exits 1 when a gate fails.
//!
//! **Clocks** (§10.6): a thread samples the pinned cores' clocks every 20 ms during each timed window; a window
//! whose cores ran above the base clock (turbo) is flagged, and so is the scenario's result in the history.
//!
//! **Memory and allocations.** Natively the runner reports the process's resident set (`VmRSS`, `VmHWM`).
//! Counting allocations needs a global allocator, which is `unsafe` code, and §2.2 keeps that to the ABI
//! crates: the module's counter (`sim_allocs`, simcheck) and the sim's allocation gate (tests/core/alloc_free.rs:
//! 6,000 steady-state ticks of each scenario allocate nothing) cover them.

use crate::hex;
use sim::SimContext;
use sim::testkit::bench::{self, Bench, HOST_FACTOR, Threshold};
use std::fmt::Write as _;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// One timed window's clocks: the pinned cores' highest clock per sample, summarised.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct WindowClock {
    pub samples: u32,
    pub min_mhz: f64,
    pub mean_mhz: f64,
    pub max_mhz: f64,
    /// Above the base clock: the window ran in turbo.
    pub turbo: bool,
}

/// The CPUs this process may run on (`Cpus_allowed_list` of /proc/self/status, e.g. `0-15`).
fn pinned_cpus() -> Vec<usize> {
    let text = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
    let list =
        text.lines().find_map(|l| l.strip_prefix("Cpus_allowed_list:")).unwrap_or("").trim().to_owned();
    cpu_list(&list)
}

/// A kernel CPU list (`0-15`, `0,2-4`).
fn cpu_list(list: &str) -> Vec<usize> {
    let mut out = Vec::new();
    for part in list.split(',').filter(|p| !p.is_empty()) {
        let mut ends = part.split('-').filter_map(|x| x.trim().parse::<usize>().ok());
        if let Some(a) = ends.next() {
            let b = ends.next().unwrap_or(a);
            out.extend(a..=b);
        }
    }
    out
}

/// The processor's base clock in MHz, from its model name (`… @ 2.60GHz`); 0 when unknown.
fn base_mhz() -> f64 {
    let text = std::fs::read_to_string("/proc/cpuinfo").unwrap_or_default();
    text.lines()
        .find(|l| l.starts_with("model name"))
        .and_then(|l| l.rsplit('@').next())
        .and_then(|g| g.trim().strip_suffix("GHz"))
        .and_then(|g| g.trim().parse::<f64>().ok())
        .map_or(0.0, |g| g * 1000.0)
}

/// A clock sampler for one timed window (§10.6's clock log): a thread that reads the pinned cores' current
/// clocks (sysfs `scaling_cur_freq`) every 20 ms until stopped.
pub struct Sampler {
    stop: Arc<AtomicBool>,
    thread: std::thread::JoinHandle<Vec<f64>>,
}

impl Sampler {
    pub fn start() -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);
        let cpus = pinned_cpus();
        let thread = std::thread::spawn(move || {
            let mut samples = Vec::new();
            loop {
                let mhz = cpus
                    .iter()
                    .filter_map(|c| {
                        std::fs::read_to_string(format!(
                            "/sys/devices/system/cpu/cpu{c}/cpufreq/scaling_cur_freq"
                        ))
                        .ok()
                    })
                    .filter_map(|t| t.trim().parse::<f64>().ok())
                    .fold(0.0f64, |m, khz| if khz / 1000.0 > m { khz / 1000.0 } else { m });
                if mhz > 0.0 {
                    samples.push(mhz);
                }
                if flag.load(Ordering::Relaxed) {
                    return samples;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        });
        Self { stop, thread }
    }

    pub fn stop(self) -> WindowClock {
        self.stop.store(true, Ordering::Relaxed);
        let samples = self.thread.join().unwrap_or_default();
        if samples.is_empty() {
            return WindowClock::default();
        }
        let n = samples.len() as f64;
        let min = samples.iter().copied().fold(f64::INFINITY, |a, b| if b < a { b } else { a });
        let max = samples.iter().copied().fold(0.0f64, |a, b| if b > a { b } else { a });
        let base = base_mhz();
        WindowClock {
            samples: samples.len() as u32,
            min_mhz: min,
            mean_mhz: samples.iter().sum::<f64>() / n,
            max_mhz: max,
            turbo: base > 0.0 && max > base + 50.0,
        }
    }
}

/// How long each part of a run is (§10.6; `--quick` for `ci`).
#[derive(Clone, Copy, Debug)]
pub struct Plan {
    pub warmup: u32,
    pub timed: u32,
    pub profiled: u32,
    pub reps: u32,
    pub quick: bool,
}

impl Plan {
    pub fn full() -> Self {
        Self { warmup: 6_000, timed: 3_600, profiled: 600, reps: 3, quick: false }
    }

    pub fn quick() -> Self {
        Self { warmup: 600, timed: 3_600, profiled: 600, reps: 1, quick: true }
    }
}

/// A scenario's measurements: named values, the per-phase µs and the process's memory.
#[derive(Clone, Debug, Default)]
pub struct Report {
    pub scenario: String,
    /// The repetitions the scenario ran (§10.6: at least 3; `m0-walk` 7).
    pub reps: u32,
    pub metrics: Vec<(String, f64)>,
    /// The mean µs of each of §4.6's 16 phases over the profiled ticks.
    pub phase_us: Vec<f64>,
    /// The resident set after the run and its peak, KiB.
    pub rss_kib: u64,
    pub hwm_kib: u64,
    /// The clocks of each timed window.
    pub windows: Vec<WindowClock>,
    pub notes: Vec<String>,
}

impl Report {
    fn set(&mut self, k: &str, v: f64) {
        self.metrics.push((k.to_owned(), v));
    }

    pub fn get(&self, k: &str) -> Option<f64> {
        self.metrics.iter().find(|m| m.0 == k).map(|m| m.1)
    }
}

/// The clock `PROFILE` reads (ms since the first call).
fn now_ms() -> f64 {
    use std::sync::OnceLock;
    static T0: OnceLock<Instant> = OnceLock::new();
    T0.get_or_init(Instant::now).elapsed().as_secs_f64() * 1e3
}

fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1e3
}

/// Mean, p50, p90, p99 and maximum of `xs` (sorted here).
fn stats(xs: &mut [f64]) -> [f64; 5] {
    xs.sort_by(f64::total_cmp);
    let n = xs.len().max(1);
    let at = |q: f64| xs.get(((n as f64 * q) as usize).min(n - 1)).copied().unwrap_or(0.0);
    [xs.iter().sum::<f64>() / n as f64, at(0.50), at(0.90), at(0.99), xs.last().copied().unwrap_or(0.0)]
}

fn put_ticks(r: &mut Report, prefix: &str, xs: &mut [f64]) {
    let [mean, p50, p90, p99, max] = stats(xs);
    r.set(&format!("{prefix}_mean_ms"), mean);
    r.set(&format!("{prefix}_p50_ms"), p50);
    r.set(&format!("{prefix}_p90_ms"), p90);
    r.set(&format!("{prefix}_p99_ms"), p99);
    r.set(&format!("{prefix}_max_ms"), max);
}

/// Runs `n` ticks of `b` with empty closures (the scenario's actions were queued at its start), timing each
/// when `times` is given; `view` adds an extraction per tick, timed into `extracts`.
fn ticks(
    b: &mut Bench,
    n: u32,
    mut times: Option<&mut Vec<f64>>,
    view: Option<&[u8]>,
    mut extracts: Option<&mut Vec<f64>>,
    out: &mut Vec<u8>,
) -> Result<(), String> {
    for _ in 0..n {
        let closure = b.next_closure();
        let t = Instant::now();
        b.ctx.tick(&closure).map_err(|e| e.to_string())?;
        if let Some(ts) = times.as_deref_mut() {
            ts.push(ms(t));
        }
        // The shell's per-tick calls (§3.6 audit: sim_digest, sim_pending_chunks), untimed.
        out.clear();
        b.ctx.digest_into(out).map_err(|e| e.to_string())?;
        out.clear();
        b.ctx.pending_chunks_into(out).map_err(|e| e.to_string())?;
        if let Some(v) = view {
            out.clear();
            let t = Instant::now();
            b.ctx.extract_into(v, out).map_err(|e| e.to_string())?;
            if let Some(es) = extracts.as_deref_mut() {
                es.push(ms(t));
            }
        }
    }
    Ok(())
}

/// The profiled ticks: `PROFILE` on, the per-phase µs summed into `sum`.
fn profiled(b: &mut Bench, n: u32, sum: &mut [f64; 16], out: &mut Vec<u8>) -> Result<(), String> {
    b.ctx.set_clock(now_ms);
    let flags = b.ctx.flags();
    b.ctx.set_flags((flags | schema::SimFlags::PROFILE).bits()).map_err(|e| e.to_string())?;
    for _ in 0..n {
        ticks(b, 1, None, None, None, out)?;
        if let Some(us) = b.ctx.phase_us() {
            for (s, &x) in sum.iter_mut().zip(us.iter()) {
                *s += f64::from(x);
            }
        }
    }
    b.ctx.set_flags(flags.bits()).map_err(|e| e.to_string())?;
    Ok(())
}

/// The tick part of the method on `b`: warm-up, then `reps` × (timed, profiled); the timed ticks pooled.
fn tick_method(
    b: &mut Bench,
    plan: Plan,
    view: Option<&[u8]>,
    r: &mut Report,
) -> Result<(Vec<f64>, Vec<f64>), String> {
    let mut out = Vec::with_capacity(1 << 20);
    ticks(b, plan.warmup, None, view, None, &mut out)?;
    let (mut times, mut extracts) = (Vec::new(), Vec::new());
    let mut sum = [0.0; 16];
    for _ in 0..plan.reps {
        let clock = Sampler::start();
        ticks(b, plan.timed, Some(&mut times), view, Some(&mut extracts), &mut out)?;
        r.windows.push(clock.stop());
        profiled(b, plan.profiled, &mut sum, &mut out)?;
    }
    let n = f64::from(plan.reps * plan.profiled).max(1.0);
    r.phase_us = sum.iter().map(|s| s / n).collect();
    Ok((times, extracts))
}

/// A `/proc/self/status` field in KiB.
fn status_kib(field: &str) -> u64 {
    let text = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
    text.lines()
        .find(|l| l.starts_with(field))
        .and_then(|l| l.split_whitespace().nth(1)?.parse().ok())
        .unwrap_or(0)
}

fn finish(r: &mut Report) {
    r.rss_kib = status_kib("VmRSS:");
    r.hwm_kib = status_kib("VmHWM:");
}

/// `m0-walk`: the full plan repeats 7 times, so that the walk lasts its 10 minutes (6,000 + 7 × 4,200 ticks).
pub fn walk(protos: &[u8], mut plan: Plan) -> Result<Report, String> {
    if !plan.quick {
        plan.reps = plan.reps.max(7);
    }
    let mut r = Report { scenario: "m0-walk".to_owned(), reps: plan.reps, ..Report::default() };
    let mut b = bench::m0_walk(protos).map_err(|e| e.to_string())?;
    let (mut times, _) = tick_method(&mut b, plan, None, &mut r)?;
    put_ticks(&mut r, "tick", &mut times);
    let w = b.ctx.world().ok_or("no world")?;
    let p = w.players.get(schema::PlayerIndex(0)).ok_or("no player 0")?;
    r.set("walked_tiles", p.x);
    r.set("generated_chunks", w.chunks.generated().len() as f64);
    finish(&mut r);
    Ok(r)
}

/// `m0-chests-10k`.
pub fn chests(protos: &[u8], plan: Plan) -> Result<Report, String> {
    let mut r = Report { scenario: "m0-chests-10k".to_owned(), reps: plan.reps, ..Report::default() };
    let (mut b, _) = bench::m0_chests_10k(protos).map_err(|e| e.to_string())?;
    let view = b.view.clone();
    // The first two packets (the FULL one and the held chunks' contents) are not the steady state.
    for _ in 0..2 {
        b.ctx.extract(&view).map_err(|e| e.to_string())?;
    }
    let (mut times, mut extracts) = tick_method(&mut b, plan, Some(&view), &mut r)?;
    put_ticks(&mut r, "tick", &mut times);
    put_ticks(&mut r, "extract", &mut extracts);
    // Save, load and the full state hash, each timed `reps` × 5 times; the minimum is noise-free, the mean
    // is the gated value.
    let n = plan.reps * 5;
    let (mut save, mut load, mut hash) = (Vec::new(), Vec::new(), Vec::new());
    let mut state = Vec::new();
    let clock = Sampler::start();
    for _ in 0..n {
        let t = Instant::now();
        state = b.ctx.checkpoint().map_err(|e| e.to_string())?;
        save.push(ms(t));
        let t = Instant::now();
        let h = b.ctx.state_hashes().map_err(|e| e.to_string())?;
        hash.push(ms(t));
        let mut c = SimContext::new();
        c.init_protos(protos, schema::SimFlags::EMPTY).map_err(|e| e.to_string())?;
        let input = state_input(&state)?;
        let t = Instant::now();
        c.load(&input).map_err(|e| e.to_string())?;
        load.push(ms(t));
        if c.state_hashes().map_err(|e| e.to_string())?.full != h.full {
            return Err("m0-chests-10k: the loaded state hashes differently".to_owned());
        }
    }
    r.windows.push(clock.stop());
    for (k, xs) in [("save", &mut save), ("load", &mut load), ("hash", &mut hash)] {
        let [mean, .., max] = stats(xs);
        r.set(&format!("{k}_ms"), mean);
        r.set(&format!("{k}_max_ms"), max);
    }
    r.set("save_bytes", state.len() as f64);
    finish(&mut r);
    Ok(r)
}

/// `m0-codec`: per repetition, 1,000 ticks of 100 actions: encoding (the sequencer writes the closures) and
/// applying (`sim_tick`: the preflight's frame check, then the rules).
pub fn codec(protos: &[u8], plan: Plan) -> Result<Report, String> {
    let mut r = Report { scenario: "m0-codec".to_owned(), reps: plan.reps, ..Report::default() };
    let (mut b, chest) = bench::m0_codec(protos).map_err(|e| e.to_string())?;
    let per_tick = u32::from(bench::CODEC_PLAYERS) * bench::CODEC_ACTIONS_PER_PLAYER;
    let ticks_per_rep = 100_000 / per_tick;
    let mut events = Vec::with_capacity(1 << 20);
    let mut windows = Vec::new();
    let mut run = |b: &mut Bench, n: u32| -> Result<(f64, f64), String> {
        let t0 = b.tick();
        let clock = Sampler::start();
        let t = Instant::now();
        let mut closures = Vec::with_capacity(n as usize);
        for t in t0 + 1..=t0 + n {
            bench::codec_tick(b, t, chest).map_err(|e| e.to_string())?;
            closures.push(b.seq.closure(t));
        }
        let encode = ms(t);
        let t = Instant::now();
        for c in &closures {
            b.ctx.tick(c).map_err(|e| e.to_string())?;
            events.clear();
            b.ctx.pres.events.drain(&mut events);
        }
        let apply = ms(t);
        windows.push(clock.stop());
        Ok((encode, apply))
    };
    run(&mut b, if plan.quick { 100 } else { ticks_per_rep })?;
    let (mut enc, mut app) = (0.0, 0.0);
    for _ in 0..plan.reps {
        let (e, a) = run(&mut b, ticks_per_rep)?;
        enc += e;
        app += a;
    }
    r.windows = windows.split_off(1);
    let actions = f64::from(plan.reps * ticks_per_rep * per_tick);
    r.set("actions", actions);
    r.set("encode_ms", enc);
    r.set("apply_ms", app);
    r.set("encode_actions_per_s", actions / (enc / 1e3));
    r.set("apply_actions_per_s", actions / (app / 1e3));
    r.set("actions_per_s", actions / ((enc + app) / 1e3));
    finish(&mut r);
    Ok(r)
}

/// `m0-load-30k`: the state comes from `cached` (built by the factory when missing).
pub fn load(protos: &[u8], plan: Plan, state: &[u8]) -> Result<Report, String> {
    let mut r =
        Report { scenario: "m0-load-30k".to_owned(), reps: plan.reps.max(1) * 2, ..Report::default() };
    let input = state_input(state)?;
    let mut loads = Vec::new();
    let mut ctx = None;
    let clock = Sampler::start();
    for _ in 0..plan.reps.max(1) * 2 {
        let mut c = SimContext::new();
        c.init_protos(protos, schema::SimFlags::EMPTY).map_err(|e| e.to_string())?;
        let t = Instant::now();
        c.load(&input).map_err(|e| e.to_string())?;
        loads.push(ms(t));
        ctx = Some(c);
    }
    r.windows.push(clock.stop());
    let [mean, .., max] = stats(&mut loads);
    r.set("load_ms", mean);
    r.set("load_max_ms", max);
    r.set("state_bytes", state.len() as f64);
    let c = ctx.ok_or("no load")?;
    let w = c.world().ok_or("no world")?;
    r.set("generated_chunks", w.chunks.generated().len() as f64);
    r.set("regenerated_by_load", w.regen.generated() as f64);
    // The next 600 ticks: player 0 walks east through pristine chunks; extraction of its view every tick.
    let mut b = bench::m0_load_30k_walk(c).map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(1 << 20);
    let (mut most, mut most_extract, mut times) = (0u64, 0u64, Vec::new());
    let clock = Sampler::start();
    for _ in 0..600 {
        let g = b.ctx.world().ok_or("no world")?.regen.generated();
        ticks(&mut b, 1, Some(&mut times), None, None, &mut out)?;
        let g2 = b.ctx.world().ok_or("no world")?.regen.generated();
        most = most.max(g2 - g);
        let p = b.ctx.world().ok_or("no world")?.players.get(schema::PlayerIndex(0)).ok_or("no player")?;
        let view = bench::view_around(p.x.floor() as i32, p.y.floor() as i32, 0);
        out.clear();
        let e = b.ctx.pres.extract.generated();
        b.ctx.extract_into(&view, &mut out).map_err(|e| e.to_string())?;
        if b.ctx.world().ok_or("no world")?.regen.generated() != g2 {
            return Err("m0-load-30k: an extraction wrote the World's regeneration cache".to_owned());
        }
        most_extract = most_extract.max(b.ctx.pres.extract.generated() - e);
    }
    r.windows.push(clock.stop());
    r.set("max_regenerations_per_tick", most as f64);
    r.set("max_regenerations_per_extraction", most_extract as f64);
    put_ticks(&mut r, "tick", &mut times);
    finish(&mut r);
    Ok(r)
}

/// `LoadInput` from `SaveOutput` bytes.
fn state_input(state: &[u8]) -> Result<Vec<u8>, String> {
    let (frames, r) = sim::save::parse_save_output(state).map_err(|e| e.to_string())?;
    Ok(sim::save::load_input(&frames, r))
}

/// The gate of one threshold: (value, reference limit, host limit, pass).
pub fn gate(r: &Report, t: &Threshold) -> Option<(f64, f64, bool)> {
    let v = r.get(t.metric)?;
    let host = match (t.scales, t.floor) {
        (false, _) => t.limit,
        (true, true) => t.limit / HOST_FACTOR,
        (true, false) => t.limit * HOST_FACTOR,
    };
    let pass = if t.floor { v >= host } else { v <= host };
    Some((v, host, pass))
}

/// The gates of a run: §10.6's thresholds for a full run, the budget gate's tails for `--quick`.
pub fn gates(scenario: &str, quick: bool) -> &'static [Threshold] {
    if quick { bench::budgets(scenario) } else { bench::thresholds(scenario) }
}

/// The report as a table.
pub fn table(r: &Report, quick: bool) -> String {
    let mut s = String::new();
    let _ = writeln!(s, "{}{}", r.scenario, if quick { " (budget gate: tails)" } else { "" });
    for t in gates(&r.scenario, quick) {
        if let Some((v, host, pass)) = gate(r, t) {
            let reference = if t.floor { v >= t.limit } else { v <= t.limit };
            let _ = writeln!(
                s,
                "  {:<28} {:>14.4} {:<9} reference {} {:<10} {}  host gate {} {:<10.4} {}",
                t.metric,
                v,
                t.unit,
                if t.floor { "≥" } else { "≤" },
                t.limit,
                if reference { "met" } else { "MISSED" },
                if t.floor { "≥" } else { "≤" },
                host,
                if pass { "pass" } else { "FAIL" }
            );
        }
    }
    for (k, v) in &r.metrics {
        if !gates(&r.scenario, quick).iter().any(|t| t.metric == k) {
            let _ = writeln!(s, "  {k:<28} {v:>14.4}");
        }
    }
    if !r.windows.is_empty() {
        let turbo = r.windows.iter().filter(|w| w.turbo).count();
        let lo = r.windows.iter().map(|w| w.min_mhz).fold(f64::INFINITY, |a, b| if b < a { b } else { a });
        let hi = r.windows.iter().map(|w| w.max_mhz).fold(0.0f64, |a, b| if b > a { b } else { a });
        let _ = writeln!(
            s,
            "  clock in timed windows       {lo:.0}–{hi:.0} MHz; turbo in {turbo} of {} windows{}",
            r.windows.len(),
            if turbo > 0 { " (flagged: not an absolute number)" } else { "" }
        );
    }
    if !r.phase_us.is_empty() && r.phase_us.iter().any(|&x| x > 0.0) {
        let phases: Vec<String> = r
            .phase_us
            .iter()
            .enumerate()
            .filter(|(_, x)| **x > 0.05)
            .map(|(i, x)| format!("{}:{x:.1}", i + 1))
            .collect();
        let _ = writeln!(s, "  phase µs (mean)              {}", phases.join(" "));
    }
    let _ = writeln!(s, "  resident set {} KiB, peak {} KiB", r.rss_kib, r.hwm_kib);
    for n in &r.notes {
        let _ = writeln!(s, "  note: {n}");
    }
    s
}

fn json_str(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            c if (c as u32) < 0x20 => {
                let _ = write!(o, "\\u{:04x}", c as u32);
            }
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn json_num(v: f64) -> String {
    if v.is_finite() { format!("{v}") } else { "null".to_owned() }
}

/// The host's state for the history: the git commit, the load, the clock before and after, the pinned CPUs.
pub struct Host {
    pub git: String,
    pub dirty: bool,
    pub load: String,
    pub mhz: f64,
    pub cpus: String,
}

pub fn host() -> Host {
    let git = |args: &[&str]| {
        std::process::Command::new("git")
            .args(args)
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned())
    };
    let load = std::fs::read_to_string("/proc/loadavg").unwrap_or_default().trim().to_owned();
    let cpus = std::fs::read_to_string("/proc/self/status")
        .unwrap_or_default()
        .lines()
        .find_map(|l| l.strip_prefix("Cpus_allowed_list:").map(|x| x.trim().to_owned()))
        .unwrap_or_default();
    Host {
        git: git(&["rev-parse", "HEAD"]).unwrap_or_default(),
        // The history file itself does not make a run dirty (it is appended to as the run goes).
        dirty: git(&[
            "status",
            "--porcelain",
            "--untracked-files=no",
            "--",
            ":/",
            ":(exclude,glob)**/bench/history.jsonl",
        ])
        .is_some_and(|s| !s.is_empty()),
        load,
        mhz: mhz(),
        cpus,
    }
}

/// The cost of one clock read in µs (this host's clocksource is HPET: about 0.6 µs, so each timed tick carries
/// about two reads, and an empty phase of the profile shows about two).
pub fn clock_read_us() -> f64 {
    let n = 20_000;
    let t = Instant::now();
    let mut last = t;
    for _ in 0..n {
        last = Instant::now();
    }
    last.duration_since(t).as_secs_f64() * 1e6 / f64::from(n)
}

/// The mean clock of the host's cores (MHz, /proc/cpuinfo).
pub fn mhz() -> f64 {
    let text = std::fs::read_to_string("/proc/cpuinfo").unwrap_or_default();
    let v: Vec<f64> = text
        .lines()
        .filter(|l| l.starts_with("cpu MHz"))
        .filter_map(|l| l.split(':').nth(1)?.trim().parse().ok())
        .collect();
    if v.is_empty() { 0.0 } else { v.iter().sum::<f64>() / v.len() as f64 }
}

/// One `history.jsonl` line (also `--json`'s output).
pub fn history_line(r: &Report, plan: Plan, before: &Host, mhz_after: f64, gate_ok: bool) -> String {
    let mut s = String::from("{");
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let _ = write!(
        s,
        "\"ts\":{ts},\"git\":{},\"dirty\":{},\"scenario\":{},\"runner\":\"simtool native\",\"quick\":{},\"reps\":{},",
        json_str(&before.git),
        before.dirty,
        json_str(&r.scenario),
        plan.quick,
        r.reps
    );
    let metrics: Vec<String> =
        r.metrics.iter().map(|(k, v)| format!("{}:{}", json_str(k), json_num(*v))).collect();
    let _ = write!(s, "\"metrics\":{{{}}},", metrics.join(","));
    let phases: Vec<String> = r.phase_us.iter().map(|v| json_num(*v)).collect();
    let _ = write!(s, "\"phase_us\":[{}],", phases.join(","));
    let _ = write!(
        s,
        "\"rss_kib\":{},\"hwm_kib\":{},\"gate\":{},\"host_factor\":{HOST_FACTOR},",
        r.rss_kib,
        r.hwm_kib,
        json_str(if gate_ok { "pass" } else { "fail" })
    );
    let windows: Vec<String> = r
        .windows
        .iter()
        .map(|w| {
            format!(
                "{{\"samples\":{},\"min_mhz\":{},\"mean_mhz\":{},\"max_mhz\":{},\"turbo\":{}}}",
                w.samples,
                json_num(w.min_mhz),
                json_num(w.mean_mhz),
                json_num(w.max_mhz),
                w.turbo
            )
        })
        .collect();
    let turbo = r.windows.iter().any(|w| w.turbo);
    let _ = write!(
        s,
        "\"flags\":[{}],\"clock_windows\":[{}],",
        if turbo { "\"turbo\"" } else { "" },
        windows.join(",")
    );
    let _ = write!(
        s,
        "\"host\":{{\"loadavg\":{},\"mhz_before\":{},\"mhz_after\":{},\"cpus\":{}}}}}",
        json_str(&before.load),
        json_num(before.mhz),
        json_num(mhz_after),
        json_str(&before.cpus)
    );
    s
}

/// The cached `m0-load-30k` state under `dir`, keyed by the prototypes, the worldgen version and the factory.
pub fn load_state(protos: &[u8], dir: &str) -> Result<(Vec<u8>, bool), String> {
    let key = format!(
        "{dir}/m0-load-30k-{}-w{}-f{}.state",
        &hex(&sim::sha256::sha256(protos))[..16],
        sim::save::WORLDGEN_VERSION,
        bench::LOAD_FACTORY_VERSION
    );
    if let Ok(b) = std::fs::read(&key) {
        return Ok((b, true));
    }
    let state = bench::m0_load_state(protos, bench::LOAD_CHUNKS).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("{dir}: {e}"))?;
    std::fs::write(&key, &state).map_err(|e| format!("{key}: {e}"))?;
    Ok((state, false))
}

/// One gate as JSON.
fn gate_json(t: &Threshold) -> String {
    format!(
        "{{\"metric\":{},\"limit\":{},\"unit\":{},\"floor\":{},\"scales\":{}}}",
        json_str(t.metric),
        json_num(t.limit),
        json_str(t.unit),
        t.floor,
        t.scales
    )
}

/// `--write-scenarios <dir>` (§10.6's WebAssembly runners, C2c-r1 finding 8): each scenario's start state
/// (`sim_save`'s output) and inputs, the prototypes, and `scenarios.json` with the method and both gate sets,
/// so `bench/node-runner.ts` times the same work through sim.wasm's ABI.
pub fn write_scenarios(protos: &[u8], dir: &str, cache: &str) -> Result<(), String> {
    let path = |f: &str| format!("{dir}/{f}");
    let write = |f: &str, b: &[u8]| std::fs::write(path(f), b).map_err(|e| format!("{}: {e}", path(f)));
    std::fs::create_dir_all(dir).map_err(|e| format!("{dir}: {e}"))?;
    write("prototypes.bin", protos)?;
    let err = |e: sim::SimError| e.to_string();
    // m0-walk: joined and walking (ticks 1 and 2 ran); then empty closures.
    let mut b = bench::m0_walk(protos).map_err(err)?;
    b.run(2).map_err(err)?;
    write("m0-walk.state", &b.ctx.checkpoint().map_err(err)?)?;
    // m0-chests-10k: after the join; its 32 windows and its view.
    let (b, windows) = bench::m0_chests_10k(protos).map_err(err)?;
    write("m0-chests-10k.state", &b.ctx.checkpoint().map_err(err)?)?;
    write("m0-chests-10k.subs", &bench::chest_windows(&windows).map_err(err)?)?;
    write("m0-chests-10k.view", &b.view)?;
    // m0-codec: 100 warm-up ticks and three repetitions of 1,000 ticks, 100 actions each.
    let (mut b, chest) = bench::m0_codec(protos).map_err(err)?;
    write("m0-codec.state", &b.ctx.checkpoint().map_err(err)?)?;
    let t0 = b.tick();
    let mut records = Vec::new();
    for t in t0 + 1..=t0 + 3_100 {
        bench::codec_tick(&mut b, t, chest).map_err(err)?;
        records.push((t, b.seq.closure(t)));
    }
    write("m0-codec.pwlog", &bench::closure_log(protos, t0, t0 + 3_100, &records).map_err(err)?)?;
    // m0-load-30k: the cached state, and the walk that starts at its next tick.
    let (state, _) = load_state(protos, cache)?;
    write("m0-load-30k.state", &state)?;
    let mut c = SimContext::new();
    c.init_protos(protos, schema::SimFlags::EMPTY).map_err(err)?;
    c.load(&state_input(&state)?).map_err(err)?;
    let mut w = bench::m0_load_30k_walk(c).map_err(err)?;
    let t1 = w.tick() + 1;
    let walk = vec![(t1, w.next_closure())];
    write("m0-load-30k.pwlog", &bench::closure_log(protos, t1 - 1, t1 + 599, &walk).map_err(err)?)?;
    let full = Plan::full();
    let quick = Plan::quick();
    let scenarios: Vec<String> = bench::SCENARIOS
        .iter()
        .map(|&name| {
            let has = |ext: &str| std::path::Path::new(&path(&format!("{name}.{ext}"))).exists();
            let file = |ext: &str| if has(ext) { json_str(&format!("{name}.{ext}")) } else { "null".to_owned() };
            let reps = if name == "m0-walk" { full.reps.max(7) } else { full.reps };
            let g = |list: &[Threshold]| list.iter().map(gate_json).collect::<Vec<_>>().join(",");
            format!(
                "{{\"name\":{},\"state\":{},\"log\":{},\"subs\":{},\"view\":{},\"full\":{{\"warmup\":{},\"timed\":{},\"reps\":{}}},\"quick\":{{\"warmup\":{},\"timed\":{},\"reps\":{}}},\"thresholds\":[{}],\"budgets\":[{}]}}",
                json_str(name),
                file("state"),
                file("pwlog"),
                file("subs"),
                file("view"),
                full.warmup,
                full.timed,
                reps,
                quick.warmup,
                quick.timed,
                quick.reps,
                g(bench::thresholds(name)),
                g(bench::budgets(name))
            )
        })
        .collect();
    let json = format!(
        "{{\"host_factor\":{HOST_FACTOR},\"protos\":\"prototypes.bin\",\"scenarios\":[{}]}}\n",
        scenarios.join(",")
    );
    write("scenarios.json", json.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_lists_and_gates() {
        assert_eq!(cpu_list("0-3,8,10-11"), [0, 1, 2, 3, 8, 10, 11]);
        assert_eq!(cpu_list(""), Vec::<usize>::new());
        let mut r = Report { scenario: "m0-walk".to_owned(), ..Report::default() };
        r.metrics.push(("tick_p99_ms".to_owned(), 4.0));
        // The budget gate: 2 ms × 2.4 on this host; the reference limit is missed, the host gate passes.
        let g = gates("m0-walk", true)[0];
        assert_eq!(g.metric, "tick_p99_ms");
        assert_eq!(gate(&r, &g), Some((4.0, 4.8, true)));
        // A count is not scaled.
        let regen =
            gates("m0-load-30k", true).iter().find(|t| t.metric == "max_regenerations_per_tick").copied();
        let mut l = Report { scenario: "m0-load-30k".to_owned(), ..Report::default() };
        l.metrics.push(("max_regenerations_per_tick".to_owned(), 9.0));
        assert_eq!(gate(&l, &regen.expect("a regeneration gate")), Some((9.0, 8.0, false)));
    }
}
