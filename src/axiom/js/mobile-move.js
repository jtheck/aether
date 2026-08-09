/**
 * Coarse-pointer / touch locomotion for axiom FreeCamera.
 * Stick moves along camera look (incl. pitch); strafe on camera right. Look on canvas.
 */

/**
 * @param {any} camera BABYLON.FreeCamera
 * @returns {{ tick: (dt: number) => void, dispose: () => void }}
 */
export function attachMobileMove(camera) {
  const want =
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
    window.matchMedia?.('(pointer: coarse)')?.matches;
  if (!want || !camera) {
    return { tick() {}, dispose() {} };
  }

  // Prefer look-only on canvas; stick owns translation
  const touch = camera.inputs?.attached?.touch;
  if (touch && 'touchMoveSensibility' in touch) {
    touch.touchMoveSensibility = 1e9;
  }

  const root = document.createElement('div');
  root.id = 'mobi_move';
  root.innerHTML = `
    <div class="mobi-stick" id="mobi_stick">
      <div class="mobi-stick-knob" id="mobi_knob"></div>
    </div>
  `;
  document.body.appendChild(root);
  root.style.display = 'flex';

  const stickEl = root.querySelector('#mobi_stick');
  const knobEl = root.querySelector('#mobi_knob');

  let sx = 0;
  let sy = 0;
  let stickId = -1;
  const maxR = 48;

  function setKnob(x, y) {
    knobEl.style.transform = `translate(${x}px, ${y}px)`;
  }

  function onStickDown(e) {
    if (stickId !== -1) return;
    stickId = e.pointerId;
    stickEl.setPointerCapture?.(e.pointerId);
    onStickMove(e);
    e.preventDefault();
    e.stopPropagation();
  }

  function onStickMove(e) {
    if (e.pointerId !== stickId) return;
    const rect = stickEl.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const len = Math.hypot(dx, dy) || 1;
    if (len > maxR) {
      dx = (dx / len) * maxR;
      dy = (dy / len) * maxR;
    }
    sx = dx / maxR;
    sy = -dy / maxR; // screen up → forward along look
    setKnob(dx, dy);
    e.preventDefault();
    e.stopPropagation();
  }

  function onStickUp(e) {
    if (e.pointerId !== stickId) return;
    stickId = -1;
    sx = 0;
    sy = 0;
    setKnob(0, 0);
    e.preventDefault();
    e.stopPropagation();
  }

  stickEl.addEventListener('pointerdown', onStickDown);
  stickEl.addEventListener('pointermove', onStickMove);
  stickEl.addEventListener('pointerup', onStickUp);
  stickEl.addEventListener('pointercancel', onStickUp);

  const B = globalThis.BABYLON;
  const forward = new B.Vector3();
  const right = new B.Vector3();
  const tmp = new B.Vector3();

  return {
    tick(dt) {
      if (!sx && !sy) return;
      const dead = 0.12;
      const curve = (v) => {
        const a = Math.abs(v) < dead ? 0 : (Math.abs(v) - dead) / (1 - dead);
        return Math.sign(v) * a * a;
      };
      const mx = curve(sx);
      const my = curve(sy);
      if (!mx && !my) return;
      const speed = (camera.speed || 5.5) * Math.min(0.05, Math.max(0, dt)) * 16;

      if (camera.getDirectionToRef) {
        camera.getDirectionToRef(B.Axis.Z, forward);
        camera.getDirectionToRef(B.Axis.X, right);
      } else {
        forward.copyFrom(camera.getDirection(B.Axis.Z));
        right.copyFrom(camera.getDirection(B.Axis.X));
      }
      // Full look direction (pitch included) — no flatten, no up/down buttons
      if (forward.lengthSquared() < 1e-8) forward.copyFromFloats(0, 0, 1);
      else forward.normalize();
      if (right.lengthSquared() < 1e-8) right.copyFromFloats(1, 0, 0);
      else right.normalize();

      // FreeCamera local +Z is behind the view — stick forward uses −Z
      tmp.copyFrom(forward).scaleInPlace(-my * speed);
      camera.cameraDirection.addInPlace(tmp);
      tmp.copyFrom(right).scaleInPlace(mx * speed);
      camera.cameraDirection.addInPlace(tmp);
    },
    dispose() {
      root.remove();
    },
  };
}
