// Minimum pad defense — brigand idle villagers, village monk queue.
// Stays on the eco rail unless captureIntent says the home pad matters.

import * as fx from './fixed.js';
import { CMD } from './commands.js';
import { ORDER } from './world.js';
import { UNIT, getUnitCost, getUnitDef } from './unitTypes.js';
import { ABILITY } from './abilities.js';
import { agoraForOwner } from './agora.js';
import { isHostile } from './teams.js';
import { canAffordBank, getResource } from './resources.js';
import {
  buildingIsFinished,
  BUILDING_MENUS,
} from './buildings.js';
import {
  captureIntent,
  resolveAiStrategy,
  shownHostiles,
} from './aiStrategy.js';
import { aiUsesFairVision, entitySeenByOwner } from './matchVision.js';

const PAD_DEFENSE_INTERVAL = 24;
const MAX_BRIGANDS_PER_STEP = 2;
const BRIGAND_YARD_F = 100;
const PAD_MONK_CAP = 1;
const BRIGAND_ARMY_MIN = 2;

/**
 * @param {object} w
 * @param {number} owner
 */
function militaryCount(w, owner) {
  let n = 0;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || (w.owner[i] | 0) !== owner) continue;
    if (getUnitDef(w.type[i]).category === 'military') n++;
  }
  return n;
}

function hasBarracks(w, owner) {
  const buildings = w.buildings;
  if (!buildings) return false;
  for (let b = 0; b < buildings.length; b++) {
    const bd = buildings[b];
    if ((bd.owner | 0) !== owner || bd.type !== 'barracks') continue;
    if (buildingIsFinished(bd)) return true;
  }
  return false;
}

/**
 * @param {object} w
 * @param {number} owner
 * @param {object} strategy
 */
function shouldBrigand(w, owner, strategy) {
  if (!brigandBankOk(w, owner)) return false;
  const heat = strategy.heat | 0;
  if (heat <= 1) return true;
  const army = militaryCount(w, owner);
  if (army >= BRIGAND_ARMY_MIN && hasBarracks(w, owner)) return false;
  return heat <= 3;
}

/**
 * @param {object} w
 * @param {number} owner
 */
function idleVillagers(w, owner) {
  const out = [];
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || (w.owner[i] | 0) !== owner) continue;
    if (w.type[i] !== UNIT.VILLAGER) continue;
    if (w.abilityCd[i] > 0) continue;
    if (w.order[i] !== ORDER.IDLE || (w.carriedAmt[i] | 0) !== 0) continue;
    out.push(i);
  }
  return out;
}

/**
 * @param {object} w
 * @param {number} owner
 * @param {number} nearX
 * @param {number} nearY
 */
function nearestHostileAim(w, field, strategy, owner, nearX, nearY) {
  const fair = aiUsesFairVision(strategy) && field;
  let best = -1;
  let bestD = 0x7fffffff;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || !isHostile(owner, w.owner[i])) continue;
    if (fair && !entitySeenByOwner(w, field, owner, i)) continue;
    if (getUnitDef(w.type[i]).category !== 'military') continue;
    const d = fx.dist2(w.px[i], w.py[i], nearX, nearY);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) return null;
  return { x: w.px[best], y: w.py[best] };
}

/**
 * @param {object} capture
 * @param {{ onHomePad: number, inYard: number }} yard
 */
function padNeedsLightDefense(capture, yard) {
  if (yard.onHomePad > 0 || yard.inYard > 0) return true;
  if ((capture.homeScore | 0) > 0 && capture.homeScore >= 0.03) return true;
  if (capture.guard) return true;
  return false;
}

/**
 * @param {object} w
 * @param {number} owner
 */
function brigandBankOk(w, owner) {
  const bank = {
    wood: getResource(w, owner, 'wood'),
    stone: getResource(w, owner, 'stone'),
    mineral: getResource(w, owner, 'mineral'),
    food: getResource(w, owner, 'food'),
  };
  return canAffordBank(bank, getUnitCost(UNIT.BRIGAND));
}

function finishedBuildingWithUnit(w, owner, unitKey) {
  const buildings = w.buildings;
  if (!buildings) return -1;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if ((b.owner | 0) !== owner || !buildingIsFinished(b)) continue;
    if (BUILDING_MENUS[b.type]?.units?.includes(unitKey)) return i;
  }
  return -1;
}

function livingAndQueuedMonk(w, owner) {
  let n = 0;
  for (let i = 0; i < w.count; i++) {
    if (w.alive[i] && w.owner[i] === owner && w.type[i] === UNIT.MONK) n++;
  }
  const buildings = w.buildings;
  if (!buildings) return n;
  for (let b = 0; b < buildings.length; b++) {
    const bd = buildings[b];
    if ((bd.owner | 0) !== owner || !bd.tracks) continue;
    for (let t = 0; t < bd.tracks.length; t++) {
      const tr = bd.tracks[t];
      if (tr.kind === 'unit' && tr.id === 'monk') n += tr.count | 0;
    }
  }
  return n;
}

/**
 * @param {object} w
 * @param {object} field
 * @param {{ owner: number, temperament?: string }} entry
 * @returns {import('./commands.js').Command[]}
 */
export function generatePadDefenseCommands(w, field, entry) {
  if (!field) return [];
  const strategy = resolveAiStrategy(entry);
  const owner = strategy.owner;
  if (owner < 0 || !strategy.economy) return [];

  const phase = (owner * 13) % PAD_DEFENSE_INTERVAL;
  if ((w.tick | 0) % PAD_DEFENSE_INTERVAL !== phase) return [];

  const capture = captureIntent(w, strategy, field);
  const yard = shownHostiles(w, owner, BRIGAND_YARD_F, field, strategy);
  if (!padNeedsLightDefense(capture, yard)) return [];

  const home = agoraForOwner(w.agoras, owner) ?? capture.home;
  if (!home) return [];

  /** @type {import('./commands.js').Command[]} */
  const cmds = [];

  const aim = nearestHostileAim(w, field, strategy, owner, home.x, home.z)
    ?? { x: home.x, y: home.z };

  if (shouldBrigand(w, owner, strategy)) {
    const idle = idleVillagers(w, owner);
    const limit = Math.min(MAX_BRIGANDS_PER_STEP, idle.length);
    for (let k = 0; k < limit; k++) {
      cmds.push({
        type: CMD.CAST,
        entities: [idle[k]],
        abilityId: ABILITY.VILLAGER_BRIGAND,
        tx: aim.x,
        ty: aim.y,
      });
    }
  }

  if (
    ((capture.guard || (capture.shown | 0) > 0) && (strategy.heat | 0) >= 1)
    && livingAndQueuedMonk(w, owner) < PAD_MONK_CAP
  ) {
    const bank = {
      wood: getResource(w, owner, 'wood'),
      stone: getResource(w, owner, 'stone'),
      mineral: getResource(w, owner, 'mineral'),
      food: getResource(w, owner, 'food'),
    };
    if (canAffordBank(bank, getUnitCost(UNIT.MONK))) {
      const bi = finishedBuildingWithUnit(w, owner, 'monk');
      if (bi >= 0) {
        cmds.push({
          type: CMD.QUEUE_TRAIN,
          playerId: owner,
          buildingIndex: bi,
          unitKey: 'monk',
        });
      }
    }
  }

  return cmds;
}
