//! `simtool`: the native host for the simulation (10 §10). M0 brings `replay`, `hash`, `trace` and
//! `bench`; M1 adds `diff` and `bisect`. It is the only crate that does I/O, reads the clock and prints.
#![allow(clippy::disallowed_macros, clippy::disallowed_methods, clippy::disallowed_types)]

fn main() {
    let cmd = std::env::args().nth(1).unwrap_or_default();
    match cmd.as_str() {
        "version" => println!("simtool {} (scaffold)", env!("CARGO_PKG_VERSION")),
        _ => {
            eprintln!(
                "usage: simtool version\n(replay, hash, trace and bench arrive with the Sim work package)"
            );
            std::process::exit(2);
        }
    }
}
