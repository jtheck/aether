// graffiti.png is one raster, so the seed head can't shed real paths.
// A click samples those pixels and blows the seeds off to the right, shrinking as they go.

const HEAD_X = 0.62;
const HEAD_Y = 0.32;
const HEAD_CX = 0.74;
const HEAD_CY = 0.23;
const MAX_SEEDS = 200;

const FALLBACK = [
  { x: 0.68, y: 0.16 },
  { x: 0.74, y: 0.12 },
  { x: 0.80, y: 0.16 },
  { x: 0.70, y: 0.22 },
  { x: 0.76, y: 0.24 },
  { x: 0.82, y: 0.22 },
  { x: 0.72, y: 0.28 },
  { x: 0.78, y: 0.18 },
];

/** @type {{ x: number, y: number }[] | null} */
let headCache = null;

/** @type {HTMLElement | null} */
let layer = null;

/** @type {Seed[]} */
let seeds = [];

let raf = 0;
let last = 0;

/**
 * @typedef {object} Seed
 * @property {HTMLElement} el
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} burstVx
 * @property {number} burstVy
 * @property {number} recede
 * @property {number} delay
 * @property {number} life
 * @property {number} age
 * @property {number} phase
 * @property {number} flutter
 */

/** @param {HTMLImageElement} img */
export function blowGraffiti(img) {
  // A click is the player asking for the gust, so it still runs when the OS
  // requests less ambient motion.
  const rect = img.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return;

  const points = headPoints(img);
  const originX = rect.left + HEAD_CX * rect.width;
  const originY = rect.top + HEAD_CY * rect.height;
  const host = ensureLayer();

  // Each click adds a gust. Seeds already in the air keep going.
  for (let i = 0; i < 18; i++) release(host, points, rect, originX, originY, false);
  for (let i = 0; i < 8; i++) release(host, points, rect, originX, originY, true);
  kick();
}

/**
 * @param {HTMLElement} host
 * @param {{ x: number, y: number }[]} points
 * @param {DOMRect} rect
 * @param {number} originX
 * @param {number} originY
 * @param {boolean} mote
 */
function release(host, points, rect, originX, originY, mote) {
  while (seeds.length >= MAX_SEEDS) seeds.shift()?.el.remove();

  const pt = points[(Math.random() * points.length) | 0];
  const x = rect.left + pt.x * rect.width;
  const y = rect.top + pt.y * rect.height;
  let dx = x - originX;
  let dy = y - originY;
  let olen = Math.hypot(dx, dy);
  if (olen < 3) {
    const a = Math.random() * Math.PI * 2;
    dx = Math.cos(a);
    dy = Math.sin(a);
    olen = 1;
  }
  dx /= olen;
  dy /= olen;

  // Peel off the head, blow right, and lift past the top of the screen while they shrink.
  const burst = 55 + Math.random() * 90;
  const wind = (mote ? 170 : 140) + Math.random() * 160;
  const lift = -55 - Math.random() * (mote ? 110 : 80);
  const dist = Math.hypot((pt.x - HEAD_CX) / 0.16, (pt.y - HEAD_CY) / 0.12);

  const el = document.createElement('span');
  el.className = 'dandelion-seed';
  const size = mote ? 2.5 + Math.random() * 1.6 : 4.5 + Math.random() * 2.5;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  host.appendChild(el);

  const seed = {
    el,
    x,
    y,
    vx: wind,
    vy: lift,
    burstVx: dx * burst,
    burstVy: dy * burst,
    recede: (mote ? 0.08 : 0.12) + Math.random() * 0.16,
    delay: Math.max(0, 1 - dist) * 0.08 + Math.random() * 0.04,
    life: (mote ? 1.35 : 1.7) + Math.random() * 0.55,
    age: 0,
    phase: Math.random() * Math.PI * 2,
    flutter: mote ? 3 + Math.random() * 5 : 5 + Math.random() * 8,
  };
  place(seed, 0, 0, 1);
  seeds.push(seed);
}

/** @param {HTMLImageElement} img */
function headPoints(img) {
  if (headCache) return headCache;
  const sampled = sampleHead(img);
  if (sampled) headCache = sampled;
  return sampled || FALLBACK;
}

/** @param {HTMLImageElement} img */
function sampleHead(img) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  let data;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }
  const pts = [];
  const yMax = Math.floor(h * HEAD_Y);
  const xMin = Math.floor(w * HEAD_X);
  for (let y = 0; y < yMax; y += 2) {
    for (let x = xMin; x < w; x += 2) {
      if (data[(y * w + x) * 4 + 3] > 170) pts.push({ x: x / w, y: y / h });
    }
  }
  return pts.length ? pts : null;
}

function ensureLayer() {
  if (layer?.isConnected) return layer;
  layer = document.createElement('div');
  layer.className = 'dandelion-puff';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  return layer;
}

function kick() {
  if (raf) return;
  last = performance.now();
  raf = requestAnimationFrame(tick);
}

/** @param {number} now */
function tick(now) {
  const dt = Math.min(0.034, (now - last) / 1000);
  last = now;
  let i = 0;
  while (i < seeds.length) {
    if (step(seeds[i], dt)) {
      i += 1;
    } else {
      seeds[i].el.remove();
      seeds[i] = seeds[seeds.length - 1];
      seeds.pop();
    }
  }
  if (seeds.length) {
    raf = requestAnimationFrame(tick);
    return;
  }
  raf = 0;
  layer?.remove();
  layer = null;
}

/**
 * @param {Seed} s
 * @param {number} dt
 */
function step(s, dt) {
  s.age += dt;
  if (s.age >= s.life) return false;
  const fly = s.age - s.delay;
  let rot = 0;
  let opacity = 1;
  let scale = 1;
  let sway = 0;
  if (fly > 0) {
    const kick = Math.exp(-fly * 4.2);
    const caught = 1 - Math.exp(-fly * 2.6);
    const ix = s.burstVx * kick + s.vx * caught;
    const iy = s.burstVy * kick + s.vy * caught;
    s.phase += dt * 5.5;
    s.x += ix * dt;
    s.y += iy * dt;
    sway = Math.sin(s.phase) * s.flutter * Math.min(1, fly * 3);
    rot = Math.atan2(iy, ix) * (180 / Math.PI) + 90 + Math.sin(s.phase * 0.7) * 10;
    const u = fly / (s.life - s.delay);
    const away = u * u * (3 - 2 * u);
    opacity = u < 0.72 ? 1 : 1 - (u - 0.72) / 0.28;
    scale = 1 - away * (1 - s.recede);
  }
  place(s, sway, rot, scale);
  s.el.style.opacity = String(Math.max(0, opacity));
  return true;
}

/**
 * @param {Seed} s
 * @param {number} sway
 * @param {number} rot
 * @param {number} scale
 */
function place(s, sway, rot, scale) {
  s.el.style.transform = `translate(${s.x + sway}px, ${s.y}px) translate(-50%, -50%) rotate(${rot}deg) scale(${scale})`;
}

