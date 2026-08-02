/* vm-mnode engine — 노드를 지우고 그 위 파드를 새 노드로 옮기는 과정.
   variant: single(한 대만) · multi(앞에서부터 여러 대를 묶어서)
   둘은 "앞에서 몇 대를 집는가" 하나만 다른 같은 기계다. 개념은 single 이 쉽고,
   실행 순서는 반대로 multi 가 먼저다 — 그건 본문이 말한다.
   phase-stepped 상태머신(단계당 2.6초, computeFrame 은 (phase,t)의 순수 함수).
   ① 후보와 그 위 파드 → ② Price/RDCost 로 줄 세우기 → ③ 집어서 시뮬레이션 →
   ④ 새 노드 기동, 파드가 하나씩 넘어가며 cost 가 쌓인다 → ⑤ 옛 노드 반납
   cost 는 추상 점수가 아니라 "노드 몇 대를 비우고 파드 몇 개를 옮기는가" 그 자체로 보인다.
   정적 호스팅에서 동작. prefers-reduced-motion / IntersectionObserver 존중. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var W = 880, H = 384;
  var PHASE_MS = 2600, PHASE_COUNT = 5;
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 후보 4대는 두 variant 가 공유한다 — 같은 클러스터를 두 방식으로 보는 그림이다.
     rd = 노드 몫 1.0 + 파드 수, ratio = price / rd.  from = 정렬 전 자리, to = ratio 내림차순 자리 */
  var NODES = [
    { id: 'A', price: 0.768, pods: 3, from: 2, to: 0 },
    { id: 'B', price: 0.384, pods: 2, from: 0, to: 1 },
    { id: 'C', price: 0.384, pods: 3, from: 3, to: 2 },
    { id: 'D', price: 0.192, pods: 5, from: 1, to: 3 }
  ];
  NODES.forEach(function (n) { n.rd = 1 + n.pods; n.ratio = n.price / n.rd; });

  var VARIANTS = {
    single: { batch: 1, newPrice: 0.384, meterMax: 6, lane: 'SingleNode' },
    multi: { batch: 3, newPrice: 0.768, meterMax: 12, lane: 'MultiNode' }
  };

  var GLYPHS = ['①', '②', '③', '④', '⑤'];

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

  /* ── 레이아웃 ── */
  var CARD_W = 150, CARD_H = 108, GAP = 16, ROW_Y = 62;
  function slotX(i) { return 26 + i * (CARD_W + GAP); }
  var NEWX = slotX(4) + 16;
  var POD_R = 7, POD_COLS = 4, POD_X0 = 18, POD_DX = 22, POD_Y0 = 50, POD_DY = 22;
  function podX(cardX, i) { return cardX + POD_X0 + (i % POD_COLS) * POD_DX; }
  function podY(i) { return ROW_Y + POD_Y0 + Math.floor(i / POD_COLS) * POD_DY; }
  var METER = { x: 26, y: 218, w: 520, h: 24 };
  var LANE_Y = 306;

  function makeCfg(variant) {
    var v = VARIANTS[variant] || VARIANTS.single;
    var picked = NODES.filter(function (n) { return n.to < v.batch; })
      .sort(function (a, b) { return a.to - b.to; });
    var flight = [];
    picked.forEach(function (n) { for (var i = 0; i < n.pods; i++) flight.push({ node: n, idx: i }); });
    var oldSum = picked.reduce(function (s, n) { return s + n.price; }, 0);
    var one = v.batch === 1;
    return {
      variant: variant, batch: v.batch, lane: v.lane, picked: picked, flight: flight,
      movePods: flight.length,
      totalRd: picked.reduce(function (s, n) { return s + n.rd; }, 0),
      oldSum: oldSum, newPrice: v.newPrice, savings: oldSum - v.newPrice,
      meterMax: v.meterMax, unitW: METER.w / v.meterMax, one: one,
      captions: [
        '① 후보와 그 위의 파드 — 옮겨야 할 파드가 곧 그 노드의 무게다 (DaemonSet은 세지 않는다)',
        '② Price / RescheduleDisruptionCost 로 줄을 세운다 — 비싸면서 한산한 노드가 앞으로',
        one ? '③ SingleNode 는 맨 앞 한 대만 집어 시뮬레이션한다 — 이 파드 ' + flight.length + '개가 다 들어가나?'
            : '③ MultiNode 는 앞에서부터 세 대를 한꺼번에 집는다 — 파드 ' + flight.length + '개가 다 들어가나?',
        '④ 새 노드 한 대를 띄우고 파드를 옮긴다 — cost 가 실제로는 이 일이다',
        one ? '⑤ 옛 노드 한 대를 반납한다. 한 번에 한 대씩이라 여러 대를 합칠 기회는 놓친다'
            : '⑤ 옛 노드 세 대를 한 대로 접었다. 한 대씩 봤다면 나오지 않았을 커맨드다'
      ],
      still: one
        ? 'SingleNode — 한 대를 지우고 그 파드를 새 노드로 옮긴다. cost 는 노드 몫 1.0 에 옮긴 파드 수를 더한 값이다'
        : 'MultiNode — 여러 대를 한 대로 접는다. 묶은 만큼 cost 도 합산되지만, 한 대씩으로는 나오지 않을 절감을 만든다'
    };
  }

  function build(container) {
    var cfg = makeCfg(container.getAttribute('data-variant') || 'single');
    var FLIGHT = cfg.flight, BATCH = cfg.batch;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'mn-svg', role: 'img', 'aria-label': cfg.still });
    var i;

    function computeFrame(phase, t) {
      var f = {
        cardsOp: 0, podsP: 0, ratioOp: 0, sortP: 0,
        batchN: 0, batchOp: 0, batchState: '',
        newOp: 0, flightP: [], landed: 0, meterUnits: 0,
        oldFade: 0, savOp: 0, laneDone: false
      };
      var j;
      if (phase === 0) {
        f.cardsOp = ease(winP(t, 0.05, 0.35));
        f.podsP = ease(winP(t, 0.3, 0.85));
      } else if (phase === 1) {
        f.cardsOp = 1; f.podsP = 1;
        f.ratioOp = ease(winP(t, 0.05, 0.3));
        f.sortP = ease(winP(t, 0.35, 0.9));
      } else if (phase === 2) {
        f.cardsOp = 1; f.podsP = 1; f.ratioOp = 1; f.sortP = 1;
        f.batchOp = ease(winP(t, 0.05, 0.3));
        f.batchN = BATCH; f.batchState = 'try';
        f.meterUnits = Math.min(BATCH, winP(t, 0.35, 0.9) * (BATCH + 0.999));
      } else if (phase === 3) {
        f.cardsOp = 1; f.podsP = 1; f.ratioOp = 1; f.sortP = 1;
        f.batchOp = 1; f.batchN = BATCH; f.batchState = 'ok';
        f.newOp = ease(winP(t, 0.02, 0.18));
        /* 파드가 겹쳐 날아간다 — 개수가 적으면 넉넉히, 많으면 촘촘히 */
        var step = FLIGHT.length > 4 ? 0.075 : 0.16;
        var landed = 0;
        for (j = 0; j < FLIGHT.length; j++) {
          var s = 0.22 + j * step;
          var p = ease(winP(t, s, s + 0.32));
          f.flightP.push(p);
          if (p >= 1) landed++;
        }
        f.landed = landed;
        f.meterUnits = BATCH + landed;
      } else {
        f.cardsOp = 1; f.podsP = 1; f.ratioOp = 1; f.sortP = 1;
        f.batchOp = 1 - winP(t, 0.1, 0.4); f.batchN = BATCH; f.batchState = 'ok';
        f.newOp = 1;
        for (j = 0; j < FLIGHT.length; j++) f.flightP.push(1);
        f.landed = FLIGHT.length;
        f.meterUnits = cfg.totalRd;
        f.oldFade = ease(winP(t, 0.05, 0.4));
        f.savOp = winP(t, 0.35, 0.55);
        f.laneDone = t > 0.5;
      }
      return f;
    }

    var steps = el('g', {});
    for (i = 0; i < PHASE_COUNT; i++) steps.appendChild(txt(26 + i * 26, 26, GLYPHS[i], 'mn-step'));
    svg.appendChild(steps);
    svg.appendChild(txt(W - 26, 26, cfg.lane, 'mn-badge', 'end'));

    var batch = el('rect', { x: slotX(0) - 8, y: ROW_Y - 10, width: 0, height: CARD_H + 20, rx: 12, class: 'mn-batch', opacity: 0 });
    svg.appendChild(batch);

    /* 새 노드 */
    var newG = el('g', { opacity: 0 });
    newG.appendChild(el('rect', { x: NEWX, y: ROW_Y, width: CARD_W, height: CARD_H, rx: 10, class: 'mn-card mn-card-new' }));
    newG.appendChild(txt(NEWX + 12, ROW_Y + 22, '새 노드', 'mn-name'));
    newG.appendChild(txt(NEWX + CARD_W - 12, ROW_Y + 22, '$' + cfg.newPrice.toFixed(3), 'mn-price', 'end'));
    newG.appendChild(txt(NEWX + 12, ROW_Y + CARD_H - 10, '파드 ' + cfg.movePods + '개를 받는다', 'mn-sub'));
    svg.appendChild(newG);
    var landG = el('g', {});
    for (i = 0; i < cfg.movePods; i++) {
      landG.appendChild(el('circle', { cx: podX(NEWX, i), cy: podY(i), r: POD_R, class: 'mn-pod mn-pod-new', opacity: 0 }));
    }
    svg.appendChild(landG);

    /* 후보 카드 */
    var cards = [];
    NODES.forEach(function (n) {
      var g = el('g', { opacity: 0 });
      var rect = el('rect', { x: 0, y: ROW_Y, width: CARD_W, height: CARD_H, rx: 10, class: 'mn-card' });
      g.appendChild(rect);
      g.appendChild(txt(12, ROW_Y + 22, '노드 ' + n.id, 'mn-name'));
      g.appendChild(txt(CARD_W - 12, ROW_Y + 22, '$' + n.price.toFixed(3), 'mn-price', 'end'));
      var pods = [];
      for (var k = 0; k < n.pods; k++) {
        var c = el('circle', { cx: POD_X0 + (k % POD_COLS) * POD_DX, cy: podY(k) - ROW_Y, r: POD_R, class: 'mn-pod', opacity: 0 });
        g.appendChild(c); pods.push(c);
      }
      var rt = txt(12, ROW_Y + CARD_H - 10, '', 'mn-sub'); rt.setAttribute('opacity', 0); g.appendChild(rt);
      var rv = txt(CARD_W - 12, ROW_Y + CARD_H - 10, '', 'mn-ratio', 'end'); rv.setAttribute('opacity', 0); g.appendChild(rv);
      svg.appendChild(g);
      cards.push({ g: g, rect: rect, pods: pods, rt: rt, rv: rv, n: n });
    });

    var flyG = el('g', {});
    for (i = 0; i < FLIGHT.length; i++) {
      flyG.appendChild(el('circle', { cx: podX(slotX(0), 0), cy: podY(0), r: POD_R, class: 'mn-pod mn-pod-fly', opacity: 0 }));
    }
    svg.appendChild(flyG);

    /* cost 미터 */
    svg.appendChild(txt(METER.x, METER.y - 9, 'RescheduleDisruptionCost — 실제로 하는 일', 'mn-lane'));
    svg.appendChild(el('rect', { x: METER.x, y: METER.y, width: METER.w, height: METER.h, rx: 6, class: 'mn-track' }));
    var meterG = el('g', {});
    for (i = 0; i < cfg.meterMax; i++) {
      meterG.appendChild(el('rect', {
        x: METER.x + i * cfg.unitW + 2, y: METER.y + 2, width: cfg.unitW - 4, height: METER.h - 4, rx: 3,
        class: i < BATCH ? 'mn-unit mn-unit-node' : 'mn-unit', opacity: 0
      }));
    }
    svg.appendChild(meterG);
    var meterTx = txt(METER.x + METER.w + 14, METER.y + 17, '', 'mn-val'); svg.appendChild(meterTx);
    var meterNote = txt(METER.x, METER.y + METER.h + 20, '', 'mn-sub'); svg.appendChild(meterNote);

    /* 결과 */
    var resultPill = el('rect', { x: 26, y: LANE_Y - 17, width: 330, height: 32, rx: 16, class: 'mn-pill', opacity: 0 });
    svg.appendChild(resultPill);
    var resultTx = txt(42, LANE_Y + 4, '', 'mn-pilltext'); svg.appendChild(resultTx);
    var savTx = txt(W - 26, LANE_Y + 4, '', 'mn-sav', 'end'); savTx.setAttribute('opacity', 0); svg.appendChild(savTx);

    container.insertBefore(svg, container.firstChild);
    var cap = container.querySelector('.mn-caption');
    var fixed = cap && cap.textContent.trim();
    if (cap && !fixed) cap.textContent = cfg.still;

    var lastPhase = -1;
    function paintSteps(p) {
      if (lastPhase === p) return;
      lastPhase = p;
      var ns = steps.querySelectorAll('text');
      for (var j = 0; j < ns.length; j++) ns[j].setAttribute('class', j === p ? 'mn-step mn-step-on' : 'mn-step');
      if (cap && !fixed) cap.textContent = cfg.captions[p];
    }

    function paint(f) {
      var j, k;
      cards.forEach(function (c) {
        var x = lerp(slotX(c.n.from), slotX(c.n.to), f.sortP);
        var picked = c.n.to < BATCH;
        c.g.setAttribute('transform', 'translate(' + x.toFixed(1) + ',0)');
        c.g.setAttribute('opacity', (picked ? 1 - f.oldFade * 0.72 : 1) * f.cardsOp);
        c.rect.setAttribute('class', picked && f.oldFade > 0.4 ? 'mn-card mn-card-gone' : 'mn-card');
        var flown = 0;
        for (k = 0; k < FLIGHT.length; k++) if (FLIGHT[k].node === c.n && f.flightP[k] > 0.02) flown++;
        for (k = 0; k < c.pods.length; k++) c.pods[k].setAttribute('opacity', (picked && k < flown) ? 0 : f.podsP);
        c.rt.setAttribute('opacity', f.ratioOp);
        c.rt.textContent = 'cost ' + c.n.rd.toFixed(1);
        c.rv.setAttribute('opacity', f.ratioOp);
        c.rv.textContent = c.n.ratio.toFixed(3);
      });

      if (f.batchN > 0) {
        batch.setAttribute('width', slotX(f.batchN - 1) + CARD_W - slotX(0) + 16);
        batch.setAttribute('opacity', f.batchOp);
        batch.setAttribute('class', f.batchState === 'ok' ? 'mn-batch mn-batch-ok' : 'mn-batch');
      } else batch.setAttribute('opacity', 0);

      newG.setAttribute('opacity', f.newOp);

      var flys = flyG.querySelectorAll('circle'), lands = landG.querySelectorAll('circle');
      for (j = 0; j < FLIGHT.length; j++) {
        var p = f.flightP[j] || 0;
        var src = FLIGHT[j], sx = lerp(slotX(src.node.from), slotX(src.node.to), f.sortP);
        var x0 = podX(sx, src.idx), y0 = podY(src.idx);
        var x1 = podX(NEWX, j), y1 = podY(j);
        /* 안 보이는 동안에도 좌표는 유효하게 둔다 — 대기 위치가 viewBox 밖이면 안 된다 */
        flys[j].setAttribute('cx', lerp(x0, x1, p));
        flys[j].setAttribute('cy', lerp(y0, y1, p) - Math.sin(p * Math.PI) * 26);
        flys[j].setAttribute('opacity', p > 0.001 && p < 1 ? 1 : 0);
        lands[j].setAttribute('opacity', p >= 1 ? 1 : 0);
      }

      var us = meterG.querySelectorAll('rect');
      for (j = 0; j < us.length; j++) {
        var full = f.meterUnits - j;
        us[j].setAttribute('opacity', full <= 0 ? 0 : 1);
        us[j].setAttribute('width', Math.max(0, Math.min(1, full)) * (cfg.unitW - 4));
      }
      meterTx.textContent = f.meterUnits > 0.02 ? f.meterUnits.toFixed(1) : '';
      meterNote.textContent = f.meterUnits > 0.02
        ? '노드 ' + Math.min(BATCH, Math.ceil(f.meterUnits)) + '대 × 1.0  +  옮긴 파드 ' + f.landed + '개 × 1.0'
        : '';

      resultPill.setAttribute('opacity', f.laneDone ? 1 : 0);
      resultPill.setAttribute('class', f.laneDone ? 'mn-pill mn-pill-ok' : 'mn-pill');
      resultTx.setAttribute('opacity', f.laneDone ? 1 : 0);
      resultTx.textContent = cfg.one
        ? '노드 1대 → 1대 · 커맨드 1건'
        : '노드 ' + BATCH + '대 → 1대 · 커맨드 1건';
      savTx.setAttribute('opacity', f.savOp);
      savTx.textContent = 'savings  $' + cfg.oldSum.toFixed(3) + ' − $' + cfg.newPrice.toFixed(3) + ' = $' + cfg.savings.toFixed(3) + '/h';
    }

    function done() { paintSteps(PHASE_COUNT - 1); paint(computeFrame(PHASE_COUNT - 1, 1)); if (cap && !fixed) cap.textContent = cfg.still; }

    if (REDUCE) { done(); return; }
    var rafId = 0, running = false, t0 = -1;
    function frame(ts) {
      /* 0 은 유효한 타임스탬프다 — falsy 검사로는 첫 프레임이 0 일 때 영영 안 걸린다 */
      if (t0 < 0) t0 = ts;
      var total = (ts - t0) % (PHASE_MS * PHASE_COUNT);
      var p = Math.floor(total / PHASE_MS);
      paintSteps(p);
      paint(computeFrame(p, (total % PHASE_MS) / PHASE_MS));
      rafId = requestAnimationFrame(frame);
    }
    function start() { if (running) return; running = true; rafId = requestAnimationFrame(frame); }
    function halt() { running = false; cancelAnimationFrame(rafId); }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) { e.isIntersecting ? start() : halt(); });
      }, { threshold: 0.25 }).observe(container);
    } else start();
  }

  function init() { var l = document.querySelectorAll('.vm-mnode'); for (var i = 0; i < l.length; i++) build(l[i]); }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
