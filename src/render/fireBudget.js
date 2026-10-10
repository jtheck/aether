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
    smoke = n <= 8;
    embers = n <= 8;
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
    if (n > 12) {
      smoke = false;
      embers = false;
    }
  }
  if (density < 0.16) density = 0.16;
  const wisps = d < TREE_FIRE_NEAR_DIST && n <= TREE_FIRE_BUDGET ? 3 : TREE_TONGUE_WISPS;
  return { anchorCount, density, smoke, embers, wisps, size: 1.25 };
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
