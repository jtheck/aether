import {
  addToScene,
  attachControl,
  createArcRotateCamera,
  createEngine,
  createGround,
  createHemisphericLight,
  createSceneContext,
  createSphere,
  createStandardMaterial,
  enableXrCompatibleAdapter,
  enterXr,
  exitXr,
  isWebGpuXrSupported,
  isWebXrPresent,
  isXrSessionSupported,
  pointerSelection,
  registerScene,
  startEngine,
  teleportation,
} from '@babylonjs/lite';

const canvas = document.querySelector('#c');
const logEl = document.querySelector('#log');
const enterBtn = document.querySelector('#enter');
const lines = [];

function log(line) {
  lines.push(line);
  logEl.textContent = lines.join('\n');
  console.log('[xr-probe]', line);
}

enableXrCompatibleAdapter();

const webgpu = !!navigator.gpu;
const xrPresent = isWebXrPresent();
const gpuXr = isWebGpuXrSupported();
log(`lite 1.33 probe`);
log(`WebGPU: ${webgpu}`);
log(`navigator.xr: ${xrPresent}`);
log(`XRGPUBinding: ${gpuXr}`);

let session = null;

if (!webgpu) {
  log('This browser has no WebGPU. Lite cannot start.');
} else {
  const engine = await createEngine(canvas);
  const scene = createSceneContext(engine);
  addToScene(scene, createHemisphericLight([0, 1, 0], 1));

  const groundMat = createStandardMaterial();
  groundMat.diffuseColor = [0.25, 0.45, 0.28];
  const ground = createGround(engine, { width: 8, height: 8 });
  ground.material = groundMat;
  addToScene(scene, ground);

  const colors = [
    [0.9, 0.25, 0.2],
    [0.2, 0.45, 0.95],
    [0.95, 0.75, 0.15],
  ];
  for (let i = 0; i < colors.length; i++) {
    const mat = createStandardMaterial();
    mat.diffuseColor = colors[i];
    const sphere = createSphere(engine, { diameter: 0.4, segments: 16 });
    sphere.material = mat;
    sphere.position.set((i - 1) * 1.2, 0.2, -0.4);
    addToScene(scene, sphere);
  }

  const camera = createArcRotateCamera(Math.PI / 2, 1.05, 6, [0, 0, 0]);
  addToScene(scene, camera);
  attachControl(camera, canvas, scene);

  await registerScene(scene);
  await startEngine(engine);
  log('Flat scene is up. XR uses the same scene.');

  const immersive = xrPresent ? await isXrSessionSupported('immersive-vr') : false;
  log(`immersive-vr + WebGPU binding: ${immersive}`);
  if (!gpuXr) {
    log('XRGPUBinding is missing. In Chrome enable WebXR Projection Layers and WebXR/WebGPU Bindings, then relaunch.');
  }
  enterBtn.disabled = !immersive;

  enterBtn.addEventListener('click', async () => {
    if (session) {
      enterBtn.disabled = true;
      try {
        await exitXr(session);
      } catch (err) {
        log(`exit failed: ${err?.message || err}`);
      }
      return;
    }
    enterBtn.disabled = true;
    try {
      session = await enterXr(scene, {
        features: [
          pointerSelection(),
          teleportation({ floorMeshes: [ground] }),
        ],
        onEnd: () => {
          session = null;
          enterBtn.disabled = false;
          enterBtn.textContent = 'Enter XR';
          log('Session ended.');
        },
      });
      enterBtn.textContent = 'Exit XR';
      log(`In XR. layer ${session.layer?.constructor?.name || 'projection'}, cameras ${session.cameras.length}`);
    } catch (err) {
      session = null;
      log(`enterXr failed: ${err?.message || err}`);
    }
    enterBtn.disabled = false;
  });
}
