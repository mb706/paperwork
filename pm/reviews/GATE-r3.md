**Four findings are resolved. Input fencing now works, but its new system-action path introduces a Major defect; bump classification remains bypassable.**

1. **#1 — Resolved.** [slices.ts:257](/home/mewse/browsergame/game/test/golden/model/slices.ts:257) sorts members by `(section, key)` before serialization. The frozen collision vector contains reused rows, serials 3 and 3603, and a free row sharing shard 3. Its ordering and all 3,600 slice hashes reproduce. Existing scenario digests and lineage remain unchanged.

2. **#2 — Resolved.** The invalid belt direction, signal status, and new invalid inserter direction now draw their corresponding greybox base and shadow. All **65 cases**, manifest validation, KTX2 checks, and composition checks pass. The greybox sets are present and total. The atlas’s `prototypesHash` matches both current and golden prototypes. Version 7 changes only five external hashes and the version/ledger metadata; frozen expected outputs remain unchanged.

3. **#3 — Fencing resolved; new Major regression.** Stale starts, stops, and mining begins consume their sequences, emit `input_fenced`, and preserve action state. Overwriting the client’s generation during stamping correctly follows §15.3.

   However, [fake.ts:383](/home/mewse/browsergame/game/src/simworker/fake.ts:383) handles `player_left` only as an input release. It never marks the player offline; `player_joined` is ignored. Reproduced through the new `injectSystem()` path: after departure, `online=true`, `inputGen=1`; a subsequently stamped walking action advances x by **0.15**, with no refusal. This contradicts §15.3’s departure and presence rules. Implement complete leave/join handling and presence validation, with regression coverage.

4. **#4 — Unresolved, Minor.** Plain `--write` now preserves the manifest, closing the original regeneration bypass. But [main.ts:213](/home/mewse/browsergame/game/test/golden/build/main.ts:213) authenticates only its tables; classification also trusts the unauthenticated `schemaHash`.

   In memory, changing only `baseline.schemaHash` preserves ledger verification. With unchanged actual schema and a changed `digests.txt` hash, `bumpProblems(kind="mechanical", approval=null)` then returns **no problems**. The original baseline correctly rejects that same change. Bind every classification input, including `schemaHash`, to an immutable reviewed baseline and test this bypass.

5. **#5 — Resolved.** [README.md:72](/home/mewse/browsergame/game/test/golden/README.md:72) explicitly defines trace `out` files as envelope payloads, excluding the length prefix, and identifies wrapper validation as the shell’s responsibility. This matches the emitted bytes.

6. **#6 — Resolved.** [C2-sim.md:74](/home/mewse/browsergame/pm/wp/C2-sim.md:74) separately requires generated `ABI_VERSION` and `GEN_ABI_VERSION`. Generated TypeScript and Rust currently agree on **2** and **1**, respectively.

Validation: **466 golden files reproduce; 73 golden/fake tests pass**, with cleanup and caches disabled. Separate read-only probes reproduced both remaining defects. No files modified.

GATE: FAIL