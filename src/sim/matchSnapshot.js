// Ladder graph. Sampled in lockstep so both clients build the same series.
// Not part of the checksum. A checkpoint carries it so a restore stays aligned.

import { UNIT, UNIT_DEFS, getUnitCost } from './unitTypes.js';
import { MAX_RESOURCE_OWNERS, RESOURCE_COUNT, RESOURCE_KINDS } from './resources.js';

export const SNAP_SAMPLE_TICKS = 200;
export const SNAP_MAX_SAMPLES = 240;

const OWNERS = MAX_RESOURCE_OWNERS;

function blank() {
  return {
    prevGathered: new Int32Array(OWNERS),
    actions: new Int32Array(OWNERS),
    seen: new Set(),
    tech: [],
    samples: [],
  };
}

function ensure(w) {
  if (!w.snap) w.snap = blank();
  return w.snap;
}

function gatheredTotal(w, owner) {
  const arr = w.ownerGathered;
  if (!arr) return 0;
  let n = 0;
  const base = owner * RESOURCE_COUNT;
  for (let k = 0; k < RESOURCE_COUNT; k++) n += arr[base + k] | 0;
  return n;
}

function bankTotal(w, owner) {
  const arr = w.resources;
  if (!arr) return 0;
  let n = 0;
  const base = owner * RESOURCE_COUNT;
  for (let k = 0; k < RESOURCE_COUNT; k++) n += arr[base + k] | 0;
  return n;
}

function unitValue(typeId) {
  const cost = typeId === UNIT.CHAMPION ? getUnitCost(UNIT.WARRIOR) : getUnitCost(typeId);
  let n = 0;
  for (let i = 0; i < RESOURCE_KINDS.length; i++) n += cost[RESOURCE_KINDS[i]] | 0;
  return n;
}

function tally(w) {
  const villagers = new Int32Array(OWNERS);
  const army = new Int32Array(OWNERS);
  const count = w.count | 0;
  for (let i = 0; i < count; i++) {
    if (!w.alive?.[i]) continue;
    const owner = w.owner?.[i] | 0;
    if (owner < 0 || owner >= OWNERS) continue;
    const type = w.type?.[i] | 0;
    if (type === UNIT.VILLAGER || type === UNIT.BRIGAND) {
      villagers[owner] += 1;
      continue;
    }
    const category = UNIT_DEFS[type]?.category;
    if (category === 'civilian') continue;
    army[owner] += unitValue(type);
  }
  return { villagers, army };
}

/** One issued order. Selection, camera, and hill join or elimination are not orders. */
export function noteMatchAction(w, owner) {
  const o = owner | 0;
  if (!w || o < 0 || o >= OWNERS) return;
  ensure(w).actions[o] += 1;
}

function noteFirst(w, owner, kind, id) {
  const o = owner | 0;
  const name = String(id ?? '');
  if (!w || o < 0 || o >= OWNERS || !/^[a-z]{2,16}$/.test(name)) return;
  const snap = ensure(w);
  const key = `${kind}:${o}:${name}`;
  if (snap.seen.has(key) || snap.tech.length >= 64) return;
  snap.seen.add(key);
  snap.tech.push({ owner: o, kind, id: name, tick: w.tick | 0 });
}

export function noteMatchBuilding(w, owner, typeId) {
  noteFirst(w, owner, 'building', typeId);
}

export function noteMatchTech(w, owner, techId) {
  noteFirst(w, owner, 'research', techId);
}

/** Record the current counts and start a new action window. */
export function sampleMatch(w) {
  if (!w || (w.snap?.samples.length ?? 0) >= SNAP_MAX_SAMPLES) return;
  const snap = ensure(w);
  const { villagers, army } = tally(w);
  const row = {
    tick: w.tick | 0,
    v: new Int32Array(OWNERS),
    a: new Int32Array(OWNERS),
    i: new Int32Array(OWNERS),
    b: new Int32Array(OWNERS),
    p: new Int32Array(OWNERS),
  };
  for (let o = 0; o < OWNERS; o++) {
    const gathered = gatheredTotal(w, o);
    row.v[o] = villagers[o];
    row.a[o] = army[o];
    row.i[o] = Math.max(0, gathered - (snap.prevGathered[o] | 0));
    row.b[o] = bankTotal(w, o);
    row.p[o] = snap.actions[o] | 0;
    snap.prevGathered[o] = gathered;
  }
  snap.actions.fill(0);
  snap.samples.push(row);
  w.snapSampled = 1;
}

function copySample(sample, owners) {
  const pick = (arr) => owners.map((owner) => arr?.[owner] | 0);
  return {
    tick: sample.tick | 0,
    v: pick(sample.v),
    a: pick(sample.a),
    i: pick(sample.i),
    b: pick(sample.b),
    p: pick(sample.p),
  };
}

/** Series for the seats in this match, including a closing point at the current tick. */
export function exportMatchSnapshot(w, owners) {
  const snap = w?.snap;
  const seats = [];
  const seen = new Set();
  const list = owners?.length ? owners : null;
  if (list) {
    for (let i = 0; i < list.length; i++) {
      const owner = list[i] | 0;
      if (owner < 0 || owner >= OWNERS || seen.has(owner)) continue;
      seen.add(owner);
      seats.push(owner);
    }
  } else {
    for (let owner = 0; owner < OWNERS; owner++) {
      seen.add(owner);
      seats.push(owner);
    }
  }
  const samples = [];
  if (snap) {
    for (let i = 0; i < snap.samples.length; i++) samples.push(copySample(snap.samples[i], seats));
  }
  const tick = w?.tick | 0;
  if (!samples.length || samples[samples.length - 1].tick !== tick) {
    const { villagers, army } = w ? tally(w) : { villagers: new Int32Array(OWNERS), army: new Int32Array(OWNERS) };
    samples.push({
      tick,
      v: seats.map((owner) => villagers[owner] | 0),
      a: seats.map((owner) => army[owner] | 0),
      i: seats.map((owner) => Math.max(0, gatheredTotal(w, owner) - (snap?.prevGathered[owner] | 0))),
      b: seats.map((owner) => bankTotal(w, owner)),
      p: seats.map((owner) => snap?.actions[owner] | 0),
    });
    if (samples.length > SNAP_MAX_SAMPLES + 1) samples.splice(0, samples.length - (SNAP_MAX_SAMPLES + 1));
  }
  const tech = [];
  if (snap) {
    for (let i = 0; i < snap.tech.length; i++) {
      const row = snap.tech[i];
      if (!seen.has(row.owner)) continue;
      tech.push({ owner: row.owner, kind: row.kind, id: row.id, tick: row.tick | 0 });
    }
  }
  return { tick, owners: seats, samples, tech };
}

export function exportMatchSnapState(w) {
  const snap = w?.snap;
  if (!snap) return null;
  const pack = (arr) => Array.from(arr, (n) => n | 0);
  return {
    prevGathered: pack(snap.prevGathered),
    actions: pack(snap.actions),
    tech: snap.tech.map((row) => ({ owner: row.owner, kind: row.kind, id: row.id, tick: row.tick })),
    samples: snap.samples.map((sample) => ({
      tick: sample.tick | 0,
      v: pack(sample.v),
      a: pack(sample.a),
      i: pack(sample.i),
      b: pack(sample.b),
      p: pack(sample.p),
    })),
  };
}

export function importMatchSnapState(w, data) {
  if (!w) return;
  if (!data?.samples) {
    w.snap = null;
    return;
  }
  const snap = blank();
  const fill = (dest, src) => {
    if (!Array.isArray(src)) return;
    for (let i = 0; i < dest.length && i < src.length; i++) dest[i] = src[i] | 0;
  };
  fill(snap.prevGathered, data.prevGathered);
  fill(snap.actions, data.actions);
  if (Array.isArray(data.tech)) {
    for (let i = 0; i < data.tech.length && snap.tech.length < 64; i++) {
      const row = data.tech[i];
      const owner = row?.owner | 0;
      const id = String(row?.id ?? '');
      const kind = row?.kind === 'research' ? 'research' : 'building';
      if (owner < 0 || owner >= OWNERS || !/^[a-z]{2,16}$/.test(id)) continue;
      const key = `${kind}:${owner}:${id}`;
      if (snap.seen.has(key)) continue;
      snap.seen.add(key);
      snap.tech.push({ owner, kind, id, tick: row.tick | 0 });
    }
  }
  if (Array.isArray(data.samples)) {
    for (let i = 0; i < data.samples.length && snap.samples.length < SNAP_MAX_SAMPLES; i++) {
      const sample = data.samples[i];
      const row = {
        tick: sample?.tick | 0,
        v: new Int32Array(OWNERS),
        a: new Int32Array(OWNERS),
        i: new Int32Array(OWNERS),
        b: new Int32Array(OWNERS),
        p: new Int32Array(OWNERS),
      };
      fill(row.v, sample?.v);
      fill(row.a, sample?.a);
      fill(row.i, sample?.i);
      fill(row.b, sample?.b);
      fill(row.p, sample?.p);
      snap.samples.push(row);
    }
  }
  w.snap = snap;
}
