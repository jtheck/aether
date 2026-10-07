// Help-card roster. Stats come from the sim defs; the squares are a
// relative read (more filled = more of that stat among this list).

import * as fx from '../sim/fixed.js';
import { UNIT, UNIT_DEFS } from '../sim/unitTypes.js';
import {
  BUILDING_HP,
  BUILDING_MENUS,
  BUILD_TIME,
  PLACEABLE_BUILDINGS,
  UPGRADE_DEFS,
  getBuildingDisplayName,
} from '../sim/buildings.js';

export const HELP_PIPS = 5;

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
  [UNIT.WARRIOR]: 'Melee. Trained at the Barracks.',
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
  mine: 'Stone and mineral.',
  tower: 'Trains Wizards. Needs a Camp.',
  tavern: 'Trains Warlocks. Researches Patronage. Needs a Camp.',
  lab: 'Researches Artillery. Needs a Camp.',
  barracks: 'Trains Warriors and Archers. Researches Drayage. Needs a Village.',
  workshop: 'Trains Wagons. Researches Armor and Scribes. Needs a Village.',
  factory: 'Trains APCs.',
  church: 'Trains Priests.',
  moonwell: 'Researches Prospecting and Stewardship.',
  perch: 'Trains Dirigibles.',
  grove: 'Trains Shamans.',
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

function listedUnits() {
  return UNIT_DEFS.filter((def) => def.id !== UNIT.BRIGAND);
}

export function helpUnitCards() {
  const units = listedUnits();
  const maxHp = Math.max(...units.map((d) => d.hp));
  const maxSpeed = Math.max(...units.map((d) => fx.toFloat(d.speed)));
  const maxDamage = Math.max(...units.map((d) => d.attackDamage));
  return units.map((def) => ({
    id: String(def.id),
    name: def.name,
    note: UNIT_NOTE[def.id] ?? '',
    stats: [
      { label: 'Health', pips: helpPips(def.hp, maxHp) },
      { label: 'Speed', pips: helpPips(fx.toFloat(def.speed), maxSpeed) },
      { label: 'Damage', pips: helpPips(def.attackDamage, maxDamage) },
    ],
  }));
}

export function helpBuildingCards() {
  const list = PLACEABLE_BUILDINGS;
  const maxHp = Math.max(...list.map((b) => BUILDING_HP[b.id] ?? 0));
  const maxTime = Math.max(...list.map((b) => BUILD_TIME[b.id] ?? 0));
  return list.map((b) => ({
    id: b.id,
    name: b.name,
    note: BUILDING_NOTE[b.id] ?? '',
    stats: [
      { label: 'Health', pips: helpPips(BUILDING_HP[b.id] ?? 0, maxHp) },
      { label: 'Time', pips: helpPips(BUILD_TIME[b.id] ?? 0, maxTime) },
    ],
  }));
}

export function helpUpgradeCards() {
  const ids = Object.keys(UPGRADE_DEFS);
  return ids.map((id) => ({
    id,
    name: UPGRADE_DEFS[id].name,
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

function pipRow(stat) {
  const row = document.createElement('div');
  row.className = 'help-stat';
  const label = document.createElement('span');
  label.textContent = stat.label;
  const pips = document.createElement('span');
  pips.className = 'help-pips';
  pips.setAttribute('aria-label', `${stat.label} ${stat.pips} of ${HELP_PIPS}`);
  for (let i = 0; i < HELP_PIPS; i++) {
    const pip = document.createElement('span');
    pip.className = i < stat.pips ? 'help-pip is-on' : 'help-pip';
    pips.append(pip);
  }
  row.append(label, pips);
  return row;
}

function renderDetail(card) {
  const title = document.createElement('h4');
  title.textContent = card.name;
  const frag = document.createDocumentFragment();
  frag.append(title);
  for (const stat of card.stats) frag.append(pipRow(stat));
  if (card.note) {
    const note = document.createElement('p');
    note.textContent = card.note;
    frag.append(note);
  }
  return frag;
}

function fillRoster(host, detail, cards) {
  host.replaceChildren();
  for (const card of cards) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'help-tile';
    btn.dataset.helpId = card.id;
    btn.textContent = card.name;
    btn.setAttribute('aria-pressed', 'false');
    host.append(btn);
  }
  host.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    if (!btn || !host.contains(btn)) return;
    const already = btn.classList.contains('is-on');
    for (const tile of host.querySelectorAll('button')) {
      tile.classList.remove('is-on');
      tile.setAttribute('aria-pressed', 'false');
    }
    if (already) {
      detail.hidden = true;
      detail.replaceChildren();
      return;
    }
    btn.classList.add('is-on');
    btn.setAttribute('aria-pressed', 'true');
    const card = cards.find((c) => c.id === btn.dataset.helpId);
    if (!card) return;
    detail.replaceChildren(renderDetail(card));
    detail.hidden = false;
    requestAnimationFrame(() => detail.scrollIntoView({ block: 'start' }));
  });
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
  const unitDetail = root.querySelector('#help-units-detail');
  const buildings = root.querySelector('#help-buildings');
  const buildingDetail = root.querySelector('#help-buildings-detail');
  const upgrades = root.querySelector('#help-upgrades');
  const upgradeDetail = root.querySelector('#help-upgrades-detail');
  if (units && unitDetail) fillRoster(units, unitDetail, helpUnitCards());
  if (buildings && buildingDetail) fillRoster(buildings, buildingDetail, helpBuildingCards());
  if (upgrades && upgradeDetail) fillRoster(upgrades, upgradeDetail, helpUpgradeCards());
  syncSectionBodies(root);
}
