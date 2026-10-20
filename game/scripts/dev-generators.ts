// The dev server's generators (the schema generator, the data stage, cargo) share one registry, so a
// request never sees one generator's new output beside another's old one (C1a-r1 findings 14, 15):
//   - every scheduled or running build is registered; held requests wait until none is left;
//   - a generator's failure is persisted until its next success: held requests get a 503 with the
//     error instead of the previous results, and every new browser connection gets the error overlay;
//   - a generator may follow another: the data stage runs again after the schema generator succeeds,
//     because prototypes.bin carries the schema's hash.
import type { ViteDevServer } from 'vite';

export interface GeneratorState {
  name: string;
  /** The error of the last run, until a run succeeds. */
  failure: string | null;
}

const busy = new Set<Promise<unknown>>();
const states = new Map<string, GeneratorState>();
const followers = new Map<string, (() => void)[]>();

/** Registers work in progress until it settles. */
export function track<T>(p: Promise<T>): Promise<T> {
  busy.add(p);
  const done = () => busy.delete(p);
  p.then(done, done);
  return p;
}

/** Resolves when no generator is scheduled or running. */
export async function idle(): Promise<void> {
  while (busy.size > 0) await Promise.allSettled([...busy]);
}

export function state(name: string): GeneratorState {
  let s = states.get(name);
  if (!s) {
    s = { name, failure: null };
    states.set(name, s);
  }
  return s;
}

/** The persisted failures, for held requests and new connections. */
export function failures(names?: readonly string[]): GeneratorState[] {
  return [...states.values()].filter((s) => s.failure !== null && (!names || names.includes(s.name)));
}

/** Runs `run` whenever `leader` succeeds. */
export function follow(leader: string, run: () => void): void {
  const list = followers.get(leader) ?? [];
  list.push(run);
  followers.set(leader, list);
}

export function succeeded(name: string): void {
  state(name).failure = null;
  for (const run of followers.get(name) ?? []) run();
}

export function failed(name: string, message: string): void {
  state(name).failure = message;
}

/** The error overlay payload for the persisted failures. */
export function overlay(list: readonly GeneratorState[]): {
  type: 'error';
  err: { message: string; stack: string };
} {
  return {
    type: 'error',
    err: { message: list.map((s) => `${s.name} failed\n\n${s.failure}`).join('\n\n'), stack: '' },
  };
}

/** Sends the overlay to every client that connects while something has failed (once per server). */
const announced = new WeakSet<object>();
export function announceFailures(server: ViteDevServer): void {
  if (announced.has(server)) return;
  announced.add(server);
  server.ws.on('connection', () => {
    const list = failures();
    if (list.length > 0) server.ws.send(overlay(list));
  });
}

/** For tests: forget every generator. */
export function resetGenerators(): void {
  busy.clear();
  states.clear();
  followers.clear();
}
