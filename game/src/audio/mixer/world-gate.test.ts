// The world gate (10 §9.4): world sounds play while the game runs and the map view is closed.
import { expect, test } from 'vitest';
import { WorldGate } from './world-gate.ts';

test('the pause and the map view each close the gate; neither reopens what the other holds (C7-r1 10)', () => {
  const g = new WorldGate();
  expect(g.open).toBe(true);
  expect(g.set({ paused: true })).toBe(false);
  // the camera moves while paused: the gate stays shut
  expect(g.set({ mapView: false })).toBeNull();
  expect(g.open).toBe(false);
  // map view opens, then the game resumes: still shut until the map closes
  expect(g.set({ mapView: true })).toBeNull();
  expect(g.set({ paused: false })).toBeNull();
  expect(g.open).toBe(false);
  expect(g.set({ mapView: false })).toBe(true);
  expect(g.open).toBe(true);
});
