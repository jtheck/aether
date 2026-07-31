// FNV-1a-style 32-bit hash over the full simulation state.
//
// In v1 checksums existed to DETECT desync after the fact. Here determinism is
// guaranteed by construction (fixed-point + seeded rng + fixed iteration order),
// so this is a VERIFICATION/debugging tool: two peers should produce the exact
// same checksum every tick. A mismatch means a bug in the sim, not a sync drift
// to paper over.

import { mixKothChecksum } from './kothMeta.js';

export function checksum(w) {
  let h = 0x811c9dc5 | 0;
  const mix = (v) => {
    h ^= v | 0;
    h = Math.imul(h, 0x01000193);
  };

  mix(w.tick);
  mix(w.count);
  mix(w.rng.s);
  mix(w.pathLosCursor);
  mix(w.pathAstarCursor);

  for (let i = 0; i < w.count; i++) {
    mix(w.alive[i]);
    if (!w.alive[i]) continue;
    mix(w.px[i]);
    mix(w.py[i]);
    mix(w.vx[i]);
    mix(w.vy[i]);
    mix(w.order[i]);
    mix(w.targetEntity[i]);
    mix(w.engagementTarget[i]);
    mix(w.engagementSlot[i]);
    mix(w.targetLoad[i]);
    mix(w.engagementMask[i]);
    mix(w.navWpCount[i]);
    mix(w.navWpIndex[i]);
    mix(w.pathRequest[i]);
    mix(w.navDestX[i]);
    mix(w.navDestY[i]);
    mix(w.attackCd[i]);
    mix(w.abilityCd[i]);
    mix(w.hp[i]);
    mix(w.type[i]);
    mix(w.owner[i]);
  }

  const p = w.projectiles;
  mix(p.activeCount);
  mix(p.freeTop);
  mix(p.highWater);
  mix(p.allocatorHash);
  for (let i = 0; i < p.highWater; i++) {
    mix(p.generation[i]);
    mix(p.alive[i]);
    if (!p.alive[i]) continue;
    mix(p.type[i]);
    mix(p.owner[i]);
    mix(p.source[i]);
    mix(p.target[i]);
    mix(p.px[i]);
    mix(p.py[i]);
    mix(p.vx[i]);
    mix(p.vy[i]);
    mix(p.aimX[i]);
    mix(p.aimY[i]);
    mix(p.damage[i]);
    mix(p.age[i]);
    mix(p.lifetime[i]);
    mix(p.hitCount[i]);
  }
  mix(w.kothMatchOver ?? 0);
  h = mixKothChecksum(h, mix, w.koth);

  return h >>> 0;
}

