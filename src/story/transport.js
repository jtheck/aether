// Standard playhead bar for in-match cinematics.

export function formatStoryTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = (s / 60) | 0;
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function rateLabel(rate) {
  const n = Number(rate) || 0;
  if (n === 0) return 'paused';
  if (n < 0) return `${n}×`;
  if (n > 4) return 'skip';
  return `${n}×`;
}

function btn(label, title, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = label;
  el.title = title;
  el.style.cssText = [
    'min-width:22px',
    'height:22px',
    'padding:0 5px',
    'border:0',
    'border-radius:5px',
    'background:#222',
    'color:#eee',
    'font:11px/1 sans-serif',
    'cursor:pointer',
  ].join(';');
  el.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  return el;
}

/**
 * @param {HTMLElement | null} [host]
 */
export function createStoryTransport(host = typeof document !== 'undefined' ? document.body : null) {
  const canDom = typeof document !== 'undefined' && host;
  let root = null;
  let playBtn = null;
  let scrub = null;
  let timeEl = null;
  let rateEl = null;
  let player = null;
  let unsub = null;

  if (canDom) {
    root = host.querySelector('#story-transport');
    if (!root) {
      root = document.createElement('div');
      root.id = 'story-transport';
      host.appendChild(root);
    }
    root.style.cssText = [
      'position:fixed',
      'right:8px',
      'bottom:112px',
      'z-index:10002',
      'display:none',
      'flex-direction:column',
      'align-items:stretch',
      'gap:3px',
      'width:148px',
      'padding:5px 6px',
      'border-radius:8px',
      'background:rgba(0,0,0,.72)',
      'pointer-events:auto',
      'user-select:none',
    ].join(';');
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:3px';
    const startBtn = btn('|<', 'To start', () => player?.toStart());
    const rewBtn = btn('<<', 'Slower', () => player?.rewind());
    playBtn = btn('Play', 'Play / pause', () => player?.toggle());
    const ffBtn = btn('>>', 'Faster', () => player?.fastForward());
    const endBtn = btn('>|', 'Skip to end', () => player?.skipForward());
    controls.append(startBtn, rewBtn, playBtn, ffBtn, endBtn);

    scrub = document.createElement('input');
    scrub.type = 'range';
    scrub.min = '0';
    scrub.max = '1000';
    scrub.value = '0';
    scrub.style.cssText = 'width:100%;accent-color:#fc4;height:14px;margin:0';
    scrub.addEventListener('pointerdown', (e) => e.stopPropagation());
    scrub.addEventListener('input', () => {
      if (!player) return;
      const dur = player.duration();
      player.seek((Number(scrub.value) / 1000) * dur);
    });

    timeEl = document.createElement('span');
    timeEl.style.cssText = 'font:11px/1 sans-serif;color:#ddd';
    rateEl = document.createElement('span');
    rateEl.style.cssText = 'font:11px/1 sans-serif;color:#fc4';
    const meta = document.createElement('div');
    meta.style.cssText = 'display:flex;justify-content:space-between;gap:8px';
    meta.append(timeEl, rateEl);

    root.replaceChildren(controls, scrub, meta);
    root.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  function paint() {
    if (!root) return;
    if (!player) {
      root.style.display = 'none';
      return;
    }
    const t = player.time();
    const dur = player.duration();
    const rate = player.rate();
    if (playBtn) playBtn.textContent = rate === 1 ? 'Pause' : 'Play';
    if (scrub && document.activeElement !== scrub) {
      scrub.value = String(dur > 0 ? Math.round((t / dur) * 1000) : 0);
    }
    if (timeEl) timeEl.textContent = `${formatStoryTime(t)} / ${formatStoryTime(dur)}`;
    if (rateEl) rateEl.textContent = rateLabel(rate);
    root.style.display = 'flex';
  }

  return {
    attach(next) {
      unsub?.();
      unsub = null;
      player = next || null;
      if (player?.subscribe) unsub = player.subscribe(() => paint());
      paint();
    },
    detach() {
      unsub?.();
      unsub = null;
      player = null;
      paint();
    },
    refresh: paint,
    dispose() {
      unsub?.();
      root?.remove();
      root = null;
      player = null;
    },
  };
}
