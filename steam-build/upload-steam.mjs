import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TARGETS, TARGET_ORDER } from './targets.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const steampipeDir = path.join(root, 'steampipe');
const configPath = path.join(steampipeDir, 'config.json');
const examplePath = path.join(steampipeDir, 'config.example.json');

function die(msg) {
  console.error('[steam-upload] ' + msg);
  process.exit(1);
}

function removeUserData(distDir) {
  const userData = path.join(distDir, '.nw-user-data');
  if (fs.existsSync(userData)) {
    fs.rmSync(userData, { recursive: true, force: true });
    console.log('[steam-upload] Removed', path.basename(distDir) + '/.nw-user-data');
  }
}

function depotMapping(localFolder, depotPath = '.') {
  return `\t\t"FileMapping"
\t\t{
\t\t\t"LocalPath" "${localFolder}/*"
\t\t\t"DepotPath" "${depotPath}"
\t\t\t"recursive" "1"
\t\t}
\t\t"FileExclusion" "${localFolder}/.nw-user-data/*"`;
}

function unixMode(localPaths) {
  return localPaths.map(function (p) {
    return `\t\t"FileProperties"
\t\t{
\t\t\t"LocalPath" "${p}"
\t\t\t"Attributes" "unix|0755"
\t\t}`;
  }).join('\n');
}

function linuxBins(prefix) {
  return [
    `${prefix}/Aether`,
    `${prefix}/Aether.sh`,
    `${prefix}/chrome_crashpad_handler`,
    `${prefix}/chrome-sandbox`,
    `${prefix}/nacl_helper`,
    `${prefix}/nacl_helper_bootstrap`,
    `${prefix}/package.nw/node-steam/node`,
  ];
}

function linuxExecProps(localFolder) {
  if (localFolder === 'dist-linux-depot') {
    return unixMode([
      `${localFolder}/Aether`,
      ...linuxBins(`${localFolder}/linux64`),
    ]);
  }
  return unixMode(linuxBins(localFolder));
}

function macExecProps(localFolder) {
  const abs = path.join(root, localFolder);
  const rels = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_err) {
      return;
    }
    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!ent.isFile()) continue;
      const parent = path.basename(dir);
      if (parent === 'MacOS' || (ent.name === 'node' && parent === 'node-steam')) {
        rels.push(localFolder + '/' + path.relative(abs, full).split(path.sep).join('/'));
      }
    }
  }
  walk(abs);
  if (!rels.length) die('No Mac executables found in ' + localFolder + '. The .app bundle did not build.');
  return unixMode(rels);
}

if (!fs.existsSync(configPath)) {
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, configPath);
    console.log('[steam-upload] Created steampipe/config.json from example - edit depot IDs, then re-run.');
  }
  die('Missing steampipe/config.json - set depot IDs from partner site → SteamPipe → Depots.');
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const appId = String(config.appId || '480');

const onlyFlags = {
  '--win-only': 'win',
  '--linux-only': 'linux',
  '--linux-arm64-only': 'linux-arm64',
  '--osx-only': 'osx',
};
const picked = Object.entries(onlyFlags)
  .filter(([flag]) => process.argv.includes(flag))
  .map(([, id]) => id);
const requested = picked.length ? picked : TARGET_ORDER;

function depotReady(id) {
  const value = String(id || '').trim();
  return !!value && !value.includes('PASTE_');
}

const platforms = [];
for (const id of requested) {
  const target = TARGETS[id];
  const depotId = String(config.depots?.[target.depotKey] || '').trim();
  if (!depotReady(depotId)) {
    const msg = 'Set depots.' + target.depotKey + ' in steampipe/config.json.';
    if (picked.length) die(msg);
    console.log('[steam-upload] Skipping ' + id + ': ' + msg);
    continue;
  }
  platforms.push({ target, depotId });
}
if (!platforms.length) die('No depots selected.');

for (const entry of platforms) {
  const { target } = entry;
  console.log('[steam-upload] Building ' + target.outDir + '…');
  const dist = spawnSync('npm', ['run', 'dist:' + target.id], { cwd: root, stdio: 'inherit', shell: true });
  if (dist.status !== 0) process.exit(dist.status ?? 1);

  const distDir = path.join(root, target.outDir);
  if (!fs.existsSync(path.join(distDir, target.launchRel))) {
    die(target.outDir + '/' + target.launchRel + ' missing after build.');
  }
  removeUserData(distDir);
  entry.folder = target.outDir;
  entry.depotPath = '.';

  if (target.id === 'linux') {
    const stage = spawnSync(process.execPath, ['stage-linux-depot.mjs'], {
      cwd: root,
      stdio: 'inherit',
    });
    if (stage.status !== 0) process.exit(stage.status ?? 1);
    entry.folder = 'dist-linux-depot';
  } else if (target.id === 'linux-arm64') {
    entry.depotPath = 'linux-arm64';
  }
}

const buildDesc = 'aether-' + platforms.map(({ target }) => target.label).join('+');

const outputDir = path.join(root, 'steampipe-output');
fs.mkdirSync(outputDir, { recursive: true });
const vdfPath = (p) => p.replace(/\\/g, '\\\\');
const buildOutput = vdfPath(outputDir);
const contentRoot = vdfPath(root);

const depotLines = platforms.map(function ({ target, depotId, folder, depotPath }) {
  const depotFolder = folder || target.outDir;
  const exec = target.ozone
    ? linuxExecProps(depotFolder)
    : target.nwPlatform === 'osx'
      ? macExecProps(depotFolder)
      : '';
  return `\t\t"${depotId}"
\t\t{
${depotMapping(depotFolder, depotPath)}
${exec}
\t\t}`;
});

const appVdfPath = path.join(steampipeDir, `app_build_${appId}.vdf`);
fs.writeFileSync(
  appVdfPath,
  `"AppBuild"
{
\t"AppID" "${appId}"
\t"Desc" "${buildDesc}"
\t"Preview" "0"
\t"ContentRoot" "${contentRoot}\\\\"
\t"BuildOutput" "${buildOutput}\\\\"
\t"verbose" "1"
\t"Depots"
\t{
${depotLines.join('\n')}
\t}
}
`,
);

console.log('[steam-upload] Wrote', appVdfPath);
console.log('[steam-upload] Depots:', platforms.map(({ target, depotId }) => target.id + '=' + depotId).join(' + '));

const sdkRoot = (process.env.STEAMWORKS_SDK || 'C:\\Users\\blind\\steamworks_sdk').trim();
const steamcmd = path.join(sdkRoot, 'tools', 'ContentBuilder', 'builder', 'steamcmd.exe');
if (!fs.existsSync(steamcmd)) die('steamcmd.exe not found - set STEAMWORKS_SDK to your SDK root.');

const user = process.env.STEAM_BUILD_USER;
const pass = process.env.STEAM_BUILD_PASSWORD;
if (!user) {
  die('Set STEAM_BUILD_USER to your Steam build account, then re-run.\n  Example: $env:STEAM_BUILD_USER="mybuildaccount"; npm run upload:steam');
}
const args = ['+login', user];
if (pass) args.push(pass);
args.push('+run_app_build', appVdfPath, '+quit');

console.log('[steam-upload] Running steamcmd…');
const run = spawnSync(steamcmd, args, { stdio: 'inherit', cwd: path.dirname(steamcmd) });
if (run.status !== 0) {
  console.error('[steam-upload] steamcmd failed - check logs in steampipe-output/');
  process.exit(run.status ?? 1);
}

console.log('[steam-upload] Done. Set the build live: https://partner.steamgames.com/apps/builds/' + appId);
if (platforms.some(({ target }) => target.ozone)) {
  console.log('[steam-upload] Linux launch executable is Aether (ELF). Aether.exe is Windows/Proton only.');
}
if (platforms.some(({ target }) => target.id === 'linux-arm64')) {
  console.log('[steam-upload] Frame depot must be OS Linux, architecture 64-bit ARM. Launch executable Aether.');
}
if (platforms.some(({ target }) => target.id === 'osx')) {
  console.log('[steam-upload] Mac launch executable is Aether.app. This build is not notarized.');
}
