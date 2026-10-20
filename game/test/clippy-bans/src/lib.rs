//! Every determinism ban of game/clippy.toml, broken once (see Cargo.toml). Not built into anything.
#![allow(dead_code, clippy::unnecessary_cast, clippy::manual_clamp)]

use std::collections::{HashMap, HashSet};

pub fn f64_methods(x: f64, y: f64) -> f64 {
    x.sin() + x.cos() + x.tan() + x.asin() + x.acos() + x.atan() + x.atan2(y) + x.exp() + x.exp2() + x.exp_m1()
        + x.ln() + x.ln_1p() + x.log(y) + x.log2() + x.log10() + x.powf(y) + x.powi(3) + x.cbrt() + x.hypot(y)
        + x.sinh() + x.cosh() + x.tanh() + x.asinh() + x.acosh() + x.atanh() + x.mul_add(y, 1.0) + x.max(y)
        + x.min(y) + x.clamp(0.0, 1.0)
}

pub fn f32_methods(x: f32, y: f32) -> f32 {
    x.sin() + x.cos() + x.tan() + x.asin() + x.acos() + x.atan() + x.atan2(y) + x.exp() + x.exp2() + x.exp_m1()
        + x.ln() + x.ln_1p() + x.log(y) + x.log2() + x.log10() + x.powf(y) + x.powi(3) + x.cbrt() + x.hypot(y)
        + x.sinh() + x.cosh() + x.tanh() + x.asinh() + x.acosh() + x.atanh() + x.mul_add(y, 1.0) + x.max(y)
        + x.min(y) + x.clamp(0.0, 1.0)
}

pub fn fused(x: f64, y: f32) -> f64 {
    libm::fma(x, x, x) + libm::fmaf(y, y, y) as f64
}

pub fn clocks_and_threads() -> u128 {
    std::thread::spawn(|| ()).join().ok();
    std::time::Instant::now().elapsed().as_nanos() + std::time::SystemTime::now().elapsed().map_or(0, |d| d.as_nanos())
}

pub fn maps(m: &HashMap<u32, u32>, s: &HashSet<u32>) -> u32 {
    m.values().sum::<u32>() + s.iter().sum::<u32>()
}

pub fn printing(x: u32) -> u32 {
    println!("{x}");
    print!("{x}");
    eprintln!("{x}");
    eprint!("{x}");
    dbg!(x)
}

/// I/O, environment and process, imported in grouped, nested and renamed forms: the bans act on resolved
/// paths, so every spelling fires (C1a-r1 finding 10).
pub mod io_bans {
    use std::{
        env as e,
        fs::{self as f, File as Handle, OpenOptions},
        io::{stderr as err, stdin, stdout},
        net::{TcpListener, TcpStream as Tcp, UdpSocket},
        process::{self as p, Command},
    };

    pub fn files() -> usize {
        let _ = f::read("x");
        let _ = f::read_to_string("x");
        let _ = f::write("x", b"y");
        let _ = f::read_dir("x");
        let _ = f::metadata("x");
        let _ = f::symlink_metadata("x");
        let _ = f::create_dir("x");
        let _ = f::create_dir_all("x");
        let _ = f::remove_file("x");
        let _ = f::remove_dir("x");
        let _ = f::remove_dir_all("x");
        let _ = f::rename("x", "y");
        let _ = f::copy("x", "y");
        let _ = f::hard_link("x", "y");
        let _ = f::canonicalize("x");
        let _ = f::read_link("x");
        let _ = f::set_permissions("x", f::metadata("x").map(|m| m.permissions()).unwrap_or_else(|_| unreachable!()));
        let _ = f::exists("x");
        let _: Option<Handle> = None;
        let _: Option<OpenOptions> = None;
        0
    }

    pub fn environment() -> usize {
        let _ = e::var("A");
        let _ = e::var_os("A");
        let _ = e::vars().count();
        let _ = e::vars_os().count();
        let _ = e::args().count();
        let _ = e::args_os().count();
        let _ = e::current_dir();
        let _ = e::set_current_dir("x");
        unsafe { e::set_var("A", "B") };
        unsafe { e::remove_var("A") };
        let _ = e::temp_dir();
        let _ = e::current_exe();
        0
    }

    pub fn process_and_streams() -> u32 {
        let _: Option<Command> = None;
        let _: Option<Tcp> = None;
        let _: Option<TcpListener> = None;
        let _: Option<UdpSocket> = None;
        let _ = (stdin(), stdout(), err());
        if p::id() == 0 {
            p::abort();
        }
        p::exit(0)
    }
}

/// What the simulation writes instead: no ban fires here.
pub fn allowed(x: f64, y: f64) -> f64 {
    libm::sin(x) + if x > y { x } else { y } + (x * y + 1.0)
}
