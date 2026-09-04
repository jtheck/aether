import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UNIT } from '../sim/unitTypes.js';
import { UNIT_MODEL_URLS } from '../render/unitModels.js';
import {
  DEFAULT_SKIN_ID,
  DLC_FIRST_RESPONDER,
  DLC_FIRST_RESPONDER_APP_ID,
  activePackId,
  localOwnedPacks,
  ownerSkinsFromRoster,
  ownerSkinsFromSeats,
  packsOwnedFromSteamDlc,
  queryDlcPacks,
  resolveUnitModelUrl,
  resolveVatDef,
  selectedSkins,
  skinChoicesForUnit,
} from './dlcCatalog.js';

describe('dlcCatalog', () => {
  it('maps Steam app 5217980 onto first_responder', () => {
    assert.deepEqual(
      packsOwnedFromSteamDlc([{ appId: DLC_FIRST_RESPONDER_APP_ID, owned: true }]),
      [DLC_FIRST_RESPONDER],
    );
    assert.deepEqual(packsOwnedFromSteamDlc([{ appId: DLC_FIRST_RESPONDER_APP_ID, owned: false }]), []);
  });

  it('honors ?dlc= only on localhost', () => {
    assert.deepEqual(queryDlcPacks('?dlc=first_responder', 'localhost'), [DLC_FIRST_RESPONDER]);
    assert.deepEqual(queryDlcPacks('?dlc=all', '127.0.0.1'), [DLC_FIRST_RESPONDER]);
    assert.deepEqual(queryDlcPacks('?dlc=first_responder', 'aether.garden'), []);
    assert.deepEqual(localOwnedPacks([], '?dlc=first_responder', 'localhost'), [DLC_FIRST_RESPONDER]);
    assert.deepEqual(localOwnedPacks([], '?dlc=first_responder', 'aether.garden'), []);
    assert.deepEqual(localOwnedPacks([DLC_FIRST_RESPONDER], '?dlc=first_responder', 'aether.garden'), [DLC_FIRST_RESPONDER]);
    assert.deepEqual(localOwnedPacks([], ''), []);
    assert.equal(activePackId([DLC_FIRST_RESPONDER]), DLC_FIRST_RESPONDER);
    assert.equal(activePackId([]), null);
  });

  it('resolves the First Responder priest and falls back for other units', () => {
    assert.equal(
      resolveUnitModelUrl(UNIT.PRIEST, DLC_FIRST_RESPONDER),
      '/assets/models/dlc/first_responder/priest-DLC1.glb',
    );
    assert.equal(resolveUnitModelUrl(UNIT.PRIEST, null), UNIT_MODEL_URLS[UNIT.PRIEST]);
    assert.equal(resolveUnitModelUrl(UNIT.WARRIOR, DLC_FIRST_RESPONDER), UNIT_MODEL_URLS[UNIT.WARRIOR]);
    assert.equal(resolveVatDef(UNIT.VILLAGER, DLC_FIRST_RESPONDER)?.url, '/assets/models/villager.glb');
  });

  it('maps lobby seats and KOTH roster onto per-unit skins', () => {
    assert.deepEqual(ownerSkinsFromSeats([
      { kind: 'human', index: 0, dlc: [DLC_FIRST_RESPONDER] },
      { kind: 'human', index: 1, dlc: [] },
      { kind: 'empty', index: 2 },
    ]), { 0: { [UNIT.PRIEST]: DLC_FIRST_RESPONDER } });
    assert.deepEqual(ownerSkinsFromSeats([
      { kind: 'human', index: 0, skins: { [UNIT.PRIEST]: DLC_FIRST_RESPONDER } },
    ]), { 0: { [UNIT.PRIEST]: DLC_FIRST_RESPONDER } });
    assert.deepEqual(ownerSkinsFromRoster(
      [
        { state: 'active', playerId: 0, userId: 'a' },
        { state: 'active', playerId: 1, userId: 'b' },
      ],
      new Map([['b', { [UNIT.PRIEST]: DLC_FIRST_RESPONDER }]]),
    ), { 1: { [UNIT.PRIEST]: DLC_FIRST_RESPONDER } });
  });

  it('lets a saved Default beat the auto-owned pack, and lists several choices', () => {
    assert.deepEqual(selectedSkins([DLC_FIRST_RESPONDER], {}), {
      [UNIT.PRIEST]: DLC_FIRST_RESPONDER,
    });
    assert.deepEqual(selectedSkins([DLC_FIRST_RESPONDER], { [UNIT.PRIEST]: DEFAULT_SKIN_ID }), {});
    const choices = skinChoicesForUnit(UNIT.PRIEST, [DLC_FIRST_RESPONDER]);
    assert.equal(choices[0].id, DEFAULT_SKIN_ID);
    assert.equal(choices.length, 2);
    assert.equal(choices[1].id, DLC_FIRST_RESPONDER);
  });
});
