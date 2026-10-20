//! What both stub modules share (each crate includes this file with `#[path]`): the input buffer, the output
//! arena with its 8-aligned `{u32 len, bytes}` envelopes, the error envelope, the memory epoch (10 §15.8's
//! calling convention), the host imports and FNV-1a, the stubs' only hash.

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
unsafe extern "C" {
    fn host_log(level: u32, ptr: u32, len: u32);
    fn host_panic(ptr: u32, len: u32);
}

/// `host_log` (LogLevel: 0 info, 1 warn, 2 error).
pub fn log(level: u32, msg: &str) {
    #[cfg(target_arch = "wasm32")]
    // SAFETY: the host reads `len` bytes at `ptr` during the call; the string outlives it.
    unsafe {
        host_log(level, msg.as_ptr() as u32, msg.len() as u32);
    }
    #[cfg(not(target_arch = "wasm32"))]
    let _ = (level, msg);
}

/// The panic hook of 10 §3.6: the message, file and line go to `host_panic` before the abort.
pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let msg = info.to_string();
        #[cfg(target_arch = "wasm32")]
        // SAFETY: as in `log`.
        unsafe {
            host_panic(msg.as_ptr() as u32, msg.len() as u32);
        }
        let _ = msg;
    }));
}

/// A trap without a panic message (an `unreachable` instruction, as a corrupted call would hit).
pub fn trap() -> ! {
    #[cfg(target_arch = "wasm32")]
    core::arch::wasm32::unreachable();
    #[cfg(not(target_arch = "wasm32"))]
    std::process::abort()
}

pub const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;

/// FNV-1a, 64 bits: test/helpers/stubs.ts computes the same.
pub fn fnv(mut h: u64, bytes: &[u8]) -> u64 {
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// SimStatus values (schema/abi.yaml).
pub const OK: u32 = 0;
pub const ERR_FRAMING: u32 = 1;
pub const ERR_BLOB_MISSING: u32 = 2;
pub const ERR_LOAD_FORMAT: u32 = 3;
pub const ERR_PROTOS: u32 = 5;
pub const ERR_ORDER: u32 = 6;
pub const ERR_INPUT: u32 = 7;
pub const ERR_LIMIT: u32 = 8;

/// The buffers that cross the boundary. Every move of the input buffer or the arena raises `epoch`.
pub struct Io {
    input: Vec<u8>,
    out: Vec<u8>,
    err: Vec<u8>,
    err_at: usize,
    pub epoch: u32,
}

impl Default for Io {
    fn default() -> Self {
        Self::new()
    }
}

impl Io {
    pub const fn new() -> Self {
        Self { input: Vec::new(), out: Vec::new(), err: Vec::new(), err_at: 0, epoch: 1 }
    }

    pub fn moved(&mut self) {
        self.epoch = self.epoch.wrapping_add(1);
    }

    /// The input buffer, at least `len` bytes (`sim_input`, a declared exception).
    pub fn input(&mut self, len: u32) -> u32 {
        let len = (len as usize).max(64);
        if self.input.len() < len {
            let before = self.input.as_ptr();
            self.input.resize(len, 0);
            if self.input.as_ptr() != before {
                self.moved();
            }
        }
        self.input.as_mut_ptr() as u32
    }

    /// A copy of the request the shell wrote: `len` bytes of the input buffer.
    pub fn request(&self, len: u32) -> Option<Vec<u8>> {
        self.input.get(..len as usize).map(<[u8]>::to_vec)
    }

    /// `bytes` as an envelope in the output arena: an 8-aligned pointer to `{u32 len, bytes}`.
    pub fn envelope(&mut self, bytes: &[u8]) -> u32 {
        let need = bytes.len() + 4 + 8;
        let before = self.out.as_ptr();
        self.out.clear();
        if self.out.capacity() < need {
            self.out.reserve(need);
        }
        if self.out.as_ptr() != before {
            self.moved();
        }
        let base = self.out.as_ptr() as usize;
        let pad = (8 - base % 8) % 8;
        self.out.resize(pad, 0);
        self.out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        self.out.extend_from_slice(bytes);
        (base + pad) as u32
    }

    /// Records the error that `sim_last_error` reports and returns its status.
    pub fn fail(&mut self, code: u32, msg: &str) -> u32 {
        self.err.clear();
        self.err.reserve(16 + msg.len());
        let base = self.err.as_ptr() as usize;
        let pad = (8 - base % 8) % 8;
        self.err.resize(pad, 0);
        self.err.extend_from_slice(&((4 + msg.len()) as u32).to_le_bytes());
        self.err.extend_from_slice(&code.to_le_bytes());
        self.err.extend_from_slice(msg.as_bytes());
        self.err_at = base + pad;
        code
    }

    /// `sim_last_error`'s envelope (its own buffer), or 0 before any failure.
    pub fn last_error(&self) -> u32 {
        if self.err.is_empty() { 0 } else { self.err_at as u32 }
    }
}

/// A little-endian byte sink.
pub struct Out(pub Vec<u8>);

impl Out {
    pub fn u8(&mut self, v: u8) {
        self.0.push(v);
    }
    pub fn u16(&mut self, v: u16) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    pub fn u32(&mut self, v: u32) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    pub fn i32(&mut self, v: i32) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    pub fn u64(&mut self, v: u64) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    pub fn bytes(&mut self, b: &[u8]) {
        self.0.extend_from_slice(b);
    }
    pub fn pad(&mut self, start: usize, align: usize) {
        while !(self.0.len() - start).is_multiple_of(align) {
            self.0.push(0);
        }
    }
}

/// A little-endian integer at `at`, if the bytes are there.
pub fn le(b: &[u8], at: usize, n: usize) -> Option<u64> {
    let s = b.get(at..at + n)?;
    let mut v = 0u64;
    for (i, x) in s.iter().enumerate() {
        v |= u64::from(*x) << (8 * i);
    }
    Some(v)
}
