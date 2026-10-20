//! `simtool`: the native host for the simulation (10 §10). M0 brings `hash` and `trace` (C2a), then `replay`
//! and `bench` (C2c); M1 adds `diff` and `bisect`. It is the only crate that does I/O, reads the clock and
//! prints, and it drives the sim exactly as the shell does: through `SimContext`, the module's state behind
//! the ABI.
//!
//! ```text
//! simtool hash <save> [--protos <prototypes.bin>]
//! simtool replay <save> <log.pwlog> | <bundle dir> [--protos P] [--to TICK] [--trace] [--full] [--no-sleep]
//!                [--state-out FILE]
//! simtool trace <save> <log.pwlog> [--protos P] [--ticks N] [--full] [--no-sleep] [--check]
//! simtool bench [--scenario NAME|all] [--quick] [--protos P] [--history FILE | --no-history] [--cache DIR]
//! simtool version
//! ```
//!
//! `<save>` is a save container (`*.save`, §8.1, raw sections) or `sim_save`'s output (`*.sections`, the golden
//! states). `--protos` defaults to `public/data/prototypes.bin`; a container's `prototypesHash` must match it.
#![allow(clippy::disallowed_macros, clippy::disallowed_methods, clippy::disallowed_types)]

mod bench;
mod inflate;

use schema::container::{ClosureLog, ClosureLogFlags};
use schema::{ClosureIter, SimFlags};
use sim::SimContext;
use std::process::ExitCode;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Instant;

const USAGE: &str = "usage:
  simtool hash <save> [--protos <prototypes.bin>]
      the full state hash (§4.8), each section's, the tick and the lineage r
  simtool replay <save> <log.pwlog> [--protos <prototypes.bin>] [--to TICK] [--trace] [--full] [--no-sleep]
                 [--state-out FILE]
  simtool replay <bundle dir> ...
      replays a closure log from its start save (§8.5): checks the save against the log's start state hash,
      supplies each tick's blobs, runs every tick to the log's end (or --to) with its closure or an empty one,
      and with HAS_DIGESTS stops at the first d_t that differs (exit 1); a trap names its tick (a bug bundle,
      §3.6, reproduces natively). A directory is a bug bundle: its one *.save (or *.sections) and *.pwlog.
      --trace prints `tick d slice r` per tick (hex, as the golden digests.txt), --full adds the state hash,
      --state-out writes the final state (sim_save's output, for `simtool hash`)
  simtool trace <save> <log.pwlog> [--protos <prototypes.bin>] [--ticks N] [--full] [--no-sleep] [--check]
      replay --trace, as C2a defined it: --ticks N stops after N ticks, --check stops at the first d_t that
      differs from the log's digests (exit 1)
  simtool bench [--scenario NAME|all|none] [--quick] [--protos <prototypes.bin>] [--history FILE | --no-history]
                [--cache DIR] [--json] [--write-scenarios DIR]
      the M0 benchmarks of §10.6 (m0-walk, m0-chests-10k, m0-codec, m0-load-30k), timed with §10.6's method;
      a full run checks §10.6's thresholds, --quick (ci's budget gate, one short repetition) the tails: each
      tick p99 against §11's 2 ms, each operation's worst call; both on the reference machine and × 2.4 on this
      host (exit 1 when a gate fails). The pinned cores' clocks are sampled in every timed window and turbo is
      flagged. Appends to bench/history.jsonl (--json prints those lines instead of the table).
      --write-scenarios DIR writes each scenario's state and inputs and scenarios.json for the WebAssembly
      runner (bench/node-runner.ts); with --scenario none, nothing is timed. m0-load-30k's state is built once
      and cached under --cache (default target/bench-cache). Pin it: taskset -c 0-15 target/release/simtool bench
  simtool version";

struct Args {
    positional: Vec<String>,
    protos: String,
    ticks: Option<u32>,
    to: Option<u32>,
    full: bool,
    no_sleep: bool,
    check: bool,
    trace: bool,
    state_out: Option<String>,
    scenario: String,
    quick: bool,
    history: Option<String>,
    cache: String,
    json: bool,
    write_scenarios: Option<String>,
}

fn parse_args(raw: &[String]) -> Result<Args, String> {
    let mut a = Args {
        positional: Vec::new(),
        protos: "public/data/prototypes.bin".to_owned(),
        ticks: None,
        to: None,
        full: false,
        no_sleep: false,
        check: false,
        trace: false,
        state_out: None,
        scenario: "all".to_owned(),
        quick: false,
        history: Some("bench/history.jsonl".to_owned()),
        cache: "target/bench-cache".to_owned(),
        json: false,
        write_scenarios: None,
    };
    let mut i = 0;
    while i < raw.len() {
        match raw[i].as_str() {
            "--protos" => {
                i += 1;
                a.protos = raw.get(i).ok_or("--protos needs a path")?.clone();
            }
            "--ticks" => {
                i += 1;
                a.ticks = Some(
                    raw.get(i).ok_or("--ticks needs a number")?.parse().map_err(|_| "--ticks: a number")?,
                );
            }
            "--to" => {
                i += 1;
                a.to = Some(raw.get(i).ok_or("--to needs a tick")?.parse().map_err(|_| "--to: a number")?);
            }
            "--state-out" => {
                i += 1;
                a.state_out = Some(raw.get(i).ok_or("--state-out needs a path")?.clone());
            }
            "--scenario" => {
                i += 1;
                a.scenario = raw.get(i).ok_or("--scenario needs a name")?.clone();
            }
            "--history" => {
                i += 1;
                a.history = Some(raw.get(i).ok_or("--history needs a path")?.clone());
            }
            "--cache" => {
                i += 1;
                a.cache = raw.get(i).ok_or("--cache needs a directory")?.clone();
            }
            "--no-history" => a.history = None,
            "--json" => a.json = true,
            "--write-scenarios" => {
                i += 1;
                a.write_scenarios = Some(raw.get(i).ok_or("--write-scenarios needs a directory")?.clone());
            }
            "--quick" => a.quick = true,
            "--trace" => a.trace = true,
            "--full" => a.full = true,
            "--no-sleep" => a.no_sleep = true,
            "--check" => a.check = true,
            s if s.starts_with("--") => return Err(format!("unknown option {s}")),
            s => a.positional.push(s.to_owned()),
        }
        i += 1;
    }
    Ok(a)
}

fn read(path: &str) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("{path}: {e}"))
}

pub(crate) fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// A module with the prototypes and the save loaded; the save's lineage comes from its header (a container)
/// or its trailing `u64` (`SaveOutput`).
fn load(save_path: &str, a: &Args) -> Result<SimContext, String> {
    let protos = read(&a.protos)?;
    let save = read(save_path)?;
    let input = if save.starts_with(schema::SAVE_MAGIC) {
        let (header, stored) = sim::save::read_container(&save).map_err(|e| format!("{save_path}: {e}"))?;
        // The IO worker deflates sections (codec 1, §8.1): inflate each, bounded by its declared raw length.
        let inflated: Vec<Option<Vec<u8>>> = stored
            .iter()
            .map(|f| match f.codec {
                schema::SectionCodec::Raw => Ok(None),
                schema::SectionCodec::Deflate => inflate::inflate(f.data, f.raw_length as usize)
                    .map(Some)
                    .map_err(|e| format!("{save_path}: section {}: {}", f.id, e.0)),
            })
            .collect::<Result<_, _>>()?;
        let frames: Vec<schema::SectionFrame<'_>> = stored
            .iter()
            .zip(&inflated)
            .map(|(f, raw)| match raw {
                Some(data) => schema::SectionFrame { codec: schema::SectionCodec::Raw, data, ..*f },
                None => *f,
            })
            .collect();
        let want = json_str(header, "prototypesHash").ok_or("the save header has no prototypesHash")?;
        let have = hex(&sim::sha256::sha256(&protos));
        if want != have && want.bytes().any(|c| c != b'0') {
            return Err(format!(
                "{save_path} was made with prototypes {want}, but {} is {have}: pass the matching --protos",
                a.protos
            ));
        }
        let r = json_str(header, "lineage").ok_or("the save header has no lineage")?;
        let r = u64::from_str_radix(r, 16).map_err(|_| "the header's lineage is not hex")?;
        sim::save::load_input(&frames, r)
    } else {
        let (frames, r) = sim::save::parse_save_output(&save).map_err(|e| format!("{save_path}: {e}"))?;
        sim::save::load_input(&frames, r)
    };
    let mut ctx = SimContext::new();
    let flags = if a.no_sleep { SimFlags::NO_SLEEP } else { SimFlags::EMPTY };
    ctx.init_protos(&protos, flags).map_err(|e| format!("{}: {e}", a.protos))?;
    ctx.load(&input).map_err(|e| format!("{save_path}: {e}"))?;
    Ok(ctx)
}

/// A top-level string field of the save header (its keys are sorted and unique, §8.1).
fn json_str<'a>(json: &'a str, key: &str) -> Option<&'a str> {
    let pat = format!("\"{key}\":\"");
    let at = json.find(&pat)? + pat.len();
    let end = json[at..].find('"')?;
    Some(&json[at..at + end])
}

fn cmd_hash(a: &Args) -> Result<(), String> {
    let [save] = a.positional.as_slice() else {
        return Err("hash takes one save".to_owned());
    };
    let ctx = load(save, a)?;
    let h = ctx.state_hashes().map_err(|e| e.to_string())?;
    let w = ctx.world().ok_or("no world")?;
    println!("tick {}", w.current_tick());
    println!("hash {:016x}", h.full);
    println!("r {:016x}", ctx.lineage());
    for (id, x) in h.sections {
        let name = sim::r#gen::SECTIONS.iter().find(|s| s.section.value() == id).map_or("?", |s| s.name);
        println!("section {id} {name} {x:016x}");
    }
    Ok(())
}

/// The tick a replay is running, for the panic hook (a trap names its tick, §3.6).
static TICK: AtomicU32 = AtomicU32::new(0);

/// A bug bundle's save and closure log (§3.5 `/__report`, §8.5): the one save and the one log in `dir`.
fn bundle_files(dir: &str) -> Result<(String, String), String> {
    let mut saves = Vec::new();
    let mut logs = Vec::new();
    for e in std::fs::read_dir(dir).map_err(|e| format!("{dir}: {e}"))? {
        let p = e.map_err(|e| e.to_string())?.path();
        let name = p.to_string_lossy().into_owned();
        if name.ends_with(".save") || name.ends_with(".sections") {
            saves.push(name);
        } else if name.ends_with(".pwlog") {
            logs.push(name);
        }
    }
    match (saves.as_slice(), logs.as_slice()) {
        ([s], [l]) => Ok((s.clone(), l.clone())),
        _ => Err(format!(
            "{dir}: a bundle holds one *.save (or *.sections) and one *.pwlog; found {saves:?} {logs:?}"
        )),
    }
}

/// `replay` and `trace` (§8.5): the log from the save, tick by tick. `Ok(false)` when a digest differs.
fn cmd_replay(a: &Args, trace_mode: bool) -> Result<bool, String> {
    let (save, log_path) = match a.positional.as_slice() {
        [save, log] => (save.clone(), log.clone()),
        [dir] if std::path::Path::new(dir).is_dir() => bundle_files(dir)?,
        _ => return Err("replay takes a save and a closure log, or a bundle directory".to_owned()),
    };
    let mut ctx = load(&save, a)?;
    let log_bytes = read(&log_path)?;
    let log = ClosureLog::parse(&log_bytes).map_err(|e| format!("{log_path}: {e}"))?;
    let t0 = ctx.world().ok_or("no world")?.current_tick();
    if log.header.start_tick.0 != t0 {
        return Err(format!(
            "{log_path} starts at tick {}, the save is at tick {t0}",
            log.header.start_tick.0
        ));
    }
    let start_hash = ctx.state_hashes().map_err(|e| e.to_string())?.full;
    if log.header.start_state_hash != 0 && log.header.start_state_hash != start_hash {
        return Err(format!(
            "{save} hashes to {start_hash:016x}, but {log_path} starts from {:016x}: not its start save",
            log.header.start_state_hash
        ));
    }
    let mut end = log.header.end_tick.0;
    if let Some(n) = a.ticks {
        end = end.min(t0.saturating_add(n));
    }
    if let Some(to) = a.to {
        end = end.min(to);
    }
    let digests = log.header.flags.contains(ClosureLogFlags::HAS_DIGESTS);
    let check = digests && (!trace_mode || a.check);
    let print = trace_mode || a.trace;
    std::panic::set_hook(Box::new(|info| {
        eprintln!("simtool: trap at tick {}: {info}", TICK.load(Ordering::Relaxed));
    }));
    let mut next = 0;
    let started = Instant::now();
    let mut ok = true;
    let mut out = String::new();
    let mut compared = 0u32;
    for t in t0 + 1..=end {
        TICK.store(t, Ordering::Relaxed);
        let closure: &[u8] = match log.records.get(next) {
            Some(r) if r.tick.0 == t => {
                next += 1;
                r.closure
            }
            _ => &[],
        };
        for act in ClosureIter::new(closure) {
            if let Ok(x) = schema::Action::decode(act.ty, act.payload)
                && let Some(h) = x.blob()
                && let Some(b) = log.blobs.iter().find(|b| b.sha256.bytes == h)
            {
                let mut input = h.to_vec();
                input.extend_from_slice(b.bytes);
                ctx.blob_put(&input).map_err(|e| format!("tick {t}: blob: {e}"))?;
            }
        }
        ctx.tick(closure).map_err(|e| format!("tick {t}: {e}"))?;
        let (d, s, r) = (ctx.last_digest(), ctx.last_slice(), ctx.lineage());
        if print {
            out.push_str(&format!("{t} {d:016x} {s:016x} {r:016x}"));
            if a.full {
                out.push_str(&format!(" {:016x}", ctx.state_hashes().map_err(|e| e.to_string())?.full));
            }
            out.push('\n');
        }
        if check {
            let first = log.header.digest_first_tick.0;
            if t >= first
                && let Some(&want) = log.digests.get((t - first) as usize)
            {
                compared += 1;
                if want != d {
                    eprintln!("tick {t}: d_t {d:016x}, the log recorded {want:016x}");
                    ok = false;
                    break;
                }
            }
        }
    }
    let _ = std::panic::take_hook();
    print!("{out}");
    let last = ctx.world().ok_or("no world")?.current_tick();
    let ticks = last.saturating_sub(t0);
    let ms = started.elapsed().as_secs_f64() * 1e3;
    let hash = ctx.state_hashes().map_err(|e| e.to_string())?.full;
    if let Some(p) = &a.state_out {
        std::fs::write(p, ctx.checkpoint().map_err(|e| e.to_string())?).map_err(|e| format!("{p}: {e}"))?;
    }
    eprintln!(
        "replayed ticks {}..{last} ({ticks} ticks in {ms:.1} ms, {:.4} ms per tick): state {hash:016x}, r {:016x}; {}",
        t0 + 1,
        if ticks > 0 { ms / f64::from(ticks) } else { 0.0 },
        ctx.lineage(),
        if !check {
            "digests not checked".to_owned()
        } else if ok {
            format!("{compared} recorded digests match")
        } else {
            "a digest differs".to_owned()
        }
    );
    Ok(ok)
}

/// `bench` (§10.6).
fn cmd_bench(a: &Args) -> Result<bool, String> {
    let protos = read(&a.protos)?;
    if let Some(dir) = &a.write_scenarios {
        bench::write_scenarios(&protos, dir, &a.cache)?;
        eprintln!("wrote the M0 scenarios for the WebAssembly runners to {dir}");
        if a.scenario == "none" {
            return Ok(true);
        }
    }
    let plan = if a.quick { bench::Plan::quick() } else { bench::Plan::full() };
    let names: Vec<&str> = if a.scenario == "all" {
        sim::testkit::bench::SCENARIOS.to_vec()
    } else if sim::testkit::bench::SCENARIOS.contains(&a.scenario.as_str()) {
        vec![a.scenario.as_str()]
    } else {
        return Err(format!("unknown scenario {}: {:?}", a.scenario, sim::testkit::bench::SCENARIOS));
    };
    let mut all_ok = true;
    for name in names {
        let host = bench::host();
        let started = Instant::now();
        let mut report = match name {
            "m0-walk" => bench::walk(&protos, plan)?,
            "m0-chests-10k" => bench::chests(&protos, plan)?,
            "m0-codec" => bench::codec(&protos, plan)?,
            _ => {
                let (state, cached) = bench::load_state(&protos, &a.cache)?;
                let mut r = bench::load(&protos, plan, &state)?;
                if !cached {
                    r.notes.push(format!("built and cached the 30,000-chunk state under {}", a.cache));
                }
                r
            }
        };
        let mhz_after = bench::mhz();
        let clock = bench::clock_read_us();
        report.metrics.push(("clock_read_us".to_owned(), clock));
        report.notes.push(format!(
            "{:.1} s; load {}; clock {:.0} → {:.0} MHz; git {}{}",
            started.elapsed().as_secs_f64(),
            host.load,
            host.mhz,
            mhz_after,
            &host.git[..host.git.len().min(10)],
            if host.dirty { " (dirty)" } else { "" }
        ));
        let ok = bench::gates(name, plan.quick).iter().all(|t| bench::gate(&report, t).is_none_or(|g| g.2));
        all_ok &= ok;
        if a.json {
            println!("{}", bench::history_line(&report, plan, &host, mhz_after, ok));
        } else {
            print!("{}", bench::table(&report, plan.quick));
        }
        if let Some(path) = &a.history {
            use std::io::Write as _;
            if let Some(dir) = std::path::Path::new(path).parent()
                && !dir.as_os_str().is_empty()
            {
                std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
            }
            let mut f = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .map_err(|e| format!("{path}: {e}"))?;
            writeln!(f, "{}", bench::history_line(&report, plan, &host, mhz_after, ok))
                .map_err(|e| format!("{path}: {e}"))?;
        }
    }
    Ok(all_ok)
}

fn main() -> ExitCode {
    let raw: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = raw.first().cloned() else {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    };
    let args = match parse_args(&raw[1..]) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    let r = match cmd.as_str() {
        "version" => {
            println!(
                "simtool {} (schema {}, sim ABI {}, worldgen version {})",
                env!("CARGO_PKG_VERSION"),
                &schema::SCHEMA_HASH_HEX[..16],
                schema::ABI_VERSION,
                sim::save::WORLDGEN_VERSION
            );
            Ok(true)
        }
        "hash" => cmd_hash(&args).map(|()| true),
        "replay" => cmd_replay(&args, false),
        "trace" => cmd_replay(&args, true),
        "bench" => cmd_bench(&args),
        _ => Err(format!("unknown command {cmd}")),
    };
    match r {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::from(1),
        Err(e) => {
            eprintln!("simtool: {e}");
            ExitCode::from(2)
        }
    }
}
