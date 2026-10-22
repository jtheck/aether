// Esbuild entry for sprite prebake only. The game vendor bundle tree-shakes
// screenshot readback, so portrait captures use this separate bundle.
export {
  addToScene,
  captureScreenshot,
  createArcRotateCamera,
  createMeshFromData,
  createDirectionalLight,
  createEngine,
  createHemisphericLight,
  createSceneContext,
  disposeEngine,
  enableOrthographicCamera,
  goToFrame,
  loadGltf,
  registerScene,
  removeFromScene,
  resizeEngine,
  setSubtreeVisible,
  startEngine,
  stopEngine,
} from '@babylonjs/lite';
