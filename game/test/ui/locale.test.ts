// The UI locale (locale/en.yaml; 10 §7.2, 08): parsed by the UI's strict YAML subset exactly as a full YAML
// parser reads it (the font coverage check uses PyYAML), complete for every key the code and the data name, and
// within the text canon's rules (08 §0–§1: no "!", no ellipsis, no "you").
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { runDataStage } from '../../scripts/data-stage/index.ts';
import type { PrototypesJson } from '../../src/shared/gen/protos.ts';
import { PROTOCOL_VERSION, SCHEMA_HASH } from '../../src/shared/gen/schema.ts';
import { EN, fill, formatCount, formatDuration } from '../../src/ui/i18n/locale.ts';
import { flattenLocale, LocaleSyntaxError, parseLocaleYaml } from '../../src/ui/i18n/yaml.ts';
import { CONTROLS, GROUPS } from '../../src/ui/input/controls.ts';
import { controlNameKey } from '../../src/ui/input/names.ts';
import { GAME, SPEC } from '../helpers/paths.ts';

const TEXT = readFileSync(join(GAME, 'locale', 'en.yaml'), 'utf8');

function protosFor(manifest: string | null): PrototypesJson {
  const r = runDataStage({
    gameDir: GAME,
    specDir: SPEC,
    ...(manifest ? { manifest, allowIncomplete: true } : {}),
    schemaHash: SCHEMA_HASH,
    protocolVersion: PROTOCOL_VERSION,
  });
  const bytes = r.outputs.get('public/data/prototypes.json');
  if (!bytes) throw new Error('no prototypes.json');
  return JSON.parse(new TextDecoder().decode(bytes)) as PrototypesJson;
}

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(f) && !f.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('locale/en.yaml', () => {
  it('parses to what a full YAML parser reads', () => {
    const ours = Object.fromEntries(flattenLocale(parseLocaleYaml(TEXT)));
    const theirs = Object.fromEntries(flattenLocale(parseYaml(TEXT) as never));
    expect(ours).toEqual(theirs);
    expect(EN.get('game.title')).toBe('Paperwork');
    expect(EN.get('game.tagline')).toBe('Information is physical.');
  });

  it('has a string for every locale key of the M0 and M1 builds (C1b decision 13)', () => {
    for (const build of [protosFor(null), protosFor('m1')]) {
      for (const list of Object.values(build.localeKeys))
        for (const k of list) if (k.key !== null) expect(EN.has(k.key), k.key).toBe(true);
      for (const g of build.groups) expect(EN.has(`item-group-name.${g.name}`), g.name).toBe(true);
    }
  });

  it('carries the two vanilla flying texts verbatim (C1c open issue 4)', () => {
    expect(fill(EN.get('flying-text.inventory-full') ?? '', ['Iron plate'])).toBe(
      'Cannot insert Iron plate. Inventory is full.',
    );
    expect(fill(EN.get('flying-text.cannot-put-away') ?? '', ['Iron plate'])).toBe(
      'Cannot put away the Iron plate. Player inventory is full.',
    );
  });

  it('names every control and every Controls section', () => {
    for (const c of CONTROLS) expect(EN.has(controlNameKey(c.id)), c.id).toBe(true);
    for (const g of GROUPS) expect(EN.has(`control-group.${g}`), g).toBe(true);
  });

  it("has every key the UI's code names literally", () => {
    const missing: string[] = [];
    for (const f of sources(join(GAME, 'src', 'ui')))
      for (const m of readFileSync(f, 'utf8').matchAll(/\bt\(\s*'([a-z0-9-]+(?:\.[a-z0-9-]+)+)'/g))
        if (!EN.has(m[1] as string)) missing.push(`${f.slice(GAME.length + 1)}: ${m[1]}`);
    expect(missing).toEqual([]);
  });

  it('keeps the text canon: no exclamation marks, no ellipses, nobody addressed (08 §1, P7, P14)', () => {
    for (const [k, v] of EN) {
      expect(v, k).not.toMatch(/!|…|\.\.\./);
      expect(v, k).not.toMatch(/\byou(r)?\b/i);
    }
  });
});

describe('the locale parser refuses what it cannot read like YAML', () => {
  const bad = [
    'a:\n\tb: x',
    'a: [1, 2]',
    'a: - x',
    'a: yes',
    'a: 12',
    'a: b: c',
    'a: "open',
    'a: x\na: y',
    'a:\nb: x',
  ];
  for (const text of bad)
    it(JSON.stringify(text), () => {
      expect(() => parseLocaleYaml(text)).toThrow(LocaleSyntaxError);
    });
  it('reads quoted escapes and comments', () => {
    expect(flattenLocale(parseLocaleYaml('a:\n  b: "x: \\"y\\"" # c\n  c: \'it\'\'s\'\n'))).toEqual(
      new Map([
        ['a.b', 'x: "y"'],
        ['a.c', "it's"],
      ]),
    );
  });
});

describe('number formats (I §4.8: smart formatting; 07 §0)', () => {
  it('formats counts with k and M', () => {
    expect([5, 999, 1000, 1250, 9999, 12345, 120000, 1_500_000].map(formatCount)).toEqual([
      '5',
      '999',
      '1k',
      '1.2k',
      '9.9k',
      '12k',
      '120k',
      '1.5M',
    ]);
  });
  it('formats durations as H:MM:SS, M:SS and 0.99 s', () => {
    expect([0.5, 42, 70, 3725].map(formatDuration)).toEqual(['0.50 s', '0:42', '1:10', '1:02:05']);
  });
});
