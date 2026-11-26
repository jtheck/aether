import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import nwbuild from 'nw-builder';
import { build as buildPlist, parse as parsePlist } from 'plist';
import { resolveTarget } from './targets.mjs';

// Windows, Linux x64, and Mac stay on Chromium 155. NW.js 0.119.x (Chromium 156)
// aborts when WebGPU WebXR creates its shared-image swapchain
// (xr_gpu_swap_chain.cc:170). Frame instead uses the locally built, patched
// Chromium 158 / NW.js 0.121 runtime documented in FRAME.md.
const NW_VERSION = '0.118.0';

const target = resolveTarget(process.argv[2] || 'win');
if (!target) {
  console.error('[steam-build] Unknown target. Use win, linux, linux-arm64, or osx.');
  process.exit(1);
}

const outDir = process.env.AETHER_DIST_DIR || target.outDir;
const runtimeOptions = resolveRuntimeOptions(target);
const app = {
  name: 'Aether',
};
if (target.nwPlatform === 'linux') app.icon = './app/build/icon.png';
if (target.nwPlatform === 'win') app.icon = './app/build/icon.ico';
if (target.nwPlatform === 'osx') {
  app.icon = writeOsxIcon();
  app.CFBundleIdentifier = 'garden.aether.steam';
  app.LSApplicationCategoryType = 'public.app-category.games';
  app.CFBundleName = 'Aether';
  app.CFBundleDisplayName = 'Aether';
  app.CFBundleSpokenName = 'Aether';
  app.CFBundleVersion = '0.1.0';
  app.CFBundleShortVersionString = '0.1.0';
  app.NSHumanReadableCopyright = 'Aether.Garden';
  if (process.platform === 'win32') allowOsxExtractWithoutSymlinks();
}

await nwbuild({
  mode: 'build',
  srcDir: './app',
  version: target.nwVersion || NW_VERSION,
  flavor: 'normal',
  platform: target.nwPlatform,
  arch: target.arch,
  outDir,
  glob: false,
  managedManifest: true,
  app,
  ...runtimeOptions,
});

if (target.nwArchive) {
  const libAtSpi = path.join(path.dirname(path.resolve(target.nwArchive)), 'libatspi.so.0');
  if (!fs.existsSync(libAtSpi)) {
    throw new Error('[steam-build] Missing patched Frame runtime dependency: ' + libAtSpi);
  }
  const libDir = path.join(outDir, 'lib');
  fs.mkdirSync(libDir, { recursive: true });
  fs.copyFileSync(libAtSpi, path.join(libDir, 'libatspi.so.0'));
  console.log('[steam-build] Added Frame runtime dependency lib/libatspi.so.0');
}

if (target.nwPlatform === 'osx') {
  // nw-builder 4.17 renames the original four helpers only. NW.js 0.118 also
  // ships Aperitif helpers, and the running app looks them up by product name.
  const framework = path.join(outDir, 'Aether.app', 'Contents', 'Frameworks', 'nwjs Framework.framework');
  const currentHelpers = path.join(framework, 'Versions', 'Current', 'Helpers');
  renameAperitifHelpers(currentHelpers, app.name, app.CFBundleIdentifier);
  const currentLink = path.join(framework, 'Versions', 'Current');
  const copiedFramework = !fs.lstatSync(currentLink).isSymbolicLink();
  if (copiedFramework) {
    // No symlink privilege: Current and the top-level Helpers entry are separate copies.
    const versions = path.join(framework, 'Versions');
    for (const entry of fs.readdirSync(versions)) {
      if (entry === 'Current') continue;
      replaceTree(currentHelpers, path.join(versions, entry, 'Helpers'));
    }
    replaceTree(currentHelpers, path.join(framework, 'Helpers'));
  }
  if (process.platform === 'win32') rewritePosixSymlinks(outDir);
}

console.log('[steam-build] Built to ' + outDir + '/ (' + target.nwPlatform + ' ' + target.arch + ', NW.js ' + (target.nwVersion || NW_VERSION) + ')');

function resolveRuntimeOptions(buildTarget) {
  if (!buildTarget.nwArchive) return {};

  const archive = path.resolve(buildTarget.nwArchive);
  const expected = `nwjs-v${buildTarget.nwVersion}-${buildTarget.nwPlatform}-${buildTarget.arch}.tar.gz`;
  if (path.basename(archive) !== expected) {
    throw new Error(`[steam-build] Patched NW.js archive must be named ${expected}: ${archive}`);
  }
  if (!fs.existsSync(archive)) {
    throw new Error(
      `[steam-build] Missing patched Frame runtime: ${archive}\n`
      + 'Set AETHER_FRAME_NW_ARCHIVE to the built archive path.',
    );
  }

  console.log('[steam-build] Using patched Frame runtime ' + archive);
  return {
    cacheDir: path.dirname(archive),
    manifestUrl: new URL('./patched-nw-manifest.json', import.meta.url).href,
    // This is a locally built artifact, not an official dl.nwjs.io release.
    shaSum: false,
  };
}

function writeOsxIcon() {
  const png = fs.readFileSync('./app/build/icon.png');
  const chunkLen = 8 + png.length;
  const total = 8 + chunkLen;
  const buf = Buffer.alloc(total);
  buf.write('icns', 0, 'ascii');
  buf.writeUInt32BE(total, 4);
  buf.write('ic09', 8, 'ascii');
  buf.writeUInt32BE(chunkLen, 12);
  png.copy(buf, 16);
  const dest = './cache/aether-osx.icns';
  fs.mkdirSync('./cache', { recursive: true });
  fs.writeFileSync(dest, buf);
  return dest;
}

// NW.js ships five framework symlinks. This Windows account cannot create them.
// Directory links become junctions in the cache, then real copies in dist-osx.
function allowOsxExtractWithoutSymlinks() {
  const origSymlink = fs.promises.symlink.bind(fs.promises);
  const origCp = fs.promises.cp.bind(fs.promises);
  const pending = [];
  let announced = false;

  fs.promises.symlink = async (linkTarget, dest) => {
    try {
      return await origSymlink(linkTarget, dest);
    } catch (err) {
      if (err?.code !== 'EPERM' && err?.code !== 'EACCES') throw err;
      if (!announced) {
        announced = true;
        console.warn('[steam-build] Windows blocked Mac symlinks. The .app will contain copies of the framework links.');
        fs.promises.cp = (src, dest, opts = {}) => {
          const next = { ...opts, dereference: true };
          delete next.verbatimSymlinks;
          return origCp(src, dest, next);
        };
      }
      pending.push({ linkTarget, dest });
      await drain(origSymlink, pending);
    }
  };
}

function renameAperitifHelpers(helpersDir, appName, bundleId) {
  const helpers = [
    ['nwjs Helper (Aperitif Alerts).app', 'helper.aperitif.alert'],
    ['nwjs Helper (Aperitif GPU).app', 'helper.aperitif.gpu'],
    ['nwjs Helper (Aperitif Renderer).app', 'helper.aperitif.renderer'],
    ['nwjs Helper (Aperitif).app', 'helper.aperitif'],
  ];
  if (!fs.existsSync(helpersDir)) return;
  for (const [fromName, helperId] of helpers) {
    const oldPath = path.join(helpersDir, fromName);
    if (!fs.existsSync(oldPath)) continue;
    const newName = fromName.replace(/^nwjs/, appName);
    const newPath = path.join(helpersDir, newName);
    fs.renameSync(oldPath, newPath);
    const oldExe = fromName.replace(/\.app$/, '');
    const newExe = newName.replace(/\.app$/, '');
    const macDir = path.join(newPath, 'Contents', 'MacOS');
    fs.renameSync(path.join(macDir, oldExe), path.join(macDir, newExe));
    const plistPath = path.join(newPath, 'Contents', 'Info.plist');
    const plistJson = parsePlist(fs.readFileSync(plistPath, 'utf8'));
    plistJson.CFBundleDisplayName = newExe;
    plistJson.CFBundleName = newExe;
    plistJson.CFBundleExecutable = newExe;
    plistJson.CFBundleIdentifier = bundleId + '.' + helperId;
    fs.writeFileSync(plistPath, buildPlist(plistJson));
  }
}

function replaceTree(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, dereference: true });
}

// Node stores Windows symlink targets with backslashes. macOS needs forward slashes.
function rewritePosixSymlinks(root) {
  const jobs = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) {
        const target = fs.readlinkSync(full);
        const absTarget = path.resolve(path.dirname(full), target);
        jobs.push({
          full,
          target: target.replaceAll('\\', '/'),
          flags: fs.statSync(absTarget).isDirectory() ? 3 : 2,
        });
        continue;
      }
      if (ent.isDirectory()) walk(full);
    }
  }
  walk(root);
  if (!jobs.length) return;
  for (const job of jobs) fs.unlinkSync(job.full);
  const listPath = path.join('cache', 'posix-symlinks.json');
  fs.writeFileSync(listPath, JSON.stringify(jobs));
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PosixLink {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CreateSymbolicLinkW(string link, string target, int flags);
}
"@
$jobs = Get-Content -Raw -LiteralPath $env:AETHER_LINK_LIST | ConvertFrom-Json
foreach ($job in $jobs) {
  $ok = [PosixLink]::CreateSymbolicLinkW($job.full, $job.target, [int]$job.flags)
  if (-not $ok) {
    throw "symlink failed $($job.full) error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
}
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    env: { ...process.env, AETHER_LINK_LIST: listPath },
    encoding: 'utf8',
  });
  fs.unlinkSync(listPath);
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'posix symlink rewrite failed');
  }
}

async function drain(origSymlink, pending) {
  let progressed = true;
  while (pending.length && progressed) {
    progressed = false;
    for (let i = 0; i < pending.length;) {
      const item = pending[i];
      const abs = path.resolve(path.dirname(item.dest), item.linkTarget);
      if (!fs.existsSync(abs)) {
        i += 1;
        continue;
      }
      const st = await fs.promises.stat(abs);
      if (st.isDirectory()) {
        try {
          await origSymlink(abs, item.dest, 'junction');
        } catch {
          await fs.promises.cp(abs, item.dest, { recursive: true, dereference: true });
        }
      } else {
        await fs.promises.mkdir(path.dirname(item.dest), { recursive: true });
        await fs.promises.copyFile(abs, item.dest);
      }
      pending.splice(i, 1);
      progressed = true;
    }
  }
}
