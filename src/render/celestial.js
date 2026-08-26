// Two celestial lights. Grade stays in olive / umber so TeamColor owns
// the rest of the spectrum. Opposite fill keeps camera yaw from going black.
// Not in lockstep — client lighting only.

import {
  addToScene,
  createDirectionalLight,
  createHemisphericLight,
  setSceneImageProcessing,
} from '../vendor/lite/liteVendor.js';

export const BODY = {
  SUN: 'sun',
  MOON: 'moon',
  HEMI: 'hemi',
  EMIT: 'emit',
};

/** Daylight on forest dirt — no amber/rose from the pathing overlay. */
const KIND_LOOK = {
  // Warm key vs. cool-neutral fill gives faces a lit/shadow split (form shading)
  // instead of a flat wash. Stays in olive/umber so TeamColor owns the spectrum.
  sun: { diffuse: [1.0, 0.94, 0.82], ground: [0.24, 0.26, 0.2] },
  moon: { diffuse: [0.86, 0.88, 0.86], ground: [0.2, 0.22, 0.2] },
  hemi: { diffuse: [0.84, 0.88, 0.9], ground: [0.26, 0.28, 0.24] },
  emit: { diffuse: [0.94, 0.95, 0.9], ground: [0.7, 0.72, 0.62] },
};

const CLEAR_COLOR = [0.2, 0.23, 0.21];
const EXPOSURE = 1.55;
const CONTRAST = 1.05;

/**
 * @param {number} azDeg 0 = +Z, 90 = +X
 * @param {number} elDeg 0 = horizon, 90 = zenith
 * @returns {[number, number, number]} light travel direction
 */
export function directionFromAzEl(azDeg, elDeg) {
  const az = (azDeg * Math.PI) / 180;
  const el = (Math.max(-89, Math.min(89, elDeg)) * Math.PI) / 180;
  const h = Math.cos(el);
  const x = Math.sin(az) * h;
  const y = Math.sin(el);
  const z = Math.cos(az) * h;
  return [-x, -y, -z];
}

/**
 * @param {{ x?: number, y?: number, z?: number } | number[] | null | undefined} dir
 * @returns {{ azimuth: number, elevation: number }}
 */
export function azElFromDirection(dir) {
  const dx = Array.isArray(dir) ? dir[0] : dir?.x ?? 0;
  const dy = Array.isArray(dir) ? dir[1] : dir?.y ?? -1;
  const dz = Array.isArray(dir) ? dir[2] : dir?.z ?? 0;
  const px = -dx;
  const py = -dy;
  const pz = -dz;
  const len = Math.hypot(px, py, pz) || 1;
  return {
    azimuth: (Math.atan2(px, pz) * 180) / Math.PI,
    elevation: (Math.asin(Math.max(-1, Math.min(1, py / len))) * 180) / Math.PI,
  };
}

export function defaultCelestialState() {
  return {
    exposure: EXPOSURE,
    contrast: CONTRAST,
    clearColor: [...CLEAR_COLOR],
    bodies: [
      // Key stays directional; fill is the floor so wrap does not collapse when
      // the camera yaws or the sun sweeps. Exposure is the all-angle lift —
      // do not balance brightness by pushing the key from one view.
      { kind: BODY.SUN, azimuth: 56, elevation: 36, intensity: 1.85 },
      { kind: BODY.HEMI, azimuth: 236, elevation: 68, intensity: 0.72 },
    ],
  };
}

function cloneState(src) {
  const base = defaultCelestialState();
  if (!src) return base;
  return {
    exposure: Number.isFinite(src.exposure) ? src.exposure : base.exposure,
    contrast: Number.isFinite(src.contrast) ? src.contrast : base.contrast,
    clearColor: Array.isArray(src.clearColor) ? src.clearColor.slice(0, 3) : base.clearColor,
    bodies: [0, 1].map((i) => {
      const b = src.bodies?.[i] ?? base.bodies[i];
      const kind = Object.values(BODY).includes(b.kind) ? b.kind : base.bodies[i].kind;
      return {
        kind,
        azimuth: Number(b.azimuth) || 0,
        elevation: Number(b.elevation) || 0,
        intensity: Number.isFinite(b.intensity) ? b.intensity : base.bodies[i].intensity,
      };
    }),
  };
}

function setVec3(target, xyz) {
  if (!target) return;
  if (Array.isArray(target)) {
    target[0] = xyz[0];
    target[1] = xyz[1];
    target[2] = xyz[2];
    return;
  }
  if ('x' in target) {
    target.x = xyz[0];
    target.y = xyz[1];
    target.z = xyz[2];
  }
}

function writeColor(light, rgb) {
  if (light.diffuse) setVec3(light.diffuse, rgb);
  if (light.diffuseColor) setVec3(light.diffuseColor, rgb);
}

function writeGround(light, rgb) {
  if (light.groundColor) setVec3(light.groundColor, rgb);
}

function writeDirection(light, dir) {
  if (light.direction) setVec3(light.direction, dir);
}

function placeDirectional(light, dir, dist) {
  writeDirection(light, dir);
  if (!light.position) return;
  light.position.x = -dir[0] * dist;
  light.position.y = -dir[1] * dist;
  light.position.z = -dir[2] * dist;
}

function isHemiKind(kind) {
  return kind === BODY.HEMI || kind === BODY.EMIT;
}

/**
 * @param {object} scene
 * @param {{ worldHalfF?: number, state?: object }} [opts]
 */
export function createCelestialRig(scene, opts = {}) {
  let worldHalfF = opts.worldHalfF ?? 384;
  let state = cloneState(opts.state);
  const dirs = [
    createDirectionalLight(directionFromAzEl(56, 30), 0),
    createDirectionalLight(directionFromAzEl(236, 20), 0),
  ];
  const hemis = [
    createHemisphericLight([0, 1, 0], 0),
    createHemisphericLight([0, 1, 0], 0),
  ];
  for (const light of [...dirs, ...hemis]) addToScene(scene, light);

  // Demo spin: sweeps azimuth (and arcs elevation) so all lighting angles —
  // low-angle rim light + long shadows through overhead — are visible in one
  // pass. Client-only; never touches the sim. Off by default.
  const spin = { enabled: false, azDegPerSec: 45, arcElevation: true };
  let spinPhaseSec = 0;

  /** Re-aim both lights for the given state. Colour/intensity untouched. */
  function writeAngles(s) {
    const dist = worldHalfF * 2.75;
    for (let i = 0; i < 2; i++) {
      const dir = directionFromAzEl(s.bodies[i].azimuth, s.bodies[i].elevation);
      placeDirectional(dirs[i], dir, dist);
      writeDirection(hemis[i], [-dir[0], -dir[1], -dir[2]]);
    }
  }

  function apply(next) {
    if (next) state = cloneState(next);
    for (let i = 0; i < 2; i++) {
      const body = state.bodies[i];
      const look = KIND_LOOK[body.kind] ?? KIND_LOOK.sun;
      const hemiOn = isHemiKind(body.kind);
      dirs[i].intensity = hemiOn ? 0 : body.intensity;
      hemis[i].intensity = hemiOn ? body.intensity : 0;
      writeColor(dirs[i], look.diffuse);
      writeColor(hemis[i], look.diffuse);
      writeGround(hemis[i], look.ground);
    }
    writeAngles(state);
    if (scene.clearColor) {
      scene.clearColor.r = state.clearColor[0];
      scene.clearColor.g = state.clearColor[1];
      scene.clearColor.b = state.clearColor[2];
      scene.clearColor.a = 1;
    }
    try {
      setSceneImageProcessing(scene, {
        exposure: state.exposure,
        contrast: state.contrast,
      });
    } catch {
      /* Lite build without image processing */
    }
    return state;
  }

  apply(state);

  return {
    shadowLight: dirs[0],
    fillLight: hemis[1],
    get fillBaseIntensity() {
      const b = state.bodies[1];
      return isHemiKind(b.kind) ? b.intensity : 0;
    },
    getState: () => cloneState(state),
    apply,
    setWorldHalfF(next) {
      worldHalfF = next;
      apply();
    },
    /**
     * Per-frame hook. While spinning, advances the celestial angles so you can
     * preview the full lighting range. No-op when spin is off.
     * @param {number} deltaMs
     */
    update(deltaMs) {
      if (!spin.enabled) return;
      spinPhaseSec += Math.max(0, Number(deltaMs) || 0) / 1000;
      const azOff = spin.azDegPerSec * spinPhaseSec;
      // One elevation cycle per full azimuth sweep: 15° (low, long shadows) → 75° (high).
      const el = spin.arcElevation
        ? 45 + 30 * Math.sin((azOff * Math.PI) / 180)
        : null;
      const eff = cloneState(state);
      for (let i = 0; i < 2; i++) {
        eff.bodies[i].azimuth = state.bodies[i].azimuth + azOff;
        if (el != null) eff.bodies[i].elevation = el;
      }
      writeAngles(eff);
    },
    /** @param {boolean} on @param {{ azDegPerSec?: number, arcElevation?: boolean }} [opts] */
    setSpin(on, opts = {}) {
      spin.enabled = !!on;
      if (Number.isFinite(opts.azDegPerSec)) spin.azDegPerSec = opts.azDegPerSec;
      if (typeof opts.arcElevation === 'boolean') spin.arcElevation = opts.arcElevation;
      if (!spin.enabled) {
        spinPhaseSec = 0;
        writeAngles(state);
      }
      return spin.enabled;
    },
    toggleSpin() {
      return this.setSpin(!spin.enabled);
    },
    getSpin: () => ({ ...spin }),
  };
}
