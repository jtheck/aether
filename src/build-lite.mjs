// Rarely-run: bundle @babylonjs/lite into vendor/lite/ (~6 MB total, code-split once).
// Re-run when package.json @babylonjs/lite version changes — not on every app edit.

import esbuild from 'esbuild';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { gzipSync } from 'zlib';
import { join } from 'path';

mkdirSync('vendor/lite', { recursive: true });
// Drop leftover dynamic-import chunks from older Lite versions.
for (const f of readdirSync('vendor/lite')) {
  rmSync(join('vendor/lite', f), { force: true, recursive: true });
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
});

// Lite clamps each cascade's far plane to the caster AABB. The ground is a
// receiver only, so the cast shadow lands past that plane and PCF drops it.
// Casters stay inside the range, which reads as buildings shadowing themselves.
// Keep the near pull (casters in front of the slice still draw) and leave the
// far plane on the camera frustum.
const CSM_FAR_CLAMP = /(\w+)<=(\w+)&&\((\w+)=Math\.min\(\3,\1\),\2=Math\.min\(\2,(\w+)\)\)/g;
function keepCsmFarOnFrustum(file) {
  const src = readFileSync(file, 'utf8');
  const matches = src.match(CSM_FAR_CLAMP);
  if (!matches || matches.length !== 1) {
    throw new Error(`CSM far-plane patch expected 1 match in ${file}, found ${matches?.length ?? 0}`);
  }
  writeFileSync(file, src.replace(CSM_FAR_CLAMP, '$1<$2&&($3=Math.min($3,$1))'));
}
keepCsmFarOnFrustum(join('vendor/lite', 'liteVendor.js'));

// Standard materials only compile shadow sampling when some mesh in that
// build already receives shadows. Swapping the board drops the old grass
// before the new grass exists, so the rebuild omits the shadow map and vs AI
// / unit tester look unshadowed. Compile it whenever a shadow light exists;
// per-mesh receiveShadows still decides who samples it.
const STD_SHADOW_GATE = /r\.some\(g=>g\.receiveShadows\)&&t\.lights\.some\(g=>!!g\.shadowGenerator\)/g;
function keepStandardShadowSampling(file) {
  const src = readFileSync(file, 'utf8');
  const matches = src.match(STD_SHADOW_GATE);
  if (!matches || matches.length !== 1) {
    throw new Error(`Standard shadow-sampling patch expected 1 match in ${file}, found ${matches?.length ?? 0}`);
  }
  writeFileSync(file, src.replace(STD_SHADOW_GATE, 't.lights.some(g=>!!g.shadowGenerator)'));
}
keepStandardShadowSampling(join('vendor/lite', 'liteVendor.js'));

// Lit standard materials (terrain, tree cards) wrote linear light straight
// into the unorm canvas, so the board ignored the exposure grade PBR uses.
// Diffuse takes most of the exposure above 1. The sun sheen takes less, so
// the sunny side stays a glint. Unlit overlays are a different shader
// string and stay as authored.
const STD_LIT_COLOR = 'var color = vec4<f32>(finalDiffuse * baseAmbientColor + finalSpecular + reflectionColor, alpha);';
const STD_LIT_COLOR_GRADED = 'let litGrade = 1.0 + (scene.vImageInfos.x - 1.0) * 0.9; let specGrade = 1.0 + (scene.vImageInfos.x - 1.0) * 0.65; var color = vec4<f32>(finalDiffuse * baseAmbientColor * litGrade + (finalSpecular + reflectionColor) * specGrade, alpha);';
function gradeLitStandardByExposure(file) {
  const src = readFileSync(file, 'utf8');
  const count = src.split(STD_LIT_COLOR).length - 1;
  if (count !== 1) {
    throw new Error(`Standard exposure patch expected 1 match in ${file}, found ${count}`);
  }
  writeFileSync(file, src.replace(STD_LIT_COLOR, STD_LIT_COLOR_GRADED));
}
gradeLitStandardByExposure(join('vendor/lite', 'liteVendor.js'));

// Standard materials hardcode the diffuse texture level at 1. Terrain sets
// diffuseLevel so the lawn can sit darker than the rails and haul props.
const STD_TEX_LEVEL = /(\w+)=\((\w+)&(\w+)\)!==0\?1:0,(\w+)=new L\(24\);(\w+)\(\4,(\w+),\1\)/;
function keepDiffuseLevel(file) {
  const src = readFileSync(file, 'utf8');
  const matches = src.match(new RegExp(STD_TEX_LEVEL, 'g'));
  if (!matches || matches.length !== 1) {
    throw new Error(`Diffuse level patch expected 1 match in ${file}, found ${matches?.length ?? 0}`);
  }
  writeFileSync(
    file,
    src.replace(STD_TEX_LEVEL, '$1=($2&$3)!==0?($6.diffuseLevel??1):0,$4=new L(24);$5($4,$6,$1)'),
  );
}
keepDiffuseLevel(join('vendor/lite', 'liteVendor.js'));

let total = 0;
let totalGz = 0;
for (const f of readdirSync('vendor/lite')) {
  if (!f.endsWith('.js') && !f.endsWith('.wasm')) continue;
  const buf = readFileSync(join('vendor/lite', f));
  total += buf.length;
  if (f.endsWith('.js')) totalGz += gzipSync(buf).length;
}
console.log(`\nvendor/lite/ — ${(total / 1024 / 1024).toFixed(2)} MB raw JS+WASM  (~${(totalGz / 1024 / 1024).toFixed(2)} MB gzip JS)`);
