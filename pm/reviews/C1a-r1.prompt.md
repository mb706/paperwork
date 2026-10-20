You are a senior reviewer of build systems, compilers and deterministic data pipelines. Review work package C1a of the browser game *Paperwork*: the scaffold, toolchains, CI, architecture checks and the data stage. It is the diff `git diff 08e5559..4036076`, which is all under `game/`, plus small edits to `CLAUDE.md` and `tools/check-toolchain.sh`.

Read:
- the brief `pm/wp/C1a-scaffold-data.md`;
- the report `pm/reports/C1a.md`;
- the binding spec sections: `design/spec/10-architecture.md` §2 (stack, layout, commands, §2.4 the data stage and capability manifest, §2.5 code rules), §4.1 (determinism rules), §15.2 (the prototype data path: formats, the expression bytecode, the reference interpreters, the cross-check), and §12 (the M0 Schema row and the contract gate);
- `pm/DECISIONS-IMPL.md`.

You may run read-only commands, such as `git show`, `git diff`, reading files, and `npm run` scripts that only read. Do not modify any files.

Look for, in priority order:
1. **Correctness bugs** in the data stage:
   - wrong or missing validation;
   - expression compiler or bytecode errors and numeric edge cases (NaN, ±Inf, overflow, the `powi` limits, division by zero, integer conversion);
   - disagreement between the TypeScript and Rust interpreters that the cross-check would miss;
   - manifest closure errors;
   - nondeterminism in the outputs (D14): ordering, hashing, floats, locale.
2. **Spec deviations** that the report does not list: binary layouts in `prototypes.bin`, missing outputs, the capability manifest.
3. **Holes in the checks:** `check-arch` and the clippy bans. Can banned constructs slip through: aliasing imports, dynamic import, optional chaining on `Math`, `globalThis.Math`, re-exports? Are the generated-file header hashes robust?
4. **Fragility in the build and CI:** the cargo plugin, the release and feature gate, the watch mode. Also reproducibility from a clean clone, and the dev-loop speed.
5. **Maintainability problems** that will hurt later packages: module structure, naming, error messages, test quality and coverage of the important paths.

Output: a prioritized list of findings, at most 1,500 words. Tag each Critical, Major or Minor, and give the file and line, the problem, a concrete failure scenario, and a fix. End with a two-line verdict.
