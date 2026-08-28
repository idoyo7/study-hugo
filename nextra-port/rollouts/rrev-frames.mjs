/*
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  이 디렉토리는 Hugo 빌드에 참여하지 않는다.                                │
 * │  content/ 밖이고 어떤 shortcode 도 이 파일을 참조하지 않는다 —             │
 * │  나중에 nextra 로 옮길 때 그대로 집어가기 위한 대기 파일이다.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * rrev 도식("리비전이 바뀌면 트래픽은 어떻게 따라가는가")의 **의미만** 담은
 * 프레임워크 무의존 모듈.
 *
 * static/flow/rrev.js 는 정적 호스팅용이라 번들러 없이 도는 IIFE 다. 그래서 이 모듈을
 * import 하지 못하고 같은 로직을 자기 안에 들고 있다. **두 곳에 같은 계산이 있다는 뜻이므로
 * 드리프트가 실제 위험이다.** 그걸 잡는 장치가 tools/flow-render/port-parity.js 다 —
 * 이 모듈의 프레임과 Hugo 엔진이 실제로 SVG 에 칠한 값을 전 구간 대조한다.
 * 어느 한쪽을 고치면 그 테스트가 깨진다. 깨지면 양쪽을 맞춰라.
 *
 * nextra 로 옮길 때:
 *   1. 이 파일을 그대로 가져간다 (의존성 0, DOM 접근 0).
 *   2. 렌더링만 React 로 다시 쓴다 — RevisionHandoff.tsx 참고.
 *   3. port-parity.js 를 nextra 쪽 테스트로 옮겨 계속 돌린다.
 *      옮긴 뒤에는 Hugo 엔진이 SSOT 가 아니라 이 모듈이 SSOT 가 된다.
 *
 * 근거: content/rollouts/01-canary-step-analysisrun/index.md §1 이 정본이다.
 *   - UpdateHash() 진입부 가드는 replicas>0 인 RS 만 검사한다(rollout/trafficrouting/istio/istio.go).
 *     업스트림 이슈 #2507 대응. 새 RS 는 replicas=0 으로 태어난다(rollout/sync.go).
 *   - PodTemplateOrStepsChanged 인 바퀴는 새 RS 만 만들고 조기 반환한다 — 트래픽 리컨실은 다음
 *     바퀴에야 돈다(rollout/canary.go). canary RS 를 실제로 키우는 reconcileCanaryReplicaSets 는
 *     그 트래픽 리컨실보다 뒤다.
 *   - REPLICAS=20 은 static/flow/rstep.js 의 같은 상수를 그대로 쓴다(문서 예시 수치 통일).
 *   - 리비전은 rev N / rev N+1, 해시는 hash⟨N⟩ / hash⟨N+1⟩ 심볼로만 표기한다 — 실제 값을 발명하지 않는다.
 */

/* 실측 상수 — 이 다섯만 고치면 나머지는 유도된다. */
export const C = {
  REPLICAS: 20,          // stable RS desired (rstep.js 와 같은 값)
  CANARY_STEP_PCT: 5,    // base 차트 기본 첫 스텝(setWeight: 5)
  MIN_PODS_PER_RS: 2,    // base 차트 canary.minPodsPerReplicaSet 기본값 (rstep.js 의 MIN_PODS 와 같은 값)
  PACKET_N: 20,          // 패킷 개수 — REPLICAS 와 같은 값을 써서 %를 깨끗하게 맞춘다
  LOOPS: 4,              // 한 단계(t: 0→1) 동안 패킷이 도는 바퀴 수
  PHASE_MS: 3000,
  PHASE_COUNT: 6,
};
/* canary 목표 파드 수 = ceil(20*5/100)=1 인데 minPodsPerReplicaSet 하한 2 에 걸려 2 */
export const CANARY_DESIRED = Math.max(Math.ceil(C.REPLICAS * C.CANARY_STEP_PCT / 100), C.MIN_PODS_PER_RS);

export const REV_CUR = 'N';
export const REV_NEXT = 'N+1';
export const HASH_CUR = 'hash⟨N⟩';
export const HASH_NEXT = 'hash⟨N+1⟩';

export const VARIANTS = {
  handoff: {
    badge: `rev ${REV_CUR} → rev ${REV_NEXT}`,
    captions: [
      '① 파드 층은 Deployment 와 같다. 트래픽 층과 판정 층이 새로 생긴다. Service 는 하나뿐이고 그 selector 는 canary·stable 파드를 함께 잡는다 — 쪼개는 일은 DestinationRule subset 에서만 일어난다. 직전 승격이 두 subset 의 해시를 같게 맞춰 둔 상태다',
      '② 새 리비전이 오면 canary RS 가 생긴다. 하지만 템플릿이 바뀐 바퀴는 그 RS 만 만들고 곧바로 되돌아간다 — 트래픽 리컨실까지 가지 못한다. 그래서 새 RS 는 처음부터 0대로 태어난다',
      '③ 다음 바퀴에야 트래픽 리컨실이 돈다. 가드는 replicas 가 0 보다 큰 RS 만 살피므로 아직 0대인 canary RS 는 건너뛰고 해시를 subset 에 써버린다. subset 은 갈라졌지만 weight 가 0 이라 아무도 그쪽으로 가지 않는다 — 가드가 막아선 것은 해시 쓰기가 아니다',
      '④ canary RS 를 실제로 키우는 코드는 트래픽 리컨실보다 뒤에 있다. desired 가 2대로 오르는 것은 그다음 바퀴이고, 20대의 5% 를 올림한 1대가 아니라 하한 2대다. 이제 Available 이 목표에 못 미치니 가드가 걸리고, 그 자리에서 트래픽 리컨실이 끊겨 weight 가 움직이지 못한다',
      '⑤ 2대가 모두 준비되자 가드가 풀리고 같은 리컨실에서 weight 가 움직인다. 쪼개는 곳(subset 라벨)과 비율을 정하는 곳(VirtualService weight)이 서로 다른 층이다 — 순서가 거꾸로 될 수 없는 이유다',
      '⑥ 승격은 stable 포인터가 새 리비전으로 옮겨가는 일이다 — 어떤 RS 도 이 순간에 지워지지 않는다. 해시가 다시 써지고 weight 는 100/0 으로 돌아온다. 가중치는 원점인데 가리키는 리비전이 바뀌었다. 옛 RS 는 잠시 뒤 파드 수부터 줄고, 오브젝트 삭제는 훨씬 나중 정리 시점에 따로 일어난다',
    ],
    still: '리비전 핸드오프 — Service 는 하나지만 라우팅은 두 곳에서 갈립니다. 컨트롤러가 써넣는 해시가 DestinationRule subset 을 가르고, 그다음에야 VirtualService weight 가 트래픽 비율을 정합니다. 해시가 먼저 써지고 weight 는 그다음에야 움직입니다 — 순서가 바뀌면 두 subset 이 여전히 존재하면서도 selector 가 같아 트래픽이 갈리지 않고 뒤섞일 수 있기 때문입니다.',
  },
};

export const VARIANT_KEYS = ['handoff'];

export function makeConfig(variant) {
  const key = VARIANTS[variant] ? variant : 'handoff';
  const v = VARIANTS[key];
  return { variant: key, badge: v.badge, captions: v.captions, still: v.still };
}

/**
 * (variant, phase, t) → 화면 상태 전부. 순수 함수다.
 * @param {string} variant  handoff (지금은 하나뿐). 이 함수 안에서 분기에 쓰이지는 않는다 —
 *                          Hugo 엔진(static/flow/rrev.js)과, 그리고 향후 variant 가 늘어날 경우와
 *                          시그니처를 맞추려고 인자로만 받는다. 지우지 말 것.
 * @param {number} phase    0..5
 * @param {number} t        0..1, 그 단계 안의 진행률
 */
export function computeFrame(variant, phase, t) {
  const f = {
    canaryExists: false, canaryGone: false,
    canaryAvail: 0, canaryDesired: 0,
    stableAvail: C.REPLICAS, stableDesired: C.REPLICAS,
    canaryHash: HASH_CUR, stableHash: HASH_CUR,
    weightStable: 100, weightCanary: 0,
    guardOn: false,
    stableRev: REV_CUR, canaryRev: '', canaryStatus: '',
    packets: [],
  };

  if (phase === 0) {
    /* ① 세 층만 있다. canary RS 는 아직 없고, 두 subset 해시는 직전 승격이 맞춰 둔 그대로
       hash⟨N⟩ 이다 — 위 default 그대로 둔다 */
  } else if (phase === 1) {
    /* ② 템플릿이 바뀐 바퀴는 새 RS 만 만들고 조기 반환한다(canary.go:22) — 트래픽 리컨실까지
       못 간다. 새 RS 는 replicas=0 으로 태어난다(sync.go:165). 해시는 아직 그대로다 */
    f.canaryExists = true;
    f.canaryRev = REV_NEXT; f.canaryStatus = '생성됨';
  } else if (phase === 2) {
    /* ③ 다음 바퀴에 트래픽 리컨실이 돈다. 가드는 replicas>0 인 RS 만 보므로(istio.go:329) 0대인
       canary RS 를 건너뛰고 해시를 써버린다 — weight 는 아직 0 이라 아무도 그 subset 으로 가지 않는다 */
    f.canaryExists = true;
    f.canaryHash = HASH_NEXT;
    f.canaryRev = REV_NEXT; f.canaryStatus = '해시 써짐';
  } else if (phase === 3) {
    /* ④ canary RS 를 실제로 키우는 코드(canary.go:73)는 트래픽 리컨실보다 뒤에 있다 — desired 가
       이제야 CANARY_DESIRED 로 오른다. Available 이 미달이라 가드가 걸리고 SetWeight 가
       실행되지 않는다(trafficrouting.go:285) */
    f.canaryExists = true; f.canaryDesired = CANARY_DESIRED;
    f.guardOn = true;
    f.canaryHash = HASH_NEXT;
    f.canaryRev = REV_NEXT; f.canaryStatus = '가드 대기';
  } else if (phase === 4) {
    /* ⑤ 목표(2대)를 채워 가드가 풀리고 같은 리컨실에서 VS weight 가 움직인다(95/5) */
    f.canaryExists = true; f.canaryDesired = CANARY_DESIRED; f.canaryAvail = CANARY_DESIRED;
    f.canaryHash = HASH_NEXT;
    f.weightStable = 100 - C.CANARY_STEP_PCT; f.weightCanary = C.CANARY_STEP_PCT;
    f.canaryRev = REV_NEXT; f.canaryStatus = `트래픽 ${C.CANARY_STEP_PCT}%`;
  } else {
    /* ⑥ 승격 — status.stableRS 포인터만 옮겨간다(sync.go:1027), 어떤 RS 도 지워지지 않는다.
       canary 였던 RS 가 곧 stable 이므로 canary 카드는 ①처럼 다시 빈다. 두 subset 해시는
       hash⟨N+1⟩ 로 같아진다 */
    f.canaryGone = true;
    f.canaryHash = HASH_NEXT; f.stableHash = HASH_NEXT;
    f.stableRev = REV_NEXT;
  }

  const canaryCount = Math.round(C.PACKET_N * f.weightCanary / 100);
  for (let j = 0; j < C.PACKET_N; j++) {
    const isCanary = j < canaryCount;
    const cyc = (t * C.LOOPS + j / C.PACKET_N) % 1;
    f.packets.push({ cyc, target: isCanary ? 'canary' : 'stable' });
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
