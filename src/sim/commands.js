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
import * as fx from './fixed.js';
import {
  clearPath,
  queuePath,
  attackStandPoint,
  groupArriveRadiusSq,
  FINAL_ARRIVE_SQ,
} from './path.js';
import { isPassable, snapToPassable, worldToTile } from './field.js';
import { spawnKothSlot } from './worldSetup.js';
import { kothRegisterJoin } from './kothMeta.js';
import { kill } from './combat.js';
import { livingByOwner } from './world.js';
import { clearEngagement } from './engagement.js';
import { tryCast } from './abilities.js';
import { getUnitDef, isFlyer, isMechanical, UNIT } from './unitTypes.js';
import {
  applyTransportAssignments,
  isCarried,
  unloadPassengers,
} from './transport.js';
import { beginRepair } from './repair.js';
import {
  applyPlaceBuilding,
  applyQueueTrain,
  applyCancelTrain,
  applySetRally,
} from './buildings.js';

export const CMD = {
  MOVE: 1,
  ATTACK: 2,
  ATTACK_MOVE: 3,
  STOP: 4,
  SPAWN_SLOT: 5,
  FORCE_ELIMINATE: 6,
  CAST: 7,
  /** Sync local selection → sim squad stamps (monk won't bonk co-selected). */
  SELECT: 8,
  /** Spill passengers from selected transports; optional walk target. */
  UNLOAD: 9,
  /** Place a building at world xz (stub — no cost / build time). */
  PLACE_BUILDING: 10,
  /** Queue a unit on a building production track. */
  QUEUE_TRAIN: 11,
  /** Cancel all production tracks on a building. */
  CANCEL_TRAIN: 12,
  /** Set a building's train rally point (world xz). */
  SET_RALLY: 13,
};

/** @typedef {{ type: number, entities: number[], tx?: number[]|number, ty?: number[]|number, target?: number, abilityId?: string, transportAssignments?: { riderId: number, transportId: number }[] }} Command */

export function applyCommands(world, field, commands) {
  if (!commands || commands.length === 0) return;

  for (let c = 0; c < commands.length; c++) {
    const cmd = commands[c];
    switch (cmd.type) {
      case CMD.MOVE:
        applyMove(world, field, cmd.entities, cmd.tx, cmd.ty, ORDER.MOVE);
        if (cmd.transportAssignments?.length) {
          applyTransportAssignments(world, cmd.transportAssignments);
        }
        break;
      case CMD.ATTACK:
        applyAttack(world, field, cmd.entities, cmd.target);
        break;
      case CMD.ATTACK_MOVE:
        applyMove(world, field, cmd.entities, cmd.tx, cmd.ty, ORDER.ATTACK_MOVE);
        if (cmd.transportAssignments?.length) {
          applyTransportAssignments(world, cmd.transportAssignments);
        }
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
        applyCast(world, field, cmd.entities, cmd.abilityId, cmd.tx, cmd.ty);
        break;
      case CMD.SELECT:
        applySelect(world, cmd.playerId, cmd.entities);
        break;
      case CMD.UNLOAD:
        applyUnload(world, field, cmd.entities, cmd.tx, cmd.ty);
        break;
      case CMD.PLACE_BUILDING:
        applyPlaceBuilding(world, field, cmd);
        break;
      case CMD.QUEUE_TRAIN:
        applyQueueTrain(world, cmd);
        break;
      case CMD.CANCEL_TRAIN:
        applyCancelTrain(world, cmd);
        break;
      case CMD.SET_RALLY:
        applySetRally(world, cmd);
        break;
      default:
        break;
    }
  }
}

/** Assign a fresh squad id to every living unit in `ids` (multi-unit orders). */
export function stampSquadGroup(world, ids) {
  if (!ids || ids.length < 2 || !world.squadId) return 0;
  const sid = (world.nextSquadId = (world.nextSquadId | 0) + 1) || 1;
  for (let k = 0; k < ids.length; k++) {
    const i = ids[k];
    if (i < 0 || i >= world.count || !world.alive[i]) continue;
    world.squadId[i] = sid;
  }
  return sid;
}

/**
 * Replace this player's squad stamps with the current selection.
 * Empty selection clears all of that player's squad ids.
 */
function applySelect(world, playerId, entities) {
  if (playerId == null || playerId < 0 || !world.squadId) return;
  const sid = (world.nextSquadId = (world.nextSquadId | 0) + 1) || 1;
  const chosen = new Set();
  if (entities?.length) {
    for (let k = 0; k < entities.length; k++) {
      const i = entities[k];
      if (i < 0 || i >= world.count || !world.alive[i]) continue;
      if (world.owner[i] !== playerId) continue;
      chosen.add(i);
    }
  }
  for (let i = 0; i < world.count; i++) {
    if (world.owner[i] !== playerId) continue;
    world.squadId[i] = chosen.has(i) ? sid : 0;
  }
}

/**
 * Soft gather scatter for group moves — deterministic per-entity jitter so a
 * shared click does not path everyone onto one pixel. Box scatter from an
 * integer hash (no trig / no formation grid). Single-unit moves stay exact.
 * Amplitude scales with √movers so hundreds don't all path into a tiny box.
 * See docs/unit-separation.md.
 */
const GATHER_JITTER_MIN = 2.4;
const GATHER_JITTER_MAX_CAP = 24;

function gatherJitterMax(movers) {
  const scaled = 1.2 * Math.sqrt(Math.max(1, movers | 0));
  return fx.fromFloat(Math.min(GATHER_JITTER_MAX_CAP, Math.max(GATHER_JITTER_MIN, scaled)));
}

function gatherJitter(entityId, maxFixed) {
  const h = Math.imul(entityId + 1, 2654435761) >>> 0;
  const rx = (h & 0xfff) - 2048;
  const ry = ((h >>> 12) & 0xfff) - 2048;
  return {
    x: Math.floor((rx * maxFixed) / 2048),
    y: Math.floor((ry * maxFixed) / 2048),
  };
}

function applyMove(world, field, ids, tx, ty, order) {
  stampSquadGroup(world, ids);
  let movers = 0;
  for (let k = 0; k < ids.length; k++) {
    const i = ids[k];
    if (world.alive[i] && !isCarried(world, i)) movers++;
  }
  const arriveR2 = groupArriveRadiusSq(movers);
  const scatter = movers > 1;
  const jitterMax = scatter ? gatherJitterMax(movers) : 0;

  for (let k = 0; k < ids.length; k++) {
    const i = ids[k];
    if (!world.alive[i] || isCarried(world, i)) continue;
    world.transportTarget[i] = -1;
    const clickX = tx[k];
    const clickY = ty[k];
    let destX = clickX;
    let destY = clickY;
    if (scatter) {
      const j = gatherJitter(i, jitterMax);
      destX += j.x;
      destY += j.y;
    }
    if (!isFlyer(world.type[i])) {
      const destTileX = worldToTile(destX);
      const destTileY = worldToTile(destY);
      if (!isPassable(field, destTileX, destTileY)) {
        const snapped = snapToPassable(field, destX, destY);
        if (snapped) {
          destX = snapped.x;
          destY = snapped.y;
        }
      }
    }
    world.tx[i] = destX;
    world.ty[i] = destY;
    world.targetEntity[i] = -1;
    clearEngagement(world, i);

    // Already inside the soft gather disk around the click — stay put.
    // Measure vs the shared click (not jittered dest) so a scaled scatter
    // doesn't yank edge units out of a settled pack.
    // Busy / mid-order units only cancel within FINAL_ARRIVE so a huge √n disk
    // does not idle an army when only the front is near the click.
    const busy =
      world.order[i] !== ORDER.IDLE &&
      (world.hasTarget[i] ||
        world.navWpCount[i] > 0 ||
        world.pathRequest[i] ||
        world.order[i] === ORDER.ATTACK ||
        world.order[i] === ORDER.REPAIR);
    const stayR2 = busy ? FINAL_ARRIVE_SQ : arriveR2;
    if (fx.dist2(world.px[i], world.py[i], clickX, clickY) <= stayR2) {
      world.order[i] = ORDER.IDLE;
      world.hasTarget[i] = 0;
      world.vx[i] = 0;
      world.vy[i] = 0;
      clearPath(world, i);
      continue;
    }

    world.order[i] = order;
    world.hasTarget[i] = 1;
    queuePath(world, i, destX, destY);
  }
}

function applyAttack(world, field, ids, target) {
  if (target < 0 || !world.alive[target]) return;
  stampSquadGroup(world, ids);
  for (let k = 0; k < ids.length; k++) {
    const i = ids[k];
    if (!world.alive[i] || isCarried(world, i)) continue;
    world.transportTarget[i] = -1;
    // Engineers convert ally-mechanical attacks into repair orders.
    if (
      world.type[i] === UNIT.ENGINEER &&
      world.owner[i] === world.owner[target] &&
      isMechanical(world.type[target])
    ) {
      beginRepair(world, i, target);
      continue;
    }
    world.order[i] = ORDER.ATTACK;
    world.targetEntity[i] = target;
    clearEngagement(world, i);
    world.hasTarget[i] = 0;
    const stand = attackStandPoint(world, i, target);
    queuePath(world, i, stand.x, stand.y);
  }
}

function applyStop(world, ids) {
  stampSquadGroup(world, ids);
  for (let k = 0; k < ids.length; k++) {
    const i = ids[k];
    if (!world.alive[i] || isCarried(world, i)) continue;
    world.transportTarget[i] = -1;
    world.order[i] = ORDER.IDLE;
    world.targetEntity[i] = -1;
    clearEngagement(world, i);
    world.hasTarget[i] = 0;
    world.vx[i] = 0;
    world.vy[i] = 0;
    clearPath(world, i);
  }
}

function applyUnload(world, field, ids, tx, ty) {
  if (!ids || ids.length === 0) return;
  const sharedAim = typeof tx === 'number' && typeof ty === 'number';
  for (let k = 0; k < ids.length; k++) {
    const i = ids[k];
    if (!world.alive[i] || isCarried(world, i)) continue;
    const walkTx = sharedAim ? tx : tx?.[k] ?? null;
    const walkTy = sharedAim ? ty : ty?.[k] ?? null;
    unloadPassengers(world, i, walkTx, walkTy);
    // Transport idles after spilling.
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
function applyCast(world, field, ids, abilityId, tx, ty) {
  if (!ids || ids.length === 0) return;
  const sharedAim = typeof tx === 'number' && typeof ty === 'number';
  for (let k = 0; k < ids.length; k++) {
    const i = ids[k];
    if (!world.alive[i] || isCarried(world, i)) continue;
    const aimX = sharedAim ? tx : tx?.[k];
    const aimY = sharedAim ? ty : ty?.[k];
    if (aimX == null || aimY == null) continue;
    const def = getUnitDef(world.type[i]);
    const id = abilityId || def.primaryAbility;
    if (!id) continue;
    tryCast(world, i, id, aimX, aimY, field);
  }
}

