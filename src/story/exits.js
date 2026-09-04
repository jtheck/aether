// Dirt road + pad so chapter exits read on the board.

import { refreshTerrainDerived, TERRAIN, TILE_SIZE_F } from '../sim/field.js';
import { paintTerrainBrush } from '../sim/tableShape.js';
import { objectiveWorldPos } from './objectives.js';

export const EXIT_RING_TINT = Object.freeze([1, 0.78, 0.18]);

export function paintExitPad(field, tx, tz, r = 5) {
  paintTerrainBrush(field, tx, tz, TERRAIN.DIRT, Math.max(2, r | 0));
}

export function paintExitRoad(field, x0, z0, x1, z1, width = 2) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    paintTerrainBrush(
      field,
      Math.round(x0 + dx * t),
      Math.round(z0 + dz * t),
      TERRAIN.DIRT,
      width,
    );
  }
}

/** Road from the spawn tile to the zone, then a dirt disc on the exit. */
export function markChapterExit(field, fromTx, fromTz, obj) {
  if (!field || !obj) return;
  paintExitRoad(field, fromTx, fromTz, obj.tx, obj.tz, 2);
  paintExitPad(field, obj.tx, obj.tz, Math.max(3, obj.r | 0));
  refreshTerrainDerived(field);
}

export function exitRingSpec(obj, field) {
  const pos = objectiveWorldPos(obj, field);
  return {
    x: pos.x,
    z: pos.z,
    radius: Math.max(2, Number(obj.r) || 4) * TILE_SIZE_F,
    tint: EXIT_RING_TINT,
  };
}

export function exitLabel(obj) {
  if (obj?.next || obj?.kind === 'escape' || obj?.kind === 'advance') return 'EXIT';
  return 'HERE';
}

/**
 * World-anchored EXIT tags. Rings are drawn by the renderer.
 * @param {{
 *   host?: HTMLElement | null,
 *   worldToScreen?: (x: number, y: number, z: number) => { x: number, y: number } | null,
 * }} [opts]
 */
export function createExitMarks(opts = {}) {
  const canDom = typeof document !== 'undefined';
  const host = opts.host ?? (canDom ? document.body : null);
  let layer = null;
  let zones = [];
  let field = null;
  let hidden = true;

  if (canDom && host) {
    layer = host.querySelector('#story-exit-marks');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'story-exit-marks';
      layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:17';
      host.appendChild(layer);
    }
  }

  function paint() {
    if (!layer) return;
    layer.replaceChildren();
    if (hidden || !zones.length) {
      layer.style.display = 'none';
      return;
    }
    let any = false;
    for (const obj of zones) {
      const pos = objectiveWorldPos(obj, field);
      const scr = opts.worldToScreen?.(pos.x, 6, pos.z);
      if (!scr) continue;
      any = true;
      const el = document.createElement('div');
      el.style.cssText = [
        'position:absolute',
        `left:${Math.round(scr.x)}px`,
        `top:${Math.round(scr.y)}px`,
        'transform:translate(-50%,-120%)',
        'padding:4px 10px',
        'border-radius:8px',
        'background:rgba(0,0,0,.7)',
        'color:#fc4',
        'font:700 15px/1 sans-serif',
        'letter-spacing:.08em',
        'text-shadow:0 1px 3px #000',
      ].join(';');
      el.textContent = exitLabel(obj);
      layer.appendChild(el);
    }
    layer.style.display = any ? 'block' : 'none';
  }

  return {
    set(list, nextField, { hidden: hide = false } = {}) {
      zones = (list || []).filter((o) => !o.completed);
      field = nextField || null;
      hidden = hide || !zones.length;
      paint();
      return hidden ? [] : zones.map((o) => exitRingSpec(o, field));
    },
    tick: paint,
    hide() {
      zones = [];
      hidden = true;
      paint();
    },
    dispose() {
      layer?.remove();
      layer = null;
      zones = [];
    },
  };
}
