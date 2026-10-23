// Side menu wiring - markup + styles live in index.html.

import {
  FX_LABELS,
  SHADOW_LABELS,
  fxTier,
  getAaEnabled,
  getFxMode,
  getPlayerColor,
  getPlayerName,
  PLAYER_COLORS,
  getShadowMode,
  getVolumeLevel,
  resolveAaEnabled,
  resolveShadowMode,
  setAaEnabled,
  setFxMode,
  setVolumeLevel,
  setPlayerColor,
  setPlayerName,
  setShadowMode,
  setUnitSkin,
  getUnitSkins,
  setBuildingSkin,
  getBuildingSkins,
  shadowTier,
} from './settings.js';
import { setVolume } from './audio.js';
import { aetherSteam } from './steam.js';
import { localOwnedPacks, skinMenuModel } from './dlcCatalog.js';
import {
  escapeMenuStep,
  fullscreenButtonLabel,
  isPageFullscreen,
  subscribeFullscreen,
  toggleFullscreen,
  tryExitFullscreen,
} from './fullscreen.js';
import { blowGraffiti } from './graffitiPuff.js';
import { mountHelpRoster } from './helpRoster.js';
import { focusMenuEl } from './input/gamepad.js';

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
 * @param {() => unknown} [opts.onOpenReplay]
 * @param {(hex: string) => unknown} [opts.onPlayerColorChange]
 * @param {() => unknown} [opts.onUnitSkinsChange]
 * @param {boolean} [opts.xrSupported]
 * @param {() => unknown} [opts.onToggleXr]
 */
export function setupMenu({
  renderer,
  onStartSoloAi,
  onStartUnitTester,
  onStartStressful,
  onOpenReplay,
  onPlayerColorChange,
  onUnitSkinsChange,
  xrSupported = false,
  onToggleXr,
}) {
  // Shadow dimensions are locked in at renderer construction, so anything other
  // than the tier we booted with only takes effect on reload. MSAA sample count
  // is the same - Lite allocates the swapchain at createEngine.
  const bootMode = resolveShadowMode();
  const bootTier = shadowTier(bootMode);
  const bootAaEnabled = resolveAaEnabled();

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
  const aaEnabled = /** @type {HTMLInputElement | null} */ (drawer.querySelector('#aa_enabled'));
  const aaNote = /** @type {HTMLElement | null} */ (drawer.querySelector('#aa_note'));
  const skinsBtn = /** @type {HTMLButtonElement | null} */ (drawer.querySelector('#skins_b'));
  const colorPicker = /** @type {HTMLSelectElement} */ (drawer.querySelector('#color_picker'));
  colorPicker.replaceChildren(
    ...PLAYER_COLORS.map((c) => {
      const opt = document.createElement('option');
      opt.value = c.hex;
      opt.textContent = c.name;
      return opt;
    }),
  );
  const practiceToggle = /** @type {HTMLButtonElement | null} */ (drawer.querySelector('#practice-toggle'));
  const practiceBody = /** @type {HTMLElement | null} */ (drawer.querySelector('#practice-body'));
  const soloBtn = /** @type {HTMLButtonElement} */ (drawer.querySelector('#solo_ai_b'));
  const openReplayBtn = /** @type {HTMLButtonElement | null} */ (drawer.querySelector('#open_replay_b'));
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
  const xrButton = /** @type {HTMLButtonElement | null} */ (drawer.querySelector('#xr_button'));
  if (xrButton) {
    xrButton.hidden = !xrSupported;
    xrButton.addEventListener('click', () => {
      Promise.resolve(onToggleXr?.()).catch((err) => {
        console.warn('[xr] session failed', err);
        xrButton.classList.remove('is-on');
        xrButton.title = 'Enter XR';
        xrButton.setAttribute('aria-pressed', 'false');
        xrButton.setAttribute('aria-label', 'Enter XR');
      });
    });
  }
  const exitBtn = /** @type {HTMLButtonElement | null} */ (drawer.querySelector('#fullscreen_exit_b'));

  function showPage(name) {
    for (const page of pages) page.classList.toggle('is-active', page.dataset.page === name);
  }

  function paintProfile() {
    profile.textContent = getPlayerName();
    profile.style.setProperty('--player', getPlayerColor());
  }

  const SHADOW_NOTES = [
    'Cast shadows off.',
    'Coarser shadows, short range.',
    'Finer shadows, mid range.',
    'Finer shadows, long range.',
  ];

  function paintShadow(mode) {
    sliderValue.textContent = SHADOW_LABELS[mode];
    const tier = shadowTier(mode);
    const needsReload = mode !== 0
      && (tier.mapSize !== bootTier.mapSize || tier.numCascades !== bootTier.numCascades);
    const detail = SHADOW_NOTES[mode] ?? '';
    note.textContent = needsReload ? `${detail} Reload to apply.` : detail;
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

  function paintAa(enabled) {
    if (!aaNote) return;
    if (enabled !== bootAaEnabled) {
      aaNote.textContent = 'Reload to apply.';
      return;
    }
    aaNote.textContent = enabled ? '4× MSAA.' : '';
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

  aaEnabled?.addEventListener('change', () => {
    paintAa(setAaEnabled(aaEnabled.checked));
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

  openReplayBtn?.addEventListener('click', async () => {
    if (!onOpenReplay || openReplayBtn.disabled) return;
    openReplayBtn.disabled = true;
    setOpen(false);
    try {
      await onOpenReplay();
    } finally {
      openReplayBtn.disabled = false;
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

  practiceToggle?.addEventListener('click', () => {
    const open = practiceToggle.getAttribute('aria-expanded') !== 'true';
    practiceToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (practiceBody) practiceBody.hidden = !open;
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
    nameInput, colorPicker, aaEnabled, skinsBtn, slider, fxSlider, volumeSlider, soloBtn, openReplayBtn, testerBtn, stressBtn,
    menuKothStart, menuKothClaim, menuKothLeave,
    menuMatchReady, menuMatchStart, menuMatchLeave,
    ...lobbyDrawerToggles,
  ].filter(Boolean);
  for (const field of keyStop) {
    field.addEventListener('keydown', (e) => e.stopPropagation());
  }

  function syncFromState() {
    // Sliders mirror renderer shadow/FX mode (menu is the control surface).
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
    if (aaEnabled) {
      const enabled = getAaEnabled();
      aaEnabled.checked = enabled;
      paintAa(enabled);
    }
    paintSkins();
    paintProfile();
  }

  function isOpen() {
    return drawer.classList.contains('is-open');
  }

  function activePage() {
    return drawer.querySelector('.page.is-active')?.dataset.page ?? 'main';
  }

  const helpBtn = /** @type {HTMLElement | null} */ (drawer.querySelector('#help_b'));
  const helpPop = /** @type {HTMLElement | null} */ (document.getElementById('help_pop'));
  const helpClose = /** @type {HTMLButtonElement | null} */ (document.getElementById('help_close'));
  const skinsPop = /** @type {HTMLElement | null} */ (document.getElementById('skins_pop'));
  const skinsClose = /** @type {HTMLButtonElement | null} */ (document.getElementById('skins_close'));
  const skinsList = /** @type {HTMLElement | null} */ (document.getElementById('skins_list'));
  const skinsStoreNote = /** @type {HTMLElement | null} */ (document.getElementById('skins_store_note'));

  function paintSkins() {
    if (!skinsList) return;
    const items = skinMenuModel(
      localOwnedPacks(aetherSteam.ownedPacks()),
      getUnitSkins(),
      getBuildingSkins(),
    );
    const frag = document.createDocumentFragment();
    if (!items.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No alternate looks yet.';
      frag.appendChild(empty);
    }
    let locked = false;
    for (const item of items) {
      if (!item.unlocked) locked = true;
      const selectId = `skin_${item.kind}_${item.id}`;
      const row = document.createElement('div');
      row.className = 'skin-row';
      const label = document.createElement('label');
      label.htmlFor = selectId;
      label.textContent = item.label;
      const select = document.createElement('select');
      select.id = selectId;
      for (const choice of item.choices) {
        const opt = document.createElement('option');
        opt.value = choice.id;
        opt.textContent = choice.label;
        opt.disabled = !choice.enabled;
        select.appendChild(opt);
      }
      select.value = item.value;
      select.addEventListener('change', () => {
        const choice = item.choices.find((row) => row.id === select.value);
        if (!choice?.enabled) {
          select.value = item.value;
          return;
        }
        if (item.kind === 'building') setBuildingSkin(String(item.id), select.value);
        else setUnitSkin(Number(item.id), select.value);
        onUnitSkinsChange?.();
      });
      select.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') return;
        e.stopPropagation();
      });
      row.append(label, select);
      frag.appendChild(row);
    }
    skinsList.replaceChildren(frag);
    if (skinsStoreNote) skinsStoreNote.hidden = !locked;
  }

  function hidePop(pop, btn) {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    btn?.classList.remove('is-on');
    btn?.setAttribute('aria-expanded', 'false');
  }

  function setHelpOpen(open, restoreFocus = false) {
    if (!helpPop) return;
    if (helpPop.hidden === !open) return;
    if (open) hidePop(skinsPop, skinsBtn);
    helpPop.hidden = !open;
    helpBtn?.classList.toggle('is-on', open);
    helpBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      focusMenuEl(helpClose);
      return;
    }
    if (restoreFocus && drawer.classList.contains('is-open')) focusMenuEl(helpBtn);
  }

  function closeHelp() {
    if (!helpPop || helpPop.hidden) return false;
    setHelpOpen(false, true);
    return true;
  }

  function setSkinsOpen(open, restoreFocus = false) {
    if (!skinsPop) return;
    if (skinsPop.hidden === !open) return;
    if (open) {
      hidePop(helpPop, helpBtn);
      paintSkins();
    }
    skinsPop.hidden = !open;
    skinsBtn?.classList.toggle('is-on', open);
    skinsBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      focusMenuEl(skinsClose);
      return;
    }
    if (restoreFocus && drawer.classList.contains('is-open')) focusMenuEl(skinsBtn);
  }

  function closeSkins() {
    if (!skinsPop || skinsPop.hidden) return false;
    setSkinsOpen(false, true);
    return true;
  }

  function setOpen(open) {
    drawer.classList.toggle('is-open', open);
    button.classList.toggle('is-open', open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    button.title = open ? 'Close' : 'Menu';
    if (!open) {
      setHelpOpen(false);
      setSkinsOpen(false);
    }
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

  const graffiti = document.getElementById('graffiti_b');
  const pressGraffiti = () => {
    if (graffiti instanceof HTMLImageElement) blowGraffiti(graffiti);
    openMain();
  };
  graffiti?.addEventListener('click', pressGraffiti);
  graffiti?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    pressGraffiti();
  });
  button.addEventListener('click', () => setOpen(!isOpen()));
  button.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      button.click();
    }
  });
  gear.addEventListener('click', () => {
    setHelpOpen(false);
    setSkinsOpen(false);
    const onSettings = activePage() === 'settings';
    showPage(onSettings ? 'main' : 'settings');
    if (!onSettings) syncFromState();
  });
  helpBtn?.addEventListener('click', () => setHelpOpen(!!helpPop?.hidden));
  helpBtn?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    helpBtn.click();
  });
  helpClose?.addEventListener('click', () => closeHelp());
  helpPop?.addEventListener('click', (e) => {
    if (e.target === helpPop) closeHelp();
  });
  skinsBtn?.addEventListener('click', () => setSkinsOpen(!!skinsPop?.hidden));
  skinsClose?.addEventListener('click', () => closeSkins());
  skinsPop?.addEventListener('click', (e) => {
    if (e.target === skinsPop) closeSkins();
  });
  if (helpPop) mountHelpRoster(helpPop);
  const steamStoreLink = drawer.querySelector('#steam_store_a');
  if (steamStoreLink && aetherSteam.isAvailable()) steamStoreLink.hidden = true;
  const forgeLink = drawer.querySelector('#forge_editor_a');
  forgeLink?.addEventListener('click', () => {
    aetherSteam.notifyForgeOpened();
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
    closeHelp,
    closeSkins,
    isHelpOpen() {
      return !!helpPop && !helpPop.hidden;
    },
    isSkinsOpen() {
      return !!skinsPop && !skinsPop.hidden;
    },
    /** Escape: skins or help card, then open menu → settings → try leave F11 / fullscreen. */
    async handleEscape() {
      if (button.hidden) return false;
      if (closeSkins()) return true;
      if (closeHelp()) return true;
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
