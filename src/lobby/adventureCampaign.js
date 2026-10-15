// Official adventure campaign. Forge exports this file; the lobby lists its
// live chapters. Episodes with nothing switched on never appear.

import { writeCampaignPack } from '../app/gardenSession.js';
import {
  flattenCampaignChapters,
  formatPackRef,
  isCampaignBundle,
} from '../story/campaignPack.js';

export const ADVENTURE_CAMPAIGN_URL = '/maps/adventure.campaign';

/** @type {{ id: string, name: string, episode: string, garden: string }[]} */
let chapters = [];

export function adventureChapters() {
  return chapters;
}

/** Replace the lobby list from a campaign bundle. Off chapters are omitted. */
export function installAdventureCampaign(bundle) {
  if (!isCampaignBundle(bundle)) {
    chapters = [];
    return chapters;
  }
  const flat = flattenCampaignChapters(bundle);
  chapters = flat.map((ch) => ({
    id: formatPackRef(ch.file),
    name: ch.name || ch.file,
    episode: ch.episode || '',
    garden: formatPackRef(ch.file),
  }));
  return chapters;
}

/**
 * Fetch the shipped campaign, install its live chapters, and keep the pack
 * so play and chapter-to-chapter continuation read the same file.
 * @param {{
 *   fetchCampaign?: () => Promise<string>,
 *   writePack?: (text: string) => Promise<void>,
 * }} [opts]
 */
export async function loadAdventureCampaign(opts = {}) {
  const fetchCampaign = opts.fetchCampaign || (async () => {
    const res = await fetch(ADVENTURE_CAMPAIGN_URL);
    if (!res.ok) throw new Error(`campaign ${res.status}`);
    return res.text();
  });
  const text = await fetchCampaign();
  const bundle = JSON.parse(text);
  const list = installAdventureCampaign(bundle);
  if (!list.length) throw new Error('campaign has no live chapters');
  if (opts.writePack) await opts.writePack(text);
  else await writeCampaignPack(text);
  return list;
}
