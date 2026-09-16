import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderCampaignScript, renderCampaignScriptHtml } from './campaignScript.js';

describe('campaign screenplay', () => {
  it('lays out prologue and five episodes in fountain form', () => {
    const script = renderCampaignScript();
    assert.match(script, /^Title:\s*\n\tAETHER/m);
    assert.match(script, /THE ANCIENT GROVE/);
    assert.match(script, /EPISODE 1: The Siege/);
    assert.match(script, /EPISODE 5: Cataclysm/);
    assert.match(script, /The keep is burning/);
    assert.match(script, /GOBLIN/);
    assert.match(script, /\(shouting\)/);
    assert.match(script, /PLAY\./);
    assert.match(script, /THE END/);
    assert.ok((script.match(/^EXT\./gm) || []).length >= 20);
  });

  it('renders a readable html copy with sections and play slugs', () => {
    const html = renderCampaignScriptHtml();
    assert.match(html, /<title>AETHER<\/title>/);
    assert.match(html, /id="prologue"/);
    assert.match(html, /id="ep1"/);
    assert.match(html, /id="e1c1"/);
    assert.match(html, /class="action"/);
    assert.match(html, /class="camera"/);
    assert.match(html, /class="who who-goblin"/);
    assert.match(html, /class="play"/);
    assert.match(html, /The keep is burning/);
  });
});
