// Observer tree assignment + offer eligibility unit checks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createObserverTree,
  assignSponsor,
  offerEligibleUserIds,
  promoteObserverToPlayer,
  demotePlayerToObserver,
  recomputeDepths,
  reconcilePlayers,
  upsertNode,
  CHILDREN_PER_PLAYER,
  CHILDREN_PER_OBSERVER,
} from '../koth/observerTree.js';

test('assigns one L1 observer per player then fans out', () => {
  const tree = createObserverTree();
  const players = ['p0', 'p1', 'p2'];
  for (const p of players) {
    upsertNode(tree, p, { role: 'player', depth: 0, caughtUp: true });
  }

  const o0 = assignSponsor(tree, players, 'o0');
  upsertNode(tree, 'o0', { caughtUp: true });
  const o1 = assignSponsor(tree, players, 'o1');
  upsertNode(tree, 'o1', { caughtUp: true });
  const o2 = assignSponsor(tree, players, 'o2');
  upsertNode(tree, 'o2', { caughtUp: true });
  assert.equal(o0.depth, 1);
  assert.equal(o1.depth, 1);
  assert.equal(o2.depth, 1);
  assert.ok(players.includes(o0.sponsorId));
  assert.ok(players.includes(o1.sponsorId));
  assert.ok(players.includes(o2.sponsorId));
  assert.notEqual(o0.sponsorId, o1.sponsorId);
  assert.notEqual(o1.sponsorId, o2.sponsorId);

  const o3 = assignSponsor(tree, players, 'o3');
  assert.ok(o3.depth >= 2);
  assert.ok(!players.includes(o3.sponsorId));
});

test('offer eligibility starts at L1 then expands by join order', () => {
  const tree = createObserverTree();
  upsertNode(tree, 'p0', { role: 'player', depth: 0, caughtUp: true });
  upsertNode(tree, 'l1a', {
    role: 'observer', depth: 1, sponsorId: 'p0', caughtUp: true, joinedAt: 1,
  });
  tree.childrenOf.set('p0', ['l1a']);
  upsertNode(tree, 'l2a', {
    role: 'observer', depth: 2, sponsorId: 'l1a', caughtUp: true, joinedAt: 2,
  });
  tree.childrenOf.set('l1a', ['l2a']);
  upsertNode(tree, 'l2b', {
    role: 'observer', depth: 2, sponsorId: 'l1a', caughtUp: true, joinedAt: 3,
  });

  assert.deepEqual(offerEligibleUserIds(tree, 0), ['l1a']);
  assert.deepEqual(offerEligibleUserIds(tree, 1), ['l1a', 'l2a']);
  assert.deepEqual(offerEligibleUserIds(tree, 2), ['l1a', 'l2a', 'l2b']);
});

test('promote reassigns children off the new player', () => {
  const tree = createObserverTree();
  upsertNode(tree, 'p0', { role: 'player', depth: 0, caughtUp: true });
  upsertNode(tree, 'l1', {
    role: 'observer', depth: 1, sponsorId: 'p0', caughtUp: true, joinedAt: 1,
  });
  tree.childrenOf.set('p0', ['l1']);
  upsertNode(tree, 'c0', {
    role: 'observer', depth: 2, sponsorId: 'l1', caughtUp: true, joinedAt: 2,
  });
  upsertNode(tree, 'c1', {
    role: 'observer', depth: 2, sponsorId: 'l1', caughtUp: true, joinedAt: 3,
  });
  tree.childrenOf.set('l1', ['c0', 'c1']);

  const handoffs = promoteObserverToPlayer(tree, 'l1', ['p0', 'l1']);
  assert.equal(tree.nodes.get('l1').role, 'player');
  assert.equal(tree.nodes.get('l1').depth, 0);
  assert.equal(handoffs.length, 2);
  for (const h of handoffs) {
    assert.ok(h.sponsorId === 'p0' || h.sponsorId === 'l1');
  }
  // New player has L1 capacity of 1.
  const underNew = tree.childrenOf.get('l1') ?? [];
  assert.ok(underNew.length <= CHILDREN_PER_PLAYER);
  const underP0 = tree.childrenOf.get('p0') ?? [];
  assert.ok(underP0.length <= CHILDREN_PER_OBSERVER);
});

test('demote returns a wiped player to the caught-up observer pool', () => {
  const tree = createObserverTree();
  upsertNode(tree, 'p0', { role: 'player', depth: 0, caughtUp: true });
  upsertNode(tree, 'p1', { role: 'player', depth: 0, caughtUp: true });
  upsertNode(tree, 'o0', {
    role: 'observer', depth: 1, sponsorId: 'p1', caughtUp: true, joinedAt: 1,
  });
  tree.childrenOf.set('p1', ['o0']);

  const handoffs = demotePlayerToObserver(tree, 'p1', ['p0', 'p1']);
  const p1 = tree.nodes.get('p1');
  assert.equal(p1.role, 'observer');
  assert.equal(p1.caughtUp, true);
  assert.equal(p1.depth, 1);
  assert.ok(p1.sponsorId === 'p0' || p1.sponsorId === 'o0');
  assert.equal(tree.nodes.get('o0').sponsorId, 'p0');
  assert.ok(handoffs.some((h) => h.userId === 'p1'));
  assert.ok(offerEligibleUserIds(tree, 0).includes('p1'));
  assert.ok(offerEligibleUserIds(tree, 0).includes('o0'));
  assert.deepEqual(demotePlayerToObserver(tree, 'p1', ['p0']), []);
});

test('every open seat gets a candidate instead of one per expand step', () => {
  const tree = createObserverTree();
  upsertNode(tree, 'p0', { role: 'player', depth: 0, caughtUp: true });
  upsertNode(tree, 'l1', {
    role: 'observer', depth: 1, sponsorId: 'p0', caughtUp: true, joinedAt: 1,
  });
  tree.childrenOf.set('p0', ['l1']);
  for (const [id, at] of [['l2a', 2], ['l2b', 3], ['l2c', 4]]) {
    upsertNode(tree, id, {
      role: 'observer', depth: 2, sponsorId: 'l1', caughtUp: true, joinedAt: at,
    });
  }
  tree.childrenOf.set('l1', ['l2a', 'l2b', 'l2c']);

  // A lone king has one L1 slot but four empty seats: everyone behind L1 used to
  // wait out a 30s expand step per seat.
  assert.deepEqual(
    offerEligibleUserIds(tree, 0, { minCandidates: 4 }),
    ['l1', 'l2a', 'l2b', 'l2c'],
  );
  assert.deepEqual(offerEligibleUserIds(tree, 0, { minCandidates: 2 }), ['l1', 'l2a']);
  // Expand steps still widen beyond the open-seat count.
  assert.deepEqual(offerEligibleUserIds(tree, 2, { minCandidates: 1 }), ['l1', 'l2a', 'l2b']);
});

test('seat holders and mid-join claimers are never offered a seat', () => {
  const tree = createObserverTree();
  upsertNode(tree, 'p0', { role: 'player', depth: 0, caughtUp: true });
  upsertNode(tree, 'l1a', {
    role: 'observer', depth: 1, sponsorId: 'p0', caughtUp: true, joinedAt: 1,
  });
  tree.childrenOf.set('p0', ['l1a']);
  upsertNode(tree, 'l2a', {
    role: 'observer', depth: 2, sponsorId: 'l1a', caughtUp: true, joinedAt: 2,
  });
  tree.childrenOf.set('l1a', ['l2a']);

  const exclude = (id) => id === 'l1a';
  // Excluding the only L1 must not leave an open seat with nobody able to claim.
  assert.deepEqual(offerEligibleUserIds(tree, 0, { exclude }), ['l2a']);
  assert.deepEqual(offerEligibleUserIds(tree, 0), ['l1a']);
});

test('depth is rebuilt from the players so a promoted sponsor does not strand its subtree', () => {
  const tree = createObserverTree();
  upsertNode(tree, 'p0', { role: 'player', depth: 0, caughtUp: true });
  upsertNode(tree, 'l1', {
    role: 'observer', depth: 1, sponsorId: 'p0', caughtUp: true, joinedAt: 1,
  });
  tree.childrenOf.set('p0', ['l1']);
  upsertNode(tree, 'l2', {
    role: 'observer', depth: 2, sponsorId: 'l1', caughtUp: true, joinedAt: 2,
  });
  tree.childrenOf.set('l1', ['l2']);

  // l1 takes the open seat: l2 is now a child of a player and must read as L1.
  const moved = reconcilePlayers(tree, ['p0', 'l1']);
  assert.equal(tree.nodes.get('l1').role, 'player');
  assert.equal(tree.nodes.get('l1').depth, 0);
  assert.equal(tree.nodes.get('l2').depth, 1);
  assert.ok(moved.some((m) => m.userId === 'l2' && m.depth === 1));
  // The seat holder is gone from the eligible set; the real observer has it.
  assert.deepEqual(offerEligibleUserIds(tree, 0), ['l2']);
});

test('reconcile demotes a stale player node and keeps it claimable', () => {
  const tree = createObserverTree();
  upsertNode(tree, 'p0', { role: 'player', depth: 0, caughtUp: true });
  upsertNode(tree, 'gone', { role: 'player', depth: 0, caughtUp: true });

  reconcilePlayers(tree, ['p0']);
  const stale = tree.nodes.get('gone');
  assert.equal(stale.role, 'observer');
  assert.equal(stale.caughtUp, true);
  assert.ok(offerEligibleUserIds(tree, 0).includes('gone'));
});

test('an observer with no path to a player stays claimable at L1', () => {
  const tree = createObserverTree();
  upsertNode(tree, 'p0', { role: 'player', depth: 0, caughtUp: true });
  upsertNode(tree, 'orphan', {
    role: 'observer', depth: 4, sponsorId: 'vanished', caughtUp: true, joinedAt: 1,
  });

  recomputeDepths(tree);
  assert.equal(tree.nodes.get('orphan').depth, 1);
  assert.equal(tree.nodes.get('orphan').sponsorId, null);
  assert.deepEqual(offerEligibleUserIds(tree, 0), ['orphan']);
});
