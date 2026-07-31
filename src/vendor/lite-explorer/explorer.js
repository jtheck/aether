// node_modules/babylon-lite-explorer/dist/browser.js
import { stopAnimation as Lt, playAnimation as zn, removeFromScene as qn, createGpuPicker as cn, disposePicker as un, pickAsync as dn, setFog as Kn, setSceneImageProcessing as ze, setSubtreeVisible as Yn, markMaterialUboDirty as Jn, StandardToneMapping as Xn, AcesToneMapping as Zn, NeutralToneMapping as Qn, loadGltf as pn, addToScene as fn } from "@babylonjs/lite";
var Hn = Object.defineProperty;
var Wn = (t, e, n) => e in t ? Hn(t, e, { enumerable: true, configurable: true, writable: true, value: n }) : t[e] = n;
var ee = (t, e, n) => Wn(t, typeof e != "symbol" ? e + "" : e, n);
var pt;
var K;
var hn;
var mn;
var we;
var Dt;
var bn;
var gn;
var vt;
var Ze;
var je;
var vn;
var Mt;
var kt;
var wt;
var yn;
var nt = {};
var it = [];
var ei = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
var ft = Array.isArray;
function ye(t, e) {
  for (var n in e) t[n] = e[n];
  return t;
}
function $t(t) {
  t && t.parentNode && t.parentNode.removeChild(t);
}
function _n(t, e, n) {
  var i, s, r, o = {};
  for (r in e) r == "key" ? i = e[r] : r == "ref" ? s = e[r] : o[r] = e[r];
  if (arguments.length > 2 && (o.children = arguments.length > 3 ? pt.call(arguments, 2) : n), typeof t == "function" && t.defaultProps != null) for (r in t.defaultProps) o[r] === void 0 && (o[r] = t.defaultProps[r]);
  return Qe(t, o, i, s, null);
}
function Qe(t, e, n, i, s) {
  var r = { type: t, props: e, key: n, ref: i, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: s ?? ++hn, __i: -1, __u: 0 };
  return s == null && K.vnode != null && K.vnode(r), r;
}
function De(t) {
  return t.children;
}
function Ie(t, e) {
  this.props = t, this.context = e;
}
function Ne(t, e) {
  if (e == null) return t.__ ? Ne(t.__, t.__i + 1) : null;
  for (var n; e < t.__k.length; e++) if ((n = t.__k[e]) != null && n.__e != null) return n.__e;
  return typeof t.type == "function" ? Ne(t) : null;
}
function ti(t) {
  if (t.__P && t.__d) {
    var e = t.__v, n = e.__e, i = [], s = [], r = ye({}, e);
    r.__v = e.__v + 1, K.vnode && K.vnode(r), It(t.__P, r, e, t.__n, t.__P.namespaceURI, 32 & e.__u ? [n] : null, i, n ?? Ne(e), !!(32 & e.__u), s), r.__v = e.__v, r.__.__k[r.__i] = r, xn(i, r, s), e.__e = e.__ = null, r.__e != n && kn(r);
  }
}
function kn(t) {
  if ((t = t.__) != null && t.__c != null) return t.__e = t.__c.base = null, t.__k.some(function(e) {
    if (e != null && e.__e != null) return t.__e = t.__c.base = e.__e;
  }), kn(t);
}
function St(t) {
  (!t.__d && (t.__d = true) && we.push(t) && !st.__r++ || Dt != K.debounceRendering) && ((Dt = K.debounceRendering) || bn)(st);
}
function st() {
  try {
    for (var t, e = 1; we.length; ) we.length > e && we.sort(gn), t = we.shift(), e = we.length, ti(t);
  } finally {
    we.length = st.__r = 0;
  }
}
function wn(t, e, n, i, s, r, o, d, m, p, _) {
  var h, P, v, A, V, E, x, C = i && i.__k || it, T = e.length;
  for (m = ni(n, e, C, m, T), h = 0; h < T; h++) (v = n.__k[h]) != null && (P = v.__i != -1 && C[v.__i] || nt, v.__i = h, E = It(t, v, P, s, r, o, d, m, p, _), A = v.__e, v.ref && P.ref != v.ref && (P.ref && At(P.ref, null, v), _.push(v.ref, v.__c || A, v)), V == null && A != null && (V = A), (x = !!(4 & v.__u)) || P.__k === v.__k ? (m = Sn(v, m, t, x), x && P.__e && (P.__e = null)) : typeof v.type == "function" && E !== void 0 ? m = E : A && (m = A.nextSibling), v.__u &= -7);
  return n.__e = V, m;
}
function ni(t, e, n, i, s) {
  var r, o, d, m, p, _ = n.length, h = _, P = 0;
  for (t.__k = new Array(s), r = 0; r < s; r++) (o = e[r]) != null && typeof o != "boolean" && typeof o != "function" ? (typeof o == "string" || typeof o == "number" || typeof o == "bigint" || o.constructor == String ? o = t.__k[r] = Qe(null, o, null, null, null) : ft(o) ? o = t.__k[r] = Qe(De, { children: o }, null, null, null) : o.constructor === void 0 && o.__b > 0 ? o = t.__k[r] = Qe(o.type, o.props, o.key, o.ref ? o.ref : null, o.__v) : t.__k[r] = o, m = r + P, o.__ = t, o.__b = t.__b + 1, d = null, (p = o.__i = ii(o, n, m, h)) != -1 && (h--, (d = n[p]) && (d.__u |= 2)), d == null || d.__v == null ? (p == -1 && (s > _ ? P-- : s < _ && P++), typeof o.type != "function" && (o.__u |= 4)) : p != m && (p == m - 1 ? P-- : p == m + 1 ? P++ : (p > m ? P-- : P++, o.__u |= 4))) : t.__k[r] = null;
  if (h) for (r = 0; r < _; r++) (d = n[r]) != null && (2 & d.__u) == 0 && (d.__e == i && (i = Ne(d)), Cn(d, d));
  return i;
}
function Sn(t, e, n, i) {
  var s, r;
  if (typeof t.type == "function") {
    for (s = t.__k, r = 0; s && r < s.length; r++) s[r] && (s[r].__ = t, e = Sn(s[r], e, n, i));
    return e;
  }
  t.__e != e && (i && (e && t.type && !e.parentNode && (e = Ne(t)), n.insertBefore(t.__e, e || null)), e = t.__e);
  do
    e = e && e.nextSibling;
  while (e != null && e.nodeType == 8);
  return e;
}
function ii(t, e, n, i) {
  var s, r, o, d = t.key, m = t.type, p = e[n], _ = p != null && (2 & p.__u) == 0;
  if (p === null && d == null || _ && d == p.key && m == p.type) return n;
  if (i > (_ ? 1 : 0)) {
    for (s = n - 1, r = n + 1; s >= 0 || r < e.length; ) if ((p = e[o = s >= 0 ? s-- : r++]) != null && (2 & p.__u) == 0 && d == p.key && m == p.type) return o;
  }
  return -1;
}
function Rt(t, e, n) {
  e[0] == "-" ? t.setProperty(e, n ?? "") : t[e] = n == null ? "" : typeof n != "number" || ei.test(e) ? n : n + "px";
}
function qe(t, e, n, i, s) {
  var r, o;
  e: if (e == "style") if (typeof n == "string") t.style.cssText = n;
  else {
    if (typeof i == "string" && (t.style.cssText = i = ""), i) for (e in i) n && e in n || Rt(t.style, e, "");
    if (n) for (e in n) i && n[e] == i[e] || Rt(t.style, e, n[e]);
  }
  else if (e[0] == "o" && e[1] == "n") r = e != (e = e.replace(vn, "$1")), o = e.toLowerCase(), e = o in t || e == "onFocusOut" || e == "onFocusIn" ? o.slice(2) : e.slice(2), t.l || (t.l = {}), t.l[e + r] = n, n ? i ? n[je] = i[je] : (n[je] = Mt, t.addEventListener(e, r ? wt : kt, r)) : t.removeEventListener(e, r ? wt : kt, r);
  else {
    if (s == "http://www.w3.org/2000/svg") e = e.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
    else if (e != "width" && e != "height" && e != "href" && e != "list" && e != "form" && e != "tabIndex" && e != "download" && e != "rowSpan" && e != "colSpan" && e != "role" && e != "popover" && e in t) try {
      t[e] = n ?? "";
      break e;
    } catch {
    }
    typeof n == "function" || (n == null || n === false && e[4] != "-" ? t.removeAttribute(e) : t.setAttribute(e, e == "popover" && n == 1 ? "" : n));
  }
}
function Ut(t) {
  return function(e) {
    if (this.l) {
      var n = this.l[e.type + t];
      if (e[Ze] == null) e[Ze] = Mt++;
      else if (e[Ze] < n[je]) return;
      return n(K.event ? K.event(e) : e);
    }
  };
}
function It(t, e, n, i, s, r, o, d, m, p) {
  var _, h, P, v, A, V, E, x, C, T, j, g, l, a, S, M = e.type;
  if (e.constructor !== void 0) return null;
  128 & n.__u && (m = !!(32 & n.__u), r = [d = e.__e = n.__e]), (_ = K.__b) && _(e);
  e: if (typeof M == "function") try {
    if (x = e.props, C = M.prototype && M.prototype.render, T = (_ = M.contextType) && i[_.__c], j = _ ? T ? T.props.value : _.__ : i, n.__c ? E = (h = e.__c = n.__c).__ = h.__E : (C ? e.__c = h = new M(x, j) : (e.__c = h = new Ie(x, j), h.constructor = M, h.render = ri), T && T.sub(h), h.state || (h.state = {}), h.__n = i, P = h.__d = true, h.__h = [], h._sb = []), C && h.__s == null && (h.__s = h.state), C && M.getDerivedStateFromProps != null && (h.__s == h.state && (h.__s = ye({}, h.__s)), ye(h.__s, M.getDerivedStateFromProps(x, h.__s))), v = h.props, A = h.state, h.__v = e, P) C && M.getDerivedStateFromProps == null && h.componentWillMount != null && h.componentWillMount(), C && h.componentDidMount != null && h.__h.push(h.componentDidMount);
    else {
      if (C && M.getDerivedStateFromProps == null && x !== v && h.componentWillReceiveProps != null && h.componentWillReceiveProps(x, j), e.__v == n.__v || !h.__e && h.shouldComponentUpdate != null && h.shouldComponentUpdate(x, h.__s, j) === false) {
        e.__v != n.__v && (h.props = x, h.state = h.__s, h.__d = false), e.__e = n.__e, e.__k = n.__k, e.__k.some(function($) {
          $ && ($.__ = e);
        }), it.push.apply(h.__h, h._sb), h._sb = [], h.__h.length && o.push(h);
        break e;
      }
      h.componentWillUpdate != null && h.componentWillUpdate(x, h.__s, j), C && h.componentDidUpdate != null && h.__h.push(function() {
        h.componentDidUpdate(v, A, V);
      });
    }
    if (h.context = j, h.props = x, h.__P = t, h.__e = false, g = K.__r, l = 0, C) h.state = h.__s, h.__d = false, g && g(e), _ = h.render(h.props, h.state, h.context), it.push.apply(h.__h, h._sb), h._sb = [];
    else do
      h.__d = false, g && g(e), _ = h.render(h.props, h.state, h.context), h.state = h.__s;
    while (h.__d && ++l < 25);
    h.state = h.__s, h.getChildContext != null && (i = ye(ye({}, i), h.getChildContext())), C && !P && h.getSnapshotBeforeUpdate != null && (V = h.getSnapshotBeforeUpdate(v, A)), a = _ != null && _.type === De && _.key == null ? Pn(_.props.children) : _, d = wn(t, ft(a) ? a : [a], e, n, i, s, r, o, d, m, p), h.base = e.__e, e.__u &= -161, h.__h.length && o.push(h), E && (h.__E = h.__ = null);
  } catch ($) {
    if (e.__v = null, m || r != null) if ($.then) {
      for (e.__u |= m ? 160 : 128; d && d.nodeType == 8 && d.nextSibling; ) d = d.nextSibling;
      r[r.indexOf(d)] = null, e.__e = d;
    } else {
      for (S = r.length; S--; ) $t(r[S]);
      xt(e);
    }
    else e.__e = n.__e, e.__k = n.__k, $.then || xt(e);
    K.__e($, e, n);
  }
  else r == null && e.__v == n.__v ? (e.__k = n.__k, e.__e = n.__e) : d = e.__e = si(n.__e, e, n, i, s, r, o, m, p);
  return (_ = K.diffed) && _(e), 128 & e.__u ? void 0 : d;
}
function xt(t) {
  t && (t.__c && (t.__c.__e = true), t.__k && t.__k.some(xt));
}
function xn(t, e, n) {
  for (var i = 0; i < n.length; i++) At(n[i], n[++i], n[++i]);
  K.__c && K.__c(e, t), t.some(function(s) {
    try {
      t = s.__h, s.__h = [], t.some(function(r) {
        r.call(s);
      });
    } catch (r) {
      K.__e(r, s.__v);
    }
  });
}
function Pn(t) {
  return typeof t != "object" || t == null || t.__b > 0 ? t : ft(t) ? t.map(Pn) : t.constructor !== void 0 ? null : ye({}, t);
}
function si(t, e, n, i, s, r, o, d, m) {
  var p, _, h, P, v, A, V, E = n.props || nt, x = e.props, C = e.type;
  if (C == "svg" ? s = "http://www.w3.org/2000/svg" : C == "math" ? s = "http://www.w3.org/1998/Math/MathML" : s || (s = "http://www.w3.org/1999/xhtml"), r != null) {
    for (p = 0; p < r.length; p++) if ((v = r[p]) && "setAttribute" in v == !!C && (C ? v.localName == C : v.nodeType == 3)) {
      t = v, r[p] = null;
      break;
    }
  }
  if (t == null) {
    if (C == null) return document.createTextNode(x);
    t = document.createElementNS(s, C, x.is && x), d && (K.__m && K.__m(e, r), d = false), r = null;
  }
  if (C == null) E === x || d && t.data == x || (t.data = x);
  else {
    if (r = C == "textarea" && x.defaultValue != null ? null : r && pt.call(t.childNodes), !d && r != null) for (E = {}, p = 0; p < t.attributes.length; p++) E[(v = t.attributes[p]).name] = v.value;
    for (p in E) v = E[p], p == "dangerouslySetInnerHTML" ? h = v : p == "children" || p in x || p == "value" && "defaultValue" in x || p == "checked" && "defaultChecked" in x || qe(t, p, null, v, s);
    for (p in x) v = x[p], p == "children" ? P = v : p == "dangerouslySetInnerHTML" ? _ = v : p == "value" ? A = v : p == "checked" ? V = v : d && typeof v != "function" || E[p] === v || qe(t, p, v, E[p], s);
    if (_) d || h && (_.__html == h.__html || _.__html == t.innerHTML) || (t.innerHTML = _.__html), e.__k = [];
    else if (h && (t.innerHTML = ""), wn(e.type == "template" ? t.content : t, ft(P) ? P : [P], e, n, i, C == "foreignObject" ? "http://www.w3.org/1999/xhtml" : s, r, o, r ? r[0] : n.__k && Ne(n, 0), d, m), r != null) for (p = r.length; p--; ) $t(r[p]);
    d && C != "textarea" || (p = "value", C == "progress" && A == null ? t.removeAttribute("value") : A != null && (A !== t[p] || C == "progress" && !A || C == "option" && A != E[p]) && qe(t, p, A, E[p], s), p = "checked", V != null && V != t[p] && qe(t, p, V, E[p], s));
  }
  return t;
}
function At(t, e, n) {
  try {
    if (typeof t == "function") {
      var i = typeof t.__u == "function";
      i && t.__u(), i && e == null || (t.__u = t(e));
    } else t.current = e;
  } catch (s) {
    K.__e(s, n);
  }
}
function Cn(t, e, n) {
  var i, s;
  if (K.unmount && K.unmount(t), (i = t.ref) && (i.current && i.current != t.__e || At(i, null, e)), (i = t.__c) != null) {
    if (i.componentWillUnmount) try {
      i.componentWillUnmount();
    } catch (r) {
      K.__e(r, e);
    }
    i.base = i.__P = null;
  }
  if (i = t.__k) for (s = 0; s < i.length; s++) i[s] && Cn(i[s], e, n || typeof t.type != "function");
  n || $t(t.__e), t.__c = t.__ = t.__e = void 0;
}
function ri(t, e, n) {
  return this.constructor(t, n);
}
function Ot(t, e, n) {
  var i, s, r, o;
  e == document && (e = document.documentElement), K.__ && K.__(t, e), s = (i = false) ? null : e.__k, r = [], o = [], It(e, t = e.__k = _n(De, null, [t]), s || nt, nt, e.namespaceURI, s ? null : e.firstChild ? pt.call(e.childNodes) : null, r, s ? s.__e : e.firstChild, i, o), xn(r, t, o);
}
function oi(t) {
  function e(n) {
    var i, s;
    return this.getChildContext || (i = /* @__PURE__ */ new Set(), (s = {})[e.__c] = this, this.getChildContext = function() {
      return s;
    }, this.componentWillUnmount = function() {
      i = null;
    }, this.shouldComponentUpdate = function(r) {
      this.props.value != r.value && i.forEach(function(o) {
        o.__e = true, St(o);
      });
    }, this.sub = function(r) {
      i.add(r);
      var o = r.componentWillUnmount;
      r.componentWillUnmount = function() {
        i && i.delete(r), o && o.call(r);
      };
    }), n.children;
  }
  return e.__c = "__cC" + yn++, e.__ = t, e.Provider = e.__l = (e.Consumer = function(n, i) {
    return n.children(i);
  }).contextType = e, e;
}
pt = it.slice, K = { __e: function(t, e, n, i) {
  for (var s, r, o; e = e.__; ) if ((s = e.__c) && !s.__) try {
    if ((r = s.constructor) && r.getDerivedStateFromError != null && (s.setState(r.getDerivedStateFromError(t)), o = s.__d), s.componentDidCatch != null && (s.componentDidCatch(t, i || {}), o = s.__d), o) return s.__E = s;
  } catch (d) {
    t = d;
  }
  throw t;
} }, hn = 0, mn = function(t) {
  return t != null && t.constructor === void 0;
}, Ie.prototype.setState = function(t, e) {
  var n;
  n = this.__s != null && this.__s != this.state ? this.__s : this.__s = ye({}, this.state), typeof t == "function" && (t = t(ye({}, n), this.props)), t && ye(n, t), t != null && this.__v && (e && this._sb.push(e), St(this));
}, Ie.prototype.forceUpdate = function(t) {
  this.__v && (this.__e = true, t && this.__h.push(t), St(this));
}, Ie.prototype.render = De, we = [], bn = typeof Promise == "function" ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, gn = function(t, e) {
  return t.__v.__b - e.__v.__b;
}, st.__r = 0, vt = Math.random().toString(8), Ze = "__d" + vt, je = "__a" + vt, vn = /(PointerCapture)$|Capture$/i, Mt = 0, kt = Ut(false), wt = Ut(true), yn = 0;
var q = (t = void 0) => ({ ok: true, value: t });
var N = (t, e) => ({ ok: false, code: t, message: e });
function Pt(t, e) {
  var n;
  for (const i of t)
    e(i), (n = i.children) != null && n.length && Pt(i.children, e);
}
function ke(t, e) {
  return e.get(t.id) ?? null;
}
function ai(t) {
  const e = {};
  for (const n of t)
    for (const [i, s] of Object.entries(n))
      typeof s == "number" && (e[i] = i === "fps" || i === "frameMs" || i === "gpuFrameTimeMs" ? e[i] ?? s : (e[i] ?? 0) + s);
  return e;
}
function li(t) {
  const e = /* @__PURE__ */ new Map();
  return {
    async getSceneTree(n) {
      e.clear();
      const i = [];
      for (const s of t) {
        const r = await s.getSceneTree(n);
        Pt(r, (o) => {
          const d = e.get(o.id);
          if (d && d !== s) throw new Error(`Duplicate Explorer entity ID "${o.id}" across composed adapters.`);
          e.set(o.id, s);
        }), i.push(...r);
      }
      return i;
    },
    async getExtensionEntities(n) {
      var s;
      const i = [];
      for (const r of t) {
        const o = await ((s = r.getExtensionEntities) == null ? void 0 : s.call(r, n)) ?? [];
        Pt(o, (d) => {
          const m = e.get(d.id);
          if (m && m !== r) throw new Error(`Duplicate Explorer entity ID "${d.id}" across composed adapters.`);
          e.set(d.id, r);
        }), i.push(...o);
      }
      return i;
    },
    async getProperties(n, i) {
      const s = ke(n, e);
      return s ? s.getProperties(n, i) : [];
    },
    async setProperty(n, i, s, r) {
      const o = ke(n, e);
      return o != null && o.setProperty ? o.setProperty(n, i, s, r) : N("unsupported", "This entity is read-only.");
    },
    async refresh(n) {
      var i;
      for (const s of t) {
        const r = await ((i = s.refresh) == null ? void 0 : i.call(s, n));
        if (r && !r.ok) return r;
      }
      return q();
    },
    async getStats(n) {
      var s;
      const i = [];
      for (const r of t) {
        const o = await ((s = r.getStats) == null ? void 0 : s.call(r, n));
        o && i.push(o);
      }
      return ai(i);
    },
    async focusEntity(n, i) {
      const s = ke(n, e);
      return s != null && s.focusEntity ? s.focusEntity(n, i) : N("unsupported", "This entity cannot be focused.");
    },
    async setEntityVisible(n, i, s) {
      const r = ke(n, e);
      return r != null && r.setEntityVisible ? r.setEntityVisible(n, i, s) : N("unsupported", "This entity has no visibility toggle.");
    },
    async removeEntity(n, i) {
      const s = ke(n, e);
      return s != null && s.removeEntity ? s.removeEntity(n, i) : N("unsupported", "This entity cannot be removed.");
    },
    async playAnimationGroup(n, i) {
      const s = ke(n, e);
      return s != null && s.playAnimationGroup ? s.playAnimationGroup(n, i) : N("unsupported", "This entity is not an animation group.");
    },
    async stopAnimationGroup(n, i) {
      const s = ke(n, e);
      return s != null && s.stopAnimationGroup ? s.stopAnimationGroup(n, i) : N("unsupported", "This entity is not an animation group.");
    },
    async getEntitySnapshot(n, i) {
      const s = ke(n, e);
      return s != null && s.getEntitySnapshot ? s.getEntitySnapshot(n, i) : N("unsupported", "This entity has no snapshot.");
    },
    async pickEntityId(n, i, s) {
      let r = null;
      for (const o of [...t].reverse()) {
        if (!o.pickEntityId) continue;
        const d = await o.pickEntityId(n, i, s);
        if (d.ok && d.value) return d;
        d.ok || (r = d);
      }
      return r ?? q(null);
    },
    dispose() {
      e.clear();
    }
  };
}
var ge = {
  editable: false,
  focusable: false,
  visibilityToggle: false,
  serializableSnapshot: true
};
var ci = { ...ge, editable: true };
var ui = { ...ge, editable: true, visibilityToggle: true, removable: true };
function Te(t) {
  if (!t || typeof t != "object") return false;
  const e = t;
  return Array.isArray(e.meshes) && Array.isArray(e.lights) && Array.isArray(e.animationGroups) && "camera" in e;
}
function di(t) {
  return t.camera ? 1 : 0;
}
function pi(t) {
  return !!t && typeof t == "object" && typeof t.drawCallCount == "number";
}
function fi(t) {
  if (!t || typeof t != "object") return false;
  const e = t;
  return typeof e.name == "string" && Array.isArray(e.children) && !!e.position && typeof e.position.x == "number" && !!e.rotation && typeof e.rotation.x == "number" && !!e.scaling && typeof e.scaling.x == "number";
}
function hi(t) {
  if (!t || typeof t != "object") return false;
  const e = t;
  return typeof e.width == "number" && typeof e.height == "number" && "texture" in e && "view" in e && "sampler" in e;
}
var mi = [
  "baseColorTexture",
  "normalTexture",
  "ormTexture",
  "emissiveTexture",
  "specGlossTexture",
  "occlusionTexture",
  "metallicReflectanceTexture",
  "reflectanceTexture",
  "diffuseTexture",
  "bumpTexture",
  "specularTexture",
  "ambientTexture",
  "lightmapTexture",
  "opacityTexture",
  "reflectionTexture"
];
function bi(t) {
  const e = t, n = [], i = (_, h) => {
    hi(h) && n.push({ slot: _, texture: h });
  };
  for (const _ of mi) i(_, e[_]);
  const s = (_) => {
    const h = e[_];
    return h && typeof h == "object" ? h : null;
  }, r = s("clearCoat");
  r && (i("clearCoat.texture", r.texture), i("clearCoat.roughnessTexture", r.roughnessTexture), i("clearCoat.bumpTexture", r.bumpTexture));
  const o = s("sheen");
  o && (i("sheen.texture", o.texture), i("sheen.roughnessTexture", o.roughnessTexture));
  const d = s("anisotropy");
  d && i("anisotropy.texture", d.texture);
  const m = s("iridescence");
  m && (i("iridescence.texture", m.texture), i("iridescence.thicknessTexture", m.thicknessTexture));
  const p = s("subsurface");
  if (p) {
    const _ = p.thickness && typeof p.thickness == "object" ? p.thickness : null, h = p.refraction && typeof p.refraction == "object" ? p.refraction : null;
    _ && i("subsurface.thickness.texture", _.texture), h && i("subsurface.refraction.texture", h.texture);
    const P = p.translucency && typeof p.translucency == "object" ? p.translucency : null;
    P && (i("subsurface.translucency.colorTexture", P.colorTexture), i("subsurface.translucency.intensityTexture", P.intensityTexture));
  }
  return n;
}
function he(t) {
  return [t.x, t.y, t.z];
}
function Me(t, e) {
  return Array.isArray(t) && t.length === e && t.every((n) => typeof n == "number" && Number.isFinite(n));
}
function Ae(t) {
  if (!t || typeof t != "object") return false;
  const e = t;
  return typeof e.x == "number" && typeof e.y == "number" && typeof e.z == "number";
}
function Gt(t) {
  const e = t;
  return typeof e.alpha == "number" && typeof e.beta == "number" && typeof e.radius == "number" && Ae(e.target) && typeof e.inertia == "number" && typeof e.panningInertia == "number";
}
function Vt(t) {
  const e = t;
  return Ae(e.position) && Ae(e.target) && typeof e.speed == "number" && typeof e.angularSensitivity == "number" && typeof e.inertia == "number";
}
function jt(t) {
  const e = t;
  return Ae(e.center) && typeof e.yaw == "number" && typeof e.pitch == "number" && typeof e.radius == "number" && Ae(e.position) && Ae(e.upVector) && !!e.limits && typeof e.limits == "object";
}
function gi(t, e) {
  const n = t;
  typeof n.set == "function" ? n.set(e[0], e[1], e[2]) : Object.assign(t, { x: e[0], y: e[1], z: e[2] });
}
function Ke(t, e, n) {
  return { id: `section:${t}`, label: e, kind: "unknown", source: null, children: n, capabilities: ge };
}
function et(t) {
  return "baseColorFactor" in t || "metallicFactor" in t || "roughnessFactor" in t;
}
function Ct(t) {
  const e = t;
  return Array.isArray(e.diffuseColor) && Array.isArray(e.specularColor) && typeof e.specularPower == "number";
}
function En(t, e = /* @__PURE__ */ new Set()) {
  if (e.has(t)) return "Material View";
  e.add(t);
  const n = t;
  return n.source && typeof n.source == "object" ? `${En(n.source, e)} View` : n.inputs && typeof n.inputs == "object" ? "Node" : typeof n.vertexSource == "string" && typeof n.fragmentSource == "string" ? "Shader" : et(t) ? "PBR" : Ct(t) ? "Standard" : "Undetermined / Custom";
}
var se = (t) => Math.min(1, Math.max(0, t));
function vi(t) {
  return (t == null ? void 0 : t.id) ?? "standard";
}
var yi = [
  { value: "standard", label: "Standard" },
  { value: "aces", label: "ACES" },
  { value: "neutral", label: "Khronos PBR Neutral" }
];
function _i(t, e) {
  return t === "standard" ? (e == null ? void 0 : e.StandardToneMapping) ?? Xn : t === "aces" ? (e == null ? void 0 : e.AcesToneMapping) ?? Zn : t === "neutral" ? (e == null ? void 0 : e.NeutralToneMapping) ?? Qn : null;
}
function ki(t) {
  if (t == null) return String(t);
  if (typeof t == "string") return t;
  if (typeof t == "number" || typeof t == "boolean" || typeof t == "bigint") return String(t);
  try {
    return JSON.stringify(t);
  } catch {
    return Object.prototype.toString.call(t);
  }
}
function wi(t) {
  const e = t.metadata;
  return !e || typeof e != "object" || Array.isArray(e) ? [] : Object.entries(e).map(([n, i]) => ({
    kind: "readonly",
    path: `metadata.${n}`,
    label: n,
    value: ki(i),
    section: "Metadata"
  }));
}
function Si() {
  const t = /* @__PURE__ */ new WeakMap(), e = /* @__PURE__ */ new WeakMap();
  let n = 1;
  const i = /* @__PURE__ */ new Map(), s = /* @__PURE__ */ new WeakMap(), r = (g) => g.currentTime, o = (g, l, a) => {
    const S = t.get(l);
    if (S) return S;
    const M = a ? `${g}:${a}:${n++}` : `${g}:object:${n++}`;
    return t.set(l, M), e.set(l, g), M;
  }, d = (g, l, a, S) => {
    if (a.has(g))
      return { id: o(l, g), label: `${g.name || l} (cycle)`, kind: l, source: g, capabilities: ge };
    a.add(g);
    const M = g.children.map(($) => d($, S != null && S.has($) ? "mesh" : "transform", a, S));
    return a.delete(g), {
      id: o(l, g, l === "mesh" ? g.id : void 0),
      label: g.name || (l === "mesh" ? "Unnamed mesh" : "Unnamed transform"),
      kind: l,
      source: g,
      children: M.length ? M : void 0,
      capabilities: l === "mesh" ? ui : { ...ge, editable: true },
      meta: { liveProperties: true }
    };
  }, m = (g) => ({
    id: o("material", g),
    label: g.name || "Unnamed material",
    kind: "material",
    source: g,
    capabilities: { ...ge, editable: et(g) },
    meta: { liveProperties: true }
  }), p = (g) => {
    if (!Te(g.scene)) return [];
    const l = g.scene;
    e.set(l, "scene");
    const a = {
      id: o("scene", l),
      label: "Scene",
      kind: "scene",
      source: l,
      capabilities: ci,
      children: [],
      meta: { liveProperties: true }
    }, S = new Set(l.meshes), M = new Set(l.meshes);
    for (const R of l.meshes) {
      let c = R.parent;
      const b = /* @__PURE__ */ new Set();
      for (; fi(c) && !b.has(c); )
        b.add(c), M.add(c), c = c.parent;
    }
    const $ = new Set(l.lights);
    l.camera && $.add(l.camera);
    const k = [];
    if (l.camera) {
      e.set(l.camera, "camera");
      const R = l.camera.children.map((c) => d(c, S.has(c) ? "mesh" : "transform", /* @__PURE__ */ new Set(), S));
      k.push({
        id: o("camera", l.camera),
        label: "Active camera",
        kind: "camera",
        source: l.camera,
        children: R.length ? R : void 0,
        capabilities: { ...ge, editable: true },
        meta: { liveProperties: true }
      });
    }
    l.lights.length && k.push(...l.lights.map((R, c) => {
      e.set(R, "light");
      const b = R.children.map((f) => d(f, S.has(f) ? "mesh" : "transform", /* @__PURE__ */ new Set(), S));
      return {
        id: o("light", R),
        label: `${R.lightType || "Light"} ${c + 1}`,
        kind: "light",
        source: R,
        children: b.length ? b : void 0,
        capabilities: { ...ge, editable: true },
        meta: { liveProperties: true }
      };
    }));
    const I = [...M].filter((R) => {
      const c = R.parent;
      return !c || !M.has(c) && !$.has(c);
    });
    k.push(...I.map((R) => d(R, S.has(R) ? "mesh" : "transform", /* @__PURE__ */ new Set(), S))), k.length && a.children.push(Ke("nodes", "Nodes", k));
    const G = [...new Set(l.meshes.map((R) => R.material))];
    G.length && a.children.push(Ke("materials", "Materials", G.map(m)));
    const z = /* @__PURE__ */ new Map();
    for (const R of G) {
      const c = R.name || "Unnamed material";
      for (const b of bi(R)) {
        const f = z.get(b.texture) ?? [];
        f.push(`${c} / ${b.slot}`), z.set(b.texture, f);
      }
    }
    return z.size && a.children.push(Ke("textures", "Textures", [...z].map(([R, c]) => ({
      id: o("texture", R),
      label: c[0],
      kind: "texture",
      source: R,
      capabilities: ge,
      meta: { usages: c, liveProperties: true }
    })))), l.animationGroups.length && a.children.push(Ke("animations", "Animation Groups", l.animationGroups.map((R, c) => (e.set(R, "animationGroup"), {
      id: o("animationGroup", R),
      label: R.name || `Animation group ${c + 1}`,
      kind: "animationGroup",
      source: R,
      capabilities: { ...ge, animationPlayback: true }
    })))), [a];
  }, _ = (g) => [
    { kind: "text", path: "name", label: "Name", value: g.name, section: "General" },
    { kind: "boolean", path: "visible", label: "Visible", value: g.visible !== false, section: "Rendering" },
    { kind: "vector3", path: "position", label: "Position", value: he(g.position), section: "Transform" },
    { kind: "vector3", path: "rotation", label: "Rotation", value: he(g.rotation), section: "Transform" },
    { kind: "vector3", path: "scaling", label: "Scaling", value: he(g.scaling), section: "Transform" }
  ], h = (g) => {
    const l = g.skeleton, a = g.morphTargets, S = [
      { kind: "readonly", path: "skinned", label: "Skinned", value: l ? "Yes" : "No", section: "Deformation" },
      { kind: "readonly", path: "hasMorphTargets", label: "Morph targets", value: a ? "Yes" : "No", section: "Deformation" }
    ];
    return l && S.splice(1, 0, { kind: "number", path: "boneCount", label: "Bone count", value: l.boneCount, readonly: true, section: "Deformation" }), a && S.push(
      { kind: "number", path: "morphTargetCount", label: "Morph target count", value: a.count, readonly: true, section: "Deformation" },
      { kind: "readonly", path: "morphWeights", label: "Current weights", value: `[${Array.from(a.weights, (M) => Number(M.toFixed(4))).join(", ")}]`, section: "Deformation" }
    ), S;
  }, P = (g) => {
    const l = [
      { kind: "number", path: "fov", label: "Field of view", value: g.fov, min: 0.01, max: Math.PI, step: 0.01, section: "Camera" },
      { kind: "number", path: "nearPlane", label: "Near plane", value: g.nearPlane, min: 1e-4, step: 0.01, section: "Camera" },
      { kind: "number", path: "farPlane", label: "Far plane", value: g.farPlane, min: 1e-3, step: 1, section: "Camera" }
    ];
    if (g.viewport && l.push(
      { kind: "number", path: "viewport.x", label: "X", value: g.viewport.x, min: 0, max: 1, step: 0.01, section: "Viewport" },
      { kind: "number", path: "viewport.y", label: "Y", value: g.viewport.y, min: 0, max: 1, step: 0.01, section: "Viewport" },
      { kind: "number", path: "viewport.width", label: "Width", value: g.viewport.width, min: 0, max: 1, step: 0.01, section: "Viewport" },
      { kind: "number", path: "viewport.height", label: "Height", value: g.viewport.height, min: 0, max: 1, step: 0.01, section: "Viewport" }
    ), Gt(g)) {
      l.unshift({ kind: "readonly", path: "$cameraType", label: "Type", value: "Arc rotate", section: "Camera" }), l.push(
        { kind: "number", path: "alpha", label: "Alpha", value: g.alpha, step: 0.01, section: "Orbit" },
        { kind: "number", path: "beta", label: "Beta", value: g.beta, step: 0.01, section: "Orbit" },
        { kind: "number", path: "radius", label: "Radius", value: g.radius, min: 1e-4, step: 0.1, section: "Orbit" },
        { kind: "vector3", path: "target", label: "Target", value: he(g.target), section: "Orbit" },
        { kind: "number", path: "inertia", label: "Inertia", value: g.inertia, min: 0, max: 1, step: 0.01, section: "Controls" },
        { kind: "number", path: "panningInertia", label: "Panning inertia", value: g.panningInertia, min: 0, max: 1, step: 0.01, section: "Controls" },
        { kind: "number", path: "angularSensibility", label: "Angular sensibility", value: g.angularSensibility, min: 1e-4, step: 1, section: "Controls" },
        { kind: "number", path: "panningSensibility", label: "Panning sensibility", value: g.panningSensibility, min: 1e-4, step: 1, section: "Controls" },
        { kind: "number", path: "wheelPrecision", label: "Wheel precision", value: g.wheelPrecision, min: 1e-4, step: 0.1, section: "Controls" }
      );
      const a = [
        ["lowerAlphaLimit", "Minimum alpha"],
        ["upperAlphaLimit", "Maximum alpha"],
        ["lowerBetaLimit", "Minimum beta"],
        ["upperBetaLimit", "Maximum beta"],
        ["lowerRadiusLimit", "Minimum radius"],
        ["upperRadiusLimit", "Maximum radius"]
      ];
      for (const [S, M] of a) typeof g[S] == "number" && l.push({ kind: "number", path: S, label: M, value: g[S], step: 0.01, section: "Limits" });
    } else if (Vt(g))
      l.unshift({ kind: "readonly", path: "$cameraType", label: "Type", value: "Free", section: "Camera" }), l.push(
        { kind: "vector3", path: "position", label: "Position", value: he(g.position), section: "Transform" },
        { kind: "vector3", path: "target", label: "Target", value: he(g.target), section: "Transform" },
        { kind: "number", path: "speed", label: "Speed", value: g.speed, min: 0, step: 0.1, section: "Controls" },
        { kind: "number", path: "angularSensitivity", label: "Angular sensitivity", value: g.angularSensitivity, min: 1e-4, step: 1, section: "Controls" },
        { kind: "number", path: "inertia", label: "Inertia", value: g.inertia, min: 0, max: 1, step: 0.01, section: "Controls" }
      );
    else if (jt(g)) {
      l.unshift({ kind: "readonly", path: "$cameraType", label: "Type", value: "Geospatial", section: "Camera" }), l.push(
        { kind: "vector3", path: "center", label: "Center", value: he(g.center), section: "Orbit" },
        { kind: "number", path: "yaw", label: "Yaw", value: g.yaw, step: 0.01, section: "Orbit" },
        { kind: "number", path: "pitch", label: "Pitch", value: g.pitch, step: 0.01, section: "Orbit" },
        { kind: "number", path: "radius", label: "Radius", value: g.radius, min: 1e-4, step: 1, section: "Orbit" },
        { kind: "vector3", path: "position", label: "Position", value: he(g.position), readonly: true, section: "Derived" },
        { kind: "vector3", path: "upVector", label: "Up vector", value: he(g.upVector), readonly: true, section: "Derived" }
      );
      const a = [
        ["radiusMin", "Minimum radius"],
        ["radiusMax", "Maximum radius"],
        ["pitchMin", "Minimum pitch"],
        ["pitchMax", "Maximum pitch"],
        ["yawMin", "Minimum yaw"],
        ["yawMax", "Maximum yaw"]
      ];
      for (const [S, M] of a) Number.isFinite(g.limits[S]) && l.push({ kind: "number", path: `limits.${S}`, label: M, value: g.limits[S], step: 0.01, section: "Limits" });
    } else
      l.unshift({ kind: "readonly", path: "$cameraType", label: "Type", value: "Camera", section: "Camera" });
    return l;
  }, v = (g) => {
    var $;
    const l = g.source, a = [
      { kind: "readonly", path: "$kind", label: "Kind", value: g.kind, section: "General" },
      { kind: "readonly", path: "$id", label: "Explorer ID", value: g.id, section: "General" }
    ];
    if (!l || typeof l != "object") return a;
    const S = wi(l), M = e.get(l);
    if (M === "mesh") return [...a, ..._(l), ...h(l), ...S];
    if (M === "transform") return [...a, ..._(l), ...S];
    if (M === "camera") {
      const k = l;
      return [...a, ...P(k), ...S];
    }
    if (M === "light") {
      const k = l, I = [...a, { kind: "readonly", path: "lightType", label: "Type", value: k.lightType, section: "Light" }];
      return typeof k.intensity == "number" && I.push({ kind: "number", path: "intensity", label: "Intensity", value: k.intensity, min: 0, step: 0.05, section: "Light" }), k.position && I.push({ kind: "vector3", path: "position", label: "Position", value: he(k.position), section: "Light" }), k.direction && I.push({ kind: "vector3", path: "direction", label: "Direction", value: he(k.direction), section: "Light" }), I.push(...S), I;
    }
    if (M === "material") {
      const k = l, I = [
        ...a,
        { kind: "readonly", path: "$materialType", label: "Type", value: En(k), section: "Material" },
        { kind: "text", path: "name", label: "Name", value: k.name ?? "", section: "Material" }
      ];
      if (et(k) && (k.baseColorFactor && I.push({ kind: "color4", path: "baseColorFactor", label: "Base color", value: [...k.baseColorFactor], section: "Material" }), typeof k.metallicFactor == "number" && I.push({ kind: "number", path: "metallicFactor", label: "Metallic", value: k.metallicFactor, min: 0, max: 1, step: 0.01, section: "Material" }), typeof k.roughnessFactor == "number" && I.push({ kind: "number", path: "roughnessFactor", label: "Roughness", value: k.roughnessFactor, min: 0, max: 1, step: 0.01, section: "Material" }), typeof k.alpha == "number" && I.push({ kind: "number", path: "alpha", label: "Alpha", value: k.alpha, min: 0, max: 1, step: 0.01, section: "Material" }), I.push({ kind: "number", path: "environmentIntensity", label: "Environment intensity", value: k.environmentIntensity ?? 1, min: 0, step: 0.01, section: "Environment" }), typeof k.doubleSided == "boolean" && I.push({ kind: "boolean", path: "doubleSided", label: "Double sided", value: k.doubleSided, section: "Material", readonly: true })), Ct(k)) {
        k.diffuseColor && I.push({ kind: "color3", path: "diffuseColor", label: "Diffuse color", value: [...k.diffuseColor], section: "Material" }), typeof k.alpha == "number" && I.push({ kind: "number", path: "alpha", label: "Alpha", value: k.alpha, min: 0, max: 1, step: 0.01, section: "Material" }), k.specularColor && I.push({ kind: "color3", path: "specularColor", label: "Specular color", value: [...k.specularColor], section: "Material" }), typeof k.specularPower == "number" && I.push({ kind: "number", path: "specularPower", label: "Specular power", value: k.specularPower, min: 0, step: 1, section: "Material" }), k.emissiveColor && I.push({ kind: "color3", path: "emissiveColor", label: "Emissive color", value: [...k.emissiveColor], section: "Material" }), k.ambientColor && I.push({ kind: "color3", path: "ambientColor", label: "Ambient color", value: [...k.ambientColor], section: "Material" });
        const G = [
          ["bumpLevel", "Bump level"],
          ["ambientTexLevel", "Ambient level"],
          ["lightmapLevel", "Lightmap level"],
          ["opacityLevel", "Opacity level"],
          ["reflectionLevel", "Reflection level"]
        ];
        for (const [z, R] of G) typeof k[z] == "number" && I.push({ kind: "number", path: z, label: R, value: k[z], min: 0, step: 0.01, section: "Texture Levels" });
      }
      return I.push(...S), I;
    }
    if (M === "texture") {
      const k = l, I = Array.isArray(($ = g.meta) == null ? void 0 : $.usages) ? g.meta.usages.filter((G) => typeof G == "string") : [];
      return [
        ...a,
        { kind: "readonly", path: "usages", label: "Used by", value: I.join(", "), section: "Texture" },
        { kind: "number", path: "width", label: "Width", value: k.width, readonly: true, section: "Texture" },
        { kind: "number", path: "height", label: "Height", value: k.height, readonly: true, section: "Texture" },
        { kind: "number", path: "uScale", label: "U scale", value: k.uScale ?? 1, readonly: true, section: "UV Transform" },
        { kind: "number", path: "vScale", label: "V scale", value: k.vScale ?? 1, readonly: true, section: "UV Transform" },
        { kind: "number", path: "uOffset", label: "U offset", value: k.uOffset ?? 0, readonly: true, section: "UV Transform" },
        { kind: "number", path: "vOffset", label: "V offset", value: k.vOffset ?? 0, readonly: true, section: "UV Transform" },
        { kind: "number", path: "uAng", label: "UV rotation", value: k.uAng ?? 0, readonly: true, section: "UV Transform" },
        { kind: "boolean", path: "invertY", label: "Invert Y", value: k.invertY ?? false, readonly: true, section: "UV Transform" },
        ...S
      ];
    }
    if (M === "animationGroup") {
      const k = l, I = k.frameRate ?? 60, G = r(k);
      return [
        ...a,
        { kind: "readonly", path: "name", label: "Name", value: k.name, section: "Animation" },
        { kind: "number", path: "duration", label: "Duration", value: k.duration, readonly: true, section: "Animation" },
        { kind: "number", path: "currentTime", label: "Current time", value: Number(G.toFixed(2)), readonly: true, step: 0.01, section: "Playback" },
        { kind: "number", path: "currentFrame", label: "Current frame", value: Math.round(G * I), readonly: true, section: "Playback" },
        { kind: "boolean", path: "isPlaying", label: "Playing", value: k.isPlaying, readonly: true, section: "Playback" },
        { kind: "number", path: "speedRatio", label: "Speed ratio", value: k.speedRatio, readonly: true, section: "Playback" },
        { kind: "boolean", path: "loopAnimation", label: "Loop", value: k.loopAnimation, readonly: true, section: "Playback" },
        ...S
      ];
    }
    if (M === "scene") {
      const k = l, I = [
        ...a,
        { kind: "readonly", path: "meshCount", label: "Meshes", value: String(k.meshes.length), section: "Scene" },
        { kind: "readonly", path: "lightCount", label: "Lights", value: String(k.lights.length), section: "Scene" },
        { kind: "readonly", path: "shadowGeneratorCount", label: "Shadow generators", value: String(k.shadowGenerators.length), section: "Scene" },
        { kind: "number", path: "fixedDeltaMs", label: "Fixed delta (ms)", value: k.fixedDeltaMs, min: 0, step: 0.01, section: "Scene" }
      ], G = k.clearColor;
      [G.r, G.g, G.b, G.a].every((R) => typeof R == "number" && Number.isFinite(R)) && I.push({ kind: "color4", path: "clearColor", label: "Clear color", value: [G.r, G.g, G.b, G.a], section: "Scene" });
      const z = k.imageProcessing;
      return typeof z.exposure == "number" && I.push({ kind: "number", path: "imageProcessing.exposure", label: "Exposure", value: z.exposure, min: 0, step: 0.01, section: "Image Processing" }), typeof z.contrast == "number" && I.push({ kind: "number", path: "imageProcessing.contrast", label: "Contrast", value: z.contrast, min: 0, step: 0.01, section: "Image Processing" }), typeof z.toneMappingEnabled == "boolean" && I.push({ kind: "boolean", path: "imageProcessing.toneMappingEnabled", label: "Tone mapping", value: z.toneMappingEnabled, section: "Image Processing" }), I.push({
        kind: "select",
        path: "imageProcessing.toneMapping",
        label: "Tone mapping type",
        value: vi(z.toneMapping),
        options: yi,
        section: "Image Processing"
      }), Me(k.environmentPrimaryColor, 3) && I.push({ kind: "color3", path: "environmentPrimaryColor", label: "Environment primary color", value: [...k.environmentPrimaryColor], section: "Environment" }), typeof k.envRotationY == "number" && I.push({ kind: "number", path: "envRotationY", label: "Environment Y rotation", value: k.envRotationY, step: 0.01, section: "Environment" }), k.fog ? I.push(
        { kind: "select", path: "fog.mode", label: "Mode", value: String(k.fog.mode), options: [
          { value: "0", label: "Disabled" },
          { value: "1", label: "Exponential" },
          { value: "2", label: "Exponential squared" },
          { value: "3", label: "Linear" }
        ], section: "Fog" },
        { kind: "number", path: "fog.density", label: "Density", value: k.fog.density, min: 0, step: 1e-3, section: "Fog" },
        { kind: "number", path: "fog.start", label: "Start", value: k.fog.start, step: 0.1, section: "Fog" },
        { kind: "number", path: "fog.end", label: "End", value: k.fog.end, step: 0.1, section: "Fog" },
        { kind: "color3", path: "fog.color", label: "Color", value: [...k.fog.color], section: "Fog" }
      ) : I.push({ kind: "readonly", path: "fog", label: "Fog", value: "Disabled", section: "Fog" }), I.push({
        kind: "readonly",
        path: "clipPlane",
        label: "Clip plane",
        value: k.clipPlane ? `[${k.clipPlane.map((R) => R.toFixed(3)).join(", ")}]` : "Disabled",
        section: "Clipping"
      }), I.push(...S), I;
    }
    return a;
  }, A = async (g, l, a, S) => {
    var k, I, G, z, R, c, b;
    const M = g.source;
    if (!M || typeof M != "object") return N("unsupported", "This entity has no editable public source.");
    const $ = e.get(M);
    try {
      if ($ === "scene") {
        const f = M;
        if (l === "clearColor" && Me(a, 4))
          f.clearColor.r = se(a[0]), f.clearColor.g = se(a[1]), f.clearColor.b = se(a[2]), f.clearColor.a = se(a[3]);
        else if (l === "fixedDeltaMs" && typeof a == "number" && Number.isFinite(a))
          f.fixedDeltaMs = Math.max(0, a);
        else if (l.startsWith("fog.") && f.fog) {
          const w = { ...f.fog, color: [...f.fog.color] };
          if (l === "fog.mode" && typeof a == "string" && ["0", "1", "2", "3"].includes(a)) w.mode = Number(a);
          else if (l === "fog.density" && typeof a == "number" && Number.isFinite(a)) w.density = Math.max(0, a);
          else if (l === "fog.start" && typeof a == "number" && Number.isFinite(a)) w.start = a;
          else if (l === "fog.end" && typeof a == "number" && Number.isFinite(a)) w.end = a;
          else if (l === "fog.color" && Me(a, 3)) w.color = [se(a[0]), se(a[1]), se(a[2])];
          else return N("invalid", `Invalid value for ${l}.`);
          (((k = S.lite) == null ? void 0 : k.setFog) ?? Kn)(f, w);
        } else if (l === "imageProcessing.exposure" && typeof a == "number" && Number.isFinite(a))
          await (((I = S.lite) == null ? void 0 : I.setSceneImageProcessing) ?? ze)(f, { exposure: Math.max(0, a) });
        else if (l === "imageProcessing.contrast" && typeof a == "number" && Number.isFinite(a))
          await (((G = S.lite) == null ? void 0 : G.setSceneImageProcessing) ?? ze)(f, { contrast: Math.max(0, a) });
        else if (l === "imageProcessing.toneMappingEnabled" && typeof a == "boolean")
          await (((z = S.lite) == null ? void 0 : z.setSceneImageProcessing) ?? ze)(f, { toneMappingEnabled: a });
        else if (l === "imageProcessing.toneMapping" && typeof a == "string") {
          const w = _i(a, S.lite);
          if (!w) return N("invalid", `Invalid value for ${l}.`);
          await (((R = S.lite) == null ? void 0 : R.setSceneImageProcessing) ?? ze)(f, { toneMappingEnabled: true, toneMapping: w });
        } else if (l === "environmentPrimaryColor" && Me(a, 3))
          f.environmentPrimaryColor = [se(a[0]), se(a[1]), se(a[2])];
        else if (l === "envRotationY" && typeof a == "number" && Number.isFinite(a))
          f.envRotationY = a;
        else
          return N("invalid", `Invalid value for ${l}.`);
        return q();
      }
      if ($ === "mesh" || $ === "transform") {
        const f = M;
        if (l === "name" && typeof a == "string") f.name = a;
        else if (l === "visible" && typeof a == "boolean") (((c = S.lite) == null ? void 0 : c.setSubtreeVisible) ?? Yn)(f, a);
        else if ((l === "position" || l === "rotation" || l === "scaling") && Array.isArray(a) && a.length === 3 && a.every(Number.isFinite)) {
          const w = a;
          if (l === "scaling" && w.some((L) => L === 0)) return N("invalid", "Scaling components cannot be exactly zero.");
          f[l].set(w[0], w[1], w[2]);
        } else return N("invalid", `Invalid value for ${l}.`);
        return q();
      }
      if ($ === "camera" && ["fov", "nearPlane", "farPlane"].includes(l) && typeof a == "number" && Number.isFinite(a)) {
        const f = M;
        return l === "fov" && (f.fov = Math.min(Math.PI, Math.max(0.01, a))), l === "nearPlane" && (f.nearPlane = Math.max(1e-4, a)), l === "farPlane" && (f.farPlane = Math.max(f.nearPlane + 1e-4, a)), q();
      }
      if ($ === "camera") {
        const f = M;
        if (l.startsWith("viewport.") && f.viewport && typeof a == "number" && Number.isFinite(a)) {
          const w = l.slice(9);
          return w !== "x" && w !== "y" && w !== "width" && w !== "height" ? N("invalid", `Invalid value for ${l}.`) : (f.viewport[w] = se(a), q());
        }
        if (Gt(f)) {
          if ((l === "alpha" || l === "beta") && typeof a == "number" && Number.isFinite(a)) f[l] = a;
          else if (l === "radius" && typeof a == "number" && Number.isFinite(a)) f.radius = Math.max(1e-4, a);
          else if (l === "target" && Array.isArray(a) && a.length === 3 && a.every(Number.isFinite)) f.target = { x: a[0], y: a[1], z: a[2] };
          else if ((l === "inertia" || l === "panningInertia") && typeof a == "number" && Number.isFinite(a)) f[l] = se(a);
          else if ((l === "angularSensibility" || l === "panningSensibility" || l === "wheelPrecision") && typeof a == "number" && Number.isFinite(a)) f[l] = Math.max(1e-4, a);
          else if (["lowerAlphaLimit", "upperAlphaLimit", "lowerBetaLimit", "upperBetaLimit", "lowerRadiusLimit", "upperRadiusLimit"].includes(l) && typeof a == "number" && Number.isFinite(a))
            f[l] = a;
          else return N("invalid", `Invalid value for ${l}.`);
          return q();
        }
        if (Vt(f)) {
          if ((l === "position" || l === "target") && Array.isArray(a) && a.length === 3 && a.every(Number.isFinite))
            gi(f[l], a);
          else if (l === "speed" && typeof a == "number" && Number.isFinite(a)) f.speed = Math.max(0, a);
          else if (l === "angularSensitivity" && typeof a == "number" && Number.isFinite(a)) f.angularSensitivity = Math.max(1e-4, a);
          else if (l === "inertia" && typeof a == "number" && Number.isFinite(a)) f.inertia = se(a);
          else return N("invalid", `Invalid value for ${l}.`);
          return q();
        }
        if (jt(f)) {
          if (l === "center" && Array.isArray(a) && a.length === 3 && a.every(Number.isFinite)) f.center = { x: a[0], y: a[1], z: a[2] };
          else if ((l === "yaw" || l === "pitch") && typeof a == "number" && Number.isFinite(a)) f[l] = a;
          else if (l === "radius" && typeof a == "number" && Number.isFinite(a)) f.radius = Math.max(1e-4, a);
          else if (l.startsWith("limits.") && typeof a == "number" && Number.isFinite(a)) {
            const w = l.slice(7);
            if (!["radiusMin", "radiusMax", "pitchMin", "pitchMax", "yawMin", "yawMax"].includes(w)) return N("invalid", `Invalid value for ${l}.`);
            f.limits[w] = a;
          } else return N("invalid", `Invalid value for ${l}.`);
          return q();
        }
        return N("unsupported", "This camera property is not available on a recognized public camera type.");
      }
      if ($ === "light") {
        const f = M;
        if (l === "intensity" && typeof a == "number" && "intensity" in f) f.intensity = Math.max(0, a);
        else if ((l === "direction" || l === "position") && Array.isArray(a) && a.length === 3 && f[l]) f[l].set(Number(a[0]), Number(a[1]), Number(a[2]));
        else return N("invalid", `Invalid value for ${l}.`);
        return q();
      }
      if ($ === "material") {
        const f = M;
        if (l === "name" && typeof a == "string")
          return f.name = a, q();
        if (et(f))
          if (l === "baseColorFactor" && Me(a, 4))
            f.baseColorFactor = [se(a[0]), se(a[1]), se(a[2]), se(a[3])];
          else if ((l === "metallicFactor" || l === "roughnessFactor" || l === "alpha") && typeof a == "number" && Number.isFinite(a))
            f[l] = se(a);
          else if (l === "environmentIntensity" && typeof a == "number" && Number.isFinite(a))
            f.environmentIntensity = Math.max(0, a);
          else
            return N("invalid", `Invalid value for ${l}.`);
        else if (Ct(f))
          if ((l === "diffuseColor" || l === "specularColor" || l === "emissiveColor" || l === "ambientColor") && Me(a, 3))
            f[l] = [se(a[0]), se(a[1]), se(a[2])];
          else if (l === "alpha" && typeof a == "number" && Number.isFinite(a))
            f.alpha = se(a);
          else if (l === "specularPower" && typeof a == "number" && Number.isFinite(a))
            f.specularPower = Math.max(0, a);
          else if ((l === "bumpLevel" || l === "ambientTexLevel" || l === "lightmapLevel" || l === "opacityLevel" || l === "reflectionLevel") && typeof a == "number" && Number.isFinite(a))
            f[l] = Math.max(0, a);
          else
            return N("invalid", `Invalid value for ${l}.`);
        else
          return N("unsupported", "This material has no verified editable public family.");
        return (((b = S.lite) == null ? void 0 : b.markMaterialUboDirty) ?? Jn)(f), q();
      }
      return N("unsupported", "This property is read-only in the default adapter.");
    } catch (f) {
      return N("failed", f instanceof Error ? f.message : "The public API write failed.");
    }
  };
  return {
    getSceneTree: p,
    getProperties: v,
    setProperty: A,
    getStats: (g) => {
      const l = {};
      return pi(g.engine) && (l.drawCallCount = g.engine.drawCallCount, g.engine.gpuFrameTimeMs > 0 && (l.gpuFrameTimeMs = g.engine.gpuFrameTimeMs), l.surfaceCount = g.engine.surfaces.length), Te(g.scene) && (l.meshCount = g.scene.meshes.length, l.lightCount = g.scene.lights.length, l.animationGroupCount = g.scene.animationGroups.length, l.materialCount = new Set(g.scene.meshes.map((a) => a.material)).size), l;
    },
    pickEntityId: async (g, l, a) => {
      var S, M, $;
      if (!Te(a.scene)) return N("unsupported", "Canvas picking requires a public Babylon Lite SceneContext.");
      try {
        let k = s.get(a.scene);
        k || (k = (((S = a.lite) == null ? void 0 : S.createGpuPicker) ?? cn)(a.scene), s.set(a.scene, k), i.set(k, ((M = a.lite) == null ? void 0 : M.disposePicker) ?? un));
        const I = await ((($ = a.lite) == null ? void 0 : $.pickAsync) ?? dn)(k, g, l);
        return !I.hit || !I.pickedMesh ? q(null) : q(t.get(I.pickedMesh) ?? null);
      } catch (k) {
        return N("failed", k instanceof Error ? k.message : "Canvas picking failed.");
      }
    },
    setEntityVisible: async (g, l, a) => A(g, "visible", l, a),
    removeEntity: async (g, l) => {
      var a;
      if (!Te(l.scene)) return N("unsupported", "Entity removal requires a public Babylon Lite SceneContext.");
      if (!g.source || typeof g.source != "object") return N("unsupported", "This entity has no removable public source.");
      if (g.kind !== "mesh" && g.kind !== "transform" && g.kind !== "light" && g.kind !== "camera")
        return N("unsupported", "This entity cannot be removed from the scene.");
      if (g.kind === "camera" && l.scene.camera === g.source && di(l.scene) <= 1)
        return N("invalid", "Cannot remove the only camera.");
      try {
        return (((a = l.lite) == null ? void 0 : a.removeFromScene) ?? qn)(l.scene, g.source), q();
      } catch (S) {
        return N("failed", S instanceof Error ? S.message : "Entity removal failed.");
      }
    },
    playAnimationGroup: (g, l) => {
      var M, $;
      if (!Te(l.scene)) return N("unsupported", "Animation playback requires a public Babylon Lite SceneContext.");
      const a = g.source;
      if (!a || typeof a != "object" || e.get(a) !== "animationGroup") return N("unsupported", "This entity is not an animation group.");
      const S = a;
      if (!l.scene.animationGroups.includes(S)) return N("unsupported", "This animation group does not belong to the current scene.");
      for (const k of l.scene.animationGroups)
        (((M = l.lite) == null ? void 0 : M.stopAnimation) ?? Lt)(k);
      return ((($ = l.lite) == null ? void 0 : $.playAnimation) ?? zn)(S), q();
    },
    stopAnimationGroup: (g, l) => {
      var M;
      if (!Te(l.scene)) return N("unsupported", "Animation playback requires a public Babylon Lite SceneContext.");
      const a = g.source;
      if (!a || typeof a != "object" || e.get(a) !== "animationGroup") return N("unsupported", "This entity is not an animation group.");
      const S = a;
      return l.scene.animationGroups.includes(S) ? ((((M = l.lite) == null ? void 0 : M.stopAnimation) ?? Lt)(S), q()) : N("unsupported", "This animation group does not belong to the current scene.");
    },
    getEntitySnapshot: (g) => {
      const l = {};
      for (const a of v(g))
        a.path.startsWith("$") || (l[a.path] = a.value);
      return q(l);
    },
    dispose() {
      for (const [g, l] of i) l(g);
      i.clear();
    }
  };
}
function rt(t) {
  let e = false;
  return { dispose: () => {
    e || (e = true, t());
  } };
}
var xi = class {
  constructor() {
    ee(this, "values", []);
    ee(this, "disposed", false);
  }
  add(e) {
    return this.disposed ? e.dispose() : this.values.push(e), e;
  }
  dispose() {
    if (!this.disposed) {
      this.disposed = true;
      for (const e of this.values.reverse()) e.dispose();
      this.values.length = 0;
    }
  }
};
var Fe;
var ie;
var yt;
var Bt;
var ot = 0;
var Tn = [];
var ae = K;
var Ht = ae.__b;
var Wt = ae.__r;
var zt = ae.diffed;
var qt = ae.__c;
var Kt = ae.unmount;
var Yt = ae.__;
function ht(t, e) {
  ae.__h && ae.__h(ie, t, ot || e), ot = 0;
  var n = ie.__H || (ie.__H = { __: [], __h: [] });
  return t >= n.__.length && n.__.push({}), n.__[t];
}
function Se(t) {
  return ot = 1, Pi($n, t);
}
function Pi(t, e, n) {
  var i = ht(Fe++, 2);
  if (i.t = t, !i.__c && (i.__ = [$n(void 0, e), function(d) {
    var m = i.__N ? i.__N[0] : i.__[0], p = i.t(m, d);
    m !== p && (i.__N = [p, i.__[1]], i.__c.setState({}));
  }], i.__c = ie, !ie.__f)) {
    var s = function(d, m, p) {
      if (!i.__c.__H) return true;
      var _ = i.__c.__H.__.filter(function(P) {
        return P.__c;
      });
      if (_.every(function(P) {
        return !P.__N;
      })) return !r || r.call(this, d, m, p);
      var h = i.__c.props !== d;
      return _.some(function(P) {
        if (P.__N) {
          var v = P.__[0];
          P.__ = P.__N, P.__N = void 0, v !== P.__[0] && (h = true);
        }
      }), r && r.call(this, d, m, p) || h;
    };
    ie.__f = true;
    var r = ie.shouldComponentUpdate, o = ie.componentWillUpdate;
    ie.componentWillUpdate = function(d, m, p) {
      if (this.__e) {
        var _ = r;
        r = void 0, s(d, m, p), r = _;
      }
      o && o.call(this, d, m, p);
    }, ie.shouldComponentUpdate = s;
  }
  return i.__N || i.__;
}
function Le(t, e) {
  var n = ht(Fe++, 3);
  !ae.__s && Mn(n.__H, e) && (n.__ = t, n.u = e, ie.__H.__h.push(n));
}
function Nt(t) {
  return ot = 5, mt(function() {
    return { current: t };
  }, []);
}
function mt(t, e) {
  var n = ht(Fe++, 7);
  return Mn(n.__H, e) && (n.__ = t(), n.__H = e, n.__h = t), n.__;
}
function Ci(t) {
  var e = ie.context[t.__c], n = ht(Fe++, 9);
  return n.c = t, e ? (n.__ == null && (n.__ = true, e.sub(ie)), e.props.value) : t.__;
}
function Ei() {
  for (var t; t = Tn.shift(); ) {
    var e = t.__H;
    if (t.__P && e) try {
      e.__h.some(tt), e.__h.some(Et), e.__h = [];
    } catch (n) {
      e.__h = [], ae.__e(n, t.__v);
    }
  }
}
ae.__b = function(t) {
  ie = null, Ht && Ht(t);
}, ae.__ = function(t, e) {
  t && e.__k && e.__k.__m && (t.__m = e.__k.__m), Yt && Yt(t, e);
}, ae.__r = function(t) {
  Wt && Wt(t), Fe = 0;
  var e = (ie = t.__c).__H;
  e && (yt === ie ? (e.__h = [], ie.__h = [], e.__.some(function(n) {
    n.__N && (n.__ = n.__N), n.u = n.__N = void 0;
  })) : (e.__h.some(tt), e.__h.some(Et), e.__h = [], Fe = 0)), yt = ie;
}, ae.diffed = function(t) {
  zt && zt(t);
  var e = t.__c;
  e && e.__H && (e.__H.__h.length && (Tn.push(e) !== 1 && Bt === ae.requestAnimationFrame || ((Bt = ae.requestAnimationFrame) || Ti)(Ei)), e.__H.__.some(function(n) {
    n.u && (n.__H = n.u), n.u = void 0;
  })), yt = ie = null;
}, ae.__c = function(t, e) {
  e.some(function(n) {
    try {
      n.__h.some(tt), n.__h = n.__h.filter(function(i) {
        return !i.__ || Et(i);
      });
    } catch (i) {
      e.some(function(s) {
        s.__h && (s.__h = []);
      }), e = [], ae.__e(i, n.__v);
    }
  }), qt && qt(t, e);
}, ae.unmount = function(t) {
  Kt && Kt(t);
  var e, n = t.__c;
  n && n.__H && (n.__H.__.some(function(i) {
    try {
      tt(i);
    } catch (s) {
      e = s;
    }
  }), n.__H = void 0, e && ae.__e(e, n.__v));
};
var Jt = typeof requestAnimationFrame == "function";
function Ti(t) {
  var e, n = function() {
    clearTimeout(i), Jt && cancelAnimationFrame(e), setTimeout(t);
  }, i = setTimeout(n, 35);
  Jt && (e = requestAnimationFrame(n));
}
function tt(t) {
  var e = ie, n = t.__c;
  typeof n == "function" && (t.__c = void 0, n()), ie = e;
}
function Et(t) {
  var e = ie;
  t.__c = t.__(), ie = e;
}
function Mn(t, e) {
  return !t || t.length !== e.length || e.some(function(n, i) {
    return n !== t[i];
  });
}
function $n(t, e) {
  return typeof e == "function" ? e(t) : e;
}
var Mi = /* @__PURE__ */ Symbol.for("preact-signals");
function bt() {
  if (_e > 1)
    _e--;
  else {
    var t, e = false;
    for ((function() {
      var s = lt;
      for (lt = void 0; s !== void 0; )
        s.S.v === s.v && (s.S.i = s.i), s = s.o;
    })(); Be !== void 0; ) {
      var n = Be;
      for (Be = void 0, at++; n !== void 0; ) {
        var i = n.u;
        if (n.u = void 0, n.f &= -3, !(8 & n.f) && An(n)) try {
          n.c();
        } catch (s) {
          e || (t = s, e = true);
        }
        n = i;
      }
    }
    if (at = 0, _e--, e) throw t;
  }
}
function $i(t) {
  if (_e > 0) return t();
  Tt = ++Ii, _e++;
  try {
    return t();
  } finally {
    bt();
  }
}
var te = void 0;
function gt(t) {
  var e = te;
  te = void 0;
  try {
    return t();
  } finally {
    te = e;
  }
}
var Be = void 0;
var _e = 0;
var at = 0;
var Ii = 0;
var Tt = 0;
var lt = void 0;
var ct = 0;
function In(t) {
  if (te !== void 0) {
    var e = t.n;
    if (e === void 0 || e.t !== te)
      return e = { i: 0, S: t, p: te.s, n: void 0, t: te, e: void 0, x: void 0, r: e }, te.s !== void 0 && (te.s.n = e), te.s = e, t.n = e, 32 & te.f && t.S(e), e;
    if (e.i === -1)
      return e.i = 0, e.n !== void 0 && (e.n.p = e.p, e.p !== void 0 && (e.p.n = e.n), e.p = te.s, e.n = void 0, te.s.n = e, te.s = e), e;
  }
}
function ue(t, e) {
  this.v = t, this.i = 0, this.n = void 0, this.t = void 0, this.l = 0, this.W = e == null ? void 0 : e.watched, this.Z = e == null ? void 0 : e.unwatched, this.name = e == null ? void 0 : e.name;
}
ue.prototype.brand = Mi;
ue.prototype.h = function() {
  return true;
};
ue.prototype.S = function(t) {
  var e = this, n = this.t;
  n !== t && t.e === void 0 && (t.x = n, this.t = t, n !== void 0 ? n.e = t : gt(function() {
    var i;
    (i = e.W) == null || i.call(e);
  }));
};
ue.prototype.U = function(t) {
  var e = this;
  if (this.t !== void 0) {
    var n = t.e, i = t.x;
    n !== void 0 && (n.x = i, t.e = void 0), i !== void 0 && (i.e = n, t.x = void 0), t === this.t && (this.t = i, i === void 0 && gt(function() {
      var s;
      (s = e.Z) == null || s.call(e);
    }));
  }
};
ue.prototype.subscribe = function(t) {
  var e = this;
  return We(function() {
    var n = e.value;
    gt(function() {
      return t(n);
    });
  }, { name: "sub" });
};
ue.prototype.valueOf = function() {
  return this.value;
};
ue.prototype.toString = function() {
  return this.value + "";
};
ue.prototype.toJSON = function() {
  return this.value;
};
ue.prototype.peek = function() {
  var t = this;
  return gt(function() {
    return t.value;
  });
};
Object.defineProperty(ue.prototype, "value", { get: function() {
  var t = In(this);
  return t !== void 0 && (t.i = this.i), this.v;
}, set: function(t) {
  if (t !== this.v) {
    if (at > 100) throw new Error("Cycle detected");
    (function(n) {
      _e !== 0 && at === 0 && n.l !== Tt && (n.l = Tt, lt = { S: n, v: n.v, i: n.i, o: lt });
    })(this), this.v = t, this.i++, ct++, _e++;
    try {
      for (var e = this.t; e !== void 0; e = e.x) e.t.N();
    } finally {
      bt();
    }
  }
} });
function J(t, e) {
  return new ue(t, e);
}
function An(t) {
  for (var e = t.s; e !== void 0; e = e.n) if (e.S.i !== e.i || !e.S.h() || e.S.i !== e.i) return true;
  return false;
}
function Nn(t) {
  for (var e = t.s; e !== void 0; e = e.n) {
    var n = e.S.n;
    if (n !== void 0 && (e.r = n), e.S.n = e, e.i = -1, e.n === void 0) {
      t.s = e;
      break;
    }
  }
}
function Fn(t) {
  for (var e = t.s, n = void 0; e !== void 0; ) {
    var i = e.p;
    e.i === -1 ? (e.S.U(e), i !== void 0 && (i.n = e.n), e.n !== void 0 && (e.n.p = i)) : n = e, e.S.n = e.r, e.r !== void 0 && (e.r = void 0), e = i;
  }
  t.s = n;
}
function Ce(t, e) {
  ue.call(this, void 0, e), this.x = t, this.s = void 0, this.g = ct - 1, this.f = 4;
}
Ce.prototype = new ue();
Ce.prototype.h = function() {
  if (this.f &= -3, 1 & this.f) return false;
  if ((36 & this.f) == 32 || (this.f &= -5, this.g === ct)) return true;
  if (this.g = ct, this.f |= 1, this.i > 0 && !An(this))
    return this.f &= -2, true;
  var t = te;
  try {
    Nn(this), te = this;
    var e = this.x();
    (16 & this.f || this.v !== e || this.i === 0) && (this.v = e, this.f &= -17, this.i++);
  } catch (n) {
    this.v = n, this.f |= 16, this.i++;
  }
  return te = t, Fn(this), this.f &= -2, true;
};
Ce.prototype.S = function(t) {
  if (this.t === void 0) {
    this.f |= 36;
    for (var e = this.s; e !== void 0; e = e.n) e.S.S(e);
  }
  ue.prototype.S.call(this, t);
};
Ce.prototype.U = function(t) {
  if (this.t !== void 0 && (ue.prototype.U.call(this, t), this.t === void 0)) {
    this.f &= -33;
    for (var e = this.s; e !== void 0; e = e.n) e.S.U(e);
  }
};
Ce.prototype.N = function() {
  if (!(2 & this.f)) {
    this.f |= 6;
    for (var t = this.t; t !== void 0; t = t.x) t.t.N();
  }
};
Object.defineProperty(Ce.prototype, "value", { get: function() {
  if (1 & this.f) throw new Error("Cycle detected");
  var t = In(this);
  if (this.h(), t !== void 0 && (t.i = this.i), 16 & this.f) throw this.v;
  return this.v;
} });
function ut(t, e) {
  return new Ce(t, e);
}
function Ln(t) {
  var e = t.m;
  if (t.m = void 0, typeof e == "function") {
    _e++;
    var n = te;
    te = void 0;
    try {
      e();
    } catch (i) {
      throw t.f &= -2, t.f |= 8, Ft(t), i;
    } finally {
      te = n, bt();
    }
  }
}
function Ft(t) {
  for (var e = t.s; e !== void 0; e = e.n) e.S.U(e);
  t.x = void 0, t.s = void 0, Ln(t);
}
function Ai(t) {
  if (te !== this) throw new Error("Out-of-order effect");
  Fn(this), te = t, this.f &= -2, 8 & this.f && Ft(this), bt();
}
function Re(t, e) {
  this.x = t, this.m = void 0, this.s = void 0, this.u = void 0, this.f = 32, this.name = e == null ? void 0 : e.name;
}
Re.prototype.c = function() {
  var t = this.S();
  try {
    if (8 & this.f || this.x === void 0) return;
    var e = this.x();
    typeof e == "function" && (this.m = e);
  } finally {
    t();
  }
};
Re.prototype.S = function() {
  if (1 & this.f) throw new Error("Cycle detected");
  this.f |= 1, this.f &= -9, Ln(this), Nn(this), _e++;
  var t = te;
  return te = this, Ai.bind(this, t);
};
Re.prototype.N = function() {
  2 & this.f || (this.f |= 2, this.u = Be, Be = this);
};
Re.prototype.d = function() {
  this.f |= 8, 1 & this.f || Ft(this);
};
Re.prototype.dispose = function() {
  this.d();
};
function We(t, e) {
  var n = new Re(t, e);
  try {
    n.c();
  } catch (s) {
    throw n.d(), s;
  }
  var i = n.d.bind(n);
  return i[Symbol.dispose] = i, i;
}
var Dn;
var Ye;
var Ni = typeof window < "u" && !!window.__PREACT_SIGNALS_DEVTOOLS__;
var Rn = [];
We(function() {
  Dn = this.N;
})();
function Ue(t, e) {
  K[t] = e.bind(null, K[t] || function() {
  });
}
function dt(t) {
  if (Ye) {
    var e = Ye;
    Ye = void 0, e();
  }
  Ye = t && t.S();
}
function Un(t) {
  var e = this, n = t.data, i = Li(n);
  i.value = n;
  var s = mt(function() {
    for (var d = e, m = e.__v; m = m.__; ) if (m.__c) {
      m.__c.__$f |= 4;
      break;
    }
    var p = ut(function() {
      var v = i.value.value;
      return v === 0 ? 0 : v === true ? "" : v || "";
    }), _ = ut(function() {
      return !Array.isArray(p.value) && !mn(p.value);
    }), h = We(function() {
      if (this.N = On, _.value) {
        var v = p.value;
        d.__v && d.__v.__e && d.__v.__e.nodeType === 3 && (d.__v.__e.data = v);
      }
    }), P = e.__$u.d;
    return e.__$u.d = function() {
      h(), P.call(this);
    }, [_, p];
  }, []), r = s[0], o = s[1];
  return r.value ? o.peek() : o.value;
}
Un.displayName = "ReactiveTextNode";
Object.defineProperties(ue.prototype, { constructor: { configurable: true, value: void 0 }, type: { configurable: true, value: Un }, props: { configurable: true, get: function() {
  var t = this;
  return { data: { get value() {
    return t.value;
  } } };
} }, __b: { configurable: true, value: 1 } });
Ue("__b", function(t, e) {
  if (typeof e.type == "string") {
    var n, i = e.props;
    for (var s in i) if (s !== "children") {
      var r = i[s];
      r instanceof ue && (n || (e.__np = n = {}), n[s] = r, i[s] = r.peek());
    }
  }
  t(e);
});
Ue("__r", function(t, e) {
  if (t(e), e.type !== De) {
    dt();
    var n, i = e.__c;
    i && (i.__$f &= -2, (n = i.__$u) === void 0 && (i.__$u = n = (function(s, r) {
      var o;
      return We(function() {
        o = this;
      }, { name: r }), o.c = s, o;
    })(function() {
      var s;
      Ni && ((s = n.y) == null || s.call(n)), i.__$f |= 1, i.setState({});
    }, typeof e.type == "function" ? e.type.displayName || e.type.name : ""))), dt(n);
  }
});
Ue("__e", function(t, e, n, i) {
  dt(), t(e, n, i);
});
Ue("diffed", function(t, e) {
  dt();
  var n;
  if (typeof e.type == "string" && (n = e.__e)) {
    var i = e.__np, s = e.props;
    if (i) {
      var r = n.U;
      if (r) for (var o in r) {
        var d = r[o];
        d !== void 0 && !(o in i) && (d.d(), r[o] = void 0);
      }
      else
        r = {}, n.U = r;
      for (var m in i) {
        var p = r[m], _ = i[m];
        p === void 0 ? (p = Fi(n, m, _, s), r[m] = p) : p.o(_, s);
      }
    }
  }
  t(e);
});
function Fi(t, e, n, i) {
  var s = e in t && t.ownerSVGElement === void 0, r = J(n);
  return { o: function(o, d) {
    r.value = o, i = d;
  }, d: We(function() {
    this.N = On;
    var o = r.value.value;
    i[e] !== o && (i[e] = o, s ? t[e] = o : o != null && (o !== false || e[4] === "-") ? t.setAttribute(e, o) : t.removeAttribute(e));
  }) };
}
Ue("unmount", function(t, e) {
  if (typeof e.type == "string") {
    var n = e.__e;
    if (n) {
      var i = n.U;
      if (i) {
        n.U = void 0;
        for (var s in i) {
          var r = i[s];
          r && r.d();
        }
      }
    }
    var o = e.__np;
    if (o) {
      var d = e.props;
      for (var m in o) d[m] = o[m];
    }
    e.__np = void 0;
  } else {
    var p = e.__c;
    if (p) {
      var _ = p.__$u;
      _ && (p.__$u = void 0, _.d());
    }
  }
  t(e);
});
Ue("__h", function(t, e, n, i) {
  (i < 3 || i === 9) && (e.__$f |= 2), t(e, n, i);
});
Ie.prototype.shouldComponentUpdate = function(t, e) {
  if (this.__R) return true;
  var n = this.__$u, i = n && n.s !== void 0;
  for (var s in e) return true;
  if (this.__f || typeof this.u == "boolean" && this.u === true) {
    var r = 2 & this.__$f;
    if (!(i || r || 4 & this.__$f) || 1 & this.__$f) return true;
  } else if (!(i || 4 & this.__$f) || 3 & this.__$f) return true;
  for (var o in t) if (o !== "__source" && t[o] !== this.props[o]) return true;
  for (var d in this.props) if (!(d in t)) return true;
  return false;
};
function Li(t, e) {
  return mt(function() {
    return J(t, e);
  }, []);
}
var Di = function(t) {
  queueMicrotask(function() {
    queueMicrotask(t);
  });
};
function Ri() {
  $i(function() {
    for (var t; t = Rn.shift(); ) Dn.call(t);
  });
}
function On() {
  Rn.push(this) === 1 && (K.requestAnimationFrame || Di)(Ri);
}
function He(t, e) {
  for (const n of t) {
    if (n.id === e) return n;
    const i = n.children ? He(n.children, e) : null;
    if (i) return i;
  }
  return null;
}
function Gn(t, e) {
  for (const n of t) {
    if (n.id === e) return [n];
    const i = n.children ? Gn(n.children, e) : null;
    if (i) return [n, ...i];
  }
  return null;
}
function Ui(t, e) {
  const n = e.trim().toLocaleLowerCase();
  if (!n) return [...t];
  const i = (s) => {
    var o;
    const r = ((o = s.children) == null ? void 0 : o.map(i).filter((d) => d !== null)) ?? [];
    return s.label.toLocaleLowerCase().includes(n) || r.length ? { ...s, children: r.length ? r : void 0 } : null;
  };
  return t.map(i).filter((s) => s !== null);
}
function Oi() {
  const t = J(true), e = J("dark"), n = J("single"), i = J(null), s = J(null), r = J(0), o = J(null), d = J([]), m = J([]), p = J([]), _ = J({}), h = J(""), P = J(/* @__PURE__ */ new Set()), v = J([]), A = J(false), V = J(false), E = J(false), x = J(false), C = J({
    confirmEntityRemoval: false,
    instancerPickMode: "instance",
    keyboardShortcutsEnabled: true,
    notificationsEnabled: true,
    notificationDurationMs: 3e3
  }), T = J([]), j = J([]), g = J({ left: null, right: null, single: null }), l = J(44), a = ut(() => o.value ? He(d.value, o.value) ?? He(m.value, o.value) : null), S = ut(() => Ui(d.value, h.value));
  return {
    isOpen: t,
    theme: e,
    layout: n,
    context: i,
    adapter: s,
    sceneVersion: r,
    selectedEntityId: o,
    selectedEntity: a,
    tree: d,
    extensionEntities: m,
    filteredTree: S,
    properties: p,
    stats: _,
    search: h,
    expandedIds: P,
    notifications: v,
    isRefreshingTree: A,
    isRefreshingProperties: V,
    pickingAvailable: E,
    pickingActive: x,
    userSettings: C,
    panes: T,
    toolbarItems: j,
    selectedPanes: g,
    singlePanePercent: l
  };
}
var Gi = class {
  constructor() {
    ee(this, "id", "commands");
    ee(this, "commands", /* @__PURE__ */ new Map());
  }
  register(e) {
    if (this.commands.has(e.id)) throw new Error(`Command already registered: ${e.id}`);
    return this.commands.set(e.id, e), rt(() => this.commands.delete(e.id));
  }
  get(e) {
    return this.commands.get(e);
  }
  list(e) {
    return [...this.commands.values()].filter((n) => {
      var i;
      return ((i = n.when) == null ? void 0 : i.call(n, e)) ?? true;
    });
  }
  dispose() {
    this.commands.clear();
  }
};
var Vi = class {
  constructor(e, n = 3e3, i = true) {
    ee(this, "nextId", 1);
    ee(this, "timers", /* @__PURE__ */ new Map());
    this.signals = e, this.durationMs = n, this.enabled = i;
  }
  push(e, n = "error") {
    if (!this.enabled) return;
    const i = { id: this.nextId++, tone: n, message: e };
    this.signals.notifications.value = [...this.signals.notifications.value.slice(-3), i], this.durationMs > 0 && this.timers.set(i.id, setTimeout(() => this.dismiss(i.id), this.durationMs));
  }
  dismiss(e) {
    const n = this.timers.get(e);
    n && clearTimeout(n), this.timers.delete(e), this.signals.notifications.value = this.signals.notifications.value.filter((i) => i.id !== e);
  }
  dispose() {
    for (const e of this.timers.values()) clearTimeout(e);
    this.timers.clear(), this.signals.notifications.value = [];
  }
};
var ji = class {
  constructor(e, n, i, s, r) {
    ee(this, "pointers", /* @__PURE__ */ new Map());
    ee(this, "generation", 0);
    ee(this, "started", false);
    ee(this, "onPointerDown", (e2) => {
      !e2.isPrimary || e2.pointerType !== "touch" && e2.button !== 0 || this.pointers.set(e2.pointerId, { x: e2.clientX, y: e2.clientY });
    });
    ee(this, "onPointerUp", (e2) => {
      const n2 = this.pointers.get(e2.pointerId);
      if (this.pointers.delete(e2.pointerId), !n2 || Math.hypot(e2.clientX - n2.x, e2.clientY - n2.y) > 4) return;
      const i2 = this.canvas.getBoundingClientRect();
      this.pick(e2.clientX - i2.left, e2.clientY - i2.top);
    });
    ee(this, "onPointerCancel", (e2) => {
      this.pointers.delete(e2.pointerId);
    });
    this.canvas = e, this.signals = n, this.refresh = i, this.notifications = s, this.shell = r;
  }
  start() {
    this.started || (this.started = true, this.canvas.addEventListener("pointerdown", this.onPointerDown), this.canvas.addEventListener("pointerup", this.onPointerUp), this.canvas.addEventListener("pointercancel", this.onPointerCancel));
  }
  async pick(e, n) {
    var o, d, m, p;
    const i = ++this.generation, s = this.signals.adapter.value, r = this.signals.context.value;
    if (!(!(s != null && s.pickEntityId) || !r))
      try {
        const _ = await s.pickEntityId(e, n, {
          ...r,
          explorer: {
            ...r.explorer,
            userSettings: {
              ...(o = r.explorer) == null ? void 0 : o.userSettings,
              instancerPickMode: this.signals.userSettings.value.instancerPickMode
            }
          }
        });
        if (!this.started || i !== this.generation) return;
        if (!_.ok) {
          this.notifications.push(_.message);
          return;
        }
        await this.refresh.select(_.value), (m = (d = this.signals.selectedEntity.value) == null ? void 0 : d.meta) != null && m.instancer && ((p = this.shell) == null || p.selectPane("instancer"));
      } catch (_) {
        this.started && i === this.generation && this.notifications.push(_ instanceof Error ? _.message : "Canvas picking failed.");
      }
  }
  stop() {
    this.started && (this.started = false, this.generation++, this.pointers.clear(), this.canvas.removeEventListener("pointerdown", this.onPointerDown), this.canvas.removeEventListener("pointerup", this.onPointerUp), this.canvas.removeEventListener("pointercancel", this.onPointerCancel));
  }
  dispose() {
    this.stop();
  }
};
var Bi = class {
  constructor(e, n) {
    ee(this, "generation", 0);
    ee(this, "disposed", false);
    ee(this, "propertyWrites", /* @__PURE__ */ new Map());
    this.signals = e, this.notifications = n;
  }
  async refreshTree() {
    var s;
    const e = ++this.generation, n = this.signals.context.value, i = this.signals.adapter.value;
    if (!(!n || !i || this.disposed)) {
      this.signals.isRefreshingTree.value = true;
      try {
        const r = await i.getSceneTree(n), o = await ((s = i.getExtensionEntities) == null ? void 0 : s.call(i, n)) ?? [];
        if (this.disposed || e !== this.generation) return;
        this.signals.tree.value = r, this.signals.extensionEntities.value = o, this.signals.sceneVersion.value++;
        const d = this.signals.selectedEntityId.value;
        d && !He(r, d) && !He(o, d) && (this.signals.selectedEntityId.value = null), await this.refreshProperties(e);
      } catch (r) {
        !this.disposed && e === this.generation && this.notifications.push(r instanceof Error ? r.message : "Scene refresh failed.");
      } finally {
        !this.disposed && e === this.generation && (this.signals.isRefreshingTree.value = false);
      }
    }
  }
  async select(e) {
    if (this.signals.selectedEntityId.value = e, e) {
      const i = Gn(this.signals.tree.value, e);
      if (i != null && i.length) {
        const s = new Set(this.signals.expandedIds.value);
        for (const r of i.slice(0, -1)) s.add(r.id);
        this.signals.expandedIds.value = s;
      }
    }
    const n = ++this.generation;
    await this.refreshProperties(n);
  }
  async refreshProperties(e = ++this.generation) {
    const n = this.signals.context.value, i = this.signals.adapter.value, s = this.signals.selectedEntity.value;
    if (!n || !i || !s) {
      this.signals.properties.value = [];
      return;
    }
    const r = s.id;
    this.signals.isRefreshingProperties.value = true;
    try {
      const o = await i.getProperties(s, n);
      !this.disposed && e === this.generation && this.signals.selectedEntityId.value === r && (this.signals.properties.value = o);
    } catch (o) {
      !this.disposed && e === this.generation && this.notifications.push(o instanceof Error ? o.message : "Property refresh failed.");
    } finally {
      !this.disposed && e === this.generation && (this.signals.isRefreshingProperties.value = false);
    }
  }
  setProperty(e, n) {
    const i = this.signals.context.value, s = this.signals.adapter.value, r = this.signals.selectedEntity.value;
    if (!i || !(s != null && s.setProperty) || !r || this.disposed) return Promise.resolve(false);
    const o = `${r.id}\0${e.path}`, m = (this.propertyWrites.get(o) ?? Promise.resolve(true)).then(
      () => this.performPropertyWrite(r, e, n, i, s.setProperty),
      () => this.performPropertyWrite(r, e, n, i, s.setProperty)
    );
    return this.propertyWrites.set(o, m), m.finally(() => {
      this.propertyWrites.get(o) === m && this.propertyWrites.delete(o);
    }), m;
  }
  async performPropertyWrite(e, n, i, s, r) {
    if (this.disposed) return false;
    try {
      const o = await r(e, n.path, i, s);
      return o.ok ? (n.path === "name" ? await this.refreshTree() : this.signals.selectedEntityId.value === e.id && await this.refreshProperties(), this.signals.sceneVersion.value++, true) : (this.notifications.push(o.message), false);
    } catch (o) {
      return this.notifications.push(o instanceof Error ? o.message : "Property update failed."), false;
    }
  }
  dispose() {
    this.disposed = true, this.generation++, this.propertyWrites.clear();
  }
};
var Xt = (t) => [...t].sort((e, n) => (e.order ?? 0) - (n.order ?? 0) || e.key.localeCompare(n.key));
var Hi = class {
  constructor(e) {
    this.signals = e;
  }
  addSidePane(e) {
    if (this.signals.panes.value.some((n) => n.key === e.key)) throw new Error(`Pane already registered: ${e.key}`);
    return this.signals.panes.value = Xt([...this.signals.panes.value, e]), this.signals.selectedPanes.value[e.side] || this.selectPane(e.key, false), this.signals.selectedPanes.value.single || (this.signals.selectedPanes.value = { ...this.signals.selectedPanes.value, single: e.key }), rt(() => {
      var n;
      if (this.signals.panes.value = this.signals.panes.value.filter((i) => i.key !== e.key), this.signals.selectedPanes.value[e.side] === e.key) {
        const i = ((n = this.signals.panes.value.find((s) => s.side === e.side)) == null ? void 0 : n.key) ?? null;
        this.signals.selectedPanes.value = { ...this.signals.selectedPanes.value, [e.side]: i };
      }
    });
  }
  addToolbarItem(e) {
    if (this.signals.toolbarItems.value.some((n) => n.key === e.key)) throw new Error(`Toolbar item already registered: ${e.key}`);
    return this.signals.toolbarItems.value = Xt([...this.signals.toolbarItems.value, e]), rt(() => {
      this.signals.toolbarItems.value = this.signals.toolbarItems.value.filter((n) => n.key !== e.key);
    });
  }
  selectPane(e, n = true) {
    const i = this.signals.panes.value.find((s) => s.key === e);
    i && (this.signals.selectedPanes.value = {
      ...this.signals.selectedPanes.value,
      [i.side]: e,
      ...n ? { single: e } : {}
    });
  }
};
var Wi = class {
  constructor(e) {
    ee(this, "timer");
    ee(this, "frameHandle");
    ee(this, "previousFrameTime");
    ee(this, "frameTimeTotal", 0);
    ee(this, "frameCount", 0);
    ee(this, "sampling", false);
    ee(this, "onFrame", (e2) => {
      if (this.previousFrameTime !== void 0) {
        const n = e2 - this.previousFrameTime;
        n > 0 && n < 1e3 && (this.frameTimeTotal += n, this.frameCount++);
      }
      this.previousFrameTime = e2, this.frameHandle = requestAnimationFrame(this.onFrame);
    });
    this.signals = e;
  }
  start() {
    this.timer || (typeof requestAnimationFrame == "function" && (this.frameHandle = requestAnimationFrame(this.onFrame)), this.timer = setInterval(() => {
      this.sample();
    }, 500));
  }
  async sample() {
    if (this.sampling) return;
    const e = this.signals.context.value, n = this.signals.adapter.value;
    if (!e || !(n != null && n.getStats)) return;
    this.sampling = true;
    const i = this.frameCount ? this.frameTimeTotal / this.frameCount : void 0;
    this.frameTimeTotal = 0, this.frameCount = 0;
    try {
      const s = await n.getStats(e);
      this.signals.stats.value = i === void 0 ? s : { ...s, frameMs: i, fps: 1e3 / i };
    } catch {
    } finally {
      this.sampling = false;
    }
  }
  dispose() {
    this.timer && clearInterval(this.timer), this.frameHandle !== void 0 && typeof cancelAnimationFrame == "function" && cancelAnimationFrame(this.frameHandle), this.timer = void 0, this.frameHandle = void 0, this.previousFrameTime = void 0, this.frameTimeTotal = 0, this.frameCount = 0;
  }
};
var zi = 0;
function u(t, e, n, i, s, r) {
  e || (e = {});
  var o, d, m = e;
  if ("ref" in m) for (d in m = {}, e) d == "ref" ? o = e[d] : m[d] = e[d];
  var p = { type: t, props: m, key: n, ref: o, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: --zi, __i: -1, __u: 0, __source: s, __self: r };
  if (typeof t == "function" && (o = t.defaultProps)) for (d in o) m[d] === void 0 && (m[d] = o[d]);
  return K.vnode && K.vnode(p), p;
}
var Vn = oi(null);
function pe() {
  const t = Ci(Vn);
  if (!t) throw new Error("Explorer runtime is unavailable.");
  return t;
}
var qi = "data:image/svg+xml,%3c?xml%20version='1.0'%20encoding='UTF-8'?%3e%3csvg%20id='Layer_2'%20data-name='Layer%202'%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2069.75%2076.38'%3e%3cdefs%3e%3cstyle%3e%20.cls-1%20{%20fill:%20%23250bf1;%20}%20.cls-2%20{%20fill:%20%232128b9;%20}%20.cls-3%20{%20fill:%20%231204ce;%20}%20.cls-4%20{%20fill:%20%230c1486;%20}%20.cls-5%20{%20fill:%20none;%20stroke:%20%23000;%20stroke-miterlimit:%2010;%20stroke-width:%20.25px;%20}%20.cls-6%20{%20fill:%20%23f2f2f2;%20}%20.cls-7%20{%20fill:%20%23232ac3;%20}%20.cls-8%20{%20fill:%20%233315ff;%20}%20.cls-9%20{%20fill:%20%23fbfbfb;%20}%20.cls-10%20{%20fill:%20%23171fa2;%20}%20.cls-11%20{%20fill:%20%23aab0c4;%20}%20%3c/style%3e%3c/defs%3e%3cg%20id='Layer_1-2'%20data-name='Layer%201'%3e%3cpolygon%20class='cls-2'%20points='11.62%2022.3%2011.62%2036.65%200%2031.15%200%2016.79%2011.62%2022.3'/%3e%3cpolygon%20class='cls-2'%20points='11.62%2036.65%2011.62%2051.01%200%2045.51%200%2031.15%2011.62%2036.65'/%3e%3cpolygon%20class='cls-2'%20points='11.62%2051.01%2011.62%2065.37%200%2059.87%200%2045.51%2011.62%2051.01'/%3e%3cpolygon%20class='cls-7'%20points='34.87%2062.02%2034.87%2076.38%2023.25%2070.88%2023.25%2056.52%2034.87%2062.02'/%3e%3cpolygon%20class='cls-9'%20points='23.25%2056.52%2023.25%2070.88%2011.62%2065.37%2011.62%2051.01%2023.25%2056.52'/%3e%3cpolygon%20class='cls-9'%20points='23.25%2027.8%2023.25%2042.16%2011.62%2036.65%2011.62%2022.3%2011.63%2022.3%2023.25%2027.8'/%3e%3cpolygon%20class='cls-9'%20points='34.87%2047.66%2034.87%2062.02%2023.25%2056.52%2023.25%2042.16%2034.87%2047.66'/%3e%3cpolygon%20class='cls-9'%20points='23.25%2042.16%2023.25%2056.52%2011.62%2051.01%2011.62%2036.65%2023.25%2042.16'/%3e%3cline%20class='cls-5'%20x1='11.62'%20y1='65.38'%20x2='11.62'%20y2='65.37'/%3e%3cpolygon%20class='cls-4'%20points='69.75%2031.15%2069.75%2045.51%2058.12%2051.01%2058.12%2036.65%2069.75%2031.15'/%3e%3cpolygon%20class='cls-4'%20points='69.75%2045.51%2069.75%2059.87%2058.12%2065.37%2058.12%2051.01%2069.75%2045.51'/%3e%3cpolygon%20class='cls-4'%20points='58.12%2051.01%2058.12%2065.38%2046.5%2070.88%2046.5%2056.52%2058.12%2051.01'/%3e%3cpolygon%20class='cls-4'%20points='46.5%2056.52%2046.5%2070.88%2034.87%2076.38%2034.87%2062.02%2046.5%2056.52'/%3e%3cpolygon%20class='cls-11'%20points='46.5%2042.16%2046.5%2056.52%2034.87%2062.02%2034.87%2047.66%2046.5%2042.16'/%3e%3cpolygon%20class='cls-11'%20points='58.12%2036.65%2058.12%2051.01%2046.5%2056.52%2046.5%2042.16%2058.12%2036.65'/%3e%3cpolygon%20class='cls-4'%20points='69.75%2016.79%2069.75%2031.15%2058.12%2036.65%2058.12%2022.3%2058.14%2022.28%2058.15%2022.28%2069.75%2016.79'/%3e%3cpolygon%20class='cls-3'%20points='23.27%2042.18%2023.27%2027.82%2034.9%2022.32%2034.9%2036.68%2023.27%2042.18'/%3e%3cpolygon%20class='cls-11'%20points='58.12%2022.3%2058.12%2036.65%2046.5%2042.16%2046.5%2027.8%2046.52%2027.78%2046.53%2027.78%2058.12%2022.3'/%3e%3cline%20class='cls-5'%20x1='58.62'%20y1='11.29'%20x2='58.59'%20y2='11.3'/%3e%3cline%20class='cls-5'%20x1='46.73'%20y1='5.61'%20x2='46.69'%20y2='5.63'/%3e%3cline%20class='cls-5'%20x1='46.6'%20y1='27.82'%20x2='46.53'%20y2='27.78'/%3e%3cpolygon%20class='cls-8'%20points='34.9%2036.68%2034.9%2022.32%2046.52%2027.82%2046.52%2042.18%2034.9%2036.68'/%3e%3cpolygon%20class='cls-1'%20points='23.25%2042.2%2023.27%2042.18%2034.9%2036.68%2046.52%2042.18%2034.78%2047.66%2023.25%2042.2'/%3e%3cpolygon%20class='cls-6'%20points='58.14%2022.28%2058.12%2022.3%2046.53%2027.78%2046.52%2027.78%2034.99%2022.32%2046.69%2016.86%2058.14%2022.28'/%3e%3cpolygon%20class='cls-6'%20points='34.99%2022.32%2023.25%2027.8%2011.63%2022.3%2023.26%2016.76%2034.99%2022.32'/%3e%3cpolygon%20class='cls-10'%20points='23.26%2016.76%2011.63%2022.3%2011.62%2022.3%200%2016.79%2011.58%2011.23%2023.26%2016.76'/%3e%3cpolygon%20class='cls-10'%20points='46.69%205.63%2034.86%2011.25%2023.11%205.67%2034.87%200%2046.69%205.63'/%3e%3cpolygon%20class='cls-10'%20points='34.86%2011.25%2023.26%2016.76%2011.58%2011.23%2023.1%205.67%2023.11%205.67%2034.86%2011.25'/%3e%3cpolygon%20class='cls-6'%20points='46.69%2016.86%2034.99%2022.32%2023.26%2016.76%2034.86%2011.25%2046.69%2016.86'/%3e%3cpolygon%20class='cls-10'%20points='58.59%2011.3%2046.69%2016.86%2034.86%2011.25%2046.69%205.63%2058.59%2011.3'/%3e%3cpolygon%20class='cls-10'%20points='69.75%2016.79%2058.15%2022.28%2058.14%2022.28%2046.69%2016.86%2058.59%2011.3%2069.75%2016.79'/%3e%3c/g%3e%3c/svg%3e";
var Zt = class extends Ie {
  constructor() {
    super(...arguments);
    ee(this, "state", {});
  }
  static getDerivedStateFromError(n) {
    return { error: n };
  }
  render() {
    return this.state.error ? /* @__PURE__ */ u("div", { class: "ble-pane-error", role: "alert", children: [
      "Panel failed: ",
      this.state.error.message
    ] }) : this.props.children;
  }
};
function Ki({ title: t }) {
  const { signals: e, shell: n, setLayout: i, setTheme: s, hide: r, dispose: o } = pe(), d = e.panes.value, m = e.toolbarItems.value, p = (P) => m.filter((v) => v.location === P).map((v) => {
    const A = v.component;
    return /* @__PURE__ */ u(A, {}, v.key);
  }), _ = (P) => {
    const v = d.filter((E) => E.side === P), A = e.selectedPanes.value[P], V = v.find((E) => E.key === A) ?? v[0];
    return /* @__PURE__ */ u("section", { class: `ble-pane ble-pane-${P}${P === "left" ? " ble-pane-has-footer" : ""}`, children: [
      /* @__PURE__ */ u("div", { class: "ble-tabs", role: "tablist", "aria-label": `${P} panels`, children: [
        v.map((E) => /* @__PURE__ */ u("button", { type: "button", role: "tab", "aria-selected": E.key === (V == null ? void 0 : V.key), onClick: () => n.selectPane(E.key), children: E.title }, E.key)),
        P === "left" && /* @__PURE__ */ u(Qt, {})
      ] }),
      /* @__PURE__ */ u("div", { class: "ble-pane-content", children: v.map((E) => {
        const x = E.key === (V == null ? void 0 : V.key);
        if (!x && !E.keepMounted) return null;
        const C = E.content;
        return /* @__PURE__ */ u("div", { role: "tabpanel", hidden: !x, children: /* @__PURE__ */ u(Zt, { children: /* @__PURE__ */ u(C, {}) }) }, E.key);
      }) }),
      P === "left" && /* @__PURE__ */ u(nn, {})
    ] });
  }, h = () => {
    const P = (A) => {
      e.singlePanePercent.value = A;
      try {
        localStorage.setItem("ble.singlePanePercent", String(A));
      } catch {
      }
    }, v = (A) => {
      const V = d.filter((C) => C.side === A), E = e.selectedPanes.value[A], x = V.find((C) => C.key === E) ?? V[0];
      return /* @__PURE__ */ u("section", { class: `ble-pane ble-pane-single ble-pane-single-${A}${A === "left" ? " ble-pane-has-footer" : ""}`, children: [
        /* @__PURE__ */ u("div", { class: "ble-tabs", role: "tablist", "aria-label": `${A} panels`, children: [
          V.map((C) => /* @__PURE__ */ u("button", { type: "button", role: "tab", "aria-selected": C.key === (x == null ? void 0 : x.key), onClick: () => n.selectPane(C.key), children: C.title }, C.key)),
          A === "left" && /* @__PURE__ */ u(Qt, {})
        ] }),
        /* @__PURE__ */ u("div", { class: "ble-pane-content", children: V.map((C) => {
          const T = C.key === (x == null ? void 0 : x.key);
          if (!T && !C.keepMounted) return null;
          const j = C.content;
          return /* @__PURE__ */ u("div", { role: "tabpanel", hidden: !T, children: /* @__PURE__ */ u(Zt, { children: /* @__PURE__ */ u(j, {}) }) }, C.key);
        }) }),
        A === "left" && /* @__PURE__ */ u(nn, {})
      ] });
    };
    return /* @__PURE__ */ u("div", { class: "ble-single-stack", style: { gridTemplateRows: `${e.singlePanePercent.value}% 5px minmax(0, 1fr)` }, children: [
      v("left"),
      /* @__PURE__ */ u(Yi, { axis: "vertical", onChange: P }),
      v("right")
    ] });
  };
  return e.layout.value === "split" ? /* @__PURE__ */ u("div", { class: "ble-split-shell", children: [
    /* @__PURE__ */ u("section", { class: "ble-split-dock ble-split-dock-left", children: [
      /* @__PURE__ */ u("header", { class: "ble-toolbar", children: [
        /* @__PURE__ */ u("strong", { children: t }),
        p("top-left")
      ] }),
      _("left")
    ] }),
    /* @__PURE__ */ u("section", { class: "ble-split-dock ble-split-dock-right", children: [
      /* @__PURE__ */ u("header", { class: "ble-toolbar", children: [
        /* @__PURE__ */ u("div", { class: "ble-toolbar-zone", children: p("top-right") }),
        /* @__PURE__ */ u("div", { class: "ble-toolbar-actions", children: [
          /* @__PURE__ */ u("button", { type: "button", title: "Switch to single layout", onClick: () => i("single"), children: "Single" }),
          /* @__PURE__ */ u("button", { type: "button", title: `Switch to ${e.theme.value === "dark" ? "light" : "dark"} theme`, onClick: () => s(e.theme.value === "dark" ? "light" : "dark"), children: e.theme.value === "dark" ? "Light" : "Dark" }),
          /* @__PURE__ */ u("button", { type: "button", title: "Hide Explorer (Ctrl+Shift+E)", onClick: r, children: "Hide" }),
          /* @__PURE__ */ u("button", { class: "ble-dispose", type: "button", title: "Dispose Explorer permanently", "aria-label": "Dispose explorer permanently", onClick: o, children: "\xD7" })
        ] })
      ] }),
      _("right"),
      /* @__PURE__ */ u(en, {}),
      /* @__PURE__ */ u(tn, { left: p("bottom-left"), right: p("bottom-right") }),
      /* @__PURE__ */ u(sn, {})
    ] }),
    /* @__PURE__ */ u(rn, {})
  ] }) : /* @__PURE__ */ u("div", { class: "ble-shell", children: [
    /* @__PURE__ */ u("header", { class: "ble-toolbar", children: [
      /* @__PURE__ */ u("div", { class: "ble-toolbar-zone", children: [
        /* @__PURE__ */ u("strong", { children: t }),
        p("top-left")
      ] }),
      /* @__PURE__ */ u("div", { class: "ble-toolbar-actions", children: [
        p("top-right"),
        /* @__PURE__ */ u("button", { type: "button", title: `Switch to ${e.layout.value === "single" ? "split" : "single"} layout`, onClick: () => i(e.layout.value === "single" ? "split" : "single"), children: e.layout.value === "single" ? "Split" : "Single" }),
        /* @__PURE__ */ u("button", { type: "button", title: `Switch to ${e.theme.value === "dark" ? "light" : "dark"} theme`, onClick: () => s(e.theme.value === "dark" ? "light" : "dark"), children: e.theme.value === "dark" ? "Light" : "Dark" }),
        /* @__PURE__ */ u("button", { type: "button", title: "Hide Explorer (Ctrl+Shift+E)", onClick: r, children: "Hide" }),
        /* @__PURE__ */ u("button", { class: "ble-dispose", type: "button", title: "Dispose Explorer permanently", "aria-label": "Dispose explorer permanently", onClick: o, children: "\xD7" })
      ] })
    ] }),
    /* @__PURE__ */ u("main", { class: "ble-main ble-main-single", children: h() }),
    /* @__PURE__ */ u(en, {}),
    /* @__PURE__ */ u(tn, { left: p("bottom-left"), right: p("bottom-right") }),
    /* @__PURE__ */ u(sn, {}),
    /* @__PURE__ */ u(rn, {})
  ] });
}
function Qt() {
  const { signals: t, setPickingActive: e } = pe();
  if (!t.pickingAvailable.value) return null;
  const n = t.pickingActive.value;
  return /* @__PURE__ */ u(
    "button",
    {
      class: `ble-pick-toggle${n ? " is-active" : ""}`,
      type: "button",
      "aria-pressed": n,
      title: n ? "Picking mode active" : "Picking mode inactive",
      onClick: () => e(!n),
      children: [
        "Pick: ",
        n ? "On" : "Off"
      ]
    }
  );
}
function Yi({ axis: t, onChange: e }) {
  const n = Nt(false);
  return /* @__PURE__ */ u(
    "div",
    {
      class: `ble-resize-handle is-${t}`,
      role: "separator",
      "aria-orientation": t,
      tabIndex: 0,
      onPointerDown: (i) => {
        n.current = true, i.currentTarget.setPointerCapture(i.pointerId);
      },
      onPointerMove: (i) => {
        if (!n.current) return;
        const s = i.currentTarget.parentElement;
        if (!s) return;
        const r = s.getBoundingClientRect(), o = t === "vertical" ? (i.clientY - r.top) / r.height * 100 : (i.clientX - r.left) / r.width * 100;
        e(Math.round(Math.min(75, Math.max(25, o))));
      },
      onPointerUp: (i) => {
        n.current = false, i.currentTarget.releasePointerCapture(i.pointerId);
      },
      onPointerCancel: () => {
        n.current = false;
      },
      onKeyDown: (i) => {
        var o, d;
        const s = i.key === "ArrowLeft" || i.key === "ArrowUp" ? -2 : i.key === "ArrowRight" || i.key === "ArrowDown" ? 2 : 0;
        if (!s) return;
        i.preventDefault();
        const r = Number(t === "vertical" ? (((o = i.currentTarget.parentElement) == null ? void 0 : o.style.gridTemplateRows.match(/^([\d.]+)%/)) ?? [])[1] : (((d = i.currentTarget.parentElement) == null ? void 0 : d.style.gridTemplateColumns.match(/^([\d.]+)%/)) ?? [])[1]);
        e(Math.min(75, Math.max(25, (Number.isFinite(r) ? r : 40) + s)));
      }
    }
  );
}
function en() {
  const { signals: t, commands: e, notifications: n } = pe(), i = t.selectedEntity.value, s = t.context.value, r = {
    "copy-entity-snapshot": "Copy",
    "toggle-visible": "Visible",
    "remove-entity": "Delete",
    "focus-selected": "Focus",
    "play-animation": "PLAY",
    "stop-animation": "STOP",
    "reset-instancer-instance": "Reset",
    "reset-instancer-set": "Reset Set",
    "save-instancer-set": "Save Set"
  }, o = i ? e.list(i).filter((m) => m.id in r) : [], d = async (m) => {
    const p = e.get(m);
    if (!(!p || !s))
      try {
        await p.run(i, s);
      } catch (_) {
        n.push(_ instanceof Error ? _.message : `Command failed: ${p.label}`);
      }
  };
  return i ? /* @__PURE__ */ u("div", { class: "ble-selection-status", children: [
    /* @__PURE__ */ u("span", { children: "Selected" }),
    /* @__PURE__ */ u("strong", { children: i.label }),
    /* @__PURE__ */ u("div", { class: "ble-selection-actions", children: o.map((m) => /* @__PURE__ */ u("button", { type: "button", "data-command-id": m.id, onClick: () => void d(m.id), children: r[m.id] }, m.id)) })
  ] }) : /* @__PURE__ */ u("div", { class: "ble-selection-status is-empty", "aria-hidden": "true" });
}
function tn({ left: t, right: e }) {
  const { signals: n } = pe(), i = n.stats.value, s = [
    i.fps !== void 0 && `FPS ${i.fps.toFixed(0)}`,
    i.frameMs !== void 0 && `Frame int. ${i.frameMs.toFixed(1)} ms`,
    i.drawCallCount !== void 0 && `Draws ${i.drawCallCount}`,
    i.gpuFrameTimeMs !== void 0 && `GPU ${i.gpuFrameTimeMs.toFixed(1)} ms`,
    i.meshCount !== void 0 && `Meshes ${i.meshCount}`,
    i.lightCount !== void 0 && `Lights ${i.lightCount}`
  ].filter(Boolean);
  return /* @__PURE__ */ u("footer", { class: "ble-status", children: [
    /* @__PURE__ */ u("span", { class: "ble-status-zone", children: [
      t,
      s.length ? s.map((r) => /* @__PURE__ */ u("span", { children: r }, String(r))) : /* @__PURE__ */ u("span", { children: "Ready" })
    ] }),
    /* @__PURE__ */ u("span", { class: "ble-status-zone", children: e })
  ] });
}
function nn() {
  const { userGuideUrl: t } = pe(), [e, n] = Se(false);
  return /* @__PURE__ */ u("footer", { class: "ble-links-footer", children: [
    /* @__PURE__ */ u("button", { class: "ble-footer-settings", type: "button", title: "Open User Settings", "aria-label": "Open User Settings", onClick: () => n(true), children: /* @__PURE__ */ u("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", children: /* @__PURE__ */ u("path", { fill: "currentColor", d: "M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2.5-1.5L14.2 2h-4l-.4 2.5A7 7 0 0 0 7.4 6L5 5 3 8.5l2 1.5a8 8 0 0 0 0 3l-2 1.5L5 18l2.4-1a7 7 0 0 0 2.4 1.5l.4 2.5h4l.4-2.5A7 7 0 0 0 17 17l2.4 1 2-3.5-2-1ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" }) }) }),
    /* @__PURE__ */ u("a", { class: "ble-footer-help", href: t, target: "_blank", rel: "noreferrer", title: "Open User Guide", "aria-label": "Open User Guide", children: "?" }),
    /* @__PURE__ */ u("a", { class: "ble-footer-logo", href: "https://babylonpress.org/", target: "_blank", rel: "noreferrer", title: "Created by BabylonPress", children: /* @__PURE__ */ u("img", { src: qi, alt: "BabylonPress" }) }),
    /* @__PURE__ */ u("a", { class: "ble-footer-github", href: "https://github.com/eldinor/babylon-lite-explorer", target: "_blank", rel: "noreferrer", title: "Babylon Lite Explorer on GitHub", "aria-label": "Babylon Lite Explorer on GitHub", children: /* @__PURE__ */ u("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", children: /* @__PURE__ */ u("path", { fill: "currentColor", d: "M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.28-5.27-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.19-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.71 5.39-5.29 5.68.42.36.79 1.07.79 2.16v3.2c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" }) }) }),
    e && /* @__PURE__ */ u(Ji, { onClose: () => n(false) })
  ] });
}
function Ji({ onClose: t }) {
  const { signals: e, setLayout: n, setTheme: i, setPickingActive: s, setConfirmEntityRemoval: r, setInstancerPickMode: o } = pe(), d = e.userSettings.value;
  return /* @__PURE__ */ u("div", { class: "ble-modal-backdrop", role: "presentation", onMouseDown: (m) => {
    m.target === m.currentTarget && t();
  }, children: /* @__PURE__ */ u("section", { class: "ble-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "ble-user-settings-title", children: [
    /* @__PURE__ */ u("header", { class: "ble-modal-header", children: [
      /* @__PURE__ */ u("h2", { id: "ble-user-settings-title", children: "User Settings" }),
      /* @__PURE__ */ u("button", { type: "button", "aria-label": "Close User Settings", onClick: t, children: "x" })
    ] }),
    /* @__PURE__ */ u("div", { class: "ble-settings-grid", children: [
      /* @__PURE__ */ u("section", { class: "ble-settings-section", children: [
        /* @__PURE__ */ u("h3", { children: "General" }),
        /* @__PURE__ */ u("label", { children: [
          /* @__PURE__ */ u("span", { children: "Theme" }),
          /* @__PURE__ */ u("select", { value: e.theme.value, onChange: (m) => i(m.currentTarget.value === "light" ? "light" : "dark"), children: [
            /* @__PURE__ */ u("option", { value: "dark", children: "Dark" }),
            /* @__PURE__ */ u("option", { value: "light", children: "Light" })
          ] })
        ] }),
        /* @__PURE__ */ u("label", { children: [
          /* @__PURE__ */ u("span", { children: "Layout" }),
          /* @__PURE__ */ u("select", { value: e.layout.value, onChange: (m) => n(m.currentTarget.value === "split" ? "split" : "single"), children: [
            /* @__PURE__ */ u("option", { value: "single", children: "Single" }),
            /* @__PURE__ */ u("option", { value: "split", children: "Split" })
          ] })
        ] }),
        /* @__PURE__ */ u("label", { class: "ble-settings-check", children: [
          /* @__PURE__ */ u("input", { type: "checkbox", checked: e.pickingActive.value, disabled: !e.pickingAvailable.value, onChange: (m) => s(m.currentTarget.checked) }),
          /* @__PURE__ */ u("span", { children: "Pick" })
        ] }),
        /* @__PURE__ */ u("label", { class: "ble-settings-check", children: [
          /* @__PURE__ */ u("input", { type: "checkbox", checked: d.confirmEntityRemoval, onChange: (m) => r(m.currentTarget.checked) }),
          /* @__PURE__ */ u("span", { children: "Confirm delete" })
        ] })
      ] }),
      /* @__PURE__ */ u("section", { class: "ble-settings-section", "data-adapter-settings": "instancer", children: [
        /* @__PURE__ */ u("h3", { children: "Instancer" }),
        /* @__PURE__ */ u("label", { children: [
          /* @__PURE__ */ u("span", { children: "Pick mode" }),
          /* @__PURE__ */ u("select", { value: d.instancerPickMode, onChange: (m) => o(m.currentTarget.value === "source" ? "source" : "instance"), children: [
            /* @__PURE__ */ u("option", { value: "instance", children: "Instance" }),
            /* @__PURE__ */ u("option", { value: "source", children: "Source" })
          ] })
        ] })
      ] })
    ] })
  ] }) });
}
function sn() {
  const { signals: t, shell: e, refresh: n } = pe(), i = t.stats.value.animationGroupCount, s = async () => {
    var d;
    const r = t.tree.value[0], o = (d = r == null ? void 0 : r.children) == null ? void 0 : d.find((m) => m.label === "Animation Groups");
    !r || !o || (e.selectPane("scene-explorer"), t.search.value = "", t.expandedIds.value = /* @__PURE__ */ new Set([...t.expandedIds.value, r.id, o.id]), await n.select(o.id));
  };
  return /* @__PURE__ */ u("footer", { class: "ble-properties-footer", "aria-label": "Properties footer", children: i !== void 0 && i > 0 && /* @__PURE__ */ u("button", { type: "button", onClick: () => void s(), children: [
    "Animation Groups ",
    i
  ] }) });
}
function rn() {
  const { signals: t, notifications: e } = pe();
  return /* @__PURE__ */ u("div", { class: "ble-notifications", "aria-live": "polite", children: t.notifications.value.map((n) => /* @__PURE__ */ u("div", { class: `ble-notification is-${n.tone}`, children: [
    n.message,
    /* @__PURE__ */ u("button", { type: "button", "aria-label": "Dismiss notification", onClick: () => e.dismiss(n.id), children: "\xD7" })
  ] }, n.id)) });
}
function Xi({ runtime: t, title: e }) {
  const { signals: n } = t;
  return n.isOpen.value ? /* @__PURE__ */ u(Vn.Provider, { value: t, children: /* @__PURE__ */ u(Ki, { title: e }) }) : null;
}
function xe(t, e) {
  if (!Number.isFinite(t)) return String(t);
  const n = e && e < 1 ? Math.min(8, Math.max(0, Math.ceil(-Math.log10(e)))) : 0, i = Math.max(3, n);
  return t !== 0 && Math.abs(t) < 10 ** -i ? String(Number(t.toPrecision(3))) : String(Number(t.toFixed(i)));
}
function Zi({ descriptor: t }) {
  const { signals: e, refresh: n, shell: i } = pe();
  if (t.kind === "entityRef") {
    const s = jn([...e.tree.value, ...e.extensionEntities.value], t.source);
    return /* @__PURE__ */ u("button", { class: "ble-property-link", type: "button", disabled: !s, title: t.value, onClick: () => {
      s && (i.selectPane("scene-explorer"), n.select(s.id));
    }, children: t.value });
  }
  if (t.kind === "readonly" || t.readonly) {
    const s = t.kind === "number" ? xe(t.value, t.step) : String(t.value);
    return /* @__PURE__ */ u("span", { class: "ble-readonly", title: String(t.value), children: s });
  }
  return t.kind === "boolean" ? /* @__PURE__ */ u("input", { type: "checkbox", checked: t.value, onChange: (s) => void n.setProperty(t, s.currentTarget.checked) }) : t.kind === "select" ? /* @__PURE__ */ u("select", { value: t.value, onChange: (s) => void n.setProperty(t, s.currentTarget.value), children: t.options.map((s) => /* @__PURE__ */ u("option", { value: s.value, children: s.label }, s.value)) }) : t.kind === "vector3" || t.kind === "color3" || t.kind === "color4" ? /* @__PURE__ */ u(ts, { descriptor: t }) : t.kind === "number" ? /* @__PURE__ */ u(es, { descriptor: t }) : /* @__PURE__ */ u(Qi, { descriptor: t });
}
function jn(t, e) {
  for (const n of t) {
    if (n.source === e) return n;
    const i = n.children ? jn(n.children, e) : null;
    if (i) return i;
  }
  return null;
}
function Qi({ descriptor: t }) {
  const { refresh: e } = pe(), [n, i] = Se(t.value);
  return Le(() => i(t.value), [t.value]), /* @__PURE__ */ u("input", { type: "text", value: n, onInput: (s) => {
    const r = s.currentTarget.value;
    i(r), r !== t.value && e.setProperty(t, r);
  }, onKeyDown: (s) => {
    s.key === "Enter" && s.currentTarget.blur(), s.key === "Escape" && (i(t.value), e.setProperty(t, t.value), s.currentTarget.blur());
  } });
}
function es({ descriptor: t }) {
  const { refresh: e } = pe(), [n, i] = Se(xe(t.value, t.step));
  return Le(() => i(xe(t.value, t.step)), [t.value, t.step]), /* @__PURE__ */ u("input", { type: "number", value: n, min: t.min, max: t.max, step: t.step, onInput: (s) => {
    const r = s.currentTarget.value;
    i(r);
    const o = Number(r);
    r !== "" && Number.isFinite(o) && o !== t.value && e.setProperty(t, o);
  }, onKeyDown: (s) => {
    s.key === "Enter" && s.currentTarget.blur(), s.key === "Escape" && (i(xe(t.value, t.step)), e.setProperty(t, t.value), s.currentTarget.blur());
  } });
}
function ts({ descriptor: t }) {
  const { refresh: e } = pe(), [n, i] = Se(false), [s, r] = Se(() => t.value.map((o) => xe(o, 0.01)));
  return Le(() => {
    n || r(t.value.map((o) => xe(o, 0.01)));
  }, [t.value, n]), /* @__PURE__ */ u("div", { class: "ble-tuple", children: s.map((o, d) => /* @__PURE__ */ u("input", { "aria-label": `${t.label} ${"XYZW"[d]}`, type: "number", step: "0.01", value: o, onFocus: () => i(true), onBlur: () => i(false), onInput: (m) => {
    const p = [...s];
    p[d] = m.currentTarget.value, r(p);
    const _ = p.map(Number);
    p.every((h) => h !== "") && _.every(Number.isFinite) && e.setProperty(t, _);
  }, onKeyDown: (m) => {
    m.key === "Enter" && m.currentTarget.blur(), m.key === "Escape" && (r(t.value.map((p) => xe(p, 0.01))), e.setProperty(t, [...t.value]), m.currentTarget.blur());
  } }, d)) });
}
function ns(t) {
  const e = t.value;
  return Array.isArray(e) ? JSON.stringify(e) : String(e);
}
function is() {
  const { signals: t, notifications: e, refresh: n } = pe(), i = t.selectedEntity.value;
  if (Le(() => {
    var o;
    if ((i == null ? void 0 : i.kind) !== "animationGroup" && ((o = i == null ? void 0 : i.meta) == null ? void 0 : o.liveProperties) !== true) return;
    const r = setInterval(() => {
      n.refreshProperties();
    }, 100);
    return () => clearInterval(r);
  }, [i == null ? void 0 : i.id, n]), !i) return /* @__PURE__ */ u("div", { class: "ble-empty", children: "Select an entity to inspect its public properties." });
  const s = /* @__PURE__ */ new Map();
  for (const r of t.properties.value) {
    const o = r.section ?? "General";
    s.set(o, [...s.get(o) ?? [], r]);
  }
  return /* @__PURE__ */ u("div", { class: "ble-properties", children: [
    /* @__PURE__ */ u("div", { class: "ble-selection-title", children: i.label }),
    [...s].map(([r, o]) => /* @__PURE__ */ u("section", { class: "ble-property-section", children: [
      /* @__PURE__ */ u("h3", { children: [
        r,
        r === "Playback" && o.some((d) => d.path === "isPlaying" && d.value === true) && /* @__PURE__ */ u("span", { class: "ble-playing-status", children: "Playing" })
      ] }),
      o.map((d) => /* @__PURE__ */ u("div", { class: "ble-property-row", children: [
        /* @__PURE__ */ u("label", { title: d.path, children: d.label }),
        /* @__PURE__ */ u("div", { class: "ble-property-control", children: /* @__PURE__ */ u(Zi, { descriptor: d }) }),
        /* @__PURE__ */ u("button", { class: "ble-copy-value", type: "button", title: "Copy property value", "aria-label": `Copy ${d.label} value`, onClick: async () => {
          try {
            await navigator.clipboard.writeText(ns(d)), e.push(`Copied ${d.label} value`, "info");
          } catch {
            e.push("Could not copy the property value.");
          }
        }, children: "\u29C9" })
      ] }, d.path))
    ] }, r))
  ] });
}
var ve = 25;
var on = 8;
function ss(t) {
  return t.kind !== "animationGroup" || !t.source || typeof t.source != "object" ? false : "isPlaying" in t.source && t.source.isPlaying === true;
}
function rs(t, e, n) {
  const i = [], s = (r, o, d) => {
    r.forEach((m, p) => {
      var _;
      i.push({ entity: m, level: o, parentId: d, position: p + 1, setSize: r.length }), (_ = m.children) != null && _.length && (n || e.has(m.id)) && s(m.children, o + 1, m.id);
    });
  };
  return s(t, 0, null), i;
}
function os() {
  const { signals: t, refresh: e, commands: n, notifications: i } = pe(), s = Nt(null), [r, o] = Se(0), [d, m] = Se(400), p = t.search.value.trim().length > 0, _ = mt(
    () => rs(t.filteredTree.value, t.expandedIds.value, p),
    [t.filteredTree.value, t.expandedIds.value, p]
  );
  Le(() => {
    const E = s.current;
    if (!E) return;
    const x = () => m(E.clientHeight || 400);
    if (x(), typeof ResizeObserver > "u") return;
    const C = new ResizeObserver(x);
    return C.observe(E), () => C.disconnect();
  }, []);
  const h = Math.max(0, Math.floor(r / ve) - on), P = Math.min(_.length, Math.ceil((r + d) / ve) + on);
  Le(() => {
    const E = t.selectedEntityId.value, x = s.current;
    if (!E || !x) return;
    const C = _.findIndex((j) => j.entity.id === E);
    if (C < 0) return;
    const T = C * ve;
    (T < x.scrollTop || T + ve > x.scrollTop + d) && (x.scrollTop = Math.max(0, T - Math.floor(d / 2)), o(x.scrollTop));
  }, [_, t.selectedEntityId.value, d]);
  const v = (E) => {
    const x = new Set(t.expandedIds.value);
    x.has(E) ? x.delete(E) : x.add(E), t.expandedIds.value = x;
  }, A = (E) => {
    const x = Math.max(0, Math.min(_.length - 1, E)), C = s.current;
    if (!C || x < 0) return;
    const T = x * ve;
    T < C.scrollTop ? C.scrollTop = T : T + ve > C.scrollTop + d && (C.scrollTop = T - d + ve), requestAnimationFrame(() => {
      var j;
      return (j = C.querySelector(`[data-tree-index="${x}"]`)) == null ? void 0 : j.focus();
    });
  }, V = async (E, x) => {
    const C = t.context.value, T = n.get(E);
    if (!(!C || !T))
      try {
        await T.run(x, C);
      } catch (j) {
        i.push(j instanceof Error ? j.message : `Command failed: ${T.label}`);
      }
  };
  return /* @__PURE__ */ u("div", { class: "ble-explorer", children: [
    /* @__PURE__ */ u("label", { class: "ble-search", children: [
      /* @__PURE__ */ u("span", { class: "ble-sr-only", children: "Search scene" }),
      /* @__PURE__ */ u("input", { value: t.search.value, onInput: (E) => {
        t.search.value = E.currentTarget.value, o(0), s.current && (s.current.scrollTop = 0);
      }, placeholder: "Search scene\u2026" })
    ] }),
    _.length ? /* @__PURE__ */ u("div", { class: "ble-tree-scroll", role: "tree", "aria-label": "Scene entities", ref: s, onScroll: (E) => o(E.currentTarget.scrollTop), children: /* @__PURE__ */ u("div", { class: "ble-tree-virtual", style: { height: `${_.length * ve}px` }, children: _.slice(h, P).map((E, x) => {
      var M;
      const C = h + x, { entity: T } = E, j = p || t.expandedIds.value.has(T.id), g = t.selectedEntityId.value === T.id, l = !!((M = T.children) != null && M.length), a = ss(T), S = n.list(T).filter(($) => $.rowAction).sort(($, k) => {
        var I, G;
        return +(((I = $.rowAction) == null ? void 0 : I.tone) === "danger") - +(((G = k.rowAction) == null ? void 0 : G.tone) === "danger");
      });
      return /* @__PURE__ */ u(
        "div",
        {
          class: `ble-tree-row${g ? " is-selected" : ""}`,
          role: "treeitem",
          "aria-level": E.level + 1,
          "aria-posinset": E.position,
          "aria-setsize": E.setSize,
          "aria-expanded": l ? j : void 0,
          "aria-selected": g,
          style: { top: `${C * ve}px`, paddingLeft: `${E.level * 14 + 4}px` },
          children: [
            /* @__PURE__ */ u("button", { class: "ble-tree-toggle", type: "button", "aria-label": j ? "Collapse" : "Expand", disabled: !l || p, onClick: () => v(T.id), children: l ? j ? "\u25BE" : "\u25B8" : "" }),
            /* @__PURE__ */ u(
              "button",
              {
                class: "ble-tree-label",
                "data-tree-index": C,
                type: "button",
                onClick: () => void e.select(T.id),
                onDblClick: () => {
                  !p && l && v(T.id);
                },
                onKeyDown: ($) => {
                  $.key === "ArrowDown" && ($.preventDefault(), A(C + 1)), $.key === "ArrowUp" && ($.preventDefault(), A(C - 1)), $.key === "ArrowRight" && l && !j && !p && ($.preventDefault(), v(T.id)), $.key === "ArrowLeft" && (l && j && !p ? ($.preventDefault(), v(T.id)) : E.parentId && ($.preventDefault(), A(_.findIndex((k) => k.entity.id === E.parentId))));
                },
                children: [
                  /* @__PURE__ */ u("span", { class: `ble-kind ble-kind-${T.kind}${a ? " is-playing" : ""}`, "aria-hidden": "true" }),
                  T.label
                ]
              }
            ),
            S.map(($) => {
              var k, I, G, z;
              return /* @__PURE__ */ u(
                "button",
                {
                  class: `ble-tree-action${((k = $.rowAction) == null ? void 0 : k.tone) === "danger" ? " is-danger" : ""}`,
                  type: "button",
                  title: `${((I = $.rowAction) == null ? void 0 : I.label) ?? $.label} ${T.label}`,
                  "aria-label": `${((G = $.rowAction) == null ? void 0 : G.label) ?? $.label} ${T.label}`,
                  onClick: () => void V($.id, T),
                  children: (z = $.rowAction) == null ? void 0 : z.icon
                },
                $.id
              );
            })
          ]
        },
        T.id
      );
    }) }) }) : /* @__PURE__ */ u("div", { class: "ble-empty", children: "No entities are exposed by the supported public API. Use explicit registration for application-owned entities." })
  ] });
}
async function as(t, e, n, i = pn, s = fn) {
  s(n, await i(e, t));
}
async function ls(t, e, n, i = (/* @__PURE__ */ new Date()).toISOString()) {
  const s = async (r) => {
    var p;
    const o = await e.getProperties(r, n), d = { label: r.label, kind: r.kind }, m = Object.fromEntries(o.filter((_) => !_.path.startsWith("$")).map((_) => [_.path, _.value]));
    return Object.keys(m).length && (d.properties = m), (p = r.children) != null && p.length && (d.children = await Promise.all(r.children.map(s))), d;
  };
  return {
    format: "babylon-lite-explorer-public-scene-snapshot",
    version: 1,
    exportedAt: i,
    entities: await Promise.all(t.map(s))
  };
}
function cs() {
  const { signals: t, refresh: e, notifications: n } = pe(), i = Nt(null), [s, r] = Se(null), o = async (m) => {
    var _, h;
    const p = t.context.value;
    if (p) {
      r("upload");
      try {
        await as(
          m,
          p.engine,
          p.scene,
          ((_ = p.lite) == null ? void 0 : _.loadGltf) ?? pn,
          ((h = p.lite) == null ? void 0 : h.addToScene) ?? fn
        ), await e.refreshTree(), n.push(`Loaded ${m.name}`, "info");
      } catch (P) {
        n.push(P instanceof Error ? P.message : "Could not load the GLB file.");
      } finally {
        r(null), i.current && (i.current.value = "");
      }
    }
  }, d = async () => {
    r("export");
    try {
      const m = t.context.value, p = t.adapter.value;
      if (!m || !p) throw new Error("Explorer scene context is unavailable.");
      const _ = await ls(t.tree.value, p, m), h = new Blob([JSON.stringify(_, null, 2)], { type: "application/json" }), P = URL.createObjectURL(h), v = document.createElement("a");
      v.href = P, v.download = "babylon-lite-scene.json", v.click(), URL.revokeObjectURL(P), n.push("Exported the public scene snapshot", "info");
    } catch (m) {
      n.push(m instanceof Error ? m.message : "Could not export the scene snapshot.");
    } finally {
      r(null);
    }
  };
  return /* @__PURE__ */ u("div", { class: "ble-tools", children: /* @__PURE__ */ u("section", { children: [
    /* @__PURE__ */ u("h3", { children: "Scene files" }),
    /* @__PURE__ */ u("button", { type: "button", disabled: s !== null, onClick: () => {
      var m;
      return (m = i.current) == null ? void 0 : m.click();
    }, children: s === "upload" ? "Uploading\u2026" : "Upload GLB" }),
    /* @__PURE__ */ u("input", { ref: i, type: "file", accept: ".glb,model/gltf-binary", hidden: true, onChange: (m) => {
      var _;
      const p = (_ = m.currentTarget.files) == null ? void 0 : _[0];
      p && o(p);
    } }),
    /* @__PURE__ */ u("button", { type: "button", disabled: s !== null, onClick: () => void d(), children: s === "export" ? "Exporting\u2026" : "Export Scene" }),
    /* @__PURE__ */ u("p", { children: "Export Scene downloads a JSON snapshot of public values visible to the Explorer. Babylon Lite does not currently expose public GLB scene serialization." })
  ] }) });
}
function _s(t, e = {}) {
  var L, B, H, re, Q, ne, oe, le, D, Y, Z, F, W, ce, fe, de, Oe, Ge, Ee;
  if (typeof document > "u") throw new Error("Babylon Lite Explorer requires a DOM environment.");
  const n = e.canvas ?? t.canvas, i = e.container ?? (n == null ? void 0 : n.parentElement) ?? document.body, s = (y) => {
    try {
      return localStorage.getItem(y);
    } catch {
      return null;
    }
  }, r = e.mode ?? "overlay", o = s("ble.layout"), d = s("ble.theme"), m = ((B = (L = e.userSettings) == null ? void 0 : L.ui) == null ? void 0 : B.layout) ?? e.layout ?? (o === "split" ? "split" : "single"), p = ((re = (H = e.userSettings) == null ? void 0 : H.ui) == null ? void 0 : re.theme) ?? e.theme ?? (d === "light" ? "light" : "dark"), _ = document.createElement("div");
  _.className = `ble-root ble-${r}`, _.dataset.theme = p, _.dataset.layout = m, _.hidden = e.initiallyOpen === false, i.appendChild(_);
  let h;
  const P = r === "overlay" && i !== document.body ? getComputedStyle(i).position : "";
  r === "overlay" && i !== document.body && (!P || P === "static") && (h = i.style.position, i.style.position = "relative");
  const v = Oi();
  v.context.value = { ...t, canvas: n };
  const A = e.adapter ?? Si(), V = e.adapters ?? [], E = V.length ? li([A, ...V]) : A;
  v.adapter.value = E, v.theme.value = p, v.layout.value = m, v.userSettings.value = {
    confirmEntityRemoval: ((ne = (Q = e.userSettings) == null ? void 0 : Q.deletion) == null ? void 0 : ne.confirmEntityRemoval) ?? e.confirmEntityRemoval ?? false,
    instancerPickMode: ((le = (oe = e.userSettings) == null ? void 0 : oe.instancer) == null ? void 0 : le.pickMode) ?? "instance",
    keyboardShortcutsEnabled: ((Y = (D = e.userSettings) == null ? void 0 : D.ui) == null ? void 0 : Y.keyboardShortcutsEnabled) ?? e.keyboardShortcutsEnabled ?? true,
    notificationsEnabled: ((F = (Z = e.userSettings) == null ? void 0 : Z.ui) == null ? void 0 : F.notificationsEnabled) ?? e.notificationsEnabled ?? true,
    notificationDurationMs: Math.max(0, ((ce = (W = e.userSettings) == null ? void 0 : W.ui) == null ? void 0 : ce.notificationDurationMs) ?? e.notificationDurationMs ?? 3e3)
  };
  try {
    const y = Number(localStorage.getItem("ble.singlePanePercent"));
    y >= 25 && y <= 75 && (v.singlePanePercent.value = y);
  } catch {
  }
  v.isOpen.value = e.initiallyOpen ?? true;
  const x = new Vi(
    v,
    v.userSettings.value.notificationDurationMs,
    v.userSettings.value.notificationsEnabled
  ), C = ((fe = e.features) == null ? void 0 : fe.focusSelected) === true, T = new Bi(v, x), j = new Hi(v), g = new Wi(v), l = ((de = e.features) == null ? void 0 : de.canvasPicking) === true && n ? new ji(n, v, T, x, j) : void 0;
  v.pickingAvailable.value = !!l;
  const a = new Gi(), S = new xi();
  S.add(j.addSidePane({ key: "scene-explorer", title: "Scene Explorer", side: "left", order: 10, content: os, keepMounted: true })), S.add(j.addSidePane({ key: "properties", title: "Properties", side: "right", order: 10, content: is, keepMounted: true })), S.add(j.addSidePane({ key: "tools", title: "Tools", side: "right", order: 20, content: cs })), S.add(a.register({ id: "refresh", label: "Refresh", run: () => T.refreshTree() })), S.add(a.register({ id: "clear-selection", label: "Clear selection", when: (y) => !!y, run: () => T.select(null) })), S.add(a.register({
    id: "copy-entity-snapshot",
    label: "Copy entity snapshot",
    when: (y) => !!(y != null && y.capabilities.serializableSnapshot),
    run: async (y, O) => {
      const U = v.adapter.value;
      if (!y || !(U != null && U.getEntitySnapshot)) return;
      const X = await U.getEntitySnapshot(y, O);
      if (!X.ok) {
        x.push(X.message);
        return;
      }
      try {
        await navigator.clipboard.writeText(JSON.stringify(X.value, null, 2));
      } catch {
        x.push("Could not write the entity snapshot to the clipboard.");
      }
    }
  })), S.add(a.register({
    id: "toggle-visible",
    label: "Toggle visible",
    when: (y) => !!(y != null && y.capabilities.visibilityToggle),
    run: async (y, O) => {
      const U = v.adapter.value;
      if (!y || !(U != null && U.setEntityVisible)) return;
      const X = v.properties.value.find((be) => be.path === "visible"), me = await U.setEntityVisible(y, !((X == null ? void 0 : X.kind) === "boolean" && X.value), O);
      me.ok ? await T.refreshTree() : x.push(me.message);
    }
  })), S.add(a.register({
    id: "remove-entity",
    label: "Delete",
    when: (y) => !!(y != null && y.capabilities.removable),
    rowAction: { label: "Delete", icon: "x", tone: "danger" },
    run: async (y, O) => {
      const U = v.adapter.value;
      if (!y || !(U != null && U.removeEntity)) return;
      const me = y.kind === "camera" && O.scene && typeof O.scene == "object" && "camera" in O.scene && O.scene.camera === y.source ? `Delete active camera "${y.label}"?` : `Delete "${y.label}" from the scene?`;
      if (v.userSettings.value.confirmEntityRemoval && !window.confirm(me)) return;
      const be = await U.removeEntity(y, O);
      if (!be.ok) {
        x.push(be.message);
        return;
      }
      v.selectedEntityId.value === y.id && await T.select(null), await T.refreshTree(), x.push(`Deleted ${y.label}`, "info");
    }
  })), S.add(a.register({
    id: "focus-selected",
    label: "Focus selected",
    when: (y) => C && !!(y != null && y.capabilities.focusable),
    run: async (y, O) => {
      const U = v.adapter.value;
      if (!y || !(U != null && U.focusEntity)) return;
      const X = await U.focusEntity(y, O);
      X.ok || x.push(X.message);
    }
  })), S.add(a.register({
    id: "play-animation",
    label: "Play animation",
    when: (y) => !!(y != null && y.capabilities.animationPlayback),
    run: async (y, O) => {
      const U = v.adapter.value;
      if (!y || !(U != null && U.playAnimationGroup)) return;
      const X = await U.playAnimationGroup(y, O);
      X.ok ? await T.refreshProperties() : x.push(X.message);
    }
  })), S.add(a.register({
    id: "stop-animation",
    label: "Stop animation",
    when: (y) => !!(y != null && y.capabilities.animationPlayback),
    run: async (y, O) => {
      const U = v.adapter.value;
      if (!y || !(U != null && U.stopAnimationGroup)) return;
      const X = await U.stopAnimationGroup(y, O);
      X.ok ? await T.refreshTree() : x.push(X.message);
    }
  }));
  const M = {
    openPanel: (y) => j.selectPane(y),
    notify: (y, O = "error") => x.push(y, O),
    refresh: () => T.refreshTree()
  }, $ = (y) => S.add(j.addSidePane({
    ...y,
    side: y.side ?? "right"
  })), k = (y) => S.add(a.register({
    ...y,
    run: (O, U) => y.run(O, U, M)
  })), I = (y) => {
    for (const O of (y == null ? void 0 : y.panes) ?? []) $(O);
    for (const O of (y == null ? void 0 : y.commands) ?? []) k(O);
  };
  for (const y of e.panes ?? []) $(y);
  for (const y of e.commands ?? []) k(y);
  for (const y of [A, ...V]) I((Oe = y.getExplorerExtensions) == null ? void 0 : Oe.call(y, M));
  let G = false;
  const z = {
    signals: v,
    refresh: T,
    notifications: x,
    commands: a,
    shell: j,
    userGuideUrl: e.userGuideUrl ?? "https://github.com/eldinor/babylon-lite-explorer/blob/main/docs/user-guide.md",
    setLayout(y) {
      v.layout.value = y, _.dataset.layout = y;
      try {
        localStorage.setItem("ble.layout", y);
      } catch {
      }
    },
    setTheme(y) {
      v.theme.value = y, _.dataset.theme = y;
      try {
        localStorage.setItem("ble.theme", y);
      } catch {
      }
    },
    setPickingActive(y) {
      l && (y ? l.start() : l.stop(), v.pickingActive.value = y);
    },
    setConfirmEntityRemoval(y) {
      v.userSettings.value = { ...v.userSettings.value, confirmEntityRemoval: y };
    },
    setInstancerPickMode(y) {
      v.userSettings.value = { ...v.userSettings.value, instancerPickMode: y };
    },
    hide: () => f.hide(),
    dispose: () => f.dispose()
  }, R = "Babylon Lite 1.10.0 Explorer 0.4.1", c = () => Ot(_n(Xi, { runtime: z, title: e.title ?? R }), _);
  c(), g.start();
  const f = {
    ready: (async () => {
      var O, U;
      const y = await ((U = (O = v.adapter.value) == null ? void 0 : O.refresh) == null ? void 0 : U.call(O, v.context.value));
      if (y && !y.ok && x.push(y.message), await T.refreshTree(), !v.expandedIds.value.size) {
        const X = /* @__PURE__ */ new Set();
        for (const me of v.tree.value) {
          X.add(me.id);
          for (const be of me.children ?? []) X.add(be.id);
        }
        v.expandedIds.value = X;
      }
    })().catch((y) => {
      throw x.push(y instanceof Error ? y.message : "Explorer startup failed."), y;
    }),
    dispose() {
      var y, O, U;
      G || (G = true, T.dispose(), l == null || l.dispose(), v.pickingActive.value = false, g.dispose(), x.dispose(), S.dispose(), a.dispose(), V.length && ((O = (y = v.adapter.value) == null ? void 0 : y.dispose) == null || O.call(y)), e.adapter || (U = A.dispose) == null || U.call(A), Ot(null, _), _.remove(), h !== void 0 && (i.style.position = h));
    },
    show() {
      G || (v.isOpen.value = true, _.hidden = false, c());
    },
    hide() {
      G || (z.setPickingActive(false), v.isOpen.value = false, _.hidden = true, c());
    },
    toggle() {
      v.isOpen.value ? f.hide() : f.show();
    },
    refresh() {
      return G ? Promise.resolve() : T.refreshTree();
    }
  }, w = (y) => {
    var O;
    if (!y.ctrlKey || !y.shiftKey) {
      y.key === "Escape" && _.contains(document.activeElement) && !(y.target instanceof HTMLInputElement) && T.select(null);
      return;
    }
    y.code === "KeyL" && (y.preventDefault(), z.setLayout(v.layout.value === "single" ? "split" : "single")), y.code === "KeyY" && (y.preventDefault(), z.setTheme(v.theme.value === "dark" ? "light" : "dark")), y.code === "KeyE" && (y.preventDefault(), f.toggle()), y.code === "KeyF" && v.isOpen.value && (y.preventDefault(), (O = _.querySelector(".ble-search input")) == null || O.focus());
  };
  return v.userSettings.value.keyboardShortcutsEnabled && (window.addEventListener("keydown", w), S.add(rt(() => window.removeEventListener("keydown", w)))), ((Ee = (Ge = e.userSettings) == null ? void 0 : Ge.picking) == null ? void 0 : Ee.enabled) === true && z.setPickingActive(true), f;
}
var an = { editable: false, focusable: false, visibilityToggle: false, serializableSnapshot: true };
var us = { editable: true, focusable: false, visibilityToggle: true, serializableSnapshot: true };
function Pe(t) {
  return !!t && typeof t == "object";
}
function ds(t) {
  return Pe(t) && typeof t.name == "string" && t.name.trim() ? t.name : void 0;
}
function ps(t) {
  return "clips" in t && "set" in t ? "vat" : "root" in t && "pool" in t ? "hierarchy" : "mesh" in t ? "thin" : "custom";
}
function fs(t, e) {
  return e === "hierarchy" && "root" in t ? t.root : "mesh" in t ? t.mesh : t;
}
function hs(t, e) {
  if (Pe(e))
    for (const n of ["name", "label", "title"]) {
      const i = e[n];
      if (typeof i == "string" && i.trim()) return i;
    }
  return `Instance ${t}`;
}
function ms(t) {
  if (t === void 0) return "";
  try {
    return JSON.stringify(t);
  } catch {
    return String(t);
  }
}
function Ve(t) {
  return Pe(t) && "record" in t && "id" in t && typeof t.id == "number";
}
function Je(t) {
  if (!(!t || t.length < 3))
    return [Number(t[0]), Number(t[1]), Number(t[2])];
}
function ln(t) {
  if (!(!t || t.length < 4))
    return [Number(t[0]), Number(t[1]), Number(t[2]), Number(t[3])];
}
function $e(t, e) {
  if (!Pe(t)) return;
  const n = t[e];
  if (!Pe(n)) return;
  const i = Number(n.x), s = Number(n.y), r = Number(n.z);
  return [i, s, r].every(Number.isFinite) ? [i, s, r] : void 0;
}
function Bn(t) {
  if (!t || t.length < 16) return;
  const e = Array.from(t, Number).slice(0, 16);
  return e.every(Number.isFinite) ? e : void 0;
}
function Xe(t) {
  const e = Bn(t);
  if (!e) return;
  const n = (v) => Math.abs(v) < 1e-12 ? 0 : v, i = Math.hypot(e[0], e[1], e[2]), s = Math.hypot(e[4], e[5], e[6]), r = Math.hypot(e[8], e[9], e[10]);
  if (!i || !s || !r) return { rotationEuler: [0, 0, 0], scale: [i, s, r] };
  const o = e[0] / i, d = e[1] / i, m = e[2] / i, p = e[6] / s, _ = e[10] / r, h = Math.hypot(o, d);
  return { rotationEuler: (h > 1e-6 ? [Math.atan2(p, _), Math.atan2(-m, h), Math.atan2(d, o)] : [Math.atan2(-e[9] / r, e[5] / s), Math.atan2(-m, h), 0]).map(n), scale: [i, s, r] };
}
function _t(t) {
  return Array.isArray(t) && t.length === 3 && t.every((e) => typeof e == "number" && Number.isFinite(e));
}
function bs(t) {
  return Array.isArray(t) && t.length === 4 && t.every((e) => typeof e == "number" && Number.isFinite(e));
}
function ks() {
  const t = [], e = /* @__PURE__ */ new WeakMap(), n = /* @__PURE__ */ new WeakMap(), i = /* @__PURE__ */ new Map(), s = /* @__PURE__ */ new WeakMap(), r = J(0), o = J(/* @__PURE__ */ new Set()), d = J(null);
  let m = 1;
  const p = () => {
    r.value += 1;
  }, _ = (c) => {
    if (!Pe(c)) return String(c);
    let b = n.get(c);
    return b || (b = m++, n.set(c, b)), String(b);
  }, h = (c) => `instancer:source:${_(c)}`, P = (c) => `instancer:set:${c.id}`, v = (c, b) => `instancer:set:${c.id}:instance:${b}`, A = (c, b) => {
    var f, w;
    return ((w = (f = c.set).getMetadata) == null ? void 0 : w.call(f, b.id)) ?? b.metadata;
  }, V = (c, b) => [...c.set.entries()].find((f) => f.id === b), E = (c, b) => [...c.set.entries()].find((f) => f.slot === b), x = (c, b) => {
    var w;
    const f = A(c, b);
    return ((w = c.getLabel) == null ? void 0 : w.call(c, b.id, f, b.slot)) ?? hs(b.id, f);
  }, C = (c) => t.filter((b) => c && b.source === c.source), T = (c) => t.find((b) => P(b) === c.id), j = (c) => ({
    label: c.sourceLabel,
    ...$e(c.source, "position") ? { position: $e(c.source, "position") } : {},
    ...$e(c.source, "rotation") ? { rotation: $e(c.source, "rotation") } : {},
    ...$e(c.source, "scaling") ? { scaling: $e(c.source, "scaling") } : {}
  }), g = (c) => ({
    id: c.id,
    label: c.label,
    kind: c.kind,
    sourceLabel: c.sourceLabel,
    source: j(c),
    count: c.set.count,
    visibleCount: c.set.visibleCount,
    capacity: c.set.capacity,
    instances: [...c.set.entries()].sort((b, f) => b.id - f.id).map((b) => {
      var ne, oe, le, D, Y, Z, F, W, ce, fe, de;
      const f = A(c, b), w = Je((oe = (ne = c.set).getPosition) == null ? void 0 : oe.call(ne, b.id)), L = Bn((D = (le = c.set).getMatrix) == null ? void 0 : D.call(le, b.id)), B = Xe(L), H = c.transformCache.get(b.id), re = ln((Z = (Y = c.set).getColor) == null ? void 0 : Z.call(Y, b.id)), Q = (W = (F = c.set).getClip) == null ? void 0 : W.call(F, b.id);
      return {
        id: b.id,
        slot: b.slot,
        label: x(c, b),
        visible: (fe = (ce = c.set).getVisible) == null ? void 0 : fe.call(ce, b.id),
        ...w ? { position: w } : {},
        ...B || H ? {
          ...(H == null ? void 0 : H.rotationEuler) ?? (B == null ? void 0 : B.rotationEuler) ? { rotationEuler: (H == null ? void 0 : H.rotationEuler) ?? B.rotationEuler } : {},
          ...(H == null ? void 0 : H.scale) ?? (B == null ? void 0 : B.scale) ? { scale: (H == null ? void 0 : H.scale) ?? B.scale } : {}
        } : {},
        ...re ? { color: re } : {},
        ...Q ? { clip: Q } : {},
        ...L ? { matrix: L } : {},
        metadata: ((de = c.serializeMetadata) == null ? void 0 : de.call(c, f, b.id)) ?? f
      };
    })
  }), l = (c) => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "instancer-set", a = (c) => `${l(c).replace(/-([a-z0-9])/g, (b, f) => f.toUpperCase()) || "instancerSet"}Placements`, S = (c) => JSON.stringify(c, null, 2), M = (c) => {
    const b = a(c.label), f = c.instances.map((w) => ({
      id: w.id,
      transform: {
        ...w.position ? { position: w.position } : {},
        ...w.rotationEuler ? { rotationEuler: w.rotationEuler } : {},
        ...w.scale ? { scale: w.scale } : {}
      },
      ...w.color ? { color: w.color } : {},
      ...w.visible !== void 0 ? { visible: w.visible } : {},
      ...w.metadata !== void 0 ? { metadata: w.metadata } : {}
    }));
    return `const ${b} = ${JSON.stringify(f, null, 2)};

const restoredIds = new Map<number, number>();

for (const placement of ${b}) {
  const id = instancerSet.create(placement.transform, placement.metadata);
  restoredIds.set(placement.id, id);
  if (placement.color) instancerSet.setColor?.(id, placement.color);
  if (placement.visible !== undefined) instancerSet.setVisible(id, placement.visible);
}
`;
  }, $ = (c, b) => V(c, b.id) ? (c.set.setTransform && (b.position || b.rotationEuler || b.scale) ? c.set.setTransform(b.id, {
    ...b.position ? { position: b.position } : {},
    ...b.rotationEuler ? { rotationEuler: b.rotationEuler } : {},
    ...b.scale ? { scale: b.scale } : {}
  }) : (b.position && c.set.setPosition && c.set.setPosition(b.id, b.position), b.scale && c.set.setScale && c.set.setScale(b.id, b.scale)), b.visible !== void 0 && c.set.setVisible && c.set.setVisible(b.id, b.visible), b.color && c.set.setColor && c.set.setColor(b.id, b.color), c.transformCache.delete(b.id), true) : false, k = (c, b) => {
    var w;
    const f = (w = c.baseline) == null ? void 0 : w.instances.find((L) => L.id === b);
    return f ? $(c, f) : false;
  }, I = (c) => {
    var f;
    let b = 0;
    for (const w of ((f = c.baseline) == null ? void 0 : f.instances) ?? [])
      $(c, w) && b++;
    return b;
  }, G = () => [...new Map(t.map((b) => [b.source, t.filter((f) => f.source === b.source)]))].map(([b, f]) => ({
    id: h(b),
    label: f[0].sourceLabel,
    kind: "mesh",
    source: b,
    capabilities: an,
    meta: { instancer: "source" },
    children: f.map((w) => ({
      id: P(w),
      label: w.label,
      kind: "unknown",
      source: w,
      parentId: h(b),
      capabilities: an,
      meta: { instancer: "set" },
      children: [...w.set.entries()].sort((L, B) => L.id - B.id).map((L) => ({
        id: v(w, L.id),
        label: x(w, L),
        kind: "unknown",
        source: { record: w, id: L.id },
        parentId: P(w),
        capabilities: us,
        meta: { instancer: "instance" }
      }))
    }))
  })), z = (c) => {
    const b = C(c);
    b.length && (o.value = /* @__PURE__ */ new Set([h(b[0].source), ...b.map(P)]), p());
  }, R = () => {
    const { signals: c, refresh: b, notifications: f } = pe();
    r.value;
    const w = c.selectedEntityId.value, L = G(), B = d.value ? t.find((D) => D.id === d.value) : void 0, H = async (D, Y) => {
      try {
        await navigator.clipboard.writeText(D), f.push(Y, "info");
      } catch {
        f.push("Could not write to the clipboard.");
      }
    }, re = (D) => {
      const Y = g(D), Z = new Blob([S(Y)], { type: "application/json" }), F = URL.createObjectURL(Z), W = document.createElement("a");
      W.href = F, W.download = `${l(D.label)}.instances.json`, W.click(), URL.revokeObjectURL(F), f.push(`Downloaded ${D.label} JSON`, "info");
    }, Q = async (D) => {
      if (D.saveSet)
        try {
          await D.saveSet(g(D)), f.push(`Saved ${D.label}`, "info"), d.value = null;
        } catch (Y) {
          f.push(Y instanceof Error ? Y.message : `Could not save ${D.label}.`);
        }
    }, ne = (D) => {
      const Y = new Set(o.value);
      Y.has(D) ? Y.delete(D) : Y.add(D), o.value = Y;
    }, oe = async (D) => {
      var Y;
      (Y = D.children) != null && Y.length && (o.value = /* @__PURE__ */ new Set([...o.value, D.id])), await b.refreshTree(), await b.select(D.id);
    }, le = ({ entity: D, level: Y = 0 }) => {
      var ce;
      const Z = !!((ce = D.children) != null && ce.length), F = o.value.has(D.id), W = w === D.id;
      return /* @__PURE__ */ u(De, { children: [
        /* @__PURE__ */ u("div", { class: `ble-instancer-tree-row${W ? " is-selected" : ""}`, style: { paddingLeft: `${Y * 14 + 4}px` }, children: [
          /* @__PURE__ */ u("button", { class: "ble-tree-toggle", type: "button", "aria-label": F ? "Collapse" : "Expand", disabled: !Z, onClick: () => ne(D.id), children: Z ? F ? "\u25BE" : "\u25B8" : "" }),
          /* @__PURE__ */ u("button", { class: "ble-instancer-tree-label", type: "button", onClick: () => void oe(D), children: D.label })
        ] }),
        Z && F ? D.children.map((fe) => /* @__PURE__ */ u(le, { entity: fe, level: Y + 1 }, fe.id)) : null
      ] });
    };
    return /* @__PURE__ */ u("div", { class: "ble-instancer-panel", children: [
      L.length ? /* @__PURE__ */ u("div", { class: "ble-instancer-tree", role: "tree", "aria-label": "Instancer entities", children: L.map((D) => /* @__PURE__ */ u(le, { entity: D }, D.id)) }) : /* @__PURE__ */ u("div", { class: "ble-empty", children: "No Instancer sets are registered." }),
      B && /* @__PURE__ */ u("div", { class: "ble-modal-backdrop", role: "presentation", onMouseDown: (D) => {
        D.target === D.currentTarget && (d.value = null);
      }, children: /* @__PURE__ */ u("section", { class: "ble-modal ble-instancer-export-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "ble-instancer-export-title", children: [
        /* @__PURE__ */ u("header", { class: "ble-modal-header", children: [
          /* @__PURE__ */ u("h2", { id: "ble-instancer-export-title", children: [
            "Save ",
            B.label
          ] }),
          /* @__PURE__ */ u("button", { type: "button", "aria-label": "Close Instancer export", onClick: () => {
            d.value = null;
          }, children: "x" })
        ] }),
        /* @__PURE__ */ u("div", { class: "ble-export-actions", children: [
          /* @__PURE__ */ u("button", { type: "button", onClick: () => void H(S(g(B)), `Copied ${B.label} JSON`), children: "Copy JSON" }),
          /* @__PURE__ */ u("button", { type: "button", onClick: () => void H(M(g(B)), `Copied ${B.label} Instancer code`), children: "Copy Instancer Code" }),
          /* @__PURE__ */ u("button", { type: "button", onClick: () => re(B), children: "Download JSON" }),
          /* @__PURE__ */ u("button", { type: "button", disabled: !B.saveSet, onClick: () => void Q(B), children: "App Save" })
        ] })
      ] }) })
    ] });
  };
  return {
    register(c, b = {}) {
      const f = c, w = e.get(f);
      if (w) throw new Error(`Instancer set already registered: ${w}`);
      const L = ps(c), B = fs(c, L), H = ds(B) ?? `${L} source ${t.length + 1}`, re = b.id ?? `${L}:${_(c)}`;
      if (t.some((oe) => oe.id === re)) throw new Error(`Instancer set id already registered: ${re}`);
      const Q = b.label ?? H;
      e.set(f, re);
      const ne = {
        id: re,
        label: Q,
        kind: L,
        source: B,
        sourceLabel: H,
        set: c,
        getLabel: b.getLabel,
        serializeMetadata: b.serializeMetadata,
        saveSet: b.saveSet,
        transformCache: /* @__PURE__ */ new Map()
      };
      ne.baseline = g(ne), t.push(ne), p();
    },
    exportSet(c) {
      const b = e.get(c), f = b ? t.find((w) => w.id === b) : void 0;
      if (!f) throw new Error("Instancer set is not registered.");
      return g(f);
    },
    getSceneTree: () => [],
    getExtensionEntities: () => G(),
    getProperties(c) {
      var b, f, w, L, B, H, re, Q, ne, oe, le, D, Y, Z;
      if (((b = c.meta) == null ? void 0 : b.instancer) === "source") {
        const F = t.filter((W) => W.source === c.source);
        return [
          { kind: "entityRef", path: "source", label: "Source", value: c.label, source: c.source, section: "Instancer" },
          { kind: "readonly", path: "setCount", label: "Sets", value: String(F.length), section: "Instancer" },
          { kind: "readonly", path: "instanceCount", label: "Instances", value: String(F.reduce((W, ce) => W + ce.set.count, 0)), section: "Instancer" }
        ];
      }
      if (((f = c.meta) == null ? void 0 : f.instancer) === "set") {
        const F = T(c);
        return F ? [
          { kind: "readonly", path: "label", label: "Label", value: F.label, section: "Instancer" },
          { kind: "readonly", path: "kind", label: "Kind", value: F.kind, section: "Instancer" },
          { kind: "readonly", path: "count", label: "Count", value: String(F.set.count), section: "Instancer" },
          { kind: "readonly", path: "visibleCount", label: "Visible", value: String(F.set.visibleCount), section: "Instancer" },
          { kind: "readonly", path: "capacity", label: "Capacity", value: String(F.set.capacity), section: "Instancer" },
          { kind: "entityRef", path: "source", label: "Source", value: F.sourceLabel, source: F.source, section: "Instancer" }
        ] : [];
      }
      if (((w = c.meta) == null ? void 0 : w.instancer) === "instance" && Ve(c.source)) {
        const { record: F, id: W } = c.source, ce = V(F, W);
        if (!ce) return [];
        const fe = A(F, ce), de = [
          { kind: "readonly", path: "id", label: "Instance ID", value: String(W), section: "Instancer" },
          { kind: "readonly", path: "slot", label: "Current slot", value: String(ce.slot), section: "Instancer" }
        ], Oe = (B = (L = F.set).getVisible) == null ? void 0 : B.call(L, W);
        Oe !== void 0 && de.push({ kind: "boolean", path: "visible", label: "Visible", value: Oe, section: "Instancer" });
        const Ge = Je((re = (H = F.set).getPosition) == null ? void 0 : re.call(H, W));
        Ge && de.push({ kind: "vector3", path: "position", label: "Position", value: Ge, section: "Transform" });
        const Ee = Xe((ne = (Q = F.set).getMatrix) == null ? void 0 : ne.call(Q, W)), y = F.transformCache.get(W);
        if (Ee) {
          const X = (y == null ? void 0 : y.rotationEuler) ?? Ee.rotationEuler, me = (y == null ? void 0 : y.scale) ?? Ee.scale;
          F.set.setTransform ? de.push({ kind: "vector3", path: "rotationEuler", label: "Rotation", value: X, section: "Transform" }) : de.push({ kind: "readonly", path: "rotationEuler", label: "Rotation", value: X.map((be) => be.toFixed(3)).join(", "), section: "Transform" }), F.set.setScale || F.set.setTransform ? de.push({ kind: "vector3", path: "scale", label: "Scaling", value: me, section: "Transform" }) : de.push({ kind: "readonly", path: "scale", label: "Scaling", value: me.map((be) => be.toFixed(3)).join(", "), section: "Transform" });
        }
        const O = ln((le = (oe = F.set).getColor) == null ? void 0 : le.call(oe, W));
        O && de.push(F.set.setColor ? { kind: "color4", path: "color", label: "Color", value: O, section: "Instancer" } : { kind: "readonly", path: "color", label: "Color", value: O.map((X) => X.toFixed(3)).join(", "), section: "Instancer" });
        const U = (Y = (D = F.set).getClip) == null ? void 0 : Y.call(D, W);
        return U && de.push({ kind: "readonly", path: "clip", label: "Clip", value: U, section: "Instancer" }), de.push({ kind: "readonly", path: "metadata", label: "Metadata", value: ms(((Z = F.serializeMetadata) == null ? void 0 : Z.call(F, fe, W)) ?? fe), section: "Metadata" }), de;
      }
      return [];
    },
    setProperty(c, b, f) {
      var B, H, re, Q, ne, oe, le, D, Y;
      if (((B = c.meta) == null ? void 0 : B.instancer) !== "instance" || !Ve(c.source)) return N("unsupported", "This Instancer entity is read-only.");
      const { record: w, id: L } = c.source;
      if (b === "visible")
        return w.set.setVisible ? (w.set.setVisible(L, !!f), p(), q()) : N("unsupported", "This instance set does not expose visibility writes.");
      if (b === "position")
        return w.set.setPosition ? _t(f) ? (w.set.setPosition(L, f), p(), q()) : N("invalid", "Position must be a vector3.") : N("unsupported", "This instance set does not expose position writes.");
      if (b === "rotationEuler") {
        if (!w.set.setTransform) return N("unsupported", "This instance set does not expose transform writes.");
        if (!_t(f)) return N("invalid", "Rotation must be a vector3.");
        const Z = Xe((re = (H = w.set).getMatrix) == null ? void 0 : re.call(H, L)), F = w.transformCache.get(L), W = Je((ne = (Q = w.set).getPosition) == null ? void 0 : ne.call(Q, L)), ce = (F == null ? void 0 : F.scale) ?? (Z == null ? void 0 : Z.scale);
        return w.set.setTransform(L, {
          ...W ? { position: W } : {},
          rotationEuler: f,
          ...ce ? { scale: ce } : {}
        }), w.transformCache.set(L, { ...F, rotationEuler: f }), p(), q();
      }
      if (b === "scale") {
        if (!_t(f)) return N("invalid", "Scaling must be a vector3.");
        const Z = w.transformCache.get(L);
        if (w.set.setScale)
          w.set.setScale(L, f);
        else if (w.set.setTransform) {
          const F = Xe((le = (oe = w.set).getMatrix) == null ? void 0 : le.call(oe, L)), W = Je((Y = (D = w.set).getPosition) == null ? void 0 : Y.call(D, L));
          w.set.setTransform(L, {
            ...W ? { position: W } : {},
            ...(Z == null ? void 0 : Z.rotationEuler) ?? (F == null ? void 0 : F.rotationEuler) ? { rotationEuler: (Z == null ? void 0 : Z.rotationEuler) ?? F.rotationEuler } : {},
            scale: f
          });
        } else
          return N("unsupported", "This instance set does not expose scaling writes.");
        return w.transformCache.set(L, { ...Z, scale: f }), p(), q();
      }
      return b === "color" ? w.set.setColor ? bs(f) ? (w.set.setColor(L, f), p(), q()) : N("invalid", "Color must be a color4.") : N("unsupported", "This instance set does not expose color writes.") : N("unsupported", "This Instancer property is read-only.");
    },
    setEntityVisible(c, b) {
      return !Ve(c.source) || !c.source.record.set.setVisible ? N("unsupported", "This instance has no visibility toggle.") : (c.source.record.set.setVisible(c.source.id, b), p(), q());
    },
    async pickEntityId(c, b, f) {
      var w, L, B, H, re;
      if (!Pe(f.scene)) return q(null);
      try {
        let Q = s.get(f.scene);
        Q || (Q = (((w = f.lite) == null ? void 0 : w.createGpuPicker) ?? cn)(f.scene), s.set(f.scene, Q), i.set(Q, ((L = f.lite) == null ? void 0 : L.disposePicker) ?? un));
        const ne = await (((B = f.lite) == null ? void 0 : B.pickAsync) ?? dn)(Q, c, b);
        if (!ne.hit || !ne.pickedMesh || ne.thinInstanceIndex < 0 || ((re = (H = f.explorer) == null ? void 0 : H.userSettings) == null ? void 0 : re.instancerPickMode) === "source") return q(null);
        for (const oe of t) {
          if (oe.source !== ne.pickedMesh) continue;
          const le = E(oe, ne.thinInstanceIndex);
          if (le)
            return o.value = /* @__PURE__ */ new Set([h(oe.source), P(oe)]), p(), q(v(oe, le.id));
        }
        return q(null);
      } catch (Q) {
        return N("failed", Q instanceof Error ? Q.message : "Instancer picking failed.");
      }
    },
    getExplorerExtensions: () => ({
      panes: [{ key: "instancer", title: "Instancer", side: "left", order: 20, content: R, keepMounted: true }],
      commands: [{
        id: "open-instancer",
        label: "Show instances",
        when: (c) => C(c).length > 0,
        rowAction: { label: "Show instances", icon: "I" },
        run: (c, b, f) => {
          c && z(c), f.openPanel("instancer"), f.refresh();
        }
      }, {
        id: "reset-instancer-instance",
        label: "Reset Instance",
        when: (c) => {
          var b;
          return !!c && ((b = c.meta) == null ? void 0 : b.instancer) === "instance" && Ve(c.source) && !!c.source.record.baseline;
        },
        run: async (c, b, f) => {
          if (!c || !Ve(c.source)) return;
          const { record: w, id: L } = c.source;
          if (!k(w, L)) {
            f.notify(`Could not reset ${c.label}.`);
            return;
          }
          f.notify(`Reset ${c.label}`, "info"), await f.refresh();
        }
      }, {
        id: "reset-instancer-set",
        label: "Reset Set",
        when: (c) => {
          var b, f;
          return !!c && ((b = c.meta) == null ? void 0 : b.instancer) === "set" && !!((f = T(c)) != null && f.baseline);
        },
        run: async (c, b, f) => {
          if (!c) return;
          const w = T(c);
          if (!w) return;
          const L = I(w);
          f.notify(`Reset ${w.label} (${L} instances)`, "info"), await f.refresh();
        }
      }, {
        id: "save-instancer-set",
        label: "Save Set",
        when: (c) => {
          var b;
          return !!c && ((b = c.meta) == null ? void 0 : b.instancer) === "set";
        },
        run: async (c, b, f) => {
          if (!c) return;
          const w = T(c);
          w && (d.value = w.id, f.openPanel("instancer"), p());
        }
      }]
    }),
    getEntitySnapshot: (c) => {
      var b;
      return q({ id: c.id, label: c.label, kind: ((b = c.meta) == null ? void 0 : b.instancer) ?? "instancer" });
    },
    dispose: () => {
      for (const [c, b] of i) b(c);
      i.clear(), t.length = 0, p();
    }
  };
}
var gs = { editable: false, focusable: false, visibilityToggle: false, serializableSnapshot: false };
function ws(t) {
  return {
    getSceneTree(e) {
      const n = t.getEntities(e), i = /* @__PURE__ */ new Set(), s = /* @__PURE__ */ new Map();
      for (const o of n) {
        if (!o.id || i.has(o.id)) throw new Error(`Registered entity IDs must be unique: ${o.id || "(empty)"}`);
        i.add(o.id), s.set(o.id, { ...o, capabilities: { ...gs, ...o.capabilities }, children: [] });
      }
      const r = [];
      for (const o of s.values()) {
        const d = o.parentId ? s.get(o.parentId) : void 0;
        d ? d.children.push(o) : r.push(o);
      }
      return r;
    },
    getProperties: t.getProperties ?? ((e) => [
      { kind: "readonly", path: "$kind", label: "Kind", value: e.kind, section: "General" },
      { kind: "readonly", path: "$id", label: "ID", value: e.id, section: "General" }
    ]),
    setProperty: t.setProperty,
    getStats: t.getStats,
    getEntitySnapshot: t.getEntitySnapshot,
    pickEntityId: t.pickEntityId,
    focusEntity: t.focusEntity,
    setEntityVisible: t.setEntityVisible
  };
}
export {
  Gi as CommandService,
  Hi as ShellService,
  li as composeLiteSceneAdapters,
  Si as createDefaultLiteSceneAdapter,
  ks as createInstancerExplorerAdapter,
  ws as createRegisteredSceneAdapter,
  N as fail,
  q as ok,
  _s as showLiteExplorer
};
