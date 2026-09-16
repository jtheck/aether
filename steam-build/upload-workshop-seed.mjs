import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(root, 'workshop-seed');
const contentDir = path.join(seedDir, 'content');
const previewPath = path.join(seedDir, 'preview.jpg');
const gardenPath = path.join(contentDir, 'map.garden');
const vdfPathOut = path.join(seedDir, 'item.vdf');
const idPath = path.join(seedDir, 'publishedfileid.txt');
const gardenSrc = path.join(root, '..', 'maps', 'tester.garden');
const previewSrc = path.join(root, '..', 'steam-assets', 'icons', 'app_icon.jpg');

function die(msg) {
  console.error('[workshop-seed] ' + msg);
  process.exit(1);
}

function vdfEscape(p) {
  return path.resolve(p).replace(/\\/g, '\\\\');
}

function readPublishedId() {
  if (!fs.existsSync(idPath)) return '0';
  const id = fs.readFileSync(idPath, 'utf8').trim();
  return /^\d{1,20}$/.test(id) && id !== '0' ? id : '0';
}

function writePublishedId(id) {
  fs.writeFileSync(idPath, `${id}\n`);
}

function parsePublishedIdFromVdf(text) {
  const m = String(text).match(/"publishedfileid"\s+"(\d+)"/i);
  return m && m[1] !== '0' ? m[1] : '';
}

fs.mkdirSync(contentDir, { recursive: true });
if (!fs.existsSync(gardenPath)) {
  if (!fs.existsSync(gardenSrc)) die('Missing maps/tester.garden');
  fs.copyFileSync(gardenSrc, gardenPath);
}
if (!fs.existsSync(previewPath)) {
  if (!fs.existsSync(previewSrc)) die('Missing steam-assets/icons/shortcut_icon.png');
  fs.copyFileSync(previewSrc, previewPath);
}

const publishedId = readPublishedId();
const skipPreview = process.env.WORKSHOP_SKIP_PREVIEW === '1';
const previewLine = skipPreview ? '' : `\t"previewfile"\t"${vdfEscape(previewPath)}"\n`;
const vdf = `"workshopitem"
{
\t"appid"\t\t\t"5043860"
\t"publishedfileid"\t"${publishedId}"
\t"contentfolder"\t"${vdfEscape(contentDir)}"
${previewLine}\t"visibility"\t\t"0"
\t"title"\t\t\t"Unit Tester"
\t"description"\t\t"Sample garden so Workshop can go live. Kind: Map. Mode: Special."
\t"changenote"\t\t"${publishedId === '0' ? 'Initial public seed item.' : 'Update seed item.'}"
}
`;
fs.writeFileSync(vdfPathOut, vdf);
console.log('[workshop-seed] Wrote', vdfPathOut);
console.log('[workshop-seed] publishedfileid', publishedId === '0' ? '(new item)' : publishedId);

const sdkRoot = (process.env.STEAMWORKS_SDK || 'C:\\Users\\blind\\steamworks_sdk').trim();
const steamcmd = path.join(sdkRoot, 'tools', 'ContentBuilder', 'builder', 'steamcmd.exe');
if (!fs.existsSync(steamcmd)) die('steamcmd.exe not found — set STEAMWORKS_SDK to your SDK root.');

const user = process.env.STEAM_BUILD_USER;
const pass = process.env.STEAM_BUILD_PASSWORD;
if (!user) {
  die('Set STEAM_BUILD_USER to the Steam account that can publish Workshop items.\n  Example: $env:STEAM_BUILD_USER="your_account"; npm run upload:workshop');
}

const args = ['+login', user];
if (pass) args.push(pass);
args.push('+workshop_build_item', vdfPathOut, '+quit');

console.log('[workshop-seed] Running steamcmd as', user);
const run = spawnSync(steamcmd, args, { stdio: 'inherit', cwd: path.dirname(steamcmd) });
if (run.status !== 0) {
  const maybeId = parsePublishedIdFromVdf(fs.readFileSync(vdfPathOut, 'utf8'));
  if (maybeId) writePublishedId(maybeId);
  console.error('[workshop-seed] steamcmd failed.');
  console.error('[workshop-seed] Item may already exist:', maybeId || publishedId);
  console.error('[workshop-seed] If the log says "no workshop depot found": enable ISteamUGC file transfer on Workshop → General, then Publish the app on the partner site, then re-run.');
  console.error('[workshop-seed] Legal agreement: https://steamcommunity.com/sharedfiles/workshoplegalagreement');
  process.exit(run.status ?? 1);
}

const updated = fs.readFileSync(vdfPathOut, 'utf8');
const id = parsePublishedIdFromVdf(updated);
if (!id) die('Upload finished but publishedfileid is still 0 — check steamcmd output.');
writePublishedId(id);
console.log('[workshop-seed] Public item:', id);
console.log('[workshop-seed] https://steamcommunity.com/sharedfiles/filedetails/?id=' + id);
console.log('[workshop-seed] Set tags Kind=Map, Mode=Special if the page is empty, leave visibility Public, then refresh the partner Workshop checklist.');
