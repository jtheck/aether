import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { liveConfigKeepsAdventure, resetAdventureRuntime } from './adventureRuntime.js';

describe('liveConfigKeepsAdventure', () => {
  it('keeps campaign only for adventure mode', () => {
    assert.equal(liveConfigKeepsAdventure({ mode: 'adventure' }), true);
    assert.equal(liveConfigKeepsAdventure({ mode: 'adventure', garden: { story: {} } }), true);
  });

  it('drops campaign when leaving for another game type', () => {
    assert.equal(liveConfigKeepsAdventure({ mode: 'skirmish' }), false);
    assert.equal(liveConfigKeepsAdventure({ mode: 'koth' }), false);
    assert.equal(liveConfigKeepsAdventure({ mode: 'onevsone' }), false);
    assert.equal(liveConfigKeepsAdventure({ mode: 'teams' }), false);
    assert.equal(liveConfigKeepsAdventure({ mode: 'sandbox' }), false);
    assert.equal(liveConfigKeepsAdventure({ mode: 'legacy' }), false);
    assert.equal(liveConfigKeepsAdventure({
      mode: 'skirmish',
      garden: { story: { beats: [] }, obj: [[1, 2, 3, 'escape']] },
    }), false);
  });
});

describe('resetAdventureRuntime', () => {
  it('clears objectives, handoff, votes, and a pending flush timer', () => {
    let fired = false;
    const rt = {
      story: { beats: [] },
      objectives: [{ id: 'road', kind: 'escape' }],
      carriedParty: [{ name: 'Stumpey' }],
      carriedBank: { wood: 4 },
      chapterWon: true,
      chapterAdvanceBusy: true,
      pendingChapterUrl: '/maps/chapter2.garden',
      objectivesArmedAt: 1200,
      chapterVotes: new Map([[0, { url: '/maps/chapter2.garden' }]]),
      chapterVoteUrl: '/maps/chapter2.garden',
      chapterProposeSent: true,
      chapterFlushTimer: setTimeout(() => { fired = true; }, 30_000),
    };
    resetAdventureRuntime(rt);
    clearTimeout(rt.chapterFlushTimer);
    assert.equal(rt.story, null);
    assert.deepEqual(rt.objectives, []);
    assert.equal(rt.carriedParty, null);
    assert.equal(rt.carriedBank, null);
    assert.equal(rt.chapterWon, false);
    assert.equal(rt.chapterAdvanceBusy, false);
    assert.equal(rt.pendingChapterUrl, null);
    assert.equal(rt.objectivesArmedAt, 0);
    assert.equal(rt.chapterVotes.size, 0);
    assert.equal(rt.chapterVoteUrl, '');
    assert.equal(rt.chapterProposeSent, false);
    assert.equal(rt.chapterFlushTimer, null);
    assert.equal(fired, false);
  });
});
