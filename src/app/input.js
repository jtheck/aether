// app/input.js — turns pointer/keyboard into COMMANDS and selection.

import * as fx from '../sim/fixed.js';
import { CMD } from '../sim/commands.js';
import { getUnitDef } from '../sim/unitTypes.js';
import { isHostile } from '../sim/teams.js';

const PLAYER = 0;
const CLICK_SLOP_PX = 6;

export function setupInput({
  canvas,
  renderer,
  world,
  selected,
  getUnitWorldPos,
  enqueueCommand,
  onSelectionChanged,
  onOrder,
}) {
  const downPos = {};
  let boxStart = null;
  let attackMoveMode = false;
  let selectionBox = null;

  ensureSelectionBox();
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    downPos[e.button] = { x: e.clientX, y: e.clientY };
    if (e.button === 0) {
      boxStart = { x: e.clientX, y: e.clientY };
      hideSelectionBox();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!boxStart || !(e.buttons & 1)) return;
    const moved = Math.hypot(e.clientX - boxStart.x, e.clientY - boxStart.y);
    if (moved > CLICK_SLOP_PX) showSelectionBox(boxStart.x, boxStart.y, e.clientX, e.clientY);
  });

  canvas.addEventListener('pointerup', (e) => {
    const d = downPos[e.button];
    delete downPos[e.button];
    const moved = d ? Math.hypot(e.clientX - d.x, e.clientY - d.y) : Infinity;

    if (e.button === 0) {
      hideSelectionBox();
      if (moved > CLICK_SLOP_PX && boxStart) {
        boxSelect(boxStart.x, boxStart.y, e.clientX, e.clientY, e.shiftKey);
      } else if (moved <= CLICK_SLOP_PX) {
        selectAt(e.clientX, e.clientY, e.shiftKey);
      }
      boxStart = null;
    } else if (e.button === 2 && moved <= CLICK_SLOP_PX) {
      const mode = attackMoveMode || e.shiftKey;
      if (attackMoveMode) attackMoveMode = false;
      orderAt(e.clientX, e.clientY, mode ? CMD.ATTACK_MOVE : CMD.MOVE);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'a' || e.key === 'A') {
      if (e.repeat) return;
      attackMoveMode = true;
    } else if (e.key === 's' || e.key === 'S') {
      stopSelected();
    } else if (e.key === 'Escape') {
      attackMoveMode = false;
      clearSelection();
    }
  });

  function ensureSelectionBox() {
    if (selectionBox) return;
    selectionBox = document.createElement('div');
    selectionBox.id = 'selection-box';
    selectionBox.style.cssText =
      'position:fixed;display:none;border:1px solid rgba(255,230,80,0.9);background:rgba(255,230,80,0.12);pointer-events:none;z-index:10;';
    document.body.appendChild(selectionBox);
  }

  function showSelectionBox(x0, y0, x1, y1) {
    ensureSelectionBox();
    selectionBox.style.left = `${Math.min(x0, x1)}px`;
    selectionBox.style.top = `${Math.min(y0, y1)}px`;
    selectionBox.style.width = `${Math.abs(x1 - x0)}px`;
    selectionBox.style.height = `${Math.abs(y1 - y0)}px`;
    selectionBox.style.display = 'block';
  }

  function hideSelectionBox() {
    if (selectionBox) selectionBox.style.display = 'none';
  }

  function buildSphereList(filter) {
    const list = [];
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i]) continue;
      if (filter && !filter(i)) continue;
      const def = getUnitDef(world.type[i]);
      const pos = getUnitWorldPos(i);
      list.push({
        id: i,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        r: def.size * 0.55,
      });
    }
    return list;
  }

  function pickUnit(clientX, clientY, filter) {
    return renderer.rayPickSpheres(clientX, clientY, buildSphereList(filter));
  }

  function selectAt(clientX, clientY, add) {
    const hit = pickUnit(clientX, clientY, (i) => world.owner[i] === PLAYER);
    if (!add) selected.fill(0);
    if (hit >= 0) selected[hit] = 1;
    onSelectionChanged();
  }

  function boxSelect(x0, y0, x1, y1, add) {
    const rect = canvas.getBoundingClientRect();
    const minX = Math.min(x0, x1) - rect.left;
    const maxX = Math.max(x0, x1) - rect.left;
    const minY = Math.min(y0, y1) - rect.top;
    const maxY = Math.max(y0, y1) - rect.top;
    if (!add) selected.fill(0);
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i] || world.owner[i] !== PLAYER) continue;
      const pos = getUnitWorldPos(i);
      const p = renderer.worldToScreen(pos.x, pos.y, pos.z);
      if (!p) continue;
      if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) selected[i] = 1;
    }
    onSelectionChanged();
  }

  function selectedIds() {
    const ids = [];
    for (let i = 0; i < world.count; i++) {
      if (selected[i] && world.alive[i]) ids.push(i);
    }
    return ids;
  }

  function orderAt(clientX, clientY, cmdType) {
    const ids = selectedIds();
    if (ids.length === 0) return;

    const enemy = pickUnit(clientX, clientY, (i) => isHostile(PLAYER, world.owner[i]));
    if (enemy >= 0 && cmdType !== CMD.ATTACK_MOVE) {
      enqueueCommand({ type: CMD.ATTACK, entities: ids, target: enemy });
      return;
    }

    const g = renderer.screenToGround(clientX, clientY);
    if (!g) return;
    if (onOrder) onOrder(g.x, g.z);

    const n = ids.length;
    const tx = new Array(n);
    const ty = new Array(n);
    let sumX = 0;
    let sumZ = 0;
    for (let k = 0; k < n; k++) {
      sumX += fx.toFloat(world.px[ids[k]]);
      sumZ += fx.toFloat(world.py[ids[k]]);
    }
    const cenX = sumX / n;
    const cenZ = sumZ / n;
    // Preserve layout: shift the group so its centroid lands on the click.
    for (let k = 0; k < n; k++) {
      const i = ids[k];
      tx[k] = fx.fromFloat(g.x + (fx.toFloat(world.px[i]) - cenX));
      ty[k] = fx.fromFloat(g.z + (fx.toFloat(world.py[i]) - cenZ));
    }
    enqueueCommand({ type: cmdType, entities: ids, tx, ty });
  }

  function stopSelected() {
    const ids = selectedIds();
    if (ids.length === 0) return;
    enqueueCommand({ type: CMD.STOP, entities: ids });
  }

  function clearSelection() {
    selected.fill(0);
    onSelectionChanged();
  }
}
