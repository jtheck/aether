// World-anchored dialogue at a unit. Narrator lines stay on the HUD bar.

import { CHAT_KEEP } from './timeline.js';

export const LINE_STYLE_LOOK = Object.freeze({
  normal: { size: '15px', color: '#fff6d9' },
  shout: { size: '20px', color: '#ff734d' },
  whisper: { size: '12px', color: '#b3b3cc' },
  think: { size: '14px', color: '#99d6ff' },
  command: { size: '18px', color: '#ffd933' },
  scared: { size: '15px', color: '#e68cff' },
});

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function spokenLines(input) {
  const list = Array.isArray(input) ? input : input ? [input] : [];
  return list
    .filter((line) => String(line?.speaker || '').trim() && String(line?.text || '').trim())
    .slice(-CHAT_KEEP);
}

/**
 * @param {{
 *   host?: HTMLElement,
 *   worldToScreen?: (x: number, y: number, z: number) => { x: number, y: number } | null,
 *   getSpeakerPos?: (name: string) => { x: number, y: number, z: number } | null,
 * }} [opts]
 */
export function createStorySpeech(opts = {}) {
  const canDom = typeof document !== 'undefined';
  const host = opts.host ?? (canDom ? document.body : null);
  let layer = null;
  /** @type {{ id: string, speaker: string, text: string, style: string }[]} */
  let lines = [];

  if (canDom && host) {
    layer = host.querySelector('#story-speech-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'story-speech-layer';
      layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:18;';
      host.appendChild(layer);
    }
  }

  function tick() {
    if (!layer) return;
    layer.replaceChildren();
    if (!lines.length) {
      layer.style.display = 'none';
      return;
    }
    let any = false;
    for (const line of lines) {
      const pos = opts.getSpeakerPos?.(line.speaker);
      const scr = pos && opts.worldToScreen?.(pos.x, pos.y, pos.z);
      if (!scr) continue;
      any = true;
      const look = LINE_STYLE_LOOK[line.style] || LINE_STYLE_LOOK.normal;
      const el = document.createElement('div');
      el.style.cssText = [
        'position:absolute',
        `left:${Math.round(scr.x)}px`,
        `top:${Math.round(scr.y)}px`,
        'transform:translate(-50%,-110%)',
        'max-width:240px',
        'text-align:center',
        'text-shadow:0 1px 3px #000',
      ].join(';');
      el.innerHTML =
        `<div style="font-size:11px;font-weight:700;color:#fc4;margin-bottom:2px">${esc(line.speaker)}</div>` +
        `<div style="font-size:${look.size};color:${look.color};line-height:1.3">${esc(line.text)}</div>`;
      layer.appendChild(el);
    }
    layer.style.display = any ? 'block' : 'none';
  }

  return {
    show(input) {
      lines = spokenLines(input);
      tick();
    },
    tick,
    hide() {
      lines = [];
      if (layer) {
        layer.replaceChildren();
        layer.style.display = 'none';
      }
    },
    dispose() {
      lines = [];
      layer?.remove();
      layer = null;
    },
  };
}

export function narratorLines(input) {
  const list = Array.isArray(input) ? input : input ? [input] : [];
  return list.filter((line) => !String(line?.speaker || '').trim() && String(line?.text || '').trim());
}
