// One undo stack for a forge document.
// begin() before a gesture mutates, commit() after. undo() commits an open
// gesture first, so a stroke still in progress undoes as a single step.

const DEFAULT_LIMIT = 50;

function jsonSame(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createHistory({ limit = DEFAULT_LIMIT, same = jsonSame } = {}) {
  const past = [];
  const future = [];
  let open = null;
  let pointers = 0;
  let holds = 0;
  let suspended = 0;

  function busy() {
    return pointers > 0 || holds > 0;
  }

  function begin(capture) {
    if (suspended || open) return false;
    const snap = capture();
    if (snap == null) return false;
    open = snap;
    return true;
  }

  function commit(capture, { force = false } = {}) {
    if (suspended || !open) return false;
    if (!force && busy()) return false;
    const before = open;
    open = null;
    const after = capture();
    if (after == null || same(before, after)) return false;
    past.push(before);
    if (past.length > limit) past.shift();
    future.length = 0;
    return true;
  }

  function run(dir, capture, restore) {
    if (suspended) return false;
    commit(capture, { force: true });
    const from = dir < 0 ? past : future;
    const to = dir < 0 ? future : past;
    if (!from.length) return false;
    const current = capture();
    if (current == null) return false;
    const next = from.pop();
    to.push(current);
    suspended += 1;
    try {
      restore(next);
    } finally {
      suspended -= 1;
    }
    return true;
  }

  return {
    begin,
    commit,
    cancel() {
      open = null;
    },
    undo(capture, restore) {
      return run(-1, capture, restore);
    },
    redo(capture, restore) {
      return run(1, capture, restore);
    },
    busy,
    suspended() {
      return suspended > 0;
    },
    notePointer(down) {
      if (down) pointers += 1;
      else pointers = Math.max(0, pointers - 1);
    },
    pointerCount() {
      return pointers;
    },
    releasePointers() {
      pointers = 0;
    },
    /** Keep commit() from closing the gesture until the returned function runs. */
    hold() {
      holds += 1;
      let done = false;
      return () => {
        if (done) return;
        done = true;
        holds = Math.max(0, holds - 1);
      };
    },
    pending() {
      return open != null;
    },
    clear() {
      past.length = 0;
      future.length = 0;
      open = null;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
  };
}
