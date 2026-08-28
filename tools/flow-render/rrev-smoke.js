/* rrev.js 렌더 스모크 — 브라우저 없이 최소 DOM 스텁 위에서 전 구간을 훑는다.
   보는 것: NaN/undefined 속성, viewBox 이탈, 음수 width/height/r, 캡션 누락.
   단계형이라 한 시점만 보면 안 된다 — phase × t 격자로 전부 돈다. variant 는 handoff 하나뿐이다. */
'use strict';

let ALL = [];

function mkEl(ns, tag) {
  const e = {
    ns, tag, attrs: {}, children: [], _text: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    appendChild(c) { this.children.push(c); c.parent = this; return c; },
    insertBefore(c) { this.children.unshift(c); c.parent = this; return c; },
    querySelector(sel) { return findOne(this, sel); },
    querySelectorAll(sel) { return findAll(this, sel); },
    get textContent() { return this._text; },
    set textContent(v) { this._text = v; },
    get firstChild() { return this.children[0] || null; },
    classList: { add() {} },
  };
  ALL.push(e);
  return e;
}

function matches(e, sel) {
  if (sel.startsWith('.')) {
    const cls = (e.attrs.class || '').split(/\s+/);
    return cls.indexOf(sel.slice(1)) >= 0;
  }
  return e.tag === sel;
}
function walk(e, out) { for (const c of e.children) { out.push(c); walk(c, out); } }
function findAll(root, sel) {
  const flat = []; walk(root, flat);
  return flat.filter((e) => sel.split(',').map((s) => s.trim()).some((s) => matches(e, s)));
}
function findOne(root, sel) { return findAll(root, sel)[0] || null; }

const RAFS = [];
global.requestAnimationFrame = (fn) => { RAFS.push(fn); return RAFS.length; };
global.cancelAnimationFrame = () => {};

const doc = {
  readyState: 'complete',
  createElementNS: (ns, tag) => mkEl(ns, tag),
  createElement: (tag) => mkEl('html', tag),
  addEventListener() {},
  documentElement: { classList: { add() {}, remove() {} } },
  querySelectorAll(sel) { return CONTAINERS.filter((c) => matches(c, sel)); },
};
let CONTAINERS = [];
global.document = doc;
global.window = { matchMedia: () => ({ matches: false }), requestAnimationFrame: global.requestAnimationFrame };
// IntersectionObserver 없음 → 엔진이 즉시 start() 를 탄다

function makeContainer(variant) {
  const c = mkEl('html', 'figure');
  c.attrs.class = 'vm-rrev';
  c.attrs['data-variant'] = variant;
  const cap = mkEl('html', 'figcaption');
  cap.attrs.class = 'rr-caption';
  cap._text = '';
  c.appendChild(cap);
  return c;
}

const VARIANTS = ['handoff'];
CONTAINERS = VARIANTS.map(makeContainer);

require('fs');
const src = require('fs').readFileSync(process.argv[2] || 'static/flow/rrev.js', 'utf8');
eval(src);

// 엔진은 DOMContentLoaded 없이 readyState complete 이므로 init() 즉시 실행됨
const problems = [];
const NUM_ATTRS = ['x', 'y', 'cx', 'cy', 'r', 'width', 'height', 'opacity', 'rx'];

function checkOnce(tag) {
  for (const svgC of CONTAINERS) {
    const svg = svgC.querySelector('svg') || svgC.children.find((e) => e.tag === 'svg');
    if (!svg) { problems.push(`${tag}: svg 없음 (${svgC.attrs['data-variant']})`); continue; }
    if (!Number.isFinite(Number((svg.attrs.viewBox || '').split(/\s+/)[2]))) { problems.push(`${tag}: viewBox 파싱 실패 "${svg.attrs.viewBox}"`); continue; }
    const vb = (svg.attrs.viewBox || '').split(/\s+/).map(Number);
    const [, , VW, VH] = vb;
    const flat = []; walk(svg, flat);
    for (const e of flat) {
      for (const k of NUM_ATTRS) {
        if (!(k in e.attrs)) continue;
        const v = Number(e.attrs[k]);
        if (!Number.isFinite(v)) { problems.push(`${tag}: ${e.tag}.${k} = ${e.attrs[k]} (NaN/undefined)`); continue; }
        if ((k === 'width' || k === 'height' || k === 'r') && v < 0) problems.push(`${tag}: ${e.tag}.${k} = ${v} (음수)`);
        if (k === 'opacity' && (v < 0 || v > 1)) problems.push(`${tag}: ${e.tag}.opacity = ${v} (범위 밖)`);
      }
      // viewBox 이탈 — 숨겨진(opacity 0) 요소는 좌표만 유효하면 되므로 제외
      const op = 'opacity' in e.attrs ? Number(e.attrs.opacity) : 1;
      if (op > 0.01) {
        if (e.tag === 'rect') {
          const x = Number(e.attrs.x), y = Number(e.attrs.y);
          const w = Number(e.attrs.width || 0), h = Number(e.attrs.height || 0);
          if (x < -1 || y < -1 || x + w > VW + 1 || y + h > VH + 1) problems.push(`${tag}: rect 이탈 x=${x} y=${y} w=${w} h=${h} / ${VW}x${VH}`);
        }
        if (e.tag === 'circle') {
          const cx = Number(e.attrs.cx), cy = Number(e.attrs.cy), r = Number(e.attrs.r);
          if (cx - r < -1 || cy - r < -1 || cx + r > VW + 1 || cy + r > VH + 1) problems.push(`${tag}: circle 이탈 cx=${cx} cy=${cy} r=${r} / ${VW}x${VH}`);
        }
        if (e.tag === 'text') {
          const x = Number(e.attrs.x), y = Number(e.attrs.y);
          if (x < -1 || y < -1 || x > VW + 1 || y > VH + 1) problems.push(`${tag}: text 이탈 x=${x} y=${y} "${e._text}" / ${VW}x${VH}`);
        }
      }
      if (e.tag === 'path' && op > 0.01) {
        if (/NaN|undefined/.test(e.attrs.d || '')) problems.push(`${tag}: path.d = ${e.attrs.d}`);
      }
    }
    const cap = svgC.querySelector('.rr-caption');
    if (!cap || !cap._text.trim()) problems.push(`${tag}: caption 비어 있음 (${svgC.attrs['data-variant']})`);
  }
}

// 전 구간 훑기 — 단계당 24 시점 × 6 단계 × 2 바퀴
const PHASE_MS = 3000, PHASE_COUNT = 6;
const frames = RAFS.slice();
let steps = 0;
for (let lap = 0; lap < 2; lap++) {
  for (let p = 0; p < PHASE_COUNT; p++) {
    for (let k = 0; k < 24; k++) {
      const ts = lap * PHASE_MS * PHASE_COUNT + p * PHASE_MS + (k / 24) * PHASE_MS;
      const pending = RAFS.splice(0, RAFS.length);
      for (const fn of (pending.length ? pending : frames)) fn(ts);
      checkOnce(`lap${lap} ph${p} t${(k / 24).toFixed(2)}`);
      steps++;
    }
  }
}
// ts === 0 정확히 (t0 = -1 함정 회귀)
{
  const pending = RAFS.splice(0, RAFS.length);
  for (const fn of pending) fn(0);
  checkOnce('ts=0');
}

const uniq = [...new Set(problems)];
if (uniq.length) {
  console.log(`FAIL — ${uniq.length} 종 문제 (${steps} 시점 검사)`);
  uniq.slice(0, 40).forEach((p) => console.log('  ' + p));
  process.exit(1);
}
console.log(`OK — variant ${VARIANTS.length}종 × ${steps} 시점, 요소 ${ALL.length}개. NaN·이탈·음수 없음`);
