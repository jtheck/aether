import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flattenCampaignChapters, formatPackRef, isCampaignBundle } from '../story/campaignPack.js';
import { installAdventureCampaign, loadAdventureCampaign } from './adventureCampaign.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('shipped adventure campaign', () => {
  const bundle = JSON.parse(readFileSync(join(here, '../../maps/adventure/adventure.campaign'), 'utf8'));

  it('lists every live chapter under its episode', () => {
    assert.equal(isCampaignBundle(bundle), true);
    assert.ok(String(bundle.name || '').trim());
    const flat = flattenCampaignChapters(bundle);
    const listed = installAdventureCampaign(bundle);
    assert.deepEqual(listed.map((ch) => ch.id), flat.map((ch) => formatPackRef(ch.file)));
    assert.deepEqual(
      listed.map((ch) => ({ name: ch.name, episode: ch.episode })),
      flat.map((ch) => ({ name: ch.name, episode: ch.episode })),
    );
  });

  it('stores the network campaign and does not read the saved pack', async () => {
    const text = JSON.stringify(bundle);
    let reads = 0;
    let wrote = '';
    const list = await loadAdventureCampaign({
      fetchCampaign: async () => text,
      readPack: async () => { reads += 1; return null; },
      writePack: async (saved) => { wrote = saved; },
    });
    assert.equal(reads, 0);
    assert.equal(wrote, text);
    assert.equal(list.length, flattenCampaignChapters(bundle).length);
  });

  it('plays the saved pack when the campaign file is unreachable', async () => {
    const text = JSON.stringify(bundle);
    let wrote = '';
    const list = await loadAdventureCampaign({
      fetchCampaign: async () => { throw new Error('offline'); },
      readPack: async () => text,
      writePack: async (saved) => { wrote = saved; },
    });
    assert.equal(wrote, text);
    assert.equal(list.length, flattenCampaignChapters(bundle).length);
    assert.equal(list[0]?.id, formatPackRef(flattenCampaignChapters(bundle)[0].file));
  });
});
