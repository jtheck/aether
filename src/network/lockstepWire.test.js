import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from '../sim/fixed.js';
import { CMD } from '../sim/commands.js';
import { SIM_GENERATION, hasCurrentSimGeneration } from '../sim/generation.js';
import { createWorld, spawn } from '../sim/world.js';
import { createField } from '../sim/field.js';
import { UNIT } from '../sim/unitTypes.js';
import { step } from '../sim/step.js';
import { checksum } from '../sim/checksum.js';
import { compactFrameForTransport, expandTransportFrame } from './lockstepWire.js';

describe('lockstep transport wire', () => {
  it('round-trips a uniform MOVE without mutating the canonical frame', () => {
    const frame = {
      tick: 12,
      playerId: 1,
      commandId: '1:4',
      commands: [{
        type: CMD.MOVE,
        entities: [7, 8, 9],
        tx: [123, 123, 123],
        ty: [-45, -45, -45],
      }],
    };
    const before = structuredClone(frame);

    const wire = compactFrameForTransport(frame);
    assert.deepEqual(frame, before);
    assert.deepEqual(wire.commands[0].$m, [123, -45]);
    assert.equal(wire.commands[0].tx, undefined);
    assert.equal(JSON.stringify(wire).length < JSON.stringify(frame).length, true);
    const peerWire = JSON.parse(JSON.stringify(wire));
    assert.deepEqual(expandTransportFrame(peerWire), frame);
  });

  it('leaves non-uniform and transport-assignment MOVE commands canonical', () => {
    const nonUniform = {
      commands: [{ type: CMD.MOVE, entities: [1, 2], tx: [3, 4], ty: [5, 5] }],
    };
    const transport = {
      commands: [{
        type: CMD.MOVE,
        entities: [1],
        tx: [3],
        ty: [5],
        transportAssignments: [{ riderId: 1, transportId: 2 }],
      }],
    };
    assert.equal(compactFrameForTransport(nonUniform), nonUniform);
    assert.equal(compactFrameForTransport(transport), transport);
  });

  it('keeps two peers checksum-identical after a compact wire round-trip', () => {
    const worlds = [createWorld(77), createWorld(77)];
    const fields = [createField(77), createField(77)];
    for (const field of fields) field.pass.fill(1);
    for (const world of worlds) {
      spawn(world, { x: 0, y: 0, type: UNIT.WARRIOR, owner: 0 });
      spawn(world, { x: fx.fromFloat(1), y: 0, type: UNIT.WARRIOR, owner: 0 });
    }
    const frame = {
      commands: [{
        type: CMD.MOVE,
        entities: [0, 1],
        tx: [fx.fromFloat(12), fx.fromFloat(12)],
        ty: [fx.fromFloat(-4), fx.fromFloat(-4)],
      }],
    };
    const peerFrame = expandTransportFrame(
      JSON.parse(JSON.stringify(compactFrameForTransport(frame))),
    );

    step(worlds[0], fields[0], frame.commands);
    step(worlds[1], fields[1], peerFrame.commands);
    assert.equal(checksum(worlds[0], fields[0]), checksum(worlds[1], fields[1]));
  });

  it('requires an explicit exact live simulation generation', () => {
    assert.equal(hasCurrentSimGeneration(SIM_GENERATION), true);
    assert.equal(hasCurrentSimGeneration(undefined), false);
    assert.equal(hasCurrentSimGeneration(String(SIM_GENERATION)), false);
    assert.equal(hasCurrentSimGeneration(SIM_GENERATION + 1), false);
  });
});
