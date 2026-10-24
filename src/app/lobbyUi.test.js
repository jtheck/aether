import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { adventureLobbySources, chapterSelectOptions, customMapSelectOptions, formatCountdown, formatCreateLobbyLabel, formatMatchStatus, formatSeatName, formatStartLabel, formatTypeLobbyRow, groupSelectOptions, setupLobbyUi } from './lobbyUi.js';

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

  it('falls back to a generic title without a room id', () => {
    const row = formatTypeLobbyRow({
      roomId: 'lobby-zzzz-abcdef12',
      hostName: '  ',
      playerCount: 1,
      maxPlayers: 2,
    });
    assert.equal(row.title, 'Open lobby');
    assert.equal(row.meta, '1/2');
  });

  it('labels a 1v1 or teams custom map in the lobby list', () => {
    const row = formatTypeLobbyRow({
      roomId: 'lobby-abc-deadbeef',
      hostName: 'Blind',
      mode: 'teams',
      playerCount: 2,
      maxPlayers: 4,
      settings: { fieldSize: 'small', chapter: 'session' },
    });
    assert.equal(row.meta, '2/4  ·  custom map');
    const story = formatTypeLobbyRow({
      roomId: 'lobby-abc-deadbeef',
      hostName: 'Blind',
      mode: 'adventure',
      playerCount: 1,
      maxPlayers: 4,
      settings: { fieldSize: 'small', chapter: 'pack:opening.garden' },
    });
    assert.equal(story.meta, '1/4  ·  small');
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
    const ladder = formatMatchStatus({
      ranked: true,
      hosting: true,
      mode: 'onevsone',
      playerCount: 2,
      maxPlayers: 2,
      seats: [
        { kind: 'human', name: 'Blind' },
        { kind: 'human', name: 'Aria' },
      ],
    });
    assert.equal(ladder.title, '1v1 Ladder');
    assert.equal(ladder.meta, 'Blind vs Aria');
  });

  it('labels start from the gate and countdown', () => {
    assert.equal(formatStartLabel(false, 'Need 2 players', 0, 'waiting'), 'Need 2 players');
    assert.equal(formatStartLabel(true, '', 0, 'waiting'), 'Start');
    assert.equal(formatStartLabel(true, '', 2500, 'countdown'), 'Starting in 3');
    assert.equal(formatStartLabel(true, '', 0, 'starting'), 'Starting…');
    assert.equal(formatStartLabel(true, '', 0, 'playing'), 'In match');
  });

  it('labels seats with name and you, no user id', () => {
    assert.equal(
      formatSeatName({ name: 'Overseer', userId: 'p2p-aaa111' }, 'p2p-aaa111'),
      'Overseer (you)',
    );
    assert.equal(
      formatSeatName({ name: 'Overseer', userId: 'p2p-bbb222' }, 'p2p-aaa111'),
      'Overseer',
    );
    assert.equal(
      formatSeatName({ name: 'Aria', userId: 'p2p-bbb222', index: 1 }, 'p2p-aaa111', 1),
      '👑 Aria',
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

  it('keeps a subscribed map and the open chapter in separate campaigns', () => {
    const items = [
      { id: '99', title: 'Grove', gardens: [{ file: 'map.garden', name: 'Grove' }] },
    ];
    const sources = adventureLobbySources(items, [], 'workshop:12/maps/02.garden');
    assert.equal(sources.some((s) => s.chapters.some((o) => o.id === 'ch1')), false);
    assert.equal(sources.some((s) => s.chapters.some((o) => o.id === 'e1c1')), false);
    assert.equal(sources.find((s) => s.id === 'workshop')?.chapters[0]?.id, 'workshop:99/map.garden');
    const open = chapterSelectOptions(items, 'workshop:12/maps/02.garden');
    assert.deepEqual(open.map((o) => o.id), ['workshop:12/maps/02.garden']);
    assert.equal(open[0].name, 'Workshop map');
  });

  it('lists a workshop campaign in index order', () => {
    const opts = chapterSelectOptions([
      {
        id: '7',
        title: 'Siege',
        campaign: {
          v: 1,
          kind: 'campaign',
          name: 'Siege',
          episodes: [{
            name: 'The Siege',
            chapters: [
              { file: 'e1c1.garden', name: 'Breach' },
              { file: 'e1c2.garden', name: 'Sally' },
            ],
          }],
        },
        gardens: [
          { file: 'e1c2.garden', name: 'Sally' },
          { file: 'e1c1.garden', name: 'Breach' },
        ],
      },
    ], '');
    const ids = opts.filter((row) => String(row.id).startsWith('workshop:')).map((row) => row.id);
    assert.deepEqual(ids, ['workshop:7/e1c1.garden', 'workshop:7/e1c2.garden']);
    assert.deepEqual(groupSelectOptions(opts).filter((row) => row.group), [
      {
        group: 'The Siege',
        options: [
          { id: 'workshop:7/e1c1.garden', name: 'Breach' },
          { id: 'workshop:7/e1c2.garden', name: 'Sally' },
        ],
      },
    ]);
  });

  it('skips chapters that are off, and an episode with none on', () => {
    const opts = chapterSelectOptions([
      {
        id: '7',
        title: 'Siege',
        campaign: {
          v: 1,
          kind: 'campaign',
          name: 'Siege',
          episodes: [
            {
              name: 'The Siege',
              chapters: [
                { file: 'e1c1.garden', name: 'Breach' },
                { file: 'e1c2.garden', name: 'Sally', live: false },
              ],
            },
            {
              name: 'Later',
              chapters: [{ file: 'e2c1.garden', name: 'Unfinished', live: false }],
            },
          ],
        },
        gardens: [
          { file: 'e1c1.garden', name: 'Breach' },
          { file: 'e1c2.garden', name: 'Sally' },
          { file: 'e2c1.garden', name: 'Unfinished' },
        ],
      },
    ], '');
    const workshop = opts.filter((row) => String(row.id).startsWith('workshop:'));
    assert.deepEqual(workshop.map((row) => row.id), ['workshop:7/e1c1.garden']);
    assert.equal(workshop.some((row) => String(row.name).includes('Later')), false);
    assert.equal(workshop.some((row) => String(row.name).includes('Sally')), false);
  });

  it('does not list the generated catalog as adventure', () => {
    const opts = chapterSelectOptions([], '', '?story=1', 'localhost');
    assert.equal(opts.some((o) => o.id === 'ch1'), false);
    assert.equal(opts.some((o) => o.id === 'e1c1'), false);
  });

  it('lists a loaded web pack ahead of workshop maps', () => {
    const opts = chapterSelectOptions([], 'pack:sally.garden', '', 'localhost', [
      { id: 'pack:sally.garden', name: 'Siege - Sally' },
    ]);
    assert.equal(opts.find((row) => row.id === 'pack:sally.garden')?.name, 'Siege - Sally');
  });

  it('keeps a loaded campaign’s episodes out of the other campaign’s chapters', () => {
    const workshop = {
      id: '7',
      title: 'Siege',
      campaign: {
        v: 1,
        kind: 'campaign',
        name: 'Siege',
        episodes: [{
          name: 'The Siege',
          chapters: [{ file: 'e1c1.garden', name: 'Breach' }],
        }],
      },
      gardens: [{ file: 'e1c1.garden', name: 'Breach' }],
    };
    const local = [
      { id: 'pack:opening.garden', name: 'Opening', group: 'Act 1', campaign: 'Mine' },
      { id: 'pack:next.garden', name: 'Next', group: 'Act 1', campaign: 'Mine' },
      { id: 'pack:later.garden', name: 'Later', group: 'Act 2', campaign: 'Mine' },
    ];
    const sources = adventureLobbySources([workshop], local, 'pack:next.garden');
    assert.deepEqual(sources.map((s) => s.name), ['Mine', 'Siege']);
    const chapters = chapterSelectOptions([workshop], 'pack:next.garden', '', '', local);
    assert.deepEqual(chapters.map((c) => c.id), [
      'pack:opening.garden', 'pack:next.garden', 'pack:later.garden',
    ]);
    assert.deepEqual(groupSelectOptions(chapters).map((row) => row.group), ['Act 1', 'Act 2']);
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
      contains: (name) => this.className.split(/\s+/).includes(name),
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
  const practice = put('menu-solo', new FakeEl('div', { className: 'menu-solo' }));
  const solo = put('solo_ai_b', new FakeEl('button'));
  put('practice-toggle', new FakeEl('button'));
  put('open_replay_b', new FakeEl('button'));
  put('unit_tester_b', new FakeEl('button'));
  put('stressful_b', new FakeEl('button'));
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
  const overlay = put('match-lobby-overlay', new FakeEl('div', { hidden: true }));
  const panel = new FakeEl('div', { className: 'match-lobby-panel', hidden: true });
  overlay.append(panel);
  put('match-over', new FakeEl('div', { hidden: true }));
  put('match-lobby-leave', new FakeEl('button'));
  put('match-lobby-min', new FakeEl('button'));
  put('match-lobby-title', new FakeEl('h3'));
  put('match-lobby-note', new FakeEl('div'));
  put('match-lobby-seats', new FakeEl('div'));
  const sidebar = put('menu-match', new FakeEl('div', { hidden: true }));
  put('menu-match-status', new FakeEl('div'));
  put('menu-match-meta', new FakeEl('div'));
  put('menu-match-seats', new FakeEl('div'));
  put('menu-match-ready', new FakeEl('button'));
  put('menu-match-start', new FakeEl('button', { hidden: true }));
  put('menu-match-leave', new FakeEl('button'));
  return {
    drawers,
    practice,
    solo,
    overlay: byId.get('match-lobby-overlay'),
    panel,
    score: byId.get('match-over'),
    leave: byId.get('match-lobby-leave'),
    min: byId.get('match-lobby-min'),
    title: byId.get('match-lobby-title'),
    note: byId.get('match-lobby-note'),
    seats: byId.get('match-lobby-seats'),
    sidebar,
    sideStatus: byId.get('menu-match-status'),
    sideMeta: byId.get('menu-match-meta'),
    sideReady: byId.get('menu-match-ready'),
    sideLeave: byId.get('menu-match-leave'),
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
        createElement: (tag) => new FakeEl(tag),
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

describe('custom map picker', () => {
  it('lists loaded and fitting maps, not a generated field', () => {
    const opts = customMapSelectOptions([
      {
        id: '10',
        title: 'Duel',
        gardens: [{ file: 'map.garden', name: 'Duel', mapType: 'onevsone' }],
      },
      {
        id: '11',
        title: 'Lanes',
        gardens: [{ file: 'map.garden', name: 'Lanes', mapType: 'teams' }],
      },
      {
        id: '12',
        title: 'Tale',
        campaign: {
          kind: 'campaign',
          episodes: [{ chapters: [{ file: 'opening.garden', name: 'Opening' }] }],
        },
        gardens: [{ file: 'opening.garden', name: 'Opening' }],
      },
      {
        id: '13',
        title: 'Open',
        gardens: [{ file: 'map.garden', name: 'Open' }],
      },
    ], 'session', [{ id: 'session', name: 'My map' }], 'onevsone', []);
    assert.deepEqual(opts.map((row) => row.name), ['My map', 'Duel', 'Open']);
    assert.equal(opts[0].id, 'session');
  });
});

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
          { kind: 'human', name: 'Blind', userId: 'u1', ready: true, index: 0 },
          { kind: 'human', name: 'Aria', userId: 'u2', ready: true, index: 1 },
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
          lockstepWaiters: () => (stalled ? [1] : []),
        },
        getUserId: () => 'u1',
      });
      assert.equal(dom.overlay.hidden, true);
      assert.equal(dom.overlay.className.includes('is-lag'), false);
      stalled = true;
      ui.refresh();
      assert.equal(dom.overlay.hidden, false);
      assert.equal(dom.overlay.className.includes('is-lag'), true);
      assert.equal(dom.title.textContent, 'Aria is lagging');
      assert.equal(dom.note.textContent, 'Aria is lagging');
      const statuses = dom.seats.querySelectorAll('.lobby-seat-status').map((el) => el.textContent);
      assert.deepEqual(statuses, ['Ready', 'lagging']);
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

  it('parks the match lobby to the corner', () => {
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
      assert.equal(dom.overlay.className.includes('is-parked'), false);
      assert.equal(dom.min.textContent, '−');
      dom.min.click();
      assert.equal(dom.overlay.className.includes('is-parked'), true);
      assert.equal(dom.min.getAttribute('aria-label'), 'Expand lobby');
      assert.equal(dom.min.textContent, '+');
      dom.min.click();
      assert.equal(dom.overlay.className.includes('is-parked'), false);
      assert.equal(dom.min.getAttribute('aria-label'), 'Minimize lobby');
      assert.equal(dom.min.textContent, '−');
    } finally {
      restore();
    }
  });

  it('can park the overlay from the controller', () => {
    const dom = lobbyDom();
    const restore = dom.install();
    try {
      const ui = setupLobbyUi({
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
      ui.setOverlayParked(true);
      assert.equal(dom.overlay.className.includes('is-parked'), true);
    } finally {
      restore();
    }
  });

  it('shows a ladder match in the menu with forfeit', () => {
    const dom = lobbyDom();
    const restore = dom.install();
    try {
      let left = 0;
      setupLobbyUi({
        gameLobby: { listLobbies: () => [], listen() {}, unlisten() {} },
        matchLobby: {
          isActive: () => true,
          getState: () => ({
            mode: 'onevsone',
            ranked: true,
            hosting: false,
            phase: 'playing',
            playerCount: 2,
            maxPlayers: 2,
            hostName: 'Aria',
            seats: [
              { kind: 'human', name: 'Aria', userId: 'u2', ready: true, index: 0 },
              { kind: 'human', name: 'Blind', userId: 'u1', ready: true, index: 1 },
            ],
            settings: { fieldSize: 'small', seed: 1, chapter: '' },
          }),
          canStart: () => false,
          startBlockReason: () => '',
          countdownMs: () => 0,
          lockstepStalled: () => false,
          leaveRoom() { left += 1; },
        },
        getUserId: () => 'u1',
      });
      assert.equal(dom.sidebar.hidden, false);
      assert.equal(dom.sideStatus.textContent, '1v1 Ladder');
      assert.equal(dom.sideMeta.textContent, 'Aria vs Blind');
      assert.equal(dom.sideReady.hidden, true);
      assert.equal(dom.sideLeave.textContent, 'Forfeit');
      assert.equal(dom.overlay.hidden, true);
      dom.sideLeave.click();
      assert.equal(left, 1);
      assert.equal(dom.practice.className.includes('is-dimmed'), true);
      assert.equal(dom.solo.disabled, true);
      assert.equal(dom.drawers.className.includes('is-dimmed'), true);
    } finally {
      restore();
    }
  });

  it('unlocks practice when no match is open', () => {
    const dom = lobbyDom();
    const restore = dom.install();
    try {
      setupLobbyUi({
        gameLobby: { listLobbies: () => [], listen() {}, unlisten() {} },
        matchLobby: {
          isActive: () => false,
          getState: () => null,
          canStart: () => false,
          startBlockReason: () => '',
          countdownMs: () => 0,
          lockstepStalled: () => false,
        },
        getUserId: () => 'u1',
      });
      assert.equal(dom.practice.className.includes('is-dimmed'), false);
      assert.equal(dom.solo.disabled, false);
    } finally {
      restore();
    }
  });

  it('shows a score card when no lobby is open', () => {
    const dom = lobbyDom();
    dom.score.hidden = false;
    const restore = dom.install();
    try {
      setupLobbyUi({
        gameLobby: { listLobbies: () => [], listen() {}, unlisten() {} },
        matchLobby: {
          isActive: () => false,
          getState: () => null,
          canStart: () => false,
          startBlockReason: () => '',
          countdownMs: () => 0,
          lockstepStalled: () => false,
        },
      });
      assert.equal(dom.overlay.hidden, false);
      assert.equal(dom.panel.hidden, false);
      assert.equal(dom.score.hidden, false);
      assert.equal(dom.leave.hidden, false);
      assert.equal(dom.leave.textContent, 'Play again');
      assert.equal(dom.overlay.className.includes('is-ranked-result'), true);
    } finally {
      restore();
    }
  });
});
