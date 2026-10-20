// A state for the slice serialization's ordering (README rule 41; GATE-r2 finding 1): entity-table and pool rows
// reused out of serial order, serials that collide in a shard, and free rows in the same shard. Built from the
// golden start world through the World's own allocator, so the state is canonical.
import { readSaveContainer } from '../../../src/shared/gen/container.ts';
import { insert } from '../model/inventory.ts';
import type { Protos } from '../model/protos.ts';
import { World } from '../model/world.ts';

/**
 * Rows after it: 0 = serial 3603 (a chest built into the row chest A left), 1 = serial 3 (chest B), 2 = serial 3601,
 * 3 = free (serial 3602 was mined). Serials 3 and 3603 share shard 3 with free row 3; row order puts 3603 first,
 * key order puts 3 first. The slot heap's blocks are reused the same way.
 */
export function collisionWorld(protos: Protos, startSave: Uint8Array): World {
  const w = World.load(protos, readSaveContainer(startSave).frames);
  w.globals.next_serial = 3601;
  const proto = protos.id('entity', 'iron-chest');
  const slots = (protos.entity[proto] as { inventory_slots: number }).inventory_slots;
  const chest = (tx: number, ty: number) =>
    w.allocEntity(
      {
        proto,
        kind: 1,
        surface: 0,
        dir: 0,
        flip: 0,
        quality: 0,
        built_by: 16,
        x2: 2 * tx + 1,
        y2: 2 * ty + 1,
        flags: 0,
        serial: w.nextSerial(),
        built_tick: 0,
      },
      slots,
    );
  chest(30, 4); // serial 3601, row 2
  const gone = chest(31, 4); // serial 3602, row 3
  w.freeEntity(gone);
  w.freeEntity(w.entityBySerial(2) as NonNullable<ReturnType<World['entityBySerial']>>);
  const late = chest(32, 4); // serial 3603, row 0 (the lowest free row)
  const ore = protos.id('item', 'iron-ore') * 8;
  insert(w, { ref: w.container(late).inv, size: slots, bar: slots, origin: -1 }, ore, 7);
  return w;
}
