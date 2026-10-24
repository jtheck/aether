// One match graph: Village, Army, Income, or the build timeline.
// History and the match-over card both mount this.

import { bakedSpriteUrl } from '../render/bakedAssets.js';
import {
  BUILDING_MODEL_URLS,
  UPGRADE_DEFS,
  UPGRADE_MODEL_URLS,
  getBuildingDisplayName,
} from '../sim/buildings.js';
import { mapTypeById } from '../sim/mapType.js';
import { matchStatOwners, matchStatRows } from './matchStats.js';

const COLORS = ['#5ee0e0', '#e07070', '#e0b050', '#c9a0ff', '#8fd48f'];
const METRICS = [
  ['villagers', 'Village'],
  ['army', 'Army'],
  ['income', 'Income'],
  ['build', 'Build'],
];

export function snapClock(tick) {
  const sec = Math.max(0, Math.round((tick | 0) / 20));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const FIELD_TILES = { tiny: 80, small: 144, medium: 208, large: 272, huge: 336 };
const ICON = 40;

function cleanLabel(value) {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 48);
}

function sizeWord(fieldSize, tiles) {
  const named = String(fieldSize || '').trim().toLowerCase();
  if (FIELD_TILES[named]) return named.charAt(0).toUpperCase() + named.slice(1);
  const w = tiles | 0;
  for (const [name, n] of Object.entries(FIELD_TILES)) {
    if (n === w) return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return w > 0 ? `${w}×${w}` : '';
}

/** Custom gardens keep their title. A generated field is its size and seed. */
export function mapLabels(garden, replay) {
  const type = mapTypeById(garden?.mt)?.name || mapTypeById(replay?.mode)?.name || '';
  const custom = Boolean(String(replay?.chapter || '').trim() || String(replay?.gardenUrl || '').trim());
  if (custom) {
    return { name: cleanLabel(garden?.n || garden?.name), type, size: '', seed: '' };
  }
  const seed = (replay?.seed ?? garden?.s ?? garden?.seed);
  const seedText = seed == null || seed === '' ? '' : String(seed >>> 0);
  return {
    name: '',
    type,
    size: sizeWord(replay?.fieldSize, garden?.w || replay?.mapW),
    seed: seedText,
  };
}

function bankAverage(samples, playerIndex) {
  let acc = 0;
  let span = 0;
  let prev = 0;
  for (const sample of samples) {
    const dt = (sample.tick | 0) - prev;
    if (dt > 0) {
      acc += (sample.bank?.[playerIndex] | 0) * dt;
      span += dt;
    }
    prev = sample.tick | 0;
  }
  return span ? Math.round(acc / span) : 0;
}

function matchApm(samples, playerIndex, tick) {
  let actions = 0;
  for (const sample of samples) actions += sample.actions?.[playerIndex] | 0;
  const span = tick | 0;
  if (span <= 0) return 0;
  return Math.round((actions * 1200) / span);
}

function statFor(doc, player, index) {
  const stats = doc.stats || [];
  if (player?.playerId) {
    const found = stats.find((row) => row.playerId === player.playerId);
    if (found) return found;
  }
  return stats[index] || {};
}

function techIcon(kind, id) {
  const url = kind === 'research' ? UPGRADE_MODEL_URLS[id] : BUILDING_MODEL_URLS[id];
  return url ? bakedSpriteUrl(url) : '';
}

function techName(kind, id) {
  if (kind === 'research') return UPGRADE_DEFS[id]?.name || id;
  return getBuildingDisplayName(id);
}

function drawLine(canvas, doc, key) {
  const players = doc.players || [];
  const samples = doc.samples || [];
  const width = 520;
  const height = 180;
  const left = 40;
  const right = 8;
  const top = 8;
  const bottom = 18;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx || !samples.length) return;
  ctx.clearRect(0, 0, width, height);
  ctx.font = '11px system-ui, sans-serif';
  const lines = players.map((_, p) => samples.map((sample) => sample[key]?.[p] | 0));
  let max = 1;
  for (const line of lines) {
    for (const n of line) if (n > max) max = n;
  }
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const yAt = (n) => top + plotH - (n / max) * plotH;
  const xAt = (s) => left + (samples.length <= 1 ? plotW / 2 : (s / (samples.length - 1)) * plotW);
  ctx.strokeStyle = '#2a3140';
  ctx.fillStyle = '#8b93a7';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const n of [max, Math.round(max / 2), 0]) {
    const y = yAt(n);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
    ctx.fillText(String(n), left - 4, y);
  }
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('0:00', left, height - 14);
  ctx.textAlign = 'right';
  ctx.fillText(snapClock(doc.tick), width - right, height - 14);
  for (let p = 0; p < lines.length; p++) {
    ctx.strokeStyle = COLORS[p % COLORS.length];
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    lines[p].forEach((n, s) => {
      const x = xAt(s);
      const y = yAt(n);
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}

function buildTimeline(doc) {
  const wrap = document.createElement('div');
  wrap.className = 'snap-build';
  const players = doc.players || [];
  const duration = doc.tick | 0;
  const axis = document.createElement('div');
  axis.className = 'snap-axis';
  const start = document.createElement('span');
  start.textContent = '0:00';
  const end = document.createElement('span');
  end.textContent = snapClock(duration);
  axis.append(start, end);
  wrap.append(axis);
  const byPlayer = new Map(players.map((player, i) => [player.playerId, i]));
  let any = false;
  players.forEach((player, i) => {
    const events = (doc.tech || []).filter((row) => {
      if (row.playerId && player.playerId) return row.playerId === player.playerId;
      return byPlayer.get(row.playerId) === i || row.playerIndex === i;
    });
    const lane = document.createElement('div');
    lane.className = 'snap-lane';
    const track = document.createElement('div');
    track.className = 'snap-track';
    track.style.boxShadow = `inset 3px 0 0 ${COLORS[i % COLORS.length]}`;
    const placed = [];
    for (const row of events) {
      const x = duration > 0 ? Math.min(1, Math.max(0, (row.tick | 0) / duration)) : 0;
      let stack = 0;
      while (placed.some((mark) => mark.stack === stack && Math.abs(mark.x - x) < 0.12)) stack += 1;
      placed.push({ x, stack });
      const mark = document.createElement('span');
      mark.className = 'snap-mark';
      mark.style.left = `${x * 100}%`;
      mark.style.top = `${2 + stack * (ICON + 2)}px`;
      mark.title = `${player.name || 'Player'} ${techName(row.kind, row.id)} ${snapClock(row.tick)}`;
      const src = techIcon(row.kind, row.id);
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = techName(row.kind, row.id);
        mark.append(img);
      } else {
        mark.textContent = techName(row.kind, row.id).slice(0, 1);
      }
      track.append(mark);
      any = true;
    }
    const stacks = placed.reduce((n, mark) => Math.max(n, mark.stack), 0);
    track.style.height = `${ICON + 4 + stacks * (ICON + 2)}px`;
    lane.append(track);
    wrap.append(lane);
  });
  if (!any) {
    const empty = document.createElement('p');
    empty.className = 'snap-empty';
    empty.textContent = 'No buildings finished.';
    wrap.append(empty);
  }
  return wrap;
}

function paintView(host, doc, metric) {
  host.replaceChildren();
  if (metric === 'build') {
    host.append(buildTimeline(doc));
  } else {
    const canvas = document.createElement('canvas');
    canvas.className = 'snap-chart';
    host.append(canvas);
    drawLine(canvas, doc, metric);
  }
}

function cell(text, title, group) {
  const td = document.createElement('td');
  td.textContent = String(text);
  if (title) td.title = title;
  if (group) td.className = 'snap-g';
  return td;
}

function statsTable(doc) {
  const samples = doc.samples || [];
  const table = document.createElement('table');
  table.className = 'snap-stats';
  const groups = document.createElement('tr');
  const labels = document.createElement('tr');
  const nameHead = document.createElement('th');
  groups.append(nameHead);
  labels.append(document.createElement('th'));
  const heads = [
    ['Units', ['Killed', 'Trained', 'Lost']],
    ['Buildings', ['Razed', 'Lost']],
    ['Resources', ['Gathered', 'Spent']],
    ['Average', ['Unspent', 'APM']],
  ];
  for (const [group, cols] of heads) {
    const th = document.createElement('th');
    th.className = 'snap-g';
    th.colSpan = cols.length;
    th.textContent = group;
    groups.append(th);
    cols.forEach((label, i) => {
      const col = document.createElement('th');
      if (i === 0) col.className = 'snap-g';
      col.textContent = label;
      if (label === 'Lost' && group === 'Units') col.title = 'Units lost';
      if (label === 'Lost' && group === 'Buildings') col.title = 'Buildings lost';
      if (label === 'Razed') col.title = 'Buildings razed';
      if (label === 'Trained') col.title = 'Units trained';
      if (label === 'Unspent') col.title = 'Average resources in hand';
      if (label === 'APM') col.title = 'Actions per minute over the match';
      labels.append(col);
    });
  }
  table.append(groups, labels);
  (doc.players || []).forEach((player, i) => {
    const src = statFor(doc, player, i);
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.textContent = player.name || src.name || 'Player';
    name.style.color = COLORS[i % COLORS.length];
    tr.append(name);
    const values = [
      [src.kills | 0, '', true],
      [src.trained | 0, '', false],
      [src.losses | 0, '', false],
      [src.razes | 0, '', true],
      [src.buildingsLost | 0, '', false],
      [src.gathered | 0, kindTitle(src.gatheredBy), true],
      [src.spent | 0, kindTitle(src.spentBy), false],
      [bankAverage(samples, i), '', true],
      [matchApm(samples, i, doc.tick), '', false],
    ];
    for (const [value, title, group] of values) tr.append(cell(value, title, group));
    table.append(tr);
  });
  return table;
}

function kindTitle(split) {
  if (!split) return '';
  return `wood ${split.wood}   stone ${split.stone}   mineral ${split.mineral}   food ${split.food}`;
}

export function snapCaption(doc) {
  const bits = [];
  if (doc?.map) bits.push(doc.map);
  if (doc?.mapType) bits.push(doc.mapType);
  if (doc?.mapSize) bits.push(doc.mapSize);
  if (doc?.mapSeed) bits.push(`seed ${doc.mapSeed}`);
  bits.push(snapClock(doc?.tick));
  return bits.join(' · ');
}

export function mountMatchSnapshot(parent, doc, opts) {
  const root = document.createElement('div');
  root.className = 'snap';
  if (opts?.caption !== false) {
    const meta = document.createElement('p');
    meta.className = 'snap-meta';
    meta.textContent = snapCaption(doc);
    root.append(meta);
  }
  const stage = document.createElement('div');
  stage.className = 'snap-stage';
  const keys = document.createElement('div');
  keys.className = 'snap-keys';
  const view = document.createElement('div');
  view.className = 'snap-view';
  let current = 'villagers';
  for (const [id, label] of METRICS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'snap-key';
    btn.textContent = label;
    btn.setAttribute('aria-pressed', id === current ? 'true' : 'false');
    btn.addEventListener('click', () => {
      current = id;
      for (const other of keys.children) other.setAttribute('aria-pressed', other === btn ? 'true' : 'false');
      paintView(view, doc, current);
    });
    keys.append(btn);
  }
  stage.append(keys, view);
  root.append(stage, statsTable(doc));
  parent.append(root);
  paintView(view, doc, current);
}

/** Local end-of-match doc. `nameOf(owner)` supplies the seat's display name. */
export function snapshotDocFromSession(session, nameOf) {
  const snap = session?.snap;
  const seats = matchStatOwners(session);
  const owners = seats?.length ? seats : (snap?.owners || []).map((owner) => owner | 0);
  const rows = matchStatRows(session?.ownerStats, owners.length ? owners : null);
  if (!rows.length && !(snap?.samples?.length)) return null;
  const index = new Map((snap?.owners || []).map((owner, i) => [owner | 0, i]));
  const at = (arr, seat) => arr?.[index.get(seat | 0)] | 0;
  const list = rows.length ? rows.map((row) => row.owner) : owners;
  const players = list.map((seat) => ({
    playerId: String(seat),
    seat,
    name: nameOf?.(seat) || `Player ${seat}`,
  }));
  const samples = (snap?.samples || []).map((sample) => ({
    tick: sample.tick | 0,
    villagers: list.map((seat) => at(sample.v, seat)),
    army: list.map((seat) => at(sample.a, seat)),
    income: list.map((seat) => at(sample.i, seat)),
    bank: list.map((seat) => at(sample.b, seat)),
    actions: list.map((seat) => at(sample.p, seat)),
  }));
  const allowed = new Set(list);
  const tech = [];
  for (const row of snap?.tech || []) {
    if (!allowed.has(row.owner | 0)) continue;
    tech.push({
      playerId: String(row.owner | 0),
      kind: row.kind,
      id: row.id,
      tick: row.tick | 0,
    });
  }
  const byOwner = new Map(rows.map((row) => [row.owner, row]));
  const stats = list.map((seat) => {
    const src = byOwner.get(seat) || {};
    return {
      playerId: String(seat),
      kills: src.kills | 0,
      losses: src.losses | 0,
      trained: src.trained | 0,
      razes: src.razes | 0,
      buildingsLost: src.buildingsLost | 0,
      gathered: src.gathered | 0,
      spent: src.spent | 0,
      gatheredBy: src.gatheredBy ?? null,
      spentBy: src.spentBy ?? null,
    };
  });
  const map = mapLabels(session?.replayGarden, session?.replayConfig);
  return {
    tick: snap?.tick | 0 || session?.confirmedTick | 0,
    map: map.name,
    mapType: map.type,
    mapSize: map.size,
    mapSeed: map.seed,
    players,
    samples,
    tech,
    stats,
  };
}
