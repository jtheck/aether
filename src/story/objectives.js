// Adventure zones on a garden. Reach is a checkpoint; escape / advance end the chapter.

import { formatGameNumber } from '../sim/formatGameNumber.js';
import { TILE_SIZE_F, worldHalfFFromField } from '../sim/field.js';

export const OBJ_REACH = 'reach';
export const OBJ_ESCAPE = 'escape';
export const OBJ_ADVANCE = 'advance';
export const OBJ_KINDS = Object.freeze([OBJ_REACH, OBJ_ESCAPE, OBJ_ADVANCE]);

function kindOf(raw) {
  const k = String(raw || '').trim().toLowerCase();
  return OBJ_KINDS.includes(k) ? k : OBJ_REACH;
}

function fieldHalf(field) {
  return field?.worldHalfF ?? (field ? worldHalfFFromField(field) : 0);
}

export function objectiveWorldPos(obj, field) {
  const half = fieldHalf(field);
  return {
    x: ((obj.tx | 0) + 0.5) * TILE_SIZE_F - half,
    z: ((obj.tz | 0) + 0.5) * TILE_SIZE_F - half,
  };
}

export function zoneContains(obj, x, z, field) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const c = objectiveWorldPos(obj, field);
  const r = Math.max(0.5, Number(obj.r) || 4) * TILE_SIZE_F;
  const dx = x - c.x;
  const dz = z - c.z;
  return dx * dx + dz * dz <= r * r;
}

export function normalizeObjective(raw, index = 0) {
  if (Array.isArray(raw)) {
    return normalizeObjective({
      tx: raw[0],
      tz: raw[1],
      r: raw[2],
      kind: raw[3],
      message: raw[4],
      next: raw[5],
      label: raw[6],
      id: raw[7],
    }, index);
  }
  const kind = kindOf(raw?.kind ?? raw?.type);
  const id = String(raw?.id || '').trim() || `obj-${index}`;
  return {
    id,
    kind,
    tx: raw?.tx | 0,
    tz: raw?.tz | 0,
    r: Math.max(0.5, Number(raw?.r ?? raw?.radius) || 4),
    label: String(raw?.label || '').trim(),
    message: String(raw?.message || '').trim(),
    next: String(raw?.next || '').trim(),
    completed: false,
  };
}

export function normalizeObjectives(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item, i) => normalizeObjective(item, i));
}

export function encodeObjectives(list) {
  const out = [];
  for (const obj of normalizeObjectives(list)) {
    const row = [obj.tx, obj.tz, obj.r, obj.kind];
    if (obj.message || obj.next || obj.label || (obj.id && !obj.id.startsWith('obj-'))) {
      row.push(obj.message);
    }
    if (obj.next || obj.label || (obj.id && !obj.id.startsWith('obj-'))) row.push(obj.next);
    if (obj.label || (obj.id && !obj.id.startsWith('obj-'))) row.push(obj.label);
    if (obj.id && !obj.id.startsWith('obj-')) row.push(obj.id);
    out.push(row);
  }
  return out.length ? out : undefined;
}

function partyUnits(units) {
  const named = (units || []).filter((u) => u?.named && !u.civilian);
  if (named.length) return named;
  return (units || []).filter((u) => !u.civilian);
}

function unitInZone(obj, units, field) {
  return (units || []).some((u) => zoneContains(obj, u.x, u.z, field));
}

export function chapterObjectivesWin(objectives) {
  const list = objectives || [];
  if (!list.length) return false;
  const terminals = list.filter((o) => o.kind === OBJ_ESCAPE || o.kind === OBJ_ADVANCE);
  if (terminals.length) return terminals.some((o) => o.completed);
  return list.every((o) => o.completed);
}

export function winningNext(objectives) {
  const list = objectives || [];
  const hit = list.find((o) => (
    (o.kind === OBJ_ESCAPE || o.kind === OBJ_ADVANCE) && o.completed && o.next
  ));
  if (hit) return hit.next;
  if (chapterObjectivesWin(list)) {
    return list.find((o) => o.next)?.next || '';
  }
  return '';
}

/**
 * Mutates `objectives`. `units` are `{ x, z, named?, civilian? }`.
 * @returns {{ just: object[], chapterWin: boolean, next: string }}
 */
export function stepObjectives(objectives, units, field) {
  const just = [];
  const list = objectives || [];
  for (const obj of list) {
    if (obj.completed) continue;
    let hit = false;
    if (obj.kind === OBJ_ESCAPE) {
      const party = partyUnits(units);
      hit = party.length > 0 && party.some((u) => zoneContains(obj, u.x, u.z, field));
    } else {
      hit = unitInZone(obj, units, field);
    }
    if (!hit) continue;
    obj.completed = true;
    just.push(obj);
    if (obj.kind === OBJ_ADVANCE) {
      for (const o of list) o.completed = true;
    }
  }
  return {
    just,
    chapterWin: chapterObjectivesWin(list),
    next: winningNext(list),
  };
}

export function createObjectiveHud(host = typeof document !== 'undefined' ? document.body : null) {
  const canDom = typeof document !== 'undefined' && host;
  let bar = null;
  if (canDom) {
    bar = host.querySelector('#story-objective-hud');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'story-objective-hud';
      bar.style.cssText = [
        'position:absolute',
        'left:24px',
        'top:72px',
        'z-index:19',
        'pointer-events:none',
        'display:none',
        'max-width:280px',
        'text-shadow:0 1px 3px #000',
      ].join(';');
      host.appendChild(bar);
    }
  }
  return {
    set(list, { hidden = false } = {}) {
      if (!bar) return;
      const open = (list || []).filter((o) => !o.completed);
      if (hidden || !open.length) {
        bar.style.display = 'none';
        bar.replaceChildren();
        return;
      }
      bar.replaceChildren();
      const title = document.createElement('div');
      title.style.cssText = 'font-size:11px;font-weight:700;color:#fc4;margin-bottom:6px';
      title.textContent = 'Objectives';
      bar.appendChild(title);
      for (const obj of open) {
        const row = document.createElement('div');
        row.style.cssText = 'font-size:14px;color:#eee;line-height:1.35;margin-top:4px';
        row.textContent = obj.label || obj.message || `${obj.kind} ${formatGameNumber(obj.tx)},${formatGameNumber(obj.tz)}`;
        bar.appendChild(row);
      }
      bar.style.display = 'block';
    },
    hide() {
      if (!bar) return;
      bar.style.display = 'none';
      bar.replaceChildren();
    },
    dispose() {
      bar?.remove();
      bar = null;
    },
  };
}
