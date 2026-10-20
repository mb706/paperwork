You are a senior reviewer of serialization formats, code generators and cross-language binary contracts. Review work package C1b of the browser game *Paperwork*: the machine-readable schema, the generator, and the codec fixtures. Together they are items 1–3 of the M0 "contract gate". The diff is `git diff 7022026..90df0c6`, mostly under `game/`.

Why this matters: after the gate, separate agents build the Rust sim, the TypeScript worker shell, the renderer, the UI and audio **in parallel, using only the schema, its README and the generated code**. Any ambiguity or bug here becomes an incompatibility between them.

Read:
- the brief `pm/wp/C1b-schema-generator.md`;
- the report `pm/reports/C1b.md`;
- `game/schema/README.md` and `game/schema/*.yaml`;
- the generator `game/scripts/schema-gen.ts` and its modules;
- the generated outputs in `game/crates/schema/`, `game/crates/sim/src/gen/` and `game/src/shared/gen/`;
- the fixtures in `game/test/fixtures/codec/`;
- the spec `design/spec/10-architecture.md` §15 (the M0 contracts) and §12 (the contract gate).

You may run read-only commands and the test suites (`npm run ci` in `game/` is fine). Do not modify any files.

Find, in priority order:
1. **Cross-language mismatches:** places where the generated Rust and TypeScript disagree on bytes, limits, defaults, or refusal behaviour, including any the fixtures do not cover. Try to construct a concrete input that one side accepts and the other refuses, or that the two decode differently.
2. **Decoder safety:** malformed, truncated, oversized or adversarial input that traps (panics), loops, over-allocates, or is misread instead of refused. Multiplayer clients will feed closures to the Rust decoder.
3. **Schema completeness against §15 and the gate list:** missing records, fields, registries or limits that a parallel package will need, and places where the README leaves an implementer guessing.
4. **`SCHEMA_HASH` and versioning:** layout changes that do not change the hash; drift that `--check` or `check-arch` would miss.
5. **Generator robustness:** nondeterminism, edge cases (empty lists, max-width enums, nested optional records, alignment), and readability of the generated code.

Output: a prioritized list of findings, at most 1,500 words. Tag each Critical, Major or Minor, and give the file and line, a concrete failing input or scenario, and a fix. End with a two-line verdict on whether gate items 1–3 can close.
