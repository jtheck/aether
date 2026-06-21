// Build entry only — esbuild bundles this into vendor/lite.bundle.js (run rarely).
// App code imports the bundle, not @babylonjs/lite.

export {
  createEngine,
  createSceneContext,
  createArcRotateCamera,
  attachControl,
  createHemisphericLight,
  createDirectionalLight,
  createSphere,
  createGround,
  createCylinder,
  createStandardMaterial,
  addToScene,
  loadGltf,
  cloneTransformNode,
  setThinInstances,
  flushThinInstances,
  setThinInstanceColors,
  setThinInstanceColor,
  onBeforeRender,
  registerScene,
  startEngine,
  getViewProjectionMatrix,
  mat4Invert,
} from '@babylonjs/lite';
