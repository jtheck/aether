// Dev server: serves src/ directly (app + sim as native ES modules).
// vendor/lite.bundle.js is prebuilt — run `npm run build:lite` when Lite version changes.
// COOP/COEP required for SharedArrayBuffer / sim worker.

import { createServer } from 'http';
import { existsSync } from 'fs';
import { readFile, access } from 'fs/promises';
import { extname, join, normalize } from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.map': 'application/json; charset=utf-8',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};

function resolveRepoDir(safe, dir) {
  if (safe !== dir && !safe.startsWith(`${dir}/`)) return null;
  let rest = safe === dir || safe === `${dir}/` ? 'index.html' : safe.slice(dir.length + 1);
  if (!rest || rest.endsWith('/')) rest = `${rest}index.html`;
  return join(REPO, dir, ...rest.split('/').filter(Boolean));
}

function resolvePath(urlPath) {
  const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '').replace(/\\/g, '/');
  if (safe.startsWith('assets/')) return join(REPO, ...safe.split('/'));
  // Soft-landing for no-WebGPU — serve ../axiom/ at /axiom/
  const axiomPath = resolveRepoDir(safe, 'axiom');
  if (axiomPath) return axiomPath;
  // Classic map editor — serve ../forge/ (+ sibling game/vendor/rt.css via <base href="../">)
  const forgePath = resolveRepoDir(safe, 'forge');
  if (forgePath) return forgePath;
  if (safe.startsWith('game/')) return join(REPO, ...safe.split('/'));
  if (safe === 'rt.css') return join(REPO, 'rt.css');
  // Prefer src/vendor, fall back to repo vendor (babylon8 etc. for forge).
  if (safe.startsWith('vendor/')) {
    const fromSrc = join(ROOT, ...safe.split('/'));
    if (existsSync(fromSrc)) return fromSrc;
    return join(REPO, ...safe.split('/'));
  }
  return join(ROOT, ...safe.split('/'));
}

try {
  await access(join(ROOT, 'vendor', 'lite', 'liteVendor.js'));
} catch {
  console.warn('⚠️  vendor/lite/ missing — run: npm run build:lite');
}
try {
  await access(join(ROOT, 'vendor', 'lite-explorer', 'explorer.js'));
} catch {
  console.warn('⚠️  vendor/lite-explorer/ missing — run: npm run build:explorer');
}
try {
  await access(join(ROOT, 'vendor', 'howler.js'));
} catch {
  console.warn('⚠️  vendor/howler.js missing — run: npm run build:howler');
}

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url || '/').split('?')[0]);
    if (path === '/') path = '/index.html';
    if (path === '/axiom' || path === '/axiom/') path = '/axiom/index.html';
    if (path === '/forge' || path === '/forge/') path = '/forge/index.html';
    const file = resolvePath(path.replace(/^\//, ''));
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(PORT, () => {
  console.log(`serving src/ at http://localhost:${PORT}`);
  console.log(`axiom soft-landing at http://localhost:${PORT}/axiom/`);
  console.log(`forge editor at http://localhost:${PORT}/forge/`);
  console.log('edit app/ sim/ render/ — refresh browser, no rebuild');
});
