// Rarely-run: bundle @babylonjs/lite into vendor/lite/ (~6 MB total, code-split once).
// Re-run when package.json @babylonjs/lite version changes — not on every app edit.

import esbuild from 'esbuild';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'fs';
import { gzipSync } from 'zlib';
import { join } from 'path';

mkdirSync('vendor/lite', { recursive: true });
// Drop leftover dynamic-import chunks from older Lite versions.
for (const f of readdirSync('vendor/lite')) {
  rmSync(join('vendor/lite', f), { force: true, recursive: true });
}

// Gameplay patches apply to Lite source during the bundle, before minify.
// Each one must match exactly once or the build fails.
const LITE_PATCHES = [
  {
    // Lite clamps each cascade's far plane to the caster AABB. The ground is a
    // receiver only, so the cast shadow lands past that plane and PCF drops it.
    // Keep the near pull and leave the far plane on the camera frustum.
    file: /csm-shadow-task-hooks\.js$/,
    from: /if \(cMinZ <= viewMaxZ\) \{\s*viewMinZ = Math\.min\(viewMinZ, cMinZ\);\s*viewMaxZ = Math\.min\(viewMaxZ, cMaxZ\);\s*\}/,
    to: 'if (cMinZ < viewMaxZ) { viewMinZ = Math.min(viewMinZ, cMinZ); }',
  },
  {
    // Cascade index is compared against scene.view of whichever camera draws
    // the color pass. In XR that is the eye, while the maps are fitted to the
    // orbit stand-in on scene.camera. The eye's near slice then samples an
    // empty map and the ground under the headset comes back fully lit.
    file: /csm-shadow-task-hooks\.js$/,
    from: 'import { _cameraChangeKey, getEffectiveAspectRatio, getViewProjectionMatrix } from "../camera/camera.js";',
    to: 'import { _cameraChangeKey, getEffectiveAspectRatio, getViewMatrix, getViewProjectionMatrix } from "../camera/camera.js";',
  },
  {
    file: /csm-shadow-task-hooks\.js$/,
    from: '_uboData: /* @__PURE__ */ new Float32Array(80),',
    to: '_uboData: /* @__PURE__ */ new Float32Array(96),',
  },
  {
    file: /csm-shadow-task-hooks\.js$/,
    from: `_writeCsmUbo(state._uboData, cascades, cfg);
	sg._version++;`,
    to: `_writeCsmUbo(state._uboData, cascades, cfg);
	state._uboData.set(getViewMatrix(camera), 80);
	sg._version++;`,
  },
  {
    file: /csm-directional-shadow-generator\.js$/,
    from: '_shadowUBO: createUniformBuffer(engine, /* @__PURE__ */ new Float32Array(80)),',
    to: '_shadowUBO: createUniformBuffer(engine, /* @__PURE__ */ new Float32Array(96)),',
  },
  {
    file: /csm-shadow-fragment-core\.js$/,
    from: 'csmParams:vec4<f32>};',
    to: 'csmParams:vec4<f32>,fitView:mat4x4<f32>};',
  },
  {
    file: /csm-shadow-fragment-core\.js$/,
    from: 'diff=csmInfo${suffix}.viewFrustumZ[i]-viewZ;',
    to: 'diff=csmInfo${suffix}.viewFrustumZ[i]-(csmInfo${suffix}.fitView*worldPos).z;',
  },
  {
    // Standard materials only compile shadow sampling when some mesh in that
    // build already receives shadows. Swapping the board drops the old grass
    // before the new grass exists, so the rebuild omits the shadow map.
    // Compile it whenever a shadow light exists; receiveShadows still decides
    // who samples it.
    file: /standard-group-builder\.js$/,
    from: 'const hasShadow = meshes.some((m) => m.receiveShadows) && scene.lights.some((l) => !!l.shadowGenerator);',
    to: 'const hasShadow = scene.lights.some((l) => !!l.shadowGenerator);',
  },
  {
    // Lit standard materials wrote linear light into the unorm canvas, so the
    // board ignored the exposure grade PBR uses. Diffuse takes most of the
    // exposure above 1. The sun sheen takes less. Unlit overlays are a
    // different shader string and stay as authored.
    file: /standard-template\.js$/,
    from: 'var color=vec4<f32>(finalDiffuse*baseAmbientColor+finalSpecular+reflectionColor,alpha);',
    to: 'let litGrade=1.0+(scene.vImageInfos.x-1.0)*0.9;let specGrade=1.0+(scene.vImageInfos.x-1.0)*0.65;var color=vec4<f32>(finalDiffuse*baseAmbientColor*litGrade+(finalSpecular+reflectionColor)*specGrade,alpha);',
  },
  {
    // Standard materials hardcode the diffuse texture level at 1. Terrain sets
    // diffuseLevel so the lawn can sit darker than the rails and haul props.
    file: /standard-renderable\.js$/,
    from: 'const textureLevel = (features & 127) !== 0 ? 1 : 0;',
    to: 'const textureLevel = (features & 127) !== 0 ? (mat.diffuseLevel ?? 1) : 0;',
  },
];

function liteGameplayPatches() {
  const pending = new Set(LITE_PATCHES);
  return {
    name: 'aether-lite-patches',
    setup(build) {
      build.onLoad({ filter: /csm-shadow-task-hooks\.js$|csm-shadow-fragment-core\.js$|csm-directional-shadow-generator\.js$|standard-group-builder\.js$|standard-template\.js$|standard-renderable\.js$/ }, (args) => {
        const patches = LITE_PATCHES.filter((p) => p.file.test(args.path));
        if (!patches.length) return null;
        let src = readFileSync(args.path, 'utf8');
        for (const patch of patches) {
          const hits = typeof patch.from === 'string'
            ? (src.split(patch.from).length - 1)
            : (src.match(new RegExp(patch.from.source, 'g')) || []).length;
          if (hits !== 1) {
            throw new Error(`Lite patch expected 1 match in ${args.path}, found ${hits}`);
          }
          pending.delete(patch);
          src = src.replace(patch.from, patch.to);
        }
        return { contents: src, loader: 'js' };
      });
      build.onEnd(() => {
        if (pending.size) {
          const names = [...pending].map((p) => p.file.source);
          throw new Error(`Lite patches never applied: ${names.join(', ')}`);
        }
      });
    },
  };
}

// splitting:false — VAT's _registerPbrExt must share the same pbr-flags
// module instance as the dynamically-imported PBR pipeline. With splitting,
// attachVat registered into a duplicate map and VAT never entered the shader
// (bind/T-pose crowds, missing skinned prims).
await esbuild.build({
  entryPoints: ['render/liteVendor.js'],
  bundle: true,
  format: 'esm',
  splitting: false,
  minify: true,
  outfile: 'vendor/lite/liteVendor.js',
  platform: 'browser',
  target: 'es2022',
  loader: { '.wasm': 'file' },
  logLevel: 'info',
  plugins: [liteGameplayPatches()],
});

let total = 0;
let totalGz = 0;
for (const f of readdirSync('vendor/lite')) {
  if (!f.endsWith('.js') && !f.endsWith('.wasm')) continue;
  const buf = readFileSync(join('vendor/lite', f));
  total += buf.length;
  if (f.endsWith('.js')) totalGz += gzipSync(buf).length;
}
console.log(`\nvendor/lite/ — ${(total / 1024 / 1024).toFixed(2)} MB raw JS+WASM  (~${(totalGz / 1024 / 1024).toFixed(2)} MB gzip JS)`);
