/* vm-flow engine — 열 기반 레이아웃 + rAF 패킷 애니메이션 + 그룹(subgraph) 박스.
   정적 호스팅에서 동작. 의존성 없음. prefers-reduced-motion / IntersectionObserver 존중. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var L = { NODE_W: 134, NODE_H: 54, COL_GAP: 226, ROW_GAP: 78, MARGIN: 24 };
  var GPAD = 15, GLABEL = 20; // 그룹 박스 여백 / 상단 라벨 높이
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

    var nodes = spec.nodes || [], edges = spec.edges || [], groups = spec.groups || [];
    var byId = {};
    nodes.forEach(function (nd) { byId[nd.id] = nd; });

    var nx = function (nd) { return L.MARGIN + (nd.col || 0) * L.COL_GAP; };
    var ny = function (nd) { return L.MARGIN + (nd.row || 0) * L.ROW_GAP; };

    // 그룹 박스: 멤버 노드들의 바운딩 + 여백 + 상단 라벨 공간
    var groupBox = {};
    groups.forEach(function (g) {
      var ms = (g.members || []).map(function (id) { return byId[id]; }).filter(Boolean);
      if (!ms.length) return;
      var x1 = Math.min.apply(null, ms.map(nx));
      var y1 = Math.min.apply(null, ms.map(ny));
      var x2 = Math.max.apply(null, ms.map(function (m) { return nx(m) + L.NODE_W; }));
      var y2 = Math.max.apply(null, ms.map(function (m) { return ny(m) + L.NODE_H; }));
      groupBox[g.id] = { x: x1 - GPAD, y: y1 - GPAD - GLABEL, w: (x2 - x1) + 2 * GPAD, h: (y2 - y1) + 2 * GPAD + GLABEL };
    });

    // id → 박스(노드 또는 그룹). 엣지 끝점 계산용.
    function boxOf(id) {
      if (byId[id]) { var n = byId[id]; return { x: nx(n), y: ny(n), w: L.NODE_W, h: L.NODE_H }; }
      if (groupBox[id]) return groupBox[id];
      return null;
    }

    // viewBox = 노드 + 그룹 박스의 합집합 (그룹 없으면 기존과 동일한 0 0 W H)
    var baseW = L.MARGIN * 2 + Math.max.apply(null, nodes.map(function (n) { return n.col || 0; })) * L.COL_GAP + L.NODE_W;
    var baseH = L.MARGIN * 2 + Math.max.apply(null, nodes.map(function (n) { return n.row || 0; })) * L.ROW_GAP + L.NODE_H;
    var minX = 0, minY = 0, maxX = baseW, maxY = baseH;
    for (var gid in groupBox) {
      var b = groupBox[gid];
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
    var vbW = maxX - minX, vbH = maxY - minY;

    var svg = el('svg', {
      viewBox: minX + ' ' + minY + ' ' + vbW + ' ' + vbH, class: 'flow-svg',
      role: 'img', 'aria-label': spec.caption || 'flow diagram',
      preserveAspectRatio: 'xMidYMid meet'
    });
    var gGroups = el('g', { class: 'flow-groups' });
    var gEdges = el('g', { class: 'flow-edges' });
    var gPk = el('g', { class: 'flow-packets' });
    var gNodes = el('g', { class: 'flow-nodes' });

    // 그룹 박스 (맨 뒤 레이어)
    groups.forEach(function (g) {
      var b = groupBox[g.id];
      if (!b) return;
      var gg = el('g', { class: 'flow-group kind-' + (g.kind || 'group') });
      gg.appendChild(el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 12, class: 'flow-group-box' }));
      if (g.label) {
        var t = el('text', { x: b.x + 12, y: b.y + 14, class: 'flow-group-label' });
        t.textContent = g.label;
        gg.appendChild(t);
      }
      gGroups.appendChild(gg);
    });

    var anim = [];
    edges.forEach(function (ed) {
      var a = boxOf(ed.from), b = boxOf(ed.to);
      if (!a || !b) return;
      var x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
      var dashed = !!ed.dashed;
      gEdges.appendChild(el('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: 'flow-edge' + (dashed ? ' is-dashed' : '') }));
      var ang = Math.atan2(y2 - y1, x2 - x1);
      var ax = x2 - 8 * Math.cos(ang), ay = y2 - 8 * Math.sin(ang);
      gEdges.appendChild(el('path', {
        d: 'M ' + x2 + ' ' + y2 + ' L ' + (ax - 4.5 * Math.sin(ang)) + ' ' + (ay + 4.5 * Math.cos(ang)) +
           ' L ' + (ax + 4.5 * Math.sin(ang)) + ' ' + (ay - 4.5 * Math.cos(ang)) + ' Z',
        class: 'flow-arrow'
      }));
      if (ed.label) {
        var lt = el('text', { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 6, class: 'flow-elabel', 'text-anchor': 'middle' });
        lt.textContent = ed.label;
        gEdges.appendChild(lt);
      }
      if (!dashed) {
        anim.push({
          x1: x1, y1: y1, x2: x2, y2: y2,
          rate: ed.rate || 720, dur: Math.hypot(x2 - x1, y2 - y1) / (SPEED[ed.speed] || SPEED.normal),
          kind: ed.kind || (byId[ed.from] && byId[ed.from].kind) || 'proc', particles: [], last: 0
        });
      }
    });

    nodes.forEach(function (nd) {
      var g = el('g', { class: 'flow-node kind-' + (nd.kind || 'proc') });
      g.appendChild(el('rect', { x: nx(nd), y: ny(nd), width: L.NODE_W, height: L.NODE_H, rx: 10, class: 'flow-rect' }));
      var lbl = el('text', { x: nx(nd) + L.NODE_W / 2, y: ny(nd) + L.NODE_H / 2 + (nd.sub ? -2 : 4), class: 'flow-nlabel', 'text-anchor': 'middle' });
      lbl.textContent = nd.label || nd.id;
      g.appendChild(lbl);
      if (nd.sub) {
        var s = el('text', { x: nx(nd) + L.NODE_W / 2, y: ny(nd) + L.NODE_H / 2 + 14, class: 'flow-nsub', 'text-anchor': 'middle' });
        s.textContent = nd.sub;
        g.appendChild(s);
      }
      gNodes.appendChild(g);
    });

    svg.appendChild(gGroups);
    svg.appendChild(gEdges);
    svg.appendChild(gPk);
    svg.appendChild(gNodes);
    svg.style.maxWidth = vbW + 'px'; // 자연 크기 이상으로 확대하지 않음
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
