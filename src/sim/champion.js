// Warrior → champion: permanent promotion after CHAMPION_KILLS hostile
// units they have wounded fall while the warrior is still within aggro.
// The last hit can belong to anyone. Same entity (orders, position, wounds).
// The champion mesh is its own VAT bake.

import * as fx from './fixed.js';
import { UNIT, getUnitDef } from './unitTypes.js';
import { unitMaxHp } from './namedUnit.js';
import { isHostile } from './teams.js';

/** Hostile units a living warrior needs wounded, and then dead, before promotion. */
export const CHAMPION_KILLS = 5;

export function becomeChampion(w, i) {
  if (!w.alive[i] || w.type[i] !== UNIT.WARRIOR) return false;
  const prevMax = unitMaxHp(w, i, getUnitDef(UNIT.WARRIOR).hp);
  const next = getUnitDef(UNIT.CHAMPION);
  const nextMax = unitMaxHp(w, i, next.hp);
  const missing = Math.max(0, prevMax - (w.hp[i] | 0));
  w.type[i] = next.id;
  w.speed[i] = next.speed;
  w.hp[i] = Math.max(1, nextMax - missing);
  return true;
}

function ensurePool(w, minTop) {
  const need = minTop | 0;
  const cur = w.damagedByAtk;
  if (cur && cur.length >= need) return;
  const cap = Math.max(64, need, (cur?.length ?? 0) * 2);
  const atk = new Int32Array(cap);
  const next = new Int32Array(cap);
  if (cur) {
    atk.set(cur);
    next.set(w.damagedByNext);
  }
  w.damagedByAtk = atk;
  w.damagedByNext = next;
}

function allocMark(w) {
  if ((w.damagedByFree ?? -1) >= 0) {
    const i = w.damagedByFree;
    w.damagedByFree = w.damagedByNext[i];
    return i;
  }
  const i = w.damagedByTop | 0;
  ensurePool(w, i + 1);
  w.damagedByTop = i + 1;
  return i;
}

/** Remember a hostile warrior hit. The same pair is stored once. */
export function noteWarriorDamage(w, source, target) {
  if (!w.damagedByHead) return;
  if (source < 0 || source >= w.count || source === target) return;
  if (!w.alive[source] || w.type[source] !== UNIT.WARRIOR) return;
  if (target < 0 || target >= w.count || !w.alive[target]) return;
  if (!isHostile(w.owner[target], w.owner[source])) return;
  let node = w.damagedByHead[target];
  while (node >= 0) {
    if (w.damagedByAtk[node] === source) return;
    node = w.damagedByNext[node];
  }
  const mark = allocMark(w);
  w.damagedByAtk[mark] = source;
  w.damagedByNext[mark] = w.damagedByHead[target];
  w.damagedByHead[target] = mark;
}

/** Still in the fight: within the warrior aggro radius of the dying unit. */
function warriorNearDeath(w, source, victim) {
  const limit = getUnitDef(UNIT.WARRIOR).aggroRange;
  return fx.dist2(w.px[source], w.py[source], w.px[victim], w.py[victim]) <= fx.mul(limit, limit);
}

function creditWarrior(w, source, victim) {
  if (!w.kills) return;
  if (source < 0 || source >= w.count) return;
  if (!w.alive[source] || w.type[source] !== UNIT.WARRIOR) return;
  if (!warriorNearDeath(w, source, victim)) return;
  const n = (w.kills[source] | 0) + 1;
  w.kills[source] = n > 255 ? 255 : n;
  if (n >= CHAMPION_KILLS) becomeChampion(w, source);
}

/** Each living warrior still near this death gains one kill, then the list is dropped. */
export function creditDamagedBy(w, victim) {
  if (!w.damagedByHead || victim < 0 || victim >= w.damagedByHead.length) return;
  let node = w.damagedByHead[victim];
  w.damagedByHead[victim] = -1;
  while (node >= 0) {
    const source = w.damagedByAtk[node];
    const next = w.damagedByNext[node];
    w.damagedByNext[node] = w.damagedByFree ?? -1;
    w.damagedByFree = node;
    node = next;
    creditWarrior(w, source, victim);
  }
}

/** Drop wound marks. Used when a checkpoint has no damage-credit block. */
export function resetDamageCredit(w) {
  if (w.damagedByHead) w.damagedByHead.fill(-1);
  w.damagedByFree = -1;
  w.damagedByTop = 0;
}

/** Grow the mark pool so a checkpoint can copy `top` nodes into it. */
export function ensureDamageCreditPool(w, minTop) {
  ensurePool(w, minTop);
}
