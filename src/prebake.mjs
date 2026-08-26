// Offline asset prebake → ../assets/baked/ (+ generated spawn locals).
// Prefers system Chrome + WebGPU (same Lite bake path as runtime).
// Falls back to a clear error if no GPU adapter is available.

import { createServer } from 'http';
import { readFile, mkdir, writeFile, access } from 'fs/promises';
import { extname, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));
const BAKED = join(REPO, 'assets', 'baked');
const PORT = Number(process.env.PREBAKE_PORT) || 5179;
const HEADED = process.env.PREBAKE_HEADED === '1' || process.env.PREBAKE_HEADED === 'true';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.bin': 'application/octet-stream',
};

function resolvePath(urlPath) {
  const safe = urlPath.replace(/^(\.\.[/\\])+/, '').replace(/\\/g, '/');
  if (safe.startsWith('assets/')) return join(REPO, ...safe.split('/'));
  return join(ROOT, ...safe.split('/'));
}

async function ensureVendor() {
  for (const rel of ['vendor/lite/liteVendor.js', 'vendor/howler.js']) {
    try {
      await access(join(ROOT, rel));
    } catch {
      throw new Error(`Missing ${rel} — run the matching npm run build:* first`);
    }
  }
}

function startServer() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        let path = decodeURIComponent((req.url || '/').split('?')[0]);
        if (path === '/') path = '/prebake/prebake.html';
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
    });
    server.listen(PORT, () => resolve(server));
  });
}

function b64ToBuffer(b64) {
  return Buffer.from(b64, 'base64');
}

async function writeArtifacts(files) {
  await mkdir(BAKED, { recursive: true });
  await mkdir(join(BAKED, 'meshes'), { recursive: true });
  await mkdir(join(BAKED, 'vat'), { recursive: true });

  for (const [rel, payload] of Object.entries(files)) {
    if (rel.startsWith('__generated__/')) {
      const name = rel.slice('__generated__/'.length);
      const out = name.startsWith('render/')
        ? join(ROOT, name)
        : join(ROOT, 'sim', name);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, typeof payload === 'string' ? payload : Buffer.from(payload));
      console.log('wrote', out);
      continue;
    }
    const out = join(BAKED, rel);
    await mkdir(dirname(out), { recursive: true });
    if (typeof payload === 'string') {
      await writeFile(out, payload, 'utf8');
    } else if (typeof payload?.base64 === 'string') {
      await writeFile(out, b64ToBuffer(payload.base64));
    } else {
      throw new Error(`Unsupported payload for ${rel}`);
    }
    console.log('wrote', out);
  }
}

async function launchBrowser() {
  const args = [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan,UseSkiaRenderer,WebGPU',
    '--ignore-gpu-blocklist',
    '--use-angle=d3d11',
    '--disable-gpu-sandbox',
  ];
  // Prefer installed Chrome (usually has a real GPU adapter).
  // Default headed on Windows when PREBAKE_HEADED unset — headless often has no adapter.
  const headed = HEADED || process.platform === 'win32';
  try {
    return await chromium.launch({
      channel: 'chrome',
      headless: headed ? false : true,
      args,
    });
  } catch {
    console.warn('system Chrome not found — falling back to Playwright Chromium');
    return chromium.launch({ headless: headed ? false : true, args });
  }
}

await ensureVendor();
const server = await startServer();
console.log(`prebake server http://localhost:${PORT}/prebake/prebake.html?auto=1`);

const browser = await launchBrowser();

try {
  const page = await browser.newPage();
  page.on('console', (msg) => console.log('browser:', msg.text()));
  page.on('pageerror', (err) => console.error('pageerror:', err));

  // Probe WebGPU before the long bake.
  await page.goto(`http://localhost:${PORT}/prebake/prebake.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  const gpuOk = await page.evaluate(async () => {
    if (!navigator.gpu) return { ok: false, reason: 'navigator.gpu missing' };
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { ok: false, reason: 'No available adapters' };
    return { ok: true, reason: adapter.name || 'adapter ok' };
  });
  if (!gpuOk.ok) {
    throw new Error(
      `WebGPU unavailable in prebake browser (${gpuOk.reason}). ` +
        `Retry with a GPU-enabled Chrome: set PREBAKE_HEADED=1 and ensure Chrome is installed. ` +
        `Mesh/VAT bake must use the same Lite loader as runtime.`,
    );
  }
  console.log('WebGPU:', gpuOk.reason);

  await page.goto(`http://localhost:${PORT}/prebake/prebake.html?auto=1`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });

  await page.waitForFunction(
    () => window.__PREBAKE_RESULT__
      && (window.__PREBAKE_RESULT__.ok === true || window.__PREBAKE_RESULT__.ok === false),
    { timeout: 600_000 },
  );

  const status = await page.evaluate(() => ({
    ok: window.__PREBAKE_RESULT__?.ok === true,
    error: window.__PREBAKE_RESULT__?.error || null,
  }));
  if (!status.ok) {
    throw new Error(status.error || 'prebake failed');
  }

  const encoded = await page.evaluate(async () => {
    const files = window.__PREBAKE_RESULT__.files;
    const out = {};
    for (const [k, v] of Object.entries(files)) {
      if (typeof v === 'string') {
        out[k] = v;
      } else if (v instanceof ArrayBuffer) {
        const bytes = new Uint8Array(v);
        let s = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          s += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        out[k] = { base64: btoa(s) };
      } else {
        out[k] = v;
      }
    }
    return out;
  });

  await writeArtifacts(encoded);
  console.log('\nprebake complete → assets/baked/');
} finally {
  await browser.close();
  server.close();
}
