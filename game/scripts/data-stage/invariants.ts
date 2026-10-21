// How the design data's values relate (D1-r1 finding 5): the invariants of tools/validate_spec.py's
// check_engine_values and check_copies, ported rule for rule so that the data stage and the Python validator
// give the same verdict on every input (python-agreement.test.ts holds them to it). The schemas (schema/) type
// each value on its own; these check values against each other, over the whole data, before any build:
//
//   - check_engine_values (D1; 10 §2.4 J1): pole and Switch areas, belt-tier throughput, boilers' 1 : 10 and the
//     energy it carries over, steam generators' power against their flow, the temperatures steam makers and
//     users name against their fluids' limits, lamp priority, radar scans, the Frontier cluster's payloads, the
//     day cycle, and the worldgen tables of meta.world and meta.start.guarantees (01 §2, §4, §5, §9);
//   - check_copies (R5-gate): values the data holds twice agree, since the engine reads one copy (10 §2.4).
import { canonicalJson, compareCodeUnits } from '../lib/canonical.ts';
import type { DataPath, Diagnostics } from './diagnostics.ts';
import type { Index } from './refs.ts';
import type { Entity } from './schema/entities.ts';
import type { DesignData } from './schema/index.ts';
import { at } from './sources.ts';

const isNum = (v: unknown): v is number => typeof v === 'number';
const fmt = (v: number): string => String(Number(v.toPrecision(6)));

export function checkInvariants(d: DesignData, ix: Index, diags: Diagnostics): void {
  checkEngineValues(d, ix, diags);
  checkCopies(d, ix, diags);
}

function checkEngineValues(d: DesignData, ix: Index, diags: Diagnostics): void {
  const ent = (e: Entity, path: DataPath = []) =>
    at(d.sources.entities, [ix.position.entities?.get(e.id) ?? 0, ...path]);
  const meta = (path: DataPath) => at(d.sources.meta, path);
  const extraOf = (e: Entity): Record<string, unknown> => e.extra ?? {};
  const fluidRange = (f: string): [number, number] => {
    const it = ix.items.get(f);
    const lo = it?.default_temperature ?? 15;
    return [lo, it?.max_temperature ?? lo];
  };
  const capacity = (f: string): number => ix.items.get(f)?.heat_capacity_kj_per_k ?? 1;
  const fluidsOf = (list: readonly string[] | undefined): string[] =>
    (list ?? []).filter((f) => ix.items.get(f)?.type === 'fluid');

  const beltSpeeds = new Set<number>();
  for (const e of d.entities) {
    const x = extraOf(e);
    const t = e.type;
    if ((t === 'lamp') !== (e.energy.priority === 'lamp'))
      diags.error(
        `entity ${e.id}: energy.priority lamp is exactly the lamps' (Factorio's usage_priority "lamp"; 10 §5.7)`,
        ent(e, ['energy']),
      );
    // Every temperature a steam maker or user names lies within its fluid's limits (D1-r1).
    const named: [string, string[]][] =
      t === 'boiler' || t === 'heat-exchanger'
        ? [['temp_c', fluidsOf(e.produces)]]
        : t === 'generator'
          ? [
              ['min_temperature_c', fluidsOf(e.consumes)],
              ['max_temperature_c', fluidsOf(e.consumes)],
            ]
          : [];
    for (const [k, fl] of named)
      for (const f of fl) {
        const [lo, hi] = fluidRange(f);
        const v = x[k];
        if (isNum(v) && !(lo <= v && v <= hi))
          diags.error(
            `entity ${e.id}: extra.${k} ${fmt(v)} °C lies outside ${f}'s temperatures [${fmt(lo)}, ${fmt(hi)}] (items.yaml default_temperature, max_temperature)`,
            ent(e, ['extra', k]),
          );
      }
    if (t === 'electric-pole')
      for (const k of ['wire_reach', 'supply_area_distance']) {
        const v = x[k];
        if (!(isNum(v) && v > 0 && v <= 64))
          diags.error(
            `entity ${e.id}: extra.${k} must be a number in (0, 64] (Factorio's limit)`,
            ent(e, ['extra']),
          );
      }
    if (t === 'beacon') {
      const v = x.supply_area_distance;
      if (!(isNum(v) && v > 0 && v <= 64))
        diags.error(
          `entity ${e.id}: extra.supply_area_distance must be a number in (0, 64]`,
          ent(e, ['extra']),
        );
      if (x.profile !== 'inverse-sqrt')
        diags.error(`entity ${e.id}: extra.profile must be inverse-sqrt (FFF-409)`, ent(e, ['extra']));
    }
    if (t === 'belt' || t === 'underground-belt' || t === 'splitter') {
      const v = x.items_per_s;
      if (!(isNum(v) && v > 0))
        diags.error(
          `entity ${e.id}: a ${t} needs extra.items_per_s (its tier's throughput)`,
          ent(e, ['extra']),
        );
      else if (!Number.isInteger((v * 8) / 15))
        diags.error(
          `entity ${e.id}: ${fmt(v)} items/s is not a whole number of positions per tick (10 §5.3)`,
          ent(e, ['extra', 'items_per_s']),
        );
      else if (t === 'belt') beltSpeeds.add(v);
    }
    if (t === 'underground-belt' && !(Number.isInteger(x.max_gap) && (x.max_gap as number) > 0))
      diags.error(
        `entity ${e.id}: an underground belt needs a positive integer extra.max_gap`,
        ent(e, ['extra']),
      );
    if ((t === 'boiler' || t === 'heat-exchanger') && isNum(x.steam_per_s) && isNum(x.water_per_s)) {
      const steam = x.steam_per_s;
      const water = x.water_per_s;
      if (Math.abs(steam - 10 * water) > 1e-9 * steam)
        diags.error(
          `entity ${e.id}: steam_per_s must be 10 × water_per_s (2.0's 1 : 10; 10 §5.8)`,
          ent(e, ['extra', 'steam_per_s']),
        );
      const ins = fluidsOf(e.consumes);
      const outs = fluidsOf(e.produces);
      if (ins[0] !== undefined && outs[0] !== undefined) {
        const w = water * capacity(ins[0]);
        const s = steam * capacity(outs[0]);
        if (Math.abs(w - s) > 1e-9 * Math.max(w, s))
          diags.error(
            `entity ${e.id}: water_per_s × ${ins[0]}'s heat capacity (${fmt(w)}) must equal steam_per_s × ${outs[0]}'s (${fmt(s)}): 2.0's 1 : 10 carries the energy over (fluid.lua 2.0.77)`,
            ent(e, ['extra']),
          );
      }
    }
    if (t === 'generator' && (e.consumes ?? []).includes('steam')) {
      const { steam_per_s: flow, min_temperature_c: tmin, max_temperature_c: tmax } = x;
      if (!(isNum(flow) && isNum(tmin) && isNum(tmax)))
        diags.error(
          `entity ${e.id}: a steam generator needs extra.steam_per_s, min_temperature_c and max_temperature_c`,
          ent(e, ['extra']),
        );
      else {
        const steam = ix.items.get('steam');
        const perUnitKj = (tmax - (steam?.default_temperature ?? 15)) * (steam?.heat_capacity_kj_per_k ?? 1);
        const kw = x.max_kw;
        if (isNum(kw) && Math.abs(kw - flow * perUnitKj) > 1e-6)
          diags.error(
            `entity ${e.id}: max_kw ${fmt(kw)} is not steam_per_s × (max_temperature_c − 15 °C) × steam's heat capacity = ${fmt(flow * perUnitKj)} (10 §5.7)`,
            ent(e, ['extra', 'max_kw']),
          );
      }
    }
    if (t === 'radar')
      for (const k of [
        'sector_range_chunks',
        'nearby_range_chunks',
        'energy_per_sector_mj',
        'energy_per_nearby_scan_kj',
      ]) {
        const v = x[k];
        if (!(isNum(v) && v > 0))
          diags.error(`entity ${e.id}: a radar needs a positive extra.${k} (10 §5.19)`, ent(e, ['extra']));
      }
    if (t === 'rocket-silo' && ('payloads' in x || 'empty_launch' in x)) {
      const launches = d.recipes.filter((r) => r.category === 'launch' && r.pseudo);
      const payloads = [
        ...new Set(launches.flatMap((r) => r.ingredients.map((i) => i.id)).filter((i) => i !== 'run-shard')),
      ].sort(compareCodeUnits);
      const listed = [...((x.payloads as string[] | undefined) ?? [])].sort(compareCodeUnits);
      if (canonicalJson(listed, 0) !== canonicalJson(payloads, 0))
        diags.error(
          `entity ${e.id}: extra.payloads [${listed.join(', ')}] is not the launch recipes' payloads [${payloads.join(', ')}]`,
          ent(e, ['extra', 'payloads']),
        );
      const empty = launches.some((r) => r.ingredients.every((i) => i.id === 'run-shard'));
      if (Boolean(x.empty_launch) !== empty)
        diags.error(
          `entity ${e.id}: extra.empty_launch must say whether a launch recipe takes no payload (${empty})`,
          ent(e, ['extra']),
        );
    }
  }
  for (const e of d.entities) {
    const v = extraOf(e).items_per_s;
    if (
      (e.type === 'underground-belt' || e.type === 'splitter') &&
      isNum(v) &&
      beltSpeeds.size > 0 &&
      !beltSpeeds.has(v)
    )
      diags.error(
        `entity ${e.id}: extra.items_per_s ${fmt(v)} is no belt tier's (${[...beltSpeeds].sort((a, b) => a - b).join(', ')})`,
        ent(e, ['extra', 'items_per_s']),
      );
  }

  const day = d.meta.heat.daylight;
  const fr = [day.dusk, day.evening, day.morning, day.dawn];
  if (
    !(
      0 <= day.dusk &&
      day.dusk < day.evening &&
      day.evening < day.morning &&
      day.morning < day.dawn &&
      day.dawn <= 1
    )
  )
    diags.error(
      `meta.heat.daylight: need 0 ≤ dusk < evening < morning < dawn ≤ 1 (fractions of the day from noon; have ${fr.join(', ')})`,
      meta(['heat', 'daylight']),
    );

  const tiles = ix.tiles;
  const bio = d.meta.world.biomes;
  const upper = bio.upper_c;
  if (upper.length !== bio.order.length - 1 || upper.some((u, i) => i > 0 && u < (upper[i - 1] as number)))
    diags.error(
      'meta.world.biomes: upper_c needs one ascending bound per biome but the last',
      meta(['world', 'biomes', 'upper_c']),
    );
  const sortedKeys = (o: object) => Object.keys(o).sort(compareCodeUnits);
  if (canonicalJson(sortedKeys(bio.trees), 0) !== canonicalJson([...bio.order].sort(compareCodeUnits), 0))
    diags.error('meta.world.biomes.trees: one factor per biome of order', meta(['world', 'biomes', 'trees']));
  const named = new Set(d.tiles.flatMap((t) => t.biome ?? []));
  for (const b of bio.order)
    if (tiles.size > 0 && !named.has(b))
      diags.error(
        `meta.world.biomes: no tile names the biome '${b}' (tiles.yaml biome)`,
        meta(['world', 'biomes', 'order']),
      );

  const pat = d.meta.world.patches;
  const res = ix.resources;
  for (const [rid, p] of Object.entries(pat.resources)) {
    const r = res.get(rid);
    if (!r)
      diags.error(
        `meta.world.patches.resources: unknown resource '${rid}'`,
        meta(['world', 'patches', 'resources', rid]),
      );
    else if (r.kind !== 'solid')
      diags.error(
        `meta.world.patches.resources: ${rid} is not a solid resource`,
        meta(['world', 'patches', 'resources', rid]),
      );
    const st = p.start;
    if (st && st.amount !== st.per_tile * st.tiles)
      diags.error(
        `meta.world.patches.resources.${rid}.start: amount must be per_tile × tiles`,
        meta(['world', 'patches', 'resources', rid, 'start']),
      );
  }
  const cover = new Set(d.meta.start.guarantees.inside_starting_coverage);
  for (const [rid, p] of Object.entries(pat.resources))
    if (Boolean(p.start) !== cover.has(rid))
      diags.error(
        `meta.world.patches.resources.${rid}: a starting patch exactly when meta.start.guarantees.inside_starting_coverage lists the resource (01 §9)`,
        meta(['world', 'patches', 'resources', rid]),
      );
  // Archives come with towns and records stores (meta.world.archives); every other solid resource is a patch.
  for (const [rid, r] of res)
    if (r.kind === 'solid' && r.yields !== 'records' && !(rid in pat.resources))
      diags.error(
        `meta.world.patches.resources: no row for the solid resource ${rid} (01 §4)`,
        meta(['world', 'patches', 'resources']),
      );
  for (const r of pat.coast_bias.resources)
    if (!res.has(r))
      diags.error(
        `meta.world.patches.coast_bias: unknown resource '${r}'`,
        meta(['world', 'patches', 'coast_bias', 'resources']),
      );
  for (const t of pat.coast_bias.on_tiles)
    if (tiles.size > 0 && !tiles.has(t))
      diags.error(
        `meta.world.patches.coast_bias: unknown tile '${t}'`,
        meta(['world', 'patches', 'coast_bias', 'on_tiles']),
      );

  const towns = d.meta.world.towns;
  const bands = towns.band_upper_tiles.length + 1;
  if (towns.probability.length !== bands)
    diags.error(
      `meta.world.towns.probability: one P(town) per distance band (${bands})`,
      meta(['world', 'towns', 'probability']),
    );
  if (
    canonicalJson(sortedKeys(towns.classes), 0) !==
    canonicalJson([...d.meta.town_classes].sort(compareCodeUnits), 0)
  )
    diags.error(
      'meta.world.towns.classes: one row per town class (meta.town_classes)',
      meta(['world', 'towns', 'classes']),
    );
  const sums: number[] = Array.from({ length: bands }, () => 0);
  for (const [c, row] of Object.entries(towns.classes)) {
    const where = meta(['world', 'towns', 'classes', c]);
    const p = row.probability;
    if (c === 'starting-college') {
      if (p !== undefined)
        diags.error(
          'meta.world.towns.classes.starting-college: the starting college is placed, not drawn (01 §9)',
          where,
        );
      continue;
    }
    if (!(p && p.length === bands)) {
      diags.error(`meta.world.towns.classes.${c}: one probability per distance band (${bands})`, where);
      continue;
    }
    // Python's zip: the sums stay `bands` long.
    for (let b = 0; b < bands; b++) sums[b] = (sums[b] as number) + (p[b] as number);
    for (const k of ['taps', 'initial_yield'] as const) {
      const v = row.exchange[k];
      if (!(v && v[0] <= v[1]))
        diags.error(`meta.world.towns.classes.${c}.exchange.${k} must be [min, max]`, where);
    }
  }
  sums.forEach((s, b) => {
    if (Math.abs(s - 1) > 1e-9)
      diags.error(
        `meta.world.towns.classes: the class probabilities of band ${b} sum to ${fmt(s)}, not 1`,
        meta(['world', 'towns', 'classes']),
      );
  });

  const sd = d.meta.start.guarantees.college.spawn_distance_tiles;
  if (!(0 <= sd[0] && sd[0] <= sd[1]))
    diags.error(
      'meta.start.guarantees.college.spawn_distance_tiles must be [min, max]',
      meta(['start', 'guarantees', 'college', 'spawn_distance_tiles']),
    );
}

/** Values the data holds twice agree (R5-gate; validate_spec.py check_copies): the engine reads one copy. */
function checkCopies(d: DesignData, ix: Index, diags: Diagnostics): void {
  const m = d.meta;
  const same = (label: string, a: unknown, b: unknown) => {
    if (a !== undefined && b !== undefined && canonicalJson(a, 0) !== canonicalJson(b, 0))
      diags.error(`duplicated value disagrees: ${label}: ${canonicalJson(a, 0)} != ${canonicalJson(b, 0)}`, {
        file: d.sources.meta.file,
      });
  };
  same(
    'meta.world.archives.starting_archive vs meta.start.guarantees.starting_archive_records',
    m.world.archives.starting_archive,
    m.start.guarantees.starting_archive_records,
  );
  const effects = d.technologies.flatMap((t) => (t.unlocks.effects ?? []).map((ef) => ({ t, ef })));
  for (const { t, ef } of effects) {
    if (ef.type === 'deployment-sigma')
      same(
        `meta.world.sigma.watermarking_factor vs ${t.id}'s deployment-sigma`,
        m.world.sigma.watermarking_factor,
        ef.multiplier,
      );
    if (ef.type === 'liquid-cooling')
      same(
        `meta.heat.coolant.liquid_share.${t.id} vs its liquid-cooling fraction`,
        m.heat.coolant.liquid_share[t.id],
        ef.fraction,
      );
  }
  const run = ix.enemies.get('runaway');
  same(
    'meta.runaways.escape_timer_s vs enemies.runaway.escape_timer_s',
    m.runaways.escape_timer_s,
    run?.escape_timer_s,
  );
  same(
    'meta.runaways.spread.interval_s vs enemies.runaway.spread_interval_s',
    m.runaways.spread.interval_s,
    run?.spread_interval_s,
  );
  same(
    'meta.runaways.presets vs meta.world_settings.runaways.options',
    m.runaways.presets,
    m.world_settings.runaways?.options,
  );
  same(
    'meta.runaways.default vs meta.world_settings.runaways.default',
    m.runaways.default,
    m.world_settings.runaways?.default,
  );
  const deploying = new Set(d.entities.filter((e) => e.deploys).map((e) => e.id));
  if (d.items.some((i) => i.staff?.deploys)) deploying.add('seminar');
  same(
    'meta.runaways.deploying_buildings vs entities with deploys (+ the Seminar via a deploying staff item)',
    [...m.runaways.deploying_buildings].sort(compareCodeUnits),
    [...deploying].sort(compareCodeUnits),
  );
  const inter = new Set([
    ...d.entities.filter((e) => e.energy.priority === 'interruptible').map((e) => e.id),
    ...d.items.filter((i) => i.staff?.interruptible).map((i) => i.id),
  ]);
  same(
    'meta.heat.interruptible_power vs interruptible entities and staff items',
    [...m.heat.interruptible_power].sort(compareCodeUnits),
    [...inter].sort(compareCodeUnits),
  );
  const hall = ix.entities.get('research-hall');
  const tiers = (hall?.extra?.tiers as { kw?: number; speed?: number }[] | undefined) ?? [];
  if (hall && tiers[0]) {
    same('research-hall energy.kw vs extra.tiers[0].kw', hall.energy.kw, tiers[0].kw);
    same('research-hall crafting_speed vs extra.tiers[0].speed', hall.crafting_speed, tiers[0].speed);
  }
  same(
    'meta.quality.recycle_return vs verifier.extra.returns',
    m.quality.recycle_return,
    ix.entities.get('verifier')?.extra?.returns,
  );
  const unlock = new Map<string, string>();
  for (const { t, ef } of effects)
    if (ef.type === 'unlock-quality' && ef.quality !== undefined) unlock.set(ef.quality, t.id);
  // As Python's same(): a copy that is absent on either side is not compared.
  for (const q of m.quality.tiers)
    if (q.unlocked_by !== undefined || unlock.has(q.id))
      same(
        `meta.quality.tiers ${q.id} unlocked_by vs the unlock-quality effects`,
        q.unlocked_by,
        unlock.get(q.id),
      );
  const fr = ix.entities.get('fusion-reactor')?.extra ?? {};
  const fg = ix.entities.get('fusion-generator')?.extra ?? {};
  const [pmw, pps, gkw, gps] = [fr.plasma_mw, fr.plasma_per_s, fg.max_kw, fg.plasma_per_s];
  if (isNum(pmw) && pmw && isNum(pps) && pps && isNum(gkw) && gkw && isNum(gps) && gps)
    same(
      'plasma MJ per unit: fusion-reactor plasma_mw / plasma_per_s vs fusion-generator max_kw / 1000 / plasma_per_s',
      pmw / pps,
      gkw / 1000 / gps,
    );
}
