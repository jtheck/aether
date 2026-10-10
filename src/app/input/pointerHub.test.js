import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isRmbPassthroughTarget, setupPointerHub } from './pointerHub.js';

function el(id, parent = null) {
  const node = {
    id,
    parentElement: parent,
    nodeType: 1,
    closest(selector) {
      const ids = selector.split(',').map((part) => part.trim());
      let current = this;
      while (current) {
        if (ids.includes(`#${current.id}`)) return current;
        current = current.parentElement;
      }
      return null;
    },
  };
  return node;
}

function event(type, target, extra = {}) {
  let prevented = false;
  let stopped = false;
  return {
    type,
    target,
    button: 0,
    buttons: 1,
    clientX: 40,
    clientY: 80,
    pointerId: 3,
    pointerType: 'mouse',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    ...extra,
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; },
    get defaultPrevented() { return prevented; },
    get propagationStopped() { return stopped; },
  };
}

function installDom() {
  const prev = {
    document: globalThis.document,
    window: globalThis.window,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  /** @type {Map<string, Function[]>} */
  const listeners = new Map();
  function add(type, fn, opts) {
    const capture = opts === true || opts?.capture === true;
    const key = `${capture ? 'c:' : ''}${type}`;
    const list = listeners.get(key) ?? [];
    list.push(fn);
    listeners.set(key, list);
  }
  function remove(type, fn, opts) {
    const capture = opts === true || opts?.capture === true;
    const key = `${capture ? 'c:' : ''}${type}`;
    listeners.set(key, (listeners.get(key) ?? []).filter((h) => h !== fn));
  }
  const canvas = {
    contains(node) { return node === canvas; },
    addEventListener() {},
    removeEventListener() {},
  };
  const doc = {
    visibilityState: 'visible',
    getElementById() { return null; },
    addEventListener: add,
    removeEventListener: remove,
  };
  const win = {
    document: doc,
    addEventListener: add,
    removeEventListener: remove,
  };
  globalThis.document = doc;
  globalThis.window = win;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};

  function dispatch(type, e, elementListener) {
    for (const fn of listeners.get(`c:${type}`) ?? []) {
      fn(e);
      if (e.propagationStopped) return;
    }
    elementListener?.(e);
    if (e.propagationStopped) return;
    for (const fn of listeners.get(type) ?? []) fn(e);
  }

  return {
    canvas,
    dispatch,
    restore() {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    },
  };
}

function harness(active = () => true) {
  const dom = installDom();
  const camera = {
    panning: false,
    didPan: false,
    downs: 0,
    moves: 0,
    ups: 0,
    isRmbPanning() { return this.panning; },
    handlePointerDown() { this.downs += 1; this.panning = true; },
    handlePointerMove() { this.moves += 1; this.didPan = true; },
    handlePointerUp() {
      this.ups += 1;
      const did = this.didPan;
      this.panning = false;
      this.didPan = false;
      return did;
    },
    handleWheel() {},
    handleKeyDown() {},
    handleKeyUp() {},
    clearKeyStates() {},
    clearVelocity() {},
  };
  const game = {
    cancels: 0,
    downs: 0,
    moves: [],
    menus: false,
    cancelDrag() { this.cancels += 1; },
    handlePointerDown() { this.downs += 1; },
    handlePointerMove() {},
    handlePointerUp() {},
    dismissMenus() { return this.menus; },
    forceMoveAt(x, y) { this.moves.push([x, y]); },
  };
  const hub = setupPointerHub({ canvas: dom.canvas, camera, game, active });
  return {
    ...dom,
    camera,
    game,
    dispose() {
      hub.dispose();
      dom.restore();
    },
  };
}

describe('isRmbPassthroughTarget', () => {
  it('matches playfield chrome and not the menu drawer', () => {
    const chat = el('chat-hud');
    const input = el('chat-input', chat);
    const replay = el('replay-watch');
    const scrub = el('replay-scrub', replay);
    const transport = el('story-transport');
    const menu = el('menu_b');
    const graffiti = el('graffiti_b');
    const drawer = el('side_menu');
    const drawerBtn = el('solo_ai_b', drawer);

    assert.equal(isRmbPassthroughTarget(input), true);
    assert.equal(isRmbPassthroughTarget(scrub), true);
    assert.equal(isRmbPassthroughTarget(el('play', transport)), true);
    assert.equal(isRmbPassthroughTarget(menu), true);
    assert.equal(isRmbPassthroughTarget(graffiti), true);
    assert.equal(isRmbPassthroughTarget(drawerBtn), false);
    assert.equal(isRmbPassthroughTarget(null), false);
  });
});

describe('setupPointerHub right-click chrome', () => {
  it('pans through chat, replay, scene controls, and the menu button', () => {
    const h = harness();
    try {
      let widgetSaw = 0;
      const swallow = (e) => {
        widgetSaw += 1;
        e.stopPropagation();
      };
      const chat = el('chat-hud');
      const down = event('pointerdown', el('chat-row', chat), { button: 2, buttons: 2 });
      h.dispatch('pointerdown', down, swallow);
      assert.equal(widgetSaw, 0);
      assert.equal(down.defaultPrevented, true);
      assert.equal(h.camera.downs, 1);
      assert.equal(h.game.cancels, 1);
      assert.equal(h.game.downs, 0);

      h.dispatch('pointermove', event('pointermove', el('chat-row', chat), { button: 2, buttons: 2 }));
      assert.equal(h.camera.moves, 1);

      const up = event('pointerup', el('menu_b'), { button: 2, buttons: 0 });
      h.dispatch('pointerup', up);
      assert.equal(h.camera.ups, 1);
      assert.deepEqual(h.game.moves, []);

      for (const id of ['replay-watch', 'story-transport', 'menu_b', 'graffiti_b']) {
        const click = event('pointerdown', el(id), { button: 2, buttons: 2, pointerId: 4 });
        h.dispatch('pointerdown', click, swallow);
        const release = event('pointerup', el(id), { button: 2, buttons: 0, pointerId: 4 });
        h.dispatch('pointerup', release);
      }
      assert.equal(h.camera.downs, 5);
      assert.equal(h.game.moves.length, 4);
    } finally {
      h.dispose();
    }
  });

  it('still left-clicks the control and ignores the side menu', () => {
    const h = harness();
    try {
      let clicks = 0;
      const menu = event('pointerdown', el('menu_b'), { button: 0, buttons: 1 });
      h.dispatch('pointerdown', menu, () => { clicks += 1; });
      assert.equal(clicks, 1);
      assert.equal(menu.defaultPrevented, false);
      assert.equal(h.camera.downs, 0);
      assert.equal(h.game.downs, 0);

      const drawer = event('pointerdown', el('solo_ai_b', el('side_menu')), { button: 2, buttons: 2 });
      h.dispatch('pointerdown', drawer);
      assert.equal(drawer.defaultPrevented, false);
      assert.equal(h.camera.downs, 0);

      const menuEvt = event('contextmenu', el('chat-log', el('chat-hud')), { button: 2 });
      h.dispatch('contextmenu', menuEvt);
      assert.equal(menuEvt.defaultPrevented, true);

      const canvasMenu = event('contextmenu', h.canvas, { button: 2 });
      h.dispatch('contextmenu', canvasMenu);
      assert.equal(canvasMenu.defaultPrevented, true);
    } finally {
      h.dispose();
    }
  });

  it('suppresses the menu on chrome while input is locked', () => {
    const h = harness(() => false);
    try {
      const down = event('pointerdown', el('replay-play', el('replay-watch')), { button: 2, buttons: 2 });
      h.dispatch('pointerdown', down);
      assert.equal(down.defaultPrevented, true);
      assert.equal(h.camera.downs, 0);
      const menuEvt = event('contextmenu', el('story-transport'), { button: 2 });
      h.dispatch('contextmenu', menuEvt);
      assert.equal(menuEvt.defaultPrevented, true);
    } finally {
      h.dispose();
    }
  });
});
