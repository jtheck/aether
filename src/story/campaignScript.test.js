import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderCampaignScript, renderCampaignScriptHtml } from './campaignScript.js';

describe('campaign screenplay', () => {
  it('lays out live adventure chapters in fountain form', () => {
    const script = renderCampaignScript();
    assert.match(script, /^Title:\s*\n\tAETHER/m);
    assert.match(script, /ancient grove/i);
    assert.match(script, /EPISODE 1: Episode 1/);
    assert.match(script, /PLAY\./);
    assert.match(script, /THE END/);
    assert.ok((script.match(/^EXT\./gm) || []).length >= 4);
  });

  it('renders a readable html copy with sections and play slugs', () => {
    const html = renderCampaignScriptHtml();
    assert.match(html, /<title>AETHER<\/title>/);
    assert.match(html, /id="ep1"/);
    assert.match(html, /class="chapter" id="[^"]+"/);
    assert.match(html, /class="action"/);
    assert.match(html, /class="camera"/);
    assert.match(html, /class="who who-[^"]+"/);
    assert.match(html, /class="play"/);
    assert.match(html, /ancient grove/i);
  });
});
