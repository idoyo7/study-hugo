/* rrev 의미 검사 — 도식이 사실과 어긋나지 않는지 본다.
   rrev-smoke.js 가 "좌표가 깨지지 않았나"를 보는 반면, 이건 "그림이 참말을 하나"를 본다.

   최소 다음을 단정한다(사양 §1 새 6단계표 근거 — content/rollouts/01-canary-step-analysisrun/index.md §1):
   (a) 6단계 전부에서 canary/stable 의 Available·desired·해시 칩·VS weight·가드 유무가
       SPEC 테이블과 정확히 일치한다 (단계표를 이 파일 안에 리터럴로 박아 두고 대조한다)
   (b) canary 패킷은 canary weight 가 0 인 단계에서 한 개도 canary RS 에 도달하지 않는다
   (c) 캡션이 단계마다 다르다

   사용: node tools/flow-render/rrev-assert.js static/flow/rrev.js */
'use strict';
const fs = require('fs');

function makeDom() {
  const all = [];
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
    all.push(e);
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
  return { mkEl, walk, findAll };
}

const dom = makeDom();
const RAFS = [];
const CONTAINERS = [];
function makeContainer(variant) {
  const c = dom.mkEl('html', 'figure');
  c.attrs.class = 'vm-rrev';
  c.attrs['data-variant'] = variant;
  const cap = dom.mkEl('html', 'figcaption');
  cap.attrs.class = 'rr-caption';
  c.appendChild(cap);
  CONTAINERS.push(c);
  return c;
}
const VARIANTS = ['handoff'];
const byVariant = {};
for (const v of VARIANTS) byVariant[v] = makeContainer(v);

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

eval(fs.readFileSync(process.argv[2] || 'static/flow/rrev.js', 'utf8'));

function readState(container) {
  const svg = container.children.find((e) => e.tag === 'svg');
  const flat = []; dom.walk(svg, flat);
  const cls = (c) => flat.filter((e) => (e.attrs.class || '').split(/\s+/).includes(c));
  const startsWith = (p) => flat.find((e) => (e.attrs.class || '').startsWith(p));
  const chipTexts = flat.filter((e) => (e.attrs.class || '') === 'rr-chiptext');
  // chipCanaryTx/chipTexts 는 순서로 canary(첫)·stable(둘째) 구분 — DOM 생성 순서가 그렇다
  const guard = cls('rr-guard')[0];
  const vstext = startsWith('rr-vstext');
  const availStable = cls('rr-avail-stable')[0];
  const availCanary = cls('rr-avail-canary')[0];
  const pktCanary = cls('rr-pkt-canary');
  const mw = (vstext ? vstext._text : '').match(/canary (\d+)%/);
  const ms = (availStable ? availStable._text : '').match(/Available (\d+)\s*\/\s*desired (\d+)/);
  const mc = (availCanary ? availCanary._text : '').match(/Available (\d+)\s*\/\s*desired (\d+)/);
  return {
    canaryHash: chipTexts[0] ? chipTexts[0]._text : '',
    stableHash: chipTexts[1] ? chipTexts[1]._text : '',
    guardVisible: guard ? Number(guard.attrs.opacity) > 0.01 : false,
    canaryWeight: mw ? Number(mw[1]) : null,
    stableAvail: ms ? Number(ms[1]) : null,
    stableDesired: ms ? Number(ms[2]) : null,
    canaryExists: !!mc,
    canaryAvail: mc ? Number(mc[1]) : null,
    canaryDesired: mc ? Number(mc[2]) : null,
    canaryPacketCount: pktCanary.length,
    caption: (container.querySelector('.rr-caption') || { _text: '' })._text,
  };
}

const PHASE_MS = 3000, PHASE_COUNT = 6;
const frames = RAFS.slice();
const seen = { handoff: [] };
for (let p = 0; p < PHASE_COUNT; p++) {
  for (let k = 0; k < 10; k++) {
    const ts = p * PHASE_MS + (k / 10) * PHASE_MS + 1;
    const pending = RAFS.splice(0, RAFS.length);
    for (const fn of (pending.length ? pending : frames)) fn(ts);
    seen.handoff.push({ phase: p, t: k / 10, ...readState(byVariant.handoff) });
  }
}

const fails = [];
function check(cond, msg) { if (!cond) fails.push(msg); }
const S = seen.handoff;

/* ── (a) 새 6단계표 — index.md §1 이 정본. 리터럴로 박아 두고 매 phase 마다 대조한다.
   canaryExists 가 false 인 단계(①⑥)는 canary 카드가 비어 있으므로 canaryAvail/canaryDesired 를
   보지 않는다 — null 로 둔다. */
const GLYPHS = ['①', '②', '③', '④', '⑤', '⑥'];
const SPEC = [
  /* ① */ { canaryExists: false, canaryAvail: null, canaryDesired: null, stableAvail: 20, stableDesired: 20, canaryHash: 'hash⟨N⟩', stableHash: 'hash⟨N⟩', weightCanary: 0, guardOn: false },
  /* ② */ { canaryExists: true, canaryAvail: 0, canaryDesired: 0, stableAvail: 20, stableDesired: 20, canaryHash: 'hash⟨N⟩', stableHash: 'hash⟨N⟩', weightCanary: 0, guardOn: false },
  /* ③ */ { canaryExists: true, canaryAvail: 0, canaryDesired: 0, stableAvail: 20, stableDesired: 20, canaryHash: 'hash⟨N+1⟩', stableHash: 'hash⟨N⟩', weightCanary: 0, guardOn: false },
  /* ④ */ { canaryExists: true, canaryAvail: 0, canaryDesired: 2, stableAvail: 20, stableDesired: 20, canaryHash: 'hash⟨N+1⟩', stableHash: 'hash⟨N⟩', weightCanary: 0, guardOn: true },
  /* ⑤ */ { canaryExists: true, canaryAvail: 2, canaryDesired: 2, stableAvail: 20, stableDesired: 20, canaryHash: 'hash⟨N+1⟩', stableHash: 'hash⟨N⟩', weightCanary: 5, guardOn: false },
  /* ⑥ */ { canaryExists: false, canaryAvail: null, canaryDesired: null, stableAvail: 20, stableDesired: 20, canaryHash: 'hash⟨N+1⟩', stableHash: 'hash⟨N+1⟩', weightCanary: 0, guardOn: false },
];

for (const s of S) {
  const spec = SPEC[s.phase];
  const g = GLYPHS[s.phase];
  check(s.canaryExists === spec.canaryExists, `phase${s.phase}(${g}) t${s.t}: canaryExists 가 ${spec.canaryExists} 여야 하는데 ${s.canaryExists}`);
  if (spec.canaryExists) {
    check(s.canaryAvail === spec.canaryAvail, `phase${s.phase}(${g}) t${s.t}: canary Available 이 ${spec.canaryAvail} 여야 하는데 ${s.canaryAvail}`);
    check(s.canaryDesired === spec.canaryDesired, `phase${s.phase}(${g}) t${s.t}: canary desired 가 ${spec.canaryDesired} 여야 하는데 ${s.canaryDesired}`);
  }
  check(s.stableAvail === spec.stableAvail, `phase${s.phase}(${g}) t${s.t}: stable Available 이 ${spec.stableAvail} 여야 하는데 ${s.stableAvail}`);
  check(s.stableDesired === spec.stableDesired, `phase${s.phase}(${g}) t${s.t}: stable desired 가 ${spec.stableDesired} 여야 하는데 ${s.stableDesired}`);
  check(s.canaryHash === spec.canaryHash, `phase${s.phase}(${g}) t${s.t}: canary 해시 칩이 "${spec.canaryHash}" 여야 하는데 "${s.canaryHash}"`);
  check(s.stableHash === spec.stableHash, `phase${s.phase}(${g}) t${s.t}: stable 해시 칩이 "${spec.stableHash}" 여야 하는데 "${s.stableHash}"`);
  check(s.canaryWeight === spec.weightCanary, `phase${s.phase}(${g}) t${s.t}: canary weight 가 ${spec.weightCanary} 여야 하는데 ${s.canaryWeight}`);
  check(s.guardVisible === spec.guardOn, `phase${s.phase}(${g}) t${s.t}: 가드 배너가 ${spec.guardOn ? '보여야' : '안 보여야'} 하는데 ${s.guardVisible ? '보인다' : '안 보인다'}`);
}

/* (b) canary weight 가 0 인 단계에서 canary 로 향하는 패킷이 한 개도 없다.
   weight 5(⑤) 에서는 canary 패킷이 실제로 존재해야 도식이 성립한다 */
for (const s of S.filter((s) => s.canaryWeight === 0)) {
  check(s.canaryPacketCount === 0, `phase${s.phase} t${s.t}: canary weight 0 인데 canary 패킷 ${s.canaryPacketCount}개가 도달 경로에 있다`);
}
check(S.filter((s) => s.phase === 4).every((s) => s.canaryPacketCount > 0), 'phase4(⑤): canary weight 5%인데 canary 패킷이 한 번도 없다');

/* (c) 캡션이 단계마다 다르다 */
{
  const caps = [...new Set(S.map((s) => s.caption))];
  check(caps.length >= PHASE_COUNT, `캡션이 ${caps.length}종뿐이다 — ${PHASE_COUNT}단계면 ${PHASE_COUNT}종이어야 한다`);
}

if (fails.length) {
  console.log(`FAIL — ${fails.length}건`);
  fails.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
console.log(`OK — variant ${VARIANTS.length}종 × ${PHASE_COUNT}단계 × 10시점, 단계표 대조(필드 8종) + 의미 검사 3종 통과`);
