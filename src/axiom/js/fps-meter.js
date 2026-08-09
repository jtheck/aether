/**
 * DOM FPS overlay + ~1Hz samples for throttle.
 * Pass per-frame work ms into tick() so throttle can see headroom under vsync.
 */
export class FPSMeter {
  /**
   * @param {object} opts
   * @param {(sample: { fps: number, frameMs: number }) => void} [opts.onSample]
   */
  constructor(opts = {}) {
    this.fps = 60;
    this.frameMs = 16.67;
    this.frameCount = 0;
    this.workSum = 0;
    this.lastTime = performance.now();
    this.onSample = opts.onSample || null;
    this._extra = '';
    this.createFPSDisplay();
  }

  createFPSDisplay() {
    this.fpsDiv = document.createElement('div');
    this.fpsDiv.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: #00ff00;
      font-family: 'Courier New', monospace;
      font-size: 14px;
      padding: 5px 10px;
      border-radius: 3px;
      z-index: 1000;
      pointer-events: none;
      user-select: none;
    `;
    this.fpsDiv.textContent = 'FPS: --';
    document.body.appendChild(this.fpsDiv);
  }

  /**
   * Call once per rendered frame.
   * @param {number} [workMs] CPU/GPU work for this frame (not RAF interval)
   */
  tick(workMs) {
    this.frameCount++;
    if (typeof workMs === 'number' && workMs >= 0) this.workSum += workMs;

    const now = performance.now();
    if (now - this.lastTime >= 1000) {
      this.fps = this.frameCount;
      this.frameMs =
        this.frameCount > 0 ? this.workSum / this.frameCount : 16.67;
      this.frameCount = 0;
      this.workSum = 0;
      this.lastTime = now;

      let color = '#00ff00';
      if (this.fps < 30 || this.frameMs > 28) color = '#ff0000';
      else if (this.fps < 50 || this.frameMs > 17) color = '#ffff00';
      this.fpsDiv.style.color = color;
      this._paint();

      if (this.onSample) this.onSample({ fps: this.fps, frameMs: this.frameMs });
    }
  }

  setExtra(text) {
    this._extra = text || '';
    this._paint();
  }

  _paint() {
    const ms =
      this.frameMs > 0 ? ` ${this.frameMs.toFixed(1)}ms` : '';
    this.fpsDiv.textContent = `FPS: ${this.fps}${ms}${
      this._extra ? ` | ${this._extra}` : ''
    }`;
  }

  dispose() {
    if (this.fpsDiv?.parentNode) this.fpsDiv.parentNode.removeChild(this.fpsDiv);
  }
}
