import { TREE_BURN_TICKS } from '../sim/trees.js';

// How much flame to spend when several fires are on screen.
// One close source stays thick. A grove or a volley shares a budget so the
// particle pool does not scale with every tongue.

/** Camera distance for a full burning-tree body. */
export const TREE_FIRE_NEAR_DIST = 40;
/** Past this, a tree is a short column and no chimney. */
export const TREE_FIRE_MID_DIST = 85;
/** This many near trees keep full detail. Past that every tree thins. */
export const TREE_FIRE_BUDGET = 4;
/** Wisps per tree tongue. Camp sockets stay on the richer recipe. */
export const TREE_TONGUE_WISPS = 2;
/** Flame + smoke plume height vs camp sockets (2 ≈ twice the peak column). */
export const TREE_FIRE_PLUME_MUL = 2;
/** Ms from when the burning tree is first seen until smoke reaches full strength. */
export const TREE_SMOKE_WARM_MS = 2200;

/**
 * Smoke strength from local visible time (always) and sim burn when present.
 * Does not require burn ticks to drop — fresh ignites still warm up on a timer.
 */
export function treeCanopySmokeBuild(visibleAgeMs, burnTicks) {
  const age = Math.max(0, visibleAgeMs);
  const warm = Math.min(1, age / TREE_SMOKE_WARM_MS);
  const warmC = warm * warm * (3 - 2 * warm);
  let mature = 0.62;
  const burn = burnTicks | 0;
  if (burn > 0) {
    const consumed = Math.min(1, (TREE_BURN_TICKS - burn) / (TREE_BURN_TICKS * 0.4));
    mature = 0.5 + 0.5 * consumed;
  }
  let build = Math.min(1, warmC * mature);
  if (age >= 250) build = Math.max(build, 0.28);
  if (age >= 700) build = Math.max(build, 0.5);
  return build;
}

/**
 * @param {number} dist
 * @param {number} burningInView
 * @returns {{
 *   anchorCount: number,
 *   density: number,
 *   smoke: boolean,
 *   embers: boolean,
 *   wisps: number,
 *   size: number,
 *   plumeMul: number,
 * }}
 */
export function treeFireDetail(dist, burningInView) {
  const d = Number.isFinite(dist) && dist > 0 ? dist : 0;
  const n = Math.max(1, burningInView | 0);
  let anchorCount;
  let density;
  let smoke;
  let embers;
  if (d < TREE_FIRE_NEAR_DIST) {
    anchorCount = 6;
    density = 0.85;
    smoke = true;
    embers = true;
  } else if (d < TREE_FIRE_MID_DIST) {
    anchorCount = 4;
    density = 0.5;
    smoke = true;
    embers = n <= 8;
  } else if (d < 120) {
    anchorCount = 2;
    density = 0.34;
    smoke = true;
    embers = false;
  } else {
    anchorCount = 2;
    density = 0.32;
    smoke = false;
    embers = false;
  }
  if (n > TREE_FIRE_BUDGET) {
    density *= TREE_FIRE_BUDGET / n;
    if (n > 10 && anchorCount > 3) anchorCount = 3;
    if (n > 18) anchorCount = 2;
    if (n > 12) embers = false;
  }
  if (density < 0.16) density = 0.16;
  const wisps = d < TREE_FIRE_NEAR_DIST && n <= TREE_FIRE_BUDGET ? 3 : TREE_TONGUE_WISPS;
  return {
    anchorCount,
    density,
    smoke,
    embers,
    wisps,
    size: 1.9,
    plumeMul: TREE_FIRE_PLUME_MUL,
  };
}

/** Close ground patches keep a few hearths. */
export const GROUND_FIRE_NEAR_DIST = 48;
export const GROUND_FIRE_MID_DIST = 100;
/** This many patches keep full detail. */
export const GROUND_FIRE_BUDGET = 3;

/**
 * @param {number} dist
 * @param {number} patchCount
 * @returns {{ sites: number, density: number }}
 */
export function groundFireDetail(dist, patchCount) {
  const d = Number.isFinite(dist) && dist > 0 ? dist : 0;
  const n = Math.max(1, patchCount | 0);
  let sites;
  let density;
  if (d < GROUND_FIRE_NEAR_DIST) {
    sites = 3;
    density = 0.65;
  } else if (d < GROUND_FIRE_MID_DIST) {
    sites = 2;
    density = 0.4;
  } else {
    sites = 1;
    density = 0.28;
  }
  if (n > GROUND_FIRE_BUDGET) {
    density *= GROUND_FIRE_BUDGET / n;
    if (n > 6 && sites > 2) sites = 2;
    if (n > 12) sites = 1;
  }
  if (density < 0.14) density = 0.14;
  return { sites, density };
}
