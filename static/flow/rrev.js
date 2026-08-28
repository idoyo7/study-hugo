/* vm-rrev engine — "리비전이 바뀌면 트래픽은 어떻게 따라가는가"를 시간축으로 보이는 그림.
   정지 그림(구 _flow 스펙)이 못 보여주는 것은 해시가 언제 써지는가라는 순서다. 그게 이 도식의
   존재 이유다. 화면에 늘 있는 층 셋 — 파드 층(파랑) · 트래픽 층(주황) · 판정 층(청록, 정지) —
   위에서 트래픽 패킷이 Service 카드를 떠나 VirtualService 가 정한 비율대로 subset 을 거쳐
   갈린다. variant 는 handoff 하나뿐이지만, 서명은 이식 모듈(nextra-port/rollouts/rrev-frames.mjs)과
   패리티를 맞추기 위해 computeFrame(variant, phase, t) 로 둔다.

   phase-stepped 상태머신(단계당 3000ms, 6단계). ①세 층 등장, 두 subset 은 이미 hash⟨N⟩ 로 같다 →
   ②템플릿이 바뀐 바퀴라 canary RS 만 생기고 조기 반환(replicas=0, 트래픽 리컨실은 못 돈다) →
   ③다음 바퀴에 트래픽 리컨실 — 가드는 replicas>0 인 RS 만 보므로 0대인 canary RS 를 건너뛰고 해시를
   먼저 써버린다 → ④canary desired 가 2 로 오르는데(ceil(20×5%)=1 에 하한 2) Available 이 미달이라
   가드가 걸린다(UpdateHash 진입부, 업스트림 #2507) → ⑤가드 해제, VirtualService weight 이동(95/5) →
   ⑥승격, weight 는 원점(100/0)인데 stable 포인터가 옮겨간다 — 어떤 RS 도 지워지지 않는다.

   근거: rollout/trafficrouting/istio/istio.go 의 UpdateHash() 진입부 가드(replicas>0 인 RS 만 검사),
   rollout/canary.go 의 PodTemplateOrStepsChanged 조기 반환과 reconcileCanaryReplicaSets 순서,
   rollouts-pod-template-hash(DefaultRolloutUniqueLabelKey). REPLICAS=20 은 static/flow/rstep.js 의
   같은 상수를 그대로 쓴다(문서 전체에서 예시 수치를 통일). 리비전은 rev N / rev N+1, 해시는
   hash⟨N⟩ / hash⟨N+1⟩ 심볼로만 표기한다 — 실제 값을 발명하지 않는다.
   정적 호스팅에서 동작. prefers-reduced-motion / IntersectionObserver 존중. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var W = 920, H = 460;
  var PHASE_MS = 3000, PHASE_COUNT = 6;
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── 실측 상수 ── REPLICAS 는 rstep.js 와 같은 값(문서 예시 수치 통일).
     CANARY_STEP_PCT 는 base 차트 기본 첫 스텝(setWeight: 5). MIN_PODS_PER_RS 는 base 차트의
     canary.minPodsPerReplicaSet 기본값 — rstep.js 의 MIN_PODS 와 같은 값이다. CANARY_DESIRED 는
     그 둘의 유도값이다: ceil(20×5/100)=1 인데 하한 2 에 걸려 2 가 된다. */
  var REPLICAS = 20;
  var CANARY_STEP_PCT = 5;
  var MIN_PODS_PER_RS = 2;
  var CANARY_DESIRED = Math.max(Math.ceil(REPLICAS * CANARY_STEP_PCT / 100), MIN_PODS_PER_RS);
  var REV_CUR = 'N', REV_NEXT = 'N+1';
  var HASH_CUR = 'hash⟨N⟩', HASH_NEXT = 'hash⟨N+1⟩'; /* hash⟨N⟩ / hash⟨N+1⟩ */
  var PACKET_N = 20;     /* 패킷 개수 — REPLICAS 와 같은 값을 써서 %를 깨끗하게 맞춘다 */
  var LOOPS = 4;         /* 한 단계(t: 0→1) 동안 패킷이 도는 바퀴 수 */

  var GLYPHS = ['①', '②', '③', '④', '⑤', '⑥'];

  function el(tag, a) { var e = document.createElementNS(NS, tag); for (var k in a) e.setAttribute(k, a[k]); return e; }
  function txt(x, y, s, cls, anchor) {
    var t = el('text', { x: x, y: y, class: cls || 'rr-t' });
    if (anchor) t.setAttribute('text-anchor', anchor);
    t.textContent = s; return t;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ── 레이아웃 ── 세 층을 위에서부터: 트래픽(패킷 출발) → 파드(패킷 도착) → 판정(정지, 맨 아래).
     margin·gap 26/20 은 다른 엔진과 같은 여백 감각. */
  var MARGIN = 26, GAP = 20, CARD_H = 118;
  var HEAD_Y = 24;
  var GUARD_Y = 32, GUARD_H = 20;

  var TRAF_BAND_Y = 58, TRAF_BAND_H = 162;
  var TRAF_LABEL_Y = TRAF_BAND_Y + 18;
  var TRAF_CARD_Y = TRAF_BAND_Y + 30; /* 88 */

  var SVC_W = 220, DR_W = 280, VS_W = 328;
  var SVC_X = MARGIN;                    /* 26 */
  var DR_X = SVC_X + SVC_W + GAP;        /* 266 */
  var VS_X = DR_X + DR_W + GAP;          /* 566 — VS_X+VS_W = 894 = W-MARGIN */

  var POD_BAND_Y = TRAF_BAND_Y + TRAF_BAND_H + 14; /* 234 */
  var POD_BAND_H = 162;
  var POD_LABEL_Y = POD_BAND_Y + 18;
  var POD_CARD_Y = POD_BAND_Y + 30; /* 264 */

  var RO_W = 276, SRS_W = 276, CRS_W = 276;
  var RO_X = MARGIN;                     /* 26 */
  var SRS_X = RO_X + RO_W + GAP;         /* 322 */
  var CRS_X = SRS_X + SRS_W + GAP;       /* 618 — CRS_X+CRS_W = 894 = W-MARGIN */

  var JUDGE_Y = POD_BAND_Y + POD_BAND_H + 14; /* 410 */
  var JUDGE_H = 36;

  /* 패킷 경로 — Service 카드 바닥에서 파드 층 카드 꼭대기까지, weight 비율대로 두 x 중 하나로 */
  var SVC_CX = SVC_X + SVC_W / 2;                 /* 136 */
  var SVC_BOTTOM_Y = TRAF_CARD_Y + CARD_H;         /* 206 */
  var STABLE_TX = SRS_X + SRS_W / 2;               /* 460 */
  var CANARY_TX = CRS_X + CRS_W / 2;               /* 756 */
  var POD_TOP_Y = POD_CARD_Y;                      /* 264 */

  /* 파드 점 그리드 — stable RS 20개 (2행×10열) */
  var POD_R = 5, POD_COLS = 10, POD_DX = 22, POD_X0 = 14, POD_Y0 = 40, POD_DY = 16;
  function podX(cardX, i) { return cardX + POD_X0 + (i % POD_COLS) * POD_DX; }
  function podY(cardY, i) { return cardY + POD_Y0 + Math.floor(i / POD_COLS) * POD_DY; }

  var CHIP_W = 92, CHIP_H = 18;

  var VARIANTS = {
    handoff: {
      badge: 'rev ' + REV_CUR + ' → rev ' + REV_NEXT,
      captions: [
        '① 파드 층은 Deployment 와 같다. 트래픽 층과 판정 층이 새로 생긴다. Service 는 하나뿐이고 그 selector 는 canary·stable 파드를 함께 잡는다 — 쪼개는 일은 DestinationRule subset 에서만 일어난다. 직전 승격이 두 subset 의 해시를 같게 맞춰 둔 상태다',
        '② 새 리비전이 오면 canary RS 가 생긴다. 하지만 템플릿이 바뀐 바퀴는 그 RS 만 만들고 곧바로 되돌아간다 — 트래픽 리컨실까지 가지 못한다. 그래서 새 RS 는 처음부터 0대로 태어난다',
        '③ 다음 바퀴에야 트래픽 리컨실이 돈다. 가드는 replicas 가 0 보다 큰 RS 만 살피므로 아직 0대인 canary RS 는 건너뛰고 해시를 subset 에 써버린다. subset 은 갈라졌지만 weight 가 0 이라 아무도 그쪽으로 가지 않는다 — 가드가 막아선 것은 해시 쓰기가 아니다',
        '④ canary RS 를 실제로 키우는 코드는 트래픽 리컨실보다 뒤에 있다. desired 가 2대로 오르는 것은 그다음 바퀴이고, 20대의 5% 를 올림한 1대가 아니라 하한 2대다. 이제 Available 이 목표에 못 미치니 가드가 걸리고, 그 자리에서 트래픽 리컨실이 끊겨 weight 가 움직이지 못한다',
        '⑤ 2대가 모두 준비되자 가드가 풀리고 같은 리컨실에서 weight 가 움직인다. 쪼개는 곳(subset 라벨)과 비율을 정하는 곳(VirtualService weight)이 서로 다른 층이다 — 순서가 거꾸로 될 수 없는 이유다',
        '⑥ 승격은 stable 포인터가 새 리비전으로 옮겨가는 일이다 — 어떤 RS 도 이 순간에 지워지지 않는다. 해시가 다시 써지고 weight 는 100/0 으로 돌아온다. 가중치는 원점인데 가리키는 리비전이 바뀌었다. 옛 RS 는 잠시 뒤 파드 수부터 줄고, 오브젝트 삭제는 훨씬 나중 정리 시점에 따로 일어난다'
      ],
      still: '리비전 핸드오프 — Service 는 하나지만 라우팅은 두 곳에서 갈립니다. 컨트롤러가 써넣는 해시가 DestinationRule subset 을 가르고, 그다음에야 VirtualService weight 가 트래픽 비율을 정합니다. 해시가 먼저 써지고 weight 는 그다음에야 움직입니다 — 순서가 바뀌면 두 subset 이 여전히 존재하면서도 selector 가 같아 트래픽이 갈리지 않고 뒤섞일 수 있기 때문입니다.'
    }
  };

  function makeCfg(variant) {
    var v = VARIANTS[variant] || VARIANTS.handoff;
    return { variant: (VARIANTS[variant] ? variant : 'handoff'), badge: v.badge, captions: v.captions, still: v.still };
  }

  function build(container) {
    var cfg = makeCfg(container.getAttribute('data-variant') || 'handoff');
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'rr-svg', role: 'img', 'aria-label': cfg.still });
    var i;

    /* (variant, phase, t) → 화면 상태 전부. variant 는 지금 handoff 하나뿐이라 분기하지 않지만,
       이식 모듈(rrev-frames.mjs)과 서명을 맞추려고 인자로 받는다. */
    function computeFrame(variant, phase, t) {
      var f = {
        canaryExists: false, canaryGone: false,
        canaryAvail: 0, canaryDesired: 0,
        stableAvail: REPLICAS, stableDesired: REPLICAS,
        canaryHash: HASH_CUR, stableHash: HASH_CUR,
        weightStable: 100, weightCanary: 0,
        guardOn: false,
        stableRev: REV_CUR, canaryRev: '', canaryStatus: '',
        packets: []
      };

      if (phase === 0) {
        /* ① 파드/트래픽/판정 세 층만 있다. canary RS 는 아직 없고, 두 subset 해시는 직전 승격이
           맞춰 둔 그대로 hash⟨N⟩ 이다 — 위 default 그대로 둔다 */
      } else if (phase === 1) {
        /* ② 템플릿이 바뀐 바퀴는 새 RS 만 만들고 조기 반환한다(canary.go:22) — 트래픽 리컨실까지
           못 간다. 새 RS 는 replicas=0 으로 태어난다(sync.go:165). 해시는 아직 그대로다 */
        f.canaryExists = true;
        f.canaryRev = REV_NEXT; f.canaryStatus = '생성됨';
      } else if (phase === 2) {
        /* ③ 다음 바퀴에 트래픽 리컨실이 돈다. 가드는 replicas>0 인 RS 만 보므로(istio.go:329)
           0대인 canary RS 를 건너뛰고 해시를 써버린다 — weight 는 아직 0 이라 아무도 그 subset 으로
           가지 않는다 */
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
        f.weightStable = 100 - CANARY_STEP_PCT; f.weightCanary = CANARY_STEP_PCT;
        f.canaryRev = REV_NEXT; f.canaryStatus = '트래픽 ' + CANARY_STEP_PCT + '%';
      } else {
        /* ⑥ 승격 — status.stableRS 포인터만 옮겨간다(sync.go:1027), 어떤 RS 도 지워지지 않는다.
           canary 였던 RS 가 곧 stable 이므로 canary 카드는 ①처럼 다시 빈다. 두 subset 해시는
           hash⟨N+1⟩ 로 같아진다 */
        f.canaryGone = true;
        f.canaryHash = HASH_NEXT; f.stableHash = HASH_NEXT;
        f.stableRev = REV_NEXT;
      }

      var canaryCount = Math.round(PACKET_N * f.weightCanary / 100);
      for (var j = 0; j < PACKET_N; j++) {
        var isCanary = j < canaryCount;
        var cyc = (t * LOOPS + j / PACKET_N) % 1;
        f.packets.push({
          cx: lerp(SVC_CX, isCanary ? CANARY_TX : STABLE_TX, cyc),
          cy: lerp(SVC_BOTTOM_Y, POD_TOP_Y, cyc),
          target: isCanary ? 'canary' : 'stable'
        });
      }
      return f;
    }

    /* ── 정적 구조 ── */
    var steps = el('g', {});
    for (i = 0; i < PHASE_COUNT; i++) steps.appendChild(txt(26 + i * 26, HEAD_Y, GLYPHS[i], 'rr-step'));
    svg.appendChild(steps);
    svg.appendChild(txt(W - 26, HEAD_Y, cfg.badge, 'rr-badge', 'end'));

    var guardRect = el('rect', { x: MARGIN, y: GUARD_Y, width: W - MARGIN * 2, height: GUARD_H, rx: 8, class: 'rr-guard', opacity: 0 });
    svg.appendChild(guardRect);
    var guardTx = txt(MARGIN + 12, GUARD_Y + GUARD_H / 2 + 4, '', 'rr-guardtext');
    svg.appendChild(guardTx);

    /* 트래픽 층 (주황) */
    svg.appendChild(el('rect', { x: MARGIN, y: TRAF_BAND_Y, width: W - MARGIN * 2, height: TRAF_BAND_H, rx: 12, class: 'rr-band rr-band-traffic' }));
    svg.appendChild(txt(MARGIN + 14, TRAF_LABEL_Y, '트래픽 층 · Service 하나 · DestinationRule subset · VirtualService weight', 'rr-lane rr-lane-traffic'));

    /* Service 카드 */
    svg.appendChild(el('rect', { x: SVC_X, y: TRAF_CARD_Y, width: SVC_W, height: CARD_H, rx: 10, class: 'rr-card rr-card-service' }));
    svg.appendChild(txt(SVC_X + 14, TRAF_CARD_Y + 18, 'Service', 'rr-title'));
    svg.appendChild(txt(SVC_X + SVC_W - 14, TRAF_CARD_Y + 18, '1개뿐', 'rr-badgesmall', 'end'));
    svg.appendChild(txt(SVC_X + 14, TRAF_CARD_Y + 42, 'selector', 'rr-sub'));
    svg.appendChild(txt(SVC_X + 14, TRAF_CARD_Y + 58, 'app.kubernetes.io/name', 'rr-mono'));
    svg.appendChild(txt(SVC_X + 14, TRAF_CARD_Y + 74, 'app.kubernetes.io/instance', 'rr-mono'));
    svg.appendChild(txt(SVC_X + 14, TRAF_CARD_Y + 98, 'canary + stable 함께 선택', 'rr-note rr-note-traffic'));

    /* DestinationRule 카드 */
    svg.appendChild(el('rect', { x: DR_X, y: TRAF_CARD_Y, width: DR_W, height: CARD_H, rx: 10, class: 'rr-card rr-card-dr' }));
    svg.appendChild(txt(DR_X + 14, TRAF_CARD_Y + 18, 'DestinationRule', 'rr-title'));
    svg.appendChild(txt(DR_X + 14, TRAF_CARD_Y + 46, 'subset: canary', 'rr-sub'));
    svg.appendChild(txt(DR_X + 14, TRAF_CARD_Y + 72, 'subset: stable', 'rr-sub'));
    var chipCanary = el('rect', { x: DR_X + DR_W - 14 - CHIP_W, y: TRAF_CARD_Y + 46 - 13, width: CHIP_W, height: CHIP_H, rx: 9, class: 'rr-chip rr-chip-canary' });
    svg.appendChild(chipCanary);
    var chipCanaryTx = txt(DR_X + DR_W - 14 - CHIP_W / 2, TRAF_CARD_Y + 46, '', 'rr-chiptext', 'middle');
    svg.appendChild(chipCanaryTx);
    var chipStable = el('rect', { x: DR_X + DR_W - 14 - CHIP_W, y: TRAF_CARD_Y + 72 - 13, width: CHIP_W, height: CHIP_H, rx: 9, class: 'rr-chip rr-chip-stable' });
    svg.appendChild(chipStable);
    var chipStableTx = txt(DR_X + DR_W - 14 - CHIP_W / 2, TRAF_CARD_Y + 72, '', 'rr-chiptext', 'middle');
    svg.appendChild(chipStableTx);
    svg.appendChild(txt(DR_X + 14, TRAF_CARD_Y + 98, 'rollouts-pod-template-hash ← 컨트롤러가 씀', 'rr-note'));

    /* VirtualService 카드 */
    svg.appendChild(el('rect', { x: VS_X, y: TRAF_CARD_Y, width: VS_W, height: CARD_H, rx: 10, class: 'rr-card rr-card-vs' }));
    svg.appendChild(txt(VS_X + 14, TRAF_CARD_Y + 18, 'VirtualService', 'rr-title'));
    var barX = VS_X + 14, barY = TRAF_CARD_Y + 40, barW = VS_W - 28, barH = 18;
    svg.appendChild(el('rect', { x: barX, y: barY, width: barW, height: barH, rx: 6, class: 'rr-bar-track' }));
    var barStable = el('rect', { x: barX, y: barY, width: barW, height: barH, rx: 6, class: 'rr-bar-stable' });
    svg.appendChild(barStable);
    var barCanary = el('rect', { x: barX, y: barY, width: 0, height: barH, class: 'rr-bar-canary' });
    svg.appendChild(barCanary);
    var barTx = txt(barX, barY + barH + 18, '', 'rr-vstext');
    svg.appendChild(barTx);
    svg.appendChild(txt(VS_X + 14, TRAF_CARD_Y + 98, 'route weight — 이 값만 트래픽 비율을 정한다', 'rr-note'));

    /* 파드 층 (파랑) */
    svg.appendChild(el('rect', { x: MARGIN, y: POD_BAND_Y, width: W - MARGIN * 2, height: POD_BAND_H, rx: 12, class: 'rr-band rr-band-pod' }));
    svg.appendChild(txt(MARGIN + 14, POD_LABEL_Y, '파드 층 · Rollout · stable RS · canary RS', 'rr-lane rr-lane-pod'));

    /* Rollout 카드 */
    svg.appendChild(el('rect', { x: RO_X, y: POD_CARD_Y, width: RO_W, height: CARD_H, rx: 10, class: 'rr-card rr-card-rollout' }));
    svg.appendChild(txt(RO_X + 14, POD_CARD_Y + 18, 'Rollout', 'rr-title'));
    var roLine1 = txt(RO_X + 14, POD_CARD_Y + 46, '', 'rr-mono');
    svg.appendChild(roLine1);
    var roLine2 = txt(RO_X + 14, POD_CARD_Y + 70, '', 'rr-mono');
    svg.appendChild(roLine2);
    svg.appendChild(txt(RO_X + 14, POD_CARD_Y + 98, 'strategy.canary — 포인터 이동 = 승격', 'rr-note'));

    /* stable RS 카드 */
    var srsRect = el('rect', { x: SRS_X, y: POD_CARD_Y, width: SRS_W, height: CARD_H, rx: 10, class: 'rr-card rr-card-stable' });
    svg.appendChild(srsRect);
    svg.appendChild(txt(SRS_X + 14, POD_CARD_Y + 18, 'stable RS', 'rr-title'));
    var srsAvailTx = txt(SRS_X + SRS_W - 14, POD_CARD_Y + 18, '', 'rr-avail rr-avail-stable', 'end');
    svg.appendChild(srsAvailTx);
    var srsPods = [];
    for (i = 0; i < REPLICAS; i++) {
      var sp = el('circle', { cx: podX(SRS_X, i), cy: podY(POD_CARD_Y, i), r: POD_R, class: 'rr-pod rr-pod-stable' });
      svg.appendChild(sp); srsPods.push(sp);
    }
    var srsRevTx = txt(SRS_X + 14, POD_CARD_Y + CARD_H - 10, '', 'rr-note');
    svg.appendChild(srsRevTx);

    /* canary RS 카드 */
    var crsRect = el('rect', { x: CRS_X, y: POD_CARD_Y, width: CRS_W, height: CARD_H, rx: 10, class: 'rr-card rr-card-canary' });
    svg.appendChild(crsRect);
    svg.appendChild(txt(CRS_X + 14, POD_CARD_Y + 18, 'canary RS', 'rr-title'));
    var crsAvailTx = txt(CRS_X + CRS_W - 14, POD_CARD_Y + 18, '', 'rr-avail rr-avail-canary', 'end');
    svg.appendChild(crsAvailTx);
    var crsPod = el('circle', { cx: CRS_X + CRS_W / 2, cy: POD_CARD_Y + 62, r: 10, class: 'rr-pod rr-pod-canary', opacity: 0 });
    svg.appendChild(crsPod);
    var crsGhostTx = txt(CRS_X + CRS_W / 2, POD_CARD_Y + 62, '', 'rr-ghosttext', 'middle');
    svg.appendChild(crsGhostTx);
    var crsRevTx = txt(CRS_X + 14, POD_CARD_Y + CARD_H - 10, '', 'rr-note');
    svg.appendChild(crsRevTx);

    /* 판정 층 (청록) — 정지, 라벨만 */
    svg.appendChild(el('rect', { x: MARGIN, y: JUDGE_Y, width: W - MARGIN * 2, height: JUDGE_H, rx: 10, class: 'rr-band rr-band-judge' }));
    svg.appendChild(txt(W / 2, JUDGE_Y + JUDGE_H / 2 + 4, '판정 층 · AnalysisTemplate → AnalysisRun → Prometheus', 'rr-judgetext', 'middle'));

    /* 트래픽 패킷 — Service 카드 바닥에서 파드 층까지, weight 비율대로 stable/canary 로 갈린다 */
    var packets = [];
    for (i = 0; i < PACKET_N; i++) {
      var pk = el('circle', { cx: SVC_CX, cy: SVC_BOTTOM_Y, r: 3.4, class: 'rr-pkt rr-pkt-stable' });
      svg.appendChild(pk); packets.push(pk);
    }

    container.insertBefore(svg, container.firstChild);
    var cap = container.querySelector('.rr-caption');
    var fixed = cap && cap.textContent.trim();
    if (cap && !fixed) cap.textContent = cfg.still;

    var lastPhase = -1;
    function paintSteps(p) {
      if (lastPhase === p) return;
      lastPhase = p;
      var ns = steps.querySelectorAll('text');
      for (var j = 0; j < ns.length; j++) ns[j].setAttribute('class', j === p ? 'rr-step rr-step-on' : 'rr-step');
      if (cap && !fixed) cap.textContent = cfg.captions[p];
    }

    function paint(f) {
      var j;

      guardRect.setAttribute('opacity', f.guardOn ? 1 : 0);
      guardTx.setAttribute('opacity', f.guardOn ? 1 : 0);
      guardTx.textContent = f.guardOn
        ? '⛔ 가드 걸림 — replicas>0 인 모든 ReplicaSet 이 Available 일 때까지 destination rule 전환을 미룬다 · UpdateHash() · 업스트림 #2507'
        : '';

      chipCanary.setAttribute('class', 'rr-chip rr-chip-canary' + (f.canaryHash ? ' rr-chip-filled' : ''));
      chipCanaryTx.textContent = f.canaryHash;
      chipStable.setAttribute('class', 'rr-chip rr-chip-stable' + (f.stableHash ? ' rr-chip-filled' : ''));
      chipStableTx.textContent = f.stableHash;

      var stableW = barW * f.weightStable / 100;
      var canaryW = barW * f.weightCanary / 100;
      barStable.setAttribute('width', Math.max(0, stableW));
      barCanary.setAttribute('x', barX + stableW);
      barCanary.setAttribute('width', Math.max(0, canaryW));
      barTx.textContent = 'stable ' + f.weightStable + '%  /  canary ' + f.weightCanary + '%';

      roLine1.textContent = 'stable → rev ' + f.stableRev + (f.canaryGone ? ' (승격됨)' : '');
      roLine2.textContent = f.canaryRev ? ('canary → rev ' + f.canaryRev) : 'canary → —';

      srsAvailTx.textContent = 'Available ' + f.stableAvail + '  /  desired ' + f.stableDesired;
      for (j = 0; j < REPLICAS; j++) srsPods[j].setAttribute('opacity', j < f.stableAvail ? 1 : 0.3);
      srsRevTx.textContent = 'revision: rev ' + f.stableRev;

      var crsShow = f.canaryExists;
      crsRect.setAttribute('class', 'rr-card rr-card-canary' + (crsShow ? '' : ' rr-card-ghost'));
      crsAvailTx.setAttribute('opacity', crsShow ? 1 : 0);
      crsAvailTx.textContent = crsShow ? ('Available ' + f.canaryAvail + '  /  desired ' + f.canaryDesired) : '';
      crsPod.setAttribute('opacity', crsShow && f.canaryAvail > 0 ? 1 : 0);
      crsGhostTx.setAttribute('opacity', crsShow ? 0 : 1);
      /* canary RS 는 승격 뒤에도 지워지지 않는다 — 카드는 ①처럼 다시 빈다(canaryGone 은 roLine1 의
         '(승격됨)' 표시에만 쓴다. 사실은 캡션 ⑥에 있다) */
      crsGhostTx.textContent = crsShow ? '' : '없음';
      crsRevTx.textContent = crsShow ? ('revision: rev ' + REV_NEXT + (f.canaryStatus ? ' · ' + f.canaryStatus : '')) : '';

      for (j = 0; j < PACKET_N; j++) {
        var pkf = f.packets[j];
        packets[j].setAttribute('cx', pkf.cx);
        packets[j].setAttribute('cy', pkf.cy);
        packets[j].setAttribute('class', 'rr-pkt rr-pkt-' + pkf.target);
      }
    }

    function done() { paintSteps(PHASE_COUNT - 1); paint(computeFrame(cfg.variant, PHASE_COUNT - 1, 1)); if (cap && !fixed) cap.textContent = cfg.still; }

    if (REDUCE) { done(); return; }
    var rafId = 0, running = false, t0 = -1;
    function frame(ts) {
      /* 0 은 유효한 타임스탬프다 — falsy 검사로는 첫 프레임이 0 일 때 영영 안 걸린다 */
      if (t0 < 0) t0 = ts;
      var total = (ts - t0) % (PHASE_MS * PHASE_COUNT);
      var p = Math.floor(total / PHASE_MS);
      paintSteps(p);
      paint(computeFrame(cfg.variant, p, (total % PHASE_MS) / PHASE_MS));
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

  function init() { var l = document.querySelectorAll('.vm-rrev'); for (var i = 0; i < l.length; i++) build(l[i]); }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
