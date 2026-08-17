---
title: "1.25 → 1.30 — sidecar 운영자가 맞는 청구서"
weight: 17
---

# 11 · 1.25 → 1.30 — ambient를 안 써도 피할 수 없는 변경들

{{< callout type="info" >}}
**한눈에**
- 이 구간의 최대 사건은 ambient가 아니라 native sidecar 기본화(1.27.0)입니다. `istio-proxy`가 일반 컨테이너를 떠나 init 컨테이너(`restartPolicy: Always`)가 되면서 파드 스펙·기동 순서·종료 순서·Job 완료 판정이 한꺼번에 달라집니다.
- 1.27 change-notes의 "default to `true`"는 틀렸습니다. 코드가 등록하는 기본값은 문자열 `"auto"`입니다(1.27.0 `pilot/pkg/features/pilot.go:307`, 직전 1.26.0은 `experimental.go:179`의 bool `false`). `true`면 무조건 활성이지만 `"auto"`는 노드 kubelet 버전 조건부라 판단이 완전히 달라집니다.
- 전환 시점은 노드 kubelet 버전이 정합니다. `DetectNativeSidecar`가 모든 Node를 훑어 kubelet 마이너가 하나라도 33 미만이면 끕니다(`pkg/kube/inject/webhook.go:1235-1286`, `minVersion := 33`). 1.30 + k8s 1.32 조합에서는 안 켜집니다. 목표인 k8s 1.35에서는 켜지고, green(k8s 1.31)에서는 끝까지 안 켜집니다.
- green(k8s 1.31)에는 1.30을 설치할 수 없습니다 — 1.30의 k8s 하한이 1.32입니다. green에서 닿는 상한이 1.29(EOL ~2026-08)이니 목표 1.30.3은 k8s 1.35 신규 클러스터에서만 성립합니다(§1·§8).
- `holdApplicationUntilProxyStarts`는 native가 켜지면 조용히 무효가 됩니다. 템플릿이 `$holdProxy := and (…hold…) (not $nativeSidecar)`로 계산해 `postStart: pilot-agent wait` 훅을 렌더에서 빼고 그 자리에 `preStop` drain 훅을 놓습니다(1.30.3 `injection-template.yaml:71-77,215-235`). 값을 지우는 것은 조치가 아닙니다 — 남겨둬도 아무 일도 일어나지 않습니다.
- 사용자 init 컨테이너가 메시 안으로 들어옵니다. `reorderPod`는 classic에서 `istio-init`을 initContainers 마지막에("iptables setup last so we do not blackhole init containers"), native에서 맨 앞에("istio first, so init containers are part of the mesh") 둡니다(`webhook.go:805-825`). init의 egress가 iptables·mTLS·`AuthorizationPolicy` 대상이 됩니다. 릴리스노트에 이 항목이 없습니다.
- 1.29 차트 통합의 이름 변경은 우리에게 해당 없을 가능성이 큽니다. upgrade-notes는 `ClusterRole istiod` → `istiod-clusterrole` 매핑표를 싣지만, 로컬 클론의 istiod 차트는 1.22.0부터 이미 신 이름이고 base 차트 템플릿은 1.28.0↔1.30.3이 동일합니다. 체크리스트를 "rename 대응"에서 "구 이름 orphan 탐색"으로 바꿔야 합니다.
- 알람이 조용히 죽는 자리가 셋, 라우팅이 조용히 바뀌는 자리가 둘입니다 — 앞의 셋은 1.29의 서킷브레이커 remaining 메트릭 기본 비활성·stats 압축 기본 활성·디버그 엔드포인트 인증(15014→1.30의 15010), 뒤의 둘은 1.30의 동일 hostname 서비스 선택 로직 변경(`PILOT_SIDECAR_PICK_BEST_SERVICE_NAMESPACE`, 기본 `true`)과 `retryBudget` 기본 `percent` 0.2%→20% 수정([#59504](https://github.com/istio/istio/issues/59504), 100배 차이)입니다. 다섯 다 에러가 없습니다.
- sidecar deprecate 신호는 이 구간에 없습니다. 1.30까지 어떤 공지·문서도 sidecar mode를 deprecated로 표시하지 않았고, native sidecar 기본화와 sidecar용 nftables 지원(1.27)은 sidecar 경로에 들인 투자입니다. 재검토 트리거는 §5에 다섯 개로 못박았습니다. 판정은 native sidecar 검증·플래그/메트릭 grep·Gateway API CRD 확인·CVE 패치가 지금, stats 압축·디버그 엔드포인트 정리·`seccompProfile`이 다음 분기, nftables·`TrafficExtension`·agentgateway·ambient가 보류입니다.
{{< /callout >}}

> 왜 이 문서인가. 목표로 잡은 1.30.3이 정확히 이 구간의 끝입니다. 그러니 남의 릴리스노트를 요약하지 않고 우리 업그레이드가 반드시 통과할 변경만 적습니다. 헤드라인은 전부 ambient(멀티클러스터 beta, DNS 캡처 기본화, 마이그레이션 가이드 신설)이고 우리는 ambient를 안 쓰는데, 그래도 못 넘어갈 것이 세 종류 남습니다 — ① 파드 스펙 자체를 바꾸는 것(native sidecar), ② 리소스 이름·차트 구조를 바꾸는 것(1.29 통합), ③ 플래그·메트릭 기본값을 바꿔 알람을 무효화하는 것. CI는 셋 중 어느 것도 못 잡습니다. ①의 렌더 결과는 유효한 yaml이고 ②에서 Helm은 에러를 안 냅니다. ③은 쿼리가 0을 리턴할 뿐입니다.
>
> 축이 겹치는 문서는 넘깁니다. istiod 부하·`GOMAXPROCS`·xDS 커넥션 재분배 같은 메커니즘은 [09 istiod 스케일링]({{< relref "09-istiod-scaling-connections.md" >}})의 몫이고 여기서는 "**버전이 그 메커니즘의 무엇을 바꿨나**"만 씁니다. 1.20~1.24 구간은 [10 changelog 1.20→1.24]({{< relref "16-changelog-1.20-1.24.md" >}}), 우리 클러스터의 차트·values·이관 절차는 [eks-upgrade/istio]({{< relref "../../eks-upgrade/components/02-istio.md" >}})가 소유합니다.

> 근거 기준: 릴리스노트·업그레이드 노트는 `istio/istio.io` 로컬 클론의 `content/en/news/releases/1.2{5..9}.x`·`1.30.x`(`--depth 1` 스냅샷이라 문서 git 이력은 없습니다). 코드·차트 인용은 `istio/istio` full-history 클론의 태그 체크아웃으로, 주로 `1.30.3`이고 도입 시점 판정은 `1.26.0`/`1.27.0`/`1.28.0`/`1.29.0` 대조입니다. 릴리스일은 `gh release` API, EOL은 istio.io의 `data/compatibility/supportStatus.yml`. 기준 시각 2026-07-30. 문서와 코드가 어긋나는 곳은 코드를 따릅니다. 어긋났다는 사실 자체도 본문에 남깁니다.

## 1. 타임라인 — 1.25~1.30

| 버전 | 릴리스일 | EOL | 지원 k8s |
|---|---|---|---|
| 1.25.0 | 2025-03-04 | 2025-09-30 | 1.29~1.32 |
| 1.26.0 | 2025-05-08 | 2025-12-22 | 1.29~1.32(1.33 "동작 예상") |
| 1.27.0 | 2025-08-12 | 2026-04-07 | 1.29~1.33 |
| 1.28.0 | 2025-11-05 | **2026-07-01(EOL)** | 1.29~1.34 |
| 1.29.0 | 2026-02-16 | ~2026-08(예상) | 1.31~1.35 |
| 1.30.0 | 2026-05-18 | ~2026-11(예상) | 1.32~1.36 |

버전별 breaking·필수 조치는 이렇습니다.

- 1.25.0: OpenCensus 트레이싱 제거. Grafana는 ≥7.2를 요구합니다. 플래그 `istioctl analyze --recursive`·`proxy-status --xds-via-agents` 제거.
- 1.26.0: `ENABLE_AUTO_SNI`는 플래그와 코드패스가 함께 제거. `MAX_CONNECTIONS_PER_SOCKET_EVENT_LOOP` 기본 0→1 — upgrade-notes엔 없고 change-notes에만 있습니다.
- 1.27.0: native sidecar 기본화(§2). Lightstep·OpenCensus 완전 제거. Grafana 대시보드 UID가 고정돼 업그레이드 후 재생성이 필요합니다. 플러그인 CA `cacerts`가 불완전할 때의 조용한 self-signed 폴백이 명시적 기동 실패로 바뀝니다.
- 1.28.0: `METRIC_ROTATION_INTERVAL`·`METRIC_GRACEFUL_DELETION_INTERVAL` 제거, 대체는 `sidecar.istio.io/statsEvictionInterval`. `PILOT_SPAWN_UPSTREAM_SPAN_FOR_GATEWAY` 기본 `true`. accept 제한이 명시 포트 바인드 리스너까지 확장. `BackendTLSPolicy` v1alpha3·`InferencePool` alpha/rc 제거.
- 1.29.0: base/istiod 차트 통합(§3). 디버그 엔드포인트 인가 기본 on(15014). CB remaining 메트릭 기본 off. stats 압축 기본 on과 함께 `statsCompression` 어노테이션 제거. istiod `GOMEMLIMIT` 100%→90%.
- 1.30.0: Gateway API CRD v1.5.x 필수(설치돼 있는 경우). sidecar 서비스 네임스페이스 선택 로직 변경. XDS 디버그(15010) 인증 필수 — CVE-2026-31838. `retryBudget` 기본 `percent` 0.2%→20% 수정. CNI config 권한 0644→0600. `istioctl`의 최소 k8s는 1.32.

오늘(2026-07-30) 기준 공식 지원 마이너는 1.29와 1.30 둘뿐입니다. 1.28은 29일 전 EOL, 하한으로 가정한 1.24는 13개월 전(2025-06-24)에 이미 EOL입니다. 지원 규칙이 "N+2 마이너 릴리스 후 6주까지"라 1.29도 약 한 달 안에 나갑니다. 여유가 남은 선택지는 1.30.3뿐이고 그 여유마저 1.32가 나오면 끝납니다.

k8s 하한은 순서 제약을 만듭니다. 1.28까지는 k8s 1.29를 받아주지만 하한이 1.29부터 1.31, 1.30부터 1.32로 오릅니다. 거꾸로 1.24 계열은 k8s ≤1.31이라 목표 1.35에서는 지원 대상 밖입니다. k8s를 먼저 올리면 현재 istio가 범위를 벗어나고 istio를 늦게 올리면 목표 버전이 EOL로 밀립니다(§8). 이 하한 하나가 경로를 통째로 지웁니다. green은 k8s 1.31이라 하한 1.32인 1.30을 설치할 수 없고, 닿는 상한 1.29(1.31~1.35)마저 EOL이 ~2026-08입니다. 목표 1.30.3은 1.35 신규 클러스터에서만 성립합니다(§8).

## 2. native sidecar 기본화 — 파드 스펙이 바뀐다

### 2.1 플래그 이력 — "true"가 아니라 "auto"다

| 버전 | `ENABLE_NATIVE_SIDECARS` | 근거 |
|---|---|---|
| 1.19.0 | bool `false`(최초 도입) | `bd5f82add6`([#45959](https://github.com/istio/istio/pull/45959)) |
| 1.24.0 | bool `false` + 어노테이션 `sidecar.istio.io/nativeSidecar` 신설 | change-notes 1.24:208-209(**Alpha**) |
| 1.26.0 | bool `false` | 1.26.0 태그 `pilot/pkg/features/experimental.go:179` |
| **1.27.0** | **string `"auto"`** | 1.27.0 태그 `pilot/pkg/features/pilot.go:307`(상세는 아래) |
| 1.28.0 ~ 1.30.3 | string `"auto"` | 태그별 `pilot/pkg/features/pilot.go` 동일 |

`"auto"` 전환은 마스터 커밋 `da90b3536f`([#56428](https://github.com/istio/istio/pull/56428))가 release-1.27로 백포트(`55ea856868`, [#56918](https://github.com/istio/istio/pull/56918))되면서 1.27.0 태그에 실제로 들어갔습니다.

1.27 change-notes:153의 문장은 *"**Promoted** the environment variable `ENABLE_NATIVE_SIDECARS` to default to `true`"*입니다. 코드가 등록하는 것은 `true`가 아니라 `"auto"`입니다.

```go
// 1.30.3 pilot/pkg/features/pilot.go
v := env.Register("ENABLE_NATIVE_SIDECARS", "auto", …).Get()
switch v {
case "false": return NativeSidecarModeDisabled
case "true":  return NativeSidecarModeEnabled
case "auto":  return NativeSidecarModeAuto
default:      log.Warnf("Unknown value …, defaulting to false"); return NativeSidecarModeDisabled
}
```

`"auto"`를 실제로 해석하는 쪽은 인젝션 웹훅의 `DetectNativeSidecar`(`pkg/kube/inject/webhook.go:1235-1286`)입니다. 파드가 이미 노드에 스케줄돼 있으면 그 노드만 봅니다. 스케줄 전이면(어드미션 시점의 통상 상태) 클러스터의 모든 Node를 순회해 kubelet 마이너가 하나라도 `minVersion := 33` 미만이면 `false`를 리턴합니다. 주석이 이유와 상수 출처를 함께 밝혀 뒀습니다 — *"This avoids issues with mixed clusters where some nodes support native sidecars and others do not"*, *"Native sidecars feature graduated to stable in Kubernetes 1.33"*(KEP-753).

- 1.27~1.30 전부 `"auto"`가 기본: Istio 업그레이드만으로는 전환이 안 일어납니다. 1.30 + k8s 1.32(지원 하한)면 계속 꺼진 채입니다.
- 전 노드 kubelet ≥1.33이 되는 순간 켜짐: 전환 시점이 노드 그룹 업그레이드 완료 시점에 붙습니다. istiod 재기동도 values 변경도 없이 다음 파드 재생성부터 조용히 바뀝니다.
- 1.33 미만 노드가 하나라도 돌아오면 다시 꺼짐: 노드 롤백이나 구버전 노드 임시 추가가 있으면 생성 시점에 따라 스펙이 다른 파드가 공존합니다. 코드가 막는 것은 "혼재 클러스터"이고 시간축의 혼재는 막지 않습니다.
- `auto`/`true`면 istiod가 모든 Node를 watch합니다. `webhook.go:222`는 `EnableNativeSidecars != Disabled`일 때만 Node kclient를 만듭니다(`StripNodeUnusedFields` 적용). 노드가 많을수록 istiod 인포머 비용이 늡니다. RBAC에는 이미 `nodes: get/list/watch`가 있어 추가 조치가 없습니다.

목표가 k8s 1.35이므로 결국 켜집니다. 신규 클러스터는 첫 설치부터 native입니다. 검증 일정은 Istio 업그레이드 창 대신 k8s 노드 업그레이드 창에 붙여야 하고 검증 환경도 k8s ≥1.33 노드가 실제로 있는 곳이어야 합니다. 1.32 이하 노드에서는 `auto`가 계속 disabled라 검증이 성립하지 않습니다 — green(1.31)을 검증 환경으로 쓸 수 없는 이유입니다.

### 2.2 무엇이 바뀌나 — 기동·종료 순서와 init 컨테이너의 소속

{{< seq src="_seq/2-2-무엇이-바뀌나-기동-종료.json" />}}

순서를 정하는 코드는 `reorderPod`(`pkg/kube/inject/webhook.go:785-828`)이고 분기 조건은 initContainers에 `istio-proxy`가 있는지 — 즉 native 여부입니다.

```go
if hasContainer(pod.Spec.InitContainers, ProxyContainerName) {
	// We want istio to be first in this case, so init containers are part of the mesh
	// This is {istio-init/istio-validation} => proxy => rest.
	…MoveFirst(ProxyContainerName) …MoveFirst(ValidationContainerName) …MoveFirst(InitContainerName)
} else {
	// Else, we want iptables setup last so we do not blackhole init containers
	// This is istio-validation => rest => istio-init
	…MoveFirst(ValidationContainerName) …MoveLast(InitContainerName)
}
```

릴리스노트에 없는 동작 변경 중 가장 큰 것이 이겁니다. classic에서 사용자 init 컨테이너는 iptables가 깔리기 전에 돌아 메시를 우회했습니다. DB 마이그레이션, 시크릿 페치, 의존성 대기 코드가 mTLS·`AuthorizationPolicy`·`VirtualService` 없이 직접 나갔습니다. native에서는 `istio-init`·`istio-proxy`가 앞에 서므로 init의 egress가 프록시를 경유합니다.

- 메시 내부 서비스 호출: classic — 평문 직통이라 mTLS STRICT면 상대가 거부. native — 프록시 경유로 mTLS 성립. 판정: 좋음(오히려 고쳐집니다).
- 메시 외부 호출(외부 API·DB): classic — 직통. native — `ServiceEntry`·`Sidecar` egress 스코프·`outboundTrafficPolicy`의 지배를 받습니다. 판정: 반쪽(`REGISTRY_ONLY`면 init에서 처음 막힙니다).
- 인바운드 `AuthorizationPolicy`가 걸린 대상 호출: classic — 정책 우회(source가 메시 밖으로 보입니다). native — principal 기반 규칙이 실제로 판정됩니다. 판정: 반쪽(우회로 통과했던 호출이 403이 됩니다).
- 순수 로컬 작업(파일 준비·볼륨 권한): classic — 무영향. native — 무영향(기동이 프록시 Ready 뒤로 밀립니다). 판정: 좋음.

확인할 것은 하나입니다 — finance 워크로드의 init 컨테이너가 네트워크를 쓰나요? 쓰면 목적지가 `ServiceEntry`·`Sidecar` 스코프 안인지, `AuthorizationPolicy`가 그 호출자를 허용하는지 native 상태에서 재검증합니다. 안 쓰면 무해합니다.

### 2.3 `holdApplicationUntilProxyStarts`는 지워지지 않고 무시된다

우리 values에 이 설정이 들어 있다는 사실은 [eks-upgrade/istio]({{< relref "../../eks-upgrade/components/02-istio.md" >}})에 기록돼 있습니다. istio.io는 이 필드가 native sidecar와 어떻게 엮이는지를 어디에도 쓰지 않았습니다. 답은 인젝션 템플릿에 있습니다(1.30.3 `istio-discovery/files/injection-template.yaml:71-77`, `:215-235`).

```gotemplate
{{- $holdProxy := and
    (or .ProxyConfig.HoldApplicationUntilProxyStarts.GetValue .Values.global.proxy.holdApplicationUntilProxyStarts)
    (not $nativeSidecar) }}
…
{{- if .Values.global.proxy.lifecycle }}
  lifecycle: {{ toYaml .Values.global.proxy.lifecycle | indent 6 }}
{{- else if $holdProxy }}
  lifecycle: { postStart: { exec: { command: [pilot-agent, wait] } } }
{{- else if $nativeSidecar }}
  {{- /* preStop is called when the pod starts shutdown. Initialize drain. … */}}
  lifecycle: { preStop: { exec: { command: [pilot-agent, request, …, POST, drain] } } }
{{- end }}
```

`$holdProxy`가 `false`가 되면 `postStart`의 `pilot-agent wait` 훅은 렌더되지 않고 native 분기의 `preStop` drain 훅이 붙습니다. 이 분기 구조 자체는 `3639a4f44f`([#47226](https://github.com/istio/istio/pull/47226), 최초 포함 태그 1.21.0)에서 들어왔습니다. 코드는 1.21부터 준비돼 있었고 1.27의 기본값 플립이 그 코드를 켰습니다. 그래서 릴리스노트에 "hold가 무효화된다"는 항목이 없습니다. 1.27에서 바뀐 건 플래그 하나뿐입니다.

- 기동 순서 보장: classic+hold=true — Istio가 `postStart` 훅으로 구현. native — kubelet이 보장. init 컨테이너가 Ready 되기 전엔 일반 컨테이너를 안 띄웁니다.
- Ready 판정: classic+hold=true — `postStart` 완료 = xDS 최초 수신 완료(`pilot-agent wait`). native — `startupProbe`(기본 활성, `failureThreshold: 600` ≈ 10분) + readinessProbe.
- 종료 시 drain: classic+hold=true — 없습니다. SIGTERM을 동시에 받습니다. native — `preStop`에서 `POST /drain`이 선행합니다.
- 컨테이너 순서 부수효과: classic+hold=true — `proxyLocation = MoveFirst`라 `kubectl exec`·`logs` 기본이 프록시. native — `istio-proxy`가 `spec.containers`에 없으므로 기본이 사용자 컨테이너로 돌아옵니다.
- `holdApplicationUntilProxyStarts` 값: classic+hold=true — 동작함. native — 무시됨(에러·경고 없음).

조치는 "값을 지워라"가 아닙니다. 실제로 할 일은 ① 순서 보장의 주체가 kubelet으로 넘어갔음을 인지하고 ② `startupProbe`가 켜져 있는지 확인하고(1.30.3 `values.yaml:394-396` 기본 `enabled: true`) ③ `global.proxy.lifecycle`을 직접 지정하고 있지 않은지 확인하는 것입니다. 지정하고 있으면 위 템플릿의 첫 분기가 이겨 native의 `preStop` drain 훅이 안 붙습니다 — 종료 시 인플라이트 요청이 끊기는 회귀가 여기서 나옵니다.

### 2.4 Job/CronJob과 주변 도구

Job 완료 문제는 Istio 릴리스노트로 추적되지 않습니다. 판정 주체가 kubelet이기 때문입니다. `restartPolicy: Always` init 컨테이너는 Job 완료 판정에서 제외되고 일반 컨테이너가 모두 종료되면 kubelet이 역순으로 sidecar에 SIGTERM을 보냅니다(KEP-753). classic 시절의 우회책이 불필요해집니다. Job 파드의 `sidecar.istio.io/inject: "false"`는 떼도 되지만 떼면 그 Job이 메시 안으로 들어오므로 목적지 정책을 먼저 확인해야 합니다. 앱 종료 직전의 `POST localhost:15020/quitquitquit` 관용구는 무해하되 의미를 잃어 정리 대상이고 `EXIT_ON_ZERO_ACTIVE_CONNECTIONS`는 1.25~1.30 구간에 기본값 변경이 없으니 그대로 둡니다.

istio.io 문서는 이 갱신을 반영하지 않았습니다. `docs/overview/dataplane-modes/index.md:117-119`의 비교표는 지금도 "Support for Kubernetes Jobs: **Complicated by long life of sidecar**"입니다. 1.27 이전 기준이고 1.30 스냅샷까지 고쳐지지 않았습니다 — 문서만 읽고 "sidecar는 Job이 안 된다"고 판단하면 안 됩니다.

같은 결로 확인할 것이 셋 더 있습니다.

- 다른 mutating webhook·컨트롤러. upgrade-notes 1.27이 직접 경고합니다 — *"This can cause compatibility issues with other mutating webhooks or controllers … that expect to modify the `istio-proxy` as a regular container."* `spec.containers[?(@.name=="istio-proxy")]`를 찾는 도구는 `initContainers`도 보게 고쳐야 합니다. istio.io의 SPIRE 연동 가이드가 실제로 그렇게 고쳐졌고(`docs/ops/integrations/spire/index.md:217`), 게이트웨이는 예외로 계속 일반 `containers`입니다(같은 문서 `:218`).
- `istioctl kube-inject`의 출력이 웹훅과 달라집니다. 오프라인 경로는 kube client가 없으면 `nativeSidecar = (EnableNativeSidecars == Enabled)`로 계산합니다(`pkg/kube/inject/inject.go:857-864`, `webhook.go:1259-1267`). 기본값 `auto`에서 `istioctl kube-inject`는 항상 classic을 뱉습니다. 렌더 결과를 golden 파일로 비교하는 CI가 있으면 클러스터 실제와 어긋납니다.
- 어노테이션 판정이 오타에 안전하지 않습니다. 템플릿 `:29`가 어노테이션 값과 문자열 `"false"`를 `ne`로 비교합니다 — 소문자 `false` 정확히 그 문자열일 때만 비활성이고 `"False"`·`"no"`·`"0"`·`"disabled"`는 전부 활성으로 읽힙니다. 어노테이션 레퍼런스는 *"Takes precedence over the ENABLE_NATIVE_SIDECARS environment variable"*라고만 적어(`docs/reference/config/annotations/index.html:609`) 값 형식의 엄격함을 알려주지 않습니다.

### 2.5 되돌리는 방법과 되돌리면 잃는 것

- `values.pilot.env.ENABLE_NATIVE_SIDECARS=false`: 부작용 — istiod의 Node watch도 함께 사라집니다. 1.27 이후 sidecar 개선을 native 전제로 받은 것이 없으니 기능 손실은 없습니다. 판정 — 좋음(전환 시점을 우리가 정하고 싶을 때 가장 단순).
- `compatibilityVersion` 1.25/1.26: 부작용 — 1.30.3 `manifests/helm-profiles/compatibility-version-1.26.yaml`은 `ENABLE_NATIVE_SIDECARS=false`와 함께 `DISABLE_SHADOW_HOST_SUFFIX`·`PILOT_SPAWN_UPSTREAM_SPAN_FOR_GATEWAY`·`DISABLE_TRACK_REMAINING_CB_METRICS`·`PILOT_SIDECAR_PICK_BEST_SERVICE_NAMESPACE`를 한꺼번에 옛 값으로 되돌립니다(1.27 프로필은 native만 빠진 나머지, 1.28은 뒤 셋, 1.29는 마지막 하나). 판정 — 반쪽(원치 않는 항목까지 묶여 와 §4의 변경들이 조용히 되돌아갑니다).
- `sidecar.istio.io/nativeSidecar: "false"`(파드 단위): 부작용 — 값이 정확히 `"false"`여야 합니다(§2.4). 워크로드마다 관리해야 하니 누락이 생깁니다. 판정 — 반쪽(특정 워크로드만 예외 처리할 때).
- 노드를 1.33 미만으로 유지: 부작용 — k8s 업그레이드 자체가 목적이므로 성립 불가. 판정 — 부적합.

우리 판정: 되돌리지 않습니다. 목표가 k8s 1.35이므로 native가 최종 상태고 되돌림은 "검증이 끝나기 전에 노드가 ≥1.33이 되는" 일정 사고를 막는 임시 수단으로만 씁니다. 쓰더라도 `compatibilityVersion` 말고 `ENABLE_NATIVE_SIDECARS=false` 한 줄로 — 묶여 오는 항목이 없어야 원인 추적이 됩니다.

## 3. Helm 차트 통합과 리소스 이름 — 문서와 코드가 어긋난다

### 3.1 upgrade-notes가 싣는 매핑표

근거는 1.29 upgrade-notes의 "Base Helm chart removals" 절입니다. *"A number of configurations previously present in the `base` Helm chart were copied to the `istiod` chart in previous releases. In this release, the duplicated configurations are fully removed from the `base` chart."*

| 이전 | 신규 |
|---|---|
| `ClusterRole istiod` | `ClusterRole istiod-clusterrole` |
| `ClusterRole istiod-reader` | `ClusterRole istio-reader-clusterrole` |
| `ClusterRoleBinding istiod` | `ClusterRoleBinding istiod-clusterrole` |
| `Role istiod` / `RoleBinding istiod` | 변경 없음 |
| `ServiceAccount istiod-service-account` | `ServiceAccount istiod` |

이름보다 중요한 게 같은 절에 하나 더 있습니다 — 접미사 규칙이 바뀝니다. 구 차트는 `-{{ .Values.global.istioNamespace }}`를 붙였습니다. 신 차트는 네임스페이스 스코프에 `-{{ .Values.revision }}`(revision이 빈 문자열이 아닐 때만)을, 클러스터 스코프에는 거기에 `-{{ .Release.Namespace }}`를 더 붙입니다. revision을 쓰는 우리 구성에서는 이름에 revision이 끼어들고 canary 홉마다 값이 달라집니다.

### 3.2 코드로 대조하면 시점이 다르다

태그별로 로컬 `istio/istio` 클론을 확인한 결과는 문서와 어긋납니다. `istio-discovery/templates/clusterrole.yaml`의 `metadata.name`은 1.22.0부터 1.30.3까지 전부 `istiod-clusterrole{…revision}-{{ .Release.Namespace }}`입니다. 같은 차트의 `clusterrolebinding`·`serviceaccount`는 1.28.0과 1.30.3이 바이트 단위로 동일하고 템플릿 파일 목록에도 diff가 없습니다. 예외는 `reader-clusterrole.yaml` 하나입니다. 1.30.3에서 `global.enableReaderRBAC` 게이팅이 붙고 `resources`에 `configmaps`가 추가돼 21줄이 달라집니다(§3.3이 소개하는 1.30 신설 값이 게이팅하는 파일이 바로 이것입니다). `charts/base/templates/`는 1.24.0~1.30.3이 동일하고 `clusterrole.yaml`류가 애초에 없습니다(1.20.0까지 내려가도 없음).

이 클론에서 1.28→1.29 사이의 rename은 재현되지 않습니다. 신 이름은 1.22.0에 이미 자리를 잡았고 base 차트의 중복본은 그보다 전에 사라졌습니다. 1.29 매핑표는 그 시점의 코드 변경 기록이 아닙니다. 훨씬 오래된 차트에서 올라오는 사용자용 누적 매핑표로 읽는 게 맞습니다. change-notes 1.29:229는 *"Removed obsolete manifests from the base Helm chart"* 한 줄뿐이고 그 대상 파일은 특정하지 못했습니다.

### 3.3 그래서 우리가 할 일

우리 하한 가정은 chart tip 1.24.1이고 그 태그의 istiod 차트는 이미 `istiod-clusterrole`을 만듭니다. 그래서 [eks-upgrade/istio]({{< relref "../../eks-upgrade/components/02-istio.md" >}}) 체크리스트의 *"base/istiod 차트 통합(1.29+) — 리소스 rename을 참조하는 커스텀 role/role-binding 점검"*은 전제가 틀렸을 가능성이 큽니다.

```bash
# ① 구 이름 orphan이 실제로 있는지 — 있으면 1.22 이전 설치의 잔재다
kubectl get clusterrole,clusterrolebinding -o name | grep -E '/istiod($|-istio-system$)'
kubectl get sa -n istio-system -o name | grep istiod-service-account
# ② 커스텀 RBAC이 어떤 이름을 참조하는지
grep -rnE 'istiod-service-account|name:[[:space:]]*istiod$' --include='*.yaml' .
# ③ revision 접미사가 실제로 어떻게 붙었는지 — canary 홉마다 달라진다
kubectl get clusterrole -o name | grep istiod-clusterrole
```

`kubectl get clusterrole istiod`가 비면 이 절 전체가 해당 없음이고 뭔가 나오면 1.22 이전 설치의 orphan이니 참조가 없는지 확인한 뒤 지웁니다.

경로별 차이는 그대로 유효합니다. Helm은 차트 출력에서 사라진 리소스를 지우지 않습니다. 이름이 바뀐 리소스는 신 이름으로 새로 생기고 구 이름은 남습니다. 기능은 정상 동작하고 `helm upgrade`도 성공하니 아무 신호가 없습니다. revision 기반 canary(매 revision이 독립된 풀 스택 설치)나 blue-green 신규 설치는 처음부터 신 이름으로 올라가므로 이 문제를 만들지 않습니다.

1.30이 차트 축에 더한 것은 둘입니다. Helm v4(server-side apply) 지원 — 웹훅 `failurePolicy` 필드 소유권 충돌도 함께 풀렸으니 ArgoCD가 SSA를 쓰면 관련 영구 OutOfSync가 해소될 수 있습니다(Helm v3 유지면 무영향). `global.enableReaderRBAC`(기본 `true`) — istio-reader SA·ClusterRole·ClusterRoleBinding의 설치 여부를 정하고 1.30.3 `charts/base/values.yaml:22-24`에 있고 1.28.0에는 없습니다. 주석이 *"only needed for multicluster remote-secret workflows"*라 단일 클러스터면 `false`로 줄일 여지가 있습니다(선택).

## 4. 조용히 깨지는 것들 — CI가 못 잡는 종류

여기 모은 변경은 하나같이 렌더 결과가 유효하고 배포가 성공하고 파드가 Ready까지 갑니다. 깨지는 쪽은 대시보드 쿼리, 알람 룰, 운영 스크립트, 라우팅 대상입니다. Helm lint·kubeconform·`istioctl analyze`·smoke test 어느 것도 신호를 주지 않습니다.

### 4.1 플래그 기본값 변경

- `PILOT_ENABLE_IP_AUTOALLOCATE`(1.25.0, `false`→`true`): sidecar 영향 — `ServiceEntry.status.addresses`가 채워집니다. 트래픽 경로는 불변. 되돌리기: `false`.
- `ENABLE_AUTO_SNI`(1.26.0, `true`→플래그 삭제(항상 on)): sidecar 영향 — 명시적 `false`로 끄고 있었다면 그 오버라이드가 무의미해집니다. 되돌리기: 없음.
- `MAX_CONNECTIONS_PER_SOCKET_EVENT_LOOP`(1.26.0(gateway·virtual outbound) → 1.28.0(명시 포트 바인드 리스너까지), unset(무제한)→`1`): sidecar 영향 — 소켓 이벤트당 accept 1개. 초고빈도 신규 연결 워크로드에서 연결 수립 지연 가능. 되돌리기: `0`.
- `ENABLE_NATIVE_SIDECARS`(1.27.0, `false`→`"auto"`): sidecar 영향 — §2 전체. 되돌리기: `false`.
- `PILOT_SPAWN_UPSTREAM_SPAN_FOR_GATEWAY`(1.28.0, `false`→`true`): sidecar 영향 — 게이트웨이 요청마다 upstream 스팬이 하나 더 붙어 트레이싱 볼륨·비용 증가. 되돌리기: `false`.
- `METRIC_ROTATION_INTERVAL`·`METRIC_GRACEFUL_DELETION_INTERVAL`(1.28.0, 존재→제거): sidecar 영향 — 설정해 뒀으면 무시됩니다 → `sidecar.istio.io/statsEvictionInterval`. 되돌리기: 없음.
- `proxyConfig.statsCompression`(1.29.0, (없음)→`true`): sidecar 영향 — Envoy stats 엔드포인트가 brotli/gzip/zstd를 협상합니다. `sidecar.istio.io/statsCompression` 어노테이션은 제거. 되돌리기: `proxy.istio.io/config`로 파드별 `statsCompression: false`.
- `ENABLE_DEBUG_ENDPOINT_AUTH`(1.29.0(15014) → 1.30.0(15010 확장), (없음)→`true`): sidecar 영향 — non-system 네임스페이스는 `config_dump`·`ndsz`·`edsz`만, 그것도 동일 네임스페이스 proxy만. 되돌리기: `false`(1.30은 CVE-2026-31838 수정 무력화, 비권장). 1.30부터 `DEBUG_ENDPOINT_AUTH_ALLOWED_NAMESPACES` 화이트리스트.
- `DISABLE_TRACK_REMAINING_CB_METRICS`(1.29.0, (없음)→`true`(트래킹 비활성)): sidecar 영향 — 서킷브레이커 remaining 메트릭이 사라집니다. 되돌리기: `false`.
- `GOMEMLIMIT`(istiod, `automemlimit`, 1.29.0, limit의 100%→90%): sidecar 영향 — OOM 위험은 줄고 GC 빈도는 늡니다. istiod 메모리를 limit에 맞춰 운용 중이면 헤드룸 재산정 → [09]({{< relref "09-istiod-scaling-connections.md" >}}). 되돌리기: `AUTOMEMLIMIT=1`(비율 리터럴이므로 `1`=100%) 또는 `GOMEMLIMIT` 직접 지정.
- `PILOT_SIDECAR_PICK_BEST_SERVICE_NAMESPACE`(1.30.0, (없음, 알파벳순)→`true`): sidecar 영향 — 라우팅 대상이 바뀔 수 있습니다(§6.1). 되돌리기: `false` 또는 `compatibilityVersion: "1.28"`.

`DISABLE_TRACK_REMAINING_CB_METRICS`는 문서끼리 모순됩니다. 1.29 change-notes는 *"When set to `false` (default) …"*로 적고, upgrade-notes는 *"tracking is disabled by default … set `DISABLE_TRACK_REMAINING_CB_METRICS=false` to maintain the previous behavior"*로 적고, 코드는 `env.Register("DISABLE_TRACK_REMAINING_CB_METRICS", true, …)`입니다. 코드가 맞습니다 — 기본은 트래킹 비활성이고 메트릭이 사라집니다.

### 4.2 메트릭·라벨·스크랩 경로

- CB remaining 메트릭 기본 비활성(1.29.0): `envoy_cluster_circuit_breakers_*_remaining_*` 계열 패널·알람이 No data가 됩니다. 서킷브레이커 여유를 알람으로 쓰던 룰이 침묵합니다.
- stats 압축 기본 활성(1.29.0): 스크레이퍼가 `Accept-Encoding`을 보내는데 디코드를 못 하는 구성이면 stats 수집이 실패합니다.
- 메트릭 eviction 메커니즘 교체(1.28.0): `METRIC_ROTATION_INTERVAL`로 조율하던 stats 카디널리티 관리가 무효 → `sidecar.istio.io/statsEvictionInterval`로 다시 설정. 안 하면 카디널리티가 늘거나 반대로 조기 만료됩니다 → [06 관측성]({{< relref "06-observability-points.md" >}}).
- `source_app`·`destination_app` fallback 확장(1.30.0): 우선순위가 `app` → `app.kubernetes.io/name` → `service.istio.io/canonical-name`으로 늘었습니다. `app` 라벨이 있으면 동작 불변이고, `app`이 없어 `unknown`이던 워크로드는 갑자기 이름을 얻어 시계열이 갈립니다.
- upstream span 기본 생성(1.28.0): 트레이스 저장 볼륨·비용이 늡니다. 샘플링률을 그대로 두면 백엔드가 먼저 아픕니다.

### 4.3 제거된 `istioctl` 서브커맨드·플래그

1.25.0에서 `istioctl analyze --recursive`(재귀가 항상 true로 고정)와 `istioctl proxy-status --xds-via-agents`(실험 플래그)가 제거됐습니다. 1.26~1.30 구간에는 서브커맨드·플래그 제거가 없습니다 — change-notes의 `**Removed**` 항목을 전 버전 grep한 결과 istioctl 관련은 위 둘뿐입니다. 대신 1.30은 `istioctl` 자체의 최소 지원 k8s를 `1.32.x`로 올렸고(구 클러스터를 같은 바이너리로 다루던 스크립트가 있으면 분리해야 합니다), `istioctl bug-report`에 `--skip-cluster-dump`·`--skip-analyze`·`--skip-proxy-debug`·`--skip-netstat`·`--skip-coredumps`·`--tail`을 추가했습니다 — 대규모 클러스터에서 bug-report가 타임아웃하던 문제의 손질입니다.

### 4.4 무엇을 grep해서 고치나

```bash
# ① 제거·폐기된 플래그·어노테이션이 values·매니페스트에 남아 있는지
grep -rnE 'ENABLE_AUTO_SNI|METRIC_ROTATION_INTERVAL|METRIC_GRACEFUL_DELETION_INTERVAL|statsCompression' \
  --include='*.yaml' .
# ② 제거된 텔레메트리 프로바이더 (1.27 하드 제거 — 남아 있으면 트레이싱이 조용히 끊긴다)
grep -rniE 'lightstep|opencensus' --include='*.yaml' .
# ③ 사라진 메트릭에 걸린 대시보드·알람
grep -rniE 'circuit_breakers.*remaining|remaining_(pending|rq|cx)' dashboards/ alerts/ 2>/dev/null
# ④ istio-proxy를 일반 컨테이너로 가정하는 도구 · ⑤ 1.25에서 제거된 istioctl 플래그
grep -rnE 'containers\[[^]]*istio-proxy|name=="istio-proxy"|-c istio-proxy' .
grep -rnE 'analyze .*--recursive|--xds-via-agents' .
# ⑥ 동일 hostname 중복 노출 — 1.30 라우팅 변경 대상 (§6.1)
kubectl get svc,serviceentry -A -o json \
  | jq -r '.items[] | (.spec.hosts // [(.metadata.name + "." + .metadata.namespace + ".svc")])[] as $h
           | "\($h)\t\(.kind)\t\(.metadata.namespace)"' \
  | sort | uniq -c | awk '$1 > 1'
# ⑦ Gateway API CRD가 클러스터에 있는지, 있으면 버전 (§6.2)
kubectl get crd tlsroutes.gateway.networking.k8s.io \
  -o jsonpath='{.metadata.annotations.gateway\.networking\.k8s\.io/bundle-version}{"\n"}' 2>/dev/null \
  || echo "Gateway API CRD 없음 — 1.30 요건 무관"
```

⑥·⑦은 CI에 넣을 수 없습니다 — 클러스터 상태에 의존하기 때문입니다. 업그레이드 런북의 사전 점검 단계로 넣고 결과를 캡처해 티켓에 붙입니다.

## 5. ambient 이후 sidecar의 위치 — 우리 방침을 언제 재검토하나

우리는 ambient를 안 씁니다. 그 결정이 여전히 유효한가를 봅니다.

- sidecar mode를 deprecated로 지정한 공지: 방향 — 없음. 근거 — 1.25~1.30의 `_index.md`·upgrade-notes·change-notes 전수 확인.
- 현재 문서의 sidecar 서술: 방향 — 유지. 근거 — `docs/overview/dataplane-modes/index.md:25` — *"well understood and thoroughly battle-tested, but comes with a resource cost and operational overhead."* 비교표에서 트래픽 관리·보안·관측성 모두 sidecar가 "Full Istio feature set".
- native sidecar 기본화 · sidecar용 native `nftables`(둘 다 1.27): 방향 — sidecar 경로에 들인 투자. 근거 — 파드 라이프사이클 문제를 k8s 표준으로 해결했고 [#56487](https://github.com/istio/istio/issues/56487)은 sidecar 모드용입니다. 폐기 예정 경로에 이런 작업을 하지는 않습니다.
- ambient 마이그레이션 가이드 신설(1.30): 방향 — 중립. 근거 — *"gradual and reversible, sidecar and ambient workloads can coexist during the process."* 전환을 쉽게 만들었을 뿐 강제하지 않습니다.
- ambient의 하드 블로커: 방향 — 우리 이동을 막는 쪽. 근거 — `docs/ambient/migrate/_index.md:75-106` — VM 워크로드·SPIRE·`PeerAuthentication mode: DISABLE`·primary-remote 멀티클러스터는 마이그레이션 불가. `EnvoyFilter`는 waypoint에 미지원.
- `TrafficExtension` 신설(1.30): 방향 — 확장 축의 방향 전환. 근거 — 릴리스 공지가 *"replacing `WasmPlugin` as the primary proxy extensibility mechanism"*로 소개합니다. change-notes:92는 Lua 확장만 적고 `WasmPlugin` deprecate·`EnvoyFilter` 언급은 없습니다 → [08 EnvoyFilter]({{< relref "08-envoyfilter-extension.md" >}}).

"sidecar 유지" 방침을 무효화할 근거는 1.30까지 어디에도 없습니다. 우리 쪽 하드 블로커도 그대로입니다. waypoint에 `EnvoyFilter`가 안 되는데 우리는 `local-reply` EnvoyFilter 2개(SIDECAR_OUTBOUND·GATEWAY)를 씁니다. 아래 중 하나가 관측되면 그 분기에 방침을 다시 심사합니다.

1. 공지·`docs/overview/dataplane-modes/`가 sidecar를 deprecated로 표기 — 그때는 방침을 고를 여지가 없고 일정만 남습니다. 어디서 보나: 매 마이너의 `_index.md`·upgrade-notes.
2. ambient 전용으로만 출시된 기능이 우리 요건에 필요해짐 — 기능 격차가 비용 논의를 대체합니다. 어디서 보나: change-notes의 "ambient only" 표기.
3. `EnvoyFilter`가 waypoint에서 지원되거나, 우리 EnvoyFilter 2개를 표준 API·`TrafficExtension`으로 대체 가능해짐 — 최대 블로커가 사라집니다. 어디서 보나: `docs/ambient/migrate/_index.md` known limitations.
4. sidecar 오버헤드가 노드 예산의 유의미한 비율이 됨 — ambient의 유일한 확실한 이득이 이 비용입니다. 어디서 보나: 파드 수 × proxy requests 대 노드 총량 → [14 왜 서비스 메시인가]({{< relref "14-why-service-mesh.md" >}}).
5. `WasmPlugin`이 명시적으로 deprecate되고 `TrafficExtension`이 유일 경로가 됨 — 확장 축을 갈아야 하니 그 창에 같이 심사합니다. 어디서 보나: 1.31+ change-notes의 `**Deprecated**` 항목.

역으로 트리거가 아닌 것도 적어둡니다. ambient의 성숙도 승격, 기본값 변화(DNS 캡처·iptables 재조정), 마이그레이션 가이드 신설은 전부 "ambient가 좋아졌다"는 신호일 뿐 sidecar가 나빠졌다는 신호가 아닙니다. 이 구간의 ambient 헤드라인 전부가 여기에 해당합니다.

## 6. 버전별 나머지

조치가 없는 것을 왜 없는지까지 적어 다시 안 보게 만드는 목록입니다.

- 1.25~1.30 — 항목: ambient 계열 전부 — iptables 재조정·DNS 캡처 기본 on(1.25/1.29), ztunnel 차트 리소스명 변경(1.25) 후 되돌림(1.26), waypoint `TCPRoute`(1.26), multi-network multicluster beta·ztunnel dry-run 정책(1.29), CIDR `ServiceEntry`·XFCC 합성·HBONE 윈도우·CNI Agent `excludeNamespaces` 준수(1.30). 우리에게: ambient 미사용 — 전부 해당 없음. 성숙도 신호로만 §5에서 읽습니다.
- 1.25 — 항목: DNS 트래픽(UDP/TCP)이 `traffic.sidecar.istio.io/exclude*`를 준수. 우리에게: 실제 변경은 1.23 계열에서 일어났고 노트에서 빠졌다고 upgrade-notes가 자백합니다. DNS 포트를 exclude에 넣은 적이 있으면 동작이 이미 달라져 있습니다.
- 1.25 — 항목: Grafana ≥7.2 요구, `istio-cni-node`에 `DAC_OVERRIDE`·AppArmor unconfined. 우리에게: 번들 대시보드를 쓰면 Grafana 버전 확인. 뒤쪽은 istio-cni 사용 여부에 따라 갈립니다(§9).
- 1.27 — 항목: 다중 서버 인증서(RSA+ECDSA), 플러그인 CA CRL(`ca-crl.pem`). 우리에게: 선택 도입. 플러그인 CA를 쓰면 CRL은 검토 가치 있음.
- 1.27 — 항목: mTLS가 `PILOT_ENABLE_TELEMETRY_LABEL`/`PILOT_ENDPOINT_TELEMETRY_LABEL=false`에서 의도치 않게 꺼지던 버그 수정. 우리에게: 업그레이드와 무관하게 지금 확인할 것. 두 플래그를 `false`로 오버라이드한 적이 있으면 그 구간 동안 mTLS가 조용히 비활성이었을 수 있습니다(change-notes 1.27:70).
- 1.27 — 항목: 플러그인 CA `cacerts` 불완전 시 self-signed 조용한 폴백 → 명시적 실패. 우리에게: 플러그인 CA를 쓰면 업그레이드 전 번들 완전성 확인. 불완전하면 1.27부터 istiod가 기동에 실패합니다(change-notes 1.27:133).
- 1.28 — 항목: `seccompProfile: RuntimeDefault` 지원(`global.proxy.seccompProfile`), consistent hash LB의 쿠키 속성(`SameSite`·`Secure`·`HttpOnly`). 우리에게: 둘 다 옵트인이고 기본값 변경이 아닙니다. 앞은 보안 기준을 올릴 때 한 줄로 켜는 카드, 뒤는 쿠키 세션 어피니티를 쓰면 도입 가치([#56468](https://github.com/istio/istio/issues/56468)).
- 1.28 — 항목: dual-stack beta, Gateway API v1.4, `BackendTLSPolicy` v1, `InferencePool` v1, 원격 istiod `Endpoints`→`EndpointSlice`. 우리에게: 전부 미사용·자동 — 해당 없음. `BackendTLSPolicy`는 `PILOT_ENABLE_ALPHA_GATEWAY_API=true`도 더는 필요 없습니다.
- 1.29 — 항목: NetworkPolicy 옵션(`global.networkPolicy.enabled=true`), `PILOT_IGNORE_RESOURCES`, `ENABLE_WILDCARD_HOST_SERVICE_ENTRIES_FOR_TLS`(alpha). 우리에게: 전부 옵트인·기본 off. 첫째는 컨트롤 플레인 격리 카드, 셋째는 SNI 스푸핑 위험이 공지에 명시돼 있어 켜지 않습니다.
- 1.30 — 항목: CNI config 권한 0644→0600(CIS 1.12), `PILOT_ENABLE_NODE_UNTAINT_CONTROLLERS`가 Helm `taint.enabled`로 자동 구성, 기본 레지스트리 `registry.istio.io`, 웹훅 HTTPS(15017) 타임아웃 추가. 우리에게: 권한은 런타임이 root로 읽으므로 통상 무영향(필요하면 `values.cni.env.CNI_CONF_GROUP_READ=true`로 0640). untaint는 쓰면 수동 env를 지울 수 있습니다(선택). 레지스트리는 ECR 미러라 소스 URL만 갱신.
- 1.30 — 항목: agentgateway(`PILOT_ENABLE_AGENTGATEWAY`, 실험), `ListenerSets` 상태, `TLSRoute` termination. 우리에게: 기본 off·Gateway API 전용 — 해당 없음.
- 1.30 — 항목: CUSTOM 인가 프로바이더 워크로드당 다중 지원, `istio.io/connect-strategy: RACE_FIRST_TCP_CONNECT`, `DNS_FORWARD_TIMEOUT`(기본 `5s` 유지). 우리에게: 첫째는 ext_authz를 경로별로 다르게 걸 수 있게 됐습니다 → [07 nginx→Istio]({{< relref "07-from-nginx-to-istio.md" >}}). 나머지는 필요 시 카드.

### 6.1 동일 hostname의 서비스 선택이 바뀐다 (1.30, 트래픽 라우팅)

upgrade-notes가 breaking으로 분류한 유일한 트래픽 경로 변경입니다. 1.29 이하는 보이는 네임스페이스 중 알파벳순 첫 번째를 골랐고 1.30은 K8s `Service` 우선 → 없으면 생성 시각이 가장 오래된 non-K8s 서비스를 고릅니다. 위험한 조합은 같은 hostname을 K8s `Service`와 `ServiceEntry`로 동시에 노출하는 패턴입니다(외부 서비스의 로컬 오버라이드). 되돌리기는 `PILOT_SIDECAR_PICK_BEST_SERVICE_NAMESPACE=false` 또는 `compatibilityVersion: "1.28"` 이하입니다.

의도는 명시적 K8s `Service`가 있는데도 알파벳순 때문에 엉뚱한 `ServiceEntry`가 선택되던 문제를 고치는 것입니다. 우리가 그 "엉뚱한 선택"에 의존하고 있었는지는 모릅니다. §4.4의 ⑥으로 중복 노출을 먼저 셉니다. 0건이면 무해하고 1건 이상이면 업그레이드 전에 어느 쪽이 선택되고 있는지(`istioctl proxy-config cluster <pod>`)를 캡처해 전후를 비교합니다.

### 6.2 Gateway API CRD가 있으면 조용히 깨진다 (1.30)

1.30은 Gateway API 의존성을 `v1.5.1`로 올리고 `TLSRoute`·`ReferenceGrant`를 Standard 채널(`gateway.networking.k8s.io/v1`)에서 읽습니다. CRD가 `v1.5.x`보다 낮으면 그 리소스들이 istiod에 보이지 않게 되고, 기존 TLS passthrough `Gateway` 리스너는 `status.listeners[].attachedRoutes: 0`을 조용히 보고하며 Envoy 리스너가 프로그램되지 않습니다 — upgrade-notes가 직접 *"silently"*라고 적은 케이스입니다.

우리는 classic `Gateway`를 쓰므로 CRD가 클러스터에 없으면 무관입니다. 다만 다른 워크로드나 애드온이 깔아 뒀을 수 있어 확인은 해야 합니다(§4.4의 ⑦). 있으면 Istio보다 먼저 `kubectl apply -k "github.com/kubernetes-sigs/gateway-api/config/crd?ref=v1.5.1"`(experimental 채널을 쓰고 있었다면 `config/crd/experimental`)로 올립니다.

### 6.3 디버그 엔드포인트 인증과 CVE — 목표를 1.30.3으로 잡는 이유

1.29가 포트 15014의 debug 엔드포인트에 네임스페이스 인가를 기본 활성화했고 1.30이 그것을 plaintext XDS 포트 15010의 `syncz`·`config_dump`까지 확장했습니다(CVE-2026-31838). 같은 릴리스에서 `StatusGen`이 서빙하는 XDS 디버그 엔드포인트도 non-system 호출자에 동일 네임스페이스 인가를 강제하도록 고쳐졌습니다 — 그전에는 인증된 워크로드면 아무 네임스페이스에서나 타 네임스페이스의 proxy를 열거나 config dump를 받을 수 있었습니다.

깨지는 것은 우리 쪽 도구입니다. `istioctl --plaintext`를 쓰는 내부 스크립트는 표준 인증 경로(`istioctl proxy-status` 등)로 옮기고 Kiali가 istio-system 밖에 있으면 이전하거나 `DEBUG_ENDPOINT_AUTH_ALLOWED_NAMESPACES`(1.30 신설)에 추가합니다. 15010에 직접 붙는 커스텀 모니터링은 고치거나 제거합니다. `ENABLE_DEBUG_ENDPOINT_AUTH=false`는 CVE 수정을 무력화하므로 쓰지 않습니다.

- CVE-2026-31837(critical): JWKS fallback 메커니즘이 RSA 개인키를 유출 → JWT 위조·인증 우회([GHSA-v75c-crr9-733c](https://github.com/istio/istio/security/advisories/GHSA-v75c-crr9-733c)). 우리에게: `RequestAuthentication`(JWT)을 쓰면 최우선. 1.30.0 이상 필수.
- 인가 우회([#59992](https://github.com/istio/istio/issues/59992)): `source.principals`(suffix 매칭)·`source.namespaces`의 정규식 메타문자가 이스케이프되지 않아 의도치 않은 identity가 정책에 매칭될 수 있었습니다. 우리에게: `AuthorizationPolicy`를 쓰는 모든 클러스터. 수정 후 매칭이 좁아질 수 있으니 정책 재검증.
- CVE-2026-39350 / CVE-2026-41413: `serviceAccount` matcher regex 미인용 / JWKS URI CIDR 차단이 리다이렉트·issuer discovery로 우회됨. 우리에게: SA 이름에 정규식 특수문자가 있으면 매칭이 바뀝니다 / `BLOCKED_CIDRS_IN_JWKS_URIS`를 쓰면 확인.
- 리프 인증서 만료·CA 번들 순서 문제: `NotAfter`가 서명 인증서 만료를 넘던 문제([#59768](https://github.com/istio/istio/issues/59768)) · CA 번들 rotation이 인증서 순서에 따라 안 되던 문제([#59909](https://github.com/istio/istio/issues/59909)) — 만료 검증이 엄격해집니다 / `CERTIFICATE` PEM 블록만 비교 대상. 우리에게: 플러그인 CA의 intermediate 잔여 수명이 짧으면 발급 인증서 수명도 짧아집니다 / `TRUSTED CERTIFICATE` 블록을 섞은 번들은 무시됩니다.

이 CVE들은 전부 1.30.0에 최초 포함됐습니다. 1.29.x 백포트 여부는 확인하지 못했으므로 1.29에 머무는 경로를 검토한다면 백포트를 별도 확인해야 합니다. 목표를 1.30.3으로 잡으면 그 확인이 불필요해집니다 — 목표 버전 선택의 보안 측 근거입니다.

### 6.4 `retryBudget`이 100배 달라진다 (1.30)

`DestinationRule.trafficPolicy.retryBudget`의 기본 `percent`가 0.2%로 잘못 계산되던 버그가 20%로 고쳐졌고([#59504](https://github.com/istio/istio/issues/59504)), 같은 릴리스에서 top-level `retryBudget`이 subset이 자체 `trafficPolicy`를 가지면 조용히 버려지고 subset 레벨 `retryBudget`도 무시되던 문제가 고쳐졌습니다([#59667](https://github.com/istio/istio/issues/59667)).

| 상황 | 1.29 이하 실제 동작 | 1.30 |
|---|---|---|
| `retryBudget`만 선언(percent 미지정) | 활성 커넥션의 **0.2%** — 사실상 재시도 봉쇄에 가깝다 | **20%** |
| top-level `retryBudget` + subset이 자체 `trafficPolicy` | top-level 예산이 **드롭**(예산 없음 = 재시도 무제한) | 정상 상속 |
| subset 레벨 `retryBudget` | **무시** | 적용 |

`retryBudget`을 쓰고 있었다면 실제 동작이 무엇이었는지 모르는 상태였습니다. 1.30에서 처음으로 선언한 대로 동작하고 결과는 "재시도가 늘어난다" 방향이므로 업스트림 부하가 늡니다. 우리 `DestinationRule`에 `retryBudget`이 있으면 값을 다시 정하고 없으면 무해합니다.

## 7. 판단 목록

### 7.1 버전별 운영 판단

전제: sidecar 유지·ambient 금지, 목표 k8s 1.35(현행 green은 1.31), 목표 1.30.3, 라이브 버전 미확정(하한 가정 1.24.1), istiod는 KEDA로 오토스케일, classic Gateway, `local-reply` EnvoyFilter 2개.

- 1.25 — 우리에게 무엇인가: 통과 지점. OpenCensus·istioctl 플래그 제거만 걸립니다. 필수 조치: §4.4의 ②·⑤. 판정: 통과.
- 1.26 — 우리에게 무엇인가: accept 제한 기본 변경이 모든 sidecar 아웃바운드에 닿습니다. 필수 조치: 초고빈도 신규 연결 워크로드가 있으면 전후 벤치마크. 판정: 관찰(사전 조치 없음, 회귀 시 `0`으로 복원).
- 1.27 — 우리에게 무엇인가: 이 구간의 본체. native sidecar 기본화 + 플러그인 CA 하드 실패 + 텔레메트리 프로바이더 제거. 필수 조치: §2 전체 검증, `cacerts` 완전성, Lightstep/OpenCensus grep, Grafana 대시보드 재생성. 판정: 최대 작업량(여기에 시간을 몰아야 합니다).
- 1.28 — 우리에게 무엇인가: 플래그 2개 제거 + 트레이싱 볼륨 증가 + accept 제한 확장. 필수 조치: `METRIC_*` grep, 트레이스 샘플링·저장 비용 재산정. 판정: 통과(단 트레이싱 비용은 사전 계산).
- 1.29 — 우리에게 무엇인가: 차트 이름(§3, 아마 무해) + 알람 3종 무효화. 필수 조치: CB remaining 패널·알람 grep, stats 스크레이퍼 확인, Kiali 네임스페이스 확인, istiod 메모리 헤드룸 재산정. 판정: 관측성 작업(고칠 대상은 대시보드와 알람 룰).
- 1.30(목표) — 우리에게 무엇인가: 라우팅 선택 로직 + Gateway API CRD + 15010 인증 + CVE 5건 + `retryBudget`. 필수 조치: hostname 중복 카운트, CRD 버전, `--plaintext` 스크립트 정리, `retryBudget` 값 재결정. 판정: 도착점(전부 사전 점검이고 사후 발견이 비쌉니다).

### 7.2 도입 우선순위

- native sidecar 검증(Job/CronJob, init egress, 웹훅·컨트롤러, hold 무효화): 비용 — 검증 환경에 k8s ≥1.33 노드 필요(목표 1.35는 충족, green 1.31은 불충족). 워크로드별 확인이라 시간이 듭니다. 효과 — 안 하면 기동·종료·Job 완료가 예고 없이 바뀝니다. 노드 업그레이드 시점에 터집니다. 판정: 지금.
- 플래그·메트릭 grep(§4.4 ①~⑤): 비용 — 리포지토리 grep + 대시보드 치환. 효과 — 안 하면 알람이 조용히 안 옵니다. 가장 발견이 늦는 종류. 판정: 지금.
- Gateway API CRD 확인 · hostname 중복 카운트 · `--plaintext` 도구 정리: 비용 — `kubectl` 두 번 + 스크립트 수정. 효과 — TLS passthrough가 에러 없이 죽는 것, 라우팅 대상이 바뀌는 것, 업그레이드 직후 운영 도구가 죽는 것을 사전에 잡습니다. 판정: 지금.
- CVE 대응 = 1.30.3 이상 고정: 비용 — 목표 버전 그대로. 효과 — JWT 위조(CVE-2026-31837)·인가 우회(#59992)가 1.30.0에서 수정. 1.29 백포트 미확인. 판정: 지금.
- `retryBudget` 값 재결정: 비용 — `DestinationRule` 수정. 값 판단 필요. 효과 — 안 하면 재시도 예산이 100배로 뜁니다 → 업스트림 부하 증가. 판정: 지금(쓰고 있다면).
- stats 스크레이퍼 압축 확인 · 디버그 엔드포인트 네임스페이스 정리: 비용 — 스크레이프 설정·Kiali 배치 또는 값 한 줄. 효과 — 실패하면 sidecar stats 전량 소실 / 관측 도구 조회 실패. 판정: 다음 분기(1.29 통과 전).
- `seccompProfile: RuntimeDefault`(1.28) · `global.networkPolicy.enabled`(1.29): 비용 — values 한 줄 + 호환 확인 / NetworkPolicy 도입 검토. 효과 — syscall 표면 축소 / 컨트롤 플레인 네트워크 격리. 판정: 다음 분기(업그레이드와 분리해서 켭니다).
- CUSTOM 인가 다중화(1.30) · native `nftables`(1.27): 비용 — `MeshConfig`+정책 / values 한 줄 + 노드 OS 의존. 효과 — 경로별 ext_authz / 노드가 nftables 우선으로 갈 때 대비. 판정: 보류(트리거는 "요건 발생"·"노드 OS 변경").
- `TrafficExtension` · agentgateway(둘 다 1.30) · ambient 전환: 비용 — 신규 API의 관계가 아직 얇습니다 / 실험·Gateway API 전용 / ztunnel·waypoint 도입 + `EnvoyFilter` 2개 이관. 효과 — Lua·Wasm 확장의 1급 경로 / AI 에이전트 트래픽 / 파드당 proxy 오버헤드 제거. 판정: 보류(앞 둘은 §5 트리거 5, ambient는 방침이 금지(재검토는 §5)).

## 8. 1.24 → 1.30 점프의 현실

모든 방식 공통 전제는 *"Upgrading across more than two minor versions … in one step is not officially tested or recommended"*(`docs/setup/upgrade/_index.md:10`)이고, revision 기반 canary는 *"jumping across two minor versions is supported"*(`canary/index.md:32`), in-place는 *"no more than one minor version less than the upgrade version"*(`in-place/index.md:30`)입니다. 여기에 스큐 정책이 겹칩니다. 컨트롤 플레인은 데이터 플레인보다 한 버전 앞설 수 있지만 반대는 안 되므로 홉마다 전 sidecar 재시작을 끝내고 다음 홉으로 가야 합니다. 우리가 하려는 것은 하한 가정 1.24 → 1.30, 6 마이너로 단일 스텝은 두 메커니즘 모두에서 지원 밖입니다.

여기에 k8s 축의 제약이 하나 더 겹칩니다(§1). green은 k8s 1.31이고 istio 1.30의 하한은 1.32입니다 — 어떤 홉 전략을 쓰든 green 위에서는 1.30에 도달할 수 없습니다.

- in-place 순차 1.24→…→1.30(홉 6): §2·§3·§4 사건을 하나씩 맞습니다. 홉마다 istiod 교체 + 전량 재시작. 판정: 부적합(6번의 전량 재시작과 검증 창. §3의 orphan을 유일하게 실제로 만나는 경로. 게다가 마지막 홉이 k8s 하한에 막힙니다).
- canary 2마이너 1.24→1.26→1.28→1.30(홉 3): 공식 최단 경로였지만 green에서는 마지막 홉이 성립하지 않습니다 — 1.26(k8s 1.29~1.33)·1.28(1.30~1.34)까지는 1.31이 범위 안이고 1.30은 밖입니다. native 플립도 일어나지 않습니다(kubelet 1.31 < 33). 판정: 1.29까지만 가능(목표 미달).
- canary + 노드 버전 통제(홉 3 이후 노드를 올려 native 플립을 분리): `auto`의 성질(§2.1)을 일정 도구로 쓰는 방법이지만, 노드를 올리는 순간 그 클러스터는 더 이상 green이 아니라 새 클러스터를 짓는 일이 됩니다. 판정: 1.35 신규 클러스터로 가는 것과 동일(별도 경로가 아닙니다).
- blue-green 신규 설치 1.30.3 직행(홉 0): 아무것도 통과하지 않습니다. k8s 1.35 + 처음부터 1.30.3 + native + 신 차트 이름. 판정: 최적이자 목표를 만족하는 유일한 경로.

blue-green이 유리한 이유는 "빠르다"가 아니라 "통과하지 않는다"입니다. 이 문서가 다룬 사건의 절반은 버전을 통과할 때만 문제가 됩니다 — §3의 orphan은 발생하지 않고 §4의 기본값 변경은 "변경"이 아니라 "초기값"이 되어 되돌릴 이전 상태가 없고 §6.1·§6.4는 "바뀜" 없이 "그렇게 시작"합니다. 스큐 자체도 없습니다. 그래도 남는 것이 둘 반 있습니다. ① §2 native sidecar — k8s 1.35 노드에서 신규 설치하면 처음부터 native이므로 검증은 어차피 해야 합니다. ② §6.3의 도구 정리 — CVE는 수정 포함이지만 `--plaintext` 스크립트는 그대로 죽습니다. 그리고 §6.1이 반쪽 — 규칙 변경 자체는 무관해지지만 의도한 대상으로 가는지는 여전히 확인해야 합니다.

절차 상세(차트 리워크, 이미지 ECR 미러, app-of-apps 핀 갱신, 배포 순서, 트래픽 컷오버 게이트, 롤백)는 [eks-upgrade/istio]({{< relref "../../eks-upgrade/components/02-istio.md" >}})가 소유합니다. 다만 그 문서의 첫 체크리스트 항목은 그대로 유효합니다 — 라이브 istiod/proxy 버전이 미확인이면 위 목록의 홉 산정 전부가 무의미합니다. 그리고 §3의 결과로 "base/istiod 차트 통합" 항목은 문구를 고쳐야 합니다.

## 9. 근거

`news/…`는 `/Users/mont/evejuni/istio-io/content/en/news/releases/`, `docs/…`는 `/Users/mont/evejuni/istio-io/content/en/docs/`, 그 밖의 상대 경로는 `/Users/mont/evejuni/istio` 레포 루트 기준입니다.

- 마이너별 breaking·필수 조치 / 변경 상세·PR·CVE / 릴리스 맥락·k8s 범위: `news/1.2{5..9}.x`·`1.30.x`의 `announcing-*/{upgrade-notes,change-notes,_index}/index.md`(1.30 Security 절 `change-notes:191-254`, k8s 범위는 각 `_index.md:19`).
- 릴리스일·EOL·지원 정책·스큐 / 업그레이드 간격 정책: `data/compatibility/supportStatus.yml`(1.24~1.30), `docs/releases/supported-releases/index.md:35`, `docs/setup/upgrade/{_index.md:10,canary/index.md:32,in-place/index.md:30}`.
- `ENABLE_NATIVE_SIDECARS` 기본값 이력: 1.26.0 태그 `pilot/pkg/features/experimental.go:179`(bool `false`), 1.27.0·1.28.0·1.30.3 태그 `pilot/pkg/features/pilot.go:307`(string `"auto"`). 커밋 `bd5f82add6`·`da90b3536f`·`55ea856868`.
- `"auto"` 판정·k8s 1.33 상수·Node watch·RBAC: `pkg/kube/inject/webhook.go:1235-1286`(1.27.0 태그도 같은 위치), `:222`, 1.30.3 `istio-discovery/templates/clusterrole.yaml:70-72`.
- hold 무효화·`preStop` drain·`restartPolicy: Always`·어노테이션 판정·`startupProbe`: 1.30.3 `istio-discovery/files/injection-template.yaml:29,71-77,193,215-235`, `istio-discovery/values.yaml:394-396`. 분기 도입 커밋 `3639a4f44f`([#47226](https://github.com/istio/istio/pull/47226), 최초 포함 태그 1.21.0).
- init 컨테이너 순서 역전 · `istioctl kube-inject` 차이 · 어노테이션 레퍼런스: `pkg/kube/inject/webhook.go:785-828`(`reorderPod`, 두 분기의 원문 주석)·`:1259-1267`, `pkg/kube/inject/inject.go:857-864`, `docs/reference/config/annotations/index.html:592-613`.
- native sidecar와 외부 도구 · Job 비교표가 낡았다는 근거: `docs/ops/integrations/spire/index.md:168,217-218`, `docs/overview/dataplane-modes/index.md:25,52-67,117-119`.
- 1.29 차트 이름 매핑표·접미사 규칙 / 코드로 대조한 결과: `news/1.29.x/announcing-1.29/upgrade-notes/index.md:49-68`·change-notes `:229`. 대조는 태그 1.22.0~1.30.3의 `istio-discovery/templates/{clusterrole,clusterrolebinding,reader-clusterrole,serviceaccount}.yaml`와 태그 1.20.0~1.30.3의 `manifests/charts/base/templates/` 파일 목록.
- `global.enableReaderRBAC` · compat 프로필 · 플래그 기본값: 1.30.3 `manifests/charts/base/values.yaml:22-24`(1.28.0 부재), `manifests/helm-profiles/compatibility-version-1.2{5..9}.yaml`, `pilot/pkg/features/pilot.go:298`(`MAX_CONNECTIONS_PER_SOCKET_EVENT_LOOP` 기본 `1`).
- ambient 하드 블로커 · Gateway API 장기 방향 · 우리 클러스터 전제: `docs/ambient/migrate/_index.md:75-106`, `content/en/boilerplates/gateway-api-future.md`, [eks-upgrade/istio]({{< relref "../../eks-upgrade/components/02-istio.md" >}}).

### 확인하지 못해서 쓰지 않은 것

- 1.30.0 CVE들의 1.29.x 백포트 여부. 로컬 클론에 패치 릴리스 상세가 없습니다. 1.29 체류 경로를 검토하면 GitHub Security Advisory를 직접 조회해야 합니다.
- 1.29 "Base Helm chart removals"의 실제 제거 대상. upgrade-notes 매핑표와 로컬 클론의 차트 트리가 어긋납니다(§3.2). change-notes 1.29:229가 어느 파일을 가리키는지 특정하지 못했습니다.
- 1.25~1.30 각 버전의 Envoy 버전과 그로 인한 동작 변화. change-notes가 Envoy 버전을 명시하지 않고, 로컬에 Envoy 클론이 없어 `istio.deps`의 proxy SHA를 태그로 변환하지 못했습니다. istio.io의 `supported-releases` 표는 EOL 마이너를 싣지 않아 과거 값도 못 찾았습니다.
- `MAX_CONNECTIONS_PER_SOCKET_EVENT_LOOP=1`의 정량적 영향. 릴리스노트·커밋 메시지에 벤치마크 수치가 없습니다. 정성 판단까지만 가능하고 실측은 스테이징에서 해야 합니다.
- finance가 `istio-cni`(CNI 체이닝) 방식인지 기본 `istio-init` 방식인지. 1.25의 `DAC_OVERRIDE`·AppArmor, 1.27의 `cni.istioOwnedCNIConfig`·istio-cni 차트 `GOMEMLIMIT` divisor 수정, 1.30의 CNI config 권한 0600이 전부 이 여부로 갈립니다. 라이브 Helm values 확인이 필요합니다.
- `WasmPlugin`의 deprecate 일정과 proxy 기본 리소스 requests·limits 변경 이력. 앞은 1.30 공지의 "replacing" 문구뿐이고 change-notes에 deprecate 항목이 없습니다. 뒤는 1.25~1.30 change-notes 전체에 해당 항목이 없습니다.
