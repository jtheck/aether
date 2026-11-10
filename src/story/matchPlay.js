// In-match intro playback - same reel/player as Forge, no sheet.

import { TILE_SIZE_F, worldHalfFFromField, worldHalfZFFromField } from '../sim/field.js';
import { createStoryHud } from './hud.js';
import { createStoryPlayer } from './player.js';
import { createStorySpeech, LINE_STYLE_LOOK, narratorLines } from './speech.js';
import { createStoryTransport } from './transport.js';
import { CLIP_CAMERA, activeReel, normalizeStory } from './timeline.js';
import { OBJ_CUE } from './objectives.js';

function reelForWhen(story, when = 'start') {
  const s = normalizeStory(story);
  if (when === 'win') return s.reels.find((r) => r.when === 'win') || null;
  if (when === 'start') return s.reels.find((r) => r.when === 'start') || activeReel(s, 'intro');
  return s.reels.find((r) => r.id === when) || null;
}

function splashCovering() {
  return typeof document !== 'undefined' && !!document.getElementById('boot-splash');
}

function samePose(a, b) {
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) < 0.01
    && Math.abs(a.z - b.z) < 0.01
    && Math.abs((a.radius ?? 0) - (b.radius ?? 0)) < 0.01
    && Math.abs((a.alpha ?? 0) - (b.alpha ?? 0)) < 0.001;
}

function worldFromTile(field, tx, tz) {
  const half = field.worldHalfF ?? worldHalfFFromField(field);
  const halfZ = worldHalfZFFromField(field);
  return {
    x: (tx + 0.5) * TILE_SIZE_F - half,
    z: (tz + 0.5) * TILE_SIZE_F - halfZ,
  };
}

function skipEvent(e) {
  return e.code === 'Escape' || e.code === 'Enter';
}

function skipTarget(el) {
  return el?.closest?.('#side_menu, #header, #story-transport, #story-narration-bar, button, a, input, select, textarea, label');
}

/**
 * @param {{
 *   getCamera?: () => { setPose?: Function, easePose?: Function, stopFollow?: Function } | null,
 *   getField?: () => { worldHalfF?: number, width?: number } | null,
 *   getSpeakerPos?: (name: string) => { x: number, y: number, z: number } | null,
 *   worldToScreen?: (x: number, y: number, z: number) => { x: number, y: number } | null,
 *   host?: HTMLElement | null,
 *   onCinematic?: (playing: boolean) => void,
 *   onSpeak?: (lines: { id: string, name: string, text: string, color: string }[]) => void,
 * }} [opts]
 */
export function createMatchStory(opts = {}) {
  const hud = typeof document !== 'undefined'
    ? createStoryHud(opts.host ?? document.body)
    : { show() {}, hide() {}, setInset() {}, dispose() {} };
  hud.setInset?.({ zIndex: 20 });
  const speech = typeof document !== 'undefined'
    ? createStorySpeech({
      host: opts.host ?? document.body,
      worldToScreen: (...args) => opts.worldToScreen?.(...args) ?? null,
      getSpeakerPos: (name) => opts.getSpeakerPos?.(name) ?? null,
    })
    : { show() {}, hide() {}, tick() {}, dispose() {} };
  const transport = createStoryTransport(opts.host ?? (typeof document !== 'undefined' ? document.body : null));

  let player = null;
  let playing = false;
  /** Camera beats lock orders. A line-only beat does not. */
  let locking = false;
  let lastShot = null;
  let lastPose = null;
  /** Intro is armed at 00:00 and waiting for the splash to clear. */
  let heldForSplash = false;
  /** Clip ids already copied into chat for this reel. */
  const spokenSeen = new Set();

  function publishSpoken(lines) {
    const fresh = [];
    for (const line of lines) {
      const name = String(line?.speaker || '').trim();
      const text = String(line?.text || '').trim();
      if (!text) continue;
      const id = String(line.id || `${name}\0${text}`);
      if (spokenSeen.has(id)) continue;
      spokenSeen.add(id);
      if (!name) {
        fresh.push({ id, name: '', text, narration: true, color: '' });
        continue;
      }
      const look = LINE_STYLE_LOOK[line.style] || LINE_STYLE_LOOK.normal;
      fresh.push({ id, name, text, color: look.color });
    }
    if (fresh.length) opts.onSpeak?.(fresh);
  }

  function applySample(s) {
    const cam = opts.getCamera?.();
    const field = opts.getField?.();
    if (s?.camera && cam && field) {
      const shot = s.camera.id || `${s.camera.tx}|${s.camera.tz}|${s.camera.radius}`;
      const live = s.camera.char ? opts.getSpeakerPos?.(s.camera.char) : null;
      const tile = worldFromTile(field, s.camera.tx, s.camera.tz);
      const pose = {
        x: live?.x ?? tile.x,
        z: live?.z ?? tile.z,
        radius: s.camera.radius,
        alpha: s.camera.alpha,
      };
      // The sample is the camera, on the same tick as the line. An ease
      // lands about a second after the text that shares its time.
      if (shot !== lastShot || !samePose(lastPose, pose)) {
        if (shot !== lastShot) cam.stopFollow?.();
        lastShot = shot;
        lastPose = pose;
        cam.setPose?.(pose, { unclamped: true });
      }
    }
    const lines = s?.lines ?? (s?.line ? [s.line] : []);
    const narrated = narratorLines(lines);
    if (narrated.length) hud.show(narrated);
    else hud.hide();
    speech.show(lines);
    publishSpoken(lines);
  }

  function unbindSkip() {
    if (typeof window === 'undefined') return;
    window.removeEventListener('keydown', onKey, true);
  }

  function bindSkip() {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', onKey, true);
  }

  function stop() {
    if (!playing) return;
    const locked = locking;
    playing = false;
    locking = false;
    lastShot = null;
    lastPose = null;
    heldForSplash = false;
    unbindSkip();
    player?.stop();
    transport.detach();
    hud.hide();
    speech.hide();
    // Live sight ends with the reel. Buildings already seen stay as last-known.
    opts.onReveal?.(null);
    if (locked) opts.onCinematic?.(false);
  }

  function onKey(e) {
    if (!playing || skipTarget(e.target)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      e.stopPropagation();
      player?.toggle();
      return;
    }
    if (!skipEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();
    skip();
  }

  function skip() {
    if (!playing || !player) return;
    player.seek(player.duration());
    stop();
  }

  function playReel(story, when = 'start') {
    stop();
    if (!story) return false;
    const reel = reelForWhen(story, when);
    if (!reel?.clips?.length || !(reel.duration > 0)) return false;
    spokenSeen.clear();
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
    const walk = when !== 'start' && when !== 'win';
    locking = !walk || reel.clips.some((clip) => clip.kind === CLIP_CAMERA);
    // Share vision while this reel plays. Stopping drops live sight.
    opts.onReveal?.(reel.reveal ?? null);
    if (locking) {
      opts.onCinematic?.(true);
      transport.attach(player);
      bindSkip();
    }
    player.play();
    // The reel would otherwise burn its opening under the splash. Hold 00:00
    // until the map is actually on screen, then the line and the camera start together.
    if (when === 'start' && splashCovering()) {
      player.hold();
      heldForSplash = true;
    }
    return true;
  }

  function resume() {
    if (!heldForSplash) return;
    heldForSplash = false;
    if (playing && player) player.play();
  }

  function playCue(obj, story) {
    if (playing || obj?.kind !== OBJ_CUE) return false;
    const id = String(obj.params?.reel || '').trim();
    if (!id) return false;
    return playReel(story, id);
  }

  function playIntro(story) {
    return playReel(story, 'start');
  }

  function playWin(story) {
    return playReel(story, 'win');
  }

  function tick(deltaMs) {
    if (playing) player?.tick(deltaMs);
    speech.tick();
  }

  return {
    playIntro,
    resume,
    playWin,
    playCue,
    skip,
    stop,
    tick,
    driving: () => playing && locking,
    busy: () => playing,
  };
}
