const STYLE_SIZE = {
  normal: '16px',
  shout: '20px',
  whisper: '13px',
  think: '15px',
  command: '18px',
  scared: '16px',
};

import { CHAT_KEEP } from './timeline.js';

export { CHAT_KEEP };

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function asList(input) {
  if (Array.isArray(input)) return input;
  if (input && Array.isArray(input.lines)) return input.lines;
  if (input && (input.text || input.speaker)) return [input];
  return [];
}

function rowHtml(line, faded) {
  const size = faded ? '13px' : (STYLE_SIZE[line.style] || STYLE_SIZE.normal);
  const color = faded ? '#bbb' : '#eee';
  const speaker = line.speaker
    ? `<div style="font-size:11px;font-weight:700;color:${faded ? '#b94' : '#fc4'};margin-bottom:2px">${esc(line.speaker)}</div>`
    : '';
  return (
    `<div style="opacity:${faded ? 0.55 : 1};margin-top:${faded ? '8px' : '10px'}">` +
    speaker +
    `<div style="font-size:${size};color:${color};line-height:1.45;text-shadow:0 1px 2px rgba(0,0,0,.95),0 0 14px rgba(0,0,0,.7)">${esc(line.text)}</div>` +
    `</div>`
  );
}

const VEIL_STYLE = [
  'background:radial-gradient(ellipse at center, rgba(0,0,0,.55) 0%, rgba(0,0,0,.2) 46%, rgba(0,0,0,0) 74%)',
  'padding:48px 12px 40px',
].join(';');

/** Centered narration. Soft falloff, no hard plate edge. */
export function createStoryHud(host = document.body) {
  let bar = host.querySelector('#story-narration-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'story-narration-bar';
    bar.style.cssText = [
      'position:fixed',
      'left:50%',
      'top:58%',
      'transform:translate(-50%,-50%)',
      'width:min(540px, 68vw)',
      'z-index:20',
      'pointer-events:none',
      'display:none',
      'text-align:center',
      'user-select:none',
      '-webkit-user-select:none',
    ].join(';');
    host.appendChild(bar);
  }

  return {
    show(input) {
      const visible = asList(input)
        .filter((line) => String(line?.text || '').trim())
        .slice(-CHAT_KEEP);
      if (!visible.length) {
        bar.style.display = 'none';
        bar.innerHTML = '';
        return;
      }
      const rows = visible.map((line, i) => rowHtml(line, i < visible.length - 1)).join('');
      bar.innerHTML = `<div style="${VEIL_STYLE}">${rows}</div>`;
      bar.style.display = 'block';
    },
    setOffset(bottomPx) {
      bar.style.bottom = `${bottomPx}px`;
    },
    setInset({ left, right, bottom, zIndex } = {}) {
      if (left != null) bar.style.left = typeof left === 'number' ? `${left}px` : left;
      if (right != null) bar.style.right = typeof right === 'number' ? `${right}px` : right;
      if (bottom != null) bar.style.bottom = typeof bottom === 'number' ? `${bottom}px` : bottom;
      if (zIndex != null) bar.style.zIndex = String(zIndex);
    },
    hide() {
      bar.style.display = 'none';
    },
    dispose() {
      bar.remove();
    },
  };
}
