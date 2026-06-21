// Rarely-run: bundle @babylonjs/lite into vendor/lite/ (~6 MB total, code-split once).
// Re-run when package.json @babylonjs/lite version changes — not on every app edit.

import esbuild from 'esbuild';
import { mkdirSync, readFileSync, readdirSync } from 'fs';
import { gzipSync } from 'zlib';
import { join } from 'path';

mkdirSync('vendor/lite', { recursive: true });

await esbuild.build({
  entryPoints: ['render/liteVendor.js'],
  bundle: true,
  format: 'esm',
  splitting: true,
  minify: true,
  outdir: 'vendor/lite',
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
