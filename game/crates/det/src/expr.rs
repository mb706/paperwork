//! The expression bytecode interpreter (10 §15.2).
//!
//! The data stage compiles every formula field (`count_formula`, `field_year`, `amounts_by_j`, the
//! model-collapse `speed_factor`) to a postfix program in the `EXPR` section of `prototypes.bin`, and
//! evaluates the same bytecode with its TypeScript reference interpreter (`scripts/data-stage/expr.ts`).
//! A cross-language test runs both on every expression at every checked value (`tests/expr_cross.rs`).
//!
//! Layout of one expression: `u16 byteCount` (the op stream that follows, END included), `u8 varCount`,
//! `u8 maxStack`, then the ops, each a one-byte opcode and its operands, little-endian.
//!
//! Behaviour at the limits is defined, never undefined: the result is clamped to the field's declared
//! range (an infinity becomes the bound), NaN maps to the range's lower bound, and a power's exponent is
//! truncated toward zero (NaN → 0) and clamped to ±1,024. Each case sets a flag so the caller can log a
//! warning; the data stage's checks make every one of them a data bug.

use crate::{POWI_LIMIT, powi};

pub const OP_CONST: u8 = 0x01;
pub const OP_VAR: u8 = 0x02;
pub const OP_ADD: u8 = 0x10;
pub const OP_SUB: u8 = 0x11;
pub const OP_MUL: u8 = 0x12;
pub const OP_DIV: u8 = 0x13;
pub const OP_NEG: u8 = 0x14;
pub const OP_POWI: u8 = 0x20;
pub const OP_END: u8 = 0xFF;

/// The stack depth the data stage guarantees.
pub const MAX_STACK: usize = 16;
/// The size of an expression's header in bytes.
pub const HEADER_BYTES: usize = 4;

/// The result range a formula field declares (10 §2.4, §15.2), inclusive at both ends.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Range {
    pub lo: f64,
    pub hi: f64,
}

/// The result was NaN and became the range's lower bound.
pub const FLAG_NAN: u8 = 1;
/// The result lay outside the range (an infinity included) and was clamped.
pub const FLAG_CLAMPED: u8 = 2;
/// A power's exponent was not an integer within ±1,024 and was truncated or clamped.
pub const FLAG_EXPONENT: u8 = 4;

/// An evaluated expression.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Value {
    pub value: f64,
    /// `FLAG_*` bits; zero for a clean evaluation.
    pub flags: u8,
}

/// Malformed bytecode. The data stage never writes it; `Protos::load` refuses a file that holds it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExprError {
    /// The header or an operand runs past the end of the bytes.
    Truncated,
    /// The header's `maxStack` exceeds `MAX_STACK`, or the program pushes past it.
    StackOverflow,
    /// An operator found too few operands, or END did not leave exactly one value.
    StackUnderflow,
    /// A variable index at or above `varCount`, or `varCount` above the variables supplied.
    BadVariable(u8),
    /// An unknown opcode.
    BadOpcode(u8),
    /// The op stream ended without END, or bytes follow END inside `byteCount`.
    BadEnd,
}

/// The total length (header included) of the expression starting at `code[0]`.
pub fn encoded_len(code: &[u8]) -> Result<usize, ExprError> {
    if code.len() < HEADER_BYTES {
        return Err(ExprError::Truncated);
    }
    let n = u16::from_le_bytes([code[0], code[1]]) as usize;
    if code.len() < HEADER_BYTES + n {
        return Err(ExprError::Truncated);
    }
    Ok(HEADER_BYTES + n)
}

/// Evaluates the expression at the start of `code` with the field's variables `vars` and clamps the
/// result to `range`.
pub fn eval(code: &[u8], vars: &[f64], range: Range) -> Result<Value, ExprError> {
    let len = encoded_len(code)?;
    let var_count = code[2];
    let max_stack = code[3] as usize;
    if max_stack > MAX_STACK {
        return Err(ExprError::StackOverflow);
    }
    if var_count as usize > vars.len() {
        return Err(ExprError::BadVariable(var_count));
    }
    let ops = &code[HEADER_BYTES..len];
    let mut stack = [0.0_f64; MAX_STACK];
    let mut sp = 0_usize;
    let mut flags = 0_u8;
    let mut pc = 0_usize;
    loop {
        let Some(&op) = ops.get(pc) else {
            return Err(ExprError::BadEnd);
        };
        pc += 1;
        match op {
            OP_CONST => {
                let Some(b) = ops.get(pc..pc + 8) else {
                    return Err(ExprError::Truncated);
                };
                pc += 8;
                if sp >= max_stack {
                    return Err(ExprError::StackOverflow);
                }
                stack[sp] =
                    f64::from_bits(u64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]]));
                sp += 1;
            }
            OP_VAR => {
                let Some(&k) = ops.get(pc) else {
                    return Err(ExprError::Truncated);
                };
                pc += 1;
                if k >= var_count {
                    return Err(ExprError::BadVariable(k));
                }
                if sp >= max_stack {
                    return Err(ExprError::StackOverflow);
                }
                stack[sp] = vars[k as usize];
                sp += 1;
            }
            OP_ADD | OP_SUB | OP_MUL | OP_DIV | OP_POWI => {
                if sp < 2 {
                    return Err(ExprError::StackUnderflow);
                }
                let b = stack[sp - 1];
                let a = stack[sp - 2];
                sp -= 1;
                stack[sp - 1] = match op {
                    OP_ADD => a + b,
                    OP_SUB => a - b,
                    OP_MUL => a * b,
                    OP_DIV => a / b,
                    _ => {
                        let (n, clean) = exponent(b);
                        if !clean {
                            flags |= FLAG_EXPONENT;
                        }
                        powi(a, n)
                    }
                };
            }
            OP_NEG => {
                if sp < 1 {
                    return Err(ExprError::StackUnderflow);
                }
                stack[sp - 1] = -stack[sp - 1];
            }
            OP_END => {
                if pc != ops.len() {
                    return Err(ExprError::BadEnd);
                }
                if sp != 1 {
                    return Err(ExprError::StackUnderflow);
                }
                let (value, f) = clamp(stack[0], range);
                return Ok(Value { value, flags: flags | f });
            }
            other => return Err(ExprError::BadOpcode(other)),
        }
    }
}

/// A power's exponent: truncated toward zero with Rust's saturating `as` (NaN → 0), then clamped to
/// ±`POWI_LIMIT`. The flag is false when the exponent was not already an integer within the limit.
fn exponent(e: f64) -> (i32, bool) {
    let n = (e as i32).clamp(-POWI_LIMIT, POWI_LIMIT);
    (n, f64::from(n) == e)
}

/// Clamps a result to the range: NaN → `lo`, below → `lo`, above → `hi` (infinities included).
fn clamp(v: f64, r: Range) -> (f64, u8) {
    if v.is_nan() {
        (r.lo, FLAG_NAN)
    } else if v < r.lo {
        (r.lo, FLAG_CLAMPED)
    } else if v > r.hi {
        (r.hi, FLAG_CLAMPED)
    } else {
        (v, 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: Range = Range { lo: f64::MIN, hi: f64::MAX };

    fn program(var_count: u8, max_stack: u8, ops: &[u8]) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(&(ops.len() as u16).to_le_bytes());
        v.push(var_count);
        v.push(max_stack);
        v.extend_from_slice(ops);
        v
    }

    fn konst(x: f64) -> Vec<u8> {
        let mut v = vec![OP_CONST];
        v.extend_from_slice(&x.to_bits().to_le_bytes());
        v
    }

    #[test]
    fn evaluates_a_count_formula() {
        // 2^(L-7)*1000 at L = 9 → 4000.
        let mut ops = konst(2.0);
        ops.extend([OP_VAR, 0]);
        ops.extend(konst(7.0));
        ops.push(OP_SUB);
        ops.push(OP_POWI);
        ops.extend(konst(1000.0));
        ops.extend([OP_MUL, OP_END]);
        let code = program(1, 3, &ops);
        assert_eq!(eval(&code, &[9.0], ALL), Ok(Value { value: 4000.0, flags: 0 }));
    }

    #[test]
    fn clamps_and_flags_the_limits() {
        let r = Range { lo: 1.0, hi: 100.0 };
        let mut div0 = konst(1.0);
        div0.extend(konst(0.0));
        div0.extend([OP_DIV, OP_END]);
        assert_eq!(eval(&program(0, 2, &div0), &[], r), Ok(Value { value: 100.0, flags: FLAG_CLAMPED }));
        let mut nan = konst(0.0);
        nan.extend(konst(0.0));
        nan.extend([OP_DIV, OP_END]);
        assert_eq!(eval(&program(0, 2, &nan), &[], r), Ok(Value { value: 1.0, flags: FLAG_NAN }));
        let mut big = konst(2.0);
        big.extend(konst(2000.0));
        big.extend([OP_POWI, OP_END]);
        let v = eval(&program(0, 2, &big), &[], ALL).unwrap();
        assert_eq!(v.flags, FLAG_EXPONENT | FLAG_CLAMPED);
        assert_eq!(v.value, f64::MAX);
        let mut frac = konst(2.0);
        frac.extend(konst(2.5));
        frac.extend([OP_POWI, OP_END]);
        assert_eq!(eval(&program(0, 2, &frac), &[], ALL), Ok(Value { value: 4.0, flags: FLAG_EXPONENT }));
    }

    #[test]
    fn refuses_malformed_bytecode() {
        assert_eq!(eval(&[1, 0, 0], &[], ALL), Err(ExprError::Truncated));
        assert_eq!(eval(&program(0, 2, &[OP_ADD, OP_END]), &[], ALL), Err(ExprError::StackUnderflow));
        assert_eq!(eval(&program(0, 2, &[0x42]), &[], ALL), Err(ExprError::BadOpcode(0x42)));
        assert_eq!(eval(&program(1, 2, &[OP_VAR, 1, OP_END]), &[0.0], ALL), Err(ExprError::BadVariable(1)));
        assert_eq!(eval(&program(1, 2, &[OP_VAR, 0, OP_END]), &[], ALL), Err(ExprError::BadVariable(1)));
        assert_eq!(eval(&program(0, 17, &[OP_END]), &[], ALL), Err(ExprError::StackOverflow));
        let mut two = konst(1.0);
        two.extend(konst(2.0));
        two.push(OP_END);
        assert_eq!(eval(&program(0, 2, &two), &[], ALL), Err(ExprError::StackUnderflow));
        let mut over = konst(1.0);
        over.extend(konst(2.0));
        assert_eq!(eval(&program(0, 1, &over), &[], ALL), Err(ExprError::StackOverflow));
        let mut tail = konst(1.0);
        tail.extend([OP_END, OP_END]);
        assert_eq!(eval(&program(0, 1, &tail), &[], ALL), Err(ExprError::BadEnd));
        assert_eq!(eval(&program(0, 1, &konst(1.0)), &[], ALL), Err(ExprError::BadEnd));
    }
}
