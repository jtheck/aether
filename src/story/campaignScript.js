// Campaign → Fountain / HTML screenplay. Reads the episode manifest and the
// grove prologue reels; no garden build required.

import { CLIP_CAMERA, CLIP_HOLD, CLIP_LINE } from './timeline.js';
import { EPISODES } from './campaign.js';
import { chapter1IntroReel, chapter1WinReel } from './chapter1.js';
import { chapter2IntroReel, chapter2WinReel } from './chapter2.js';
import { chapter3IntroReel, chapter3WinReel } from './chapter3.js';

const ACTION_WIDTH = 60;
const DIALOGUE_WIDTH = 36;
const CHAR_PAD = 22;
const PAREN_PAD = 16;
const DIALOGUE_PAD = 10;
const TRANS_PAD = 40;

const STYLE_PAREN = {
  shout: 'shouting',
  whisper: 'whispering',
  think: 'quietly, to himself',
  command: 'commanding',
  scared: 'scared',
};

const THEME_SLUG = {
  siege: 'EXT. THE BURNING KEEP',
  volcano: 'EXT. ASHFALL',
  ice: 'EXT. THE ICE WALL',
  muster: 'EXT. THE MUSTER PLAIN',
  cataclysm: 'EXT. THE LAST FIELD',
  grove: 'EXT. THE ANCIENT GROVE',
};

function pad(n) {
  return ' '.repeat(n);
}

function wrap(text, width) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && next.length > width) {
      lines.push(cur);
      cur = word;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function sceneHeading(theme, chapterName, later = false) {
  const where = THEME_SLUG[theme] || 'EXT. THE FIELD';
  const title = String(chapterName || '').toUpperCase();
  return later ? `${where} - ${title} - LATER` : `${where} - ${title}`;
}

function cameraBeat(step) {
  const who = String(step.char || '').trim();
  const close = Number(step.radius) > 0 && Number(step.radius) < 100;
  if (who) return { kind: 'camera', text: `ANGLE ON ${who.toUpperCase()}.` };
  if (close) return { kind: 'camera', text: 'The camera finds them — closer now.' };
  return { kind: 'camera', text: 'The camera takes the field. Wide.' };
}

function stepBeats(steps) {
  const out = [];
  for (const step of steps || []) {
    if (!step) continue;
    if (step.kind === CLIP_CAMERA) {
      out.push(cameraBeat(step));
    } else if (step.kind === CLIP_HOLD) {
      out.push({ kind: 'beat', text: 'A beat.' });
    } else if (step.kind === CLIP_LINE) {
      const speaker = String(step.speaker || '').trim();
      const text = String(step.text || '').trim();
      if (!text) continue;
      if (speaker) {
        out.push({
          kind: 'dialogue',
          speaker,
          text,
          style: step.style || 'normal',
          paren: STYLE_PAREN[step.style] || '',
        });
      } else {
        out.push({ kind: 'action', text });
      }
    }
  }
  return out;
}

function playFromObjectives(objectives) {
  const items = (objectives || []).map((o) => ({
    verb: String(o.label || o.kind || '').toUpperCase(),
    note: String(o.message || '').trim(),
  }));
  return items.length ? { kind: 'play', items } : null;
}

function chapterBeats(episodeName, episodeN, indexInEpisode, def) {
  const chapterNo = `${episodeN}.${indexInEpisode}`;
  const beats = [
    { kind: 'transition', text: 'FADE IN:' },
    { kind: 'scene', text: sceneHeading(def.theme, def.name) },
    { kind: 'action', text: `EPISODE ${episodeN}: ${episodeName}. CHAPTER ${chapterNo} — ${def.name}.` },
    ...stepBeats(def.intro),
  ];
  const play = playFromObjectives(def.objectives);
  if (play) {
    beats.push({ kind: 'transition', text: 'CUT TO:' });
    beats.push(play);
  }
  beats.push({ kind: 'transition', text: 'CUT TO:' });
  beats.push({ kind: 'scene', text: sceneHeading(def.theme, def.name, true), later: true });
  beats.push(...stepBeats(def.win));
  beats.push({ kind: 'transition', text: 'FADE OUT.' });
  return beats;
}

function groveAct() {
  const chapters = [
    { id: 'grove-1', name: 'The Grove', intro: chapter1IntroReel(), win: chapter1WinReel(), play: 'REACH the old road north.' },
    { id: 'grove-2', name: 'The Ridge', intro: chapter2IntroReel(), win: chapter2WinReel(), play: 'TAKE the north ridge.' },
    { id: 'grove-3', name: 'Clean Ground', intro: chapter3IntroReel(), win: chapter3WinReel(), play: 'REACH the clean hollow.' },
  ];
  return {
    id: 'prologue',
    n: 0,
    name: 'Prologue',
    theme: 'grove',
    chapters: chapters.map((ch, i) => ({
      id: ch.id,
      name: ch.name,
      index: i + 1,
      beats: [
        ...(i === 0
          ? [
            { kind: 'transition', text: 'FADE IN:' },
            { kind: 'scene', text: 'EXT. THE ANCIENT GROVE - PROLOGUE' },
            { kind: 'action', text: 'Before the siege. The party is still only four, and the woods are already dying.' },
          ]
          : []),
        { kind: 'scene', text: sceneHeading('grove', ch.name) },
        ...stepBeats(ch.intro.clips),
        { kind: 'transition', text: 'CUT TO:' },
        { kind: 'play', items: [{ verb: '', note: ch.play }] },
        { kind: 'transition', text: 'CUT TO:' },
        { kind: 'scene', text: sceneHeading('grove', ch.name, true), later: true },
        ...stepBeats(ch.win.clips),
        ...(i === chapters.length - 1 ? [{ kind: 'transition', text: 'FADE OUT.' }] : []),
      ],
    })),
  };
}

/** Structured screenplay used by both Fountain and HTML renderers. */
export function campaignScriptDocument() {
  const acts = [groveAct()];
  for (const ep of EPISODES) {
    acts.push({
      id: `ep${ep.n}`,
      n: ep.n,
      name: ep.name,
      theme: ep.theme,
      chapters: ep.chapters.map((def, idx) => ({
        id: def.id,
        name: def.name,
        index: idx + 1,
        beats: chapterBeats(ep.name, ep.n, idx + 1, def),
      })),
    });
  }
  return {
    title: 'AETHER',
    credit: 'a campaign in five episodes',
    author: 'the party',
    date: new Date().toISOString().slice(0, 10),
    notes: [
      'Generated from the adventure manifest. Spoken lines are as authored.',
      'PLAY slugs are the live chapter objectives.',
    ],
    acts,
  };
}

function fountainPlay(beat) {
  const bits = (beat.items || []).map((item) => (
    item.verb && item.note ? `${item.verb} — ${item.note}` : (item.verb || item.note)
  ));
  const joined = bits.join(' ');
  if (joined.startsWith('REACH') || joined.startsWith('TAKE')) {
    return [`PLAY. ${joined}`, ''];
  }
  return ['PLAY.', '', wrap(joined, ACTION_WIDTH).join('\n'), ''];
}

function fountainBeats(beats) {
  const out = [];
  for (const beat of beats || []) {
    if (beat.kind === 'transition') {
      out.push(`${pad(TRANS_PAD)}${beat.text}`, '');
    } else if (beat.kind === 'scene') {
      out.push(beat.text, '');
    } else if (beat.kind === 'action' || beat.kind === 'camera' || beat.kind === 'beat') {
      out.push(wrap(beat.text, ACTION_WIDTH).join('\n'), '');
    } else if (beat.kind === 'dialogue') {
      out.push(`${pad(CHAR_PAD)}${beat.speaker.toUpperCase()}`);
      if (beat.paren) out.push(`${pad(PAREN_PAD)}(${beat.paren})`);
      for (const row of wrap(beat.text, DIALOGUE_WIDTH)) {
        out.push(`${pad(DIALOGUE_PAD)}${row}`);
      }
      out.push('');
    } else if (beat.kind === 'play') {
      out.push(...fountainPlay(beat));
    }
  }
  return out;
}

/** Fountain / screenplay text for the grove prologue + five-episode campaign. */
export function renderCampaignScript(doc = campaignScriptDocument()) {
  const lines = [
    'Title:',
    `\t${doc.title}`,
    '',
    'Credit:',
    `\t${doc.credit}`,
    '',
    'Author:',
    `\t${doc.author}`,
    '',
    'Draft date:',
    `\t${doc.date}`,
    '',
    'Notes:',
    ...doc.notes.map((n) => `\t${n}`),
    '',
    '',
    '===',
    '',
  ];
  for (const act of doc.acts) {
    if (act.n > 0) {
      lines.push(`# EPISODE ${act.n}`, '', wrap(`${act.name.toUpperCase()}.`, ACTION_WIDTH).join('\n'), '');
    }
    for (const ch of act.chapters) lines.push(...fountainBeats(ch.beats));
  }
  lines.push(`${pad(TRANS_PAD)}THE END`, '');
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function speakerClass(name) {
  const key = String(name || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  return key ? `who-${key}` : '';
}

function htmlBeats(beats) {
  const out = [];
  for (const beat of beats || []) {
    if (beat.kind === 'transition') {
      out.push(`<p class="trans">${esc(beat.text)}</p>`);
    } else if (beat.kind === 'scene') {
      out.push(`<h4 class="slug${beat.later ? ' later' : ''}">${esc(beat.text)}</h4>`);
    } else if (beat.kind === 'action') {
      out.push(`<p class="action">${esc(beat.text)}</p>`);
    } else if (beat.kind === 'camera') {
      out.push(`<p class="camera">${esc(beat.text)}</p>`);
    } else if (beat.kind === 'beat') {
      out.push(`<p class="beat">${esc(beat.text)}</p>`);
    } else if (beat.kind === 'dialogue') {
      const who = speakerClass(beat.speaker);
      out.push('<div class="line">');
      out.push(`<div class="who ${who}">${esc(beat.speaker.toUpperCase())}</div>`);
      if (beat.paren) out.push(`<div class="paren">(${esc(beat.paren)})</div>`);
      out.push(`<p class="said">${esc(beat.text)}</p>`);
      out.push('</div>');
    } else if (beat.kind === 'play') {
      out.push('<div class="play">');
      out.push('<div class="play-label">PLAY</div>');
      out.push('<ul>');
      for (const item of beat.items || []) {
        const verb = item.verb ? `<b>${esc(item.verb)}</b>` : '';
        const note = item.note ? esc(item.note) : '';
        out.push(`<li>${verb}${verb && note ? ' — ' : ''}${note}</li>`);
      }
      out.push('</ul>');
      out.push('</div>');
    }
  }
  return out.join('\n');
}

const HTML_CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font: 16px/1.45 Georgia, "Times New Roman", serif;
  color: #e8e2d4;
  background: #16140f;
}
a { color: inherit; }
nav {
  position: sticky; top: 0; z-index: 2;
  background: #16140f;
  border-bottom: 1px solid #3a3428;
  padding: 10px 18px 12px;
}
nav strong { display: block; letter-spacing: .12em; font: 700 12px/1.2 sans-serif; color: #c9a227; }
nav ol { display: flex; flex-wrap: wrap; gap: 8px 18px; margin: 8px 0 0; padding: 0; list-style: none; }
nav a { font: 600 13px/1.2 sans-serif; color: #d8c9a0; text-decoration: none; }
nav a:hover { color: #fff; }
main { max-width: 720px; margin: 0 auto; padding: 28px 20px 80px; }
.title { text-align: center; margin: 36px 0 48px; }
.title h1 { font: 700 42px/1.1 Georgia, serif; letter-spacing: .08em; margin: 0 0 8px; }
.title p { margin: 0; color: #9a907c; font-style: italic; }
.act { margin: 56px 0 0; }
.act > h2 {
  font: 700 13px/1.2 sans-serif;
  letter-spacing: .16em;
  color: #c9a227;
  border-top: 1px solid #3a3428;
  padding-top: 18px;
}
.chapter { margin: 36px 0 56px; }
.chapter > h3 { font: 700 22px/1.2 Georgia, serif; margin: 0 0 18px; }
.slug {
  font: 700 14px/1.35 sans-serif;
  letter-spacing: .04em;
  color: #f2ead2;
  margin: 22px 0 10px;
}
.slug.later { color: #b7ae96; }
.action { margin: 10px 0; color: #e8e2d4; }
.camera { margin: 10px 0; color: #8fa8b8; font-style: italic; }
.beat { margin: 10px 0; color: #7a7366; font-style: italic; }
.trans { text-align: right; color: #7a7366; font: 600 12px/1.2 sans-serif; letter-spacing: .08em; margin: 22px 0; }
.line { margin: 18px auto; max-width: 22em; text-align: center; }
.who { font: 700 13px/1.2 sans-serif; letter-spacing: .08em; color: #c9a227; }
.who-lady { color: #c9b4de; }
.who-doc { color: #8eb4d4; }
.who-goblin { color: #d47a5a; }
.who-stumpey { color: #d4b84a; }
.paren { color: #8a8374; font: italic 13px/1.3 Georgia, serif; margin-top: 2px; }
.said { margin: 4px 0 0; }
.play {
  margin: 20px 0;
  padding: 12px 14px;
  border: 1px solid #5a4a1e;
  background: #241e10;
}
.play-label { font: 700 12px/1 sans-serif; letter-spacing: .14em; color: #c9a227; }
.play ul { margin: 8px 0 0; padding: 0 0 0 1.1em; }
.play li { margin: 4px 0; }
.play b { color: #f2ead2; }
.end { text-align: center; margin: 64px 0 24px; letter-spacing: .2em; color: #c9a227; font: 700 14px/1 sans-serif; }
`.trim();

/** Standalone HTML reading copy of the same screenplay. */
export function renderCampaignScriptHtml(doc = campaignScriptDocument()) {
  const nav = ['<nav><strong>AETHER</strong><ol>'];
  const body = [];
  body.push(`<header class="title"><h1>${esc(doc.title)}</h1><p>${esc(doc.credit)}</p></header>`);
  for (const act of doc.acts) {
    const actTitle = act.n > 0 ? `Episode ${act.n} · ${act.name}` : act.name;
    nav.push(`<li><a href="#${esc(act.id)}">${esc(actTitle)}</a></li>`);
    body.push(`<section class="act" id="${esc(act.id)}"><h2>${esc(actTitle.toUpperCase())}</h2>`);
    for (const ch of act.chapters) {
      const label = act.n > 0 ? `${act.n}.${ch.index} ${ch.name}` : ch.name;
      body.push(`<article class="chapter" id="${esc(ch.id)}">`);
      body.push(`<h3>${esc(label)}</h3>`);
      body.push(htmlBeats(ch.beats));
      body.push('</article>');
    }
    body.push('</section>');
  }
  nav.push('</ol></nav>');
  body.push('<p class="end">THE END</p>');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)}</title>
<style>
${HTML_CSS}
</style>
</head>
<body>
${nav.join('\n')}
<main>
${body.join('\n')}
</main>
</body>
</html>
`;
}
