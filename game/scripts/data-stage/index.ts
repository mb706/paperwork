// The data stage (10 §2.4): design/spec/data/*.yaml + game/data/engine/*.yaml → prototypes.bin,
// prototypes.json, build-manifest.json, src/shared/gen/proto-ids.ts and the expression cross-check
// fixture. A pure function of its input files: identical inputs give byte-identical outputs (D14).
//
//   1. load and validate every design kind against its schema (schema/), references (refs.ts);
//   2. compile and check every formula (formulas.ts, expr.ts);
//   3. load the engine overlay (overlay.ts) and the milestone filters, and check every filter's closure
//      (manifests.ts, R17);
//   4. take the build's prototypes from the current capability manifest, or from a build filter
//      (capabilities.ts), and check that they close;
//   5. assign dense ids (model.ts) and emit (emit/).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { devManifest, manifestText } from '../build-manifest.ts';
import { fromHex, sha256Bytes, toHex } from '../lib/hash.ts';
import {
  type BuildSet,
  capabilityBuild,
  checkManifestNames,
  checkReadsCarried,
  filterBuild,
  filterCapabilityBuild,
  loadCapabilities,
} from './capabilities.ts';
import { Diagnostics } from './diagnostics.ts';
import { contentsRecord } from './emit/contents.ts';
import { exprFixture, loadEdgeCases } from './emit/expr-fixture.ts';
import { protoIdsTs } from './emit/proto-ids.ts';
import { type EmitProblem, type TableSummary, writePrototypesBin } from './emit/protos-bin.ts';
import { prototypesJson } from './emit/protos-json.ts';
import { checkEngine } from './engine.ts';
import { checkFormulaRefs } from './formula-refs.ts';
import { compileFormulas } from './formulas.ts';
import {
  type BuildFilter,
  checkAgainstSpec,
  closure,
  loadManifests,
  loadSlice,
  selectTechnologies,
  sliceFilter,
  summary,
} from './manifests.ts';
import { buildModel, CHARACTER, type Model } from './model.ts';
import { OUTPUT_PATHS } from './outputs.ts';
import { loadOverlay, type OverlaySources } from './overlay.ts';
import { checkReferences, indexDesign } from './refs.ts';
import { checkRegistries } from './registries.ts';
import { type DesignData, FILE_KINDS, type FileKind, validateDesign } from './schema/index.ts';
import { at, loadYaml, type SourceFile } from './sources.ts';

export interface DataStageOptions {
  /** The game/ directory. */
  gameDir: string;
  /** The design spec directory (design/spec). */
  specDir: string;
  /** Build a milestone filter (`m1` … `m5`) instead of the current capability manifest. */
  manifest?: string;
  /**
   * Report engine-overlay gaps as warnings instead of errors (for `--manifest` builds of prototypes that
   * no milestone's engine supports yet).
   */
  allowIncomplete?: boolean;
  /** The schema's hash and protocol version (the generated src/shared/gen/schema.ts). */
  schemaHash: string;
  protocolVersion: number;
  /** Also emit these build filters in memory (a smoke test of the writers over the full data). */
  extraBuilds?: readonly string[];
  /**
   * Engine overlay files to read from elsewhere, by name (`sounds.yaml` → an absolute path): fixture builds,
   * such as the fake sim's (10 §15.10), whose tables must be complete before the owning package adds its file.
   * A file that exists in game/data/engine wins over its override.
   */
  engineFiles?: Readonly<Record<string, string>>;
}

export interface DataStageResult {
  diagnostics: Diagnostics;
  /** Output files, by path relative to game/. Empty when there are errors. */
  outputs: Map<string, Uint8Array>;
  /** Lines worth printing: the manifests' closure summaries and the build's tables. */
  report: string[];
  build: BuildSet | null;
  tables: TableSummary[];
  filters: BuildFilter[];
  prototypesHash: string | null;
  /** The build's prototypes with their resolved engine fields (D1: tests and tools read them). */
  model: Model | null;
  /** The extra builds' prototypes.bin sizes and hashes. */
  extra: { name: string; bytes: number; hash: string; jsonBytes: number }[];
}

export { OUTPUT_PATHS } from './outputs.ts';

const enc = new TextEncoder();

const KIND_FILE: Record<EmitProblem['kind'], FileKind | null> = {
  item: 'items',
  fluid: 'items',
  recipe: 'recipes',
  entity: 'entities',
  technology: 'technologies',
  resource: 'resources',
  tile: 'tiles',
  world: 'world',
  signal: null,
};

/** The writer's refusals as diagnostics at the YAML field they come from (C1a-r1 finding 1). */
function reportProblems(problems: readonly EmitProblem[], design: DesignData, diags: Diagnostics): void {
  for (const p of problems) {
    const file = KIND_FILE[p.kind];
    if (file && p.filePos >= 0) diags.error(p.message, at(design.sources[file], [p.filePos, ...p.path]));
    else if (p.id === CHARACTER)
      diags.error(`the character: ${p.message}`, { file: 'game/data/engine/prototypes.yaml' });
    else diags.error(`${p.kind} ${p.id}: ${p.message}`);
  }
}

/**
 * 10 §2.4 step 4: per machine that takes modules, the build's recipes in its categories that a
 * productivity module would block (allow_productivity is false; DECISIONS §30).
 */
export function productivityReport(m: ReturnType<typeof buildModel>): string[] {
  const out: string[] = [];
  for (const e of m.entities) {
    if (!e.data.module_slots || !e.data.categories) continue;
    const cats = new Set(e.data.categories);
    const blocked = m.recipes
      .filter((r) => cats.has(r.data.category) && !r.data.allow_productivity)
      .map((r) => r.id);
    if (blocked.length > 0) out.push(`  productivity blocked in ${e.id}: ${blocked.join(', ')}`);
  }
  return out;
}

export function runDataStage(o: DataStageOptions): DataStageResult {
  const diags = new Diagnostics();
  const report: string[] = [];
  const result: DataStageResult = {
    diagnostics: diags,
    outputs: new Map(),
    report,
    build: null,
    tables: [],
    filters: [],
    prototypesHash: null,
    model: null,
    extra: [],
  };
  const repo = join(o.gameDir, '..');
  const rel = (p: string) => (p.startsWith(`${repo}/`) ? p.slice(repo.length + 1) : p);

  // 1. Design data.
  const sources = {} as Record<FileKind, SourceFile>;
  for (const k of FILE_KINDS) {
    const abs = join(o.specDir, 'data', `${k}.yaml`);
    const src = loadYaml(abs, rel(abs), diags);
    if (src) sources[k] = src;
  }
  if (diags.errors.length > 0) return result;
  const design = validateDesign(sources, diags);
  if (!design) return result;
  const ix = indexDesign(design);
  checkReferences(design, ix, diags);
  checkRegistries(design, diags);
  if (diags.errors.length > 0) return result;

  // 2. Formulas.
  const formulas = compileFormulas(design, diags);

  // 3. Overlay and milestone filters.
  const engine = (name: string) => {
    const abs = join(o.gameDir, 'data', 'engine', name);
    return loadYaml(abs, rel(abs), diags);
  };
  /** An optional engine file: game/data/engine's, else the caller's override, else none. */
  const optionalEngine = (name: string) => {
    const own = join(o.gameDir, 'data', 'engine', name);
    const abs = existsSync(own) ? own : o.engineFiles?.[name];
    return abs && existsSync(abs) ? loadYaml(abs, rel(abs), diags) : null;
  };
  const ovSrc = {
    groups: engine('groups.yaml'),
    defaults: engine('defaults.yaml'),
    mirrors: engine('mirrors.yaml'),
    prototypes: engine('prototypes.yaml'),
    sets: engine('sets.yaml'),
    terrain: engine('terrain.yaml'),
    sounds: optionalEngine('sounds.yaml'),
  };
  const manifestsSrc = engine('manifests.yaml');
  const capsSrc = engine('capabilities.yaml');
  if (
    !ovSrc.groups ||
    !ovSrc.defaults ||
    !ovSrc.mirrors ||
    !ovSrc.prototypes ||
    !ovSrc.sets ||
    !ovSrc.terrain ||
    !manifestsSrc ||
    !capsSrc
  )
    return result;
  const overlay = loadOverlay(ovSrc as OverlaySources, diags);
  const manifests = loadManifests(manifestsSrc, diags);
  if (!overlay || !manifests) return result;
  checkAgainstSpec(manifests, o.specDir, diags);
  const filters: BuildFilter[] = [];
  for (const [name, m] of Object.entries(manifests.manifests)) {
    if ('from' in m) {
      const slice = loadSlice(o.specDir, diags);
      if (slice) filters.push({ ...sliceFilter(slice.block, design, ix, diags, slice.src), name });
    } else filters.push(closure(name, selectTechnologies(m, manifests.wild_roots, design, ix), design, ix));
  }
  for (const f of filters) {
    report.push(summary(f));
    for (const p of f.problems) diags.error(`${f.name}: ${p}`, { file: 'game/data/engine/manifests.yaml' });
    if (f.inert.length > 0) report.push(`    inert until its setting exists: ${f.inert.join('; ')}`);
  }
  result.filters = filters;

  // 4. The build's prototypes. Every capability manifest's names are checked, the current one's build made.
  const caps = loadCapabilities(capsSrc, diags);
  if (!caps) return result;
  for (const m of caps.manifests) checkManifestNames(m, capsSrc, diags);
  const cap = caps.current;
  const filterNamed = (n: string, where: string): BuildFilter | null => {
    const f = filters.find((x) => x.name === n);
    if (!f)
      diags.error(`no build filter named ${n} (have: ${filters.map((x) => x.name).join(', ')})`, {
        file: where,
      });
    return f ?? null;
  };
  let build: BuildSet;
  if (o.manifest) {
    const f = filterNamed(o.manifest, 'game/data/engine/manifests.yaml');
    if (!f) return result;
    build = filterBuild(f, design, ix);
  } else {
    if (cap.filter) {
      const f = filterNamed(cap.filter, 'game/data/engine/capabilities.yaml');
      if (!f) return result;
      build = filterCapabilityBuild(cap, f, design, ix, diags, capsSrc, true);
    } else build = capabilityBuild(cap, design, ix, diags, capsSrc);
    checkReadsCarried(cap, capsSrc, diags);
    checkFormulaRefs(cap, design.meta, join(o.gameDir, 'crates'), diags, capsSrc);
    // The other manifests (D1): the prototypes they will support must have a complete engine overlay now, so a
    // milestone's packages can build against them (strict: a gap is an error). Nothing is emitted for them.
    for (const m of caps.manifests) {
      if (m === cap || !m.filter) continue;
      const f = filterNamed(m.filter, 'game/data/engine/capabilities.yaml');
      if (!f) continue;
      const set = filterCapabilityBuild(m, f, design, ix, diags, capsSrc, false);
      checkEngine(buildModel(set, design, ix, overlay, formulas, diags, true), diags, true);
    }
  }
  result.build = build;
  if (diags.errors.length > 0) return result;

  // 5. Ids and outputs.
  const model = buildModel(build, design, ix, overlay, formulas, diags, !o.allowIncomplete);
  checkEngine(model, diags, !o.allowIncomplete);
  result.model = model;
  if (diags.errors.length > 0) return result;
  const schemaHash = fromHex(o.schemaHash);
  const bin = writePrototypesBin(model, schemaHash);
  reportProblems(bin.problems, design, diags);
  if (diags.errors.length > 0) return result;
  const prototypesHash = toHex(sha256Bytes(bin.bytes));
  result.prototypesHash = prototypesHash;
  result.tables = bin.tables;
  if (o.manifest) report.push(...productivityReport(model));
  report.push(
    `build ${build.name}: ${model.items.length} items, ${model.fluids.length} fluids, ${model.recipes.length} recipes, ` +
      `${model.entities.length} entities, ${model.technologies.length} technologies, ${model.resources.length} resources, ` +
      `${model.tiles.length} tiles, ${model.world.length} world objects; prototypes.bin ${bin.bytes.length} bytes, sha256 ${prototypesHash.slice(0, 16)}…`,
  );
  if (o.manifest)
    report.push(
      `  ${build.name}'s prototypes.bin omits ${contentsRecord().omitted.length} parts of the design data (its META contents record lists them): an engine must refuse a build that lacks what it reads`,
    );
  const out = result.outputs;
  out.set(OUTPUT_PATHS.bin, bin.bytes);
  try {
    out.set(OUTPUT_PATHS.json, enc.encode(prototypesJson(model, o.schemaHash, prototypesHash)));
  } catch (e) {
    diags.error(`prototypes.json: ${(e as Error).message}`);
    out.clear();
    return result;
  }
  out.set(
    OUTPUT_PATHS.manifest,
    enc.encode(
      manifestText(
        devManifest({
          modules: {},
          prototypesHash,
          schemaHash: o.schemaHash,
          protocolVersion: o.protocolVersion,
          build: build.name,
          contents: contentsRecord(),
        }),
      ),
    ),
  );
  if (!o.manifest) {
    out.set(OUTPUT_PATHS.protosFixture, bin.bytes);
    out.set(OUTPUT_PATHS.protoIds, enc.encode(protoIdsTs(design)));
    const edges = loadEdgeCases(
      join(o.gameDir, 'test', 'fixtures', 'expr', 'edge-cases.yaml'),
      'game/test/fixtures/expr/edge-cases.yaml',
      diags,
    );
    out.set(OUTPUT_PATHS.exprFixture, enc.encode(exprFixture(formulas, edges)));
  }
  for (const name of o.extraBuilds ?? []) {
    const f = filters.find((x) => x.name === name);
    if (!f) {
      diags.error(`no build filter named ${name}`);
      continue;
    }
    const scratch = new Diagnostics();
    const m = buildModel(filterBuild(f, design, ix), design, ix, overlay, formulas, scratch, false);
    for (const d of scratch.errors) diags.add(d);
    if (scratch.errors.length > 0) continue;
    const b = writePrototypesBin(m, schemaHash);
    reportProblems(b.problems, design, diags);
    if (b.problems.length > 0) continue;
    const h = toHex(sha256Bytes(b.bytes));
    const j = prototypesJson(m, o.schemaHash, h);
    result.extra.push({ name, bytes: b.bytes.length, hash: h, jsonBytes: enc.encode(j).length });
  }
  if (diags.errors.length > 0) out.clear();
  return result;
}
