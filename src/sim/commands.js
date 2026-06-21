// Commands are the ONLY way the outside world changes the simulation.
//
// This is the inversion v1 lacked: input (mouse, AI, network) never mutates
// entity state directly. It produces commands, the command list is fed to
// step(), and step() applies them at a known tick. That makes the sim a pure
// function of (state, commands) — which is exactly what lockstep multiplayer
// needs, and it is true from the very first unit.
//
// A command is plain, serializable data (no object references), so the same
// command can be applied locally, sent over the wire, or replayed from a log.

import { ORDER } from './world.js';
import { clearPath, queuePath, attackStandPoint } from './path.js';

export const CMD = {
  MOVE: 1,
  ATTACK: 2,
  ATTACK_MOVE: 3,
  STOP: 4,
};

/** @typedef {{ type: number, entities: number[], tx?: number[], ty?: number[], target?: number }} Command */

export function applyCommands(world, field, commands) {
  if (!commands || commands.length === 0) return;

  for (let c = 0; c < commands.length; c++) {
    const cmd = commands[c];
    switch (cmd.type) {
      case CMD.MOVE:
        applyMove(world, field, cmd.entities, cmd.tx, cmd.ty, ORDER.MOVE);
        break;
      case CMD.ATTACK:
        applyAttack(world, field, cmd.entities, cmd.target);
        break;
      case CMD.ATTACK_MOVE:
        applyMove(world, field, cmd.entities, cmd.tx, cmd.ty, ORDER.ATTACK_MOVE);
        break;
      case CMD.STOP:
        applyStop(world, cmd.entities);
        break;
      default:
        break;
    }
  }
}

function applyMove(world, field, ids, tx, ty, order) {
  for (let k = 0; k < ids.length; k++) {
    const i = ids[k];
    if (!world.alive[i]) continue;
    world.order[i] = order;
    world.targetEntity[i] = -1;
    world.tx[i] = tx[k];
    world.ty[i] = ty[k];
    world.hasTarget[i] = 1;
    queuePath(world, i, tx[k], ty[k]);
  }
}

function applyAttack(world, field, ids, target) {
  if (target < 0 || !world.alive[target]) return;
  for (let k = 0; k < ids.length; k++) {
    const i = ids[k];
    if (!world.alive[i]) continue;
    world.order[i] = ORDER.ATTACK;
    world.targetEntity[i] = target;
    world.hasTarget[i] = 0;
    const stand = attackStandPoint(world, i, target);
    queuePath(world, i, stand.x, stand.y);
  }
}

function applyStop(world, ids) {
  for (let k = 0; k < ids.length; k++) {
    const i = ids[k];
    if (!world.alive[i]) continue;
    world.order[i] = ORDER.IDLE;
    world.targetEntity[i] = -1;
    world.hasTarget[i] = 0;
    world.vx[i] = 0;
    world.vy[i] = 0;
    clearPath(world, i);
  }
}

