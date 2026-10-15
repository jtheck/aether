import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { flattenCampaignChapters } from '../story/campaignPack.js';
import {
  addChapter,
  addEpisode,
  createCampaignDraft,
  draftFromBundle,
  draftToBundle,
  draftToIndex,
  removeChapter,
  setChapterLive,
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

  it('round-trips a chapter that is off, and hides an episode with none on', () => {
    const draft = createCampaignDraft('Siege');
    addChapter(draft, { name: 'Breach', garden: { v: 4, n: 'Breach', w: 8, h: 8 } });
    addChapter(draft, { name: 'Sally', garden: { v: 4, n: 'Sally', w: 8, h: 8 } });
    addEpisode(draft, 'Later');
    addChapter(draft, { name: 'Unfinished', garden: { v: 4, n: 'Unfinished', w: 8, h: 8 } });
    assert.equal(setChapterLive(draft, 'Sally.garden', false), true);
    assert.equal(setChapterLive(draft, 'Unfinished.garden', false), true);
    const bundle = draftToBundle(draft);
    assert.equal(bundle.episodes[1].name, 'Later');
    assert.equal(bundle.episodes[0].chapters[1].live, false);
    assert.deepEqual(flattenCampaignChapters(bundle).map((ch) => ch.file), ['Breach.garden']);
    assert.deepEqual(bundle.gardens['Breach.garden'].pk.files, ['Breach.garden']);
    assert.equal(draftToIndex(draft, { liveOnly: true }).episodes.length, 1);
    const again = draftFromBundle(bundle);
    assert.equal(again.episodes[0].chapters[1].live, false);
    assert.equal(again.episodes[1].chapters[0].name, 'Unfinished');
    assert.equal(again.episodes[1].chapters[0].live, false);
  });
});
