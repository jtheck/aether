// Campaign pack - an ordered index of chapter gardens.
// Episodes are headings. Play walks the flattened chapter list.
// A bundle is that index plus the garden JSON, so the web build can
// import one file. `pk.files` on a garden is a copy of this order so a
// match can continue without fetching the index again.

export const CAMPAIGN_KIND = 'campaign';
export const CAMPAIGN_INDEX_VERSION = 1;
export const CAMPAIGN_INDEX_FILE = 'campaign.json';
export const PACK_SCHEME = 'pack:';

function safeGardenFile(file) {
  const s = String(file || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!s || s.includes('..') || s.startsWith('/') || /^[a-zA-Z]:/.test(s)) return '';
  if (!/\.garden$/i.test(s)) return '';
  if (s.split('/').some((part) => !part || part === '.' || part === '..')) return '';
  return s;
}

function clip(text, max) {
  return String(text || '').trim().slice(0, max);
}

/** @param {object | null | undefined} raw */
export function normalizeCampaignIndex(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.kind !== CAMPAIGN_KIND || !Array.isArray(raw.episodes)) return null;
  const episodes = [];
  let count = 0;
  for (let i = 0; i < raw.episodes.length && count < 64; i++) {
    const ep = raw.episodes[i];
    if (!ep || !Array.isArray(ep.chapters)) continue;
    const chapters = [];
    for (let c = 0; c < ep.chapters.length && count < 64; c++) {
      const ch = ep.chapters[c];
      const file = safeGardenFile(ch && ch.file);
      if (!file) continue;
      const chapter = { file, name: clip(ch && ch.name, 80) };
      if (ch && ch.live === false) chapter.live = false;
      chapters.push(chapter);
      count += 1;
    }
    if (!chapters.length) continue;
    episodes.push({
      name: clip(ep.name, 80) || 'Episode',
      theme: clip(ep.theme, 40),
      chapters,
    });
  }
  if (!episodes.length) return null;
  return {
    v: CAMPAIGN_INDEX_VERSION,
    kind: CAMPAIGN_KIND,
    name: clip(raw.name, 80) || 'Campaign',
    episodes,
  };
}

export function isCampaignIndex(raw) {
  return !!normalizeCampaignIndex(raw);
}

/** Index plus embedded gardens, one per chapter file - including chapters that are off. */
export function isCampaignBundle(raw) {
  const index = normalizeCampaignIndex(raw);
  if (!index || !raw.gardens || typeof raw.gardens !== 'object') return false;
  for (const ch of allCampaignChapters(index)) {
    const garden = raw.gardens[ch.file];
    if (!garden || typeof garden !== 'object' || !(garden.v | 0)) return false;
  }
  return true;
}

/**
 * @param {string} name
 * @param {{ name?: string, theme?: string, chapters: { file: string, name?: string }[] }[]} episodes
 */
export function campaignIndex(name, episodes) {
  return normalizeCampaignIndex({
    v: CAMPAIGN_INDEX_VERSION,
    kind: CAMPAIGN_KIND,
    name,
    episodes,
  });
}

function chapterRows(index) {
  const doc = normalizeCampaignIndex(index);
  if (!doc) return [];
  const out = [];
  for (const ep of doc.episodes) {
    for (const ch of ep.chapters) {
      out.push({
        file: ch.file,
        name: ch.name,
        episode: ep.name,
        theme: ep.theme,
        live: ch.live !== false,
      });
    }
  }
  return out;
}

/** Every chapter in the file, including ones switched off. */
export function allCampaignChapters(index) {
  return chapterRows(index);
}

/** Chapters players see. An episode with none of these is omitted. */
export function flattenCampaignChapters(index) {
  return chapterRows(index).filter((ch) => ch.live);
}

/**
 * Next live chapter after `file`. A chapter that is off is not a stop,
 * and finishing one continues at the next chapter that is on.
 * '' at the end or when `file` is unknown.
 */
export function nextChapterFile(index, file) {
  const chapters = chapterRows(index);
  const want = campaignFileOfRef(file) || safeGardenFile(file);
  if (!want) return '';
  const i = chapters.findIndex((ch) => ch.file === want || campaignFileOfRef(ch.file) === want);
  if (i < 0) return '';
  for (let j = i + 1; j < chapters.length; j++) {
    if (chapters[j].live) return chapters[j].file;
  }
  return '';
}

export function firstChapterFile(index) {
  return flattenCampaignChapters(index)[0]?.file || '';
}

/** `{ files }` stamped onto every chapter garden in the pack. */
export function packStamp(index) {
  const files = flattenCampaignChapters(index).map((ch) => ch.file);
  return files.length ? { files } : null;
}

export function packFilesOf(garden) {
  const files = garden?.pk?.files;
  if (!Array.isArray(files) || !files.length) return null;
  const out = [];
  for (const file of files) {
    const safe = safeGardenFile(file);
    if (safe) out.push(safe);
  }
  return out.length ? out : null;
}

/**
 * @param {object} index
 * @param {Record<string, object>} gardensByFile
 */
export function bundleCampaign(index, gardensByFile) {
  const doc = normalizeCampaignIndex(index);
  if (!doc) return null;
  const gardens = {};
  for (const ch of allCampaignChapters(doc)) {
    const garden = gardensByFile?.[ch.file];
    if (!garden || typeof garden !== 'object') return null;
    gardens[ch.file] = garden;
  }
  const stamp = packStamp(doc);
  if (stamp) {
    for (const file of Object.keys(gardens)) gardens[file] = { ...gardens[file], pk: stamp };
  }
  return { ...doc, gardens };
}

export function gardenFromBundle(bundle, file) {
  if (!bundle?.gardens || typeof bundle.gardens !== 'object') return null;
  const key = safeGardenFile(file) || campaignFileOfRef(file);
  const garden = key ? bundle.gardens[key] : null;
  return garden && typeof garden === 'object' ? garden : null;
}

export function parsePackRef(raw) {
  const text = String(raw || '').trim();
  if (!text.toLowerCase().startsWith(PACK_SCHEME)) return null;
  const file = safeGardenFile(text.slice(PACK_SCHEME.length));
  return file ? { file } : null;
}

export function formatPackRef(file) {
  const safe = safeGardenFile(file);
  return safe ? `${PACK_SCHEME}${safe}` : '';
}

/** Basename of a garden ref: `/maps/e1c1.garden`, `pack:e1c1.garden`, `workshop:9/e1c1.garden`. */
export function campaignFileOfRef(ref) {
  const text = String(ref || '').trim().replace(/\\/g, '/');
  const pack = text.toLowerCase().startsWith(PACK_SCHEME) ? text.slice(PACK_SCHEME.length) : text;
  const slash = pack.lastIndexOf('/');
  const base = slash >= 0 ? pack.slice(slash + 1) : pack;
  return safeGardenFile(base);
}
