// Bundle howler into an ESM module for native-ESM serve + import maps.
// Re-run when the howler package version changes.

import esbuild from 'esbuild';
import { mkdirSync, readFileSync } from 'fs';
import { gzipSync } from 'zlib';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const out = join(ROOT, 'vendor', 'howler.js');

mkdirSync(join(ROOT, 'vendor'), { recursive: true });

await esbuild.build({
  stdin: {
    contents: `export { Howl, Howler } from 'howler';\n`,
    resolveDir: ROOT,
    sourcefile: 'howler-entry.js',
  },
  bundle: true,
  format: 'esm',
  outfile: out,
  platform: 'browser',
  target: 'es2022',
  logLevel: 'info',
});

const buf = readFileSync(out);
console.log(
  `vendor/howler.js — ${(buf.length / 1024).toFixed(1)} KB raw  (~${(gzipSync(buf).length / 1024).toFixed(1)} KB gzip)`,
);
