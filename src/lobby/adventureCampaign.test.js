import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flattenCampaignChapters, formatPackRef, isCampaignBundle } from '../story/campaignPack.js';
import { installAdventureCampaign } from './adventureCampaign.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('shipped adventure campaign', () => {
  const bundle = JSON.parse(readFileSync(join(here, '../../maps/adventure.campaign'), 'utf8'));

  it('lists every live chapter under its episode', () => {
    assert.equal(isCampaignBundle(bundle), true);
    assert.equal(bundle.name, 'Adventure');
    const flat = flattenCampaignChapters(bundle);
    const listed = installAdventureCampaign(bundle);
    assert.deepEqual(listed.map((ch) => ch.id), flat.map((ch) => formatPackRef(ch.file)));
    const chapter4 = listed.find((ch) => ch.id === 'pack:Chapter_4.garden');
    assert.equal(chapter4?.name, 'Chapter 4');
    assert.equal(chapter4?.episode, 'Episode 2');
  });
});
