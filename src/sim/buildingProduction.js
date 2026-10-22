// Building production tick - kept separate from buildings.js so importing
// spawn() from world.js cannot circular-init footprint tables.

import * as fx from './fixed.js';
import { snapToPassable } from './field.js';
import { ORDER, spawn } from './world.js';
import { queuePath } from './path.js';
import { clearEngagement } from './engagement.js';
import { isFlyer, UNIT, getUnitCost } from './unitTypes.js';
import { ownerAtPopSoftCap, ownerPopCap, ownerPopUsed } from './pop.js';
import { getResource, spendResources } from './resources.js';
import { bankShortfallHintLabel, noteStorageOverflow, ownerSlotCount } from './storage.js';
import {
  BUILDING_SPAWN_LOCAL,
  TRAIN_TICKS,
  RESEARCH_TICKS,
  VILLAGE_VILLAGER_TICKS,
  buildingLocalToWorld,
  stampUnitRallyHops,
} from './buildings.js';
import { grantTech, ownerHasTech, TECH } from './tech.js';
import { noteOwnerTrained } from './ownerStats.js';

/**
 * @param {object} w
 * @param {object | null | undefined} field
 * @param {{ owner: number, type: string, x: number, z: number, yaw: number }} b
 * @param {number} unitType
 */
function spawnTrainedUnit(w, field, b, unitType) {
  const flyer = isFlyer(unitType);
  const bx = fx.toFloat(b.x);
  const bz = fx.toFloat(b.z);
  const yaw = fx.toFloat(b.yaw | 0);
  const local = BUILDING_SPAWN_LOCAL[b.type] ?? { x: 0, y: 0, z: 0 };
  const spawnPos = buildingLocalToWorld(bx, bz, yaw, local.x, local.z);
  let sx = fx.fromFloat(spawnPos.x);
  let sz = fx.fromFloat(spawnPos.z);
  // Ground units snap onto passable; air units keep the spawn/rally xz.
  if (field && !flyer) {
    const snapped = snapToPassable(field, sx, sz);
    if (snapped) {
      sx = snapped.x;
      sz = snapped.y;
    }
  }
  const i = spawn(w, { x: sx, y: sz, type: unitType, owner: b.owner | 0 });
  noteOwnerTrained(w, b.owner | 0);
  // Rally point (player-set) or default walk-out past the doorway.
  let rx;
  let rz;
  if (b.hasRally) {
    rx = b.rallyX | 0;
    rz = b.rallyZ | 0;
  } else {
    const rally = buildingLocalToWorld(bx, bz, yaw, local.x * 1.35, local.z * 1.35);
    rx = fx.fromFloat(rally.x);
    rz = fx.fromFloat(rally.z);
  }
  if (field && !flyer) {
    const snapped = snapToPassable(field, rx, rz);
    if (snapped) {
      rx = snapped.x;
      rz = snapped.y;
    }
  }
  w.transportTarget[i] = -1;
  w.order[i] =
    b.hasRally && (b.rallyOrder | 0) === ORDER.ATTACK_MOVE
      ? ORDER.ATTACK_MOVE
      : ORDER.MOVE;
  w.tx[i] = rx;
  w.ty[i] = rz;
  w.targetEntity[i] = -1;
  if (w.targetBuilding) w.targetBuilding[i] = -1;
  clearEngagement(w, i);
  w.hasTarget[i] = 1;
  w.vx[i] = 0;
  w.vy[i] = 0;
  if (field) {
    // Flyers path straight in planPath; Drayage slow-aware is ground-only.
    const slowAware =
      !flyer && ownerHasTech(w, b.owner | 0, TECH.DRAYAGE);
    queuePath(w, i, rx, rz, slowAware ? { slowAware: true } : null);
  }
  stampUnitRallyHops(w, i, b);
}

/**
 * Fill fraction (0..1) of a village's auto-villager trickle. Accounts for the
 * soft-cap slowdown (interval doubles at/over the cap). Returns 0 for anything
 * that is not a completed village.
 * @param {object} w
 * @param {{ type?: string, owner?: number, built?: number, villageSpawnAcc?: number } | null | undefined} b
 * @param {object[] | null | undefined} [buildings] defaults to `w.buildings` (pass the HUD snapshot)
 * @param {object[] | null | undefined} [agoras]
 * @returns {number}
 */
export function villageVillagerProgress(w, b, buildings, agoras) {
  if (!w || !b || b.type !== 'village' || (b.built | 0) === 0) return 0;
  const list = buildings ?? w.buildings;
  const ag = agoras ?? w.agoras;
  const atCap = ownerPopUsed(w, b.owner | 0, list) >= ownerPopCap(list, ag, b.owner | 0);
  const need = atCap ? VILLAGE_VILLAGER_TICKS * 2 : VILLAGE_VILLAGER_TICKS;
  if (need <= 0) return 0;
  const acc = b.villageSpawnAcc | 0;
  return Math.max(0, Math.min(1, acc / need));
}

/** Completed villages trickle a villager at UNIT_COST; half speed at/over the soft cap. */
function tickVillageVillagers(w, field, b) {
  if (b.type !== 'village') return;
  const acc = (b.villageSpawnAcc | 0) + 1;
  const need = ownerAtPopSoftCap(w, b.owner | 0)
    ? VILLAGE_VILLAGER_TICKS * 2
    : VILLAGE_VILLAGER_TICKS;
  if (acc >= need) {
    b.villageSpawnAcc = 0;
    // Can't pay → miss this interval; the timer does not sit on ready.
    const owner = b.owner | 0;
    if (spendResources(w, owner, getUnitCost(UNIT.VILLAGER))) {
      spawnTrainedUnit(w, field, b, UNIT.VILLAGER);
    } else {
      const food = getResource(w, owner, 'food');
      const slots = ownerSlotCount(w.buildings, owner, 'food', 'world', w);
      noteStorageOverflow(
        w,
        owner,
        'food',
        bankShortfallHintLabel(food, slots, 'food'),
        'short',
      );
    }
    return;
  }
  b.villageSpawnAcc = acc;
}

/**
 * Advance multi-track production; slowdown by active track count.
 * @param {object} w
 * @param {object | null | undefined} field
 */
export function buildingProductionSystem(w, field) {
  const buildings = w.buildings;
  if (!buildings?.length) return;
  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    if (b.built === 0) continue; // a construction site produces nothing
    if (b.hp != null && (b.hp | 0) <= 0) continue;
    tickVillageVillagers(w, field, b);
    const tracks = b.tracks;
    if (!tracks?.length) continue;
    let active = 0;
    for (let i = 0; i < tracks.length; i++) {
      if ((tracks[i].count | 0) > 0) active++;
    }
    if (active === 0) {
      b.tracks = [];
      if (b.prodPaused) b.prodPaused = 0;
      w.buildingsDirty = 1;
      continue;
    }
    let dirty = false;
    for (let ti = tracks.length - 1; ti >= 0; ti--) {
      const t = tracks[ti];
      if ((t.count | 0) < 1) {
        tracks.splice(ti, 1);
        dirty = true;
        continue;
      }
      const ticks = t.kind === 'upgrade' ? RESEARCH_TICKS : TRAIN_TICKS;
      const stepProg = 1 / (ticks * active);
      let progress = Number(t.progress) || 0;
      // Pause still cooks the current item at normal speed; hold at ready
      // so the unit does not walk out until resume.
      if (b.prodPaused) {
        if (progress < 1) {
          progress += stepProg;
          t.progress = progress >= 1 ? 1 : progress;
          dirty = true;
        }
        continue;
      }
      if (progress < 1) progress += stepProg;
      t.progress = progress;
      while (t.progress >= 1 && (t.count | 0) > 0) {
        t.progress -= 1;
        t.count = (t.count | 0) - 1;
        if (t.kind === 'unit') {
          spawnTrainedUnit(w, field, b, t.unitType);
        } else if (t.kind === 'upgrade') {
          grantTech(w, b.owner | 0, t.id);
        }
        dirty = true;
      }
      if ((t.count | 0) < 1) {
        tracks.splice(ti, 1);
        dirty = true;
      } else {
        if (t.progress >= 1) t.progress = t.progress % 1;
        dirty = true;
      }
    }
    if (dirty) w.buildingsDirty = 1;
  }
}
