import { CLIP_CAMERA, CLIP_LINE, normalizeReel } from '../story/timeline.js';

const MIN_WINDOW = 8;

function fmtTime(t) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(2).padStart(5, '0')}`;
}

export function createStorySheet({ onSeek, onSelect } = {}) {
  const el = document.createElement('div');
  el.id = 'story-sheet';
  el.innerHTML = `
    <div class="story-sheet-meta"><span id="story-time">0:00.00</span> / <span id="story-dur">0:00.00</span></div>
    <div id="story-ruler" class="story-ruler"></div>
    <div class="story-tracks">
      <div class="story-track-label">Cam</div>
      <div id="story-track-camera" class="story-track" data-track="camera"></div>
      <div class="story-track-label">Line</div>
      <div id="story-track-line" class="story-track" data-track="line"></div>
    </div>
    <div id="story-playhead" class="story-playhead"></div>
  `;

  const ruler = el.querySelector('#story-ruler');
  const camTrack = el.querySelector('#story-track-camera');
  const lineTrack = el.querySelector('#story-track-line');
  const playhead = el.querySelector('#story-playhead');
  const timeEl = el.querySelector('#story-time');
  const durEl = el.querySelector('#story-dur');

  function windowSec(reel) {
    return Math.max(MIN_WINDOW, reel.duration || 0, 0.001);
  }

  function eventTime(ev, reel) {
    const rect = ruler.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const w = rect.width || 1;
    return Math.max(0, Math.min(windowSec(reel), (x / w) * windowSec(reel)));
  }

  function bindScrub(node) {
    node.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      const reel = normalizeReel(el._reel);
      onSeek?.(eventTime(ev, reel));
      node.setPointerCapture(ev.pointerId);
    });
    node.addEventListener('pointermove', (ev) => {
      if (!node.hasPointerCapture?.(ev.pointerId) && !(ev.buttons & 1)) return;
      if (!(ev.buttons & 1)) return;
      const reel = normalizeReel(el._reel);
      onSeek?.(eventTime(ev, reel));
    });
  }

  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('pointermove', (e) => e.stopPropagation());
  el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

  bindScrub(ruler);
  bindScrub(camTrack);
  bindScrub(lineTrack);

  function renderTrack(track, clips, selectedId, reel) {
    track.innerHTML = '';
    const win = windowSec(reel);
    for (const clip of clips) {
      const block = document.createElement('button');
      block.type = 'button';
      block.className = 'story-clip' + (clip.id === selectedId ? ' active' : '');
      block.style.left = `${(clip.t / win) * 100}%`;
      block.style.width = `${Math.max(1.2, (clip.dur / win) * 100)}%`;
      if (clip.kind === CLIP_LINE) {
        block.textContent = clip.speaker || clip.text || 'line';
      } else if (Number.isFinite(clip.fromTx) && (clip.fromTx !== clip.tx || clip.fromTz !== clip.tz)) {
        block.textContent = `${clip.fromTx | 0},${clip.fromTz | 0}→${clip.tx | 0},${clip.tz | 0}`;
      } else {
        block.textContent = `${clip.tx | 0},${clip.tz | 0}`;
      }
      block.title = clip.kind === CLIP_LINE
        ? clip.text
        : Number.isFinite(clip.fromTx)
          ? `camera ${clip.fromTx},${clip.fromTz} → ${clip.tx},${clip.tz}`
          : `camera ${clip.tx},${clip.tz}`;
      block.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onSelect?.(clip.id);
        onSeek?.(clip.t);
      });
      track.appendChild(block);
    }
  }

  function render(rawReel, t, selectedId) {
    const reel = normalizeReel(rawReel);
    el._reel = reel;
    const win = windowSec(reel);
    timeEl.textContent = fmtTime(t);
    durEl.textContent = fmtTime(reel.duration);
    renderTrack(camTrack, reel.clips.filter((c) => c.kind === CLIP_CAMERA), selectedId, reel);
    renderTrack(lineTrack, reel.clips.filter((c) => c.kind === CLIP_LINE), selectedId, reel);
    const track = camTrack.getBoundingClientRect();
    const sheet = el.getBoundingClientRect();
    const x = track.width
      ? track.left - sheet.left + (Math.max(0, t) / win) * track.width
      : 0;
    playhead.style.left = `${x}px`;
  }

  function setOpen(on) {
    el.classList.toggle('open', !!on);
  }

  return { el, render, setOpen };
}
