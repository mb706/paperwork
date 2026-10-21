// The layout format (10 §10.2; C8) in TypeScript: the spec's example and the same refusals as the Rust parser
// (crates/sim/src/testkit/layout.rs), and every layout in test/layouts/ parses with only known entities.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLayout } from '../helpers/layout.ts';
import { GAME } from '../helpers/paths.ts';

describe('layouts', () => {
  it('parse the spec example as the Rust parser does', () => {
    const l = parseLayout(
      '# legend: C=iron-chest  i=inserter:E  A=assembler-1:recipe=iron-gear-wheel  >=transport-belt:E\n' +
        '# legend: E=electric-interface\n' +
        'C i A . . i C\n' +
        '. . . . . . .\n' +
        '. @ . . . . >\n',
    );
    expect([l.width, l.height, l.origin]).toEqual([7, 3, [-1, -2]]);
    expect(l.placed).toHaveLength(6);
    expect(l.placed[0]?.tile).toEqual([-1, -2]);
    expect(l.placed[1]?.entry.dir).toBe('E');
    expect(l.placed[2]?.entry.recipe).toBe('iron-gear-wheel');
    expect(l.placed.filter((p) => p.ch === 'C').map((p) => p.tile)).toEqual([
      [-1, -2],
      [5, -2],
    ]);
    expect(l.placed[5]?.tile).toEqual([5, 0]);
  });

  it('read contents and refuse the same mistakes', () => {
    const l = parseLayout('# legend: C=iron-chest:items=iron-plate*800+iron-ore*5\nC\n');
    expect(l.origin).toEqual([1, 1]);
    expect(l.placed[0]?.entry.items).toEqual([
      ['iron-plate', 800],
      ['iron-ore', 5],
    ]);
    for (const bad of [
      'C\n',
      '# legend: C=iron-chest C=iron-chest\n',
      '# legend: .=iron-chest\n',
      '# legend: C=iron-chest:Q\nC\n',
      '# legend: C=iron-chest:items=iron-plate\nC\n',
      '# legend: C=iron-chest\nCC\n',
    ])
      expect(() => parseLayout(bad), bad).toThrow();
  });

  it('in test/layouts/ name only entities of the M0 prototypes', () => {
    const protos = JSON.parse(readFileSync(join(GAME, 'test/golden/m0/protos/prototypes.json'), 'utf8')) as {
      entity: { name: string }[];
      item: { name: string }[];
    };
    const entities = new Set(protos.entity.map((e) => e.name));
    const items = new Set(protos.item.map((e) => e.name));
    const dir = join(GAME, 'test', 'layouts');
    const files = readdirSync(dir).filter((f) => f.endsWith('.txt'));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files) {
      const l = parseLayout(readFileSync(join(dir, f), 'utf8'));
      for (const p of l.placed) {
        expect(entities.has(p.entry.entity), `${f}: ${p.entry.entity}`).toBe(true);
        for (const [item] of p.entry.items) expect(items.has(item), `${f}: ${item}`).toBe(true);
      }
    }
  });
});
