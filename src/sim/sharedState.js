// SharedArrayBuffer layout for main-thread render/input ↔ worker sim sync.
// Worker writes after each step; main copies out on stepDone (no torn reads).

import { MAX_ENTITIES } from './world.js';

const HEADER_I32 = 2; // [0]=count, [1]=tick

export function simSharedByteSize() {
  return (
    HEADER_I32 * 4 +
    MAX_ENTITIES * 4 + // px
    MAX_ENTITIES * 4 + // py
    MAX_ENTITIES * 4 + // hp
    MAX_ENTITIES + // alive
    MAX_ENTITIES + // owner
    MAX_ENTITIES // type (written once at init)
  );
}

export function mapSharedState(sab) {
  let o = 0;
  const header = new Int32Array(sab, o, HEADER_I32);
  o += HEADER_I32 * 4;
  const px = new Int32Array(sab, o, MAX_ENTITIES);
  o += MAX_ENTITIES * 4;
  const py = new Int32Array(sab, o, MAX_ENTITIES);
  o += MAX_ENTITIES * 4;
  const hp = new Int32Array(sab, o, MAX_ENTITIES);
  o += MAX_ENTITIES * 4;
  const alive = new Uint8Array(sab, o, MAX_ENTITIES);
  o += MAX_ENTITIES;
  const owner = new Uint8Array(sab, o, MAX_ENTITIES);
  o += MAX_ENTITIES;
  const type = new Uint8Array(sab, o, MAX_ENTITIES);
  return { header, px, py, hp, alive, owner, type };
}

export function publishType(w, s) {
  s.type.set(w.type.subarray(0, w.count));
}

export function publishWorld(w, s) {
  const n = w.count;
  s.header[0] = n;
  s.header[1] = w.tick;
  s.px.set(w.px.subarray(0, n));
  s.py.set(w.py.subarray(0, n));
  s.hp.set(w.hp.subarray(0, n));
  s.alive.set(w.alive.subarray(0, n));
  s.owner.set(w.owner.subarray(0, n));
}

/** Read-only facade matching the fields input/render expect from world. */
export function simViewFacade(s) {
  return {
    get count() {
      return s.header[0];
    },
    get tick() {
      return s.header[1];
    },
    px: s.px,
    py: s.py,
    hp: s.hp,
    alive: s.alive,
    owner: s.owner,
    type: s.type,
  };
}
