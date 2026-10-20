//! `simtool bench` (10 §10.6): the M0 scenarios of `sim::testkit::bench`, timed natively with §10.6's method,
//! compared with their thresholds, and appended to `bench/history.jsonl`.
//!
//! **Method** (§10.6, A1): warm up 6,000 ticks, time 3,600 ticks one by one, then 600 with per-phase timers
//! (`PROFILE` and this process's clock); repeat 3 times and pool the timed ticks. `--quick` (`ci`'s budget gate)
//! warms up 600 ticks and times one repetition. Pin the run (`taskset -c 0-15`) and check the load first.
//!
//! **Gate.** A metric passes when it meets its threshold on the reference machine times [`HOST_FACTOR`] (this
//! host is about 2.4 × slower, §11); the table shows both. `bench` exits 1 when a gate fails.
//!
//! **Memory and allocations.** Natively the runner reports the process's resident set (`VmRSS`, `VmHWM`).
//! Counting allocations needs a global allocator, which is `unsafe` code, and §2.2 keeps that to the ABI
//! crates: the module's counter (`sim_allocs`, simcheck) and the sim's allocation gate (tests/core/alloc_free.rs:
//! 6,000 steady-state ticks of each scenario allocate nothing) cover them.

use crate::hex;
use sim::SimContext;
use sim::testkit::bench::{self, Bench, HOST_FACTOR, Threshold};
use std::fmt::Write as _;
use std::time::Instant;

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
    pub metrics: Vec<(String, f64)>,
    /// The mean µs of each of §4.6's 16 phases over the profiled ticks.
    pub phase_us: Vec<f64>,
    /// The resident set after the run and its peak, KiB.
    pub rss_kib: u64,
    pub hwm_kib: u64,
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
        ticks(b, plan.timed, Some(&mut times), view, Some(&mut extracts), &mut out)?;
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
    let mut r = Report { scenario: "m0-walk".to_owned(), ..Report::default() };
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
    let mut r = Report { scenario: "m0-chests-10k".to_owned(), ..Report::default() };
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
    for (k, xs) in [("save_ms", &mut save), ("load_ms", &mut load), ("hash_ms", &mut hash)] {
        let [mean, ..] = stats(xs);
        r.set(k, mean);
    }
    r.set("save_bytes", state.len() as f64);
    finish(&mut r);
    Ok(r)
}

/// `m0-codec`: per repetition, 1,000 ticks of 100 actions: encoding (the sequencer writes the closures) and
/// applying (`sim_tick`: the preflight's frame check, then the rules).
pub fn codec(protos: &[u8], plan: Plan) -> Result<Report, String> {
    let mut r = Report { scenario: "m0-codec".to_owned(), ..Report::default() };
    let (mut b, chest) = bench::m0_codec(protos).map_err(|e| e.to_string())?;
    let per_tick = u32::from(bench::CODEC_PLAYERS) * bench::CODEC_ACTIONS_PER_PLAYER;
    let ticks_per_rep = 100_000 / per_tick;
    let mut events = Vec::with_capacity(1 << 20);
    let mut run = |b: &mut Bench, n: u32| -> Result<(f64, f64), String> {
        let t0 = b.tick();
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
        Ok((encode, ms(t)))
    };
    run(&mut b, if plan.quick { 100 } else { ticks_per_rep })?;
    let (mut enc, mut app) = (0.0, 0.0);
    for _ in 0..plan.reps {
        let (e, a) = run(&mut b, ticks_per_rep)?;
        enc += e;
        app += a;
    }
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
    let mut r = Report { scenario: "m0-load-30k".to_owned(), ..Report::default() };
    let input = state_input(state)?;
    let mut loads = Vec::new();
    let mut ctx = None;
    for _ in 0..plan.reps.max(1) * 2 {
        let mut c = SimContext::new();
        c.init_protos(protos, schema::SimFlags::EMPTY).map_err(|e| e.to_string())?;
        let t = Instant::now();
        c.load(&input).map_err(|e| e.to_string())?;
        loads.push(ms(t));
        ctx = Some(c);
    }
    let [mean, ..] = stats(&mut loads);
    r.set("load_ms", mean);
    r.set("state_bytes", state.len() as f64);
    let c = ctx.ok_or("no load")?;
    let w = c.world().ok_or("no world")?;
    r.set("generated_chunks", w.chunks.generated().len() as f64);
    r.set("regenerated_by_load", w.regen.generated() as f64);
    // The next 600 ticks: player 0 walks east through pristine chunks; extraction of its view every tick.
    let mut b = bench::m0_load_30k_walk(c).map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(1 << 20);
    let (mut most, mut most_extract, mut times) = (0u64, 0u64, Vec::new());
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

/// The report as a table.
pub fn table(r: &Report) -> String {
    let mut s = String::new();
    let _ = writeln!(s, "{}", r.scenario);
    for t in bench::thresholds(&r.scenario) {
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
        if !bench::thresholds(&r.scenario).iter().any(|t| t.metric == k) {
            let _ = writeln!(s, "  {k:<28} {v:>14.4}");
        }
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

/// The host's state for the history: the git commit, the load and the clock before and after.
pub struct Host {
    pub git: String,
    pub dirty: bool,
    pub load: String,
    pub mhz: f64,
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
    Host {
        git: git(&["rev-parse", "HEAD"]).unwrap_or_default(),
        dirty: git(&["status", "--porcelain", "--untracked-files=no"]).is_some_and(|s| !s.is_empty()),
        load,
        mhz: mhz(),
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

/// One `history.jsonl` line.
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
        plan.reps
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
    let _ = write!(
        s,
        "\"host\":{{\"loadavg\":{},\"mhz_before\":{},\"mhz_after\":{}}}}}",
        json_str(&before.load),
        json_num(before.mhz),
        json_num(mhz_after)
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
