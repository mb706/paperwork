// game/schema/README.md's TypeScript examples ("Using the generated code"), run as written (C1b-r1 finding
// 10): the guide may only advertise API that exists.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { actionBytes, decodeAction } from '../../src/shared/gen/actions.ts';
import { DecodeError } from '../../src/shared/gen/codec.ts';
import { decodePacket, EntityViewCodec } from '../../src/shared/gen/packet.ts';
import { BuildMode, Direction } from '../../src/shared/gen/types.ts';
import { GAME } from '../helpers/paths.ts';

describe("the README's examples", () => {
  it('run as written', () => {
    const bytes = readFileSync(join(GAME, 'test', 'fixtures', 'codec', 'golden', 'packet.bin'));
    // From README.md:
    const build = actionBytes({
      type: 'build',
      item: 2 << 3,
      pos: { x2: 4, y2: 6 },
      dir: Direction.east,
      flip: false,
      mode: BuildMode.normal,
      flags: 0,
      drag_id: 0,
    }); // u16 type, u16 len, payload
    const view = EntityViewCodec.decode(EntityViewCodec.encode(EntityViewCodec.defaults()));
    const packet = decodePacket(bytes); // header, directory and sections, all checked; throws DecodeError
    // Their results:
    expect(decodeAction(20, build.subarray(4))).toMatchObject({ type: 'build', dir: Direction.east });
    expect(view).toEqual(EntityViewCodec.defaults());
    expect(packet.sections).toHaveLength(5);
    expect(() => EntityViewCodec.decode(new Uint8Array(EntityViewCodec.SIZE + 1))).toThrow(DecodeError);
  });

  it('are the ones in the README', () => {
    const readme = readFileSync(join(GAME, 'schema', 'README.md'), 'utf8');
    const test = readFileSync(join(GAME, 'test', 'codec', 'readme.test.ts'), 'utf8');
    const block = /```ts\n([\s\S]*?)```/.exec(readme)?.[1] ?? '';
    // Statement by statement, whitespace and comments aside (Biome formats this file, not the README).
    const bare = (t: string) =>
      t
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\s+/g, '')
        .replace(/,([}\])])/g, '$1');
    for (const stmt of bare(block)
      .split(';')
      .filter((x) => x !== ''))
      expect(bare(test)).toContain(stmt);
  });
});
