# game/schema/: the schema (10 §15.1)

The one description of every value that crosses the Rust/TypeScript boundary, every saved field and every
wire record: `types.yaml`, `state.yaml`, `sections.yaml`, `actions.yaml`, `events.yaml`,
`projections.yaml`, `packet.yaml`, `protos.yaml`, `abi.yaml` and `registries.yaml`.

Work package C1b writes these files and `scripts/schema-gen.ts`, which turns them into
`crates/schema/src/`, `crates/sim/src/gen/` and `src/shared/gen/`. Until then the directory holds no
YAML and the generator stub writes the empty schema's outputs (`npm run gen`).
