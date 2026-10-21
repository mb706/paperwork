// bench/engine.ts (bench/calibrate.ts): the user's engine is matched with this host's runs, or refused (the M0 exit audit #8, C9).
import { describe, expect, it } from 'vitest';
import { engineOf } from '../../bench/engine.ts';

describe("the user's engine", () => {
  it('names Chromium-based and Firefox browsers, and refuses the rest', () => {
    const chrome =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
    const edge = `${chrome} Edg/156.0.0.0`;
    const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0';
    const safari =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';
    const ios =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/156.0 Mobile/15E148 Safari/604.1';
    expect(engineOf(chrome)).toBe('chrome');
    expect(engineOf(edge)).toBe('chrome');
    expect(engineOf(firefox)).toBe('firefox');
    expect(engineOf(safari)).toBeNull();
    // Chrome on iOS is WebKit underneath: not Chromium's engine
    expect(engineOf(ios)).toBeNull();
    expect(engineOf('')).toBeNull();
  });
});
