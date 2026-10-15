import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  allCampaignChapters,
  bundleCampaign,
  campaignFileOfRef,
  campaignIndex,
  firstChapterFile,
  flattenCampaignChapters,
  formatPackRef,
  isCampaignBundle,
  nextChapterFile,
  normalizeCampaignIndex,
  packStamp,
  parsePackRef,
} from './campaignPack.js';

const garden = { v: 4, n: 'One', w: 8, h: 8 };

describe('campaign index', () => {
  const index = campaignIndex('Siege', [
    { name: 'The Siege', theme: 'siege', chapters: [
      { file: 'e1c1.garden', name: 'Breach' },
      { file: 'e1c2.garden', name: 'Sally' },
    ] },
    { name: 'The Road', theme: 'road', chapters: [{ file: 'e2c1.garden', name: 'Muster' }] },
  ]);

  it('flattens episodes into play order', () => {
    assert.equal(firstChapterFile(index), 'e1c1.garden');
    assert.deepEqual(flattenCampaignChapters(index).map((ch) => ch.file), [
      'e1c1.garden', 'e1c2.garden', 'e2c1.garden',
    ]);
    assert.equal(flattenCampaignChapters(index)[2].episode, 'The Road');
    assert.equal(nextChapterFile(index, 'e1c1.garden'), 'e1c2.garden');
    assert.equal(nextChapterFile(index, '/maps/e1c2.garden'), 'e2c1.garden');
    assert.equal(nextChapterFile(index, 'e2c1.garden'), '');
    assert.equal(nextChapterFile(index, 'missing.garden'), '');
    assert.deepEqual(packStamp(index), { files: ['e1c1.garden', 'e1c2.garden', 'e2c1.garden'] });
  });

  it('rejects a chapter path that leaves the pack', () => {
    assert.equal(normalizeCampaignIndex({
      kind: 'campaign',
      episodes: [{ chapters: [{ file: '../x.garden' }] }],
    }), null);
    assert.equal(parsePackRef('pack:../x.garden'), null);
    assert.equal(formatPackRef('e1c1.garden'), 'pack:e1c1.garden');
    assert.equal(campaignFileOfRef('workshop:99/maps/e1c2.garden'), 'e1c2.garden');
  });

  it('keeps a switched-off chapter in the file and out of play', () => {
    const index = campaignIndex('Siege', [
      { name: 'The Siege', chapters: [
        { file: 'e1c1.garden', name: 'Breach' },
        { file: 'e1c2.garden', name: 'Sally', live: false },
      ] },
      { name: 'Later', chapters: [
        { file: 'e2c1.garden', name: 'Unfinished', live: false },
      ] },
      { name: 'The Road', chapters: [{ file: 'e3c1.garden', name: 'Muster' }] },
    ]);
    assert.equal(index.episodes[1].name, 'Later');
    assert.equal(index.episodes[0].chapters[1].live, false);
    assert.deepEqual(flattenCampaignChapters(index).map((ch) => ch.file), [
      'e1c1.garden', 'e3c1.garden',
    ]);
    assert.equal(flattenCampaignChapters(index).some((ch) => ch.episode === 'Later'), false);
    assert.equal(firstChapterFile(index), 'e1c1.garden');
    assert.equal(nextChapterFile(index, 'e1c1.garden'), 'e3c1.garden');
    assert.equal(nextChapterFile(index, 'e1c2.garden'), 'e3c1.garden');
    assert.deepEqual(allCampaignChapters(index).map((ch) => ch.file), [
      'e1c1.garden', 'e1c2.garden', 'e2c1.garden', 'e3c1.garden',
    ]);
    const bundle = bundleCampaign(index, {
      'e1c1.garden': garden,
      'e1c2.garden': garden,
      'e2c1.garden': garden,
      'e3c1.garden': garden,
    });
    assert.equal(isCampaignBundle(bundle), true);
    assert.deepEqual(bundle.gardens['e1c1.garden'].pk.files, ['e1c1.garden', 'e3c1.garden']);
    assert.ok(bundle.gardens['e1c2.garden']);
  });

  it('bundles gardens and stamps the play order onto each one', () => {
    const bundle = bundleCampaign(index, {
      'e1c1.garden': { ...garden, n: 'Breach' },
      'e1c2.garden': { ...garden, n: 'Sally' },
      'e2c1.garden': { ...garden, n: 'Muster' },
    });
    assert.equal(isCampaignBundle(bundle), true);
    assert.deepEqual(bundle.gardens['e1c2.garden'].pk.files, packStamp(index).files);
    assert.equal(isCampaignBundle({ ...index, gardens: { 'e1c1.garden': garden } }), false);
  });
});
