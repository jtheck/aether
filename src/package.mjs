// Fill ../DEPLOY/ for S3/CloudFront upload: hashed+minified JS.
// Extra javascript-obfuscator is off (stringArray wrecks tick/pose). Opt in:
// PACKAGE_OBFUSCATE=1 npm run package
// assets (incl. baked), PWA bits, index derived from src/index.html.
// Forge is an esbuild entry (forge-*.js + forge/index.html).
// src/axiom/ is a separate ship (deploy-axiom.ps1); do not copy it here.
// Does NOT rebuild vendor lite/howler - uses whatever is already in vendor/.

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
  statSync,
} from 'fs';
import { gzipSync } from 'zlib';
import { createHash } from 'crypto';
import { join, extname, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { listHouseMapRelPaths, readSkirmishCatalog, resolveMapsUrl } from './mapsResolve.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));
const DEPLOY = join(REPO, 'DEPLOY');
const BAKED = join(REPO, 'assets', 'baked');
const ASSET_REV_JS = join(ROOT, 'render', 'assetRev.js');

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkFiles(path, out);
    else out.push(path);
  }
  return out;
}

/** `meshes/trees.json` → `meshes/trees-<hash>.json` */
function hashedAssetRel(rel, hash) {
  const slash = rel.lastIndexOf('/');
  const dir = slash >= 0 ? rel.slice(0, slash + 1) : '';
  const file = slash >= 0 ? rel.slice(slash + 1) : rel;
  const dot = file.lastIndexOf('.');
  if (dot <= 0) return `${dir}${file}-${hash}`;
  return `${dir}${file.slice(0, dot)}-${hash}${file.slice(dot)}`;
}

/**
 * Content-hash every file under repo assets/. Dev keeps the stable names;
 * DEPLOY only has the hashed copies. Keys are `/assets/<rel>`.
 * @returns {Record<string, string>}
 */
function publishHashedAssets() {
  const srcRoot = join(REPO, 'assets');
  /** @type {Record<string, string>} */
  const rev = {};
  if (!existsSync(srcRoot)) return rev;
  for (const file of walkFiles(srcRoot)) {
    const rel = relative(srcRoot, file).replace(/\\/g, '/');
    const buf = readFileSync(file);
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 12);
    const hashed = hashedAssetRel(rel, hash);
    rev[`/assets/${rel}`] = `/assets/${hashed}`;
    const dest = join(DEPLOY, 'assets', hashed);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
  }
  return rev;
}

function rewriteAssetUrls(text, rev) {
  const keys = Object.keys(rev).sort((a, b) => b.length - a.length);
  let out = text;
  for (const key of keys) {
    if (out.includes(key)) out = out.replaceAll(key, rev[key]);
  }
  return out;
}

function mustExist(rel, hint) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) throw new Error(`Missing ${rel}${hint ? ` - ${hint}` : ''}`);
}

mustExist('vendor/lite/liteVendor.js', 'run: npm run build:lite');
mustExist('vendor/howler.js', 'run: npm run build:howler');
mustExist('vendor/getfire-p2p.js');
mustExist('vendor/getfire.js');

if (!existsSync(BAKED) || !existsSync(join(BAKED, 'sockets.json'))) {
  console.warn('⚠️  assets/baked/ incomplete - run: npm run prebake');
  console.warn('   Packaging anyway (runtime will fall back to live bake).');
}

// Clean DEPLOY but keep the folder.
mkdirSync(DEPLOY, { recursive: true });
for (const name of readdirSync(DEPLOY)) {
  if (name === '.gitkeep') continue;
  rmSync(join(DEPLOY, name), { recursive: true, force: true });
}

// Ensure baked manifest exists before hashing, so the deploy copy includes it.
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

const assetRev = publishHashedAssets();
console.log(`hashed ${Object.keys(assetRev).length} assets`);

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
  plugins: [
    {
      name: 'asset-rev',
      setup(build) {
        build.onLoad({ filter: /assetRev\.js$/ }, () => {
          const needle = 'const ASSET_REV = Object.freeze({});';
          let src = readFileSync(ASSET_REV_JS, 'utf8');
          if (!src.includes(needle)) {
            throw new Error('assetRev.js is missing the empty ASSET_REV marker');
          }
          src = src.replace(needle, `const ASSET_REV = Object.freeze(${JSON.stringify(assetRev)});`);
          return { contents: src, loader: 'js', resolveDir: dirname(ASSET_REV_JS) };
        });
      },
    },
  ],
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
  const sample = Object.values(assetRev)[0];
  if (sample && !mainSrc.includes(sample)) {
    throw new Error('asset rev map was not bundled');
  }
}

// Off by default. Opt in: PACKAGE_OBFUSCATE=1 npm run package
// Safe because splitting:false fully inlines them (no import/export left for
// the obfuscator to put a preamble in front of). Never run this on the worker
// - stringArray + base64 turned 11ms ticks into 150–500ms.
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
        `${name} still has import/export - obfuscation would break module loading; fix the bundle first`,
      );
    }
    const obfuscated = JavaScriptObfuscator.obfuscate(src, obfuscateOpts).getObfuscatedCode();
    writeFileSync(path, obfuscated);
    console.log('obfuscated', name);
  }
} else {
  console.log('skip extra obfuscate (main + worker minify-only)');
}

// Static copies. assets/ is already content-hashed into DEPLOY/assets.
{
  const mapsDst = join(DEPLOY, 'maps');
  mkdirSync(mapsDst, { recursive: true });
  for (const rel of listHouseMapRelPaths(REPO)) {
    const src = resolveMapsUrl(REPO, `maps/${rel}`);
    if (!src) continue;
    const dst = join(mapsDst, rel);
    mkdirSync(join(dst, '..'), { recursive: true });
    cpSync(src, dst);
  }
  const skirmishIndex = join(mapsDst, 'skirmish', 'index.json');
  if (existsSync(join(mapsDst, 'skirmish'))) {
    writeFileSync(skirmishIndex, `${JSON.stringify(readSkirmishCatalog(REPO), null, 2)}\n`);
  }
  const readme = join(REPO, 'maps', 'README.md');
  if (existsSync(readme)) {
    mkdirSync(mapsDst, { recursive: true });
    cpSync(readme, join(mapsDst, 'README.md'));
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
cpSync(join(ROOT, 'vendor', 'getfire.js'), join(DEPLOY, 'vendor', 'getfire.js'));
cpSync(join(ROOT, 'vendor', 'lite'), join(DEPLOY, 'vendor', 'lite'), { recursive: true });
if (existsSync(join(ROOT, 'vendor', 'lite-explorer'))) {
  cpSync(join(ROOT, 'vendor', 'lite-explorer'), join(DEPLOY, 'vendor', 'lite-explorer'), { recursive: true });
}
cpSync(join(ROOT, 'manifest.json'), join(DEPLOY, 'manifest.json'));

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

let html = rewriteAssetUrls(readFileSync(join(ROOT, 'index.html'), 'utf8'), assetRev);
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

console.log(`\nDEPLOY/ ready - main=${mainFile}`);
console.log(`JS ${(total / 1024).toFixed(1)} KB raw  (~${(totalGz / 1024).toFixed(1)} KB gzip)`);
console.log(`Upload the contents of ${DEPLOY} to the S3 bucket root.`);
