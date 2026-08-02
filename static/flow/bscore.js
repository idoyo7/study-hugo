/* vm-bscore engine — Balanced 스코어가 만들어지는 과정.
   nextra 블로그 ThrottleGate와 같은 phase-stepped 상태머신:
   단계마다 ~2.2초 멈춰 보여주고, computeFrame(phase,t)가 프레임 전체를 순수 함수로 계산한다.
   ① 후보 확정 → ② disruptionCost 누적 → ③ savings 계산 → ④ 풀 기준선 → ⑤ 심사
   정적 호스팅에서 동작. prefers-reduced-motion / IntersectionObserver 존중. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var W = 840, H = 372;
  var PHASE_MS = 2200, PHASE_COUNT = 5;
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── 시나리오 ── k=2 주석이 근거로 든 "같은 패밀리 한 단계 다운사이징"이다.
     4xlarge → 2xlarge 는 정확히 50% 절감이고, 평균 밀도 노드에서 겨우 통과한다. */
  var OLD_PRICE = 0.768, NEW_PRICE = 0.384;
  var PODS = 4, DS_PODS = 1;                 /* DaemonSet 은 비용에 안 들어간다 */
  var RD_COST = 1.0 + PODS;                  /* 노드 몫 1.0 + 파드마다 1.0 */
  var SAVINGS = OLD_PRICE - NEW_PRICE;
  var POOL_COST = 3.84, POOL_RD = 50.0;
  var SAV_FRAC = SAVINGS / POOL_COST;        /* 0.10 */
  var DIS_FRAC = RD_COST / POOL_RD;          /* 0.10 */
  var SCORE = SAV_FRAC / DIS_FRAC;           /* 1.00 */
  var GHOST_PODS = 12;
  var GHOST_RD = 1.0 + GHOST_PODS;
  var GHOST_SCORE = SAV_FRAC / (GHOST_RD / POOL_RD); /* ≈ 0.385 */
  var THRESHOLD = 0.5;

  var CAPTIONS = [
    '① 후보가 정해진다 — m5.4xlarge 한 대, 그 위에 옮겨야 할 파드 4개 (DaemonSet은 세지 않는다)',
    '② disruptionCost 를 쌓는다 — 노드 몫 1.0 에 파드마다 1.0 씩. 돈이 아니라 개수다',
    '③ savings 를 잰다 — 지울 노드 가격에서 새로 띄울 노드 가격을 뺀다',
    '④ 풀 평균을 기준선으로 삼는다 — 이 액션의 효율을 풀 전체의 효율로 나눈다',
    '⑤ 심사 — score 가 임계 0.5 를 넘으면 승인. 같은 절감이라도 파드가 3배면 떨어진다'
  ];
  var GLYPHS = ['①', '②', '③', '④', '⑤'];
  var STATIC_CAPTION = 'Balanced 는 절감액이 아니라 "파괴 1단위당 절감"을 본다 — 분모가 파드 수라 빽빽한 노드일수록 통과가 어렵다';

  function el(tag, a) { var e = document.createElementNS(NS, tag); for (var k in a) e.setAttribute(k, a[k]); return e; }
  function txt(x, y, s, cls, anchor) {
    var t = el('text', { x: x, y: y, class: cls || 'bs-t' });
    if (anchor) t.setAttribute('text-anchor', anchor);
    t.textContent = s; return t;
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function ease(t) { return 1 - Math.pow(1 - t, 3); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function winP(t, s, e) { return clamp01((t - s) / (e - s)); }
  function f2(v) { return v.toFixed(2); }

  /* ── 레이아웃 상수 ── */
  var CARD = { y: 52, h: 96, w: 196 };
  var OLDX = 26, NEWX = 300;
  var BAR = { x: 26, y: 196, w: 470, h: 22 };   /* disruptionCost 누적 막대 */
  var SBAR = { x: 26, y: 246, w: 470, h: 18 };  /* savings 막대 */
  var GAUGE = { x: 26, y: 316, w: 640, h: 14, max: 1.6 };
  function gx(v) { return GAUGE.x + clamp01(v / GAUGE.max) * GAUGE.w; }

  /* (phase, t) → 이번 프레임의 상태 전부. 파티클 배열을 들고 있지 않는다. */
  function computeFrame(phase, t) {
    var f = {
      phase: phase,
      podsShown: 0, dsShown: 0, dsRejected: 0,
      costUnits: 0, costLabel: 0,
      newCardOp: 0, savFrac: 0,
      baseOp: 0, gaugeOp: 0, needle: 0, ghostOp: 0, ghostNeedle: 0,
      verdictOp: 0, fracOp: 0
    };
    if (phase === 0) {
      f.podsShown = Math.round(lerp(0, PODS, ease(winP(t, 0.15, 0.7))));
      f.dsShown = t > 0.75 ? DS_PODS : 0;
    } else if (phase === 1) {
      f.podsShown = PODS; f.dsShown = DS_PODS;
      /* 바닥 1.0 이 먼저, 그 다음 파드가 하나씩 얹힌다 */
      var n = t < 0.18 ? 0 : Math.min(PODS, Math.floor(winP(t, 0.18, 0.86) * (PODS + 0.999)));
      f.costUnits = (t < 0.08 ? ease(winP(t, 0, 0.08)) : 1) + n;
      f.costLabel = f.costUnits;
      f.dsRejected = t > 0.88 ? 1 : 0;
    } else if (phase === 2) {
      f.podsShown = PODS; f.dsShown = DS_PODS; f.dsRejected = 1;
      f.costUnits = RD_COST; f.costLabel = RD_COST;
      f.newCardOp = ease(winP(t, 0.05, 0.4));
      f.savFrac = ease(winP(t, 0.45, 0.9));
    } else if (phase === 3) {
      f.podsShown = PODS; f.dsShown = DS_PODS; f.dsRejected = 1;
      f.costUnits = RD_COST; f.costLabel = RD_COST;
      f.newCardOp = 1; f.savFrac = 1;
      f.fracOp = ease(winP(t, 0.05, 0.45));
      f.baseOp = ease(winP(t, 0.35, 0.8));
      f.gaugeOp = ease(winP(t, 0.55, 0.95));
    } else {
      f.podsShown = PODS; f.dsShown = DS_PODS; f.dsRejected = 1;
      f.costUnits = RD_COST; f.costLabel = RD_COST;
      f.newCardOp = 1; f.savFrac = 1; f.fracOp = 1; f.baseOp = 1; f.gaugeOp = 1;
      f.needle = lerp(0, SCORE, ease(winP(t, 0.05, 0.45)));
      f.verdictOp = winP(t, 0.45, 0.6);
      f.ghostOp = winP(t, 0.62, 0.78);
      f.ghostNeedle = lerp(SCORE, GHOST_SCORE, ease(winP(t, 0.65, 0.92)));
    }
    return f;
  }

  function build(container) {
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'bs-svg', role: 'img', 'aria-label': STATIC_CAPTION });

    /* 단계 글리프 */
    var steps = el('g', {});
    for (var i = 0; i < PHASE_COUNT; i++) steps.appendChild(txt(26 + i * 26, 26, GLYPHS[i], 'bs-step'));
    svg.appendChild(steps);

    /* 지울 노드 카드 */
    svg.appendChild(el('rect', { x: OLDX, y: CARD.y, width: CARD.w, height: CARD.h, rx: 10, class: 'bs-card bs-card-old' }));
    svg.appendChild(txt(OLDX + 12, CARD.y + 22, '지울 노드', 'bs-cardlabel'));
    svg.appendChild(txt(OLDX + 12, CARD.y + 42, 'm5.4xlarge', 'bs-cardname'));
    svg.appendChild(txt(OLDX + CARD.w - 12, CARD.y + 42, '$' + OLD_PRICE.toFixed(3) + '/h', 'bs-price', 'end'));
    var podG = el('g', {});
    for (i = 0; i < PODS; i++) podG.appendChild(el('circle', { cx: OLDX + 24 + i * 30, cy: CARD.y + 72, r: 9, class: 'bs-pod', opacity: 0 }));
    var dsG = el('g', {});
    for (i = 0; i < DS_PODS; i++) dsG.appendChild(el('rect', { x: OLDX + 24 + (PODS + i) * 30 - 8, y: CARD.y + 64, width: 16, height: 16, rx: 4, class: 'bs-ds', opacity: 0 }));
    svg.appendChild(podG); svg.appendChild(dsG);
    var dsNote = txt(OLDX + 24 + PODS * 30 + 16, CARD.y + 77, 'DaemonSet — 안 셈', 'bs-note'); dsNote.setAttribute('opacity', 0); svg.appendChild(dsNote);

    /* 새 노드 카드 */
    var newG = el('g', { opacity: 0 });
    newG.appendChild(el('rect', { x: NEWX, y: CARD.y, width: CARD.w, height: CARD.h, rx: 10, class: 'bs-card bs-card-new' }));
    newG.appendChild(txt(NEWX + 12, CARD.y + 22, '새로 띄울 노드', 'bs-cardlabel'));
    newG.appendChild(txt(NEWX + 12, CARD.y + 42, 'm5.2xlarge', 'bs-cardname'));
    newG.appendChild(txt(NEWX + CARD.w - 12, CARD.y + 42, '$' + NEW_PRICE.toFixed(3) + '/h', 'bs-price', 'end'));
    newG.appendChild(txt(NEWX + 12, CARD.y + 74, '한 단계 다운사이징 = 정확히 50% 절감', 'bs-note'));
    svg.appendChild(newG);

    /* disruptionCost 누적 막대 */
    svg.appendChild(txt(BAR.x, BAR.y - 8, 'RescheduleDisruptionCost', 'bs-rowlabel'));
    svg.appendChild(el('rect', { x: BAR.x, y: BAR.y, width: BAR.w, height: BAR.h, rx: 5, class: 'bs-track' }));
    var unitW = BAR.w / 8;   /* 8칸 스케일 — 5.0 이 6할쯤 */
    var costG = el('g', {});
    for (i = 0; i < 8; i++) {
      costG.appendChild(el('rect', {
        x: BAR.x + i * unitW + 1.5, y: BAR.y + 1.5, width: unitW - 3, height: BAR.h - 3, rx: 3,
        class: i === 0 ? 'bs-unit bs-unit-node' : 'bs-unit', opacity: 0
      }));
    }
    svg.appendChild(costG);
    var costTx = txt(BAR.x + BAR.w + 12, BAR.y + 16, '', 'bs-val'); svg.appendChild(costTx);

    /* savings 막대 */
    svg.appendChild(txt(SBAR.x, SBAR.y - 7, 'savings', 'bs-rowlabel'));
    svg.appendChild(el('rect', { x: SBAR.x, y: SBAR.y, width: SBAR.w, height: SBAR.h, rx: 5, class: 'bs-track' }));
    var savFill = el('rect', { x: SBAR.x + 1.5, y: SBAR.y + 1.5, width: 0, height: SBAR.h - 3, rx: 3, class: 'bs-sav' });
    svg.appendChild(savFill);
    var savTx = txt(SBAR.x + SBAR.w + 12, SBAR.y + 14, '', 'bs-val'); svg.appendChild(savTx);

    /* 두 분수 */
    var fracG = el('g', { opacity: 0 });
    fracG.appendChild(txt(26, 292, 'savings / TotalCost = ' + f2(SAV_FRAC) + '   ÷   RDCost / TotalDisruptionCost = ' + f2(DIS_FRAC), 'bs-frac'));
    svg.appendChild(fracG);

    /* 스코어 게이지 */
    var gaugeG = el('g', { opacity: 0 });
    gaugeG.appendChild(el('rect', { x: GAUGE.x, y: GAUGE.y, width: GAUGE.w, height: GAUGE.h, rx: 7, class: 'bs-track' }));
    gaugeG.appendChild(el('rect', { x: GAUGE.x, y: GAUGE.y, width: gx(THRESHOLD) - GAUGE.x, height: GAUGE.h, rx: 7, class: 'bs-reject-zone' }));
    gaugeG.appendChild(el('line', { x1: gx(THRESHOLD), y1: GAUGE.y - 10, x2: gx(THRESHOLD), y2: GAUGE.y + GAUGE.h + 10, class: 'bs-thr' }));
    gaugeG.appendChild(txt(gx(THRESHOLD), GAUGE.y - 16, '임계 1/k = 0.5', 'bs-thrlabel', 'middle'));
    gaugeG.appendChild(txt(GAUGE.x, GAUGE.y + GAUGE.h + 22, 'score', 'bs-rowlabel'));
    svg.appendChild(gaugeG);

    var ghostG = el('g', { opacity: 0 });
    var ghostDot = el('circle', { cx: gx(0), cy: GAUGE.y + GAUGE.h / 2, r: 8, class: 'bs-ghost' });
    ghostG.appendChild(ghostDot);
    var ghostTx = txt(gx(GHOST_SCORE), GAUGE.y + GAUGE.h + 24, '파드가 3배면 ' + f2(GHOST_SCORE) + ' — 거부', 'bs-ghostlabel', 'middle');
    ghostG.appendChild(ghostTx);
    svg.appendChild(ghostG);

    var needle = el('circle', { cx: gx(0), cy: GAUGE.y + GAUGE.h / 2, r: 10, class: 'bs-needle', opacity: 0 });
    svg.appendChild(needle);
    var needleTx = txt(gx(0), GAUGE.y - 16, '', 'bs-needlelabel', 'middle'); svg.appendChild(needleTx);

    var verdict = txt(W - 26, GAUGE.y + GAUGE.h / 2 + 5, '', 'bs-verdict', 'end'); verdict.setAttribute('opacity', 0); svg.appendChild(verdict);

    container.insertBefore(svg, container.firstChild);
    var cap = container.querySelector('.bs-caption');
    if (cap && !cap.textContent.trim()) cap.textContent = STATIC_CAPTION;

    var lastPhase = -1;
    function paintSteps(p) {
      if (lastPhase === p) return;
      lastPhase = p;
      var ns = steps.querySelectorAll('text');
      for (var i = 0; i < ns.length; i++) ns[i].setAttribute('class', i === p ? 'bs-step bs-step-on' : 'bs-step');
      if (cap) cap.textContent = CAPTIONS[p];
    }

    function paint(f) {
      var i, ps = podG.querySelectorAll('circle'), ds = dsG.querySelectorAll('rect');
      for (i = 0; i < ps.length; i++) ps[i].setAttribute('opacity', i < f.podsShown ? 1 : 0);
      for (i = 0; i < ds.length; i++) {
        ds[i].setAttribute('opacity', i < f.dsShown ? (f.dsRejected ? 0.35 : 1) : 0);
      }
      dsNote.setAttribute('opacity', f.dsRejected ? 1 : 0);

      var us = costG.querySelectorAll('rect');
      for (i = 0; i < us.length; i++) {
        var full = f.costUnits - i;
        us[i].setAttribute('opacity', full <= 0 ? 0 : 1);
        us[i].setAttribute('width', Math.max(0, Math.min(1, full)) * (unitW - 3));
      }
      costTx.textContent = f.costLabel > 0 ? f2(f.costLabel) : '';

      newG.setAttribute('opacity', f.newCardOp);
      savFill.setAttribute('width', f.savFrac * (SBAR.w - 3) * (SAVINGS / OLD_PRICE));
      savTx.textContent = f.savFrac > 0.02 ? '$' + (SAVINGS * f.savFrac).toFixed(3) + '/h' : '';

      fracG.setAttribute('opacity', f.fracOp);
      gaugeG.setAttribute('opacity', f.gaugeOp);

      needle.setAttribute('opacity', f.needle > 0 ? 1 : 0);
      needle.setAttribute('cx', gx(f.needle));
      needleTx.setAttribute('opacity', f.needle > 0.02 ? 1 : 0);
      needleTx.setAttribute('x', gx(f.needle));
      needleTx.textContent = f.needle > 0.02 ? 'score ' + f2(f.needle) : '';

      verdict.setAttribute('opacity', f.verdictOp);
      var approved = f.ghostOp > 0.5 ? false : f.needle >= THRESHOLD;
      verdict.textContent = approved ? '승인' : '거부';
      verdict.setAttribute('class', approved ? 'bs-verdict bs-ok' : 'bs-verdict bs-no');

      ghostG.setAttribute('opacity', f.ghostOp);
      ghostDot.setAttribute('cx', gx(f.ghostNeedle));
    }

    function done() { paintSteps(PHASE_COUNT - 1); paint(computeFrame(PHASE_COUNT - 1, 1)); if (cap) cap.textContent = STATIC_CAPTION; }

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
    function stop() { running = false; cancelAnimationFrame(rafId); }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) { e.isIntersecting ? start() : stop(); });
      }, { threshold: 0.25 }).observe(container);
    } else start();
  }

  function init() { var l = document.querySelectorAll('.vm-bscore'); for (var i = 0; i < l.length; i++) build(l[i]); }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
