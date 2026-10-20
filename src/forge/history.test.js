import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHistory } from './history.js';

function stack() {
  let doc = { n: 0 };
  const hist = createHistory({ limit: 3 });
  const capture = () => ({ n: doc.n });
  const restore = (snap) => { doc = { n: snap.n }; };
  return {
    hist,
    capture,
    restore,
    get n() { return doc.n; },
    set n(v) { doc = { n: v }; },
  };
}

describe('forge history', () => {
  it('undo and redo one committed edit', () => {
    const s = stack();
    s.hist.begin(s.capture);
    s.n = 1;
    assert.equal(s.hist.commit(s.capture), true);
    assert.equal(s.hist.canUndo, true);
    assert.equal(s.hist.canRedo, false);
    assert.equal(s.hist.undo(s.capture, s.restore), true);
    assert.equal(s.n, 0);
    assert.equal(s.hist.canRedo, true);
    assert.equal(s.hist.redo(s.capture, s.restore), true);
    assert.equal(s.n, 1);
    assert.equal(s.hist.redo(s.capture, s.restore), false);
  });

  it('drops a gesture that did not change the document and keeps redo', () => {
    const s = stack();
    s.hist.begin(s.capture);
    s.n = 1;
    s.hist.commit(s.capture);
    s.hist.undo(s.capture, s.restore);
    s.hist.begin(s.capture);
    assert.equal(s.hist.commit(s.capture), false);
    assert.equal(s.hist.canRedo, true);
    s.n = 4;
    s.hist.begin(s.capture);
    s.n = 5;
    s.hist.commit(s.capture);
    assert.equal(s.hist.canRedo, false);
    assert.equal(s.n, 5);
  });

  it('treats a pointer stroke as one step', () => {
    const s = stack();
    s.hist.notePointer(true);
    s.hist.begin(s.capture);
    s.n = 1;
    assert.equal(s.hist.commit(s.capture), false);
    s.n = 2;
    s.hist.notePointer(false);
    assert.equal(s.hist.commit(s.capture), true);
    assert.equal(s.hist.undo(s.capture, s.restore), true);
    assert.equal(s.n, 0);
    assert.equal(s.hist.redo(s.capture, s.restore), true);
    assert.equal(s.n, 2);
  });

  it('undoes an open stroke without waiting for pointer-up', () => {
    const s = stack();
    s.hist.notePointer(true);
    s.hist.begin(s.capture);
    s.n = 7;
    assert.equal(s.hist.undo(s.capture, s.restore), true);
    assert.equal(s.n, 0);
    assert.equal(s.hist.canRedo, true);
  });

  it('holds an async edit as one step', () => {
    const s = stack();
    s.hist.begin(s.capture);
    const release = s.hist.hold();
    s.n = 1;
    assert.equal(s.hist.commit(s.capture), false);
    s.n = 2;
    release();
    release();
    assert.equal(s.hist.commit(s.capture), true);
    s.hist.undo(s.capture, s.restore);
    assert.equal(s.n, 0);
  });

  it('forgets entries past the limit', () => {
    const s = stack();
    for (let i = 1; i <= 5; i += 1) {
      s.hist.begin(s.capture);
      s.n = i;
      s.hist.commit(s.capture);
    }
    assert.equal(s.n, 5);
    assert.equal(s.hist.undo(s.capture, s.restore), true);
    assert.equal(s.n, 4);
    assert.equal(s.hist.undo(s.capture, s.restore), true);
    assert.equal(s.n, 3);
    assert.equal(s.hist.undo(s.capture, s.restore), true);
    assert.equal(s.n, 2);
    assert.equal(s.hist.undo(s.capture, s.restore), false);
    assert.equal(s.n, 2);
  });

  it('does not replace the snapshot already opened for a gesture', () => {
    const s = stack();
    assert.equal(s.hist.begin(s.capture), true);
    s.n = 1;
    assert.equal(s.hist.begin(s.capture), false);
    s.n = 2;
    s.hist.commit(s.capture);
    s.hist.undo(s.capture, s.restore);
    assert.equal(s.n, 0);
  });

  it('clear drops both directions', () => {
    const s = stack();
    s.hist.begin(s.capture);
    s.n = 1;
    s.hist.commit(s.capture);
    s.hist.undo(s.capture, s.restore);
    s.hist.clear();
    assert.equal(s.hist.canUndo, false);
    assert.equal(s.hist.canRedo, false);
    assert.equal(s.hist.undo(s.capture, s.restore), false);
  });
});
