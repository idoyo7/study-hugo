/*
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  이 디렉토리는 Hugo 빌드에 참여하지 않는다.                                │
 * │  content/ 밖이고 어떤 shortcode 도 이 파일을 참조하지 않는다 —             │
 * │  나중에 nextra 로 옮길 때 그대로 집어가기 위한 대기 파일이다.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * rstep 도식의 **의미만** 담은 프레임워크 무의존 모듈.
 *
 * static/flow/rstep.js 는 정적 호스팅용이라 번들러 없이 도는 IIFE 다. 그래서 이 모듈을
 * import 하지 못하고 같은 로직을 자기 안에 들고 있다. **두 곳에 같은 계산이 있다는 뜻이므로
 * 드리프트가 실제 위험이다.** 그걸 잡는 장치가 tools/flow-render/port-parity.js 다 —
 * 이 모듈의 프레임과 Hugo 엔진이 실제로 SVG 에 칠한 값을 전 구간 대조한다.
 * 어느 한쪽을 고치면 그 테스트가 깨진다. 깨지면 양쪽을 맞춰라.
 *
 * nextra 로 옮길 때:
 *   1. 이 파일을 그대로 가져간다 (의존성 0, DOM 접근 0).
 *   2. 렌더링만 React 로 다시 쓴다 — RolloutStep.tsx 참고.
 *   3. port-parity.js 를 nextra 쪽 테스트로 옮겨 계속 돌린다.
 *      옮긴 뒤에는 Hugo 엔진이 SSOT 가 아니라 이 모듈이 SSOT 가 된다.
 *
 * 근거: argo-rollouts v1.8.2. 단계 서술의 코드 인용은
 * content/rollouts/02-rollback-window-weight/index.md 가 정본이다.
 */

/* 실측 상수 — 2026-08-21 사고 조건(주문 도메인의 프런트 API). 이 넷만 고치면 나머지는 유도된다. */
export const C = {
  REPLICAS: 20,   // desired
  MIN_PODS: 2,    // canary.minPodsPerReplicaSet (base 차트 기본값)
  RPS: 96,        // 사고 구간 유입
  POD_CEIL: 29,   // 2대 처리 천장 — 1코어 미만 CPU limit 에 실행 단위 여럿인 구성에서 유도한 계산값(실측 상한 아님)
  PHASE_MS: 3200,
  PHASE_COUNT: 6,
};

/* base 차트 기본 steps (platform/charts/base/values.yaml) */
const STEPS_3 = ['setWeight: 5', 'pause: 10m', 'setWeight: 100'];
/* 마지막 하나를 지운 형태 */
const STEPS_2 = ['setWeight: 5', 'pause: 10m'];

export const VARIANTS = {
  deploy: {
    steps: STEPS_3, badge: '정상 배포',
    still: '정상 배포 — 인덱스를 하나씩 밟습니다. 스텝마다 canary 가 Available 이 될 때까지 가중치가 앞 스텝 값에 묶이므로, 요구 파드 수가 실제 Ready 를 넘어서는 구간이 생기지 않습니다.',
  },
  promote: {
    steps: STEPS_3, badge: 'promote --full',
    still: 'promote --full — 스텝을 전부 건너뛰고 AnalysisRun 도 취소하지만, 가중치는 :229 갈래가 현재 값에 동결합니다. ReplicaSet 만 전량으로 오르고 전환은 20/20 에서 한 번에 일어납니다.',
  },
  rollback: {
    steps: STEPS_3, badge: 'rollbackWindow 롤백',
    still: 'rollbackWindow 롤백 — 스킵과 AnalysisRun 취소는 promote --full 과 같은데, 가중치 동결 갈래가 없어 :245 역탐색으로 떨어집니다. 건너뛴 스텝의 마지막 setWeight:100 을 도로 집어와 Ready 2대에 전량을 싣습니다.',
  },
  fixed: {
    steps: STEPS_2, badge: '마지막 100 제거 후',
    still: '마지막 setWeight:100 을 지운 뒤의 같은 롤백 — 같은 역탐색 코드가 pause 를 지나 setWeight:5 를 집습니다. 요구 파드가 1대라 하한 2대로 충족되고, 대가는 램프 구간 내내 95% 가 되돌리려던 버전으로 가는 것입니다.',
  },
};

export const VARIANT_KEYS = ['deploy', 'promote', 'rollback', 'fixed'];

/* ── 보간 유틸 — 엔진과 같은 식이어야 한다 ── */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t) => 1 - Math.pow(1 - t, 3);
const lerp = (a, b, t) => a + (b - a) * t;
const winP = (t, s, e) => clamp01((t - s) / (e - s));
/* 사고 구간의 Ready 진동 — readyFailureThreshold 1 로 한 번 넘기면 즉시 빠지고
   복귀에 successThreshold × period 가 걸린다 */
const flap = (t) => (Math.sin(t * Math.PI * 3.4) > -0.1 ? 1 : 0);

export function makeConfig(variant) {
  const v = VARIANTS[variant] || VARIANTS.deploy;
  const n = v.steps.length;
  const { REPLICAS, MIN_PODS, RPS, POD_CEIL } = C;
  let captions;
  if (variant === 'deploy') {
    captions = [
      `① 새 ReplicaSet 이 뜹니다. 첫 스텝이 5% 라 ceil(5%×${REPLICAS})=1 인데 minPodsPerReplicaSet 하한 ${MIN_PODS} 이 걸려 ${MIN_PODS}대가 됩니다. Available 이 0 인 동안은 :217 이 가중치를 아예 주지 않습니다`,
      `② ${MIN_PODS}대가 Ready 되면 index 0 의 setWeight:5 가 발효됩니다. 5% 가 요구하는 파드는 1대뿐이라 하한 ${MIN_PODS}대로 충족됩니다. 이때 background AnalysisRun 이 붙습니다`,
      '③ index 1 은 pause 입니다. 스텝은 멈춰 있고 AnalysisRun 만 20초마다 측정합니다 — 판정이 실제로 일어나는 구간은 여기입니다',
      `④ index 2 로 넘어가 RS 목표가 ${REPLICAS}으로 오릅니다. 아직 도달하지 않았으므로 :245 역탐색이 걸리고, 가중치는 앞 스텝 값 5% 에 묶입니다 — 이 게이트가 정상 배포를 안전하게 만드는 장치입니다`,
      `⑤ ${REPLICAS}/${REPLICAS} 에 도달하면 게이트가 풀리고 :255 가 index 2 의 setWeight:100 을 씁니다. 요구 ${REPLICAS}대와 실제 Ready ${REPLICAS}대가 같습니다`,
      '⑥ 같은 조건이 승격 게이트도 통과시킵니다 — shouldFullPromote 는 Available == spec.replicas 를 요구합니다. stable 이 되고 구 RS 는 30초 뒤 축소됩니다',
    ];
  } else if (variant === 'promote') {
    captions = [
      '① index 1 의 pause 에서 대기 중입니다. 가중치 5%, canary 2대, AnalysisRun 은 돌고 있습니다',
      '② promote --full 이 status.promoteFull 을 켭니다. canary.go:390 이 인덱스를 스텝 끝으로 던지고 analysis.go:77 이 실행 중인 AnalysisRun 을 취소합니다 — 여기까지는 rollbackWindow 와 같습니다',
      `③ 갈리는 지점입니다. PromoteFull 은 :229 에 자기 갈래가 있어 가중치를 현재 값 5% 에 동결합니다. RS 목표만 ${REPLICAS}으로 오릅니다`,
      '④ 램프업 내내 가중치는 5% 입니다. 요구 파드는 1대라 Ready 가 늘 그보다 많습니다 — 미가용 구간이 열리지 않습니다',
      `⑤ ${REPLICAS}/${REPLICAS} 도달. 가중치는 여전히 동결이고, 대신 승격 게이트가 성립합니다`,
      '⑥ 승격이 되면 stable subset 이 새 리비전을 가리키므로 canary 가중치는 0 으로 돌아갑니다. 전환이 한 번에 일어나는 원자적 형태입니다',
    ];
  } else if (variant === 'rollback') {
    captions = [
      `① 롤백도 컨트롤러에는 새 rollout 입니다. RS 가 하한 ${MIN_PODS}대로 뜨고 index 는 0 에서 시작합니다`,
      '② isRollbackWithinWindow 가 성립해 인덱스가 스텝 끝으로 점프하고 AnalysisRun 이 취소됩니다 — promote --full 과 같은 코드, 같은 줄입니다',
      '③ 여기서 갈립니다. rollbackWindow 는 :229 에 자기 갈래가 없어 :245 역탐색으로 떨어집니다. index−1 부터 거꾸로 훑어 처음 만나는 setWeight 가 방금 건너뛴 마지막 100 입니다',
      `④ 100% 가 요구하는 파드는 ${REPLICAS}대인데 Ready 는 ${MIN_PODS}대입니다. ${MIN_PODS}대에 ${RPS} rps 가 들어오고 천장은 ${POD_CEIL} rps 라 /ready 가 넘어가 endpoint 가 0 이 됩니다`,
      `⑤ ${REPLICAS}/${REPLICAS} 에 도달하면 요구와 실제가 맞습니다. 사고는 그 사이 35초 안에 다 일어났습니다`,
      '⑥ 승격 게이트는 promote --full 과 같은 조건입니다 — Available == spec.replicas. 롤백 완료 시각 자체는 가중치와 무관합니다',
    ];
  } else {
    captions = [
      `① 여기까지는 rollbackWindow 와 같습니다 — RS 하한 ${MIN_PODS}대, index 0`,
      '② 인덱스 점프도 AnalysisRun 취소도 같습니다. rollbackWindow 를 그대로 두므로 이 효과는 유지됩니다',
      '③ 역탐색도 같은 코드입니다. 다만 index−1 이 pause 라 SetWeight 가 nil 이고, 한 칸 더 가서 setWeight:5 를 집습니다',
      '④ 5% 가 요구하는 파드는 1대입니다. 하한 2대로 충족되니 미가용 구간이 없습니다. 대가는 램프 내내 95% 가 되돌리려던 버전으로 가는 것입니다',
      `⑤ ${REPLICAS}/${REPLICAS} 에서 게이트가 풀립니다. index 가 stepCount 와 같으므로 :261 의 MaxTrafficWeight 가 100 을 씁니다`,
      '⑥ 같은 리컨실에서 승격까지 갑니다 — 정상 배포의 마지막 두 단계와 같은 모양입니다',
    ];
  }
  return { variant, steps: v.steps, stepCount: n, badge: v.badge, still: v.still, captions };
}

/**
 * (variant, phase, t) → 화면 상태 전부. 순수 함수다.
 * @param {string} variant  deploy | promote | rollback | fixed
 * @param {number} phase    0..5
 * @param {number} t        0..1, 그 단계 안의 진행률
 */
export function computeFrame(variant, phase, t) {
  const { REPLICAS, MIN_PODS, RPS, POD_CEIL } = C;
  const N = (VARIANTS[variant] || VARIANTS.deploy).steps.length;
  const f = {
    idx: 0, atEnd: false, skipFrom: -1, revHit: -1,
    weight: 0, src: '', srcTone: 'neutral',
    cDesired: MIN_PODS, cAvail: 0, sDesired: REPLICAS, sAvail: REPLICAS,
    analysis: 'none', gate: '', verdict: '', tone: 'neutral', promoted: false,
  };

  if (variant === 'deploy') {
    if (phase === 0) {
      f.cAvail = Math.floor(ease(winP(t, 0.45, 0.95)) * (MIN_PODS + 0.999));
      f.weight = 0;
      f.src = ':217  newRS.AvailableReplicas == 0  →  never weight to canary';
      f.gate = 'Available 대기';
      f.verdict = 'ceil(5%×20)=1 · 하한 2 적용';
    } else if (phase === 1) {
      f.cAvail = MIN_PODS; f.weight = 5; f.analysis = 'running';
      f.src = ':255  GetCurrentSetWeight  →  steps[0].setWeight = 5';
      f.srcTone = 'ok';
      f.gate = 'AtDesiredReplicaCounts(2/2) 성립 → 스텝 완료';
      f.verdict = '요구 1대 ≤ Ready 2대'; f.tone = 'ok';
    } else if (phase === 2) {
      f.idx = 1; f.cAvail = MIN_PODS; f.weight = 5; f.analysis = 'running';
      f.src = ':255  GetCurrentSetWeight  →  거꾸로 훑어 steps[0] = 5';
      f.srcTone = 'ok';
      f.gate = 'pause 10m — duration 경과 대기';
      f.verdict = 'AnalysisRun 이 20초마다 측정'; f.tone = 'ok';
    } else if (phase === 3) {
      f.idx = 2; f.cDesired = REPLICAS; f.revHit = 0;
      f.cAvail = Math.floor(lerp(MIN_PODS, REPLICAS - 4, ease(winP(t, 0.08, 0.95))));
      f.weight = 5; f.analysis = 'running';
      f.src = ':245  미도달 → 역탐색  →  앞 스텝 5 를 유지';
      f.srcTone = 'ok';
      f.gate = 'atDesiredReplicaCount false — 20/20 대기';
      f.verdict = 'RS 2 → 20 램프업 · 가중치 5% 고정'; f.tone = 'ok';
    } else if (phase === 4) {
      f.idx = 2; f.cDesired = REPLICAS; f.cAvail = REPLICAS; f.weight = 100;
      f.analysis = 'running';
      f.src = ':255  GetCurrentSetWeight  →  steps[2].setWeight = 100';
      f.srcTone = 'ok';
      f.gate = 'AtDesiredReplicaCounts(20/20) 성립';
      f.verdict = '요구 20대 = Ready 20대'; f.tone = 'ok';
    } else {
      f.idx = 2; f.atEnd = t > 0.3; f.cDesired = REPLICAS; f.cAvail = REPLICAS;
      f.weight = 100; f.analysis = 'ok'; f.promoted = t > 0.3;
      f.sDesired = t > 0.45 ? 0 : REPLICAS;
      f.sAvail = t > 0.45 ? REPLICAS - Math.floor(ease(winP(t, 0.45, 0.95)) * REPLICAS) : REPLICAS;
      f.src = 'shouldFullPromote  →  Completed all 3 canary steps';
      f.srcTone = 'ok';
      f.gate = 'Available(20) == spec.replicas(20)';
      f.verdict = '승격 완료'; f.tone = 'ok';
    }
    return f;
  }

  /* promote · rollback · fixed — 인덱스를 끝으로 던지는 세 갈래.
     스킵 시작 위치만 다르고, 갈리는 건 가중치 갈래다. */
  const jumpAt = variant === 'promote' ? 1 : 0;
  const lastW = variant === 'rollback' ? 100 : 5;
  const revIdx = variant === 'rollback' ? N - 1 : 0;

  if (phase === 0) {
    f.idx = jumpAt;
    if (variant === 'promote') {
      f.cAvail = MIN_PODS; f.weight = 5; f.analysis = 'running';
      f.src = ':255  GetCurrentSetWeight  →  steps[0] = 5';
      f.srcTone = 'ok';
      f.gate = 'pause 10m 에서 사람이 기다리는 중';
      f.verdict = '요구 1대 ≤ Ready 2대'; f.tone = 'ok';
    } else {
      f.cAvail = 0; f.weight = 0;
      f.src = ':217  newRS.AvailableReplicas == 0  →  가중치 없음';
      f.gate = 'PodTemplateOrStepsChanged → 조기 반환, status 만 갱신';
      f.verdict = `RS 하한 ${MIN_PODS}대 생성`;
    }
  } else if (phase === 1) {
    f.idx = jumpAt; f.atEnd = t > 0.3; f.skipFrom = t > 0.3 ? jumpAt : -1;
    f.cAvail = variant === 'promote' ? MIN_PODS : 0;
    f.weight = variant === 'promote' ? 5 : 0;
    f.analysis = t > 0.55 ? 'cancelled' : 'running';
    f.src = `canary.go:390  PromoteFull || isRollbackWithinWindow  →  currentStepIndex = ${N}`;
    f.srcTone = 'warn';
    f.gate = 'analysis.go:77 이 같은 조건으로 실행분까지 취소';
    f.verdict = `스텝 ${N - jumpAt}개 스킵 · AnalysisRun 취소`; f.tone = 'warn';
  } else if (phase === 2) {
    f.idx = N - 1; f.atEnd = true; f.skipFrom = jumpAt; f.cDesired = REPLICAS;
    f.cAvail = variant === 'promote' ? MIN_PODS : Math.floor(ease(winP(t, 0.05, 0.35)) * (MIN_PODS + 0.999));
    f.analysis = 'cancelled';
    if (variant === 'promote') {
      f.weight = 5;
      f.src = ':229  PromoteFull 자기 갈래  →  현재 가중치 동결';
      f.srcTone = 'ok';
      f.gate = '역탐색(:245)은 !PromoteFull 조건에 걸려 아예 진입하지 않는다';
      f.verdict = '요구 1대 ≤ Ready 2대 — 미가용 구간 없음'; f.tone = 'ok';
    } else {
      f.revHit = t > 0.35 ? revIdx : -1;
      f.weight = t > 0.5 ? lastW : 0;
      f.src = `:245  미도달 → 역탐색  →  ${variant === 'rollback' ? '마지막 setWeight = 100' : 'pause 를 지나 setWeight = 5'}`;
      f.srcTone = variant === 'rollback' ? 'bad' : 'ok';
      f.gate = 'checkReplicasAvailable 은 stable 만 본다 — canary 는 검사되지 않는다';
      f.verdict = variant === 'rollback'
        ? `요구 ${REPLICAS}대 > Ready ${MIN_PODS}대 — ${REPLICAS - MIN_PODS}대 부족`
        : `요구 1대 ≤ Ready ${MIN_PODS}대`;
      f.tone = variant === 'rollback' ? 'bad' : 'ok';
    }
  } else if (phase === 3) {
    f.idx = N - 1; f.atEnd = true; f.skipFrom = jumpAt; f.cDesired = REPLICAS;
    f.analysis = 'cancelled'; f.weight = variant === 'promote' ? 5 : lastW;
    f.revHit = variant === 'promote' ? -1 : revIdx;
    if (variant === 'rollback') {
      const base = Math.floor(lerp(MIN_PODS, 9, ease(winP(t, 0.15, 1.0))));
      f.cAvail = flap(t) ? base : 0;
      f.src = ':245  가중치 100% 유지 — 20/20 이 될 때까지';
      f.srcTone = 'bad';
      f.gate = 'endpoint 0 — no healthy upstream';
      f.verdict = `${MIN_PODS}대 노출 ${RPS} rps · 천장 ${POD_CEIL} rps`;
      f.tone = 'bad';
    } else {
      f.cAvail = Math.floor(lerp(MIN_PODS, 18, ease(winP(t, 0.08, 0.95))));
      f.src = variant === 'promote' ? ':229  동결 유지 — RS 만 오른다' : ':245  가중치 5% 유지 — 20/20 까지';
      f.srcTone = 'ok';
      f.gate = 'atDesiredReplicaCount false — 20/20 대기';
      f.verdict = variant === 'promote' ? '램프업 · 진동 없음' : '진동 없음 · 95% 는 구 리비전이 처리';
      f.tone = variant === 'promote' ? 'ok' : 'warn';
    }
  } else if (phase === 4) {
    f.idx = N - 1; f.atEnd = true; f.skipFrom = jumpAt;
    f.cDesired = REPLICAS; f.cAvail = REPLICAS; f.analysis = 'cancelled';
    if (variant === 'promote') {
      f.weight = 5;
      f.src = ':229  동결 그대로 — 전환은 승격에서 한 번에';
      f.srcTone = 'ok';
    } else {
      f.weight = 100;
      f.src = ':261  index == stepCount  →  MaxTrafficWeight = 100';
      f.srcTone = 'ok';
    }
    f.gate = 'Available(20) == spec.replicas(20) — 승격 게이트 성립';
    f.verdict = '요구와 실제가 맞는 첫 시점'; f.tone = 'ok';
  } else {
    f.idx = N - 1; f.atEnd = true; f.skipFrom = jumpAt;
    f.cDesired = REPLICAS; f.cAvail = REPLICAS; f.analysis = 'cancelled';
    f.weight = variant === 'promote' ? (t > 0.35 ? 0 : 5) : 100;
    f.promoted = t > 0.3;
    f.sDesired = t > 0.45 ? 0 : REPLICAS;
    f.sAvail = t > 0.45 ? REPLICAS - Math.floor(ease(winP(t, 0.45, 0.95)) * REPLICAS) : REPLICAS;
    f.src = `shouldFullPromote  →  ${variant === 'promote' ? 'Full promotion requested' : 'Rollback within window'}`;
    f.srcTone = 'ok';
    f.gate = 'promoteStable — stable subset 이 새 해시를 가리킨다';
    f.verdict = '승격 완료'; f.tone = 'ok';
  }
  return f;
}

/** 경과 시간(ms) → { phase, t, frame }. 루프는 호출자가 돌린다. */
export function frameAt(variant, elapsedMs) {
  const total = elapsedMs % (C.PHASE_MS * C.PHASE_COUNT);
  const phase = Math.floor(total / C.PHASE_MS);
  const t = (total % C.PHASE_MS) / C.PHASE_MS;
  return { phase, t, frame: computeFrame(variant, phase, t) };
}

/** 그 가중치가 요구하는 파드 수. 화면의 "요구 n대" 는 이 유도값이어야 한다. */
export const requiredPods = (weight) => Math.ceil(C.REPLICAS * weight / 100);
