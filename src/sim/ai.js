// Basic AI — generates commands for non-player owners.
//
// Called from app/ before step(); produces the same command objects as input.

import * as fx from './fixed.js';
import { CMD } from './commands.js';
import { getUnitDef } from './unitTypes.js';
import { isHostile } from './teams.js';

const AI_INTERVAL = 40; // ticks between attack-move orders (~2s)

/** @returns {import('./commands.js').Command[]} */
export function generateAiCommands(world, aiOwner, playerOwner = 0) {
  if (world.tick % AI_INTERVAL !== 0) return [];

  const ids = [];
  for (let i = 0; i < world.count; i++) {
    if (!world.alive[i] || world.owner[i] !== aiOwner) continue;
    const def = getUnitDef(world.type[i]);
    if (def.category !== 'military') continue;
    if (world.order[i] === world.ORDER.ATTACK || world.order[i] === world.ORDER.ATTACK_MOVE) continue;
    ids.push(i);
  }
  if (ids.length === 0) return [];

  // Rally point: centroid of nearest enemy cluster, or map center fallback.
  let ex = 0;
  let ey = 0;
  let ec = 0;
  for (let j = 0; j < world.count; j++) {
    if (!world.alive[j] || !isHostile(aiOwner, world.owner[j])) continue;
    ex += world.px[j];
    ey += world.py[j];
    ec++;
  }
  if (ec === 0) return [];

  const cx = fx.div(ex, fx.fromInt(ec));
  const cy = fx.div(ey, fx.fromInt(ec));

  const n = ids.length;
  const tx = new Array(n);
  const ty = new Array(n);
  let sx = 0;
  let sy = 0;
  for (let k = 0; k < n; k++) {
    sx += world.px[ids[k]];
    sy += world.py[ids[k]];
  }
  const scx = fx.div(sx, fx.fromInt(n));
  const scy = fx.div(sy, fx.fromInt(n));
  for (let k = 0; k < n; k++) {
    const i = ids[k];
    tx[k] = cx + (world.px[i] - scx);
    ty[k] = cy + (world.py[i] - scy);
  }

  return [{ type: CMD.ATTACK_MOVE, entities: ids, tx, ty }];
}
