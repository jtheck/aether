// Combat-only building fire: little perimeter flames, no baked anchors.
// Sparks on hits once HP drops under 2/3, swell as the building gets lower,
// and fade out when nobody is hitting it.

import { BUILDING_FOOTPRINTS } from '../sim/buildings.js';
import { TILE_SIZE_F } from '../sim/field.js';

/** Same cut as the HP chip yellow band. */
export const BUILDING_FIRE_HP_GATE = 2 / 3;
export const BUILDING_FIRE_SPARK_CHANCE_MIN = 0.30;
export const BUILDING_FIRE_SPARK_CHANCE_MAX = 0.92;
export const BUILDING_FIRE_DECAY_PER_SEC = 0.24;
export const BUILDING_FIRE_PATCH_MIN = 0.07;
export const BUILDING_FIRE_MAX_PATCHES = 8;

/**
 * 0 at the 2/3 gate, 1 at 0 HP. 0 when the building is still above the gate.
 * @param {number} ratio hp / maxHp
 */
export function fireWound(ratio) {
  if (!(ratio < BUILDING_FIRE_HP_GATE)) return 0;
  return 1 - Math.max(0, ratio) / BUILDING_FIRE_HP_GATE;
}

/** @param {number} wound */
export function sparkChanceForWound(wound) {
  const t = Math.max(0, Math.min(1, wound));
  return BUILDING_FIRE_SPARK_CHANCE_MIN
    + t * (BUILDING_FIRE_SPARK_CHANCE_MAX - BUILDING_FIRE_SPARK_CHANCE_MIN);
}

/** 1 spark near the gate, up to 3 when the building is almost down. */
export function sparksForWound(wound) {
  const t = Math.max(0, Math.min(1, wound));
  return 1 + Math.floor(t * 2.01);
}

/** Heat dumped onto the building (and its patches) for one observed hit. */
export function heatForWound(wound) {
  const t = Math.max(0, Math.min(1, wound));
  return 0.38 + t * 0.55;
}

/** Little torch — well under authored socket fire (inherent × 3). */
export function flameScale(intensity) {
  const a = Math.max(0, Math.min(1, intensity));
  return 0.30 + a * 0.40;
}

export function maxPatchesForType(type) {
  const fp = BUILDING_FOOTPRINTS[type];
  const tiles = Math.max(fp?.w ?? 2, fp?.h ?? 2);
  return Math.min(BUILDING_FIRE_MAX_PATCHES, 3 + tiles);
}

export function footprintHalf(type) {
  const fp = BUILDING_FOOTPRINTS[type] ?? { w: 2, h: 2 };
  return {
    hx: fp.w * TILE_SIZE_F * 0.46,
    hz: fp.h * TILE_SIZE_F * 0.46,
  };
}

/** Point on the axis-aligned footprint edge. `t` wraps on [0, 1). */
export function perimeterOffset(hx, hz, t) {
  const w = hx * 2;
  const h = hz * 2;
  const peri = Math.max(1e-6, 2 * (w + h));
  let d = (((t % 1) + 1) % 1) * peri;
  if (d < w) return { x: -hx + d, z: -hz };
  d -= w;
  if (d < h) return { x: hx, z: -hz + d };
  d -= h;
  if (d < w) return { x: hx - d, z: hz };
  d -= w;
  return { x: -hx, z: hz - d };
}

function rotateOffset(ox, oz, yaw) {
  if (!yaw) return { x: ox, z: oz };
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: ox * c - oz * s, z: ox * s + oz * c };
}

function patchWorld(st, p) {
  const rot = rotateOffset(p.ox, p.oz, st.yaw);
  return { x: st.x + rot.x, z: st.z + rot.z };
}

function liveIntensity(st, p) {
  return Math.min(1, p.heat * (0.52 + st.heat * 0.72));
}

/**
 * @param {{ random?: () => number }} [opts]
 */
export function createBuildingFire(opts = {}) {
  const random = opts.random ?? Math.random;
  /** @type {Map<number, {
   *   lastHp: number,
   *   ratio: number,
   *   heat: number,
   *   x: number,
   *   z: number,
   *   yaw: number,
   *   type: string,
   *   hidden: boolean,
   *   seen: boolean,
   *   patches: { ox: number, oz: number, yOff: number, heat: number, seed: number }[],
   * }>} */
  const states = new Map();

  function makePatch(type) {
    const { hx, hz } = footprintHalf(type);
    const off = perimeterOffset(hx, hz, random());
    const inset = 0.82 + random() * 0.10;
    return {
      ox: off.x * inset,
      oz: off.z * inset,
      yOff: 0.14 + random() * 0.52,
      heat: 0.58 + random() * 0.28,
      seed: random(),
    };
  }

  function describePatch(st, p) {
    const world = patchWorld(st, p);
    const intensity = liveIntensity(st, p);
    return {
      x: world.x,
      z: world.z,
      yOff: p.yOff,
      intensity,
      scale: flameScale(intensity),
      hidden: st.hidden,
    };
  }

  function applyHit(st, type, ratio) {
    const wound = fireWound(ratio);
    if (wound <= 0) return [];
    const boost = heatForWound(wound);
    st.heat = Math.min(1, st.heat + boost);
    for (let i = 0; i < st.patches.length; i++) {
      const p = st.patches[i];
      p.heat = Math.min(1, p.heat + boost * 0.88);
    }
    /** @type {ReturnType<typeof describePatch>[]} */
    const sparked = [];
    if (random() >= sparkChanceForWound(wound)) return sparked;
    const add = sparksForWound(wound);
    const cap = maxPatchesForType(type);
    for (let k = 0; k < add && st.patches.length < cap; k++) {
      const p = makePatch(type);
      st.patches.push(p);
      sparked.push(describePatch(st, p));
    }
    return sparked;
  }

  function decayState(st, dt, ratio) {
    if (!(dt > 0)) return;
    let rate = BUILDING_FIRE_DECAY_PER_SEC;
    if (ratio >= BUILDING_FIRE_HP_GATE) rate *= 2.1;
    st.heat = Math.max(0, st.heat - dt * rate);
    let w = 0;
    for (let i = 0; i < st.patches.length; i++) {
      const p = st.patches[i];
      const wobble = 0.82 + (p.seed % 1) * 0.36;
      p.heat = Math.max(0, p.heat - dt * rate * wobble);
      if (p.heat > BUILDING_FIRE_PATCH_MIN) st.patches[w++] = p;
    }
    st.patches.length = w;
  }

  /**
   * Record latest HP / pose and roll sparks for HP drops under the gate.
   * First sight never sparks — only later hits do.
   * @param {Array<{ hp?: number, maxHp?: number, built?: number, type?: string, x?: number, z?: number, yaw?: number }|null|undefined>|null|undefined} buildings
   * @param {{ hidden?: (b: object, index: number) => boolean }} [flags]
   */
  function sync(buildings, flags = {}) {
    for (const st of states.values()) st.seen = false;
    /** @type {ReturnType<typeof describePatch>[]} */
    const sparked = [];
    const n = buildings?.length ?? 0;
    for (let i = 0; i < n; i++) {
      const b = buildings[i];
      if (!b) continue;
      const maxHp = b.maxHp != null ? b.maxHp | 0 : 0;
      const hp = b.hp != null ? b.hp | 0 : maxHp;
      const built = b.built == null ? 1 : b.built | 0;
      const hidden = flags.hidden?.(b, i) === true;
      let st = states.get(i);
      const ratio = maxHp > 0 ? hp / maxHp : 1;
      if (!st) {
        st = {
          lastHp: hp,
          ratio,
          heat: 0,
          x: b.x,
          z: b.z,
          yaw: b.yaw || 0,
          type: b.type || '',
          hidden,
          seen: true,
          patches: [],
        };
        states.set(i, st);
        continue;
      }
      st.seen = true;
      st.x = b.x;
      st.z = b.z;
      st.yaw = b.yaw || 0;
      st.type = b.type || st.type;
      st.hidden = hidden;
      st.ratio = ratio;
      const dropped = hp < st.lastHp;
      if (dropped && built === 1 && !hidden && maxHp > 0) {
        const born = applyHit(st, b.type, ratio);
        for (let k = 0; k < born.length; k++) sparked.push(born[k]);
      }
      st.lastHp = hp;
    }
    return sparked;
  }

  /** Age flames. Orphaned buildings (left the list) keep fading out. */
  function tick(dtSec) {
    const dt = Number(dtSec);
    if (!(dt > 0)) return;
    for (const [i, st] of states) {
      decayState(st, dt, st.seen ? st.ratio : BUILDING_FIRE_HP_GATE);
      if (!st.seen && st.patches.length === 0 && st.heat <= 0) states.delete(i);
    }
  }

  function forEachLivePatch(fn) {
    for (const st of states.values()) {
      if (st.hidden || !st.patches.length) continue;
      for (let i = 0; i < st.patches.length; i++) {
        const p = describePatch(st, st.patches[i]);
        if (p.intensity < 0.08) continue;
        fn(p);
      }
    }
  }

  function snapshot() {
    const buildings = [];
    for (const [index, st] of states) {
      buildings.push({
        index,
        lastHp: st.lastHp,
        heat: st.heat,
        patches: st.patches.length,
        hidden: st.hidden,
        seen: st.seen,
      });
    }
    return { buildings, count: states.size };
  }

  function clear() {
    states.clear();
  }

  return { sync, tick, forEachLivePatch, snapshot, clear };
}
