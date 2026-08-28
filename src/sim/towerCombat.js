// Watchtowers — finished towers lob arrows at the nearest hostile in range.
// Units already fight buildings; this is the missing building → unit fire.

import * as fx from './fixed.js';
import { PROJECTILE } from './projectileTypes.js';
import { spawnProjectile } from './projectiles.js';
import { isHostile } from './teams.js';
import { isBuildingAlive } from './buildings.js';
import {
  queryCellBounds,
  spatialCellId,
  SPATIAL_OWNER_SLOTS,
} from './spatialGrid.js';
import { isCarried } from './transport.js';

/** World-unit reach from the tower center (12 tiles). */
export const TOWER_ATTACK_RANGE_F = 48;
export const TOWER_ATTACK_DAMAGE = 8;
/** Same cadence as an archer (~2s at 20 Hz). */
export const TOWER_ATTACK_COOLDOWN = 40;

const TOWER_ATTACK_RANGE = fx.fromFloat(TOWER_ATTACK_RANGE_F);
const TOWER_ATTACK_RANGE_SQ = fx.mul(TOWER_ATTACK_RANGE, TOWER_ATTACK_RANGE);

function pickTowerTarget(w, b) {
  const grid = w.spatial;
  if (!grid) {
    let best = -1;
    let bestD2 = TOWER_ATTACK_RANGE_SQ + 1;
    for (let i = 0; i < w.count; i++) {
      if (!w.alive[i] || !isHostile(b.owner, w.owner[i])) continue;
      if (isCarried(w, i)) continue;
      const d2 = fx.dist2(b.x, b.z, w.px[i], w.py[i]);
      if (d2 > TOWER_ATTACK_RANGE_SQ) continue;
      if (d2 < bestD2 || (d2 === bestD2 && (best < 0 || i < best))) {
        bestD2 = d2;
        best = i;
      }
    }
    return best;
  }

  const bounds = queryCellBounds(b.x, b.z, TOWER_ATTACK_RANGE, grid);
  let best = -1;
  let bestD2 = TOWER_ATTACK_RANGE_SQ + 1;
  const consider = (i) => {
    if (!w.alive[i] || !isHostile(b.owner, w.owner[i])) return;
    if (isCarried(w, i)) return;
    const d2 = fx.dist2(b.x, b.z, w.px[i], w.py[i]);
    if (d2 > TOWER_ATTACK_RANGE_SQ) return;
    if (d2 < bestD2 || (d2 === bestD2 && (best < 0 || i < best))) {
      bestD2 = d2;
      best = i;
    }
  };

  for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const cell = spatialCellId(x, z, grid);
      if (grid.overflowOwners || (b.owner | 0) >= SPATIAL_OWNER_SLOTS) {
        let i = grid.head[cell];
        while (i >= 0) {
          consider(i);
          i = grid.next[i];
        }
        continue;
      }
      for (let owner = 0; owner < SPATIAL_OWNER_SLOTS; owner++) {
        if (owner === (b.owner | 0) || !grid.activeOwners[owner]) continue;
        let i = grid.ownerHead[cell * SPATIAL_OWNER_SLOTS + owner];
        while (i >= 0) {
          consider(i);
          i = grid.ownerNext[i];
        }
      }
    }
  }
  return best;
}

function fireTower(w, b, target) {
  spawnProjectile(w, {
    type: PROJECTILE.ARROW,
    owner: b.owner,
    source: -1,
    target,
    x: b.x,
    y: b.z,
    aimX: w.px[target],
    aimY: w.py[target],
    damage: TOWER_ATTACK_DAMAGE,
  });
  b.attackCd = TOWER_ATTACK_COOLDOWN;
}

export function towerCombatSystem(w) {
  const buildings = w.buildings;
  if (!buildings?.length) return;
  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    if (b.type !== 'tower' || (b.built | 0) === 0 || !isBuildingAlive(b)) continue;
    const cd = b.attackCd | 0;
    if (cd > 0) {
      b.attackCd = cd - 1;
      continue;
    }
    const target = pickTowerTarget(w, b);
    if (target >= 0) fireTower(w, b, target);
  }
}
