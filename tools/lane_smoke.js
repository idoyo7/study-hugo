/* lane.js 렌더 스모크 — 브라우저 없이 최소 DOM 스텁 위에서 엔진을 돌려
   ①NaN·음수 폭 ②viewBox 이탈 ③pattern id 유일성 ④category 칸 구분선 수
   ⑤linear 초과 세그먼트 경고 ⑥텍스트가 칸/다음 세그먼트 경계를 넘지 않음
   여섯 항목을 검사한다(DIAGRAMS.md §검증 규약).
   사용: node tools/lane_smoke.js content/runtime/01-jvm-graalvm/_lane/*.json */
'use strict';
const fs = require('fs');

// lane.js 의 레이아웃 상수와 텍스트 폭 추정 방식을 그대로 복제 — ⑥ 검사는 엔진과 같은 잣대로 재본다
const CONST = { GUTTER_W: 118, COL_W: 150, TRACK_W: 640, MARGIN: 16, COL_PAD: 6 };
function chw(ch) { return ch.charCodeAt(0) > 0x2E80 ? 0.98 : 0.56; }
function estw(s, fpx) { let w = 0; for (const ch of s) w += chw(ch) * fpx; return w; }

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
    dataset: {},
    classList: { add() {}, remove() {} },
    style: {},
  };
  ALL.push(e);
  return e;
}
function matches(e, sel) {
  if (sel.startsWith('.')) { const cls = (e.attrs.class || '').split(/\s+/); return cls.indexOf(sel.slice(1)) >= 0; }
  if (sel.startsWith('script.')) return e.tag === 'script' && matches(e, sel.slice(6));
  return e.tag === sel;
}
function walk(e, out) { for (const c of e.children) { out.push(c); walk(c, out); } }
function findAll(root, sel) { const flat = []; walk(root, flat); return flat.filter((e) => sel.split(',').map((s) => s.trim()).some((s) => matches(e, s))); }
function findOne(root, sel) { return findAll(root, sel)[0] || null; }
function cls(e) { return (e.attrs.class || '').split(/\s+/); }
function fontPx(e) { const m = /font-size:\s*([\d.]+)px/.exec(e.attrs.style || ''); return m ? Number(m[1]) : 12; }

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
// IntersectionObserver 없음 → 엔진이 즉시 start() 를 탄다(flow 관례와 동일)
global.window = { matchMedia: () => ({ matches: false }), requestAnimationFrame: global.requestAnimationFrame };

const warnings = [];
const origWarn = console.warn;
console.warn = (...args) => { warnings.push(args.join(' ')); };

function makeContainer(specObj) {
  const c = mkEl('html', 'figure');
  c.attrs.class = 'vm-lane';
  const s = mkEl('html', 'script');
  s.attrs.class = 'lane-spec';
  s._text = JSON.stringify(specObj);
  c.appendChild(s);
  c._spec = specObj;
  return c;
}

const files = process.argv.slice(2);
if (!files.length) { origWarn('사용: node tools/lane_smoke.js <spec.json...>'); process.exit(2); }

const fileSpecs = files.map((f) => ({ file: f, spec: JSON.parse(fs.readFileSync(f, 'utf8')) }));

// 합성 케이스 — 항목 ⑤(linear 초과) 및 축 불일치 skip 경고를 직접 검증
const synthLinearOverflow = {
  caption: '합성: linear 초과',
  axis: { kind: 'linear', max: 4, unit: 'GB' },
  lanes: [{ label: 'X', segments: [
    { start: 0, end: 5, label: '초과분', kind: 'store' },   // end > max — 잘리지 않고 경고
    { col: 0, w: 1, label: '잘못된 필드', kind: 'query' }   // linear 축인데 col — skip + 경고
  ] }]
};
const synthCategoryMismatch = {
  caption: '합성: category 불일치',
  axis: { kind: 'category', cols: ['A', 'B'] },
  lanes: [{ label: 'Y', segments: [
    { start: 0, end: 1, label: '잘못된 필드', kind: 'store' }   // category 축인데 start/end — skip + 경고
  ] }]
};

CONTAINERS = fileSpecs.map((fs_) => makeContainer(fs_.spec))
  .concat([makeContainer(synthLinearOverflow), makeContainer(synthCategoryMismatch)]);

const src = fs.readFileSync(require('path').join(__dirname, '..', 'static', 'flow', 'lane.js'), 'utf8');
eval(src);
// 엔진은 readyState complete 이므로 init() 즉시 실행 → 각 컨테이너에 svg 삽입 + rAF 큐잉

const problems = [];
const NUM_ATTRS = ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'rx'];

function checkOnce(tag) {
  for (const c of CONTAINERS) {
    const svg = c.children.find((e) => e.tag === 'svg');
    if (!svg) { problems.push(`${tag}: svg 없음`); continue; }
    const vb = (svg.attrs.viewBox || '').split(/\s+/).map(Number);
    if (vb.length !== 4 || vb.some((n) => !Number.isFinite(n))) { problems.push(`${tag}: viewBox 파싱 실패 "${svg.attrs.viewBox}"`); continue; }
    const [vx, vy, VW, VH] = vb;
    const flat = []; walk(svg, flat);
    for (const e of flat) {
      for (const k of NUM_ATTRS) {
        if (!(k in e.attrs)) continue;
        const v = Number(e.attrs[k]);
        if (!Number.isFinite(v)) { problems.push(`${tag}: ${e.tag}.${k} = ${e.attrs[k]} (NaN/undefined)`); continue; }
        if ((k === 'width' || k === 'height') && v < 0) problems.push(`${tag}: ${e.tag}.${k} = ${v} (음수 폭)`);
      }
      if (e.tag === 'rect') {
        const x = Number(e.attrs.x), y = Number(e.attrs.y), w = Number(e.attrs.width || 0), h = Number(e.attrs.height || 0);
        if (x < vx - 1 || y < vy - 1 || x + w > vx + VW + 1 || y + h > vy + VH + 1) problems.push(`${tag}: rect 이탈 x=${x} y=${y} w=${w} h=${h} / viewBox ${vb.join(' ')}`);
      }
      if (e.tag === 'line') {
        for (const [xk, yk] of [['x1', 'y1'], ['x2', 'y2']]) {
          const x = Number(e.attrs[xk]), y = Number(e.attrs[yk]);
          if (x < vx - 1 || y < vy - 1 || x > vx + VW + 1 || y > vy + VH + 1) problems.push(`${tag}: line 이탈 ${xk}=${x} ${yk}=${y} / viewBox ${vb.join(' ')}`);
        }
      }
      if (e.tag === 'text') {
        const x = Number(e.attrs.x), y = Number(e.attrs.y);
        if (x < vx - 1 || y < vy - 1 || x > vx + VW + 1 || y > vy + VH + 1) problems.push(`${tag}: text 이탈 x=${x} y=${y} "${e._text}" / viewBox ${vb.join(' ')}`);
      }
    }
  }
}

// ① ② 전 구간 훑기 — t=0(경계 함정) 포함해 애니메이션 완주까지 프레임을 계속 돌린다
checkOnce('mount');
{
  const pending0 = RAFS.splice(0, RAFS.length);
  for (const fn of pending0) fn(0);   // ts===0 함정 회귀
  checkOnce('ts=0');
}
let ts = 1;
for (let i = 0; i < 40 && RAFS.length; i++) {
  ts += 60;
  const pending = RAFS.splice(0, RAFS.length);
  for (const fn of pending) fn(ts);
  checkOnce(`ts=${ts}`);
}
if (RAFS.length) problems.push(`애니메이션이 40프레임 안에 끝나지 않음(rAF 잔여 ${RAFS.length}개)`);

// ③ pattern id 유일성 — 컨테이너 전체에서
const allPatternIds = [];
for (const c of CONTAINERS) {
  const svg = c.children.find((e) => e.tag === 'svg');
  if (!svg) continue;
  const flat = []; walk(svg, flat);
  flat.filter((e) => e.tag === 'pattern').forEach((p) => allPatternIds.push(p.attrs.id));
}
const dupPat = allPatternIds.filter((id, i) => allPatternIds.indexOf(id) !== i);
if (dupPat.length) problems.push(`pattern id 중복: ${[...new Set(dupPat)].join(', ')}`);
if (!allPatternIds.length) origWarn('참고: 이번 입력엔 hatch 세그먼트가 없어 pattern id 검사는 존재 확인만 함(0개)');

// ④ category 축 — cols.length 와 칸 구분선 수(cols.length+1, 양끝 포함)가 맞는지
for (const fs_ of fileSpecs) {
  const spec = fs_.spec;
  if (!spec.axis || spec.axis.kind !== 'linear') {
    const cols = (spec.axis && spec.axis.cols) || [];
    const c = CONTAINERS[fileSpecs.indexOf(fs_)];
    const svg = c.children.find((e) => e.tag === 'svg');
    const flat = []; walk(svg, flat);
    const seps = flat.filter((e) => e.tag === 'line' && (e.attrs.class || '').indexOf('lane-axis-sep') >= 0);
    const expect = cols.length + 1; // 칸 N개 → 경계선 N+1개(양끝 포함)
    if (seps.length !== expect) problems.push(`${fs_.file}: 칸 구분선 ${seps.length}개, 기대 ${expect}개(cols.length+1)`);
  }
}

// ⑤ linear 초과 세그먼트 경고 + 잘리지 않음(합성 케이스로 검증)
{
  const hasOverflowWarn = warnings.some((w) => w.indexOf('axis.max') >= 0 && w.indexOf('건너뜀') < 0);
  if (!hasOverflowWarn) problems.push('linear 초과 세그먼트에 대한 console.warn이 없음');
  const synthIdx = CONTAINERS.length - 2; // synthLinearOverflow
  const svg = CONTAINERS[synthIdx].children.find((e) => e.tag === 'svg');
  const flat = []; walk(svg, flat);
  const rects = flat.filter((e) => e.tag === 'rect' && (e.attrs.class || '').indexOf('lane-rect') >= 0);
  // end=5, max=4, TRACK_W=640 → 잘리지 않았다면 최종(애니메이션 완주 후) width ≈ (5/4)*640=800
  const finalW = rects.length ? Math.max(...rects.map((r) => Number(r.attrs.width))) : 0;
  if (!(finalW > 640)) problems.push(`linear 초과 세그먼트가 잘린 것으로 보임 — 최종 width=${finalW} (TRACK_W=640 넘어야 함)`);
}
// 축 불일치 skip 경고(참고 — 두 세트 모두 발생했는지)
{
  const hasSkipWarn = warnings.some((w) => w.indexOf('건너뜀') >= 0);
  if (!hasSkipWarn) problems.push('축 불일치 세그먼트에 대한 skip 경고(console.warn)가 없음');
}

// ⑥ 텍스트가 칸(category) / 다음 세그먼트 시작점(linear) 경계를 넘지 않는다
const overflowLabels = []; // 보고용 — 2줄로 접힌 라벨, console.warn 뜬 세그먼트 목록은 warnings 배열에서 이미 잡힌다
for (const item of fileSpecs.concat([{ file: '(합성: linear 초과)', spec: synthLinearOverflow }, { file: '(합성: category 불일치)', spec: synthCategoryMismatch }])) {
  const idx = CONTAINERS.indexOf(CONTAINERS.find((c) => c._spec === item.spec));
  const c = CONTAINERS[idx];
  const svg = c.children.find((e) => e.tag === 'svg');
  if (!svg) continue;
  const kind = (item.spec.axis && item.spec.axis.kind === 'linear') ? 'linear' : 'category';
  const flat = []; walk(svg, flat);
  const segGs = flat.filter((e) => e.tag === 'g' && cls(e).indexOf('lane-seg') >= 0);
  // 레인별로 묶는다 — 같은 레인의 세그먼트는 rect.y(barY)가 같다
  const byLaneY = {};
  segGs.forEach((g) => {
    const rect = g.children.find((e) => e.tag === 'rect');
    if (!rect) return;
    const y = rect.attrs.y;
    (byLaneY[y] = byLaneY[y] || []).push({ g, rect });
  });
  Object.keys(byLaneY).forEach((y) => {
    const segs = byLaneY[y].sort((a, b) => Number(a.rect.attrs.x) - Number(b.rect.attrs.x));
    segs.forEach((sgObj, i) => {
      const rectX = Number(sgObj.rect.attrs.x), rectW = Number(sgObj.rect.attrs.width);
      let rightBound;
      if (kind === 'category') {
        const colX = rectX - CONST.COL_PAD;
        rightBound = colX + CONST.COL_W - CONST.COL_PAD;
      } else {
        const trackRight = CONST.MARGIN + CONST.GUTTER_W + CONST.TRACK_W;
        rightBound = (i + 1 < segs.length) ? Number(segs[i + 1].rect.attrs.x) : Math.max(trackRight, rectX + Math.max(rectW, 120));
      }
      const texts = sgObj.g.children.filter((e) => e.tag === 'text');
      texts.forEach((t) => {
        const tx = Number(t.attrs.x);
        const tw = estw(t._text, fontPx(t));
        if (tx + tw > rightBound + 1) {
          problems.push(`${item.file}: 텍스트 "${t._text}" 가 경계를 넘음 — x=${tx.toFixed(1)}+w=${tw.toFixed(1)}=${(tx + tw).toFixed(1)} > ${rightBound.toFixed(1)}`);
        }
      });
      // 2줄로 접힌 라벨/서브 보고용 수집
      const labTexts = sgObj.g.children.filter((e) => e.tag === 'text' && cls(e).indexOf('lane-slabel') >= 0);
      const subTexts = sgObj.g.children.filter((e) => e.tag === 'text' && cls(e).indexOf('lane-ssub') >= 0);
      if (labTexts.length >= 2) overflowLabels.push(`${item.file}: "${labTexts.map((t) => t._text).join(' / ')}" (라벨 2줄)`);
      if (subTexts.length >= 2) overflowLabels.push(`${item.file}: "${subTexts.map((t) => t._text).join(' / ')}" (서브 2줄)`);
    });
  });
}

console.warn = origWarn;

const uniq = [...new Set(problems)];
console.log(`검사한 컨테이너: 입력 ${fileSpecs.length}개 + 합성 2개, 총 요소 ${ALL.length}개`);
console.log(`캡처된 console.warn: ${warnings.length}건`);
warnings.forEach((w) => console.log('  warn: ' + w));
console.log(`2줄로 접힌 세그먼트 텍스트: ${overflowLabels.length}건`);
overflowLabels.forEach((o) => console.log('  ' + o));
for (const fs_ of fileSpecs) {
  const c = CONTAINERS[fileSpecs.indexOf(fs_)];
  const svg = c.children.find((e) => e.tag === 'svg');
  console.log(`  ${fs_.file}: viewBox="${svg.attrs.viewBox}"`);
}
if (uniq.length) {
  console.log(`FAIL — ${uniq.length}건`);
  uniq.forEach((p) => console.log('  ' + p));
  process.exit(1);
}
console.log('OK — NaN·이탈·음수 없음, pattern id 유일, 칸 구분선 수 일치, 초과 세그먼트 비클리핑+경고, 텍스트 경계 침범 없음 확인');
