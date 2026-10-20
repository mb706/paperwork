# C1a: M0 scaffold, toolchains, CI and the data stage

**Owner:** one Opus agent, working in the main tree on branch `dev`.
- **You may commit** to `dev` at meaningful milestones: small, coherent commits with clear messages, each ending with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, rebase or rewrite history. Other agents are editing `design/**` in the same working tree right now, so stage only your own paths (`git add game CLAUDE.md tools/check-toolchain.sh pm/reports/C1a.md`) and never use `git add -A` or `git commit -a`.
- **Writes to:** `game/**`; `CLAUDE.md` (the commands and how to run things); `tools/check-toolchain.sh` (new checks); `pm/reports/C1a.md`.
- **Must not touch:** `design/**`. If the spec is wrong, report it; the manager routes spec changes.

## Context

This is the first coding package of the project. M0's **Schema** package (10 §12, the first row of its table, and "The contract gate") is the executable contract of the whole engine, and no other M0 package starts until its gate passes. It is too big for one session, so the manager has split it into three sequential packages:
- **C1a (this one):** the repository, the pinned toolchains, the build, CI and architecture checks, and the **data stage**;
- **C1b:** the schema and the generator, with codec fixtures;
- **C1c:** the fake sim, the reference model, and the M0 golden integration set.

Build C1a so that C1b and C1c slot in cleanly. Leave clearly named empty places, such as `game/schema/` and `scripts/schema-gen.ts` stubs, rather than guessing their contents.

## Read

- `CLAUDE.md`, `pm/README.md`, `pm/DECISIONS-IMPL.md`.
- `design/spec/10-architecture.md`:
  - "Changes in v2" (skim);
  - §0;
  - **§2 in full**: versions and pins, the repository layout, commands, **the data stage §2.4** (including the M0 capability manifest), and the code rules §2.5;
  - §4.1, the determinism rules, the parts that check-arch and clippy enforce;
  - §12, the M0 scope, the Schema row and the contract gate;
  - **§15.2**, the prototype data path: formats, the expression bytecode, the reference interpreter, the cross-check;
  - §15.11, ownership.
- `design/spec/data/SCHEMA.md` and the YAML in `design/spec/data/`: the data you compile.
- The existing Python validator `tools/validate_spec.py`. The TypeScript data stage must agree with it wherever they overlap, and must not replace it.
- `design/round2/A-stack-test/`: the pinned, tested npm package set and its lockfile.
- `design/engine-study/rust/`: `rust-toolchain.toml`, `clippy.toml` (with determinism bans proven to fire), `build-wasm.sh`. Reuse what is proven there.

## Deliver

1. **The repository skeleton (§2.2).**
   - The npm package with exactly the pinned versions, using `npm ci` from a committed lockfile.
   - The Cargo workspace with a skeleton for every crate in §2.2. They compile; their contents come later.
   - The per-layer tsconfigs, Biome, Vitest and the Playwright config, with one smoke test that loads the dev page in Chrome for Testing.
2. **The build.**
   - Vite with the cargo plugin: the dev profile in the dev loop and release for builds, plus `wasm-opt`.
   - **The WebAssembly feature gate**: release modules must not use features outside the allowed set (§2.1, §2.3).
   - A placeholder main page whose title is "Paperwork". It is not the menu, which belongs to the UI package.
3. **The checks.**
   - `check-arch` with oxc-parser:
     - the import boundaries of §2.2;
     - the TypeScript determinism bans in shared and worker code (§2.5 and §4.1);
     - the generated-file header hashes, so hand edits are refused.
   - `clippy.toml` with the determinism bans, verified to fire.
   - `rustfmt.toml`.
4. **The commands (§2.3).** Every `npm run` script the spec defines that makes sense now.
   - **`npm run ci`** runs everything and is green: lint, format check, typecheck per layer, Vitest, `cargo test`, `cargo clippy -D warnings`, `check-arch`, the data stage and its checks, and the feature gate.
   - Do **not** install a git pre-commit hook. That is the manager's decision; commits happen often, and the hook would slow them down.
5. **The data stage (§2.4, §15.2).**
   - Parse and validate every kind in `design/spec/data`, tiles, world objects and text included, against its schema.
   - The engine overlay YAML in `game/data/engine/`, including `manifests.yaml` with the milestone filters of §12.
   - **The closure check for every milestone manifest** (R17). Its counts must agree with `design/round4/arch-data/manifests.py`.
   - **The M0 capability manifest.**
   - **The expression compiler:** formula fields compiled to the bytecode of §15.2, with the TypeScript reference interpreter. Test it against golden values and the Python validator's evaluation wherever both exist, including the numeric edge cases §15.2 defines.
   - The outputs `prototypes.bin`, `prototypes.json` and `build-manifest.json`, for the M0 manifest at least. If cheap, emit them for any manifest.
   - **Determinism:** run the stage twice; it must give byte-identical output (D14).

   The binary layouts of `prototypes.bin` are part of the contract.
   - Implement them exactly as §15.2 specifies.
   - Where the spec leaves a layout detail open, implement the simplest choice and **list it** in your report. C1b moves those layouts into the machine-readable schema.
6. **Rust side of the data path.** A `Protos::load` skeleton (in `crates/schema` or wherever §15.2 puts it), if it belongs to this package per §15.11. If it needs the generator, leave it for C1b and say so.
7. **Docs.** Update CLAUDE.md with how to install, build, run, test and check, and where things live. Keep it short; CLAUDE.md is read by every agent.

## Quality bar

- This is the foundation for about 150k lines of later code. Favour clarity, small modules, good names and fast feedback loops.
  - Keep the dev loop quick on this old host. Measure `npm run ci` and the incremental rebuild times, and report them.
  - Error messages from the data stage must point at the YAML file and path.
- Pin CPU-heavy jobs with `taskset -c 0-15` when other agents are running. Check with `uptime`.
- **When done:** `npm run ci` is green from a clean clone (`git clone` into a temporary directory, `npm ci`, `npm run ci`), and the report lists the timings.

## Report

`pm/reports/C1a.md`, using the template. Include the layout and format choices left for C1b, and every deviation from the spec. Your final message is at most 200 words.
