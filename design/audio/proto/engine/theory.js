// Pitch and harmony helpers. Pitches are MIDI numbers (fractional allowed); pitch classes 0..11.

export const mod12 = (x) => ((x % 12) + 12) % 12;
export const pcOf = (m) => mod12(Math.round(m));
export const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);
export const hzToMidi = (f) => 69 + 12 * Math.log2(f / 440);

/** Major pentatonic on a root pitch class: 0 2 4 7 9. No semitones, no tritone. */
export const pentatonic = (rootPc) => [0, 2, 4, 7, 9].map((i) => mod12(rootPc + i));
/** The diatonic (major) collection that contains pentatonic(rootPc): adds the 4th and 7th. */
export const diatonicOf = (rootPc) => [0, 2, 4, 5, 7, 9, 11].map((i) => mod12(rootPc + i));

/** All MIDI notes in [lo, hi] whose pitch class is in pcs, ascending. */
export function notesIn(pcs, lo, hi) {
  const out = [];
  for (let m = Math.ceil(lo); m <= hi; m++) if (pcs.includes(mod12(m))) out.push(m);
  return out;
}

/** Nearest note to m with pitch class in pcs. dir: 0 nearest (ties up), -1 at or below, +1 at or above. */
export function nearestIn(m, pcs, dir = 0) {
  for (let d = 0; d < 12; d++) {
    const up = m + d;
    const dn = m - d;
    if (dir >= 0 && pcs.includes(mod12(up))) {
      if (dir === 0 && d > 0 && pcs.includes(mod12(dn))) return up; // tie -> up
      return up;
    }
    if (dir <= 0 && pcs.includes(mod12(dn))) return dn;
  }
  return m;
}

/** Step n scale degrees from m (m must be in scale) within the scale pcs. */
export function stepIn(m, pcs, n) {
  let x = Math.round(m);
  const s = Math.sign(n);
  for (let k = 0; k < Math.abs(n); k++) {
    x += s;
    while (!pcs.includes(mod12(x))) x += s;
  }
  return x;
}

/** Remap a note into a new pitch-class set by the smallest move (ties: up). Used when a field changes. */
export const remap = (m, pcs) => (pcs.includes(mod12(m)) ? m : nearestIn(m, pcs, 0));

/**
 * Tintinnabuli (Part, 1976): the T-voice sounds the nearest tone of a triad on one side of the M-voice.
 * position: 'inferior' (below), 'superior' (above); rank 1 = nearest, 2 = second nearest. Never the unison.
 */
export function tVoice(m, triadPcs, position = 'inferior', rank = 1) {
  let x = Math.round(m);
  const s = position === 'superior' ? 1 : -1;
  let found = 0;
  for (let k = 1; k <= 24; k++) {
    x += s;
    if (triadPcs.includes(mod12(x))) {
      found++;
      if (found === rank) return x;
    }
  }
  return m;
}

/**
 * Additive "toward the centre" phrases (the scheme of Part's Spiegel im Spiegel, applied to our own
 * modes and rhythms): phrase k has k+1 notes; odd phrases climb to the centre from below, even phrases
 * descend to it from above. Returns arrays of MIDI notes.
 */
export function towardCentrePhrases(centre, scalePcs, count, firstLen = 2, lens = null) {
  const phrases = [];
  for (let k = 0; k < count; k++) {
    const len = lens ? lens[k % lens.length] : firstLen + k;
    const fromBelow = k % 2 === 0;
    const start = stepIn(centre, scalePcs, fromBelow ? -(len - 1) : len - 1);
    const ph = [];
    for (let i = 0; i < len; i++) ph.push(stepIn(start, scalePcs, fromBelow ? i : -i));
    phrases.push(ph);
  }
  return phrases;
}

/**
 * Voice a chord for an ensemble. bass: MIDI note of the lowest voice (fixed). upper: candidate pitch
 * classes for the other voices (in order of preference). ranges: [[lo, hi], ...] for upper voices,
 * lowest voice first. prev: previous upper voicing (or null) for smooth voice leading.
 * Rules: no crossing, adjacent upper voices within an octave, no unisons, low-interval limits
 * (no interval under a fifth above the bass when the bass is below C3; no thirds below E3),
 * every pitch class of upper[0..need-1] present where possible.
 */
export function voiceChord(bass, upper, ranges, prev, rng, opts = {}) {
  const need = Math.min(opts.need ?? ranges.length, upper.length);
  const required = upper.slice(0, need);
  const cands = ranges.map(([lo, hi]) => notesIn(upper, lo, hi));
  if (opts.top != null) cands[cands.length - 1] = [opts.top]; // a composed top line
  let best = null;
  let bestCost = Infinity;
  const pick = new Array(ranges.length);
  const rec = (i) => {
    if (i === ranges.length) {
      const pcs = pick.map(mod12);
      for (const r of required) if (!pcs.includes(r)) return;
      // hard avoidance: no minor second or ninth against a melody note sounding with this chord
      if (opts.hardAvoid) for (const n of opts.avoid ?? []) for (const m of pick) if (Math.abs(n - m) % 12 === 1) return;
      const cost = voicingCost(bass, pick, prev, opts) + (rng ? rng.next() * 0.3 : 0);
      if (cost < bestCost) {
        bestCost = cost;
        best = pick.slice();
      }
      return;
    }
    for (const m of cands[i]) {
      if (i === 0) {
        const iv = m - bass;
        if (iv <= 0) continue;
        if (bass < 48 && iv < 7) continue; // low-interval limit
        if (bass < 40 && iv < 12) continue;
      } else {
        const below = pick[i - 1];
        const iv = m - below;
        if (iv <= 0 || iv > 12) continue;
        if (below < 52 && iv < 5) continue; // no thirds (or seconds) below E3
        if (iv === 1 && opts.noMinorSeconds !== false) continue;
      }
      pick[i] = m;
      rec(i + 1);
    }
  };
  rec(0);
  return best;
}

function voicingCost(bass, v, prev, opts) {
  let c = 0;
  // movement from the previous voicing; when the number of voices changes, align the tops
  if (prev) {
    const off = prev.length - v.length;
    for (let i = 0; i < v.length; i++) {
      const pi = i + off;
      const p = prev[Math.max(0, Math.min(prev.length - 1, pi))];
      c += Math.abs(v[i] - p) * (i === v.length - 1 ? 1.4 : 1);
    }
  }
  // the lowest upper voice should define the chord: root, third or fifth above the bass
  if (![0, 3, 4, 7].includes(mod12(v[0] - bass))) c += 3;
  if (prev && opts.prevBass != null && opts.prevBass !== bass) {
    // a frozen upper structure over a moving bass sounds like a pedal, not a progression
    if (prev.length === v.length && v.every((m, i) => m === prev[i])) c += 3;
    // no parallel fifths or octaves against the bass
    const db = bass - opts.prevBass;
    for (let i = 0; i < Math.min(v.length, prev.length); i++) {
      const dv = v[i] - prev[i];
      const a = mod12(prev[i] - opts.prevBass);
      const b = mod12(v[i] - bass);
      if (dv !== 0 && Math.sign(dv) === Math.sign(db) && a === b && (a === 0 || a === 7)) c += 5;
    }
  }
  // prefer open, even spacing in the middle; penalise crowding in the low-mid register
  for (let i = 1; i < v.length; i++) {
    const iv = v[i] - v[i - 1];
    if (iv < 3) c += 2.5;
    if (v[i - 1] < 55 && iv < 7) c += 1.5;
  }
  // keep the top voice near a target register if given
  if (opts.topTarget != null) c += Math.abs(v[v.length - 1] - opts.topTarget) * 0.35;
  // never a minor second or minor ninth (upper - lower = 1 mod 12) against a melody note
  for (const n of opts.avoid ?? []) for (const m of v) {
    const iv = Math.abs(n - m);
    if (iv % 12 === 1 && (n > m ? n - m : m - n) > 0 && mod12(Math.max(n, m) - Math.min(n, m)) === 1) c += 9;
  }
  // avoid a minor ninth between any voice and a lower one
  for (let i = 0; i < v.length; i++) {
    for (let j = 0; j < i; j++) if (mod12(v[i] - v[j]) === 1) c += 6;
    if (mod12(v[i] - bass) === 1) c += 6;
  }
  return c;
}

/**
 * A top line through a chord sequence: for each chord, the allowed note nearest a contour target,
 * preferring steps over leaps and moving rather than repeating. chords: [{pcs, target}], range [lo, hi].
 */
export function topLine(chords, range, start = null) {
  const out = [];
  let prev = start;
  for (const c of chords) {
    if (c.reenter) prev = null; // the voice rested: it may come back anywhere
    const cands = notesIn(c.pcs, range[0], range[1]);
    let best = cands[0];
    let bc = Infinity;
    for (const m of cands) {
      let cost = Math.abs(m - c.target) * 0.8;
      if (prev != null) {
        const d = Math.abs(m - prev);
        cost += d > 5 ? 3 + d : d * 0.4;
        if (d === 0) cost += 1.2;
      }
      if (cost < bc) {
        bc = cost;
        best = m;
      }
    }
    out.push(best);
    prev = best;
  }
  return out;
}

/** Equal-tempered MIDI value of a just interval above a MIDI note (for drones and spectral chords). */
export const justAbove = (m, ratio) => m + 12 * Math.log2(ratio);
