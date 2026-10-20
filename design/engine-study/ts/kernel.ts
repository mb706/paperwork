// Paperwork engine study (WP A1): the TypeScript simulation kernel.
//
// Systems (spec 10): transport lines (§5.3), inserters (§5.4), crafting machines, furnaces, labs and drills
// (§5.5), electric networks (§5.7), active sets, watch lists and the timer wheel (§4.6).
// rust/src/lib.rs is a line-by-line port. Both must give bit-identical state hashes; that is the
// fairness check of the comparison (the same work is done) and the cross-engine determinism test.
//
// Rules followed (spec 10 §2.5, §4.1): struct-of-arrays typed arrays, no allocation in the tick,
// monomorphic code, no Math transcendentals, fixed iteration order.
// Active sets are bitsets iterated in pool-index order (not swap-remove lists), so that sleeping is a
// pure optimisation: a run with sleep disabled (noSleep) gives the same hash (§4.6 NO_SLEEP equivalence).

import { H, Reader, SEC } from './format.ts';
import type { SimLike } from './sim-like.ts';

export const SPACING = 64; // positions between item centres on a compressed lane (1/4 tile)
export const INF = 0x3fffffff;
export const WIN = 32; // half-width of an inserter's belt pickup window, in positions
const WHEEL_MASK = 4095; // 4,096-bucket timer wheel (§4.6); every delay here is < 4,096 ticks

// inserter states
export const S_WAIT_SRC = 0;
export const S_TO_DROP = 1;
export const S_WAIT_DST = 2;
export const S_TO_PICK = 3;
// inserter endpoint kinds
export const T_BELT = 0;
export const T_CHEST = 1;
export const T_MACH = 2;
// machine kinds
export const M_DRILL = 0;
export const M_FURNACE = 1;
export const M_ASM = 2;
export const M_LAB = 3;
// entity kinds (render)
export const E_BELT = 1;
export const E_INS = 2;
export const E_MACH = 3;
export const E_CHEST = 4;
export const E_POLE = 5;
export const E_DECOR = 6;
export const E_ITEM = 7;
export const E_HAND = 8;

// watch-list nodes
const OWN_INS = 1 << 24;
const OWN_MACH = 2 << 24;
const OWN_IDX = 0xffffff;
const TRK_SRC = 0;
const TRK_TGT = 1;
const TRK_TIMER = 2;
const TRK_OUT = 3;
const TRK_MID = 4;

export const PHASES = ['timers', 'electric', 'machines', 'belts', 'inserters'] as const;

export class World implements SimLike {
  noSleep = false;
  tick = 0;
  research = 0;
  upD = -1; // scratch: distance of the nearest acceptable upstream item found by lineScan
  nodeGrowths = 0;
  timing = false;
  now: () => number = () => 0;
  phaseAcc = new Float64Array(5);

  // tables
  stack: Int32Array;
  rI: Int32Array;
  rInvTicks: Float64Array;
  ipRot: Float64Array;
  ipExt: Float64Array;
  ipMoveE: Float64Array;
  mpWorkE: Float64Array;
  epCap: Float64Array;
  epDrain: Float64Array;
  epClass: Int32Array;

  // transport lines
  nLines: number;
  lLen: Int32Array;
  lSpeed: Int32Array;
  lNext: Int32Array;
  lPrev: Int32Array;
  lCount: Int32Array;
  lFront: Int32Array;
  lBack: Int32Array;
  lHead: Int32Array;
  lMask: Int32Array;
  lOff: Int32Array;
  lActiveGap: Int32Array;
  lWatchAny: Int32Array;
  lWatchMid: Int32Array;
  lAct: Int32Array;
  lStamp: Int32Array;
  lEndX: Int32Array;
  lEndY: Int32Array;
  lDir: Int32Array;
  lLane: Int32Array;
  iKey: Uint16Array;
  iGap: Int16Array;

  // inserters
  nIns: number;
  insProto: Int32Array;
  insState: Int32Array;
  insHeld: Int32Array;
  insHeldN: Int32Array;
  insCap: Int32Array;
  insSrcKind: Int32Array;
  insSrc: Int32Array;
  insSrcPos: Int32Array;
  insDstKind: Int32Array;
  insDst: Int32Array;
  insDstPos: Int32Array;
  insElec: Int32Array;
  insTheta: Float64Array;
  insExt: Float64Array;
  insPickTheta: Float64Array;
  insPickExt: Float64Array;
  insDropTheta: Float64Array;
  insDropExt: Float64Array;
  insSeq: Int32Array;
  insSrcNode: Int32Array; // node in the source's list (a line's any-list, or a chest's / machine's added-list)
  insMidNode: Int32Array; // node in the source line's mid-list (while waiting on an arrival timer)
  insTgtNode: Int32Array; // node in the target's list
  insAct: Int32Array;

  // crafting machines (drills, furnaces, assemblers, labs)
  nMach: number;
  mProto: Int32Array;
  mKind: Int32Array;
  mRecipe: Int32Array;
  mCrafting: Int32Array;
  mInv: Int32Array;
  mNIn: Int32Array;
  mNOut: Int32Array;
  mCrafts: Int32Array;
  mElec: Int32Array;
  mOutLine: Int32Array;
  mOutPos: Int32Array;
  mProgress: Float64Array;
  mSpeed: Float64Array;
  mFullMask: Int32Array;
  mSeq: Int32Array;
  mOutNode: Int32Array;
  mAddedWatch: Int32Array;
  mSpaceWatch: Int32Array;
  mAct: Int32Array;

  // chests and the slot heap
  nChests: number;
  cInv: Int32Array;
  cSlots: Int32Array;
  cAddedWatch: Int32Array;
  cSpaceWatch: Int32Array;
  sKey: Int32Array;
  sCount: Int32Array;
  sLimit: Int32Array;

  // electric
  nCons: number;
  cProto: Int32Array;
  eBuf: Float64Array;
  nNets: number;
  netStart: Int32Array;
  netEnd: Int32Array;
  netGen: Float64Array;
  netSolar: Float64Array;
  netAcc: Float64Array;
  netAccCap: Float64Array;
  netAccRate: Float64Array;

  // watch-list / timer nodes
  nNext: Int32Array;
  nOwner: Int32Array;
  nSeq: Int32Array;
  nTrk: Int32Array;
  freeNode: number;
  wheel: Int32Array;

  // render
  nEnts: number;
  eKind: Int32Array;
  eSprite: Int32Array;
  eX2: Int32Array;
  eY2: Int32Array;
  eRef: Int32Array;
  chunksX: number;
  chunksY: number;
  chunkI: Int32Array;
  chunkDyn: Int32Array;
  chunkStatic: Int32Array;
  chunkLines: Int32Array;
  frame = 0;
  out: ArrayBuffer;
  outF: Float32Array;
  outU: Uint32Array;

  constructor(buf: ArrayBuffer) {
    const r = new Reader(buf);
    const h = r.i32(SEC.HEADER);
    this.stack = r.i32(SEC.ITEM_STACK);
    this.rI = r.i32(SEC.RECIPE_I);
    const rTime = r.f64(SEC.RECIPE_F);
    this.rInvTicks = new Float64Array(rTime.length);
    for (let i = 0; i < rTime.length; i++) this.rInvTicks[i] = 1 / (rTime[i] * 60);
    const ip = r.f64(SEC.IPROTO_F);
    const nIP = h[H.nIProtos];
    this.ipRot = new Float64Array(nIP);
    this.ipExt = new Float64Array(nIP);
    this.ipMoveE = new Float64Array(nIP);
    for (let p = 0; p < nIP; p++) {
      this.ipRot[p] = ip[p * 3];
      this.ipExt[p] = ip[p * 3 + 1];
      this.ipMoveE[p] = ip[p * 3 + 2];
    }
    this.mpWorkE = r.f64(SEC.MPROTO_F);
    const ep = r.f64(SEC.EPROTO_F);
    const nEP = h[H.nEProtos];
    this.epCap = new Float64Array(nEP);
    this.epDrain = new Float64Array(nEP);
    for (let p = 0; p < nEP; p++) {
      this.epCap[p] = ep[p * 2];
      this.epDrain[p] = ep[p * 2 + 1];
    }
    this.epClass = r.i32(SEC.EPROTO_I);

    // lines
    const nL = (this.nLines = h[H.nLines]);
    const li = r.i32(SEC.LINE_I);
    const lg = r.i32(SEC.LINE_GEOM);
    this.lLen = new Int32Array(nL);
    this.lSpeed = new Int32Array(nL);
    this.lNext = new Int32Array(nL);
    this.lPrev = new Int32Array(nL);
    this.lCount = new Int32Array(nL);
    this.lFront = new Int32Array(nL);
    this.lBack = new Int32Array(nL);
    this.lHead = new Int32Array(nL);
    this.lMask = new Int32Array(nL);
    this.lOff = new Int32Array(nL);
    this.lActiveGap = new Int32Array(nL);
    this.lWatchAny = new Int32Array(nL).fill(-1);
    this.lWatchMid = new Int32Array(nL).fill(-1);
    this.lStamp = new Int32Array(nL);
    this.lEndX = new Int32Array(nL);
    this.lEndY = new Int32Array(nL);
    this.lDir = new Int32Array(nL);
    this.lLane = new Int32Array(nL);
    const keys = r.i32(SEC.ITEM_KEY);
    const gaps = r.i32(SEC.ITEM_GAP);
    this.iKey = Uint16Array.from(keys);
    this.iGap = Int16Array.from(gaps);
    for (let l = 0; l < nL; l++) {
      const b = l * 9;
      this.lLen[l] = li[b];
      this.lSpeed[l] = li[b + 1];
      this.lNext[l] = li[b + 2];
      this.lPrev[l] = li[b + 3];
      this.lCount[l] = li[b + 4];
      this.lFront[l] = li[b + 5];
      this.lBack[l] = li[b + 6];
      this.lMask[l] = li[b + 7] - 1;
      this.lOff[l] = li[b + 8];
      this.lHead[l] = 0;
      this.lEndX[l] = lg[l * 4];
      this.lEndY[l] = lg[l * 4 + 1];
      this.lDir[l] = lg[l * 4 + 2];
      this.lLane[l] = lg[l * 4 + 3];
      this.recomputeActiveGap(l);
    }
    this.lAct = new Int32Array((nL + 31) >>> 5);

    // inserters
    const nI = (this.nIns = h[H.nIns]);
    const ii = r.i32(SEC.INS_I);
    const iff = r.f64(SEC.INS_F);
    this.insProto = new Int32Array(nI);
    this.insState = new Int32Array(nI);
    this.insHeld = new Int32Array(nI);
    this.insHeldN = new Int32Array(nI);
    this.insCap = new Int32Array(nI);
    this.insSrcKind = new Int32Array(nI);
    this.insSrc = new Int32Array(nI);
    this.insSrcPos = new Int32Array(nI);
    this.insDstKind = new Int32Array(nI);
    this.insDst = new Int32Array(nI);
    this.insDstPos = new Int32Array(nI);
    this.insElec = new Int32Array(nI);
    this.insTheta = new Float64Array(nI);
    this.insExt = new Float64Array(nI);
    this.insPickTheta = new Float64Array(nI);
    this.insPickExt = new Float64Array(nI);
    this.insDropTheta = new Float64Array(nI);
    this.insDropExt = new Float64Array(nI);
    this.insSeq = new Int32Array(nI);
    this.insSrcNode = new Int32Array(nI).fill(-1);
    this.insMidNode = new Int32Array(nI).fill(-1);
    this.insTgtNode = new Int32Array(nI).fill(-1);
    for (let i = 0; i < nI; i++) {
      const b = i * 13;
      this.insProto[i] = ii[b];
      this.insState[i] = ii[b + 1];
      this.insHeld[i] = ii[b + 2];
      this.insHeldN[i] = ii[b + 3];
      this.insCap[i] = ii[b + 4];
      this.insSrcKind[i] = ii[b + 5];
      this.insSrc[i] = ii[b + 6];
      this.insSrcPos[i] = ii[b + 7];
      this.insDstKind[i] = ii[b + 8];
      this.insDst[i] = ii[b + 9];
      this.insDstPos[i] = ii[b + 10];
      this.insElec[i] = ii[b + 11];
      const f = i * 6;
      this.insTheta[i] = iff[f];
      this.insExt[i] = iff[f + 1];
      this.insPickTheta[i] = iff[f + 2];
      this.insPickExt[i] = iff[f + 3];
      this.insDropTheta[i] = iff[f + 4];
      this.insDropExt[i] = iff[f + 5];
    }
    this.insAct = new Int32Array((nI + 31) >>> 5);

    // machines
    const nM = (this.nMach = h[H.nMach]);
    const mi = r.i32(SEC.MACH_I);
    const mf = r.f64(SEC.MACH_F);
    this.mProto = new Int32Array(nM);
    this.mKind = new Int32Array(nM);
    this.mRecipe = new Int32Array(nM);
    this.mCrafting = new Int32Array(nM);
    this.mInv = new Int32Array(nM);
    this.mNIn = new Int32Array(nM);
    this.mNOut = new Int32Array(nM);
    this.mCrafts = new Int32Array(nM);
    this.mElec = new Int32Array(nM);
    this.mOutLine = new Int32Array(nM);
    this.mOutPos = new Int32Array(nM);
    this.mProgress = new Float64Array(nM);
    this.mSpeed = new Float64Array(nM);
    this.mFullMask = new Int32Array(nM);
    this.mSeq = new Int32Array(nM);
    this.mOutNode = new Int32Array(nM).fill(-1);
    this.mAddedWatch = new Int32Array(nM).fill(-1);
    this.mSpaceWatch = new Int32Array(nM).fill(-1);
    for (let m = 0; m < nM; m++) {
      const b = m * 11;
      this.mProto[m] = mi[b];
      this.mKind[m] = mi[b + 1];
      this.mRecipe[m] = mi[b + 2];
      this.mCrafting[m] = mi[b + 3];
      this.mInv[m] = mi[b + 4];
      this.mNIn[m] = mi[b + 5];
      this.mNOut[m] = mi[b + 6];
      this.mCrafts[m] = mi[b + 7];
      this.mElec[m] = mi[b + 8];
      this.mOutLine[m] = mi[b + 9];
      this.mOutPos[m] = mi[b + 10];
      this.mProgress[m] = mf[m * 2];
      this.mSpeed[m] = mf[m * 2 + 1];
    }
    this.mAct = new Int32Array((nM + 31) >>> 5);

    // chests, slots
    const nC = (this.nChests = h[H.nChests]);
    const ci = r.i32(SEC.CHEST_I);
    this.cInv = new Int32Array(nC);
    this.cSlots = new Int32Array(nC);
    this.cAddedWatch = new Int32Array(nC).fill(-1);
    this.cSpaceWatch = new Int32Array(nC).fill(-1);
    for (let c = 0; c < nC; c++) {
      this.cInv[c] = ci[c * 3];
      this.cSlots[c] = ci[c * 3 + 1];
    }
    const si = r.i32(SEC.SLOT_I);
    const nS = h[H.nSlots];
    this.sKey = new Int32Array(nS);
    this.sCount = new Int32Array(nS);
    this.sLimit = new Int32Array(nS);
    for (let s = 0; s < nS; s++) {
      this.sKey[s] = si[s * 3];
      this.sCount[s] = si[s * 3 + 1];
      this.sLimit[s] = si[s * 3 + 2];
    }
    for (let m = 0; m < nM; m++) {
      let fm = 0;
      const inv = this.mInv[m];
      for (let j = 0; j < this.mNIn[m]; j++) fm |= 1 << this.sKey[inv + j];
      this.mFullMask[m] = fm;
    }

    // electric
    const nCo = (this.nCons = h[H.nCons]);
    const coi = r.i32(SEC.CONS_I);
    this.cProto = new Int32Array(nCo);
    for (let c = 0; c < nCo; c++) this.cProto[c] = coi[c * 2];
    this.eBuf = r.f64(SEC.CONS_F);
    const nN = (this.nNets = h[H.nNets]);
    const ni = r.i32(SEC.NET_I);
    const nf = r.f64(SEC.NET_F);
    this.netStart = new Int32Array(nN);
    this.netEnd = new Int32Array(nN);
    this.netGen = new Float64Array(nN);
    this.netSolar = new Float64Array(nN);
    this.netAcc = new Float64Array(nN);
    this.netAccCap = new Float64Array(nN);
    this.netAccRate = new Float64Array(nN);
    for (let n = 0; n < nN; n++) {
      this.netStart[n] = ni[n * 2];
      this.netEnd[n] = ni[n * 2 + 1];
      this.netGen[n] = nf[n * 5];
      this.netSolar[n] = nf[n * 5 + 1];
      this.netAcc[n] = nf[n * 5 + 2];
      this.netAccCap[n] = nf[n * 5 + 3];
      this.netAccRate[n] = nf[n * 5 + 4];
    }

    // entities and chunks (render)
    const nE = (this.nEnts = h[H.nEnts]);
    const ei = r.i32(SEC.ENT_I);
    this.eKind = new Int32Array(nE);
    this.eSprite = new Int32Array(nE);
    this.eX2 = new Int32Array(nE);
    this.eY2 = new Int32Array(nE);
    this.eRef = new Int32Array(nE);
    for (let e = 0; e < nE; e++) {
      const b = e * 5;
      this.eKind[e] = ei[b];
      this.eSprite[e] = ei[b + 1];
      this.eX2[e] = ei[b + 2];
      this.eY2[e] = ei[b + 3];
      this.eRef[e] = ei[b + 4];
    }
    this.chunksX = h[H.chunksX];
    this.chunksY = h[H.chunksY];
    this.chunkI = r.i32(SEC.CHUNK_I);
    this.chunkDyn = r.i32(SEC.CHUNK_DYN);
    this.chunkStatic = r.i32(SEC.CHUNK_STATIC);
    this.chunkLines = r.i32(SEC.CHUNK_LINES);

    // nodes
    const cap = h[H.nodeCap];
    this.nNext = new Int32Array(cap);
    this.nOwner = new Int32Array(cap);
    this.nSeq = new Int32Array(cap);
    this.nTrk = new Int32Array(cap);
    for (let k = 0; k < cap - 1; k++) this.nNext[k] = k + 1;
    this.nNext[cap - 1] = -1;
    this.freeNode = 0;
    this.wheel = new Int32Array(WHEEL_MASK + 1).fill(-1);

    this.out = new ArrayBuffer(16 * 65536);
    this.outF = new Float32Array(this.out);
    this.outU = new Uint32Array(this.out);

    this.wakeAll();
  }

  wakeAll(): void {
    setAll(this.lAct, this.nLines);
    setAll(this.insAct, this.nIns);
    setAll(this.mAct, this.nMach);
  }

  setNoSleep(v: boolean): void {
    this.noSleep = v;
    if (v) this.wakeAll();
  }

  // ---------------------------------------------------------------- the tick (§4.6 phase order)

  step(): void {
    const t = ++this.tick;
    if (this.timing) {
      const now = this.now;
      const pm = this.phaseAcc;
      let a = now();
      this.fire(this.wheel, t & WHEEL_MASK);
      let b = now();
      pm[0] += b - a;
      this.electric();
      a = now();
      pm[1] += a - b;
      this.machines();
      b = now();
      pm[2] += b - a;
      this.lines();
      a = now();
      pm[3] += a - b;
      this.inserters();
      b = now();
      pm[4] += b - a;
    } else {
      this.fire(this.wheel, t & WHEEL_MASK);
      this.electric();
      this.machines();
      this.lines();
      this.inserters();
    }
  }

  run(n: number): void {
    for (let k = 0; k < n; k++) this.step();
  }

  setTiming(v: boolean): void {
    this.timing = v;
  }
  phaseMs(): number[] {
    return Array.from(this.phaseAcc);
  }
  resetPhaseMs(): void {
    this.phaseAcc.fill(0);
  }
  outBytes(n: number): Uint8Array {
    return new Uint8Array(this.out, 0, n * 16);
  }
  // install a (pooled, transferable) output buffer for the next extract()
  setOut(buf: ArrayBuffer): void {
    this.out = buf;
    this.outF = new Float32Array(buf);
    this.outU = new Uint32Array(buf);
  }

  // ---------------------------------------------------------------- electric networks (§5.7)

  electric(): void {
    const t = this.tick;
    const f = (t % 25000) / 25000;
    let day: number;
    if (f < 0.25) day = 1;
    else if (f < 0.45) day = 1 - (f - 0.25) / 0.2;
    else if (f < 0.55) day = 0;
    else if (f < 0.75) day = (f - 0.55) / 0.2;
    else day = 1;
    // One call per network keeps the hot loops in a small function. Written as one function with the
    // loops inline, V8 (Node 24) re-entered on-stack-replacement code on nearly every tick once a
    // day-cycle branch first ran at tick 6,250 (3,351 OSR deopts in 3,600 ticks, see REPORT.md).
    for (let n = 0; n < this.nNets; n++) this.electricNet(n, day);
  }

  electricNet(n: number, day: number): void {
    const cProto = this.cProto;
    const eBuf = this.eBuf;
    const epCap = this.epCap;
    const epDrain = this.epDrain;
    const epClass = this.epClass;
    const s = this.netStart[n];
    const e = this.netEnd[n];
    let dN = 0;
    let dI = 0;
    for (let c = s; c < e; c++) {
      const p = cProto[c];
      const def = epCap[p] - eBuf[c];
      if (epClass[p] === 0) dN += def;
      else dI += def;
    }
    const g = this.netGen[n] + this.netSolar[n] * day;
    let acc = this.netAcc[n];
    const rate = this.netAccRate[n];
    let satN: number;
    let satI: number;
    if (g >= dN) {
      satN = 1;
      let room = this.netAccCap[n] - acc;
      if (room > rate) room = rate;
      let ch = g - dN;
      if (ch > room) ch = room;
      acc += ch;
      const rest = g - dN - ch;
      satI = dI > 0 ? (rest >= dI ? 1 : rest / dI) : 1;
    } else {
      let d = dN - g + dI;
      if (d > acc) d = acc;
      if (d > rate) d = rate;
      acc -= d;
      const sup = g + d;
      satN = sup / dN;
      if (satN > 1) satN = 1;
      const rest = sup - dN;
      satI = dI > 0 ? (rest > 0 ? (rest >= dI ? 1 : rest / dI) : 0) : 1;
    }
    this.netAcc[n] = acc;
    for (let c = s; c < e; c++) {
      const p = cProto[c];
      let b = eBuf[c];
      b += (epCap[p] - b) * (epClass[p] === 0 ? satN : satI);
      b -= epDrain[p];
      eBuf[c] = b < 0 ? 0 : b;
    }
  }

  // ---------------------------------------------------------------- crafting machines (§5.5)

  machines(): void {
    const act = this.mAct;
    const words = act.length;
    for (let w = 0; w < words; w++) {
      let bits = act[w] | 0;
      while (bits !== 0) {
        const b = 31 - Math.clz32(bits & -bits);
        this.tickMach((w << 5) | b);
        bits = b === 31 ? 0 : act[w] & (-1 << (b + 1));
      }
    }
  }

  tickMach(m: number): void {
    const r = this.mRecipe[m];
    if (r < 0) {
      this.sleepMach(m);
      return;
    }
    const kind = this.mKind[m];
    if (this.mCrafting[m] === 0) {
      if (!this.machTryStart(m, r, kind)) {
        this.machBlocked(m, kind);
        return;
      }
    }
    const c = this.mElec[m];
    const need = this.mpWorkE[this.mProto[m]];
    let buf = this.eBuf[c];
    let sat: number;
    if (buf >= need) {
      sat = 1;
      buf -= need;
    } else {
      sat = buf / need;
      buf = 0;
    }
    this.eBuf[c] = buf;
    let prog = this.mProgress[m] + this.mSpeed[m] * sat * this.rInvTicks[r];
    while (prog >= 1) {
      prog -= 1;
      this.mCrafts[m] = this.mCrafts[m] + 1;
      this.machFinish(m, r, kind);
      if (!this.machTryStart(m, r, kind)) {
        this.mCrafting[m] = 0;
        prog = 0;
        break;
      }
    }
    this.mProgress[m] = prog;
  }

  machTryStart(m: number, r: number, kind: number): boolean {
    const inv = this.mInv[m];
    const sCount = this.sCount;
    if (kind === M_DRILL) {
      if (sCount[inv] > 0) {
        if (!this.lineInsert(this.mOutLine[m], this.mOutPos[m], this.sKey[inv])) return false;
        sCount[inv] = 0;
      }
      this.mCrafting[m] = 1;
      return true;
    }
    const rI = this.rI;
    const rb = r * 12;
    const nIn = this.mNIn[m];
    const nOut = this.mNOut[m];
    for (let j = 0; j < nIn; j++) if (sCount[inv + j] < rI[rb + 2 + 2 * j]) return false;
    for (let j = 0; j < nOut; j++) {
      const s = inv + nIn + j;
      if (sCount[s] + rI[rb + 9 + 2 * j] > this.stack[this.sKey[s]]) return false;
    }
    for (let j = 0; j < nIn; j++) sCount[inv + j] -= rI[rb + 2 + 2 * j];
    this.mCrafting[m] = 1;
    if (nIn > 0) this.fire(this.mSpaceWatch, m);
    return true;
  }

  machFinish(m: number, r: number, kind: number): void {
    if (kind === M_LAB) {
      this.research++;
      return;
    }
    const inv = this.mInv[m];
    if (kind === M_DRILL) {
      const key = this.rI[r * 12 + 8];
      if (!this.lineInsert(this.mOutLine[m], this.mOutPos[m], key)) {
        this.sKey[inv] = key;
        this.sCount[inv] = 1;
      }
      return;
    }
    const nIn = this.mNIn[m];
    const nOut = this.mNOut[m];
    const rb = r * 12;
    for (let j = 0; j < nOut; j++) this.sCount[inv + nIn + j] += this.rI[rb + 9 + 2 * j];
    if (nOut > 0) this.fire(this.mAddedWatch, m);
  }

  machBlocked(m: number, kind: number): void {
    if (this.noSleep) return;
    if (kind === M_DRILL) {
      const l = this.mOutLine[m];
      if ((this.lAct[l >>> 5] & (1 << (l & 31))) !== 0) return; // the belt moves: retry next tick
      const seq = this.mSeq[m];
      const nd0 = this.mOutNode[m];
      if (nd0 >= 0) this.nSeq[nd0] = seq;
      else this.mOutNode[m] = this.watch(this.lWatchAny, l, OWN_MACH | m, TRK_OUT, seq);
    }
    this.sleepMach(m);
  }

  sleepMach(m: number): void {
    if (this.noSleep) return;
    this.mAct[m >>> 5] &= ~(1 << (m & 31));
  }

  wakeMach(m: number): void {
    const w = m >>> 5;
    const bit = 1 << (m & 31);
    const a = this.mAct;
    if ((a[w] & bit) !== 0) return;
    a[w] |= bit;
    this.mSeq[m] = (this.mSeq[m] + 1) | 0;
  }

  // ---------------------------------------------------------------- transport lines (§5.3)

  lines(): void {
    const act = this.lAct;
    const words = act.length;
    for (let w = 0; w < words; w++) {
      let bits = act[w] | 0;
      while (bits !== 0) {
        const b = 31 - Math.clz32(bits & -bits);
        this.tickLine((w << 5) | b);
        bits = b === 31 ? 0 : act[w] & (-1 << (b + 1));
      }
    }
  }

  tickLine(l: number): void {
    const n = this.lCount[l];
    if (n === 0) {
      this.sleepLine(l);
      return;
    }
    const sp = this.lSpeed[l];
    let front = this.lFront[l];
    if (front >= sp) {
      // FFF-176: the whole line moves by changing two numbers
      this.lFront[l] = front - sp;
      this.lBack[l] += sp;
      const p = this.lPrev[l];
      if (p >= 0) this.wakeLine(p);
      return;
    }
    const nx = this.lNext[l];
    let room: number;
    if (nx < 0) room = front;
    else if (this.lCount[nx] === 0) room = INF;
    else room = front + this.lBack[nx] - SPACING;
    let m = room < sp ? room : sp;
    if (m < 0) m = 0;
    // the items behind the front close the first positive gaps (compression)
    let deficit = sp - m;
    const off = this.lOff[l];
    const lm = this.lMask[l];
    const head = this.lHead[l];
    const gaps = this.iGap;
    if (deficit > 0) {
      let a = this.lActiveGap[l];
      while (a < n) {
        const k = off + ((head + a) & lm);
        const g = gaps[k];
        if (g > deficit) {
          gaps[k] = g - deficit;
          deficit = 0;
          break;
        }
        gaps[k] = 0;
        deficit -= g;
        a++;
        while (a < n && gaps[off + ((head + a) & lm)] === 0) a++;
        if (deficit === 0) break;
      }
      this.lActiveGap[l] = a;
    }
    const moved = sp - deficit; // how far the last item moved
    front -= m;
    if (front < 0) {
      // hand the front item to the next line (end-to-end)
      const key = this.iKey[off + head];
      if (n === 1) {
        this.lCount[l] = 0;
        this.lBack[l] = INF;
        this.lActiveGap[l] = 0;
      } else {
        const h1 = (head + 1) & lm;
        this.lFront[l] = front + SPACING + gaps[off + h1];
        this.lHead[l] = h1;
        this.lCount[l] = n - 1;
        this.lBack[l] += moved;
        let ag = this.lActiveGap[l];
        if (ag === 1) {
          const nn = n - 1;
          while (ag < nn && gaps[off + ((h1 + ag) & lm)] === 0) ag++;
        } else ag -= 1;
        this.lActiveGap[l] = ag;
      }
      this.pushBack(nx, key, -front);
    } else {
      this.lFront[l] = front;
      this.lBack[l] += moved;
    }
    if (moved > 0) {
      const p = this.lPrev[l];
      if (p >= 0) this.wakeLine(p);
    } else if (m === 0) {
      this.sleepLine(l); // fully compressed and blocked: nothing can change until a neighbour acts
    }
  }

  // item enters line l at its start, `o` positions in (end-to-end transfer)
  pushBack(l: number, key: number, o: number): void {
    const n = this.lCount[l];
    const off = this.lOff[l];
    const lm = this.lMask[l];
    const head = this.lHead[l];
    const k = off + ((head + n) & lm);
    this.iKey[k] = key;
    if (n === 0) {
      this.iGap[k] = 0;
      this.lFront[l] = this.lLen[l] - o;
      this.lActiveGap[l] = 1;
    } else {
      const g = this.lBack[l] - o - SPACING;
      this.iGap[k] = g;
      if (g === 0 && this.lActiveGap[l] === n) this.lActiveGap[l] = n + 1;
    }
    this.lBack[l] = o;
    this.lCount[l] = n + 1;
    this.wakeLine(l);
    this.fire(this.lWatchAny, l);
  }

  sleepLine(l: number): void {
    if (this.noSleep) return;
    this.lAct[l >>> 5] &= ~(1 << (l & 31));
  }

  wakeLine(l: number): void {
    const w = l >>> 5;
    const bit = 1 << (l & 31);
    const a = this.lAct;
    if ((a[w] & bit) !== 0) return;
    a[w] |= bit;
    this.fire(this.lWatchAny, l); // restart: waiters re-check
  }

  recomputeActiveGap(l: number): void {
    const n = this.lCount[l];
    const off = this.lOff[l];
    const lm = this.lMask[l];
    const head = this.lHead[l];
    let a = 1;
    while (a < n && this.iGap[off + ((head + a) & lm)] === 0) a++;
    this.lActiveGap[l] = n === 0 ? 0 : a;
  }

  // First item with lo <= d <= hi whose key is in mask: its index, else -1.
  // Sets upD to the distance of the first acceptable item upstream of hi (or -1).
  lineScan(l: number, lo: number, hi: number, mask: number): number {
    this.upD = -1;
    const n = this.lCount[l];
    if (n === 0) return -1;
    const off = this.lOff[l];
    const lm = this.lMask[l];
    const head = this.lHead[l];
    const keys = this.iKey;
    const gaps = this.iGap;
    let d = this.lFront[l];
    for (let i = 0; i < n; i++) {
      const k = off + ((head + i) & lm);
      if (i > 0) d += SPACING + gaps[k];
      if (((mask >>> keys[k]) & 1) !== 0) {
        if (d > hi) {
          this.upD = d;
          return -1;
        }
        if (d >= lo) return i;
      }
    }
    return -1;
  }

  lineRemove(l: number, idx: number): number {
    const n = this.lCount[l];
    const off = this.lOff[l];
    const lm = this.lMask[l];
    const head = this.lHead[l];
    const keys = this.iKey;
    const gaps = this.iGap;
    const k = off + ((head + idx) & lm);
    const key = keys[k];
    if (n === 1) {
      this.lCount[l] = 0;
      this.lBack[l] = INF;
      this.lActiveGap[l] = 0;
      const p = this.lPrev[l];
      if (p >= 0) this.wakeLine(p);
    } else if (idx === 0) {
      const h1 = (head + 1) & lm;
      this.lFront[l] = this.lFront[l] + SPACING + gaps[off + h1];
      this.lHead[l] = h1;
      this.lCount[l] = n - 1;
      let ag = this.lActiveGap[l];
      if (ag === 1) {
        const nn = n - 1;
        while (ag < nn && gaps[off + ((h1 + ag) & lm)] === 0) ag++;
      } else ag -= 1;
      this.lActiveGap[l] = ag;
    } else if (idx === n - 1) {
      this.lBack[l] = this.lBack[l] + SPACING + gaps[k];
      this.lCount[l] = n - 1;
      if (this.lActiveGap[l] > n - 1) this.lActiveGap[l] = n - 1;
      const p = this.lPrev[l];
      if (p >= 0) this.wakeLine(p);
    } else {
      const kf = off + ((head + idx + 1) & lm);
      gaps[kf] = gaps[kf] + gaps[k] + SPACING;
      if (idx < n - 1 - idx) {
        for (let j = idx; j > 0; j--) {
          const dst = off + ((head + j) & lm);
          const src = off + ((head + j - 1) & lm);
          keys[dst] = keys[src];
          gaps[dst] = gaps[src];
        }
        this.lHead[l] = (head + 1) & lm;
      } else {
        for (let j = idx; j < n - 1; j++) {
          const dst = off + ((head + j) & lm);
          const src = off + ((head + j + 1) & lm);
          keys[dst] = keys[src];
          gaps[dst] = gaps[src];
        }
      }
      this.lCount[l] = n - 1;
      if (this.lActiveGap[l] > idx) this.lActiveGap[l] = idx;
    }
    this.wakeLine(l);
    return key;
  }

  // Insert an item at distance dp from the line end (inserter drop, drill output). No squeezing.
  lineInsert(l: number, dp: number, key: number): boolean {
    const n = this.lCount[l];
    const off = this.lOff[l];
    const lm = this.lMask[l];
    let head = this.lHead[l];
    const keys = this.iKey;
    const gaps = this.iGap;
    if (n === 0) {
      const k = off + head;
      keys[k] = key;
      gaps[k] = 0;
      this.lFront[l] = dp;
      this.lBack[l] = this.lLen[l] - dp;
      this.lCount[l] = 1;
      this.lActiveGap[l] = 1;
      this.wakeLine(l);
      this.fire(this.lWatchAny, l);
      return true;
    }
    if (n > lm) return false;
    let i = 0;
    let d = this.lFront[l];
    let pd = -1;
    while (i < n && d <= dp) {
      pd = d;
      i++;
      if (i < n) d += SPACING + gaps[off + ((head + i) & lm)];
    }
    if (pd >= 0 && dp - pd < SPACING) return false;
    if (i < n && d - dp < SPACING) return false;
    if (i === 0) {
      head = (head - 1) & lm;
      const k = off + head;
      keys[k] = key;
      gaps[k] = 0;
      const g = d - dp - SPACING;
      gaps[off + ((head + 1) & lm)] = g;
      this.lHead[l] = head;
      this.lFront[l] = dp;
      this.lCount[l] = n + 1;
      this.lActiveGap[l] = g > 0 ? 1 : this.lActiveGap[l] + 1;
    } else if (i === n) {
      const k = off + ((head + n) & lm);
      const g = dp - pd - SPACING;
      keys[k] = key;
      gaps[k] = g;
      this.lBack[l] = this.lLen[l] - dp;
      this.lCount[l] = n + 1;
      if (g === 0 && this.lActiveGap[l] === n) this.lActiveGap[l] = n + 1;
    } else {
      const g1 = dp - pd - SPACING;
      const g2 = d - dp - SPACING;
      if (i < n - i) {
        head = (head - 1) & lm;
        for (let j = 0; j < i; j++) {
          const dst = off + ((head + j) & lm);
          const src = off + ((head + j + 1) & lm);
          keys[dst] = keys[src];
          gaps[dst] = gaps[src];
        }
        this.lHead[l] = head;
      } else {
        for (let j = n; j > i; j--) {
          const dst = off + ((head + j) & lm);
          const src = off + ((head + j - 1) & lm);
          keys[dst] = keys[src];
          gaps[dst] = gaps[src];
        }
      }
      const k = off + ((head + i) & lm);
      keys[k] = key;
      gaps[k] = g1;
      gaps[off + ((head + i + 1) & lm)] = g2;
      this.lCount[l] = n + 1;
      if (this.lActiveGap[l] === i && g1 === 0) {
        if (g2 > 0) this.lActiveGap[l] = i + 1;
        else {
          let a = i + 2;
          while (a < n + 1 && gaps[off + ((head + a) & lm)] === 0) a++;
          this.lActiveGap[l] = a;
        }
      }
    }
    this.wakeLine(l);
    this.fire(this.lWatchAny, l);
    if (i < n) this.fire(this.lWatchMid, l);
    return true;
  }

  // ---------------------------------------------------------------- inserters (§5.4)

  inserters(): void {
    const act = this.insAct;
    const words = act.length;
    for (let w = 0; w < words; w++) {
      let bits = act[w] | 0;
      while (bits !== 0) {
        const b = 31 - Math.clz32(bits & -bits);
        this.tickIns((w << 5) | b);
        bits = b === 31 ? 0 : act[w] & (-1 << (b + 1));
      }
    }
  }

  tickIns(i: number): void {
    const st = this.insState[i];
    if (st === S_TO_DROP || st === S_TO_PICK) this.insMove(i, st);
    else if (st === S_WAIT_SRC) this.insPick(i);
    else this.insDrop(i);
  }

  insMove(i: number, st: number): void {
    const p = this.insProto[i];
    const need = this.ipMoveE[p];
    const c = this.insElec[i];
    let buf = this.eBuf[c];
    let sat: number;
    if (buf >= need) {
      sat = 1;
      buf -= need;
    } else {
      sat = buf / need;
      buf = 0;
    }
    this.eBuf[c] = buf;
    const toDrop = st === S_TO_DROP;
    const tt = toDrop ? this.insDropTheta[i] : this.insPickTheta[i];
    const te = toDrop ? this.insDropExt[i] : this.insPickExt[i];
    let th = this.insTheta[i];
    let d = tt - th;
    if (d > 0.5) d -= 1;
    else if (d < -0.5) d += 1;
    const rs = this.ipRot[p] * sat;
    if (d > rs) th += rs;
    else if (d < -rs) th -= rs;
    else th = tt;
    if (th >= 1) th -= 1;
    else if (th < 0) th += 1;
    let ex = this.insExt[i];
    const es = this.ipExt[p] * sat;
    const de = te - ex;
    if (de > es) ex += es;
    else if (de < -es) ex -= es;
    else ex = te;
    this.insTheta[i] = th;
    this.insExt[i] = ex;
    if (th === tt && ex === te) this.insState[i] = toDrop ? S_WAIT_DST : S_WAIT_SRC;
  }

  // what the target accepts now, as a bitmask of item keys
  targetMask(dk: number, dst: number): number {
    if (dk === T_MACH) {
      if (this.mRecipe[dst] < 0) return 0;
      const inv = this.mInv[dst];
      const nIn = this.mNIn[dst];
      let mask = 0;
      for (let j = 0; j < nIn; j++) {
        const s = inv + j;
        if (this.sCount[s] < this.sLimit[s]) mask |= 1 << this.sKey[s];
      }
      return mask;
    }
    if (dk === T_CHEST) {
      const inv = this.cInv[dst];
      const ns = this.cSlots[dst];
      let mask = 0;
      for (let s = inv; s < inv + ns; s++) {
        const cnt = this.sCount[s];
        if (cnt === 0) return -1;
        if (cnt < this.stack[this.sKey[s]]) mask |= 1 << this.sKey[s];
      }
      return mask;
    }
    return -1;
  }

  // how many more of `key` the target takes beyond `held` already in the hand (capped at `cap`)
  targetRoom(dk: number, dst: number, key: number, held: number, cap: number): number {
    if (dk === T_MACH) {
      const inv = this.mInv[dst];
      const nIn = this.mNIn[dst];
      for (let s = inv; s < inv + nIn; s++) {
        if (this.sKey[s] === key) {
          const r = this.sLimit[s] - this.sCount[s] - held;
          return r < 0 ? 0 : r < cap ? r : cap;
        }
      }
      return 0;
    }
    if (dk === T_CHEST) {
      const inv = this.cInv[dst];
      const ns = this.cSlots[dst];
      const st = this.stack[key];
      let free = 0;
      for (let s = inv; s < inv + ns; s++) {
        const cnt = this.sCount[s];
        if (cnt === 0) free += st;
        else if (this.sKey[s] === key) free += st - cnt;
        if (free - held >= cap) return cap;
      }
      const r = free - held;
      return r < 0 ? 0 : r;
    }
    return cap;
  }

  insPick(i: number): void {
    const dk = this.insDstKind[i];
    const dst = this.insDst[i];
    const heldN = this.insHeldN[i];
    const cap = this.insCap[i];
    let mask: number;
    if (heldN > 0) {
      const hk = this.insHeld[i];
      if (this.targetRoom(dk, dst, hk, heldN, 1) === 0) {
        this.insState[i] = S_TO_DROP; // partial hand: the target needs no more
        return;
      }
      mask = 1 << hk;
    } else {
      mask = this.targetMask(dk, dst);
      if (mask === 0) {
        this.insWaitTarget(i);
        return;
      }
    }
    const sk = this.insSrcKind[i];
    const src = this.insSrc[i];
    if (sk === T_BELT) {
      const pos = this.insSrcPos[i];
      const idx = this.lineScan(src, pos - WIN, pos + WIN, mask);
      if (idx >= 0) {
        const key = this.lineRemove(src, idx);
        this.insHeld[i] = key;
        const nh = heldN + 1;
        this.insHeldN[i] = nh;
        if (nh >= cap || this.targetRoom(dk, dst, key, nh, 1) === 0) this.insState[i] = S_TO_DROP;
        return;
      }
      if (heldN === 0) this.insWaitSource(i, mask); // a partial hand keeps polling
      return;
    }
    // chest or machine output: take a whole hand at once
    const inv = sk === T_CHEST ? this.cInv[src] : this.mInv[src] + this.mNIn[src];
    const ns = sk === T_CHEST ? this.cSlots[src] : this.mNOut[src];
    for (let s = inv; s < inv + ns; s++) {
      const cnt = this.sCount[s];
      if (cnt === 0) continue;
      const key = this.sKey[s];
      if (((mask >>> key) & 1) === 0) continue;
      let take = this.targetRoom(dk, dst, key, 0, cap);
      if (take > cnt) take = cnt;
      if (take === 0) continue;
      this.sCount[s] = cnt - take;
      this.insHeld[i] = key;
      this.insHeldN[i] = take;
      this.insState[i] = S_TO_DROP;
      if (sk === T_CHEST) this.fire(this.cSpaceWatch, src);
      else this.wakeMach(src);
      return;
    }
    this.insWaitSource(i, mask);
  }

  insDrop(i: number): void {
    const dk = this.insDstKind[i];
    const dst = this.insDst[i];
    const key = this.insHeld[i];
    let n = this.insHeldN[i];
    if (dk === T_MACH) {
      const inv = this.mInv[dst];
      const nIn = this.mNIn[dst];
      let s = inv;
      while (s < inv + nIn && this.sKey[s] !== key) s++;
      if (s === inv + nIn || this.sCount[s] + n > this.stack[key]) {
        this.insWaitTarget(i);
        return;
      }
      this.sCount[s] += n;
      n = 0;
      this.wakeMach(dst);
    } else if (dk === T_CHEST) {
      const inv = this.cInv[dst];
      const ns = this.cSlots[dst];
      const st = this.stack[key];
      const before = n;
      for (let s = inv; s < inv + ns && n > 0; s++) {
        if (this.sCount[s] > 0 && this.sKey[s] === key) {
          let put = st - this.sCount[s];
          if (put > n) put = n;
          this.sCount[s] += put;
          n -= put;
        }
      }
      for (let s = inv; s < inv + ns && n > 0; s++) {
        if (this.sCount[s] === 0) {
          const put = n < st ? n : st;
          this.sKey[s] = key;
          this.sCount[s] = put;
          n -= put;
        }
      }
      if (n !== before) this.fire(this.cAddedWatch, dst);
      if (n > 0) {
        this.insHeldN[i] = n;
        this.insWaitTarget(i);
        return;
      }
    } else {
      if (this.lineInsert(dst, this.insDstPos[i], key)) n -= 1;
      if (n > 0) {
        this.insHeldN[i] = n;
        if ((this.lAct[dst >>> 5] & (1 << (dst & 31))) === 0) this.insWaitTarget(i);
        return;
      }
    }
    this.insHeldN[i] = 0;
    this.insHeld[i] = 0;
    this.insState[i] = S_TO_PICK;
  }

  // sleep until the target changes (needs items, has room, or a stalled drop belt restarts)
  insWaitTarget(i: number): void {
    if (this.noSleep) return;
    this.watchTgt(i, this.insSeq[i]);
    this.insAct[i >>> 5] &= ~(1 << (i & 31));
  }

  // sleep until the source can offer something (and, if the target's need may widen, until it does)
  insWaitSource(i: number, mask: number): void {
    if (this.noSleep) return;
    const sk = this.insSrcKind[i];
    const src = this.insSrc[i];
    const seq = this.insSeq[i];
    if (sk === T_BELT) {
      const up = this.upD;
      if (up >= 0 && (this.lAct[src >>> 5] & (1 << (src & 31))) !== 0) {
        const sp = this.lSpeed[src];
        const dist = up - (this.insSrcPos[i] + WIN);
        const delay = ((dist + sp - 1) / sp) | 0; // arrival estimate: a lower bound, so never late
        this.schedule(OWN_INS | i, delay, seq);
        const nd0 = this.insMidNode[i];
        if (nd0 >= 0) this.nSeq[nd0] = seq;
        else this.insMidNode[i] = this.watch(this.lWatchMid, src, OWN_INS | i, TRK_MID, seq);
      } else {
        this.watchSrc(i, this.lWatchAny, src, seq);
      }
    } else if (sk === T_CHEST) {
      this.watchSrc(i, this.cAddedWatch, src, seq);
    } else {
      this.watchSrc(i, this.mAddedWatch, src, seq);
    }
    const dk = this.insDstKind[i];
    if (dk === T_MACH ? mask !== this.mFullMask[this.insDst[i]] : mask !== -1) this.watchTgt(i, seq);
    this.insAct[i >>> 5] &= ~(1 << (i & 31));
  }

  wakeIns(i: number): void {
    const w = i >>> 5;
    const bit = 1 << (i & 31);
    const a = this.insAct;
    if ((a[w] & bit) !== 0) return;
    a[w] |= bit;
    this.insSeq[i] = (this.insSeq[i] + 1) | 0;
  }

  // ---------------------------------------------------------------- watch lists and the timer wheel (§4.6)

  allocNode(): number {
    let nd = this.freeNode;
    if (nd < 0) {
      // grows only when a factory has more waiters than nodeCap (counted; 0 in the benchmarks)
      const old = this.nNext.length;
      const cap = old * 2;
      this.nNext = grow(this.nNext, cap);
      this.nOwner = grow(this.nOwner, cap);
      this.nSeq = grow(this.nSeq, cap);
      this.nTrk = grow(this.nTrk, cap);
      for (let k = old; k < cap - 1; k++) this.nNext[k] = k + 1;
      this.nNext[cap - 1] = -1;
      nd = old;
      this.nodeGrowths++;
    }
    this.freeNode = this.nNext[nd];
    return nd;
  }

  watch(heads: Int32Array, idx: number, owner: number, trk: number, seq: number): number {
    const nd = this.allocNode();
    this.nOwner[nd] = owner;
    this.nSeq[nd] = seq;
    this.nTrk[nd] = trk;
    this.nNext[nd] = heads[idx];
    heads[idx] = nd;
    return nd;
  }

  // An inserter keeps at most one node per list it waits on; re-registering refreshes the node's sequence.
  watchSrc(i: number, heads: Int32Array, idx: number, seq: number): void {
    const nd0 = this.insSrcNode[i];
    if (nd0 >= 0) {
      this.nSeq[nd0] = seq;
      return;
    }
    this.insSrcNode[i] = this.watch(heads, idx, OWN_INS | i, TRK_SRC, seq);
  }

  watchTgt(i: number, seq: number): void {
    const nd0 = this.insTgtNode[i];
    if (nd0 >= 0) {
      this.nSeq[nd0] = seq;
      return;
    }
    const dk = this.insDstKind[i];
    const dst = this.insDst[i];
    const heads = dk === T_MACH ? this.mSpaceWatch : dk === T_CHEST ? this.cSpaceWatch : this.lWatchAny;
    this.insTgtNode[i] = this.watch(heads, dst, OWN_INS | i, TRK_TGT, seq);
  }

  schedule(owner: number, delay: number, seq: number): void {
    this.watch(this.wheel, (this.tick + delay) & WHEEL_MASK, owner, TRK_TIMER, seq);
  }

  fire(heads: Int32Array, idx: number): void {
    let nd = heads[idx];
    if (nd < 0) return;
    heads[idx] = -1;
    while (nd >= 0) {
      const next = this.nNext[nd];
      const o = this.nOwner[nd];
      const x = o & OWN_IDX;
      const trk = this.nTrk[nd];
      if (o >>> 24 === 1) {
        if (trk === TRK_SRC) {
          if (this.insSrcNode[x] === nd) this.insSrcNode[x] = -1;
        } else if (trk === TRK_MID) {
          if (this.insMidNode[x] === nd) this.insMidNode[x] = -1;
        } else if (trk === TRK_TGT) {
          if (this.insTgtNode[x] === nd) this.insTgtNode[x] = -1;
        }
        if (this.nSeq[nd] === this.insSeq[x]) this.wakeIns(x);
      } else {
        if (trk === TRK_OUT && this.mOutNode[x] === nd) this.mOutNode[x] = -1;
        if (this.nSeq[nd] === this.mSeq[x]) this.wakeMach(x);
      }
      this.nNext[nd] = this.freeNode;
      this.freeNode = nd;
      nd = next;
    }
  }

  // ---------------------------------------------------------------- state hash (§4.1 item 7)

  hash(): number {
    const h = new Xxh32();
    h.u32(this.tick);
    h.u32(this.research);
    for (let l = 0; l < this.nLines; l++) {
      const n = this.lCount[l];
      h.u32(n);
      if (n === 0) continue;
      h.u32(this.lFront[l]);
      h.u32(this.lBack[l]);
      const off = this.lOff[l];
      const lm = this.lMask[l];
      const head = this.lHead[l];
      for (let i = 0; i < n; i++) {
        const k = off + ((head + i) & lm);
        h.u32(this.iKey[k] | ((i === 0 ? 0 : this.iGap[k] & 0xffff) << 16));
      }
    }
    for (let i = 0; i < this.nIns; i++) {
      h.u32(this.insState[i]);
      h.u32(this.insHeldN[i] === 0 ? 0 : this.insHeld[i]);
      h.u32(this.insHeldN[i]);
      h.f64(this.insTheta[i]);
      h.f64(this.insExt[i]);
    }
    for (let m = 0; m < this.nMach; m++) {
      h.u32(this.mRecipe[m]);
      h.u32(this.mCrafting[m]);
      h.u32(this.mCrafts[m]);
      h.f64(this.mProgress[m]);
    }
    for (let s = 0; s < this.sKey.length; s++) {
      h.u32(this.sKey[s]);
      h.u32(this.sCount[s]);
    }
    for (let c = 0; c < this.nCons; c++) h.f64(this.eBuf[c]);
    for (let n = 0; n < this.nNets; n++) h.f64(this.netAcc[n]);
    return h.digest();
  }

  // ---------------------------------------------------------------- statistics (outside the tick)

  stats(): Record<string, number> {
    let beltItems = 0;
    let linesNonEmpty = 0;
    for (let l = 0; l < this.nLines; l++) {
      beltItems += this.lCount[l];
      if (this.lCount[l] > 0) linesNonEmpty++;
    }
    const insByState = [0, 0, 0, 0];
    for (let i = 0; i < this.nIns; i++) insByState[this.insState[i]]++;
    let crafting = 0;
    for (let m = 0; m < this.nMach; m++) crafting += this.mCrafting[m];
    return {
      tick: this.tick,
      research: this.research,
      lines: this.nLines,
      linesActive: popcount(this.lAct),
      linesNonEmpty,
      beltItems,
      inserters: this.nIns,
      insActive: popcount(this.insAct),
      insMoving: insByState[S_TO_DROP] + insByState[S_TO_PICK],
      insWaitSrc: insByState[S_WAIT_SRC],
      insWaitDst: insByState[S_WAIT_DST],
      machines: this.nMach,
      machActive: popcount(this.mAct),
      machCrafting: crafting,
      nodeGrowths: this.nodeGrowths,
    };
  }

  // ---------------------------------------------------------------- render extraction (§3.2 `dyn`, §6.2)
  // Visible sprites in the tile rectangle [x0,x1)×[y0,y1) as 16-byte records {f32 x, f32 y, u32 a, u32 b},
  // a = kind << 24 | id. `full` adds the static sprites (belts, chests, poles, decor) that the spec's view
  // model keeps on the main thread; without it this is the per-frame `dyn` section only.
  extract(x0: number, y0: number, x1: number, y1: number, full: boolean): number {
    const fr = (this.frame = (this.frame + 1) | 0);
    const cx0 = Math.max(0, Math.floor(x0 / 32));
    const cy0 = Math.max(0, Math.floor(y0 / 32));
    const cx1 = Math.min(this.chunksX - 1, Math.floor((x1 - 1) / 32));
    const cy1 = Math.min(this.chunksY - 1, Math.floor((y1 - 1) / 32));
    const ci = this.chunkI;
    let n = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const cb = (cy * this.chunksX + cx) * 6;
        if (full) {
          const so = ci[cb + 2];
          const sn = ci[cb + 3];
          for (let k = so; k < so + sn; k++) n = this.emitEnt(this.chunkStatic[k], n, x0, y0, x1, y1);
        }
        const dOff = ci[cb];
        const dn = ci[cb + 1];
        for (let k = dOff; k < dOff + dn; k++) n = this.emitEnt(this.chunkDyn[k], n, x0, y0, x1, y1);
        const lo = ci[cb + 4];
        const ln = ci[cb + 5];
        for (let k = lo; k < lo + ln; k++) {
          const l = this.chunkLines[k];
          if (this.lStamp[l] === fr) continue;
          this.lStamp[l] = fr;
          n = this.emitLine(l, n, x0, y0, x1, y1);
        }
      }
    }
    return n;
  }

  // make room for `count` records in the output buffer (grows only on the first frames)
  ensureOut(count: number): void {
    if (count * 16 <= this.out.byteLength) return;
    let size = this.out.byteLength;
    while (count * 16 > size) size *= 2;
    const nb = new ArrayBuffer(size);
    new Uint8Array(nb).set(new Uint8Array(this.out));
    this.out = nb;
    this.outF = new Float32Array(nb);
    this.outU = new Uint32Array(nb);
  }

  emitEnt(e: number, n: number, x0: number, y0: number, x1: number, y1: number): number {
    const x = this.eX2[e] * 0.5;
    const y = this.eY2[e] * 0.5;
    if (x < x0 || x >= x1 || y < y0 || y >= y1) return n;
    const kind = this.eKind[e];
    const ref = this.eRef[e];
    this.ensureOut(n + 2);
    const f = this.outF;
    const u = this.outU;
    let o = n * 4;
    f[o] = x;
    f[o + 1] = y;
    if (kind === E_MACH) {
      u[o + 2] = ((E_MACH << 24) | this.eSprite[e]) >>> 0;
      u[o + 3] = (Math.floor(this.mProgress[ref] * 32) | (this.mCrafting[ref] << 8)) >>> 0;
      return n + 1;
    }
    if (kind === E_INS) {
      u[o + 2] = ((E_INS << 24) | this.eSprite[e]) >>> 0;
      u[o + 3] = this.insState[ref];
      o += 4;
      f[o] = x;
      f[o + 1] = y;
      u[o + 2] = ((E_HAND << 24) | (this.insHeldN[ref] > 0 ? this.insHeld[ref] + 1 : 0)) >>> 0;
      u[o + 3] = (Math.floor(this.insTheta[ref] * 65536) | (Math.floor(this.insExt[ref] * 4096) << 16)) >>> 0;
      return n + 2;
    }
    u[o + 2] = ((kind << 24) | this.eSprite[e]) >>> 0;
    u[o + 3] = 0;
    return n + 1;
  }

  emitLine(l: number, n: number, x0: number, y0: number, x1: number, y1: number): number {
    const cnt = this.lCount[l];
    if (cnt === 0) return n;
    this.ensureOut(n + cnt);
    const f = this.outF;
    const u = this.outU;
    const off = this.lOff[l];
    const lm = this.lMask[l];
    const head = this.lHead[l];
    const dir = this.lDir[l];
    const ex = this.lEndX[l];
    const ey = this.lEndY[l];
    const lane = this.lLane[l];
    // unit flow vector (dx, dy) and the lane's perpendicular offset
    const dx = dir === 0 ? 1 : dir === 2 ? -1 : 0;
    const dy = dir === 1 ? 1 : dir === 3 ? -1 : 0;
    const bx = ex + dy * lane;
    const by = ey - dx * lane;
    let d = this.lFront[l];
    for (let i = 0; i < cnt; i++) {
      const k = off + ((head + i) & lm);
      if (i > 0) d += SPACING + this.iGap[k];
      const x = (bx - dx * d) * (1 / 256);
      const y = (by - dy * d) * (1 / 256);
      if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
      const o = n * 4;
      f[o] = x;
      f[o + 1] = y;
      u[o + 2] = ((E_ITEM << 24) | this.iKey[k]) >>> 0;
      u[o + 3] = 0;
      n++;
    }
    return n;
  }
}

function setAll(a: Int32Array, n: number): void {
  a.fill(0);
  for (let i = 0; i < n; i++) a[i >>> 5] |= 1 << (i & 31);
}

function popcount(a: Int32Array): number {
  let c = 0;
  for (let w = 0; w < a.length; w++) {
    let v = a[w] | 0;
    while (v !== 0) {
      v &= v - 1;
      c++;
    }
  }
  return c;
}

function grow(a: Int32Array, cap: number): Int32Array {
  const b = new Int32Array(cap);
  b.set(a);
  return b;
}

// xxHash32 over a stream of little-endian u32 words (seed 0)
const P1 = 2654435761;
const P2 = 2246822519;
const P3 = 3266489917;
const P4 = 668265263;
const P5 = 374761393;
const rotl = (x: number, r: number): number => (x << r) | (x >>> (32 - r));

export class Xxh32 {
  private v = new Int32Array(4);
  private buf = new Int32Array(4);
  private nb = 0;
  private total = 0;
  private f = new Float64Array(1);
  private fu = new Uint32Array(this.f.buffer);
  constructor() {
    this.v[0] = (P1 + P2) | 0;
    this.v[1] = P2 | 0;
    this.v[2] = 0;
    this.v[3] = -P1 | 0;
  }
  u32(x: number): void {
    this.buf[this.nb++] = x | 0;
    this.total += 4;
    if (this.nb === 4) {
      for (let k = 0; k < 4; k++) this.v[k] = Math.imul(rotl((this.v[k] + Math.imul(this.buf[k], P2)) | 0, 13), P1);
      this.nb = 0;
    }
  }
  f64(x: number): void {
    this.f[0] = x;
    this.u32(this.fu[0]);
    this.u32(this.fu[1]);
  }
  digest(): number {
    let h: number;
    if (this.total >= 16) h = (rotl(this.v[0], 1) + rotl(this.v[1], 7) + rotl(this.v[2], 12) + rotl(this.v[3], 18)) | 0;
    else h = P5 | 0;
    h = (h + this.total) | 0;
    for (let k = 0; k < this.nb; k++) h = Math.imul(rotl((h + Math.imul(this.buf[k], P3)) | 0, 17), P4);
    h ^= h >>> 15;
    h = Math.imul(h, P2);
    h ^= h >>> 13;
    h = Math.imul(h, P3);
    h ^= h >>> 16;
    return h >>> 0;
  }
}

export function xxh32Bytes(bytes: Uint8Array, len: number): number {
  const h = new Xxh32();
  const words = len >>> 2;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, len);
  for (let k = 0; k < words; k++) h.u32(dv.getUint32(k * 4, true));
  return h.digest();
}
