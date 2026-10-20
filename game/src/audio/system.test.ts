// The façade's start-up checks that need no AudioContext: a sound manifest built for other prototypes is
// refused (10 §15.6).
import { afterEach, expect, test, vi } from 'vitest';
import { AudioSystem } from './system.ts';

const sounds = (hash: string | null) => ({
  version: 1,
  rate: 32000,
  prototypesHash: hash,
  sounds: {},
  events: {},
  working: {},
  music: { eras: [{ from: null, piece: 'era1', name: 'Relays and tubes', typicalWatts: 1e6, busDb: 13.6 }] },
});

function serve(hash: string | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('sounds.json')
        ? new Response(JSON.stringify(sounds(hash)))
        : new Response('missing', { status: 404 }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('a sound manifest built for other prototypes is refused, not merely logged (C7-r1 12)', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  serve('aaaa1111');
  const audio = new AudioSystem({ worklets: { bank: '' }, prototypesHash: 'bbbb2222' });
  await audio.preload();
  expect(audio.errors.some((e) => e.includes('sound effects are off'))).toBe(true);
  expect((audio as unknown as { sounds: unknown }).sounds).toBeNull();
});

test('a matching manifest is kept', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  serve('aaaa1111');
  const audio = new AudioSystem({ worklets: { bank: '' }, prototypesHash: 'aaaa1111' });
  await audio.preload();
  expect(audio.errors.filter((e) => e.includes('prototypes'))).toEqual([]);
  expect((audio as unknown as { sounds: unknown }).sounds).not.toBeNull();
});
