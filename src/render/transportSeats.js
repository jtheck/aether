// Rider seats from vehicle `spawn_anchor*` empties (position + suggested rotation).
// Coordinates are Lite world / bake space (glTF X-mirrored). Overflow still uses
// the old 2-column deck so a missing bake cannot leave passengers in the origin.

import { UNIT } from '../sim/unitTypes.js';
import { GENERATED_TRANSPORT_SEATS } from './transportSeats.generated.js';

/** Hang passengers this far under air transports when no seat empty exists. */
export const AIR_PASSENGER_DROP = 7;

const PASSENGER_COLS = 2;
const PASSENGER_SPACING = 1.2;

const TYPE_STEM = {
  [UNIT.WAGON]: 'wagon',
  [UNIT.APC]: 'apc',
  [UNIT.DIRIGIBLE]: 'dirigible',
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Yaw / pitch / roll matching unit instance matrices (Y, then X, then local Z).
 * @param {ArrayLike<number>} w column-major 4×4
 */
export function yawPitchRollFromWorldMatrix(w) {
  const sx = Math.hypot(w[0], w[1], w[2]) || 1;
  const sy = Math.hypot(w[4], w[5], w[6]) || 1;
  const sz = Math.hypot(w[8], w[9], w[10]) || 1;
  const zx = w[8] / sz;
  const zy = w[9] / sz;
  const zz = w[10] / sz;
  const pitch = -Math.asin(clamp(zy, -1, 1));
  const cp = Math.cos(pitch);
  const yaw = Math.abs(cp) > 1e-6
    ? Math.atan2(zx, zz)
    : Math.atan2(-w[2] / sx, w[0] / sx);
  const roll = Math.atan2(w[1] / sx, w[5] / sy);
  return {
    yaw: yaw || 0,
    pitch: pitch || 0,
    roll: roll || 0,
  };
}

/** glTF node TRS → column-major 4×4. */
export function gltfTrsToWorldMatrix(translation, rotation) {
  const [tx, ty, tz] = translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = rotation ?? [0, 0, 0, 1];
  const xx = qx * qx;
  const yy = qy * qy;
  const zz = qz * qz;
  const xy = qx * qy;
  const xz = qx * qz;
  const yz = qy * qz;
  const wx = qw * qx;
  const wy = qw * qy;
  const wz = qw * qz;
  return [
    1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 0,
    2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 0,
    2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0,
    tx, ty, tz, 1,
  ];
}

/** Lite LH conversion: conjugate by diag(-1, 1, 1, 1). */
export function mirrorXWorldMatrix(m) {
  return [
    m[0], -m[1], -m[2], 0,
    -m[4], m[5], m[6], 0,
    -m[8], m[9], m[10], 0,
    -m[12], m[13], m[14], 1,
  ];
}

/**
 * Authoring (glTF) empty → bake / instance-local seat.
 * @param {string} name
 * @param {number[] | undefined} translation
 * @param {number[] | undefined} rotation xyzw
 */
export function gltfNodeToLiteSeat(name, translation, rotation) {
  const lite = mirrorXWorldMatrix(gltfTrsToWorldMatrix(translation, rotation));
  const ypr = yawPitchRollFromWorldMatrix(lite);
  return {
    name,
    x: lite[12],
    y: lite[13],
    z: lite[14],
    yaw: ypr.yaw,
    pitch: ypr.pitch,
    roll: ypr.roll,
  };
}

/** Blender `foo` / `foo.001` suffix; missing suffix is 0. */
export function blenderDupIndex(name) {
  const m = /^(.+?)(?:\.(\d+))?$/i.exec(String(name ?? ''));
  if (!m) return 0;
  return m[2] ? parseInt(m[2], 10) : 0;
}

export function isSpawnAnchorName(name) {
  return /spawn_anchor/i.test(String(name ?? ''));
}

/**
 * @param {{ name?: string, x?: number, y?: number, z?: number, yaw?: number, pitch?: number, roll?: number }[] | null | undefined} sockets
 * @returns {{ name: string, x: number, y: number, z: number, yaw: number, pitch: number, roll: number }[]}
 */
export function spawnSeatsFromSockets(sockets) {
  const seats = [];
  for (const s of sockets ?? []) {
    if (s?.name && !isSpawnAnchorName(s.name)) continue;
    if (!s || (s.name == null && s.x == null && s.y == null && s.z == null)) continue;
    seats.push({
      name: s.name || `spawn_anchor.${seats.length}`,
      x: +s.x || 0,
      y: +s.y || 0,
      z: +s.z || 0,
      yaw: +s.yaw || 0,
      pitch: +s.pitch || 0,
      roll: +s.roll || 0,
    });
  }
  seats.sort((a, b) => {
    const d = blenderDupIndex(a.name) - blenderDupIndex(b.name);
    return d !== 0 ? d : a.name.localeCompare(b.name);
  });
  return seats;
}

export function seatsForUnitType(typeId) {
  const stem = TYPE_STEM[typeId];
  if (!stem) return [];
  return spawnSeatsFromSockets(GENERATED_TRANSPORT_SEATS[stem]);
}

/**
 * Model-local XZ → world XZ. Same yaw as building / unit instance matrices:
 * x' = c·lx + s·lz, z' = -s·lx + c·lz.
 */
export function seatLocalToWorld(tx, tz, yaw, lx, lz) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    x: tx + c * lx + s * lz,
    z: tz - s * lx + c * lz,
  };
}

export function passengerDeckOffset(slot, total) {
  const col = slot % PASSENGER_COLS;
  const row = (slot / PASSENGER_COLS) | 0;
  const rows = Math.max(1, Math.ceil(Math.max(1, total) / PASSENGER_COLS));
  return {
    x: (col - (PASSENGER_COLS - 1) / 2) * PASSENGER_SPACING,
    z: (row - (rows - 1) / 2) * PASSENGER_SPACING,
  };
}

function deckWorldOffset(offX, offZ, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    x: offX * c - offZ * s,
    z: offX * s + offZ * c,
  };
}

/**
 * @param {{
 *   tx: number, tz: number, vehicleYaw: number, vehicleLoft: number,
 *   seats: { x: number, y: number, z: number, yaw?: number, pitch?: number, roll?: number }[],
 *   slot: number, total: number,
 * }} opts
 */
export function posePassengerOnTransport(opts) {
  const { tx, tz, vehicleYaw, vehicleLoft, seats, slot, total } = opts;
  const seat = seats?.[slot];
  if (seat) {
    const xz = seatLocalToWorld(tx, tz, vehicleYaw, seat.x, seat.z);
    return {
      x: xz.x,
      z: xz.z,
      loft: vehicleLoft + seat.y,
      yaw: vehicleYaw + (seat.yaw || 0),
      pitch: seat.pitch || 0,
      roll: seat.roll || 0,
    };
  }
  const local = passengerDeckOffset(slot, total);
  const off = deckWorldOffset(local.x, local.z, vehicleYaw);
  const airDrop = vehicleLoft > 0 ? AIR_PASSENGER_DROP : 0;
  return {
    x: tx + off.x,
    z: tz + off.z,
    loft: Math.max(0, vehicleLoft - airDrop),
    yaw: vehicleYaw,
    pitch: 0,
    roll: 0,
  };
}

/** Prebake dump — seats already in Lite space. */
export function serializeGeneratedTransportSeats(byStem) {
  const stems = Object.keys(byStem).sort();
  const blocks = stems.map((stem) => {
    const seats = spawnSeatsFromSockets(byStem[stem]);
    if (!seats.length) return null;
    const rows = seats.map((s) => (
      `    Object.freeze({ x: ${s.x}, y: ${s.y}, z: ${s.z}, yaw: ${s.yaw}, pitch: ${s.pitch}, roll: ${s.roll} }),`
    ));
    return `  ${JSON.stringify(stem)}: Object.freeze([\n${rows.join('\n')}\n  ]),`;
  }).filter(Boolean);
  return `// AUTO-GENERATED by \`npm run prebake\` — do not edit by hand.
// Rider spawn empties (\`spawn_anchor*\`) from transport GLBs (Lite world space).

/** @type {Readonly<Record<string, readonly { x: number, y: number, z: number, yaw: number, pitch: number, roll: number }[]>>} */
export const GENERATED_TRANSPORT_SEATS = Object.freeze({
${blocks.join('\n')}
});
`;
}
