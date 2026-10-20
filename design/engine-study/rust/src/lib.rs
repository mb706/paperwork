//! Paperwork engine study (WP A1): the Rust port of `ts/kernel.ts`.
//!
//! This is a line-by-line port: the same struct-of-arrays layout, the same algorithms, the same
//! iteration order and the same floating-point evaluation order. Both kernels must produce
//! bit-identical state hashes (checked by `tests/` and the harness); that is what makes the
//! performance comparison fair and doubles as the cross-engine determinism test.
//! No transcendental maths, no hash maps, no FMA (clippy.toml bans them).

#![allow(clippy::too_many_arguments, clippy::needless_range_loop, clippy::needless_late_init)] // mirrors ts/kernel.ts statement by statement

pub const SPACING: i32 = 64;
pub const INF: i32 = 0x3fff_ffff;
pub const WIN: i32 = 32;
const WHEEL_MASK: i32 = 4095;

pub const S_WAIT_SRC: i32 = 0;
pub const S_TO_DROP: i32 = 1;
pub const S_WAIT_DST: i32 = 2;
pub const S_TO_PICK: i32 = 3;
pub const T_BELT: i32 = 0;
pub const T_CHEST: i32 = 1;
pub const T_MACH: i32 = 2;
pub const M_DRILL: i32 = 0;
pub const M_LAB: i32 = 3;
pub const E_INS: i32 = 2;
pub const E_MACH: i32 = 3;
pub const E_ITEM: u32 = 7;
pub const E_HAND: u32 = 8;

const OWN_INS: i32 = 1 << 24;
const OWN_MACH: i32 = 2 << 24;
const OWN_IDX: i32 = 0xff_ffff;
const TRK_SRC: i32 = 0;
const TRK_TGT: i32 = 1;
const TRK_TIMER: i32 = 2;
const TRK_OUT: i32 = 3;
const TRK_MID: i32 = 4;

// list selectors for watch() / fire(): Rust cannot pass `&mut self.list` and `&mut self` together
#[derive(Clone, Copy)]
enum List {
    LAny,
    LMid,
    MAdded,
    MSpace,
    CAdded,
    CSpace,
    Wheel,
}

const SEC_HEADER: u32 = 1;

struct Reader<'a> {
    b: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn u32_at(&self, p: usize) -> u32 {
        u32::from_le_bytes([self.b[p], self.b[p + 1], self.b[p + 2], self.b[p + 3]])
    }
    fn head(&mut self, tag: u32, ty: u32) -> usize {
        let t = self.u32_at(self.pos);
        let y = self.u32_at(self.pos + 4);
        let n = self.u32_at(self.pos + 8) as usize;
        assert!(t == tag && y == ty, "world format: expected section {tag}/{ty}, got {t}/{y}");
        self.pos += 16;
        n
    }
    fn i32s(&mut self, tag: u32) -> Vec<i32> {
        let n = self.head(tag, 1);
        let mut v = Vec::with_capacity(n);
        for k in 0..n {
            v.push(self.u32_at(self.pos + 4 * k) as i32);
        }
        self.pos += (n * 4 + 7) & !7;
        v
    }
    fn f64s(&mut self, tag: u32) -> Vec<f64> {
        let n = self.head(tag, 2);
        let mut v = Vec::with_capacity(n);
        for k in 0..n {
            let p = self.pos + 8 * k;
            let mut a = [0u8; 8];
            a.copy_from_slice(&self.b[p..p + 8]);
            v.push(f64::from_le_bytes(a));
        }
        self.pos += n * 8;
        v
    }
}

pub struct World {
    pub no_sleep: bool,
    pub tick: i32,
    pub research: i32,
    up_d: i32,
    pub node_growths: i32,
    pub timing: bool,
    pub phase_ms: [f64; 5],

    stack: Vec<i32>,
    r_i: Vec<i32>,
    r_inv_ticks: Vec<f64>,
    ip_rot: Vec<f64>,
    ip_ext: Vec<f64>,
    ip_move_e: Vec<f64>,
    mp_work_e: Vec<f64>,
    ep_cap: Vec<f64>,
    ep_drain: Vec<f64>,
    ep_class: Vec<i32>,

    pub n_lines: usize,
    l_len: Vec<i32>,
    l_speed: Vec<i32>,
    l_next: Vec<i32>,
    l_prev: Vec<i32>,
    l_count: Vec<i32>,
    l_front: Vec<i32>,
    l_back: Vec<i32>,
    l_head: Vec<i32>,
    l_mask: Vec<i32>,
    l_off: Vec<i32>,
    l_active_gap: Vec<i32>,
    l_watch_any: Vec<i32>,
    l_watch_mid: Vec<i32>,
    l_act: Vec<u32>,
    l_stamp: Vec<i32>,
    l_end_x: Vec<i32>,
    l_end_y: Vec<i32>,
    l_dir: Vec<i32>,
    l_lane: Vec<i32>,
    i_key: Vec<u16>,
    i_gap: Vec<i16>,

    pub n_ins: usize,
    ins_proto: Vec<i32>,
    ins_state: Vec<i32>,
    ins_held: Vec<i32>,
    ins_held_n: Vec<i32>,
    ins_cap: Vec<i32>,
    ins_src_kind: Vec<i32>,
    ins_src: Vec<i32>,
    ins_src_pos: Vec<i32>,
    ins_dst_kind: Vec<i32>,
    ins_dst: Vec<i32>,
    ins_dst_pos: Vec<i32>,
    ins_elec: Vec<i32>,
    ins_theta: Vec<f64>,
    ins_ext: Vec<f64>,
    ins_pick_theta: Vec<f64>,
    ins_pick_ext: Vec<f64>,
    ins_drop_theta: Vec<f64>,
    ins_drop_ext: Vec<f64>,
    ins_seq: Vec<i32>,
    ins_src_node: Vec<i32>,
    ins_mid_node: Vec<i32>,
    ins_tgt_node: Vec<i32>,
    ins_act: Vec<u32>,

    pub n_mach: usize,
    m_proto: Vec<i32>,
    m_kind: Vec<i32>,
    m_recipe: Vec<i32>,
    m_crafting: Vec<i32>,
    m_inv: Vec<i32>,
    m_n_in: Vec<i32>,
    m_n_out: Vec<i32>,
    m_crafts: Vec<i32>,
    m_elec: Vec<i32>,
    m_out_line: Vec<i32>,
    m_out_pos: Vec<i32>,
    m_progress: Vec<f64>,
    m_speed: Vec<f64>,
    m_full_mask: Vec<i32>,
    m_seq: Vec<i32>,
    m_out_node: Vec<i32>,
    m_added_watch: Vec<i32>,
    m_space_watch: Vec<i32>,
    m_act: Vec<u32>,

    pub n_chests: usize,
    c_inv: Vec<i32>,
    c_slots: Vec<i32>,
    c_added_watch: Vec<i32>,
    c_space_watch: Vec<i32>,
    s_key: Vec<i32>,
    s_count: Vec<i32>,
    s_limit: Vec<i32>,

    pub n_cons: usize,
    c_proto: Vec<i32>,
    e_buf: Vec<f64>,
    pub n_nets: usize,
    net_start: Vec<i32>,
    net_end: Vec<i32>,
    net_gen: Vec<f64>,
    net_solar: Vec<f64>,
    net_acc: Vec<f64>,
    net_acc_cap: Vec<f64>,
    net_acc_rate: Vec<f64>,

    n_next: Vec<i32>,
    n_owner: Vec<i32>,
    n_seq: Vec<i32>,
    n_trk: Vec<i32>,
    free_node: i32,
    wheel: Vec<i32>,

    pub n_ents: usize,
    e_kind: Vec<i32>,
    e_sprite: Vec<i32>,
    e_x2: Vec<i32>,
    e_y2: Vec<i32>,
    e_ref: Vec<i32>,
    chunks_x: i32,
    chunks_y: i32,
    chunk_i: Vec<i32>,
    chunk_dyn: Vec<i32>,
    chunk_static: Vec<i32>,
    chunk_lines: Vec<i32>,
    frame: i32,
    pub out: Vec<u32>,
}

#[inline]
fn bit_set(a: &[u32], i: usize) -> bool {
    a[i >> 5] & (1u32 << (i & 31)) != 0
}

fn set_all(a: &mut [u32], n: usize) {
    a.fill(0);
    for i in 0..n {
        a[i >> 5] |= 1u32 << (i & 31);
    }
}

fn popcount(a: &[u32]) -> i32 {
    a.iter().map(|w| w.count_ones() as i32).sum()
}

impl World {
    pub fn new(buf: &[u8]) -> World {
        let mut r = Reader { b: buf, pos: 0 };
        let h = r.i32s(SEC_HEADER);
        let stack = r.i32s(2);
        let r_i = r.i32s(3);
        let r_time = r.f64s(4);
        let r_inv_ticks = r_time.iter().map(|t| 1.0 / (t * 60.0)).collect();
        let ip = r.f64s(5);
        let n_ip = h[4] as usize;
        let ip_rot = (0..n_ip).map(|p| ip[p * 3]).collect();
        let ip_ext = (0..n_ip).map(|p| ip[p * 3 + 1]).collect();
        let ip_move_e = (0..n_ip).map(|p| ip[p * 3 + 2]).collect();
        let mp_work_e = r.f64s(6);
        let ep = r.f64s(7);
        let n_ep = h[6] as usize;
        let ep_cap = (0..n_ep).map(|p| ep[p * 2]).collect();
        let ep_drain = (0..n_ep).map(|p| ep[p * 2 + 1]).collect();
        let ep_class = r.i32s(8);

        let nl = h[7] as usize;
        let li = r.i32s(9);
        let lg = r.i32s(10);
        let keys = r.i32s(11);
        let gaps = r.i32s(12);
        let col = |v: &Vec<i32>, stride: usize, f: usize, n: usize| -> Vec<i32> { (0..n).map(|k| v[k * stride + f]).collect() };
        let colf = |v: &Vec<f64>, stride: usize, f: usize, n: usize| -> Vec<f64> { (0..n).map(|k| v[k * stride + f]).collect() };

        let ni = h[9] as usize;
        let ii = r.i32s(13);
        let iff = r.f64s(14);
        let nm = h[10] as usize;
        let mi = r.i32s(15);
        let mf = r.f64s(16);
        let nc = h[11] as usize;
        let ci = r.i32s(17);
        let si = r.i32s(18);
        let ns = h[12] as usize;
        let nco = h[13] as usize;
        let coi = r.i32s(19);
        let e_buf = r.f64s(20);
        let nn = h[14] as usize;
        let nni = r.i32s(21);
        let nnf = r.f64s(22);
        let ne = h[15] as usize;
        let ei = r.i32s(23);
        let chunk_i = r.i32s(24);
        let chunk_dyn = r.i32s(25);
        let chunk_static = r.i32s(26);
        let chunk_lines = r.i32s(27);
        let cap = h[21] as usize;

        let s_key = col(&si, 3, 0, ns);
        let m_inv = col(&mi, 11, 4, nm);
        let m_n_in = col(&mi, 11, 5, nm);
        let m_full_mask = (0..nm)
            .map(|m| {
                let mut fm = 0i32;
                for j in 0..m_n_in[m] as usize {
                    fm |= 1 << s_key[m_inv[m] as usize + j];
                }
                fm
            })
            .collect();
        let mut n_next: Vec<i32> = (1..=cap as i32).collect();
        n_next[cap - 1] = -1;

        let mut w = World {
            no_sleep: false,
            tick: 0,
            research: 0,
            up_d: -1,
            node_growths: 0,
            timing: false,
            phase_ms: [0.0; 5],
            stack,
            r_i,
            r_inv_ticks,
            ip_rot,
            ip_ext,
            ip_move_e,
            mp_work_e,
            ep_cap,
            ep_drain,
            ep_class,
            n_lines: nl,
            l_len: col(&li, 9, 0, nl),
            l_speed: col(&li, 9, 1, nl),
            l_next: col(&li, 9, 2, nl),
            l_prev: col(&li, 9, 3, nl),
            l_count: col(&li, 9, 4, nl),
            l_front: col(&li, 9, 5, nl),
            l_back: col(&li, 9, 6, nl),
            l_head: vec![0; nl],
            l_mask: (0..nl).map(|l| li[l * 9 + 7] - 1).collect(),
            l_off: col(&li, 9, 8, nl),
            l_active_gap: vec![0; nl],
            l_watch_any: vec![-1; nl],
            l_watch_mid: vec![-1; nl],
            l_act: vec![0; nl.div_ceil(32)],
            l_stamp: vec![0; nl],
            l_end_x: col(&lg, 4, 0, nl),
            l_end_y: col(&lg, 4, 1, nl),
            l_dir: col(&lg, 4, 2, nl),
            l_lane: col(&lg, 4, 3, nl),
            i_key: keys.iter().map(|&k| k as u16).collect(),
            i_gap: gaps.iter().map(|&g| g as i16).collect(),
            n_ins: ni,
            ins_proto: col(&ii, 13, 0, ni),
            ins_state: col(&ii, 13, 1, ni),
            ins_held: col(&ii, 13, 2, ni),
            ins_held_n: col(&ii, 13, 3, ni),
            ins_cap: col(&ii, 13, 4, ni),
            ins_src_kind: col(&ii, 13, 5, ni),
            ins_src: col(&ii, 13, 6, ni),
            ins_src_pos: col(&ii, 13, 7, ni),
            ins_dst_kind: col(&ii, 13, 8, ni),
            ins_dst: col(&ii, 13, 9, ni),
            ins_dst_pos: col(&ii, 13, 10, ni),
            ins_elec: col(&ii, 13, 11, ni),
            ins_theta: colf(&iff, 6, 0, ni),
            ins_ext: colf(&iff, 6, 1, ni),
            ins_pick_theta: colf(&iff, 6, 2, ni),
            ins_pick_ext: colf(&iff, 6, 3, ni),
            ins_drop_theta: colf(&iff, 6, 4, ni),
            ins_drop_ext: colf(&iff, 6, 5, ni),
            ins_seq: vec![0; ni],
            ins_src_node: vec![-1; ni],
            ins_mid_node: vec![-1; ni],
            ins_tgt_node: vec![-1; ni],
            ins_act: vec![0; ni.div_ceil(32)],
            n_mach: nm,
            m_proto: col(&mi, 11, 0, nm),
            m_kind: col(&mi, 11, 1, nm),
            m_recipe: col(&mi, 11, 2, nm),
            m_crafting: col(&mi, 11, 3, nm),
            m_inv,
            m_n_in,
            m_n_out: col(&mi, 11, 6, nm),
            m_crafts: col(&mi, 11, 7, nm),
            m_elec: col(&mi, 11, 8, nm),
            m_out_line: col(&mi, 11, 9, nm),
            m_out_pos: col(&mi, 11, 10, nm),
            m_progress: colf(&mf, 2, 0, nm),
            m_speed: colf(&mf, 2, 1, nm),
            m_full_mask,
            m_seq: vec![0; nm],
            m_out_node: vec![-1; nm],
            m_added_watch: vec![-1; nm],
            m_space_watch: vec![-1; nm],
            m_act: vec![0; nm.div_ceil(32)],
            n_chests: nc,
            c_inv: col(&ci, 3, 0, nc),
            c_slots: col(&ci, 3, 1, nc),
            c_added_watch: vec![-1; nc],
            c_space_watch: vec![-1; nc],
            s_key,
            s_count: col(&si, 3, 1, ns),
            s_limit: col(&si, 3, 2, ns),
            n_cons: nco,
            c_proto: col(&coi, 2, 0, nco),
            e_buf,
            n_nets: nn,
            net_start: col(&nni, 2, 0, nn),
            net_end: col(&nni, 2, 1, nn),
            net_gen: colf(&nnf, 5, 0, nn),
            net_solar: colf(&nnf, 5, 1, nn),
            net_acc: colf(&nnf, 5, 2, nn),
            net_acc_cap: colf(&nnf, 5, 3, nn),
            net_acc_rate: colf(&nnf, 5, 4, nn),
            n_next,
            n_owner: vec![0; cap],
            n_seq: vec![0; cap],
            n_trk: vec![0; cap],
            free_node: 0,
            wheel: vec![-1; (WHEEL_MASK + 1) as usize],
            n_ents: ne,
            e_kind: col(&ei, 5, 0, ne),
            e_sprite: col(&ei, 5, 1, ne),
            e_x2: col(&ei, 5, 2, ne),
            e_y2: col(&ei, 5, 3, ne),
            e_ref: col(&ei, 5, 4, ne),
            chunks_x: h[16],
            chunks_y: h[17],
            chunk_i,
            chunk_dyn,
            chunk_static,
            chunk_lines,
            frame: 0,
            out: vec![0; 4 * 65536],
        };
        for l in 0..nl {
            w.recompute_active_gap(l);
        }
        w.wake_all();
        w
    }

    pub fn wake_all(&mut self) {
        set_all(&mut self.l_act, self.n_lines);
        set_all(&mut self.ins_act, self.n_ins);
        set_all(&mut self.m_act, self.n_mach);
    }

    pub fn set_no_sleep(&mut self, v: bool) {
        self.no_sleep = v;
        if v {
            self.wake_all();
        }
    }

    // ------------------------------------------------------------ the tick (§4.6 phase order)

    pub fn step(&mut self) {
        self.tick += 1;
        let t = self.tick;
        if self.timing {
            let mut a = now();
            self.fire(List::Wheel, (t & WHEEL_MASK) as usize);
            let mut b = now();
            self.phase_ms[0] += b - a;
            self.electric();
            a = now();
            self.phase_ms[1] += a - b;
            self.machines();
            b = now();
            self.phase_ms[2] += b - a;
            self.lines();
            a = now();
            self.phase_ms[3] += a - b;
            self.inserters();
            b = now();
            self.phase_ms[4] += b - a;
        } else {
            self.fire(List::Wheel, (t & WHEEL_MASK) as usize);
            self.electric();
            self.machines();
            self.lines();
            self.inserters();
        }
    }

    pub fn run(&mut self, n: u32) {
        for _ in 0..n {
            self.step();
        }
    }

    // ------------------------------------------------------------ electric networks (§5.7)

    fn electric(&mut self) {
        let t = self.tick;
        let f = (t % 25000) as f64 / 25000.0;
        let day = if f < 0.25 {
            1.0
        } else if f < 0.45 {
            1.0 - (f - 0.25) / 0.2
        } else if f < 0.55 {
            0.0
        } else if f < 0.75 {
            (f - 0.55) / 0.2
        } else {
            1.0
        };
        for n in 0..self.n_nets {
            self.electric_net(n, day); // one call per network (mirrors ts/kernel.ts)
        }
    }

    fn electric_net(&mut self, n: usize, day: f64) {
        let s = self.net_start[n] as usize;
        let e = self.net_end[n] as usize;
        let mut d_n = 0.0;
        let mut d_i = 0.0;
        for c in s..e {
            let p = self.c_proto[c] as usize;
            let def = self.ep_cap[p] - self.e_buf[c];
            if self.ep_class[p] == 0 {
                d_n += def;
            } else {
                d_i += def;
            }
        }
        let g = self.net_gen[n] + self.net_solar[n] * day;
        let mut acc = self.net_acc[n];
        let rate = self.net_acc_rate[n];
        let sat_n;
        let sat_i;
        if g >= d_n {
            sat_n = 1.0;
            let mut room = self.net_acc_cap[n] - acc;
            if room > rate {
                room = rate;
            }
            let mut ch = g - d_n;
            if ch > room {
                ch = room;
            }
            acc += ch;
            let rest = g - d_n - ch;
            sat_i = if d_i > 0.0 { if rest >= d_i { 1.0 } else { rest / d_i } } else { 1.0 };
        } else {
            let mut d = d_n - g + d_i;
            if d > acc {
                d = acc;
            }
            if d > rate {
                d = rate;
            }
            acc -= d;
            let sup = g + d;
            let mut sn = sup / d_n;
            if sn > 1.0 {
                sn = 1.0;
            }
            sat_n = sn;
            let rest = sup - d_n;
            sat_i = if d_i > 0.0 {
                if rest > 0.0 { if rest >= d_i { 1.0 } else { rest / d_i } } else { 0.0 }
            } else {
                1.0
            };
        }
        self.net_acc[n] = acc;
        for c in s..e {
            let p = self.c_proto[c] as usize;
            let mut b = self.e_buf[c];
            b += (self.ep_cap[p] - b) * (if self.ep_class[p] == 0 { sat_n } else { sat_i });
            b -= self.ep_drain[p];
            self.e_buf[c] = if b < 0.0 { 0.0 } else { b };
        }
    }

    // ------------------------------------------------------------ crafting machines (§5.5)

    fn machines(&mut self) {
        let words = self.m_act.len();
        for w in 0..words {
            let mut bits = self.m_act[w];
            while bits != 0 {
                let b = bits.trailing_zeros();
                self.tick_mach((w << 5) | b as usize);
                bits = if b == 31 { 0 } else { self.m_act[w] & (u32::MAX << (b + 1)) };
            }
        }
    }

    fn tick_mach(&mut self, m: usize) {
        let r = self.m_recipe[m];
        if r < 0 {
            self.sleep_mach(m);
            return;
        }
        let r = r as usize;
        let kind = self.m_kind[m];
        if self.m_crafting[m] == 0 && !self.mach_try_start(m, r, kind) {
            self.mach_blocked(m, kind);
            return;
        }
        let c = self.m_elec[m] as usize;
        let need = self.mp_work_e[self.m_proto[m] as usize];
        let mut buf = self.e_buf[c];
        let sat;
        if buf >= need {
            sat = 1.0;
            buf -= need;
        } else {
            sat = buf / need;
            buf = 0.0;
        }
        self.e_buf[c] = buf;
        let mut prog = self.m_progress[m] + self.m_speed[m] * sat * self.r_inv_ticks[r];
        while prog >= 1.0 {
            prog -= 1.0;
            self.m_crafts[m] = self.m_crafts[m].wrapping_add(1);
            self.mach_finish(m, r, kind);
            if !self.mach_try_start(m, r, kind) {
                self.m_crafting[m] = 0;
                prog = 0.0;
                break;
            }
        }
        self.m_progress[m] = prog;
    }

    fn mach_try_start(&mut self, m: usize, r: usize, kind: i32) -> bool {
        let inv = self.m_inv[m] as usize;
        if kind == M_DRILL {
            if self.s_count[inv] > 0 {
                let key = self.s_key[inv];
                if !self.line_insert(self.m_out_line[m] as usize, self.m_out_pos[m], key) {
                    return false;
                }
                self.s_count[inv] = 0;
            }
            self.m_crafting[m] = 1;
            return true;
        }
        let rb = r * 12;
        let n_in = self.m_n_in[m] as usize;
        let n_out = self.m_n_out[m] as usize;
        for j in 0..n_in {
            if self.s_count[inv + j] < self.r_i[rb + 2 + 2 * j] {
                return false;
            }
        }
        for j in 0..n_out {
            let s = inv + n_in + j;
            if self.s_count[s] + self.r_i[rb + 9 + 2 * j] > self.stack[self.s_key[s] as usize] {
                return false;
            }
        }
        for j in 0..n_in {
            self.s_count[inv + j] -= self.r_i[rb + 2 + 2 * j];
        }
        self.m_crafting[m] = 1;
        if n_in > 0 {
            self.fire(List::MSpace, m);
        }
        true
    }

    fn mach_finish(&mut self, m: usize, r: usize, kind: i32) {
        if kind == M_LAB {
            self.research += 1;
            return;
        }
        let inv = self.m_inv[m] as usize;
        if kind == M_DRILL {
            let key = self.r_i[r * 12 + 8];
            if !self.line_insert(self.m_out_line[m] as usize, self.m_out_pos[m], key) {
                self.s_key[inv] = key;
                self.s_count[inv] = 1;
            }
            return;
        }
        let n_in = self.m_n_in[m] as usize;
        let n_out = self.m_n_out[m] as usize;
        let rb = r * 12;
        for j in 0..n_out {
            self.s_count[inv + n_in + j] += self.r_i[rb + 9 + 2 * j];
        }
        if n_out > 0 {
            self.fire(List::MAdded, m);
        }
    }

    fn mach_blocked(&mut self, m: usize, kind: i32) {
        if self.no_sleep {
            return;
        }
        if kind == M_DRILL {
            let l = self.m_out_line[m] as usize;
            if bit_set(&self.l_act, l) {
                return; // the belt moves: retry next tick
            }
            let seq = self.m_seq[m];
            let nd0 = self.m_out_node[m];
            if nd0 >= 0 {
                self.n_seq[nd0 as usize] = seq;
            } else {
                self.m_out_node[m] = self.watch(List::LAny, l, OWN_MACH | m as i32, TRK_OUT, seq);
            }
        }
        self.sleep_mach(m);
    }

    fn sleep_mach(&mut self, m: usize) {
        if self.no_sleep {
            return;
        }
        self.m_act[m >> 5] &= !(1u32 << (m & 31));
    }

    fn wake_mach(&mut self, m: usize) {
        let w = m >> 5;
        let bit = 1u32 << (m & 31);
        if self.m_act[w] & bit != 0 {
            return;
        }
        self.m_act[w] |= bit;
        self.m_seq[m] = self.m_seq[m].wrapping_add(1);
    }

    // ------------------------------------------------------------ transport lines (§5.3)

    fn lines(&mut self) {
        let words = self.l_act.len();
        for w in 0..words {
            let mut bits = self.l_act[w];
            while bits != 0 {
                let b = bits.trailing_zeros();
                self.tick_line((w << 5) | b as usize);
                bits = if b == 31 { 0 } else { self.l_act[w] & (u32::MAX << (b + 1)) };
            }
        }
    }

    fn tick_line(&mut self, l: usize) {
        let n = self.l_count[l];
        if n == 0 {
            self.sleep_line(l);
            return;
        }
        let sp = self.l_speed[l];
        let mut front = self.l_front[l];
        if front >= sp {
            // FFF-176: the whole line moves by changing two numbers
            self.l_front[l] = front - sp;
            self.l_back[l] += sp;
            let p = self.l_prev[l];
            if p >= 0 {
                self.wake_line(p as usize);
            }
            return;
        }
        let nx = self.l_next[l];
        let room = if nx < 0 {
            front
        } else if self.l_count[nx as usize] == 0 {
            INF
        } else {
            front + self.l_back[nx as usize] - SPACING
        };
        let mut m = if room < sp { room } else { sp };
        if m < 0 {
            m = 0;
        }
        let mut deficit = sp - m;
        let off = self.l_off[l];
        let lm = self.l_mask[l];
        let head = self.l_head[l];
        if deficit > 0 {
            let mut a = self.l_active_gap[l];
            while a < n {
                let k = (off + ((head + a) & lm)) as usize;
                let g = self.i_gap[k] as i32;
                if g > deficit {
                    self.i_gap[k] = (g - deficit) as i16;
                    deficit = 0;
                    break;
                }
                self.i_gap[k] = 0;
                deficit -= g;
                a += 1;
                while a < n && self.i_gap[(off + ((head + a) & lm)) as usize] == 0 {
                    a += 1;
                }
                if deficit == 0 {
                    break;
                }
            }
            self.l_active_gap[l] = a;
        }
        let moved = sp - deficit;
        front -= m;
        if front < 0 {
            let key = self.i_key[(off + head) as usize];
            if n == 1 {
                self.l_count[l] = 0;
                self.l_back[l] = INF;
                self.l_active_gap[l] = 0;
            } else {
                let h1 = (head + 1) & lm;
                self.l_front[l] = front + SPACING + self.i_gap[(off + h1) as usize] as i32;
                self.l_head[l] = h1;
                self.l_count[l] = n - 1;
                self.l_back[l] += moved;
                let mut ag = self.l_active_gap[l];
                if ag == 1 {
                    let nn = n - 1;
                    while ag < nn && self.i_gap[(off + ((h1 + ag) & lm)) as usize] == 0 {
                        ag += 1;
                    }
                } else {
                    ag -= 1;
                }
                self.l_active_gap[l] = ag;
            }
            self.push_back(nx as usize, key, -front);
        } else {
            self.l_front[l] = front;
            self.l_back[l] += moved;
        }
        if moved > 0 {
            let p = self.l_prev[l];
            if p >= 0 {
                self.wake_line(p as usize);
            }
        } else if m == 0 {
            self.sleep_line(l);
        }
    }

    fn push_back(&mut self, l: usize, key: u16, o: i32) {
        let n = self.l_count[l];
        let off = self.l_off[l];
        let lm = self.l_mask[l];
        let head = self.l_head[l];
        let k = (off + ((head + n) & lm)) as usize;
        self.i_key[k] = key;
        if n == 0 {
            self.i_gap[k] = 0;
            self.l_front[l] = self.l_len[l] - o;
            self.l_active_gap[l] = 1;
        } else {
            let g = self.l_back[l] - o - SPACING;
            self.i_gap[k] = g as i16;
            if g == 0 && self.l_active_gap[l] == n {
                self.l_active_gap[l] = n + 1;
            }
        }
        self.l_back[l] = o;
        self.l_count[l] = n + 1;
        self.wake_line(l);
        self.fire(List::LAny, l);
    }

    fn sleep_line(&mut self, l: usize) {
        if self.no_sleep {
            return;
        }
        self.l_act[l >> 5] &= !(1u32 << (l & 31));
    }

    fn wake_line(&mut self, l: usize) {
        let w = l >> 5;
        let bit = 1u32 << (l & 31);
        if self.l_act[w] & bit != 0 {
            return;
        }
        self.l_act[w] |= bit;
        self.fire(List::LAny, l);
    }

    fn recompute_active_gap(&mut self, l: usize) {
        let n = self.l_count[l];
        let off = self.l_off[l];
        let lm = self.l_mask[l];
        let head = self.l_head[l];
        let mut a = 1;
        while a < n && self.i_gap[(off + ((head + a) & lm)) as usize] == 0 {
            a += 1;
        }
        self.l_active_gap[l] = if n == 0 { 0 } else { a };
    }

    fn line_scan(&mut self, l: usize, lo: i32, hi: i32, mask: i32) -> i32 {
        self.up_d = -1;
        let n = self.l_count[l];
        if n == 0 {
            return -1;
        }
        let off = self.l_off[l];
        let lm = self.l_mask[l];
        let head = self.l_head[l];
        let mut d = self.l_front[l];
        for i in 0..n {
            let k = (off + ((head + i) & lm)) as usize;
            if i > 0 {
                d += SPACING + self.i_gap[k] as i32;
            }
            if ((mask as u32) >> self.i_key[k]) & 1 != 0 {
                if d > hi {
                    self.up_d = d;
                    return -1;
                }
                if d >= lo {
                    return i;
                }
            }
        }
        -1
    }

    fn line_remove(&mut self, l: usize, idx: i32) -> u16 {
        let n = self.l_count[l];
        let off = self.l_off[l];
        let lm = self.l_mask[l];
        let head = self.l_head[l];
        let k = (off + ((head + idx) & lm)) as usize;
        let key = self.i_key[k];
        if n == 1 {
            self.l_count[l] = 0;
            self.l_back[l] = INF;
            self.l_active_gap[l] = 0;
            let p = self.l_prev[l];
            if p >= 0 {
                self.wake_line(p as usize);
            }
        } else if idx == 0 {
            let h1 = (head + 1) & lm;
            self.l_front[l] = self.l_front[l] + SPACING + self.i_gap[(off + h1) as usize] as i32;
            self.l_head[l] = h1;
            self.l_count[l] = n - 1;
            let mut ag = self.l_active_gap[l];
            if ag == 1 {
                let nn = n - 1;
                while ag < nn && self.i_gap[(off + ((h1 + ag) & lm)) as usize] == 0 {
                    ag += 1;
                }
            } else {
                ag -= 1;
            }
            self.l_active_gap[l] = ag;
        } else if idx == n - 1 {
            self.l_back[l] = self.l_back[l] + SPACING + self.i_gap[k] as i32;
            self.l_count[l] = n - 1;
            if self.l_active_gap[l] > n - 1 {
                self.l_active_gap[l] = n - 1;
            }
            let p = self.l_prev[l];
            if p >= 0 {
                self.wake_line(p as usize);
            }
        } else {
            let kf = (off + ((head + idx + 1) & lm)) as usize;
            self.i_gap[kf] = (self.i_gap[kf] as i32 + self.i_gap[k] as i32 + SPACING) as i16;
            if idx < n - 1 - idx {
                let mut j = idx;
                while j > 0 {
                    let dst = (off + ((head + j) & lm)) as usize;
                    let src = (off + ((head + j - 1) & lm)) as usize;
                    self.i_key[dst] = self.i_key[src];
                    self.i_gap[dst] = self.i_gap[src];
                    j -= 1;
                }
                self.l_head[l] = (head + 1) & lm;
            } else {
                for j in idx..n - 1 {
                    let dst = (off + ((head + j) & lm)) as usize;
                    let src = (off + ((head + j + 1) & lm)) as usize;
                    self.i_key[dst] = self.i_key[src];
                    self.i_gap[dst] = self.i_gap[src];
                }
            }
            self.l_count[l] = n - 1;
            if self.l_active_gap[l] > idx {
                self.l_active_gap[l] = idx;
            }
        }
        self.wake_line(l);
        key
    }

    fn line_insert(&mut self, l: usize, dp: i32, key: i32) -> bool {
        let n = self.l_count[l];
        let off = self.l_off[l];
        let lm = self.l_mask[l];
        let mut head = self.l_head[l];
        let key = key as u16;
        if n == 0 {
            let k = (off + head) as usize;
            self.i_key[k] = key;
            self.i_gap[k] = 0;
            self.l_front[l] = dp;
            self.l_back[l] = self.l_len[l] - dp;
            self.l_count[l] = 1;
            self.l_active_gap[l] = 1;
            self.wake_line(l);
            self.fire(List::LAny, l);
            return true;
        }
        if n > lm {
            return false;
        }
        let mut i = 0;
        let mut d = self.l_front[l];
        let mut pd = -1;
        while i < n && d <= dp {
            pd = d;
            i += 1;
            if i < n {
                d += SPACING + self.i_gap[(off + ((head + i) & lm)) as usize] as i32;
            }
        }
        if pd >= 0 && dp - pd < SPACING {
            return false;
        }
        if i < n && d - dp < SPACING {
            return false;
        }
        if i == 0 {
            head = (head - 1) & lm;
            let k = (off + head) as usize;
            self.i_key[k] = key;
            self.i_gap[k] = 0;
            let g = d - dp - SPACING;
            self.i_gap[(off + ((head + 1) & lm)) as usize] = g as i16;
            self.l_head[l] = head;
            self.l_front[l] = dp;
            self.l_count[l] = n + 1;
            self.l_active_gap[l] = if g > 0 { 1 } else { self.l_active_gap[l] + 1 };
        } else if i == n {
            let k = (off + ((head + n) & lm)) as usize;
            let g = dp - pd - SPACING;
            self.i_key[k] = key;
            self.i_gap[k] = g as i16;
            self.l_back[l] = self.l_len[l] - dp;
            self.l_count[l] = n + 1;
            if g == 0 && self.l_active_gap[l] == n {
                self.l_active_gap[l] = n + 1;
            }
        } else {
            let g1 = dp - pd - SPACING;
            let g2 = d - dp - SPACING;
            if i < n - i {
                head = (head - 1) & lm;
                for j in 0..i {
                    let dst = (off + ((head + j) & lm)) as usize;
                    let src = (off + ((head + j + 1) & lm)) as usize;
                    self.i_key[dst] = self.i_key[src];
                    self.i_gap[dst] = self.i_gap[src];
                }
                self.l_head[l] = head;
            } else {
                let mut j = n;
                while j > i {
                    let dst = (off + ((head + j) & lm)) as usize;
                    let src = (off + ((head + j - 1) & lm)) as usize;
                    self.i_key[dst] = self.i_key[src];
                    self.i_gap[dst] = self.i_gap[src];
                    j -= 1;
                }
            }
            let k = (off + ((head + i) & lm)) as usize;
            self.i_key[k] = key;
            self.i_gap[k] = g1 as i16;
            self.i_gap[(off + ((head + i + 1) & lm)) as usize] = g2 as i16;
            self.l_count[l] = n + 1;
            if self.l_active_gap[l] == i && g1 == 0 {
                if g2 > 0 {
                    self.l_active_gap[l] = i + 1;
                } else {
                    let mut a = i + 2;
                    while a < n + 1 && self.i_gap[(off + ((head + a) & lm)) as usize] == 0 {
                        a += 1;
                    }
                    self.l_active_gap[l] = a;
                }
            }
        }
        self.wake_line(l);
        self.fire(List::LAny, l);
        if i < n {
            self.fire(List::LMid, l);
        }
        true
    }

    // ------------------------------------------------------------ inserters (§5.4)

    fn inserters(&mut self) {
        let words = self.ins_act.len();
        for w in 0..words {
            let mut bits = self.ins_act[w];
            while bits != 0 {
                let b = bits.trailing_zeros();
                self.tick_ins((w << 5) | b as usize);
                bits = if b == 31 { 0 } else { self.ins_act[w] & (u32::MAX << (b + 1)) };
            }
        }
    }

    fn tick_ins(&mut self, i: usize) {
        let st = self.ins_state[i];
        if st == S_TO_DROP || st == S_TO_PICK {
            self.ins_move(i, st);
        } else if st == S_WAIT_SRC {
            self.ins_pick(i);
        } else {
            self.ins_drop(i);
        }
    }

    fn ins_move(&mut self, i: usize, st: i32) {
        let p = self.ins_proto[i] as usize;
        let need = self.ip_move_e[p];
        let c = self.ins_elec[i] as usize;
        let mut buf = self.e_buf[c];
        let sat;
        if buf >= need {
            sat = 1.0;
            buf -= need;
        } else {
            sat = buf / need;
            buf = 0.0;
        }
        self.e_buf[c] = buf;
        let to_drop = st == S_TO_DROP;
        let tt = if to_drop { self.ins_drop_theta[i] } else { self.ins_pick_theta[i] };
        let te = if to_drop { self.ins_drop_ext[i] } else { self.ins_pick_ext[i] };
        let mut th = self.ins_theta[i];
        let mut d = tt - th;
        if d > 0.5 {
            d -= 1.0;
        } else if d < -0.5 {
            d += 1.0;
        }
        let rs = self.ip_rot[p] * sat;
        if d > rs {
            th += rs;
        } else if d < -rs {
            th -= rs;
        } else {
            th = tt;
        }
        if th >= 1.0 {
            th -= 1.0;
        } else if th < 0.0 {
            th += 1.0;
        }
        let mut ex = self.ins_ext[i];
        let es = self.ip_ext[p] * sat;
        let de = te - ex;
        if de > es {
            ex += es;
        } else if de < -es {
            ex -= es;
        } else {
            ex = te;
        }
        self.ins_theta[i] = th;
        self.ins_ext[i] = ex;
        if th == tt && ex == te {
            self.ins_state[i] = if to_drop { S_WAIT_DST } else { S_WAIT_SRC };
        }
    }

    fn target_mask(&self, dk: i32, dst: usize) -> i32 {
        if dk == T_MACH {
            if self.m_recipe[dst] < 0 {
                return 0;
            }
            let inv = self.m_inv[dst] as usize;
            let n_in = self.m_n_in[dst] as usize;
            let mut mask = 0i32;
            for j in 0..n_in {
                let s = inv + j;
                if self.s_count[s] < self.s_limit[s] {
                    mask |= 1 << self.s_key[s];
                }
            }
            return mask;
        }
        if dk == T_CHEST {
            let inv = self.c_inv[dst] as usize;
            let ns = self.c_slots[dst] as usize;
            let mut mask = 0i32;
            for s in inv..inv + ns {
                let cnt = self.s_count[s];
                if cnt == 0 {
                    return -1;
                }
                if cnt < self.stack[self.s_key[s] as usize] {
                    mask |= 1 << self.s_key[s];
                }
            }
            return mask;
        }
        -1
    }

    fn target_room(&self, dk: i32, dst: usize, key: i32, held: i32, cap: i32) -> i32 {
        if dk == T_MACH {
            let inv = self.m_inv[dst] as usize;
            let n_in = self.m_n_in[dst] as usize;
            for s in inv..inv + n_in {
                if self.s_key[s] == key {
                    let r = self.s_limit[s] - self.s_count[s] - held;
                    return if r < 0 { 0 } else if r < cap { r } else { cap };
                }
            }
            return 0;
        }
        if dk == T_CHEST {
            let inv = self.c_inv[dst] as usize;
            let ns = self.c_slots[dst] as usize;
            let st = self.stack[key as usize];
            let mut free = 0;
            for s in inv..inv + ns {
                let cnt = self.s_count[s];
                if cnt == 0 {
                    free += st;
                } else if self.s_key[s] == key {
                    free += st - cnt;
                }
                if free - held >= cap {
                    return cap;
                }
            }
            let r = free - held;
            return if r < 0 { 0 } else { r };
        }
        cap
    }

    fn ins_pick(&mut self, i: usize) {
        let dk = self.ins_dst_kind[i];
        let dst = self.ins_dst[i] as usize;
        let held_n = self.ins_held_n[i];
        let cap = self.ins_cap[i];
        let mask;
        if held_n > 0 {
            let hk = self.ins_held[i];
            if self.target_room(dk, dst, hk, held_n, 1) == 0 {
                self.ins_state[i] = S_TO_DROP;
                return;
            }
            mask = 1 << hk;
        } else {
            mask = self.target_mask(dk, dst);
            if mask == 0 {
                self.ins_wait_target(i);
                return;
            }
        }
        let sk = self.ins_src_kind[i];
        let src = self.ins_src[i] as usize;
        if sk == T_BELT {
            let pos = self.ins_src_pos[i];
            let idx = self.line_scan(src, pos - WIN, pos + WIN, mask);
            if idx >= 0 {
                let key = self.line_remove(src, idx) as i32;
                self.ins_held[i] = key;
                let nh = held_n + 1;
                self.ins_held_n[i] = nh;
                if nh >= cap || self.target_room(dk, dst, key, nh, 1) == 0 {
                    self.ins_state[i] = S_TO_DROP;
                }
                return;
            }
            if held_n == 0 {
                self.ins_wait_source(i, mask);
            }
            return;
        }
        let (inv, ns) = if sk == T_CHEST {
            (self.c_inv[src] as usize, self.c_slots[src] as usize)
        } else {
            ((self.m_inv[src] + self.m_n_in[src]) as usize, self.m_n_out[src] as usize)
        };
        for s in inv..inv + ns {
            let cnt = self.s_count[s];
            if cnt == 0 {
                continue;
            }
            let key = self.s_key[s];
            if ((mask as u32) >> key) & 1 == 0 {
                continue;
            }
            let mut take = self.target_room(dk, dst, key, 0, cap);
            if take > cnt {
                take = cnt;
            }
            if take == 0 {
                continue;
            }
            self.s_count[s] = cnt - take;
            self.ins_held[i] = key;
            self.ins_held_n[i] = take;
            self.ins_state[i] = S_TO_DROP;
            if sk == T_CHEST {
                self.fire(List::CSpace, src);
            } else {
                self.wake_mach(src);
            }
            return;
        }
        self.ins_wait_source(i, mask);
    }

    fn ins_drop(&mut self, i: usize) {
        let dk = self.ins_dst_kind[i];
        let dst = self.ins_dst[i] as usize;
        let key = self.ins_held[i];
        let mut n = self.ins_held_n[i];
        if dk == T_MACH {
            let inv = self.m_inv[dst] as usize;
            let n_in = self.m_n_in[dst] as usize;
            let mut s = inv;
            while s < inv + n_in && self.s_key[s] != key {
                s += 1;
            }
            if s == inv + n_in || self.s_count[s] + n > self.stack[key as usize] {
                self.ins_wait_target(i);
                return;
            }
            self.s_count[s] += n;
            self.wake_mach(dst);
        } else if dk == T_CHEST {
            let inv = self.c_inv[dst] as usize;
            let ns = self.c_slots[dst] as usize;
            let st = self.stack[key as usize];
            let before = n;
            let mut s = inv;
            while s < inv + ns && n > 0 {
                if self.s_count[s] > 0 && self.s_key[s] == key {
                    let mut put = st - self.s_count[s];
                    if put > n {
                        put = n;
                    }
                    self.s_count[s] += put;
                    n -= put;
                }
                s += 1;
            }
            s = inv;
            while s < inv + ns && n > 0 {
                if self.s_count[s] == 0 {
                    let put = if n < st { n } else { st };
                    self.s_key[s] = key;
                    self.s_count[s] = put;
                    n -= put;
                }
                s += 1;
            }
            if n != before {
                self.fire(List::CAdded, dst);
            }
            if n > 0 {
                self.ins_held_n[i] = n;
                self.ins_wait_target(i);
                return;
            }
        } else {
            if self.line_insert(dst, self.ins_dst_pos[i], key) {
                n -= 1;
            }
            if n > 0 {
                self.ins_held_n[i] = n;
                if !bit_set(&self.l_act, dst) {
                    self.ins_wait_target(i);
                }
                return;
            }
        }
        self.ins_held_n[i] = 0;
        self.ins_held[i] = 0;
        self.ins_state[i] = S_TO_PICK;
    }

    fn ins_wait_target(&mut self, i: usize) {
        if self.no_sleep {
            return;
        }
        let seq = self.ins_seq[i];
        self.watch_tgt(i, seq);
        self.ins_act[i >> 5] &= !(1u32 << (i & 31));
    }

    fn ins_wait_source(&mut self, i: usize, mask: i32) {
        if self.no_sleep {
            return;
        }
        let sk = self.ins_src_kind[i];
        let src = self.ins_src[i] as usize;
        let seq = self.ins_seq[i];
        if sk == T_BELT {
            let up = self.up_d;
            if up >= 0 && bit_set(&self.l_act, src) {
                let sp = self.l_speed[src];
                let dist = up - (self.ins_src_pos[i] + WIN);
                let delay = (dist + sp - 1) / sp; // arrival estimate: a lower bound, so never late
                self.schedule(OWN_INS | i as i32, delay, seq);
                let nd0 = self.ins_mid_node[i];
                if nd0 >= 0 {
                    self.n_seq[nd0 as usize] = seq;
                } else {
                    self.ins_mid_node[i] = self.watch(List::LMid, src, OWN_INS | i as i32, TRK_MID, seq);
                }
            } else {
                self.watch_src(i, List::LAny, src, seq);
            }
        } else if sk == T_CHEST {
            self.watch_src(i, List::CAdded, src, seq);
        } else {
            self.watch_src(i, List::MAdded, src, seq);
        }
        let dk = self.ins_dst_kind[i];
        let widen = if dk == T_MACH { mask != self.m_full_mask[self.ins_dst[i] as usize] } else { mask != -1 };
        if widen {
            self.watch_tgt(i, seq);
        }
        self.ins_act[i >> 5] &= !(1u32 << (i & 31));
    }

    fn wake_ins(&mut self, i: usize) {
        let w = i >> 5;
        let bit = 1u32 << (i & 31);
        if self.ins_act[w] & bit != 0 {
            return;
        }
        self.ins_act[w] |= bit;
        self.ins_seq[i] = self.ins_seq[i].wrapping_add(1);
    }

    // ------------------------------------------------------------ watch lists and the timer wheel (§4.6)

    fn heads(&mut self, list: List) -> &mut Vec<i32> {
        match list {
            List::LAny => &mut self.l_watch_any,
            List::LMid => &mut self.l_watch_mid,
            List::MAdded => &mut self.m_added_watch,
            List::MSpace => &mut self.m_space_watch,
            List::CAdded => &mut self.c_added_watch,
            List::CSpace => &mut self.c_space_watch,
            List::Wheel => &mut self.wheel,
        }
    }

    fn alloc_node(&mut self) -> i32 {
        let mut nd = self.free_node;
        if nd < 0 {
            let old = self.n_next.len();
            let cap = old * 2;
            self.n_next.resize(cap, 0);
            self.n_owner.resize(cap, 0);
            self.n_seq.resize(cap, 0);
            self.n_trk.resize(cap, 0);
            for k in old..cap - 1 {
                self.n_next[k] = k as i32 + 1;
            }
            self.n_next[cap - 1] = -1;
            nd = old as i32;
            self.node_growths += 1;
        }
        self.free_node = self.n_next[nd as usize];
        nd
    }

    fn watch(&mut self, list: List, idx: usize, owner: i32, trk: i32, seq: i32) -> i32 {
        let nd = self.alloc_node();
        let u = nd as usize;
        self.n_owner[u] = owner;
        self.n_seq[u] = seq;
        self.n_trk[u] = trk;
        let h = self.heads(list);
        let old = h[idx];
        h[idx] = nd;
        self.n_next[u] = old;
        nd
    }

    fn watch_src(&mut self, i: usize, list: List, idx: usize, seq: i32) {
        let nd0 = self.ins_src_node[i];
        if nd0 >= 0 {
            self.n_seq[nd0 as usize] = seq;
            return;
        }
        self.ins_src_node[i] = self.watch(list, idx, OWN_INS | i as i32, TRK_SRC, seq);
    }

    fn watch_tgt(&mut self, i: usize, seq: i32) {
        let nd0 = self.ins_tgt_node[i];
        if nd0 >= 0 {
            self.n_seq[nd0 as usize] = seq;
            return;
        }
        let dk = self.ins_dst_kind[i];
        let dst = self.ins_dst[i] as usize;
        let list = if dk == T_MACH {
            List::MSpace
        } else if dk == T_CHEST {
            List::CSpace
        } else {
            List::LAny
        };
        self.ins_tgt_node[i] = self.watch(list, dst, OWN_INS | i as i32, TRK_TGT, seq);
    }

    fn schedule(&mut self, owner: i32, delay: i32, seq: i32) {
        let b = ((self.tick + delay) & WHEEL_MASK) as usize;
        self.watch(List::Wheel, b, owner, TRK_TIMER, seq);
    }

    fn fire(&mut self, list: List, idx: usize) {
        let h = self.heads(list);
        let mut nd = h[idx];
        if nd < 0 {
            return;
        }
        h[idx] = -1;
        while nd >= 0 {
            let u = nd as usize;
            let next = self.n_next[u];
            let o = self.n_owner[u];
            let x = (o & OWN_IDX) as usize;
            let trk = self.n_trk[u];
            if (o as u32) >> 24 == 1 {
                if trk == TRK_SRC {
                    if self.ins_src_node[x] == nd {
                        self.ins_src_node[x] = -1;
                    }
                } else if trk == TRK_MID {
                    if self.ins_mid_node[x] == nd {
                        self.ins_mid_node[x] = -1;
                    }
                } else if trk == TRK_TGT && self.ins_tgt_node[x] == nd {
                    self.ins_tgt_node[x] = -1;
                }
                if self.n_seq[u] == self.ins_seq[x] {
                    self.wake_ins(x);
                }
            } else {
                if trk == TRK_OUT && self.m_out_node[x] == nd {
                    self.m_out_node[x] = -1;
                }
                if self.n_seq[u] == self.m_seq[x] {
                    self.wake_mach(x);
                }
            }
            self.n_next[u] = self.free_node;
            self.free_node = nd;
            nd = next;
        }
    }

    // ------------------------------------------------------------ state hash (§4.1 item 7)

    pub fn hash(&self) -> u32 {
        let mut h = Xxh32::new();
        h.u32(self.tick as u32);
        h.u32(self.research as u32);
        for l in 0..self.n_lines {
            let n = self.l_count[l];
            h.u32(n as u32);
            if n == 0 {
                continue;
            }
            h.u32(self.l_front[l] as u32);
            h.u32(self.l_back[l] as u32);
            let off = self.l_off[l];
            let lm = self.l_mask[l];
            let head = self.l_head[l];
            for i in 0..n {
                let k = (off + ((head + i) & lm)) as usize;
                let g = if i == 0 { 0u32 } else { self.i_gap[k] as u16 as u32 };
                h.u32(self.i_key[k] as u32 | (g << 16));
            }
        }
        for i in 0..self.n_ins {
            h.u32(self.ins_state[i] as u32);
            h.u32(if self.ins_held_n[i] == 0 { 0 } else { self.ins_held[i] as u32 });
            h.u32(self.ins_held_n[i] as u32);
            h.f64(self.ins_theta[i]);
            h.f64(self.ins_ext[i]);
        }
        for m in 0..self.n_mach {
            h.u32(self.m_recipe[m] as u32);
            h.u32(self.m_crafting[m] as u32);
            h.u32(self.m_crafts[m] as u32);
            h.f64(self.m_progress[m]);
        }
        for s in 0..self.s_key.len() {
            h.u32(self.s_key[s] as u32);
            h.u32(self.s_count[s] as u32);
        }
        for c in 0..self.n_cons {
            h.f64(self.e_buf[c]);
        }
        for n in 0..self.n_nets {
            h.f64(self.net_acc[n]);
        }
        h.digest()
    }

    // ------------------------------------------------------------ statistics (outside the tick)
    // [tick, research, lines, linesActive, linesNonEmpty, beltItems, inserters, insActive, insMoving,
    //  insWaitSrc, insWaitDst, machines, machActive, machCrafting, nodeGrowths]
    pub fn stats(&self) -> [f64; 15] {
        let mut belt_items = 0i64;
        let mut non_empty = 0;
        for l in 0..self.n_lines {
            belt_items += self.l_count[l] as i64;
            if self.l_count[l] > 0 {
                non_empty += 1;
            }
        }
        let mut by_state = [0i32; 4];
        for i in 0..self.n_ins {
            by_state[self.ins_state[i] as usize] += 1;
        }
        let crafting: i32 = self.m_crafting.iter().sum();
        [
            self.tick as f64,
            self.research as f64,
            self.n_lines as f64,
            popcount(&self.l_act) as f64,
            non_empty as f64,
            belt_items as f64,
            self.n_ins as f64,
            popcount(&self.ins_act) as f64,
            (by_state[S_TO_DROP as usize] + by_state[S_TO_PICK as usize]) as f64,
            by_state[S_WAIT_SRC as usize] as f64,
            by_state[S_WAIT_DST as usize] as f64,
            self.n_mach as f64,
            popcount(&self.m_act) as f64,
            crafting as f64,
            self.node_growths as f64,
        ]
    }

    // ------------------------------------------------------------ render extraction (§3.2 `dyn`, §6.2)

    pub fn extract(&mut self, x0: f64, y0: f64, x1: f64, y1: f64, full: bool) -> usize {
        self.frame = self.frame.wrapping_add(1);
        let fr = self.frame;
        let cx0 = 0.max((x0 / 32.0).floor() as i32);
        let cy0 = 0.max((y0 / 32.0).floor() as i32);
        let cx1 = (self.chunks_x - 1).min(((x1 - 1.0) / 32.0).floor() as i32);
        let cy1 = (self.chunks_y - 1).min(((y1 - 1.0) / 32.0).floor() as i32);
        let mut n = 0usize;
        for cy in cy0..=cy1 {
            for cx in cx0..=cx1 {
                let cb = ((cy * self.chunks_x + cx) * 6) as usize;
                if full {
                    let so = self.chunk_i[cb + 2] as usize;
                    let sn = self.chunk_i[cb + 3] as usize;
                    for k in so..so + sn {
                        n = self.emit_ent(self.chunk_static[k] as usize, n, x0, y0, x1, y1);
                    }
                }
                let d_off = self.chunk_i[cb] as usize;
                let dn = self.chunk_i[cb + 1] as usize;
                for k in d_off..d_off + dn {
                    n = self.emit_ent(self.chunk_dyn[k] as usize, n, x0, y0, x1, y1);
                }
                let lo = self.chunk_i[cb + 4] as usize;
                let ln = self.chunk_i[cb + 5] as usize;
                for k in lo..lo + ln {
                    let l = self.chunk_lines[k] as usize;
                    if self.l_stamp[l] == fr {
                        continue;
                    }
                    self.l_stamp[l] = fr;
                    n = self.emit_line(l, n, x0, y0, x1, y1);
                }
            }
        }
        n
    }

    fn ensure_out(&mut self, count: usize) {
        if count * 4 <= self.out.len() {
            return;
        }
        let mut size = self.out.len();
        while count * 4 > size {
            size *= 2;
        }
        self.out.resize(size, 0);
    }

    fn emit_ent(&mut self, e: usize, n: usize, x0: f64, y0: f64, x1: f64, y1: f64) -> usize {
        let x = self.e_x2[e] as f64 * 0.5;
        let y = self.e_y2[e] as f64 * 0.5;
        if x < x0 || x >= x1 || y < y0 || y >= y1 {
            return n;
        }
        let kind = self.e_kind[e];
        let r = self.e_ref[e] as usize;
        self.ensure_out(n + 2);
        let o = n * 4;
        let xf = (x as f32).to_bits();
        let yf = (y as f32).to_bits();
        self.out[o] = xf;
        self.out[o + 1] = yf;
        if kind == E_MACH {
            self.out[o + 2] = ((E_MACH << 24) | self.e_sprite[e]) as u32;
            self.out[o + 3] = ((self.m_progress[r] * 32.0).floor() as i32 | (self.m_crafting[r] << 8)) as u32;
            return n + 1;
        }
        if kind == E_INS {
            self.out[o + 2] = ((E_INS << 24) | self.e_sprite[e]) as u32;
            self.out[o + 3] = self.ins_state[r] as u32;
            let o = o + 4;
            self.out[o] = xf;
            self.out[o + 1] = yf;
            let held = if self.ins_held_n[r] > 0 { self.ins_held[r] as u32 + 1 } else { 0 };
            self.out[o + 2] = (E_HAND << 24) | held;
            self.out[o + 3] = ((self.ins_theta[r] * 65536.0).floor() as i32 | (((self.ins_ext[r] * 4096.0).floor() as i32) << 16)) as u32;
            return n + 2;
        }
        self.out[o + 2] = ((kind << 24) | self.e_sprite[e]) as u32;
        self.out[o + 3] = 0;
        n + 1
    }

    fn emit_line(&mut self, l: usize, mut n: usize, x0: f64, y0: f64, x1: f64, y1: f64) -> usize {
        let cnt = self.l_count[l];
        if cnt == 0 {
            return n;
        }
        self.ensure_out(n + cnt as usize);
        let off = self.l_off[l];
        let lm = self.l_mask[l];
        let head = self.l_head[l];
        let dir = self.l_dir[l];
        let ex = self.l_end_x[l];
        let ey = self.l_end_y[l];
        let lane = self.l_lane[l];
        let dx = if dir == 0 { 1 } else if dir == 2 { -1 } else { 0 };
        let dy = if dir == 1 { 1 } else if dir == 3 { -1 } else { 0 };
        let bx = ex + dy * lane;
        let by = ey - dx * lane;
        let mut d = self.l_front[l];
        for i in 0..cnt {
            let k = (off + ((head + i) & lm)) as usize;
            if i > 0 {
                d += SPACING + self.i_gap[k] as i32;
            }
            let x = (bx - dx * d) as f64 * (1.0 / 256.0);
            let y = (by - dy * d) as f64 * (1.0 / 256.0);
            if x < x0 || x >= x1 || y < y0 || y >= y1 {
                continue;
            }
            let o = n * 4;
            self.out[o] = (x as f32).to_bits();
            self.out[o + 1] = (y as f32).to_bits();
            self.out[o + 2] = (E_ITEM << 24) | self.i_key[k] as u32;
            self.out[o + 3] = 0;
            n += 1;
        }
        n
    }
}

// xxHash32 over a stream of little-endian u32 words (seed 0); matches Xxh32 in ts/kernel.ts
const P1: u32 = 2654435761;
const P2: u32 = 2246822519;
const P3: u32 = 3266489917;
const P4: u32 = 668265263;
const P5: u32 = 374761393;

pub struct Xxh32 {
    v: [u32; 4],
    buf: [u32; 4],
    nb: usize,
    total: u32,
}

impl Default for Xxh32 {
    fn default() -> Self {
        Self::new()
    }
}

impl Xxh32 {
    pub fn new() -> Xxh32 {
        Xxh32 { v: [P1.wrapping_add(P2), P2, 0, 0u32.wrapping_sub(P1)], buf: [0; 4], nb: 0, total: 0 }
    }
    pub fn u32(&mut self, x: u32) {
        self.buf[self.nb] = x;
        self.nb += 1;
        self.total = self.total.wrapping_add(4);
        if self.nb == 4 {
            for k in 0..4 {
                self.v[k] = self.v[k].wrapping_add(self.buf[k].wrapping_mul(P2)).rotate_left(13).wrapping_mul(P1);
            }
            self.nb = 0;
        }
    }
    pub fn f64(&mut self, x: f64) {
        let b = x.to_bits();
        self.u32(b as u32);
        self.u32((b >> 32) as u32);
    }
    pub fn digest(&self) -> u32 {
        let mut h = if self.total >= 16 {
            self.v[0]
                .rotate_left(1)
                .wrapping_add(self.v[1].rotate_left(7))
                .wrapping_add(self.v[2].rotate_left(12))
                .wrapping_add(self.v[3].rotate_left(18))
        } else {
            P5
        };
        h = h.wrapping_add(self.total);
        for k in 0..self.nb {
            h = h.wrapping_add(self.buf[k].wrapping_mul(P3)).rotate_left(17).wrapping_mul(P4);
        }
        h ^= h >> 15;
        h = h.wrapping_mul(P2);
        h ^= h >> 13;
        h = h.wrapping_mul(P3);
        h ^= h >> 16;
        h
    }
}

pub fn xxh32_words(words: &[u32]) -> u32 {
    let mut h = Xxh32::new();
    for &w in words {
        h.u32(w);
    }
    h.digest()
}

// ---------------------------------------------------------------- time source for phase timing

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
unsafe extern "C" {
    #[link_name = "now"]
    fn js_now() -> f64;
}

#[cfg(target_arch = "wasm32")]
fn now() -> f64 {
    unsafe { js_now() }
}

#[cfg(not(target_arch = "wasm32"))]
fn now() -> f64 {
    use std::sync::OnceLock;
    use std::time::Instant;
    static T0: OnceLock<Instant> = OnceLock::new();
    T0.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
}

// ---------------------------------------------------------------- the WebAssembly API (C ABI, no bindgen)
// JS: p = alloc(len); copy the world bytes to memory at p; load(p, len); step(n); hash(); extract(...).

#[cfg(target_arch = "wasm32")]
mod wasm_api {
    use super::World;
    use core::ptr::null_mut;

    static mut WORLD: *mut World = null_mut();
    static mut STATS: [f64; 15] = [0.0; 15];

    fn w() -> &'static mut World {
        unsafe { &mut *WORLD }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn alloc(len: usize) -> *mut u8 {
        let mut v: Vec<u8> = Vec::with_capacity(len);
        let p = v.as_mut_ptr();
        core::mem::forget(v);
        p
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn dealloc(p: *mut u8, len: usize) {
        unsafe { drop(Vec::from_raw_parts(p, 0, len)) }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn load(p: *const u8, len: usize) {
        let bytes = unsafe { core::slice::from_raw_parts(p, len) };
        let world = Box::new(World::new(bytes));
        unsafe {
            if !WORLD.is_null() {
                drop(Box::from_raw(WORLD));
            }
            WORLD = Box::into_raw(world);
        }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn step(n: u32) {
        w().run(n);
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn set_no_sleep(v: u32) {
        w().set_no_sleep(v != 0);
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn set_timing(v: u32) {
        w().timing = v != 0;
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn phase_ms(k: u32) -> f64 {
        w().phase_ms[k as usize]
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn reset_phase_ms() {
        w().phase_ms = [0.0; 5];
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn hash() -> u32 {
        w().hash()
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn tick() -> i32 {
        w().tick
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn stats() -> *const f64 {
        unsafe {
            STATS = w().stats();
            core::ptr::addr_of!(STATS) as *const f64
        }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn extract(x0: f64, y0: f64, x1: f64, y1: f64, full: u32) -> u32 {
        w().extract(x0, y0, x1, y1, full != 0) as u32
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn out_ptr() -> *const u32 {
        w().out.as_ptr()
    }
}
