import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OS_KBD_ID,
  applyOsKbdKey,
  closeOsKbd,
  osKbdRoot,
  osKbdStartMode,
  openOsKbd,
  stepOsKbdFocus,
} from './osKbd.js';

describe('applyOsKbdKey', () => {
  it('types, spaces, backs up, and respects max + replace', () => {
    assert.equal(applyOsKbdKey('Cat', 's', 24), 'Cats');
    assert.equal(applyOsKbdKey('Cat', 'space', 24), 'Cat ');
    assert.equal(applyOsKbdKey('Cat', 'back', 24), 'Ca');
    assert.equal(applyOsKbdKey('Cultivator', 'W', 24, true), 'W');
    assert.equal(applyOsKbdKey('Cultivator', 'back', 24, true), 'Cultivato');
    assert.equal(applyOsKbdKey('abcd', 'e', 4), 'abcd');
    assert.equal(applyOsKbdKey('ab', 'shift', 24), 'ab');
  });
});

describe('stepOsKbdFocus', () => {
  it('moves down a column and wraps along a row', () => {
    const q = { dataset: { osKbd: 'q', osKbdRow: '0', osKbdCol: '0' }, focus() { this.focused = true; } };
    const w = { dataset: { osKbd: 'w', osKbdRow: '0', osKbdCol: '1' }, focus() { this.focused = true; } };
    const a = { dataset: { osKbd: 'a', osKbdRow: '1', osKbdCol: '0' }, focus() { this.focused = true; } };
    const s = { dataset: { osKbd: 's', osKbdRow: '1', osKbdCol: '1' }, focus() { this.focused = true; } };
    const root = {
      children: [q, w, a, s],
      ownerDocument: { activeElement: q },
      _osKbd: {},
    };
    q.parent = root;
    w.parent = root;
    a.parent = root;
    s.parent = root;
    // listOsKbdKeys walks children
    assert.equal(stepOsKbdFocus(root, 0, 1), a);
    assert.equal(a.focused, true);
    root.ownerDocument.activeElement = a;
    assert.equal(stepOsKbdFocus(root, 1, 0), s);
    root.ownerDocument.activeElement = w;
    assert.equal(stepOsKbdFocus(root, 1, 0), q);
  });
});

describe('osKbdStartMode', () => {
  it('uses digits for numeric fields', () => {
    assert.equal(osKbdStartMode({ inputMode: 'numeric' }), 'digits');
    assert.equal(osKbdStartMode({ type: 'number' }), 'digits');
    assert.equal(osKbdStartMode({ type: 'text' }), 'letters');
  });
});

describe('openOsKbd / closeOsKbd', () => {
  it('mounts a dialog, types into the field, then hides', () => {
    const events = [];
    const field = {
      tagName: 'INPUT',
      type: 'text',
      value: 'Cat',
      maxLength: 24,
      focus() { this.focused = true; },
      select() { this.didSelect = true; },
      dispatchEvent(ev) { events.push(ev.type); return true; },
    };
    const byId = new Map();
    const doc = {
      body: {
        appendChild(el) {
          if (el.id) byId.set(el.id, el);
          return el;
        },
      },
      getElementById(id) { return byId.get(id) ?? null; },
      createElement(tag) {
        const kids = [];
        const el = {
          tagName: String(tag).toUpperCase(),
          hidden: false,
          className: '',
          textContent: '',
          dataset: {},
          ownerDocument: null,
          children: kids,
          appendChild(child) {
            kids.push(child);
            child.parent = this;
            return child;
          },
          replaceChildren(...next) {
            kids.length = 0;
            for (const child of next) this.appendChild(child);
          },
          querySelector(sel) {
            if (sel === 'button') return kids.find((c) => c.tagName === 'BUTTON')
              ?? kids.flatMap((c) => c.children || []).find((c) => c.tagName === 'BUTTON')
              ?? null;
            return null;
          },
          setAttribute() {},
          addEventListener(type, fn) { this.onclick = type === 'click' ? fn : this.onclick; },
          focus() { this.focused = true; },
          closest(sel) { return sel === '[data-os-kbd]' ? this : null; },
        };
        Object.defineProperty(el, 'id', {
          get() { return this._id; },
          set(v) {
            this._id = v;
            byId.set(v, el);
          },
        });
        el.ownerDocument = doc;
        return el;
      },
    };
    field.ownerDocument = doc;

    assert.equal(openOsKbd(field, { document: doc }), true);
    const root = osKbdRoot(doc);
    assert.equal(root?.id, OS_KBD_ID);
    assert.equal(root.hidden, false);
    const first = [...walk(root)].find((n) => n.dataset?.osKbd === 'q');
    assert.ok(first);
    assert.equal(first.focused, true);
    assert.equal(field.didSelect, undefined);

    root._osKbd.replaceAll = true;
    root.onclick({ target: { dataset: { osKbd: 'back' }, closest() { return this; } }, preventDefault() {} });
    assert.equal(field.value, 'Ca');

    const w = [...walk(root)].find((n) => n.dataset?.osKbd === 'w');
    assert.ok(w);
    root.onclick({ target: w, preventDefault() {} });
    assert.equal(field.value, 'Caw');

    doc.activeElement = first;
    first.blur = () => { first.focused = false; doc.activeElement = null; };
    root.contains = (n) => n === first;
    assert.equal(closeOsKbd(doc), true);
    assert.equal(osKbdRoot(doc), null);
    assert.equal(root.hidden, true);
    assert.equal(first.focused, false);
  });
});

function walk(node) {
  const out = [];
  const stack = [node];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    out.push(cur);
    for (const child of cur.children || []) stack.push(child);
  }
  return out;
}
