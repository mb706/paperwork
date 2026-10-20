// Formulas that are not expressions (10 §2.4 step 4): T(W)'s clamp, j(W)'s breakpoints, the leak's
// selection rule. They live in Rust, parameterised by their block's numbers; the block's `formula_ref`
// cites the chapter section that states the rule ("01 §8.1"), and the implementation carries the same
// citation as a `// @formula 01 §8.1` comment. The stage fails when a formula reference the capability
// manifest implements has no tagged implementation under crates/.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CapabilityManifest } from './capabilities.ts';
import type { Diagnostics } from './diagnostics.ts';
import type { Meta } from './schema/meta.ts';
import { at, type SourceFile } from './sources.ts';

/** The leading "NN §X.Y" of a formula reference, or null. */
export function leadingRef(ref: string): string | null {
  return /^\d{2} §\d+(?:\.\d+)*/.exec(ref.trim())?.[0] ?? null;
}

/** Every formula_ref in meta.yaml, by its leading "NN §X.Y". */
export function dataFormulaRefs(meta: Meta): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'formula_ref' && typeof x === 'string') {
          const r = leadingRef(x);
          if (r) out.add(r);
        } else walk(x);
      }
    }
  };
  walk(meta);
  return out;
}

/** The `// @formula NN §X.Y` tags under a directory of Rust sources. */
export function taggedFormulas(cratesDir: string): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.rs'))
        for (const m of readFileSync(p, 'utf8').matchAll(/\/\/\s*@formula\s+(\d{2} §\d+(?:\.\d+)*)/g))
          out.add(m[1] as string);
    }
  };
  walk(cratesDir);
  return out;
}

export function checkFormulaRefs(
  cap: CapabilityManifest,
  meta: Meta,
  cratesDir: string,
  diags: Diagnostics,
  src: SourceFile,
): void {
  const used = dataFormulaRefs(meta);
  const tagged = taggedFormulas(cratesDir);
  cap.registries.formula_refs.forEach((ref, k) => {
    const path = ['manifests', cap.name, 'registries', 'formula_refs', k];
    const r = leadingRef(ref);
    if (!r) diags.error(`${ref} is not a formula reference "NN §X.Y"`, at(src, path));
    else if (!used.has(r)) diags.error(`no block in meta.yaml cites ${r}`, at(src, path));
    else if (!tagged.has(r))
      diags.error(`${r} has no implementation tagged \`// @formula ${r}\` under crates/`, at(src, path));
  });
}
