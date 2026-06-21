// Dev server: serves src/ directly (app + sim as native ES modules).
// vendor/lite.bundle.js is prebuilt — run `npm run build:lite` when Lite version changes.
// COOP/COEP required for SharedArrayBuffer / sim worker.

import { createServer } from 'http';
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
  '.map': 'application/json; charset=utf-8',
};

function resolvePath(urlPath) {
  const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '').replace(/\\/g, '/');
  if (safe.startsWith('assets/')) return join(REPO, ...safe.split('/'));
  return join(ROOT, ...safe.split('/'));
}

try {
  await access(join(ROOT, 'vendor', 'lite', 'liteVendor.js'));
} catch {
  console.warn('⚠️  vendor/lite/ missing — run: npm run build:lite');
}

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url || '/').split('?')[0]);
    if (path === '/') path = '/index.html';
    const file = resolvePath(path.replace(/^\//, ''));
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(PORT, () => {
  console.log(`serving src/ at http://localhost:${PORT}`);
  console.log('edit app/ sim/ render/ — refresh browser, no rebuild');
});
