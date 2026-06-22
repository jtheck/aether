// app/input.js — turns pointer/keyboard into COMMANDS and selection.

import * as fx from '../sim/fixed.js';
import { CMD } from '../sim/commands.js';
import { getUnitDef } from '../sim/unitTypes.js';
import { isHostile } from '../sim/teams.js';

const CLICK_SLOP_PX = 6;

export function setupInput({
  canvas,
  renderer,
  world: worldOrGetter,
  selected,
  localPlayerId: initialPlayerId,
  getUnitWorldPos,
  enqueueCommand,
  onSelectionChanged,
  onOrder,
}) {
  let localPlayerId = initialPlayerId;
  let selectedBuf = selected;
  const getWorld = typeof worldOrGetter === 'function' ? worldOrGetter : () => worldOrGetter;
  const downPos = {};
  let boxStart = null;
  let dragPointerId = null;
  let selectionBox = null;

  ensureSelectionBox();
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    downPos[e.button] = { x: e.clientX, y: e.clientY };
    if (e.button === 0) {
      boxStart = { x: e.clientX, y: e.clientY };
      dragPointerId = e.pointerId;
      hideSelectionBox();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (dragPointerId !== e.pointerId || !boxStart || !(e.buttons & 1)) return;
    const moved = Math.hypot(e.clientX - boxStart.x, e.clientY - boxStart.y);
    if (moved > CLICK_SLOP_PX) showSelectionBox(boxStart.x, boxStart.y, e.clientX, e.clientY);
  });

  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  function onPointerUp(e) {
    if (e.button === 0) finishLmb(e);
    else if (e.button === 2) finishRmb(e);
  }

  function finishLmb(e) {
    if (e.button !== 0 || dragPointerId === null) return;
    if (e.pointerId !== dragPointerId) return;

    const d = downPos[0];
    delete downPos[0];
    const moved = d ? Math.hypot(e.clientX - d.x, e.clientY - d.y) : Infinity;

    if (moved > CLICK_SLOP_PX && boxStart) {
      boxSelect(boxStart.x, boxStart.y, e.clientX, e.clientY, e.shiftKey);
    } else if (moved <= CLICK_SLOP_PX) {
      const world = getWorld();
      const hit = pickUnit(e.clientX, e.clientY, (i) => world.owner[i] === localPlayerId);
      if (hit >= 0) {
        if (!e.shiftKey) selectedBuf.fill(0);
        selectedBuf[hit] = 1;
        onSelectionChanged();
      } else if (selectedIds().length > 0) {
        orderAt(e.clientX, e.clientY, CMD.MOVE);
      } else if (!e.shiftKey) {
        clearSelection();
      }
    }

    hideSelectionBox();
    boxStart = null;
    dragPointerId = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function finishRmb(e) {
    const d = downPos[2];
    delete downPos[2];
    const moved = d ? Math.hypot(e.clientX - d.x, e.clientY - d.y) : Infinity;
    if (moved <= CLICK_SLOP_PX) {
      orderAt(e.clientX, e.clientY, CMD.ATTACK_MOVE);
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 's' || e.key === 'S') {
      stopSelected();
    } else if (e.key === 'Escape') {
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
    const world = getWorld();
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

  function boxSelect(x0, y0, x1, y1, add) {
    const rect = canvas.getBoundingClientRect();
    const minX = Math.min(x0, x1) - rect.left;
    const maxX = Math.max(x0, x1) - rect.left;
    const minY = Math.min(y0, y1) - rect.top;
    const maxY = Math.max(y0, y1) - rect.top;
    if (!add) selectedBuf.fill(0);
    const world = getWorld();
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i] || world.owner[i] !== localPlayerId) continue;
      const pos = getUnitWorldPos(i);
      const p = renderer.worldToScreen(pos.x, pos.y, pos.z);
      if (!p) continue;
      if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) selectedBuf[i] = 1;
    }
    onSelectionChanged();
  }

  function selectedIds() {
    const world = getWorld();
    const ids = [];
    for (let i = 0; i < world.count; i++) {
      if (selectedBuf[i] && world.alive[i]) ids.push(i);
    }
    return ids;
  }

  function orderAt(clientX, clientY, cmdType) {
    const ids = selectedIds();
    if (ids.length === 0) return;

    const world = getWorld();
    const enemy = pickUnit(clientX, clientY, (i) => isHostile(localPlayerId, world.owner[i]));
    if (enemy >= 0 && cmdType === CMD.MOVE) {
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
    selectedBuf.fill(0);
    onSelectionChanged();
  }

  return {
    setLocalPlayerId(id) {
      localPlayerId = id;
    },
    setSelectedBuffer(buf) {
      selectedBuf = buf;
    },
  };
}
