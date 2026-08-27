/* eslint-disable */
// @ts-nocheck
//
// ↑ 이 두 줄은 의도적이다. 이 파일은 study-hugo 레포에 있지만 study-hugo 는 React·nextra 를
//   의존성으로 갖지 않는다 — 그래서 여기서는 `react` 와 `DiagramFigure` 가 영영 안 풀린다.
//   타입 검사를 끄지 않으면 편집기가 이 레포 전체에서 해결 불가능한 오류 3건을 계속 띄운다.
//   **이식 후에는 이 두 줄을 지우고 그쪽 tsconfig 로 실제 타입 검사를 받아야 한다.**
//   그게 이 파일이 처음으로 진짜 검증되는 시점이다.
//
/*
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  이 디렉토리는 Hugo 빌드에 참여하지 않는다.                                │
 * │  content/ 밖이고 어떤 shortcode 도 이 파일을 참조하지 않는다.              │
 * │  이 컴포넌트는 nextra 빌드에서 아직 한 번도 컴파일·렌더된 적이 없다 —      │
 * │  타입체크도, 브라우저에서 띄워본 적도 없다. 동작을 단정하지 마라.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * rstep 도식(canary 스텝 진행·스킵·가중치·가용량·AnalysisRun 을 한 판에 겹쳐 보는 그림)의
 * React 이식. 의미(로직)는 이 파일이 새로 계산하지 않는다 — 전부 ./rstep-frames.mjs 에서
 * import 한다. 이 파일이 하는 일은 그 계산 결과를 SVG 속성으로 칠하는 것뿐이다.
 *
 * SSOT 는 rstep-frames.mjs 다. static/flow/rstep.js(정적 호스팅용 IIFE, 번들러 없이 도는
 * Hugo 엔진)는 같은 계산을 자기 안에 중복으로 들고 있고, tools/flow-render/port-parity.js 가
 * 그 둘을 프레임 단위로 대조해 드리프트를 잡는다. 이 컴포넌트의 SVG 생성부·paint 매핑은
 * static/flow/rstep.js 의 build()/paint() 를 그대로 옮긴 것이다 — 로직이 아니라 "어느 요소의
 * 어느 속성을 어떻게 바꾸는가"만 베꼈다.
 *
 * 이식(포팅) 시 사람이 할 일:
 *   1. import 경로 조정 — 지금 './rstep-frames.mjs' 는 같은 디렉토리 상대경로다. 실제 위치로
 *      옮기면 이 경로와, 아래 DiagramFigure import 경로('../../../_components/diagram/DiagramFigure')
 *      둘 다 다시 잡아야 한다.
 *   2. rstep-frames.mjs 를 .ts 로 옮길지 결정 — 지금은 .mjs 를 .tsx 에서 그대로 import 한다.
 *      대부분의 번들러는 확장자 없는 JS 모듈 import 에 타입을 못 주므로(.d.ts 없음), 이 파일의
 *      Frame/Cfg 타입은 실제 export 형태를 손으로 옮겨 적은 것이고 import 쪽은 강제되지 않는다.
 *      .ts 로 옮기거나 .d.ts 를 붙이거나, 최소한 tsconfig 에 allowJs 를 켜야 타입이 맞는지
 *      실제로 검증된다 — 지금은 아무것도 검증되지 않은 상태다.
 *   3. tools/flow-render/port-parity.js 를 nextra 쪽 테스트로 옮긴다. 옮긴 뒤에는 Hugo 엔진이
 *      아니라 rstep-frames.mjs 가 SSOT 이므로, 비교 방향(엔진이 칠한 값을 되읽어 모듈과 대조)도
 *      뒤집어야 한다.
 *   4. 이 파일 자체를 한 번도 렌더해본 적이 없다 — 최소한 4개 variant 를 브라우저에 띄워서
 *      static/flow/rstep.js 버전과 나란히 놓고 눈으로 대조하는 과정이 필요하다.
 *
 * 근거: argo-rollouts v1.8.2. 단계 서술의 코드 인용은
 * content/rollouts/02-rollback-window-weight/index.md 가 정본이다.
 */
'use client'

import { useEffect, useRef, type JSX } from 'react'

// 이식 시 실제 위치에 맞춰 조정
import { DiagramFigure } from '../../../_components/diagram/DiagramFigure'

import { C, makeConfig, computeFrame, frameAt, requiredPods } from './rstep-frames.mjs'

/* ── variant ── rstep-frames.mjs 의 VARIANT_KEYS 와 같은 네 값. 그 모듈이 없는 값은
   VARIANTS[variant] || VARIANTS.deploy 로 스스로 deploy 에 떨어지므로 여기서 다시 검증하지 않는다. */
type Variant = 'deploy' | 'promote' | 'rollback' | 'fixed'

/* ── rstep-frames.mjs 가 실제로 내는 값의 형태를 손으로 옮겨 적은 타입.
   .mjs 에는 .d.ts 가 없으므로 import 쪽에서 강제되지 않는다 — 배너 2번 참고. */
type SrcTone = 'neutral' | 'ok' | 'warn' | 'bad'
type Tone = 'neutral' | 'ok' | 'warn' | 'bad'
type Analysis = 'none' | 'running' | 'cancelled' | 'ok'

type Frame = {
  idx: number
  atEnd: boolean
  skipFrom: number
  revHit: number
  weight: number
  src: string
  srcTone: SrcTone
  cDesired: number
  cAvail: number
  sDesired: number
  sAvail: number
  analysis: Analysis
  gate: string
  verdict: string
  tone: Tone
  promoted: boolean
}

type Cfg = {
  variant: Variant
  steps: string[]
  stepCount: number
  badge: string
  still: string
  captions: string[]
}

/* ── SVG 캔버스 · 레이아웃 상수 — static/flow/rstep.js 의 값을 그대로 옮겼다 ── */
const W = 940
const H = 424
const GLYPHS = ['①', '②', '③', '④', '⑤', '⑥'] // C.PHASE_COUNT(6) 와 같은 수여야 한다

const RAIL_X = 28
const RAIL_Y = 76
const RAIL_H = 36
const STEP_W = 168
const STEP_GAP = 12
const ARC_APEX = 46 // 스킵 호의 꼭대기
const BAR = { x: 28, y: 152, w: 650, h: 28 }
const CARD_Y = 216
const CARD_H = 118
const CARD_W = 438
const CARD_GAP = 36
const POD_R = 6
const POD_COLS = 10
const POD_DX = 25
const POD_X0 = 20
const POD_Y0 = 60
const POD_DY = 24
const PILL_Y = 358

function slotX(i: number) {
  return RAIL_X + i * (STEP_W + STEP_GAP)
}
function slotMid(i: number) {
  return slotX(i) + STEP_W / 2
}
function cardX(wi: number) {
  return wi === 0 ? 28 : 28 + CARD_W + CARD_GAP
}
function podX(cx: number, i: number) {
  return cx + POD_X0 + (i % POD_COLS) * POD_DX
}
function podY(i: number) {
  return CARD_Y + POD_Y0 + Math.floor(i / POD_COLS) * POD_DY
}
/* barX 만을 위한 클램프 — rstep-frames.mjs 는 이 헬퍼를 export 하지 않는다(내부 전용이라
   computeFrame 안에서만 쓰인다). 여기서는 지오메트리 쪽 용도로 같은 한 줄을 다시 둔다. */
function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
function barX(pct: number) {
  return BAR.x + BAR.w * clamp01(pct / 100)
}

/* AnalysisRun pill 라벨/클래스 — static/flow/rstep.js 의 paint() 안에 있던 뷰 전용 매핑.
   로직이 아니라 표시 문구이므로 여기 둔다(computeFrame 은 analysis 상태 이름만 낸다). */
const AR_LABEL: Record<Analysis, string> = {
  none: 'AnalysisRun  —  아직 없음',
  running: 'AnalysisRun  —  Running · 20s 간격 측정',
  cancelled: 'AnalysisRun  —  스킵 + 실행분 취소',
  ok: 'AnalysisRun  —  Successful',
}
const AR_CLASS: Record<Analysis, string> = {
  none: 'rs-pill',
  running: 'rs-pill rs-pill-run',
  cancelled: 'rs-pill rs-pill-off',
  ok: 'rs-pill rs-pill-ok',
}

const CARD_TITLES = ['canary ReplicaSet — 새로 올리는 리비전', 'stable ReplicaSet — 지금 트래픽을 받는 리비전']

export function RolloutStep({
  variant = 'deploy',
  caption,
}: {
  variant?: Variant
  caption?: string
}): JSX.Element {
  const cfg = makeConfig(variant) as Cfg
  const N = cfg.stepCount
  /* 캡션을 밖에서 주면 그 문장이 고정된다 — 단계별 교체를 하지 않는다 */
  const fixedCaption = typeof caption === 'string' && caption.trim() !== ''

  const svgRef = useRef<SVGSVGElement>(null)
  const capRef = useRef<HTMLParagraphElement>(null)
  const stepGroup = useRef<SVGGElement>(null)

  const skipArc = useRef<SVGPathElement>(null)
  const skipTx = useRef<SVGTextElement>(null)
  const revArrow = useRef<SVGPathElement>(null)
  const revTx = useRef<SVGTextElement>(null)

  const slots = useRef<(SVGRectElement | null)[]>([])
  const slotTx = useRef<(SVGTextElement | null)[]>([])
  const slotStrike = useRef<(SVGLineElement | null)[]>([])
  const slotMark = useRef<(SVGTextElement | null)[]>([])
  const endBox = useRef<SVGRectElement>(null)
  const endMark = useRef<SVGTextElement>(null)

  const srcTx = useRef<SVGTextElement>(null)
  const barHave = useRef<SVGRectElement>(null)
  const barShort = useRef<SVGRectElement>(null)
  const wMark = useRef<SVGLineElement>(null)
  const wTx = useRef<SVGTextElement>(null)
  const hTx = useRef<SVGTextElement>(null)
  const barVal = useRef<SVGTextElement>(null)

  const cardRect = useRef<(SVGRectElement | null)[]>([])
  const cardAv = useRef<(SVGTextElement | null)[]>([])
  const cardSub = useRef<(SVGTextElement | null)[]>([])
  /* 카드 둘 × REPLICAS 파드 — 평평한 배열, index = side * C.REPLICAS + k */
  const cardPods = useRef<(SVGCircleElement | null)[]>([])

  const arPill = useRef<SVGRectElement>(null)
  const arTx = useRef<SVGTextElement>(null)
  const gateTx = useRef<SVGTextElement>(null)
  const verTx = useRef<SVGTextElement>(null)

  const raf = useRef(0)
  const running = useRef(false)
  /* 0 은 유효한 타임스탬프다 — falsy 검사로는 첫 프레임이 0 일 때 영영 안 걸린다 */
  const t0 = useRef(-1)
  const lastPhase = useRef(-1)

  /* 단계가 바뀔 때만 DOM 을 건드린다 */
  function paintSteps(p: number) {
    const g = stepGroup.current
    if (!g || lastPhase.current === p) return
    lastPhase.current = p
    const ns = g.querySelectorAll('text')
    for (let j = 0; j < ns.length; j++) {
      ns[j]!.setAttribute('class', j === p ? 'rs-step rs-step-on' : 'rs-step')
    }
    if (!fixedCaption && capRef.current) capRef.current.textContent = cfg.captions[p] ?? cfg.still
  }

  function paint(f: Frame) {
    let j: number

    /* ── 스텝 슬롯 · 스킵 표시 ── */
    for (j = 0; j < N; j++) {
      const cur = !f.atEnd && j === f.idx
      const hit = f.revHit === j
      const skipped = f.skipFrom >= 0 && j >= f.skipFrom
      const done = !skipped && j < f.idx
      slots.current[j]?.setAttribute(
        'class',
        'rs-slot' +
          (cur ? ' rs-slot-on' : '') +
          (hit ? ' rs-slot-hit' : '') +
          (skipped && !hit ? ' rs-slot-skipped' : '') +
          (done ? ' rs-slot-done' : '')
      )
      slotTx.current[j]?.setAttribute(
        'class',
        'rs-slottext' + (cur || hit ? ' rs-slottext-on' : '') + (skipped && !hit ? ' rs-slottext-skipped' : '')
      )
      slotStrike.current[j]?.setAttribute('opacity', skipped && !hit ? '1' : '0')
      if (slotMark.current[j]) {
        slotMark.current[j]!.textContent = cur ? '▲ 여기' : hit ? '▲ 역탐색이 집은 값' : ''
        slotMark.current[j]!.setAttribute('class', 'rs-mark' + (hit ? ' rs-mark-hit' : ''))
      }
    }
    endBox.current?.setAttribute('class', 'rs-slot rs-slot-end' + (f.atEnd ? ' rs-slot-on' : ''))
    if (endMark.current) endMark.current.textContent = f.atEnd ? '▲ 여기 — 스텝이 아니다' : ''

    /* ── 스킵 호 — 건너뛴 구간 위로 ── */
    if (f.skipFrom >= 0) {
      const a0 = slotMid(f.skipFrom)
      const a1 = slotMid(N)
      const amid = (a0 + a1) / 2
      skipArc.current?.setAttribute(
        'd',
        `M${a0} ${RAIL_Y - 4} C${a0} ${ARC_APEX} ${a1} ${ARC_APEX} ${a1} ${RAIL_Y - 4}` +
          ` M${a1 - 6} ${RAIL_Y - 13} L${a1} ${RAIL_Y - 4} L${a1 + 6} ${RAIL_Y - 13}`
      )
      skipArc.current?.setAttribute('opacity', '1')
      if (skipTx.current) {
        skipTx.current.setAttribute('x', `${amid}`)
        skipTx.current.setAttribute('y', `${ARC_APEX + 4}`)
        skipTx.current.textContent = `스텝 ${N - f.skipFrom}개를 건너뛴다  ·  canary.go:390`
        skipTx.current.setAttribute('opacity', '1')
      }
    } else {
      skipArc.current?.setAttribute('d', `M${slotMid(0)} ${RAIL_Y - 4} L${slotMid(0)} ${RAIL_Y - 4}`)
      skipArc.current?.setAttribute('opacity', '0')
      if (skipTx.current) {
        skipTx.current.setAttribute('x', `${slotMid(0)}`)
        skipTx.current.setAttribute('y', `${ARC_APEX + 4}`)
        skipTx.current.setAttribute('opacity', '0')
      }
    }

    /* ── 역탐색 화살표 — 아래쪽, 반대 방향 ── */
    const ry = RAIL_Y + RAIL_H + 30
    if (f.revHit >= 0) {
      const r0 = slotMid(N)
      const r1 = slotMid(f.revHit)
      revArrow.current?.setAttribute(
        'd',
        `M${r0} ${ry} L${r1} ${ry} M${r1 + 9} ${ry - 5} L${r1} ${ry} L${r1 + 9} ${ry + 5}`
      )
      revArrow.current?.setAttribute('opacity', '1')
      if (revTx.current) {
        revTx.current.setAttribute('x', `${(r0 + r1) / 2}`)
        revTx.current.setAttribute('y', `${ry - 8}`)
        revTx.current.textContent =
          'for i := *index − 1; i >= 0; i−−   처음 만나는 setWeight 를 쓴다  ·  trafficrouting.go:245'
        revTx.current.setAttribute('opacity', '1')
      }
    } else {
      revArrow.current?.setAttribute('d', `M${slotMid(N)} ${ry} L${slotMid(N)} ${ry}`)
      revArrow.current?.setAttribute('opacity', '0')
      if (revTx.current) {
        revTx.current.setAttribute('x', `${slotMid(N)}`)
        revTx.current.setAttribute('y', `${ry - 8}`)
        revTx.current.setAttribute('opacity', '0')
      }
    }

    /* ── 가중치 바 — 확보된 몫과 확보되지 않은 몫을 겹쳐 그린다 ── */
    const havePct = (f.cAvail / C.REPLICAS) * 100
    const shownHave = Math.min(f.weight, havePct)
    barHave.current?.setAttribute('width', `${Math.max(0, barX(shownHave) - BAR.x)}`)
    const shortStart = barX(shownHave)
    const shortEnd = barX(f.weight)
    const shortW = Math.max(0, shortEnd - shortStart)
    barShort.current?.setAttribute('x', `${shortStart}`)
    barShort.current?.setAttribute('width', `${shortW}`)
    barShort.current?.setAttribute('opacity', shortW > 1 ? '1' : '0')
    wMark.current?.setAttribute('x1', `${barX(f.weight)}`)
    wMark.current?.setAttribute('x2', `${barX(f.weight)}`)
    const need = requiredPods(f.weight)
    if (wTx.current) {
      wTx.current.setAttribute('x', `${Math.min(Math.max(barX(f.weight), BAR.x + 46), BAR.x + BAR.w - 46)}`)
      wTx.current.textContent = f.weight > 0 ? `canary ${f.weight}%  ·  요구 ${need}대` : 'canary 0%'
      wTx.current.setAttribute('class', 'rs-wtext' + (f.tone === 'bad' ? ' rs-wtext-bad' : ''))
    }
    if (hTx.current) {
      hTx.current.setAttribute('x', `${Math.min(Math.max(barX(shownHave), BAR.x + 40), BAR.x + BAR.w - 40)}`)
      hTx.current.textContent = `Ready ${f.cAvail}대`
    }
    if (barVal.current) {
      barVal.current.textContent = shortW > 1 ? `${need - f.cAvail}대 부족` : '충족'
      barVal.current.setAttribute('class', 'rs-barval' + (shortW > 1 ? ' rs-barval-bad' : ' rs-barval-ok'))
    }

    /* ── 결정 출처 ── */
    if (srcTx.current) {
      srcTx.current.textContent = f.src
      srcTx.current.setAttribute('class', `rs-src rs-src-${f.srcTone}`)
    }

    /* ── ReplicaSet 카드 둘 ── */
    for (let side = 0; side < 2; side++) {
      const desired = side === 0 ? f.cDesired : f.sDesired
      const avail = side === 0 ? f.cAvail : f.sAvail
      const needHere = side === 0 ? requiredPods(f.weight) : requiredPods(100 - f.weight)
      const short = side === 0 && f.weight > 0 && avail < needHere
      cardRect.current[side]?.setAttribute(
        'class',
        'rs-card ' +
          (side === 0 ? 'rs-card-canary' : 'rs-card-stable') +
          (short ? ' rs-card-short' : '') +
          (desired === 0 ? ' rs-card-gone' : '')
      )
      if (cardAv.current[side]) {
        cardAv.current[side]!.textContent = `Available ${avail}  /  desired ${desired}`
        cardAv.current[side]!.setAttribute('class', 'rs-avail' + (short ? ' rs-avail-bad' : ''))
      }
      if (cardSub.current[side]) {
        cardSub.current[side]!.textContent =
          side === 0
            ? f.weight > 0
              ? `이 가중치가 요구하는 파드 ${needHere}대` + (short ? ` — ${needHere - avail}대 부족` : ' — 충족')
              : '가중치가 없어 요구 파드 0대'
            : f.promoted
              ? '승격 후 축소 — scaleDownDelay 30s'
              : '전량 유지 · dynamicStableScale false'
      }
      for (let k = 0; k < C.REPLICAS; k++) {
        const live = k < avail
        const planned = k < desired
        const pod = cardPods.current[side * C.REPLICAS + k]
        pod?.setAttribute('opacity', live ? '1' : planned ? '0.3' : '0')
        pod?.setAttribute(
          'class',
          'rs-pod' + (side === 0 ? ' rs-pod-canary' : ' rs-pod-stable') + (!live && planned ? ' rs-pod-pending' : '')
        )
      }
    }

    arPill.current?.setAttribute('class', AR_CLASS[f.analysis] ?? 'rs-pill')
    if (arTx.current) {
      arTx.current.textContent = AR_LABEL[f.analysis] ?? ''
      arTx.current.setAttribute('class', 'rs-pilltext' + (f.analysis === 'cancelled' ? ' rs-pilltext-off' : ''))
    }
    if (gateTx.current) gateTx.current.textContent = f.gate
    if (verTx.current) {
      verTx.current.textContent = f.verdict
      verTx.current.setAttribute('class', `rs-verdict rs-verdict-${f.tone}`)
    }
  }

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    /* variant 가 바뀌면 캡션·글리프를 무조건 한 번 다시 칠해야 한다 */
    lastPhase.current = -1

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      /* 마지막 단계 t=1 정지 화면. paintSteps 가 넣은 단계 캡션을 still 로 되돌리는
         순서가 중요하다 — 뒤집으면 최종 문구가 마지막 단계 캡션으로 남는다 */
      paintSteps(C.PHASE_COUNT - 1)
      paint(computeFrame(variant, C.PHASE_COUNT - 1, 1) as Frame)
      if (!fixedCaption && capRef.current) capRef.current.textContent = cfg.still
      return
    }

    /* IntersectionObserver 가 걸리기 전에도 첫 화면은 깔아둔다 */
    paintSteps(0)
    paint(computeFrame(variant, 0, 0) as Frame)

    const frame = (ts: number) => {
      if (t0.current < 0) t0.current = ts
      const { phase, t, frame: f } = frameAt(variant, ts - t0.current) as { phase: number; t: number; frame: Frame }
      paintSteps(phase)
      paint(f)
      raf.current = requestAnimationFrame(frame)
    }
    const start = () => {
      if (running.current) return
      running.current = true
      raf.current = requestAnimationFrame(frame)
    }
    /* halt 는 t0 를 리셋하지 않는다 — 화면 밖에서도 시계는 흐른 것으로 계산되어,
       다시 들어오면 그동안 돌고 있었던 위치에서 이어진다(원본 동작) */
    const halt = () => {
      running.current = false
      cancelAnimationFrame(raf.current)
    }
    const io = new IntersectionObserver(
      entries => (entries.some(e => e.isIntersecting) ? start() : halt()),
      { threshold: 0.25 }
    )
    io.observe(el)
    return () => {
      io.disconnect()
      halt()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant])

  return (
    <DiagramFigure className="vm-rstep">
      <style>{CSS}</style>
      <svg ref={svgRef} className="rs-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={cfg.still}>
        {/* 단계 인디케이터 */}
        <g ref={stepGroup}>
          {GLYPHS.map((g, i) => (
            <text key={i} className="rs-step" x={28 + i * 27} y={26}>
              {g}
            </text>
          ))}
        </g>
        <text className="rs-badge" x={W - 28} y={26} textAnchor="end">
          {cfg.badge}
        </text>
        <text className="rs-lane" x={RAIL_X} y={RAIL_Y - 14}>
          {'canary steps  ·  currentStepIndex 가 가리키는 자리'}
        </text>

        {/* 스킵 호 — 인덱스가 끝으로 던져질 때 건너뛴 구간 위로 넘어간다 */}
        <path ref={skipArc} className="rs-skip" d="M0 0" opacity={0} />
        <text ref={skipTx} className="rs-skiptext" x={0} y={0} textAnchor="middle" opacity={0} />

        {/* 스텝 슬롯 */}
        {cfg.steps.map((label, i) => {
          const sx = slotX(i)
          return (
            <g key={i}>
              <rect
                ref={el => {
                  slots.current[i] = el
                }}
                className="rs-slot"
                x={sx}
                y={RAIL_Y}
                width={STEP_W}
                height={RAIL_H}
                rx={8}
              />
              <text
                ref={el => {
                  slotTx.current[i] = el
                }}
                className="rs-slottext"
                x={sx + STEP_W / 2}
                y={RAIL_Y + 17}
                textAnchor="middle"
              >
                {label}
              </text>
              <text className="rs-slotsub" x={sx + STEP_W / 2} y={RAIL_Y + 30} textAnchor="middle">
                {`index ${i}`}
              </text>
              <line
                ref={el => {
                  slotStrike.current[i] = el
                }}
                className="rs-strike"
                x1={sx + 12}
                y1={RAIL_Y + 13}
                x2={sx + STEP_W - 12}
                y2={RAIL_Y + 13}
                opacity={0}
              />
              <text
                ref={el => {
                  slotMark.current[i] = el
                }}
                className="rs-mark"
                x={sx + STEP_W / 2}
                y={RAIL_Y + RAIL_H + 17}
                textAnchor="middle"
              />
            </g>
          )
        })}

        {/* index == stepCount 자리 — 스텝이 아니다. currentStep 이 nil 이 되는 상태 */}
        <rect
          ref={endBox}
          className="rs-slot rs-slot-end"
          x={slotX(N)}
          y={RAIL_Y}
          width={STEP_W}
          height={RAIL_H}
          rx={8}
        />
        <text className="rs-slottext rs-slottext-end" x={slotX(N) + STEP_W / 2} y={RAIL_Y + 16} textAnchor="middle">
          {`index = ${N}`}
        </text>
        <text className="rs-slotsub" x={slotX(N) + STEP_W / 2} y={RAIL_Y + 29} textAnchor="middle">
          currentStep = nil
        </text>
        <text ref={endMark} className="rs-mark" x={slotX(N) + STEP_W / 2} y={RAIL_Y + RAIL_H + 17} textAnchor="middle" />

        {/* 역탐색 화살표 — 끝 자리에서 거꾸로, 스킵 호와 반대 방향 */}
        <path ref={revArrow} className="rs-rev" d="M0 0" opacity={0} />
        <text ref={revTx} className="rs-revtext" x={0} y={0} textAnchor="middle" opacity={0} />

        {/* 가중치 바 + 가용량 겹치기 */}
        <text className="rs-lane" x={BAR.x} y={BAR.y - 30}>
          {'트래픽 가중치  ·  그 가중치가 요구하는 파드 수  vs  실제 Available'}
        </text>
        <text ref={srcTx} className="rs-src" x={BAR.x} y={BAR.y - 12} />
        <rect className="rs-bartrack" x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} rx={6} />
        {/* 눈금 — 10% 마다 */}
        {Array.from({ length: 9 }, (_, k) => k + 1).map(i => (
          <line
            key={i}
            className="rs-tick"
            x1={barX(i * 10)}
            y1={BAR.y + 4}
            x2={barX(i * 10)}
            y2={BAR.y + BAR.h - 4}
          />
        ))}
        {/* 실제 확보된 몫 — Available 비율까지 */}
        <rect ref={barHave} className="rs-bar-have" x={BAR.x} y={BAR.y} width={0} height={BAR.h} rx={6} />
        {/* 확보되지 않았는데 라우팅된 몫 — 이 빨간 칸이 사고다 */}
        <rect ref={barShort} className="rs-bar-short" x={BAR.x} y={BAR.y} width={0} height={BAR.h} opacity={0} />
        {/* 가중치 경계선 */}
        <line ref={wMark} className="rs-wmark" x1={BAR.x} y1={BAR.y - 5} x2={BAR.x} y2={BAR.y + BAR.h + 5} />
        <text ref={wTx} className="rs-wtext" x={BAR.x} y={BAR.y + BAR.h + 20} textAnchor="middle" />
        <text ref={hTx} className="rs-htext" x={BAR.x} y={BAR.y - 6} textAnchor="middle" />
        <text ref={barVal} className="rs-barval" x={BAR.x + BAR.w + 16} y={BAR.y + 19} />

        {/* ReplicaSet 카드 둘 */}
        {CARD_TITLES.map((title, side) => {
          const cx = cardX(side)
          return (
            <g key={side}>
              <rect
                ref={el => {
                  cardRect.current[side] = el
                }}
                className={side === 0 ? 'rs-card rs-card-canary' : 'rs-card rs-card-stable'}
                x={cx}
                y={CARD_Y}
                width={CARD_W}
                height={CARD_H}
                rx={10}
              />
              <text className="rs-cardtitle" x={cx + 14} y={CARD_Y + 21}>
                {title}
              </text>
              <text
                ref={el => {
                  cardAv.current[side] = el
                }}
                className="rs-avail"
                x={cx + CARD_W - 14}
                y={CARD_Y + 22}
                textAnchor="end"
              />
              <text
                ref={el => {
                  cardSub.current[side] = el
                }}
                className="rs-cardsub"
                x={cx + 14}
                y={CARD_Y + 41}
              />
              {Array.from({ length: C.REPLICAS }, (_, k) => (
                <circle
                  key={k}
                  ref={el => {
                    cardPods.current[side * C.REPLICAS + k] = el
                  }}
                  className="rs-pod"
                  cx={podX(cx, k)}
                  cy={podY(k)}
                  r={POD_R}
                  opacity={0}
                />
              ))}
            </g>
          )
        })}

        {/* AnalysisRun · 게이트 · 판정 */}
        <rect ref={arPill} className="rs-pill" x={28} y={PILL_Y - 17} width={318} height={30} rx={15} />
        <text ref={arTx} className="rs-pilltext" x={44} y={PILL_Y + 3} />
        <text ref={gateTx} className="rs-gate" x={W - 28} y={PILL_Y - 3} textAnchor="end" />
        <text ref={verTx} className="rs-verdict" x={W - 28} y={PILL_Y + 16} textAnchor="end" />
      </svg>
      <p ref={capRef} className="rs-caption">
        {caption ?? cfg.still}
      </p>
    </DiagramFigure>
  )
}

/* static/flow/rstep.css 를 그대로 옮긴 것. */
const CSS = `
.vm-rstep {
  --rs-surface: #fcfcfb;
  --rs-ink: #0b0b0b;
  --rs-ink2: #52514e;
  --rs-muted: #898781;
  --rs-track: #ecebe4;
  --rs-canary: #2a78d6;
  --rs-canary-soft: #dbeafe;
  --rs-stable: #15803d;
  --rs-stable-soft: #dcfce7;
  --rs-warn: #d97706;
  --rs-warn-soft: #fef3c7;
  --rs-bad: #b91c1c;
  --rs-bad-soft: #fee2e2;
  --rs-border: rgba(11, 11, 11, 0.10);
  margin: 1.5rem 0;
  background: var(--rs-surface);
  border: 1px solid var(--rs-border);
  border-radius: 14px;
  padding: 16px 18px 12px;
  color: var(--rs-ink);
}
html.dark .vm-rstep {
  --rs-surface: #1a1a19;
  --rs-ink: #fff;
  --rs-ink2: #c3c2b7;
  --rs-muted: #898781;
  --rs-track: #2c2c2a;
  --rs-canary: #4a8de0;
  --rs-canary-soft: #22334a;
  --rs-stable: #4ade80;
  --rs-stable-soft: #1e3a2a;
  --rs-warn: #f59e0b;
  --rs-warn-soft: #3a2e12;
  --rs-bad: #f87171;
  --rs-bad-soft: #431516;
  --rs-border: rgba(255, 255, 255, 0.10);
}

.rs-svg { display: block; width: 100%; height: auto; }

.rs-step { fill: var(--rs-muted); font-size: 15px; font-weight: 600; transition: fill 0.2s; }
.rs-step-on { fill: var(--rs-canary); font-size: 18px; font-weight: 800; }
.rs-badge { fill: var(--rs-canary); font-size: 13px; font-weight: 800; letter-spacing: 0.02em; }
.rs-lane { fill: var(--rs-ink); font-size: 12px; font-weight: 800; }

/* ── 스텝 레일 ── 한 칸이 CanaryStep 하나. 마지막 뒤의 점선 칸은 index == stepCount 자리다 */
.rs-slot { fill: var(--rs-track); stroke: var(--rs-border); stroke-width: 1; }
.rs-slot-done { fill: var(--rs-canary-soft); stroke: var(--rs-canary); stroke-opacity: 0.45; }
.rs-slot-on { fill: var(--rs-canary-soft); stroke: var(--rs-canary); stroke-width: 2.2; }
/* 건너뛴 스텝 — 값은 남아 있는데 밟지 않는다 */
.rs-slot-skipped { fill: none; stroke: var(--rs-muted); stroke-dasharray: 4 3; }
/* 건너뛰었는데 역탐색이 도로 집어온 스텝 — 이 도식의 핵 */
.rs-slot-hit { fill: var(--rs-bad-soft); stroke: var(--rs-bad); stroke-width: 2.4; }
.rs-slot-end { fill: none; stroke: var(--rs-muted); stroke-dasharray: 5 3; }
.rs-slottext { fill: var(--rs-ink2); font-size: 12.5px; font-weight: 700; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.rs-slottext-on { fill: var(--rs-ink); font-weight: 800; }
.rs-slottext-skipped { fill: var(--rs-muted); font-weight: 600; }
.rs-slottext-end { fill: var(--rs-muted); font-weight: 700; }
.rs-slotsub { fill: var(--rs-muted); font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.rs-strike { stroke: var(--rs-muted); stroke-width: 1.4; }
.rs-mark { fill: var(--rs-canary); font-size: 11px; font-weight: 800; }
.rs-mark-hit { fill: var(--rs-bad); }

/* 스킵 호 — 인덱스가 스텝 구간 위를 뛰어넘는다 */
.rs-skip { fill: none; stroke: var(--rs-warn); stroke-width: 2; stroke-dasharray: 7 4; stroke-linecap: round; }
.rs-skiptext { fill: var(--rs-warn); font-size: 11.5px; font-weight: 800; }

/* 역탐색 — 끝 자리에서 거꾸로. 스킵 호와 반대 방향이라는 게 보여야 한다 */
.rs-rev { fill: none; stroke: var(--rs-bad); stroke-width: 1.8; stroke-linecap: round; }
.rs-revtext { fill: var(--rs-bad); font-size: 10.5px; font-weight: 700; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

/* ── 가중치 바 ── 확보된 몫(초록)과 확보되지 않았는데 라우팅된 몫(빨강)을 겹쳐 그린다 */
.rs-bartrack { fill: var(--rs-track); }
.rs-tick { stroke: var(--rs-surface); stroke-width: 1; stroke-opacity: 0.8; }
.rs-bar-have { fill: var(--rs-stable); opacity: 0.62; }
.rs-bar-short { fill: var(--rs-bad); opacity: 0.85; }
.rs-wmark { stroke: var(--rs-ink); stroke-width: 2; }
.rs-wtext { fill: var(--rs-ink); font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums; }
.rs-wtext-bad { fill: var(--rs-bad); }
.rs-htext { fill: var(--rs-ink2); font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; }
.rs-barval { font-size: 12.5px; font-weight: 800; font-variant-numeric: tabular-nums; }
.rs-barval-ok { fill: var(--rs-stable); }
.rs-barval-bad { fill: var(--rs-bad); }

/* 이 가중치를 정한 코드 갈래 */
.rs-src { font-size: 11px; font-weight: 700; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.rs-src-neutral { fill: var(--rs-muted); }
.rs-src-ok { fill: var(--rs-ink2); }
.rs-src-warn { fill: var(--rs-warn); }
.rs-src-bad { fill: var(--rs-bad); }

/* ── ReplicaSet 카드 ── */
.rs-card { fill: var(--rs-surface); stroke: var(--rs-border); stroke-width: 1.4; }
.rs-card-canary { stroke: var(--rs-canary); }
.rs-card-stable { stroke: var(--rs-stable); }
.rs-card-short { stroke: var(--rs-bad); stroke-width: 2.4; fill: var(--rs-bad-soft); }
.rs-card-gone { stroke: var(--rs-muted); stroke-dasharray: 5 3; fill: var(--rs-track); }
.rs-cardtitle { fill: var(--rs-ink); font-size: 12px; font-weight: 800; }
.rs-cardsub { fill: var(--rs-ink2); font-size: 11px; font-variant-numeric: tabular-nums; }
.rs-avail { fill: var(--rs-ink); font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums; }
.rs-avail-bad { fill: var(--rs-bad); }

/* 파드 — 진한 것이 Available, 점선 원이 desired 중 아직 안 뜬 자리 */
.rs-pod { stroke: var(--rs-surface); stroke-width: 1.6; }
.rs-pod-canary { fill: var(--rs-canary); }
.rs-pod-stable { fill: var(--rs-stable); }
.rs-pod-pending { fill: none; stroke: var(--rs-muted); stroke-width: 1.4; stroke-dasharray: 2.5 2; }

/* AnalysisRun 상태 */
.rs-pill { fill: var(--rs-track); stroke: var(--rs-muted); stroke-width: 1.2; }
.rs-pill-run { fill: var(--rs-canary-soft); stroke: var(--rs-canary); stroke-width: 1.6; }
.rs-pill-ok { fill: var(--rs-stable-soft); stroke: var(--rs-stable); stroke-width: 1.6; }
.rs-pill-off { fill: none; stroke: var(--rs-muted); stroke-dasharray: 4 3; }
.rs-pilltext { fill: var(--rs-ink); font-size: 12px; font-weight: 700; }
.rs-pilltext-off { fill: var(--rs-muted); }

/* 우측 게이트·판정 */
.rs-gate { fill: var(--rs-ink2); font-size: 10.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.rs-verdict { font-size: 12.5px; font-weight: 800; font-variant-numeric: tabular-nums; }
.rs-verdict-neutral { fill: var(--rs-ink2); }
.rs-verdict-ok { fill: var(--rs-stable); }
.rs-verdict-warn { fill: var(--rs-warn); }
.rs-verdict-bad { fill: var(--rs-bad); }

.rs-caption { font-size: 12.5px; color: var(--rs-ink2); margin: 10px 0 0; line-height: 1.6; }
`
