// Layouts (10 §10.2; C8): the TypeScript twin of crates/sim/src/testkit/layout.rs, for the tools and tests that
// read test/layouts/*.txt. The format is documented there: `# legend: X=entity[:N|E|S|W][:recipe=r][:items=a*n+b*m]`
// lines, then rows of single characters separated by one space; `.` is empty, `@` is the spawn point's tile (0, 0).

export type Dir = 'N' | 'E' | 'S' | 'W';

export interface LegendEntry {
  entity: string;
  dir: Dir;
  recipe: string | null;
  items: [string, number][];
}

export interface Placed {
  ch: string;
  tile: [number, number];
  entry: LegendEntry;
}

export interface Layout {
  legend: Map<string, LegendEntry>;
  placed: Placed[];
  width: number;
  height: number;
  origin: [number, number];
}

function legendEntry(spec: string): LegendEntry {
  const [entity, ...parts] = spec.split(':');
  if (!entity) throw new Error(`${spec}: no entity`);
  const e: LegendEntry = { entity, dir: 'N', recipe: null, items: [] };
  for (const p of parts) {
    if (p.startsWith('recipe=')) e.recipe = p.slice('recipe='.length);
    else if (p.startsWith('items=')) {
      for (const item of p.slice('items='.length).split('+')) {
        const m = /^([^*]+)\*(\d+)$/.exec(item);
        if (!m) throw new Error(`${item}: items are name*count`);
        e.items.push([m[1] as string, Number(m[2])]);
      }
    } else if (p === 'N' || p === 'E' || p === 'S' || p === 'W') e.dir = p;
    else throw new Error(`a direction is N, E, S or W, not ${p}`);
  }
  return e;
}

export function parseLayout(text: string): Layout {
  const legend = new Map<string, LegendEntry>();
  const rows: string[][] = [];
  text.split('\n').forEach((line, n) => {
    const at = (m: string) => new Error(`line ${n + 1}: ${m}`);
    const t = line.trimEnd();
    if (t.startsWith('# legend:')) {
      for (const tok of t.slice('# legend:'.length).trim().split(/\s+/)) {
        if (!tok) continue;
        const eq = tok.indexOf('=');
        if (eq < 0) throw at(`${tok}: a legend entry is X=entity`);
        const ch = tok.slice(0, eq);
        if ([...ch].length !== 1 || ch === '.' || ch === '@' || ch === '#')
          throw at(`${ch}: a legend character is one character other than . @ #`);
        if (legend.has(ch)) throw at(`${ch} is in the legend twice`);
        legend.set(ch, legendEntry(tok.slice(eq + 1)));
      }
      return;
    }
    if (t === '' || t.startsWith('#')) return;
    const row = t.split(' ');
    for (const cell of row)
      if ([...cell].length !== 1)
        throw at(`${JSON.stringify(cell)}: cells are single characters separated by one space`);
    rows.push(row);
  });
  const width = Math.max(0, ...rows.map((r) => r.length));
  const height = rows.length;
  let spawn: [number, number] | null = null;
  rows.forEach((r, y) => {
    const x = r.indexOf('@');
    if (x >= 0 && spawn === null) spawn = [x, y];
  });
  const origin: [number, number] = spawn
    ? [-(spawn as [number, number])[0], -(spawn as [number, number])[1]]
    : [1, 1];
  const placed: Placed[] = [];
  for (const [y, r] of rows.entries())
    for (const [x, c] of r.entries()) {
      if (c === '.' || c === '@') continue;
      const entry = legend.get(c);
      if (!entry) throw new Error(`row ${y + 1}: ${c} is not in the legend`);
      placed.push({ ch: c, tile: [origin[0] + x, origin[1] + y], entry });
    }
  return { legend, placed, width, height, origin };
}
