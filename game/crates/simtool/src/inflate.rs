//! Raw DEFLATE (RFC 1951) decompression for save containers' codec-1 sections (§8.1: the IO worker deflates each
//! section with fflate at level 6 when that is smaller). Bounded: the output may not pass the frame's declared
//! raw length, and must reach it exactly, so a damaged or hostile frame costs at most what it claims to hold. A
//! port of zlib's reference inflater `puff.c` (Mark Adler): canonical Huffman codes decoded a bit at a time.

/// Why a stream did not inflate.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InflateError(pub String);

fn err<T>(m: impl Into<String>) -> Result<T, InflateError> {
    Err(InflateError(m.into()))
}

const MAXBITS: usize = 15;
const MAXLCODES: usize = 286;
const MAXDCODES: usize = 30;
const FIXLCODES: usize = 288;

struct Bits<'a> {
    input: &'a [u8],
    pos: usize,
    bitbuf: u32,
    bitcnt: u32,
}

impl Bits<'_> {
    fn bits(&mut self, need: u32) -> Result<u32, InflateError> {
        let mut val = u64::from(self.bitbuf);
        while self.bitcnt < need {
            let Some(&b) = self.input.get(self.pos) else {
                return err("the stream ends early");
            };
            self.pos += 1;
            val |= u64::from(b) << self.bitcnt;
            self.bitcnt += 8;
        }
        self.bitbuf = (val >> need) as u32;
        self.bitcnt -= need;
        Ok((val & ((1u64 << need) - 1)) as u32)
    }
}

/// A canonical Huffman code: how many symbols have each length, and the symbols in canonical order.
struct Huffman {
    count: [u16; MAXBITS + 1],
    symbol: Vec<u16>,
}

impl Huffman {
    /// Builds the code of `lengths`; refuses an over-subscribed code (an incomplete one is allowed only when it
    /// has a single code, as RFC 1951 permits for distances).
    fn new(lengths: &[u16]) -> Result<(Self, bool), InflateError> {
        let mut count = [0u16; MAXBITS + 1];
        for &l in lengths {
            count[usize::from(l)] += 1;
        }
        if usize::from(count[0]) == lengths.len() {
            return Ok((Self { count, symbol: Vec::new() }, false));
        }
        let mut left: i32 = 1;
        for &c in &count[1..] {
            left <<= 1;
            left -= i32::from(c);
            if left < 0 {
                return err("an over-subscribed Huffman code");
            }
        }
        let mut offs = [0u16; MAXBITS + 1];
        for len in 1..MAXBITS {
            offs[len + 1] = offs[len] + count[len];
        }
        let mut symbol = vec![0u16; lengths.len()];
        for (sym, &l) in lengths.iter().enumerate() {
            if l != 0 {
                symbol[usize::from(offs[usize::from(l)])] = sym as u16;
                offs[usize::from(l)] += 1;
            }
        }
        Ok((Self { count, symbol }, left > 0))
    }

    fn decode(&self, s: &mut Bits<'_>) -> Result<u16, InflateError> {
        let (mut code, mut first, mut index) = (0i32, 0i32, 0i32);
        for len in 1..=MAXBITS {
            code |= s.bits(1)? as i32;
            let count = i32::from(self.count[len]);
            if code - count < first {
                return Ok(self.symbol[(index + (code - first)) as usize]);
            }
            index += count;
            first += count;
            first <<= 1;
            code <<= 1;
        }
        err("a code that is in no Huffman table")
    }
}

const LBASE: [u16; 29] = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195,
    227, 258,
];
const LEXT: [u16; 29] =
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE: [u16; 30] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073,
    4097, 6145, 8193, 12289, 16385, 24577,
];
const DEXT: [u16; 30] =
    [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

fn codes(
    s: &mut Bits<'_>,
    out: &mut Vec<u8>,
    limit: usize,
    lcode: &Huffman,
    dcode: &Huffman,
) -> Result<(), InflateError> {
    loop {
        let sym = lcode.decode(s)?;
        if sym < 256 {
            if out.len() >= limit {
                return err("more bytes than the frame declares");
            }
            out.push(sym as u8);
        } else if sym == 256 {
            return Ok(());
        } else {
            let i = usize::from(sym - 257);
            if i >= 29 {
                return err("an invalid length symbol");
            }
            let len = usize::from(LBASE[i]) + s.bits(u32::from(LEXT[i]))? as usize;
            let d = usize::from(dcode.decode(s)?);
            if d >= 30 {
                return err("an invalid distance symbol");
            }
            let dist = usize::from(DBASE[d]) + s.bits(u32::from(DEXT[d]))? as usize;
            if dist > out.len() {
                return err("a distance before the start of the output");
            }
            if out.len() + len > limit {
                return err("more bytes than the frame declares");
            }
            for _ in 0..len {
                out.push(out[out.len() - dist]);
            }
        }
    }
}

fn stored(s: &mut Bits<'_>, out: &mut Vec<u8>, limit: usize) -> Result<(), InflateError> {
    s.bitbuf = 0;
    s.bitcnt = 0;
    let Some(h) = s.input.get(s.pos..s.pos + 4) else {
        return err("a stored block's header ends early");
    };
    let len = usize::from(u16::from_le_bytes([h[0], h[1]]));
    if u16::from_le_bytes([h[0], h[1]]) != !u16::from_le_bytes([h[2], h[3]]) {
        return err("a stored block's length does not match its complement");
    }
    s.pos += 4;
    let Some(data) = s.input.get(s.pos..s.pos + len) else {
        return err("a stored block ends early");
    };
    if out.len() + len > limit {
        return err("more bytes than the frame declares");
    }
    out.extend_from_slice(data);
    s.pos += len;
    Ok(())
}

fn fixed() -> Result<(Huffman, Huffman), InflateError> {
    let mut lengths = [0u16; FIXLCODES];
    for (sym, l) in lengths.iter_mut().enumerate() {
        *l = match sym {
            0..=143 => 8,
            144..=255 => 9,
            256..=279 => 7,
            _ => 8,
        };
    }
    let (l, _) = Huffman::new(&lengths)?;
    let (d, _) = Huffman::new(&[5u16; MAXDCODES])?;
    Ok((l, d))
}

fn dynamic(s: &mut Bits<'_>) -> Result<(Huffman, Huffman), InflateError> {
    const ORDER: [usize; 19] = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    let nlen = s.bits(5)? as usize + 257;
    let ndist = s.bits(5)? as usize + 1;
    let ncode = s.bits(4)? as usize + 4;
    if nlen > MAXLCODES || ndist > MAXDCODES {
        return err("too many length or distance codes");
    }
    let mut lengths = [0u16; MAXLCODES + MAXDCODES];
    for &o in ORDER.iter().take(ncode) {
        lengths[o] = s.bits(3)? as u16;
    }
    let (lencode, incomplete) = Huffman::new(&lengths[..19])?;
    if incomplete {
        return err("an incomplete code-length code");
    }
    let mut index = 0;
    while index < nlen + ndist {
        let sym = lencode.decode(s)?;
        if sym < 16 {
            lengths[index] = sym;
            index += 1;
        } else {
            let (len, rep) = match sym {
                16 => {
                    if index == 0 {
                        return err("a repeat with no length before it");
                    }
                    (lengths[index - 1], 3 + s.bits(2)?)
                }
                17 => (0, 3 + s.bits(3)?),
                _ => (0, 11 + s.bits(7)?),
            };
            if index + rep as usize > nlen + ndist {
                return err("too many code lengths");
            }
            for _ in 0..rep {
                lengths[index] = len;
                index += 1;
            }
        }
    }
    if lengths[256] == 0 {
        return err("no end-of-block code");
    }
    let (l, inc) = Huffman::new(&lengths[..nlen])?;
    if inc && nlen - usize::from(l.count[0]) != 1 {
        return err("an incomplete literal/length code");
    }
    let (d, inc) = Huffman::new(&lengths[nlen..nlen + ndist])?;
    if inc && ndist - usize::from(d.count[0]) != 1 {
        return err("an incomplete distance code");
    }
    Ok((l, d))
}

/// DEFLATE's best ratio is about 1,032 : 1 (a 258-byte match in under 2 bits); a frame claiming more is refused
/// before anything is allocated for it.
const MAX_RATIO: usize = 1032;

/// Inflates a raw DEFLATE stream that must hold exactly `raw_len` bytes.
pub fn inflate(input: &[u8], raw_len: usize) -> Result<Vec<u8>, InflateError> {
    if raw_len > input.len().saturating_mul(MAX_RATIO).saturating_add(1024) {
        return err(format!("{raw_len} bytes cannot come from {} deflated ones", input.len()));
    }
    let mut out = Vec::with_capacity(raw_len);
    let mut s = Bits { input, pos: 0, bitbuf: 0, bitcnt: 0 };
    loop {
        let last = s.bits(1)?;
        match s.bits(2)? {
            0 => stored(&mut s, &mut out, raw_len)?,
            1 => {
                let (l, d) = fixed()?;
                codes(&mut s, &mut out, raw_len, &l, &d)?;
            }
            2 => {
                let (l, d) = dynamic(&mut s)?;
                codes(&mut s, &mut out, raw_len, &l, &d)?;
            }
            _ => return err("a block of the reserved type 3"),
        }
        if last == 1 {
            break;
        }
    }
    if out.len() != raw_len {
        return err(format!("{} bytes, but the frame declares {raw_len}", out.len()));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Streams made by Python's zlib (raw DEFLATE, wbits −15): a stored block, a fixed-code block and a
    /// dynamic-code block with long back-references.
    #[test]
    fn inflates_stored_fixed_and_dynamic_blocks() {
        // zlib.compressobj(0, zlib.DEFLATED, -15) of b"abc": a stored block.
        assert_eq!(inflate(&[0x01, 0x03, 0x00, 0xfc, 0xff, b'a', b'b', b'c'], 3).expect("stored"), b"abc");
        // zlib.compressobj(9, zlib.DEFLATED, -15) of b"hello hello hello": fixed codes with a back-reference.
        let fixed = [0xcb, 0x48, 0xcd, 0xc9, 0xc9, 0x57, 0xc8, 0x40, 0x90, 0x00];
        assert_eq!(inflate(&fixed, 17).expect("fixed"), b"hello hello hello");
        // The same at level 9 of 300 bytes drawn from a skewed alphabet by an LCG: a dynamic-code block.
        let alpha = b"aaaaaaaabbbbccd efghijklmnop";
        let mut x: u64 = 7;
        let data: Vec<u8> = (0..300)
            .map(|_| {
                x = (x * 1_103_515_245 + 12_345) % (1 << 31);
                alpha[((x >> 16) % alpha.len() as u64) as usize]
            })
            .collect();
        let dynamic = [
            0x1d, 0x8f, 0x5b, 0x0e, 0x44, 0x21, 0x08, 0x43, 0xb7, 0xe2, 0xd6, 0x5a, 0x54, 0xc0, 0x07, 0xb2,
            0xff, 0xaf, 0xe1, 0x4e, 0x48, 0x20, 0x39, 0xb6, 0x14, 0x1d, 0xd8, 0x07, 0x20, 0x96, 0xd4, 0x58,
            0x7d, 0xee, 0x27, 0x68, 0x2c, 0x92, 0xb3, 0x6b, 0x3d, 0xd2, 0x1b, 0x06, 0x00, 0x1d, 0x84, 0x6e,
            0x57, 0x4c, 0xcc, 0x13, 0xd0, 0xfc, 0x18, 0x6e, 0x75, 0x7f, 0x29, 0x71, 0xaf, 0xcc, 0x07, 0x59,
            0x14, 0xda, 0xbd, 0x01, 0x84, 0x9a, 0xac, 0x09, 0x11, 0x1d, 0x18, 0xdd, 0xb0, 0x58, 0xc2, 0x90,
            0x4a, 0x0a, 0xc5, 0x59, 0x05, 0xed, 0x9f, 0x92, 0x7e, 0x10, 0x56, 0xac, 0xbd, 0xd8, 0x46, 0x83,
            0x58, 0x83, 0x13, 0x4f, 0x8e, 0xc1, 0x58, 0x0d, 0xcd, 0xfa, 0xf0, 0x8a, 0xf7, 0xb9, 0x90, 0x65,
            0x7a, 0xc8, 0xa3, 0x25, 0x18, 0x1c, 0xbc, 0x75, 0x6e, 0x18, 0x7b, 0xeb, 0xe3, 0xe2, 0x96, 0xb8,
            0x53, 0xf9, 0xed, 0x68, 0x32, 0x49, 0x90, 0x7d, 0x2a, 0x6c, 0xb5, 0xb2, 0xd7, 0xf7, 0x22, 0x62,
            0x48, 0x5f, 0x2d, 0x9f, 0x4c, 0x47, 0xc7, 0x07, 0xfd, 0x84, 0x9f, 0x57, 0x1e, 0x3f, 0xbc, 0x75,
            0x70, 0x6e, 0xe0, 0xe6, 0xe7, 0xdd, 0x01, 0x8e, 0xd2, 0x7c, 0x95, 0x10, 0xfd, 0x01,
        ];
        assert_eq!(dynamic[0] >> 1 & 3, 2, "a dynamic block");
        assert_eq!(inflate(&dynamic, 300).expect("dynamic"), data);
        // Bounds: one byte short, one byte over, garbage.
        assert!(inflate(&fixed, 16).is_err());
        assert!(inflate(&fixed, 18).is_err());
        assert!(inflate(&dynamic, 299).is_err());
        assert!(inflate(&[0xff, 0xff, 0xff], 10).is_err());
    }
}
