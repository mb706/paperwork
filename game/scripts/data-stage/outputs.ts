// The data stage's output files, relative to game/ (a module of its own so check-arch can read the
// generated-file inventory without loading the stage).
export const OUTPUT_PATHS = {
  bin: 'public/data/prototypes.bin',
  json: 'public/data/prototypes.json',
  manifest: 'public/data/build-manifest.json',
  protoIds: 'src/shared/gen/proto-ids.ts',
  exprFixture: 'test/fixtures/expr/cases.txt',
  /** The M0 build's prototypes.bin, committed for the Rust loader's test (crates/schema/tests/protos_load.rs). */
  protosFixture: 'test/fixtures/protos/m0.bin',
} as const;
