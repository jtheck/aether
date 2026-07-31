// Allocation-free deterministic uniform grid for local simulation queries.

import * as fx from './fixed.js';
import { WORLD_HALF, WORLD_HALF_F } from './field.js';

export const SPATIAL_CELL_WORLD = 8;
export const SPATIAL_CELL = fx.fromInt(SPATIAL_CELL_WORLD);
export const SPATIAL_COLS = Math.ceil((WORLD_HALF_F * 2) / SPATIAL_CELL_WORLD);
export const SPATIAL_ROWS = SPATIAL_COLS;
export const SPATIAL_CELL_COUNT = SPATIAL_COLS * SPATIAL_ROWS;
export const SPATIAL_OWNER_SLOTS = 8;

export function createSpatialGrid(capacity) {
  const head = new Int32Array(SPATIAL_CELL_COUNT);
  const tail = new Int32Array(SPATIAL_CELL_COUNT);
  const next = new Int32Array(capacity);
  const touched = new Int32Array(SPATIAL_CELL_COUNT);
  const ownerHead = new Int32Array(SPATIAL_CELL_COUNT * SPATIAL_OWNER_SLOTS);
  const ownerTail = new Int32Array(SPATIAL_CELL_COUNT * SPATIAL_OWNER_SLOTS);
  const ownerNext = new Int32Array(capacity);
  const touchedOwner = new Int32Array(SPATIAL_CELL_COUNT * SPATIAL_OWNER_SLOTS);
  head.fill(-1);
  tail.fill(-1);
  next.fill(-1);
  ownerHead.fill(-1);
  ownerTail.fill(-1);
  ownerNext.fill(-1);
  return {
    head,
    tail,
    next,
    touched,
    touchedCount: 0,
    ownerHead,
    ownerTail,
    ownerNext,
    touchedOwner,
    touchedOwnerCount: 0,
    activeOwners: new Uint8Array(SPATIAL_OWNER_SLOTS),
    overflowOwners: false,
    cols: SPATIAL_COLS,
    rows: SPATIAL_ROWS,
  };
}

function clearSpatialGrid(grid) {
  for (let i = 0; i < grid.touchedCount; i++) {
    const cell = grid.touched[i];
    grid.head[cell] = -1;
    grid.tail[cell] = -1;
  }
  for (let i = 0; i < grid.touchedOwnerCount; i++) {
    const slot = grid.touchedOwner[i];
    grid.ownerHead[slot] = -1;
    grid.ownerTail[slot] = -1;
  }
  grid.touchedCount = 0;
  grid.touchedOwnerCount = 0;
  grid.activeOwners.fill(0);
  grid.overflowOwners = false;
}

function clampCell(value, limit) {
  if (value < 0) return 0;
  if (value >= limit) return limit - 1;
  return value;
}

export function spatialCoords(px, py) {
  const x = clampCell(Math.floor((px + WORLD_HALF) / SPATIAL_CELL), SPATIAL_COLS);
  const z = clampCell(Math.floor((py + WORLD_HALF) / SPATIAL_CELL), SPATIAL_ROWS);
  return { x, z };
}

export function spatialCellId(x, z) {
  return z * SPATIAL_COLS + x;
}

export function rebuildSpatialGrid(grid, world, include = null, indexOwners = true) {
  clearSpatialGrid(grid);
  for (let i = 0; i < world.count; i++) {
    if (!world.alive[i] || (include && !include(world, i))) continue;
    const { x, z } = spatialCoords(world.px[i], world.py[i]);
    const cell = spatialCellId(x, z);
    grid.next[i] = -1;
    const previousTail = grid.tail[cell];
    if (previousTail < 0) {
      grid.head[cell] = i;
      grid.touched[grid.touchedCount++] = cell;
    } else {
      grid.next[previousTail] = i;
    }
    grid.tail[cell] = i;

    if (!indexOwners) continue;
    const owner = world.owner[i];
    if (owner >= SPATIAL_OWNER_SLOTS) {
      grid.overflowOwners = true;
      continue;
    }
    grid.activeOwners[owner] = 1;
    grid.ownerNext[i] = -1;
    const ownerSlot = cell * SPATIAL_OWNER_SLOTS + owner;
    const previousOwnerTail = grid.ownerTail[ownerSlot];
    if (previousOwnerTail < 0) {
      grid.ownerHead[ownerSlot] = i;
      grid.touchedOwner[grid.touchedOwnerCount++] = ownerSlot;
    } else {
      grid.ownerNext[previousOwnerTail] = i;
    }
    grid.ownerTail[ownerSlot] = i;
  }
}

export function queryCellBounds(px, py, radius) {
  const { x, z } = spatialCoords(px, py);
  const ring = Math.max(0, Math.ceil(radius / SPATIAL_CELL));
  return {
    minX: Math.max(0, x - ring),
    maxX: Math.min(SPATIAL_COLS - 1, x + ring),
    minZ: Math.max(0, z - ring),
    maxZ: Math.min(SPATIAL_ROWS - 1, z + ring),
  };
}
