import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCountdown, formatCreateLobbyLabel, formatMatchStatus, formatSeatName, formatStartLabel, formatTypeLobbyRow, setupLobbyUi } from './lobbyUi.js';

describe('lobby ui copy', () => {
  it('formats a type-list row', () => {
    const row = formatTypeLobbyRow({
      roomId: 'lobby-abc-deadbeef',
      hostName: 'Blind',
      playerCount: 2,
      maxPlayers: 4,
      settings: { fieldSize: 'small' },
    });
    assert.equal(row.title, 'Blind');
    assert.equal(row.meta, '2/4  ·  small');
    assert.match(row.label, /Join Blind/);
  });

  it('falls back to a short room id', () => {
    const row = formatTypeLobbyRow({
      roomId: 'lobby-zzzz-abcdef12',
      hostName: '  ',
      playerCount: 1,
      maxPlayers: 2,
    });
    assert.equal(row.title, '…abcdef12');
    assert.equal(row.meta, '1/2');
  });

  it('describes hosted versus joined match status', () => {
    const hosted = formatMatchStatus({
      hosting: true,
      mode: 'teams',
      hostName: 'Overseer',
      playerCount: 1,
      maxPlayers: 4,
    });
    assert.equal(hosted.title, 'Your Teams');
    const joined = formatMatchStatus({
      hosting: false,
      mode: 'onevsone',
      hostName: 'Overseer',
      playerCount: 2,
      maxPlayers: 2,
    });
    assert.equal(joined.title, "In Overseer's 1 vs 1");
  });

  it('labels start from the gate and countdown', () => {
    assert.equal(formatStartLabel(false, 'Need 2 players', 0, 'waiting'), 'Need 2 players');
    assert.equal(formatStartLabel(true, '', 0, 'waiting'), 'Start');
    assert.equal(formatStartLabel(true, '', 2500, 'countdown'), 'Starting in 3');
    assert.equal(formatStartLabel(true, '', 0, 'starting'), 'Starting…');
    assert.equal(formatStartLabel(true, '', 0, 'playing'), 'In match');
  });

  it('labels seats with name, short id, and you', () => {
    assert.equal(
      formatSeatName({ name: 'Overseer', userId: 'p2p-aaa111' }, 'p2p-aaa111'),
      'Overseer · aaa111 (you)',
    );
    assert.equal(
      formatSeatName({ name: 'Overseer', userId: 'p2p-bbb222' }, 'p2p-aaa111'),
      'Overseer · bbb222',
    );
  });

  it('formats countdown seconds', () => {
    assert.equal(formatCountdown(3000), 'Starting in 3');
    assert.equal(formatCountdown(0), 'Starting…');
  });

  it('names create buttons after the mode', () => {
    assert.equal(formatCreateLobbyLabel('onevsone'), 'Create 1 vs 1 lobby');
    assert.equal(formatCreateLobbyLabel('teams'), 'Create Teams lobby');
    assert.equal(formatCreateLobbyLabel('adventure'), 'Create Adventure lobby');
  });
});

class FakeEl {
  constructor(tag = 'div', attrs = {}) {
    this.tagName = String(tag).toUpperCase();
    this.id = attrs.id || '';
    this.hidden = Boolean(attrs.hidden);
    this.className = attrs.className || '';
    this.dataset = { ...(attrs.dataset || {}) };
    this.attrs = { ...(attrs.attrs || {}) };
    this.children = [];
    this.listeners = {};
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.style = {};
    this.classList = {
      toggle: (name, on) => {
        const parts = new Set(this.className.split(/\s+/).filter(Boolean));
        if (on) parts.add(name);
        else parts.delete(name);
        this.className = [...parts].join(' ');
      },
    };
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }

  click() {
    for (const fn of this.listeners.click || []) fn({ target: this });
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
  }

  querySelector(sel) {
    return this.querySelectorAll(sel)[0] ?? null;
  }

  querySelectorAll(sel) {
    const out = [];
    const walk = (node) => {
      if (fakeMatches(node, sel)) out.push(node);
      for (const child of node.children) walk(child);
    };
    for (const child of this.children) walk(child);
    return out;
  }
}

function fakeMatches(node, sel) {
  if (sel.startsWith('.')) return node.className.split(/\s+/).includes(sel.slice(1));
  const dataMode = sel.match(/^\[data-mode="([^"]+)"\]$/);
  if (dataMode) return node.dataset.mode === dataMode[1];
  if (sel === 'button, input, select') return ['BUTTON', 'INPUT', 'SELECT'].includes(node.tagName);
  return false;
}

function lobbyDom() {
  const byId = new Map();
  const put = (id, el) => {
    el.id = id;
    byId.set(id, el);
    return el;
  };
  const drawers = put('menu-lobbies', new FakeEl('div'));
  for (const mode of ['onevsone', 'teams', 'adventure']) {
    const drawer = new FakeEl('div', { dataset: { mode } });
    drawer.append(
      new FakeEl('button', { className: 'lobby-drawer-toggle', attrs: { 'aria-expanded': 'false' } }),
      (() => {
        const body = new FakeEl('div', { className: 'lobby-drawer-body', hidden: true });
        body.append(
          new FakeEl('div', { className: 'lobby-type-list' }),
          new FakeEl('div', { className: 'lobby-type-empty' }),
          new FakeEl('button', { className: 'lobby-create' }),
        );
        return body;
      })(),
    );
    drawers.append(drawer);
  }
  put('match-lobby-overlay', new FakeEl('div', { hidden: true }));
  return {
    drawers,
    overlay: byId.get('match-lobby-overlay'),
    create(mode) {
      return drawers.querySelector(`[data-mode="${mode}"]`).querySelector('.lobby-create');
    },
    toggle(mode) {
      return drawers.querySelector(`[data-mode="${mode}"]`).querySelector('.lobby-drawer-toggle');
    },
    install() {
      const prev = globalThis.document;
      globalThis.document = {
        getElementById: (id) => byId.get(id) ?? null,
      };
      return () => {
        if (prev === undefined) delete globalThis.document;
        else globalThis.document = prev;
      };
    },
  };
}

function waitingState(mode = 'adventure') {
  return {
    mode,
    hosting: true,
    phase: 'waiting',
    playerCount: 1,
    maxPlayers: 4,
    hostName: 'Blind',
    seats: [{ kind: 'human', name: 'Blind', userId: 'u1', ready: true }],
    settings: { fieldSize: 'small', seed: 1, chapter: 'ch1' },
  };
}

describe('match lobby overlay', () => {
  it('closes the side menu when a regular lobby opens', () => {
    const dom = lobbyDom();
    const restore = dom.install();
    try {
      let active = false;
      let closed = 0;
      const matchLobby = {
        isActive: () => active,
        getState: () => (active ? waitingState() : null),
        canStart: () => true,
        startBlockReason: () => '',
        countdownMs: () => 0,
        createRoom() { active = true; },
        joinRoom() { active = true; },
      };
      setupLobbyUi({
        gameLobby: { listLobbies: () => [], listen() {}, unlisten() {} },
        matchLobby,
        getUserId: () => 'u1',
        onCloseMenu: () => { closed += 1; },
      });
      assert.equal(closed, 0);
      assert.equal(dom.overlay.hidden, true);

      dom.toggle('adventure').click();
      assert.equal(closed, 0);

      dom.create('adventure').click();
      assert.equal(closed, 1);
      assert.equal(dom.overlay.hidden, false);
    } finally {
      restore();
    }
  });

  it('does not close the side menu again while the lobby stays open', () => {
    const dom = lobbyDom();
    const restore = dom.install();
    try {
      const state = waitingState();
      let closed = 0;
      const ui = setupLobbyUi({
        gameLobby: { listLobbies: () => [], listen() {}, unlisten() {} },
        matchLobby: {
          isActive: () => true,
          getState: () => state,
          canStart: () => true,
          startBlockReason: () => '',
          countdownMs: () => 0,
        },
        getUserId: () => 'u1',
        onCloseMenu: () => { closed += 1; },
      });
      assert.equal(closed, 1);
      state.settings.seed = 2;
      ui.refresh();
      assert.equal(closed, 1);
    } finally {
      restore();
    }
  });

  it('shows the lobby in the corner when lockstep stalls mid-match', () => {
    const dom = lobbyDom();
    const restore = dom.install();
    try {
      let stalled = false;
      const state = {
        ...waitingState('onevsone'),
        phase: 'playing',
        playerCount: 2,
        seats: [
          { kind: 'human', name: 'Blind', userId: 'u1', ready: true },
          { kind: 'human', name: 'Aria', userId: 'u2', ready: true },
        ],
      };
      const ui = setupLobbyUi({
        gameLobby: { listLobbies: () => [], listen() {}, unlisten() {} },
        matchLobby: {
          isActive: () => true,
          getState: () => state,
          canStart: () => false,
          startBlockReason: () => '',
          countdownMs: () => 0,
          lockstepStalled: () => stalled,
        },
        getUserId: () => 'u1',
      });
      assert.equal(dom.overlay.hidden, true);
      assert.equal(dom.overlay.className.includes('is-lag'), false);
      stalled = true;
      ui.refresh();
      assert.equal(dom.overlay.hidden, false);
      assert.equal(dom.overlay.className.includes('is-lag'), true);
    } finally {
      restore();
    }
  });

  it('keeps a new-match lobby centered', () => {
    const dom = lobbyDom();
    const restore = dom.install();
    try {
      setupLobbyUi({
        gameLobby: { listLobbies: () => [], listen() {}, unlisten() {} },
        matchLobby: {
          isActive: () => true,
          getState: () => waitingState(),
          canStart: () => true,
          startBlockReason: () => '',
          countdownMs: () => 0,
          lockstepStalled: () => false,
        },
        getUserId: () => 'u1',
      });
      assert.equal(dom.overlay.hidden, false);
      assert.equal(dom.overlay.className.includes('is-lag'), false);
    } finally {
      restore();
    }
  });
});
