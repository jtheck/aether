// Main-thread bridge to the sim worker.

import {
  simSharedByteSize,
  mapSharedState,
  simViewFacade,
  SHARED_LAYOUT_VERSION,
} from '../sim/sharedState.js';

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
    /** @type {{ tick: number, reject: (err: Error) => void } | null} */
    this._tickWait = null;
    this.worker.onmessage = (e) => this._onMessage(e);
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'sim worker failed');
      if (this._tickWait) this._tickWait.reject(err);
      else throw err;
    };
  }

  init(config) {
    return new Promise((resolve, reject) => {
      this._initResolve = resolve;
      this._initReject = reject;
      this.worker.postMessage({ type: 'init', config, sab: this.sab });
    });
  }

  /** Latest field snapshot from worker init (static after gen). */
  get field() {
    return this._field ?? null;
  }

  onStepDone(handler) {
    this._stepDoneHandler = handler;
  }

  /** Commit one lockstep tick with merged human command frames. */
  commitTick(tick, frames) {
    this.worker.postMessage({ type: 'commitTick', tick, frames });
  }

  /** Await one tick commit (catch-up replay). */
  commitTickAsync(tick, frames) {
    return new Promise((resolve, reject) => {
      if (this._tickWait) {
        reject(new Error(`commitTick ${tick} busy (waiting on ${this._tickWait.tick})`));
        return;
      }
      const prev = this._stepDoneHandler;
      let settled = false;
      const finish = (fn) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this._tickWait = null;
        this._stepDoneHandler = prev;
        fn();
      };
      const timeout = setTimeout(() => {
        finish(() => reject(new Error(`commitTick ${tick} timeout`)));
      }, 30_000);
      this._tickWait = { tick, reject: (err) => finish(() => reject(err)) };
      this._stepDoneHandler = (doneTick, checksum, extra) => {
        if (doneTick !== tick) {
          finish(() =>
            reject(new Error(`commitTick expected ${tick}, got ${doneTick}`)),
          );
          return;
        }
        finish(() => resolve({ tick: doneTick, checksum, extra }));
      };
      this.worker.postMessage({ type: 'commitTick', tick, frames });
    });
  }

  terminate() {
    this.worker.terminate();
  }

  _onMessage(e) {
    const msg = e.data;
    if (msg.type === 'ready') {
      if (msg.layoutVersion !== SHARED_LAYOUT_VERSION) {
        this._initReject?.(
          new Error(`shared layout mismatch: worker ${msg.layoutVersion}, main ${SHARED_LAYOUT_VERSION}`),
        );
        this._initReject = null;
        return;
      }
      this._field = msg.field ?? null;
      this._initResolve?.({ count: msg.count, field: this._field });
      this._initResolve = null;
    } else if (msg.type === 'stepDone') {
      this._stepDoneHandler?.(msg.tick, msg.checksum, {
        koth: msg.koth,
        kothMatchOver: msg.kothMatchOver,
        metrics: msg.metrics,
        treeUpdates: msg.treeUpdates ?? null,
        fireZoneUpdates: msg.fireZoneUpdates ?? null,
        frogUpdates: msg.frogUpdates ?? null,
        lightningUpdates: msg.lightningUpdates ?? null,
        holyArmorUpdates: msg.holyArmorUpdates ?? null,
        sporeBloomUpdates: msg.sporeBloomUpdates ?? null,
        monkKickUpdates: msg.monkKickUpdates ?? null,
      });
    } else if (msg.type === 'error') {
      const err = new Error(msg.message);
      if (msg.stack) err.stack = msg.stack;
      if (this._initReject) {
        this._initReject(err);
        this._initReject = null;
      } else if (this._tickWait) {
        this._tickWait.reject(err);
      } else {
        throw err;
      }
    }
  }
}
