// Render-only jagged sky bolts — continuous Lite tubes (no segment joints).

import {
  addToScene,
  createStandardMaterial,
  createTube,
  markMaterialUboDirty,
  removeFromScene,
} from '../vendor/lite/liteVendor.js';
import { LIGHTNING_HIT } from '../sim/lightning.js';

/** Default hot window — actual per-strike values are randomized. */
const HOT_MS_MIN = 70;
const HOT_MS_MAX = 220;
/** Default fade window — actual per-strike values are randomized. */
const FADE_MS_MIN = 280;
const FADE_MS_MAX = 1100;
/** Brief pulse life for non-final return strokes. */
const RETURN_PULSE_MS = 90;
const MIN_SKY_ABOVE_IMPACT = 90;
const BRANCH_DISPLACE = 7;
const TUBE_SIDES = 6;
/** Skip end caps — cheaper, ends are off-screen / at impact flash. */
const CAP_NONE = 0;
/** Cap polyline density before meshing (createTube cost scales with points × sides). */
const MAX_TUBE_POINTS = 28;
/** Soft additive glow beads along each path (not a covering tube shell). */
const GLOW_BEADS_MAIN = 96;
const GLOW_BEADS_BRANCH = 22;

/**
 * Opaque white-hot core. Blue glow is additive billboards along the path so
 * it can't paint over the core the way a translucent outer tube did.
 * Unlit color is emissive × diffuse.
 */
const CORE_DEF = {
  radius: 0.36,
  branchRadius: 0.17,
  diffuse: [1, 1, 1],
  emissive: [4.5, 4.6, 4.8],
};

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 16), 0x45d9f3b) + 0x9e3779b9) >>> 0;
    return (s & 0xffff) / 0xffff;
  };
}

/** Midpoint-displacement bolt path from A → B. */
function generatePath(ax, ay, az, bx, by, bz, generations, maxOffset, seed) {
  let pts = [[ax, ay, az], [bx, by, bz]];
  let offset = maxOffset;
  const rand = makeRng(seed);

  for (let g = 0; g < generations; g++) {
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const mx = (p0[0] + p1[0]) * 0.5;
      const my = (p0[1] + p1[1]) * 0.5;
      const mz = (p0[2] + p1[2]) * 0.5;
      const dx = p1[0] - p0[0];
      const dy = p1[1] - p0[1];
      const dz = p1[2] - p0[2];
      const segLen = Math.hypot(dx, dy, dz) || 1;
      let px = -dz;
      let pz = dx;
      const plen = Math.hypot(px, pz);
      if (plen > 1e-5) {
        px /= plen;
        pz /= plen;
      } else {
        px = 1;
        pz = 0;
      }
      const local = Math.max(offset, segLen * 0.18);
      const jag = (rand() * 2 - 1) * local;
      const lift = (rand() * 2 - 1) * local * 0.22;
      next.push([mx + px * jag, my + lift, mz + pz * jag]);
      next.push(p1);
    }
    pts = next;
    offset *= 0.55;
  }

  const out = new Float32Array(pts.length * 3);
  for (let i = 0; i < pts.length; i++) {
    out[i * 3] = pts[i][0];
    out[i * 3 + 1] = pts[i][1];
    out[i * 3 + 2] = pts[i][2];
  }
  return out;
}

function pathPoint(path, i) {
  return [path[i * 3], path[i * 3 + 1], path[i * 3 + 2]];
}

function pathLen(path) {
  return path.length / 3;
}

function pathToVec3(path) {
  const n = pathLen(path);
  const pts = new Array(n);
  for (let i = 0; i < n; i++) {
    pts[i] = {
      x: path[i * 3],
      y: path[i * 3 + 1],
      z: path[i * 3 + 2],
    };
  }
  return pts;
}

/** Decimate long polylines so createTube stays cheap when zoomed out. */
function decimatePath(path, maxPts = MAX_TUBE_POINTS) {
  const n = pathLen(path);
  if (n <= maxPts) return pathToVec3(path);
  const pts = new Array(maxPts);
  for (let i = 0; i < maxPts; i++) {
    const src = Math.round((i / (maxPts - 1)) * (n - 1));
    pts[i] = {
      x: path[src * 3],
      y: path[src * 3 + 1],
      z: path[src * 3 + 2],
    };
  }
  return pts;
}

function widthMulAt(i, n) {
  const t = i / Math.max(1, n - 1);
  // Slight taper toward the sky end; keep ground end crisp, not fat.
  return 0.75 + (1 - t) * 0.35;
}

function disposeMesh(scene, mesh) {
  if (!mesh) return;
  removeFromScene(scene, mesh);
  const gpu = mesh._gpu;
  if (gpu) {
    gpu.positionBuffer?.destroy?.();
    gpu.normalBuffer?.destroy?.();
    gpu.indexBuffer?.destroy?.();
    gpu.uvBuffer?.destroy?.();
    gpu.uv2Buffer?.destroy?.();
    gpu.tangentBuffer?.destroy?.();
    gpu.colorBuffer?.destroy?.();
  }
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {(x: number, z: number) => number} groundYAt
 * @param {{
 *   emitImpact?: Function,
 *   emitGlow?: Function,
 *   onFlash?: Function,
 *   getSkyOrigin?: (impactX: number, impactY: number, impactZ: number, seed: number) => { x: number, y: number, z: number },
 * }} [opts]
 */
export function createLightningBolts(engine, scene, groundYAt, opts = {}) {
  /** @type {Array<{
   *   birth: number,
   *   phaseStart: number,
   *   flashIndex: number,
   *   flashes: Array<{ delay: number, intensity: number }>,
   *   hotMs: number,
   *   fadeMs: number,
   *   fadePower: number,
   *   endAt: number,
   *   gy: number,
   *   kind: number,
   *   paths: Float32Array[],
   *   scale: number,
   *   sideX: number,
   *   sideZ: number,
   *   tubes: Array<{ mesh: object, material: object, baseEmissive: number[], pts?: object[] }>,
   * }>} */
  const strikes = [];
  let clockMs = 0;
  let segSeed = 1;

  function skyOrigin(x, gy, z, seed) {
    if (opts.getSkyOrigin) return opts.getSkyOrigin(x, gy, z, seed);
    const sx = x + ((seed & 0xff) / 255 - 0.5) * 18;
    const sz = z + (((seed >>> 8) & 0xff) / 255 - 0.5) * 18;
    return { x: sx, y: gy + MIN_SKY_ABOVE_IMPACT, z: sz };
  }

  function freeStrikeTubes(strike) {
    for (let i = 0; i < strike.tubes.length; i++) {
      disposeMesh(scene, strike.tubes[i].mesh);
    }
    strike.tubes.length = 0;
  }

  function makeCoreTube(path, baseRadius) {
    const pts = decimatePath(path);
    if (pts.length < 2) return null;
    const n = pts.length;
    const mesh = createTube(engine, {
      path: pts,
      tessellation: TUBE_SIDES,
      radiusFunction: (i) => baseRadius * widthMulAt(i, n),
      cap: CAP_NONE,
    });
    mesh.pickable = false;
    const material = createStandardMaterial();
    material.diffuseColor = [...CORE_DEF.diffuse];
    material.emissiveColor = [...CORE_DEF.emissive];
    material.ambientColor = [...CORE_DEF.emissive];
    material.specularColor = [0, 0, 0];
    material.disableLighting = true;
    if ('unlit' in material) material.unlit = true;
    material.alpha = 1;
    material.backFaceCulling = false;
    mesh.material = material;
    addToScene(scene, mesh);
    markMaterialUboDirty(material);
    return {
      mesh,
      material,
      baseEmissive: [...CORE_DEF.emissive],
      pts,
    };
  }

  /** Sample a polyline by arc length so beads sit on the bolt, not a straight drop. */
  function pointAlongPolyline(pts, distance) {
    let remaining = distance;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1].x;
      const ay = pts[i - 1].y;
      const az = pts[i - 1].z;
      const bx = pts[i].x;
      const by = pts[i].y;
      const bz = pts[i].z;
      const seg = Math.hypot(bx - ax, by - ay, bz - az);
      if (seg <= 1e-6) continue;
      if (remaining <= seg) {
        const t = remaining / seg;
        return {
          x: ax + (bx - ax) * t,
          y: ay + (by - ay) * t,
          z: az + (bz - az) * t,
        };
      }
      remaining -= seg;
    }
    const last = pts[pts.length - 1];
    return { x: last.x, y: last.y, z: last.z };
  }

  function polylineLength(pts) {
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      total += Math.hypot(
        pts[i].x - pts[i - 1].x,
        pts[i].y - pts[i - 1].y,
        pts[i].z - pts[i - 1].z,
      );
    }
    return total;
  }

  /** Additive soft beads locked to the same polyline as the core tube. */
  function emitPathGlow(pts, scale, lifeSec, isMain, sideX, sideZ) {
    if (!opts.emitGlow || !pts || pts.length < 2) return;
    const total = polylineLength(pts);
    if (total < 1) return;
    const beads = isMain ? GLOW_BEADS_MAIN : GLOW_BEADS_BRANCH;
    const size = (isMain ? 2.1 : 1.2) * scale;
    // Irregular spacing: accumulate random steps, then normalize onto the path.
    const weights = new Float32Array(beads);
    let weightSum = 0;
    for (let i = 0; i < beads; i++) {
      // Bias toward clumps — occasional bigger gaps.
      weights[i] = 0.25 + Math.random() * Math.random() * 2.2;
      weightSum += weights[i];
    }
    let walked = 0;
    for (let i = 0; i < beads; i++) {
      walked += weights[i];
      // Keep off the exact endpoints a touch.
      const u = 0.02 + 0.96 * (walked / weightSum);
      const p = pointAlongPolyline(pts, u * total);
      const jx = (Math.random() - 0.5) * 0.45 * scale;
      const jz = (Math.random() - 0.5) * 0.45 * scale;
      const sidePush = (1.6 + Math.random() * 2.4) * scale;
      opts.emitGlow({
        position: [p.x + jx, p.y, p.z + jz],
        velocity: [
          sideX * sidePush + (Math.random() - 0.5) * 0.5,
          1.0 + Math.random() * 1.8,
          sideZ * sidePush + (Math.random() - 0.5) * 0.5,
        ],
        gravity: [0, 0.35, 0],
        color: isMain ? [0.3, 0.6, 1, 0.85] : [0.22, 0.48, 1, 0.55],
        lifetime: lifeSec * (0.45 + Math.random() * 0.2),
        startSize: size * (0.75 + Math.random() * 0.55),
        endSize: size * 0.12,
        drag: 0.65,
      });
    }
  }

  function rebuildStrikeGeometry(strike, paths, scale, lifeSec) {
    freeStrikeTubes(strike);

    for (let p = 0; p < paths.length; p++) {
      const isMain = p === 0;
      const radius = (isMain ? CORE_DEF.radius : CORE_DEF.branchRadius) * scale;
      const tube = makeCoreTube(paths[p], radius);
      if (!tube) continue;
      strike.tubes.push(tube);
      emitPathGlow(
        tube.pts,
        scale,
        lifeSec,
        isMain,
        strike.sideX,
        strike.sideZ,
      );
    }
  }

  /** Re-spark glow on the existing channel (same pattern, return stroke). */
  function emitGlowForPaths(strike, lifeSec) {
    for (let p = 0; p < strike.paths.length; p++) {
      emitPathGlow(
        decimatePath(strike.paths[p]),
        strike.scale,
        lifeSec,
        p === 0,
        strike.sideX,
        strike.sideZ,
      );
    }
  }

  function paintStrikeTubes(strike, fade, flash) {
    // fade: 1 = full white-hot, 0 = gone. Dim emissive + alpha together so it
    // eases out instead of hard-cutting when alpha alone trips visibility.
    for (let i = 0; i < strike.tubes.length; i++) {
      const tube = strike.tubes[i];
      const intensity = fade * (1 + 0.7 * flash);
      const em = [
        tube.baseEmissive[0] * intensity,
        tube.baseEmissive[1] * intensity,
        tube.baseEmissive[2] * intensity,
      ];
      tube.material.emissiveColor = em;
      tube.material.ambientColor = em;
      // Stay fully opaque until the last stretch, then soft alpha falloff.
      if (fade >= 0.35) {
        tube.material.alpha = 1;
      } else {
        tube.material.alpha = Math.max(0.02, Math.min(0.99, fade / 0.35));
      }
      tube.mesh.visible = fade > 0.02;
      markMaterialUboDirty(tube.material);
    }
  }

  function addBranch(paths, main, seed, along, reachScale, gens) {
    const mainN = pathLen(main);
    const idx = Math.max(1, Math.min(mainN - 2, Math.floor(along * (mainN - 1))));
    const [ox, oy, oz] = pathPoint(main, idx);
    const rand = makeRng(seed);
    const ang = rand() * Math.PI * 2;
    const reach = (12 + rand() * 22) * reachScale;
    const drop = (10 + rand() * 28) * reachScale;
    const ex = ox + Math.cos(ang) * reach;
    const ez = oz + Math.sin(ang) * reach;
    const ey = oy - drop;
    paths.push(generatePath(ox, oy, oz, ex, ey, ez, gens, BRANCH_DISPLACE * reachScale, seed));
    return paths[paths.length - 1];
  }

  function buildStrikePaths(x, z, gy, seed, scale = 1) {
    const paths = [];
    const origin = skyOrigin(x, gy, z, seed);
    const boltLen = Math.max(40, origin.y - gy);
    const rand = makeRng(seed ^ 0xa5a5);
    const leanX = origin.x - x;
    const leanZ = origin.z - z;
    const leanLen = Math.hypot(leanX, leanZ) || 1;
    const nx = leanX / leanLen;
    const nz = leanZ / leanLen;
    const midSwing = boltLen * (0.12 + rand() * 0.14) * scale;
    const midX = x - nx * midSwing + (rand() * 2 - 1) * boltLen * 0.06;
    const midZ = z - nz * midSwing + (rand() * 2 - 1) * boltLen * 0.06;
    const midY = gy + boltLen * (0.35 + rand() * 0.2);

    // Keep gens modest — decimate handles zoomed-out length.
    const gens = Math.min(5, 4 + Math.floor(boltLen / 280));
    const displace = boltLen * (0.1 + rand() * 0.05) * scale;

    const upper = generatePath(
      origin.x, origin.y, origin.z,
      midX, midY, midZ,
      gens,
      displace,
      seed,
    );
    const lower = generatePath(
      midX, midY, midZ,
      x, gy, z,
      gens,
      displace * 0.75,
      seed + 91,
    );
    const main = new Float32Array(upper.length + lower.length - 3);
    main.set(upper);
    main.set(lower.subarray(3), upper.length);
    paths.push(main);

    // 2–3 branches, no sub-forks — biggest cost is path count × layers.
    const branchCount = 2 + (seed % 2);
    for (let b = 0; b < branchCount; b++) {
      const along = 0.22 + ((seed >>> (b * 3)) & 7) / 7 * 0.45;
      addBranch(
        paths,
        main,
        seed + b * 97 + 13,
        along,
        (0.65 + (b % 2) * 0.25) * scale * Math.min(1.5, boltLen / 150),
        3,
      );
    }
    return paths;
  }

  function fadeCurve(t, power) {
    // t in [0,1] through the fade window → brightness 1→0.
    const u = 1 - Math.max(0, Math.min(1, t));
    return u ** power;
  }

  function beginFlash(strike, flashIndex, worldFlash) {
    const flash = strike.flashes[flashIndex];
    strike.flashIndex = flashIndex;
    strike.phaseStart = clockMs;
    const isLast = flashIndex >= strike.flashes.length - 1;
    const glowLife = isLast
      ? (strike.hotMs + strike.fadeMs) / 1000
      : RETURN_PULSE_MS / 1000;

    if (strike.tubes.length === 0) {
      rebuildStrikeGeometry(strike, strike.paths, strike.scale, glowLife);
    } else {
      // Same channel — just re-ignite glow beads.
      emitGlowForPaths(strike, glowLife);
    }
    if (worldFlash) opts.onFlash?.(flash.intensity);
  }

  function refreshStrike(strike) {
    const ageFromBirth = clockMs - strike.birth;

    // Advance through return strokes that reuse the same path pattern.
    while (
      strike.flashIndex + 1 < strike.flashes.length &&
      ageFromBirth >= strike.flashes[strike.flashIndex + 1].delay
    ) {
      beginFlash(strike, strike.flashIndex + 1, true);
    }

    const isLast = strike.flashIndex >= strike.flashes.length - 1;
    const age = clockMs - strike.phaseStart;
    const flash = strike.flashes[strike.flashIndex];
    const life = isLast
      ? strike.hotMs + strike.fadeMs
      : Math.min(
          RETURN_PULSE_MS,
          Math.max(
            35,
            (strike.flashes[strike.flashIndex + 1]?.delay ?? ageFromBirth + RETURN_PULSE_MS) -
              flash.delay -
              8,
          ),
        );

    if (age >= life) {
      if (!isLast) {
        // Hard blackout between return strokes — full off, not a soft dim.
        paintStrikeTubes(strike, 0, 0);
        for (let i = 0; i < strike.tubes.length; i++) {
          strike.tubes[i].mesh.visible = false;
        }
        return true;
      }
      freeStrikeTubes(strike);
      return false;
    }

    let fade;
    let punch = 0;
    if (!isLast) {
      // Hard on for most of the short pulse, then hard off for the rest of the gap.
      fade = 1;
      punch = flash.intensity;
    } else if (age < strike.hotMs) {
      fade = 1;
      punch = flash.intensity;
    } else {
      const t = (age - strike.hotMs) / Math.max(1, strike.fadeMs);
      fade = fadeCurve(t, strike.fadePower);
    }

    paintStrikeTubes(strike, fade * flash.intensity, punch > 0.9 ? 1.1 : 0.4);
    // Ensure return pulses actually reappear after a blackout.
    if (fade > 0.02) {
      for (let i = 0; i < strike.tubes.length; i++) {
        strike.tubes[i].mesh.visible = true;
      }
    }
    return true;
  }

  function strike(worldX, worldZ, kind = LIGHTNING_HIT.GROUND) {
    const gy = groundYAt(worldX, worldZ);
    segSeed = (Math.imul(segSeed, 1664525) + 1013904223) >>> 0;
    const seed = segSeed;
    const rand = makeRng(seed);

    // Variable dissolve — some bolts wink out, others linger.
    const hotMs = HOT_MS_MIN + rand() * (HOT_MS_MAX - HOT_MS_MIN);
    const fadeMs = FADE_MS_MIN + rand() * (FADE_MS_MAX - FADE_MS_MIN);
    const fadePower = 1.15 + rand() * 2.4;

    // Same jagged channel for the whole sequence.
    const paths = buildStrikePaths(worldX, worldZ, gy, seed, 1);
    const sideAng = rand() * Math.PI * 2;

    /** @type {Array<{ delay: number, intensity: number }>} */
    const flashes = [{ delay: 0, intensity: 1 }];
    // ~50% of strikes get 1–3 return flashes on the same pattern.
    if (rand() < 0.52) {
      const returns = 1 + Math.floor(rand() * 3);
      let t = 70 + rand() * 90;
      for (let r = 0; r < returns; r++) {
        flashes.push({
          delay: t,
          intensity: 0.7 + rand() * 0.55,
        });
        // Leave a clear dark gap between pulses.
        t += 90 + rand() * 160;
      }
    }

    const last = flashes[flashes.length - 1];
    const entry = {
      birth: clockMs,
      phaseStart: clockMs,
      flashIndex: -1,
      flashes,
      hotMs,
      fadeMs,
      fadePower,
      endAt: clockMs + last.delay + hotMs + fadeMs,
      gy,
      kind,
      paths,
      scale: 1,
      sideX: Math.cos(sideAng),
      sideZ: Math.sin(sideAng),
      tubes: [],
    };
    beginFlash(entry, 0, true);
    strikes.push(entry);

    opts.emitImpact?.(worldX, gy, worldZ, kind);
    refreshStrike(entry);
  }

  function update(deltaMs) {
    clockMs += Math.min(100, Math.max(0, deltaMs));
    for (let i = strikes.length - 1; i >= 0; i--) {
      const s = strikes[i];
      if (clockMs >= s.endAt || !refreshStrike(s)) {
        freeStrikeTubes(s);
        strikes.splice(i, 1);
      }
    }
  }

  function clear() {
    for (let i = 0; i < strikes.length; i++) freeStrikeTubes(strikes[i]);
    strikes.length = 0;
  }

  function commit() {
    // Scene meshes are live — nothing to flush.
  }

  return {
    strike,
    update,
    clear,
    commit,
    stats() {
      let tubes = 0;
      for (let i = 0; i < strikes.length; i++) tubes += strikes[i].tubes.length;
      return { strikes: strikes.length, tubes };
    },
  };
}
