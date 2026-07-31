// Phase 1 build: bundle the app + Babylon Lite into dist/ with esbuild.
//
// Lite is code-split (lots of dynamic imports for shader blocks / optional
// features), so we use ESM output + splitting and only the chunks we actually
// touch at runtime get fetched. Unused subsystems (navmesh, CSG, splats...)
// never load.

import esbuild from 'esbuild';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { gzipSync } from 'zlib';
import { join } from 'path';

mkdirSync('dist', { recursive: true });

await esbuild.build({
  entryPoints: ['app/main.js', 'app/sim.worker.js'],
  bundle: true,
  format: 'esm',
  splitting: true,
  minify: true,
  outdir: 'dist',
  platform: 'browser',
  target: 'es2022',
  loader: { '.wasm': 'file' },
  logLevel: 'info',
});

writeFileSync(
  'dist/index.html',
  `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aether v2 — Lite</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #0c0f14; color: #cdd6e4; font-family: system-ui, sans-serif; }
    #canvas { display: block; width: 100%; height: 100%; touch-action: none; }
    #fallback { display: none; place-content: center; height: 100%; padding: 2rem; text-align: center; line-height: 1.6; }
    #legend { position: fixed; left: 12px; bottom: 12px; display: flex; flex-wrap: wrap; gap: 8px 14px; font-size: 12px; opacity: 0.85; pointer-events: none; }
    #legend .legend-item { display: inline-flex; align-items: center; gap: 6px; }
    #legend i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    #status { position: fixed; left: 12px; top: 12px; font-size: 13px; opacity: 0.9; pointer-events: none; }
    #hint { position: fixed; right: 12px; top: 12px; font-size: 12px; opacity: 0.65; pointer-events: none; text-align: right; line-height: 1.5; }
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>
  <div id="status"></div>
  <div id="hint">LMB select · drag box · RMB move selected<br>A then RMB attack-move · RMB enemy attack<br>S stop · Esc clear · MMB pan · Alt+LMB orbit<br>B shadows · ?shadows=0 · ?stress=1000 · ?animStress=32 skinned</div>
  <div id="legend"></div>
  <div id="fallback">
    <div>
      <p><strong>WebGPU required</strong></p>
      <p data-msg>Aether v2 runs on WebGPU.</p>
    </div>
  </div>
  <script type="module" src="./main.js"></script>
</body>
</html>
`,
);

// Report what actually ships.
let total = 0;
let totalGz = 0;
for (const f of readdirSync('dist')) {
  if (!f.endsWith('.js')) continue;
  const buf = readFileSync(join('dist', f));
  const gz = gzipSync(buf).length;
  total += buf.length;
  totalGz += gz;
}
console.log(`\ndist/ built — ${(total / 1024).toFixed(1)} KB raw JS  (~${(totalGz / 1024).toFixed(1)} KB gzip) across all chunks`);
