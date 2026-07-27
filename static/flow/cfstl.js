/* vm-cfstl engine — CFS period 타임라인.
   nextra 블로그의 CfsTimeline(React)을 이 레포의 무의존 SVG 엔진으로 옮긴 것.
   variant: latency(30ms 작업이 110ms) · threads(병렬도가 quota를 태운다) · burst(적립·차용)
   정적 호스팅에서 동작. prefers-reduced-motion / IntersectionObserver 존중. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var TOTAL = 300, W = 840, ML = 22, MR = 22, PW = W - ML - MR;
  var DUR = 5200, HOLD = 1400, CYCLE = DUR + HOLD;
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* 한 페이지에 여러 개가 있어도 같은 위상으로 돌게 시계를 공유한다 */
  var CLOCK = { t0: 0 };
  var seq = 0;

  function el(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function xOf(ms) { return ML + (ms / TOTAL) * PW; }

  /* limit은 1코어(quota 100ms/period)로 고정하고 "동시에 도는 코어 수"만 바꾼다.
     코어가 많을수록 그 100ms를 빨리 태우고 period의 더 많은 구간이 멈춘다.
     runEnd = 100ms ÷ 코어 수 = quota가 마르는 wall time */
  function threadRow(label, runEnd, note, lanes) {
    var segs = [], bases = [0, 100, 200], i;
    for (i = 0; i < bases.length; i++) {
      segs.push({ from: bases[i], to: bases[i] + runEnd, kind: 'run' });
      if (runEnd < 100) segs.push({ from: bases[i] + runEnd, to: bases[i] + 100, kind: 'throttled' });
    }
    var marker = runEnd < 100
      ? { at: runEnd, label: runEnd + 'ms', repeatFull: [runEnd + 100], repeats: [runEnd + 200] }
      : { at: runEnd, label: '100ms 꽉 참', full: true };
    return { label: label, note: note, segs: segs, lanes: lanes, marker: marker };
  }

  var ROWS = {
    threads: [
      threadRow('1 코어', 100, 'quota 100ms를 딱 채우고 끝 — 안 잘림', 1),
      threadRow('2 코어', 50, '50ms에 quota 소진 → period 절반 멈춤', 2),
      threadRow('4 코어', 25, '25ms에 소진 → period의 ¾ 이 멈춤', 4)
    ],
    latency: [
      { label: 'CPU limit 없음', note: '요청 하나를 30ms에 끝낸다',
        segs: [{ from: 0, to: 30, kind: 'run' }, { from: 30, to: 300, kind: 'idle' }] },
      { label: 'CPU limit 0.2 코어', note: '같은 요청이 110ms — 80ms는 그냥 멈춰 있었다',
        segs: [{ from: 0, to: 20, kind: 'run' }, { from: 20, to: 100, kind: 'throttled' },
               { from: 100, to: 110, kind: 'run' }, { from: 110, to: 300, kind: 'idle' }] }
    ],
    burst: [
      { label: 'Burst 없음', note: '1구간에서 남긴 20ms는 그냥 사라진다',
        segs: [{ from: 0, to: 100, kind: 'idle' }, { from: 100, to: 120, kind: 'run' },
               { from: 120, to: 200, kind: 'throttled' }, { from: 200, to: 220, kind: 'run' },
               { from: 220, to: 300, kind: 'throttled' }],
        buffer: [null, null, null] },
      { label: 'Burst 켬', note: '남긴 20ms를 모아뒀다 2구간에서 10ms 빌려 쓴다 — 스로틀 없음',
        segs: [{ from: 0, to: 100, kind: 'idle' }, { from: 100, to: 120, kind: 'run' },
               { from: 120, to: 130, kind: 'borrow' }, { from: 130, to: 200, kind: 'idle' },
               { from: 200, to: 220, kind: 'run' }, { from: 220, to: 230, kind: 'borrow' },
               { from: 230, to: 300, kind: 'throttled' }],
        buffer: [20, 10, 0] }
    ]
  };

  var CAPTION = {
    threads: 'limit이 1코어(quota 100ms/period)여도, 코어가 많아 동시 실행이 늘면 그 100ms를 더 빨리 태운다. 1코어는 꽉 채워 안 잘리지만 2코어는 절반·4코어는 ¾ 이 멈춤 — throttle은 CPU 총량이 아니라 병렬도(코어 수)에서 터진다.',
    latency: 'quota를 다 쓴 순간부터 다음 구간이 시작될 때까지 애플리케이션 전체가 멈춘다. 평균 사용률은 0.1코어로 limit(0.2코어) 아래인데도 요청은 80ms 더 걸린다.',
    burst: '안 쓴 quota를 버퍼에 모아뒀다 필요할 때 당겨 쓴다. 버퍼가 비면 그때는 그대로 스로틀된다 — 긴 구간 평균은 여전히 limit을 넘지 않는다.'
  };

  /* 재생 헤드는 wall time을 따라 계속 가지만 "작업 표시"는 run/borrow 구간에서만 따라온다.
     멈춤 구간에 들어가면 마지막 실행 지점에 그대로 선다 — 시간은 흐르는데 일은 안 되는 상태. */
  function workMs(row, t) {
    var last = 0, i, s;
    for (i = 0; i < row.segs.length; i++) {
      s = row.segs[i];
      if (s.kind !== 'run' && s.kind !== 'borrow') continue;
      if (t >= s.to) last = s.to;
      else if (t >= s.from) return t;
    }
    return last;
  }

  function fillOf(kind) {
    return kind === 'run' ? 'var(--cft-run)'
      : kind === 'borrow' ? 'var(--cft-borrow)'
      : kind === 'throttled' ? 'var(--cft-thr)' : 'var(--cft-idle)';
  }

  function chip(cls, label, style) {
    var s = document.createElement('span');
    s.className = 'cft-chip';
    var sw = document.createElement('span');
    sw.className = cls;
    if (style) sw.setAttribute('style', style);
    s.appendChild(sw);
    s.appendChild(document.createTextNode(label));
    return s;
  }

  function build(container) {
    if (container.dataset.cftReady) return;
    var variant = container.dataset.variant || 'latency';
    var rows = ROWS[variant];
    if (!rows) return;
    container.dataset.cftReady = '1';

    var isThreads = variant === 'threads';
    var hasBuf = rows.some(function (r) { return r.buffer; });
    var ROW_H = isThreads ? 40 : 46;
    var ROW_GAP = hasBuf ? 62 : isThreads ? 64 : 44;
    var TOP = 34, LANE_GAP = 3;
    /* 레인 두께는 코어 수별 가변 — 많을수록 얇게. 4줄 스택이 latency 막대만큼 뚱뚱해지지 않도록 */
    function laneH(row) { return row.lanes === 1 ? 46 : row.lanes === 2 ? 23 : 15; }
    function groupH(row) { return row.lanes ? row.lanes * laneH(row) + (row.lanes - 1) * LANE_GAP : ROW_H; }

    var rowY = [], acc = TOP, i;
    for (i = 0; i < rows.length; i++) { rowY.push(acc); acc += groupH(rows[i]) + ROW_GAP; }
    var H = acc + 6;

    var clipId = 'cft-clip-' + variant + '-' + (++seq);
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'cft-svg', role: 'img', 'aria-label': CAPTION[variant] });
    var defs = el('defs', {}), clip = el('clipPath', { id: clipId });
    var reveal = el('rect', { x: ML, y: 0, width: W, height: H });
    clip.appendChild(reveal); defs.appendChild(clip); svg.appendChild(defs);

    /* period 눈금 */
    [0, 100, 200, 300].forEach(function (ms) {
      svg.appendChild(el('line', { x1: xOf(ms), y1: TOP - 12, x2: xOf(ms), y2: H - 6, stroke: 'var(--cft-grid)', 'stroke-width': 1, 'stroke-dasharray': '2 4' }));
      var t = el('text', { x: xOf(ms), y: TOP - 18, class: 'cft-tick', 'text-anchor': ms === 0 ? 'start' : ms === 300 ? 'end' : 'middle' });
      t.textContent = ms + 'ms'; svg.appendChild(t);
    });

    var dots = [];
    rows.forEach(function (row, ri) {
      var y = rowY[ri], gH = groupH(row), g = el('g', {});
      var lab = el('text', { x: ML, y: y - 6, class: 'cft-label' });
      lab.textContent = row.label; g.appendChild(lab);

      /* 재생 헤드가 지나간 만큼만 드러난다 */
      var clipped = el('g', { 'clip-path': 'url(#' + clipId + ')' });
      if (row.lanes) {
        /* 코어 수만큼 레인을 세로로 쌓는다 — 같은 timing을 공유해 동시에 돌고 동시에 멈춘다 */
        var lh = laneH(row);
        for (var li = 0; li < row.lanes; li++) {
          var laneY = y + li * (lh + LANE_GAP);
          row.segs.forEach(function (s) {
            var w = xOf(s.to) - xOf(s.from);
            if (w <= 0) return;
            clipped.appendChild(el('rect', { x: xOf(s.from), y: laneY, width: w, height: lh, rx: 1.5, fill: s.kind === 'run' ? 'var(--cft-run)' : 'var(--cft-thr)' }));
          });
        }
      } else {
        row.segs.forEach(function (s) {
          var w = xOf(s.to) - xOf(s.from);
          if (w <= 0) return;
          clipped.appendChild(el('rect', { x: xOf(s.from), y: y, width: w, height: ROW_H, rx: 2, fill: fillOf(s.kind) }));
          if (s.kind === 'throttled' && w > 46) {
            var st = el('text', { x: xOf(s.from) + w / 2, y: y + ROW_H / 2 + 4, class: 'cft-seg', 'text-anchor': 'middle' });
            st.textContent = '멈춤'; clipped.appendChild(st);
          }
          if (s.kind === 'borrow') {
            clipped.appendChild(el('rect', { x: xOf(s.from), y: y, width: w, height: ROW_H, rx: 2, fill: 'none', stroke: 'var(--cft-run)', 'stroke-width': 1.5, 'stroke-dasharray': '3 2' }));
          }
        });
      }

      /* quota 소진 마커 — 1·2번째 period는 완전 라벨(throttle + ms)을 반복해 "매 주기 반복됨"을
         보여주고, 3번째는 크라우딩을 피해 옅은 tick만 남긴다 */
      if (row.marker) {
        var mk = row.marker;
        (mk.repeats || []).forEach(function (rp) {
          clipped.appendChild(el('line', { x1: xOf(rp), x2: xOf(rp), y1: y, y2: y + gH, stroke: 'var(--cft-thr)', 'stroke-width': 1, 'stroke-dasharray': '2 3', opacity: 0.5 }));
        });
        var fullAt = mk.full ? [mk.at] : [mk.at].concat(mk.repeatFull || []);
        fullAt.forEach(function (p) {
          clipped.appendChild(el('line', { x1: xOf(p), x2: xOf(p), y1: y, y2: y + gH, stroke: mk.full ? 'var(--cft-run)' : 'var(--cft-thr)', 'stroke-width': 1.5, 'stroke-dasharray': '3 2' }));
          if (mk.full) {
            var t1 = el('text', { x: xOf(p), y: y + gH + 14, class: 'cft-marker cft-marker-run', 'text-anchor': 'middle' });
            t1.textContent = mk.label; clipped.appendChild(t1);
          } else {
            var t2 = el('text', { x: xOf(p), y: y + gH + 12, class: 'cft-marker-throttle', 'text-anchor': 'middle' });
            t2.textContent = 'throttle'; clipped.appendChild(t2);
            var t3 = el('text', { x: xOf(p), y: y + gH + 26, class: 'cft-marker', 'text-anchor': 'middle' });
            t3.textContent = mk.label; clipped.appendChild(t3);
          }
        });
      }
      g.appendChild(clipped);

      /* 작업 표시 — 그룹당 1개. run 구간에서만 따라오고 멈춤 구간에서는 그대로 선다 */
      var dot = el('g', { class: 'cft-work', opacity: 0 });
      dot.appendChild(el('circle', { cx: 0, cy: y + gH / 2, r: 6 }));
      g.appendChild(dot); dots.push(dot);

      /* 마커가 2줄 라벨을 쓰므로 note는 더 내려 겹침을 피한다 */
      if (row.note) {
        var nt = el('text', { x: ML, y: y + gH + (row.marker ? 44 : 16), class: 'cft-note' });
        nt.textContent = row.note; g.appendChild(nt);
      }
      if (row.buffer) {
        row.buffer.forEach(function (b, bi) {
          var cx = xOf(bi * 100 + 100), by = y + gH + (row.note ? 26 : 10);
          g.appendChild(el('rect', { x: cx - 15, y: by, width: 30, height: 14, rx: 3, fill: b ? 'var(--cft-buf)' : 'none', stroke: 'var(--cft-buf-edge)', 'stroke-width': 1.2, 'stroke-dasharray': b ? '0' : '3 2' }));
          var bt = el('text', { x: cx + 22, y: by + 11, class: 'cft-buf' });
          bt.textContent = b === null ? '버퍼 없음' : b === 0 ? '버퍼 0' : '버퍼 ' + b + 'ms';
          g.appendChild(bt);
        });
      }
      svg.appendChild(g);
    });

    /* 재생 헤드 — wall time. 멈춤 구간에서도 계속 간다 */
    var head = el('line', { y1: TOP - 10, y2: H - 6, class: 'cft-head', opacity: 0 });
    svg.appendChild(head);
    container.insertBefore(svg, container.firstChild);

    /* 범례 */
    var lg = document.createElement('div');
    lg.className = 'cft-legend';
    lg.appendChild(chip('cft-sw', 'quota로 실행', 'background:var(--cft-run)'));
    if (variant === 'burst') lg.appendChild(chip('cft-sw cft-dash', '버퍼에서 빌려 실행'));
    lg.appendChild(chip('cft-sw', '스로틀 — 멈춰 있음', 'background:var(--cft-thr)'));
    if (variant !== 'threads') lg.appendChild(chip('cft-sw', '할 일 없음', 'background:var(--cft-idle)'));
    lg.appendChild(chip('cft-dot', '작업 진행 — 멈추면 빨갛게'));
    var cap = container.querySelector('.cft-caption');
    container.insertBefore(lg, cap || null);
    if (cap && !cap.textContent.trim()) cap.textContent = CAPTION[variant];

    function paint(t, showHead) {
      reveal.setAttribute('width', String(Math.max(0, xOf(t) - ML + 1)));
      head.setAttribute('x1', String(xOf(t)));
      head.setAttribute('x2', String(xOf(t)));
      head.setAttribute('opacity', showHead ? '0.85' : '0');
      rows.forEach(function (row, ri) {
        var w = workMs(row, t), g = dots[ri];
        g.setAttribute('transform', 'translate(' + xOf(w) + ',0)');
        /* 재생 헤드에 뒤처져 있으면 = 스로틀로 멈춰 선 상태 */
        g.setAttribute('data-stalled', t - w > 1 ? '1' : '0');
        g.setAttribute('opacity', showHead ? '1' : '0');
      });
    }
    function done() { paint(TOTAL, false); }

    if (REDUCE) { done(); return; }
    var rafId = 0, running = false;
    function frame(ts) {
      if (!CLOCK.t0) CLOCK.t0 = ts;
      var phase = (ts - CLOCK.t0) % CYCLE;
      if (phase <= DUR) paint((phase / DUR) * TOTAL, true); else done();
      rafId = requestAnimationFrame(frame);
    }
    function start() { if (running) return; running = true; rafId = requestAnimationFrame(frame); }
    function stop() { running = false; cancelAnimationFrame(rafId); done(); }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) { e.isIntersecting ? start() : stop(); });
      }, { threshold: 0.25 }).observe(container);
    } else start();
  }

  function init() { var l = document.querySelectorAll('.vm-cfstl'); for (var i = 0; i < l.length; i++) build(l[i]); }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
