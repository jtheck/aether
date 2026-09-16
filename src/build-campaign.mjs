// Regenerate the campaign chapter gardens from the manifest.
// Writes each chapter to repo-root maps/<id>.garden and src/maps/<id>.garden
// (serve falls back to src/maps; package.mjs ships repo-root maps).
//
//   npm run build:campaign        (from src/)

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCampaign } from './story/campaignBuild.js';

const here = dirname(fileURLToPath(import.meta.url));
const rootMaps = join(here, '..', 'maps');
const srcMaps = join(here, 'maps');
mkdirSync(rootMaps, { recursive: true });
mkdirSync(srcMaps, { recursive: true });

const built = buildCampaign();
for (const chapter of built) {
  const json = JSON.stringify(chapter.garden);
  const file = `${chapter.id}.garden`;
  writeFileSync(join(rootMaps, file), json);
  writeFileSync(join(srcMaps, file), json);
  console.log(`wrote ${file.padEnd(14)} ${String(json.length).padStart(6)} bytes  ${chapter.name}`);
}
console.log(`\n${built.length} campaign chapters written to maps/ and src/maps/.`);
