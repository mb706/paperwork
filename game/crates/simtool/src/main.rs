//! `simtool`: the native host for the simulation (10 §10). M0 brings `hash` and `trace` (C2a), then `replay`
//! and `bench` (C2c); M1 adds `diff` and `bisect`. It is the only crate that does I/O, reads the clock and
//! prints, and it drives the sim exactly as the shell does: through `SimContext`, the module's state behind
//! the ABI.
//!
//! ```text
//! simtool hash <save> [--protos <prototypes.bin>]
//! simtool trace <save> <log.pwlog> [--protos <prototypes.bin>] [--ticks N] [--full] [--no-sleep] [--check]
//! simtool version
//! ```
//!
//! `<save>` is a save container (`*.save`, §8.1, raw sections) or `sim_save`'s output (`*.sections`, the golden
//! states). `--protos` defaults to `public/data/prototypes.bin`; a container's `prototypesHash` must match it.
#![allow(clippy::disallowed_macros, clippy::disallowed_methods, clippy::disallowed_types)]

use schema::container::ClosureLog;
use schema::{ClosureIter, SimFlags};
use sim::SimContext;
use std::process::ExitCode;
use std::time::Instant;

const USAGE: &str = "usage:
  simtool hash <save> [--protos <prototypes.bin>]
      the full state hash (§4.8), each section's, the tick and the lineage r
  simtool trace <save> <log.pwlog> [--protos <prototypes.bin>] [--ticks N] [--full] [--no-sleep] [--check]
      replays the closure log from the save and prints `tick d slice r` per tick (hex, as the golden
      digests.txt); --full adds the full state hash, --no-sleep sets NO_SLEEP, --check stops at the first d_t
      that differs from the log's digests (exit 1)
  simtool version";

struct Args {
    positional: Vec<String>,
    protos: String,
    ticks: Option<u32>,
    full: bool,
    no_sleep: bool,
    check: bool,
}

fn parse_args(raw: &[String]) -> Result<Args, String> {
    let mut a = Args {
        positional: Vec::new(),
        protos: "public/data/prototypes.bin".to_owned(),
        ticks: None,
        full: false,
        no_sleep: false,
        check: false,
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

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// A module with the prototypes and the save loaded; the save's lineage comes from its header (a container)
/// or its trailing `u64` (`SaveOutput`).
fn load(save_path: &str, a: &Args) -> Result<SimContext, String> {
    let protos = read(&a.protos)?;
    let save = read(save_path)?;
    let input = if save.starts_with(schema::SAVE_MAGIC) {
        let (header, frames) = sim::save::read_container(&save).map_err(|e| format!("{save_path}: {e}"))?;
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

fn cmd_trace(a: &Args) -> Result<bool, String> {
    let [save, log_path] = a.positional.as_slice() else {
        return Err("trace takes a save and a closure log".to_owned());
    };
    let mut ctx = load(save, a)?;
    let log_bytes = read(log_path)?;
    let log = ClosureLog::parse(&log_bytes).map_err(|e| format!("{log_path}: {e}"))?;
    let t0 = ctx.world().ok_or("no world")?.current_tick();
    if log.header.start_tick.0 != t0 {
        return Err(format!(
            "{log_path} starts at tick {}, the save is at tick {t0}",
            log.header.start_tick.0
        ));
    }
    let end = a.ticks.map_or(log.header.end_tick.0, |n| (t0 + n).min(log.header.end_tick.0));
    let mut next = 0;
    let started = Instant::now();
    let mut ok = true;
    let mut out = String::new();
    for t in t0 + 1..=end {
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
        out.push_str(&format!("{t} {d:016x} {s:016x} {r:016x}"));
        if a.full {
            out.push_str(&format!(" {:016x}", ctx.state_hashes().map_err(|e| e.to_string())?.full));
        }
        out.push('\n');
        if a.check {
            let first = log.header.digest_first_tick.0;
            if t >= first
                && let Some(&want) = log.digests.get((t - first) as usize)
                && want != d
            {
                eprintln!("tick {t}: d_t {d:016x}, the log recorded {want:016x}");
                ok = false;
                break;
            }
        }
    }
    print!("{out}");
    let ticks = end.saturating_sub(t0);
    let ms = started.elapsed().as_secs_f64() * 1e3;
    eprintln!(
        "{ticks} ticks in {ms:.1} ms ({:.4} ms per tick)",
        if ticks > 0 { ms / f64::from(ticks) } else { 0.0 }
    );
    Ok(ok)
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
        "trace" => cmd_trace(&args),
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
