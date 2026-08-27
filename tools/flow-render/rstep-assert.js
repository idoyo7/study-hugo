/* rstep 의미 검사 — 도식이 사실과 어긋나지 않는지 본다.
   rstep-smoke.js 가 "좌표가 깨지지 않았나"를 보는 반면, 이건 "그림이 참말을 하나"를 본다.
   빨간 칸(확보되지 않았는데 라우팅된 몫)은 rollback variant 에서만, 그것도 역탐색이
   100 을 집은 뒤에만 나타나야 한다. deploy·promote·fixed 에서 한 번이라도 나타나면
   그 도식은 거짓말을 하고 있다.

   사용: node tools/flow-render/rstep-assert.js static/flow/rstep.js */
'use strict';
const fs = require('fs');

/* computeFrame 을 엔진에서 그대로 꺼내 쓸 수 없으므로(클로저 안에 있다),
   engine 을 DOM 스텁 위에서 돌리고 매 프레임 화면에 찍힌 값을 되읽는다. */
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
  c.attrs.class = 'vm-rstep';
  c.attrs['data-variant'] = variant;
  const cap = dom.mkEl('html', 'figcaption');
  cap.attrs.class = 'rs-caption';
  c.appendChild(cap);
  CONTAINERS.push(c);
  return c;
}
const VARIANTS = ['deploy', 'promote', 'rollback', 'fixed'];
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

eval(fs.readFileSync(process.argv[2] || 'static/flow/rstep.js', 'utf8'));

/* 화면에서 되읽는 값들 */
function readState(container) {
  const svg = container.children.find((e) => e.tag === 'svg');
  const flat = []; dom.walk(svg, flat);
  const cls = (c) => flat.filter((e) => (e.attrs.class || '').split(/\s+/).includes(c));
  const short = cls('rs-bar-short')[0];
  const barval = flat.find((e) => (e.attrs.class || '').startsWith('rs-barval'));
  const wtext = flat.find((e) => (e.attrs.class || '').startsWith('rs-wtext'));
  const avail = flat.filter((e) => (e.attrs.class || '').startsWith('rs-avail'));
  const src = flat.find((e) => (e.attrs.class || '').startsWith('rs-src'));
  const skip = cls('rs-skip')[0];
  const rev = cls('rs-rev')[0];
  const pill = flat.find((e) => (e.attrs.class || '').startsWith('rs-pilltext'));
  return {
    shortVisible: short ? Number(short.attrs.opacity) > 0.01 && Number(short.attrs.width) > 1 : false,
    shortWidth: short ? Number(short.attrs.width) : 0,
    barval: barval ? barval._text : '',
    wtext: wtext ? wtext._text : '',
    canaryAvail: avail[0] ? avail[0]._text : '',
    stableAvail: avail[1] ? avail[1]._text : '',
    src: src ? src._text : '',
    skipVisible: skip ? Number(skip.attrs.opacity) > 0.01 : false,
    revVisible: rev ? Number(rev.attrs.opacity) > 0.01 : false,
    analysis: pill ? pill._text : '',
    caption: (container.querySelector('.rs-caption') || { _text: '' })._text,
  };
}

const PHASE_MS = 3200, PHASE_COUNT = 6;
const frames = RAFS.slice();
const seen = {};
for (const v of VARIANTS) seen[v] = [];
for (let p = 0; p < PHASE_COUNT; p++) {
  for (let k = 0; k < 10; k++) {
    const ts = p * PHASE_MS + (k / 10) * PHASE_MS + 1;
    const pending = RAFS.splice(0, RAFS.length);
    for (const fn of (pending.length ? pending : frames)) fn(ts);
    for (const v of VARIANTS) seen[v].push({ phase: p, t: k / 10, ...readState(byVariant[v]) });
  }
}

const fails = [];
function check(cond, msg) { if (!cond) fails.push(msg); }

/* 1. 빨간 칸은 rollback 에서만 */
for (const v of ['deploy', 'promote', 'fixed']) {
  const bad = seen[v].filter((s) => s.shortVisible);
  check(bad.length === 0,
    `${v}: 미가용 구간(빨간 칸)이 ${bad.length}개 시점에서 나타났다 — 이 variant 에서는 절대 안 나와야 한다` +
    (bad[0] ? ` (첫 발생 ph${bad[0].phase} t${bad[0].t}, w=${bad[0].shortWidth.toFixed(0)}, ${bad[0].wtext})` : ''));
}
{
  const hit = seen.rollback.filter((s) => s.shortVisible);
  check(hit.length > 0, 'rollback: 미가용 구간이 한 번도 안 나타났다 — 사고를 그리지 못하고 있다');
  const phases = [...new Set(hit.map((s) => s.phase))];
  check(phases.every((p) => p >= 2), `rollback: 미가용 구간이 ③단계보다 먼저 나타났다 (phases: ${phases.join(',')})`);
}

/* 2. 스킵 호는 deploy 에서만 안 나타난다 */
check(seen.deploy.every((s) => !s.skipVisible), 'deploy: 스킵 호가 나타났다 — 정상 배포는 스텝을 건너뛰지 않는다');
for (const v of ['promote', 'rollback', 'fixed']) {
  check(seen[v].some((s) => s.skipVisible), `${v}: 스킵 호가 한 번도 안 나타났다`);
}

/* 3. 역탐색 화살표는 promote 에서 안 나타난다 (PromoteFull 은 :245 에 진입하지 않는다) */
check(seen.promote.every((s) => !s.revVisible),
  'promote: 역탐색 화살표가 나타났다 — PromoteFull 은 :229 자기 갈래를 타므로 역탐색에 진입하지 않는다');
for (const v of ['rollback', 'fixed']) {
  check(seen[v].some((s) => s.revVisible), `${v}: 역탐색 화살표가 한 번도 안 나타났다`);
}

/* 4. promote 는 가중치가 동결된다 — 5% 를 넘는 구간이 마지막 승격 전에 없어야 한다 */
{
  const pre = seen.promote.filter((s) => s.phase < 5);
  const over = pre.filter((s) => /canary (\d+)%/.test(s.wtext) && Number(s.wtext.match(/canary (\d+)%/)[1]) > 5);
  check(over.length === 0, `promote: 승격 전에 가중치가 5% 를 넘었다 (${over.length}개 시점) — 동결이 깨졌다`);
}

/* 5. rollback 은 ③단계에서 100% 에 도달한다 */
{
  const ph2 = seen.rollback.filter((s) => s.phase === 2);
  check(ph2.some((s) => /canary 100%/.test(s.wtext)), 'rollback: ③단계에서 가중치 100% 가 안 나왔다');
}

/* 6. fixed 는 ③·④단계에서 5% 다 */
{
  const mid = seen.fixed.filter((s) => s.phase === 2 || s.phase === 3);
  const bad = mid.filter((s) => /canary (\d+)%/.test(s.wtext) && Number(s.wtext.match(/canary (\d+)%/)[1]) > 5);
  check(bad.length === 0, `fixed: ③·④단계에서 가중치가 5% 를 넘었다 (${bad.length}개 시점)`);
}

/* 7. AnalysisRun 은 스킵 variant 셋에서 모두 '취소' 상태를 거친다 */
for (const v of ['promote', 'rollback', 'fixed']) {
  check(seen[v].some((s) => /취소/.test(s.analysis)), `${v}: AnalysisRun 취소 상태가 안 나타났다`);
}
check(seen.deploy.every((s) => !/취소/.test(s.analysis)), 'deploy: AnalysisRun 이 취소됐다 — 정상 배포에서는 취소되지 않는다');

/* 8. 요구 파드 수와 가중치가 서로 유도된다 (ceil(20 * w / 100)) */
for (const v of VARIANTS) {
  for (const s of seen[v]) {
    const mw = s.wtext.match(/canary (\d+)%/);
    const mn = s.wtext.match(/요구 (\d+)대/);
    if (!mw || !mn) continue;
    const w = Number(mw[1]), need = Number(mn[1]);
    const expect = Math.ceil(20 * w / 100);
    if (need !== expect) {
      fails.push(`${v} ph${s.phase}: 가중치 ${w}% 인데 요구 ${need}대 (유도값은 ${expect}대) — 두 수치가 어긋난다`);
      break;
    }
  }
}

/* 9. 캡션이 단계마다 바뀐다 */
for (const v of VARIANTS) {
  const caps = [...new Set(seen[v].map((s) => s.caption))];
  check(caps.length >= PHASE_COUNT, `${v}: 캡션이 ${caps.length}종뿐이다 — 6단계면 6종이어야 한다`);
}

if (fails.length) {
  console.log(`FAIL — ${fails.length}건`);
  fails.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
console.log(`OK — variant ${VARIANTS.length}종 × ${PHASE_COUNT}단계 × 10시점, 의미 검사 9종 통과`);
