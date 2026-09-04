// Howler-backed audio for Lite (no Babylon audio in @babylonjs/lite).

import { Howl, Howler } from 'howler';
import { getVolumeLevel } from './settings.js';

const sounds = new Map();
let masterVolume = 0.25;
let unlocked = false;

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/** Resume AudioContext after a user gesture (required by browsers). */
export function unlock() {
  if (unlocked) return;
  try {
    if (Howler.ctx && Howler.ctx.state === 'suspended') {
      Howler.ctx.resume();
    }
    unlocked = true;
  } catch {
    // ignore — playback will retry on next gesture
  }
}

/** Volume level 0–100 (matches v1 prefs). */
export function setVolume(level) {
  masterVolume = clamp01(Number(level) / 100);
  Howler.volume(masterVolume);
}

export function getVolume() {
  return Math.round(masterVolume * 100);
}

/**
 * Register a named Howl. `src` may be a string or string[].
 * Existing names are replaced.
 */
export function load(name, src, opts = {}) {
  const prev = sounds.get(name);
  if (prev) prev.unload();

  const howl = new Howl({
    src: Array.isArray(src) ? src : [src],
    volume: opts.volume ?? 1,
    loop: !!opts.loop,
    preload: opts.preload !== false,
    html5: !!opts.html5,
    ...opts,
  });
  sounds.set(name, howl);
  return howl;
}

/**
 * Howler does not drop play() while the AudioContext is parked.
 * Hidden tabs and `interrupted` contexts queue each call onto `resume`,
 * so a lockstep catch-up (or a long alt-tab) comes back as a stacked chorus.
 */
export function playbackBlocked({ hidden, ctxState } = {}) {
  const isHidden = hidden ?? (typeof document !== 'undefined' && !!document.hidden);
  if (isHidden) return true;
  const state = ctxState ?? Howler.ctx?.state;
  return state === 'interrupted';
}

/** One clap even if many bolts landed in the same drained frame. */
export function thunderPlaysForStrikes(count) {
  return (count | 0) > 0 ? 1 : 0;
}

export function play(name, opts = {}) {
  const howl = sounds.get(name);
  if (!howl || masterVolume <= 0) return null;
  if (playbackBlocked()) return null;
  unlock();
  if (opts.volume != null) howl.volume(clamp01(opts.volume));
  const id = howl.play();
  if (opts.rate != null) howl.rate(opts.rate, id);
  return id;
}

export function stop(name) {
  const howl = sounds.get(name);
  if (howl) howl.stop();
}

export function isLoaded(name) {
  const howl = sounds.get(name);
  return !!(howl && howl.state() === 'loaded');
}

/** Default SFX used by v1; call once at startup. */
export function loadDefaults() {
  load('villager_move_1', 'assets/sounds/units/villager.ogg', { volume: 1 });
  load('villager_move_2', 'assets/sounds/units/villager2.ogg', { volume: 0.85 });
  load('thunder', 'assets/sounds/thunder.ogg', { volume: 0.9 });
}

export function playVillagerMove() {
  const pick = Math.random() < 0.5 ? 'villager_move_1' : 'villager_move_2';
  return play(pick);
}

export function playThunder() {
  return play('thunder');
}

export function init() {
  setVolume(getVolumeLevel());
  loadDefaults();

  if (typeof window !== 'undefined') {
    const unlockOnce = () => {
      unlock();
      window.removeEventListener('pointerdown', unlockOnce);
      window.removeEventListener('keydown', unlockOnce);
    };
    window.addEventListener('pointerdown', unlockOnce, { passive: true });
    window.addEventListener('keydown', unlockOnce);
  }
}

export { Howl, Howler };
