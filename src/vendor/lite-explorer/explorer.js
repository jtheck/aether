// node_modules/babylon-lite-explorer/dist/browser.js
import { stopAnimation as qt, playAnimation as oi, removeFromScene as ai, createGpuPicker as wn, disposePicker as xn, pickAsync as Pn, setFog as li, setSceneImageProcessing as Qe, setSubtreeVisible as ci, markMaterialUboDirty as ui, StandardToneMapping as di, AcesToneMapping as pi, NeutralToneMapping as fi, isPbrMaterial as hi, isStandardMaterial as mi, getMeshGeometry as bi, getMaterialFamily as yi, loadGltf as Tn, addToScene as Cn, getViewProjectionMatrix as gi } from "@babylonjs/lite";
var ri = Object.defineProperty;
var si = (t, e, n) => e in t ? ri(t, e, { enumerable: true, configurable: true, writable: true, value: n }) : t[e] = n;
var re = (t, e, n) => si(t, typeof e != "symbol" ? e + "" : e, n);
var gt;
var Z;
var En;
var Mn;
var Me;
var Kt;
var In;
var $n;
var xt;
var rt;
var Ke;
var An;
var Ut;
var Ct;
var Et;
var Nn;
var lt = {};
var ct = [];
var vi = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
var vt = Array.isArray;
function Te(t, e) {
  for (var n in e) t[n] = e[n];
  return t;
}
function Rt(t) {
  t && t.parentNode && t.parentNode.removeChild(t);
}
function Fn(t, e, n) {
  var i, r, s, o = {};
  for (s in e) s == "key" ? i = e[s] : s == "ref" ? r = e[s] : o[s] = e[s];
  if (arguments.length > 2 && (o.children = arguments.length > 3 ? gt.call(arguments, 2) : n), typeof t == "function" && t.defaultProps != null) for (s in t.defaultProps) o[s] === void 0 && (o[s] = t.defaultProps[s]);
  return st(t, o, i, r, null);
}
function st(t, e, n, i, r) {
  var s = { type: t, props: e, key: n, ref: i, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: r ?? ++En, __i: -1, __u: 0 };
  return r == null && Z.vnode != null && Z.vnode(s), s;
}
function Be(t) {
  return t.children;
}
function Re(t, e) {
  this.props = t, this.context = e;
}
function Oe(t, e) {
  if (e == null) return t.__ ? Oe(t.__, t.__i + 1) : null;
  for (var n; e < t.__k.length; e++) if ((n = t.__k[e]) != null && n.__e != null) return n.__e;
  return typeof t.type == "function" ? Oe(t) : null;
}
function _i(t) {
  if (t.__P && t.__d) {
    var e = t.__v, n = e.__e, i = [], r = [], s = Te({}, e);
    s.__v = e.__v + 1, Z.vnode && Z.vnode(s), Vt(t.__P, s, e, t.__n, t.__P.namespaceURI, 32 & e.__u ? [n] : null, i, n ?? Oe(e), !!(32 & e.__u), r), s.__v = e.__v, s.__.__k[s.__i] = s, Rn(i, s, r), e.__e = e.__ = null, s.__e != n && Ln(s);
  }
}
function Ln(t) {
  if ((t = t.__) != null && t.__c != null) return t.__e = t.__c.base = null, t.__k.some(function(e) {
    if (e != null && e.__e != null) return t.__e = t.__c.base = e.__e;
  }), Ln(t);
}
function Mt(t) {
  (!t.__d && (t.__d = true) && Me.push(t) && !ut.__r++ || Kt != Z.debounceRendering) && ((Kt = Z.debounceRendering) || In)(ut);
}
function ut() {
  try {
    for (var t, e = 1; Me.length; ) Me.length > e && Me.sort($n), t = Me.shift(), e = Me.length, _i(t);
  } finally {
    Me.length = ut.__r = 0;
  }
}
function Dn(t, e, n, i, r, s, o, c, b, d, v) {
  var m, x, g, L, J, M, P, E = i && i.__k || ct, $ = e.length;
  for (b = ki(n, e, E, b, $), m = 0; m < $; m++) (g = n.__k[m]) != null && (x = g.__i != -1 && E[g.__i] || lt, g.__i = m, M = Vt(t, g, x, r, s, o, c, b, d, v), L = g.__e, g.ref && x.ref != g.ref && (x.ref && Ot(x.ref, null, g), v.push(g.ref, g.__c || L, g)), J == null && L != null && (J = L), (P = !!(4 & g.__u)) || x.__k === g.__k ? (b = Un(g, b, t, P), P && x.__e && (x.__e = null)) : typeof g.type == "function" && M !== void 0 ? b = M : L && (b = L.nextSibling), g.__u &= -7);
  return n.__e = J, b;
}
function ki(t, e, n, i, r) {
  var s, o, c, b, d, v = n.length, m = v, x = 0;
  for (t.__k = new Array(r), s = 0; s < r; s++) (o = e[s]) != null && typeof o != "boolean" && typeof o != "function" ? (typeof o == "string" || typeof o == "number" || typeof o == "bigint" || o.constructor == String ? o = t.__k[s] = st(null, o, null, null, null) : vt(o) ? o = t.__k[s] = st(Be, { children: o }, null, null, null) : o.constructor === void 0 && o.__b > 0 ? o = t.__k[s] = st(o.type, o.props, o.key, o.ref ? o.ref : null, o.__v) : t.__k[s] = o, b = s + x, o.__ = t, o.__b = t.__b + 1, c = null, (d = o.__i = Si(o, n, b, m)) != -1 && (m--, (c = n[d]) && (c.__u |= 2)), c == null || c.__v == null ? (d == -1 && (r > v ? x-- : r < v && x++), typeof o.type != "function" && (o.__u |= 4)) : d != b && (d == b - 1 ? x-- : d == b + 1 ? x++ : (d > b ? x-- : x++, o.__u |= 4))) : t.__k[s] = null;
  if (m) for (s = 0; s < v; s++) (c = n[s]) != null && (2 & c.__u) == 0 && (c.__e == i && (i = Oe(c)), On(c, c));
  return i;
}
function Un(t, e, n, i) {
  var r, s;
  if (typeof t.type == "function") {
    for (r = t.__k, s = 0; r && s < r.length; s++) r[s] && (r[s].__ = t, e = Un(r[s], e, n, i));
    return e;
  }
  t.__e != e && (i && (e && t.type && !e.parentNode && (e = Oe(t)), n.insertBefore(t.__e, e || null)), e = t.__e);
  do
    e = e && e.nextSibling;
  while (e != null && e.nodeType == 8);
  return e;
}
function Si(t, e, n, i) {
  var r, s, o, c = t.key, b = t.type, d = e[n], v = d != null && (2 & d.__u) == 0;
  if (d === null && c == null || v && c == d.key && b == d.type) return n;
  if (i > (v ? 1 : 0)) {
    for (r = n - 1, s = n + 1; r >= 0 || s < e.length; ) if ((d = e[o = r >= 0 ? r-- : s++]) != null && (2 & d.__u) == 0 && c == d.key && b == d.type) return o;
  }
  return -1;
}
function Jt(t, e, n) {
  e[0] == "-" ? t.setProperty(e, n ?? "") : t[e] = n == null ? "" : typeof n != "number" || vi.test(e) ? n : n + "px";
}
function et(t, e, n, i, r) {
  var s, o;
  e: if (e == "style") if (typeof n == "string") t.style.cssText = n;
  else {
    if (typeof i == "string" && (t.style.cssText = i = ""), i) for (e in i) n && e in n || Jt(t.style, e, "");
    if (n) for (e in n) i && n[e] == i[e] || Jt(t.style, e, n[e]);
  }
  else if (e[0] == "o" && e[1] == "n") s = e != (e = e.replace(An, "$1")), o = e.toLowerCase(), e = o in t || e == "onFocusOut" || e == "onFocusIn" ? o.slice(2) : e.slice(2), t.l || (t.l = {}), t.l[e + s] = n, n ? i ? n[Ke] = i[Ke] : (n[Ke] = Ut, t.addEventListener(e, s ? Et : Ct, s)) : t.removeEventListener(e, s ? Et : Ct, s);
  else {
    if (r == "http://www.w3.org/2000/svg") e = e.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
    else if (e != "width" && e != "height" && e != "href" && e != "list" && e != "form" && e != "tabIndex" && e != "download" && e != "rowSpan" && e != "colSpan" && e != "role" && e != "popover" && e in t) try {
      t[e] = n ?? "";
      break e;
    } catch {
    }
    typeof n == "function" || (n == null || n === false && e[4] != "-" ? t.removeAttribute(e) : t.setAttribute(e, e == "popover" && n == 1 ? "" : n));
  }
}
function Xt(t) {
  return function(e) {
    if (this.l) {
      var n = this.l[e.type + t];
      if (e[rt] == null) e[rt] = Ut++;
      else if (e[rt] < n[Ke]) return;
      return n(Z.event ? Z.event(e) : e);
    }
  };
}
function Vt(t, e, n, i, r, s, o, c, b, d) {
  var v, m, x, g, L, J, M, P, E, $, Y, pe, ne, ie, y, u = e.type;
  if (e.constructor !== void 0) return null;
  128 & n.__u && (b = !!(32 & n.__u), s = [c = e.__e = n.__e]), (v = Z.__b) && v(e);
  e: if (typeof u == "function") try {
    if (P = e.props, E = u.prototype && u.prototype.render, $ = (v = u.contextType) && i[v.__c], Y = v ? $ ? $.props.value : v.__ : i, n.__c ? M = (m = e.__c = n.__c).__ = m.__E : (E ? e.__c = m = new u(P, Y) : (e.__c = m = new Re(P, Y), m.constructor = u, m.render = xi), $ && $.sub(m), m.state || (m.state = {}), m.__n = i, x = m.__d = true, m.__h = [], m._sb = []), E && m.__s == null && (m.__s = m.state), E && u.getDerivedStateFromProps != null && (m.__s == m.state && (m.__s = Te({}, m.__s)), Te(m.__s, u.getDerivedStateFromProps(P, m.__s))), g = m.props, L = m.state, m.__v = e, x) E && u.getDerivedStateFromProps == null && m.componentWillMount != null && m.componentWillMount(), E && m.componentDidMount != null && m.__h.push(m.componentDidMount);
    else {
      if (E && u.getDerivedStateFromProps == null && P !== g && m.componentWillReceiveProps != null && m.componentWillReceiveProps(P, Y), e.__v == n.__v || !m.__e && m.shouldComponentUpdate != null && m.shouldComponentUpdate(P, m.__s, Y) === false) {
        e.__v != n.__v && (m.props = P, m.state = m.__s, m.__d = false), e.__e = n.__e, e.__k = n.__k, e.__k.some(function(a) {
          a && (a.__ = e);
        }), ct.push.apply(m.__h, m._sb), m._sb = [], m.__h.length && o.push(m);
        break e;
      }
      m.componentWillUpdate != null && m.componentWillUpdate(P, m.__s, Y), E && m.componentDidUpdate != null && m.__h.push(function() {
        m.componentDidUpdate(g, L, J);
      });
    }
    if (m.context = Y, m.props = P, m.__P = t, m.__e = false, pe = Z.__r, ne = 0, E) m.state = m.__s, m.__d = false, pe && pe(e), v = m.render(m.props, m.state, m.context), ct.push.apply(m.__h, m._sb), m._sb = [];
    else do
      m.__d = false, pe && pe(e), v = m.render(m.props, m.state, m.context), m.state = m.__s;
    while (m.__d && ++ne < 25);
    m.state = m.__s, m.getChildContext != null && (i = Te(Te({}, i), m.getChildContext())), E && !x && m.getSnapshotBeforeUpdate != null && (J = m.getSnapshotBeforeUpdate(g, L)), ie = v != null && v.type === Be && v.key == null ? Vn(v.props.children) : v, c = Dn(t, vt(ie) ? ie : [ie], e, n, i, r, s, o, c, b, d), m.base = e.__e, e.__u &= -161, m.__h.length && o.push(m), M && (m.__E = m.__ = null);
  } catch (a) {
    if (e.__v = null, b || s != null) if (a.then) {
      for (e.__u |= b ? 160 : 128; c && c.nodeType == 8 && c.nextSibling; ) c = c.nextSibling;
      s[s.indexOf(c)] = null, e.__e = c;
    } else {
      for (y = s.length; y--; ) Rt(s[y]);
      It(e);
    }
    else e.__e = n.__e, e.__k = n.__k, a.then || It(e);
    Z.__e(a, e, n);
  }
  else s == null && e.__v == n.__v ? (e.__k = n.__k, e.__e = n.__e) : c = e.__e = wi(n.__e, e, n, i, r, s, o, b, d);
  return (v = Z.diffed) && v(e), 128 & e.__u ? void 0 : c;
}
function It(t) {
  t && (t.__c && (t.__c.__e = true), t.__k && t.__k.some(It));
}
function Rn(t, e, n) {
  for (var i = 0; i < n.length; i++) Ot(n[i], n[++i], n[++i]);
  Z.__c && Z.__c(e, t), t.some(function(r) {
    try {
      t = r.__h, r.__h = [], t.some(function(s) {
        s.call(r);
      });
    } catch (s) {
      Z.__e(s, r.__v);
    }
  });
}
function Vn(t) {
  return typeof t != "object" || t == null || t.__b > 0 ? t : vt(t) ? t.map(Vn) : t.constructor !== void 0 ? null : Te({}, t);
}
function wi(t, e, n, i, r, s, o, c, b) {
  var d, v, m, x, g, L, J, M = n.props || lt, P = e.props, E = e.type;
  if (E == "svg" ? r = "http://www.w3.org/2000/svg" : E == "math" ? r = "http://www.w3.org/1998/Math/MathML" : r || (r = "http://www.w3.org/1999/xhtml"), s != null) {
    for (d = 0; d < s.length; d++) if ((g = s[d]) && "setAttribute" in g == !!E && (E ? g.localName == E : g.nodeType == 3)) {
      t = g, s[d] = null;
      break;
    }
  }
  if (t == null) {
    if (E == null) return document.createTextNode(P);
    t = document.createElementNS(r, E, P.is && P), c && (Z.__m && Z.__m(e, s), c = false), s = null;
  }
  if (E == null) M === P || c && t.data == P || (t.data = P);
  else {
    if (s = E == "textarea" && P.defaultValue != null ? null : s && gt.call(t.childNodes), !c && s != null) for (M = {}, d = 0; d < t.attributes.length; d++) M[(g = t.attributes[d]).name] = g.value;
    for (d in M) g = M[d], d == "dangerouslySetInnerHTML" ? m = g : d == "children" || d in P || d == "value" && "defaultValue" in P || d == "checked" && "defaultChecked" in P || et(t, d, null, g, r);
    for (d in P) g = P[d], d == "children" ? x = g : d == "dangerouslySetInnerHTML" ? v = g : d == "value" ? L = g : d == "checked" ? J = g : c && typeof g != "function" || M[d] === g || et(t, d, g, M[d], r);
    if (v) c || m && (v.__html == m.__html || v.__html == t.innerHTML) || (t.innerHTML = v.__html), e.__k = [];
    else if (m && (t.innerHTML = ""), Dn(e.type == "template" ? t.content : t, vt(x) ? x : [x], e, n, i, E == "foreignObject" ? "http://www.w3.org/1999/xhtml" : r, s, o, s ? s[0] : n.__k && Oe(n, 0), c, b), s != null) for (d = s.length; d--; ) Rt(s[d]);
    c && E != "textarea" || (d = "value", E == "progress" && L == null ? t.removeAttribute("value") : L != null && (L !== t[d] || E == "progress" && !L || E == "option" && L != M[d]) && et(t, d, L, M[d], r), d = "checked", J != null && J != t[d] && et(t, d, J, M[d], r));
  }
  return t;
}
function Ot(t, e, n) {
  try {
    if (typeof t == "function") {
      var i = typeof t.__u == "function";
      i && t.__u(), i && e == null || (t.__u = t(e));
    } else t.current = e;
  } catch (r) {
    Z.__e(r, n);
  }
}
function On(t, e, n) {
  var i, r;
  if (Z.unmount && Z.unmount(t), (i = t.ref) && (i.current && i.current != t.__e || Ot(i, null, e)), (i = t.__c) != null) {
    if (i.componentWillUnmount) try {
      i.componentWillUnmount();
    } catch (s) {
      Z.__e(s, e);
    }
    i.base = i.__P = null;
  }
  if (i = t.__k) for (r = 0; r < i.length; r++) i[r] && On(i[r], e, n || typeof t.type != "function");
  n || Rt(t.__e), t.__c = t.__ = t.__e = void 0;
}
function xi(t, e, n) {
  return this.constructor(t, n);
}
function Zt(t, e, n) {
  var i, r, s, o;
  e == document && (e = document.documentElement), Z.__ && Z.__(t, e), r = (i = false) ? null : e.__k, s = [], o = [], Vt(e, t = e.__k = Fn(Be, null, [t]), r || lt, lt, e.namespaceURI, r ? null : e.firstChild ? gt.call(e.childNodes) : null, s, r ? r.__e : e.firstChild, i, o), Rn(s, t, o);
}
function Pi(t) {
  function e(n) {
    var i, r;
    return this.getChildContext || (i = /* @__PURE__ */ new Set(), (r = {})[e.__c] = this, this.getChildContext = function() {
      return r;
    }, this.componentWillUnmount = function() {
      i = null;
    }, this.shouldComponentUpdate = function(s) {
      this.props.value != s.value && i.forEach(function(o) {
        o.__e = true, Mt(o);
      });
    }, this.sub = function(s) {
      i.add(s);
      var o = s.componentWillUnmount;
      s.componentWillUnmount = function() {
        i && i.delete(s), o && o.call(s);
      };
    }), n.children;
  }
  return e.__c = "__cC" + Nn++, e.__ = t, e.Provider = e.__l = (e.Consumer = function(n, i) {
    return n.children(i);
  }).contextType = e, e;
}
gt = ct.slice, Z = { __e: function(t, e, n, i) {
  for (var r, s, o; e = e.__; ) if ((r = e.__c) && !r.__) try {
    if ((s = r.constructor) && s.getDerivedStateFromError != null && (r.setState(s.getDerivedStateFromError(t)), o = r.__d), r.componentDidCatch != null && (r.componentDidCatch(t, i || {}), o = r.__d), o) return r.__E = r;
  } catch (c) {
    t = c;
  }
  throw t;
} }, En = 0, Mn = function(t) {
  return t != null && t.constructor === void 0;
}, Re.prototype.setState = function(t, e) {
  var n;
  n = this.__s != null && this.__s != this.state ? this.__s : this.__s = Te({}, this.state), typeof t == "function" && (t = t(Te({}, n), this.props)), t && Te(n, t), t != null && this.__v && (e && this._sb.push(e), Mt(this));
}, Re.prototype.forceUpdate = function(t) {
  this.__v && (this.__e = true, t && this.__h.push(t), Mt(this));
}, Re.prototype.render = Be, Me = [], In = typeof Promise == "function" ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, $n = function(t, e) {
  return t.__v.__b - e.__v.__b;
}, ut.__r = 0, xt = Math.random().toString(8), rt = "__d" + xt, Ke = "__a" + xt, An = /(PointerCapture)$|Capture$/i, Ut = 0, Ct = Xt(false), Et = Xt(true), Nn = 0;
var q = (t = void 0) => ({ ok: true, value: t });
var A = (t, e) => ({ ok: false, code: t, message: e });
function $t(t, e) {
  var n;
  for (const i of t)
    e(i), (n = i.children) != null && n.length && $t(i.children, e);
}
function Ee(t, e) {
  return e.get(t.id) ?? null;
}
function Ti(t) {
  const e = {};
  for (const n of t)
    for (const [i, r] of Object.entries(n))
      typeof r == "number" && (e[i] = i === "fps" || i === "frameMs" || i === "gpuFrameTimeMs" ? e[i] ?? r : (e[i] ?? 0) + r);
  return e;
}
function Ci(t) {
  const e = /* @__PURE__ */ new Map();
  return {
    async getSceneTree(n) {
      e.clear();
      const i = [];
      for (const r of t) {
        const s = await r.getSceneTree(n);
        $t(s, (o) => {
          const c = e.get(o.id);
          if (c && c !== r) throw new Error(`Duplicate Explorer entity ID "${o.id}" across composed adapters.`);
          e.set(o.id, r);
        }), i.push(...s);
      }
      return i;
    },
    async getExtensionEntities(n) {
      var r;
      const i = [];
      for (const s of t) {
        const o = await ((r = s.getExtensionEntities) == null ? void 0 : r.call(s, n)) ?? [];
        $t(o, (c) => {
          const b = e.get(c.id);
          if (b && b !== s) throw new Error(`Duplicate Explorer entity ID "${c.id}" across composed adapters.`);
          e.set(c.id, s);
        }), i.push(...o);
      }
      return i;
    },
    async getProperties(n, i) {
      const r = Ee(n, e);
      return r ? r.getProperties(n, i) : [];
    },
    async setProperty(n, i, r, s) {
      const o = Ee(n, e);
      return o != null && o.setProperty ? o.setProperty(n, i, r, s) : A("unsupported", "This entity is read-only.");
    },
    async refresh(n) {
      var i;
      for (const r of t) {
        const s = await ((i = r.refresh) == null ? void 0 : i.call(r, n));
        if (s && !s.ok) return s;
      }
      return q();
    },
    async getStats(n) {
      var r;
      const i = [];
      for (const s of t) {
        const o = await ((r = s.getStats) == null ? void 0 : r.call(s, n));
        o && i.push(o);
      }
      return Ti(i);
    },
    async focusEntity(n, i) {
      const r = Ee(n, e);
      return r != null && r.focusEntity ? r.focusEntity(n, i) : A("unsupported", "This entity cannot be focused.");
    },
    async setEntityVisible(n, i, r) {
      const s = Ee(n, e);
      return s != null && s.setEntityVisible ? s.setEntityVisible(n, i, r) : A("unsupported", "This entity has no visibility toggle.");
    },
    async removeEntity(n, i) {
      const r = Ee(n, e);
      return r != null && r.removeEntity ? r.removeEntity(n, i) : A("unsupported", "This entity cannot be removed.");
    },
    async playAnimationGroup(n, i) {
      const r = Ee(n, e);
      return r != null && r.playAnimationGroup ? r.playAnimationGroup(n, i) : A("unsupported", "This entity is not an animation group.");
    },
    async stopAnimationGroup(n, i) {
      const r = Ee(n, e);
      return r != null && r.stopAnimationGroup ? r.stopAnimationGroup(n, i) : A("unsupported", "This entity is not an animation group.");
    },
    async getEntitySnapshot(n, i) {
      const r = Ee(n, e);
      return r != null && r.getEntitySnapshot ? r.getEntitySnapshot(n, i) : A("unsupported", "This entity has no snapshot.");
    },
    async pickEntityId(n, i, r) {
      let s = null;
      for (const o of [...t].reverse()) {
        if (!o.pickEntityId) continue;
        const c = await o.pickEntityId(n, i, r);
        if (c.ok && c.value) return c;
        c.ok || (s = c);
      }
      return s ?? q(null);
    },
    async pickEntity(n, i, r) {
      let s = null;
      for (const o of [...t].reverse()) {
        if (o.pickEntity) {
          const c = await o.pickEntity(n, i, r);
          if (c.ok && c.value) return c;
          c.ok || (s = c);
          continue;
        }
        if (o.pickEntityId) {
          const c = await o.pickEntityId(n, i, r);
          if (c.ok && c.value) return q({ entityId: c.value });
          c.ok || (s = c);
        }
      }
      return s ?? q(null);
    },
    dispose() {
      e.clear();
    }
  };
}
var xe = {
  editable: false,
  focusable: false,
  visibilityToggle: false,
  serializableSnapshot: true
};
var Ei = { ...xe, editable: true };
var Mi = { ...xe, editable: true, visibilityToggle: true, removable: true };
function Fe(t) {
  if (!t || typeof t != "object") return false;
  const e = t;
  return Array.isArray(e.meshes) && Array.isArray(e.lights) && Array.isArray(e.animationGroups) && "camera" in e;
}
function Ii(t) {
  return t.camera ? 1 : 0;
}
function $i(t) {
  return !!t && typeof t == "object" && typeof t.drawCallCount == "number";
}
function Ai(t) {
  if (!t || typeof t != "object") return false;
  const e = t;
  return typeof e.name == "string" && Array.isArray(e.children) && !!e.position && typeof e.position.x == "number" && !!e.rotation && typeof e.rotation.x == "number" && !!e.scaling && typeof e.scaling.x == "number";
}
function Ni(t) {
  if (!t || typeof t != "object") return false;
  const e = t;
  return typeof e.width == "number" && typeof e.height == "number" && "texture" in e && "view" in e && "sampler" in e;
}
var Fi = [
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
function Li(t) {
  const e = t, n = [], i = (v, m) => {
    Ni(m) && n.push({ slot: v, texture: m });
  };
  for (const v of Fi) i(v, e[v]);
  const r = (v) => {
    const m = e[v];
    return m && typeof m == "object" ? m : null;
  }, s = r("clearCoat");
  s && (i("clearCoat.texture", s.texture), i("clearCoat.roughnessTexture", s.roughnessTexture), i("clearCoat.bumpTexture", s.bumpTexture));
  const o = r("sheen");
  o && (i("sheen.texture", o.texture), i("sheen.roughnessTexture", o.roughnessTexture));
  const c = r("anisotropy");
  c && i("anisotropy.texture", c.texture);
  const b = r("iridescence");
  b && (i("iridescence.texture", b.texture), i("iridescence.thicknessTexture", b.thicknessTexture));
  const d = r("subsurface");
  if (d) {
    const v = d.thickness && typeof d.thickness == "object" ? d.thickness : null, m = d.refraction && typeof d.refraction == "object" ? d.refraction : null;
    v && i("subsurface.thickness.texture", v.texture), m && i("subsurface.refraction.texture", m.texture);
    const x = d.translucency && typeof d.translucency == "object" ? d.translucency : null;
    x && (i("subsurface.translucency.colorTexture", x.colorTexture), i("subsurface.translucency.intensityTexture", x.intensityTexture));
  }
  return n;
}
function we(t) {
  return [t.x, t.y, t.z];
}
function Le(t, e) {
  return Array.isArray(t) && t.length === e && t.every((n) => typeof n == "number" && Number.isFinite(n));
}
function Ve(t) {
  if (!t || typeof t != "object") return false;
  const e = t;
  return typeof e.x == "number" && typeof e.y == "number" && typeof e.z == "number";
}
function Qt(t) {
  const e = t;
  return typeof e.alpha == "number" && typeof e.beta == "number" && typeof e.radius == "number" && Ve(e.target) && typeof e.inertia == "number" && typeof e.panningInertia == "number";
}
function en(t) {
  const e = t;
  return Ve(e.position) && Ve(e.target) && typeof e.speed == "number" && typeof e.angularSensitivity == "number" && typeof e.inertia == "number";
}
function tn(t) {
  const e = t;
  return Ve(e.center) && typeof e.yaw == "number" && typeof e.pitch == "number" && typeof e.radius == "number" && Ve(e.position) && Ve(e.upVector) && !!e.limits && typeof e.limits == "object";
}
function Di(t, e) {
  const n = t;
  typeof n.set == "function" ? n.set(e[0], e[1], e[2]) : Object.assign(t, { x: e[0], y: e[1], z: e[2] });
}
function tt(t, e, n) {
  return { id: `section:${t}`, label: e, kind: "unknown", source: null, children: n, capabilities: xe };
}
function ot(t) {
  return hi(t) || "baseColorFactor" in t || "metallicFactor" in t || "roughnessFactor" in t;
}
function At(t) {
  if (mi(t)) return true;
  const e = t;
  return Array.isArray(e.diffuseColor) && Array.isArray(e.specularColor) && typeof e.specularPower == "number";
}
function Gn(t, e = /* @__PURE__ */ new Set()) {
  if (e.has(t)) return "Material View";
  e.add(t);
  const n = t;
  if (n.source && typeof n.source == "object")
    return `${Gn(n.source, e)} View`;
  const i = yi(t);
  return i === "pbr" ? "PBR" : i === "standard" ? "Standard" : i === "node" ? "Node" : i === "shader" ? "Shader" : n.inputs && typeof n.inputs == "object" ? "Node" : typeof n.vertexSource == "string" && typeof n.fragmentSource == "string" ? "Shader" : ot(t) ? "PBR" : At(t) ? "Standard" : "Undetermined / Custom";
}
var ue = (t) => Math.min(1, Math.max(0, t));
function Ui(t) {
  return (t == null ? void 0 : t.id) ?? "standard";
}
var Ri = [
  { value: "standard", label: "Standard" },
  { value: "aces", label: "ACES" },
  { value: "neutral", label: "Khronos PBR Neutral" }
];
function Vi(t, e) {
  return t === "standard" ? (e == null ? void 0 : e.StandardToneMapping) ?? di : t === "aces" ? (e == null ? void 0 : e.AcesToneMapping) ?? pi : t === "neutral" ? (e == null ? void 0 : e.NeutralToneMapping) ?? fi : null;
}
function Oi(t) {
  if (t == null) return String(t);
  if (typeof t == "string") return t;
  if (typeof t == "number" || typeof t == "boolean" || typeof t == "bigint") return String(t);
  try {
    return JSON.stringify(t);
  } catch {
    return Object.prototype.toString.call(t);
  }
}
function Gi(t) {
  const e = t.metadata;
  return !e || typeof e != "object" || Array.isArray(e) ? [] : Object.entries(e).map(([n, i]) => ({
    kind: "readonly",
    path: `metadata.${n}`,
    label: n,
    value: Oi(i),
    section: "Metadata"
  }));
}
function Wi() {
  let t = /* @__PURE__ */ new WeakMap();
  const e = /* @__PURE__ */ new WeakMap(), n = /* @__PURE__ */ new WeakMap();
  let i = 1;
  const r = /* @__PURE__ */ new Map(), s = /* @__PURE__ */ new WeakMap(), o = (y) => y.currentTime, c = (y, u, a) => {
    const w = e.get(u);
    if (w) return w;
    const N = a ? `${y}:${a}:${i++}` : `${y}:object:${i++}`;
    return e.set(u, N), n.set(u, y), N;
  }, b = (y, u, a, w) => {
    if (a.has(y))
      return { id: c(u, y), label: `${y.name || u} (cycle)`, kind: u, source: y, capabilities: xe };
    a.add(y);
    const N = y.children.map((W) => b(W, w != null && w.has(W) ? "mesh" : "transform", a, w));
    return a.delete(y), {
      id: c(u, y, u === "mesh" ? y.id : void 0),
      label: y.name || (u === "mesh" ? "Unnamed mesh" : "Unnamed transform"),
      kind: u,
      source: y,
      children: N.length ? N : void 0,
      capabilities: u === "mesh" ? Mi : { ...xe, editable: true },
      meta: { liveProperties: true }
    };
  }, d = (y) => ({
    id: c("material", y),
    label: y.name || "Unnamed material",
    kind: "material",
    source: y,
    capabilities: { ...xe, editable: ot(y) },
    meta: { liveProperties: true }
  }), v = (y) => {
    if (t = /* @__PURE__ */ new WeakMap(), !Fe(y.scene)) return [];
    const u = y.scene;
    n.set(u, "scene");
    const a = {
      id: c("scene", u),
      label: "Scene",
      kind: "scene",
      source: u,
      capabilities: Ei,
      children: [],
      meta: { liveProperties: true }
    }, w = new Set(u.meshes), N = new Set(u.meshes);
    for (const R of u.meshes) {
      let K = R.parent;
      const fe = /* @__PURE__ */ new Set();
      for (; Ai(K) && !fe.has(K); )
        fe.add(K), N.add(K), K = K.parent;
    }
    const W = new Set(u.lights);
    u.camera && W.add(u.camera);
    const X = [];
    if (u.camera) {
      n.set(u.camera, "camera");
      const R = u.camera.children.map((K) => b(K, w.has(K) ? "mesh" : "transform", /* @__PURE__ */ new Set(), w));
      X.push({
        id: c("camera", u.camera),
        label: "Active camera",
        kind: "camera",
        source: u.camera,
        children: R.length ? R : void 0,
        capabilities: { ...xe, editable: true },
        meta: { liveProperties: true }
      });
    }
    u.lights.length && X.push(...u.lights.map((R, K) => {
      n.set(R, "light");
      const fe = R.children.map((C) => b(C, w.has(C) ? "mesh" : "transform", /* @__PURE__ */ new Set(), w));
      return {
        id: c("light", R),
        label: `${R.lightType || "Light"} ${K + 1}`,
        kind: "light",
        source: R,
        children: fe.length ? fe : void 0,
        capabilities: { ...xe, editable: true },
        meta: { liveProperties: true }
      };
    }));
    const S = [...N].filter((R) => {
      const K = R.parent;
      return !K || !N.has(K) && !W.has(K);
    });
    X.push(...S.map((R) => b(R, w.has(R) ? "mesh" : "transform", /* @__PURE__ */ new Set(), w))), X.length && a.children.push(tt("nodes", "Nodes", X));
    const U = [...new Set(u.meshes.map((R) => R.material))];
    U.length && a.children.push(tt("materials", "Materials", U.map(d)));
    const ee = /* @__PURE__ */ new Map();
    for (const R of U) {
      const K = R.name || "Unnamed material";
      for (const fe of Li(R)) {
        const C = ee.get(fe.texture) ?? [];
        C.push(`${K} / ${fe.slot}`), ee.set(fe.texture, C);
      }
    }
    return ee.size && a.children.push(tt("textures", "Textures", [...ee].map(([R, K]) => ({
      id: c("texture", R),
      label: K[0],
      kind: "texture",
      source: R,
      capabilities: xe,
      meta: { usages: K, liveProperties: true }
    })))), u.animationGroups.length && a.children.push(tt("animations", "Animation Groups", u.animationGroups.map((R, K) => (n.set(R, "animationGroup"), {
      id: c("animationGroup", R),
      label: R.name || `Animation group ${K + 1}`,
      kind: "animationGroup",
      source: R,
      capabilities: { ...xe, animationPlayback: true }
    })))), [a];
  }, m = (y) => [
    { kind: "text", path: "name", label: "Name", value: y.name, section: "General" },
    { kind: "boolean", path: "visible", label: "Visible", value: y.visible !== false, section: "Rendering" },
    { kind: "vector3", path: "position", label: "Position", value: we(y.position), section: "Transform" },
    { kind: "vector3", path: "rotation", label: "Rotation", value: we(y.rotation), section: "Transform" },
    { kind: "vector3", path: "scaling", label: "Scaling", value: we(y.scaling), section: "Transform" }
  ], x = (y) => {
    const u = y.skeleton, a = y.morphTargets, w = [
      { kind: "readonly", path: "skinned", label: "Skinned", value: u ? "Yes" : "No", section: "Deformation" },
      { kind: "readonly", path: "hasMorphTargets", label: "Morph targets", value: a ? "Yes" : "No", section: "Deformation" }
    ];
    return u && w.splice(1, 0, { kind: "number", path: "boneCount", label: "Bone count", value: u.boneCount, readonly: true, section: "Deformation" }), a && w.push(
      { kind: "number", path: "morphTargetCount", label: "Morph target count", value: a.count, readonly: true, section: "Deformation" },
      { kind: "readonly", path: "morphWeights", label: "Current weights", value: `[${Array.from(a.weights, (N) => Number(N.toFixed(4))).join(", ")}]`, section: "Deformation" }
    ), w;
  }, g = (y, u) => {
    var W;
    const a = t.get(y);
    if (a) return a;
    const w = (((W = u.lite) == null ? void 0 : W.getMeshGeometry) ?? bi)(y), N = w ? [
      { kind: "readonly", path: "geometry.cpu", label: "CPU geometry", value: "Available", section: "Geometry" },
      { kind: "number", path: "geometry.vertexCount", label: "Vertices", value: w.positions.length / 3, readonly: true, section: "Geometry" },
      { kind: "number", path: "geometry.indexCount", label: "Indices", value: w.indices.length, readonly: true, section: "Geometry" },
      { kind: "number", path: "geometry.triangleCount", label: "Triangles (triangle-list)", value: w.indices.length / 3, readonly: true, section: "Geometry" },
      { kind: "readonly", path: "geometry.normals", label: "Normals", value: `${w.normals.length / 3} elements`, section: "Geometry Attributes" },
      { kind: "readonly", path: "geometry.uvs", label: "UV0", value: w.uvs ? `${w.uvs.length / 2} elements` : "Unavailable", section: "Geometry Attributes" },
      { kind: "readonly", path: "geometry.uvs2", label: "UV1", value: w.uvs2 ? `${w.uvs2.length / 2} elements` : "Unavailable", section: "Geometry Attributes" },
      { kind: "readonly", path: "geometry.tangents", label: "Tangents", value: w.tangents ? `${w.tangents.length / 4} elements` : "Unavailable", section: "Geometry Attributes" },
      { kind: "readonly", path: "geometry.colors", label: "Colors", value: w.colors ? `${w.colors.length / 4} elements` : "Unavailable", section: "Geometry Attributes" }
    ] : [
      { kind: "readonly", path: "geometry.cpu", label: "CPU geometry", value: "Unavailable", section: "Geometry" }
    ];
    return t.set(y, N), N;
  }, L = (y) => {
    const u = [
      { kind: "number", path: "fov", label: "Field of view", value: y.fov, min: 0.01, max: Math.PI, step: 0.01, section: "Camera" },
      { kind: "number", path: "nearPlane", label: "Near plane", value: y.nearPlane, min: 1e-4, step: 0.01, section: "Camera" },
      { kind: "number", path: "farPlane", label: "Far plane", value: y.farPlane, min: 1e-3, step: 1, section: "Camera" }
    ];
    if (y.viewport && u.push(
      { kind: "number", path: "viewport.x", label: "X", value: y.viewport.x, min: 0, max: 1, step: 0.01, section: "Viewport" },
      { kind: "number", path: "viewport.y", label: "Y", value: y.viewport.y, min: 0, max: 1, step: 0.01, section: "Viewport" },
      { kind: "number", path: "viewport.width", label: "Width", value: y.viewport.width, min: 0, max: 1, step: 0.01, section: "Viewport" },
      { kind: "number", path: "viewport.height", label: "Height", value: y.viewport.height, min: 0, max: 1, step: 0.01, section: "Viewport" }
    ), Qt(y)) {
      u.unshift({ kind: "readonly", path: "$cameraType", label: "Type", value: "Arc rotate", section: "Camera" }), u.push(
        { kind: "number", path: "alpha", label: "Alpha", value: y.alpha, step: 0.01, section: "Orbit" },
        { kind: "number", path: "beta", label: "Beta", value: y.beta, step: 0.01, section: "Orbit" },
        { kind: "number", path: "radius", label: "Radius", value: y.radius, min: 1e-4, step: 0.1, section: "Orbit" },
        { kind: "vector3", path: "target", label: "Target", value: we(y.target), section: "Orbit" },
        { kind: "number", path: "inertia", label: "Inertia", value: y.inertia, min: 0, max: 1, step: 0.01, section: "Controls" },
        { kind: "number", path: "panningInertia", label: "Panning inertia", value: y.panningInertia, min: 0, max: 1, step: 0.01, section: "Controls" },
        { kind: "number", path: "angularSensibility", label: "Angular sensibility", value: y.angularSensibility, min: 1e-4, step: 1, section: "Controls" },
        { kind: "number", path: "panningSensibility", label: "Panning sensibility", value: y.panningSensibility, min: 1e-4, step: 1, section: "Controls" },
        { kind: "number", path: "wheelPrecision", label: "Wheel precision", value: y.wheelPrecision, min: 1e-4, step: 0.1, section: "Controls" }
      );
      const a = [
        ["lowerAlphaLimit", "Minimum alpha"],
        ["upperAlphaLimit", "Maximum alpha"],
        ["lowerBetaLimit", "Minimum beta"],
        ["upperBetaLimit", "Maximum beta"],
        ["lowerRadiusLimit", "Minimum radius"],
        ["upperRadiusLimit", "Maximum radius"]
      ];
      for (const [w, N] of a) typeof y[w] == "number" && u.push({ kind: "number", path: w, label: N, value: y[w], step: 0.01, section: "Limits" });
    } else if (en(y))
      u.unshift({ kind: "readonly", path: "$cameraType", label: "Type", value: "Free", section: "Camera" }), u.push(
        { kind: "vector3", path: "position", label: "Position", value: we(y.position), section: "Transform" },
        { kind: "vector3", path: "target", label: "Target", value: we(y.target), section: "Transform" },
        { kind: "number", path: "speed", label: "Speed", value: y.speed, min: 0, step: 0.1, section: "Controls" },
        { kind: "number", path: "angularSensitivity", label: "Angular sensitivity", value: y.angularSensitivity, min: 1e-4, step: 1, section: "Controls" },
        { kind: "number", path: "inertia", label: "Inertia", value: y.inertia, min: 0, max: 1, step: 0.01, section: "Controls" }
      );
    else if (tn(y)) {
      u.unshift({ kind: "readonly", path: "$cameraType", label: "Type", value: "Geospatial", section: "Camera" }), u.push(
        { kind: "vector3", path: "center", label: "Center", value: we(y.center), section: "Orbit" },
        { kind: "number", path: "yaw", label: "Yaw", value: y.yaw, step: 0.01, section: "Orbit" },
        { kind: "number", path: "pitch", label: "Pitch", value: y.pitch, step: 0.01, section: "Orbit" },
        { kind: "number", path: "radius", label: "Radius", value: y.radius, min: 1e-4, step: 1, section: "Orbit" },
        { kind: "vector3", path: "position", label: "Position", value: we(y.position), readonly: true, section: "Derived" },
        { kind: "vector3", path: "upVector", label: "Up vector", value: we(y.upVector), readonly: true, section: "Derived" }
      );
      const a = [
        ["radiusMin", "Minimum radius"],
        ["radiusMax", "Maximum radius"],
        ["pitchMin", "Minimum pitch"],
        ["pitchMax", "Maximum pitch"],
        ["yawMin", "Minimum yaw"],
        ["yawMax", "Maximum yaw"]
      ];
      for (const [w, N] of a) Number.isFinite(y.limits[w]) && u.push({ kind: "number", path: `limits.${w}`, label: N, value: y.limits[w], step: 0.01, section: "Limits" });
    } else
      u.unshift({ kind: "readonly", path: "$cameraType", label: "Type", value: "Camera", section: "Camera" });
    return u;
  }, J = (y, u) => {
    var X;
    const a = y.source, w = [
      { kind: "readonly", path: "$kind", label: "Kind", value: y.kind, section: "General" },
      { kind: "readonly", path: "$id", label: "Explorer ID", value: y.id, section: "General" }
    ];
    if (!a || typeof a != "object") return w;
    const N = Gi(a), W = n.get(a);
    if (W === "mesh") return [...w, ...m(a), ...g(a, u), ...x(a), ...N];
    if (W === "transform") return [...w, ...m(a), ...N];
    if (W === "camera") {
      const S = a;
      return [...w, ...L(S), ...N];
    }
    if (W === "light") {
      const S = a, U = [...w, { kind: "readonly", path: "lightType", label: "Type", value: S.lightType, section: "Light" }];
      return typeof S.intensity == "number" && U.push({ kind: "number", path: "intensity", label: "Intensity", value: S.intensity, min: 0, step: 0.05, section: "Light" }), S.position && U.push({ kind: "vector3", path: "position", label: "Position", value: we(S.position), section: "Light" }), S.direction && U.push({ kind: "vector3", path: "direction", label: "Direction", value: we(S.direction), section: "Light" }), U.push(...N), U;
    }
    if (W === "material") {
      const S = a, U = [
        ...w,
        { kind: "readonly", path: "$materialType", label: "Type", value: Gn(S), section: "Material" },
        { kind: "text", path: "name", label: "Name", value: S.name ?? "", section: "Material" }
      ];
      if (ot(S) && (S.baseColorFactor && U.push({ kind: "color4", path: "baseColorFactor", label: "Base color", value: [...S.baseColorFactor], section: "Material" }), typeof S.metallicFactor == "number" && U.push({ kind: "number", path: "metallicFactor", label: "Metallic", value: S.metallicFactor, min: 0, max: 1, step: 0.01, section: "Material" }), typeof S.roughnessFactor == "number" && U.push({ kind: "number", path: "roughnessFactor", label: "Roughness", value: S.roughnessFactor, min: 0, max: 1, step: 0.01, section: "Material" }), typeof S.alpha == "number" && U.push({ kind: "number", path: "alpha", label: "Alpha", value: S.alpha, min: 0, max: 1, step: 0.01, section: "Material" }), U.push({ kind: "number", path: "environmentIntensity", label: "Environment intensity", value: S.environmentIntensity ?? 1, min: 0, step: 0.01, section: "Environment" }), typeof S.doubleSided == "boolean" && U.push({ kind: "boolean", path: "doubleSided", label: "Double sided", value: S.doubleSided, section: "Material", readonly: true })), At(S)) {
        S.diffuseColor && U.push({ kind: "color3", path: "diffuseColor", label: "Diffuse color", value: [...S.diffuseColor], section: "Material" }), typeof S.alpha == "number" && U.push({ kind: "number", path: "alpha", label: "Alpha", value: S.alpha, min: 0, max: 1, step: 0.01, section: "Material" }), S.specularColor && U.push({ kind: "color3", path: "specularColor", label: "Specular color", value: [...S.specularColor], section: "Material" }), typeof S.specularPower == "number" && U.push({ kind: "number", path: "specularPower", label: "Specular power", value: S.specularPower, min: 0, step: 1, section: "Material" }), S.emissiveColor && U.push({ kind: "color3", path: "emissiveColor", label: "Emissive color", value: [...S.emissiveColor], section: "Material" }), S.ambientColor && U.push({ kind: "color3", path: "ambientColor", label: "Ambient color", value: [...S.ambientColor], section: "Material" });
        const ee = [
          ["bumpLevel", "Bump level"],
          ["ambientTexLevel", "Ambient level"],
          ["lightmapLevel", "Lightmap level"],
          ["opacityLevel", "Opacity level"],
          ["reflectionLevel", "Reflection level"]
        ];
        for (const [R, K] of ee) typeof S[R] == "number" && U.push({ kind: "number", path: R, label: K, value: S[R], min: 0, step: 0.01, section: "Texture Levels" });
      }
      return U.push(...N), U;
    }
    if (W === "texture") {
      const S = a, U = Array.isArray((X = y.meta) == null ? void 0 : X.usages) ? y.meta.usages.filter((ee) => typeof ee == "string") : [];
      return [
        ...w,
        { kind: "readonly", path: "usages", label: "Used by", value: U.join(", "), section: "Texture" },
        { kind: "number", path: "width", label: "Width", value: S.width, readonly: true, section: "Texture" },
        { kind: "number", path: "height", label: "Height", value: S.height, readonly: true, section: "Texture" },
        { kind: "number", path: "uScale", label: "U scale", value: S.uScale ?? 1, readonly: true, section: "UV Transform" },
        { kind: "number", path: "vScale", label: "V scale", value: S.vScale ?? 1, readonly: true, section: "UV Transform" },
        { kind: "number", path: "uOffset", label: "U offset", value: S.uOffset ?? 0, readonly: true, section: "UV Transform" },
        { kind: "number", path: "vOffset", label: "V offset", value: S.vOffset ?? 0, readonly: true, section: "UV Transform" },
        { kind: "number", path: "uAng", label: "UV rotation", value: S.uAng ?? 0, readonly: true, section: "UV Transform" },
        { kind: "boolean", path: "invertY", label: "Invert Y", value: S.invertY ?? false, readonly: true, section: "UV Transform" },
        ...N
      ];
    }
    if (W === "animationGroup") {
      const S = a, U = S.frameRate ?? 60, ee = o(S);
      return [
        ...w,
        { kind: "readonly", path: "name", label: "Name", value: S.name, section: "Animation" },
        { kind: "number", path: "duration", label: "Duration", value: S.duration, readonly: true, section: "Animation" },
        { kind: "number", path: "currentTime", label: "Current time", value: Number(ee.toFixed(2)), readonly: true, step: 0.01, section: "Playback" },
        { kind: "number", path: "currentFrame", label: "Current frame", value: Math.round(ee * U), readonly: true, section: "Playback" },
        { kind: "boolean", path: "isPlaying", label: "Playing", value: S.isPlaying, readonly: true, section: "Playback" },
        { kind: "number", path: "speedRatio", label: "Speed ratio", value: S.speedRatio, readonly: true, section: "Playback" },
        { kind: "boolean", path: "loopAnimation", label: "Loop", value: S.loopAnimation, readonly: true, section: "Playback" },
        ...N
      ];
    }
    if (W === "scene") {
      const S = a, U = [
        ...w,
        { kind: "readonly", path: "meshCount", label: "Meshes", value: String(S.meshes.length), section: "Scene" },
        { kind: "readonly", path: "lightCount", label: "Lights", value: String(S.lights.length), section: "Scene" },
        { kind: "readonly", path: "shadowGeneratorCount", label: "Shadow generators", value: String(S.shadowGenerators.length), section: "Scene" },
        { kind: "number", path: "fixedDeltaMs", label: "Fixed delta (ms)", value: S.fixedDeltaMs, min: 0, step: 0.01, section: "Scene" }
      ], ee = S.clearColor;
      [ee.r, ee.g, ee.b, ee.a].every((K) => typeof K == "number" && Number.isFinite(K)) && U.push({ kind: "color4", path: "clearColor", label: "Clear color", value: [ee.r, ee.g, ee.b, ee.a], section: "Scene" });
      const R = S.imageProcessing;
      return typeof R.exposure == "number" && U.push({ kind: "number", path: "imageProcessing.exposure", label: "Exposure", value: R.exposure, min: 0, step: 0.01, section: "Image Processing" }), typeof R.contrast == "number" && U.push({ kind: "number", path: "imageProcessing.contrast", label: "Contrast", value: R.contrast, min: 0, step: 0.01, section: "Image Processing" }), typeof R.toneMappingEnabled == "boolean" && U.push({ kind: "boolean", path: "imageProcessing.toneMappingEnabled", label: "Tone mapping", value: R.toneMappingEnabled, section: "Image Processing" }), U.push({
        kind: "select",
        path: "imageProcessing.toneMapping",
        label: "Tone mapping type",
        value: Ui(R.toneMapping),
        options: Ri,
        section: "Image Processing"
      }), Le(S.environmentPrimaryColor, 3) && U.push({ kind: "color3", path: "environmentPrimaryColor", label: "Environment primary color", value: [...S.environmentPrimaryColor], section: "Environment" }), typeof S.envRotationY == "number" && U.push({ kind: "number", path: "envRotationY", label: "Environment Y rotation", value: S.envRotationY, step: 0.01, section: "Environment" }), S.fog ? U.push(
        { kind: "select", path: "fog.mode", label: "Mode", value: String(S.fog.mode), options: [
          { value: "0", label: "Disabled" },
          { value: "1", label: "Exponential" },
          { value: "2", label: "Exponential squared" },
          { value: "3", label: "Linear" }
        ], section: "Fog" },
        { kind: "number", path: "fog.density", label: "Density", value: S.fog.density, min: 0, step: 1e-3, section: "Fog" },
        { kind: "number", path: "fog.start", label: "Start", value: S.fog.start, step: 0.1, section: "Fog" },
        { kind: "number", path: "fog.end", label: "End", value: S.fog.end, step: 0.1, section: "Fog" },
        { kind: "color3", path: "fog.color", label: "Color", value: [...S.fog.color], section: "Fog" }
      ) : U.push({ kind: "readonly", path: "fog", label: "Fog", value: "Disabled", section: "Fog" }), U.push({
        kind: "readonly",
        path: "clipPlane",
        label: "Clip plane",
        value: S.clipPlane ? `[${S.clipPlane.map((K) => K.toFixed(3)).join(", ")}]` : "Disabled",
        section: "Clipping"
      }), U.push(...N), U;
    }
    return w;
  }, M = async (y, u, a, w) => {
    var X, S, U, ee, R, K, fe;
    const N = y.source;
    if (!N || typeof N != "object") return A("unsupported", "This entity has no editable public source.");
    const W = n.get(N);
    try {
      if (W === "scene") {
        const C = N;
        if (u === "clearColor" && Le(a, 4))
          C.clearColor.r = ue(a[0]), C.clearColor.g = ue(a[1]), C.clearColor.b = ue(a[2]), C.clearColor.a = ue(a[3]);
        else if (u === "fixedDeltaMs" && typeof a == "number" && Number.isFinite(a))
          C.fixedDeltaMs = Math.max(0, a);
        else if (u.startsWith("fog.") && C.fog) {
          const l = { ...C.fog, color: [...C.fog.color] };
          if (u === "fog.mode" && typeof a == "string" && ["0", "1", "2", "3"].includes(a)) l.mode = Number(a);
          else if (u === "fog.density" && typeof a == "number" && Number.isFinite(a)) l.density = Math.max(0, a);
          else if (u === "fog.start" && typeof a == "number" && Number.isFinite(a)) l.start = a;
          else if (u === "fog.end" && typeof a == "number" && Number.isFinite(a)) l.end = a;
          else if (u === "fog.color" && Le(a, 3)) l.color = [ue(a[0]), ue(a[1]), ue(a[2])];
          else return A("invalid", `Invalid value for ${u}.`);
          (((X = w.lite) == null ? void 0 : X.setFog) ?? li)(C, l);
        } else if (u === "imageProcessing.exposure" && typeof a == "number" && Number.isFinite(a))
          await (((S = w.lite) == null ? void 0 : S.setSceneImageProcessing) ?? Qe)(C, { exposure: Math.max(0, a) });
        else if (u === "imageProcessing.contrast" && typeof a == "number" && Number.isFinite(a))
          await (((U = w.lite) == null ? void 0 : U.setSceneImageProcessing) ?? Qe)(C, { contrast: Math.max(0, a) });
        else if (u === "imageProcessing.toneMappingEnabled" && typeof a == "boolean")
          await (((ee = w.lite) == null ? void 0 : ee.setSceneImageProcessing) ?? Qe)(C, { toneMappingEnabled: a });
        else if (u === "imageProcessing.toneMapping" && typeof a == "string") {
          const l = Vi(a, w.lite);
          if (!l) return A("invalid", `Invalid value for ${u}.`);
          await (((R = w.lite) == null ? void 0 : R.setSceneImageProcessing) ?? Qe)(C, { toneMappingEnabled: true, toneMapping: l });
        } else if (u === "environmentPrimaryColor" && Le(a, 3))
          C.environmentPrimaryColor = [ue(a[0]), ue(a[1]), ue(a[2])];
        else if (u === "envRotationY" && typeof a == "number" && Number.isFinite(a))
          C.envRotationY = a;
        else
          return A("invalid", `Invalid value for ${u}.`);
        return q();
      }
      if (W === "mesh" || W === "transform") {
        const C = N;
        if (u === "name" && typeof a == "string") C.name = a;
        else if (u === "visible" && typeof a == "boolean") (((K = w.lite) == null ? void 0 : K.setSubtreeVisible) ?? ci)(C, a);
        else if ((u === "position" || u === "rotation" || u === "scaling") && Array.isArray(a) && a.length === 3 && a.every(Number.isFinite)) {
          const l = a;
          if (u === "scaling" && l.some((h) => h === 0)) return A("invalid", "Scaling components cannot be exactly zero.");
          C[u].set(l[0], l[1], l[2]);
        } else return A("invalid", `Invalid value for ${u}.`);
        return q();
      }
      if (W === "camera" && ["fov", "nearPlane", "farPlane"].includes(u) && typeof a == "number" && Number.isFinite(a)) {
        const C = N;
        return u === "fov" && (C.fov = Math.min(Math.PI, Math.max(0.01, a))), u === "nearPlane" && (C.nearPlane = Math.max(1e-4, a)), u === "farPlane" && (C.farPlane = Math.max(C.nearPlane + 1e-4, a)), q();
      }
      if (W === "camera") {
        const C = N;
        if (u.startsWith("viewport.") && C.viewport && typeof a == "number" && Number.isFinite(a)) {
          const l = u.slice(9);
          return l !== "x" && l !== "y" && l !== "width" && l !== "height" ? A("invalid", `Invalid value for ${u}.`) : (C.viewport[l] = ue(a), q());
        }
        if (Qt(C)) {
          if ((u === "alpha" || u === "beta") && typeof a == "number" && Number.isFinite(a)) C[u] = a;
          else if (u === "radius" && typeof a == "number" && Number.isFinite(a)) C.radius = Math.max(1e-4, a);
          else if (u === "target" && Array.isArray(a) && a.length === 3 && a.every(Number.isFinite)) C.target = { x: a[0], y: a[1], z: a[2] };
          else if ((u === "inertia" || u === "panningInertia") && typeof a == "number" && Number.isFinite(a)) C[u] = ue(a);
          else if ((u === "angularSensibility" || u === "panningSensibility" || u === "wheelPrecision") && typeof a == "number" && Number.isFinite(a)) C[u] = Math.max(1e-4, a);
          else if (["lowerAlphaLimit", "upperAlphaLimit", "lowerBetaLimit", "upperBetaLimit", "lowerRadiusLimit", "upperRadiusLimit"].includes(u) && typeof a == "number" && Number.isFinite(a))
            C[u] = a;
          else return A("invalid", `Invalid value for ${u}.`);
          return q();
        }
        if (en(C)) {
          if ((u === "position" || u === "target") && Array.isArray(a) && a.length === 3 && a.every(Number.isFinite))
            Di(C[u], a);
          else if (u === "speed" && typeof a == "number" && Number.isFinite(a)) C.speed = Math.max(0, a);
          else if (u === "angularSensitivity" && typeof a == "number" && Number.isFinite(a)) C.angularSensitivity = Math.max(1e-4, a);
          else if (u === "inertia" && typeof a == "number" && Number.isFinite(a)) C.inertia = ue(a);
          else return A("invalid", `Invalid value for ${u}.`);
          return q();
        }
        if (tn(C)) {
          if (u === "center" && Array.isArray(a) && a.length === 3 && a.every(Number.isFinite)) C.center = { x: a[0], y: a[1], z: a[2] };
          else if ((u === "yaw" || u === "pitch") && typeof a == "number" && Number.isFinite(a)) C[u] = a;
          else if (u === "radius" && typeof a == "number" && Number.isFinite(a)) C.radius = Math.max(1e-4, a);
          else if (u.startsWith("limits.") && typeof a == "number" && Number.isFinite(a)) {
            const l = u.slice(7);
            if (!["radiusMin", "radiusMax", "pitchMin", "pitchMax", "yawMin", "yawMax"].includes(l)) return A("invalid", `Invalid value for ${u}.`);
            C.limits[l] = a;
          } else return A("invalid", `Invalid value for ${u}.`);
          return q();
        }
        return A("unsupported", "This camera property is not available on a recognized public camera type.");
      }
      if (W === "light") {
        const C = N;
        if (u === "intensity" && typeof a == "number" && "intensity" in C) C.intensity = Math.max(0, a);
        else if ((u === "direction" || u === "position") && Array.isArray(a) && a.length === 3 && C[u]) C[u].set(Number(a[0]), Number(a[1]), Number(a[2]));
        else return A("invalid", `Invalid value for ${u}.`);
        return q();
      }
      if (W === "material") {
        const C = N;
        if (u === "name" && typeof a == "string")
          return C.name = a, q();
        if (ot(C))
          if (u === "baseColorFactor" && Le(a, 4))
            C.baseColorFactor = [ue(a[0]), ue(a[1]), ue(a[2]), ue(a[3])];
          else if ((u === "metallicFactor" || u === "roughnessFactor" || u === "alpha") && typeof a == "number" && Number.isFinite(a))
            C[u] = ue(a);
          else if (u === "environmentIntensity" && typeof a == "number" && Number.isFinite(a))
            C.environmentIntensity = Math.max(0, a);
          else
            return A("invalid", `Invalid value for ${u}.`);
        else if (At(C))
          if ((u === "diffuseColor" || u === "specularColor" || u === "emissiveColor" || u === "ambientColor") && Le(a, 3))
            C[u] = [ue(a[0]), ue(a[1]), ue(a[2])];
          else if (u === "alpha" && typeof a == "number" && Number.isFinite(a))
            C.alpha = ue(a);
          else if (u === "specularPower" && typeof a == "number" && Number.isFinite(a))
            C.specularPower = Math.max(0, a);
          else if ((u === "bumpLevel" || u === "ambientTexLevel" || u === "lightmapLevel" || u === "opacityLevel" || u === "reflectionLevel") && typeof a == "number" && Number.isFinite(a))
            C[u] = Math.max(0, a);
          else
            return A("invalid", `Invalid value for ${u}.`);
        else
          return A("unsupported", "This material has no verified editable public family.");
        return (((fe = w.lite) == null ? void 0 : fe.markMaterialUboDirty) ?? ui)(C), q();
      }
      return A("unsupported", "This property is read-only in the default adapter.");
    } catch (C) {
      return A("failed", C instanceof Error ? C.message : "The public API write failed.");
    }
  }, P = async (y, u) => {
    var a;
    if (!Fe(u.scene)) return A("unsupported", "Entity removal requires a public Babylon Lite SceneContext.");
    if (!y.source || typeof y.source != "object") return A("unsupported", "This entity has no removable public source.");
    if (y.kind !== "mesh" && y.kind !== "transform" && y.kind !== "light" && y.kind !== "camera")
      return A("unsupported", "This entity cannot be removed from the scene.");
    if (y.kind === "camera" && u.scene.camera === y.source && Ii(u.scene) <= 1)
      return A("invalid", "Cannot remove the only camera.");
    try {
      return (((a = u.lite) == null ? void 0 : a.removeFromScene) ?? ai)(u.scene, y.source), q();
    } catch (w) {
      return A("failed", w instanceof Error ? w.message : "Entity removal failed.");
    }
  }, E = (y) => {
    const u = {};
    return $i(y.engine) && (u.drawCallCount = y.engine.drawCallCount, y.engine.gpuFrameTimeMs > 0 && (u.gpuFrameTimeMs = y.engine.gpuFrameTimeMs), u.surfaceCount = y.engine.surfaces.length), Fe(y.scene) && (u.meshCount = y.scene.meshes.length, u.lightCount = y.scene.lights.length, u.animationGroupCount = y.scene.animationGroups.length, u.materialCount = new Set(y.scene.meshes.map((a) => a.material)).size), u;
  }, $ = (y, u) => {
    var N, W;
    if (!Fe(u.scene)) return A("unsupported", "Animation playback requires a public Babylon Lite SceneContext.");
    const a = y.source;
    if (!a || typeof a != "object" || n.get(a) !== "animationGroup") return A("unsupported", "This entity is not an animation group.");
    const w = a;
    if (!u.scene.animationGroups.includes(w)) return A("unsupported", "This animation group does not belong to the current scene.");
    for (const X of u.scene.animationGroups)
      (((N = u.lite) == null ? void 0 : N.stopAnimation) ?? qt)(X);
    return (((W = u.lite) == null ? void 0 : W.playAnimation) ?? oi)(w), q();
  }, Y = (y, u) => {
    var N;
    if (!Fe(u.scene)) return A("unsupported", "Animation playback requires a public Babylon Lite SceneContext.");
    const a = y.source;
    if (!a || typeof a != "object" || n.get(a) !== "animationGroup") return A("unsupported", "This entity is not an animation group.");
    const w = a;
    return u.scene.animationGroups.includes(w) ? ((((N = u.lite) == null ? void 0 : N.stopAnimation) ?? qt)(w), q()) : A("unsupported", "This animation group does not belong to the current scene.");
  }, pe = async (y, u, a) => {
    var w, N, W;
    if (!Fe(a.scene)) return A("unsupported", "Canvas picking requires a public Babylon Lite SceneContext.");
    try {
      let X = s.get(a.scene);
      X || (X = (((w = a.lite) == null ? void 0 : w.createGpuPicker) ?? wn)(a.scene), s.set(a.scene, X), r.set(X, ((N = a.lite) == null ? void 0 : N.disposePicker) ?? xn));
      const S = await (((W = a.lite) == null ? void 0 : W.pickAsync) ?? Pn)(X, y, u);
      if (!S.hit || !S.pickedMesh) return q(null);
      const U = e.get(S.pickedMesh);
      if (!U) return q(null);
      const ee = {
        distance: S.distance,
        pickedPoint: S.pickedPoint,
        pickedNormal: S.pickedNormal,
        pickedNormalWorld: S.pickedNormalWorld,
        pickedFaceNormal: S.pickedFaceNormal,
        pickedFaceNormalWorld: S.pickedFaceNormalWorld,
        faceId: S.faceId,
        subMeshId: S.subMeshId,
        bu: S.bu,
        bv: S.bv,
        thinInstanceIndex: S.thinInstanceIndex
      };
      return q({ entityId: U, details: ee });
    } catch (X) {
      return A("failed", X instanceof Error ? X.message : "Canvas picking failed.");
    }
  };
  return {
    getSceneTree: v,
    getProperties: J,
    setProperty: M,
    getStats: E,
    pickEntity: pe,
    pickEntityId: async (y, u, a) => {
      var N;
      const w = await pe(y, u, a);
      return w.ok ? q(((N = w.value) == null ? void 0 : N.entityId) ?? null) : w;
    },
    setEntityVisible: async (y, u, a) => M(y, "visible", u, a),
    removeEntity: P,
    playAnimationGroup: $,
    stopAnimationGroup: Y,
    getEntitySnapshot: (y, u) => {
      const a = {};
      for (const w of J(y, u))
        w.path.startsWith("$") || (a[w.path] = w.value);
      return q(a);
    },
    dispose() {
      for (const [y, u] of r) u(y);
      r.clear();
    }
  };
}
function dt(t) {
  let e = false;
  return { dispose: () => {
    e || (e = true, t());
  } };
}
var Bi = class {
  constructor() {
    re(this, "values", []);
    re(this, "disposed", false);
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
var Ge;
var ae;
var Pt;
var nn;
var pt = 0;
var Wn = [];
var de = Z;
var rn = de.__b;
var sn = de.__r;
var on = de.diffed;
var an = de.__c;
var ln = de.unmount;
var cn = de.__;
function _t(t, e) {
  de.__h && de.__h(ae, t, pt || e), pt = 0;
  var n = ae.__H || (ae.__H = { __: [], __h: [] });
  return t >= n.__.length && n.__.push({}), n.__[t];
}
function Ie(t) {
  return pt = 1, ji(jn, t);
}
function ji(t, e, n) {
  var i = _t(Ge++, 2);
  if (i.t = t, !i.__c && (i.__ = [jn(void 0, e), function(c) {
    var b = i.__N ? i.__N[0] : i.__[0], d = i.t(b, c);
    b !== d && (i.__N = [d, i.__[1]], i.__c.setState({}));
  }], i.__c = ae, !ae.__f)) {
    var r = function(c, b, d) {
      if (!i.__c.__H) return true;
      var v = i.__c.__H.__.filter(function(x) {
        return x.__c;
      });
      if (v.every(function(x) {
        return !x.__N;
      })) return !s || s.call(this, c, b, d);
      var m = i.__c.props !== c;
      return v.some(function(x) {
        if (x.__N) {
          var g = x.__[0];
          x.__ = x.__N, x.__N = void 0, g !== x.__[0] && (m = true);
        }
      }), s && s.call(this, c, b, d) || m;
    };
    ae.__f = true;
    var s = ae.shouldComponentUpdate, o = ae.componentWillUpdate;
    ae.componentWillUpdate = function(c, b, d) {
      if (this.__e) {
        var v = s;
        s = void 0, r(c, b, d), s = v;
      }
      o && o.call(this, c, b, d);
    }, ae.shouldComponentUpdate = r;
  }
  return i.__N || i.__;
}
function We(t, e) {
  var n = _t(Ge++, 3);
  !de.__s && Bn(n.__H, e) && (n.__ = t, n.u = e, ae.__H.__h.push(n));
}
function Gt(t) {
  return pt = 5, kt(function() {
    return { current: t };
  }, []);
}
function kt(t, e) {
  var n = _t(Ge++, 7);
  return Bn(n.__H, e) && (n.__ = t(), n.__H = e, n.__h = t), n.__;
}
function Hi(t) {
  var e = ae.context[t.__c], n = _t(Ge++, 9);
  return n.c = t, e ? (n.__ == null && (n.__ = true, e.sub(ae)), e.props.value) : t.__;
}
function zi() {
  for (var t; t = Wn.shift(); ) {
    var e = t.__H;
    if (t.__P && e) try {
      e.__h.some(at), e.__h.some(Nt), e.__h = [];
    } catch (n) {
      e.__h = [], de.__e(n, t.__v);
    }
  }
}
de.__b = function(t) {
  ae = null, rn && rn(t);
}, de.__ = function(t, e) {
  t && e.__k && e.__k.__m && (t.__m = e.__k.__m), cn && cn(t, e);
}, de.__r = function(t) {
  sn && sn(t), Ge = 0;
  var e = (ae = t.__c).__H;
  e && (Pt === ae ? (e.__h = [], ae.__h = [], e.__.some(function(n) {
    n.__N && (n.__ = n.__N), n.u = n.__N = void 0;
  })) : (e.__h.some(at), e.__h.some(Nt), e.__h = [], Ge = 0)), Pt = ae;
}, de.diffed = function(t) {
  on && on(t);
  var e = t.__c;
  e && e.__H && (e.__H.__h.length && (Wn.push(e) !== 1 && nn === de.requestAnimationFrame || ((nn = de.requestAnimationFrame) || Yi)(zi)), e.__H.__.some(function(n) {
    n.u && (n.__H = n.u), n.u = void 0;
  })), Pt = ae = null;
}, de.__c = function(t, e) {
  e.some(function(n) {
    try {
      n.__h.some(at), n.__h = n.__h.filter(function(i) {
        return !i.__ || Nt(i);
      });
    } catch (i) {
      e.some(function(r) {
        r.__h && (r.__h = []);
      }), e = [], de.__e(i, n.__v);
    }
  }), an && an(t, e);
}, de.unmount = function(t) {
  ln && ln(t);
  var e, n = t.__c;
  n && n.__H && (n.__H.__.some(function(i) {
    try {
      at(i);
    } catch (r) {
      e = r;
    }
  }), n.__H = void 0, e && de.__e(e, n.__v));
};
var un = typeof requestAnimationFrame == "function";
function Yi(t) {
  var e, n = function() {
    clearTimeout(i), un && cancelAnimationFrame(e), setTimeout(t);
  }, i = setTimeout(n, 35);
  un && (e = requestAnimationFrame(n));
}
function at(t) {
  var e = ae, n = t.__c;
  typeof n == "function" && (t.__c = void 0, n()), ae = e;
}
function Nt(t) {
  var e = ae;
  t.__c = t.__(), ae = e;
}
function Bn(t, e) {
  return !t || t.length !== e.length || e.some(function(n, i) {
    return n !== t[i];
  });
}
function jn(t, e) {
  return typeof e == "function" ? e(t) : e;
}
var qi = /* @__PURE__ */ Symbol.for("preact-signals");
function St() {
  if (Ce > 1)
    Ce--;
  else {
    var t, e = false;
    for ((function() {
      var r = ht;
      for (ht = void 0; r !== void 0; )
        r.S.v === r.v && (r.S.i = r.i), r = r.o;
    })(); Je !== void 0; ) {
      var n = Je;
      for (Je = void 0, ft++; n !== void 0; ) {
        var i = n.u;
        if (n.u = void 0, n.f &= -3, !(8 & n.f) && zn(n)) try {
          n.c();
        } catch (r) {
          e || (t = r, e = true);
        }
        n = i;
      }
    }
    if (ft = 0, Ce--, e) throw t;
  }
}
function Ki(t) {
  if (Ce > 0) return t();
  Ft = ++Ji, Ce++;
  try {
    return t();
  } finally {
    St();
  }
}
var se = void 0;
function wt(t) {
  var e = se;
  se = void 0;
  try {
    return t();
  } finally {
    se = e;
  }
}
var Je = void 0;
var Ce = 0;
var ft = 0;
var Ji = 0;
var Ft = 0;
var ht = void 0;
var mt = 0;
function Hn(t) {
  if (se !== void 0) {
    var e = t.n;
    if (e === void 0 || e.t !== se)
      return e = { i: 0, S: t, p: se.s, n: void 0, t: se, e: void 0, x: void 0, r: e }, se.s !== void 0 && (se.s.n = e), se.s = e, t.n = e, 32 & se.f && t.S(e), e;
    if (e.i === -1)
      return e.i = 0, e.n !== void 0 && (e.n.p = e.p, e.p !== void 0 && (e.p.n = e.n), e.p = se.s, e.n = void 0, se.s.n = e, se.s = e), e;
  }
}
function me(t, e) {
  this.v = t, this.i = 0, this.n = void 0, this.t = void 0, this.l = 0, this.W = e == null ? void 0 : e.watched, this.Z = e == null ? void 0 : e.unwatched, this.name = e == null ? void 0 : e.name;
}
me.prototype.brand = qi;
me.prototype.h = function() {
  return true;
};
me.prototype.S = function(t) {
  var e = this, n = this.t;
  n !== t && t.e === void 0 && (t.x = n, this.t = t, n !== void 0 ? n.e = t : wt(function() {
    var i;
    (i = e.W) == null || i.call(e);
  }));
};
me.prototype.U = function(t) {
  var e = this;
  if (this.t !== void 0) {
    var n = t.e, i = t.x;
    n !== void 0 && (n.x = i, t.e = void 0), i !== void 0 && (i.e = n, t.x = void 0), t === this.t && (this.t = i, i === void 0 && wt(function() {
      var r;
      (r = e.Z) == null || r.call(e);
    }));
  }
};
me.prototype.subscribe = function(t) {
  var e = this;
  return Ze(function() {
    var n = e.value;
    wt(function() {
      return t(n);
    });
  }, { name: "sub" });
};
me.prototype.valueOf = function() {
  return this.value;
};
me.prototype.toString = function() {
  return this.value + "";
};
me.prototype.toJSON = function() {
  return this.value;
};
me.prototype.peek = function() {
  var t = this;
  return wt(function() {
    return t.value;
  });
};
Object.defineProperty(me.prototype, "value", { get: function() {
  var t = Hn(this);
  return t !== void 0 && (t.i = this.i), this.v;
}, set: function(t) {
  if (t !== this.v) {
    if (ft > 100) throw new Error("Cycle detected");
    (function(n) {
      Ce !== 0 && ft === 0 && n.l !== Ft && (n.l = Ft, ht = { S: n, v: n.v, i: n.i, o: ht });
    })(this), this.v = t, this.i++, mt++, Ce++;
    try {
      for (var e = this.t; e !== void 0; e = e.x) e.t.N();
    } finally {
      St();
    }
  }
} });
function Q(t, e) {
  return new me(t, e);
}
function zn(t) {
  for (var e = t.s; e !== void 0; e = e.n) if (e.S.i !== e.i || !e.S.h() || e.S.i !== e.i) return true;
  return false;
}
function Yn(t) {
  for (var e = t.s; e !== void 0; e = e.n) {
    var n = e.S.n;
    if (n !== void 0 && (e.r = n), e.S.n = e, e.i = -1, e.n === void 0) {
      t.s = e;
      break;
    }
  }
}
function qn(t) {
  for (var e = t.s, n = void 0; e !== void 0; ) {
    var i = e.p;
    e.i === -1 ? (e.S.U(e), i !== void 0 && (i.n = e.n), e.n !== void 0 && (e.n.p = i)) : n = e, e.S.n = e.r, e.r !== void 0 && (e.r = void 0), e = i;
  }
  t.s = n;
}
function Ne(t, e) {
  me.call(this, void 0, e), this.x = t, this.s = void 0, this.g = mt - 1, this.f = 4;
}
Ne.prototype = new me();
Ne.prototype.h = function() {
  if (this.f &= -3, 1 & this.f) return false;
  if ((36 & this.f) == 32 || (this.f &= -5, this.g === mt)) return true;
  if (this.g = mt, this.f |= 1, this.i > 0 && !zn(this))
    return this.f &= -2, true;
  var t = se;
  try {
    Yn(this), se = this;
    var e = this.x();
    (16 & this.f || this.v !== e || this.i === 0) && (this.v = e, this.f &= -17, this.i++);
  } catch (n) {
    this.v = n, this.f |= 16, this.i++;
  }
  return se = t, qn(this), this.f &= -2, true;
};
Ne.prototype.S = function(t) {
  if (this.t === void 0) {
    this.f |= 36;
    for (var e = this.s; e !== void 0; e = e.n) e.S.S(e);
  }
  me.prototype.S.call(this, t);
};
Ne.prototype.U = function(t) {
  if (this.t !== void 0 && (me.prototype.U.call(this, t), this.t === void 0)) {
    this.f &= -33;
    for (var e = this.s; e !== void 0; e = e.n) e.S.U(e);
  }
};
Ne.prototype.N = function() {
  if (!(2 & this.f)) {
    this.f |= 6;
    for (var t = this.t; t !== void 0; t = t.x) t.t.N();
  }
};
Object.defineProperty(Ne.prototype, "value", { get: function() {
  if (1 & this.f) throw new Error("Cycle detected");
  var t = Hn(this);
  if (this.h(), t !== void 0 && (t.i = this.i), 16 & this.f) throw this.v;
  return this.v;
} });
function bt(t, e) {
  return new Ne(t, e);
}
function Kn(t) {
  var e = t.m;
  if (t.m = void 0, typeof e == "function") {
    Ce++;
    var n = se;
    se = void 0;
    try {
      e();
    } catch (i) {
      throw t.f &= -2, t.f |= 8, Wt(t), i;
    } finally {
      se = n, St();
    }
  }
}
function Wt(t) {
  for (var e = t.s; e !== void 0; e = e.n) e.S.U(e);
  t.x = void 0, t.s = void 0, Kn(t);
}
function Xi(t) {
  if (se !== this) throw new Error("Out-of-order effect");
  qn(this), se = t, this.f &= -2, 8 & this.f && Wt(this), St();
}
function je(t, e) {
  this.x = t, this.m = void 0, this.s = void 0, this.u = void 0, this.f = 32, this.name = e == null ? void 0 : e.name;
}
je.prototype.c = function() {
  var t = this.S();
  try {
    if (8 & this.f || this.x === void 0) return;
    var e = this.x();
    typeof e == "function" && (this.m = e);
  } finally {
    t();
  }
};
je.prototype.S = function() {
  if (1 & this.f) throw new Error("Cycle detected");
  this.f |= 1, this.f &= -9, Kn(this), Yn(this), Ce++;
  var t = se;
  return se = this, Xi.bind(this, t);
};
je.prototype.N = function() {
  2 & this.f || (this.f |= 2, this.u = Je, Je = this);
};
je.prototype.d = function() {
  this.f |= 8, 1 & this.f || Wt(this);
};
je.prototype.dispose = function() {
  this.d();
};
function Ze(t, e) {
  var n = new je(t, e);
  try {
    n.c();
  } catch (r) {
    throw n.d(), r;
  }
  var i = n.d.bind(n);
  return i[Symbol.dispose] = i, i;
}
var Jn;
var nt;
var Zi = typeof window < "u" && !!window.__PREACT_SIGNALS_DEVTOOLS__;
var Xn = [];
Ze(function() {
  Jn = this.N;
})();
function He(t, e) {
  Z[t] = e.bind(null, Z[t] || function() {
  });
}
function yt(t) {
  if (nt) {
    var e = nt;
    nt = void 0, e();
  }
  nt = t && t.S();
}
function Zn(t) {
  var e = this, n = t.data, i = er(n);
  i.value = n;
  var r = kt(function() {
    for (var c = e, b = e.__v; b = b.__; ) if (b.__c) {
      b.__c.__$f |= 4;
      break;
    }
    var d = bt(function() {
      var g = i.value.value;
      return g === 0 ? 0 : g === true ? "" : g || "";
    }), v = bt(function() {
      return !Array.isArray(d.value) && !Mn(d.value);
    }), m = Ze(function() {
      if (this.N = Qn, v.value) {
        var g = d.value;
        c.__v && c.__v.__e && c.__v.__e.nodeType === 3 && (c.__v.__e.data = g);
      }
    }), x = e.__$u.d;
    return e.__$u.d = function() {
      m(), x.call(this);
    }, [v, d];
  }, []), s = r[0], o = r[1];
  return s.value ? o.peek() : o.value;
}
Zn.displayName = "ReactiveTextNode";
Object.defineProperties(me.prototype, { constructor: { configurable: true, value: void 0 }, type: { configurable: true, value: Zn }, props: { configurable: true, get: function() {
  var t = this;
  return { data: { get value() {
    return t.value;
  } } };
} }, __b: { configurable: true, value: 1 } });
He("__b", function(t, e) {
  if (typeof e.type == "string") {
    var n, i = e.props;
    for (var r in i) if (r !== "children") {
      var s = i[r];
      s instanceof me && (n || (e.__np = n = {}), n[r] = s, i[r] = s.peek());
    }
  }
  t(e);
});
He("__r", function(t, e) {
  if (t(e), e.type !== Be) {
    yt();
    var n, i = e.__c;
    i && (i.__$f &= -2, (n = i.__$u) === void 0 && (i.__$u = n = (function(r, s) {
      var o;
      return Ze(function() {
        o = this;
      }, { name: s }), o.c = r, o;
    })(function() {
      var r;
      Zi && ((r = n.y) == null || r.call(n)), i.__$f |= 1, i.setState({});
    }, typeof e.type == "function" ? e.type.displayName || e.type.name : ""))), yt(n);
  }
});
He("__e", function(t, e, n, i) {
  yt(), t(e, n, i);
});
He("diffed", function(t, e) {
  yt();
  var n;
  if (typeof e.type == "string" && (n = e.__e)) {
    var i = e.__np, r = e.props;
    if (i) {
      var s = n.U;
      if (s) for (var o in s) {
        var c = s[o];
        c !== void 0 && !(o in i) && (c.d(), s[o] = void 0);
      }
      else
        s = {}, n.U = s;
      for (var b in i) {
        var d = s[b], v = i[b];
        d === void 0 ? (d = Qi(n, b, v, r), s[b] = d) : d.o(v, r);
      }
    }
  }
  t(e);
});
function Qi(t, e, n, i) {
  var r = e in t && t.ownerSVGElement === void 0, s = Q(n);
  return { o: function(o, c) {
    s.value = o, i = c;
  }, d: Ze(function() {
    this.N = Qn;
    var o = s.value.value;
    i[e] !== o && (i[e] = o, r ? t[e] = o : o != null && (o !== false || e[4] === "-") ? t.setAttribute(e, o) : t.removeAttribute(e));
  }) };
}
He("unmount", function(t, e) {
  if (typeof e.type == "string") {
    var n = e.__e;
    if (n) {
      var i = n.U;
      if (i) {
        n.U = void 0;
        for (var r in i) {
          var s = i[r];
          s && s.d();
        }
      }
    }
    var o = e.__np;
    if (o) {
      var c = e.props;
      for (var b in o) c[b] = o[b];
    }
    e.__np = void 0;
  } else {
    var d = e.__c;
    if (d) {
      var v = d.__$u;
      v && (d.__$u = void 0, v.d());
    }
  }
  t(e);
});
He("__h", function(t, e, n, i) {
  (i < 3 || i === 9) && (e.__$f |= 2), t(e, n, i);
});
Re.prototype.shouldComponentUpdate = function(t, e) {
  if (this.__R) return true;
  var n = this.__$u, i = n && n.s !== void 0;
  for (var r in e) return true;
  if (this.__f || typeof this.u == "boolean" && this.u === true) {
    var s = 2 & this.__$f;
    if (!(i || s || 4 & this.__$f) || 1 & this.__$f) return true;
  } else if (!(i || 4 & this.__$f) || 3 & this.__$f) return true;
  for (var o in t) if (o !== "__source" && t[o] !== this.props[o]) return true;
  for (var c in this.props) if (!(c in t)) return true;
  return false;
};
function er(t, e) {
  return kt(function() {
    return Q(t, e);
  }, []);
}
var tr = function(t) {
  queueMicrotask(function() {
    queueMicrotask(t);
  });
};
function nr() {
  Ki(function() {
    for (var t; t = Xn.shift(); ) Jn.call(t);
  });
}
function Qn() {
  Xn.push(this) === 1 && (Z.requestAnimationFrame || tr)(nr);
}
function Xe(t, e) {
  for (const n of t) {
    if (n.id === e) return n;
    const i = n.children ? Xe(n.children, e) : null;
    if (i) return i;
  }
  return null;
}
function ei(t, e) {
  for (const n of t) {
    if (n.id === e) return [n];
    const i = n.children ? ei(n.children, e) : null;
    if (i) return [n, ...i];
  }
  return null;
}
function ir(t, e) {
  const n = e.trim().toLocaleLowerCase();
  if (!n) return [...t];
  const i = (r) => {
    var o;
    const s = ((o = r.children) == null ? void 0 : o.map(i).filter((c) => c !== null)) ?? [];
    return r.label.toLocaleLowerCase().includes(n) || s.length ? { ...r, children: s.length ? s : void 0 } : null;
  };
  return t.map(i).filter((r) => r !== null);
}
function rr() {
  const t = Q(true), e = Q("dark"), n = Q("single"), i = Q(null), r = Q(null), s = Q(0), o = Q(null), c = Q([]), b = Q([]), d = Q([]), v = Q({}), m = Q(""), x = Q(/* @__PURE__ */ new Set()), g = Q([]), L = Q(false), J = Q(false), M = Q(false), P = Q(false), E = Q(null), $ = Q({
    confirmEntityRemoval: false,
    instancerPickMode: "instance",
    keyboardShortcutsEnabled: true,
    notificationsEnabled: true,
    notificationDurationMs: 3e3
  }), Y = Q([]), pe = Q([]), ne = Q({ left: null, right: null, single: null }), ie = Q(44), y = bt(() => o.value ? Xe(c.value, o.value) ?? Xe(b.value, o.value) : null), u = bt(() => ir(c.value, m.value));
  return {
    isOpen: t,
    theme: e,
    layout: n,
    context: i,
    adapter: r,
    sceneVersion: s,
    selectedEntityId: o,
    selectedEntity: y,
    tree: c,
    extensionEntities: b,
    filteredTree: u,
    properties: d,
    stats: v,
    search: m,
    expandedIds: x,
    notifications: g,
    isRefreshingTree: L,
    isRefreshingProperties: J,
    pickingAvailable: M,
    pickingActive: P,
    lastPick: E,
    userSettings: $,
    panes: Y,
    toolbarItems: pe,
    selectedPanes: ne,
    singlePanePercent: ie
  };
}
var sr = class {
  constructor() {
    re(this, "id", "commands");
    re(this, "commands", /* @__PURE__ */ new Map());
  }
  register(e) {
    if (this.commands.has(e.id)) throw new Error(`Command already registered: ${e.id}`);
    return this.commands.set(e.id, e), dt(() => this.commands.delete(e.id));
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
var or = class {
  constructor(e, n = 3e3, i = true) {
    re(this, "nextId", 1);
    re(this, "timers", /* @__PURE__ */ new Map());
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
var ar = class {
  constructor(e, n, i, r, s) {
    re(this, "pointers", /* @__PURE__ */ new Map());
    re(this, "generation", 0);
    re(this, "started", false);
    re(this, "onPointerDown", (e2) => {
      !e2.isPrimary || e2.pointerType !== "touch" && e2.button !== 0 || this.pointers.set(e2.pointerId, { x: e2.clientX, y: e2.clientY });
    });
    re(this, "onPointerUp", (e2) => {
      const n2 = this.pointers.get(e2.pointerId);
      if (this.pointers.delete(e2.pointerId), !n2 || Math.hypot(e2.clientX - n2.x, e2.clientY - n2.y) > 4) return;
      const i2 = this.canvas.getBoundingClientRect();
      this.pick(e2.clientX - i2.left, e2.clientY - i2.top);
    });
    re(this, "onPointerCancel", (e2) => {
      this.pointers.delete(e2.pointerId);
    });
    this.canvas = e, this.signals = n, this.refresh = i, this.notifications = r, this.shell = s;
  }
  start() {
    this.started || (this.started = true, this.canvas.addEventListener("pointerdown", this.onPointerDown), this.canvas.addEventListener("pointerup", this.onPointerUp), this.canvas.addEventListener("pointercancel", this.onPointerCancel));
  }
  async pick(e, n) {
    var o, c, b, d, v;
    const i = ++this.generation, r = this.signals.adapter.value, s = this.signals.context.value;
    if (!(!(r != null && r.pickEntity) && !(r != null && r.pickEntityId) || !s))
      try {
        const m = {
          ...s,
          explorer: {
            ...s.explorer,
            userSettings: {
              ...(o = s.explorer) == null ? void 0 : o.userSettings,
              instancerPickMode: this.signals.userSettings.value.instancerPickMode
            }
          }
        }, x = r.pickEntity ? await r.pickEntity(e, n, m) : await Promise.resolve(r.pickEntityId(e, n, m)).then((L) => L.ok ? { ok: true, value: L.value ? { entityId: L.value } : null } : L);
        if (!this.started || i !== this.generation) return;
        if (!x.ok) {
          this.notifications.push(x.message);
          return;
        }
        const g = x.value && "details" in x.value ? x.value.details : void 0;
        await this.refresh.select(((c = x.value) == null ? void 0 : c.entityId) ?? null, g), (d = (b = this.signals.selectedEntity.value) == null ? void 0 : b.meta) != null && d.instancer && ((v = this.shell) == null || v.selectPane("instancer"));
      } catch (m) {
        this.started && i === this.generation && this.notifications.push(m instanceof Error ? m.message : "Canvas picking failed.");
      }
  }
  stop() {
    this.started && (this.started = false, this.generation++, this.pointers.clear(), this.canvas.removeEventListener("pointerdown", this.onPointerDown), this.canvas.removeEventListener("pointerup", this.onPointerUp), this.canvas.removeEventListener("pointercancel", this.onPointerCancel));
  }
  dispose() {
    this.stop();
  }
};
var lr = class {
  constructor(e, n) {
    re(this, "generation", 0);
    re(this, "disposed", false);
    re(this, "propertyWrites", /* @__PURE__ */ new Map());
    this.signals = e, this.notifications = n;
  }
  async refreshTree() {
    var r;
    const e = ++this.generation, n = this.signals.context.value, i = this.signals.adapter.value;
    if (!(!n || !i || this.disposed)) {
      this.signals.isRefreshingTree.value = true;
      try {
        const s = await i.getSceneTree(n), o = await ((r = i.getExtensionEntities) == null ? void 0 : r.call(i, n)) ?? [];
        if (this.disposed || e !== this.generation) return;
        this.signals.tree.value = s, this.signals.extensionEntities.value = o, this.signals.sceneVersion.value++;
        const c = this.signals.selectedEntityId.value;
        c && !Xe(s, c) && !Xe(o, c) && (this.signals.selectedEntityId.value = null, this.signals.lastPick.value = null), await this.refreshProperties(e);
      } catch (s) {
        !this.disposed && e === this.generation && this.notifications.push(s instanceof Error ? s.message : "Scene refresh failed.");
      } finally {
        !this.disposed && e === this.generation && (this.signals.isRefreshingTree.value = false);
      }
    }
  }
  async select(e, n) {
    if (this.signals.lastPick.value = e && n ? { entityId: e, details: n } : null, this.signals.selectedEntityId.value = e, e) {
      const r = ei(this.signals.tree.value, e);
      if (r != null && r.length) {
        const s = new Set(this.signals.expandedIds.value);
        for (const o of r.slice(0, -1)) s.add(o.id);
        this.signals.expandedIds.value = s;
      }
    }
    const i = ++this.generation;
    await this.refreshProperties(i);
  }
  async refreshProperties(e = ++this.generation) {
    const n = this.signals.context.value, i = this.signals.adapter.value, r = this.signals.selectedEntity.value;
    if (!n || !i || !r) {
      this.signals.properties.value = [];
      return;
    }
    const s = r.id;
    this.signals.isRefreshingProperties.value = true;
    try {
      const o = await i.getProperties(r, n), c = this.signals.lastPick.value, b = (c == null ? void 0 : c.entityId) === s ? this.pickProperties(c.details) : [];
      !this.disposed && e === this.generation && this.signals.selectedEntityId.value === s && (this.signals.properties.value = [...o, ...b]);
    } catch (o) {
      !this.disposed && e === this.generation && this.notifications.push(o instanceof Error ? o.message : "Property refresh failed.");
    } finally {
      !this.disposed && e === this.generation && (this.signals.isRefreshingProperties.value = false);
    }
  }
  pickProperties(e) {
    const n = [
      { kind: "number", path: "pick.distance", label: "Distance", value: e.distance, readonly: true, section: "Last Pick" },
      { kind: "number", path: "pick.faceId", label: "Face ID", value: e.faceId, readonly: true, section: "Last Pick" },
      { kind: "number", path: "pick.subMeshId", label: "Submesh ID", value: e.subMeshId, readonly: true, section: "Last Pick" },
      { kind: "number", path: "pick.bu", label: "Barycentric U", value: e.bu, readonly: true, section: "Last Pick" },
      { kind: "number", path: "pick.bv", label: "Barycentric V", value: e.bv, readonly: true, section: "Last Pick" },
      { kind: "readonly", path: "pick.thinInstance", label: "Thin instance", value: e.thinInstanceIndex >= 0 ? String(e.thinInstanceIndex) : "Regular mesh", section: "Last Pick" }
    ], i = [
      ["pickedPoint", "Point", e.pickedPoint],
      ["pickedNormal", "Normal (local)", e.pickedNormal],
      ["pickedNormalWorld", "Normal (world)", e.pickedNormalWorld],
      ["pickedFaceNormal", "Face normal (local)", e.pickedFaceNormal],
      ["pickedFaceNormalWorld", "Face normal (world)", e.pickedFaceNormalWorld]
    ];
    for (const [r, s, o] of i) o && n.push({ kind: "vector3", path: `pick.${r}`, label: s, value: o, readonly: true, section: "Last Pick" });
    return n;
  }
  setProperty(e, n) {
    const i = this.signals.context.value, r = this.signals.adapter.value, s = this.signals.selectedEntity.value;
    if (!i || !(r != null && r.setProperty) || !s || this.disposed) return Promise.resolve(false);
    const o = `${s.id}\0${e.path}`, b = (this.propertyWrites.get(o) ?? Promise.resolve(true)).then(
      () => this.performPropertyWrite(s, e, n, i, r.setProperty),
      () => this.performPropertyWrite(s, e, n, i, r.setProperty)
    );
    return this.propertyWrites.set(o, b), b.finally(() => {
      this.propertyWrites.get(o) === b && this.propertyWrites.delete(o);
    }), b;
  }
  async performPropertyWrite(e, n, i, r, s) {
    if (this.disposed) return false;
    try {
      const o = await s(e, n.path, i, r);
      return o.ok ? (n.path === "name" ? await this.refreshTree() : this.signals.selectedEntityId.value === e.id && await this.refreshProperties(), this.signals.sceneVersion.value++, true) : (this.notifications.push(o.message), false);
    } catch (o) {
      return this.notifications.push(o instanceof Error ? o.message : "Property update failed."), false;
    }
  }
  dispose() {
    this.disposed = true, this.generation++, this.propertyWrites.clear(), this.signals.lastPick.value = null;
  }
};
var dn = (t) => [...t].sort((e, n) => (e.order ?? 0) - (n.order ?? 0) || e.key.localeCompare(n.key));
var cr = class {
  constructor(e) {
    this.signals = e;
  }
  addSidePane(e) {
    if (this.signals.panes.value.some((n) => n.key === e.key)) throw new Error(`Pane already registered: ${e.key}`);
    return this.signals.panes.value = dn([...this.signals.panes.value, e]), this.signals.selectedPanes.value[e.side] || this.selectPane(e.key, false), this.signals.selectedPanes.value.single || (this.signals.selectedPanes.value = { ...this.signals.selectedPanes.value, single: e.key }), dt(() => {
      var n;
      if (this.signals.panes.value = this.signals.panes.value.filter((i) => i.key !== e.key), this.signals.selectedPanes.value[e.side] === e.key) {
        const i = ((n = this.signals.panes.value.find((r) => r.side === e.side)) == null ? void 0 : n.key) ?? null;
        this.signals.selectedPanes.value = { ...this.signals.selectedPanes.value, [e.side]: i };
      }
    });
  }
  addToolbarItem(e) {
    if (this.signals.toolbarItems.value.some((n) => n.key === e.key)) throw new Error(`Toolbar item already registered: ${e.key}`);
    return this.signals.toolbarItems.value = dn([...this.signals.toolbarItems.value, e]), dt(() => {
      this.signals.toolbarItems.value = this.signals.toolbarItems.value.filter((n) => n.key !== e.key);
    });
  }
  selectPane(e, n = true) {
    const i = this.signals.panes.value.find((r) => r.key === e);
    i && (this.signals.selectedPanes.value = {
      ...this.signals.selectedPanes.value,
      [i.side]: e,
      ...n ? { single: e } : {}
    });
  }
};
var ur = class {
  constructor(e) {
    re(this, "timer");
    re(this, "frameHandle");
    re(this, "previousFrameTime");
    re(this, "frameTimeTotal", 0);
    re(this, "frameCount", 0);
    re(this, "sampling", false);
    re(this, "onFrame", (e2) => {
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
      const r = await n.getStats(e);
      this.signals.stats.value = i === void 0 ? r : { ...r, frameMs: i, fps: 1e3 / i };
    } catch {
    } finally {
      this.sampling = false;
    }
  }
  dispose() {
    this.timer && clearInterval(this.timer), this.frameHandle !== void 0 && typeof cancelAnimationFrame == "function" && cancelAnimationFrame(this.frameHandle), this.timer = void 0, this.frameHandle = void 0, this.previousFrameTime = void 0, this.frameTimeTotal = 0, this.frameCount = 0;
  }
};
var dr = 0;
function p(t, e, n, i, r, s) {
  e || (e = {});
  var o, c, b = e;
  if ("ref" in b) for (c in b = {}, e) c == "ref" ? o = e[c] : b[c] = e[c];
  var d = { type: t, props: b, key: n, ref: o, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: --dr, __i: -1, __u: 0, __source: r, __self: s };
  if (typeof t == "function" && (o = t.defaultProps)) for (c in o) b[c] === void 0 && (b[c] = o[c]);
  return Z.vnode && Z.vnode(d), d;
}
var ti = Pi(null);
function ve() {
  const t = Hi(ti);
  if (!t) throw new Error("Explorer runtime is unavailable.");
  return t;
}
var pr = "data:image/svg+xml,%3c?xml%20version='1.0'%20encoding='UTF-8'?%3e%3csvg%20id='Layer_2'%20data-name='Layer%202'%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2069.75%2076.38'%3e%3cdefs%3e%3cstyle%3e%20.cls-1%20{%20fill:%20%23250bf1;%20}%20.cls-2%20{%20fill:%20%232128b9;%20}%20.cls-3%20{%20fill:%20%231204ce;%20}%20.cls-4%20{%20fill:%20%230c1486;%20}%20.cls-5%20{%20fill:%20none;%20stroke:%20%23000;%20stroke-miterlimit:%2010;%20stroke-width:%20.25px;%20}%20.cls-6%20{%20fill:%20%23f2f2f2;%20}%20.cls-7%20{%20fill:%20%23232ac3;%20}%20.cls-8%20{%20fill:%20%233315ff;%20}%20.cls-9%20{%20fill:%20%23fbfbfb;%20}%20.cls-10%20{%20fill:%20%23171fa2;%20}%20.cls-11%20{%20fill:%20%23aab0c4;%20}%20%3c/style%3e%3c/defs%3e%3cg%20id='Layer_1-2'%20data-name='Layer%201'%3e%3cpolygon%20class='cls-2'%20points='11.62%2022.3%2011.62%2036.65%200%2031.15%200%2016.79%2011.62%2022.3'/%3e%3cpolygon%20class='cls-2'%20points='11.62%2036.65%2011.62%2051.01%200%2045.51%200%2031.15%2011.62%2036.65'/%3e%3cpolygon%20class='cls-2'%20points='11.62%2051.01%2011.62%2065.37%200%2059.87%200%2045.51%2011.62%2051.01'/%3e%3cpolygon%20class='cls-7'%20points='34.87%2062.02%2034.87%2076.38%2023.25%2070.88%2023.25%2056.52%2034.87%2062.02'/%3e%3cpolygon%20class='cls-9'%20points='23.25%2056.52%2023.25%2070.88%2011.62%2065.37%2011.62%2051.01%2023.25%2056.52'/%3e%3cpolygon%20class='cls-9'%20points='23.25%2027.8%2023.25%2042.16%2011.62%2036.65%2011.62%2022.3%2011.63%2022.3%2023.25%2027.8'/%3e%3cpolygon%20class='cls-9'%20points='34.87%2047.66%2034.87%2062.02%2023.25%2056.52%2023.25%2042.16%2034.87%2047.66'/%3e%3cpolygon%20class='cls-9'%20points='23.25%2042.16%2023.25%2056.52%2011.62%2051.01%2011.62%2036.65%2023.25%2042.16'/%3e%3cline%20class='cls-5'%20x1='11.62'%20y1='65.38'%20x2='11.62'%20y2='65.37'/%3e%3cpolygon%20class='cls-4'%20points='69.75%2031.15%2069.75%2045.51%2058.12%2051.01%2058.12%2036.65%2069.75%2031.15'/%3e%3cpolygon%20class='cls-4'%20points='69.75%2045.51%2069.75%2059.87%2058.12%2065.37%2058.12%2051.01%2069.75%2045.51'/%3e%3cpolygon%20class='cls-4'%20points='58.12%2051.01%2058.12%2065.38%2046.5%2070.88%2046.5%2056.52%2058.12%2051.01'/%3e%3cpolygon%20class='cls-4'%20points='46.5%2056.52%2046.5%2070.88%2034.87%2076.38%2034.87%2062.02%2046.5%2056.52'/%3e%3cpolygon%20class='cls-11'%20points='46.5%2042.16%2046.5%2056.52%2034.87%2062.02%2034.87%2047.66%2046.5%2042.16'/%3e%3cpolygon%20class='cls-11'%20points='58.12%2036.65%2058.12%2051.01%2046.5%2056.52%2046.5%2042.16%2058.12%2036.65'/%3e%3cpolygon%20class='cls-4'%20points='69.75%2016.79%2069.75%2031.15%2058.12%2036.65%2058.12%2022.3%2058.14%2022.28%2058.15%2022.28%2069.75%2016.79'/%3e%3cpolygon%20class='cls-3'%20points='23.27%2042.18%2023.27%2027.82%2034.9%2022.32%2034.9%2036.68%2023.27%2042.18'/%3e%3cpolygon%20class='cls-11'%20points='58.12%2022.3%2058.12%2036.65%2046.5%2042.16%2046.5%2027.8%2046.52%2027.78%2046.53%2027.78%2058.12%2022.3'/%3e%3cline%20class='cls-5'%20x1='58.62'%20y1='11.29'%20x2='58.59'%20y2='11.3'/%3e%3cline%20class='cls-5'%20x1='46.73'%20y1='5.61'%20x2='46.69'%20y2='5.63'/%3e%3cline%20class='cls-5'%20x1='46.6'%20y1='27.82'%20x2='46.53'%20y2='27.78'/%3e%3cpolygon%20class='cls-8'%20points='34.9%2036.68%2034.9%2022.32%2046.52%2027.82%2046.52%2042.18%2034.9%2036.68'/%3e%3cpolygon%20class='cls-1'%20points='23.25%2042.2%2023.27%2042.18%2034.9%2036.68%2046.52%2042.18%2034.78%2047.66%2023.25%2042.2'/%3e%3cpolygon%20class='cls-6'%20points='58.14%2022.28%2058.12%2022.3%2046.53%2027.78%2046.52%2027.78%2034.99%2022.32%2046.69%2016.86%2058.14%2022.28'/%3e%3cpolygon%20class='cls-6'%20points='34.99%2022.32%2023.25%2027.8%2011.63%2022.3%2023.26%2016.76%2034.99%2022.32'/%3e%3cpolygon%20class='cls-10'%20points='23.26%2016.76%2011.63%2022.3%2011.62%2022.3%200%2016.79%2011.58%2011.23%2023.26%2016.76'/%3e%3cpolygon%20class='cls-10'%20points='46.69%205.63%2034.86%2011.25%2023.11%205.67%2034.87%200%2046.69%205.63'/%3e%3cpolygon%20class='cls-10'%20points='34.86%2011.25%2023.26%2016.76%2011.58%2011.23%2023.1%205.67%2023.11%205.67%2034.86%2011.25'/%3e%3cpolygon%20class='cls-6'%20points='46.69%2016.86%2034.99%2022.32%2023.26%2016.76%2034.86%2011.25%2046.69%2016.86'/%3e%3cpolygon%20class='cls-10'%20points='58.59%2011.3%2046.69%2016.86%2034.86%2011.25%2046.69%205.63%2058.59%2011.3'/%3e%3cpolygon%20class='cls-10'%20points='69.75%2016.79%2058.15%2022.28%2058.14%2022.28%2046.69%2016.86%2058.59%2011.3%2069.75%2016.79'/%3e%3c/g%3e%3c/svg%3e";
var pn = class extends Re {
  constructor() {
    super(...arguments);
    re(this, "state", {});
  }
  static getDerivedStateFromError(n) {
    return { error: n };
  }
  render() {
    return this.state.error ? /* @__PURE__ */ p("div", { class: "ble-pane-error", role: "alert", children: [
      "Panel failed: ",
      this.state.error.message
    ] }) : this.props.children;
  }
};
function fr({ title: t }) {
  const { signals: e, shell: n, setLayout: i, setTheme: r, hide: s, dispose: o } = ve(), c = e.panes.value, b = e.toolbarItems.value, d = (x) => b.filter((g) => g.location === x).map((g) => {
    const L = g.component;
    return /* @__PURE__ */ p(L, {}, g.key);
  }), v = (x) => {
    const g = c.filter((M) => M.side === x), L = e.selectedPanes.value[x], J = g.find((M) => M.key === L) ?? g[0];
    return /* @__PURE__ */ p("section", { class: `ble-pane ble-pane-${x}${x === "left" ? " ble-pane-has-footer" : ""}`, children: [
      /* @__PURE__ */ p("div", { class: "ble-tabs", role: "tablist", "aria-label": `${x} panels`, children: [
        g.map((M) => /* @__PURE__ */ p("button", { type: "button", role: "tab", "aria-selected": M.key === (J == null ? void 0 : J.key), onClick: () => n.selectPane(M.key), children: M.title }, M.key)),
        x === "left" && /* @__PURE__ */ p(fn, {})
      ] }),
      /* @__PURE__ */ p("div", { class: "ble-pane-content", children: g.map((M) => {
        const P = M.key === (J == null ? void 0 : J.key);
        if (!P && !M.keepMounted) return null;
        const E = M.content;
        return /* @__PURE__ */ p("div", { role: "tabpanel", hidden: !P, children: /* @__PURE__ */ p(pn, { children: /* @__PURE__ */ p(E, {}) }) }, M.key);
      }) }),
      x === "left" && /* @__PURE__ */ p(bn, {})
    ] });
  }, m = () => {
    const x = (L) => {
      e.singlePanePercent.value = L;
      try {
        localStorage.setItem("ble.singlePanePercent", String(L));
      } catch {
      }
    }, g = (L) => {
      const J = c.filter((E) => E.side === L), M = e.selectedPanes.value[L], P = J.find((E) => E.key === M) ?? J[0];
      return /* @__PURE__ */ p("section", { class: `ble-pane ble-pane-single ble-pane-single-${L}${L === "left" ? " ble-pane-has-footer" : ""}`, children: [
        /* @__PURE__ */ p("div", { class: "ble-tabs", role: "tablist", "aria-label": `${L} panels`, children: [
          J.map((E) => /* @__PURE__ */ p("button", { type: "button", role: "tab", "aria-selected": E.key === (P == null ? void 0 : P.key), onClick: () => n.selectPane(E.key), children: E.title }, E.key)),
          L === "left" && /* @__PURE__ */ p(fn, {})
        ] }),
        /* @__PURE__ */ p("div", { class: "ble-pane-content", children: J.map((E) => {
          const $ = E.key === (P == null ? void 0 : P.key);
          if (!$ && !E.keepMounted) return null;
          const Y = E.content;
          return /* @__PURE__ */ p("div", { role: "tabpanel", hidden: !$, children: /* @__PURE__ */ p(pn, { children: /* @__PURE__ */ p(Y, {}) }) }, E.key);
        }) }),
        L === "left" && /* @__PURE__ */ p(bn, {})
      ] });
    };
    return /* @__PURE__ */ p("div", { class: "ble-single-stack", style: { gridTemplateRows: `${e.singlePanePercent.value}% 5px minmax(0, 1fr)` }, children: [
      g("left"),
      /* @__PURE__ */ p(hr, { axis: "vertical", onChange: x }),
      g("right")
    ] });
  };
  return e.layout.value === "split" ? /* @__PURE__ */ p("div", { class: "ble-split-shell", children: [
    /* @__PURE__ */ p("section", { class: "ble-split-dock ble-split-dock-left", children: [
      /* @__PURE__ */ p("header", { class: "ble-toolbar", children: [
        /* @__PURE__ */ p("strong", { children: t }),
        d("top-left")
      ] }),
      v("left")
    ] }),
    /* @__PURE__ */ p("section", { class: "ble-split-dock ble-split-dock-right", children: [
      /* @__PURE__ */ p("header", { class: "ble-toolbar", children: [
        /* @__PURE__ */ p("div", { class: "ble-toolbar-zone", children: d("top-right") }),
        /* @__PURE__ */ p("div", { class: "ble-toolbar-actions", children: [
          /* @__PURE__ */ p("button", { type: "button", title: "Switch to single layout", onClick: () => i("single"), children: "Single" }),
          /* @__PURE__ */ p("button", { type: "button", title: `Switch to ${e.theme.value === "dark" ? "light" : "dark"} theme`, onClick: () => r(e.theme.value === "dark" ? "light" : "dark"), children: e.theme.value === "dark" ? "Light" : "Dark" }),
          /* @__PURE__ */ p("button", { type: "button", title: "Hide Explorer (Ctrl+Shift+E)", onClick: s, children: "Hide" }),
          /* @__PURE__ */ p("button", { class: "ble-dispose", type: "button", title: "Dispose Explorer permanently", "aria-label": "Dispose explorer permanently", onClick: o, children: "Dispose" })
        ] })
      ] }),
      v("right"),
      /* @__PURE__ */ p(hn, {}),
      /* @__PURE__ */ p(mn, { left: d("bottom-left"), right: d("bottom-right") }),
      /* @__PURE__ */ p(yn, {})
    ] }),
    /* @__PURE__ */ p(gn, {})
  ] }) : /* @__PURE__ */ p("div", { class: "ble-shell", children: [
    /* @__PURE__ */ p("header", { class: "ble-toolbar", children: [
      /* @__PURE__ */ p("div", { class: "ble-toolbar-zone", children: [
        /* @__PURE__ */ p("strong", { children: t }),
        d("top-left")
      ] }),
      /* @__PURE__ */ p("div", { class: "ble-toolbar-actions", children: [
        d("top-right"),
        /* @__PURE__ */ p("button", { type: "button", title: `Switch to ${e.layout.value === "single" ? "split" : "single"} layout`, onClick: () => i(e.layout.value === "single" ? "split" : "single"), children: e.layout.value === "single" ? "Split" : "Single" }),
        /* @__PURE__ */ p("button", { type: "button", title: `Switch to ${e.theme.value === "dark" ? "light" : "dark"} theme`, onClick: () => r(e.theme.value === "dark" ? "light" : "dark"), children: e.theme.value === "dark" ? "Light" : "Dark" }),
        /* @__PURE__ */ p("button", { type: "button", title: "Hide Explorer (Ctrl+Shift+E)", onClick: s, children: "Hide" }),
        /* @__PURE__ */ p("button", { class: "ble-dispose", type: "button", title: "Dispose Explorer permanently", "aria-label": "Dispose explorer permanently", onClick: o, children: "Dispose" })
      ] })
    ] }),
    /* @__PURE__ */ p("main", { class: "ble-main ble-main-single", children: m() }),
    /* @__PURE__ */ p(hn, {}),
    /* @__PURE__ */ p(mn, { left: d("bottom-left"), right: d("bottom-right") }),
    /* @__PURE__ */ p(yn, {}),
    /* @__PURE__ */ p(gn, {})
  ] });
}
function fn() {
  const { signals: t, setPickingActive: e } = ve();
  if (!t.pickingAvailable.value) return null;
  const n = t.pickingActive.value;
  return /* @__PURE__ */ p(
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
function hr({ axis: t, onChange: e }) {
  const n = Gt(false);
  return /* @__PURE__ */ p(
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
        const r = i.currentTarget.parentElement;
        if (!r) return;
        const s = r.getBoundingClientRect(), o = t === "vertical" ? (i.clientY - s.top) / s.height * 100 : (i.clientX - s.left) / s.width * 100;
        e(Math.round(Math.min(75, Math.max(25, o))));
      },
      onPointerUp: (i) => {
        n.current = false, i.currentTarget.releasePointerCapture(i.pointerId);
      },
      onPointerCancel: () => {
        n.current = false;
      },
      onKeyDown: (i) => {
        var o, c;
        const r = i.key === "ArrowLeft" || i.key === "ArrowUp" ? -2 : i.key === "ArrowRight" || i.key === "ArrowDown" ? 2 : 0;
        if (!r) return;
        i.preventDefault();
        const s = Number(t === "vertical" ? (((o = i.currentTarget.parentElement) == null ? void 0 : o.style.gridTemplateRows.match(/^([\d.]+)%/)) ?? [])[1] : (((c = i.currentTarget.parentElement) == null ? void 0 : c.style.gridTemplateColumns.match(/^([\d.]+)%/)) ?? [])[1]);
        e(Math.min(75, Math.max(25, (Number.isFinite(s) ? s : 40) + r)));
      }
    }
  );
}
function hn() {
  const { signals: t, commands: e, notifications: n } = ve(), i = t.selectedEntity.value, r = t.context.value, s = {
    "copy-entity-snapshot": "Copy",
    "toggle-visible": "Visible",
    "remove-entity": "Delete",
    "focus-selected": "Focus",
    "play-animation": "PLAY",
    "stop-animation": "STOP",
    "reset-instancer-instance": "Reset",
    "reset-instancer-set": "Reset Set",
    "save-instancer-set": "Save Set"
  }, o = i ? e.list(i).filter((b) => b.id in s) : [], c = async (b) => {
    const d = e.get(b);
    if (!(!d || !r))
      try {
        await d.run(i, r);
      } catch (v) {
        n.push(v instanceof Error ? v.message : `Command failed: ${d.label}`);
      }
  };
  return i ? /* @__PURE__ */ p("div", { class: "ble-selection-status", children: [
    /* @__PURE__ */ p("span", { children: "Selected" }),
    /* @__PURE__ */ p("strong", { children: i.label }),
    /* @__PURE__ */ p("div", { class: "ble-selection-actions", children: o.map((b) => /* @__PURE__ */ p("button", { type: "button", "data-command-id": b.id, onClick: () => void c(b.id), children: s[b.id] }, b.id)) })
  ] }) : /* @__PURE__ */ p("div", { class: "ble-selection-status is-empty", "aria-hidden": "true" });
}
function mn({ left: t, right: e }) {
  const { signals: n } = ve(), i = n.stats.value, r = [
    i.fps !== void 0 && `FPS ${i.fps.toFixed(0)}`,
    i.frameMs !== void 0 && `Frame int. ${i.frameMs.toFixed(1)} ms`,
    i.drawCallCount !== void 0 && `Draws ${i.drawCallCount}`,
    i.gpuFrameTimeMs !== void 0 && `GPU ${i.gpuFrameTimeMs.toFixed(1)} ms`,
    i.meshCount !== void 0 && `Meshes ${i.meshCount}`,
    i.lightCount !== void 0 && `Lights ${i.lightCount}`
  ].filter(Boolean);
  return /* @__PURE__ */ p("footer", { class: "ble-status", children: [
    /* @__PURE__ */ p("span", { class: "ble-status-zone", children: [
      t,
      r.length ? r.map((s) => /* @__PURE__ */ p("span", { children: s }, String(s))) : /* @__PURE__ */ p("span", { children: "Ready" })
    ] }),
    /* @__PURE__ */ p("span", { class: "ble-status-zone", children: e })
  ] });
}
function bn() {
  const { userGuideUrl: t } = ve(), [e, n] = Ie(false);
  return /* @__PURE__ */ p("footer", { class: "ble-links-footer", children: [
    /* @__PURE__ */ p("button", { class: "ble-footer-settings", type: "button", title: "Open User Settings", "aria-label": "Open User Settings", onClick: () => n(true), children: /* @__PURE__ */ p("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", children: /* @__PURE__ */ p("path", { fill: "currentColor", d: "M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2.5-1.5L14.2 2h-4l-.4 2.5A7 7 0 0 0 7.4 6L5 5 3 8.5l2 1.5a8 8 0 0 0 0 3l-2 1.5L5 18l2.4-1a7 7 0 0 0 2.4 1.5l.4 2.5h4l.4-2.5A7 7 0 0 0 17 17l2.4 1 2-3.5-2-1ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" }) }) }),
    /* @__PURE__ */ p("a", { class: "ble-footer-help", href: t, target: "_blank", rel: "noreferrer", title: "Open User Guide", "aria-label": "Open User Guide", children: "?" }),
    /* @__PURE__ */ p("a", { class: "ble-footer-logo", href: "https://babylonpress.org/", target: "_blank", rel: "noreferrer", title: "Created by BabylonPress", children: /* @__PURE__ */ p("img", { src: pr, alt: "BabylonPress" }) }),
    /* @__PURE__ */ p("a", { class: "ble-footer-github", href: "https://github.com/eldinor/babylon-lite-explorer", target: "_blank", rel: "noreferrer", title: "Babylon Lite Explorer on GitHub", "aria-label": "Babylon Lite Explorer on GitHub", children: /* @__PURE__ */ p("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", children: /* @__PURE__ */ p("path", { fill: "currentColor", d: "M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.28-5.27-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.19-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.71 5.39-5.29 5.68.42.36.79 1.07.79 2.16v3.2c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" }) }) }),
    e && /* @__PURE__ */ p(mr, { onClose: () => n(false) })
  ] });
}
function mr({ onClose: t }) {
  const { signals: e, setLayout: n, setTheme: i, setPickingActive: r, setConfirmEntityRemoval: s, setInstancerPickMode: o } = ve(), c = e.userSettings.value;
  return /* @__PURE__ */ p("div", { class: "ble-modal-backdrop", role: "presentation", onMouseDown: (b) => {
    b.target === b.currentTarget && t();
  }, children: /* @__PURE__ */ p("section", { class: "ble-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "ble-user-settings-title", children: [
    /* @__PURE__ */ p("header", { class: "ble-modal-header", children: [
      /* @__PURE__ */ p("h2", { id: "ble-user-settings-title", children: "User Settings" }),
      /* @__PURE__ */ p("button", { type: "button", "aria-label": "Close User Settings", onClick: t, children: "x" })
    ] }),
    /* @__PURE__ */ p("div", { class: "ble-settings-grid", children: [
      /* @__PURE__ */ p("section", { class: "ble-settings-section", children: [
        /* @__PURE__ */ p("h3", { children: "General" }),
        /* @__PURE__ */ p("label", { children: [
          /* @__PURE__ */ p("span", { children: "Theme" }),
          /* @__PURE__ */ p("select", { value: e.theme.value, onChange: (b) => i(b.currentTarget.value === "light" ? "light" : "dark"), children: [
            /* @__PURE__ */ p("option", { value: "dark", children: "Dark" }),
            /* @__PURE__ */ p("option", { value: "light", children: "Light" })
          ] })
        ] }),
        /* @__PURE__ */ p("label", { children: [
          /* @__PURE__ */ p("span", { children: "Layout" }),
          /* @__PURE__ */ p("select", { value: e.layout.value, onChange: (b) => n(b.currentTarget.value === "split" ? "split" : "single"), children: [
            /* @__PURE__ */ p("option", { value: "single", children: "Single" }),
            /* @__PURE__ */ p("option", { value: "split", children: "Split" })
          ] })
        ] }),
        /* @__PURE__ */ p("label", { class: "ble-settings-check", children: [
          /* @__PURE__ */ p("input", { type: "checkbox", checked: e.pickingActive.value, disabled: !e.pickingAvailable.value, onChange: (b) => r(b.currentTarget.checked) }),
          /* @__PURE__ */ p("span", { children: "Pick" })
        ] }),
        /* @__PURE__ */ p("label", { class: "ble-settings-check", children: [
          /* @__PURE__ */ p("input", { type: "checkbox", checked: c.confirmEntityRemoval, onChange: (b) => s(b.currentTarget.checked) }),
          /* @__PURE__ */ p("span", { children: "Confirm delete" })
        ] })
      ] }),
      /* @__PURE__ */ p("section", { class: "ble-settings-section", "data-adapter-settings": "instancer", children: [
        /* @__PURE__ */ p("h3", { children: "Instancer" }),
        /* @__PURE__ */ p("label", { children: [
          /* @__PURE__ */ p("span", { children: "Pick mode" }),
          /* @__PURE__ */ p("select", { value: c.instancerPickMode, onChange: (b) => o(b.currentTarget.value === "source" ? "source" : "instance"), children: [
            /* @__PURE__ */ p("option", { value: "instance", children: "Instance" }),
            /* @__PURE__ */ p("option", { value: "source", children: "Source" })
          ] })
        ] })
      ] })
    ] })
  ] }) });
}
function yn() {
  const { signals: t, shell: e, refresh: n } = ve(), i = t.stats.value.animationGroupCount, r = async () => {
    var c;
    const s = t.tree.value[0], o = (c = s == null ? void 0 : s.children) == null ? void 0 : c.find((b) => b.label === "Animation Groups");
    !s || !o || (e.selectPane("scene-explorer"), t.search.value = "", t.expandedIds.value = /* @__PURE__ */ new Set([...t.expandedIds.value, s.id, o.id]), await n.select(o.id));
  };
  return /* @__PURE__ */ p("footer", { class: "ble-properties-footer", "aria-label": "Properties footer", children: i !== void 0 && i > 0 && /* @__PURE__ */ p("button", { type: "button", onClick: () => void r(), children: [
    "Animation Groups ",
    i
  ] }) });
}
function gn() {
  const { signals: t, notifications: e } = ve();
  return /* @__PURE__ */ p("div", { class: "ble-notifications", "aria-live": "polite", children: t.notifications.value.map((n) => /* @__PURE__ */ p("div", { class: `ble-notification is-${n.tone}`, children: [
    n.message,
    /* @__PURE__ */ p("button", { type: "button", "aria-label": "Dismiss notification", onClick: () => e.dismiss(n.id), children: "\xD7" })
  ] }, n.id)) });
}
function br({ runtime: t, title: e }) {
  const { signals: n } = t;
  return n.isOpen.value ? /* @__PURE__ */ p(ti.Provider, { value: t, children: /* @__PURE__ */ p(fr, { title: e }) }) : null;
}
function Ae(t, e) {
  if (!Number.isFinite(t)) return String(t);
  const n = e && e < 1 ? Math.min(8, Math.max(0, Math.ceil(-Math.log10(e)))) : 0, i = Math.max(3, n);
  return t !== 0 && Math.abs(t) < 10 ** -i ? String(Number(t.toPrecision(3))) : String(Number(t.toFixed(i)));
}
function yr({ descriptor: t }) {
  const { signals: e, refresh: n, shell: i } = ve();
  if (t.kind === "entityRef") {
    const r = ni([...e.tree.value, ...e.extensionEntities.value], t.source);
    return /* @__PURE__ */ p("button", { class: "ble-property-link", type: "button", disabled: !r, title: t.value, onClick: () => {
      r && (i.selectPane("scene-explorer"), n.select(r.id));
    }, children: t.value });
  }
  if (t.kind === "readonly" || t.readonly) {
    const r = t.kind === "number" ? Ae(t.value, t.step) : String(t.value);
    return /* @__PURE__ */ p("span", { class: "ble-readonly", title: String(t.value), children: r });
  }
  return t.kind === "boolean" ? /* @__PURE__ */ p("input", { type: "checkbox", checked: t.value, onChange: (r) => void n.setProperty(t, r.currentTarget.checked) }) : t.kind === "select" ? /* @__PURE__ */ p("select", { value: t.value, onChange: (r) => void n.setProperty(t, r.currentTarget.value), children: t.options.map((r) => /* @__PURE__ */ p("option", { value: r.value, children: r.label }, r.value)) }) : t.kind === "vector3" || t.kind === "color3" || t.kind === "color4" ? /* @__PURE__ */ p(_r, { descriptor: t }) : t.kind === "number" ? /* @__PURE__ */ p(vr, { descriptor: t }) : /* @__PURE__ */ p(gr, { descriptor: t });
}
function ni(t, e) {
  for (const n of t) {
    if (n.source === e) return n;
    const i = n.children ? ni(n.children, e) : null;
    if (i) return i;
  }
  return null;
}
function gr({ descriptor: t }) {
  const { refresh: e } = ve(), [n, i] = Ie(t.value);
  return We(() => i(t.value), [t.value]), /* @__PURE__ */ p("input", { type: "text", value: n, onInput: (r) => {
    const s = r.currentTarget.value;
    i(s), s !== t.value && e.setProperty(t, s);
  }, onKeyDown: (r) => {
    r.key === "Enter" && r.currentTarget.blur(), r.key === "Escape" && (i(t.value), e.setProperty(t, t.value), r.currentTarget.blur());
  } });
}
function vr({ descriptor: t }) {
  const { refresh: e } = ve(), [n, i] = Ie(Ae(t.value, t.step));
  return We(() => i(Ae(t.value, t.step)), [t.value, t.step]), /* @__PURE__ */ p("input", { type: "number", value: n, min: t.min, max: t.max, step: t.step, onInput: (r) => {
    const s = r.currentTarget.value;
    i(s);
    const o = Number(s);
    s !== "" && Number.isFinite(o) && o !== t.value && e.setProperty(t, o);
  }, onKeyDown: (r) => {
    r.key === "Enter" && r.currentTarget.blur(), r.key === "Escape" && (i(Ae(t.value, t.step)), e.setProperty(t, t.value), r.currentTarget.blur());
  } });
}
function _r({ descriptor: t }) {
  const { refresh: e } = ve(), [n, i] = Ie(false), [r, s] = Ie(() => t.value.map((o) => Ae(o, 0.01)));
  return We(() => {
    n || s(t.value.map((o) => Ae(o, 0.01)));
  }, [t.value, n]), /* @__PURE__ */ p("div", { class: "ble-tuple", children: r.map((o, c) => /* @__PURE__ */ p("input", { "aria-label": `${t.label} ${"XYZW"[c]}`, type: "number", step: "0.01", value: o, onFocus: () => i(true), onBlur: () => i(false), onInput: (b) => {
    const d = [...r];
    d[c] = b.currentTarget.value, s(d);
    const v = d.map(Number);
    d.every((m) => m !== "") && v.every(Number.isFinite) && e.setProperty(t, v);
  }, onKeyDown: (b) => {
    b.key === "Enter" && b.currentTarget.blur(), b.key === "Escape" && (s(t.value.map((d) => Ae(d, 0.01))), e.setProperty(t, [...t.value]), b.currentTarget.blur());
  } }, c)) });
}
function kr(t) {
  const e = t.value;
  return Array.isArray(e) ? JSON.stringify(e) : String(e);
}
function Sr() {
  const { signals: t, notifications: e, refresh: n } = ve(), i = t.selectedEntity.value;
  if (We(() => {
    var o;
    if ((i == null ? void 0 : i.kind) !== "animationGroup" && ((o = i == null ? void 0 : i.meta) == null ? void 0 : o.liveProperties) !== true) return;
    const s = setInterval(() => {
      n.refreshProperties();
    }, 100);
    return () => clearInterval(s);
  }, [i == null ? void 0 : i.id, n]), !i) return /* @__PURE__ */ p("div", { class: "ble-empty", children: "Select an entity to inspect its public properties." });
  const r = /* @__PURE__ */ new Map();
  for (const s of t.properties.value) {
    const o = s.section ?? "General";
    r.set(o, [...r.get(o) ?? [], s]);
  }
  return /* @__PURE__ */ p("div", { class: "ble-properties", children: [
    /* @__PURE__ */ p("div", { class: "ble-selection-title", children: i.label }),
    [...r].map(([s, o]) => /* @__PURE__ */ p("section", { class: "ble-property-section", children: [
      /* @__PURE__ */ p("h3", { children: [
        s,
        s === "Playback" && o.some((c) => c.path === "isPlaying" && c.value === true) && /* @__PURE__ */ p("span", { class: "ble-playing-status", children: "Playing" })
      ] }),
      o.map((c) => /* @__PURE__ */ p("div", { class: "ble-property-row", children: [
        /* @__PURE__ */ p("label", { title: c.path, children: c.label }),
        /* @__PURE__ */ p("div", { class: "ble-property-control", children: /* @__PURE__ */ p(yr, { descriptor: c }) }),
        /* @__PURE__ */ p("button", { class: "ble-copy-value", type: "button", title: "Copy property value", "aria-label": `Copy ${c.label} value`, onClick: async () => {
          try {
            await navigator.clipboard.writeText(kr(c)), e.push(`Copied ${c.label} value`, "info");
          } catch {
            e.push("Could not copy the property value.");
          }
        }, children: "\u29C9" })
      ] }, c.path))
    ] }, s))
  ] });
}
var Pe = 25;
var vn = 8;
function wr(t) {
  return t.kind !== "animationGroup" || !t.source || typeof t.source != "object" ? false : "isPlaying" in t.source && t.source.isPlaying === true;
}
function xr(t, e, n) {
  const i = [], r = (s, o, c) => {
    s.forEach((b, d) => {
      var v;
      i.push({ entity: b, level: o, parentId: c, position: d + 1, setSize: s.length }), (v = b.children) != null && v.length && (n || e.has(b.id)) && r(b.children, o + 1, b.id);
    });
  };
  return r(t, 0, null), i;
}
function Pr() {
  const { signals: t, refresh: e, commands: n, notifications: i } = ve(), r = Gt(null), [s, o] = Ie(0), [c, b] = Ie(400), d = t.search.value.trim().length > 0, v = kt(
    () => xr(t.filteredTree.value, t.expandedIds.value, d),
    [t.filteredTree.value, t.expandedIds.value, d]
  );
  We(() => {
    const M = r.current;
    if (!M) return;
    const P = () => b(M.clientHeight || 400);
    if (P(), typeof ResizeObserver > "u") return;
    const E = new ResizeObserver(P);
    return E.observe(M), () => E.disconnect();
  }, []);
  const m = Math.max(0, Math.floor(s / Pe) - vn), x = Math.min(v.length, Math.ceil((s + c) / Pe) + vn);
  We(() => {
    const M = t.selectedEntityId.value, P = r.current;
    if (!M || !P) return;
    const E = v.findIndex((Y) => Y.entity.id === M);
    if (E < 0) return;
    const $ = E * Pe;
    ($ < P.scrollTop || $ + Pe > P.scrollTop + c) && (P.scrollTop = Math.max(0, $ - Math.floor(c / 2)), o(P.scrollTop));
  }, [v, t.selectedEntityId.value, c]);
  const g = (M) => {
    const P = new Set(t.expandedIds.value);
    P.has(M) ? P.delete(M) : P.add(M), t.expandedIds.value = P;
  }, L = (M) => {
    const P = Math.max(0, Math.min(v.length - 1, M)), E = r.current;
    if (!E || P < 0) return;
    const $ = P * Pe;
    $ < E.scrollTop ? E.scrollTop = $ : $ + Pe > E.scrollTop + c && (E.scrollTop = $ - c + Pe), requestAnimationFrame(() => {
      var Y;
      return (Y = E.querySelector(`[data-tree-index="${P}"]`)) == null ? void 0 : Y.focus();
    });
  }, J = async (M, P) => {
    const E = t.context.value, $ = n.get(M);
    if (!(!E || !$))
      try {
        await $.run(P, E);
      } catch (Y) {
        i.push(Y instanceof Error ? Y.message : `Command failed: ${$.label}`);
      }
  };
  return /* @__PURE__ */ p("div", { class: "ble-explorer", children: [
    /* @__PURE__ */ p("label", { class: "ble-search", children: [
      /* @__PURE__ */ p("span", { class: "ble-sr-only", children: "Search scene" }),
      /* @__PURE__ */ p("input", { value: t.search.value, onInput: (M) => {
        t.search.value = M.currentTarget.value, o(0), r.current && (r.current.scrollTop = 0);
      }, placeholder: "Search scene\u2026" })
    ] }),
    v.length ? /* @__PURE__ */ p("div", { class: "ble-tree-scroll", role: "tree", "aria-label": "Scene entities", ref: r, onScroll: (M) => o(M.currentTarget.scrollTop), children: /* @__PURE__ */ p("div", { class: "ble-tree-virtual", style: { height: `${v.length * Pe}px` }, children: v.slice(m, x).map((M, P) => {
      var u;
      const E = m + P, { entity: $ } = M, Y = d || t.expandedIds.value.has($.id), pe = t.selectedEntityId.value === $.id, ne = !!((u = $.children) != null && u.length), ie = wr($), y = n.list($).filter((a) => a.rowAction).sort((a, w) => {
        var N, W;
        return +(((N = a.rowAction) == null ? void 0 : N.tone) === "danger") - +(((W = w.rowAction) == null ? void 0 : W.tone) === "danger");
      });
      return /* @__PURE__ */ p(
        "div",
        {
          class: `ble-tree-row${pe ? " is-selected" : ""}`,
          role: "treeitem",
          "aria-level": M.level + 1,
          "aria-posinset": M.position,
          "aria-setsize": M.setSize,
          "aria-expanded": ne ? Y : void 0,
          "aria-selected": pe,
          style: { top: `${E * Pe}px`, paddingLeft: `${M.level * 14 + 4}px` },
          children: [
            /* @__PURE__ */ p("button", { class: "ble-tree-toggle", type: "button", "aria-label": Y ? "Collapse" : "Expand", disabled: !ne || d, onClick: () => g($.id), children: ne ? Y ? "\u25BE" : "\u25B8" : "" }),
            /* @__PURE__ */ p(
              "button",
              {
                class: "ble-tree-label",
                "data-tree-index": E,
                type: "button",
                onClick: () => void e.select($.id),
                onDblClick: () => {
                  !d && ne && g($.id);
                },
                onKeyDown: (a) => {
                  a.key === "ArrowDown" && (a.preventDefault(), L(E + 1)), a.key === "ArrowUp" && (a.preventDefault(), L(E - 1)), a.key === "ArrowRight" && ne && !Y && !d && (a.preventDefault(), g($.id)), a.key === "ArrowLeft" && (ne && Y && !d ? (a.preventDefault(), g($.id)) : M.parentId && (a.preventDefault(), L(v.findIndex((w) => w.entity.id === M.parentId))));
                },
                children: [
                  /* @__PURE__ */ p("span", { class: `ble-kind ble-kind-${$.kind}${ie ? " is-playing" : ""}`, "aria-hidden": "true" }),
                  $.label
                ]
              }
            ),
            y.map((a) => {
              var w, N, W, X;
              return /* @__PURE__ */ p(
                "button",
                {
                  class: `ble-tree-action${((w = a.rowAction) == null ? void 0 : w.tone) === "danger" ? " is-danger" : ""}`,
                  type: "button",
                  title: `${((N = a.rowAction) == null ? void 0 : N.label) ?? a.label} ${$.label}`,
                  "aria-label": `${((W = a.rowAction) == null ? void 0 : W.label) ?? a.label} ${$.label}`,
                  onClick: () => void J(a.id, $),
                  children: (X = a.rowAction) == null ? void 0 : X.icon
                },
                a.id
              );
            })
          ]
        },
        $.id
      );
    }) }) }) : /* @__PURE__ */ p("div", { class: "ble-empty", children: "No entities are exposed by the supported public API. Use explicit registration for application-owned entities." })
  ] });
}
async function Tr(t, e, n, i = Tn, r = Cn) {
  r(n, await i(e, t));
}
async function Cr(t, e, n, i = (/* @__PURE__ */ new Date()).toISOString()) {
  const r = async (s) => {
    var d;
    const o = await e.getProperties(s, n), c = { label: s.label, kind: s.kind }, b = Object.fromEntries(o.filter((v) => !v.path.startsWith("$")).map((v) => [v.path, v.value]));
    return Object.keys(b).length && (c.properties = b), (d = s.children) != null && d.length && (c.children = await Promise.all(s.children.map(r))), c;
  };
  return {
    format: "babylon-lite-explorer-public-scene-snapshot",
    version: 1,
    exportedAt: i,
    entities: await Promise.all(t.map(r))
  };
}
function Er() {
  const { signals: t, refresh: e, notifications: n } = ve(), i = Gt(null), [r, s] = Ie(null), o = async (b) => {
    var v, m;
    const d = t.context.value;
    if (d) {
      s("upload");
      try {
        await Tr(
          b,
          d.engine,
          d.scene,
          ((v = d.lite) == null ? void 0 : v.loadGltf) ?? Tn,
          ((m = d.lite) == null ? void 0 : m.addToScene) ?? Cn
        ), await e.refreshTree(), n.push(`Loaded ${b.name}`, "info");
      } catch (x) {
        n.push(x instanceof Error ? x.message : "Could not load the GLB file.");
      } finally {
        s(null), i.current && (i.current.value = "");
      }
    }
  }, c = async () => {
    s("export");
    try {
      const b = t.context.value, d = t.adapter.value;
      if (!b || !d) throw new Error("Explorer scene context is unavailable.");
      const v = await Cr(t.tree.value, d, b), m = new Blob([JSON.stringify(v, null, 2)], { type: "application/json" }), x = URL.createObjectURL(m), g = document.createElement("a");
      g.href = x, g.download = "babylon-lite-scene.json", g.click(), URL.revokeObjectURL(x), n.push("Exported the public scene snapshot", "info");
    } catch (b) {
      n.push(b instanceof Error ? b.message : "Could not export the scene snapshot.");
    } finally {
      s(null);
    }
  };
  return /* @__PURE__ */ p("div", { class: "ble-tools", children: /* @__PURE__ */ p("section", { children: [
    /* @__PURE__ */ p("h3", { children: "Scene files" }),
    /* @__PURE__ */ p("button", { type: "button", disabled: r !== null, onClick: () => {
      var b;
      return (b = i.current) == null ? void 0 : b.click();
    }, children: r === "upload" ? "Uploading\u2026" : "Upload GLB" }),
    /* @__PURE__ */ p("input", { ref: i, type: "file", accept: ".glb,model/gltf-binary", hidden: true, onChange: (b) => {
      var v;
      const d = (v = b.currentTarget.files) == null ? void 0 : v[0];
      d && o(d);
    } }),
    /* @__PURE__ */ p("button", { type: "button", disabled: r !== null, onClick: () => void c(), children: r === "export" ? "Exporting\u2026" : "Export Scene" }),
    /* @__PURE__ */ p("p", { children: "Export Scene downloads a JSON snapshot of public values visible to the Explorer. Babylon Lite does not currently expose public GLB scene serialization." })
  ] }) });
}
function qr(t, e = {}) {
  var fe, C, l, h, _, k, T, j, H, le, te, ce, be, D, I, O, V, B, oe;
  if (typeof document > "u") throw new Error("Babylon Lite Explorer requires a DOM environment.");
  const n = e.canvas ?? t.canvas, i = e.container ?? (n == null ? void 0 : n.parentElement) ?? document.body, r = (f) => {
    try {
      return localStorage.getItem(f);
    } catch {
      return null;
    }
  }, s = e.mode ?? "overlay", o = r("ble.layout"), c = r("ble.theme"), b = ((C = (fe = e.userSettings) == null ? void 0 : fe.ui) == null ? void 0 : C.layout) ?? e.layout ?? (o === "split" ? "split" : "single"), d = ((h = (l = e.userSettings) == null ? void 0 : l.ui) == null ? void 0 : h.theme) ?? e.theme ?? (c === "light" ? "light" : "dark"), v = document.createElement("div");
  v.className = `ble-root ble-${s}`, v.dataset.theme = d, v.dataset.layout = b, v.hidden = e.initiallyOpen === false, i.appendChild(v);
  let m;
  const x = s === "overlay" && i !== document.body ? getComputedStyle(i).position : "";
  s === "overlay" && i !== document.body && (!x || x === "static") && (m = i.style.position, i.style.position = "relative");
  const g = rr();
  g.context.value = { ...t, canvas: n };
  const L = e.adapter ?? Wi(), J = e.adapters ?? [], M = J.length ? Ci([L, ...J]) : L;
  g.adapter.value = M, g.theme.value = d, g.layout.value = b, g.userSettings.value = {
    confirmEntityRemoval: ((k = (_ = e.userSettings) == null ? void 0 : _.deletion) == null ? void 0 : k.confirmEntityRemoval) ?? e.confirmEntityRemoval ?? false,
    instancerPickMode: ((j = (T = e.userSettings) == null ? void 0 : T.instancer) == null ? void 0 : j.pickMode) ?? "instance",
    keyboardShortcutsEnabled: ((le = (H = e.userSettings) == null ? void 0 : H.ui) == null ? void 0 : le.keyboardShortcutsEnabled) ?? e.keyboardShortcutsEnabled ?? true,
    notificationsEnabled: ((ce = (te = e.userSettings) == null ? void 0 : te.ui) == null ? void 0 : ce.notificationsEnabled) ?? e.notificationsEnabled ?? true,
    notificationDurationMs: Math.max(0, ((D = (be = e.userSettings) == null ? void 0 : be.ui) == null ? void 0 : D.notificationDurationMs) ?? e.notificationDurationMs ?? 3e3)
  };
  try {
    const f = Number(localStorage.getItem("ble.singlePanePercent"));
    f >= 25 && f <= 75 && (g.singlePanePercent.value = f);
  } catch {
  }
  g.isOpen.value = e.initiallyOpen ?? true;
  const P = new or(
    g,
    g.userSettings.value.notificationDurationMs,
    g.userSettings.value.notificationsEnabled
  ), E = ((I = e.features) == null ? void 0 : I.focusSelected) === true, $ = new lr(g, P), Y = new cr(g), pe = new ur(g), ne = ((O = e.features) == null ? void 0 : O.canvasPicking) === true && n ? new ar(n, g, $, P, Y) : void 0;
  g.pickingAvailable.value = !!ne;
  const ie = new sr(), y = new Bi();
  y.add(Y.addSidePane({ key: "scene-explorer", title: "Scene Explorer", side: "left", order: 10, content: Pr, keepMounted: true })), y.add(Y.addSidePane({ key: "properties", title: "Properties", side: "right", order: 10, content: Sr, keepMounted: true })), y.add(Y.addSidePane({ key: "tools", title: "Tools", side: "right", order: 20, content: Er })), y.add(ie.register({ id: "refresh", label: "Refresh", run: () => $.refreshTree() })), y.add(ie.register({ id: "clear-selection", label: "Clear selection", when: (f) => !!f, run: () => $.select(null) })), y.add(ie.register({
    id: "copy-entity-snapshot",
    label: "Copy entity snapshot",
    when: (f) => !!(f != null && f.capabilities.serializableSnapshot),
    run: async (f, F) => {
      const G = g.adapter.value;
      if (!f || !(G != null && G.getEntitySnapshot)) return;
      const z = await G.getEntitySnapshot(f, F);
      if (!z.ok) {
        P.push(z.message);
        return;
      }
      try {
        await navigator.clipboard.writeText(JSON.stringify(z.value, null, 2));
      } catch {
        P.push("Could not write the entity snapshot to the clipboard.");
      }
    }
  })), y.add(ie.register({
    id: "toggle-visible",
    label: "Toggle visible",
    when: (f) => !!(f != null && f.capabilities.visibilityToggle),
    run: async (f, F) => {
      const G = g.adapter.value;
      if (!f || !(G != null && G.setEntityVisible)) return;
      const z = g.properties.value.find((he) => he.path === "visible"), ye = await G.setEntityVisible(f, !((z == null ? void 0 : z.kind) === "boolean" && z.value), F);
      ye.ok ? await $.refreshTree() : P.push(ye.message);
    }
  })), y.add(ie.register({
    id: "remove-entity",
    label: "Delete",
    when: (f) => !!(f != null && f.capabilities.removable),
    rowAction: { label: "Delete", icon: "x", tone: "danger" },
    run: async (f, F) => {
      const G = g.adapter.value;
      if (!f || !(G != null && G.removeEntity)) return;
      const ye = f.kind === "camera" && F.scene && typeof F.scene == "object" && "camera" in F.scene && F.scene.camera === f.source ? `Delete active camera "${f.label}"?` : `Delete "${f.label}" from the scene?`;
      if (g.userSettings.value.confirmEntityRemoval && !window.confirm(ye)) return;
      const he = await G.removeEntity(f, F);
      if (!he.ok) {
        P.push(he.message);
        return;
      }
      g.selectedEntityId.value === f.id && await $.select(null), await $.refreshTree(), P.push(`Deleted ${f.label}`, "info");
    }
  })), y.add(ie.register({
    id: "focus-selected",
    label: "Focus selected",
    when: (f) => E && !!(f != null && f.capabilities.focusable),
    run: async (f, F) => {
      const G = g.adapter.value;
      if (!f || !(G != null && G.focusEntity)) return;
      const z = await G.focusEntity(f, F);
      z.ok || P.push(z.message);
    }
  })), y.add(ie.register({
    id: "play-animation",
    label: "Play animation",
    when: (f) => !!(f != null && f.capabilities.animationPlayback),
    run: async (f, F) => {
      const G = g.adapter.value;
      if (!f || !(G != null && G.playAnimationGroup)) return;
      const z = await G.playAnimationGroup(f, F);
      z.ok ? await $.refreshProperties() : P.push(z.message);
    }
  })), y.add(ie.register({
    id: "stop-animation",
    label: "Stop animation",
    when: (f) => !!(f != null && f.capabilities.animationPlayback),
    run: async (f, F) => {
      const G = g.adapter.value;
      if (!f || !(G != null && G.stopAnimationGroup)) return;
      const z = await G.stopAnimationGroup(f, F);
      z.ok ? await $.refreshTree() : P.push(z.message);
    }
  }));
  const u = {
    openPanel: (f) => Y.selectPane(f),
    notify: (f, F = "error") => P.push(f, F),
    refresh: () => $.refreshTree()
  }, a = (f) => y.add(Y.addSidePane({
    ...f,
    side: f.side ?? "right"
  })), w = (f) => y.add(ie.register({
    ...f,
    run: (F, G) => f.run(F, G, u)
  })), N = (f) => {
    for (const F of (f == null ? void 0 : f.panes) ?? []) a(F);
    for (const F of (f == null ? void 0 : f.commands) ?? []) w(F);
  };
  for (const f of e.panes ?? []) a(f);
  for (const f of e.commands ?? []) w(f);
  for (const f of [L, ...J]) N((V = f.getExplorerExtensions) == null ? void 0 : V.call(f, u));
  let W = false;
  const X = {
    signals: g,
    refresh: $,
    notifications: P,
    commands: ie,
    shell: Y,
    userGuideUrl: e.userGuideUrl ?? "https://github.com/eldinor/babylon-lite-explorer/blob/main/docs/user-guide.md",
    setLayout(f) {
      g.layout.value = f, v.dataset.layout = f;
      try {
        localStorage.setItem("ble.layout", f);
      } catch {
      }
    },
    setTheme(f) {
      g.theme.value = f, v.dataset.theme = f;
      try {
        localStorage.setItem("ble.theme", f);
      } catch {
      }
    },
    setPickingActive(f) {
      ne && (f ? ne.start() : ne.stop(), g.pickingActive.value = f);
    },
    setConfirmEntityRemoval(f) {
      g.userSettings.value = { ...g.userSettings.value, confirmEntityRemoval: f };
    },
    setInstancerPickMode(f) {
      g.userSettings.value = { ...g.userSettings.value, instancerPickMode: f };
    },
    hide: () => R.hide(),
    dispose: () => R.dispose()
  }, S = "Babylon Lite 1.17.0 Explorer 0.6.0", U = () => Zt(Fn(br, { runtime: X, title: e.title ?? S }), v);
  U(), pe.start();
  const R = {
    ready: (async () => {
      var F, G;
      const f = await ((G = (F = g.adapter.value) == null ? void 0 : F.refresh) == null ? void 0 : G.call(F, g.context.value));
      if (f && !f.ok && P.push(f.message), await $.refreshTree(), !g.expandedIds.value.size) {
        const z = /* @__PURE__ */ new Set();
        for (const ye of g.tree.value) {
          z.add(ye.id);
          for (const he of ye.children ?? []) z.add(he.id);
        }
        g.expandedIds.value = z;
      }
    })().catch((f) => {
      throw P.push(f instanceof Error ? f.message : "Explorer startup failed."), f;
    }),
    get state() {
      return W ? "disposed" : g.isOpen.value ? "visible" : "hidden";
    },
    get isDisposed() {
      return W;
    },
    dispose() {
      var f, F, G, z;
      W || (W = true, $.dispose(), ne == null || ne.dispose(), g.pickingActive.value = false, pe.dispose(), P.dispose(), y.dispose(), ie.dispose(), J.length && ((F = (f = g.adapter.value) == null ? void 0 : f.dispose) == null || F.call(f)), e.adapter || (G = L.dispose) == null || G.call(L), Zt(null, v), v.remove(), m !== void 0 && (i.style.position = m), (z = e.onDispose) == null || z.call(e));
    },
    show() {
      W || (g.isOpen.value = true, v.hidden = false, U());
    },
    hide() {
      W || (X.setPickingActive(false), g.isOpen.value = false, v.hidden = true, U());
    },
    toggle() {
      g.isOpen.value ? R.hide() : R.show();
    },
    refresh() {
      return W ? Promise.resolve() : $.refreshTree();
    }
  }, K = (f) => {
    var F;
    if (!f.ctrlKey || !f.shiftKey) {
      f.key === "Escape" && v.contains(document.activeElement) && !(f.target instanceof HTMLInputElement) && $.select(null);
      return;
    }
    f.code === "KeyL" && (f.preventDefault(), X.setLayout(g.layout.value === "single" ? "split" : "single")), f.code === "KeyY" && (f.preventDefault(), X.setTheme(g.theme.value === "dark" ? "light" : "dark")), f.code === "KeyE" && (f.preventDefault(), R.toggle()), f.code === "KeyF" && g.isOpen.value && (f.preventDefault(), (F = v.querySelector(".ble-search input")) == null || F.focus());
  };
  return g.userSettings.value.keyboardShortcutsEnabled && (window.addEventListener("keydown", K), y.add(dt(() => window.removeEventListener("keydown", K)))), ((oe = (B = e.userSettings) == null ? void 0 : B.picking) == null ? void 0 : oe.enabled) === true && X.setPickingActive(true), R;
}
function Mr(t) {
  return {
    distance: t.distance,
    pickedPoint: t.pickedPoint,
    pickedNormal: t.pickedNormal,
    pickedNormalWorld: t.pickedNormalWorld,
    pickedFaceNormal: t.pickedFaceNormal,
    pickedFaceNormalWorld: t.pickedFaceNormalWorld,
    faceId: t.faceId,
    subMeshId: t.subMeshId,
    bu: t.bu,
    bv: t.bv,
    thinInstanceIndex: t.thinInstanceIndex
  };
}
var it = { editable: false, focusable: false, visibilityToggle: false, serializableSnapshot: true };
var Ir = { editable: true, focusable: false, visibilityToggle: true, serializableSnapshot: true };
function ge(t) {
  return !!t && typeof t == "object";
}
function qe(t, e) {
  return ge(t) && typeof t[e] == "function";
}
function $r(t) {
  return ge(t) && typeof t.name == "string" && t.name.trim() ? t.name : void 0;
}
function Ar(t) {
  return "clips" in t && "set" in t ? "vat" : "root" in t && "pool" in t ? "hierarchy" : "mesh" in t ? "thin" : "custom";
}
function Nr(t) {
  return ge(t) && ge(t.primary) && Array.isArray(t.secondaryParts) && "root" in t && qe(t, "getPlaybackSample");
}
function Fr(t) {
  return qe(t, "has") && qe(t, "getSlot") && qe(t, "getIdForSlot") && qe(t, "entries");
}
function Lr(t) {
  return !ge(t) || !ge(t.pool) || !Array.isArray(t.pool.meshes) ? [] : t.pool.meshes;
}
function _n(t) {
  let e = 1 / 0, n = 1 / 0, i = 1 / 0, r = -1 / 0, s = -1 / 0, o = -1 / 0;
  for (const c of t) {
    if (!ge(c) || !Array.isArray(c.boundMin) || !Array.isArray(c.boundMax)) continue;
    const [b, d, v] = c.boundMin.map(Number), [m, x, g] = c.boundMax.map(Number);
    [b, d, v, m, x, g].every(Number.isFinite) && (e = Math.min(e, b), n = Math.min(n, d), i = Math.min(i, v), r = Math.max(r, m), s = Math.max(s, x), o = Math.max(o, g));
  }
  return Number.isFinite(e) ? [(e + r) * 0.5, (n + s) * 0.5, (i + o) * 0.5] : [0, 0, 0];
}
function Dr(t, e) {
  return e === "hierarchy" && "root" in t ? t.root : "mesh" in t ? t.mesh : t;
}
function Ur(t, e) {
  if (ge(e))
    for (const n of ["name", "label", "title"]) {
      const i = e[n];
      if (typeof i == "string" && i.trim()) return i;
    }
  return `Instance ${t}`;
}
function Rr(t) {
  if (t === void 0) return "";
  try {
    return JSON.stringify(t);
  } catch {
    return String(t);
  }
}
function ze(t) {
  return ge(t) && "record" in t && "id" in t && typeof t.id == "number";
}
function kn(t) {
  return ge(t) && "record" in t && "clip" in t && typeof t.clip == "string";
}
function De(t) {
  return ge(t.writeSet.clips) ? t.writeSet.clips : {};
}
function $e(t) {
  if (!(!t || t.length < 3))
    return [Number(t[0]), Number(t[1]), Number(t[2])];
}
function Sn(t) {
  if (!(!t || t.length < 4))
    return [Number(t[0]), Number(t[1]), Number(t[2]), Number(t[3])];
}
function Ue(t, e) {
  if (!ge(t)) return;
  const n = t[e];
  if (!ge(n)) return;
  const i = Number(n.x), r = Number(n.y), s = Number(n.z);
  return [i, r, s].every(Number.isFinite) ? [i, r, s] : void 0;
}
function ii(t) {
  if (!t || t.length < 16) return;
  const e = Array.from(t, Number).slice(0, 16);
  return e.every(Number.isFinite) ? e : void 0;
}
function Ye(t) {
  const e = ii(t);
  if (!e) return;
  const n = (g) => Math.abs(g) < 1e-12 ? 0 : g, i = Math.hypot(e[0], e[1], e[2]), r = Math.hypot(e[4], e[5], e[6]), s = Math.hypot(e[8], e[9], e[10]);
  if (!i || !r || !s) return { rotationEuler: [0, 0, 0], scale: [i, r, s] };
  const o = e[0] / i, c = e[1] / i, b = e[2] / i, d = e[6] / r, v = e[10] / s, m = Math.hypot(o, c);
  return { rotationEuler: (m > 1e-6 ? [Math.atan2(d, v), Math.atan2(-b, m), Math.atan2(c, o)] : [Math.atan2(-e[9] / s, e[5] / r), Math.atan2(-b, m), 0]).map(n), scale: [i, r, s] };
}
function Tt(t) {
  return Array.isArray(t) && t.length === 3 && t.every((e) => typeof e == "number" && Number.isFinite(e));
}
function Vr(t) {
  return Array.isArray(t) && t.length === 4 && t.every((e) => typeof e == "number" && Number.isFinite(e));
}
function Or(t) {
  if (Nr(t)) {
    const s = t.primary, o = [t.primary.mesh, ...t.secondaryParts.map((c) => c.mesh)];
    return {
      kind: "vat-character",
      source: t.root,
      set: s,
      writeSet: t,
      pickSources: o,
      pickCenter: _n(o),
      official: true
    };
  }
  const e = t, n = Ar(e), i = Dr(e, n), r = n === "hierarchy" ? Lr(e) : e.mesh ? [e.mesh] : [];
  return {
    kind: n,
    source: i,
    set: e,
    writeSet: e,
    ...n === "vat" || n === "thin" ? { colorSet: e } : {},
    pickSources: r,
    pickCenter: _n(r),
    official: Fr(e)
  };
}
function Gr(t, e, n, i) {
  const [r, s, o] = t, c = Number(e[0] ?? 0) * r + Number(e[4] ?? 0) * s + Number(e[8] ?? 0) * o + Number(e[12] ?? 0), b = Number(e[1] ?? 0) * r + Number(e[5] ?? 0) * s + Number(e[9] ?? 0) * o + Number(e[13] ?? 0), d = Number(e[3] ?? 0) * r + Number(e[7] ?? 0) * s + Number(e[11] ?? 0) * o + Number(e[15] ?? 0);
  if (Math.abs(d) < 1e-6) return;
  const v = c / d, m = b / d;
  if (!(v < -1.1 || v > 1.1 || m < -1.1 || m > 1.1))
    return { x: (v + 1) * 0.5 * n, y: (1 - m) * 0.5 * i };
}
function Wr(t, e) {
  const [n, i, r] = e;
  return [
    Number(t[0] ?? 0) * n + Number(t[4] ?? 0) * i + Number(t[8] ?? 0) * r + Number(t[12] ?? 0),
    Number(t[1] ?? 0) * n + Number(t[5] ?? 0) * i + Number(t[9] ?? 0) * r + Number(t[13] ?? 0),
    Number(t[2] ?? 0) * n + Number(t[6] ?? 0) * i + Number(t[10] ?? 0) * r + Number(t[14] ?? 0)
  ];
}
function Kr() {
  const t = [], e = /* @__PURE__ */ new WeakMap(), n = /* @__PURE__ */ new WeakMap(), i = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new WeakMap(), s = Q(0), o = Q(/* @__PURE__ */ new Set()), c = Q(null);
  let b = 1;
  const d = () => {
    s.value += 1;
  }, v = (l) => {
    if (!ge(l)) return String(l);
    let h = n.get(l);
    return h || (h = b++, n.set(l, h)), String(h);
  }, m = (l) => `instancer:source:${v(l)}`, x = (l) => `instancer:set:${l.id}`, g = (l, h) => `instancer:set:${l.id}:instance:${h}`, L = (l) => `instancer:set:${l.id}:animations`, J = (l, h) => `${L(l)}:${encodeURIComponent(h)}`, M = (l, h) => {
    var _, k;
    return ((k = (_ = l.set).getMetadata) == null ? void 0 : k.call(_, h.id)) ?? h.metadata;
  }, P = (l, h) => {
    var _, k;
    if (l.official && l.set.has && l.set.getSlot) {
      if (!l.set.has(h)) return;
      const T = l.set.getSlot(h);
      return T === void 0 ? void 0 : { id: h, slot: T, metadata: (k = (_ = l.set).getMetadata) == null ? void 0 : k.call(_, h) };
    }
    return [...l.set.entries()].find((T) => T.id === h);
  }, E = (l, h) => {
    if (l.official && l.set.getIdForSlot) {
      const _ = l.set.getIdForSlot(h);
      return _ === void 0 ? void 0 : P(l, _);
    }
    return [...l.set.entries()].find((_) => _.slot === h);
  }, $ = (l, h) => {
    var _, k, T, j;
    return ((k = (_ = l.set).getMatrixOrUndefined) == null ? void 0 : k.call(_, h)) ?? ((j = (T = l.set).getMatrix) == null ? void 0 : j.call(T, h));
  }, Y = (l, h) => {
    var _, k, T, j;
    return ((k = (_ = l.writeSet).getVisibleOrUndefined) == null ? void 0 : k.call(_, h)) ?? ((j = (T = l.writeSet).getVisible) == null ? void 0 : j.call(T, h));
  }, pe = (l, h) => {
    var _, k, T, j, H;
    return ((k = (_ = l.writeSet).getClip) == null ? void 0 : k.call(_, h)) ?? ((H = (j = (T = l.writeSet).getPlaybackSample) == null ? void 0 : j.call(T, h)) == null ? void 0 : H.clip);
  }, ne = (l, h, _) => l.writeSet.trySetTransform ? l.writeSet.trySetTransform(h, _) : l.writeSet.setTransform ? (l.writeSet.setTransform(h, _), true) : false, ie = (l, h) => {
    var k;
    const _ = M(l, h);
    return ((k = l.getLabel) == null ? void 0 : k.call(l, h.id, _, h.slot)) ?? Ur(h.id, _);
  }, y = (l) => t.filter((h) => l && h.source === l.source), u = (l) => t.find((h) => x(h) === l.id), a = (l) => ({
    label: l.sourceLabel,
    ...Ue(l.source, "position") ? { position: Ue(l.source, "position") } : {},
    ...Ue(l.source, "rotation") ? { rotation: Ue(l.source, "rotation") } : {},
    ...Ue(l.source, "scaling") ? { scaling: Ue(l.source, "scaling") } : {}
  }), w = (l) => ({
    id: l.id,
    label: l.label,
    kind: l.kind,
    sourceLabel: l.sourceLabel,
    source: a(l),
    count: l.set.count,
    visibleCount: l.set.visibleCount,
    capacity: l.set.capacity,
    instances: [...l.set.entries()].sort((h, _) => h.id - _.id).map((h) => {
      var ce, be, D, I, O;
      const _ = M(l, h), k = $e((be = (ce = l.set).getPosition) == null ? void 0 : be.call(ce, h.id)), T = ii($(l, h.id)), j = Ye(T), H = l.transformCache.get(h.id), le = Sn((I = (D = l.colorSet) == null ? void 0 : D.getColor) == null ? void 0 : I.call(D, h.id)), te = pe(l, h.id);
      return {
        id: h.id,
        slot: h.slot,
        label: ie(l, h),
        visible: Y(l, h.id),
        ...k ? { position: k } : {},
        ...j || H ? {
          ...(H == null ? void 0 : H.rotationEuler) ?? (j == null ? void 0 : j.rotationEuler) ? { rotationEuler: (H == null ? void 0 : H.rotationEuler) ?? j.rotationEuler } : {},
          ...(H == null ? void 0 : H.scale) ?? (j == null ? void 0 : j.scale) ? { scale: (H == null ? void 0 : H.scale) ?? j.scale } : {}
        } : {},
        ...le ? { color: le } : {},
        ...te ? { clip: te } : {},
        ...T ? { matrix: T } : {},
        metadata: ((O = l.serializeMetadata) == null ? void 0 : O.call(l, _, h.id)) ?? _
      };
    })
  }), N = (l) => l.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "instancer-set", W = (l) => `${N(l).replace(/-([a-z0-9])/g, (h, _) => _.toUpperCase()) || "instancerSet"}Placements`, X = (l) => JSON.stringify(l, null, 2), S = (l) => {
    const h = W(l.label), _ = l.instances.map((T) => ({
      id: T.id,
      transform: {
        ...T.position ? { position: T.position } : {},
        ...T.rotationEuler ? { rotationEuler: T.rotationEuler } : {},
        ...T.scale ? { scale: T.scale } : {}
      },
      ...T.color ? { color: T.color } : {},
      ...T.visible !== void 0 ? { visible: T.visible } : {},
      ...T.clip ? { clip: T.clip } : {},
      ...T.metadata !== void 0 ? { metadata: T.metadata } : {}
    })), k = l.kind === "vat" || l.kind === "vat-character" ? "instancerSet.create({ transform: placement.transform, metadata: placement.metadata, ...(placement.clip ? { clip: placement.clip } : {}) })" : "instancerSet.create(placement.transform, placement.metadata)";
    return `const ${h} = ${JSON.stringify(_, null, 2)};

const restoredIds = new Map<number, number>();

for (const placement of ${h}) {
  const id = ${k};
  restoredIds.set(placement.id, id);
  if (placement.color) instancerSet.setColor?.(id, placement.color);
  if (placement.visible !== undefined) instancerSet.setVisible(id, placement.visible);
}
`;
  }, U = (l, h) => {
    var _;
    if (!P(l, h.id)) return false;
    if (l.writeSet.setTransform && (h.position || h.rotationEuler || h.scale)) {
      const k = {
        ...h.position ? { position: h.position } : {},
        ...h.rotationEuler ? { rotationEuler: h.rotationEuler } : {},
        ...h.scale ? { scale: h.scale } : {}
      };
      if (l.writeSet.trySetTransform) {
        if (!l.writeSet.trySetTransform(h.id, k)) return false;
      } else
        l.writeSet.setTransform(h.id, k);
    } else
      h.position && l.writeSet.setPosition && l.writeSet.setPosition(h.id, h.position), h.scale && l.writeSet.setScale && l.writeSet.setScale(h.id, h.scale);
    return h.visible !== void 0 && l.writeSet.setVisible && (l.writeSet.trySetVisible ? l.writeSet.trySetVisible(h.id, h.visible) : l.writeSet.setVisible(h.id, h.visible)), h.color && ((_ = l.colorSet) != null && _.setColor) && l.colorSet.setColor(h.id, h.color), l.transformCache.delete(h.id), true;
  }, ee = (l, h) => {
    var k;
    const _ = (k = l.baseline) == null ? void 0 : k.instances.find((T) => T.id === h);
    return _ ? U(l, _) : false;
  }, R = (l) => {
    var _;
    let h = 0;
    for (const k of ((_ = l.baseline) == null ? void 0 : _.instances) ?? [])
      U(l, k) && h++;
    return h;
  }, K = () => [...new Map(t.map((h) => [h.source, t.filter((_) => _.source === h.source)]))].map(([h, _]) => ({
    id: m(h),
    label: _[0].sourceLabel,
    kind: "mesh",
    source: h,
    capabilities: it,
    meta: { instancer: "source" },
    children: _.map((k) => {
      const T = [...k.set.entries()].sort((H, le) => H.id - le.id).map((H) => ({
        id: g(k, H.id),
        label: ie(k, H),
        kind: "unknown",
        source: { record: k, id: H.id },
        parentId: x(k),
        capabilities: Ir,
        meta: { instancer: "instance" }
      })), j = Object.keys(De(k));
      return j.length && T.push({
        id: L(k),
        label: "Animations",
        kind: "unknown",
        source: k,
        parentId: x(k),
        capabilities: it,
        meta: { instancer: "animations" },
        children: j.map((H) => ({
          id: J(k, H),
          label: H,
          kind: "animationGroup",
          source: { record: k, clip: H },
          parentId: L(k),
          capabilities: it,
          meta: { instancer: "animation" }
        }))
      }), {
        id: x(k),
        label: k.label,
        kind: "unknown",
        source: k,
        parentId: m(h),
        capabilities: it,
        meta: { instancer: "set" },
        children: T
      };
    })
  })), fe = (l) => {
    const h = y(l);
    h.length && (o.value = /* @__PURE__ */ new Set([m(h[0].source), ...h.map(x)]), d());
  }, C = () => {
    const { signals: l, refresh: h, notifications: _ } = ve();
    s.value;
    const k = l.selectedEntityId.value, T = K(), j = c.value ? t.find((I) => I.id === c.value) : void 0, H = async (I, O) => {
      try {
        await navigator.clipboard.writeText(I), _.push(O, "info");
      } catch {
        _.push("Could not write to the clipboard.");
      }
    }, le = (I) => {
      const O = w(I), V = new Blob([X(O)], { type: "application/json" }), B = URL.createObjectURL(V), oe = document.createElement("a");
      oe.href = B, oe.download = `${N(I.label)}.instances.json`, oe.click(), URL.revokeObjectURL(B), _.push(`Downloaded ${I.label} JSON`, "info");
    }, te = async (I) => {
      if (I.saveSet)
        try {
          await I.saveSet(w(I)), _.push(`Saved ${I.label}`, "info"), c.value = null;
        } catch (O) {
          _.push(O instanceof Error ? O.message : `Could not save ${I.label}.`);
        }
    }, ce = (I) => {
      const O = new Set(o.value);
      O.has(I) ? O.delete(I) : O.add(I), o.value = O;
    }, be = async (I) => {
      var O;
      (O = I.children) != null && O.length && (o.value = /* @__PURE__ */ new Set([...o.value, I.id])), await h.refreshTree(), await h.select(I.id);
    }, D = ({ entity: I, level: O = 0 }) => {
      var he, _e, Se;
      const V = !!((he = I.children) != null && he.length), B = o.value.has(I.id), oe = k === I.id, f = kn(I.source) ? I.source : void 0, F = ((Se = f == null ? void 0 : (_e = f.record).getPlaybackPaused) == null ? void 0 : Se.call(_e)) ?? false, z = !!f && f.record.writeSet.activeClip === f.clip && !F && !!(f != null && f.record.setPlaybackPaused), ye = async () => {
        var ke, Bt, jt, Ht, zt, Yt;
        if (f) {
          if (z)
            (Bt = (ke = f.record).setPlaybackPaused) == null || Bt.call(ke, true);
          else {
            if (!((Ht = (jt = f.record.writeSet).play) != null && Ht.call(jt, f.clip))) {
              _.push(`Could not play VAT clip: ${f.clip}`);
              return;
            }
            (Yt = (zt = f.record).setPlaybackPaused) == null || Yt.call(zt, false);
          }
          d(), await h.refreshProperties();
        }
      };
      return /* @__PURE__ */ p(Be, { children: [
        /* @__PURE__ */ p("div", { class: `ble-instancer-tree-row${oe ? " is-selected" : ""}`, style: { paddingLeft: `${O * 14 + 4}px` }, children: [
          /* @__PURE__ */ p("button", { class: "ble-tree-toggle", type: "button", "aria-label": B ? "Collapse" : "Expand", disabled: !V, onClick: () => ce(I.id), children: V ? B ? "\u25BE" : "\u25B8" : "" }),
          /* @__PURE__ */ p("button", { class: "ble-instancer-tree-label", type: "button", onClick: () => void be(I), children: I.label }),
          f ? /* @__PURE__ */ p(
            "button",
            {
              class: "ble-tree-action",
              type: "button",
              title: `${z ? "Pause" : "Play"} ${f.clip}`,
              "aria-label": `${z ? "Pause" : "Play"} ${f.clip}`,
              onClick: () => void ye(),
              children: z ? "\u2161" : "\u25B6"
            }
          ) : null
        ] }),
        V && B ? I.children.map((ke) => /* @__PURE__ */ p(D, { entity: ke, level: O + 1 }, ke.id)) : null
      ] });
    };
    return /* @__PURE__ */ p("div", { class: "ble-instancer-panel", children: [
      T.length ? /* @__PURE__ */ p("div", { class: "ble-instancer-tree", role: "tree", "aria-label": "Instancer entities", children: T.map((I) => /* @__PURE__ */ p(D, { entity: I }, I.id)) }) : /* @__PURE__ */ p("div", { class: "ble-empty", children: "No Instancer sets are registered." }),
      j && /* @__PURE__ */ p("div", { class: "ble-modal-backdrop", role: "presentation", onMouseDown: (I) => {
        I.target === I.currentTarget && (c.value = null);
      }, children: /* @__PURE__ */ p("section", { class: "ble-modal ble-instancer-export-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "ble-instancer-export-title", children: [
        /* @__PURE__ */ p("header", { class: "ble-modal-header", children: [
          /* @__PURE__ */ p("h2", { id: "ble-instancer-export-title", children: [
            "Save ",
            j.label
          ] }),
          /* @__PURE__ */ p("button", { type: "button", "aria-label": "Close Instancer export", onClick: () => {
            c.value = null;
          }, children: "x" })
        ] }),
        /* @__PURE__ */ p("div", { class: "ble-export-actions", children: [
          /* @__PURE__ */ p("button", { type: "button", onClick: () => void H(X(w(j)), `Copied ${j.label} JSON`), children: "Copy JSON" }),
          /* @__PURE__ */ p("button", { type: "button", onClick: () => void H(S(w(j)), `Copied ${j.label} Instancer code`), children: "Copy Instancer Code" }),
          /* @__PURE__ */ p("button", { type: "button", onClick: () => le(j), children: "Download JSON" }),
          /* @__PURE__ */ p("button", { type: "button", disabled: !j.saveSet, onClick: () => void te(j), children: "App Save" })
        ] })
      ] }) })
    ] });
  };
  return {
    register(l, h = {}) {
      const _ = l, k = e.get(_);
      if (k) throw new Error(`Instancer set already registered: ${k}`);
      const T = Or(l), j = $r(T.source) ?? `${T.kind} source ${t.length + 1}`, H = h.id ?? `${T.kind}:${v(l)}`;
      if (t.some((ce) => ce.id === H)) throw new Error(`Instancer set id already registered: ${H}`);
      const le = h.label ?? j;
      e.set(_, H);
      const te = {
        id: H,
        label: le,
        ...T,
        sourceLabel: j,
        getLabel: h.getLabel,
        serializeMetadata: h.serializeMetadata,
        saveSet: h.saveSet,
        getPlaybackPaused: h.getPlaybackPaused,
        setPlaybackPaused: h.setPlaybackPaused,
        transformCache: /* @__PURE__ */ new Map()
      };
      te.baseline = w(te), t.push(te), d();
    },
    exportSet(l) {
      const h = e.get(l), _ = h ? t.find((k) => k.id === h) : void 0;
      if (!_) throw new Error("Instancer set is not registered.");
      return w(_);
    },
    getSceneTree: () => [],
    getExtensionEntities: () => K(),
    getProperties(l) {
      var h, _, k, T, j, H, le, te, ce, be;
      if (((h = l.meta) == null ? void 0 : h.instancer) === "source") {
        const D = t.filter((I) => I.source === l.source);
        return [
          { kind: "entityRef", path: "source", label: "Source", value: l.label, source: l.source, section: "Instancer" },
          { kind: "readonly", path: "setCount", label: "Sets", value: String(D.length), section: "Instancer" },
          { kind: "readonly", path: "instanceCount", label: "Instances", value: String(D.reduce((I, O) => I + O.set.count, 0)), section: "Instancer" }
        ];
      }
      if (((_ = l.meta) == null ? void 0 : _.instancer) === "set") {
        const D = u(l);
        if (!D) return [];
        const I = [
          { kind: "readonly", path: "label", label: "Label", value: D.label, section: "Instancer" },
          { kind: "readonly", path: "kind", label: "Kind", value: D.kind, section: "Instancer" },
          { kind: "readonly", path: "count", label: "Count", value: String(D.set.count), section: "Instancer" },
          { kind: "readonly", path: "visibleCount", label: "Visible", value: String(D.set.visibleCount), section: "Instancer" },
          { kind: "readonly", path: "capacity", label: "Capacity", value: String(D.set.capacity), section: "Instancer" },
          { kind: "entityRef", path: "source", label: "Source", value: D.sourceLabel, source: D.source, section: "Instancer" }
        ], O = Object.keys(De(D));
        return O.length && (I.push({
          kind: D.writeSet.play ? "select" : "readonly",
          path: "activeClip",
          label: "Active clip",
          value: D.writeSet.activeClip ?? O[0],
          ...D.writeSet.play ? { options: O.map((V) => ({ value: V, label: V })) } : {},
          section: "Animation"
        }), typeof D.writeSet.timeSeconds == "number" && I.push({ kind: "number", path: "timeSeconds", label: "Time", value: D.writeSet.timeSeconds, step: 0.01, readonly: true, section: "Animation" })), I;
      }
      if (((k = l.meta) == null ? void 0 : k.instancer) === "animation" && kn(l.source)) {
        const { record: D, clip: I } = l.source, O = De(D)[I];
        if (!O) return [];
        const V = [
          { kind: "readonly", path: "name", label: "Clip", value: I, section: "Animation" },
          { kind: "boolean", path: "active", label: "Active", value: D.writeSet.activeClip === I, readonly: true, section: "Animation" }
        ];
        return typeof O.frameCount == "number" && V.push({ kind: "number", path: "frameCount", label: "Frames", value: O.frameCount, readonly: true, section: "Animation" }), typeof O.fps == "number" && V.push({ kind: "number", path: "fps", label: "FPS", value: O.fps, readonly: true, section: "Animation" }), typeof O.frameCount == "number" && typeof O.fps == "number" && O.fps > 0 && V.push({ kind: "number", path: "duration", label: "Duration", value: O.frameCount / O.fps, step: 0.01, readonly: true, section: "Animation" }), V;
      }
      if (((T = l.meta) == null ? void 0 : T.instancer) === "instance" && ze(l.source)) {
        const { record: D, id: I } = l.source, O = P(D, I);
        if (!O) return [];
        const V = M(D, O), B = [
          { kind: "readonly", path: "id", label: "Instance ID", value: String(I), section: "Instancer" },
          { kind: "readonly", path: "slot", label: "Current slot", value: String(O.slot), section: "Instancer" }
        ], oe = Y(D, I);
        oe !== void 0 && B.push({ kind: "boolean", path: "visible", label: "Visible", value: oe, section: "Instancer" });
        const f = $(D, I), F = $e((H = (j = D.set).getPosition) == null ? void 0 : H.call(j, I)) ?? $e(f ? [f[12], f[13], f[14]] : void 0);
        F && B.push({ kind: "vector3", path: "position", label: "Position", value: F, section: "Transform" });
        const G = Ye(f), z = D.transformCache.get(I);
        if (G) {
          const _e = (z == null ? void 0 : z.rotationEuler) ?? G.rotationEuler, Se = (z == null ? void 0 : z.scale) ?? G.scale;
          D.writeSet.setTransform ? B.push({ kind: "vector3", path: "rotationEuler", label: "Rotation", value: _e, section: "Transform" }) : B.push({ kind: "readonly", path: "rotationEuler", label: "Rotation", value: _e.map((ke) => ke.toFixed(3)).join(", "), section: "Transform" }), D.writeSet.setScale || D.writeSet.setTransform ? B.push({ kind: "vector3", path: "scale", label: "Scaling", value: Se, section: "Transform" }) : B.push({ kind: "readonly", path: "scale", label: "Scaling", value: Se.map((ke) => ke.toFixed(3)).join(", "), section: "Transform" });
        }
        const ye = Sn((te = (le = D.colorSet) == null ? void 0 : le.getColor) == null ? void 0 : te.call(le, I));
        ye && B.push((ce = D.colorSet) != null && ce.setColor ? { kind: "color4", path: "color", label: "Color", value: ye, section: "Instancer" } : { kind: "readonly", path: "color", label: "Color", value: ye.map((_e) => _e.toFixed(3)).join(", "), section: "Instancer" });
        const he = pe(D, I);
        if (he) {
          const _e = Object.keys(De(D));
          B.push(D.writeSet.setClip && _e.length ? { kind: "select", path: "clip", label: "Clip", value: he, options: _e.map((Se) => ({ value: Se, label: Se })), section: "Animation" } : { kind: "readonly", path: "clip", label: "Clip", value: he, section: "Animation" });
        }
        return B.push({ kind: "readonly", path: "metadata", label: "Metadata", value: Rr(((be = D.serializeMetadata) == null ? void 0 : be.call(D, V, I)) ?? V), section: "Metadata" }), B;
      }
      return [];
    },
    setProperty(l, h, _) {
      var j, H, le, te, ce, be, D, I, O;
      if (((j = l.meta) == null ? void 0 : j.instancer) === "set") {
        const V = u(l);
        return !V || h !== "activeClip" || typeof _ != "string" || !V.writeSet.play ? A("unsupported", "This Instancer set property is read-only.") : _ in De(V) ? V.writeSet.play(_) ? (d(), q()) : A("failed", `Could not play VAT clip: ${_}`) : A("invalid", `Unknown VAT clip: ${_}`);
      }
      if (((H = l.meta) == null ? void 0 : H.instancer) !== "instance" || !ze(l.source)) return A("unsupported", "This Instancer entity is read-only.");
      const { record: k, id: T } = l.source;
      if (!P(k, T)) return A("failed", "This instance no longer exists.");
      if (h === "visible")
        return k.writeSet.setVisible ? k.writeSet.trySetVisible && !k.writeSet.trySetVisible(T, !!_) ? A("failed", "This instance no longer exists.") : (k.writeSet.trySetVisible || k.writeSet.setVisible(T, !!_), d(), q()) : A("unsupported", "This instance set does not expose visibility writes.");
      if (h === "position") {
        if (!Tt(_)) return A("invalid", "Position must be a vector3.");
        if (k.writeSet.setPosition) {
          if (k.writeSet.trySetPosition && !k.writeSet.trySetPosition(T, _)) return A("failed", "This instance no longer exists.");
          k.writeSet.trySetPosition || k.writeSet.setPosition(T, _);
        } else if (k.writeSet.setTransform) {
          const V = Ye($(k, T)), B = k.transformCache.get(T);
          if (!ne(k, T, {
            position: _,
            ...(B == null ? void 0 : B.rotationEuler) ?? (V == null ? void 0 : V.rotationEuler) ? { rotationEuler: (B == null ? void 0 : B.rotationEuler) ?? V.rotationEuler } : {},
            ...(B == null ? void 0 : B.scale) ?? (V == null ? void 0 : V.scale) ? { scale: (B == null ? void 0 : B.scale) ?? V.scale } : {}
          })) return A("failed", "This instance no longer exists.");
        } else
          return A("unsupported", "This instance set does not expose position writes.");
        return d(), q();
      }
      if (h === "rotationEuler") {
        if (!k.writeSet.setTransform) return A("unsupported", "This instance set does not expose transform writes.");
        if (!Tt(_)) return A("invalid", "Rotation must be a vector3.");
        const V = $(k, T), B = Ye(V), oe = k.transformCache.get(T), f = $e((te = (le = k.set).getPosition) == null ? void 0 : te.call(le, T)) ?? $e(V ? [V[12], V[13], V[14]] : void 0), F = (oe == null ? void 0 : oe.scale) ?? (B == null ? void 0 : B.scale);
        return ne(k, T, {
          ...f ? { position: f } : {},
          rotationEuler: _,
          ...F ? { scale: F } : {}
        }) ? (k.transformCache.set(T, { ...oe, rotationEuler: _ }), d(), q()) : A("failed", "This instance no longer exists.");
      }
      if (h === "scale") {
        if (!Tt(_)) return A("invalid", "Scaling must be a vector3.");
        const V = k.transformCache.get(T);
        if (k.writeSet.setScale) {
          if (k.writeSet.trySetScale && !k.writeSet.trySetScale(T, _)) return A("failed", "This instance no longer exists.");
          k.writeSet.trySetScale || k.writeSet.setScale(T, _);
        } else if (k.writeSet.setTransform) {
          const B = $(k, T), oe = Ye(B), f = $e((be = (ce = k.set).getPosition) == null ? void 0 : be.call(ce, T)) ?? $e(B ? [B[12], B[13], B[14]] : void 0);
          if (!ne(k, T, {
            ...f ? { position: f } : {},
            ...(V == null ? void 0 : V.rotationEuler) ?? (oe == null ? void 0 : oe.rotationEuler) ? { rotationEuler: (V == null ? void 0 : V.rotationEuler) ?? oe.rotationEuler } : {},
            scale: _
          })) return A("failed", "This instance no longer exists.");
        } else
          return A("unsupported", "This instance set does not expose scaling writes.");
        return k.transformCache.set(T, { ...V, scale: _ }), d(), q();
      }
      return h === "color" ? (D = k.colorSet) != null && D.setColor ? Vr(_) ? (k.colorSet.setColor(T, _), d(), q()) : A("invalid", "Color must be a color4.") : A("unsupported", "This instance set does not expose color writes.") : h === "clip" ? typeof _ != "string" || !(_ in De(k)) ? A("invalid", "Select a known VAT clip.") : (O = (I = k.writeSet).setClip) != null && O.call(I, T, _) ? (d(), q()) : A("failed", "This instance no longer exists or the clip is unavailable.") : A("unsupported", "This Instancer property is read-only.");
    },
    setEntityVisible(l, h) {
      return !ze(l.source) || !l.source.record.writeSet.setVisible ? A("unsupported", "This instance has no visibility toggle.") : !P(l.source.record, l.source.id) || l.source.record.writeSet.trySetVisible && !l.source.record.writeSet.trySetVisible(l.source.id, h) ? A("failed", "This instance no longer exists.") : (l.source.record.writeSet.trySetVisible || l.source.record.writeSet.setVisible(l.source.id, h), d(), q());
    },
    async pickEntity(l, h, _) {
      var k, T, j, H, le;
      if (!ge(_.scene) || ((T = (k = _.explorer) == null ? void 0 : k.userSettings) == null ? void 0 : T.instancerPickMode) === "source") return q(null);
      try {
        let te = r.get(_.scene);
        te || (te = (((j = _.lite) == null ? void 0 : j.createGpuPicker) ?? wn)(_.scene), r.set(_.scene, te), i.set(te, ((H = _.lite) == null ? void 0 : H.disposePicker) ?? xn));
        const ce = await (((le = _.lite) == null ? void 0 : le.pickAsync) ?? Pn)(te, l, h);
        if (ce.hit && ce.pickedMesh && ce.thinInstanceIndex >= 0)
          for (const F of t) {
            if (F.kind === "vat" || F.kind === "vat-character" || !F.pickSources.includes(ce.pickedMesh)) continue;
            const G = E(F, ce.thinInstanceIndex);
            if (G)
              return o.value = /* @__PURE__ */ new Set([m(F.source), x(F)]), d(), q({ entityId: g(F, G.id), details: Mr(ce) });
          }
        const be = t.filter((F) => F.kind === "vat" || F.kind === "vat-character"), D = _.canvas, I = _.scene.camera;
        if (!be.length || !D || !ge(I)) return q(null);
        const O = D.getBoundingClientRect(), V = O.width || D.width, B = O.height || D.height;
        if (!V || !B) return q(null);
        const oe = gi(I, V / B);
        let f;
        for (const F of be)
          for (const G of F.set.entries()) {
            if (Y(F, G.id) === false) continue;
            const z = $(F, G.id), ye = z ? Wr(z, F.pickCenter) : void 0;
            if (!ye) continue;
            const he = Gr(ye, oe, V, B);
            if (!he) continue;
            const _e = l - he.x, Se = h - he.y, ke = _e * _e + Se * Se;
            ke > 576 || f && f.distanceSquared <= ke || (f = { record: F, id: G.id, distanceSquared: ke });
          }
        return f ? (o.value = /* @__PURE__ */ new Set([m(f.record.source), x(f.record)]), d(), q({ entityId: g(f.record, f.id) })) : q(null);
      } catch (te) {
        return A("failed", te instanceof Error ? te.message : "Instancer picking failed.");
      }
    },
    async pickEntityId(l, h, _) {
      var T;
      const k = await this.pickEntity(l, h, _);
      return k.ok ? q(((T = k.value) == null ? void 0 : T.entityId) ?? null) : k;
    },
    getExplorerExtensions: () => ({
      panes: [{ key: "instancer", title: "Instancer", side: "left", order: 20, content: C, keepMounted: true }],
      commands: [{
        id: "open-instancer",
        label: "Show instances",
        when: (l) => y(l).length > 0,
        rowAction: { label: "Show instances", icon: "I" },
        run: (l, h, _) => {
          l && fe(l), _.openPanel("instancer"), _.refresh();
        }
      }, {
        id: "reset-instancer-instance",
        label: "Reset Instance",
        when: (l) => {
          var h;
          return !!l && ((h = l.meta) == null ? void 0 : h.instancer) === "instance" && ze(l.source) && !!l.source.record.baseline;
        },
        run: async (l, h, _) => {
          if (!l || !ze(l.source)) return;
          const { record: k, id: T } = l.source;
          if (!ee(k, T)) {
            _.notify(`Could not reset ${l.label}.`);
            return;
          }
          _.notify(`Reset ${l.label}`, "info"), await _.refresh();
        }
      }, {
        id: "reset-instancer-set",
        label: "Reset Set",
        when: (l) => {
          var h, _;
          return !!l && ((h = l.meta) == null ? void 0 : h.instancer) === "set" && !!((_ = u(l)) != null && _.baseline);
        },
        run: async (l, h, _) => {
          if (!l) return;
          const k = u(l);
          if (!k) return;
          const T = R(k);
          _.notify(`Reset ${k.label} (${T} instances)`, "info"), await _.refresh();
        }
      }, {
        id: "save-instancer-set",
        label: "Save Set",
        when: (l) => {
          var h;
          return !!l && ((h = l.meta) == null ? void 0 : h.instancer) === "set";
        },
        run: async (l, h, _) => {
          if (!l) return;
          const k = u(l);
          k && (c.value = k.id, _.openPanel("instancer"), d());
        }
      }]
    }),
    getEntitySnapshot: (l) => {
      var h;
      return q({ id: l.id, label: l.label, kind: ((h = l.meta) == null ? void 0 : h.instancer) ?? "instancer" });
    },
    dispose: () => {
      for (const [l, h] of i) h(l);
      i.clear(), t.length = 0, d();
    }
  };
}
var Br = { editable: false, focusable: false, visibilityToggle: false, serializableSnapshot: false };
function Lt(t) {
  if (!t || typeof t != "object") return false;
  const e = t;
  return typeof e.width == "number" && typeof e.height == "number" && "texture" in e && "view" in e && "sampler" in e;
}
function Dt(t) {
  if (!t || typeof t != "object") return null;
  const e = t.layers;
  return typeof e == "number" && Number.isInteger(e) && e > 0 ? e : null;
}
function jr(t) {
  return t === "dynamic" ? "Dynamic Texture2D" : t === "html" ? "HTML Texture2D" : t === "array" ? "Texture2D Array" : "Texture2D";
}
function Hr(t) {
  var o;
  const e = [
    { kind: "readonly", path: "$kind", label: "Kind", value: t.kind, section: "General" },
    { kind: "readonly", path: "$id", label: "ID", value: t.id, section: "General" }
  ], n = (o = t.meta) == null ? void 0 : o.registeredTextureType;
  if (t.kind !== "texture" || typeof n != "string" || !Lt(t.source)) return e;
  const i = t.source, r = [
    { kind: "readonly", path: "$textureType", label: "Type", value: jr(n), section: "Texture" },
    { kind: "number", path: "width", label: "Width", value: i.width, readonly: true, section: "Texture" },
    { kind: "number", path: "height", label: "Height", value: i.height, readonly: true, section: "Texture" }
  ];
  n === "array" && r.push({ kind: "number", path: "layers", label: "Layers", value: Dt(i), readonly: true, section: "Texture" });
  const s = [
    ["uScale", "U scale"],
    ["vScale", "V scale"],
    ["uOffset", "U offset"],
    ["vOffset", "V offset"],
    ["uAng", "UV rotation"]
  ];
  for (const [c, b] of s) typeof i[c] == "number" && r.push({ kind: "number", path: c, label: b, value: i[c], readonly: true, section: "UV Transform" });
  return typeof i.invertY == "boolean" && r.push({ kind: "boolean", path: "invertY", label: "Invert Y", value: i.invertY, readonly: true, section: "UV Transform" }), [...e, ...r];
}
function Jr(t) {
  return {
    getSceneTree(e) {
      const n = t.getEntities(e), i = /* @__PURE__ */ new Set(), r = /* @__PURE__ */ new Map();
      for (const o of n) {
        if (!o.id || i.has(o.id)) throw new Error(`Registered entity IDs must be unique: ${o.id || "(empty)"}`);
        if (o.textureType && o.kind !== "texture") throw new Error(`Texture classification is only valid for texture entities: ${o.id}`);
        if (o.textureType && !Lt(o.source)) throw new Error(`Registered texture source must expose the public Texture2D shape: ${o.id}`);
        if (o.textureType === "array" && Dt(o.source) === null) throw new Error(`Registered array texture must expose a positive integer layers value: ${o.id}`);
        const c = o.kind === "texture" && Lt(o.source) ? o.textureType ?? (Dt(o.source) !== null ? "array" : "texture2d") : void 0;
        i.add(o.id);
        const { textureType: b, ...d } = o;
        r.set(o.id, {
          ...d,
          capabilities: { ...Br, ...o.capabilities },
          children: [],
          meta: c ? { registeredTextureType: c } : void 0
        });
      }
      const s = [];
      for (const o of r.values()) {
        const c = o.parentId ? r.get(o.parentId) : void 0;
        c ? c.children.push(o) : s.push(o);
      }
      return s;
    },
    getProperties: t.getProperties ?? Hr,
    setProperty: t.setProperty,
    getStats: t.getStats,
    getEntitySnapshot: t.getEntitySnapshot,
    pickEntity: t.pickEntity,
    pickEntityId: t.pickEntityId,
    focusEntity: t.focusEntity,
    setEntityVisible: t.setEntityVisible
  };
}
export {
  sr as CommandService,
  cr as ShellService,
  Ci as composeLiteSceneAdapters,
  Wi as createDefaultLiteSceneAdapter,
  Kr as createInstancerExplorerAdapter,
  Jr as createRegisteredSceneAdapter,
  A as fail,
  q as ok,
  qr as showLiteExplorer
};
