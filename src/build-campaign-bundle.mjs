// Bundle the official campaign (index + every chapter garden) into one
// importable .campaign file — the same format the Forge exports and imports.
// Writes repo-root maps/ and src/maps/ (serve falls back to src/maps).
//
//   npm run build:campaign:bundle        (from src/)

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCampaign } from './story/campaignBuild.js';
import { officialCampaignIndex } from './story/campaign.js';
import { bundleCampaign } from './story/campaignPack.js';

const here = dirname(fileURLToPath(import.meta.url));
const rootMaps = join(here, '..', 'maps');
const srcMaps = join(here, 'maps');
mkdirSync(rootMaps, { recursive: true });
mkdirSync(srcMaps, { recursive: true });

const built = buildCampaign();
const gardens = Object.fromEntries(built.map((c) => [c.file, c.garden]));
const bundle = bundleCampaign(officialCampaignIndex(), gardens);
if (!bundle) {
  console.error('Failed to bundle campaign — index did not normalize.');
  process.exit(1);
}

const json = JSON.stringify(bundle);
const file = 'Campaign.campaign';
writeFileSync(join(rootMaps, file), json);
writeFileSync(join(srcMaps, file), json);

for (const c of built) {
  const bytes = JSON.stringify(bundle.gardens[c.file]).length;
  console.log(`  ${c.file.padEnd(14)} ${String((bytes / 1024).toFixed(1)).padStart(7)} KB  ${c.name}`);
}
console.log(`\nwrote ${file}  ${(json.length / 1024).toFixed(1)} KB  (${built.length} chapters) to maps/ and src/maps/.`);
