// Rarely-run: bundle @babylonjs/lite into vendor/lite/ (~6 MB total, code-split once).
// Re-run when package.json @babylonjs/lite version changes — not on every app edit.

import esbuild from 'esbuild';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'fs';
import { gzipSync } from 'zlib';
import { join } from 'path';

mkdirSync('vendor/lite', { recursive: true });
// Drop stale code-split chunks from older builds (they duplicate pbr-flags).
for (const f of readdirSync('vendor/lite')) {
  if (f.startsWith('chunk-') && f.endsWith('.js')) {
    rmSync(join('vendor/lite', f), { force: true });
  }
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

let total = 0;
let totalGz = 0;
for (const f of readdirSync('vendor/lite')) {
  if (!f.endsWith('.js') && !f.endsWith('.wasm')) continue;
  const buf = readFileSync(join('vendor/lite', f));
  total += buf.length;
  if (f.endsWith('.js')) totalGz += gzipSync(buf).length;
}
console.log(`\nvendor/lite/ — ${(total / 1024 / 1024).toFixed(2)} MB raw JS+WASM  (~${(totalGz / 1024 / 1024).toFixed(2)} MB gzip JS)`);
