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
import { isPassable, snapToPassable, worldToTile } from './field.js';
import { spawnKothSlot } from './worldSetup.js';
import { kothRegisterJoin } from './kothMeta.js';
import { kill } from './combat.js';
import { livingByOwner } from './world.js';
import { clearEngagement } from './engagement.js';
import { tryCast } from './abilities.js';
import { getUnitDef } from './unitTypes.js';

export const CMD = {
  MOVE: 1,
  ATTACK: 2,
  ATTACK_MOVE: 3,
  STOP: 4,
  SPAWN_SLOT: 5,
  FORCE_ELIMINATE: 6,
  CAST: 7,
};

/** @typedef {{ type: number, entities: number[], tx?: number[]|number, ty?: number[]|number, target?: number, abilityId?: string }} Command */

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
      case CMD.SPAWN_SLOT:
        applySpawnSlot(world, cmd.playerId);
        break;
      case CMD.FORCE_ELIMINATE:
        applyForceEliminate(world, cmd.playerId);
        break;
      case CMD.CAST:
        applyCast(world, cmd.entities, cmd.abilityId, cmd.tx, cmd.ty);
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
    let destX = tx[k];
    let destY = ty[k];
    const destTileX = worldToTile(destX);
    const destTileY = worldToTile(destY);
    if (!isPassable(field, destTileX, destTileY)) {
      const snapped = snapToPassable(field, destX, destY);
      if (snapped) {
        destX = snapped.x;
        destY = snapped.y;
      }
    }
    world.order[i] = order;
    world.targetEntity[i] = -1;
    clearEngagement(world, i);
    world.tx[i] = destX;
    world.ty[i] = destY;
    world.hasTarget[i] = 1;
    queuePath(world, i, destX, destY);
  }
}

function applyAttack(world, field, ids, target) {
  if (target < 0 || !world.alive[target]) return;
  for (let k = 0; k < ids.length; k++) {
    const i = ids[k];
    if (!world.alive[i]) continue;
    world.order[i] = ORDER.ATTACK;
    world.targetEntity[i] = target;
    clearEngagement(world, i);
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
    clearEngagement(world, i);
    world.hasTarget[i] = 0;
    world.vx[i] = 0;
    world.vy[i] = 0;
    clearPath(world, i);
  }
}

function applySpawnSlot(world, playerId) {
  if (playerId == null || playerId < 0) return;
  if (livingByOwner(world, playerId) > 0) return;
  if (world.koth) kothRegisterJoin(world.koth, playerId, world.tick);
  spawnKothSlot(world, playerId);
}

function applyForceEliminate(world, playerId) {
  if (playerId == null || playerId < 0) return;
  for (let i = 0; i < world.count; i++) {
    if (world.alive[i] && world.owner[i] === playerId) kill(world, i);
  }
}

/**
 * Point-cast primary (or named) ability for each entity.
 * `tx`/`ty` may be a single fixed-point aim or per-entity arrays.
 */
function applyCast(world, ids, abilityId, tx, ty) {
  if (!ids || ids.length === 0) return;
  const sharedAim = typeof tx === 'number' && typeof ty === 'number';
  for (let k = 0; k < ids.length; k++) {
    const i = ids[k];
    if (!world.alive[i]) continue;
    const aimX = sharedAim ? tx : tx?.[k];
    const aimY = sharedAim ? ty : ty?.[k];
    if (aimX == null || aimY == null) continue;
    const def = getUnitDef(world.type[i]);
    const id = abilityId || def.primaryAbility;
    if (!id) continue;
    tryCast(world, i, id, aimX, aimY);
  }
}

