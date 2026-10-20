// Assembles the Rust modules: every declaration in its home module (rust.ts), plus each module's extras
// (rust-extras.ts: the action pipeline, packets, the ABI, the Protos loader, sections …).

import type { Capabilities } from './capabilities.ts';
import { ERROR_KINDS, rustKind } from './error-kinds.ts';
import { rustFixtures } from './fixtures-rust.ts';
import type { Decl, Schema } from './model.ts';
import { emitDecl, homeMod, type RsMod, RsOut, rsUses, SCHEMA_MODS, SIM_MODS, simFile } from './rust.ts';
import { rustExtras } from './rust-extras.ts';

const MOD_DOC: Record<RsMod, string> = {
  types:
    'Shared scalars, ids, enums, flag sets and small records (schema/types.yaml; §15.1, §15.3, §4.2–§4.3).',
  actions:
    'Actions, batches and closures (schema/actions.yaml; §15.3): payloads, the decoder and encoder, the preflight.',
  events: 'Events (schema/events.yaml; §15.6): payloads and the EVENTS section records.',
  packet: 'The render packet (schema/packet.yaml; §15.4): header, directory, section records, the held set.',
  projections: 'Projections, subscriptions and queries (schema/projections.yaml; §15.5).',
  container: 'The save container and closure logs (schema/sections.yaml; §8.1, §8.5): framing and records.',
  abi: 'The WebAssembly ABI (schema/abi.yaml; §15.8, §15.9): exports, records, status codes.',
  protos: 'prototypes.bin (schema/protos.yaml; §15.2): the tables and the `Protos` loader.',
  registries:
    'Engine registries (schema/registries.yaml; §2.4): effects, triggers, achievement conditions, well-known names.',
  capabilities: 'The current capability manifest (game/data/engine/capabilities.yaml; §2.4), as code.',
  state: 'The saved state records (schema/state.yaml; §4.4–§4.5, §8.1).',
  pools: 'The entity table and the pools (schema/state.yaml; §4.5): SoA columns and their column tables.',
  sections: 'The save sections (schema/sections.yaml; §8.1, §4.8): section codecs and the digest shard map.',
  fixtures:
    'Decoding, re-encoding and dumping by type name, for the codec fixtures (test/fixtures/codec; §15.1). Tests only.',
};

/** The codec-fixture test's dispatch module (an integration test of the sim crate, so it may read files). */
export const RUST_FIXTURES_PATH = 'crates/sim/tests/codec_fixtures/generated.rs';

export interface RustFile {
  path: string;
  text: string;
}

function moduleText(o: RsOut, crate: 'schema' | 'sim' | 'test', body: string): string {
  const uses = rsUses(o, crate, body);
  return `//! ${MOD_DOC[o.mod]}
// Generated code favours one uniform shape per declaration over the shortest spelling of each case.
#![allow(
    clippy::collapsible_if,
    clippy::derivable_impls,
    clippy::enum_variant_names,
    clippy::explicit_auto_deref,
    clippy::identity_op,
    clippy::match_single_binding,
    clippy::needless_borrow,
    clippy::needless_range_loop,
    clippy::too_many_lines
)]

${uses}

${body}`;
}

export function emitRustFiles(s: Schema, caps: Capabilities, hashHex: string): RustFile[] {
  const outs = new Map<RsMod, RsOut>();
  for (const m of [...SCHEMA_MODS, ...SIM_MODS, 'fixtures' as const]) outs.set(m, new RsOut(s, m));
  for (const name of s.names) {
    const d = s.decls.get(name) as Decl;
    emitDecl(outs.get(homeMod(d)) as RsOut, d);
  }
  rustExtras(s, caps, outs);
  rustFixtures(s, outs.get('fixtures') as RsOut);
  const files: RustFile[] = [];
  const hashBytes = (hashHex.match(/../g) ?? []).map((b) => `0x${b}`).join(', ');
  const v = s.versions;
  files.push({
    path: 'crates/schema/src/lib.rs',
    text: `//! The schema crate (10 §15.1): generated from \`game/schema/\` by \`scripts/schema-gen.ts\`. Ids, enums,
//! shared records (\`ChunkData\`), codecs, the packet, event and projection writers, the action decoder with
//! its preflight, the ABI records and the \`Protos\` loader. Every crate below uses it; it depends on nothing.
//! game/schema/README.md explains how to change it.
#![forbid(unsafe_code)]

pub mod codec;
${SCHEMA_MODS.map((m) => `pub mod ${m};`).join('\n')}

${SCHEMA_MODS.map((m) => `pub use ${m}::*;`).join('\n')}

/// SHA-256 of the schema's resolved layouts (10 §15.1, B1-r1 3): src/shared/gen/layout.txt.
pub const SCHEMA_HASH: [u8; 32] = [${hashBytes}];
/// SCHEMA_HASH in lowercase hexadecimal.
pub const SCHEMA_HASH_HEX: &str = "${hashHex}";
/// Raised with every change to a save section's layout (schema/types.yaml).
pub const SCHEMA_VERSION: u16 = ${v.schema};
/// ACTION_SCHEMA_VERSION: every batch header carries it (schema/actions.yaml).
pub const ACTION_SCHEMA_VERSION: u8 = ${v.action};
/// PACKET_VERSION: every packet header carries it (schema/packet.yaml).
pub const PACKET_VERSION: u16 = ${v.packet};
/// sim_abi_version() (schema/abi.yaml).
pub const ABI_VERSION: u32 = ${v.abi};
/// gen_abi_version() (schema/abi.yaml).
pub const GEN_ABI_VERSION: u32 = ${v.genAbi};
/// PROTOCOL_VERSION of the worker and wire protocols (schema/abi.yaml; §3.2, 11 §3.2).
pub const PROTOCOL_VERSION: u32 = ${v.protocol};
`,
  });
  files.push({ path: 'crates/schema/src/codec.rs', text: rustRuntime() });
  for (const m of SCHEMA_MODS) {
    const o = outs.get(m) as RsOut;
    files.push({ path: `crates/schema/src/${m}.rs`, text: moduleText(o, 'schema', o.parts.join('\n')) });
  }
  files.push({
    path: 'crates/sim/src/gen/mod.rs',
    text: `//! Generated from \`game/schema/state.yaml\` and \`sections.yaml\` (10 §15.1): the pools, the state
//! records and the save sections, which only the sim uses. Behaviour lives in hand-written code on them.

${SIM_MODS.map((m) => `pub mod ${simFile(m)};`).join('\n')}

${SIM_MODS.map((m) => `pub use ${m}::*;`).join('\n')}
`,
  });
  for (const m of SIM_MODS) {
    const o = outs.get(m) as RsOut;
    files.push({
      path: `crates/sim/src/gen/${simFile(m)}.rs`,
      text: moduleText(o, 'sim', o.parts.join('\n')),
    });
  }
  const fx = outs.get('fixtures') as RsOut;
  files.push({ path: RUST_FIXTURES_PATH, text: moduleText(fx, 'test', fx.parts.join('\n')) });
  return files;
}

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), 'templates');

export function rustRuntime(): string {
  return readFileSync(join(TEMPLATES, 'codec.rs.txt'), 'utf8')
    .replace(
      '@@ERROR_KIND_VARIANTS@@',
      ERROR_KINDS.map(([n, doc]) => `    /// ${doc}\n    ${rustKind(n)},`).join('\n'),
    )
    .replace(
      '@@ERROR_KIND_NAMES@@',
      ERROR_KINDS.map(([n]) => `            Self::${rustKind(n)} => "${n}",`).join('\n'),
    );
}
