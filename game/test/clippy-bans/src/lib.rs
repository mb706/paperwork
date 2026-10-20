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

/// What the simulation writes instead: no ban fires here.
pub fn allowed(x: f64, y: f64) -> f64 {
    libm::sin(x) + if x > y { x } else { y } + (x * y + 1.0)
}
