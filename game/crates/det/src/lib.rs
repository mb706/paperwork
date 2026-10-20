//! Deterministic maths for the simulation (10 §4.1).
//!
//! Every engine must compute bit-identical results. IEEE 754 fixes `+ − × ÷` and `sqrt`; transcendental
//! functions are not fixed, so they come from the `libm` crate (0.2.16), which is plain Rust compiled
//! into the module: native tests and every WebAssembly engine run the same instructions (B1 measured
//! ten functions over 10⁶ arguments bit-identical natively, in Node, Chrome 156 and Firefox 157).
//! `std`'s `f64::sin` and friends are banned by `clippy.toml`; call these instead. Besides the libm wrappers
//! the crate holds the fixed-order integer power [`powi`], [`fmax`]/[`fmin`] as comparisons, half-up unit
//! rounding, piecewise-linear tables ([`piecewise`]) and the expression bytecode interpreter ([`expr`]).
#![forbid(unsafe_code)]

pub mod expr;
pub mod piecewise;

pub use piecewise::{Piecewise, PiecewiseError, piecewise_linear};

/// The largest exponent magnitude `powi` accepts (10 §4.1 rule 2); larger ones are clamped.
pub const POWI_LIMIT: i32 = 1024;

/// `x` to the integer power `n`: multiplies left to right |n| times, then takes the reciprocal for
/// negative `n` (10 §4.1 rule 2). LLVM's `powi` has unspecified rounding, so this is the only power
/// with an integer exponent the simulation may use. `n` is clamped to ±`POWI_LIMIT`; `powi(x, 0)` is 1
/// for every `x`, NaN included.
pub fn powi(x: f64, n: i32) -> f64 {
    let n = n.clamp(-POWI_LIMIT, POWI_LIMIT);
    let mut r = 1.0_f64;
    let mut i = 0_u32;
    let k = n.unsigned_abs();
    while i < k {
        r *= x;
        i += 1;
    }
    if n < 0 { 1.0 / r } else { r }
}

/// A cost rounded half up to whole units (10 §5.12), from the fractional part: `v - floor(v)` is exact
/// for every finite double, where `floor(v + 0.5)` is not (2^52 + 1 would become 2^52 + 2). The data
/// stage's `unitCount` is its TypeScript twin; test/fixtures/expr/unit-counts.txt pins both.
pub fn unit_count(v: f64) -> f64 {
    let f = v.floor();
    if v - f >= 0.5 { f + 1.0 } else { f }
}

/// The larger of two values, as a comparison: `b` unless `a > b` (so a NaN in `a` yields `b`, and a NaN
/// in `b` yields NaN). `f64::max` differs between native code and WebAssembly on −0 and NaN (10 §4.1).
pub fn fmax(a: f64, b: f64) -> f64 {
    if a > b { a } else { b }
}

/// The smaller of two values, as a comparison: `b` unless `a < b` (the mirror of [`fmax`]).
pub fn fmin(a: f64, b: f64) -> f64 {
    if a < b { a } else { b }
}

/// 2^x (libm).
pub fn exp2(x: f64) -> f64 {
    libm::exp2(x)
}

/// log₂ x (libm).
pub fn log2(x: f64) -> f64 {
    libm::log2(x)
}

/// x^y for a real exponent (libm). Use [`powi`] for integer exponents.
pub fn pow(x: f64, y: f64) -> f64 {
    libm::pow(x, y)
}

/// sin x (libm).
pub fn sin(x: f64) -> f64 {
    libm::sin(x)
}

/// cos x (libm).
pub fn cos(x: f64) -> f64 {
    libm::cos(x)
}

/// atan2(y, x) (libm).
pub fn atan2(y: f64, x: f64) -> f64 {
    libm::atan2(y, x)
}

/// e^x (libm).
pub fn exp(x: f64) -> f64 {
    libm::exp(x)
}

/// The natural logarithm (libm).
pub fn ln(x: f64) -> f64 {
    libm::log(x)
}

/// atan x (libm).
pub fn atan(x: f64) -> f64 {
    libm::atan(x)
}

/// √(x² + y²) without undue overflow (libm).
pub fn hypot(x: f64, y: f64) -> f64 {
    libm::hypot(x, y)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn powi_multiplies_left_to_right() {
        assert_eq!(powi(2.0, 10), 1024.0);
        assert_eq!(powi(2.0, -2), 0.25);
        assert_eq!(powi(1.5, 3), 3.375);
        assert_eq!(powi(-3.0, 3), -27.0);
        assert_eq!(powi(f64::NAN, 0).to_bits(), 1.0_f64.to_bits());
        assert_eq!(powi(0.0, -1), f64::INFINITY);
        // 0.1³ by repeated multiplication is ((1 × 0.1) × 0.1) × 0.1, not the correctly rounded 0.001.
        assert_eq!(powi(0.1, 3).to_bits(), (0.1_f64 * 0.1 * 0.1).to_bits());
    }

    #[test]
    fn powi_clamps_the_exponent() {
        assert_eq!(powi(2.0, 5000), f64::INFINITY);
        assert_eq!(powi(1.0, i32::MIN), 1.0);
        assert_eq!(powi(2.0, -5000).to_bits(), powi(2.0, -1024).to_bits());
    }

    #[test]
    fn fmax_and_fmin_are_comparisons() {
        assert_eq!(fmax(1.0, 2.0), 2.0);
        assert_eq!(fmin(1.0, 2.0), 1.0);
        assert_eq!(fmax(0.0, -0.0).to_bits(), (-0.0_f64).to_bits());
        assert_eq!(fmax(f64::NAN, 1.0), 1.0);
        assert!(fmax(1.0, f64::NAN).is_nan());
    }

    #[test]
    fn libm_wrappers_are_libm() {
        assert_eq!(exp2(10.0), 1024.0);
        assert_eq!(log2(1024.0), 10.0);
        assert_eq!(pow(2.0, 0.5).to_bits(), libm::pow(2.0, 0.5).to_bits());
        assert_eq!(sin(0.0), 0.0);
        assert_eq!(cos(0.0), 1.0);
        assert_eq!(atan2(0.0, 1.0), 0.0);
        assert_eq!(exp(0.0), 1.0);
        assert_eq!(exp(1.5).to_bits(), libm::exp(1.5).to_bits());
        assert_eq!(ln(1.0), 0.0);
        assert_eq!(ln(10.0).to_bits(), libm::log(10.0).to_bits());
        assert_eq!(atan(1.0).to_bits(), libm::atan(1.0).to_bits());
        assert_eq!(hypot(3.0, 4.0), 5.0);
    }
}
