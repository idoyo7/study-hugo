/* eslint-disable */
// @ts-nocheck
//
// ↑ 이 두 줄은 의도적이다. 이 파일은 study-hugo 레포에 있지만 study-hugo 는 React·nextra 를
//   의존성으로 갖지 않는다 — 그래서 여기서는 `react` 와 `DiagramFigure` 가 영영 안 풀린다.
//   타입 검사를 끄지 않으면 편집기가 이 레포 전체에서 해결 불가능한 오류를 계속 띄운다.
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
 * rrev 도식("리비전이 바뀌면 트래픽은 어떻게 따라가는가")의 React 이식. 의미(로직)는 이 파일이
 * 새로 계산하지 않는다 — 전부 ./rrev-frames.mjs 에서 import 한다. 이 파일이 하는 일은 그 계산
 * 결과를 SVG 속성으로 칠하는 것뿐이다. 패킷의 화면 좌표(cx/cy)만은 예외다 — rrev-frames.mjs 는
 * 패킷의 목표(target)와 주기 진행률(cyc)만 내고, 그것을 픽셀로 바꾸는 지오메트리는 레이아웃
 * 상수와 함께 이 파일(그리고 static/flow/rrev.js)에 있다. RolloutStep.tsx 가 스킵 호·역탐색
 * 화살표의 좌표 계산을 컴포넌트 쪽에 둔 것과 같은 이유다.
 *
 * SSOT 는 rrev-frames.mjs 다. static/flow/rrev.js(정적 호스팅용 IIFE, 번들러 없이 도는 Hugo
 * 엔진)는 같은 계산을 자기 안에 중복으로 들고 있고, tools/flow-render/port-parity.js 가 그 둘을
 * 프레임 단위로 대조해 드리프트를 잡는다. 이 컴포넌트의 SVG 생성부·paint 매핑은
 * static/flow/rrev.js 의 build()/paint() 를 그대로 옮긴 것이다 — 로직이 아니라 "어느 요소의
 * 어느 속성을 어떻게 바꾸는가"만 베꼈다.
 *
 * 이식(포팅) 시 사람이 할 일:
 *   1. import 경로 조정 — 지금 './rrev-frames.mjs' 는 같은 디렉토리 상대경로다. 실제 위치로
 *      옮기면 이 경로와, 아래 DiagramFigure import 경로('../../../_components/diagram/DiagramFigure')
 *      둘 다 다시 잡아야 한다.
 *   2. rrev-frames.mjs 를 .ts 로 옮길지 결정 — RolloutStep.tsx 와 같은 이유로 지금은 강제되지 않는다.
 *   3. tools/flow-render/port-parity.js 를 nextra 쪽 테스트로 옮긴다. 옮긴 뒤에는 Hugo 엔진이
 *      아니라 rrev-frames.mjs 가 SSOT 이므로, 비교 방향도 뒤집어야 한다.
 *   4. 이 파일 자체를 한 번도 렌더해본 적이 없다 — static/flow/rrev.js 버전과 나란히 놓고
 *      눈으로 대조하는 과정이 필요하다.
 *
 * 근거: content/rollouts/01-canary-step-analysisrun/index.md §1 이 정본이다.
 */
'use client'

import { useEffect, useRef, type JSX } from 'react'

// 이식 시 실제 위치에 맞춰 조정
import { DiagramFigure } from '../../../_components/diagram/DiagramFigure'

import { C, REV_NEXT, makeConfig, computeFrame, frameAt } from './rrev-frames.mjs'

/* ── variant ── rrev-frames.mjs 의 VARIANT_KEYS 와 같은 값. 그 모듈이 없는 값은
   VARIANTS[variant] ? variant : 'handoff' 로 스스로 handoff 에 떨어지므로 여기서 다시 검증하지 않는다. */
type Variant = 'handoff'

/* ── rrev-frames.mjs 가 실제로 내는 값의 형태를 손으로 옮겨 적은 타입.
   .mjs 에는 .d.ts 가 없으므로 import 쪽에서 강제되지 않는다 — 배너 참고. */
type PacketTarget = 'canary' | 'stable'
type Packet = { cyc: number; target: PacketTarget }

type Frame = {
  canaryExists: boolean
  canaryGone: boolean
  canaryAvail: number
  canaryDesired: number
  stableAvail: number
  stableDesired: number
  canaryHash: string
  stableHash: string
  weightStable: number
  weightCanary: number
  guardOn: boolean
  stableRev: string
  canaryRev: string
  canaryStatus: string
  packets: Packet[]
}

type Cfg = {
  variant: Variant
  badge: string
  captions: string[]
  still: string
}

/* ── SVG 캔버스 · 레이아웃 상수 — static/flow/rrev.js 의 값을 그대로 옮겼다 ── */
const W = 920
const H = 460
const GLYPHS = ['①', '②', '③', '④', '⑤', '⑥'] // C.PHASE_COUNT(6) 와 같은 수여야 한다

const MARGIN = 26
const GAP = 20
const CARD_H = 118
const HEAD_Y = 24
const GUARD_Y = 32
const GUARD_H = 20

const TRAF_BAND_Y = 58
const TRAF_BAND_H = 162
const TRAF_LABEL_Y = TRAF_BAND_Y + 18
const TRAF_CARD_Y = TRAF_BAND_Y + 30 // 88

const SVC_W = 220
const DR_W = 280
const VS_W = 328
const SVC_X = MARGIN // 26
const DR_X = SVC_X + SVC_W + GAP // 266
const VS_X = DR_X + DR_W + GAP // 566 — VS_X+VS_W = 894 = W-MARGIN

const POD_BAND_Y = TRAF_BAND_Y + TRAF_BAND_H + 14 // 234
const POD_BAND_H = 162
const POD_LABEL_Y = POD_BAND_Y + 18
const POD_CARD_Y = POD_BAND_Y + 30 // 264

const RO_W = 276
const SRS_W = 276
const CRS_W = 276
const RO_X = MARGIN // 26
const SRS_X = RO_X + RO_W + GAP // 322
const CRS_X = SRS_X + SRS_W + GAP // 618 — CRS_X+CRS_W = 894 = W-MARGIN

const JUDGE_Y = POD_BAND_Y + POD_BAND_H + 14 // 410
const JUDGE_H = 36

/* 패킷 경로 — Service 카드 바닥에서 파드 층 카드 꼭대기까지, weight 비율대로 두 x 중 하나로.
   rrev-frames.mjs 는 target·cyc(주기 진행률)만 내고, 픽셀 좌표는 여기서 계산한다 — 배너 참고. */
const SVC_CX = SVC_X + SVC_W / 2 // 136
const SVC_BOTTOM_Y = TRAF_CARD_Y + CARD_H // 206
const STABLE_TX = SRS_X + SRS_W / 2 // 460
const CANARY_TX = CRS_X + CRS_W / 2 // 756
const POD_TOP_Y = POD_CARD_Y // 264

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}
function packetPos(p: Packet) {
  const tx = p.target === 'canary' ? CANARY_TX : STABLE_TX
  return { cx: lerp(SVC_CX, tx, p.cyc), cy: lerp(SVC_BOTTOM_Y, POD_TOP_Y, p.cyc) }
}

/* 파드 점 그리드 — stable RS 20개 (2행×10열) */
const POD_R = 5
const POD_COLS = 10
const POD_DX = 22
const POD_X0 = 14
const POD_Y0 = 40
const POD_DY = 16
function podX(cardX: number, i: number) {
  return cardX + POD_X0 + (i % POD_COLS) * POD_DX
}
function podY(cardY: number, i: number) {
  return cardY + POD_Y0 + Math.floor(i / POD_COLS) * POD_DY
}

const CHIP_W = 92
const CHIP_H = 18

export function RevisionHandoff({
  variant = 'handoff',
  caption,
}: {
  variant?: Variant
  caption?: string
}): JSX.Element {
  const cfg = makeConfig(variant) as Cfg
  /* 캡션을 밖에서 주면 그 문장이 고정된다 — 단계별 교체를 하지 않는다 */
  const fixedCaption = typeof caption === 'string' && caption.trim() !== ''

  const svgRef = useRef<SVGSVGElement>(null)
  const capRef = useRef<HTMLParagraphElement>(null)
  const stepGroup = useRef<SVGGElement>(null)

  const guardRect = useRef<SVGRectElement>(null)
  const guardTx = useRef<SVGTextElement>(null)

  const chipCanaryRect = useRef<SVGRectElement>(null)
  const chipCanaryTx = useRef<SVGTextElement>(null)
  const chipStableRect = useRef<SVGRectElement>(null)
  const chipStableTx = useRef<SVGTextElement>(null)

  const barStable = useRef<SVGRectElement>(null)
  const barCanary = useRef<SVGRectElement>(null)
  const barTx = useRef<SVGTextElement>(null)

  const roLine1 = useRef<SVGTextElement>(null)
  const roLine2 = useRef<SVGTextElement>(null)

  const srsAvailTx = useRef<SVGTextElement>(null)
  const srsPods = useRef<(SVGCircleElement | null)[]>([])
  const srsRevTx = useRef<SVGTextElement>(null)

  const crsRect = useRef<SVGRectElement>(null)
  const crsAvailTx = useRef<SVGTextElement>(null)
  const crsPod = useRef<SVGCircleElement>(null)
  const crsGhostTx = useRef<SVGTextElement>(null)
  const crsRevTx = useRef<SVGTextElement>(null)

  const packets = useRef<(SVGCircleElement | null)[]>([])

  const raf = useRef(0)
  const running = useRef(false)
  /* 0 은 유효한 타임스탬프다 — falsy 검사로는 첫 프레임이 0 일 때 영영 안 걸린다 */
  const t0 = useRef(-1)
  const lastPhase = useRef(-1)

  function paintSteps(p: number) {
    const g = stepGroup.current
    if (!g || lastPhase.current === p) return
    lastPhase.current = p
    const ns = g.querySelectorAll('text')
    for (let j = 0; j < ns.length; j++) {
      ns[j]!.setAttribute('class', j === p ? 'rr-step rr-step-on' : 'rr-step')
    }
    if (!fixedCaption && capRef.current) capRef.current.textContent = cfg.captions[p] ?? cfg.still
  }

  function paint(f: Frame) {
    guardRect.current?.setAttribute('opacity', f.guardOn ? '1' : '0')
    guardTx.current?.setAttribute('opacity', f.guardOn ? '1' : '0')
    if (guardTx.current) {
      guardTx.current.textContent = f.guardOn
        ? '⛔ 가드 걸림 — replicas>0 인 모든 ReplicaSet 이 Available 일 때까지 destination rule 전환을 미룬다 · UpdateHash() · 업스트림 #2507'
        : ''
    }

    chipCanaryRect.current?.setAttribute('class', 'rr-chip rr-chip-canary' + (f.canaryHash ? ' rr-chip-filled' : ''))
    if (chipCanaryTx.current) chipCanaryTx.current.textContent = f.canaryHash
    chipStableRect.current?.setAttribute('class', 'rr-chip rr-chip-stable' + (f.stableHash ? ' rr-chip-filled' : ''))
    if (chipStableTx.current) chipStableTx.current.textContent = f.stableHash

    const barX = VS_X + 14
    const barW = VS_W - 28
    const stableW = (barW * f.weightStable) / 100
    const canaryW = (barW * f.weightCanary) / 100
    barStable.current?.setAttribute('width', `${Math.max(0, stableW)}`)
    barCanary.current?.setAttribute('x', `${barX + stableW}`)
    barCanary.current?.setAttribute('width', `${Math.max(0, canaryW)}`)
    if (barTx.current) barTx.current.textContent = `stable ${f.weightStable}%  /  canary ${f.weightCanary}%`

    if (roLine1.current) roLine1.current.textContent = `stable → rev ${f.stableRev}` + (f.canaryGone ? ' (승격됨)' : '')
    if (roLine2.current) roLine2.current.textContent = f.canaryRev ? `canary → rev ${f.canaryRev}` : 'canary → —'

    if (srsAvailTx.current) srsAvailTx.current.textContent = `Available ${f.stableAvail}  /  desired ${f.stableDesired}`
    for (let j = 0; j < C.REPLICAS; j++) {
      srsPods.current[j]?.setAttribute('opacity', j < f.stableAvail ? '1' : '0.3')
    }
    if (srsRevTx.current) srsRevTx.current.textContent = `revision: rev ${f.stableRev}`

    const crsShow = f.canaryExists
    crsRect.current?.setAttribute('class', 'rr-card rr-card-canary' + (crsShow ? '' : ' rr-card-ghost'))
    crsAvailTx.current?.setAttribute('opacity', crsShow ? '1' : '0')
    if (crsAvailTx.current) {
      crsAvailTx.current.textContent = crsShow ? `Available ${f.canaryAvail}  /  desired ${f.canaryDesired}` : ''
    }
    crsPod.current?.setAttribute('opacity', crsShow && f.canaryAvail > 0 ? '1' : '0')
    crsGhostTx.current?.setAttribute('opacity', crsShow ? '0' : '1')
    if (crsGhostTx.current) {
      /* canary RS 는 승격 뒤에도 지워지지 않는다 — 카드는 ①처럼 다시 빈다(canaryGone 은 roLine1 의
         '(승격됨)' 표시에만 쓴다. 사실은 캡션 ⑥에 있다) */
      crsGhostTx.current.textContent = crsShow ? '' : '없음'
    }
    if (crsRevTx.current) {
      crsRevTx.current.textContent = crsShow
        ? `revision: rev ${REV_NEXT}` + (f.canaryStatus ? ` · ${f.canaryStatus}` : '')
        : ''
    }

    for (let j = 0; j < C.PACKET_N; j++) {
      const pk = f.packets[j]
      const pos = packetPos(pk)
      const el = packets.current[j]
      el?.setAttribute('cx', `${pos.cx}`)
      el?.setAttribute('cy', `${pos.cy}`)
      el?.setAttribute('class', `rr-pkt rr-pkt-${pk.target}`)
    }
  }

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    /* variant 가 바뀌면 캡션·글리프를 무조건 한 번 다시 칠해야 한다 */
    lastPhase.current = -1

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
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
    <DiagramFigure className="vm-rrev">
      <style>{CSS}</style>
      <svg ref={svgRef} className="rr-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={cfg.still}>
        <g ref={stepGroup}>
          {GLYPHS.map((g, i) => (
            <text key={i} className="rr-step" x={26 + i * 26} y={HEAD_Y}>
              {g}
            </text>
          ))}
        </g>
        <text className="rr-badge" x={W - 26} y={HEAD_Y} textAnchor="end">
          {cfg.badge}
        </text>

        {/* 가드 배너 — ③단계에만 보인다 */}
        <rect ref={guardRect} className="rr-guard" x={MARGIN} y={GUARD_Y} width={W - MARGIN * 2} height={GUARD_H} rx={8} opacity={0} />
        <text ref={guardTx} className="rr-guardtext" x={MARGIN + 12} y={GUARD_Y + GUARD_H / 2 + 4} />

        {/* 트래픽 층 (주황) */}
        <rect x={MARGIN} y={TRAF_BAND_Y} width={W - MARGIN * 2} height={TRAF_BAND_H} rx={12} className="rr-band rr-band-traffic" />
        <text className="rr-lane rr-lane-traffic" x={MARGIN + 14} y={TRAF_LABEL_Y}>
          트래픽 층 · Service 하나 · DestinationRule subset · VirtualService weight
        </text>

        {/* Service 카드 */}
        <rect x={SVC_X} y={TRAF_CARD_Y} width={SVC_W} height={CARD_H} rx={10} className="rr-card rr-card-service" />
        <text className="rr-title" x={SVC_X + 14} y={TRAF_CARD_Y + 18}>Service</text>
        <text className="rr-badgesmall" x={SVC_X + SVC_W - 14} y={TRAF_CARD_Y + 18} textAnchor="end">1개뿐</text>
        <text className="rr-sub" x={SVC_X + 14} y={TRAF_CARD_Y + 42}>selector</text>
        <text className="rr-mono" x={SVC_X + 14} y={TRAF_CARD_Y + 58}>app.kubernetes.io/name</text>
        <text className="rr-mono" x={SVC_X + 14} y={TRAF_CARD_Y + 74}>app.kubernetes.io/instance</text>
        <text className="rr-note rr-note-traffic" x={SVC_X + 14} y={TRAF_CARD_Y + 98}>canary + stable 함께 선택</text>

        {/* DestinationRule 카드 */}
        <rect x={DR_X} y={TRAF_CARD_Y} width={DR_W} height={CARD_H} rx={10} className="rr-card rr-card-dr" />
        <text className="rr-title" x={DR_X + 14} y={TRAF_CARD_Y + 18}>DestinationRule</text>
        <text className="rr-sub" x={DR_X + 14} y={TRAF_CARD_Y + 46}>subset: canary</text>
        <text className="rr-sub" x={DR_X + 14} y={TRAF_CARD_Y + 72}>subset: stable</text>
        <rect
          ref={chipCanaryRect}
          className="rr-chip rr-chip-canary"
          x={DR_X + DR_W - 14 - CHIP_W}
          y={TRAF_CARD_Y + 46 - 13}
          width={CHIP_W}
          height={CHIP_H}
          rx={9}
        />
        <text ref={chipCanaryTx} className="rr-chiptext" x={DR_X + DR_W - 14 - CHIP_W / 2} y={TRAF_CARD_Y + 46} textAnchor="middle" />
        <rect
          ref={chipStableRect}
          className="rr-chip rr-chip-stable"
          x={DR_X + DR_W - 14 - CHIP_W}
          y={TRAF_CARD_Y + 72 - 13}
          width={CHIP_W}
          height={CHIP_H}
          rx={9}
        />
        <text ref={chipStableTx} className="rr-chiptext" x={DR_X + DR_W - 14 - CHIP_W / 2} y={TRAF_CARD_Y + 72} textAnchor="middle" />
        <text className="rr-note" x={DR_X + 14} y={TRAF_CARD_Y + 98}>rollouts-pod-template-hash ← 컨트롤러가 씀</text>

        {/* VirtualService 카드 */}
        <rect x={VS_X} y={TRAF_CARD_Y} width={VS_W} height={CARD_H} rx={10} className="rr-card rr-card-vs" />
        <text className="rr-title" x={VS_X + 14} y={TRAF_CARD_Y + 18}>VirtualService</text>
        <rect x={VS_X + 14} y={TRAF_CARD_Y + 40} width={VS_W - 28} height={18} rx={6} className="rr-bar-track" />
        <rect ref={barStable} className="rr-bar-stable" x={VS_X + 14} y={TRAF_CARD_Y + 40} width={VS_W - 28} height={18} rx={6} />
        <rect ref={barCanary} className="rr-bar-canary" x={VS_X + 14} y={TRAF_CARD_Y + 40} width={0} height={18} />
        <text ref={barTx} className="rr-vstext" x={VS_X + 14} y={TRAF_CARD_Y + 40 + 18 + 18} />
        <text className="rr-note" x={VS_X + 14} y={TRAF_CARD_Y + 98}>route weight — 이 값만 트래픽 비율을 정한다</text>

        {/* 파드 층 (파랑) */}
        <rect x={MARGIN} y={POD_BAND_Y} width={W - MARGIN * 2} height={POD_BAND_H} rx={12} className="rr-band rr-band-pod" />
        <text className="rr-lane rr-lane-pod" x={MARGIN + 14} y={POD_LABEL_Y}>
          파드 층 · Rollout · stable RS · canary RS
        </text>

        {/* Rollout 카드 */}
        <rect x={RO_X} y={POD_CARD_Y} width={RO_W} height={CARD_H} rx={10} className="rr-card rr-card-rollout" />
        <text className="rr-title" x={RO_X + 14} y={POD_CARD_Y + 18}>Rollout</text>
        <text ref={roLine1} className="rr-mono" x={RO_X + 14} y={POD_CARD_Y + 46} />
        <text ref={roLine2} className="rr-mono" x={RO_X + 14} y={POD_CARD_Y + 70} />
        <text className="rr-note" x={RO_X + 14} y={POD_CARD_Y + 98}>strategy.canary — 포인터 이동 = 승격</text>

        {/* stable RS 카드 */}
        <rect x={SRS_X} y={POD_CARD_Y} width={SRS_W} height={CARD_H} rx={10} className="rr-card rr-card-stable" />
        <text className="rr-title" x={SRS_X + 14} y={POD_CARD_Y + 18}>stable RS</text>
        <text ref={srsAvailTx} className="rr-avail rr-avail-stable" x={SRS_X + SRS_W - 14} y={POD_CARD_Y + 18} textAnchor="end" />
        {Array.from({ length: C.REPLICAS }, (_, i) => (
          <circle
            key={i}
            ref={el => {
              srsPods.current[i] = el
            }}
            className="rr-pod rr-pod-stable"
            cx={podX(SRS_X, i)}
            cy={podY(POD_CARD_Y, i)}
            r={POD_R}
          />
        ))}
        <text ref={srsRevTx} className="rr-note" x={SRS_X + 14} y={POD_CARD_Y + CARD_H - 10} />

        {/* canary RS 카드 */}
        <rect ref={crsRect} x={CRS_X} y={POD_CARD_Y} width={CRS_W} height={CARD_H} rx={10} className="rr-card rr-card-canary" />
        <text className="rr-title" x={CRS_X + 14} y={POD_CARD_Y + 18}>canary RS</text>
        <text ref={crsAvailTx} className="rr-avail rr-avail-canary" x={CRS_X + CRS_W - 14} y={POD_CARD_Y + 18} textAnchor="end" />
        <circle ref={crsPod} className="rr-pod rr-pod-canary" cx={CRS_X + CRS_W / 2} cy={POD_CARD_Y + 62} r={10} opacity={0} />
        <text ref={crsGhostTx} className="rr-ghosttext" x={CRS_X + CRS_W / 2} y={POD_CARD_Y + 62} textAnchor="middle" />
        <text ref={crsRevTx} className="rr-note" x={CRS_X + 14} y={POD_CARD_Y + CARD_H - 10} />

        {/* 판정 층 (청록) — 정지, 라벨만 */}
        <rect x={MARGIN} y={JUDGE_Y} width={W - MARGIN * 2} height={JUDGE_H} rx={10} className="rr-band rr-band-judge" />
        <text className="rr-judgetext" x={W / 2} y={JUDGE_Y + JUDGE_H / 2 + 4} textAnchor="middle">
          판정 층 · AnalysisTemplate → AnalysisRun → Prometheus
        </text>

        {/* 트래픽 패킷 */}
        {Array.from({ length: C.PACKET_N }, (_, i) => (
          <circle
            key={i}
            ref={el => {
              packets.current[i] = el
            }}
            className="rr-pkt rr-pkt-stable"
            cx={SVC_CX}
            cy={SVC_BOTTOM_Y}
            r={3.4}
          />
        ))}
      </svg>
      <p ref={capRef} className="rr-caption" />
    </DiagramFigure>
  )
}

/* CSS — static/flow/rrev.css 를 그대로 옮겼다. RolloutStep.tsx 와 같은 방식으로 <style> 태그에 인라인한다. */
const CSS = `
.vm-rrev {
  --rr-surface: #fcfcfb;
  --rr-ink: #0b0b0b;
  --rr-ink2: #52514e;
  --rr-muted: #898781;
  --rr-track: #ecebe4;
  --rr-border: rgba(11, 11, 11, 0.10);
  --rr-pod: #2a78d6;
  --rr-pod-soft: rgba(42, 120, 214, 0.08);
  --rr-traffic: #d97706;
  --rr-traffic-soft: rgba(217, 119, 6, 0.08);
  --rr-judge: #0d9488;
  --rr-judge-soft: rgba(13, 148, 136, 0.08);
  --rr-canary: #2a78d6;
  --rr-canary-soft: #dbeafe;
  --rr-stable: #15803d;
  --rr-stable-soft: #dcfce7;
  --rr-bad: #b91c1c;
  --rr-bad-soft: #fee2e2;
  margin: 1.5rem 0;
  background: var(--rr-surface);
  border: 1px solid var(--rr-border);
  border-radius: 14px;
  padding: 16px 18px 12px;
  color: var(--rr-ink);
}
html.dark .vm-rrev {
  --rr-surface: #1a1a19;
  --rr-ink: #fff;
  --rr-ink2: #c3c2b7;
  --rr-muted: #898781;
  --rr-track: #2c2c2a;
  --rr-border: rgba(255, 255, 255, 0.10);
  --rr-pod: #4b93e6;
  --rr-pod-soft: rgba(75, 147, 230, 0.12);
  --rr-traffic: #f59e0b;
  --rr-traffic-soft: rgba(245, 158, 11, 0.12);
  --rr-judge: #2dd4bf;
  --rr-judge-soft: rgba(45, 212, 191, 0.12);
  --rr-canary: #4a8de0;
  --rr-canary-soft: #22334a;
  --rr-stable: #4ade80;
  --rr-stable-soft: #1e3a2a;
  --rr-bad: #f87171;
  --rr-bad-soft: #431516;
}

.rr-svg { display: block; width: 100%; height: auto; }

.rr-step { fill: var(--rr-muted); font-size: 15px; font-weight: 600; transition: fill 0.2s; }
.rr-step-on { fill: var(--rr-pod); font-size: 18px; font-weight: 800; }
.rr-badge { fill: var(--rr-ink2); font-size: 12.5px; font-weight: 800; letter-spacing: 0.02em; font-variant-numeric: tabular-nums; }

.rr-guard { fill: var(--rr-bad-soft); stroke: var(--rr-bad); stroke-width: 1.4; }
.rr-guardtext { fill: var(--rr-bad); font-size: 11px; font-weight: 700; }

.rr-band { stroke: none; }
.rr-band-traffic { fill: var(--rr-traffic-soft); }
.rr-band-pod { fill: var(--rr-pod-soft); }
.rr-band-judge { fill: var(--rr-judge-soft); }
.rr-lane { font-size: 12px; font-weight: 800; }
.rr-lane-traffic { fill: var(--rr-traffic); }
.rr-lane-pod { fill: var(--rr-pod); }
.rr-judgetext { fill: var(--rr-judge); font-size: 12px; font-weight: 700; }

.rr-card { fill: var(--rr-surface); stroke: var(--rr-border); stroke-width: 1.4; }
.rr-card-service { stroke: var(--rr-traffic); }
.rr-card-dr { stroke: var(--rr-traffic); }
.rr-card-vs { stroke: var(--rr-traffic); }
.rr-card-rollout { stroke: var(--rr-pod); }
.rr-card-stable { stroke: var(--rr-stable); }
.rr-card-canary { stroke: var(--rr-canary); }
.rr-card-ghost { stroke: var(--rr-muted); stroke-dasharray: 5 3; fill: var(--rr-track); }

.rr-title { fill: var(--rr-ink); font-size: 12.5px; font-weight: 800; }
.rr-badgesmall { fill: var(--rr-traffic); font-size: 10.5px; font-weight: 800; }
.rr-sub { fill: var(--rr-ink2); font-size: 11px; font-weight: 700; }
.rr-mono { fill: var(--rr-ink2); font-size: 10.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.rr-note { fill: var(--rr-muted); font-size: 10.5px; }
.rr-note-traffic { fill: var(--rr-traffic); font-weight: 700; }
.rr-ghosttext { fill: var(--rr-muted); font-size: 11px; font-weight: 700; }

.rr-chip { fill: none; stroke: var(--rr-muted); stroke-width: 1.2; stroke-dasharray: 3 2; }
.rr-chip-filled.rr-chip-canary { fill: var(--rr-canary-soft); stroke: var(--rr-canary); stroke-dasharray: none; }
.rr-chip-filled.rr-chip-stable { fill: var(--rr-stable-soft); stroke: var(--rr-stable); stroke-dasharray: none; }
.rr-chiptext { fill: var(--rr-ink); font-size: 10px; font-weight: 800; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

.rr-bar-track { fill: var(--rr-track); }
.rr-bar-stable { fill: var(--rr-stable); opacity: 0.75; }
.rr-bar-canary { fill: var(--rr-canary); opacity: 0.85; }
.rr-vstext { fill: var(--rr-ink); font-size: 11.5px; font-weight: 800; font-variant-numeric: tabular-nums; }

.rr-avail { fill: var(--rr-ink); font-size: 11.5px; font-weight: 800; font-variant-numeric: tabular-nums; }
.rr-avail-stable { fill: var(--rr-stable); }
.rr-avail-canary { fill: var(--rr-canary); }

.rr-pod { stroke: var(--rr-surface); stroke-width: 1.4; }
.rr-pod-stable { fill: var(--rr-stable); }
.rr-pod-canary { fill: var(--rr-canary); }

.rr-pkt { stroke: var(--rr-surface); stroke-width: 1; }
.rr-pkt-stable { fill: var(--rr-stable); }
.rr-pkt-canary { fill: var(--rr-canary); }

.rr-caption { font-size: 12.5px; color: var(--rr-ink2); margin: 10px 0 0; line-height: 1.6; }
`
