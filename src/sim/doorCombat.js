// Shut curtain doors. They block like a wall until a unit breaks them, then the
// opening flips open and applyWallOccupancy clears those tiles.

import * as fx from './fixed.js';
import { TILE_SIZE_F, snapToPassable } from './field.js';
import { applyWallOccupancy, openingWorldPoint } from './walls.js';
import { getUnitDef } from './unitTypes.js';

/** A short squad of infantry breaks one. */
export const DOOR_HP = 80;
/** Nearest open ground sits past the blocked tiles on both sides of the edge. */
const DOOR_STAND_F = TILE_SIZE_F * 1.25;
const DOOR_REACH_F = TILE_SIZE_F * 1.6;
/** Attack-move click this close to a shut door breaks it instead of walking. */
export const DOOR_CLICK_REACH_F = 7;
/** Pressed against a shut door on the way somewhere - stop and bash. */
export const DOOR_BASH_REACH_F = 8;

export function isDoorAlive(door) {
  return !!door && !door.open && (door.hp | 0) > 0;
}

/** Index of the nearest shut door within maxDist (fixed), or -1. */
export function nearestShutDoor(world, x, z, maxDist) {
  const doors = world?.doors;
  if (!doors?.length || !(maxDist > 0)) return -1;
  const max2 = fx.mul(maxDist, maxDist);
  let best = -1;
  let bestD = max2;
  for (let i = 0; i < doors.length; i++) {
    const door = doors[i];
    if (!isDoorAlive(door)) continue;
    const d2 = fx.dist2(x, z, door.x, door.z);
    if (d2 < bestD || (d2 === bestD && (best < 0 || i < best))) {
      bestD = d2;
      best = i;
    }
  }
  return best;
}

/** Area damage (fireball, bloom, ground fire). Returns how many doors were hit. */
export function damageDoorsInRadius(world, field, x, z, radius, amount) {
  const doors = world?.doors;
  if (!doors?.length || !(radius > 0) || (amount | 0) <= 0) return 0;
  const radius2 = fx.mul(radius, radius);
  let hit = 0;
  for (let i = 0; i < doors.length; i++) {
    if (!isDoorAlive(doors[i])) continue;
    if (fx.dist2(x, z, doors[i].x, doors[i].z) > radius2) continue;
    if (applyDamageDoor(world, field, i, amount) > 0) hit++;
  }
  return hit;
}

export function doorAttackRange(def) {
  return (def?.attackRange ?? 0) + fx.fromFloat(DOOR_REACH_F);
}

export function attackDoorInRange(w, i, door) {
  if (!isDoorAlive(door)) return false;
  const def = getUnitDef(w.type[i]);
  const reach = doorAttackRange(def);
  const d2 = fx.dist2(w.px[i], w.py[i], door.x, door.z);
  if (d2 > fx.mul(reach, reach)) return false;
  if (def.minRange > 0) {
    const min2 = fx.mul(def.minRange, def.minRange);
    if (d2 < min2) return false;
  }
  return true;
}

export function attackDoorStandPoint(w, i, door) {
  const stand = fx.fromFloat(DOOR_STAND_F);
  const dx = w.px[i] - door.x;
  const dy = w.py[i] - door.z;
  const dist = fx.len(dx, dy);
  const nx = dist > 0 ? fx.div(dx, dist) : fx.ONE;
  const ny = dist > 0 ? fx.div(dy, dist) : 0;
  return {
    x: door.x + fx.mul(nx, stand),
    y: door.z + fx.mul(ny, stand),
  };
}

export function attackDoorStandPointOnField(w, field, i, door) {
  const raw = attackDoorStandPoint(w, i, door);
  const snapped = field ? snapToPassable(field, raw.x, raw.y) : null;
  return snapped ? { x: snapped.x, y: snapped.y } : raw;
}

/** One record per shut door. Open authored doors are not targets. */
export function bindDoors(world, field) {
  const runs = field?.walls?.runs || [];
  const doors = [];
  for (let r = 0; r < runs.length; r++) {
    const openings = runs[r].openings || [];
    for (let o = 0; o < openings.length; o++) {
      const opening = openings[o];
      if (opening.gate || opening.open) continue;
      const at = openingWorldPoint(runs[r], opening);
      doors.push({
        x: fx.fromFloat(at.x),
        z: fx.fromFloat(at.z),
        hp: DOOR_HP,
        maxHp: DOOR_HP,
        open: 0,
        run: r,
        opening: o,
      });
    }
  }
  world.doors = doors;
  world.doorsDirty = 0;
  return doors;
}

export function serializeDoors(doors) {
  if (!doors?.length) return [];
  return doors.map((d) => ({
    x: fx.toFloat(d.x),
    z: fx.toFloat(d.z),
    hp: d.hp | 0,
    open: d.open ? 1 : 0,
    run: d.run | 0,
    opening: d.opening | 0,
  }));
}

export function takeDoorUpdates(world) {
  if (!world?.doorsDirty) return null;
  world.doorsDirty = 0;
  return serializeDoors(world.doors);
}

function markDoorOpen(field, door) {
  const opening = field?.walls?.runs?.[door.run]?.openings?.[door.opening];
  if (opening) opening.open = 1;
  if (field?.walls) applyWallOccupancy(field, field.walls);
}

export function applyDamageDoor(world, field, di, amount) {
  const door = world?.doors?.[di];
  if (!isDoorAlive(door) || amount <= 0) return 0;
  const next = Math.max(0, (door.hp | 0) - (amount | 0));
  const dealt = (door.hp | 0) - next;
  door.hp = next;
  world.doorsDirty = 1;
  if (next <= 0) {
    door.open = 1;
    door.hp = 0;
    markDoorOpen(field, door);
  }
  return dealt;
}

/** Client / checkpoint: flip openings that have been broken and restamp pass. */
export function applyDoorSnapshot(field, doors) {
  const runs = field?.walls?.runs;
  if (!runs || !doors?.length) return false;
  let opened = false;
  for (let i = 0; i < doors.length; i++) {
    const d = doors[i];
    if (!d?.open) continue;
    const opening = runs[d.run]?.openings?.[d.opening];
    if (opening && !opening.open) {
      opening.open = 1;
      opened = true;
    }
  }
  if (opened) applyWallOccupancy(field, field.walls);
  return opened;
}

export function exportDoorState(doors) {
  if (!doors?.length) return [];
  return doors.map((d) => ({
    x: d.x | 0,
    z: d.z | 0,
    hp: d.hp | 0,
    maxHp: d.maxHp | 0,
    open: d.open ? 1 : 0,
    run: d.run | 0,
    opening: d.opening | 0,
  }));
}

export function importDoorState(world, field, data) {
  if (!world || !Array.isArray(data)) return;
  world.doors = data.map((d) => ({
    x: d.x | 0,
    z: d.z | 0,
    hp: d.hp | 0,
    maxHp: d.maxHp | 0 || DOOR_HP,
    open: d.open ? 1 : 0,
    run: d.run | 0,
    opening: d.opening | 0,
  }));
  world.doorsDirty = 0;
  const runs = field?.walls?.runs;
  if (!runs) return;
  for (let i = 0; i < world.doors.length; i++) {
    const door = world.doors[i];
    const opening = runs[door.run]?.openings?.[door.opening];
    if (opening) opening.open = door.open ? 1 : 0;
  }
  if (field.walls) applyWallOccupancy(field, field.walls);
}
