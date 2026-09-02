// In-match intro playback — same reel/player as Forge, no sheet.

import { TILE_SIZE_F, worldHalfFFromField } from '../sim/field.js';
import { createStoryHud } from './hud.js';
import { createStoryPlayer } from './player.js';
import { createStorySpeech, narratorLines } from './speech.js';
import { activeReel, normalizeStory } from './timeline.js';

function reelForStart(story) {
  const s = normalizeStory(story);
  return s.reels.find((r) => r.when === 'start') || activeReel(s, 'intro');
}

function worldFromTile(field, tx, tz) {
  const half = field.worldHalfF ?? worldHalfFFromField(field);
  return {
    x: (tx + 0.5) * TILE_SIZE_F - half,
    z: (tz + 0.5) * TILE_SIZE_F - half,
  };
}

function skipEvent(e) {
  return e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter';
}

function skipTarget(el) {
  return el?.closest?.('#side_menu, #header, button, a, input, select, textarea, label');
}

/**
 * @param {{
 *   getCamera?: () => { setPose?: Function, stopFollow?: Function } | null,
 *   getField?: () => { worldHalfF?: number, width?: number } | null,
 *   getSpeakerPos?: (name: string) => { x: number, y: number, z: number } | null,
 *   worldToScreen?: (x: number, y: number, z: number) => { x: number, y: number } | null,
 *   host?: HTMLElement | null,
 * }} [opts]
 */
export function createMatchStory(opts = {}) {
  const hud = typeof document !== 'undefined'
    ? createStoryHud(opts.host ?? document.body)
    : { show() {}, hide() {}, setInset() {}, dispose() {} };
  hud.setInset?.({ left: 24, right: 24, bottom: 96, zIndex: 20 });
  const speech = typeof document !== 'undefined'
    ? createStorySpeech({
      host: opts.host ?? document.body,
      worldToScreen: (...args) => opts.worldToScreen?.(...args) ?? null,
      getSpeakerPos: (name) => opts.getSpeakerPos?.(name) ?? null,
    })
    : { show() {}, hide() {}, tick() {}, dispose() {} };

  let player = null;
  let playing = false;

  function applySample(s) {
    const cam = opts.getCamera?.();
    const field = opts.getField?.();
    if (s?.camera && cam && field) {
      const live = s.camera.char ? opts.getSpeakerPos?.(s.camera.char) : null;
      const tile = worldFromTile(field, s.camera.tx, s.camera.tz);
      const x = live?.x ?? tile.x;
      const z = live?.z ?? tile.z;
      cam.stopFollow?.();
      cam.setPose?.({ x, z, radius: s.camera.radius, alpha: s.camera.alpha }, { unclamped: true });
    }
    const lines = s?.lines ?? (s?.line ? [s.line] : []);
    const narrated = narratorLines(lines);
    if (narrated.length) hud.show(narrated);
    else hud.hide();
    speech.show(lines);
  }

  function unbindSkip() {
    if (typeof window === 'undefined') return;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onPointer, true);
  }

  function bindSkip() {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
  }

  function stop() {
    if (!playing) return;
    playing = false;
    unbindSkip();
    player?.stop();
    hud.hide();
    speech.hide();
  }

  function onKey(e) {
    if (!playing || !skipEvent(e)) return;
    if (skipTarget(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    skip();
  }

  function onPointer(e) {
    if (!playing || skipTarget(e.target)) return;
    skip();
  }

  function skip() {
    if (!playing || !player) return;
    player.seek(player.duration());
    stop();
  }

  function playIntro(story) {
    stop();
    if (!story) return false;
    const reel = reelForStart(story);
    if (!reel?.clips?.length || !(reel.duration > 0)) return false;
    player = createStoryPlayer({
      reel,
      onSample: (s) => {
        applySample(s);
        if (playing && player.rate() === 0 && player.time() >= player.duration() - 1e-4) {
          stop();
        }
      },
    });
    playing = true;
    bindSkip();
    player.play();
    return true;
  }

  function tick(deltaMs) {
    if (playing) player?.tick(deltaMs);
    speech.tick();
  }

  return {
    playIntro,
    skip,
    stop,
    tick,
    driving: () => playing,
  };
}
