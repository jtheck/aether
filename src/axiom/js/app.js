/**
 * Axiom bootstrap: chunk-streamed volume + multi-kind particles.
 * Render backend: Three (default). ?backend=lite or ?backend=babylon
 */
import { createWorld } from './sim/world.js';
import { stepWavePreset, WAVE_SOURCES, WAVE_EMITTER_BALLS } from './sim/behaviors.js';
import { FPSMeter } from './fps-meter.js';
import { attachFieldProbe, probeSites } from './field-probe.js';
import { attachAxiomFly, mergeFlyIntents } from './fly.js';
import { attachAxiomGamepad } from './gamepad.js';
import { bindXrButton, isImmersiveVrSupported } from './xr.js';

const params = new URLSearchParams(location.search);
const BACKEND_PARAM = (params.get('backend') || '').toLowerCase();
/** Three is the default. Lite / BJS9 stay behind ?backend=. */
let BACKEND = BACKEND_PARAM || 'three';
// Store/GPU buffers size to this — keep default sane (8M prealloc was freezing mid machines
// at 16k live). Raise with ?n= / ?cap= on a strong box (max 16M).
const CAPACITY = clampInt(params.get('cap'), 1_500_000, 1000, 16_000_000);
const INITIAL = clampInt(params.get('n'), Math.min(1_500_000, CAPACITY), 100, CAPACITY);
const CHUNK_SIZE = clampInt(params.get('chunk'), 16, 8, 64);
// Chebyshev paging cube: 5 → 11³ chunks. Live fill is a sphere inscribed in that cube.
const CHUNK_RADIUS = clampInt(params.get('radius'), 5, 1, 8);

function clampInt(v, fallback, lo, hi) {
  const n = v == null ? fallback : parseInt(String(v), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

async function main() {
  const canvas = document.getElementById('canvas');
  if (!canvas) throw new Error('#canvas missing');

  /** @type {import('./render/backend.js').AxiomRenderer & Record<string, any>} */
  let renderer;
  if (BACKEND === 'lite') {
    if (!navigator.gpu) throw new Error('Lite backend requires WebGPU');
    const { createLiteBackend } = await import('./render/lite-backend.js');
    renderer = createLiteBackend();
    await renderer.init(canvas);
  } else if (BACKEND === 'babylon') {
    await loadBabylonUmd();
    const { createBabylonBackend } = await import('./render/babylon-backend.js');
    renderer = createBabylonBackend();
    await renderer.init(canvas);
  } else {
    BACKEND = 'three';
    const { createThreeBackend } = await import('./render/three-backend.js');
    renderer = createThreeBackend();
    await renderer.init(canvas);
  }
  function applyWaveShape(dir = 1) {
    const id = stepWavePreset(dir);
    renderer.syncWaveEmitters?.();
    const extra =
      id === 'tube' ? ` carbons=${WAVE_EMITTER_BALLS.length} waves=${WAVE_SOURCES.length}` : ` (${WAVE_SOURCES.length})`;
    console.log(`[axiom] wave emitters → ${id}${extra}`);
  }
  const desktop = attachAxiomFly(canvas);
  const pad = attachAxiomGamepad(renderer, {
    onShape: applyWaveShape,
    autoStart: false,
    apply: false,
    getXrInputSources: () => renderer.getXRInputSources?.() ?? [],
  });

  // Boot with a visible volume, seek 42.9 FPS. ?throttle=0 = full budget, no seek.
  const throttleOn = params.get('throttle') !== '0';
  const nFloor = 16_000;
  const nCeiling = INITIAL;
  const rFloor = 1;
  const rCeiling = CHUNK_RADIUS;
  // Don't boot at the floor/r=1 — looks empty and deadlocks if FPS can't clear the band.
  const nBoot = throttleOn ? Math.min(nCeiling, 120_000) : INITIAL;
  const rBoot = throttleOn ? Math.min(3, rCeiling) : rCeiling;
  let nAim = nBoot;
  let rAim = rBoot;

  const world = createWorld({
    capacity: CAPACITY,
    initialCount: INITIAL, // high-water store/staging
    startCount: nAim,
    chunkSize: CHUNK_SIZE,
    chunkRadius: CHUNK_RADIUS, // high-water radius
    startRadius: rAim,
    cellSize: 4,
  });

  for (const s of world.species) {
    renderer.registerSpecies({
      id: s.id,
      meshKind: s.meshKind,
      capacity: s.capacity,
      size: s.size,
      tint: s.tint,
      hardCircle: s.hardCircle,
    });
  }

  let lastAdjust = 0;
  const FPS_TARGET = 42.9;
  const FPS_LO = 41.4; // below → shed
  const FPS_HI = 44.4; // above → add

  /** Per ~100ms tune — ease spreads the actual fill so this can be brisk. */
  function aimDelta(fps) {
    const err = Math.abs(fps - FPS_TARGET);
    let pct = 0.028;
    if (err >= 20) pct = 0.07;
    else if (err >= 10) pct = 0.045;
    return Math.max(4000, Math.min(48000, Math.round(nAim * pct)));
  }

  function climb(fps) {
    const pose = renderer.getCameraPose();
    const room = world.maxLiveForRadius(rAim);
    const bump = aimDelta(fps);
    if (nAim < nCeiling && world.count < room - 32) {
      const next = Math.min(nCeiling, room, nAim + bump);
      if (next > nAim) {
        nAim = next;
        world.setTargetCount(nAim);
        return true;
      }
    }
    if (rAim < rCeiling) {
      rAim += 1;
      world.setChunkRadius(rAim, pose, nAim);
      return true;
    }
    if (nAim < nCeiling) {
      const next = Math.min(nCeiling, nAim + bump);
      if (next <= nAim) return false;
      nAim = next;
      world.setTargetCount(nAim);
      return true;
    }
    return false;
  }

  function shed(fps) {
    const bump = aimDelta(fps);
    if (nAim > nFloor) {
      const next = Math.max(nFloor, nAim - bump);
      if (next < nAim) {
        nAim = next;
        world.setTargetCount(nAim);
        return true;
      }
    }
    if (rAim > rFloor) {
      rAim -= 1;
      world.setChunkRadius(rAim, renderer.getCameraPose(), nAim);
      return true;
    }
    return false;
  }

  const probe = attachFieldProbe();
  const fpsMeter = new FPSMeter({
    onSample() {
      const fc = world.focusChunk;
      const th = throttleOn ? ` aim=${nAim} r=${rAim}` : '';
      fpsMeter.setExtra(
        `live=${world.count}${th} chunks=${world.chunkCount} @${fc.cx},${fc.cy},${fc.cz}`,
      );
    },
  });
  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'F9') {
      if (renderer.toggleInspector) {
        renderer.toggleInspector();
        return;
      }
      const scene = renderer.getScene?.();
      if (!scene?.debugLayer) return;
      if (scene.debugLayer.isVisible()) scene.debugLayer.hide();
      else scene.debugLayer.show();
      return;
    }
    // G — toggle chunk volume wireframes
    if (evt.key === 'g' || evt.key === 'G') {
      const on = renderer.toggleChunkWireframes();
      console.log(`[axiom] chunk wireframes ${on ? 'on' : 'off'}`);
      return;
    }
    if ((evt.key === 'y' || evt.key === 'Y' || evt.code === 'Space') && !evt.repeat) {
      if (evt.code === 'Space') evt.preventDefault();
      applyWaveShape(1);
    }
  });

  window.addEventListener('resize', () => renderer.resize());
  window.addEventListener('orientationchange', () => renderer.resize());

  tryXR(renderer).catch(() => {});

  const engine = renderer.getEngine();
  let lastChunksVersion = -1;
  let workEma = 18;
  engine.runRenderLoop(() => {
    const t0 = performance.now();
    const dt = renderer.getDeltaTime();
    pad.tick();
    renderer.applyGamepadFly?.(mergeFlyIntents(desktop.read(), pad.read()));
    renderer.prepareFrame?.();
    const pose = renderer.getCameraPose();
    world.tick(dt, pose);
    probe.show(probeSites(pose), world.time);
    const uploads = world.getRenderSpecies();
    for (const upload of uploads) renderer.uploadSpecies(upload);
    // Wireframes only when the streamed set changes — signature sort was GC hell every frame.
    if (world.chunksVersion !== lastChunksVersion) {
      lastChunksVersion = world.chunksVersion;
      renderer.syncChunkWireframes(world.getChunkBounds());
    }
    renderer.tickScenery?.();
    renderer.render();
    const work = performance.now() - t0;
    fpsMeter.tick(work);
    workEma = workEma * 0.88 + work * 0.12;
    if (t0 - lastAdjust >= 100) {
      if (throttleOn) {
        const est = 1000 / Math.max(workEma, 6);
        if (est > FPS_HI) climb(est);
        else if (est < FPS_LO) shed(est);
      }
      lastAdjust = t0;
      const fc = world.focusChunk;
      const th = throttleOn ? ` aim=${nAim} r=${rAim}` : '';
      fpsMeter.setExtra(
        `live=${world.count}${th} chunks=${world.chunkCount} @${fc.cx},${fc.cy},${fc.cz}`,
      );
    }
  });

  console.log(
    `[axiom] backend=${BACKEND} chunk volume size=${CHUNK_SIZE} radius=${CHUNK_RADIUS} ` +
      `budget=${INITIAL}/${CAPACITY} boot=${nAim}/r${rAim} throttle=${throttleOn ? 'up' : 'off'} — ` +
      `ESDF fly (R/C up/down), wheel forward/back + side-strafe, pad sticks + LT/RT, LB/RB shape, mobi stick (look-dir), G cube wires, Y/Space emitter ring, F9 inspector`,
  );
}

async function loadScript(src) {
  await new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(el);
  });
}

async function loadBabylonUmd() {
  if (globalThis.BABYLON) return;
  await loadScript('vendor/babylon9.js');
  await loadScript('vendor/babylonjs.materials.min.js');
  await loadScript('vendor/babylonjs.loaders.min.js');
  await loadScript('vendor/babylon.gui.min.js');
  await loadScript('vendor/babylonjs.serializers.min.js');
  await loadScript('vendor/babylonjs.addons.min.js');
  await loadScript('vendor/babylon.inspector.bundle.js');
}

/**
 * @param {import('./render/backend.js').AxiomRenderer & Record<string, any>} renderer
 */
async function tryXR(renderer) {
  const xrButton = document.getElementById('xr_button');
  if (!xrButton) return;

  const threeApi = renderer.enterXR && {
    enterXR: () => renderer.enterXR(),
    exitXR: () => renderer.exitXR?.(),
  };
  if (threeApi) {
    const ok = renderer.canEnterXR
      ? await renderer.canEnterXR()
      : await isImmersiveVrSupported(globalThis.navigator?.xr);
    if (!ok) return;
    xrButton.style.display = 'block';
    bindXrButton(xrButton, threeApi);
    return;
  }

  const B = globalThis.BABYLON;
  const scene = renderer.getScene?.();
  if (!B?.WebXRExperienceHelper || !scene) return;

  const xrHelper = await B.WebXRExperienceHelper.CreateAsync(scene);
  const hasXR = await xrHelper.sessionManager.isSessionSupportedAsync('immersive-vr');
  if (!hasXR) return;

  xrButton.style.display = 'block';
  bindXrButton(xrButton, {
    enterXR: () => xrHelper.enterXRAsync('immersive-vr', 'local-floor'),
    exitXR: () => xrHelper.exitXRAsync?.(),
  });
}

main().catch((err) => {
  console.error('[axiom] failed to start', err);
  const el = document.getElementById('console_log');
  if (el) el.textContent = String(err);
});
