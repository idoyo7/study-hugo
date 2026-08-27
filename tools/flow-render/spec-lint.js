/* flow·seq 스펙 린트 + 렌더 검사.
   사용: node tools/flow-render/spec-lint.js 'content/<섹션>/<문서>/_flow/이름.json' ... (셸 글롭으로 여러 개 넘겨도 된다)

   두 층을 본다.
   1) 정적 린트 — 엔진을 안 돌려도 알 수 있는 것. DIAGRAMS.md 가 경고하는 조용한 실패들:
      group.id 누락(둘 이상이면 마지막 박스만 남고 라벨이 겹쳐 찍힌다), 미지의 kind,
      엣지 끝점 오타, 가로 엣지 라벨이 열 사이 72px 를 넘김, token 모드인데 경로가 안 잡힘.
   2) 렌더 검사 — 실제 flow.js/seq.js 를 최소 DOM 스텁 위에서 돌려 좌표가 viewBox 안에 있는지,
      NaN 이 없는지, 노드가 예상 밖으로 높아지지 않았는지 본다.

   에러는 exit 1, 경고는 출력만 하고 통과시킨다. */
'use strict';
const fs = require('fs');
const path = require('path');

const NUM_ATTRS = ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'width', 'height', 'opacity', 'rx'];
const KINDS = new Set(['src', 'proc', 'store', 'query', 'sink']);
const LAYERS = new Set(['deploy', 'observe', 'state', 'access']);
const COL_GAP = 218, NODE_W = 146;
const H_LABEL_BUDGET = COL_GAP - NODE_W;      /* 인접 열 사이 빈 폭 = 72px */

/* flow.js·seq.js 와 같은 글자폭 추정식 */
function chw(ch, f) { return (ch.charCodeAt(0) > 0x2E80 ? 0.98 : 0.56) * f; }
function estw(s, f) { let w = 0; for (let i = 0; i < s.length; i++) w += chw(s[i], f); return w; }

/* ── 최소 DOM 스텁 ── */
function makeDom() {
  const all = [];
  function mkEl(ns, tag) {
    const e = {
      ns, tag, attrs: {}, children: [], _text: '', style: {}, dataset: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      appendChild(c) { this.children.push(c); return c; },
      insertBefore(c) { this.children.unshift(c); return c; },
      querySelector(sel) { return findAll(this, sel)[0] || null; },
      querySelectorAll(sel) { return findAll(this, sel); },
      get textContent() { return this._text; },
      set textContent(v) { this._text = v; },
      get innerHTML() { return this._html || ''; },
      set innerHTML(v) { this._html = v; },
      get firstChild() { return this.children[0] || null; },
      classList: { add() {}, remove() {}, contains() { return false; } },
      addEventListener() {},
    };
    all.push(e);
    return e;
  }
  function matches(e, sel) {
    sel = sel.trim();
    if (sel.includes('.') && !sel.startsWith('.')) {
      const [tag, cls] = sel.split('.');
      return e.tag === tag && (e.attrs.class || '').split(/\s+/).includes(cls);
    }
    if (sel.startsWith('.')) return (e.attrs.class || '').split(/\s+/).includes(sel.slice(1));
    return e.tag === sel;
  }
  function walk(e, out) { for (const c of e.children) { out.push(c); walk(c, out); } }
  function findAll(root, sel) {
    const flat = []; walk(root, flat);
    return flat.filter((e) => sel.split(',').some((s) => matches(e, s)));
  }
  return { mkEl, walk, findAll, all };
}

function runEngine(enginePath, containerClass, specClass, spec) {
  const dom = makeDom();
  const container = dom.mkEl('html', 'figure');
  container.attrs.class = containerClass;
  const scriptEl = dom.mkEl('html', 'script');
  scriptEl.attrs.class = specClass;
  scriptEl._text = JSON.stringify(spec);
  container.appendChild(scriptEl);

  const rafs = [];
  const sandbox = {
    document: {
      readyState: 'complete',
      createElementNS: (ns, tag) => dom.mkEl(ns, tag),
      createElement: (tag) => dom.mkEl('html', tag),
      addEventListener() {},
      querySelectorAll: (sel) => (sel.includes(containerClass.replace('vm-', 'vm-')) ? [container] : []),
    },
    window: { matchMedia: () => ({ matches: false }) },
    requestAnimationFrame: (fn) => { rafs.push(fn); return rafs.length; },
    cancelAnimationFrame: () => {},
  };
  sandbox.document.querySelectorAll = () => [container];
  const src = fs.readFileSync(enginePath, 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame', src)(
    sandbox.document, sandbox.window, sandbox.requestAnimationFrame, sandbox.cancelAnimationFrame,
  );
  // 애니메이션 프레임 몇 개 돌려 파티클/토큰 경로도 태운다
  for (let i = 0; i < 6; i++) {
    const pending = rafs.splice(0, rafs.length);
    for (const fn of pending) { try { fn(i * 240); } catch (e) { /* 프레임 오류는 아래 bounds 검사로 드러난다 */ } }
  }
  const svg = container.children.find((e) => e.tag === 'svg');
  return { svg, dom, container };
}

function checkBounds(svg, dom, errs, file) {
  if (!svg) { errs.push(`${file}: svg 가 생성되지 않았다 (스펙 파싱 실패 가능)`); return; }
  const vb = String(svg.attrs.viewBox || '').trim().split(/\s+/).map(Number);
  if (vb.length !== 4 || vb.some((v) => !Number.isFinite(v))) {
    errs.push(`${file}: viewBox 가 잘못됐다 — "${svg.attrs.viewBox}"`);
    return;
  }
  const [vx, vy, vw, vh] = vb;
  const flat = []; dom.walk(svg, flat);
  for (const e of flat) {
    for (const k of NUM_ATTRS) {
      if (!(k in e.attrs)) continue;
      const v = Number(e.attrs[k]);
      if (!Number.isFinite(v)) { errs.push(`${file}: ${e.tag}.${k} = ${e.attrs[k]}`); continue; }
      if ((k === 'width' || k === 'height' || k === 'r') && v < 0) errs.push(`${file}: ${e.tag}.${k} = ${v} (음수)`);
    }
    if (/NaN|undefined/.test(String(e.attrs.d || e.attrs.points || ''))) errs.push(`${file}: ${e.tag} 경로에 NaN — ${e.attrs.d || e.attrs.points}`);
    const op = 'opacity' in e.attrs ? Number(e.attrs.opacity) : 1;
    if (!(op > 0.01)) continue;
    const nums = (k) => Number(e.attrs[k]);
    if (e.tag === 'rect') {
      const x = nums('x'), y = nums('y'), w = Number(e.attrs.width || 0), h = Number(e.attrs.height || 0);
      if (x < vx - 1 || y < vy - 1 || x + w > vx + vw + 1 || y + h > vy + vh + 1) errs.push(`${file}: rect 이탈 (${x},${y},${w}x${h}) / viewBox ${vx} ${vy} ${vw} ${vh}`);
    } else if (e.tag === 'circle') {
      const cx = nums('cx'), cy = nums('cy'), r = Number(e.attrs.r || 0);
      if (cx - r < vx - 1 || cy - r < vy - 1 || cx + r > vx + vw + 1 || cy + r > vy + vh + 1) errs.push(`${file}: circle 이탈 (${cx},${cy},r${r})`);
    } else if (e.tag === 'text') {
      const x = nums('x'), y = nums('y');
      if (x < vx - 2 || y < vy - 2 || x > vx + vw + 2 || y > vy + vh + 2) errs.push(`${file}: text 이탈 (${x},${y}) "${e._text}"`);
    }
  }
}

function lintFlow(spec, file, errs, warns) {
  const nodes = spec.nodes || [], edges = spec.edges || [], groups = spec.groups || [];
  if (!nodes.length) errs.push(`${file}: nodes 가 비어 있다`);
  const byId = {};
  for (const n of nodes) {
    if (!n.id) { errs.push(`${file}: id 없는 node — ${JSON.stringify(n).slice(0, 80)}`); continue; }
    if (byId[n.id]) errs.push(`${file}: node id 중복 "${n.id}"`);
    byId[n.id] = n;
    if (n.kind && !KINDS.has(n.kind)) errs.push(`${file}: node "${n.id}" 의 kind "${n.kind}" 는 없는 값 — CSS 가 없어 무색으로 나온다`);
    if (n.layer && !LAYERS.has(n.layer)) errs.push(`${file}: node "${n.id}" 의 layer "${n.layer}" 는 없는 값`);
  }
  const F = +spec.font > 0 ? +spec.font : 1;
  /* group.id 누락 — 둘 이상이면 조용히 깨진다 */
  const gids = {};
  for (const g of groups) {
    if (!g.id) errs.push(`${file}: group 에 id 가 없다 (label "${g.label || ''}") — 그룹이 둘 이상이면 마지막 박스만 남고 라벨이 겹친다`);
    else if (gids[g.id]) errs.push(`${file}: group id 중복 "${g.id}"`);
    else gids[g.id] = 1;
    for (const m of g.members || []) if (!byId[m]) errs.push(`${file}: group "${g.id}" 의 member "${m}" 가 node 에 없다`);
    if (!(g.members || []).length) errs.push(`${file}: group "${g.id}" 에 members 가 없다`);
  }
  let usesGroupEndpoint = false;
  for (const e of edges) {
    for (const side of ['from', 'to']) {
      const v = e[side];
      if (!byId[v]) {
        if (gids[v]) usesGroupEndpoint = true;
        else errs.push(`${file}: edge ${e.from}→${e.to} 의 ${side} "${v}" 가 node·group 어디에도 없다`);
      }
    }
    if (!e.label) continue;
    const a = byId[e.from], b = byId[e.to];
    if (!a || !b) continue;
    const horizontal = (a.col || 0) !== (b.col || 0);
    if (!horizontal) continue;
    const w = estw(e.label, 11 * F);
    if (w > H_LABEL_BUDGET) {
      warns.push(`${file}: 가로 엣지 라벨 "${e.label}" 이 ${Math.round(w)}px — 열 사이 여백 ${H_LABEL_BUDGET}px 를 넘어 노드 테두리를 덮는다`);
    }
  }
  if (spec.token && usesGroupEndpoint) warns.push(`${file}: token:true 인데 엣지 끝점에 그룹이 있어 토큰 모드가 파티클 모드로 되돌아간다`);
  if (spec.token && !usesGroupEndpoint) {
    /* 경로가 하나라도 잡히나 — 시작(indeg 0) 노드가 있어야 한다 */
    const indeg = {};
    nodes.forEach((n) => { indeg[n.id] = 0; });
    edges.forEach((e) => { if (!e.dashed && byId[e.to]) indeg[e.to]++; });
    const starts = nodes.filter((n) => !indeg[n.id]);
    if (!starts.length) errs.push(`${file}: token:true 인데 시작 노드(들어오는 엣지 없음)가 없다 — 사이클이면 경로가 안 잡힌다`);
  }
  /* 노드 라벨 줄 수 — 3줄이 넘으면 카드가 과하게 높아진다 */
  for (const n of nodes) {
    const lab = String(n.label || n.id);
    const lines = Math.ceil(estw(lab, 12.5 * F) / 128);
    if (lines > 2) warns.push(`${file}: node "${n.id}" label "${lab}" 이 ${lines}줄로 감긴다 — sub 나 caption 으로 내리는 게 낫다`);
  }
  const cols = new Set(nodes.map((n) => n.col || 0));
  if (cols.size > 5) warns.push(`${file}: 열이 ${cols.size}개 — 5열을 넘기면 본문 폭에서 심하게 축소된다`);
}

function lintSeq(spec, file, errs, warns) {
  const parts = spec.participants || [];
  if (!parts.length) errs.push(`${file}: participants 가 비어 있다`);
  const ids = {};
  for (const p of parts) {
    if (!p.id) errs.push(`${file}: id 없는 participant`);
    else if (ids[p.id]) errs.push(`${file}: participant id 중복 "${p.id}"`);
    else ids[p.id] = 1;
  }
  if (parts.length > 4) warns.push(`${file}: participant ${parts.length}명 — 3~4명이 최적, 넘으면 인라인에서 심하게 축소된다`);
  const KNOWN = new Set(['msg', 'note', 'alt', 'label', 'lines', 'dashed', 'steps', 'elseLabel', 'elseSteps']);
  (function walkSteps(list, depth) {
    for (const st of list || []) {
      for (const k of Object.keys(st)) if (!KNOWN.has(k)) warns.push(`${file}: step 에 엔진이 안 읽는 키 "${k}" — loop·par·opt 프레임은 없고 alt 하나뿐이다`);
      if (st.alt !== undefined) { walkSteps(st.steps, depth + 1); walkSteps(st.elseSteps, depth + 1); continue; }
      if (st.note) {
        for (const id of st.note) if (!ids[id]) errs.push(`${file}: note 의 participant "${id}" 가 없다`);
        if (!(st.lines || st.label)) errs.push(`${file}: note 에 lines 도 label 도 없다`);
        continue;
      }
      if (st.msg) {
        for (const id of st.msg) if (!ids[id]) errs.push(`${file}: msg 의 participant "${id}" 가 없다`);
        if (st.msg[0] === st.msg[1]) warns.push(`${file}: 자기 자신에게 보내는 msg (${st.msg[0]}) — 엔진에 self-message 가 없어 길이 0 화살표가 된다. note 로 쓸 것`);
        continue;
      }
      errs.push(`${file}: msg·note·alt 어느 것도 아닌 step — ${JSON.stringify(st).slice(0, 80)}`);
    }
  })(spec.steps, 0);
}

const files = process.argv.slice(2);
if (!files.length) { console.error('사용: node tools/flow-render/spec-lint.js <spec.json ...>'); process.exit(2); }

const errs = [], warns = [];
let flowN = 0, seqN = 0;
for (const f of files) {
  let spec;
  try { spec = JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { errs.push(`${f}: JSON 파싱 실패 — ${e.message}`); continue; }
  const isSeq = /_seq[\\/]/.test(f) || !!spec.participants;
  if (!spec.caption) warns.push(`${f}: caption 이 없다 — 도식이 무엇을 말하는지 한 문장이 필요하다`);
  if (isSeq) {
    seqN++;
    lintSeq(spec, f, errs, warns);
    const { svg, dom } = runEngine(path.join('static/flow/seq.js'), 'vm-seq', 'seq-spec', spec);
    checkBounds(svg, dom, errs, f);
  } else {
    flowN++;
    lintFlow(spec, f, errs, warns);
    const { svg, dom } = runEngine(path.join('static/flow/flow.js'), 'vm-flow', 'flow-spec', spec);
    checkBounds(svg, dom, errs, f);
  }
}

for (const w of [...new Set(warns)]) console.log('경고  ' + w);
if (errs.length) {
  console.log('');
  for (const e of [...new Set(errs)]) console.log('오류  ' + e);
  console.log(`\nFAIL — flow ${flowN} · seq ${seqN} 검사, 오류 ${new Set(errs).size}건`);
  process.exit(1);
}
console.log(`\nOK — flow ${flowN} · seq ${seqN} 검사, 오류 0${warns.length ? ` (경고 ${new Set(warns).size}건)` : ''}`);
