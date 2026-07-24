/* vm-flow engine — 열 기반 레이아웃 + 텍스트 자동 줄바꿈/가변 높이 + 그룹(subgraph) + rAF 패킷.
   정적 호스팅에서 동작. 의존성 없음. prefers-reduced-motion / IntersectionObserver 존중. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var L = { NODE_W: 146, COL_GAP: 218, ROW_VGAP: 30, MARGIN: 24, MINH: 48 };
  var GPAD = 16, GLABEL = 20;
  var LAB_F = 12.5, LAB_LH = 15, SUB_F = 10, SUB_LH = 12.5, PADY = 9;
  var SPEED = { slow: 55, normal: 92, fast: 150 };
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function chw(ch, f) { return (ch.charCodeAt(0) > 0x2E80 ? 0.98 : 0.56) * f; }
  function estw(s, f) { var w = 0; for (var i = 0; i < s.length; i++) w += chw(s[i], f); return w; }
  // 텍스트를 maxW에 맞춰 줄바꿈(공백·구분자 우선, 안 되면 강제 분할)
  function wrap(str, maxW, f) {
    str = String(str); var lines = [], line = '', brk = -1;
    for (var i = 0; i < str.length; i++) {
      line += str[i];
      if (str[i] === ' ' || '·/,→-)]}'.indexOf(str[i]) >= 0) brk = line.length;
      if (estw(line, f) > maxW && line.length > 1) {
        if (brk > 0 && brk < line.length) { lines.push(line.slice(0, brk).replace(/\s+$/, '')); line = line.slice(brk); }
        else { lines.push(line.slice(0, -1)); line = str[i]; }
        brk = -1;
      }
    }
    if (line.replace(/\s+$/, '')) lines.push(line.replace(/\s+$/, ''));
    return lines.length ? lines : [str];
  }

  function build(container) {
    var specEl = container.querySelector('script.flow-spec');
    if (!specEl || container.dataset.flowReady) return;
    var spec; try { spec = JSON.parse(specEl.textContent); } catch (err) { return; }
    container.dataset.flowReady = '1';
    var nodes = spec.nodes || [], edges = spec.edges || [], groups = spec.groups || [];

    // 1) 각 노드 텍스트 줄바꿈 + 높이 계산
    var maxCol = 0, maxRow = 0, byId = {};
    nodes.forEach(function (nd) {
      nd._lab = wrap(nd.label || nd.id, L.NODE_W - 18, LAB_F);
      nd._sub = nd.sub ? wrap(nd.sub, L.NODE_W - 14, SUB_F) : [];
      var th = nd._lab.length * LAB_LH + (nd._sub.length ? 3 + nd._sub.length * SUB_LH : 0);
      nd._h = Math.max(L.MINH, Math.round(PADY * 2 + th));
      byId[nd.id] = nd;
      maxCol = Math.max(maxCol, nd.col || 0); maxRow = Math.max(maxRow, nd.row || 0);
    });
    // 2) 행별 높이 = 그 행 최대 노드 높이 → 누적 y
    var rowH = [], r;
    for (r = 0; r <= maxRow; r++) rowH[r] = L.MINH;
    nodes.forEach(function (nd) { rowH[nd.row || 0] = Math.max(rowH[nd.row || 0], nd._h); });
    var rowTop = []; rowTop[0] = L.MARGIN;
    for (r = 1; r <= maxRow; r++) rowTop[r] = rowTop[r - 1] + rowH[r - 1] + L.ROW_VGAP;
    var nx = function (nd) { return L.MARGIN + (nd.col || 0) * L.COL_GAP; };
    // 노드 박스(가변 높이, 행 슬롯 내 세로 중앙)
    nodes.forEach(function (nd) {
      var rt = rowTop[nd.row || 0], rh = rowH[nd.row || 0];
      nd._x = nx(nd); nd._y = rt + (rh - nd._h) / 2;
    });
    function nodeBox(nd) { return { x: nd._x, y: nd._y, w: L.NODE_W, h: nd._h }; }

    // 3) 그룹 박스
    var groupBox = {};
    groups.forEach(function (g) {
      var ms = (g.members || []).map(function (id) { return byId[id]; }).filter(Boolean);
      if (!ms.length) return;
      var x1 = Math.min.apply(null, ms.map(function (m) { return m._x; }));
      var y1 = Math.min.apply(null, ms.map(function (m) { return m._y; }));
      var x2 = Math.max.apply(null, ms.map(function (m) { return m._x + L.NODE_W; }));
      var y2 = Math.max.apply(null, ms.map(function (m) { return m._y + m._h; }));
      groupBox[g.id] = { x: x1 - GPAD, y: y1 - GPAD - GLABEL, w: (x2 - x1) + 2 * GPAD, h: (y2 - y1) + 2 * GPAD + GLABEL };
    });
    function boxOf(id) { if (byId[id]) return nodeBox(byId[id]); if (groupBox[id]) return groupBox[id]; return null; }

    // 4) viewBox = 노드+그룹 합집합
    var baseW = L.MARGIN * 2 + maxCol * L.COL_GAP + L.NODE_W;
    var baseH = rowTop[maxRow] + rowH[maxRow] + L.MARGIN;
    var minX = 0, minY = 0, maxX = baseW, maxY = baseH, gid, b;
    for (gid in groupBox) { b = groupBox[gid]; minX = Math.min(minX, b.x); minY = Math.min(minY, b.y); maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h); }
    var vbW = maxX - minX, vbH = maxY - minY;

    var svg = el('svg', { viewBox: minX + ' ' + minY + ' ' + vbW + ' ' + vbH, class: 'flow-svg', role: 'img', 'aria-label': spec.caption || 'flow diagram' });
    var gGroups = el('g', {}), gEdges = el('g', {}), gPk = el('g', { class: 'flow-packets' }), gNodes = el('g', {});

    groups.forEach(function (g) {
      var bx = groupBox[g.id]; if (!bx) return;
      var gg = el('g', {});
      gg.appendChild(el('rect', { x: bx.x, y: bx.y, width: bx.w, height: bx.h, rx: 12, class: 'flow-group-box' }));
      if (g.label) { var t = el('text', { x: bx.x + 12, y: bx.y + 14, class: 'flow-group-label' }); t.textContent = g.label; gg.appendChild(t); }
      gGroups.appendChild(gg);
    });

    var anim = [];
    edges.forEach(function (ed) {
      var a = boxOf(ed.from), bb = boxOf(ed.to); if (!a || !bb) return;
      var x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = bb.x, y2 = bb.y + bb.h / 2;
      var dashed = !!ed.dashed;
      gEdges.appendChild(el('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: 'flow-edge' + (dashed ? ' is-dashed' : '') }));
      var ang = Math.atan2(y2 - y1, x2 - x1), ax = x2 - 8 * Math.cos(ang), ay = y2 - 8 * Math.sin(ang);
      gEdges.appendChild(el('path', { d: 'M ' + x2 + ' ' + y2 + ' L ' + (ax - 4.5 * Math.sin(ang)) + ' ' + (ay + 4.5 * Math.cos(ang)) + ' L ' + (ax + 4.5 * Math.sin(ang)) + ' ' + (ay - 4.5 * Math.cos(ang)) + ' Z', class: 'flow-arrow' }));
      if (ed.label) {
        var lx = (x1 + x2) / 2, ly = (y1 + y2) / 2 - 6, lw = estw(ed.label, 10.5);
        gEdges.appendChild(el('rect', { x: lx - lw / 2 - 3, y: ly - 10, width: lw + 6, height: 13, rx: 3, class: 'flow-elabel-bg' }));
        var lt = el('text', { x: lx, y: ly, class: 'flow-elabel', 'text-anchor': 'middle' }); lt.textContent = ed.label; gEdges.appendChild(lt);
      }
      if (!dashed) anim.push({ x1: x1, y1: y1, x2: x2, y2: y2, rate: ed.rate || 720, dur: Math.hypot(x2 - x1, y2 - y1) / (SPEED[ed.speed] || SPEED.normal), kind: ed.kind || (byId[ed.from] && byId[ed.from].kind) || 'proc', particles: [], last: 0 });
    });

    nodes.forEach(function (nd) {
      var g = el('g', { class: 'flow-node kind-' + (nd.kind || 'proc') });
      g.appendChild(el('rect', { x: nd._x, y: nd._y, width: L.NODE_W, height: nd._h, rx: 10, class: 'flow-rect' }));
      var th = nd._lab.length * LAB_LH + (nd._sub.length ? 3 + nd._sub.length * SUB_LH : 0);
      var ty = nd._y + (nd._h - th) / 2 + LAB_F - 1;
      nd._lab.forEach(function (ln, i) { var t = el('text', { x: nd._x + L.NODE_W / 2, y: ty + i * LAB_LH, class: 'flow-nlabel', 'text-anchor': 'middle' }); t.textContent = ln; g.appendChild(t); });
      var sy = ty + nd._lab.length * LAB_LH + 1;
      nd._sub.forEach(function (ln, i) { var t = el('text', { x: nd._x + L.NODE_W / 2, y: sy + i * SUB_LH, class: 'flow-nsub', 'text-anchor': 'middle' }); t.textContent = ln; g.appendChild(t); });
      gNodes.appendChild(g);
    });

    svg.appendChild(gGroups); svg.appendChild(gEdges); svg.appendChild(gPk); svg.appendChild(gNodes);
    svg.style.maxWidth = Math.round(vbW) + 'px'; // 자연 크기 상한(본문 폭에 맞춰 축소 → 전체가 다 보임)
    container.insertBefore(svg, container.firstChild);

    if (REDUCE || !anim.length) return;
    var running = false, rafId = 0, prev = 0;
    function frame(ts) {
      if (!prev) prev = ts; var dt = Math.min((ts - prev) / 1000, 0.05); prev = ts; var buf = '';
      for (var i = 0; i < anim.length; i++) {
        var e = anim[i]; e.last += dt * 1000;
        if (e.last >= e.rate) { e.last = 0; e.particles.push({ t: 0 }); }
        for (var j = 0; j < e.particles.length; j++) e.particles[j].t += dt / e.dur;
        e.particles = e.particles.filter(function (p) { return p.t <= 1; });
        for (var k = 0; k < e.particles.length; k++) { var p = e.particles[k], x = e.x1 + (e.x2 - e.x1) * p.t, y = e.y1 + (e.y2 - e.y1) * p.t, op = p.t < 0.14 ? p.t / 0.14 : (p.t > 0.86 ? (1 - p.t) / 0.14 : 1); buf += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3.5" class="pk-' + e.kind + '" opacity="' + op.toFixed(2) + '"/>'; }
      }
      gPk.innerHTML = buf; rafId = requestAnimationFrame(frame);
    }
    function start() { if (running) return; running = true; prev = 0; rafId = requestAnimationFrame(frame); }
    function stop() { running = false; cancelAnimationFrame(rafId); }
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { es.forEach(function (e) { e.isIntersecting ? start() : stop(); }); }, { threshold: 0.15 }).observe(container);
    else start();
  }

  function init() { var l = document.querySelectorAll('.vm-flow'); for (var i = 0; i < l.length; i++) build(l[i]); }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
