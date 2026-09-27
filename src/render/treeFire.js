// Fire in the body of the tree. Tongues sit in the trunk and inner canopy
// and are large enough to join, so the tree reads as burning — not as
// pinprick lights on the outer leaves.

/** Keep in sync with scenery tree variant `modelScale`. */
export const TREE_MODEL_SCALE = 0.9;
/** trees.glb local Y max (baked bound). */
export const TREE_MESH_HEIGHT = 4.92;

/** Camp socket scale is inherent × model (3 × 1.25). */
export const CAMP_SOCKET_SCALE = 3.75;

/**
 * Sites in trees.glb local space, inside the foliage (mesh radius reaches
 * ~3.5; these stay near the core). A column climbs the trunk, and a few
 * licks sit in the inner canopy so they meet that column. `kind` picks
 * tongue size; `smoke` marks crown sites that chimney.
 */
export const TREE_FIRE_ANCHORS = [
  { x: -0.2, y: 0.55, z: 0.05, kind: 'trunk' },
  { x: 0.05, y: 1.45, z: -0.2, kind: 'trunk' },
  { x: -0.25, y: 2.35, z: 0.1, kind: 'leaf' },
  { x: 0.1, y: 3.2, z: -0.15, kind: 'leaf' },
  { x: -0.1, y: 4.05, z: 0.05, kind: 'leaf', smoke: true },
  { x: 1.05, y: 1.25, z: -0.75, kind: 'leaf' },
  { x: -1.15, y: 1.55, z: 0.7, kind: 'leaf' },
  { x: 0.15, y: 2.15, z: 1.05, kind: 'leaf' },
  { x: -0.55, y: 2.85, z: -1.05, kind: 'leaf' },
  { x: 0.75, y: 3.45, z: 0.45, kind: 'leaf', smoke: true },
];

export function treeWorldScale(stockScale) {
  return TREE_MODEL_SCALE * Math.max(0.38, Number(stockScale) || 1);
}

export function treeFireHeight(stockScale) {
  return TREE_MESH_HEIGHT * treeWorldScale(stockScale);
}

export function treeCrownCenterY(y, stockScale) {
  return y + 2.7 * treeWorldScale(stockScale);
}

/**
 * Same Ry(yaw) × Rz(lean) as scenery instance placement, so fire lists
 * with the tree as it chars.
 */
export function treeLocalToWorld(x, y, z, lx, ly, lz, yaw = 0, lean = 0) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const cl = Math.cos(lean);
  const sl = Math.sin(lean);
  return {
    x: x + c * cl * lx - c * sl * ly + s * lz,
    y: y + sl * lx + cl * ly,
    z: z - s * cl * lx + s * sl * ly + c * lz,
  };
}

export function treeMeshToWorld(x, y, z, mx, my, mz, stockScale, yaw = 0, lean = 0) {
  const s = treeWorldScale(stockScale);
  return treeLocalToWorld(x, y, z, mx * s, my * s, mz * s, yaw, lean);
}

/**
 * Fat enough that neighboring tongues join into one fire. Still under a
 * full camp hearth (socket scale 3.75) so the canopy is not one bonfire.
 */
export function treeFireTongueScale(kind, stockScale) {
  const grow = Math.max(0.75, Math.min(1.7, treeWorldScale(stockScale) / 1.2));
  return (kind === 'trunk' ? 2.15 : 2.75) * grow;
}

/**
 * @param {{
 *   x: number, y: number, z: number,
 *   stockScale?: number,
 *   yaw?: number,
 *   lean?: number,
 * }} tree
 * @param {(site: {
 *   x: number, y: number, z: number,
 *   scale: number,
 *   kind: string,
 *   index: number,
 *   smoke: boolean,
 * }) => void} fn
 */
export function forEachTreeFireAnchor(tree, fn) {
  const stockScale = tree.stockScale;
  const yaw = tree.yaw || 0;
  const lean = tree.lean || 0;
  for (let i = 0; i < TREE_FIRE_ANCHORS.length; i++) {
    const a = TREE_FIRE_ANCHORS[i];
    const w = treeMeshToWorld(tree.x, tree.y, tree.z, a.x, a.y, a.z, stockScale, yaw, lean);
    fn({
      x: w.x,
      y: w.y,
      z: w.z,
      scale: treeFireTongueScale(a.kind, stockScale),
      kind: a.kind,
      index: i,
      smoke: a.smoke === true,
    });
  }
}
