/* vm-seq engine — 애니메이션 시퀀스 다이어그램.
   participants + steps(msg/note/alt). 메시지가 시간순(위→아래)으로 캐스케이드 흐름.
   정적 호스팅에서 동작. 의존성 없음. prefers-reduced-motion / IntersectionObserver 존중. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var M = 20, PBOX_W = 138, PBOX_H = 42, PGAP = 178, STEP_H = 46, NOTE_PAD = 12;
  var STEP_DELAY = 640, TRAVEL = 520, TAIL = 900;
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function estw(s) { var w = 0; for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2E80 ? 10 : 5.8; return w; }

  function build(container) {
    var specEl = container.querySelector('script.seq-spec');
    if (!specEl || container.dataset.seqReady) return;
    var spec;
    try { spec = JSON.parse(specEl.textContent); } catch (e) { return; }
    container.dataset.seqReady = '1';

    var parts = spec.participants || [];
    var idx = {};
    parts.forEach(function (p, i) { idx[p.id] = i; });
    var cx = function (id) { return M + PBOX_W / 2 + (idx[id] || 0) * PGAP; };

    // 스텝 배치: 메시지/노트에 y, alt는 프레임
    var msgs = [], notes = [], frames = [];
    var order = 0;
    var contentTop = M + PBOX_H + 22;
    var y = contentTop;
    function walk(list) {
      (list || []).forEach(function (st) {
        if (st.alt !== undefined) {
          var y1 = y - 4; y += 10;
          walk(st.steps);
          var dividerY = y - 2; y += 15;
          walk(st.elseSteps);
          var y2 = y; y += 6;
          frames.push({ y1: y1, y2: y2, dividerY: dividerY, label: st.alt, elseLabel: st.elseLabel || '' });
        } else if (st.note) {
          var lines = st.lines || (st.label ? [st.label] : []);
          var h = lines.length * 13 + 14;
          notes.push({ over: st.note, lines: lines, y: y, h: h });
          y += h + 12;
        } else if (st.msg) {
          msgs.push({ from: st.msg[0], to: st.msg[1], label: st.label || '', dashed: !!st.dashed, y: y + 6, order: order++ });
          y += STEP_H;
        }
      });
    }
    walk(spec.steps);
    var bottomY = y + 6;

    // x 범위(참여자 + 노트 박스가 넘칠 수 있음) 계산
    var minX = 0, maxX = M * 2 + PBOX_W + (parts.length - 1) * PGAP;
    var noteGeo = notes.map(function (nt) {
      var cs = nt.over.map(cx);
      var mid = (Math.min.apply(null, cs) + Math.max.apply(null, cs)) / 2;
      var tw = Math.max.apply(null, nt.lines.map(estw));
      var w = Math.max((Math.max.apply(null, cs) - Math.min.apply(null, cs)) + 2 * NOTE_PAD, tw + 22, 150);
      var x = mid - w / 2;
      minX = Math.min(minX, x - 4); maxX = Math.max(maxX, x + w + 4);
      return { x: x, w: w };
    });
    var vbW = maxX - minX;

    var svg = el('svg', { viewBox: minX + ' 0 ' + vbW + ' ' + bottomY, class: 'seq-svg', role: 'img', 'aria-label': spec.caption || 'sequence diagram', preserveAspectRatio: 'xMidYMid meet' });
    var gFrames = el('g', {}), gLife = el('g', {}), gBody = el('g', {}), gPk = el('g', { class: 'sq-packets' }), gParts = el('g', {});

    // alt/else 프레임 (맨 뒤)
    frames.forEach(function (fr) {
      var fx1 = M - 6, fx2 = M + PBOX_W + (parts.length - 1) * PGAP + 6;
      gFrames.appendChild(el('rect', { x: fx1, y: fr.y1, width: fx2 - fx1, height: fr.y2 - fr.y1, rx: 6, class: 'sq-frame-box' }));
      gFrames.appendChild(el('rect', { x: fx1, y: fr.y1, width: 46, height: 15, rx: 3, class: 'sq-frame-tab' }));
      var lt = el('text', { x: fx1 + 6, y: fr.y1 + 11, class: 'sq-frame-label' }); lt.textContent = 'alt'; gFrames.appendChild(lt);
      var ll = el('text', { x: fx1 + 52, y: fr.y1 + 11, class: 'sq-frame-else' }); ll.textContent = '[' + fr.label + ']'; gFrames.appendChild(ll);
      if (fr.elseLabel) {
        gFrames.appendChild(el('line', { x1: fx1, y1: fr.dividerY, x2: fx2, y2: fr.dividerY, class: 'sq-frame-box' }));
        var el2 = el('text', { x: fx1 + 6, y: fr.dividerY + 12, class: 'sq-frame-else' }); el2.textContent = '[else] ' + fr.elseLabel; gFrames.appendChild(el2);
      }
    });

    // 라이프라인
    parts.forEach(function (p) {
      gLife.appendChild(el('line', { x1: cx(p.id), y1: M + PBOX_H, x2: cx(p.id), y2: bottomY, class: 'sq-life' }));
    });

    // 노트
    notes.forEach(function (nt, i) {
      var g = noteGeo[i];
      gBody.appendChild(el('rect', { x: g.x, y: nt.y, width: g.w, height: nt.h, rx: 5, class: 'sq-note-box' }));
      nt.lines.forEach(function (ln, li) {
        var t = el('text', { x: g.x + g.w / 2, y: nt.y + 15 + li * 13, class: 'sq-note-text', 'text-anchor': 'middle' });
        t.textContent = ln; gBody.appendChild(t);
      });
    });

    // 메시지 (화살표 + 라벨)
    var anim = [];
    msgs.forEach(function (m) {
      var x1 = cx(m.from), x2 = cx(m.to), yy = m.y;
      var right = x2 >= x1;
      var ex = x2 + (right ? -7 : 7);
      gBody.appendChild(el('line', { x1: x1, y1: yy, x2: x2, y2: yy, class: 'sq-msg-line' + (m.dashed ? ' is-dashed' : '') }));
      gBody.appendChild(el('path', { d: 'M ' + x2 + ' ' + yy + ' L ' + ex + ' ' + (yy - 4) + ' L ' + ex + ' ' + (yy + 4) + ' Z', class: 'sq-arrow' }));
      if (m.label) {
        var t = el('text', { x: (x1 + x2) / 2, y: yy - 6, class: 'sq-msg-label', 'text-anchor': 'middle' });
        t.textContent = m.label; gBody.appendChild(t);
      }
      anim.push({ x1: x1, x2: x2, y: yy, order: m.order });
    });

    // 참여자 박스 (맨 앞, 상단)
    parts.forEach(function (p) {
      var x = cx(p.id) - PBOX_W / 2;
      gParts.appendChild(el('rect', { x: x, y: M, width: PBOX_W, height: PBOX_H, rx: 8, class: 'sq-part-box' }));
      var t = el('text', { x: cx(p.id), y: M + PBOX_H / 2 + 4, class: 'sq-part-label', 'text-anchor': 'middle' });
      t.textContent = p.label || p.id; gParts.appendChild(t);
    });

    svg.appendChild(gFrames); svg.appendChild(gLife); svg.appendChild(gBody); svg.appendChild(gPk); svg.appendChild(gParts);
    svg.style.maxWidth = vbW + 'px';
    container.insertBefore(svg, container.firstChild);

    if (REDUCE || !anim.length) return;
    var M_ = anim.length, period = M_ * STEP_DELAY + TAIL;
    var rafId = 0, running = false;
    function frame(ts) {
      var tau = ts % period, buf = '';
      for (var i = 0; i < anim.length; i++) {
        var a = anim[i], s = a.order * STEP_DELAY;
        if (tau >= s && tau <= s + TRAVEL) {
          var p = (tau - s) / TRAVEL;
          var x = a.x1 + (a.x2 - a.x1) * p;
          var op = p < 0.15 ? p / 0.15 : (p > 0.85 ? (1 - p) / 0.15 : 1);
          buf += '<circle cx="' + x.toFixed(1) + '" cy="' + a.y + '" r="4" class="sq-dot" opacity="' + op.toFixed(2) + '"/>';
        }
      }
      gPk.innerHTML = buf;
      rafId = requestAnimationFrame(frame);
    }
    function start() { if (running) return; running = true; rafId = requestAnimationFrame(frame); }
    function stop() { running = false; cancelAnimationFrame(rafId); }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { es.forEach(function (e) { e.isIntersecting ? start() : stop(); }); }, { threshold: 0.12 }).observe(container);
    } else start();
  }

  function init() {
    var list = document.querySelectorAll('.vm-seq');
    for (var i = 0; i < list.length; i++) build(list[i]);
  }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
