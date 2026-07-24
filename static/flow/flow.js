/* vm-flow engine — 열 기반 레이아웃 + rAF 패킷 애니메이션.
   정적 호스팅에서 동작. 의존성 없음. prefers-reduced-motion / IntersectionObserver 존중. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var L = { NODE_W: 134, NODE_H: 54, COL_GAP: 226, ROW_GAP: 78, MARGIN: 24 };
  var SPEED = { slow: 55, normal: 92, fast: 150 }; // px/sec
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function build(container) {
    var specEl = container.querySelector('script.flow-spec');
    if (!specEl || container.dataset.flowReady) return;
    var spec;
    try { spec = JSON.parse(specEl.textContent); } catch (err) { return; }
    container.dataset.flowReady = '1';

    var nodes = spec.nodes || [], edges = spec.edges || [];
    var byId = {};
    nodes.forEach(function (nd) { byId[nd.id] = nd; });

    var maxCol = 0, maxRow = 0;
    nodes.forEach(function (nd) {
      maxCol = Math.max(maxCol, nd.col || 0);
      maxRow = Math.max(maxRow, nd.row || 0);
    });
    var W = L.MARGIN * 2 + maxCol * L.COL_GAP + L.NODE_W;
    var H = L.MARGIN * 2 + maxRow * L.ROW_GAP + L.NODE_H;

    var nx = function (nd) { return L.MARGIN + (nd.col || 0) * L.COL_GAP; };
    var ny = function (nd) { return L.MARGIN + (nd.row || 0) * L.ROW_GAP; };
    var midY = function (nd) { return ny(nd) + L.NODE_H / 2; };

    var svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H, class: 'flow-svg',
      role: 'img', 'aria-label': spec.caption || 'flow diagram',
      preserveAspectRatio: 'xMidYMid meet'
    });
    var gEdges = el('g', { class: 'flow-edges' });
    var gPk = el('g', { class: 'flow-packets' });
    var gNodes = el('g', { class: 'flow-nodes' });

    var anim = [];
    edges.forEach(function (ed) {
      var a = byId[ed.from], b = byId[ed.to];
      if (!a || !b) return;
      var x1 = nx(a) + L.NODE_W, y1 = midY(a), x2 = nx(b), y2 = midY(b);
      var dashed = !!ed.dashed;
      gEdges.appendChild(el('line', {
        x1: x1, y1: y1, x2: x2, y2: y2,
        class: 'flow-edge' + (dashed ? ' is-dashed' : '')
      }));
      var ang = Math.atan2(y2 - y1, x2 - x1);
      var ax = x2 - 8 * Math.cos(ang), ay = y2 - 8 * Math.sin(ang);
      gEdges.appendChild(el('path', {
        d: 'M ' + x2 + ' ' + y2 + ' L ' + (ax - 4.5 * Math.sin(ang)) + ' ' + (ay + 4.5 * Math.cos(ang)) +
           ' L ' + (ax + 4.5 * Math.sin(ang)) + ' ' + (ay - 4.5 * Math.cos(ang)) + ' Z',
        class: 'flow-arrow'
      }));
      if (ed.label) {
        var t = el('text', { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 6, class: 'flow-elabel', 'text-anchor': 'middle' });
        t.textContent = ed.label;
        gEdges.appendChild(t);
      }
      if (!dashed) {
        anim.push({
          x1: x1, y1: y1, x2: x2, y2: y2,
          rate: ed.rate || 720, dur: Math.hypot(x2 - x1, y2 - y1) / (SPEED[ed.speed] || SPEED.normal),
          kind: ed.kind || a.kind || 'proc', particles: [], last: 0
        });
      }
    });

    nodes.forEach(function (nd) {
      var g = el('g', { class: 'flow-node kind-' + (nd.kind || 'proc') });
      g.appendChild(el('rect', { x: nx(nd), y: ny(nd), width: L.NODE_W, height: L.NODE_H, rx: 10, class: 'flow-rect' }));
      var lbl = el('text', { x: nx(nd) + L.NODE_W / 2, y: midY(nd) + (nd.sub ? -2 : 4), class: 'flow-nlabel', 'text-anchor': 'middle' });
      lbl.textContent = nd.label || nd.id;
      g.appendChild(lbl);
      if (nd.sub) {
        var s = el('text', { x: nx(nd) + L.NODE_W / 2, y: midY(nd) + 14, class: 'flow-nsub', 'text-anchor': 'middle' });
        s.textContent = nd.sub;
        g.appendChild(s);
      }
      gNodes.appendChild(g);
    });

    svg.appendChild(gEdges);
    svg.appendChild(gPk);
    svg.appendChild(gNodes);
    svg.style.maxWidth = W + 'px'; // 자연 크기 이상으로 확대하지 않음(좁은 도식이 뭉개지지 않게)
    container.insertBefore(svg, container.firstChild);

    if (REDUCE || !anim.length) return; // 정적 렌더 (구조만)

    var running = false, rafId = 0, prev = 0;
    function frame(ts) {
      if (!prev) prev = ts;
      var dt = Math.min((ts - prev) / 1000, 0.05);
      prev = ts;
      var buf = '';
      for (var i = 0; i < anim.length; i++) {
        var e = anim[i];
        e.last += dt * 1000;
        if (e.last >= e.rate) { e.last = 0; e.particles.push({ t: 0 }); }
        for (var j = 0; j < e.particles.length; j++) e.particles[j].t += dt / e.dur;
        e.particles = e.particles.filter(function (p) { return p.t <= 1; });
        for (var k = 0; k < e.particles.length; k++) {
          var p = e.particles[k];
          var x = e.x1 + (e.x2 - e.x1) * p.t, y = e.y1 + (e.y2 - e.y1) * p.t;
          var op = p.t < 0.14 ? p.t / 0.14 : (p.t > 0.86 ? (1 - p.t) / 0.14 : 1);
          buf += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3.5" class="pk-' + e.kind + '" opacity="' + op.toFixed(2) + '"/>';
        }
      }
      gPk.innerHTML = buf;
      rafId = requestAnimationFrame(frame);
    }
    function start() { if (running) return; running = true; prev = 0; rafId = requestAnimationFrame(frame); }
    function stop() { running = false; cancelAnimationFrame(rafId); }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { en.isIntersecting ? start() : stop(); });
      }, { threshold: 0.15 }).observe(container);
    } else {
      start();
    }
  }

  function init() {
    var list = document.querySelectorAll('.vm-flow');
    for (var i = 0; i < list.length; i++) build(list[i]);
  }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
