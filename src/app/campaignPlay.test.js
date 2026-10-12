import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { continuationGardenRef, siblingGardenRef } from './campaignPlay.js';

const index = {
  v: 1,
  kind: 'campaign',
  name: 'Siege',
  episodes: [{
    name: 'The Siege',
    chapters: [
      { file: 'e1c1.garden', name: 'Breach' },
      { file: 'e1c2.garden', name: 'Sally' },
    ],
  }],
};

describe('chapter continuation', () => {
  it('follows the index inside a served map folder, a workshop item, and a web pack', () => {
    assert.equal(
      continuationGardenRef({ currentRef: '/maps/e1c1.garden', index }),
      '/maps/e1c2.garden',
    );
    assert.equal(
      continuationGardenRef({ currentRef: 'workshop:99/e1c1.garden', index }),
      'workshop:99/e1c2.garden',
    );
    assert.equal(
      continuationGardenRef({ currentRef: 'pack:e1c1.garden', index }),
      'pack:e1c2.garden',
    );
    assert.equal(continuationGardenRef({ currentRef: '/maps/e1c2.garden', index }), '');
  });

  it('lets an objective next override the index', () => {
    assert.equal(
      continuationGardenRef({
        explicit: '/maps/secret.garden',
        currentRef: '/maps/e1c1.garden',
        index,
        packFiles: ['e1c1.garden', 'e1c2.garden'],
      }),
      '/maps/secret.garden',
    );
  });

  it('uses the garden stamp when the index is not loaded', () => {
    assert.equal(
      continuationGardenRef({
        currentRef: 'workshop:99/maps/e1c1.garden',
        packFiles: ['e1c1.garden', 'e1c2.garden'],
      }),
      'workshop:99/maps/e1c2.garden',
    );
    assert.equal(siblingGardenRef('/maps/e1c1.garden', 'e1c2.garden'), '/maps/e1c2.garden');
  });
});
