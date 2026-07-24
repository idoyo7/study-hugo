/* vm-seq engine — 애니메이션 시퀀스 다이어그램 (참여자 줄바꿈·메시지·Note·alt/else + 가로 스크롤).
   정적 호스팅에서 동작. 의존성 없음. prefers-reduced-motion / IntersectionObserver 존중. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var M = 20, PBOX_W = 142, PGAP = 182, STEP_H = 46, NOTE_PAD = 12, PADY = 7, PLH = 13.5, PF = 12;
  var STEP_DELAY = 640, TRAVEL = 520, TAIL = 900;
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function chw(ch, f) { return (ch.charCodeAt(0) > 0x2E80 ? 0.98 : 0.56) * f; }
  function estw(s, f) { var w = 0; for (var i = 0; i < s.length; i++) w += chw(s[i], f); return w; }
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
    var specEl = container.querySelector('script.seq-spec');
    if (!specEl || container.dataset.seqReady) return;
    var spec; try { spec = JSON.parse(specEl.textContent); } catch (e) { return; }
    container.dataset.seqReady = '1';

    var parts = spec.participants || [], idx = {};
    parts.forEach(function (p, i) { idx[p.id] = i; p._lab = wrap(p.label || p.id, PBOX_W - 14, PF); });
    var pboxH = Math.max(40, PADY * 2 + Math.max.apply(null, parts.map(function (p) { return p._lab.length; })) * PLH);
    var cx = function (id) { return M + PBOX_W / 2 + (idx[id] || 0) * PGAP; };

    var msgs = [], notes = [], frames = [], order = 0;
    var y = M + pboxH + 22;
    function walk(list) {
      (list || []).forEach(function (st) {
        if (st.alt !== undefined) {
          var y1 = y - 4; y += 10; walk(st.steps);
          var dividerY = y - 2; y += 15; walk(st.elseSteps);
          var y2 = y; y += 6;
          frames.push({ y1: y1, y2: y2, dividerY: dividerY, label: st.alt, elseLabel: st.elseLabel || '' });
        } else if (st.note) {
          var lines = st.lines || (st.label ? [st.label] : []);
          var h = lines.length * 13 + 14;
          notes.push({ over: st.note, lines: lines, y: y, h: h }); y += h + 12;
        } else if (st.msg) {
          msgs.push({ from: st.msg[0], to: st.msg[1], label: st.label || '', dashed: !!st.dashed, y: y + 6, order: order++ }); y += STEP_H;
        }
      });
    }
    walk(spec.steps);
    var bottomY = y + 6;

    var minX = 0, maxX = M * 2 + PBOX_W + (parts.length - 1) * PGAP;
    var noteGeo = notes.map(function (nt) {
      var cs = nt.over.map(cx), mid = (Math.min.apply(null, cs) + Math.max.apply(null, cs)) / 2;
      var tw = Math.max.apply(null, nt.lines.map(function (l) { return estw(l, 10.5); }));
      var w = Math.max((Math.max.apply(null, cs) - Math.min.apply(null, cs)) + 2 * NOTE_PAD, tw + 22, 150), x = mid - w / 2;
      minX = Math.min(minX, x - 4); maxX = Math.max(maxX, x + w + 4);
      return { x: x, w: w };
    });
    // 메시지 라벨이 좌우로 넘칠 수 있음 → viewBox에 반영
    msgs.forEach(function (m) { var mid = (cx(m.from) + cx(m.to)) / 2, hw = estw(m.label, 11) / 2 + 4; minX = Math.min(minX, mid - hw); maxX = Math.max(maxX, mid + hw); });
    var vbW = maxX - minX;

    var svg = el('svg', { viewBox: minX + ' 0 ' + vbW + ' ' + bottomY, class: 'seq-svg', role: 'img', 'aria-label': spec.caption || 'sequence diagram' });
    var gFrames = el('g', {}), gLife = el('g', {}), gBody = el('g', {}), gPk = el('g', { class: 'sq-packets' }), gParts = el('g', {});
    var lifeX1 = M - 6, lifeX2 = M + PBOX_W + (parts.length - 1) * PGAP + 6;

    frames.forEach(function (fr) {
      gFrames.appendChild(el('rect', { x: lifeX1, y: fr.y1, width: lifeX2 - lifeX1, height: fr.y2 - fr.y1, rx: 6, class: 'sq-frame-box' }));
      gFrames.appendChild(el('rect', { x: lifeX1, y: fr.y1, width: 42, height: 15, rx: 3, class: 'sq-frame-tab' }));
      var lt = el('text', { x: lifeX1 + 6, y: fr.y1 + 11, class: 'sq-frame-label' }); lt.textContent = 'alt'; gFrames.appendChild(lt);
      var ll = el('text', { x: lifeX1 + 48, y: fr.y1 + 11, class: 'sq-frame-else' }); ll.textContent = '[' + fr.label + ']'; gFrames.appendChild(ll);
      if (fr.elseLabel) {
        gFrames.appendChild(el('line', { x1: lifeX1, y1: fr.dividerY, x2: lifeX2, y2: fr.dividerY, class: 'sq-frame-box' }));
        var e2 = el('text', { x: lifeX1 + 6, y: fr.dividerY + 12, class: 'sq-frame-else' }); e2.textContent = '[else] ' + fr.elseLabel; gFrames.appendChild(e2);
      }
    });

    parts.forEach(function (p) { gLife.appendChild(el('line', { x1: cx(p.id), y1: M + pboxH, x2: cx(p.id), y2: bottomY, class: 'sq-life' })); });

    notes.forEach(function (nt, i) {
      var g = noteGeo[i];
      gBody.appendChild(el('rect', { x: g.x, y: nt.y, width: g.w, height: nt.h, rx: 5, class: 'sq-note-box' }));
      nt.lines.forEach(function (ln, li) { var t = el('text', { x: g.x + g.w / 2, y: nt.y + 15 + li * 13, class: 'sq-note-text', 'text-anchor': 'middle' }); t.textContent = ln; gBody.appendChild(t); });
    });

    var anim = [];
    msgs.forEach(function (m) {
      var x1 = cx(m.from), x2 = cx(m.to), yy = m.y, right = x2 >= x1, ex = x2 + (right ? -7 : 7);
      gBody.appendChild(el('line', { x1: x1, y1: yy, x2: x2, y2: yy, class: 'sq-msg-line' + (m.dashed ? ' is-dashed' : '') }));
      gBody.appendChild(el('path', { d: 'M ' + x2 + ' ' + yy + ' L ' + ex + ' ' + (yy - 4) + ' L ' + ex + ' ' + (yy + 4) + ' Z', class: 'sq-arrow' }));
      if (m.label) {
        var mx = (x1 + x2) / 2, lw = estw(m.label, 11);
        gBody.appendChild(el('rect', { x: mx - lw / 2 - 3, y: yy - 17, width: lw + 6, height: 13, rx: 3, class: 'sq-msg-label-bg' }));
        var t = el('text', { x: mx, y: yy - 6, class: 'sq-msg-label', 'text-anchor': 'middle' }); t.textContent = m.label; gBody.appendChild(t);
      }
      anim.push({ x1: x1, x2: x2, y: yy, order: m.order });
    });

    parts.forEach(function (p) {
      var x = cx(p.id) - PBOX_W / 2;
      gParts.appendChild(el('rect', { x: x, y: M, width: PBOX_W, height: pboxH, rx: 8, class: 'sq-part-box' }));
      var ty = M + (pboxH - p._lab.length * PLH) / 2 + PF - 1;
      p._lab.forEach(function (ln, i) { var t = el('text', { x: cx(p.id), y: ty + i * PLH, class: 'sq-part-label', 'text-anchor': 'middle' }); t.textContent = ln; gParts.appendChild(t); });
    });

    svg.appendChild(gFrames); svg.appendChild(gLife); svg.appendChild(gBody); svg.appendChild(gPk); svg.appendChild(gParts);
    svg.style.maxWidth = Math.round(vbW) + 'px'; // 본문 폭에 맞춰 축소 → 전체가 다 보임
    container.insertBefore(svg, container.firstChild);

    if (REDUCE || !anim.length) return;
    var M_ = anim.length, period = M_ * STEP_DELAY + TAIL, rafId = 0, running = false;
    function frame(ts) {
      var tau = ts % period, buf = '';
      for (var i = 0; i < anim.length; i++) {
        var a = anim[i], s = a.order * STEP_DELAY;
        if (tau >= s && tau <= s + TRAVEL) { var p = (tau - s) / TRAVEL, x = a.x1 + (a.x2 - a.x1) * p, op = p < 0.15 ? p / 0.15 : (p > 0.85 ? (1 - p) / 0.15 : 1); buf += '<circle cx="' + x.toFixed(1) + '" cy="' + a.y + '" r="4" class="sq-dot" opacity="' + op.toFixed(2) + '"/>'; }
      }
      gPk.innerHTML = buf; rafId = requestAnimationFrame(frame);
    }
    function start() { if (running) return; running = true; rafId = requestAnimationFrame(frame); }
    function stop() { running = false; cancelAnimationFrame(rafId); }
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { es.forEach(function (e) { e.isIntersecting ? start() : stop(); }); }, { threshold: 0.12 }).observe(container);
    else start();
  }

  function init() { var l = document.querySelectorAll('.vm-seq'); for (var i = 0; i < l.length; i++) build(l[i]); }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
