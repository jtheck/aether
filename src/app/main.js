// app/ — SimSession (lockstep) + Lite renderer + input.

import { livingByOwner } from '../sim/world.js';
import { UNIT_DEFS, getUnitDef } from '../sim/unitTypes.js';
import { PLAYER_ARMY, stressPerSideFromSearch, KOTH_MAX_ENTITIES } from '../sim/worldSetup.js';
import { createRenderer } from '../render/renderer.js';
import { setupInput } from './input.js';
import { SimSession } from './simSession.js';
import { createKothShard, kothModeFromSearch } from './kothShard.js';
import { PLAYER, AI_OWNER } from '../sim/worldSetup.js';

const SEED = 0x1234;

const SELECT_COLOR = [1.0, 0.95, 0.15];
const SELECT_SCALE = 1.15;
const OWNER_TINTS = [
  [0.25, 0.55, 1.0],
  [1.0, 0.32, 0.25],
  [0.4, 1.0, 0.45],
  [0.95, 0.8, 0.25],
  [0.75, 0.45, 1.0],
];
const DEATH_FADE_MS = 450;
const DEBUG_KOTH = new URLSearchParams(location.search).get('debug') === 'koth';

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

  if (!(await waitForWebGPU())) {
    showFallback('This browser has no WebGPU. Use Chrome/Edge 113+ or Firefox/Safari with WebGPU enabled.');
    return;
  }

  if (typeof SharedArrayBuffer === 'undefined') {
    showFallback('SharedArrayBuffer unavailable. Run via node serve.mjs (COOP/COEP headers required).');
    return;
  }

  const stress = stressPerSideFromSearch(location.search);
  const solo = new URLSearchParams(location.search).has('solo');
  const useKoth = kothModeFromSearch(location.search) && !solo;

  let kothShard = null;
  let ctx = null;
  /** @type {object | null} Live config received before bootGame finished. */
  let pendingLiveCfg = null;

  async function handleLiveStart(cfg) {
    if (!ctx) {
      pendingLiveCfg = cfg;
      return;
    }
    await applyLiveConfig(ctx, cfg, kothShard);
  }

  function handlePresentationSync(cfg) {
    if (!ctx) return;
    syncPresentation(ctx, cfg);
  }

  let bootCfg = {
    mode: stress > 0 ? 'legacy' : 'legacy',
    seed: SEED,
    localPlayerId: PLAYER,
    humanPlayers: [PLAYER],
    role: 'player',
    activeSlots: [PLAYER],
  };

  if (useKoth && stress === 0) {
    if (!(await waitForGetFireP2p())) {
      showFallback('GetFire P2P failed to load. Hard-refresh or use ?solo=1 for offline.');
      return;
    }
    kothShard = createKothShard({
      onStatus: setStatusText,
      onLiveStart: handleLiveStart,
      onPresentationSync: handlePresentationSync,
    });
    bootCfg = await kothShard.waitForBoot();
  }

  ctx = await bootGame(canvas, bootCfg, { stress, kothShard, solo });
  if (pendingLiveCfg) {
    const cfg = pendingLiveCfg;
    pendingLiveCfg = null;
    await applyLiveConfig(ctx, cfg, kothShard);
  }
}

async function bootGame(canvas, bootCfg, { stress, kothShard, solo = false }) {
  const useNet = bootCfg.mode === 'koth' || bootCfg.mode === 'sandbox';

  const session = new SimSession({
    localPlayerId: bootCfg.localPlayerId,
    humanPlayers: bootCfg.humanPlayers,
    aiPlayers: useKothAi(bootCfg, stress, solo),
    inputDelayTicks: useNet ? 1 : 0,
    role: bootCfg.role ?? 'player',
  });

  const simConfig = {
    seed: bootCfg.seed ?? SEED,
    stressPerSide: stress,
    mode: bootCfg.mode === 'sandbox' ? 'sandbox' : bootCfg.mode === 'koth' ? 'koth' : 'legacy',
    activeSlots: bootCfg.activeSlots ?? [bootCfg.localPlayerId],
  };

  const { count } = await session.start(simConfig);
  if (kothShard) kothShard.attachSession(session);

  const renderer = await createRenderer(canvas, count, {
    types: session.state.type,
    gpuCapacity: useNet ? KOTH_MAX_ENTITIES : count,
  });
  renderer.setCount(count);

  /** Mutable render buffers — frame loop reads this object, not closed-over copies. */
  const bufs = {
    selected: new Uint8Array(count),
    wasAlive: new Uint8Array(count),
    deathFade: new Float32Array(count),
    colors: new Float32Array(count * 4),
    renderX: new Float32Array(count),
    renderY: new Float32Array(count),
    renderZ: new Float32Array(count),
  };
  bufs.wasAlive.fill(1);

  function resizeRenderBuffers(n) {
    bufs.selected = new Uint8Array(n);
    bufs.wasAlive = new Uint8Array(n);
    bufs.wasAlive.fill(1);
    bufs.deathFade = new Float32Array(n);
    bufs.colors = new Float32Array(n * 4);
    bufs.renderX = new Float32Array(n);
    bufs.renderY = new Float32Array(n);
    bufs.renderZ = new Float32Array(n);
    inputApi?.setSelectedBuffer?.(bufs.selected);
  }

  let fpsDisplay = 0;
  let fpsAcc = 0;
  let fpsFrames = 0;
  let localPlayerId = bootCfg.localPlayerId;
  let matchMeta = { mode: bootCfg.mode, matchId: bootCfg.matchId };
  let matchOverShown = false;
  let lastRenderDebugAt = 0;

  const updateColors = () => {
    const world = session.state;
    const { selected, deathFade, colors } = bufs;
    for (let i = 0; i < session.count; i++) {
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
        c = tintColor(c, OWNER_TINTS[world.owner[i] % OWNER_TINTS.length], 0.45);
      }
      const alpha = world.alive[i] ? 1 : fade;
      colors[i * 4] = c[0];
      colors[i * 4 + 1] = c[1];
      colors[i * 4 + 2] = c[2];
      colors[i * 4 + 3] = alpha;
    }
    renderer.setColors(colors);
    renderer.setTeamDiscColors?.(colors);
    paintStatus();
  };

  function paintStatus() {
    const world = session.state;
    const el = document.getElementById('status');
    if (!el) return;
    const p = livingByOwner(world, localPlayerId);
    let sel = 0;
    for (let i = 0; i < session.count; i++) if (bufs.selected[i]) sel++;
    let line = `You P${localPlayerId}: ${p}  ·  Selected: ${sel}  ·  Tick ${world.tick}`;
    if (matchMeta.mode === 'sandbox') line = `Sandbox  ·  ${line}`;
    if (matchMeta.mode === 'koth') {
      const k = session.koth;
      if (k) {
        const players = k.active?.reduce?.((n, v) => n + (v ? 1 : 0), 0) ?? 0;
        const p0 = livingByOwner(world, 0);
        const p1 = livingByOwner(world, 1);
        line = `KOTH  ·  👑 P${k.kingOwner}  ·  Players ${players}  ·  Units ${world.count} P0 ${p0} P1 ${p1}  ·  Score ${k.scores[localPlayerId] ?? 0}  ·  ${line}`;
      } else line = `KOTH  ·  ${line}`;
    }
    if (session.role === 'spectator') line = `Spectating  ·  ${line}`;
    if (fpsDisplay > 0) line += `  ·  ${fpsDisplay} fps`;
    if (stress > 0) line += `  ·  stress ${world.count} units`;
    if (matchMeta.matchId) line += `  ·  …${matchMeta.matchId.slice(-8)}`;
    el.textContent = line;
    updateKothControls(kothShard);
  }

  updateColors();
  updateLegend();

  let orderPing = null;
  let inputApi = setupInput({
    canvas,
    renderer,
    world: () => session.state,
    selected: bufs.selected,
    localPlayerId,
    getUnitWorldPos: (i) => ({
      x: bufs.renderX[i],
      y: bufs.renderY[i],
      z: bufs.renderZ[i],
    }),
    enqueueCommand: (cmd) => session.submitCommand(cmd),
    onSelectionChanged: updateColors,
    onOrder: (x, z) => {
      orderPing = { x, z, until: performance.now() + 900 };
    },
    canInteract: () => session.role === 'player' && localPlayerId >= 0,
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'j' || e.key === 'J') {
      if (kothShard?.canJoin?.()) kothShard.requestJoin();
    }
  });
  setupKothControls(kothShard);

  const prevCommit = session.onCommit;
  session.onCommit = (tick, checksum) => {
    prevCommit?.(tick, checksum);
    const world = session.state;
    const { wasAlive, deathFade } = bufs;
    for (let i = 0; i < session.count; i++) {
      if (wasAlive[i] && !world.alive[i]) deathFade[i] = 1;
      wasAlive[i] = world.alive[i];
    }
    if (session.kothMatchOver && !matchOverShown) {
      matchOverShown = true;
      showMatchOver(session);
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
      paintStatus();
    }

    const alpha = session.displayAlpha;
    const { prev, cur } = session.displaySnapshots();
    if (!prev || !cur) return;
    const ringPulse = 1.38 + 0.07 * Math.sin(performance.now() * 0.004);

    if (orderPing) {
      const left = orderPing.until - performance.now();
      if (left <= 0) orderPing = null;
      else renderer.showOrderMarker(orderPing.x, orderPing.z, 16, (left / 900) * 0.9);
    } else {
      renderer.showOrderMarker(0, 0, 0, 0);
    }

    let colorsDirty = false;
    const drawStats = { p0: 0, p1: 0, unmapped: 0 };
    const n = session.count;
    const world = session.state;
    const { selected, deathFade, colors, renderX, renderY, renderZ } = bufs;
    for (let i = 0; i < n; i++) {
      if (deathFade[i] > 0) {
        deathFade[i] = Math.max(0, deathFade[i] - deltaMs / DEATH_FADE_MS);
        if (deathFade[i] <= 0 && !world.alive[i]) {
          if (!renderer.writeInstance(i, world.type[i], 0, 0, 0)) drawStats.unmapped++;
          renderer.writeTeamDisc?.(i, 0, 0, 0);
          renderer.writeSelectionRing(i, 0, 0, 0);
          colors[i * 4 + 3] = 0;
          colorsDirty = true;
          continue;
        }
      } else if (!world.alive[i]) {
        if (!renderer.writeInstance(i, world.type[i], 0, 0, 0)) drawStats.unmapped++;
        renderer.writeTeamDisc?.(i, 0, 0, 0);
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
      if (renderer.writeInstance(i, world.type[i], x, z, size, yaw, moving && world.alive[i])) {
        if (world.owner[i] === 0) drawStats.p0++;
        else if (world.owner[i] === 1) drawStats.p1++;
      } else drawStats.unmapped++;
      renderer.writeTeamDisc?.(i, x, z, size * 1.1);
      renderer.writeSelectionRing(i, x, z, selected[i] && world.alive[i] ? size * ringPulse : 0);
    }
    if (DEBUG_KOTH && matchMeta.mode === 'koth' && performance.now() - lastRenderDebugAt > 3000) {
      lastRenderDebugAt = performance.now();
      console.info('[KOTH] render frame', {
        count: n,
        drawStats,
        batches: renderer.debugBatches?.(n, world.type),
      });
    }
    if (colorsDirty) renderer.setColors(colors);
    renderer.commit();
  });

  await renderer.start();

  return {
    session,
    renderer,
    bufs,
    resizeRenderBuffers,
    inputApi,
    kothShard,
    get matchOverShown() {
      return matchOverShown;
    },
    set matchOverShown(v) {
      matchOverShown = v;
    },
    get localPlayerId() {
      return localPlayerId;
    },
    set localPlayerId(v) {
      localPlayerId = v;
      inputApi.setLocalPlayerId?.(v);
    },
    matchMeta,
    setMatchMeta(m) {
      matchMeta = { ...matchMeta, ...m };
    },
    paintStatus,
    updateColors,
  };
}

async function applyLiveConfig(ctx, cfg, kothShard) {
  const activeSlots = cfg.activeSlots ?? cfg.humanPlayers ?? [];
  if (cfg.mode === 'sandbox' && activeSlots.length === 0) {
    ctx.setMatchMeta({ mode: 'sandbox', matchId: cfg.matchId });
    ctx.session.setRole(cfg.role ?? 'spectator');
    setStatusText('Looking for live shard…');
    return;
  }
  if (cfg.mode === 'koth' && activeSlots.length < 2) {
    console.warn('[KOTH] ignoring live config with fewer than 2 active slots', cfg);
    setStatusText(`Waiting for roster sync — got ${activeSlots.length} active slot${activeSlots.length === 1 ? '' : 's'}`);
    return;
  }
  if (cfg.mode === 'koth' && DEBUG_KOTH) console.info('[KOTH] applying live config', cfg);

  const simMode = cfg.mode === 'sandbox' ? 'sandbox' : 'koth';
  const { count } = await ctx.session.reset({
    seed: cfg.seed,
    mode: simMode,
    activeSlots,
  });
  if (cfg.mode === 'koth' && DEBUG_KOTH) console.info('[KOTH] sim after reset', ownerStats(ctx.session.state));

  syncPresentation(ctx, cfg, { count });
}

function syncPresentation(ctx, cfg, options = {}) {
  const count = options.count ?? ctx.session.count;
  ctx.setMatchMeta({ mode: cfg.mode ?? 'koth', matchId: cfg.matchId });
  if (cfg.localPlayerId != null) ctx.localPlayerId = cfg.localPlayerId;
  if (cfg.localPlayerId != null) ctx.session.setLocalPlayerId?.(cfg.localPlayerId);
  if (cfg.humanPlayers && (cfg.reset || cfg.updateHumanPlayers || options.updateHumanPlayers)) {
    ctx.session.setHumanPlayers(cfg.humanPlayers);
  }
  ctx.session.setRole(cfg.role ?? 'player');
  ctx.inputApi?.setRole?.(cfg.role ?? 'player');
  if (cfg.inputEnabled != null) ctx.inputApi?.setInputEnabled?.(Boolean(cfg.inputEnabled));
  if ((cfg.role ?? 'player') !== 'player') ctx.inputApi?.clearSelection?.();
  ctx.session.inputDelayTicks = cfg.mode === 'koth' ? 1 : 0;
  ctx.resizeRenderBuffers(count);
  ctx.renderer.setCount(count);
  ctx.renderer.rebuildFromTypes(count, ctx.session.state.type);
  if (cfg.mode === 'koth') ctx.renderer.resetCamera?.();

  const overEl = document.getElementById('match-over');
  if (overEl) overEl.style.display = 'none';
  ctx.matchOverShown = false;

  ctx.updateColors();
  const label =
    cfg.mode === 'sandbox'
      ? 'Sandbox'
      : cfg.role === 'player'
        ? `Live — player ${cfg.localPlayerId}`
        : 'Live — spectating';
  setStatusText(label);
}

function ownerStats(world) {
  const owners = new Map();
  for (let i = 0; i < world.count; i++) {
    if (!world.alive[i]) continue;
    const owner = world.owner[i];
    let s = owners.get(owner);
    if (!s) {
      s = { count: 0, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      owners.set(owner, s);
    }
    const x = world.px[i] / 65536;
    const z = world.py[i] / 65536;
    s.count++;
    s.minX = Math.min(s.minX, x);
    s.maxX = Math.max(s.maxX, x);
    s.minZ = Math.min(s.minZ, z);
    s.maxZ = Math.max(s.maxZ, z);
  }
  return {
    count: world.count,
    owners: Object.fromEntries([...owners.entries()].map(([owner, s]) => [owner, s])),
  };
}

function showMatchOver(session) {
  const el = document.getElementById('match-over');
  if (!el) return;
  const k = session.koth;
  let text = 'Match over';
  if (k) {
    let best = 0;
    let bestScore = -1;
    for (let i = 0; i < 5; i++) {
      if ((k.scores[i] ?? 0) > bestScore) {
        bestScore = k.scores[i];
        best = i;
      }
    }
    text = `Match over — Player ${best} wins (${bestScore} pts)`;
  }
  el.textContent = text;
  el.style.display = 'block';
}

function useKothAi(bootCfg, stress, solo) {
  if (stress > 0) return [];
  if (solo) return [AI_OWNER];
  if (bootCfg.mode === 'sandbox' || bootCfg.mode === 'koth') return [];
  return [AI_OWNER];
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

function setStatusText(text) {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

function setupKothControls(kothShard) {
  const start = document.getElementById('koth-start');
  const join = document.getElementById('koth-join');
  if (!start || !join || !kothShard) {
    if (start) start.hidden = true;
    if (join) join.hidden = true;
    return;
  }
  start.addEventListener('click', () => {
    kothShard.startOrJoinLive?.();
    updateKothControls(kothShard);
  });
  join.addEventListener('click', () => {
    kothShard.requestJoin?.();
    updateKothControls(kothShard);
  });
  updateKothControls(kothShard);
}

function updateKothControls(kothShard) {
  const start = document.getElementById('koth-start');
  const join = document.getElementById('koth-join');
  if (!start || !join) return;
  if (!kothShard) {
    start.hidden = true;
    join.hidden = true;
    return;
  }
  const canJoin = Boolean(kothShard.canJoin?.());
  start.hidden = !kothShard.canStartOrJoinLive?.() || canJoin;
  join.hidden = !canJoin;
  join.textContent = kothShard.joinActionLabel?.() ?? 'Join Match';
}

async function waitForGetFireP2p(timeoutMs = 5000) {
  const start = performance.now();
  while (typeof globalThis.GETFIREP2P !== 'function' && performance.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return typeof globalThis.GETFIREP2P === 'function';
}

async function waitForWebGPU(timeoutMs = 3000) {
  const start = performance.now();
  while (!navigator.gpu && performance.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return !!navigator.gpu;
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
