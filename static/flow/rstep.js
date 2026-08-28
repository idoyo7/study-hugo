/* vm-rstep engine — canary step 이 진행되는 동안 동시에 움직이는 다섯 가지를 한 판에 겹쳐 놓는다.
     ① 스텝 인덱스와 스킵         ② 가중치를 정한 코드 갈래   ③ 트래픽 가중치
     ④ 그 가중치가 요구하는 파드 수 vs 실제 Available   ⑤ AnalysisRun 상태
   flow 로는 안 된다. 선 위를 흐르는 그림이 아니라 같은 판이 단계마다 다시 칠해지는 그림이기 때문이다.

   variant 넷은 같은 기계에 스텝 목록과 "인덱스를 어디서 끝으로 점프시키는가" 만 다르게 넣은 것이다.
     deploy   — 정상 배포. 인덱스를 하나씩 밟고 스텝마다 가용량 게이트가 걸린다
     promote  — kubectl argo rollouts promote --full. 스텝을 건너뛰지만 가중치는 동결된다
     rollback — rollbackWindow 롤백. 같은 자리에서 같이 건너뛰는데 가중치는 역탐색이 정한다
     fixed    — 마지막 setWeight:100 을 지운 뒤의 같은 롤백
   promote 와 rollback 은 스킵도 analysis 취소도 같다. 갈리는 건 가중치 갈래 한 줄이고,
   그 한 줄이 이 도식의 전부다.

   phase-stepped 상태머신(단계당 3.2초, computeFrame 은 (phase,t)의 순수 함수).
   파티클 배열을 들고 있지 않으므로 단계를 넣고 빼는 건 computeFrame 분기 하나를 고치는 일이다.
   정적 호스팅에서 동작. prefers-reduced-motion / IntersectionObserver 존중. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var W = 940, H = 424;
  var PHASE_MS = 3200, PHASE_COUNT = 6;
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 실측 상수 — 2026-08-21 사고 조건(주문 도메인의 프런트 API).
     REPLICAS 는 사고 당시 desired, MIN_PODS 는 base 차트의 canary.minPodsPerReplicaSet 기본값. */
  var REPLICAS = 20, MIN_PODS = 2;
  var RPS = 96;            /* 사고 구간 유입 */
  var POD_CEIL = 29;       /* 2대 처리 천장 — 1코어 미만 CPU limit 에 실행 단위 여럿인 구성에서 유도한 계산값(실측 상한 아님) */

  /* base 차트 기본 steps (platform/charts/base/values.yaml) */
  var STEPS_3 = ['setWeight: 5', 'pause: 10m', 'setWeight: 100'];
  var STEPS_2 = ['setWeight: 5', 'pause: 10m'];

  var GLYPHS = ['①', '②', '③', '④', '⑤', '⑥'];

  function el(tag, a) { var e = document.createElementNS(NS, tag); for (var k in a) e.setAttribute(k, a[k]); return e; }
  function txt(x, y, s, cls, anchor) {
    var t = el('text', { x: x, y: y, class: cls || 'rs-t' });
    if (anchor) t.setAttribute('text-anchor', anchor);
    t.textContent = s; return t;
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function ease(t) { return 1 - Math.pow(1 - t, 3); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function winP(t, s, e) { return clamp01((t - s) / (e - s)); }
  /* 사고 구간의 Ready 2→0→2→0 — readyFailureThreshold 1 로 한 번 넘기면 즉시 빠지고
     복귀에 successThreshold 3 × period 5 가 걸린다 */
  function flap(t) { return Math.sin(t * Math.PI * 3.4) > -0.1 ? 1 : 0; }

  /* ── 레이아웃 ── */
  var RAIL_X = 28, RAIL_Y = 76, RAIL_H = 36, STEP_W = 168, STEP_GAP = 12;
  var ARC_APEX = 46;                                    /* 스킵 호의 꼭대기 */
  var BAR = { x: 28, y: 152, w: 650, h: 28 };
  var CARD_Y = 216, CARD_H = 118, CARD_W = 438, CARD_GAP = 36;
  var POD_R = 6, POD_COLS = 10, POD_DX = 25, POD_X0 = 20, POD_Y0 = 60, POD_DY = 24;
  var PILL_Y = 358;

  function slotX(i) { return RAIL_X + i * (STEP_W + STEP_GAP); }
  function slotMid(i) { return slotX(i) + STEP_W / 2; }
  function cardX(w) { return w === 0 ? 28 : 28 + CARD_W + CARD_GAP; }
  function podX(cx, i) { return cx + POD_X0 + (i % POD_COLS) * POD_DX; }
  function podY(i) { return CARD_Y + POD_Y0 + Math.floor(i / POD_COLS) * POD_DY; }
  function barX(pct) { return BAR.x + BAR.w * clamp01(pct / 100); }

  var VARIANTS = {
    deploy: {
      steps: STEPS_3, badge: '정상 배포',
      still: '정상 배포 — 인덱스를 하나씩 밟습니다. 스텝마다 canary 가 Available 이 될 때까지 가중치가 앞 스텝 값에 묶이므로, 요구 파드 수가 실제 Ready 를 넘어서는 구간이 생기지 않습니다.'
    },
    promote: {
      steps: STEPS_3, badge: 'promote --full',
      still: 'promote --full — 스텝을 전부 건너뛰고 AnalysisRun 도 취소하지만, 가중치는 :229 갈래가 현재 값에 동결합니다. ReplicaSet 만 전량으로 오르고 전환은 20/20 에서 한 번에 일어납니다.'
    },
    rollback: {
      steps: STEPS_3, badge: 'rollbackWindow 롤백',
      still: 'rollbackWindow 롤백 — 스킵과 AnalysisRun 취소는 promote --full 과 같은데, 가중치 동결 갈래가 없어 :245 역탐색으로 떨어집니다. 건너뛴 스텝의 마지막 setWeight:100 을 도로 집어와 Ready 2대에 전량을 싣습니다.'
    },
    fixed: {
      steps: STEPS_2, badge: '마지막 100 제거 후',
      still: '마지막 setWeight:100 을 지운 뒤의 같은 롤백 — 같은 역탐색 코드가 pause 를 지나 setWeight:5 를 집습니다. 요구 파드가 1대라 하한 2대로 충족되고, 대가는 램프 구간 내내 95% 가 되돌리려던 버전으로 가는 것입니다.'
    }
  };

  function makeCfg(variant) {
    var v = VARIANTS[variant] || VARIANTS.deploy;
    var n = v.steps.length;
    var caps;
    if (variant === 'deploy') {
      caps = [
        '① 새 ReplicaSet 이 뜹니다. 첫 스텝이 5% 라 ceil(5%×' + REPLICAS + ')=1 인데 minPodsPerReplicaSet 하한 ' + MIN_PODS + ' 이 걸려 ' + MIN_PODS + '대가 됩니다. Available 이 0 인 동안은 :217 이 가중치를 아예 주지 않습니다',
        '② ' + MIN_PODS + '대가 Ready 되면 index 0 의 setWeight:5 가 발효됩니다. 5% 가 요구하는 파드는 1대뿐이라 하한 ' + MIN_PODS + '대로 충족됩니다. 이때 background AnalysisRun 이 붙습니다',
        '③ index 1 은 pause 입니다. 스텝은 멈춰 있고 AnalysisRun 만 20초마다 측정합니다 — 판정이 실제로 일어나는 구간은 여기입니다',
        '④ index 2 로 넘어가 RS 목표가 ' + REPLICAS + '으로 오릅니다. 아직 도달하지 않았으므로 :245 역탐색이 걸리고, 가중치는 앞 스텝 값 5% 에 묶입니다 — 이 게이트가 정상 배포를 안전하게 만드는 장치입니다',
        '⑤ ' + REPLICAS + '/' + REPLICAS + ' 에 도달하면 게이트가 풀리고 :255 가 index 2 의 setWeight:100 을 씁니다. 요구 ' + REPLICAS + '대와 실제 Ready ' + REPLICAS + '대가 같습니다',
        '⑥ 같은 조건이 승격 게이트도 통과시킵니다 — shouldFullPromote 는 Available == spec.replicas 를 요구합니다. stable 이 되고 구 RS 는 30초 뒤 축소됩니다'
      ];
    } else if (variant === 'promote') {
      caps = [
        '① index 1 의 pause 에서 대기 중입니다. 가중치 5%, canary ' + MIN_PODS + '대, AnalysisRun 은 돌고 있습니다',
        '② promote --full 이 status.promoteFull 을 켭니다. canary.go:390 이 인덱스를 스텝 끝으로 던지고 analysis.go:77 이 실행 중인 AnalysisRun 을 취소합니다 — 여기까지는 rollbackWindow 와 같습니다',
        '③ 갈리는 지점입니다. PromoteFull 은 :229 에 자기 갈래가 있어 가중치를 현재 값 5% 에 동결합니다. RS 목표만 ' + REPLICAS + '으로 오릅니다',
        '④ 램프업 내내 가중치는 5% 입니다. 요구 파드는 1대라 Ready 가 늘 그보다 많습니다 — 미가용 구간이 열리지 않습니다',
        '⑤ ' + REPLICAS + '/' + REPLICAS + ' 도달. 가중치는 여전히 동결이고, 대신 승격 게이트가 성립합니다',
        '⑥ 승격이 되면 stable subset 이 새 리비전을 가리키므로 canary 가중치는 0 으로 돌아갑니다. 전환이 한 번에 일어나는 원자적 형태입니다'
      ];
    } else if (variant === 'rollback') {
      caps = [
        '① 롤백도 컨트롤러에는 새 rollout 입니다. RS 가 하한 ' + MIN_PODS + '대로 뜨고 index 는 0 에서 시작합니다',
        '② isRollbackWithinWindow 가 성립해 인덱스가 스텝 끝으로 점프하고 AnalysisRun 이 취소됩니다 — promote --full 과 같은 코드, 같은 줄입니다',
        '③ 여기서 갈립니다. rollbackWindow 는 :229 에 자기 갈래가 없어 :245 역탐색으로 떨어집니다. index−1 부터 거꾸로 훑어 처음 만나는 setWeight 가 방금 건너뛴 마지막 100 입니다',
        '④ 100% 가 요구하는 파드는 ' + REPLICAS + '대인데 Ready 는 ' + MIN_PODS + '대입니다. ' + MIN_PODS + '대에 ' + RPS + ' rps 가 들어오고 천장은 ' + POD_CEIL + ' rps 라 /ready 가 넘어가 endpoint 가 0 이 됩니다',
        '⑤ ' + REPLICAS + '/' + REPLICAS + ' 에 도달하면 요구와 실제가 맞습니다. 사고는 그 사이 35초 안에 다 일어났습니다',
        '⑥ 승격 게이트는 promote --full 과 같은 조건입니다 — Available == spec.replicas. 롤백 완료 시각 자체는 가중치와 무관합니다'
      ];
    } else {
      caps = [
        '① 여기까지는 rollbackWindow 와 같습니다 — RS 하한 ' + MIN_PODS + '대, index 0',
        '② 인덱스 점프도 AnalysisRun 취소도 같습니다. rollbackWindow 를 그대로 두므로 이 효과는 유지됩니다',
        '③ 역탐색도 같은 코드입니다. 다만 index−1 이 pause 라 SetWeight 가 nil 이고, 한 칸 더 가서 setWeight:5 를 집습니다',
        '④ 5% 가 요구하는 파드는 1대입니다. 하한 ' + MIN_PODS + '대로 충족되니 미가용 구간이 없습니다. 대가는 램프 내내 95% 가 되돌리려던 버전으로 가는 것입니다',
        '⑤ ' + REPLICAS + '/' + REPLICAS + ' 에서 게이트가 풀립니다. index 가 stepCount 와 같으므로 :261 의 MaxTrafficWeight 가 100 을 씁니다',
        '⑥ 같은 리컨실에서 승격까지 갑니다 — 정상 배포의 마지막 두 단계와 같은 모양입니다'
      ];
    }
    return { variant: variant, steps: v.steps, stepCount: n, badge: v.badge, still: v.still, captions: caps };
  }

  function build(container) {
    var cfg = makeCfg(container.getAttribute('data-variant') || 'deploy');
    var STEPS = cfg.steps, N = cfg.stepCount;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'rs-svg', role: 'img', 'aria-label': cfg.still });
    var i;

    /* (phase, t) → 화면 상태 전부. 여기 밖에 상태가 없다. */
    function computeFrame(phase, t) {
      var f = {
        idx: 0, atEnd: false, skipFrom: -1, revHit: -1,
        weight: 0, src: '', srcTone: 'neutral',
        cDesired: MIN_PODS, cAvail: 0, sDesired: REPLICAS, sAvail: REPLICAS,
        analysis: 'none', gate: '', verdict: '', tone: 'neutral', promoted: false
      };
      var V = cfg.variant;

      if (V === 'deploy') {
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
         스킵 시작 위치만 다르고(promote 는 pause 중, 롤백은 0 에서), 갈리는 건 가중치 갈래다. */
      var jumpAt = V === 'promote' ? 1 : 0;
      var lastW = V === 'rollback' ? 100 : 5;
      var revIdx = V === 'rollback' ? N - 1 : 0;

      if (phase === 0) {
        f.idx = jumpAt;
        if (V === 'promote') {
          f.cAvail = MIN_PODS; f.weight = 5; f.analysis = 'running';
          f.src = ':255  GetCurrentSetWeight  →  steps[0] = 5';
          f.srcTone = 'ok';
          f.gate = 'pause 10m 에서 사람이 기다리는 중';
          f.verdict = '요구 1대 ≤ Ready 2대'; f.tone = 'ok';
        } else {
          f.cAvail = 0; f.weight = 0;
          f.src = ':217  newRS.AvailableReplicas == 0  →  가중치 없음';
          f.gate = 'PodTemplateOrStepsChanged → 조기 반환, status 만 갱신';
          f.verdict = 'RS 하한 ' + MIN_PODS + '대 생성';
        }
      } else if (phase === 1) {
        f.idx = jumpAt; f.atEnd = t > 0.3; f.skipFrom = t > 0.3 ? jumpAt : -1;
        f.cAvail = V === 'promote' ? MIN_PODS : 0;
        f.weight = V === 'promote' ? 5 : 0;
        f.analysis = t > 0.55 ? 'cancelled' : 'running';
        f.src = 'canary.go:390  PromoteFull || isRollbackWithinWindow  →  currentStepIndex = ' + N;
        f.srcTone = 'warn';
        f.gate = 'analysis.go:77 이 같은 조건으로 실행분까지 취소';
        f.verdict = '스텝 ' + (N - jumpAt) + '개 스킵 · AnalysisRun 취소'; f.tone = 'warn';
      } else if (phase === 2) {
        f.idx = N - 1; f.atEnd = true; f.skipFrom = jumpAt;
        /* 리컨실 순서 재현 — reconcileTrafficRouting(:57) 이 reconcileCanaryReplicaSets(:75) 보다
           앞이므로, 한 바퀴 안에서 가중치가 먼저 정해지고 RS 목표(cDesired)가 뒤따른다.
           그래서 cDesired 상승(0.55)을 가중치 전환(0.5)보다 늦춘다. promote 는 가중치 값 자체가
           안 바뀌어(5% 동결) 전환이 안 보이지만, 같은 리컨실 순서이므로 임계는 그대로 맞춘다. */
        f.cDesired = t > 0.55 ? REPLICAS : MIN_PODS;
        f.cAvail = V === 'promote' ? MIN_PODS : Math.floor(ease(winP(t, 0.05, 0.35)) * (MIN_PODS + 0.999));
        f.analysis = 'cancelled';
        if (V === 'promote') {
          f.weight = 5;
          f.src = ':229  PromoteFull 자기 갈래  →  현재 가중치 동결';
          f.srcTone = 'ok';
          f.gate = '역탐색(:245)은 !PromoteFull 조건에 걸려 아예 진입하지 않는다';
          f.verdict = '요구 1대 ≤ Ready 2대 — 미가용 구간 없음'; f.tone = 'ok';
        } else {
          f.revHit = t > 0.35 ? revIdx : -1;
          f.weight = t > 0.5 ? lastW : 0;
          f.src = ':245  미도달 → 역탐색  →  ' + (V === 'rollback' ? '마지막 setWeight = 100' : 'pause 를 지나 setWeight = 5');
          f.srcTone = V === 'rollback' ? 'bad' : 'ok';
          f.gate = 'checkReplicasAvailable 은 stable 만 본다 — canary 는 검사되지 않는다';
          /* verdict 는 가중치 바의 '요구'·'Ready' 문구와 같은 두 값(need, cAvail)을 그대로 쓴다 —
             REPLICAS·MIN_PODS 상수를 박아두면 가중치가 아직 안 바뀐 t 구간에서 캡션만 앞서 나간다. */
          var wNeed = Math.ceil(REPLICAS * f.weight / 100);
          var wShort = wNeed - f.cAvail;
          f.verdict = wShort > 0
            ? '요구 ' + wNeed + '대 > Ready ' + f.cAvail + '대 — ' + wShort + '대 부족'
            : '요구 ' + wNeed + '대 ≤ Ready ' + f.cAvail + '대';
          f.tone = wShort > 0 ? 'bad' : 'ok';
        }
      } else if (phase === 3) {
        f.idx = N - 1; f.atEnd = true; f.skipFrom = jumpAt; f.cDesired = REPLICAS;
        f.analysis = 'cancelled'; f.weight = V === 'promote' ? 5 : lastW;
        f.revHit = V === 'promote' ? -1 : revIdx;
        if (V === 'rollback') {
          var base = Math.floor(lerp(MIN_PODS, 9, ease(winP(t, 0.15, 1.0))));
          f.cAvail = flap(t) ? base : 0;
          f.src = ':245  가중치 100% 유지 — 20/20 이 될 때까지';
          f.srcTone = 'bad';
          f.gate = 'endpoint 0 — no healthy upstream';
          f.verdict = MIN_PODS + '대 노출 ' + RPS + ' rps · 천장 ' + POD_CEIL + ' rps';
          f.tone = 'bad';
        } else {
          f.cAvail = Math.floor(lerp(MIN_PODS, 18, ease(winP(t, 0.08, 0.95))));
          f.src = V === 'promote' ? ':229  동결 유지 — RS 만 오른다' : ':245  가중치 5% 유지 — 20/20 까지';
          f.srcTone = 'ok';
          f.gate = 'atDesiredReplicaCount false — 20/20 대기';
          f.verdict = V === 'promote' ? '램프업 · 진동 없음' : '진동 없음 · 95% 는 구 리비전이 처리';
          f.tone = V === 'promote' ? 'ok' : 'warn';
        }
      } else if (phase === 4) {
        f.idx = N - 1; f.atEnd = true; f.skipFrom = jumpAt;
        f.cDesired = REPLICAS; f.cAvail = REPLICAS; f.analysis = 'cancelled';
        if (V === 'promote') {
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
        f.weight = V === 'promote' ? (t > 0.35 ? 0 : 5) : 100;
        f.promoted = t > 0.3;
        f.sDesired = t > 0.45 ? 0 : REPLICAS;
        f.sAvail = t > 0.45 ? REPLICAS - Math.floor(ease(winP(t, 0.45, 0.95)) * REPLICAS) : REPLICAS;
        f.src = 'shouldFullPromote  →  ' + (V === 'promote' ? 'Full promotion requested' : 'Rollback within window');
        f.srcTone = 'ok';
        f.gate = 'promoteStable — stable subset 이 새 해시를 가리킨다';
        f.verdict = '승격 완료'; f.tone = 'ok';
      }
      return f;
    }

    /* ── 정적 요소 ── */
    var steps = el('g', {});
    for (i = 0; i < PHASE_COUNT; i++) steps.appendChild(txt(28 + i * 27, 26, GLYPHS[i], 'rs-step'));
    svg.appendChild(steps);
    svg.appendChild(txt(W - 28, 26, cfg.badge, 'rs-badge', 'end'));
    svg.appendChild(txt(RAIL_X, RAIL_Y - 14, 'canary steps  ·  currentStepIndex 가 가리키는 자리', 'rs-lane'));

    /* 스킵 호 — 인덱스가 끝으로 던져질 때 건너뛴 구간 위로 넘어간다 */
    var skipArc = el('path', { d: 'M0 0', class: 'rs-skip', opacity: 0 });
    svg.appendChild(skipArc);
    var skipTx = txt(0, 0, '', 'rs-skiptext', 'middle'); skipTx.setAttribute('opacity', 0);
    svg.appendChild(skipTx);

    /* 스텝 슬롯 */
    var slots = [], slotTx = [], slotStrike = [], slotMark = [];
    for (i = 0; i < N; i++) {
      var sx = slotX(i);
      var r = el('rect', { x: sx, y: RAIL_Y, width: STEP_W, height: RAIL_H, rx: 8, class: 'rs-slot' });
      svg.appendChild(r); slots.push(r);
      var st = txt(sx + STEP_W / 2, RAIL_Y + 17, STEPS[i], 'rs-slottext', 'middle');
      svg.appendChild(st); slotTx.push(st);
      var si = txt(sx + STEP_W / 2, RAIL_Y + 30, 'index ' + i, 'rs-slotsub', 'middle');
      svg.appendChild(si);
      var ln = el('line', { x1: sx + 12, y1: RAIL_Y + 13, x2: sx + STEP_W - 12, y2: RAIL_Y + 13, class: 'rs-strike', opacity: 0 });
      svg.appendChild(ln); slotStrike.push(ln);
      var mk = txt(sx + STEP_W / 2, RAIL_Y + RAIL_H + 17, '', 'rs-mark', 'middle');
      svg.appendChild(mk); slotMark.push(mk);
    }
    /* index == stepCount 자리 — 스텝이 아니다. currentStep 이 nil 이 되는 상태 */
    var endX = slotX(N);
    var endBox = el('rect', { x: endX, y: RAIL_Y, width: STEP_W, height: RAIL_H, rx: 8, class: 'rs-slot rs-slot-end' });
    svg.appendChild(endBox);
    svg.appendChild(txt(endX + STEP_W / 2, RAIL_Y + 16, 'index = ' + N, 'rs-slottext rs-slottext-end', 'middle'));
    svg.appendChild(txt(endX + STEP_W / 2, RAIL_Y + 29, 'currentStep = nil', 'rs-slotsub', 'middle'));
    var endMark = txt(endX + STEP_W / 2, RAIL_Y + RAIL_H + 17, '', 'rs-mark', 'middle');
    svg.appendChild(endMark);

    /* 역탐색 화살표 — 끝 자리에서 거꾸로, 스킵 호와 반대 방향 */
    var revArrow = el('path', { d: 'M0 0', class: 'rs-rev', opacity: 0 });
    svg.appendChild(revArrow);
    var revTx = txt(0, 0, '', 'rs-revtext', 'middle'); revTx.setAttribute('opacity', 0);
    svg.appendChild(revTx);

    /* 가중치 바 + 가용량 겹치기 */
    svg.appendChild(txt(BAR.x, BAR.y - 30, '트래픽 가중치  ·  그 가중치가 요구하는 파드 수  vs  실제 Available', 'rs-lane'));
    var srcTx = txt(BAR.x, BAR.y - 12, '', 'rs-src');
    svg.appendChild(srcTx);
    svg.appendChild(el('rect', { x: BAR.x, y: BAR.y, width: BAR.w, height: BAR.h, rx: 6, class: 'rs-bartrack' }));
    /* 눈금 — 10% 마다 */
    for (i = 1; i < 10; i++) {
      svg.appendChild(el('line', { x1: barX(i * 10), y1: BAR.y + 4, x2: barX(i * 10), y2: BAR.y + BAR.h - 4, class: 'rs-tick' }));
    }
    /* 실제 확보된 몫 — Available 비율까지 */
    var barHave = el('rect', { x: BAR.x, y: BAR.y, width: 0, height: BAR.h, rx: 6, class: 'rs-bar-have' });
    svg.appendChild(barHave);
    /* 확보되지 않았는데 라우팅된 몫 — 이 빨간 칸이 사고다 */
    var barShort = el('rect', { x: BAR.x, y: BAR.y, width: 0, height: BAR.h, class: 'rs-bar-short', opacity: 0 });
    svg.appendChild(barShort);
    /* 가중치 경계선 */
    var wMark = el('line', { x1: BAR.x, y1: BAR.y - 5, x2: BAR.x, y2: BAR.y + BAR.h + 5, class: 'rs-wmark' });
    svg.appendChild(wMark);
    var wTx = txt(BAR.x, BAR.y + BAR.h + 20, '', 'rs-wtext', 'middle');
    svg.appendChild(wTx);
    var hTx = txt(BAR.x, BAR.y - 6, '', 'rs-htext', 'middle');
    svg.appendChild(hTx);
    var barVal = txt(BAR.x + BAR.w + 16, BAR.y + 19, '', 'rs-barval');
    svg.appendChild(barVal);

    /* ReplicaSet 카드 둘 */
    var cards = [];
    ['canary ReplicaSet — 새로 올리는 리비전', 'stable ReplicaSet — 지금 트래픽을 받는 리비전'].forEach(function (title, wi) {
      var cx = cardX(wi);
      var g = el('g', {});
      var rect = el('rect', { x: cx, y: CARD_Y, width: CARD_W, height: CARD_H, rx: 10, class: wi === 0 ? 'rs-card rs-card-canary' : 'rs-card rs-card-stable' });
      g.appendChild(rect);
      g.appendChild(txt(cx + 14, CARD_Y + 21, title, 'rs-cardtitle'));
      var av = txt(cx + CARD_W - 14, CARD_Y + 22, '', 'rs-avail', 'end'); g.appendChild(av);
      var sub = txt(cx + 14, CARD_Y + 41, '', 'rs-cardsub'); g.appendChild(sub);
      var pods = [];
      for (var k = 0; k < REPLICAS; k++) {
        var c = el('circle', { cx: podX(cx, k), cy: podY(k), r: POD_R, class: 'rs-pod', opacity: 0 });
        g.appendChild(c); pods.push(c);
      }
      svg.appendChild(g);
      cards.push({ g: g, rect: rect, av: av, sub: sub, pods: pods, side: wi });
    });

    /* AnalysisRun · 게이트 · 판정 */
    var arPill = el('rect', { x: 28, y: PILL_Y - 17, width: 318, height: 30, rx: 15, class: 'rs-pill' });
    svg.appendChild(arPill);
    var arTx = txt(44, PILL_Y + 3, '', 'rs-pilltext');
    svg.appendChild(arTx);
    var gateTx = txt(W - 28, PILL_Y - 3, '', 'rs-gate', 'end');
    svg.appendChild(gateTx);
    var verTx = txt(W - 28, PILL_Y + 16, '', 'rs-verdict', 'end');
    svg.appendChild(verTx);

    container.insertBefore(svg, container.firstChild);
    var cap = container.querySelector('.rs-caption');
    var fixedCap = cap && cap.textContent.trim();
    if (cap && !fixedCap) cap.textContent = cfg.still;

    var lastPhase = -1;
    function paintSteps(p) {
      if (lastPhase === p) return;
      lastPhase = p;
      var ns = steps.querySelectorAll('text');
      for (var j = 0; j < ns.length; j++) ns[j].setAttribute('class', j === p ? 'rs-step rs-step-on' : 'rs-step');
      if (cap && !fixedCap) cap.textContent = cfg.captions[p];
    }

    var AR_LABEL = {
      none: 'AnalysisRun  —  아직 없음',
      running: 'AnalysisRun  —  Running · 20s 간격 측정',
      cancelled: 'AnalysisRun  —  스킵 + 실행분 취소',
      ok: 'AnalysisRun  —  Successful'
    };
    var AR_CLASS = { none: 'rs-pill', running: 'rs-pill rs-pill-run', cancelled: 'rs-pill rs-pill-off', ok: 'rs-pill rs-pill-ok' };

    function paint(f) {
      var j;

      /* 스텝 슬롯 · 스킵 표시 */
      for (j = 0; j < N; j++) {
        var cur = !f.atEnd && j === f.idx;
        var hit = f.revHit === j;
        var skipped = f.skipFrom >= 0 && j >= f.skipFrom;
        var done = !skipped && j < f.idx;
        slots[j].setAttribute('class', 'rs-slot'
          + (cur ? ' rs-slot-on' : '')
          + (hit ? ' rs-slot-hit' : '')
          + (skipped && !hit ? ' rs-slot-skipped' : '')
          + (done ? ' rs-slot-done' : ''));
        slotTx[j].setAttribute('class', 'rs-slottext' + (cur || hit ? ' rs-slottext-on' : '') + (skipped && !hit ? ' rs-slottext-skipped' : ''));
        slotStrike[j].setAttribute('opacity', skipped && !hit ? 1 : 0);
        slotMark[j].textContent = cur ? '▲ 여기' : (hit ? '▲ 역탐색이 집은 값' : '');
        slotMark[j].setAttribute('class', 'rs-mark' + (hit ? ' rs-mark-hit' : ''));
      }
      endBox.setAttribute('class', 'rs-slot rs-slot-end' + (f.atEnd ? ' rs-slot-on' : ''));
      endMark.textContent = f.atEnd ? '▲ 여기 — 스텝이 아니다' : '';

      /* 스킵 호 — 건너뛴 구간 위로 */
      if (f.skipFrom >= 0) {
        var a0 = slotMid(f.skipFrom), a1 = slotMid(N);
        var amid = (a0 + a1) / 2;
        skipArc.setAttribute('d', 'M' + a0 + ' ' + (RAIL_Y - 4)
          + ' C' + a0 + ' ' + ARC_APEX + ' ' + a1 + ' ' + ARC_APEX + ' ' + a1 + ' ' + (RAIL_Y - 4)
          + ' M' + (a1 - 6) + ' ' + (RAIL_Y - 13) + ' L' + a1 + ' ' + (RAIL_Y - 4) + ' L' + (a1 + 6) + ' ' + (RAIL_Y - 13));
        skipArc.setAttribute('opacity', 1);
        skipTx.setAttribute('x', amid); skipTx.setAttribute('y', ARC_APEX + 4);
        skipTx.textContent = '스텝 ' + (N - f.skipFrom) + '개를 건너뛴다  ·  canary.go:390';
        skipTx.setAttribute('opacity', 1);
      } else {
        skipArc.setAttribute('d', 'M' + slotMid(0) + ' ' + (RAIL_Y - 4) + ' L' + slotMid(0) + ' ' + (RAIL_Y - 4));
        skipArc.setAttribute('opacity', 0);
        skipTx.setAttribute('x', slotMid(0)); skipTx.setAttribute('y', ARC_APEX + 4);
        skipTx.setAttribute('opacity', 0);
      }

      /* 역탐색 화살표 — 아래쪽, 반대 방향 */
      var ry = RAIL_Y + RAIL_H + 30;
      if (f.revHit >= 0) {
        var r0 = slotMid(N), r1 = slotMid(f.revHit);
        revArrow.setAttribute('d', 'M' + r0 + ' ' + ry + ' L' + r1 + ' ' + ry
          + ' M' + (r1 + 9) + ' ' + (ry - 5) + ' L' + r1 + ' ' + ry + ' L' + (r1 + 9) + ' ' + (ry + 5));
        revArrow.setAttribute('opacity', 1);
        revTx.setAttribute('x', (r0 + r1) / 2); revTx.setAttribute('y', ry - 8);
        revTx.textContent = 'for i := *index − 1; i >= 0; i−−   처음 만나는 setWeight 를 쓴다  ·  trafficrouting.go:245';
        revTx.setAttribute('opacity', 1);
      } else {
        revArrow.setAttribute('d', 'M' + slotMid(N) + ' ' + ry + ' L' + slotMid(N) + ' ' + ry);
        revArrow.setAttribute('opacity', 0);
        revTx.setAttribute('x', slotMid(N)); revTx.setAttribute('y', ry - 8);
        revTx.setAttribute('opacity', 0);
      }

      /* 가중치 바 — 확보된 몫과 확보되지 않은 몫을 겹쳐 그린다 */
      var havePct = (f.cAvail / REPLICAS) * 100;
      var shownHave = Math.min(f.weight, havePct);
      barHave.setAttribute('width', Math.max(0, barX(shownHave) - BAR.x));
      var shortStart = barX(shownHave), shortEnd = barX(f.weight);
      var shortW = Math.max(0, shortEnd - shortStart);
      barShort.setAttribute('x', shortStart);
      barShort.setAttribute('width', shortW);
      barShort.setAttribute('opacity', shortW > 1 ? 1 : 0);
      wMark.setAttribute('x1', barX(f.weight)); wMark.setAttribute('x2', barX(f.weight));
      wTx.setAttribute('x', Math.min(Math.max(barX(f.weight), BAR.x + 46), BAR.x + BAR.w - 46));
      var need = Math.ceil(REPLICAS * f.weight / 100);
      wTx.textContent = f.weight > 0 ? 'canary ' + f.weight + '%  ·  요구 ' + need + '대' : 'canary 0%';
      wTx.setAttribute('class', 'rs-wtext' + (f.tone === 'bad' ? ' rs-wtext-bad' : ''));
      hTx.setAttribute('x', Math.min(Math.max(barX(shownHave), BAR.x + 40), BAR.x + BAR.w - 40));
      hTx.textContent = 'Ready ' + f.cAvail + '대';
      barVal.textContent = shortW > 1 ? (need - f.cAvail) + '대 부족' : '충족';
      barVal.setAttribute('class', 'rs-barval' + (shortW > 1 ? ' rs-barval-bad' : ' rs-barval-ok'));

      /* 결정 출처 */
      srcTx.textContent = f.src;
      srcTx.setAttribute('class', 'rs-src rs-src-' + f.srcTone);

      /* ReplicaSet 카드 */
      cards.forEach(function (c) {
        var desired = c.side === 0 ? f.cDesired : f.sDesired;
        var avail = c.side === 0 ? f.cAvail : f.sAvail;
        var needHere = Math.ceil(REPLICAS * (c.side === 0 ? f.weight : 100 - f.weight) / 100);
        var short = c.side === 0 && f.weight > 0 && avail < needHere;
        c.rect.setAttribute('class', 'rs-card ' + (c.side === 0 ? 'rs-card-canary' : 'rs-card-stable')
          + (short ? ' rs-card-short' : '') + (desired === 0 ? ' rs-card-gone' : ''));
        c.av.textContent = 'Available ' + avail + '  /  desired ' + desired;
        c.av.setAttribute('class', 'rs-avail' + (short ? ' rs-avail-bad' : ''));
        c.sub.textContent = c.side === 0
          ? (f.weight > 0 ? '이 가중치가 요구하는 파드 ' + needHere + '대' + (short ? ' — ' + (needHere - avail) + '대 부족' : ' — 충족') : '가중치가 없어 요구 파드 0대')
          : (f.promoted ? '승격 후 축소 — scaleDownDelay 30s' : '전량 유지 · dynamicStableScale false');
        for (var k = 0; k < REPLICAS; k++) {
          var live = k < avail, planned = k < desired;
          c.pods[k].setAttribute('opacity', live ? 1 : (planned ? 0.3 : 0));
          c.pods[k].setAttribute('class', 'rs-pod'
            + (c.side === 0 ? ' rs-pod-canary' : ' rs-pod-stable')
            + (!live && planned ? ' rs-pod-pending' : ''));
        }
      });

      arPill.setAttribute('class', AR_CLASS[f.analysis] || 'rs-pill');
      arTx.textContent = AR_LABEL[f.analysis] || '';
      arTx.setAttribute('class', 'rs-pilltext' + (f.analysis === 'cancelled' ? ' rs-pilltext-off' : ''));
      gateTx.textContent = f.gate;
      verTx.textContent = f.verdict;
      verTx.setAttribute('class', 'rs-verdict rs-verdict-' + f.tone);
    }

    function done() { paintSteps(PHASE_COUNT - 1); paint(computeFrame(PHASE_COUNT - 1, 1)); if (cap && !fixedCap) cap.textContent = cfg.still; }

    if (REDUCE) { done(); return; }
    var rafId = 0, running = false, t0 = -1;
    function frame(ts) {
      /* 0 은 유효한 타임스탬프다 — falsy 검사로는 첫 프레임이 0 일 때 영영 안 걸린다 */
      if (t0 < 0) t0 = ts;
      var total = (ts - t0) % (PHASE_MS * PHASE_COUNT);
      var p = Math.floor(total / PHASE_MS);
      paintSteps(p);
      paint(computeFrame(p, (total % PHASE_MS) / PHASE_MS));
      rafId = requestAnimationFrame(frame);
    }
    function start() { if (running) return; running = true; rafId = requestAnimationFrame(frame); }
    function halt() { running = false; cancelAnimationFrame(rafId); }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) { e.isIntersecting ? start() : halt(); });
      }, { threshold: 0.25 }).observe(container);
    } else start();
  }

  function init() { var l = document.querySelectorAll('.vm-rstep'); for (var i = 0; i < l.length; i++) build(l[i]); }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
