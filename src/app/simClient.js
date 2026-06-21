// Main-thread bridge to the sim worker.

import { simSharedByteSize, mapSharedState, simViewFacade } from '../sim/sharedState.js';

export class SimClient {
  constructor() {
    if (typeof SharedArrayBuffer === 'undefined') {
      throw new Error('SharedArrayBuffer unavailable — serve with COOP/COEP (node serve.mjs).');
    }
    this.sab = new SharedArrayBuffer(simSharedByteSize());
    this.views = mapSharedState(this.sab);
    this.state = simViewFacade(this.views);
    this.worker = new Worker(new URL('./sim.worker.js', import.meta.url), { type: 'module' });
    this._stepDoneHandler = null;
    this.worker.onmessage = (e) => this._onMessage(e);
    this.worker.onerror = (e) => {
      throw new Error(e.message || 'sim worker failed');
    };
  }

  init(config) {
    return new Promise((resolve, reject) => {
      this._initResolve = resolve;
      this._initReject = reject;
      this.worker.postMessage({ type: 'init', config, sab: this.sab });
    });
  }

  onStepDone(handler) {
    this._stepDoneHandler = handler;
  }

  /** Commit one lockstep tick with merged human command frames. */
  commitTick(tick, frames) {
    this.worker.postMessage({ type: 'commitTick', tick, frames });
  }

  terminate() {
    this.worker.terminate();
  }

  _onMessage(e) {
    const msg = e.data;
    if (msg.type === 'ready') {
      this._initResolve?.({ count: msg.count });
      this._initResolve = null;
    } else if (msg.type === 'stepDone') {
      this._stepDoneHandler?.(msg.tick, msg.checksum);
    } else if (msg.type === 'error') {
      const err = new Error(msg.message);
      if (msg.stack) err.stack = msg.stack;
      if (this._initReject) {
        this._initReject(err);
        this._initReject = null;
      } else {
        throw err;
      }
    }
  }
}
