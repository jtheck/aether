// FNV-1a-style 32-bit hash over the full simulation state.
//
// In v1 checksums existed to DETECT desync after the fact. Here determinism is
// guaranteed by construction (fixed-point + seeded rng + fixed iteration order),
// so this is a VERIFICATION/debugging tool: two peers should produce the exact
// same checksum every tick. A mismatch means a bug in the sim, not a sync drift
// to paper over.

import { mixKothChecksum } from './kothMeta.js';
import { mixAgoraChecksum } from './agora.js';
import { mixBuildingChecksum } from './buildings.js';
import { mixTreeChecksum } from './trees.js';
import { mixRockChecksum } from './scenery.js';
import { mixFireZoneChecksum } from './fireZones.js';
import { mixFrogChecksum } from './frogs.js';
import { mixHolyArmorChecksum } from './holyArmor.js';
import { mixSporeGrowthChecksum } from './sporeBloom.js';
import { mixMonkLobChecksum } from './monkKick.js';
import { mixCombatStatusChecksum } from './combatStatus.js';
import { mixTechChecksum } from './tech.js';
import { mixResourceChecksum } from './resources.js';

export function checksum(w, field = null) {
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
    if (w.faceX) mix(w.faceX[i]);
    if (w.faceY) mix(w.faceY[i]);
    mix(w.order[i]);
    mix(w.targetEntity[i]);
    mix(w.engagementTarget[i]);
    mix(w.engagementSlot[i]);
    mix(w.targetLoad[i]);
    mix(w.engagementMask[i]);
    mix(w.navWpCount[i]);
    mix(w.navWpIndex[i]);
    mix(w.pathRequest[i]);
    if (w.pathSlowAware) mix(w.pathSlowAware[i]);
    mix(w.navDestX[i]);
    mix(w.navDestY[i]);
    mix(w.attackCd[i]);
    mix(w.abilityCd[i]);
    mix(w.distractCd[i]);
    mix(w.hp[i]);
    mix(w.type[i]);
    mix(w.owner[i]);
    if (w.carriedBy) mix(w.carriedBy[i]);
    if (w.transportTarget) mix(w.transportTarget[i]);
    if (w.gatherTile) mix(w.gatherTile[i]);
    if (w.carriedKind) mix(w.carriedKind[i]);
    if (w.carriedAmt) mix(w.carriedAmt[i]);
    if (w.gatherCd) mix(w.gatherCd[i]);
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
    if (p.wanderOx) mix(p.wanderOx[i]);
    if (p.wanderOy) mix(p.wanderOy[i]);
    mix(p.damage[i]);
    mix(p.age[i]);
    mix(p.lifetime[i]);
    mix(p.hitCount[i]);
  }
  mix(w.kothMatchOver ?? 0);
  mix(w.matchWinner ?? -1);
  h = mixKothChecksum(h, mix, w.koth);
  h = mixAgoraChecksum(h, mix, w.agoras);
  h = mixBuildingChecksum(h, mix, w.buildings);
  mixTechChecksum(h, mix, w);
  mixResourceChecksum(h, mix, w);
  if (field) mixTreeChecksum(mix, field);
  if (field) mixRockChecksum(mix, field);
  mixFireZoneChecksum(mix, w);
  mixFrogChecksum(mix, w);
  mixHolyArmorChecksum(mix, w);
  mixCombatStatusChecksum(mix, w);
  mixSporeGrowthChecksum(mix, w);
  mixMonkLobChecksum(mix, w);
  if (w.squadId) {
    mix(w.nextSquadId | 0);
    for (let i = 0; i < w.count; i++) {
      if (!w.alive[i]) continue;
      mix(w.squadId[i]);
    }
  }

  return h >>> 0;
}

