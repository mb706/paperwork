// The engine overlay against a build (10 §2.4 step 4; D1): every prototype the build holds has the engine
// fields its systems read, and they agree with the design data. A capability manifest's prototypes are checked
// strictly (errors), so the M1 manifest's slice cannot lose an inserter vector or a fluid box unnoticed; other
// build filters (`--manifest m2` … with --allow-incomplete) report warnings.
//
//   - entities: a map colour and a collision mask; inserters their vectors and swing speeds (and an electric
//     inserter's kw is Factorio 2.0's rotation plus extension power, SCHEMA.md); drills a mining area covering
//     their footprint and a drop point outside it; the offshore pump its pumping position; lamps their light;
//     burners their fuel slots; furnaces their inventories; fluid boxes where fluids flow, with every
//     connection on the footprint's edge and facing out, filters that are fluids, and a box for every fluid
//     the entity consumes or produces or one of its recipes needs; a flippable entity's fluid connections have
//     a line of symmetry, and an assembler whose connections have one is flippable (FFF-394; D1-r1);
//   - tiles: a terrain material (terrain.yaml), crisp for town tiles; resources and world objects a map colour;
//   - set tables (sets.yaml, D1-r1): a build with trees has tree species and decoratives in every biome, one
//     with town tiles town buildings;
//   - sounds: every working machine of the build has a working sound, now or in sounds.yaml's `planned`;
//   - the belt lane geometry's lengths are ordered as 10 §5.3's.
// checkOverlayNames runs once over the whole design data: every key the overlay names is a prototype (or a
// mirrors id some entity uses), so a misspelt id cannot hide an entry. checkSets holds sets.yaml to the design
// data's biomes and town skins.
import type { Diagnostics } from './diagnostics.ts';
import type { Model } from './model.ts';
import { DIRECTION_VECTOR, type Direction4, type FluidBox, mirrorsId, type Overlay } from './overlay.ts';
import type { Index } from './refs.ts';
import type { Entity, EntityType } from './schema/entities.ts';
import type { DesignData } from './schema/index.ts';
import { at } from './sources.ts';

/** Every overlay key names something the design data has (D1): a prototype, or a mirrors id in use. */
export function checkOverlayNames(ov: Overlay, ix: Index, diags: Diagnostics): void {
  const known = (
    kind: string,
    keys: Iterable<string>,
    has: (k: string) => boolean,
    src: Parameters<typeof at>[0] | null,
    path: string[],
  ) => {
    for (const k of keys)
      if (!has(k))
        diags.error(
          kind === 'mirrors' ? `no entity mirrors ${k}` : `no ${kind} named ${k}`,
          src ? at(src, [...path, k]) : { file: 'game/data/engine' },
        );
  };
  const p = ov.prototypes;
  const ps = ov.sources.prototypes;
  known('entity', Object.keys(p.entities), (k) => ix.entities.has(k), ps, ['entities']);
  known('item', Object.keys(p.items), (k) => ix.items.has(k), ps, ['items']);
  known('recipe', Object.keys(p.recipes), (k) => ix.recipes.has(k), ps, ['recipes']);
  known('resource', Object.keys(p.resources), (k) => ix.resources.has(k), ps, ['resources']);
  known('world object', Object.keys(p.world), (k) => ix.world.has(k), ps, ['world']);
  const used = new Set([...ix.entities.values()].map((e) => mirrorsId(e.mirrors)));
  known('mirrors', Object.keys(ov.mirrors.entities), (k) => used.has(k), ov.sources.mirrors, ['entities']);
  known('tile', Object.keys(ov.terrain), (k) => ix.tiles.has(k), ov.sources.terrain, ['tiles']);
  const snd = ov.sounds.planned;
  known('entity', snd.working.keys(), (k) => ix.entities.has(k), ov.sources.sounds, [
    'planned',
    'working_sounds',
  ]);
  known('tile', snd.footsteps.keys(), (k) => ix.tiles.has(k), ov.sources.sounds, ['planned', 'footsteps']);
  known('entity', ov.sounds.working.keys(), (k) => ix.entities.has(k), ov.sources.sounds, ['working_sounds']);
}

/**
 * sets.yaml against the design data (D1-r1): every table's ids unique; each biome map names exactly the biomes of
 * meta.world.biomes.order and puts every entry of its list in one biome; every town skin has the same number of
 * pictures, and there are at most 01 §5.3's skins (one more than meta.world.towns.era_skin_w's thresholds).
 */
export function checkSets(ov: Overlay, d: DesignData, diags: Diagnostics): void {
  const src = ov.sources.sets;
  const s = ov.sets;
  const err = (message: string, path: (string | number)[]) => diags.error(message, at(src, path));
  const unique = (name: string, list: readonly string[]) => {
    const seen = new Set<string>();
    for (const x of list) {
      if (seen.has(x)) err(`${name} lists ${x} twice`, [name]);
      seen.add(x);
    }
  };
  unique('tree_species', s.tree_species);
  unique('decoratives', s.decoratives);
  unique('cliffs', s.cliffs);
  unique('town_buildings', s.town_buildings.flat());
  const biomes = d.meta.world.biomes.order;
  const byBiome = (
    mapName: string,
    listName: string,
    map: Record<string, string[]>,
    list: readonly string[],
  ) => {
    for (const b of Object.keys(map))
      if (!biomes.includes(b))
        err(`${mapName} names ${b}, which is no biome of meta.world.biomes.order`, [mapName, b]);
    for (const b of biomes)
      if (!(b in map)) err(`${mapName} lacks the biome ${b} (meta.world.biomes.order)`, [mapName]);
    const home = new Map<string, string>();
    for (const [b, xs] of Object.entries(map))
      for (const x of xs) {
        if (!list.includes(x)) err(`${mapName}.${b} names ${x}, which ${listName} lacks`, [mapName, b]);
        const prev = home.get(x);
        if (prev !== undefined) err(`${mapName} puts ${x} in both ${prev} and ${b}`, [mapName, b]);
        else home.set(x, b);
      }
    for (const x of list)
      if (!home.has(x)) err(`${listName} entry ${x} is in no biome of ${mapName}`, [listName]);
  };
  byBiome('tree_biomes', 'tree_species', s.tree_biomes, s.tree_species);
  byBiome('decorative_biomes', 'decoratives', s.decorative_biomes, s.decoratives);
  const first = s.town_buildings[0]?.length ?? 0;
  s.town_buildings.forEach((skin, i) => {
    if (skin.length !== first)
      err(
        `town_buildings skin ${i + 1} has ${skin.length} pictures and skin 1 ${first}: every skin draws the same blocks`,
        ['town_buildings', i],
      );
  });
  const skins = d.meta.world.towns.era_skin_w.length + 1;
  if (s.town_buildings.length > skins)
    err(`town_buildings has ${s.town_buildings.length} skins; 01 §5.3 has ${skins}`, ['town_buildings']);
}

/** The engine's own sounds.yaml, as the data stage names its source (repository-relative). */
const OWN_SOUNDS = 'game/data/engine/sounds.yaml';

/** Machines that sound while they work (A4 §7.4; sounds.yaml `planned`). */
const WORKING_TYPES: ReadonlySet<EntityType> = new Set([
  'mining-drill',
  'furnace',
  'assembler',
  'lab',
  'boiler',
  'generator',
  'belt',
  'underground-belt',
  'splitter',
  'radar',
  'offshore-pump',
  'pumpjack',
]);

/** Types whose fluid boxes are their purpose (10 §5.8). */
const FLUID_TYPES: ReadonlySet<EntityType> = new Set([
  'pipe',
  'pipe-to-ground',
  'pump',
  'storage-tank',
  'offshore-pump',
  'boiler',
  'heat-exchanger',
]);

const EPS = 1e-9;

/** Whether a point lies strictly inside an entity's footprint, centred on the origin. */
function inside(e: Entity, x: number, y: number): boolean {
  return Math.abs(x) < e.size[0] / 2 - EPS && Math.abs(y) < e.size[1] / 2 - EPS;
}

/**
 * The lines an entity may flip over (FFF-394): the vertical and horizontal axes, and on a square footprint the
 * two diagonals. Each maps a position (x east, y south) and a side.
 */
const MIRRORS: readonly {
  name: string;
  square: boolean;
  p: (x: number, y: number) => [number, number];
  d: Record<Direction4, Direction4>;
}[] = [
  {
    name: 'vertical',
    square: false,
    p: (x, y) => [-x, y],
    d: { north: 'north', east: 'west', south: 'south', west: 'east' },
  },
  {
    name: 'horizontal',
    square: false,
    p: (x, y) => [x, -y],
    d: { north: 'south', east: 'east', south: 'north', west: 'west' },
  },
  {
    name: 'diagonal',
    square: true,
    p: (x, y) => [y, x],
    d: { north: 'west', east: 'south', south: 'east', west: 'north' },
  },
  {
    name: 'antidiagonal',
    square: true,
    p: (x, y) => [-y, -x],
    d: { north: 'east', east: 'north', south: 'west', west: 'south' },
  },
];

/**
 * The lines of symmetry of an entity's fluid connections (FFF-394: "only allowing buildings to flip over their
 * line of symmetry, so all inputs and outputs would still match once flipped"): the mirrors that map every
 * connection onto one of the same kind (box production and filter, flow, type).
 */
export function fluidSymmetries(e: Entity, boxes: readonly FluidBox[]): string[] {
  const key = (b: FluidBox, c: FluidBox['connections'][number], x: number, y: number, d: Direction4) =>
    `${b.production}|${b.filter ?? ''}|${c.flow}|${c.type ?? 'normal'}|${x},${y}|${d}`;
  const own = boxes.flatMap((b) =>
    b.connections.map((c) => key(b, c, c.position[0], c.position[1], c.direction)),
  );
  own.sort();
  return MIRRORS.filter((m) => !m.square || e.size[0] === e.size[1])
    .filter((m) => {
      const img = boxes.flatMap((b) =>
        b.connections.map((c) => key(b, c, ...m.p(c.position[0], c.position[1]), m.d[c.direction])),
      );
      img.sort();
      return img.every((k, i) => k === own[i]);
    })
    .map((m) => m.name);
}

export function checkEngine(m: Model, diags: Diagnostics, strict: boolean): void {
  const ov = m.overlay;
  const src = m.design.sources;
  const report = (message: string, where: Parameters<Diagnostics['error']>[1]) =>
    strict ? diags.error(message, where) : diags.warn(message, where);
  const ent = (r: Model['entities'][number], path: (string | number)[] = []) =>
    at(src.entities, [r.filePos, ...path]);
  const fluids = new Set(m.design.items.filter((i) => i.type === 'fluid').map((i) => i.id));
  // Recipes of the build by category, for the fluid boxes a crafting machine needs.
  const fluidCategories = new Set(
    m.recipes
      .filter((r) => [...r.data.ingredients, ...r.data.products].some((x) => fluids.has(x.id)))
      .map((r) => r.data.category),
  );

  for (const r of m.entities) {
    const e = r.data;
    const g = r.engine;
    const where = ent(r);
    if (!g.map_color) report(`entity ${e.id} has no map colour (defaults.yaml, mirrors.yaml)`, where);
    if (g.collision_mask.length === 0) report(`entity ${e.id} has no collision mask (defaults.yaml)`, where);

    if (g.inserter) {
      const s = g.inserter;
      const missing = (['pickup', 'drop', 'rotation_speed', 'extension_speed'] as const).filter(
        (k) => s[k] === undefined,
      );
      if (missing.length > 0)
        report(
          `inserter ${e.id} lacks ${missing.join(', ')} (mirrors.yaml or prototypes.yaml \`inserter\`)`,
          where,
        );
      else {
        for (const k of ['pickup', 'drop'] as const) {
          const [x, y] = s[k] as [number, number];
          if (inside(e, x, y)) report(`inserter ${e.id}: its ${k} point (${x}, ${y}) lies on itself`, where);
        }
        // An electric inserter's kw is its maximum movement power (SCHEMA.md; Factorio 2.0's wiki formula).
        const en = e.energy;
        if (en.source === 'electric' && en.kw !== undefined) {
          const want =
            60 *
            ((s.rotation_speed as number) * (en.per_rotation_kj ?? 0) +
              (s.extension_speed as number) * (en.per_movement_kj ?? 0));
          if (Math.abs(en.kw - want) > 1e-9 * Math.max(1, want))
            report(
              `inserter ${e.id}: energy.kw ${en.kw} is not 60 × (rotation_speed × per_rotation_kj + extension_speed × per_movement_kj) = ${Math.round(want * 1e9) / 1e9} kW (Factorio 2.0's maximum movement power)`,
              ent(r, ['energy', 'kw']),
            );
        }
      }
    }
    if (g.mining_drill) {
      const d = g.mining_drill;
      if (d.resource_searching_radius === undefined || d.vector_to_place_result === undefined)
        report(`drill ${e.id} lacks its mining area or drop point (mirrors.yaml \`mining_drill\`)`, where);
      else {
        const [w, h] = d.mining_area as [number, number];
        if (w < e.size[0] || h < e.size[1])
          report(
            `drill ${e.id}: its mining area ${w} × ${h} does not cover its ${e.size[0]} × ${e.size[1]} footprint`,
            where,
          );
        const [x, y] = d.vector_to_place_result;
        if (inside(e, x, y)) report(`drill ${e.id}: its drop point (${x}, ${y}) lies on itself`, where);
      }
    }
    if (g.offshore_pump) {
      const p = g.offshore_pump.pumping_position;
      if (!p) report(`offshore pump ${e.id} has no pumping position (mirrors.yaml \`offshore_pump\`)`, where);
      else if (!inside(e, p[0], p[1]))
        report(
          `offshore pump ${e.id}: its pumping position (${p[0]}, ${p[1]}) lies outside its footprint`,
          where,
        );
    }
    if (g.electric_pole) {
      const p = g.electric_pole;
      if (p.auto_connect_up_to_n_wires === undefined || p.track_coverage_during_drag_building === undefined)
        report(`pole ${e.id} lacks its wiring defaults (defaults.yaml \`electric_pole\`)`, where);
    }
    if (g.lamp) {
      const l = g.lamp;
      if (l.darkness_on === undefined || l.darkness_off === undefined || l.light === undefined)
        report(`lamp ${e.id} lacks its darkness thresholds or light (mirrors.yaml \`lamp\`)`, where);
      else if (l.darkness_off >= l.darkness_on)
        report(
          `lamp ${e.id}: darkness_off ${l.darkness_off} must be below darkness_on ${l.darkness_on}`,
          where,
        );
    }
    if (g.burner && !(g.burner.fuel_slots && g.burner.fuel_slots >= 1))
      report(`burner entity ${e.id} has no fuel slot (defaults.yaml \`burner\`)`, where);
    if (g.furnace && (!g.furnace.source_slots || !g.furnace.result_slots))
      report(`furnace ${e.id} lacks its source or result slots (defaults.yaml \`furnace\`)`, where);
    checkFluidBoxes(r, fluids, fluidCategories, report, where);
    // Flipping (FFF-394; I §3.3): a building flips only over a line of symmetry of its fluid connections, and in
    // 2.0 every assembler whose ports have one flips (D1-r1: assembling machine 2).
    if (g.fluid_boxes.length > 0) {
      const lines = fluidSymmetries(e, g.fluid_boxes);
      if (g.flippable && lines.length === 0)
        report(
          `entity ${e.id} is flippable, but its fluid connections have no line of symmetry: flipped, its pipes would not meet (FFF-394)`,
          where,
        );
      if (!g.flippable && e.type === 'assembler' && lines.length > 0)
        report(
          `assembler ${e.id}'s fluid connections are symmetric (${lines.join(', ')}), so it flips in Factorio 2.0 (FFF-394; I §3.3): set flippable (mirrors.yaml)`,
          where,
        );
    }
  }

  // Scenery (sets.yaml, D1-r1): a build with trees has species and decoratives in every biome, one with town
  // tiles town buildings (10 §9.9, §15.7).
  const sets = ov.sets;
  const setsAt = (k: string) => at(ov.sources.sets, [k]);
  if (m.world.some((w) => w.data.kind === 'tree'))
    for (const b of m.design.meta.world.biomes.order) {
      if (!sets.tree_biomes[b]?.length)
        report(`biome ${b} has no tree species (sets.yaml tree_biomes)`, setsAt('tree_biomes'));
      if (!sets.decorative_biomes[b]?.length)
        report(`biome ${b} has no decoratives (sets.yaml decorative_biomes)`, setsAt('decorative_biomes'));
    }
  if (m.tiles.some((t) => t.data.town) && !sets.town_buildings.some((skin) => skin.length > 0))
    report(
      'the build has town tiles but no town buildings (sets.yaml town_buildings)',
      setsAt('town_buildings'),
    );

  // Tiles: a terrain material each (terrain.yaml), crisp for town tiles; a fallback base names a material.
  const tsrc = ov.sources.terrain;
  for (const t of m.tiles) {
    const row = ov.terrain[t.id];
    if (!row) {
      report(`tile ${t.id} has no terrain material (game/data/engine/terrain.yaml)`, at(tsrc, ['tiles']));
      continue;
    }
    if (t.data.town && !row.crisp)
      report(`town tile ${t.id} must be crisp (10 §6.5)`, at(tsrc, ['tiles', t.id, 'crisp']));
    const base = row.fallback?.base;
    if (base && !Object.values(ov.terrain).some((x) => x.material === base))
      report(
        `tile ${t.id}'s fallback base ${base} is no material of terrain.yaml`,
        at(tsrc, ['tiles', t.id, 'fallback', 'base']),
      );
  }
  const psrc = ov.sources.prototypes;
  for (const r of m.resources)
    if ((r.data.kind === 'solid' || r.data.kind === 'fluid') && !ov.prototypes.resources[r.id]?.map_color)
      report(`resource ${r.id} has no map colour (prototypes.yaml resources)`, at(psrc, ['resources']));
  for (const w of m.world)
    if (!ov.prototypes.world[w.id]?.map_color)
      report(`world object ${w.id} has no map colour (prototypes.yaml world)`, at(psrc, ['world']));

  // Sounds: every working machine has a working sound, now or planned. Only the engine's own sounds.yaml is held
  // to it: a fixture build's override (DataStageOptions.engineFiles, the fake sim's) maps what its scenes need.
  const snd = ov.sounds;
  const ssrc = ov.sources.sounds;
  if (ssrc?.file === OWN_SOUNDS)
    for (const r of m.entities)
      if (WORKING_TYPES.has(r.data.type) && !snd.working.has(r.id) && !snd.planned.working.has(r.id))
        report(
          `working machine ${r.id} has no working sound, now or planned (sounds.yaml working_sounds, planned.working_sounds)`,
          at(ssrc, ['working_sounds']),
        );

  // Belt lane geometry (10 §5.3): the inner curve is shorter than a straight lane, the outer longer; items fit.
  const b = ov.defaults.belt_lanes;
  if (
    !(b.curve_inner < b.straight && b.straight < b.curve_outer) ||
    b.positions_per_tile % b.item_spacing !== 0
  )
    report(
      'belt_lanes: need curve_inner < straight < curve_outer and item_spacing dividing positions_per_tile (10 §5.3)',
      at(ov.sources.defaults, ['belt_lanes']),
    );
}

function checkFluidBoxes(
  r: Model['entities'][number],
  fluids: ReadonlySet<string>,
  fluidCategories: ReadonlySet<string>,
  report: (message: string, where: Parameters<Diagnostics['error']>[1]) => void,
  where: Parameters<Diagnostics['error']>[1],
): void {
  const e = r.data;
  const boxes: FluidBox[] = r.engine.fluid_boxes;
  const consumes = (e.consumes ?? []).filter((x) => fluids.has(x));
  const produces = (e.produces ?? []).filter((x) => fluids.has(x));
  const craftsFluid = (e.categories ?? []).some((c) => fluidCategories.has(c));
  const needs = FLUID_TYPES.has(e.type) || consumes.length > 0 || produces.length > 0 || craftsFluid;
  if (needs && boxes.length === 0) {
    report(
      `entity ${e.id} moves fluids but has no fluid boxes (mirrors.yaml or prototypes.yaml \`fluid_boxes\`)`,
      where,
    );
    return;
  }
  boxes.forEach((b, i) => {
    if (b.filter && !fluids.has(b.filter))
      report(`entity ${e.id}: fluid box ${i} filters ${b.filter}, which is no fluid`, where);
    for (const c of b.connections) {
      const [x, y] = c.position;
      const [dx, dy] = DIRECTION_VECTOR[c.direction];
      if (!inside(e, x, y) || inside(e, x + dx, y + dy))
        report(
          `entity ${e.id}: fluid box ${i}'s ${c.direction} connection at (${x}, ${y}) is not on the footprint's edge facing out`,
          where,
        );
    }
  });
  const accepts = (f: string, prod: 'input' | 'output') =>
    boxes.some((b) => (b.production === prod || b.production === 'none') && (!b.filter || b.filter === f));
  for (const f of consumes)
    if (!accepts(f, 'input')) report(`entity ${e.id} consumes ${f} but no fluid box takes it in`, where);
  for (const f of produces)
    if (!accepts(f, 'output')) report(`entity ${e.id} produces ${f} but no fluid box puts it out`, where);
  if (craftsFluid && !boxes.some((b) => b.production === 'input'))
    report(`entity ${e.id} crafts recipes with fluids but has no input fluid box`, where);
}
