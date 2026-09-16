// Generate a Fountain screenplay from the adventure campaign.
//
//   npm run build:script        (from src/)

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCampaignScript, renderCampaignScriptHtml } from './story/campaignScript.js';

const here = dirname(fileURLToPath(import.meta.url));
const storyDir = join(here, 'story');
mkdirSync(storyDir, { recursive: true });
const fountain = renderCampaignScript();
const html = renderCampaignScriptHtml();
const fountainPath = join(storyDir, 'AETHER.fountain');
const htmlPath = join(storyDir, 'AETHER.html');
writeFileSync(fountainPath, fountain);
writeFileSync(htmlPath, html);
const lines = fountain.split('\n').length;
const scenes = (fountain.match(/^EXT\./gm) || []).length;
console.log(`wrote ${fountainPath}`);
console.log(`wrote ${htmlPath}`);
console.log(`${lines} lines, ${scenes} scene headings`);
