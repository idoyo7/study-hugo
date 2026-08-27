/* nextra 이식 대기 모듈 ↔ Hugo 엔진 패리티.
   nextra-port/rollouts/rstep-frames.mjs 는 static/flow/rstep.js 와 같은 계산을 들고 있다
   (엔진은 번들러 없이 도는 IIFE 라 모듈을 import 할 수 없다). 두 곳에 같은 로직이 있으면
   드리프트가 난다 — 이 스크립트가 그걸 잡는다.

   비교 방식: 모듈은 프레임 객체를 직접 내고, 엔진은 SVG 에 칠한 값만 관측 가능하다.
   그래서 엔진이 칠한 텍스트에서 값을 되읽어 모듈의 프레임과 대조한다.
   어느 한쪽을 고치면 여기가 깨진다. 깨지면 양쪽을 맞춰라 — 한쪽만 고치고 이 파일을
   느슨하게 만들지 마라. 그러면 이식 시점에 조용히 다른 그림이 나온다.

   사용: node tools/flow-render/port-parity.js */
'use strict';
const fs = require('fs');
const path = require('path');

const ENGINE = path.join(__dirname, '../../static/flow/rstep.js');
const MODULE = path.join(__dirname, '../../nextra-port/rollouts/rstep-frames.mjs');

/* ── DOM 스텁 ── */
function makeDom() {
  function mkEl(ns, tag) {
    const e = {
      ns, tag, attrs: {}, children: [], _text: '',
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      appendChild(c) { this.children.push(c); return c; },
      insertBefore(c) { this.children.unshift(c); return c; },
      querySelector(sel) { return findAll(this, sel)[0] || null; },
      querySelectorAll(sel) { return findAll(this, sel); },
      get textContent() { return this._text; },
      set textContent(v) { this._text = v; },
      get firstChild() { return this.children[0] || null; },
      classList: { add() {} },
    };
    return e;
  }
  function matches(e, sel) {
    if (sel.startsWith('.')) return (e.attrs.class || '').split(/\s+/).includes(sel.slice(1));
    return e.tag === sel;
  }
  function walk(e, out) { for (const c of e.children) { out.push(c); walk(c, out); } }
  function findAll(root, sel) {
    const flat = []; walk(root, flat);
    return flat.filter((e) => sel.split(',').map((s) => s.trim()).some((s) => matches(e, s)));
  }
  return { mkEl, walk };
}

const dom = makeDom();
const RAFS = [];
const CONTAINERS = [];
const byVariant = {};

function loadModule() {
  /* .mjs 를 require 할 수 없으므로 export 를 걷어내고 평가한다.
     (동적 import 를 쓰면 이 파일이 async 가 되고 CJS 툴체인과 섞인다) */
  let src = fs.readFileSync(MODULE, 'utf8');
  src = src.replace(/^export\s+/gm, '');
  const exportsBag = {};
  const fn = new Function('exportsBag', src + '\nexportsBag.C = C; exportsBag.VARIANTS = VARIANTS; exportsBag.VARIANT_KEYS = VARIANT_KEYS; exportsBag.computeFrame = computeFrame; exportsBag.makeConfig = makeConfig; exportsBag.requiredPods = requiredPods;');
  fn(exportsBag);
  return exportsBag;
}

const M = loadModule();
const VARIANT_KEYS = M.VARIANT_KEYS;

for (const v of VARIANT_KEYS) {
  const c = dom.mkEl('html', 'figure');
  c.attrs.class = 'vm-rstep';
  c.attrs['data-variant'] = v;
  const cap = dom.mkEl('html', 'figcaption');
  cap.attrs.class = 'rs-caption';
  c.appendChild(cap);
  CONTAINERS.push(c);
  byVariant[v] = c;
}

global.requestAnimationFrame = (fn) => { RAFS.push(fn); return RAFS.length; };
global.cancelAnimationFrame = () => {};
global.document = {
  readyState: 'complete',
  createElementNS: (ns, tag) => dom.mkEl(ns, tag),
  createElement: (tag) => dom.mkEl('html', tag),
  addEventListener() {},
  querySelectorAll: () => CONTAINERS,
};
global.window = { matchMedia: () => ({ matches: false }) };

eval(fs.readFileSync(ENGINE, 'utf8'));

/* 엔진이 칠한 값 되읽기 */
function readEngine(container) {
  const svg = container.children.find((e) => e.tag === 'svg');
  const flat = []; dom.walk(svg, flat);
  const startsWith = (p) => flat.find((e) => (e.attrs.class || '').startsWith(p));
  const cls = (c) => flat.filter((e) => (e.attrs.class || '').split(/\s+/).includes(c));
  const wtext = startsWith('rs-wtext');
  const src = startsWith('rs-src');
  const gate = startsWith('rs-gate');
  const verdict = startsWith('rs-verdict');
  const pill = startsWith('rs-pilltext');
  const avail = flat.filter((e) => (e.attrs.class || '').startsWith('rs-avail'));
  const skip = cls('rs-skip')[0];
  const rev = cls('rs-rev')[0];
  const mw = (wtext ? wtext._text : '').match(/canary (\d+)%/);
  const mc = (avail[0] ? avail[0]._text : '').match(/Available (\d+)\s*\/\s*desired (\d+)/);
  const ms = (avail[1] ? avail[1]._text : '').match(/Available (\d+)\s*\/\s*desired (\d+)/);
  const AR = { 'AnalysisRun  —  아직 없음': 'none', 'AnalysisRun  —  Running · 20s 간격 측정': 'running', 'AnalysisRun  —  스킵 + 실행분 취소': 'cancelled', 'AnalysisRun  —  Successful': 'ok' };
  return {
    weight: mw ? Number(mw[1]) : null,
    cAvail: mc ? Number(mc[1]) : null,
    cDesired: mc ? Number(mc[2]) : null,
    sAvail: ms ? Number(ms[1]) : null,
    sDesired: ms ? Number(ms[2]) : null,
    src: src ? src._text : '',
    gate: gate ? gate._text : '',
    verdict: verdict ? verdict._text : '',
    analysis: pill ? (AR[pill._text] !== undefined ? AR[pill._text] : pill._text) : '',
    skipVisible: skip ? Number(skip.attrs.opacity) > 0.01 : false,
    revVisible: rev ? Number(rev.attrs.opacity) > 0.01 : false,
    caption: (container.querySelector('.rs-caption') || { _text: '' })._text,
  };
}

const PHASE_MS = M.C.PHASE_MS, PHASE_COUNT = M.C.PHASE_COUNT;
const frames = RAFS.slice();
const diffs = [];
let compared = 0;

for (let p = 0; p < PHASE_COUNT; p++) {
  for (let k = 0; k < 10; k++) {
    const t = k / 10;
    const ts = p * PHASE_MS + t * PHASE_MS + 1;
    const pending = RAFS.splice(0, RAFS.length);
    for (const fn of (pending.length ? pending : frames)) fn(ts);
    for (const v of VARIANT_KEYS) {
      const eng = readEngine(byVariant[v]);
      /* 엔진은 ts 를 (ts - t0) 로 쓰는데 t0 = 첫 프레임 ts = 1 이므로
         실제 진행은 (ts - 1) 이다. 모듈에도 같은 값을 넣어 맞춘다. */
      const el = ts - 1;
      const total = el % (PHASE_MS * PHASE_COUNT);
      const mp = Math.floor(total / PHASE_MS);
      const mt = (total % PHASE_MS) / PHASE_MS;
      const mod = M.computeFrame(v, mp, mt);
      const cfg = M.makeConfig(v);
      const want = {
        weight: mod.weight,
        cAvail: mod.cAvail, cDesired: mod.cDesired,
        sAvail: mod.sAvail, sDesired: mod.sDesired,
        src: mod.src, gate: mod.gate, verdict: mod.verdict,
        analysis: mod.analysis,
        skipVisible: mod.skipFrom >= 0,
        revVisible: mod.revHit >= 0,
        caption: cfg.captions[mp],
      };
      for (const key of Object.keys(want)) {
        if (eng[key] !== want[key]) {
          diffs.push(`${v} ph${mp} t${mt.toFixed(2)} · ${key}\n      엔진: ${JSON.stringify(eng[key])}\n      모듈: ${JSON.stringify(want[key])}`);
        }
      }
      compared++;
    }
  }
}

/* 요구 파드 수 유도식도 양쪽이 같은지 */
for (const w of [0, 1, 5, 50, 100]) {
  const want = Math.ceil(M.C.REPLICAS * w / 100);
  if (M.requiredPods(w) !== want) diffs.push(`requiredPods(${w}) = ${M.requiredPods(w)} != ${want}`);
}

const uniq = [...new Set(diffs)];
if (uniq.length) {
  console.log(`FAIL — 엔진과 이식 모듈이 어긋난다 (${uniq.length}종 / ${compared}회 비교)`);
  uniq.slice(0, 25).forEach((d) => console.log('  ' + d));
  if (uniq.length > 25) console.log(`  ... ${uniq.length - 25}종 더`);
  console.log('\n한쪽만 고치고 이 테스트를 느슨하게 만들지 마라 — 이식 시점에 다른 그림이 나온다.');
  process.exit(1);
}
console.log(`OK — 엔진 ↔ 이식 모듈 일치. variant ${VARIANT_KEYS.length}종 × ${PHASE_COUNT}단계 × 10시점, 필드 12종 (${compared}회 비교)`);
