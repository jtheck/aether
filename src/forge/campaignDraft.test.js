import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addChapter,
  addEpisode,
  createCampaignDraft,
  draftFromBundle,
  draftToBundle,
  removeChapter,
} from './campaignDraft.js';

describe('campaign draft', () => {
  it('orders chapters across episodes and round-trips a bundle', () => {
    const draft = createCampaignDraft('Siege');
    addChapter(draft, { name: 'Breach', garden: { v: 4, n: 'Breach', w: 8, h: 8 } });
    addEpisode(draft, 'The Road');
    addChapter(draft, { name: 'Muster', garden: { v: 4, n: 'Muster', w: 8, h: 8 } });
    const bundle = draftToBundle(draft);
    assert.deepEqual(bundle.gardens['Breach.garden'].pk.files, ['Breach.garden', 'Muster.garden']);
    assert.equal(bundle.episodes[1].name, 'The Road');
    const again = draftFromBundle(bundle);
    assert.equal(again.episodes[0].chapters[0].name, 'Breach');
    assert.equal(removeChapter(again, 'Breach.garden'), true);
    assert.equal(again.episodes[0].chapters.length, 0);
  });
});
