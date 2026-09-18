/**
 * Three short scopes at left / here / right.
 * Each frame the curve is the live field at that site over one period — not a travel history.
 */

import { sampleCompressionWaveTrace } from './sim/behaviors.js';

const SAMPLES = 140;
const U_SCALE = 7;
const SLOT_W = 188;
const SLOT_H = 44;
const SEP = 23;

/**
 * Camera-right offsets for the side probes.
 * @param {{ x: number, y: number, z: number, billboard?: { rx?: number, ry?: number, rz?: number } }} pose
 * @param {number} [sep]
 */
export function probeSites(pose, sep = SEP) {
  const rx = pose?.billboard?.rx ?? 1;
  const ry = pose?.billboard?.ry ?? 0;
  const rz = pose?.billboard?.rz ?? 0;
  const len = Math.hypot(rx, ry, rz) || 1;
  const dx = (rx / len) * sep;
  const dy = (ry / len) * sep;
  const dz = (rz / len) * sep;
  const x = pose?.x ?? 0;
  const y = pose?.y ?? 0;
  const z = pose?.z ?? 0;
  return {
    left: { x: x - dx, y: y - dy, z: z - dz },
    here: { x, y, z },
    right: { x: x + dx, y: y + dy, z: z + dz },
  };
}

export function attachFieldProbe() {
  const traces = [
    new Float32Array(SAMPLES),
    new Float32Array(SAMPLES),
    new Float32Array(SAMPLES),
  ];

  const wrap = document.createElement('div');
  wrap.id = 'field_probe';
  wrap.style.cssText =
    'position:fixed;left:0;right:0;bottom:12px;height:44px;z-index:15;pointer-events:none;';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;';
  wrap.appendChild(canvas);
  document.body.appendChild(wrap);
  const ctx = canvas.getContext('2d');

  function layout() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth || window.innerWidth;
    const h = wrap.clientHeight || SLOT_H;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
  }
  layout();
  window.addEventListener('resize', layout);

  function drawTrace(ox, oy, slotW, slotH, buf) {
    const mid = oy + slotH * 0.5;
    const gain = (slotH * 0.42) / U_SCALE;
    ctx.strokeStyle = 'rgba(255,255,255,0.72)';
    ctx.lineWidth = Math.max(1, slotH / 36);
    ctx.beginPath();
    for (let i = 0; i < SAMPLES; i++) {
      const x = ox + (i / (SAMPLES - 1)) * (slotW - 1);
      const y = mid - buf[i] * gain;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function paint() {
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    const dpr = w / Math.max(1, wrap.clientWidth || window.innerWidth);
    let slotW = SLOT_W * dpr;
    let gap = (w - slotW * 3) / 4;
    if (gap < 8 * dpr) {
      gap = 8 * dpr;
      slotW = Math.max(32 * dpr, (w - gap * 4) / 3);
    }
    for (let i = 0; i < 3; i++) {
      drawTrace(gap + i * (slotW + gap), 0, slotW, h, traces[i]);
    }
  }

  return {
    /**
     * Rebuild all three curves at the current sites / sim time.
     * @param {{ left: { x: number, y: number, z: number }, here: { x: number, y: number, z: number }, right: { x: number, y: number, z: number } }} sites
     * @param {number} time
     */
    show(sites, time) {
      const pts = [sites?.left, sites?.here, sites?.right];
      for (let i = 0; i < 3; i++) {
        const p = pts[i] ?? { x: 0, y: 0, z: 0 };
        sampleCompressionWaveTrace(p.x, p.y, p.z, time, traces[i]);
      }
      paint();
    },
    dispose() {
      window.removeEventListener('resize', layout);
      wrap.remove();
    },
  };
}
