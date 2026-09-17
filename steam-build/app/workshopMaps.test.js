'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const maps = require('./workshopMaps');

const TINY = JSON.stringify({ v: 4, n: 'Grove', w: 16, h: 16, s: 1, cs: 16, cm: '1' });

function writeGarden(dir, rel, body) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

describe('workshopMaps paths', () => {
  it('accepts decimal workshop ids and rejects junk', () => {
    assert.equal(maps.parseWorkshopId('123456789'), '123456789');
    assert.equal(maps.itemIdString(123456789n), '123456789');
    assert.equal(maps.parseWorkshopId('workshop:1'), '');
    assert.equal(maps.parseWorkshopId('../9'), '');
    assert.equal(maps.toPublishedFileId('99'), 99n);
  });

  it('only allows relative .garden files inside the install folder', () => {
    assert.equal(maps.normalizeGardenRel('maps/02.garden'), 'maps/02.garden');
    assert.equal(maps.normalizeGardenRel('map.garden'), 'map.garden');
    assert.equal(maps.normalizeGardenRel('../secret.garden'), '');
    assert.equal(maps.normalizeGardenRel('C:/maps/a.garden'), '');
    assert.equal(maps.normalizeGardenRel('maps/note.txt'), '');
    const root = path.resolve('/tmp/workshop/1');
    const inside = maps.resolveInside(root, 'maps/02.garden');
    assert.ok(inside.startsWith(root));
    assert.equal(maps.resolveInside(root, '../2/x.garden'), null);
  });

  it('peeks garden meta without a full decode', () => {
    const ok = maps.peekGardenMeta(TINY);
    assert.equal(ok.ok, true);
    assert.equal(ok.name, 'Grove');
    assert.equal(maps.peekGardenMeta('{"v":2,"w":8,"h":8}').ok, false);
    assert.equal(maps.peekGardenMeta('not-json').ok, false);
  });
});

describe('workshopMaps install scan', () => {
  it('lists gardens and prefers map.garden then maps/', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeg-workshop-'));
    try {
      writeGarden(dir, 'extra.garden', TINY);
      writeGarden(dir, 'maps/02.garden', JSON.stringify({ v: 4, n: 'Road', w: 8, h: 8, s: 2 }));
      writeGarden(dir, 'map.garden', JSON.stringify({ v: 4, n: 'Start', w: 8, h: 8, s: 3 }));
      const listed = maps.describeInstall(dir);
      assert.deepEqual(listed.map((g) => g.file).sort(), ['extra.garden', 'map.garden', 'maps/02.garden']);
      assert.equal(maps.pickDefaultGarden(listed), 'map.garden');
      const loaded = maps.readGardenFile(dir, '');
      assert.equal(loaded.ok, true);
      assert.equal(loaded.file, 'map.garden');
      assert.equal(loaded.garden.n, 'Start');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a garden path outside the install folder', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeg-workshop-'));
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'aeg-workshop-other-'));
    try {
      writeGarden(other, 'stolen.garden', TINY);
      const rel = path.relative(dir, path.join(other, 'stolen.garden')).replace(/\\/g, '/');
      const loaded = maps.readGardenFile(dir, rel);
      assert.equal(loaded.ok, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});

describe('workshopMaps subscribed list', () => {
  it('reads installed items and kicks a download when missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeg-workshop-'));
    const downloads = [];
    try {
      writeGarden(dir, 'map.garden', TINY);
      const workshop = {
        getSubscribedItems: () => [99n, 100n],
        getItemState: (id) => (id === 99n ? maps.ITEM_STATE.Subscribed | maps.ITEM_STATE.Installed : maps.ITEM_STATE.Subscribed),
        getItemInstallInfo: (id) => (id === 99n ? { folder: dir } : null),
        downloadItem: (id) => { downloads.push(String(id)); return true; },
      };
      const items = maps.listSubscribedMaps(workshop);
      assert.equal(items.length, 2);
      assert.equal(items[0].id, '99');
      assert.equal(items[0].installed, true);
      assert.equal(items[0].title, 'Grove');
      assert.equal(items[0].gardens[0].file, 'map.garden');
      assert.equal(items[1].id, '100');
      assert.equal(items[1].installed, false);
      assert.deepEqual(downloads, ['100']);
      const garden = maps.loadSubscribedGarden(workshop, '99', '');
      assert.equal(garden.ok, true);
      assert.equal(garden.garden.n, 'Grove');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts array-like subscribed ids from the FFI binding', () => {
    const workshop = {
      getSubscribedItems: () => ({ 0: 99n, 1: 100n, length: 2 }),
      getItemState: () => 0,
    };
    const items = maps.listSubscribedMaps(workshop);
    assert.deepEqual(items.map((item) => item.id), ['99', '100']);
  });
});

describe('workshop overlay url', () => {
  it('opens the app workshop or a file page', () => {
    assert.equal(
      maps.workshopOverlayUrl('workshop', 5043860),
      'https://steamcommunity.com/app/5043860/workshop/',
    );
    assert.equal(
      maps.workshopOverlayUrl('workshop:42', 5043860),
      'https://steamcommunity.com/sharedfiles/filedetails/?id=42',
    );
    assert.equal(maps.workshopOverlayUrl('achievements', 5043860), '');
    assert.equal(
      maps.workshopOverlayUrl('workshop-legal', 5043860),
      'https://steamcommunity.com/sharedfiles/workshoplegalagreement',
    );
  });
});

describe('workshopMaps publish', () => {
  it('tags a relative-next pack as Campaign + Adventure', () => {
    assert.deepEqual(
      maps.workshopTagsForGarden({ story: {}, objectives: [{ next: 'maps/02.garden' }] }),
      ['Campaign', 'Adventure'],
    );
    assert.deepEqual(
      maps.workshopTagsForGarden({ v: 4, w: 8, h: 8 }),
      ['Map', 'Skirmish'],
    );
    assert.deepEqual(
      maps.workshopTagsForGarden({ objectives: [{ next: '/maps/chapter2.garden' }] }),
      ['Map', 'Adventure'],
    );
  });

  it('writes map.garden, skips a denied preview, and returns the item id', async () => {
    const calls = [];
    const workshop = {
      createItem: async () => 55n,
      startItemUpdate: () => 1n,
      setItemTitle: () => true,
      setItemDescription: () => true,
      setItemVisibility: () => true,
      setItemTags: (_h, tags) => { calls.push(tags); return true; },
      setItemContent: (_h, folder) => {
        assert.equal(fs.existsSync(path.join(folder, 'map.garden')), true);
        assert.equal(path.basename(folder), 'content');
        return true;
      },
      setItemPreview: () => { throw new Error('Access Denied'); },
      submitItemUpdate: async () => true,
    };
    const garden = { v: 4, n: 'Grove', w: 8, h: 8, objectives: [{ next: 'maps/02.garden' }] };
    const result = await maps.publishWorkshopItem(workshop, garden, {
      appId: 5043860,
      title: 'Grove',
      previewPath: 'x.jpg',
    });
    assert.equal(result.ok, true);
    assert.equal(result.id, '55');
    assert.deepEqual(result.tags, ['Campaign', 'Adventure']);
    assert.deepEqual(calls[0], ['Campaign', 'Adventure']);
  });

  it('writes a jpeg preview from base64 and passes it to setItemPreview', async () => {
    const previews = [];
    const workshop = {
      createItem: async () => 56n,
      startItemUpdate: () => 1n,
      setItemTitle: () => true,
      setItemVisibility: () => true,
      setItemTags: () => true,
      setItemContent: () => true,
      setItemPreview: (_h, file) => { previews.push(file); return true; },
      submitItemUpdate: async () => true,
    };
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const result = await maps.publishWorkshopItem(workshop, { v: 4, n: 'Grove', w: 8, h: 8 }, {
      appId: 5043860,
      title: 'Grove',
      previewJpeg: jpeg.toString('base64'),
    });
    assert.equal(result.ok, true);
    assert.equal(previews.length, 1);
    assert.equal(path.basename(previews[0]), 'preview.jpg');
  });

  it('retries submit with partner-safe tags after the first submit fails', async () => {
    const tagRuns = [];
    let submits = 0;
    const workshop = {
      createItem: async () => 57n,
      startItemUpdate: () => 1n,
      setItemTitle: () => true,
      setItemVisibility: () => true,
      setItemTags: (_h, tags) => { tagRuns.push(tags); return true; },
      setItemContent: () => true,
      setItemPreview: () => true,
      submitItemUpdate: async () => (++submits === 1 ? false : true),
    };
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const result = await maps.publishWorkshopItem(workshop, { v: 4, n: 'Grove', w: 8, h: 8 }, {
      appId: 5043860,
      title: 'Grove',
      previewJpeg: jpeg.toString('base64'),
    });
    assert.equal(result.ok, true);
    assert.equal(submits, 2);
    assert.deepEqual(tagRuns[0], ['Map', 'Skirmish']);
    assert.deepEqual(result.tags, ['Map', 'Special']);
  });

  it('flags a legal-agreement failure', async () => {
    const workshop = {
      createItem: async () => { throw new Error('User needs to accept Workshop Legal Agreement'); },
    };
    const result = await maps.publishWorkshopItem(workshop, { v: 4, n: 'Grove', w: 8, h: 8 }, { appId: 5043860 });
    assert.equal(result.ok, false);
    assert.equal(result.needsAgreement, true);
  });
});
