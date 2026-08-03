/* vm-bscore engine — Balanced 는 심사관이다. 통합을 만들지 않고 받아서 거른다.
   phase-stepped 상태머신(단계별 3·2·6.8초, computeFrame 은 (phase,t)의 순수 함수 — t는 그 단계 내 0~1).
   ① WhenEmptyOrUnderutilized 가 만든 커맨드들이 도착 → ② 채점 재료(savings·cost) →
   ③ 풀 평균을 기준선으로 → ④ 하나씩 심사대에 오름 → ⑤ 대부분 거부, 하나만 통과
   정적 호스팅에서 동작. prefers-reduced-motion / IntersectionObserver 존중. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var W = 840, H = 384;
  /* 단계별로 길이가 다르다 — ①은 카드 4장을 읽어야 하고 ③은 4건이 줄 서서 판정받는다 */
  var PHASE_MS = [3000, 2000, 6800], PHASE_COUNT = PHASE_MS.length;
  var CYCLE_MS = PHASE_MS.reduce(function (a, b) { return a + b; }, 0);
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 그 NodePool 의 총계 — 기준선은 여기서 나온다 */
  var POOL_COST = 4.414, POOL_RD = 50.0;
  var THRESHOLD = 0.5;   /* 1/k, k=2 */

  /* 위 경로가 만들어 올린 커맨드들. rd = 노드 수 × 1.0 + 옮길 파드 수 */
  /* 가격은 ap-northeast-2 온디맨드 Linux 실가 (AWS pricing API) */
  var CMDS = [
    { label: 'm8g.4xl → m8g.2xl', sub: '한 단계 다운사이징', sav: 0.4413, nodes: 1, pods: 4 },
    { label: 'm8g.2xl → m8g.xl', sub: '빽빽한 노드', sav: 0.2207, nodes: 1, pods: 11 },
    { label: 'm8g.2xl ×2 → r8g.2xl', sub: '묶어서 접기', sav: 0.3143, nodes: 2, pods: 18 },
    { label: 'm8g.xl → m8g.large', sub: '푼돈 절감', sav: 0.1104, nodes: 1, pods: 8 }
  ];
  CMDS.forEach(function (c) {
    c.rd = c.nodes + c.pods;
    c.score = (c.sav / POOL_COST) / (c.rd / POOL_RD);
    c.ok = c.score >= THRESHOLD;
  });
  var PASSED = CMDS.filter(function (c) { return c.ok; }).length;

  var CAPTIONS = [
    '① Balanced 는 통합을 만들지 않는다 — 위 경로가 만든 커맨드가 그대로 올라온다. 얼마를 아끼고(savings) 그러려고 무엇을 건드리는지(노드 + 파드)가 붙어 있다',
    '② 기준선은 그 풀의 평균 효율이다 — 액션의 효율을 그 값으로 나눈 것이 score, 임계는 1/k = 0.5',
    '③ 도착하는 자리가 곧 점수다 — 넷 중 하나만 임계를 넘는다'
  ];
  var GLYPHS = ['①', '②', '③'];
  var STATIC_CAPTION = 'Balanced 는 절감액이 아니라 "파괴 1단위당 절감"을 본다 — 아끼는 돈이 같아도 건드리는 파드가 많으면 거부된다';

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

  /* ── 레이아웃 ── */
  var CARD_W = 185, CARD_H = 106, CARD_Y = 48, CARD_GAP = 12;
  function cardX(i) { return 26 + i * (CARD_W + CARD_GAP); }
  function cardMid(i) { return cardX(i) + CARD_W / 2; }
  var GAUGE = { x: 60, y: 280, w: 700, h: 14, max: 1.5 };
  function gx(v) { return GAUGE.x + clamp01(v / GAUGE.max) * GAUGE.w; }
  var TOK_R = 11;

  function computeFrame(phase, t) {
    var f = {
      cardsOp: 0, factsOp: 0, gaugeOp: 0, formulaOp: 0,
      scoreOp: 0, travel: [], verdict: [], summaryOp: 0
    };
    var i;
    for (i = 0; i < CMDS.length; i++) { f.travel.push(0); f.verdict.push(0); }

    if (phase === 0) {
      /* 커맨드가 채점 재료를 달고 통째로 올라온다 — 빈 카드를 먼저 보일 이유가 없다 */
      f.cardsOp = ease(winP(t, 0.05, 0.4));
      f.factsOp = ease(winP(t, 0.3, 0.8));
    } else if (phase === 1) {
      f.cardsOp = 1; f.factsOp = 1;
      f.formulaOp = ease(winP(t, 0.05, 0.35));
      f.gaugeOp = ease(winP(t, 0.3, 0.7));
      f.scoreOp = ease(winP(t, 0.6, 0.9));
    } else {
      f.cardsOp = 1; f.factsOp = 1; f.formulaOp = 1; f.gaugeOp = 1; f.scoreOp = 1;
      /* 하나씩 내려가 도착하는 즉시 판정된다 — 줄 서서 심사받는 모양 */
      for (i = 0; i < CMDS.length; i++) {
        var s0 = 0.05 + i * 0.15;
        f.travel[i] = ease(winP(t, s0, s0 + 0.22));
        f.verdict[i] = winP(t, s0 + 0.22, s0 + 0.3);
      }
      f.summaryOp = winP(t, 0.78, 0.9);
    }
    return f;
  }

  function build(container) {
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'bs-svg', role: 'img', 'aria-label': STATIC_CAPTION });
    var i;

    var steps = el('g', {});
    for (i = 0; i < PHASE_COUNT; i++) steps.appendChild(txt(26 + i * 26, 26, GLYPHS[i], 'bs-step'));
    svg.appendChild(steps);
    svg.appendChild(txt(W - 26, 26, 'WhenEmptyOrUnderutilized 가 만든 커맨드', 'bs-hint', 'end'));

    /* 커맨드 카드 */
    var cards = [];
    CMDS.forEach(function (c, idx) {
      var g = el('g', { opacity: 0 });
      g.appendChild(el('rect', { x: cardX(idx), y: CARD_Y, width: CARD_W, height: CARD_H, rx: 10, class: 'bs-cmd' }));
      g.appendChild(txt(cardX(idx) + 12, CARD_Y + 22, c.label, 'bs-cardname'));
      g.appendChild(txt(cardX(idx) + 12, CARD_Y + 38, c.sub, 'bs-note'));
      var facts = el('g', { opacity: 0 });
      facts.appendChild(txt(cardX(idx) + 12, CARD_Y + 63, 'savings', 'bs-factlabel'));
      facts.appendChild(txt(cardX(idx) + CARD_W - 12, CARD_Y + 63, '$' + c.sav.toFixed(3) + '/h', 'bs-factval', 'end'));
      facts.appendChild(txt(cardX(idx) + 12, CARD_Y + 84, 'cost', 'bs-factlabel'));
      facts.appendChild(txt(cardX(idx) + CARD_W - 12, CARD_Y + 84,
        '노드 ' + c.nodes + ' + 파드 ' + c.pods + ' = ' + c.rd.toFixed(1), 'bs-factval', 'end'));
      g.appendChild(facts);
      /* 점수는 이름과 같은 줄에 두면 긴 라벨(m8g.2xl ×2 → r8g.2xl)과 정면으로 부딪힌다.
         이름에 한 줄을 통째로 주고 점수는 sub 줄 오른쪽으로 내린다 — sub 는 짧아 여유가 있다 */
      var score = txt(cardX(idx) + CARD_W - 12, CARD_Y + 39, '', 'bs-cardscore', 'end');
      score.setAttribute('opacity', 0);
      g.appendChild(score);
      svg.appendChild(g);
      cards.push({ g: g, facts: facts, score: score, c: c, idx: idx });
    });

    /* 식 */
    var formula = el('g', { opacity: 0 });
    formula.appendChild(txt(26, 190, 'score  =  (savings / 풀 총비용)  ÷  (cost / 풀 총 disruption cost)', 'bs-frac'));
    formula.appendChild(txt(26, 208, '풀 총비용 $' + POOL_COST.toFixed(3) + '/h · 풀 총 disruption cost ' + POOL_RD.toFixed(1) + ' · 가격은 ap-northeast-2 온디맨드', 'bs-note'));
    svg.appendChild(formula);

    /* 심사대 */
    var gaugeG = el('g', { opacity: 0 });
    gaugeG.appendChild(el('rect', { x: GAUGE.x, y: GAUGE.y, width: GAUGE.w, height: GAUGE.h, rx: 7, class: 'bs-track' }));
    gaugeG.appendChild(el('rect', { x: GAUGE.x, y: GAUGE.y, width: gx(THRESHOLD) - GAUGE.x, height: GAUGE.h, rx: 7, class: 'bs-reject-zone' }));
    gaugeG.appendChild(el('line', { x1: gx(THRESHOLD), y1: GAUGE.y - 34, x2: gx(THRESHOLD), y2: GAUGE.y + GAUGE.h + 12, class: 'bs-thr' }));
    gaugeG.appendChild(txt(gx(THRESHOLD) - 8, GAUGE.y - 40, '거부', 'bs-zonelabel bs-no', 'end'));
    gaugeG.appendChild(txt(gx(THRESHOLD) + 8, GAUGE.y - 40, '승인   임계 1/k = 0.5', 'bs-zonelabel bs-ok'));
    gaugeG.appendChild(txt(GAUGE.x, GAUGE.y + GAUGE.h + 26, '0', 'bs-tick', 'middle'));
    gaugeG.appendChild(txt(gx(0.5), GAUGE.y + GAUGE.h + 26, '0.5', 'bs-tick', 'middle'));
    gaugeG.appendChild(txt(gx(1.0), GAUGE.y + GAUGE.h + 26, '1.0', 'bs-tick', 'middle'));
    svg.appendChild(gaugeG);

    /* 심사대로 내려가는 토큰 */
    var toks = [];
    CMDS.forEach(function (c, idx) {
      var g = el('g', { opacity: 0 });
      var circ = el('circle', { cx: cardMid(idx), cy: CARD_Y + CARD_H, r: TOK_R, class: 'bs-tok' });
      var lab = txt(cardMid(idx), GAUGE.y - 12, '', 'bs-toklabel', 'middle');
      lab.setAttribute('opacity', 0);
      g.appendChild(circ); g.appendChild(lab);
      svg.appendChild(g);
      toks.push({ g: g, circ: circ, lab: lab, c: c, idx: idx });
    });

    var summary = el('g', { opacity: 0 });
    summary.appendChild(txt(26, 352, '승인 ' + PASSED + '건 · 거부 ' + (CMDS.length - PASSED) + '건', 'bs-summary'));
    summary.appendChild(txt(W - 26, 352, 'Balanced 는 만들지 않는다 — 받아서 거를 뿐이다', 'bs-note', 'end'));
    svg.appendChild(summary);

    container.insertBefore(svg, container.firstChild);
    var cap = container.querySelector('.bs-caption');
    var fixed = cap && cap.textContent.trim();
    if (cap && !fixed) cap.textContent = STATIC_CAPTION;

    var lastPhase = -1;
    function paintSteps(p) {
      if (lastPhase === p) return;
      lastPhase = p;
      var ns = steps.querySelectorAll('text');
      for (var j = 0; j < ns.length; j++) ns[j].setAttribute('class', j === p ? 'bs-step bs-step-on' : 'bs-step');
      if (cap && !fixed) cap.textContent = CAPTIONS[p];
    }

    function paint(f) {
      cards.forEach(function (k) {
        k.g.setAttribute('opacity', f.cardsOp);
        k.facts.setAttribute('opacity', f.factsOp);
        k.score.setAttribute('opacity', f.scoreOp);
        k.score.textContent = f.scoreOp > 0.02 ? k.c.score.toFixed(2) : '';
        k.score.setAttribute('class', f.verdict[k.idx] > 0.5
          ? (k.c.ok ? 'bs-cardscore bs-ok' : 'bs-cardscore bs-no') : 'bs-cardscore');
      });
      formula.setAttribute('opacity', f.formulaOp);
      gaugeG.setAttribute('opacity', f.gaugeOp);

      toks.forEach(function (k) {
        var p = f.travel[k.idx];
        var x0 = cardMid(k.idx), y0 = CARD_Y + CARD_H;
        var x1 = gx(k.c.score), y1 = GAUGE.y + GAUGE.h / 2;
        k.g.setAttribute('opacity', p > 0.001 ? 1 : 0);
        k.circ.setAttribute('cx', lerp(x0, x1, p));
        k.circ.setAttribute('cy', lerp(y0, y1, p));
        var decided = f.verdict[k.idx] > 0.5;
        k.circ.setAttribute('class', decided
          ? (k.c.ok ? 'bs-tok bs-tok-ok' : 'bs-tok bs-tok-no') : 'bs-tok');
        k.lab.setAttribute('opacity', p >= 1 ? 1 : 0);
        k.lab.setAttribute('x', x1);
        k.lab.textContent = p >= 1 ? (decided ? (k.c.ok ? '승인' : '거부') : k.c.score.toFixed(2)) : '';
        k.lab.setAttribute('class', decided
          ? (k.c.ok ? 'bs-toklabel bs-ok' : 'bs-toklabel bs-no') : 'bs-toklabel');
      });

      summary.setAttribute('opacity', f.summaryOp);
    }

    function done() { paintSteps(PHASE_COUNT - 1); paint(computeFrame(PHASE_COUNT - 1, 1)); if (cap && !fixed) cap.textContent = STATIC_CAPTION; }

    if (REDUCE) { done(); return; }
    var rafId = 0, running = false, t0 = -1;
    function frame(ts) {
      /* 0 은 유효한 타임스탬프다 — falsy 검사로는 첫 프레임이 0 일 때 영영 안 걸린다 */
      if (t0 < 0) t0 = ts;
      var total = (ts - t0) % CYCLE_MS;
      /* 단계 길이가 제각각이라 나눗셈으로는 못 찾는다 — 누적해서 걸리는 칸을 고른다 */
      var p = 0, acc = 0;
      while (p < PHASE_COUNT - 1 && total >= acc + PHASE_MS[p]) { acc += PHASE_MS[p]; p++; }
      paintSteps(p);
      paint(computeFrame(p, (total - acc) / PHASE_MS[p]));
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

  function init() { var l = document.querySelectorAll('.vm-bscore'); for (var i = 0; i < l.length; i++) build(l[i]); }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
