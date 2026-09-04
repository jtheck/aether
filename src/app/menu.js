// Side menu wiring — markup + styles live in index.html.

import {
  FX_LABELS,
  SHADOW_LABELS,
  fxTier,
  getExtraControlGroups,
  getFxMode,
  getPlayerColor,
  getPlayerName,
  PLAYER_COLORS,
  getShadowMode,
  getVolumeLevel,
  resolveShadowMode,
  setExtraControlGroups,
  setFxMode,
  setVolumeLevel,
  setPlayerColor,
  setPlayerName,
  setShadowMode,
  setUnitSkin,
  getUnitSkins,
  shadowTier,
} from './settings.js';
import { setVolume } from './audio.js';
import { aetherSteam } from './steam.js';
import {
  DEFAULT_SKIN_ID,
  localOwnedPacks,
  selectedSkins,
  skinChoicesForUnit,
  unitSkinLabel,
  unitsWithUnlockedSkins,
} from './dlcCatalog.js';
import {
  escapeMenuStep,
  fullscreenButtonLabel,
  isPageFullscreen,
  subscribeFullscreen,
  toggleFullscreen,
  tryExitFullscreen,
} from './fullscreen.js';

/**
 * @param {object} opts
 * @param {{
 *   setShadowsEnabled?: (on: boolean) => unknown,
 *   getShadowsEnabled?: () => boolean,
 *   setFxMode?: (mode: number, quality?: object) => unknown,
 *   getFxMode?: () => number,
 *   particleStats?: () => { active?: number, capacity?: number, hardMax?: number },
 * }} opts.renderer
 * @param {() => unknown} [opts.onStartSoloAi]
 * @param {() => unknown} [opts.onStartUnitTester]
 * @param {() => unknown} [opts.onStartStressful]
 * @param {(hex: string) => unknown} [opts.onPlayerColorChange]
 * @param {() => unknown} [opts.onUnitSkinsChange]
 * @param {() => boolean} [opts.getHudLocked]
 * @param {(on: boolean) => unknown} [opts.setHudLocked]
 */
export function setupMenu({
  renderer,
  onStartSoloAi,
  onStartUnitTester,
  onStartStressful,
  onPlayerColorChange,
  onUnitSkinsChange,
  getHudLocked,
  setHudLocked,
}) {
  // Shadow dimensions are locked in at renderer construction, so anything other
  // than the tier we booted with only takes effect on reload.
  const bootMode = resolveShadowMode();
  const bootTier = shadowTier(bootMode);

  const button = /** @type {HTMLElement} */ (document.getElementById('menu_b'));
  const drawer = /** @type {HTMLElement} */ (document.getElementById('side_menu'));
  if (!button || !drawer) throw new Error('menu markup missing from index.html');

  const pages = /** @type {NodeListOf<HTMLElement>} */ (drawer.querySelectorAll('.page'));
  const profile = /** @type {HTMLElement} */ (drawer.querySelector('[data-profile]'));
  const slider = /** @type {HTMLInputElement} */ (drawer.querySelector('#shadow_slider'));
  const sliderValue = /** @type {HTMLElement} */ (drawer.querySelector('#shadow_value'));
  const note = /** @type {HTMLElement} */ (drawer.querySelector('#shadow_note'));
  const fxSlider = /** @type {HTMLInputElement} */ (drawer.querySelector('#fx_slider'));
  const fxValue = /** @type {HTMLElement} */ (drawer.querySelector('#fx_value'));
  const fxNote = /** @type {HTMLElement} */ (drawer.querySelector('#fx_note'));
  const volumeSlider = /** @type {HTMLInputElement} */ (drawer.querySelector('#volume_slider'));
  const volumeValue = /** @type {HTMLElement} */ (drawer.querySelector('#volume_value'));
  const nameInput = /** @type {HTMLInputElement} */ (drawer.querySelector('#name_input'));
  const extraGroups = /** @type {HTMLInputElement | null} */ (drawer.querySelector('#extra_groups'));
  const hideHudBtn = /** @type {HTMLButtonElement | null} */ (drawer.querySelector('#hide_hud_b'));
  const unitSkinsRow = /** @type {HTMLElement | null} */ (drawer.querySelector('#unit_skins_row'));
  const unitSkinsHost = /** @type {HTMLElement | null} */ (drawer.querySelector('#unit_skins'));
  const colorPicker = /** @type {HTMLSelectElement} */ (drawer.querySelector('#color_picker'));
  colorPicker.replaceChildren(
    ...PLAYER_COLORS.map((c) => {
      const opt = document.createElement('option');
      opt.value = c.hex;
      opt.textContent = c.name;
      return opt;
    }),
  );
  const soloBtn = /** @type {HTMLButtonElement} */ (drawer.querySelector('#solo_ai_b'));
  const testerBtn = /** @type {HTMLButtonElement} */ (drawer.querySelector('#unit_tester_b'));
  const stressBtn = /** @type {HTMLButtonElement | null} */ (drawer.querySelector('#stressful_b'));
  const menuKothStart = /** @type {HTMLButtonElement | null} */ (drawer.querySelector('#menu-koth-start'));
  const menuKothClaim = /** @type {HTMLButtonElement | null} */ (drawer.querySelector('#menu-koth-claim'));
  const menuKothLeave = /** @type {HTMLButtonElement | null} */ (drawer.querySelector('#menu-koth-leave'));
  const menuMatchReady = /** @type {HTMLButtonElement | null} */ (drawer.querySelector('#menu-match-ready'));
  const menuMatchStart = /** @type {HTMLButtonElement | null} */ (drawer.querySelector('#menu-match-start'));
  const menuMatchLeave = /** @type {HTMLButtonElement | null} */ (drawer.querySelector('#menu-match-leave'));
  const lobbyDrawerToggles = [...drawer.querySelectorAll('.lobby-drawer-toggle, .lobby-create')];
  const gear = /** @type {HTMLElement} */ (drawer.querySelector('#settings_b'));
  const graffiti = /** @type {HTMLElement | null} */ (
    document.getElementById('graffiti_b') || document.querySelector('#header img')
  );
  const exitBtn = /** @type {HTMLButtonElement | null} */ (drawer.querySelector('#fullscreen_exit_b'));

  function showPage(name) {
    for (const page of pages) page.classList.toggle('is-active', page.dataset.page === name);
  }

  function paintProfile() {
    profile.textContent = getPlayerName();
    profile.style.color = getPlayerColor();
  }

  function paintShadow(mode) {
    sliderValue.textContent = SHADOW_LABELS[mode];
    const tier = shadowTier(mode);
    const needsReload = mode !== 0
      && (tier.mapSize !== bootTier.mapSize || tier.numCascades !== bootTier.numCascades);
    note.textContent = needsReload ? 'Reload to apply this quality.' : '';
  }

  function paintFx(mode) {
    fxValue.textContent = FX_LABELS[mode];
    const st = renderer.particleStats?.();
    if (mode === 0) {
      fxNote.textContent = 'Particles / socket fire off.';
      return;
    }
    if (st) {
      fxNote.textContent = `${st.active ?? 0} active · cap ${st.capacity ?? '?'} · max ${st.hardMax ?? '?'}`;
    } else {
      fxNote.textContent = 'Applies live.';
    }
  }

  function paintVolume(level) {
    volumeValue.textContent = `${level}%`;
  }

  slider.addEventListener('input', () => {
    const mode = setShadowMode(Number(slider.value));
    paintShadow(mode);
    // Off/on is the one part that can change live; the cascade count and map
    // size behind Low/Med/Full are baked into the depth texture at boot.
    renderer.setShadowsEnabled?.(mode !== 0);
  });

  fxSlider.addEventListener('input', () => {
    const mode = setFxMode(Number(fxSlider.value));
    renderer.setFxMode?.(mode, fxTier(mode));
    paintFx(mode);
  });

  volumeSlider.addEventListener('input', () => {
    const level = setVolumeLevel(Number(volumeSlider.value));
    setVolume(level);
    paintVolume(level);
  });

  nameInput.addEventListener('change', () => {
    nameInput.value = setPlayerName(nameInput.value);
    paintProfile();
  });

  colorPicker.addEventListener('change', () => {
    const hex = setPlayerColor(colorPicker.value);
    paintProfile();
    onPlayerColorChange?.(hex);
  });

  unitSkinsHost?.addEventListener('keydown', (e) => e.stopPropagation());

  extraGroups?.addEventListener('change', () => {
    renderer.setExtraControlGroups?.(setExtraControlGroups(extraGroups.checked));
  });

  function paintUnitSkins() {
    if (!unitSkinsRow || !unitSkinsHost) return;
    const owned = localOwnedPacks(aetherSteam.ownedPacks());
    const units = unitsWithUnlockedSkins(owned);
    unitSkinsRow.hidden = units.length === 0;
    if (!units.length) {
      unitSkinsHost.replaceChildren();
      return;
    }
    const prefs = getUnitSkins();
    const auto = selectedSkins(owned, {});
    const frag = document.createDocumentFragment();
    for (const typeId of units) {
      const row = document.createElement('div');
      row.className = 'row';
      const selectId = `unit_skin_${typeId}`;
      const label = document.createElement('label');
      label.htmlFor = selectId;
      label.textContent = unitSkinLabel(typeId);
      const select = document.createElement('select');
      select.id = selectId;
      select.dataset.unitType = String(typeId);
      for (const choice of skinChoicesForUnit(typeId, owned)) {
        const opt = document.createElement('option');
        opt.value = choice.id;
        opt.textContent = choice.label;
        select.appendChild(opt);
      }
      select.value = Object.prototype.hasOwnProperty.call(prefs, typeId)
        ? prefs[typeId]
        : (auto[typeId] ?? DEFAULT_SKIN_ID);
      select.addEventListener('change', () => {
        setUnitSkin(typeId, select.value);
        onUnitSkinsChange?.();
      });
      row.append(label, select);
      frag.appendChild(row);
    }
    unitSkinsHost.replaceChildren(frag);
  }

  hideHudBtn?.addEventListener('click', () => {
    const next = !getHudLocked?.();
    setHudLocked?.(next);
    if (next) setOpen(false);
  });

  soloBtn.addEventListener('click', async () => {
    if (!onStartSoloAi || soloBtn.disabled) return;
    soloBtn.disabled = true;
    setOpen(false);
    try {
      await onStartSoloAi();
    } finally {
      soloBtn.disabled = false;
    }
  });

  testerBtn?.addEventListener('click', async () => {
    if (!onStartUnitTester || testerBtn.disabled) return;
    testerBtn.disabled = true;
    setOpen(false);
    try {
      await onStartUnitTester();
    } finally {
      testerBtn.disabled = false;
    }
  });

  stressBtn?.addEventListener('click', async () => {
    if (!onStartStressful || stressBtn.disabled) return;
    stressBtn.disabled = true;
    setOpen(false);
    try {
      await onStartStressful();
    } finally {
      stressBtn.disabled = false;
    }
  });

  // Camera/hotkeys listen on window. Stop keydown so typing a name does not
  // pan or trip B/G/H. Leave keyup alone so a held pan key still releases.
  const keyStop = [
    nameInput, colorPicker, extraGroups, hideHudBtn, slider, fxSlider, volumeSlider, soloBtn, testerBtn, stressBtn,
    menuKothStart, menuKothClaim, menuKothLeave,
    menuMatchReady, menuMatchStart, menuMatchLeave,
    ...lobbyDrawerToggles,
  ].filter(Boolean);
  for (const field of keyStop) {
    field.addEventListener('keydown', (e) => e.stopPropagation());
  }

  function syncFromState() {
    // N / X toggle outside the menu; reflect that rather than fighting it.
    const mode = renderer.getShadowsEnabled?.() === false ? 0 : getShadowMode();
    slider.value = String(mode);
    paintShadow(mode);
    const fx = renderer.getFxMode?.() ?? getFxMode();
    fxSlider.value = String(fx);
    paintFx(fx);
    const volume = getVolumeLevel();
    volumeSlider.value = String(volume);
    paintVolume(volume);
    nameInput.value = getPlayerName();
    colorPicker.value = getPlayerColor();
    if (extraGroups) {
      extraGroups.checked = getExtraControlGroups();
      renderer.setExtraControlGroups?.(extraGroups.checked);
    }
    paintUnitSkins();
    paintProfile();
  }

  function isOpen() {
    return drawer.classList.contains('is-open');
  }

  function activePage() {
    return drawer.querySelector('.page.is-active')?.dataset.page ?? 'main';
  }

  function setOpen(open) {
    drawer.classList.toggle('is-open', open);
    button.classList.toggle('is-open', open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    button.title = open ? 'Close' : 'Menu';
    if (open) syncFromState();
  }

  function openMain() {
    showPage('main');
    setOpen(true);
  }

  function paintExit(on = isPageFullscreen()) {
    if (!exitBtn) return;
    exitBtn.hidden = false;
    exitBtn.textContent = fullscreenButtonLabel(on);
  }

  button.addEventListener('click', () => setOpen(!isOpen()));
  button.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      button.click();
    }
  });
  graffiti?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openMain();
  });
  graffiti?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openMain();
    }
  });
  gear.addEventListener('click', () => {
    const onSettings = activePage() === 'settings';
    showPage(onSettings ? 'main' : 'settings');
    if (!onSettings) syncFromState();
  });
  exitBtn?.addEventListener('click', async () => {
    await toggleFullscreen();
    paintExit();
  });

  const unsubFullscreen = subscribeFullscreen(paintExit);

  syncFromState();

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    openMain,
    isOpen,
    /** Escape: open menu → settings → try leave F11 / fullscreen. */
    async handleEscape() {
      if (button.hidden) return false;
      const step = escapeMenuStep({ menuOpen: isOpen(), page: activePage() });
      if (step === 'open-menu') {
        openMain();
        return true;
      }
      if (step === 'open-settings') {
        showPage('settings');
        syncFromState();
        return true;
      }
      const left = await tryExitFullscreen();
      paintExit();
      return left;
    },
    /** Keep the sliders honest when B/F toggle outside the menu. */
    refresh: syncFromState,
    /** Show/hide the menu button; closes the drawer when locking. */
    setAvailable(on) {
      button.hidden = !on;
      if (!on) setOpen(false);
    },
    dispose() {
      unsubFullscreen?.();
    },
  };
}
