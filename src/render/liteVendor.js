// Build entry only — esbuild bundles this into vendor/lite/ (run rarely).
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
  createMeshFromData,
  createTube,
  updateMeshGeometryCapacity,
  createTexture2DFromPixels,
  createGridSpriteAtlas,
  loadTexture2D,
  getOrCreateSampler,
  createStandardMaterial,
  createPbrMaterial,
  addToScene,
  removeFromScene,
  setSubtreeVisible,
  loadGltf,
  cloneTransformNode,
  setThinInstances,
  flushThinInstances,
  setThinInstanceColors,
  setThinInstanceColor,
  createFacingBillboardSystem,
  addFacingBillboardSystem,
  addBillboardSprite,
  updateBillboardSprite,
  removeBillboardSprite,
  clearBillboardSprites,
  billboardBlendAdditive,
  billboardBlendAlpha,
  onBeforeRender,
  onSceneDispose,
  registerScene,
  registerSceneWithShadowSupport,
  startEngine,
  getViewProjectionMatrix,
  mat4Invert,
  playAnimation,
  stopAnimation,
  bakeVat,
  bakeVatMany,
  createGpuPicker,
  disposePicker,
  pickAsync,
  setFog,
  setSceneImageProcessing,
  markMaterialUboDirty,
  loadFont,
  createDefaultTextData,
  updateDefaultTextData,
  disposeDefaultTextData,
  createTextRenderable,
  addTextRenderable,
  disposeTextRenderable,
  createTextLayer,
  createTextRenderer,
  registerTextRenderer,
  disposeTextRenderer,
  createCsmDirectionalShadowGenerator,
  setShadowTaskCasterMeshes,
  // babylon-lite-explorer (F9) imports these via import map → this bundle.
  StandardToneMapping,
  AcesToneMapping,
  NeutralToneMapping,
} from '@babylonjs/lite';

import { attachVat as liteAttachVat } from '@babylonjs/lite';
// Relative paths so esbuild can resolve past package "exports", and so this
// Map is the same instance vat-baker / pbr-compose use inside the bundle.
import { _getPbrExts, _registerPbrExt } from '../node_modules/@babylonjs/lite/lib/material/pbr/pbr-flags.js';
import { pbrExt as vatPbrExt } from '../node_modules/@babylonjs/lite/lib/material/pbr/fragments/vat-fragment.js';

// Register at module load — before any scene pipelines are composed.
_registerPbrExt(vatPbrExt);

export function attachVat(engine, mesh, baked, clip) {
  const handle = liteAttachVat(engine, mesh, baked, clip);
  _registerPbrExt(vatPbrExt);
  return handle;
}

export function debugPbrExtIds() {
  return [..._getPbrExts().keys()];
}
