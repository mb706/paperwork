// What the event map needs of the prototypes (10 §15.6; C9): a footprint's larger side (the build sound by size), and
// what `entity_mined` names (always an entity prototype: a resource unit mined by hand emits none, the golden model's
// rule 23); developer fail reasons play nothing. From the page's prototypes.json.
import type { PrototypesJson } from '../../shared/gen/protos.ts';
import { FailReasonCodec } from '../../shared/gen/types.ts';
import type { ProtoInfo } from './types.ts';

/** Each entity prototype's footprint, its larger side in tiles (at least 1). */
export function entitySizes(protos: Pick<PrototypesJson, 'entity'>): number[] {
  return protos.entity.map((e) => Math.max(1, ...((e as { size?: number[] }).size ?? [1])));
}

export function protoInfoOf(protos: Pick<PrototypesJson, 'entity'>): ProtoInfo {
  const size = entitySizes(protos);
  return {
    entitySize: (p) => size[p] ?? 1,
    minedKind: () => 'entity',
    isDeveloperReason: FailReasonCodec.isDeveloper,
  };
}
