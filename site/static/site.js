(function () {
  'use strict';
  var d = document, w = window;
  var reduce = w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = w.matchMedia('(pointer: fine)').matches;
  var $ = function (s, r) { return (r || d).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); };

  try { var l = d.documentElement.getAttribute('data-lang'); if (l) localStorage.setItem('lang', l); } catch (e) {}

  /* ── header: solid on scroll, hide on scroll down ── */
  var hdr = $('#hdr'), lastY = 0, ticking = false;
  function onScroll() {
    var y = w.scrollY;
    hdr.classList.toggle('solid', y > 24);
    var open = $('#nav').classList.contains('open');
    hdr.classList.toggle('hide', y > 240 && y > lastY + 4 && !open);
    if (y < lastY - 4) hdr.classList.remove('hide');
    lastY = y;
    progress();
    sweep();
    ticking = false;
  }
  w.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });

  /* ── mobile menu ── */
  var burger = $('#burger'), nav = $('#nav');
  burger.addEventListener('click', function () {
    var o = nav.classList.toggle('open');
    burger.setAttribute('aria-expanded', o ? 'true' : 'false');
    d.body.style.overflow = o ? 'hidden' : '';
  });
  $$('a', nav).forEach(function (a) { a.addEventListener('click', function () { nav.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); d.body.style.overflow = ''; }); });

  /* ── reveal on scroll ── */
  var io = 'IntersectionObserver' in w ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }) : null;
  $$('[data-reveal]').forEach(function (el) { io ? io.observe(el) : el.classList.add('in'); });
  /* запасной путь: если наблюдатель пропустил быстрый скролл, открываем всё, что уже выше нижней границы окна */
  function sweep() {
    var vh = w.innerHeight;
    $$('[data-reveal]:not(.in)').forEach(function (el) { if (el.getBoundingClientRect().top < vh * 0.94) el.classList.add('in'); });
  }
  sweep();

  /* ── cursor glow + spotlight cards ── */
  var glow = $('.glow');
  if (fine && !reduce) {
    w.addEventListener('pointermove', function (e) {
      glow.style.setProperty('--gx', e.clientX + 'px');
      glow.style.setProperty('--gy', e.clientY + 'px');
      glow.classList.add('on');
    }, { passive: true });
    $$('.spot').forEach(function (c) {
      c.addEventListener('pointermove', function (e) {
        var r = c.getBoundingClientRect();
        c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        c.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    });
  }

  /* ── process line fills on scroll ── */
  var steps = $('#steps');
  function progress() {
    if (!steps) return;
    var r = steps.getBoundingClientRect(), vh = w.innerHeight;
    var p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.2)));
    steps.style.setProperty('--p', p.toFixed(3));
    $$('li', steps).forEach(function (li, i, all) { li.classList.toggle('on', p > (i + 0.35) / all.length - 0.02); });
  }
  progress();

  /* ── lazy demo iframe ── */
  var fr = $('iframe[data-src]');
  if (fr) {
    var load = function () { if (!fr.src) { fr.src = fr.getAttribute('data-src'); fr.addEventListener('load', function () { var l = $('.frame-load'); if (l) l.remove(); }); } };
    if ('IntersectionObserver' in w) {
      var o2 = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { load(); o2.disconnect(); } }, { rootMargin: '300px' });
      o2.observe(fr);
    } else load();
  }

  /* ── hero network canvas ── */
  var cv = $('#net');
  if (cv && !reduce) {
    var ctx = cv.getContext('2d'), W = 0, H = 0, dpr = Math.min(2, w.devicePixelRatio || 1), nodes = [], packets = [], mouse = { x: -999, y: -999 }, run = true, t0 = 0;
    var N = 0, LINK = 150;
    function size() {
      var r = cv.getBoundingClientRect(); W = r.width; H = r.height;
      cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      N = Math.round(Math.min(70, Math.max(26, W * H / 20000)));
      nodes = [];
      for (var i = 0; i < N; i++) nodes.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .25, vy: (Math.random() - .5) * .25, r: Math.random() * 1.6 + 1.1, hub: Math.random() < .12 });
      LINK = Math.max(110, Math.min(170, W / 8));
    }
    size();
    w.addEventListener('resize', size);
    w.addEventListener('pointermove', function (e) { var r = cv.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; }, { passive: true });
    if ('IntersectionObserver' in w) new IntersectionObserver(function (es) { run = es[0].isIntersecting; if (run) requestAnimationFrame(frame); }).observe(cv);
    function spawn() {
      var a = nodes[(Math.random() * N) | 0], best = null, bd = 1e9;
      for (var i = 0; i < N; i++) { var b = nodes[i]; if (b === a) continue; var dx = a.x - b.x, dy = a.y - b.y, dd = dx * dx + dy * dy; if (dd < LINK * LINK && dd < bd && Math.random() < .5) { bd = dd; best = b; } }
      if (best) packets.push({ a: a, b: best, t: 0, s: .012 + Math.random() * .014 });
    }
    function frame(ts) {
      if (!run) return;
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < N; i++) {
        var n = nodes[i];
        n.x += n.vx; n.y += n.vy;
        if (n.x < -20) n.x = W + 20; else if (n.x > W + 20) n.x = -20;
        if (n.y < -20) n.y = H + 20; else if (n.y > H + 20) n.y = -20;
        var mx = n.x - mouse.x, my = n.y - mouse.y, md = mx * mx + my * my;
        if (md < 14000) { var f = (1 - md / 14000) * .9; n.x += mx / Math.sqrt(md + 1) * f; n.y += my / Math.sqrt(md + 1) * f; }
      }
      ctx.lineWidth = 1;
      for (var a = 0; a < N; a++) {
        for (var b = a + 1; b < N; b++) {
          var dx = nodes[a].x - nodes[b].x, dy = nodes[a].y - nodes[b].y, dd = dx * dx + dy * dy;
          if (dd < LINK * LINK) {
            var al = (1 - Math.sqrt(dd) / LINK) * .28;
            ctx.strokeStyle = 'rgba(255,255,255,' + al.toFixed(3) + ')';
            ctx.beginPath(); ctx.moveTo(nodes[a].x, nodes[a].y); ctx.lineTo(nodes[b].x, nodes[b].y); ctx.stroke();
          }
        }
      }
      for (var k = 0; k < N; k++) {
        var q = nodes[k];
        ctx.beginPath(); ctx.arc(q.x, q.y, q.hub ? q.r + 1.4 : q.r, 0, 6.283);
        ctx.fillStyle = q.hub ? 'rgba(255,138,0,.95)' : 'rgba(255,255,255,.45)'; ctx.fill();
        if (q.hub) { ctx.beginPath(); ctx.arc(q.x, q.y, q.r + 6 + Math.sin(ts / 500 + k) * 2, 0, 6.283); ctx.strokeStyle = 'rgba(255,138,0,.25)'; ctx.stroke(); }
      }
      if (packets.length < 14 && Math.random() < .08) spawn();
      for (var p = packets.length - 1; p >= 0; p--) {
        var pk = packets[p]; pk.t += pk.s;
        if (pk.t >= 1) { packets.splice(p, 1); continue; }
        var px = pk.a.x + (pk.b.x - pk.a.x) * pk.t, py = pk.a.y + (pk.b.y - pk.a.y) * pk.t;
        var g = ctx.createRadialGradient(px, py, 0, px, py, 9);
        g.addColorStop(0, 'rgba(255,170,60,.95)'); g.addColorStop(1, 'rgba(255,138,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, 9, 0, 6.283); ctx.fill();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ── lead forms ── */
  $$('form.lead').forEach(function (f) {
    var status = $('.status', f);
    function data() {
      var g = function (n) { var el = f.elements[n]; return el ? el.value.trim() : ''; };
      return { name: g('name'), company: g('company'), contact: g('contact'), message: g('message'), website: g('website'), lang: f.dataset.lang, page: f.dataset.page };
    }
    function valid(v) {
      var ok = true;
      ['name', 'contact', 'message'].forEach(function (n) {
        var bad = !v[n]; f.elements[n].closest('.fld').classList.toggle('bad', bad); if (bad) ok = false;
      });
      if (!ok) { status.className = 'status err'; status.textContent = f.dataset.required; }
      return ok;
    }
    function setBusy(b) { $$('[data-send]', f).forEach(function (x) { x.disabled = b; }); }
    $$('[data-send]', f).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var v = data(); status.className = 'status'; status.textContent = '';
        if (!valid(v)) return;
        if (btn.dataset.send === 'email') {
          var body = [v.name + (v.company ? ' (' + v.company + ')' : ''), v.contact, '', v.message].join('\n');
          w.location.href = 'mailto:' + f.dataset.email + '?subject=' + encodeURIComponent(f.dataset.subject) + '&body=' + encodeURIComponent(body);
          return;
        }
        setBusy(true); status.textContent = f.dataset.sending;
        fetch(f.dataset.api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok && j.ok, j: j }; }); })
          .then(function (res) {
            if (res.ok) { status.className = 'status ok'; status.textContent = f.dataset.ok; f.reset(); }
            else { status.className = 'status err'; status.textContent = f.dataset.err; }
          })
          .catch(function () { status.className = 'status err'; status.textContent = f.dataset.err; })
          .then(function () { setBusy(false); });
      });
    });
    $$('input,textarea', f).forEach(function (el) { el.addEventListener('input', function () { var p = el.closest('.fld'); if (p) p.classList.remove('bad'); }); });
  });
})();
