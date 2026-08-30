/* vm-lane engine — 가로축(시점/연속) 위에 레인별 막대. flow의 열 기반 흐름과 달리
   "무엇이 축의 어디에 얼마만큼 놓이는가"를 그린다. 정적 호스팅에서 동작. 의존성 없음.
   prefers-reduced-motion / IntersectionObserver 존중. flow.js를 참조하지 않는 독립 파일.

   세그먼트 라벨·서브는 막대 위에 좌측 정렬로 얹는다(막대는 순수하게 양만 나타낸다).
   텍스트는 자기 칸(category) 또는 다음 세그먼트 시작점(linear)을 절대 넘지 않도록 wrap() 으로
   최대 2줄까지 접고, 그래도 안 들어가면 console.warn 을 남기고 2줄까지만 그린다 — 라벨이
   viewBox 를 넓히는 일은 이제 없다(단, linear 에서 end > axis.max 로 막대 자체가 넘치는 것은
   여전히 잘리지 않고 그대로 그린다). */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var L = {
    GUTTER_W: 118,
    COL_W: 150,
    TRACK_W: 640,
    LANE_GAP: 14,
    HEAD_H: 28,
    FOOT_H: 22,
    MARGIN: 16,
    SEG_R: 5,
    BAR_H: 18,       // 막대 높이 고정
    TEXT_GAP: 4,      // 텍스트 블록 하단 ~ 막대 상단
    BOT_PAD: 6,       // 막대 하단 ~ 레인 영역 끝
    MIN_LANE_H: 46,
    COL_PAD: 6
  };
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var containerSeq = 0;

  function el(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  // 텍스트 폭 추정 — flow.js와 동일한 방식(문자 코드 0x2E80 기준)
  function chw(ch, f) { return (ch.charCodeAt(0) > 0x2E80 ? 0.98 : 0.56) * f; }
  function estw(s, f) { var w = 0; for (var i = 0; i < s.length; i++) w += chw(s[i], f); return w; }
  // flow.js의 wrap() 이식 — 레인 라벨과 세그먼트 라벨·서브 줄바꿈에 쓴다.
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
  // 2줄까지만 허용 — 넘치면 경고하고 자른다
  function wrap2(str, maxW, f, warnMsg) {
    if (!str) return [];
    var lines = wrap(str, maxW, f);
    if (lines.length > 2) { console.warn(warnMsg, str); lines = lines.slice(0, 2); }
    return lines;
  }
  function fs(px) { return 'font-size:' + (Math.round(px * 10) / 10) + 'px'; }

  function build(container) {
    var specEl = container.querySelector('script.lane-spec');
    if (!specEl || container.dataset.laneReady) return;
    var spec; try { spec = JSON.parse(specEl.textContent); } catch (err) { return; }
    container.dataset.laneReady = '1';
    containerSeq++;
    var cid = containerSeq;

    var F = (+spec.font > 0) ? +spec.font : 1;
    var axis = spec.axis || { kind: 'category' };
    var kind = (axis.kind === 'linear') ? 'linear' : 'category';
    var lanes = spec.lanes || [];
    var hasNote = !!spec.note;

    // 폰트 크기(배율 F 적용)
    var NLF = 12.5 * F, NSF = 9.5 * F, NLLH = 15 * F, NSLH = 12 * F;   // 레인 라벨/서브(왼쪽 거터)
    var SLF = 12 * F, SSF = 9.5 * F;                                   // 세그먼트 라벨/서브 폰트
    var LH_LAB = 15 * F, LH_SUB = 12 * F;                              // 세그먼트 텍스트 줄 높이
    var AXF = 11 * F, TKF = 10 * F, NOTEF = 10.5 * F, MKF = 10 * F;    // 축 헤더 / note / marker

    // 레인 라벨(왼쪽 거터) 줄바꿈
    lanes.forEach(function (ln) {
      ln._lab = wrap(ln.label || '', L.GUTTER_W - 10, NLF);
      ln._sub = ln.sub ? wrap(ln.sub, L.GUTTER_W - 10, NSF) : [];
    });

    var trackX0 = L.MARGIN + L.GUTTER_W;
    var trackY0 = L.MARGIN + L.HEAD_H;
    var footH = hasNote ? L.FOOT_H : 0;

    var cols = (kind === 'category') ? (axis.cols || []) : [];
    var axMax = (kind === 'linear') ? (axis.max || 1) : 1;
    var trackW = (kind === 'category') ? (cols.length * L.COL_W) : L.TRACK_W;
    var trackRight = trackX0 + trackW;

    var baseW = L.MARGIN + L.GUTTER_W + trackW + L.MARGIN;
    var maxRight = baseW; // linear 초과 세그먼트·marker 라벨이 밀어내면 늘어난다(세그먼트 텍스트는 더 이상 늘리지 않는다)

    // ── Phase 1: 세그먼트 지오메트리 + 텍스트 줄바꿈 (DOM 없이) ──
    var laneGeo = [];
    lanes.forEach(function (ln) {
      var raw = [];
      (ln.segments || []).forEach(function (seg) {
        var segX, segW;
        if (kind === 'category') {
          if (typeof seg.col !== 'number') { console.warn('lane: category 축인데 col이 없는 세그먼트 — 건너뜀', seg); return; }
          var w = (typeof seg.w === 'number') ? seg.w : 1;
          var colX = trackX0 + seg.col * L.COL_W;
          segW = Math.max(0, (L.COL_W - L.COL_PAD * 2) * w);
          segX = colX + L.COL_PAD; // 좌측 정렬 — "칸 시작점에서 얼마나 뻗는가"로 읽힌다
        } else {
          if (typeof seg.start !== 'number' || typeof seg.end !== 'number') { console.warn('lane: linear 축인데 start/end가 없는 세그먼트 — 건너뜀', seg); return; }
          if (seg.end > axMax) console.warn('lane: 세그먼트 end(' + seg.end + ')가 axis.max(' + axMax + ')를 넘는다 — 잘리지 않고 그린다', seg);
          segX = trackX0 + (seg.start / axMax) * L.TRACK_W;
          segW = Math.max(0, (seg.end - seg.start) / axMax * L.TRACK_W);
        }
        var isEmpty = !!seg.empty;
        raw.push({
          segX: segX, segW: segW,
          isEmpty: isEmpty, isHatch: !isEmpty && seg.style === 'hatch',
          kind: seg.kind || 'proc',
          labelText: seg.label || (isEmpty ? '없음' : ''),
          subText: seg.sub || ''
        });
        maxRight = Math.max(maxRight, segX + segW + L.MARGIN); // linear 초과분은 여기서 반영된다
      });
      raw.sort(function (a, b) { return a.segX - b.segX; });

      // 텍스트 줄바꿈 — category는 자기 칸 폭 고정, linear는 다음 세그먼트 시작점(또는 트랙 오른쪽 끝)을 넘지 않게
      raw.forEach(function (sg, idx) {
        var maxTextW;
        if (kind === 'category') {
          maxTextW = L.COL_W - L.COL_PAD * 2;
        } else {
          var cap = (idx + 1 < raw.length) ? raw[idx + 1].segX : Math.max(trackRight, sg.segX + Math.max(sg.segW, 120));
          maxTextW = Math.max(1, Math.min(Math.max(sg.segW, 120), cap - sg.segX));
        }
        sg.labLines = wrap2(sg.labelText, maxTextW, SLF, 'lane: 세그먼트 라벨이 2줄에도 안 들어가 잘림');
        sg.subLines = wrap2(sg.subText, maxTextW, SSF, 'lane: 세그먼트 서브가 2줄에도 안 들어가 잘림');
      });

      var maxLabelLines = 0, maxSubLines = 0;
      raw.forEach(function (sg) { maxLabelLines = Math.max(maxLabelLines, sg.labLines.length); maxSubLines = Math.max(maxSubLines, sg.subLines.length); });
      var laneH = Math.max(L.MIN_LANE_H, maxLabelLines * LH_LAB + maxSubLines * LH_SUB + L.TEXT_GAP + L.BAR_H + L.BOT_PAD);
      var barOffset = maxLabelLines * LH_LAB + maxSubLines * LH_SUB + L.TEXT_GAP;

      laneGeo.push({ segs: raw, lab: ln._lab, sub: ln._sub, h: laneH, barOffset: barOffset });
    });

    // 레인 누적 y
    var laneAreaH = 0;
    laneGeo.forEach(function (lg, i) { lg.y = trackY0 + laneAreaH; laneAreaH += lg.h + (i < laneGeo.length - 1 ? L.LANE_GAP : 0); });

    var baseH = L.MARGIN + L.HEAD_H + laneAreaH + footH + L.MARGIN;
    var vbW = maxRight, vbH = baseH;

    var svg = el('svg', { viewBox: '0 0 ' + vbW + ' ' + vbH, class: 'lane-svg', role: 'img', 'aria-label': spec.caption || 'lane diagram' });
    var defs = el('defs', {});
    var gAxis = el('g', {}), gLanes = el('g', {}), gMarkers = el('g', {});

    // ── 축 헤더 ──
    if (kind === 'category') {
      for (var ci = 0; ci <= cols.length; ci++) {
        var sx = trackX0 + ci * L.COL_W;
        gAxis.appendChild(el('line', { x1: sx, y1: trackY0, x2: sx, y2: trackY0 + laneAreaH, class: 'lane-axis-sep' }));
      }
      cols.forEach(function (name, ci2) {
        var cx = trackX0 + ci2 * L.COL_W + L.COL_W / 2;
        var t = el('text', { x: cx, y: L.MARGIN + L.HEAD_H / 2 + AXF * 0.35, class: 'lane-axis-label', style: fs(AXF) });
        t.textContent = name; gAxis.appendChild(t);
      });
    } else {
      var ticks = (axis.ticks && axis.ticks.length) ? axis.ticks : [0, axMax];
      ticks.forEach(function (tv) {
        var tx = trackX0 + (tv / axMax) * L.TRACK_W;
        gAxis.appendChild(el('line', { x1: tx, y1: trackY0 + laneAreaH, x2: tx, y2: trackY0, class: 'lane-axis-grid' }));
        gAxis.appendChild(el('line', { x1: tx, y1: trackY0 - 11, x2: tx, y2: trackY0, class: 'lane-axis-tick' }));
        var lbl = tv + (axis.unit || '');
        var t = el('text', { x: tx, y: trackY0 - 14, class: 'lane-axis-tlabel', style: fs(TKF) });
        t.textContent = lbl; gAxis.appendChild(t);
      });
    }

    // ── 레인 ──
    var patIds = {}; // kind -> pattern id, 컨테이너 안에서만 유일
    var animItems = [];
    laneGeo.forEach(function (lg, li) {
      var cy = lg.y + lg.h / 2;
      var th = lg.lab.length * NLLH + (lg.sub.length ? 3 + lg.sub.length * NSLH : 0);
      var ty = cy - th / 2 + NLF - 1;
      lg.lab.forEach(function (line, i) {
        var t = el('text', { x: L.MARGIN, y: ty + i * NLLH, class: 'lane-nlabel', style: fs(NLF) });
        t.textContent = line; gLanes.appendChild(t);
      });
      var sy = ty + lg.lab.length * NLLH + 1;
      lg.sub.forEach(function (line, i) {
        var t = el('text', { x: L.MARGIN, y: sy + i * NSLH, class: 'lane-nsub', style: fs(NSF) });
        t.textContent = line; gLanes.appendChild(t);
      });

      var barY = lg.y + lg.barOffset;
      lg.segs.forEach(function (sg) {
        var rectClass = 'lane-rect';
        var fillAttr = null;
        if (sg.isEmpty) {
          rectClass += ' is-empty';
        } else if (sg.isHatch) {
          rectClass += ' is-hatch';
          var pid = patIds[sg.kind];
          if (!pid) {
            pid = 'lane-hatch-' + cid + '-' + sg.kind;
            patIds[sg.kind] = pid;
            var pat = el('pattern', { id: pid, patternUnits: 'userSpaceOnUse', width: 6, height: 6, patternTransform: 'rotate(45)' });
            pat.appendChild(el('rect', { width: 6, height: 6, fill: 'transparent' }));
            var pl = el('line', { x1: 0, y1: 0, x2: 0, y2: 6, style: 'stroke:var(--lane-' + sg.kind + ');stroke-width:2' });
            pat.appendChild(pl);
            defs.appendChild(pat);
          }
          fillAttr = 'url(#' + pid + ')';
        } else {
          rectClass += ' is-solid';
        }
        var g = el('g', { class: 'lane-seg seg-' + sg.kind + (sg.isEmpty ? ' seg-empty' : '') });
        var rectAttrs = { x: sg.segX, y: barY, width: REDUCE ? sg.segW : 0, height: L.BAR_H, rx: L.SEG_R, class: rectClass };
        if (fillAttr) rectAttrs.fill = fillAttr;
        var rect = el('rect', rectAttrs);
        g.appendChild(rect);

        // 텍스트 — 막대 위, 좌측 정렬. 라벨 줄 다음 서브 줄이 이어진다(자기 줄 수만큼만 차지)
        var textCy = lg.y + SLF - 2;
        sg.labLines.forEach(function (line, i) {
          var t = el('text', { x: sg.segX, y: textCy + i * LH_LAB, class: 'lane-slabel', 'text-anchor': 'start', style: fs(SLF) });
          t.textContent = line; g.appendChild(t);
        });
        var subCy = textCy + sg.labLines.length * LH_LAB;
        sg.subLines.forEach(function (line, i) {
          var t = el('text', { x: sg.segX, y: subCy + i * LH_SUB, class: 'lane-ssub', 'text-anchor': 'start', style: fs(SSF) });
          t.textContent = line; g.appendChild(t);
        });

        gLanes.appendChild(g);
        if (!REDUCE) animItems.push({ rect: rect, w: sg.segW, delay: li * 80 });
      });
    });

    // ── marker (linear 전용) ──
    (spec.markers || []).forEach(function (mk) {
      if (kind !== 'linear') { console.warn('lane: marker는 linear 축에서만 그려진다 — 건너뜀', mk); return; }
      if (typeof mk.at !== 'number') return;
      var mx = trackX0 + (mk.at / axMax) * L.TRACK_W;
      var mkKind = mk.kind || 'query';
      gMarkers.appendChild(el('line', { x1: mx, y1: L.MARGIN + 12, x2: mx, y2: trackY0 + laneAreaH, class: 'lane-marker-line', style: 'stroke:var(--lane-' + mkKind + ')' }));
      if (mk.label) {
        var lw = estw(mk.label, MKF);
        maxRight = Math.max(maxRight, mx + lw / 2 + L.MARGIN);
        var t = el('text', { x: mx, y: L.MARGIN + 9, class: 'lane-marker-label', style: fs(MKF) + ';fill:var(--lane-' + mkKind + ')' });
        t.textContent = mk.label; gMarkers.appendChild(t);
      }
    });
    if (maxRight > vbW) { vbW = maxRight; svg.setAttribute('viewBox', '0 0 ' + vbW + ' ' + vbH); }

    // ── note ──
    if (hasNote) {
      var noteY = L.MARGIN + L.HEAD_H + laneAreaH + footH / 2 + NOTEF * 0.35;
      var nt = el('text', { x: trackX0 + trackW / 2, y: noteY, class: 'lane-note', style: fs(NOTEF) });
      nt.textContent = spec.note; gAxis.appendChild(nt);
    }

    svg.appendChild(defs); svg.appendChild(gAxis); svg.appendChild(gMarkers); svg.appendChild(gLanes);
    svg.style.maxWidth = Math.round(vbW) + 'px';
    container.insertBefore(svg, container.firstChild);

    if (REDUCE || !animItems.length) return;

    var running = false, rafId = 0, startTs = -1;
    function frame(ts) {
      if (startTs < 0) startTs = ts;
      var elapsed = ts - startTs, doneAll = true;
      for (var i = 0; i < animItems.length; i++) {
        var it = animItems[i], t = (elapsed - it.delay) / 600;
        if (t < 0) { t = 0; doneAll = false; }
        else if (t >= 1) { t = 1; } else { doneAll = false; }
        var ease = 1 - Math.pow(1 - t, 3);
        it.rect.setAttribute('width', Math.max(0, it.w * ease));
      }
      if (!doneAll) rafId = requestAnimationFrame(frame);
    }
    function start() { if (running) return; running = true; startTs = -1; rafId = requestAnimationFrame(frame); }
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { start(); io.disconnect(); } });
      }, { threshold: 0.15 });
      io.observe(container);
    } else start();
  }

  function init() { var l = document.querySelectorAll('.vm-lane'); for (var i = 0; i < l.length; i++) build(l[i]); }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
