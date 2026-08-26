import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UNIT } from '../sim/unitTypes.js';
import {
  AIR_PASSENGER_DROP,
  blenderDupIndex,
  gltfNodeToLiteSeat,
  gltfTrsToWorldMatrix,
  posePassengerOnTransport,
  seatLocalToWorld,
  seatsForUnitType,
  spawnSeatsFromSockets,
  yawPitchRollFromWorldMatrix,
} from './transportSeats.js';

describe('transportSeats', () => {
  it('sorts Blender spawn_anchor duplicates and ignores FX empties', () => {
    const seats = spawnSeatsFromSockets([
      { name: 'particle_anchor', x: 9, y: 9, z: 9 },
      { name: 'spawn_anchor.002', x: 2, y: 0, z: 0 },
      { name: 'spawn_anchor', x: 0, y: 1, z: 0 },
      { name: 'spawn_anchor.001', x: 1, y: 0, z: 0 },
    ]);
    assert.deepEqual(seats.map((s) => s.name), [
      'spawn_anchor',
      'spawn_anchor.001',
      'spawn_anchor.002',
    ]);
    assert.equal(blenderDupIndex('spawn_anchor'), 0);
    assert.equal(blenderDupIndex('spawn_anchor.010'), 10);
  });

  it('mirrors glTF empties into Lite bake space (X flip, yaw negate)', () => {
    const theta = 0.4;
    const qy = Math.sin(theta / 2);
    const qw = Math.cos(theta / 2);
    const seat = gltfNodeToLiteSeat('spawn_anchor', [2, 3, 4], [0, qy, 0, qw]);
    assert.ok(Math.abs(seat.x - -2) < 1e-9);
    assert.ok(Math.abs(seat.y - 3) < 1e-9);
    assert.ok(Math.abs(seat.z - 4) < 1e-9);
    assert.ok(Math.abs(seat.yaw - -theta) < 1e-6);
    assert.ok(Math.abs(seat.pitch) < 1e-6);
    assert.ok(Math.abs(seat.roll) < 1e-6);
  });

  it('extracts identity rotation from an identity matrix', () => {
    const ypr = yawPitchRollFromWorldMatrix(gltfTrsToWorldMatrix([1, 2, 3], [0, 0, 0, 1]));
    assert.equal(ypr.yaw, 0);
    assert.equal(ypr.pitch, 0);
    assert.equal(ypr.roll, 0);
  });

  it('rotates seat XZ with the same yaw as building / unit instances', () => {
    const p = seatLocalToWorld(10, 20, Math.PI / 2, 1, 0);
    assert.ok(Math.abs(p.x - 10) < 1e-9);
    assert.ok(Math.abs(p.z - 19) < 1e-9);
  });

  it('poses a rider on an authored seat (position + suggested rotation)', () => {
    const posed = posePassengerOnTransport({
      tx: 8,
      tz: 4,
      vehicleYaw: 0.5,
      vehicleLoft: 16,
      seats: [{ x: 1, y: -0.25, z: 2, yaw: -0.3, pitch: 0.1, roll: -0.05 }],
      slot: 0,
      total: 1,
    });
    const expect = seatLocalToWorld(8, 4, 0.5, 1, 2);
    assert.ok(Math.abs(posed.x - expect.x) < 1e-9);
    assert.ok(Math.abs(posed.z - expect.z) < 1e-9);
    assert.equal(posed.loft, 15.75);
    assert.ok(Math.abs(posed.yaw - 0.2) < 1e-9);
    assert.equal(posed.pitch, 0.1);
    assert.equal(posed.roll, -0.05);
  });

  it('falls back to the v1 deck grid when the slot has no seat', () => {
    const posed = posePassengerOnTransport({
      tx: 0,
      tz: 0,
      vehicleYaw: 0,
      vehicleLoft: 16,
      seats: [],
      slot: 0,
      total: 2,
    });
    assert.equal(posed.loft, 16 - AIR_PASSENGER_DROP);
    assert.equal(posed.yaw, 0);
    assert.ok(posed.x !== 0 || posed.z !== 0);
  });

  it('loads generated wagon / apc / dirigible seats', () => {
    assert.equal(seatsForUnitType(UNIT.WAGON).length, 6);
    assert.equal(seatsForUnitType(UNIT.APC).length, 6);
    assert.equal(seatsForUnitType(UNIT.DIRIGIBLE).length, 6);
    assert.equal(seatsForUnitType(UNIT.VILLAGER).length, 0);
    const wagon = seatsForUnitType(UNIT.WAGON)[0];
    assert.ok(wagon.y > 1);
    const apc = seatsForUnitType(UNIT.APC)[0];
    assert.ok(Math.abs(apc.yaw) > 0);
  });
});
