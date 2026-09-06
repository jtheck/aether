import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

function depotMapping(localFolder) {
  return `\t\t"FileMapping"
\t\t{
\t\t\t"LocalPath" "${localFolder}/*"
\t\t\t"DepotPath" "."
\t\t\t"recursive" "1"
\t\t}
\t\t"FileExclusion" "${localFolder}/.nw-user-data/*"`;
}

function linuxExecProps(localFolder) {
  const bins = [
    `${localFolder}/Aether`,
    `${localFolder}/Aether.sh`,
    `${localFolder}/chrome_crashpad_handler`,
    `${localFolder}/chrome-sandbox`,
    `${localFolder}/nacl_helper`,
    `${localFolder}/nacl_helper_bootstrap`,
    `${localFolder}/package.nw/node-steam/node`,
  ];
  return bins.map(function (p) {
    return `\t\t"FileProperties"
\t\t{
\t\t\t"LocalPath" "${p}"
\t\t\t"Attributes" "unix|0755"
\t\t}`;
  }).join('\n');
}

if (!fs.existsSync(configPath)) {
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, configPath);
    console.log('[steam-upload] Created steampipe/config.json from example — edit depot IDs, then re-run.');
  }
  die('Missing steampipe/config.json — set depots.win and depots.linux from partner site → SteamPipe → Depots.');
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const appId = String(config.appId || '480');
const winDepotId = String(config.depots?.win || '').trim();
const linuxDepotId = String(config.depots?.linux || '').trim();
const buildDesc = String(config.buildDesc || 'aether-win64+linux64');

const winOnly = process.argv.includes('--win-only');
const linuxOnly = process.argv.includes('--linux-only');
const platforms = winOnly ? ['win'] : linuxOnly ? ['linux'] : ['win', 'linux'];

if (platforms.includes('win') && (!winDepotId || winDepotId.includes('PASTE_'))) {
  die('Set depots.win in steampipe/config.json.');
}
if (platforms.includes('linux') && (!linuxDepotId || linuxDepotId.includes('PASTE_'))) {
  die('Set depots.linux in steampipe/config.json.');
}

for (const plat of platforms) {
  console.log('[steam-upload] Building dist-' + plat + '…');
  const dist = spawnSync('npm', ['run', 'dist:' + plat], { cwd: root, stdio: 'inherit', shell: true });
  if (dist.status !== 0) process.exit(dist.status ?? 1);

  const distDir = path.join(root, 'dist-' + plat);
  const launchBin = plat === 'linux' ? 'Aether' : 'Aether.exe';
  if (!fs.existsSync(path.join(distDir, launchBin))) {
    die('dist-' + plat + '/' + launchBin + ' missing after build.');
  }
  removeUserData(distDir);
}

const outputDir = path.join(root, 'steampipe-output');
fs.mkdirSync(outputDir, { recursive: true });
const vdfPath = (p) => p.replace(/\\/g, '\\\\');
const buildOutput = vdfPath(outputDir);
const contentRoot = vdfPath(root);

const depotLines = [];
if (platforms.includes('win')) {
  depotLines.push(`\t\t"${winDepotId}"
\t\t{
${depotMapping('dist-win')}
\t\t}`);
}
if (platforms.includes('linux')) {
  depotLines.push(`\t\t"${linuxDepotId}"
\t\t{
${depotMapping('dist-linux')}
${linuxExecProps('dist-linux')}
\t\t}`);
}

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
console.log('[steam-upload] Depots:', platforms.map((p) => (p === 'win' ? winDepotId : linuxDepotId)).join(' + '));

const sdkRoot = (process.env.STEAMWORKS_SDK || 'C:\\Users\\blind\\steamworks_sdk').trim();
const steamcmd = path.join(sdkRoot, 'tools', 'ContentBuilder', 'builder', 'steamcmd.exe');
if (!fs.existsSync(steamcmd)) die('steamcmd.exe not found — set STEAMWORKS_SDK to your SDK root.');

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
  console.error('[steam-upload] steamcmd failed — check logs in steampipe-output/');
  process.exit(run.status ?? 1);
}

console.log('[steam-upload] Done. Set the build live: https://partner.steamgames.com/apps/builds/' + appId);
if (platforms.includes('linux')) {
  console.log('[steam-upload] Linux launch option must be Aether (ELF, OS: Linux). Aether.exe is Windows/Proton only.');
}
