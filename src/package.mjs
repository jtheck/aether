// Fill ../DEPLOY/ for S3/CloudFront upload: hashed+minified JS.
// Extra javascript-obfuscator is off (stringArray wrecks tick/pose). Opt in:
// PACKAGE_OBFUSCATE=1 npm run package
// assets (incl. baked), PWA bits, index derived from src/index.html.
// Also copies src/axiom/ raw. Forge is an esbuild entry (forge-*.js + forge/index.html).
// Does NOT rebuild vendor lite/howler — uses whatever is already in vendor/.

import esbuild from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';
import {
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  cpSync,
  existsSync,
} from 'fs';
import { gzipSync } from 'zlib';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));
const DEPLOY = join(REPO, 'DEPLOY');
const BAKED = join(REPO, 'assets', 'baked');

function mustExist(rel, hint) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) throw new Error(`Missing ${rel}${hint ? ` — ${hint}` : ''}`);
}

mustExist('vendor/lite/liteVendor.js', 'run: npm run build:lite');
mustExist('vendor/howler.js', 'run: npm run build:howler');
mustExist('vendor/getfire-p2p.js');

if (!existsSync(BAKED) || !existsSync(join(BAKED, 'sockets.json'))) {
  console.warn('⚠️  assets/baked/ incomplete — run: npm run prebake');
  console.warn('   Packaging anyway (runtime will fall back to live bake).');
}

// Clean DEPLOY but keep the folder.
mkdirSync(DEPLOY, { recursive: true });
for (const name of readdirSync(DEPLOY)) {
  if (name === '.gitkeep') continue;
  rmSync(join(DEPLOY, name), { recursive: true, force: true });
}

// splitting:false + liteVendor alias → 2 JS files instead of 400+ Lite shader chunks.
// (splitting:true re-emits every dynamic import from @babylonjs/lite as its own file.)
const result = await esbuild.build({
  entryPoints: {
    main: join(ROOT, 'app/main.js'),
    'sim.worker': join(ROOT, 'app/sim.worker.js'),
    forge: join(ROOT, 'forge/main.js'),
  },
  bundle: true,
  format: 'esm',
  splitting: false,
  minify: true,
  outdir: DEPLOY,
  platform: 'browser',
  target: 'es2022',
  loader: { '.wasm': 'file' },
  entryNames: '[name]-[hash]',
  assetNames: 'asset-[hash]',
  absWorkingDir: ROOT,
  alias: {
    howler: join(ROOT, 'vendor/howler.js'),
    '@babylonjs/lite': join(ROOT, 'vendor/lite/liteVendor.js'),
  },
  logLevel: 'info',
  metafile: true,
  write: true,
});

const outputs = Object.keys(result.metafile.outputs);
const mainOut = outputs.find((p) => /(?:^|\/)main-[^/\\]+\.js$/i.test(p.replace(/\\/g, '/')));
const workerOut = outputs.find((p) => /sim\.worker-[^/\\]+\.js$/i.test(p.replace(/\\/g, '/')));
const forgeOut = outputs.find((p) => /(?:^|\/)forge-[^/\\]+\.js$/i.test(p.replace(/\\/g, '/')));
if (!mainOut) throw new Error('esbuild did not emit main-*.js');
if (!workerOut) throw new Error('esbuild did not emit sim.worker-*.js');
if (!forgeOut) throw new Error('esbuild did not emit forge-*.js');
const mainFile = mainOut.replace(/\\/g, '/').split('/').pop();
const workerFile = workerOut.replace(/\\/g, '/').split('/').pop();
const forgeFile = forgeOut.replace(/\\/g, '/').split('/').pop();
const mainHash = mainFile.replace(/^main-/, '').replace(/\.js$/, '');

// splitting:false does not rewrite `new URL('./sim.worker.js', import.meta.url)`.
// Point the main bundle at the hashed worker filename.
{
  const mainPath = join(DEPLOY, mainFile);
  let mainSrc = readFileSync(mainPath, 'utf8');
  const before = mainSrc;
  mainSrc = mainSrc.replaceAll(
    'new URL("./sim.worker.js",import.meta.url)',
    `new URL("./${workerFile}",import.meta.url)`,
  );
  mainSrc = mainSrc.replaceAll(
    "new URL('./sim.worker.js',import.meta.url)",
    `new URL('./${workerFile}',import.meta.url)`,
  );
  // Minifier may insert spaces.
  mainSrc = mainSrc.replace(
    /new URL\(\s*["']\.\/sim\.worker\.js["']\s*,\s*import\.meta\.url\s*\)/g,
    `new URL("./${workerFile}",import.meta.url)`,
  );
  if (mainSrc === before) {
    throw new Error('Failed to rewrite sim.worker URL in main bundle (pattern not found)');
  }
  writeFileSync(mainPath, mainSrc);
  console.log(`worker URL → ./${workerFile}`);
}

// Off by default. Opt in: PACKAGE_OBFUSCATE=1 npm run package
// Safe because splitting:false fully inlines them (no import/export left for
// the obfuscator to put a preamble in front of). Never run this on the worker
// — stringArray + base64 turned 11ms ticks into 150–500ms.
const obfEnv = (process.env.PACKAGE_OBFUSCATE ?? '0').toLowerCase();
const doObfuscate = obfEnv === '1' || obfEnv === 'true' || obfEnv === 'on' || obfEnv === 'yes';
if (doObfuscate) {
  const obfuscateOpts = {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    selfDefending: false,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.5,
    renameGlobals: false,
    simplify: true,
    target: 'browser',
    ignoreImports: true,
  };
  for (const name of readdirSync(DEPLOY)) {
    if (!/^main-.+\.js$/.test(name)) continue;
    const path = join(DEPLOY, name);
    const src = readFileSync(path, 'utf8');
    if (/(?:^|[;\n])\s*import\s*[\*{'"']|(?:^|[;\n])\s*export\s/.test(src)) {
      throw new Error(
        `${name} still has import/export — obfuscation would break module loading; fix the bundle first`,
      );
    }
    const obfuscated = JavaScriptObfuscator.obfuscate(src, obfuscateOpts).getObfuscatedCode();
    writeFileSync(path, obfuscated);
    console.log('obfuscated', name);
  }
} else {
  console.log('skip extra obfuscate (main + worker minify-only)');
}

// Ensure baked manifest exists (avoids per-mesh 404 probes at runtime).
{
  const bakedDir = join(REPO, 'assets', 'baked');
  const manifestPath = join(bakedDir, 'manifest.json');
  if (existsSync(bakedDir) && !existsSync(manifestPath)) {
    const meshesDir = join(bakedDir, 'meshes');
    const vatDir = join(bakedDir, 'vat');
    const meshes = existsSync(meshesDir)
      ? readdirSync(meshesDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
      : [];
    const vat = existsSync(vatDir)
      ? readdirSync(vatDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
      : [];
    writeFileSync(manifestPath, JSON.stringify({ meshes, vat }, null, 2));
    console.log(`wrote assets/baked/manifest.json (${meshes.length} meshes, ${vat.length} vat)`);
  }
}

// Static copies
cpSync(join(REPO, 'assets'), join(DEPLOY, 'assets'), { recursive: true });
{
  const mapsSrc = join(REPO, 'maps');
  const mapsDst = join(DEPLOY, 'maps');
  mkdirSync(mapsDst, { recursive: true });
  for (const name of readdirSync(mapsSrc)) {
    if (!name.endsWith('.garden')) continue;
    cpSync(join(mapsSrc, name), join(mapsDst, name));
  }
}
cpSync(join(ROOT, 'icons'), join(DEPLOY, 'icons'), { recursive: true });
if (existsSync(join(ROOT, 'graffiti.png'))) {
  cpSync(join(ROOT, 'graffiti.png'), join(DEPLOY, 'graffiti.png'));
}
mkdirSync(join(DEPLOY, 'config'), { recursive: true });
cpSync(join(ROOT, 'config', 'offline.html'), join(DEPLOY, 'config', 'offline.html'));
mkdirSync(join(DEPLOY, 'vendor'), { recursive: true });
cpSync(join(ROOT, 'vendor', 'getfire-p2p.js'), join(DEPLOY, 'vendor', 'getfire-p2p.js'));
cpSync(join(ROOT, 'vendor', 'lite'), join(DEPLOY, 'vendor', 'lite'), { recursive: true });
if (existsSync(join(ROOT, 'vendor', 'lite-explorer'))) {
  cpSync(join(ROOT, 'vendor', 'lite-explorer'), join(DEPLOY, 'vendor', 'lite-explorer'), { recursive: true });
}
cpSync(join(ROOT, 'manifest.json'), join(DEPLOY, 'manifest.json'));

// Legacy extras (under src/) — copy raw, no minify/obfuscate.
function copyRawDir(name, { required = false, note = '' } = {}) {
  const src = join(ROOT, name);
  if (!existsSync(src)) {
    const msg = `⚠️  ${name}/ missing${note ? ` — ${note}` : ''}`;
    if (required) throw new Error(msg);
    console.warn(msg);
    return;
  }
  cpSync(src, join(DEPLOY, name), { recursive: true });
  console.log(`copied ${name}/ (raw)`);
}

copyRawDir('axiom', { note: 'Three default; ?backend=lite / babylon' });
{
  mkdirSync(join(DEPLOY, 'forge'), { recursive: true });
  let forgeHtml = readFileSync(join(ROOT, 'forge/index.html'), 'utf8');
  forgeHtml = forgeHtml.replace(
    /<script type="module" src="\.\/main\.js"><\/script>/i,
    `<script type="module" src="../${forgeFile}"></script>`,
  );
  writeFileSync(join(DEPLOY, 'forge/index.html'), forgeHtml);
  console.log(`forge/index.html → ../${forgeFile}`);
}

let sw = readFileSync(join(ROOT, 'sw-aether.js'), 'utf8');
sw = sw.replace(/const CACHE = ["'][^"']*["']/, `const CACHE = "aether-${mainHash.slice(0, 12)}"`);
writeFileSync(join(DEPLOY, 'sw-aether.js'), sw);

let html = readFileSync(join(ROOT, 'index.html'), 'utf8');
// Drop importmap (bundled) and explorer CSS (optional in prod; F9 won't load explorer chunks easily).
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/i, '');
html = html.replace(/<link rel="stylesheet" href="\.\/vendor\/lite-explorer\/explorer\.css">\s*/i, '');
html = html.replace(
  /<script type="module" src="\.\/app\/main\.js"><\/script>/i,
  `<script type="module" src="./${mainFile}"></script>`,
);
// Normalize getfire path (drop cache-buster query for deploy).
html = html.replace(
  /src="\.\/vendor\/getfire-p2p\.js[^"]*"/i,
  'src="./vendor/getfire-p2p.js"',
);
writeFileSync(join(DEPLOY, 'index.html'), html);

let total = 0;
let totalGz = 0;
for (const name of readdirSync(DEPLOY)) {
  if (!name.endsWith('.js')) continue;
  const buf = readFileSync(join(DEPLOY, name));
  total += buf.length;
  totalGz += gzipSync(buf).length;
}

console.log(`\nDEPLOY/ ready — main=${mainFile}`);
console.log(`JS ${(total / 1024).toFixed(1)} KB raw  (~${(totalGz / 1024).toFixed(1)} KB gzip)`);
console.log(`Upload the contents of ${DEPLOY} to the S3 bucket root.`);
