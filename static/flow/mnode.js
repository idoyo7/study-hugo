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
  /* 가격은 ap-northeast-2 온디맨드 Linux 실가 (AWS pricing API) */
  var VCPU_MAX = 16;
  var NODES = [
    { id: 'A', type: 'm8g.4xlarge', vcpu: 16, price: 0.8827, pods: 3, to: 0 },
    { id: 'B', type: 'm8g.2xlarge', vcpu: 8, price: 0.4414, pods: 2, to: 1 },
    /* B 와 크기·가격이 같은데 파드가 많아 뒤로 밀린다 — 순서를 가르는 게 파드라는 증거 */
    { id: 'C', type: 'm8g.2xlarge', vcpu: 8, price: 0.4414, pods: 3, to: 2 },
    { id: 'D', type: 'm8g.xlarge', vcpu: 4, price: 0.2207, pods: 5, to: 3 }
  ];
  NODES.forEach(function (n) { n.rd = 1 + n.pods; n.ratio = n.price / n.rd; });

  /* cost 는 "값이 어디서 나오나" 전용 — 후보를 집지 않는다(batch 0).
     single·multi 는 그 결과(정렬된 목록)를 전제로 시작한다. */
  /* multi 의 교체 노드는 일부러 다른 패밀리다 — 옛 세 대의 메모리 합(128 GiB)은 그대로 두고
     vCPU 만 32 -> 16 으로 줄인다. 교체는 같은 패밀리일 필요가 없다. */
  var VARIANTS = {
    single: { batch: 1, newType: 'm8g.2xlarge', newVcpu: 8, newPrice: 0.4414, meterMax: 6, lane: 'SingleNode' },
    multi: { batch: 3, newType: 'r8g.4xlarge', newVcpu: 16, newPrice: 1.1370, meterMax: 12, lane: 'MultiNode' }
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
    var totalRd = picked.reduce(function (s, n) { return s + n.rd; }, 0);
    return {
      variant: variant, batch: v.batch, lane: v.lane, picked: picked, flight: flight,
      movePods: flight.length,
      totalRd: totalRd, newType: v.newType, newVcpu: v.newVcpu,
      oldSum: oldSum, newPrice: v.newPrice, savings: oldSum - v.newPrice,
      meterMax: v.meterMax, unitW: METER.w / v.meterMax, one: one, phases: 4,
      captions: [
        (one ? '① 정렬된 후보에서 맨 앞 한 대를 집는다' : '① 정렬된 후보에서 앞 세 대를 한꺼번에 집는다')
          + ' — 이 순간 cost 합계 ' + totalRd.toFixed(1) + ' 이 확정된다 (옅은 칸)',
        '② 가상으로 지워보고 파드를 다시 스케줄해본다 — 점선이 시뮬레이션이 앉혀본 자리다',
        '③ 실제로 새 노드를 띄우고 파드를 옮긴다 — 확정돼 있던 cost 를 하나씩 치른다 (진한 칸)',
        one ? '④ 옛 노드 한 대를 반납한다. 한 번에 한 대씩이라 여러 대를 합칠 기회는 놓친다'
            : '④ 옛 노드 세 대를 r8g 한 대로 접었다 — 교체 노드는 같은 패밀리일 필요가 없다. 메모리 128GiB는 그대로, vCPU만 32→16'
      ],
      still: one
          ? 'SingleNode — 맨 앞 한 대를 집어 그 파드를 새 노드로 옮긴다. cost 는 집는 순간 확정되고 옮기면서 치러진다'
          : 'MultiNode — 앞 세 대를 한꺼번에 집어 한 대로 접는다. 교체 노드는 파드 요구에 맞는 것 중 싼 것이면 되고, 같은 패밀리일 필요가 없다'
    };
  }

  function build(container) {
    var cfg = makeCfg(container.getAttribute('data-variant') || 'single');
    var FLIGHT = cfg.flight, BATCH = cfg.batch;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'mn-svg', role: 'img', 'aria-label': cfg.still });
    var i;

    function computeFrame(phase, t) {
      var f = {
        cardsOp: 1, podsP: 1, countP: 1, ratioOp: 1, sortP: 1,
        batchN: 0, batchOp: 0, batchState: '',
        newOp: 0, simMode: false, ghostPods: 0,
        flightP: [], landed: 0, plannedUnits: 0, paidUnits: 0,
        oldFade: 0, savOp: 0, laneDone: false
      };
      var j;

      /* single · multi — 정렬은 이미 끝난 상태에서 출발한다 */
      if (phase === 0) {
        f.batchOp = ease(winP(t, 0.1, 0.35));
        f.batchN = BATCH; f.batchState = 'try';
        /* 집는 순간 합계가 확정된다 — 옮기기 전에 이미 안다 */
        f.plannedUnits = ease(winP(t, 0.35, 0.72)) * cfg.totalRd;
      } else if (phase === 1) {
        f.batchOp = 1; f.batchN = BATCH; f.batchState = 'try';
        f.plannedUnits = cfg.totalRd;
        f.newOp = ease(winP(t, 0.05, 0.25));
        f.simMode = true;
        f.ghostPods = Math.floor(winP(t, 0.2, 0.85) * (FLIGHT.length + 0.999));
      } else if (phase === 2) {
        f.batchOp = 1; f.batchN = BATCH; f.batchState = 'ok';
        f.plannedUnits = cfg.totalRd;
        f.newOp = 1; f.ghostPods = FLIGHT.length;
        var step = FLIGHT.length > 4 ? 0.085 : 0.19;
        var landed = 0;
        for (j = 0; j < FLIGHT.length; j++) {
          var st = 0.08 + j * step;
          var pp = ease(winP(t, st, st + 0.3));
          f.flightP.push(pp);
          if (pp >= 1) landed++;
        }
        f.landed = landed;
        /* 노드 몫은 드레인이 시작될 때, 파드 몫은 하나씩 도착할 때 치러진다 */
        f.paidUnits = ease(winP(t, 0.02, 0.14)) * BATCH + landed;
      } else {
        f.batchOp = 1 - winP(t, 0.1, 0.4); f.batchN = BATCH; f.batchState = 'ok';
        f.plannedUnits = cfg.totalRd; f.paidUnits = cfg.totalRd;
        f.newOp = 1; f.ghostPods = 0;
        for (j = 0; j < FLIGHT.length; j++) f.flightP.push(1);
        f.landed = FLIGHT.length;
        f.oldFade = ease(winP(t, 0.05, 0.4));
        f.savOp = winP(t, 0.3, 0.5);
        f.laneDone = t > 0.45;
      }
      return f;
    }

    var steps = el('g', {});
    for (i = 0; i < cfg.phases; i++) steps.appendChild(txt(26 + i * 26, 26, GLYPHS[i], 'mn-step'));
    svg.appendChild(steps);
    svg.appendChild(txt(W - 26, 26, cfg.lane, 'mn-badge', 'end'));

    var batch = el('rect', { x: slotX(0) - 8, y: ROW_Y - 10, width: 0, height: CARD_H + 20, rx: 12, class: 'mn-batch', opacity: 0 });
    svg.appendChild(batch);

    /* 새 노드 */
    var newG = el('g', { opacity: 0 });
    var newRect = el('rect', { x: NEWX, y: ROW_Y, width: CARD_W, height: CARD_H, rx: 10, class: 'mn-card mn-card-new' });
    newG.appendChild(newRect);
    newG.appendChild(el('rect', { x: NEWX + 10, y: ROW_Y + 37, width: CARD_W - 20, height: 46, rx: 7, class: 'mn-well' }));
    newG.appendChild(txt(NEWX + 12, ROW_Y + 21, cfg.newType, 'mn-name'));
    newG.appendChild(txt(NEWX + CARD_W - 12, ROW_Y + 21, '$' + cfg.newPrice.toFixed(3), 'mn-price', 'end'));
    newG.appendChild(el('rect', { x: NEWX + 12, y: ROW_Y + 28, width: CARD_W - 24, height: 3, rx: 1.5, class: 'mn-sizetrack' }));
    newG.appendChild(el('rect', { x: NEWX + 12, y: ROW_Y + 28, width: (CARD_W - 24) * (cfg.newVcpu / VCPU_MAX), height: 3, rx: 1.5, class: 'mn-size-new' }));
    var newSub = txt(NEWX + 12, ROW_Y + CARD_H - 10, '', 'mn-sub');
    newG.appendChild(newSub);
    svg.appendChild(newG);
    /* 시뮬레이션이 배치해본 자리 — 실물이 도착하면 그 자리부터 지워진다 */
    var ghostG = el('g', {});
    for (i = 0; i < cfg.movePods; i++) {
      ghostG.appendChild(el('circle', { cx: podX(NEWX, i), cy: podY(i), r: POD_R, class: 'mn-pod-ghost', opacity: 0 }));
    }
    svg.appendChild(ghostG);
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
      /* 파드가 담기는 자리 — 점이 카드 위에 떠 있는 게 아니라 안에 들어있음을 보인다 */
      g.appendChild(el('rect', { x: 10, y: ROW_Y + 37, width: CARD_W - 20, height: 46, rx: 7, class: 'mn-well' }));
      g.appendChild(txt(12, ROW_Y + 21, n.type, 'mn-name'));
      g.appendChild(txt(CARD_W - 12, ROW_Y + 21, '$' + n.price.toFixed(3), 'mn-price', 'end'));
      /* 크기 막대 — 가격이 vCPU 에 비례한다는 걸 읽지 않고도 보이게 */
      g.appendChild(el('rect', { x: 12, y: ROW_Y + 28, width: CARD_W - 24, height: 3, rx: 1.5, class: 'mn-sizetrack' }));
      g.appendChild(el('rect', { x: 12, y: ROW_Y + 28, width: (CARD_W - 24) * (n.vcpu / VCPU_MAX), height: 3, rx: 1.5, class: 'mn-size' }));
      var pods = [];
      for (var k = 0; k < n.pods; k++) {
        /* 그룹은 X 만 옮긴다 — cy 는 절대 좌표라야 카드 안에 앉는다 */
        var c = el('circle', { cx: POD_X0 + (k % POD_COLS) * POD_DX, cy: podY(k), r: POD_R, class: 'mn-pod', opacity: 0 });
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
    var meterWrap = el('g', {});
    meterWrap.appendChild(txt(METER.x, METER.y - 9, 'RescheduleDisruptionCost — 집는 순간 정해지고, 옮기면서 치러진다', 'mn-lane'));
    meterWrap.appendChild(el('rect', { x: METER.x, y: METER.y, width: METER.w, height: METER.h, rx: 6, class: 'mn-track' }));
    svg.appendChild(meterWrap);
    var meterG = el('g', {});
    for (i = 0; i < cfg.meterMax; i++) {
      meterG.appendChild(el('rect', {
        x: METER.x + i * cfg.unitW + 2, y: METER.y + 2, width: cfg.unitW - 4, height: METER.h - 4, rx: 3,
        class: i < BATCH ? 'mn-unit mn-unit-node' : 'mn-unit', opacity: 0
      }));
    }
    svg.appendChild(meterG);
    /* 위 겹: 실제로 치른 몫 */
    var paidG = el('g', {});
    for (i = 0; i < cfg.meterMax; i++) {
      paidG.appendChild(el('rect', {
        x: METER.x + i * cfg.unitW + 2, y: METER.y + 2, width: cfg.unitW - 4, height: METER.h - 4, rx: 3,
        class: i < BATCH ? 'mn-paid mn-paid-node' : 'mn-paid', opacity: 0
      }));
    }
    svg.appendChild(paidG);
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
        var x = slotX(c.n.to);
        var picked = c.n.to < BATCH;
        c.g.setAttribute('transform', 'translate(' + x.toFixed(1) + ',0)');
        c.g.setAttribute('opacity', (picked ? 1 - f.oldFade * 0.72 : 1) * f.cardsOp);
        c.rect.setAttribute('class', picked && f.oldFade > 0.4 ? 'mn-card mn-card-gone' : 'mn-card');
        var flown = 0;
        for (k = 0; k < FLIGHT.length; k++) if (FLIGHT[k].node === c.n && f.flightP[k] > 0.02) flown++;
        var counted = Math.min(c.n.pods, Math.floor(f.countP * (c.n.pods + 0.999)));
        var counting = f.countP > 0 && f.countP < 1;
        for (k = 0; k < c.pods.length; k++) {
          var gone = picked && k < flown;
          /* 아직 안 센 파드는 옅게 — 이 점들이 저 숫자를 만든다는 걸 보이게 */
          c.pods[k].setAttribute('opacity', gone ? 0 : (counting && k >= counted ? f.podsP * 0.25 : f.podsP));
        }
        c.rt.setAttribute('opacity', f.countP > 0.02 ? 1 : 0);
        c.rt.textContent = 'cost ' + (1 + counted).toFixed(1);
        c.rv.setAttribute('opacity', f.ratioOp);
        c.rv.textContent = c.n.ratio.toFixed(3);
      });

      if (f.batchN > 0) {
        batch.setAttribute('width', slotX(f.batchN - 1) + CARD_W - slotX(0) + 16);
        batch.setAttribute('opacity', f.batchOp);
        batch.setAttribute('class', f.batchState === 'ok' ? 'mn-batch mn-batch-ok' : 'mn-batch');
      } else batch.setAttribute('opacity', 0);

      newG.setAttribute('opacity', f.newOp);
      newRect.setAttribute('class', f.simMode ? 'mn-card mn-card-sim' : 'mn-card mn-card-new');
      newSub.textContent = f.simMode
        ? '시뮬레이션 — 파드 ' + cfg.movePods + '개가 들어간다'
        : '파드 ' + cfg.movePods + '개를 받는다';

      /* 실물이 도착한 자리의 유령은 지운다 */
      var ghosts = ghostG.querySelectorAll('circle');
      for (j = 0; j < cfg.movePods; j++) {
        ghosts[j].setAttribute('opacity', (j < f.ghostPods && (f.flightP[j] || 0) < 1) ? 1 : 0);
      }

      var flys = flyG.querySelectorAll('circle'), lands = landG.querySelectorAll('circle');
      for (j = 0; j < FLIGHT.length; j++) {
        var p = f.flightP[j] || 0;
        var src = FLIGHT[j], sx = slotX(src.node.to);
        var x0 = podX(sx, src.idx), y0 = podY(src.idx);
        var x1 = podX(NEWX, j), y1 = podY(j);
        /* 안 보이는 동안에도 좌표는 유효하게 둔다 — 대기 위치가 viewBox 밖이면 안 된다 */
        flys[j].setAttribute('cx', lerp(x0, x1, p));
        flys[j].setAttribute('cy', lerp(y0, y1, p) - Math.sin(p * Math.PI) * 26);
        flys[j].setAttribute('opacity', p > 0.001 && p < 1 ? 1 : 0);
        lands[j].setAttribute('opacity', p >= 1 ? 1 : 0);
      }

      var us = meterG.querySelectorAll('rect'), pd = paidG.querySelectorAll('rect');
      for (j = 0; j < us.length; j++) {
        var pl = f.plannedUnits - j, pv = f.paidUnits - j;
        us[j].setAttribute('opacity', pl <= 0 ? 0 : 1);
        us[j].setAttribute('width', Math.max(0, Math.min(1, pl)) * (cfg.unitW - 4));
        pd[j].setAttribute('opacity', pv <= 0 ? 0 : 1);
        pd[j].setAttribute('width', Math.max(0, Math.min(1, pv)) * (cfg.unitW - 4));
      }
      meterTx.textContent = f.plannedUnits > 0.02 ? cfg.totalRd.toFixed(1) : '';
      meterNote.textContent = f.plannedUnits < 0.02 ? ''
        : f.paidUnits < 0.02
          ? '집는 순간 확정 — 노드 ' + BATCH + '대 × 1.0  +  옮길 파드 ' + cfg.movePods + '개 × 1.0'
          : '치르는 중 — 옮긴 파드 ' + f.landed + ' / ' + cfg.movePods + '개';

      resultPill.setAttribute('opacity', f.laneDone ? 1 : 0);
      resultPill.setAttribute('class', f.laneDone ? 'mn-pill mn-pill-ok' : 'mn-pill');
      resultTx.setAttribute('opacity', f.laneDone ? 1 : 0);
      resultTx.textContent = cfg.one
        ? '1대 → 1대 · 커맨드 1건'
        : BATCH + '대 → 1대 · 커맨드 1건';
      savTx.setAttribute('opacity', f.savOp);
      savTx.textContent = 'savings  $' + cfg.oldSum.toFixed(3) + ' − $' + cfg.newPrice.toFixed(3) + ' = $' + cfg.savings.toFixed(3) + '/h';
    }

    function done() { paintSteps(cfg.phases - 1); paint(computeFrame(cfg.phases - 1, 1)); if (cap && !fixed) cap.textContent = cfg.still; }

    if (REDUCE) { done(); return; }
    var rafId = 0, running = false, t0 = -1;
    function frame(ts) {
      /* 0 은 유효한 타임스탬프다 — falsy 검사로는 첫 프레임이 0 일 때 영영 안 걸린다 */
      if (t0 < 0) t0 = ts;
      var total = (ts - t0) % (PHASE_MS * cfg.phases);
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
