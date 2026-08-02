/* vm-mnode engine — MultiNode 와 SingleNode 가 갈리는 지점.
   bscore 와 같은 phase-stepped 상태머신(단계당 ~2.2초, computeFrame 은 순수 함수).
   ① SavingsRatio 정렬 → ② 예산 컷 → ③ MultiNode 가 묶어서 시도 →
   ④ 성공하면 SingleNode 는 그 라운드에 안 돈다 → ⑤ 빈손이었다면 한 대씩
   정적 호스팅에서 동작. prefers-reduced-motion / IntersectionObserver 존중. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var W = 840, H = 340;
  var PHASE_MS = 2200, PHASE_COUNT = 5;
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 후보 5대. from = 정렬 전 자리, to = SavingsRatio 내림차순 자리 */
  var NODES = [
    { id: 'A', ratio: 0.11, from: 0, to: 2 },
    { id: 'B', ratio: 0.19, from: 1, to: 0 },
    { id: 'C', ratio: 0.05, from: 2, to: 4 },
    { id: 'D', ratio: 0.16, from: 3, to: 1 },
    { id: 'E', ratio: 0.08, from: 4, to: 3 }
  ];
  var MAX_RATIO = 0.20;
  var BUDGET = 3;          /* 이 풀에 허용된 disruption 수 — 뒤 2대는 탐색 전에 빠진다 */

  var CAPTIONS = [
    '① 후보를 Price / RescheduleDisruptionCost 내림차순으로 세운다 — 비싸면서 한산한 노드가 앞',
    '② 예산이 먼저 자른다 — 허용치를 넘는 뒤쪽 후보는 시뮬레이션도 해보지 않는다',
    '③ MultiNode 는 앞에서부터 여러 대를 묶어 한 번에 시뮬레이션한다',
    '④ 성공하면 커맨드 하나가 나오고 거기서 끝 — SingleNode 는 그 라운드에 아예 돌지 않는다',
    '⑤ MultiNode 가 빈손일 때만 SingleNode 로 내려가 한 대씩 본다 (3분 타임아웃)'
  ];
  var GLYPHS = ['①', '②', '③', '④', '⑤'];
  var STATIC_CAPTION = 'MultiNode 가 먼저 돌고, 성공하면 SingleNode 는 그 라운드를 건너뛴다. 예산은 탐색 전에 후보 풀 자체를 자른다';

  function el(tag, a) { var e = document.createElementNS(NS, tag); for (var k in a) e.setAttribute(k, a[k]); return e; }
  function txt(x, y, s, cls, anchor) {
    var t = el('text', { x: x, y: y, class: cls || 'mn-t' });
    if (anchor) t.setAttribute('text-anchor', anchor);
    t.textContent = s; return t;
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function ease(t) { return 1 - Math.pow(1 - t, 3); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function winP(t, s, e) { return clamp01((t - s) / (e - s)); }

  var CARD_W = 124, CARD_H = 58, GAP = 16, ROW_Y = 62;
  function slotX(i) { return 26 + i * (CARD_W + GAP); }
  var MN_Y = 168, SN_Y = 248;   /* MultiNode / SingleNode 레인 */

  function computeFrame(phase, t) {
    var f = {
      phase: phase, sortP: 0, barP: 0,
      cutCount: 0, budgetOp: 0,
      batchN: 0, batchOp: 0, mnLabel: '', mnState: '',
      cmdOp: 0, snDim: 0, snOp: 0, snIdx: -1, snLabel: '', altOp: 0
    };
    if (phase === 0) {
      f.barP = ease(winP(t, 0.05, 0.4));
      f.sortP = ease(winP(t, 0.35, 0.9));
    } else if (phase === 1) {
      f.barP = 1; f.sortP = 1;
      f.budgetOp = ease(winP(t, 0.05, 0.35));
      f.cutCount = t > 0.45 ? NODES.length - BUDGET : 0;
    } else if (phase === 2) {
      f.barP = 1; f.sortP = 1; f.budgetOp = 1; f.cutCount = NODES.length - BUDGET;
      f.batchOp = ease(winP(t, 0.05, 0.25));
      /* 2대 묶음 → 3대 묶음으로 넓힌다 */
      f.batchN = t < 0.5 ? 2 : 3;
      f.mnLabel = t < 0.5 ? '2대를 묶어 시뮬레이션' : '3대를 묶어 시뮬레이션';
      f.mnState = 'try';
    } else if (phase === 3) {
      f.barP = 1; f.sortP = 1; f.budgetOp = 1; f.cutCount = NODES.length - BUDGET;
      f.batchOp = 1; f.batchN = 3;
      f.mnLabel = '3대 → 새 노드 1대'; f.mnState = 'ok';
      f.cmdOp = ease(winP(t, 0.1, 0.45));
      f.snDim = winP(t, 0.45, 0.7);
      f.snLabel = '이 라운드엔 돌지 않는다';
    } else {
      f.barP = 1; f.sortP = 1; f.budgetOp = 1; f.cutCount = NODES.length - BUDGET;
      f.batchOp = 1; f.batchN = 3;
      f.mnLabel = '빈손 — 커맨드 없음'; f.mnState = 'fail';
      f.altOp = ease(winP(t, 0.02, 0.2));
      f.snOp = ease(winP(t, 0.15, 0.35));
      /* 한 대씩 훑는다 */
      f.snIdx = t < 0.4 ? 0 : t < 0.65 ? 1 : 2;
      f.snLabel = '한 대씩 — 3분 타임아웃';
    }
    return f;
  }

  function build(container) {
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'mn-svg', role: 'img', 'aria-label': STATIC_CAPTION });

    var steps = el('g', {});
    for (var i = 0; i < PHASE_COUNT; i++) steps.appendChild(txt(26 + i * 26, 26, GLYPHS[i], 'mn-step'));
    svg.appendChild(steps);
    svg.appendChild(txt(W - 26, 26, 'Price / RescheduleDisruptionCost 내림차순', 'mn-hint', 'end'));

    /* 묶음 박스 — 카드 뒤에 깔린다 */
    var batch = el('rect', { x: slotX(0) - 8, y: ROW_Y - 10, width: 0, height: CARD_H + 20, rx: 12, class: 'mn-batch', opacity: 0 });
    svg.appendChild(batch);

    /* 후보 카드 */
    var cards = [];
    NODES.forEach(function (n) {
      var g = el('g', {});
      g.appendChild(el('rect', { x: 0, y: ROW_Y, width: CARD_W, height: CARD_H, rx: 9, class: 'mn-card' }));
      g.appendChild(txt(12, ROW_Y + 21, '노드 ' + n.id, 'mn-name'));
      g.appendChild(txt(CARD_W - 12, ROW_Y + 21, n.ratio.toFixed(2), 'mn-ratio', 'end'));
      g.appendChild(el('rect', { x: 12, y: ROW_Y + 32, width: CARD_W - 24, height: 8, rx: 4, class: 'mn-track' }));
      var fill = el('rect', { x: 12, y: ROW_Y + 32, width: 0, height: 8, rx: 4, class: 'mn-fill' });
      g.appendChild(fill);
      svg.appendChild(g);
      cards.push({ g: g, fill: fill, n: n, rect: g.querySelector('rect') });
    });

    var budget = el('g', { opacity: 0 });
    var bx = slotX(BUDGET) - GAP / 2;
    budget.appendChild(el('line', { x1: bx, y1: ROW_Y - 16, x2: bx, y2: ROW_Y + CARD_H + 16, class: 'mn-budgetline' }));
    budget.appendChild(txt(bx + 8, ROW_Y - 22, '예산 ' + BUDGET + ' — 여기까지', 'mn-budgetlabel'));
    svg.appendChild(budget);

    /* MultiNode 레인 */
    svg.appendChild(txt(26, MN_Y + 4, 'MultiNode', 'mn-lane'));
    var mnPill = el('rect', { x: 150, y: MN_Y - 14, width: 260, height: 26, rx: 13, class: 'mn-pill', opacity: 0 });
    svg.appendChild(mnPill);
    var mnTx = txt(162, MN_Y + 4, '', 'mn-pilltext'); svg.appendChild(mnTx);

    var cmd = el('g', { opacity: 0 });
    cmd.appendChild(el('rect', { x: 440, y: MN_Y - 18, width: 200, height: 34, rx: 9, class: 'mn-cmd' }));
    cmd.appendChild(txt(452, MN_Y + 5, 'Command 1건 — 교체', 'mn-cmdtext'));
    svg.appendChild(cmd);
    var stop = txt(660, MN_Y + 5, '여기서 라운드 끝', 'mn-stop'); stop.setAttribute('opacity', 0); svg.appendChild(stop);

    /* SingleNode 레인 */
    var snLane = el('g', {});
    snLane.appendChild(txt(26, SN_Y + 4, 'SingleNode', 'mn-lane'));
    svg.appendChild(snLane);
    var snPill = el('rect', { x: 150, y: SN_Y - 14, width: 260, height: 26, rx: 13, class: 'mn-pill', opacity: 0 });
    svg.appendChild(snPill);
    var snTx = txt(162, SN_Y + 4, '', 'mn-pilltext'); svg.appendChild(snTx);
    var alt = txt(440, SN_Y + 5, 'MultiNode 가 빈손일 때만 여기로', 'mn-alt'); alt.setAttribute('opacity', 0); svg.appendChild(alt);

    /* 한 대씩 스캔할 때 현재 보고 있는 후보를 가리키는 표식 */
    var scan = el('rect', { x: slotX(0) - 4, y: ROW_Y - 6, width: CARD_W + 8, height: CARD_H + 12, rx: 11, class: 'mn-scan', opacity: 0 });
    svg.appendChild(scan);

    container.insertBefore(svg, container.firstChild);
    var cap = container.querySelector('.mn-caption');
    if (cap && !cap.textContent.trim()) cap.textContent = STATIC_CAPTION;

    var lastPhase = -1;
    function paintSteps(p) {
      if (lastPhase === p) return;
      lastPhase = p;
      var ns = steps.querySelectorAll('text');
      for (var i = 0; i < ns.length; i++) ns[i].setAttribute('class', i === p ? 'mn-step mn-step-on' : 'mn-step');
      if (cap) cap.textContent = CAPTIONS[p];
    }

    function paint(f) {
      cards.forEach(function (c) {
        var x = lerp(slotX(c.n.from), slotX(c.n.to), f.sortP);
        c.g.setAttribute('transform', 'translate(' + x.toFixed(1) + ',0)');
        c.fill.setAttribute('width', (CARD_W - 24) * (c.n.ratio / MAX_RATIO) * f.barP);
        var cut = f.cutCount > 0 && c.n.to >= (NODES.length - f.cutCount);
        c.g.setAttribute('opacity', cut ? 0.3 : 1);
        c.rect.setAttribute('class', cut ? 'mn-card mn-card-cut' : 'mn-card');
      });

      budget.setAttribute('opacity', f.budgetOp);

      if (f.batchN > 0) {
        var w = slotX(f.batchN - 1) + CARD_W - slotX(0) + 16;
        batch.setAttribute('width', w);
        batch.setAttribute('opacity', f.batchOp);
        batch.setAttribute('class', f.mnState === 'fail' ? 'mn-batch mn-batch-fail' : f.mnState === 'ok' ? 'mn-batch mn-batch-ok' : 'mn-batch');
      } else batch.setAttribute('opacity', 0);

      var mnOn = f.mnLabel !== '';
      mnPill.setAttribute('opacity', mnOn ? 1 : 0);
      mnPill.setAttribute('class', f.mnState === 'fail' ? 'mn-pill mn-pill-fail' : f.mnState === 'ok' ? 'mn-pill mn-pill-ok' : 'mn-pill');
      mnTx.textContent = f.mnLabel;
      mnTx.setAttribute('opacity', mnOn ? 1 : 0);

      cmd.setAttribute('opacity', f.cmdOp);
      stop.setAttribute('opacity', f.cmdOp > 0.6 ? f.snDim : 0);

      var snActive = f.snOp > 0;
      snLane.setAttribute('opacity', snActive ? 1 : (f.snDim > 0 ? 1 - f.snDim * 0.65 : 1));
      snPill.setAttribute('opacity', f.snLabel ? (snActive ? f.snOp : f.snDim) : 0);
      snPill.setAttribute('class', snActive ? 'mn-pill' : 'mn-pill mn-pill-off');
      snTx.textContent = f.snLabel || '';
      snTx.setAttribute('opacity', f.snLabel ? (snActive ? f.snOp : f.snDim) : 0);
      snTx.setAttribute('class', snActive ? 'mn-pilltext' : 'mn-pilltext mn-pilltext-off');
      alt.setAttribute('opacity', f.altOp);

      if (f.snIdx >= 0) {
        scan.setAttribute('opacity', f.snOp);
        scan.setAttribute('x', slotX(f.snIdx) - 4);
      } else scan.setAttribute('opacity', 0);
    }

    function done() { paintSteps(3); paint(computeFrame(3, 1)); if (cap) cap.textContent = STATIC_CAPTION; }

    if (REDUCE) { done(); return; }
    var rafId = 0, running = false, t0 = 0;
    function frame(ts) {
      if (!t0) t0 = ts;
      var total = (ts - t0) % (PHASE_MS * PHASE_COUNT);
      var p = Math.floor(total / PHASE_MS);
      paintSteps(p);
      paint(computeFrame(p, (total % PHASE_MS) / PHASE_MS));
      rafId = requestAnimationFrame(frame);
    }
    function start() { if (running) return; running = true; rafId = requestAnimationFrame(frame); }
    function stop2() { running = false; cancelAnimationFrame(rafId); }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) { e.isIntersecting ? start() : stop2(); });
      }, { threshold: 0.25 }).observe(container);
    } else start();
  }

  function init() { var l = document.querySelectorAll('.vm-mnode'); for (var i = 0; i < l.length; i++) build(l[i]); }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
