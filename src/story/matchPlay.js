// In-match intro playback — same reel/player as Forge, no sheet.

import { TILE_SIZE_F, worldHalfFFromField, worldHalfZFFromField } from '../sim/field.js';
import { createStoryHud } from './hud.js';
import { createStoryPlayer } from './player.js';
import { createStorySpeech, LINE_STYLE_LOOK, narratorLines } from './speech.js';
import { createStoryTransport } from './transport.js';
import { activeReel, normalizeStory } from './timeline.js';

function reelForWhen(story, when = 'start') {
  const s = normalizeStory(story);
  if (when === 'win') return s.reels.find((r) => r.when === 'win') || null;
  return s.reels.find((r) => r.when === 'start') || activeReel(s, 'intro');
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
  let lastShot = null;
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
      if (shot !== lastShot) {
        lastShot = shot;
        const live = s.camera.char ? opts.getSpeakerPos?.(s.camera.char) : null;
        const tile = worldFromTile(field, s.camera.tx, s.camera.tz);
        const pose = {
          x: live?.x ?? tile.x,
          z: live?.z ?? tile.z,
          radius: s.camera.radius,
          alpha: s.camera.alpha,
        };
        cam.stopFollow?.();
        if (cam.easePose) cam.easePose(pose, { unclamped: true });
        else cam.setPose?.(pose, { unclamped: true });
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
    playing = false;
    lastShot = null;
    unbindSkip();
    player?.stop();
    transport.detach();
    hud.hide();
    speech.hide();
    // Drop any cinematic vision share when the reel ends or is skipped.
    opts.onReveal?.(null);
    opts.onCinematic?.(false);
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
    // Share vision with the reel's factions so spawns / distant action read on camera.
    opts.onReveal?.(reel.reveal ?? null);
    opts.onCinematic?.(true);
    transport.attach(player);
    bindSkip();
    player.play();
    return true;
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
    playWin,
    skip,
    stop,
    tick,
    driving: () => playing,
  };
}
