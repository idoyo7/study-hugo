/* nextra 이식 대기 모듈 ↔ Hugo 엔진 패리티. 두 엔진을 각각 검사한다:
     rstep ↔ nextra-port/rollouts/rstep-frames.mjs
     rrev  ↔ nextra-port/rollouts/rrev-frames.mjs
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

/* ── DOM 스텁 (두 엔진이 공유) ── */
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

function loadEsmAsFunctionBag(modulePath) {
  /* .mjs 를 require 할 수 없으므로 export 를 걷어내고 평가한다.
     (동적 import 를 쓰면 이 파일이 async 가 되고 CJS 툴체인과 섞인다) */
  let src = fs.readFileSync(modulePath, 'utf8');
  src = src.replace(/^export\s+/gm, '');
  return { src };
}

let TOTAL_DIFFS = 0;

/* ══════════════════════════ rstep ══════════════════════════ */
function runRstepParity() {
  const ENGINE = path.join(__dirname, '../../static/flow/rstep.js');
  const MODULE = path.join(__dirname, '../../nextra-port/rollouts/rstep-frames.mjs');
  const dom = makeDom();
  const RAFS = [];
  const CONTAINERS = [];
  const byVariant = {};

  const { src } = loadEsmAsFunctionBag(MODULE);
  const exportsBag = {};
  const fn = new Function('exportsBag', src + '\nexportsBag.C = C; exportsBag.VARIANTS = VARIANTS; exportsBag.VARIANT_KEYS = VARIANT_KEYS; exportsBag.computeFrame = computeFrame; exportsBag.makeConfig = makeConfig; exportsBag.requiredPods = requiredPods;');
  fn(exportsBag);
  const M = exportsBag;
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

  global.requestAnimationFrame = (fn2) => { RAFS.push(fn2); return RAFS.length; };
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

  function readEngine(container) {
    const svg = container.children.find((e) => e.tag === 'svg');
    const flat = []; dom.walk(svg, flat);
    const startsWith = (p) => flat.find((e) => (e.attrs.class || '').startsWith(p));
    const cls = (c) => flat.filter((e) => (e.attrs.class || '').split(/\s+/).includes(c));
    const wtext = startsWith('rs-wtext');
    const src2 = startsWith('rs-src');
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
      src: src2 ? src2._text : '',
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
      for (const fn2 of (pending.length ? pending : frames)) fn2(ts);
      for (const v of VARIANT_KEYS) {
        const eng = readEngine(byVariant[v]);
        const elapsed = ts - 1;
        const total = elapsed % (PHASE_MS * PHASE_COUNT);
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

  for (const w of [0, 1, 5, 50, 100]) {
    const want = Math.ceil(M.C.REPLICAS * w / 100);
    if (M.requiredPods(w) !== want) diffs.push(`requiredPods(${w}) = ${M.requiredPods(w)} != ${want}`);
  }

  const uniq = [...new Set(diffs)];
  if (uniq.length) {
    console.log(`FAIL rstep — 엔진과 이식 모듈이 어긋난다 (${uniq.length}종 / ${compared}회 비교)`);
    uniq.slice(0, 25).forEach((d) => console.log('  ' + d));
    if (uniq.length > 25) console.log(`  ... ${uniq.length - 25}종 더`);
  } else {
    console.log(`OK rstep — 엔진 ↔ 이식 모듈 일치. variant ${VARIANT_KEYS.length}종 × ${PHASE_COUNT}단계 × 10시점, 필드 12종 (${compared}회 비교)`);
  }
  TOTAL_DIFFS += uniq.length;
}

/* ══════════════════════════ rrev ══════════════════════════ */
function runRrevParity() {
  const ENGINE = path.join(__dirname, '../../static/flow/rrev.js');
  const MODULE = path.join(__dirname, '../../nextra-port/rollouts/rrev-frames.mjs');
  const dom = makeDom();
  const RAFS = [];
  const CONTAINERS = [];
  const byVariant = {};

  const { src } = loadEsmAsFunctionBag(MODULE);
  const exportsBag = {};
  const fn = new Function('exportsBag', src + '\nexportsBag.C = C; exportsBag.CANARY_DESIRED = CANARY_DESIRED; exportsBag.VARIANTS = VARIANTS; exportsBag.VARIANT_KEYS = VARIANT_KEYS; exportsBag.computeFrame = computeFrame; exportsBag.makeConfig = makeConfig;');
  fn(exportsBag);
  const M = exportsBag;
  const VARIANT_KEYS = M.VARIANT_KEYS;

  for (const v of VARIANT_KEYS) {
    const c = dom.mkEl('html', 'figure');
    c.attrs.class = 'vm-rrev';
    c.attrs['data-variant'] = v;
    const cap = dom.mkEl('html', 'figcaption');
    cap.attrs.class = 'rr-caption';
    c.appendChild(cap);
    CONTAINERS.push(c);
    byVariant[v] = c;
  }

  global.requestAnimationFrame = (fn2) => { RAFS.push(fn2); return RAFS.length; };
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

  function readEngine(container) {
    const svg = container.children.find((e) => e.tag === 'svg');
    const flat = []; dom.walk(svg, flat);
    const startsWith = (p) => flat.find((e) => (e.attrs.class || '').startsWith(p));
    const cls = (c) => flat.filter((e) => (e.attrs.class || '').split(/\s+/).includes(c));
    const chipTexts = flat.filter((e) => (e.attrs.class || '') === 'rr-chiptext');
    const vstext = startsWith('rr-vstext');
    const guard = cls('rr-guard')[0];
    const availStable = cls('rr-avail-stable')[0];
    const availCanary = cls('rr-avail-canary')[0];
    const pktCanary = cls('rr-pkt-canary');
    // roLine1/roLine2·srsRevTx/crsRevTx 는 각각 rr-mono·rr-note 를 정적 라벨과 공유한다 —
    // 순서로 구분한다(DOM 생성 순서가 그렇다). rr-mono: [0]name [1]instance [2]roLine1 [3]roLine2.
    // rr-note: [0]Service note("canary+stable 함께 선택", class="rr-note rr-note-traffic" — 이것도
    // rr-note 로 잡힌다) [1]DR note [2]VS note [3]Rollout note [4]srsRevTx [5]crsRevTx.
    const monos = cls('rr-mono');
    const notes = cls('rr-note');
    const roLine1Text = monos[2] ? monos[2]._text : '';
    const roLine2Text = monos[3] ? monos[3]._text : '';
    const srsRevText = notes[4] ? notes[4]._text : '';
    const crsRevText = notes[5] ? notes[5]._text : '';
    const mw = (vstext ? vstext._text : '').match(/canary (\d+)%/);
    const ms = (availStable ? availStable._text : '').match(/Available (\d+)\s*\/\s*desired (\d+)/);
    const mcanary = (availCanary ? availCanary._text : '').match(/Available (\d+)\s*\/\s*desired (\d+)/);
    const mStableRev = srsRevText.match(/revision: rev (.+)/);
    const mCanaryRev = roLine2Text.match(/canary → rev (.+)/);
    const mCanaryStatus = crsRevText.match(/· (.+)$/);
    return {
      canaryHash: chipTexts[0] ? chipTexts[0]._text : '',
      stableHash: chipTexts[1] ? chipTexts[1]._text : '',
      guardOn: guard ? Number(guard.attrs.opacity) > 0.01 : false,
      weightCanary: mw ? Number(mw[1]) : null,
      weightStable: mw ? 100 - Number(mw[1]) : null,
      stableAvail: ms ? Number(ms[1]) : null,
      stableDesired: ms ? Number(ms[2]) : null,
      canaryExists: !!mcanary,
      canaryAvail: mcanary ? Number(mcanary[1]) : 0,
      canaryDesired: mcanary ? Number(mcanary[2]) : 0,
      canaryPacketCount: pktCanary.length,
      canaryGone: /\(승격됨\)/.test(roLine1Text),
      stableRev: mStableRev ? mStableRev[1] : '',
      canaryRev: mCanaryRev ? mCanaryRev[1] : '',
      canaryStatus: mCanaryStatus ? mCanaryStatus[1] : '',
      caption: (container.querySelector('.rr-caption') || { _text: '' })._text,
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
      for (const fn2 of (pending.length ? pending : frames)) fn2(ts);
      for (const v of VARIANT_KEYS) {
        const eng = readEngine(byVariant[v]);
        const elapsed = ts - 1;
        const total = elapsed % (PHASE_MS * PHASE_COUNT);
        const mp = Math.floor(total / PHASE_MS);
        const mt = (total % PHASE_MS) / PHASE_MS;
        const mod = M.computeFrame(v, mp, mt);
        const cfg = M.makeConfig(v);
        const canaryCount = mod.packets.filter((pk) => pk.target === 'canary').length;
        const want = {
          canaryHash: mod.canaryHash,
          stableHash: mod.stableHash,
          guardOn: mod.guardOn,
          weightCanary: mod.weightCanary,
          weightStable: mod.weightStable,
          stableAvail: mod.stableAvail,
          stableDesired: mod.stableDesired,
          canaryExists: mod.canaryExists,
          canaryAvail: mod.canaryExists ? mod.canaryAvail : 0,
          canaryDesired: mod.canaryExists ? mod.canaryDesired : 0,
          canaryPacketCount: canaryCount,
          canaryGone: mod.canaryGone,
          stableRev: mod.stableRev,
          canaryRev: mod.canaryRev,
          canaryStatus: mod.canaryStatus,
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

  const uniq = [...new Set(diffs)];
  if (uniq.length) {
    console.log(`FAIL rrev — 엔진과 이식 모듈이 어긋난다 (${uniq.length}종 / ${compared}회 비교)`);
    uniq.slice(0, 25).forEach((d) => console.log('  ' + d));
    if (uniq.length > 25) console.log(`  ... ${uniq.length - 25}종 더`);
  } else {
    console.log(`OK rrev — 엔진 ↔ 이식 모듈 일치. variant ${VARIANT_KEYS.length}종 × ${PHASE_COUNT}단계 × 10시점, 필드 16종 (${compared}회 비교)`);
  }
  TOTAL_DIFFS += uniq.length;
}

runRstepParity();
runRrevParity();

if (TOTAL_DIFFS > 0) {
  console.log('\n한쪽만 고치고 이 테스트를 느슨하게 만들지 마라 — 이식 시점에 다른 그림이 나온다.');
  process.exit(1);
}
