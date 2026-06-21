// app/ — SimSession (lockstep) + Lite renderer + input.

import { livingByOwner } from '../sim/world.js';
import { UNIT_DEFS, getUnitDef } from '../sim/unitTypes.js';
import { PLAYER_ARMY, stressPerSideFromSearch, PLAYER, AI_OWNER } from '../sim/worldSetup.js';
import { createRenderer } from '../render/renderer.js';
import { setupInput } from './input.js';
import { SimSession } from './simSession.js';

const SEED = 0x1234;

const SELECT_COLOR = [1.0, 0.95, 0.15];
const SELECT_SCALE = 1.15;
const ENEMY_TINT = [0.55, 0.55, 0.62];
const DEATH_FADE_MS = 450;

function tintColor(base, tint, amount) {
  const a = amount;
  const b = 1 - amount;
  return [base[0] * b + tint[0] * a, base[1] * b + tint[1] * a, base[2] * b + tint[2] * a];
}

function hpColor(def, hp) {
  const t = Math.max(0, Math.min(1, hp / def.hp));
  const hurt = [1, 0.35, 0.3];
  return tintColor(def.color, hurt, 1 - t);
}

async function main() {
  const canvas = document.getElementById('canvas');
  resizeCanvas(canvas);
  window.addEventListener('resize', () => resizeCanvas(canvas));

  if (!(await waitForWebGPU())) {
    showFallback('This browser has no WebGPU. Use Chrome/Edge 113+ or Firefox/Safari with WebGPU enabled.');
    return;
  }

  if (typeof SharedArrayBuffer === 'undefined') {
    showFallback('SharedArrayBuffer unavailable. Run via node serve.mjs (COOP/COEP headers required).');
    return;
  }

  const stress = stressPerSideFromSearch(location.search);
  const session = new SimSession({
    localPlayerId: PLAYER,
    humanPlayers: [PLAYER],
    aiPlayers: stress > 0 ? [] : [AI_OWNER],
    inputDelayTicks: 0,
  });

  const { count } = await session.start({ seed: SEED, stressPerSide: stress });
  const world = session.state;

  const renderer = await createRenderer(canvas, count);
  renderer.setCount(count);

  const selected = new Uint8Array(count);
  const wasAlive = new Uint8Array(count);
  const deathFade = new Float32Array(count);
  const colors = new Float32Array(count * 4);
  wasAlive.fill(1);

  const renderX = new Float32Array(count);
  const renderY = new Float32Array(count);
  const renderZ = new Float32Array(count);

  let fpsDisplay = 0;
  let fpsAcc = 0;
  let fpsFrames = 0;

  const updateColors = () => {
    for (let i = 0; i < count; i++) {
      const fade = deathFade[i];
      if (!world.alive[i] && fade <= 0) {
        colors[i * 4 + 3] = 0;
        continue;
      }
      const def = getUnitDef(world.type[i]);
      let c;
      if (selected[i] && world.alive[i]) c = SELECT_COLOR;
      else {
        c = hpColor(def, world.hp[i]);
        if (world.owner[i] !== PLAYER) c = tintColor(c, ENEMY_TINT, 0.25);
      }
      const alpha = world.alive[i] ? 1 : fade;
      colors[i * 4] = c[0];
      colors[i * 4 + 1] = c[1];
      colors[i * 4 + 2] = c[2];
      colors[i * 4 + 3] = alpha;
    }
    renderer.setColors(colors);
    updateStatus(session, world, selected, fpsDisplay, stress);
  };
  updateColors();
  updateLegend();

  let orderPing = null;

  setupInput({
    canvas,
    renderer,
    world,
    selected,
    getUnitWorldPos: (i) => ({
      x: renderX[i],
      y: renderY[i],
      z: renderZ[i],
    }),
    enqueueCommand: (cmd) => session.submitCommand(cmd),
    onSelectionChanged: updateColors,
    onOrder: (x, z) => {
      orderPing = { x, z, until: performance.now() + 900 };
    },
  });

  session.onCommit = () => {
    for (let i = 0; i < count; i++) {
      if (wasAlive[i] && !world.alive[i]) deathFade[i] = 1;
      wasAlive[i] = world.alive[i];
    }
    updateColors();
  };

  renderer.onFrame((deltaMs) => {
    session.pump(deltaMs);

    fpsAcc += deltaMs;
    fpsFrames++;
    if (fpsAcc >= 500) {
      fpsDisplay = Math.round((fpsFrames * 1000) / fpsAcc);
      fpsAcc = 0;
      fpsFrames = 0;
      updateStatus(session, world, selected, fpsDisplay, stress);
    }

    const alpha = session.displayAlpha;
    const { prev, cur } = session.displaySnapshots();
    const ringPulse = 1.38 + 0.07 * Math.sin(performance.now() * 0.004);

    if (orderPing) {
      const left = orderPing.until - performance.now();
      if (left <= 0) orderPing = null;
      else renderer.showOrderMarker(orderPing.x, orderPing.z, 16, (left / 900) * 0.9);
    } else {
      renderer.showOrderMarker(0, 0, 0, 0);
    }

    let colorsDirty = false;
    for (let i = 0; i < count; i++) {
      if (deathFade[i] > 0) {
        deathFade[i] = Math.max(0, deathFade[i] - deltaMs / DEATH_FADE_MS);
        if (deathFade[i] <= 0 && !world.alive[i]) {
          renderer.writeInstance(i, 0, 0, 0);
          renderer.writeSelectionRing(i, 0, 0, 0);
          colors[i * 4 + 3] = 0;
          colorsDirty = true;
          continue;
        }
      } else if (!world.alive[i]) {
        renderer.writeInstance(i, 0, 0, 0);
        renderer.writeSelectionRing(i, 0, 0, 0);
        continue;
      }

      const def = getUnitDef(world.type[i]);
      const x = prev.x[i] + (cur.x[i] - prev.x[i]) * alpha;
      const z = prev.z[i] + (cur.z[i] - prev.z[i]) * alpha;
      const dx = cur.x[i] - prev.x[i];
      const dz = cur.z[i] - prev.z[i];
      const moving = dx * dx + dz * dz > 0.0004;
      const yaw = moving ? Math.atan2(dx, dz) : 0;
      let size = selected[i] && world.alive[i] ? def.size * SELECT_SCALE : def.size;
      const fade = deathFade[i];
      if (fade > 0) size *= fade;
      const y = size * 0.5;
      renderX[i] = x;
      renderY[i] = y;
      renderZ[i] = z;
      if (fade > 0) {
        colors[i * 4 + 3] = fade;
        colorsDirty = true;
      }
      renderer.writeInstance(i, x, z, size, yaw, moving && world.alive[i]);
      renderer.writeSelectionRing(i, x, z, selected[i] && world.alive[i] ? size * ringPulse : 0);
    }
    if (colorsDirty) renderer.setColors(colors);
    renderer.commit();
  });

  await renderer.start();
}

function updateLegend() {
  const el = document.getElementById('legend');
  if (!el) return;
  el.innerHTML = PLAYER_ARMY.map(({ type }) => {
    const d = UNIT_DEFS[type];
    const rgb = d.color.map((v) => Math.round(v * 255)).join(',');
    return `<span class="legend-item"><i style="background:rgb(${rgb})"></i>${d.name}</span>`;
  }).join('');
}

function updateStatus(session, world, selected, fps = 0, stress = 0) {
  const el = document.getElementById('status');
  if (!el) return;
  const p = livingByOwner(world, PLAYER);
  const e = livingByOwner(world, AI_OWNER);
  let sel = 0;
  for (let i = 0; i < world.count; i++) if (selected[i]) sel++;
  let line = `You: ${p}  ·  Enemy: ${e}  ·  Selected: ${sel}  ·  Tick ${world.tick}`;
  if (fps > 0) line += `  ·  ${fps} fps`;
  if (stress > 0) line += `  ·  stress ${world.count} units`;
  el.textContent = line;
}

async function waitForWebGPU(timeoutMs = 3000) {
  const start = performance.now();
  while (!navigator.gpu && performance.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return !!navigator.gpu;
}

function resizeCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
}

function showFallback(msg) {
  const el = document.getElementById('fallback');
  if (!el) return;
  el.style.display = 'grid';
  const p = el.querySelector('[data-msg]');
  if (p && msg) p.textContent = msg;
}

main().catch((err) => {
  console.error(err);
  showFallback(String(err?.message ?? err));
});
