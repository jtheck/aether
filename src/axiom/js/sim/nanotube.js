/** (6,5) SWCNT honeycomb, blown up to pair/ring emitter scale. */

export const NANOTUBE_N = 6;
export const NANOTUBE_M = 5;
/** Graphene C–C (Å). */
export const CARBON_CC = 1.42;
/** Ring neighbor chord at r=10, n=6. */
export const NANOTUBE_BOND = 10;
export const NANOTUBE_SCALE = NANOTUBE_BOND / CARBON_CC;
export const NANOTUBE_Y0 = 0;
export const NANOTUBE_Y1 = 14;

/**
 * SWCNT radius (Å): R = a √(n²+nm+m²) / 2π, a = √3 a_cc.
 * (6,5) ≈ 3.73 Å (d ≈ 0.75 nm; CoMoCAT commercial average ~0.78 nm).
 * @param {number} [n]
 * @param {number} [m]
 * @param {number} [acc]
 */
export function nanotubeRadius(n = NANOTUBE_N, m = NANOTUBE_M, acc = CARBON_CC) {
  const a = Math.sqrt(3) * acc;
  return (a * Math.sqrt(n * n + n * m + m * m)) / (Math.PI * 2);
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

/**
 * Roll a graphene strip into a finite (n,m) tube along +Y.
 * @param {{ n?: number, m?: number, acc?: number, y0?: number, y1?: number, scale?: number }} [opts]
 */
export function buildNanotubeLattice(opts = {}) {
  const n = opts.n ?? NANOTUBE_N;
  const m = opts.m ?? NANOTUBE_M;
  const acc = opts.acc ?? CARBON_CC;
  const y0 = opts.y0 ?? NANOTUBE_Y0;
  const y1 = opts.y1 ?? NANOTUBE_Y1;
  const scale = opts.scale ?? NANOTUBE_SCALE;
  const a = Math.sqrt(3) * acc;
  const a1x = a;
  const a1y = 0;
  const a2x = a * 0.5;
  const a2y = a * (Math.sqrt(3) * 0.5);
  const bx = (a1x + a2x) / 3;
  const by = (a1y + a2y) / 3;

  const chx = n * a1x + m * a2x;
  const chy = n * a1y + m * a2y;
  const chLen = Math.sqrt(chx * chx + chy * chy);
  const R = chLen / (Math.PI * 2);
  const chHx = chx / chLen;
  const chHy = chy / chLen;

  const dR = gcd(2 * n + m, 2 * m + n);
  let Tx = ((2 * m + n) / dR) * a1x + (-(2 * n + m) / dR) * a2x;
  let Ty = ((2 * m + n) / dR) * a1y + (-(2 * n + m) / dR) * a2y;
  if (chx * Ty - chy * Tx < 0) {
    Tx = -Tx;
    Ty = -Ty;
  }
  const tLen = Math.sqrt(Tx * Tx + Ty * Ty);
  const tHx = Tx / tLen;
  const tHy = Ty / tLen;

  const pad = acc * 2;
  const corners = [
    [-pad, y0 - pad],
    [chLen + pad, y0 - pad],
    [-pad, y1 + pad],
    [chLen + pad, y1 + pad],
  ];
  let iMin = Infinity;
  let iMax = -Infinity;
  let jMin = Infinity;
  let jMax = -Infinity;
  for (const [c, z] of corners) {
    const gx = c * chHx + z * tHx;
    const gy = c * chHy + z * tHy;
    const j = (2 * gy) / (a * Math.sqrt(3));
    const i = (gx - j * (a * 0.5)) / a;
    iMin = Math.min(iMin, i);
    iMax = Math.max(iMax, i);
    jMin = Math.min(jMin, j);
    jMax = Math.max(jMax, j);
  }
  iMin = Math.floor(iMin) - 2;
  iMax = Math.ceil(iMax) + 2;
  jMin = Math.floor(jMin) - 2;
  jMax = Math.ceil(jMax) + 2;

  /** @type {{ x: number, y: number, z: number }[]} */
  const vertices = [];
  /** @type {Map<string, number>} */
  const cellToVert = new Map();
  /** @type {Map<string, number>} */
  const merge = new Map();

  const addAtom = (kind, i, j, gx, gy) => {
    const c = gx * chHx + gy * chHy;
    const z = gx * tHx + gy * tHy;
    if (z < y0 - 0.02 || z > y1 + 0.02) return;
    const cWrap = c - Math.floor(c / chLen) * chLen;
    const theta = (cWrap / chLen) * Math.PI * 2;
    const qk = `${Math.round((cWrap / chLen) * 1024)},${Math.round(z * 250)}`;
    let idx = merge.get(qk);
    if (idx === undefined) {
      idx = vertices.length;
      vertices.push({
        x: R * Math.cos(theta),
        y: z,
        z: R * Math.sin(theta),
      });
      merge.set(qk, idx);
    }
    cellToVert.set(`${kind},${i},${j}`, idx);
  };

  for (let i = iMin; i <= iMax; i++) {
    for (let j = jMin; j <= jMax; j++) {
      const ax = i * a1x + j * a2x;
      const ay = i * a1y + j * a2y;
      addAtom('A', i, j, ax, ay);
      addAtom('B', i, j, ax + bx, ay + by);
    }
  }

  /** @type {[number, number][]} */
  const edges = [];
  const seenE = new Set();
  const addEdge = (ia, ib) => {
    if (ia === undefined || ib === undefined || ia === ib) return;
    const lo = ia < ib ? ia : ib;
    const hi = ia < ib ? ib : ia;
    const key = `${lo},${hi}`;
    if (seenE.has(key)) return;
    const a = vertices[lo];
    const b = vertices[hi];
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < acc * 0.72 || len > acc * 1.28) return;
    seenE.add(key);
    edges.push([lo, hi]);
  };

  for (let i = iMin; i <= iMax; i++) {
    for (let j = jMin; j <= jMax; j++) {
      const ia = cellToVert.get(`A,${i},${j}`);
      if (ia === undefined) continue;
      addEdge(ia, cellToVert.get(`B,${i},${j}`));
      addEdge(ia, cellToVert.get(`B,${i - 1},${j}`));
      addEdge(ia, cellToVert.get(`B,${i},${j - 1}`));
    }
  }

  if (scale !== 1) {
    for (const v of vertices) {
      v.x *= scale;
      v.y *= scale;
      v.z *= scale;
    }
  }

  const positions = new Float32Array(edges.length * 6);
  let o = 0;
  for (const [ia, ib] of edges) {
    const a = vertices[ia];
    const b = vertices[ib];
    positions[o++] = a.x;
    positions[o++] = a.y;
    positions[o++] = a.z;
    positions[o++] = b.x;
    positions[o++] = b.y;
    positions[o++] = b.z;
  }

  /** @type {{ x: number, y: number, z: number }[][]} */
  const lines = edges.map(([ia, ib]) => [vertices[ia], vertices[ib]]);

  return {
    vertices,
    edges,
    lines,
    positions,
    radius: R * scale,
    radiusA: R,
    scale,
    n,
    m,
    acc,
    y0: y0 * scale,
    y1: y1 * scale,
  };
}

/** @type {ReturnType<typeof buildNanotubeLattice> | null} */
let cachedLattice = null;

export function getNanotubeLattice() {
  if (!cachedLattice) cachedLattice = buildNanotubeLattice();
  return cachedLattice;
}

/** Every carbon corner — ico-spheres / lattice joints. */
export function nanotubeCorners() {
  return getNanotubeLattice().vertices.map((v) => ({ x: v.x, y: v.y, z: v.z }));
}

/**
 * LOD subsample: well-spaced carbons (not the live sum — that uses every corner).
 * Default: two rings of six along the tube.
 */
export function nanotubeWaveSources(count = 12) {
  const { vertices, radius } = getNanotubeLattice();
  const n = Math.max(1, count | 0);
  const y0 = Math.min(...vertices.map((v) => v.y));
  const y1 = Math.max(...vertices.map((v) => v.y));
  const used = new Set();
  const out = [];
  const rings = n <= 6 ? 1 : 2;
  const around = Math.ceil(n / rings);
  for (let k = 0; k < n; k++) {
    const ring = rings === 1 ? 0.5 : (Math.floor(k / around) + 0.5) / rings;
    const slot = k % around;
    const targetY = y0 + (y1 - y0) * ring;
    const target = -Math.PI + ((slot + 0.5) * Math.PI * 2) / around;
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < vertices.length; i++) {
      if (used.has(i)) continue;
      const v = vertices[i];
      let dth = Math.atan2(v.z, v.x) - target;
      if (dth > Math.PI) dth -= Math.PI * 2;
      if (dth < -Math.PI) dth += Math.PI * 2;
      const score = Math.abs(dth) * radius + Math.abs(v.y - targetY) * 0.45;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break;
    used.add(best);
    const v = vertices[best];
    out.push({ x: v.x, y: v.y, z: v.z });
  }
  return out;
}
