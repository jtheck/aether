/**
 * Axiom bootstrap: chunk-streamed volume + multi-kind particles.
 * Render backend: Three (default). ?backend=lite or ?backend=babylon
 */
import { createWorld } from './sim/world.js';
import { FPSMeter } from './fps-meter.js';
import { attachMobileMove } from './mobile-move.js';

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
  // Mobile stick is Babylon FreeCamera-shaped; Three uses ESDF/pointer on desktop.
  const cam = renderer.getCamera?.();
  const mobiMove =
    cam && typeof cam.getDirectionToRef === 'function'
      ? attachMobileMove(cam)
      : { tick() {}, dispose() {} };

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

  function climb(fps) {
    const pose = renderer.getCameraPose();
    const room = world.maxLiveForRadius(rAim);
    // Far above target → big bites; near the band → creep
    const grow =
      fps >= 55 ? 1.35 : fps >= 48 ? 1.18 : 1.08;
    const bump = fps >= 55 ? 16000 : fps >= 48 ? 8000 : 3000;
    if (nAim < nCeiling && world.count < room - 32) {
      const next = Math.min(nCeiling, room, Math.max(nAim + bump, Math.ceil(nAim * grow)));
      if (next > nAim) {
        nAim = next;
        world.setTargetCount(nAim);
        console.log(`[axiom] throttle ↑ aim→${nAim} live=${world.count} (fps ${fps})`);
        return true;
      }
      // room already claimed (sphere fill < cube quota) — fall through to grow r
    }
    if (rAim < rCeiling) {
      // Expand volume at current count (dilute) — do NOT fill the new shell to max
      rAim += 1;
      world.setChunkRadius(rAim, pose, nAim);
      console.log(`[axiom] throttle ↑ r→${rAim} aim→${nAim} (fps ${fps})`);
      return true;
    }
    if (nAim < nCeiling) {
      const next = Math.min(nCeiling, Math.max(nAim + bump, Math.ceil(nAim * grow)));
      if (next <= nAim) return false;
      nAim = next;
      world.setTargetCount(nAim);
      console.log(`[axiom] throttle ↑ aim→${nAim} live=${world.count} (fps ${fps})`);
      return true;
    }
    return false;
  }

  function shed(fps) {
    // Prefer cutting count before collapsing volume (r=1 + floor looked empty).
    if (nAim > nFloor) {
      const factor = fps < 30 ? 0.6 : fps < 37 ? 0.78 : 0.9;
      const next = Math.max(nFloor, Math.floor(nAim * factor));
      if (next < nAim) {
        nAim = next;
        world.setTargetCount(nAim);
        console.log(`[axiom] throttle ↓ aim→${nAim} live=${world.count} (fps ${fps})`);
        return true;
      }
    }
    if (rAim > rFloor) {
      rAim -= 1;
      world.setChunkRadius(rAim, renderer.getCameraPose(), nAim);
      console.log(`[axiom] throttle ↓ r→${rAim} aim→${nAim} (fps ${fps})`);
      return true;
    }
    return false;
  }

  const fpsMeter = new FPSMeter({
    onSample({ fps }) {
      if (throttleOn) {
        const now = performance.now();
        const err = Math.abs(fps - FPS_TARGET);
        const cool = err >= 15 ? 250 : err >= 8 ? 400 : 600;
        if (now - lastAdjust >= cool) {
          let moved = false;
          if (fps > FPS_HI) moved = climb(fps);
          else if (fps < FPS_LO) moved = shed(fps);
          if (moved) lastAdjust = now;
        }
      }

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
    }
  });

  window.addEventListener('resize', () => renderer.resize());
  window.addEventListener('orientationchange', () => renderer.resize());

  tryXR(renderer).catch(() => {});

  const engine = renderer.getEngine();
  let lastChunksVersion = -1;
  engine.runRenderLoop(() => {
    const t0 = performance.now();
    const dt = renderer.getDeltaTime();
    mobiMove.tick(dt);
    world.tick(dt, renderer.getCameraPose());
    const uploads = world.getRenderSpecies();
    for (const upload of uploads) renderer.uploadSpecies(upload);
    // Wireframes only when the streamed set changes — signature sort was GC hell every frame.
    if (world.chunksVersion !== lastChunksVersion) {
      lastChunksVersion = world.chunksVersion;
      renderer.syncChunkWireframes(world.getChunkBounds());
    }
    renderer.tickScenery?.();
    renderer.render();
    // Work ms (not RAF interval) — sees headroom when vsync pins FPS at 60
    fpsMeter.tick(performance.now() - t0);
  });

  console.log(
    `[axiom] backend=${BACKEND} chunk volume size=${CHUNK_SIZE} radius=${CHUNK_RADIUS} ` +
      `budget=${INITIAL}/${CAPACITY} boot=${nAim}/r${rAim} throttle=${throttleOn ? 'up' : 'off'} — ` +
      `ESDF fly (R/C up/down), mobi stick (look-dir), G cube wires, F9 inspector`,
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
  const B = globalThis.BABYLON;
  const scene = renderer.getScene();
  const xrButton = document.getElementById('xr_button');
  if (!B?.WebXRExperienceHelper || !scene || !xrButton) return;

  const xrHelper = await B.WebXRExperienceHelper.CreateAsync(scene);
  const hasXR = await xrHelper.sessionManager.isSessionSupportedAsync('immersive-vr');
  if (!hasXR) return;

  xrButton.style.display = 'block';
  xrButton.addEventListener('click', () => {
    xrHelper.enterXRAsync('immersive-vr', 'local-floor').catch(() => {});
  });
  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') xrHelper.exitXRAsync?.();
  });
}

main().catch((err) => {
  console.error('[axiom] failed to start', err);
  const el = document.getElementById('console_log');
  if (el) el.textContent = String(err);
});
