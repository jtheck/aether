// Help-card roster. Stats come from the sim defs; the squares are a
// relative read (more filled = more of that stat among this list).

import * as fx from '../sim/fixed.js';
import { UNIT, UNIT_DEFS } from '../sim/unitTypes.js';
import {
  BUILDING_HP,
  BUILDING_MENUS,
  BUILDING_MODEL_URLS,
  BUILD_TIME,
  PLACEABLE_BUILDINGS,
  UPGRADE_DEFS,
  UPGRADE_MODEL_URLS,
  getBuildingDisplayName,
} from '../sim/buildings.js';
import { bakedSpriteUrl } from '../render/bakedAssets.js';
import { localHudSkin, resolveUnitModelUrl } from './dlcCatalog.js';

export const HELP_PIPS = 5;

function portraitUrl(glbUrl) {
  return glbUrl ? bakedSpriteUrl(glbUrl) : '';
}

function unitPortrait(typeId) {
  return portraitUrl(resolveUnitModelUrl(typeId, localHudSkin(typeId)));
}

/** 0 when there is none. Otherwise 1–5 against the list maximum. */
export function helpPips(value, max) {
  const v = Number(value);
  const m = Number(max);
  if (!(v > 0) || !(m > 0)) return 0;
  const n = Math.round((v / m) * HELP_PIPS);
  if (n < 1) return 1;
  if (n > HELP_PIPS) return HELP_PIPS;
  return n;
}

const UNIT_NOTE = {
  [UNIT.VILLAGER]: 'Gathers and builds. Comes from the Village.',
  [UNIT.BRIGAND]: 'Temporary torch fighter. Ability or pointed attack; reverts when idle or sent to work.',
  [UNIT.WARRIOR]: 'Melee. Trained at the Barracks. Becomes a Champion after five wounded enemies fall nearby.',
  [UNIT.CHAMPION]: 'Melee. A warrior who was still nearby when five wounded enemies fell.',
  [UNIT.ARCHER]: 'Ranged. Trained at the Barracks.',
  [UNIT.WARLOCK]: 'Ranged. Fireball. Trained at the Tavern.',
  [UNIT.PRIEST]: 'Ranged. Holy armor. Does not attack buildings. Trained at the Church.',
  [UNIT.MYCO]: 'Ranged. Spore bloom. Trained at the Camp.',
  [UNIT.SHAMAN]: 'Ranged. Plague of frogs. Trained at the Grove.',
  [UNIT.WIZARD]: 'Ranged. Lightning. Trained at the Tower.',
  [UNIT.MONK]: 'Melee. Does not attack buildings. Trained at the Village.',
  [UNIT.ENGINEER]: 'Builds. Does not fight. Trained at the Village.',
  [UNIT.WAGON]: 'Carries 4. Trained at the Workshop.',
  [UNIT.DIRIGIBLE]: 'Flies. Carries 6. Trained at the Perch.',
  [UNIT.APC]: 'Melee. Carries 6. Trained at the Factory.',
};

const BUILDING_NOTE = {
  camp: 'Wood. Trains Myco.',
  village: 'Villagers gather here. Trains Engineers and Monks.',
  silo: 'Extra storage beside a camp, mine, or farm.',
  farm: 'Food.',
  mine: 'Stone and mineral. Upgrades to a Derrick.',
  derrick: 'Temporary mineral rig on a Mine. Collapses into a Well.',
  well: 'Mineral trickle after the Derrick collapses.',
  tower: 'Trains Wizards. Needs a Camp.',
  tavern: 'Recruits Warlocks. Researches Patronage. Needs a Camp.',
  lab: 'Researches Artillery. Needs a Camp.',
  barracks: 'Trains Warriors and Archers. Researches Drayage. Needs a Village.',
  workshop: 'Builds Wagons. Researches Armor and Scribes. Needs a Village.',
  factory: 'Makes APCs.',
  church: 'Trains Priests.',
  moonwell: 'Researches Prospecting and Stewardship.',
  perch: 'Harbor Dirigibles.',
  grove: 'Train Shaman.',
};

const UPGRADE_NOTE = {
  patronage: 'Researched at the Tavern.',
  armor: 'Researched at the Workshop.',
  artillery: 'Researched at the Lab.',
  drayage: 'Adds another rally point. Researched at the Barracks.',
  prospecting: 'Researched at the Moon Well.',
  scribes: 'You can hold more before income is taxed. Researched at the Workshop.',
  stewardship: 'Researched at the Moon Well.',
};

/**
 * Base unit beside its upgrade (v1 upgradeTo arcs). `null` upgrade = reserved slot.
 * @type {readonly (readonly [number, number | null])[]}
 */
export const HELP_UNIT_ROWS = Object.freeze([
  [UNIT.VILLAGER, UNIT.BRIGAND],
  [UNIT.ENGINEER, null],
  [UNIT.MONK, null],
  [UNIT.WARRIOR, UNIT.CHAMPION],
  [UNIT.ARCHER, null],
  [UNIT.WIZARD, null],
  [UNIT.WARLOCK, null],
  [UNIT.MYCO, null],
  [UNIT.PRIEST, null],
  [UNIT.SHAMAN, null],
  [UNIT.WAGON, null],
  [UNIT.DIRIGIBLE, null],
  [UNIT.APC, null],
]);

/** v1 upgradeTo display names for help placeholders (not in sim yet). */
const HELP_UNIT_FUTURE_NAME = Object.freeze({
  [UNIT.ENGINEER]: 'Architect',
  [UNIT.MONK]: 'Paladin',
  [UNIT.WIZARD]: 'Elemental',
  [UNIT.WARLOCK]: 'Geomancer',
  [UNIT.ARCHER]: 'Marksman',
  [UNIT.WAGON]: 'War Wagon',
  [UNIT.DIRIGIBLE]: 'War Balloon',
  [UNIT.APC]: 'Tank',
  [UNIT.PRIEST]: 'Valkyrie',
  [UNIT.MYCO]: 'Alchemist',
  [UNIT.SHAMAN]: 'Druid',
});

const UNIT_STAT_SHELL = Object.freeze([
  { label: 'Health', pips: 0 },
  { label: 'Speed', pips: 0 },
  { label: 'Damage', pips: 0 },
]);

/** @returns {({ kind: 'unit', id: string } | { kind: 'gap' })[]} */
export function helpUnitLayout() {
  /** @type {({ kind: 'unit', id: string } | { kind: 'gap' })[]} */
  const slots = [];
  for (const [base, upgrade] of HELP_UNIT_ROWS) {
    slots.push({ kind: 'unit', id: String(base) });
    if (upgrade == null) slots.push({ kind: 'gap' });
    else slots.push({ kind: 'unit', id: String(upgrade) });
  }
  return slots;
}

export function helpUnitCards() {
  const units = UNIT_DEFS;
  const maxHp = Math.max(...units.map((d) => d.hp));
  const maxSpeed = Math.max(...units.map((d) => fx.toFloat(d.speed)));
  const maxDamage = Math.max(...units.map((d) => d.attackDamage));
  return units.map((def) => ({
    id: String(def.id),
    name: def.name,
    sprite: unitPortrait(def.id),
    note: UNIT_NOTE[def.id] ?? '',
    stats: [
      { label: 'Health', pips: helpPips(def.hp, maxHp) },
      { label: 'Speed', pips: helpPips(fx.toFloat(def.speed), maxSpeed) },
      { label: 'Damage', pips: helpPips(def.attackDamage, maxDamage) },
    ],
  }));
}

/** Placeable pads plus structure-upgrade forms shown in help pairs. */
const HELP_BUILDING_IDS = Object.freeze([
  ...PLACEABLE_BUILDINGS.map((b) => b.id),
  'derrick',
  'well',
]);

export const HELP_BUILDING_ORDER = Object.freeze(
  PLACEABLE_BUILDINGS.flatMap((b) => (b.id === 'mine' ? ['mine', 'derrick', 'well'] : [b.id])),
);

export const HELP_UPGRADE_ORDER = Object.freeze(Object.keys(UPGRADE_DEFS));

export function helpBuildingCards() {
  const ids = HELP_BUILDING_IDS;
  const maxHp = Math.max(...ids.map((id) => BUILDING_HP[id] ?? 0));
  const maxTime = Math.max(...ids.map((id) => BUILD_TIME[id] ?? 0));
  return ids.map((id) => ({
    id,
    name: getBuildingDisplayName(id),
    sprite: portraitUrl(BUILDING_MODEL_URLS[id]),
    note: BUILDING_NOTE[id] ?? '',
    stats: [
      { label: 'Health', pips: helpPips(BUILDING_HP[id] ?? 0, maxHp) },
      { label: 'Time', pips: helpPips(BUILD_TIME[id] ?? 0, maxTime) },
    ],
  }));
}

export function helpUpgradeCards() {
  const ids = Object.keys(UPGRADE_DEFS);
  return ids.map((id) => ({
    id,
    name: UPGRADE_DEFS[id].name,
    sprite: portraitUrl(UPGRADE_MODEL_URLS[id]),
    note: UPGRADE_NOTE[id] ?? `Researched at the ${upgradeHome(id)}.`,
    stats: [],
  }));
}

function upgradeHome(id) {
  for (const [typeId, menu] of Object.entries(BUILDING_MENUS)) {
    if (menu.upgrades?.includes(id)) return getBuildingDisplayName(typeId);
  }
  return 'building menu';
}

function pipGroup(stat, pipClass = 'help-pip') {
  const pips = document.createElement('span');
  pips.className = 'help-pips';
  pips.setAttribute('aria-label', `${stat.label} ${stat.pips} of ${HELP_PIPS}`);
  for (let i = 0; i < HELP_PIPS; i++) {
    const pip = document.createElement('span');
    pip.className = i < stat.pips ? `${pipClass} is-on` : pipClass;
    pips.append(pip);
  }
  return pips;
}

const UNIT_STAT_ABBR = { Health: 'Hp', Speed: 'Spd', Damage: 'Dmg' };
const BUILDING_STAT_ABBR = { Health: 'Hp', Time: 'Time' };

function portraitImg(src, small) {
  if (!src) return null;
  const img = document.createElement('img');
  img.className = small ? 'help-sprite help-sprite-sm' : 'help-sprite';
  img.alt = '';
  img.draggable = false;
  img.src = src;
  img.addEventListener('error', () => img.remove());
  return img;
}

function unitTileFace(card, statAbbr, { empty = false } = {}) {
  const face = document.createElement('div');
  face.className = empty ? 'help-unit-tile help-unit-tile--empty' : 'help-unit-tile';
  const portrait = portraitImg(card.sprite, false);
  if (portrait) face.append(portrait);
  const name = document.createElement('span');
  name.className = 'help-unit-tile-name';
  name.textContent = card.name ?? '';
  face.append(name);
  const statList = card.stats?.length ? card.stats : [];
  if (statList.length) {
    const statsWrap = document.createElement('span');
    statsWrap.className = 'help-unit-tile-stats';
    for (const stat of statList) {
      const row = document.createElement('span');
      row.className = 'help-unit-mini-stat';
      const label = document.createElement('span');
      label.className = 'help-unit-mini-label';
      label.textContent = statAbbr[stat.label] ?? stat.label;
      row.append(label, pipGroup(stat, 'help-pip help-pip-mini'));
      statsWrap.append(row);
    }
    face.append(statsWrap);
  }
  return face;
}

function rosterCell(card, statAbbr) {
  const cell = document.createElement('div');
  cell.className = 'help-unit-cell';
  cell.append(unitTileFace(card, statAbbr));
  if (card.note) {
    const note = document.createElement('p');
    note.className = 'help-unit-inline-note';
    note.textContent = card.note;
    cell.append(note);
  }
  return cell;
}

function rosterFutureSlot(baseUnitId, statAbbr) {
  const placeholder = {
    name: HELP_UNIT_FUTURE_NAME[baseUnitId] ?? '',
    stats: UNIT_STAT_SHELL,
  };
  const cell = document.createElement('div');
  cell.className = 'help-unit-cell';
  cell.append(unitTileFace(placeholder, statAbbr, { empty: true }));
  return cell;
}

/** @param {readonly (readonly [string, string | null])[]} rows */
function fillPairRoster(host, rows, cards, statAbbr) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  host.replaceChildren();
  for (const [baseId, upgradeId] of rows) {
    const pair = document.createElement('div');
    pair.className = 'help-unit-pair';
    const baseCard = byId.get(String(baseId));
    if (baseCard) pair.append(rosterCell(baseCard, statAbbr));
    if (upgradeId != null) {
      const upCard = byId.get(String(upgradeId));
      if (upCard) pair.append(rosterCell(upCard, statAbbr));
    } else {
      pair.append(rosterFutureSlot(baseId, statAbbr));
    }
    host.append(pair);
  }
}

function entryStatsRow(card, statAbbr) {
  const stats = document.createElement('span');
  stats.className = 'help-entry-stats';
  for (const stat of card.stats) {
    const row = document.createElement('span');
    row.className = 'help-unit-mini-stat';
    const label = document.createElement('span');
    label.className = 'help-unit-mini-label';
    label.textContent = statAbbr[stat.label] ?? stat.label;
    row.append(label, pipGroup(stat, 'help-pip help-pip-mini'));
    stats.append(row);
  }
  return stats;
}

function entryRow(card, statAbbr, { compact = false } = {}) {
  const row = document.createElement('div');
  row.className = 'help-entry-row';
  const portrait = portraitImg(card.sprite, compact);
  if (portrait) {
    row.classList.add('help-entry-row--pic');
    row.append(portrait);
  }
  const main = document.createElement('div');
  main.className = 'help-entry-main';
  const name = document.createElement('span');
  name.className = 'help-entry-name';
  name.textContent = card.name;
  main.append(name);
  if (card.stats.length) main.append(entryStatsRow(card, statAbbr));
  if (card.note) {
    const note = document.createElement('p');
    note.className = 'help-entry-note';
    note.textContent = card.note;
    main.append(note);
  }
  row.append(main);
  return row;
}

/** @param {readonly string[]} order */
function fillEntryRoster(host, order, cards, statAbbr, { compact = false } = {}) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  host.replaceChildren();
  host.classList.add('help-entry-roster');
  for (const id of order) {
    const card = byId.get(id);
    if (card) host.append(entryRow(card, statAbbr, { compact }));
  }
}

function syncSectionBodies(root) {
  for (const details of root.querySelectorAll('details')) {
    const body = details.querySelector(':scope > .help-body');
    if (!body) continue;
    const sync = () => { body.hidden = !details.open; };
    sync();
    details.addEventListener('toggle', sync);
  }
}

/** Fill the unit, building, and upgrade squares inside the help card. */
export function mountHelpRoster(root) {
  if (!root?.querySelector) return;
  const units = root.querySelector('#help-units');
  const buildings = root.querySelector('#help-buildings');
  const upgrades = root.querySelector('#help-upgrades');
  if (units) {
    fillPairRoster(
      units,
      HELP_UNIT_ROWS.map(([b, u]) => [String(b), u == null ? null : String(u)]),
      helpUnitCards(),
      UNIT_STAT_ABBR,
    );
  }
  if (buildings) fillEntryRoster(buildings, HELP_BUILDING_ORDER, helpBuildingCards(), BUILDING_STAT_ABBR);
  if (upgrades) fillEntryRoster(upgrades, HELP_UPGRADE_ORDER, helpUpgradeCards(), {}, { compact: true });
  syncSectionBodies(root);
}
