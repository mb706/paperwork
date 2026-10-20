//! Piecewise-linear tables (10 §2.2, §4.1): j(W) between `meta.world.j`'s breakpoints (01 §12.2, 10 §5.11),
//! the day cycle's daylight over the day fraction (§5.7) and every later table of the same shape.
//!
//! Evaluation uses `+ − × ÷` and comparisons only, in one fixed order, so every engine computes the same
//! bits (§4.1 rule 1). Between breakpoints `(x₀, y₀)` and `(x₁, y₁)` the value is
//! `y₀ + (y₁ − y₀) × ((x − x₀) / (x₁ − x₀))`, evaluated exactly in that order; at a breakpoint it is the
//! breakpoint's own `y`, bit for bit (−0 included); before the first breakpoint it is the first `y` and after
//! the last the last `y` ("constant after the last", meta.world.j); a NaN argument gives the first `y`. A table
//! whose segments would overflow (`x₁ − x₀` or `y₁ − y₀` not finite) is refused, so no value is ever NaN or
//! infinite (D6; C2a-r1 finding 7).

/// Why a table was refused.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PiecewiseError {
    /// No breakpoints at all.
    Empty,
    /// A coordinate that is NaN or infinite.
    NotFinite,
    /// Breakpoints whose `x` does not rise strictly.
    NotAscending,
    /// A segment whose `x₁ − x₀` or `y₁ − y₀` overflows to infinity, so interpolating it could give NaN.
    Overflow,
}

/// A checked piecewise-linear table: at least one breakpoint, finite coordinates, `x` strictly ascending, and
/// every segment's differences finite.
#[derive(Clone, Debug, PartialEq)]
pub struct Piecewise {
    points: Vec<(f64, f64)>,
}

impl Piecewise {
    /// Checks and keeps the breakpoints `(x, y)`.
    pub fn new(points: Vec<(f64, f64)>) -> Result<Self, PiecewiseError> {
        check(&points)?;
        Ok(Self { points })
    }

    /// The value at `x` (see the module documentation).
    pub fn eval(&self, x: f64) -> f64 {
        eval_checked(&self.points, x)
    }

    /// The breakpoints.
    pub fn points(&self) -> &[(f64, f64)] {
        &self.points
    }
}

/// Checks a table: at least one breakpoint, finite coordinates, `x` strictly ascending.
pub fn check(points: &[(f64, f64)]) -> Result<(), PiecewiseError> {
    if points.is_empty() {
        return Err(PiecewiseError::Empty);
    }
    if points.iter().any(|&(x, y)| !x.is_finite() || !y.is_finite()) {
        return Err(PiecewiseError::NotFinite);
    }
    if points.windows(2).any(|w| w[1].0 <= w[0].0) {
        return Err(PiecewiseError::NotAscending);
    }
    if points.windows(2).any(|w| !(w[1].0 - w[0].0).is_finite() || !(w[1].1 - w[0].1).is_finite()) {
        return Err(PiecewiseError::Overflow);
    }
    Ok(())
}

/// The value of a table at `x`; `None` when the table fails [`check`]. For constant tables that are
/// checked once (`const` arrays in code), [`Piecewise`] avoids repeating the check.
pub fn piecewise_linear(points: &[(f64, f64)], x: f64) -> Option<f64> {
    check(points).ok()?;
    Some(eval_checked(points, x))
}

fn eval_checked(points: &[(f64, f64)], x: f64) -> f64 {
    let (x0, y0) = points[0];
    // NaN gives the first value: a defined value, never NaN (D6).
    if x.is_nan() || x <= x0 {
        return y0;
    }
    let (xn, yn) = points[points.len() - 1];
    if x >= xn {
        return yn;
    }
    // The segment [x_i, x_{i+1}) holding x: the last breakpoint whose x is ≤ x (binary search, so long
    // tables cost log n). x0 < x < xn here, so i + 1 < len.
    let mut lo = 0usize;
    let mut hi = points.len() - 1;
    while hi - lo > 1 {
        let mid = lo + (hi - lo) / 2;
        if points[mid].0 <= x {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let (xa, ya) = points[lo];
    if x == xa {
        // An interior breakpoint: its own value, bit for bit (−0 stays −0).
        return ya;
    }
    let (xb, yb) = points[lo + 1];
    // xa < x < xb and both differences are finite (`check`), so t ∈ (0, 1) and the result lies between ya and
    // yb: finite, never NaN.
    ya + (yb - ya) * ((x - xa) / (xb - xa))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// meta.world.j's breakpoints (design/spec/data/meta.yaml; 01 §12.2).
    const J: [(f64, f64); 4] = [(0.0, 0.3), (49.0, 0.3), (59.0, 0.45), (67.0, 0.55)];

    #[test]
    fn breakpoints_are_exact_and_the_ends_constant() {
        let p = Piecewise::new(J.to_vec()).expect("a valid table");
        for &(x, y) in &J {
            assert_eq!(p.eval(x).to_bits(), y.to_bits(), "j({x})");
        }
        assert_eq!(p.eval(-5.0), 0.3);
        assert_eq!(p.eval(1e300), 0.55);
        assert_eq!(p.eval(f64::INFINITY), 0.55);
        assert_eq!(p.eval(f64::NEG_INFINITY), 0.3);
        assert_eq!(p.eval(f64::NAN), 0.3, "NaN gives the first value");
    }

    #[test]
    fn interpolates_in_the_documented_order() {
        let p = Piecewise::new(J.to_vec()).expect("a valid table");
        // Midway between (49, 0.3) and (59, 0.45): 0.3 + 0.15000000000000002 × 0.5.
        let want = 0.3 + (0.45_f64 - 0.3) * ((54.0 - 49.0) / (59.0 - 49.0));
        assert_eq!(p.eval(54.0).to_bits(), want.to_bits());
        assert!((p.eval(54.0) - 0.375).abs() < 1e-15);
        let want = 0.45 + (0.55_f64 - 0.45) * ((63.0 - 59.0) / (67.0 - 59.0));
        assert_eq!(p.eval(63.0).to_bits(), want.to_bits());
        // The flat first segment.
        assert_eq!(p.eval(20.0), 0.3);
    }

    #[test]
    fn daylight_table() {
        // §5.7: t = 0 is noon; 1 until dusk (0.25), 0 at evening (0.45) until morning (0.55), 1 at dawn (0.75).
        let day =
            Piecewise::new(vec![(0.0, 1.0), (0.25, 1.0), (0.45, 0.0), (0.55, 0.0), (0.75, 1.0), (1.0, 1.0)])
                .expect("a valid table");
        assert_eq!(day.eval(0.1), 1.0);
        assert_eq!(day.eval(0.5), 0.0);
        assert!((day.eval(0.35) - 0.5).abs() < 1e-15);
        assert!((day.eval(0.65) - 0.5).abs() < 1e-15);
        // The 70% solar average of §5.7: integrate the table on a fine grid.
        let n = 100_000;
        let mut sum = 0.0;
        for i in 0..n {
            sum += day.eval((f64::from(i) + 0.5) / f64::from(n));
        }
        assert!((sum / f64::from(n) - 0.7).abs() < 1e-9);
    }

    #[test]
    fn extreme_values_and_signed_zero() {
        // C2a-r1 finding 7: a jump from MAX to −MAX overflows its difference; such a table is refused.
        assert_eq!(
            Piecewise::new(vec![(0.0, 0.0), (1.0, f64::MAX), (2.0, -f64::MAX)]),
            Err(PiecewiseError::Overflow)
        );
        assert_eq!(Piecewise::new(vec![(-f64::MAX, 0.0), (f64::MAX, 1.0)]), Err(PiecewiseError::Overflow));
        // The largest finite differences are allowed, and every value stays finite.
        let p =
            Piecewise::new(vec![(0.0, 0.0), (1.0, f64::MAX), (2.0, 0.0), (3.0, -f64::MAX)]).expect("finite");
        for i in 0..=300 {
            let x = f64::from(i) / 100.0;
            assert!(p.eval(x).is_finite(), "{x}");
        }
        assert_eq!(p.eval(1.0), f64::MAX);
        assert_eq!(p.eval(2.0).to_bits(), 0.0f64.to_bits());
        // Breakpoints keep their sign of zero, also at an interior breakpoint, and −0 meets +0.
        let z = Piecewise::new(vec![(-1.0, 5.0), (0.0, -0.0), (1.0, 3.0)]).expect("valid");
        assert_eq!(z.eval(0.0).to_bits(), (-0.0f64).to_bits());
        assert_eq!(z.eval(-0.0).to_bits(), (-0.0f64).to_bits());
        let first = Piecewise::new(vec![(0.0, -0.0), (1.0, 1.0)]).expect("valid");
        assert_eq!(first.eval(-0.0).to_bits(), (-0.0f64).to_bits());
        assert_eq!(first.eval(f64::NAN).to_bits(), (-0.0f64).to_bits());
    }

    #[test]
    fn refuses_bad_tables() {
        assert_eq!(Piecewise::new(vec![]), Err(PiecewiseError::Empty));
        assert_eq!(Piecewise::new(vec![(0.0, 1.0), (0.0, 2.0)]), Err(PiecewiseError::NotAscending));
        assert_eq!(Piecewise::new(vec![(1.0, 1.0), (0.0, 2.0)]), Err(PiecewiseError::NotAscending));
        assert_eq!(Piecewise::new(vec![(0.0, f64::NAN)]), Err(PiecewiseError::NotFinite));
        assert_eq!(Piecewise::new(vec![(f64::INFINITY, 0.0)]), Err(PiecewiseError::NotFinite));
        assert_eq!(piecewise_linear(&[], 1.0), None);
        assert_eq!(piecewise_linear(&[(2.0, 7.0)], 1.0), Some(7.0), "one breakpoint: a constant");
        assert_eq!(piecewise_linear(&[(2.0, 7.0)], 9.0), Some(7.0));
    }
}
