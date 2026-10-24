(function () {

  var P = 'M 27 12 L 10.8 5 L 12.5 10.5 H 6.5 v 3 h 5.5 l -2.25 5.75 z';

  function node(w, h, lead, trailIdx) {

    var d = document.createElement('div');

    d.className = 'motion-cursor ' + (lead ? 'motion-cursor--lead' : 'motion-cursor--trail');

    if (trailIdx !== '') d.setAttribute('data-trail', trailIdx);

    d.setAttribute('aria-hidden', 'true');

    d.innerHTML = '<svg class="motion-cursor-svg motion-cursor-svg--' + (lead ? 'lead' : 'trail') + '" width="' + w + '" height="' + h + '" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path fill="#fff" stroke="#000" stroke-width="1" stroke-linejoin="round" vector-effect="non-scaling-stroke" d="' + P + '"/></svg>';

    return d;

  }

  document.body.appendChild(node(32, 32, true, '')).id = 'motion-cursor';

  document.body.appendChild(node(22, 22, false, '0'));

  document.body.appendChild(node(18, 18, false, '1'));



  var el = document.getElementById('motion-cursor');

  var trailEls = Array.prototype.slice.call(document.querySelectorAll('.motion-cursor--trail'));

  var MIN = 0.16, DS = 0.2, DH = 0.62, DHSQ = 100, TSQ = 140, DEC = 0.88, STOP = 6, CAP = 56;

  var TX = 27 / 32, TY = 12 / 32, FBL = 32, BIAS = 0;

  var LAG = [5, 10], TOP = [0.52, 0.38], TSC = [0.72, 0.56], TFB = [22, 18];

  var hx = new Float32Array(CAP), hy = new Float32Array(CAP), ha = new Float32Array(CAP);

  var hw = 0, hc = 0, hx0, hy0, ha0, tpx, tpy, lx, ly, ok, dx, dy, dr, da, vis, tx, ty, raf, pk, i, n, te;

  var active = false;

  var PARK = 'translate3d(-4096px,-4096px,0)';

  function park(n) {

    n.style.transform = PARK;

    n.style.transformOrigin = '0 0';

    n.style.visibility = 'hidden';

    n.style.opacity = '0';

  }



  function tip(n, fw, fh) {

    var w = Math.max(n.offsetWidth || fw || FBL, 1), h = Math.max(n.offsetHeight || fh || FBL, 1);

    tpx = w * TX; tpy = h * TY;

  }

  function place(n, wx, wy, deg, sc, fw, fh) {

    tip(n, fw, fh);

    n.style.transformOrigin = tpx + 'px ' + tpy + 'px';

    var t = 'translate3d(' + (wx - tpx) + 'px,' + (wy - tpy) + 'px,0) rotateZ(' + deg + 'deg)';

    n.style.transform = sc !== 1 ? t + ' scale(' + sc + ')' : t;

    if (n !== el) n.style.visibility = 'visible';

  }

  function push(x, y, a) {

    hx[hw] = x; hy[hw] = y; ha[hw] = a;

    hw = (hw + 1) % CAP;

    if (hc < CAP) hc++;

  }

  function take(lg) {

    if (lg >= hc) return false;

    var ix = (hw - 1 - lg + CAP) % CAP;

    hx0 = hx[ix]; hy0 = hy[ix]; ha0 = ha[ix];

    return true;

  }

  function flush() {

    raf = 0;

    if (!active) return;

    pk *= DEC;

    place(el, tx, ty, da + BIAS, 1, FBL, FBL);

    var fast = pk >= TSQ;

    for (i = 0, n = trailEls.length; i < n; i++) {

      te = trailEls[i];

      if (fast && take(LAG[i])) {

        te.style.opacity = String(TOP[i]);

        place(te, hx0, hy0, ha0 + BIAS, TSC[i], TFB[i], TFB[i]);

      } else {

        park(te);

      }

    }

    if (pk > STOP || fast) sch();

  }

  function sch() { if (!raf && active) raf = requestAnimationFrame(flush); }

  function hide() {

    if (raf) { cancelAnimationFrame(raf); raf = 0; }

    vis = false; pk = 0; ok = false; dx = 1; dy = 0; dr = false;

    el.classList.remove('motion-cursor--visible');

    for (i = 0; i < trailEls.length; i++) park(trailEls[i]);

    el.style.transform = PARK;

    el.style.transformOrigin = '0 0';

  }

  function ptr(e) {

    if (!active) return;

    var x = e.clientX, y = e.clientY, ddx = ok ? x - lx : 0, ddy = ok ? y - ly : 0;

    if (ddx || ddy) {

      var q = ddx * ddx + ddy * ddy;

      pk = q;

      if (q >= MIN) {

        var il = 1 / Math.sqrt(q), nx = ddx * il, ny = ddy * il, b = q >= DHSQ ? DH : DS;

        if (!dr) { dx = nx; dy = ny; dr = true; }

        else {

          dx += (nx - dx) * b; dy += (ny - dy) * b;

          il = 1 / Math.hypot(dx, dy);

          dx *= il; dy *= il;

        }

        da = (Math.atan2(dy, dx) * 180) / Math.PI;

      }

    }

    lx = x; ly = y; ok = true;

    tx = x; ty = y;

    push(tx, ty, da);

    place(el, tx, ty, da + BIAS, 1, FBL, FBL);

    if (!vis) { vis = true; el.classList.add('motion-cursor--visible'); }

    sch();

  }

  function touch(e) { ptr({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY }); }



  function onLeave() {

    if (active) hide();

  }



  lx = ly = tx = ty = 0; ok = false; dx = 1; dy = 0; dr = false; da = 0; vis = false; raf = 0; pk = 0;



  for (i = 0; i < trailEls.length; i++) park(trailEls[i]);

  el.style.transform = PARK;

  el.style.transformOrigin = '0 0';



  if (window.PointerEvent) {

    document.addEventListener('pointermove', ptr, { passive: true });

    document.addEventListener('pointerdown', ptr, { passive: true });

    document.documentElement.addEventListener('pointerleave', onLeave, { passive: true });

  } else {

    document.addEventListener('mousemove', ptr, { passive: true });

    document.addEventListener('touchmove', function (e) { if (e.touches.length) touch(e); }, { passive: true });

    document.addEventListener('touchstart', function (e) { if (e.touches.length) touch(e); }, { passive: true });

    document.body.addEventListener('mouseleave', onLeave, { passive: true });

  }



  window.motionCursor = {

    syncSelectionMode: function (mode) {

      var on = mode === 'lasso';

      active = on;

      document.body.classList.toggle('motion-cursor-page', on);

      if (!on) hide();

    }

  };



  var initial = 'rectangle';

  if (window.lassoSelection && typeof window.lassoSelection.getMode === 'function') {

    initial = window.lassoSelection.getMode();

  }

  window.motionCursor.syncSelectionMode(initial);

})();

