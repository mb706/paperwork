export function step(state: Int32Array, n: number): number {
  let s = 0;
  for (let t = 0; t < n; t++) for (let i = 0; i < state.length; i++) { state[i] = (state[i] + i) | 0; s = (s + state[i]) | 0; }
  return s;
}
