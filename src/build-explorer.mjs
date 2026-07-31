// Bundle babylon-lite-explorer for native ES module serving (no Vite).
// CSS is linked from index.html; @babylonjs/lite resolves via import map → vendor/lite.

import esbuild from 'esbuild';
import { mkdirSync, copyFileSync } from 'fs';

mkdirSync('vendor/lite-explorer', { recursive: true });

await esbuild.build({
  entryPoints: ['node_modules/babylon-lite-explorer/dist/browser.js'],
  bundle: true,
  format: 'esm',
  outfile: 'vendor/lite-explorer/explorer.js',
  platform: 'browser',
  target: 'es2022',
  external: ['@babylonjs/lite'],
  loader: { '.css': 'empty' },
  logLevel: 'info',
});

copyFileSync(
  'node_modules/babylon-lite-explorer/dist/browser.css',
  'vendor/lite-explorer/explorer.css',
);

console.log('vendor/lite-explorer/ — explorer.js + explorer.css');
