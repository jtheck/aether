// Which garden plays after this chapter.
// An objective `next` is a branch. Otherwise the campaign index wins,
// then the `pk.files` copy stamped on the garden.

import { parseWorkshopRef, resolveNextGardenRef } from './workshop.js';
import { readCampaignPack } from './gardenSession.js';
import {
  campaignFileOfRef,
  formatPackRef,
  nextChapterFile,
  normalizeCampaignIndex,
  packFilesOf,
} from '../story/campaignPack.js';

/**
 * Join a chapter filename onto the pack the player is already in.
 * @param {string} currentRef
 * @param {string} nextFile
 */
export function siblingGardenRef(currentRef, nextFile) {
  const file = String(nextFile || '').trim();
  if (!file) return '';
  const current = String(currentRef || '').trim();
  if (current.toLowerCase().startsWith('pack:')) {
    return formatPackRef(campaignFileOfRef(file) || file);
  }
  if (parseWorkshopRef(current)) return resolveNextGardenRef(file, current);
  if (current.startsWith('/')) {
    if (file.startsWith('/')) return file;
    if (file.includes('/')) return `/${file.replace(/^\/+/, '')}`;
    const slash = current.lastIndexOf('/');
    return `${current.slice(0, slash + 1)}${file}`;
  }
  return file;
}

function nextFileInList(files, currentRef) {
  if (!files?.length) return '';
  const want = campaignFileOfRef(currentRef);
  if (!want) return '';
  const i = files.indexOf(want);
  if (i < 0 || i + 1 >= files.length) return '';
  return files[i + 1];
}

/**
 * @param {{
 *   explicit?: string,
 *   currentRef?: string,
 *   packFiles?: string[] | null,
 *   index?: object | null,
 * }} args
 */
export function continuationGardenRef({
  explicit = '',
  currentRef = '',
  packFiles = null,
  index = null,
} = {}) {
  const current = String(currentRef || '').trim();
  const branch = String(explicit || '').trim();
  if (branch) return resolveNextGardenRef(branch, current);
  const fromIndex = index ? nextChapterFile(index, current) : '';
  if (fromIndex) return siblingGardenRef(current, fromIndex);
  const fromPack = nextFileInList(packFilesOf({ pk: { files: packFiles } }) || packFiles, current);
  if (fromPack) return siblingGardenRef(current, fromPack);
  return '';
}

/** Index for the pack this ref belongs to. Null when the ref is a single map. */
export async function loadPlayIndex(ref, opts = {}) {
  const current = String(ref || '');
  try {
    if (current.startsWith('/maps/') || current.toLowerCase().startsWith('pack:')) {
      const text = typeof opts.packText === 'function' ? await opts.packText() : await readCampaignPack();
      return text ? normalizeCampaignIndex(JSON.parse(text)) : null;
    }
    const workshop = parseWorkshopRef(current);
    if (workshop) {
      const items = typeof opts.listWorkshopMaps === 'function' ? await opts.listWorkshopMaps() : [];
      const item = (items || []).find((row) => String(row.id) === workshop.id);
      return normalizeCampaignIndex(item?.campaign);
    }
  } catch {
    return null;
  }
  return null;
}
