import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatWorkshopRef,
  isWorkshopRef,
  loadGardenRef,
  normalizeGardenRel,
  parseWorkshopId,
  parseWorkshopRef,
  resolveNextGardenRef,
  STEAM_APP_ID,
  isDefaultWorkshopName,
  workshopDescriptionFor,
  workshopListingTags,
  workshopNameSuggestions,
  workshopPageUrl,
} from './workshop.js';

describe('workshop refs', () => {
  it('parses workshop:id and an optional garden path', () => {
    assert.deepEqual(parseWorkshopRef('workshop:99'), { id: '99', file: '' });
    assert.deepEqual(parseWorkshopRef('workshop:99/maps/02.garden'), {
      id: '99',
      file: 'maps/02.garden',
    });
    assert.equal(parseWorkshopRef('/maps/chapter1.garden'), null);
    assert.equal(parseWorkshopRef('workshop:../9'), null);
    assert.equal(parseWorkshopRef('workshop:99/../x.garden'), null);
    assert.equal(isWorkshopRef('workshop:1'), true);
    assert.equal(formatWorkshopRef('99', 'maps/02.garden'), 'workshop:99/maps/02.garden');
    assert.equal(parseWorkshopId('5043860'), '5043860');
    assert.equal(normalizeGardenRel('map.garden'), 'map.garden');
  });

  it('builds public Steam Community URLs for workshop overlays', () => {
    assert.equal(
      workshopPageUrl('workshop', STEAM_APP_ID),
      'https://steamcommunity.com/app/5043860/workshop/',
    );
    assert.equal(
      workshopPageUrl('workshop:42', STEAM_APP_ID),
      'https://steamcommunity.com/sharedfiles/filedetails/?id=42',
    );
    assert.equal(
      workshopPageUrl('workshop-legal', STEAM_APP_ID),
      'https://steamcommunity.com/sharedfiles/workshoplegalagreement',
    );
    assert.equal(workshopPageUrl('achievements', STEAM_APP_ID), '');
  });

  it('offers names and a boilerplate description when the title is blank', () => {
    assert.equal(isDefaultWorkshopName(''), true);
    assert.equal(isDefaultWorkshopName('Untitled garden'), true);
    assert.equal(isDefaultWorkshopName('Grove'), false);
    const garden = { v: 4, w: 144, h: 144, s: 12345 };
    assert.deepEqual(workshopListingTags(garden), ['Map', 'Skirmish']);
    assert.deepEqual(workshopNameSuggestions(garden, ''), ['Skirmish 144', 'Garden 12345', 'Skirmish Garden']);
    assert.deepEqual(workshopNameSuggestions(garden, 'Grove'), ['Grove']);
    const desc = workshopDescriptionFor(garden, 'Skirmish 144');
    assert.match(desc, /Skirmish 144/);
    assert.match(desc, /144×144/);
    assert.match(desc, /seed 12345/);
    assert.match(desc, /Made in Forge/);
    const campaign = workshopDescriptionFor({
      v: 4, w: 80, h: 80, s: 9, obj: [{ next: 'maps/02.garden' }],
    }, 'Campaign 80');
    assert.match(campaign, /Next/);
    assert.deepEqual(workshopListingTags({ obj: [{ next: 'maps/02.garden' }] }), ['Campaign', 'Adventure']);
  });

  it('resolves a relative next against the current Workshop pack', () => {
    assert.equal(
      resolveNextGardenRef('02.garden', 'workshop:99/maps/01.garden'),
      'workshop:99/maps/02.garden',
    );
    assert.equal(
      resolveNextGardenRef('maps/02.garden', 'workshop:99'),
      'workshop:99/maps/02.garden',
    );
    assert.equal(resolveNextGardenRef('/maps/chapter2.garden', 'workshop:99/map.garden'), '/maps/chapter2.garden');
    assert.equal(resolveNextGardenRef('workshop:8/map.garden', 'workshop:99'), 'workshop:8/map.garden');
    assert.equal(resolveNextGardenRef('02.garden', '/maps/chapter1.garden'), '02.garden');
    assert.equal(resolveNextGardenRef('', 'workshop:99'), '');
  });
});

describe('loadGardenRef', () => {
  it('loads session JSON, workshop items, then URLs', async () => {
    const session = await loadGardenRef('session', {
      sessionText: () => '{"v":4,"n":"From session","w":8,"h":8}',
    });
    assert.equal(session.n, 'From session');

    const workshop = await loadGardenRef('workshop:12/maps/02.garden', {
      loadWorkshopGarden: async (id, file) => ({ v: 4, n: `${id}:${file}`, w: 8, h: 8 }),
    });
    assert.equal(workshop.n, '12:maps/02.garden');

    const url = await loadGardenRef('/maps/chapter1.garden', {
      fetchGarden: async (href) => ({ v: 4, n: href, w: 8, h: 8 }),
    });
    assert.equal(url.n, '/maps/chapter1.garden');
  });

  it('throws when a workshop load has no garden', async () => {
    await assert.rejects(
      () => loadGardenRef('workshop:1', { loadWorkshopGarden: async () => null }),
      /workshop garden missing/,
    );
  });
});
