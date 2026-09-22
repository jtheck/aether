// Observer fan-out tree + cascading open-slot offer eligibility.

import { MAX_SLOTS } from './protocol.js';

/** L1: one observer per live player. Deeper nodes fan out further. */
export const CHILDREN_PER_PLAYER = 1;
export const CHILDREN_PER_OBSERVER = 4;
/** ~5 minutes at 20 Hz. */
export const CHECKPOINT_INTERVAL_TICKS = 6000;
/** Expand offer eligibility by one more observer every 30s. */
export const OFFER_EXPAND_MS = 30_000;

/**
 * @typedef {{
 *   userId: string,
 *   role: 'player' | 'observer',
 *   sponsorId: string | null,
 *   depth: number,
 *   caughtUp: boolean,
 *   joinedAt: number,
 * }} ObserverNode
 */

/**
 * @typedef {{
 *   nodes: Map<string, ObserverNode>,
 *   childrenOf: Map<string, string[]>,
 * }} ObserverTree
 */

export function createObserverTree() {
  return {
    nodes: new Map(),
    childrenOf: new Map(),
  };
}

export function upsertNode(tree, userId, patch = {}) {
  if (!userId) return null;
  let node = tree.nodes.get(userId);
  if (!node) {
    node = {
      userId,
      role: patch.role ?? 'observer',
      sponsorId: patch.sponsorId ?? null,
      depth: patch.depth ?? 0,
      caughtUp: patch.caughtUp ?? false,
      joinedAt: patch.joinedAt ?? Date.now(),
    };
    tree.nodes.set(userId, node);
  } else {
    Object.assign(node, patch);
  }
  return node;
}

export function removeNode(tree, userId) {
  const node = tree.nodes.get(userId);
  if (!node) return [];
  const orphans = [...(tree.childrenOf.get(userId) ?? [])];
  if (node.sponsorId) {
    const sibs = tree.childrenOf.get(node.sponsorId);
    if (sibs) {
      const next = sibs.filter((id) => id !== userId);
      if (next.length) tree.childrenOf.set(node.sponsorId, next);
      else tree.childrenOf.delete(node.sponsorId);
    }
  }
  tree.childrenOf.delete(userId);
  tree.nodes.delete(userId);
  for (const childId of orphans) {
    const child = tree.nodes.get(childId);
    if (child) {
      child.sponsorId = null;
    }
  }
  return orphans;
}

function childCount(tree, userId) {
  return tree.childrenOf.get(userId)?.length ?? 0;
}

function capacityFor(node) {
  if (!node) return 0;
  if (node.role === 'player') return CHILDREN_PER_PLAYER;
  return CHILDREN_PER_OBSERVER;
}

function linkChild(tree, sponsorId, childId) {
  const list = tree.childrenOf.get(sponsorId) ?? [];
  if (!list.includes(childId)) list.push(childId);
  tree.childrenOf.set(sponsorId, list);
  const child = tree.nodes.get(childId);
  const sponsor = tree.nodes.get(sponsorId);
  if (child) {
    child.sponsorId = sponsorId;
    child.depth = (sponsor?.depth ?? 0) + 1;
  }
}

/**
 * Pick a sponsor for a new observer: prefer empty L1 under a player, else
 * shallowest observer/player with free capacity (deterministic by userId).
 * @param {ObserverTree} tree
 * @param {string[]} playerUserIds — live players
 * @param {string} observerUserId
 */
export function assignSponsor(tree, playerUserIds, observerUserId) {
  upsertNode(tree, observerUserId, { role: 'observer' });
  const players = [...playerUserIds].filter(Boolean).sort();
  for (const pid of players) {
    upsertNode(tree, pid, { role: 'player', depth: 0, sponsorId: null, caughtUp: true });
    if (childCount(tree, pid) < CHILDREN_PER_PLAYER) {
      linkChild(tree, pid, observerUserId);
      return tree.nodes.get(observerUserId);
    }
  }

  /** @type {{ id: string, depth: number }[]} */
  const candidates = [];
  for (const [id, node] of tree.nodes) {
    if (id === observerUserId) continue;
    if (!node.caughtUp && node.role === 'observer') continue;
    if (childCount(tree, id) >= capacityFor(node)) continue;
    candidates.push({ id, depth: node.depth | 0 });
  }
  candidates.sort((a, b) => a.depth - b.depth || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!candidates.length) {
    // No capacity yet — leave unassigned; caller retries.
    const node = tree.nodes.get(observerUserId);
    if (node) {
      node.sponsorId = null;
      node.depth = 1;
    }
    return node;
  }
  linkChild(tree, candidates[0].id, observerUserId);
  return tree.nodes.get(observerUserId);
}

/**
 * Reassign orphans (and optionally a promoting node's children) to other sponsors.
 * @returns {{ userId: string, sponsorId: string | null, depth: number }[]}
 */
export function reassignOrphans(tree, playerUserIds, orphanUserIds) {
  const assignments = [];
  const sorted = [...orphanUserIds].sort();
  for (const oid of sorted) {
    const node = tree.nodes.get(oid);
    if (!node || node.role === 'player') continue;
    // Detach from old sponsor list if still linked.
    if (node.sponsorId) {
      const sibs = tree.childrenOf.get(node.sponsorId);
      if (sibs) {
        const next = sibs.filter((id) => id !== oid);
        if (next.length) tree.childrenOf.set(node.sponsorId, next);
        else tree.childrenOf.delete(node.sponsorId);
      }
      node.sponsorId = null;
    }
    assignSponsor(tree, playerUserIds, oid);
    const updated = tree.nodes.get(oid);
    assignments.push({
      userId: oid,
      sponsorId: updated?.sponsorId ?? null,
      depth: updated?.depth ?? 1,
    });
  }
  return assignments;
}

/**
 * Combat-wipe / forfeit: turn a player into a caught-up observer and reassign
 * their L1 children (and themselves) onto remaining players.
 * @returns {{ userId: string, sponsorId: string | null, depth: number }[]}
 */
export function demotePlayerToObserver(tree, userId, playerUserIds) {
  if (!userId) return [];
  const existing = tree.nodes.get(userId);
  if (existing?.role === 'observer' && existing.caughtUp) return [];
  const children = [...(tree.childrenOf.get(userId) ?? [])];
  if (existing?.sponsorId) {
    const sibs = tree.childrenOf.get(existing.sponsorId);
    if (sibs) {
      const next = sibs.filter((id) => id !== userId);
      if (next.length) tree.childrenOf.set(existing.sponsorId, next);
      else tree.childrenOf.delete(existing.sponsorId);
    }
  }
  tree.childrenOf.delete(userId);
  upsertNode(tree, userId, {
    role: 'observer',
    sponsorId: null,
    depth: 1,
    caughtUp: true,
  });
  const players = (playerUserIds ?? []).filter((id) => id && id !== userId);
  const assignments = reassignOrphans(tree, players, [userId, ...children]);
  const node = tree.nodes.get(userId);
  if (node) {
    // Seat offers start at L1. A just-eliminated player should be able to
    // claim the open seat immediately, even if the tree parked them deeper.
    node.depth = 1;
    node.caughtUp = true;
  }
  return assignments;
}

/**
 * Rebuild every observer depth by walking out from the players.
 *
 * Depth is only ever written when a link is made, so a sponsor that later
 * promotes or drops leaves its whole subtree at a stale depth — which silently
 * excludes those observers from L1 seat offers forever.
 */
export function recomputeDepths(tree) {
  for (const [sponsorId, children] of [...tree.childrenOf]) {
    const kept = tree.nodes.has(sponsorId)
      ? children.filter((id) => tree.nodes.has(id))
      : [];
    if (kept.length) tree.childrenOf.set(sponsorId, kept);
    else tree.childrenOf.delete(sponsorId);
    if (tree.nodes.has(sponsorId)) continue;
    for (const childId of children) {
      const child = tree.nodes.get(childId);
      if (child?.sponsorId === sponsorId) child.sponsorId = null;
    }
  }

  const queue = [];
  for (const node of tree.nodes.values()) {
    if (node.role !== 'player') continue;
    node.depth = 0;
    node.sponsorId = null;
    queue.push(node.userId);
  }
  const reached = new Set(queue);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    const depth = tree.nodes.get(id)?.depth ?? 0;
    for (const childId of tree.childrenOf.get(id) ?? []) {
      if (reached.has(childId)) continue;
      const child = tree.nodes.get(childId);
      if (!child || child.role === 'player') continue;
      child.sponsorId = id;
      child.depth = depth + 1;
      reached.add(childId);
      queue.push(childId);
    }
  }
  // Observers with no path to a player are parked at L1: they still hold a
  // caught-up world, so they must stay claimable while they wait for a sponsor.
  for (const node of tree.nodes.values()) {
    if (node.role === 'player' || reached.has(node.userId)) continue;
    node.sponsorId = null;
    node.depth = 1;
  }
  return tree;
}

/**
 * Make the tree agree with the live roster.
 *
 * The king is the only node that computes offer eligibility, and it is not the
 * node that runs the promote/demote handoff — so without this a seat holder
 * stays in the tree as a caught-up L1 observer and permanently occupies the
 * eligible set while the real observers sit below them.
 * @returns {{ userId: string, sponsorId: string | null, depth: number }[]}
 */
export function reconcilePlayers(tree, playerUserIds) {
  const players = [...new Set((playerUserIds ?? []).filter(Boolean))];
  const assignments = [];
  for (const id of players) {
    const node = tree.nodes.get(id);
    if (node?.role === 'player' && node.depth === 0 && !node.sponsorId) continue;
    assignments.push(...promoteObserverToPlayer(tree, id, players));
  }
  for (const node of [...tree.nodes.values()]) {
    if (node.role !== 'player') continue;
    if (players.includes(node.userId)) continue;
    assignments.push(...demotePlayerToObserver(tree, node.userId, players));
  }
  recomputeDepths(tree);

  const out = [];
  const seen = new Set();
  for (const a of assignments) {
    if (!a?.userId || seen.has(a.userId)) continue;
    seen.add(a.userId);
    const node = tree.nodes.get(a.userId);
    if (!node || node.role === 'player') continue;
    out.push({ userId: node.userId, sponsorId: node.sponsorId ?? null, depth: node.depth | 0 });
  }
  return out;
}

/**
 * When an observer promotes to player: detach from sponsor, take their children
 * as orphans to reassign, mark self as player with L1 capacity.
 */
export function promoteObserverToPlayer(tree, userId, playerUserIds) {
  const node = upsertNode(tree, userId, { role: 'player', depth: 0, caughtUp: true });
  const children = [...(tree.childrenOf.get(userId) ?? [])];
  if (node.sponsorId) {
    const sibs = tree.childrenOf.get(node.sponsorId);
    if (sibs) {
      const next = sibs.filter((id) => id !== userId);
      if (next.length) tree.childrenOf.set(node.sponsorId, next);
      else tree.childrenOf.delete(node.sponsorId);
    }
  }
  node.sponsorId = null;
  node.depth = 0;
  tree.childrenOf.delete(userId);
  const players = playerUserIds.includes(userId)
    ? playerUserIds
    : [...playerUserIds, userId];
  return reassignOrphans(tree, players, children);
}

/** L1 observers = depth 1, sponsored by a player. */
export function listL1Observers(tree) {
  const out = [];
  for (const node of tree.nodes.values()) {
    if (node.role !== 'observer') continue;
    if (node.depth !== 1) continue;
    out.push(node);
  }
  return out.sort((a, b) => a.joinedAt - b.joinedAt || (a.userId < b.userId ? -1 : 1));
}

/** All observers in join order. */
export function listObserversByJoin(tree) {
  const out = [];
  for (const node of tree.nodes.values()) {
    if (node.role !== 'observer') continue;
    out.push(node);
  }
  return out.sort((a, b) => a.joinedAt - b.joinedAt || (a.userId < b.userId ? -1 : 1));
}

/**
 * Eligible userIds for an open-seat offer.
 * Starts with caught-up L1; every expandStep adds the next caught-up observer.
 * @param {number} expandSteps — each step widens eligibility by one more observer
 * @param {{ exclude?: (userId: string) => boolean, minCandidates?: number }} [options]
 *   exclude — seat holders and mid-join claimers must not be offered a second seat
 *   minCandidates — every open seat needs a candidate (see below)
 */
export function offerEligibleUserIds(tree, expandSteps = 0, options = {}) {
  const skip = options.exclude ?? (() => false);
  const ready = (n) => n.caughtUp && !skip(n.userId);
  const l1 = listL1Observers(tree).filter(ready);
  const all = listObserversByJoin(tree).filter(ready);
  const eligible = [];
  const seen = new Set();
  for (const n of l1) {
    eligible.push(n.userId);
    seen.add(n.userId);
  }
  // The 1:1 fan-out limit is about catch-up bandwidth, not about who may take an
  // empty seat. Capping eligibility at L1 meant a lone king could only ever
  // offer to one observer, so everybody behind them waited out an expand step
  // per seat while seats sat open.
  const want = Math.max(Math.max(1, options.minCandidates ?? 1), eligible.length + expandSteps);
  for (const n of all) {
    if (eligible.length >= want) break;
    if (seen.has(n.userId)) continue;
    eligible.push(n.userId);
    seen.add(n.userId);
  }
  return eligible;
}

export function maxPlayerSponsors() {
  return MAX_SLOTS;
}
