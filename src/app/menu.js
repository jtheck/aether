// Side menu wiring — markup + styles live in index.html.

import {
  FX_LABELS,
  SHADOW_LABELS,
  fxTier,
  getFxMode,
  getPlayerColor,
  getPlayerName,
  PLAYER_COLORS,
  getShadowMode,
  resolveShadowMode,
  setFxMode,
  setPlayerColor,
  setPlayerName,
  setShadowMode,
  shadowTier,
} from './settings.js';

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
 * @param {(hex: string) => unknown} [opts.onPlayerColorChange]
 */
export function setupMenu({ renderer, onStartSoloAi, onPlayerColorChange }) {
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
  const nameInput = /** @type {HTMLInputElement} */ (drawer.querySelector('#name_input'));
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
  const gear = /** @type {HTMLElement} */ (drawer.querySelector('#settings_b'));

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

  nameInput.addEventListener('change', () => {
    nameInput.value = setPlayerName(nameInput.value);
    paintProfile();
  });

  colorPicker.addEventListener('change', () => {
    const hex = setPlayerColor(colorPicker.value);
    paintProfile();
    onPlayerColorChange?.(hex);
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

  // The camera and hotkeys listen on window with no target check, so typing a
  // name would otherwise pan the board and trip B/G/H.
  for (const field of [nameInput, colorPicker, slider, fxSlider, soloBtn]) {
    field.addEventListener('keydown', (e) => e.stopPropagation());
    field.addEventListener('keyup', (e) => e.stopPropagation());
  }

  function syncFromState() {
    // B / F toggle outside the menu; reflect that rather than fighting it.
    const mode = renderer.getShadowsEnabled?.() === false ? 0 : getShadowMode();
    slider.value = String(mode);
    paintShadow(mode);
    const fx = renderer.getFxMode?.() ?? getFxMode();
    fxSlider.value = String(fx);
    paintFx(fx);
    nameInput.value = getPlayerName();
    colorPicker.value = getPlayerColor();
    paintProfile();
  }

  function setOpen(open) {
    drawer.classList.toggle('is-open', open);
    if (open) syncFromState();
  }

  button.addEventListener('click', () => setOpen(!drawer.classList.contains('is-open')));
  gear.addEventListener('click', () => {
    const onSettings = drawer.querySelector('.page.is-active')?.dataset.page === 'settings';
    showPage(onSettings ? 'main' : 'settings');
    if (!onSettings) syncFromState();
  });

  syncFromState();

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    /** Keep the sliders honest when B/F toggle outside the menu. */
    refresh: syncFromState,
    /** Show/hide the menu button; closes the drawer when locking. */
    setAvailable(on) {
      button.hidden = !on;
      if (!on) setOpen(false);
    },
  };
}
