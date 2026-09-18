// Axiom fly — one intent for keys, pointer, wheel, stick.
// Backends only apply (same pipe as gamepad.js → applyGamepadFly).

export const IDLE_FLY = {
  mx: 0,
  my: 0,
  mz: 0,
  wheelX: 0,
  wheelZ: 0,
  lookRight: 0,
  lookUp: 0,
  lookYaw: 0,
  lookPitch: 0,
};

export const LOOK_SENS = 0.0022;

/**
 * ESDF + arrows + R/C. Same mapping every backend used to keep a private copy of.
 * @param {Set<string> | Iterable<string> | null | undefined} keys
 */
export function flyIntentFromKeys(keys) {
  let mx = 0;
  let my = 0;
  let mz = 0;
  const has = keys?.has
    ? (code) => keys.has(code)
    : (() => {
      const set = new Set(keys ?? []);
      return (code) => set.has(code);
    })();
  if (has('KeyE') || has('ArrowUp')) mz += 1;
  if (has('KeyD') || has('ArrowDown')) mz -= 1;
  if (has('KeyS') || has('ArrowLeft')) mx -= 1;
  if (has('KeyF') || has('ArrowRight')) mx += 1;
  if (has('KeyR')) my += 1;
  if (has('KeyC')) my -= 1;
  return { mx, my, mz, wheelX: 0, wheelZ: 0, lookRight: 0, lookUp: 0, lookYaw: 0, lookPitch: 0 };
}

function wheelPixels(delta, mode) {
  const v = Number(delta);
  if (!Number.isFinite(v) || v === 0) return 0;
  if (mode === 1) return v * 16;
  if (mode === 2) return v * 800;
  return v;
}

function wheelUnit(px) {
  const u = px / 100;
  if (u > 8) return 8;
  if (u < -8) return -8;
  return u;
}

/**
 * Scroll up (negative deltaY) → +mz (look forward). One mouse notch (~100px) ≈ 1.
 * @param {{ deltaY?: number, deltaMode?: number } | null | undefined} e
 */
export function wheelFlyMz(e) {
  return wheelUnit(-wheelPixels(e?.deltaY, e?.deltaMode ?? 0));
}

/**
 * Tilt / side-scroll right (positive deltaX) → +mx (strafe right).
 * Tilt hardware usually fires one small notch vs held S/F, so this is hotter than vertical.
 * @param {{ deltaX?: number, deltaMode?: number } | null | undefined} e
 */
export function wheelFlyMx(e) {
  return wheelUnit(wheelPixels(e?.deltaX, e?.deltaMode ?? 0) * 2.5);
}

/** @param {...(object | null | undefined)} parts */
export function mergeFlyIntents(...parts) {
  let mx = 0;
  let my = 0;
  let mz = 0;
  let wheelX = 0;
  let wheelZ = 0;
  let lookYaw = 0;
  let lookPitch = 0;
  let lookRight = 0;
  let lookUp = 0;
  for (const p of parts) {
    if (!p) continue;
    mx += p.mx || 0;
    my += p.my || 0;
    mz += p.mz || 0;
    wheelX += p.wheelX || 0;
    wheelZ += p.wheelZ || 0;
    lookYaw += p.lookYaw || 0;
    lookPitch += p.lookPitch || 0;
    lookRight += p.lookRight || 0;
    lookUp += p.lookUp || 0;
  }
  if (wheelX > 8) wheelX = 8;
  else if (wheelX < -8) wheelX = -8;
  if (wheelZ > 8) wheelZ = 8;
  else if (wheelZ < -8) wheelZ = -8;
  return { mx, my, mz, wheelX, wheelZ, lookRight, lookUp, lookYaw, lookPitch };
}

function isTextField(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || !!el.isContentEditable;
}

function clampWheel(z) {
  if (z > 8) return 8;
  if (z < -8) return -8;
  return z;
}

/**
 * Coarse-pointer stick: screen-right = +mx, screen-up = +mz.
 * @param {Pick<Document, 'createElement' | 'body'>} doc
 * @param {(mx: number, mz: number) => void} onChange
 */
function attachMobileStick(doc, onChange) {
  const root = doc.createElement('div');
  root.id = 'mobi_move';
  root.innerHTML = `
      <div class="mobi-stick" id="mobi_stick">
        <div class="mobi-stick-knob" id="mobi_knob"></div>
      </div>
    `;
  doc.body.appendChild(root);
  root.style.display = 'flex';
  const stickEl = root.querySelector('#mobi_stick');
  const knobEl = root.querySelector('#mobi_knob');
  let stickId = -1;
  const maxR = 48;
  const onDown = (e) => {
    if (stickId !== -1) return;
    stickId = e.pointerId;
    stickEl.setPointerCapture?.(e.pointerId);
    onMove(e);
    e.preventDefault();
    e.stopPropagation();
  };
  const onMove = (e) => {
    if (e.pointerId !== stickId) return;
    const rect = stickEl.getBoundingClientRect();
    let dx = e.clientX - (rect.left + rect.width * 0.5);
    let dy = e.clientY - (rect.top + rect.height * 0.5);
    const len = Math.hypot(dx, dy) || 1;
    if (len > maxR) {
      dx = (dx / len) * maxR;
      dy = (dy / len) * maxR;
    }
    onChange(dx / maxR, -dy / maxR);
    knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
    e.preventDefault();
    e.stopPropagation();
  };
  const onUp = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = -1;
    onChange(0, 0);
    knobEl.style.transform = 'translate(0px, 0px)';
    e.preventDefault();
    e.stopPropagation();
  };
  stickEl.addEventListener('pointerdown', onDown);
  stickEl.addEventListener('pointermove', onMove);
  stickEl.addEventListener('pointerup', onUp);
  stickEl.addEventListener('pointercancel', onUp);
  return {
    dispose() {
      stickEl.removeEventListener('pointerdown', onDown);
      stickEl.removeEventListener('pointermove', onMove);
      stickEl.removeEventListener('pointerup', onUp);
      stickEl.removeEventListener('pointercancel', onUp);
      root.remove();
    },
  };
}

/**
 * Bind desktop + stick. `read()` is the frame's intent (look / wheel consumed).
 * @param {HTMLElement} canvas
 * @param {{ window?: Window, document?: Document }} [opts]
 */
export function attachAxiomFly(canvas, opts = {}) {
  if (!canvas) throw new Error('attachAxiomFly: canvas required');
  const win = opts.window ?? (typeof window !== 'undefined' ? window : null);
  const doc = opts.document ?? (typeof document !== 'undefined' ? document : null);
  const keys = new Set();
  let stickX = 0;
  let stickZ = 0;
  let wheelX = 0;
  let wheelZ = 0;
  let lookYaw = 0;
  let lookPitch = 0;
  let dragging = false;
  let lastPtrX = 0;
  let lastPtrY = 0;

  if (canvas.tabIndex < 0) canvas.tabIndex = 0;
  if (canvas.style) canvas.style.outline = 'none';

  const onKeyDown = (e) => {
    if (isTextField(doc?.activeElement)) return;
    if (e?.code) keys.add(e.code);
  };
  const onKeyUp = (e) => {
    if (e?.code) keys.delete(e.code);
  };
  const onPtrDown = (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    dragging = true;
    lastPtrX = e.clientX;
    lastPtrY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
    canvas.focus?.();
  };
  const onPtrMove = (e) => {
    if (!dragging) return;
    lookYaw += (e.clientX - lastPtrX) * LOOK_SENS;
    lookPitch += -(e.clientY - lastPtrY) * LOOK_SENS;
    lastPtrX = e.clientX;
    lastPtrY = e.clientY;
  };
  const onPtrUp = (e) => {
    dragging = false;
    canvas.releasePointerCapture?.(e.pointerId);
  };
  const onWheel = (e) => {
    e.preventDefault?.();
    wheelX = clampWheel(wheelX + wheelFlyMx(e));
    wheelZ = clampWheel(wheelZ + wheelFlyMz(e));
  };
  const onFocus = () => canvas.focus?.();
  const onContext = (e) => e.preventDefault?.();

  canvas.addEventListener('pointerdown', onPtrDown);
  canvas.addEventListener('pointermove', onPtrMove);
  canvas.addEventListener('pointerup', onPtrUp);
  canvas.addEventListener('pointercancel', onPtrUp);
  canvas.addEventListener('pointerdown', onFocus);
  canvas.addEventListener('contextmenu', onContext);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  win?.addEventListener?.('keydown', onKeyDown);
  win?.addEventListener?.('keyup', onKeyUp);
  canvas.focus?.();

  const wantStick =
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
    win?.matchMedia?.('(pointer: coarse)')?.matches;
  const stick = wantStick && doc?.body
    ? attachMobileStick(doc, (x, z) => {
      stickX = x;
      stickZ = z;
    })
    : null;

  return {
    read() {
      const key = isTextField(doc?.activeElement) ? IDLE_FLY : flyIntentFromKeys(keys);
      const intent = mergeFlyIntents(
        key,
        { mx: stickX, mz: stickZ },
        { wheelX, wheelZ },
        { lookYaw, lookPitch },
      );
      lookYaw = 0;
      lookPitch = 0;
      wheelX = 0;
      wheelZ = 0;
      return intent;
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onPtrDown);
      canvas.removeEventListener('pointermove', onPtrMove);
      canvas.removeEventListener('pointerup', onPtrUp);
      canvas.removeEventListener('pointercancel', onPtrUp);
      canvas.removeEventListener('pointerdown', onFocus);
      canvas.removeEventListener('contextmenu', onContext);
      canvas.removeEventListener('wheel', onWheel);
      win?.removeEventListener?.('keydown', onKeyDown);
      win?.removeEventListener?.('keyup', onKeyUp);
      stick?.dispose();
      keys.clear();
    },
  };
}
