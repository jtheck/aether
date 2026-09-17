'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const GARDEN_VERSION_MIN = 3;
const GARDEN_VERSION_MAX = 4;
const MAX_GARDEN_BYTES = 2 * 1024 * 1024;
const MAX_GARDENS = 64;
const MAX_WALK_DEPTH = 3;

const ITEM_STATE = {
  Subscribed: 1,
  LegacyItem: 2,
  Installed: 4,
  NeedsUpdate: 8,
  Downloading: 16,
  DownloadPending: 32,
};

function itemIdString(id) {
  if (id == null) return '';
  if (typeof id === 'bigint') return id.toString(10);
  const s = String(id).trim();
  return /^\d{1,20}$/.test(s) ? s : '';
}

function toPublishedFileId(id) {
  const s = itemIdString(id);
  if (!s) return null;
  try {
    return BigInt(s);
  } catch (_err) {
    return null;
  }
}

function parseWorkshopId(raw) {
  return itemIdString(raw);
}

function normalizeGardenRel(file) {
  const s = String(file || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!s || s.includes('..') || s.startsWith('/') || /^[a-zA-Z]:/.test(s)) return '';
  if (!/\.garden$/i.test(s)) return '';
  if (s.split('/').some((part) => !part || part === '.' || part === '..')) return '';
  return s;
}

function resolveInside(folder, rel) {
  if (!folder) return null;
  const root = path.resolve(String(folder));
  const file = normalizeGardenRel(rel);
  if (!file) return null;
  const full = path.resolve(root, file);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (full !== root && !full.startsWith(prefix)) return null;
  return full;
}

function peekGardenMeta(text) {
  if (typeof text !== 'string') return { ok: false, error: 'invalid garden' };
  if (Buffer.byteLength(text, 'utf8') > MAX_GARDEN_BYTES) {
    return { ok: false, error: 'garden too large' };
  }
  var data;
  try {
    data = JSON.parse(text);
  } catch (_err) {
    return { ok: false, error: 'invalid json' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'invalid garden' };
  }
  var version = data.v | 0;
  if (version < GARDEN_VERSION_MIN || version > GARDEN_VERSION_MAX) {
    return { ok: false, error: 'unsupported garden version' };
  }
  var width = data.w | 0;
  var height = data.h | 0;
  if (width < 1 || height < 1) return { ok: false, error: 'invalid garden size' };
  var name = '';
  if (typeof data.n === 'string') name = data.n;
  else if (typeof data.name === 'string') name = data.name;
  return { ok: true, garden: data, name: name, version: version, width: width, height: height };
}

function walkGardenRels(folder, fsImpl) {
  var io = fsImpl || fs;
  var out = [];
  function walk(dir, prefix, depth) {
    if (depth > MAX_WALK_DEPTH || out.length >= MAX_GARDENS) return;
    var entries;
    try {
      entries = io.readdirSync(dir, { withFileTypes: true });
    } catch (_err) {
      return;
    }
    for (var i = 0; i < entries.length; i++) {
      var ent = entries[i];
      var rel = prefix ? prefix + '/' + ent.name : ent.name;
      if (ent.isDirectory()) {
        walk(path.join(dir, ent.name), rel.replace(/\\/g, '/'), depth + 1);
      } else if (ent.isFile() && /\.garden$/i.test(ent.name)) {
        out.push(rel.replace(/\\/g, '/'));
      }
    }
  }
  if (folder) walk(path.resolve(String(folder)), '', 0);
  return out.sort();
}

function pickDefaultGarden(files) {
  var list = (files || []).map(function (f) {
    return typeof f === 'string' ? f : (f && f.file) || '';
  }).filter(Boolean);
  if (list.indexOf('map.garden') >= 0) return 'map.garden';
  var maps = list.filter(function (f) { return f.indexOf('maps/') === 0; }).sort();
  if (maps.length) return maps[0];
  var sorted = list.slice().sort();
  return sorted[0] || '';
}

function describeInstall(folder, fsImpl) {
  var io = fsImpl || fs;
  var rels = walkGardenRels(folder, io);
  var gardens = [];
  for (var i = 0; i < rels.length; i++) {
    var rel = rels[i];
    var full = resolveInside(folder, rel);
    if (!full) continue;
    var text;
    try {
      text = io.readFileSync(full, 'utf8');
    } catch (_err) {
      continue;
    }
    var meta = peekGardenMeta(text);
    if (!meta.ok) continue;
    gardens.push({
      file: rel,
      name: meta.name || rel.replace(/\.garden$/i, ''),
    });
  }
  return gardens;
}

function readGardenFile(folder, rel, fsImpl) {
  var io = fsImpl || fs;
  var file = normalizeGardenRel(rel) || pickDefaultGarden(walkGardenRels(folder, io));
  if (!file) return { ok: false, error: 'no garden in item' };
  var full = resolveInside(folder, file);
  if (!full) return { ok: false, error: 'invalid garden path' };
  var stat;
  try {
    stat = io.statSync(full);
  } catch (_err) {
    return { ok: false, error: 'garden missing' };
  }
  if (!stat || !stat.isFile() || stat.size > MAX_GARDEN_BYTES) {
    return { ok: false, error: 'garden missing' };
  }
  var text;
  try {
    text = io.readFileSync(full, 'utf8');
  } catch (_err) {
    return { ok: false, error: 'garden missing' };
  }
  var meta = peekGardenMeta(text);
  if (!meta.ok) return meta;
  return { ok: true, garden: meta.garden, file: file, name: meta.name };
}

function itemFlags(state) {
  var s = state | 0;
  return {
    subscribed: !!(s & ITEM_STATE.Subscribed),
    installed: !!(s & ITEM_STATE.Installed),
    needsUpdate: !!(s & ITEM_STATE.NeedsUpdate),
    downloading: !!(s & ITEM_STATE.Downloading) || !!(s & ITEM_STATE.DownloadPending),
  };
}

function listSubscribedMaps(workshop, opts) {
  opts = opts || {};
  var scan = opts.scanInstall || describeInstall;
  if (!workshop || typeof workshop.getSubscribedItems !== 'function') return [];
  var rawIds;
  try {
    rawIds = workshop.getSubscribedItems() || [];
  } catch (_err) {
    return [];
  }
  if (!Array.isArray(rawIds)) {
    rawIds = rawIds && typeof rawIds.length === 'number' ? Array.from(rawIds) : [];
  }
  var items = [];
  for (var i = 0; i < rawIds.length; i++) {
    var id = itemIdString(rawIds[i]);
    if (!id) continue;
    var published = toPublishedFileId(id);
    var state = 0;
    if (published != null && typeof workshop.getItemState === 'function') {
      try { state = workshop.getItemState(published) | 0; } catch (_errState) { state = 0; }
    }
    var flags = itemFlags(state);
    var gardens = [];
    if (flags.installed && published != null && typeof workshop.getItemInstallInfo === 'function') {
      try {
        var info = workshop.getItemInstallInfo(published);
        if (info && info.folder) gardens = scan(info.folder, opts.fs);
      } catch (_errInfo) { /* ignore */ }
    } else if (flags.subscribed && !flags.downloading && typeof workshop.downloadItem === 'function' && published != null) {
      try { workshop.downloadItem(published, false); } catch (_errDl) { /* ignore */ }
    }
    var title = '';
    if (gardens.length) title = gardens[0].name || '';
    items.push({
      id: id,
      title: title,
      installed: flags.installed,
      downloading: flags.downloading,
      needsUpdate: flags.needsUpdate,
      gardens: gardens,
    });
  }
  return items;
}

function loadSubscribedGarden(workshop, id, file, opts) {
  opts = opts || {};
  var published = toPublishedFileId(id);
  if (!published || !workshop || typeof workshop.getItemInstallInfo !== 'function') {
    return { ok: false, error: 'not installed' };
  }
  var info;
  try {
    info = workshop.getItemInstallInfo(published);
  } catch (_err) {
    return { ok: false, error: 'not installed' };
  }
  if (!info || !info.folder) return { ok: false, error: 'not installed' };
  var result = readGardenFile(info.folder, file, opts.fs);
  if (!result.ok) return result;
  result.id = itemIdString(id);
  return result;
}

function workshopOverlayUrl(dialog, appId) {
  var raw = String(dialog || '').trim();
  var id = appId | 0;
  if (raw.toLowerCase() === 'workshop') {
    return id > 0 ? 'https://steamcommunity.com/app/' + id + '/workshop/' : '';
  }
  if (raw.toLowerCase() === 'workshop-legal') {
    return 'https://steamcommunity.com/sharedfiles/workshoplegalagreement';
  }
  var m = /^workshop:(\d{1,20})$/i.exec(raw);
  if (m) return 'https://steamcommunity.com/sharedfiles/filedetails/?id=' + m[1];
  return '';
}

function nextFromObjective(raw) {
  if (Array.isArray(raw)) return String(raw[5] || '').trim();
  if (raw && typeof raw === 'object') return String(raw.next || '').trim();
  return '';
}

function workshopTagsForGarden(garden) {
  var objs = [];
  if (Array.isArray(garden && garden.objectives)) objs = garden.objectives;
  else if (Array.isArray(garden && garden.obj)) objs = garden.obj;
  var campaign = false;
  for (var i = 0; i < objs.length; i++) {
    var next = nextFromObjective(objs[i]);
    if (next && !next.startsWith('/') && !/^https?:/i.test(next) && next.toLowerCase().indexOf('workshop:') !== 0) {
      campaign = true;
      break;
    }
  }
  var tags = [campaign ? 'Campaign' : 'Map'];
  if ((garden && garden.story) || objs.length) tags.push('Adventure');
  else tags.push('Skirmish');
  return tags;
}

/** Partner checklist tags — extra labels often make SubmitItemUpdate return false. */
const WORKSHOP_SAFE_TAGS = ['Map', 'Special'];

function submitAccepted(submitted) {
  if (submitted === true) return true;
  if (submitted === false || submitted == null) return false;
  if (typeof submitted === 'object') {
    if (submitted.success === false || submitted.ok === false) return false;
    if (submitted.result != null && Number(submitted.result) !== 1) return false;
    if (submitted.success === true || submitted.ok === true) return true;
  }
  return false;
}

function submitErrorMessage(submitted) {
  if (submitted && typeof submitted === 'object') {
    if (submitted.error || submitted.message) return String(submitted.error || submitted.message);
    if (submitted.result != null) return 'submit failed (Steam result ' + submitted.result + ')';
  }
  return 'submit failed';
}

function publishAttempts(tags, hasPreview) {
  var seen = Object.create(null);
  var out = [];
  function add(nextTags, preview) {
    var usePreview = !!(preview && hasPreview);
    var key = nextTags.join(',') + '|' + (usePreview ? '1' : '0');
    if (seen[key]) return;
    seen[key] = 1;
    out.push({ tags: nextTags, preview: usePreview });
  }
  add(tags, true);
  add(WORKSHOP_SAFE_TAGS, true);
  add(tags, false);
  add(WORKSHOP_SAFE_TAGS, false);
  add([], false);
  return out;
}

function createdItemId(result) {
  if (result == null || result === false) return { id: '', needsAgreement: false };
  if (typeof result === 'bigint' || typeof result === 'number' || typeof result === 'string') {
    return { id: itemIdString(result), needsAgreement: false };
  }
  var id = itemIdString(
    result.publishedFileId != null ? result.publishedFileId
      : result.publishedFileID != null ? result.publishedFileID
        : result.itemId != null ? result.itemId
          : result.id,
  );
  var needsAgreement = !!(
    result.needsToAcceptAgreement
    || result.userNeedsToAcceptWorkshopLegalAgreement
  );
  return { id: id, needsAgreement: needsAgreement };
}

function looksLikeLegalAgreement(err) {
  var msg = err && err.message ? err.message : String(err || '');
  return /legal agreement/i.test(msg);
}

function writePreviewJpeg(dir, raw, io) {
  var text = String(raw || '');
  var comma = text.indexOf(',');
  if (text.slice(0, 5) === 'data:' && comma > 0) text = text.slice(comma + 1);
  if (!text || text.length > 1400000) return '';
  var buf;
  try { buf = Buffer.from(text, 'base64'); } catch (_err) { return ''; }
  if (!buf.length || buf.length > 1024 * 1024) return '';
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return '';
  var file = path.join(dir, 'preview.jpg');
  try {
    io.writeFileSync(file, buf);
    return file;
  } catch (_errWrite) {
    return '';
  }
}

/**
 * Create a Workshop item, write map.garden to a temp folder, submit.
 * Preview is optional — Steam Cloud often denies setItemPreview.
 */
async function publishWorkshopItem(workshop, garden, opts) {
  opts = opts || {};
  var appId = (opts.appId | 0) || 0;
  if (!appId) return { ok: false, error: 'no app id' };
  var text = typeof garden === 'string' ? garden : JSON.stringify(garden);
  var meta = peekGardenMeta(text);
  if (!meta.ok) return { ok: false, error: meta.error };
  if (!workshop || typeof workshop.createItem !== 'function') {
    return { ok: false, error: 'workshop publish unavailable' };
  }
  var title = String(opts.title || meta.name || 'Untitled garden').trim() || 'Untitled garden';
  var description = String(opts.description || '').trim();
  var tags = Array.isArray(opts.tags) ? opts.tags : workshopTagsForGarden(meta.garden);
  var visibility = opts.visibility == null ? 0 : (opts.visibility | 0);

  var created;
  try {
    created = await workshop.createItem(appId, 0);
  } catch (errCreate) {
    return {
      ok: false,
      error: errCreate && errCreate.message ? errCreate.message : 'create item failed',
      needsAgreement: looksLikeLegalAgreement(errCreate),
    };
  }
  var parsed = createdItemId(created);
  if (!parsed.id || parsed.id === '0') {
    return { ok: false, error: 'create item failed', needsAgreement: parsed.needsAgreement || true };
  }

  var io = opts.fs || fs;
  var dir = opts.contentDir || io.mkdtempSync(path.join(os.tmpdir(), 'aeg-ugc-'));
  var wrote = false;
  try {
    var contentDir = path.join(dir, 'content');
    try { io.mkdirSync(contentDir, { recursive: true }); } catch (_errMk) { /* exists */ }
    io.writeFileSync(path.join(contentDir, 'map.garden'), JSON.stringify(meta.garden));
    wrote = true;
    var previewFile = opts.previewPath || writePreviewJpeg(dir, opts.previewJpeg, io);
    var changeNote = String(opts.changeNote || 'Published from Forge');
    var attempts = publishAttempts(tags, !!previewFile);
    var lastError = 'submit failed';
    for (var a = 0; a < attempts.length; a++) {
      var attempt = attempts[a];
      var handle = workshop.startItemUpdate(appId, toPublishedFileId(parsed.id));
      if (handle == null) return { ok: false, error: 'start update failed', id: parsed.id };
      if (typeof workshop.setItemTitle === 'function') workshop.setItemTitle(handle, title);
      if (description && typeof workshop.setItemDescription === 'function') {
        workshop.setItemDescription(handle, description);
      }
      if (typeof workshop.setItemVisibility === 'function') workshop.setItemVisibility(handle, visibility);
      if (attempt.tags.length && typeof workshop.setItemTags === 'function') {
        workshop.setItemTags(handle, attempt.tags);
      }
      if (typeof workshop.setItemContent !== 'function' || !workshop.setItemContent(handle, contentDir)) {
        return { ok: false, error: 'set content failed', id: parsed.id };
      }
      if (attempt.preview && previewFile && typeof workshop.setItemPreview === 'function') {
        try {
          if (workshop.setItemPreview(handle, previewFile) === false) attempt.preview = false;
        } catch (_errPrev) {
          attempt.preview = false;
        }
      }
      var submitted = await workshop.submitItemUpdate(handle, changeNote);
      if (submitAccepted(submitted)) {
        return {
          ok: true,
          id: parsed.id,
          file: 'map.garden',
          title: title,
          tags: attempt.tags,
          needsAgreement: parsed.needsAgreement,
        };
      }
      lastError = submitErrorMessage(submitted);
    }
    return { ok: false, error: lastError, id: parsed.id, needsAgreement: parsed.needsAgreement };
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : 'publish failed',
      id: parsed.id,
      needsAgreement: parsed.needsAgreement || looksLikeLegalAgreement(err),
    };
  } finally {
    if (wrote && !opts.keepDir) {
      try { io.rmSync(dir, { recursive: true, force: true }); } catch (_errRm) { /* ignore */ }
    }
  }
}

module.exports = {
  GARDEN_VERSION_MIN,
  GARDEN_VERSION_MAX,
  MAX_GARDEN_BYTES,
  ITEM_STATE,
  itemIdString,
  toPublishedFileId,
  parseWorkshopId,
  normalizeGardenRel,
  resolveInside,
  peekGardenMeta,
  walkGardenRels,
  pickDefaultGarden,
  describeInstall,
  readGardenFile,
  itemFlags,
  listSubscribedMaps,
  loadSubscribedGarden,
  workshopOverlayUrl,
  workshopTagsForGarden,
  createdItemId,
  writePreviewJpeg,
  publishWorkshopItem,
};
