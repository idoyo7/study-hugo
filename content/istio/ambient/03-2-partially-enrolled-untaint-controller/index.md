---
title: "3-2편 — Partially Enrolled Pod와 Untaint Controller"
weight: 4
---

# 03-2 · Partially Enrolled Pod와 Untaint Controller — istio-cni보다 먼저 뜬 Pod (2026-07)

{{< callout type="info" >}}
**참조한 내용정리** · 이 문서는 아래 원문을 읽고 우리 지식베이스 형식으로 재구성한 요약입니다. 원문 자체가 아니며, 정확한 워딩·전체 맥락·그림은 원문에서 확인합니다.
- **원문**: [Istio 3-2편: Partially Enrolled Pod와 Untaint Controller](https://tech.channel.io/kr/articles/ambient-mode-troubleshooting-2-1f761f31)
- **매체 · 게시일**: 채널코퍼레이션 기술 블로그 · 2026-07-02
{{< /callout >}}

{{< callout type="info" >}}
- 특정 노드에서 새로 뜬 Pod이 간헐적으로 트래픽을 받지 못했습니다. Pod phase는 `Running`, readiness probe는 통과, Service 엔드포인트에도 들어가 있었는데 메시 데이터플레인 관점에서는 아직 처리 준비가 안 된 **partially enrolled** 상태였습니다.
- Ambient에서 "메시에 참여했다"가 성립하려면 **두 단계**가 모두 끝나야 합니다. ① istio-cni가 Pod network namespace에 리다이렉션 규칙을 심습니다. ② ztunnel이 그 Pod을 workload로 인식하고 프록시를 준비합니다. 하나만 빠져도 쿠버네티스는 정상이라 보고 메시는 처리하지 못합니다.
- 원인은 스케줄링 경합입니다. **kube-scheduler는 DaemonSet의 준비 완료를 일반 워크로드 스케줄링의 선행 조건으로 보장하지 않습니다.** 새 노드에서는 istio-cni·ztunnel DaemonSet Pod과 워크로드 Pod의 스케줄링이 같은 시점에 함께 진행될 수 있습니다.
- 공식 해법은 **untaint controller**입니다. 새 노드에 `cni.istio.io/not-ready` startup taint를 붙여 워크로드 스케줄링을 막아두고 istio-cni가 Ready가 되면 istiod 안의 컨트롤러가 그 taint를 뗍니다.
- 설정은 `pilot.taint.enabled=true`와 `PILOT_ENABLE_NODE_UNTAINT_CONTROLLERS` **두 개가 다 필요**했습니다. Istio 1.30부터는 전자를 켜면 후자가 자동 구성됩니다.
{{< /callout >}}

[3-1편]({{< relref "03-1-503-half-open-connection.md" >}})의 503과 half-open connection은 이미 메시 안에 자리 잡은 커넥션이 언제 끊기는지를 다뤘습니다. 이번 편의 대상은 그보다 한 단계 앞입니다 — 애초에 메시에 제대로 들어오지 못한 Pod입니다. 겉으로 드러나는 증상은 똑같이 5xx인데 원인이 놓인 계층이 다릅니다. 앞쪽은 커넥션 타이밍이고 이쪽은 Pod 등록 타이밍입니다.

Sidecar mode라면 이 문제 자체가 성립하기 어렵습니다. Envoy 사이드카가 Pod 안에 함께 있으니 Pod이 준비되면 메시 기능도 같이 준비됩니다. Ambient mode의 데이터플레인은 Pod 밖에 있습니다 — 노드 위의 istio-cni와 ztunnel입니다. 그래서 Pod의 readiness와 노드 데이터플레인의 readiness가 어긋납니다. 그 사이에 벌어진 간격이 장애 구간입니다([1편]({{< relref "01-why-ambient-mode.md" >}})이 다룬 트레이드오프의 연장선입니다).

## 1. 증상 — Running이고 Ready인데 트래픽이 실패한다

채널팀이 프로덕션에서 관측한 내용입니다.

| 관측 지점 | 상태 |
| --- | --- |
| Pod phase | `Running` |
| readiness probe | 통과 |
| Kubernetes Service 엔드포인트 | 정상 포함 |
| 다른 메시 워크로드 / waypoint에서의 호출 | 실패 |

클라이언트 쪽 Envoy에는 이런 에러가 남았습니다.

```text
upstream connect error or disconnect/reset before headers
```

reset reason은 `connection failure` 또는 `connection termination`이었습니다.

쿠버네티스가 내주는 신호는 전부 초록불인데 트래픽만 흐르지 않습니다. [상위 챕터 05 간헐적 응답 이상]({{< relref "../../05-incident-intermittent-5xx.md" >}})에서 다룬 사이드카 시절의 5xx 추적 순서로는 이런 조합이 잘 잡히지 않습니다. 그 순서는 "프록시가 붙어 있다"는 전제에서 출발해 라우팅·정책·업스트림을 차례로 의심하는데 여기서는 프록시가 지날 경로 자체가 아직 만들어지지 않았습니다.

단서는 발생이 특정 노드에 몰린다는 점이었습니다. 문제의 축은 Pod이 아니라 노드였습니다.

## 2. Ambient에서 "메시에 참여한다"의 정확한 의미

### 레이블은 의도 표명일 뿐이다

네임스페이스에 `istio.io/dataplane-mode=ambient` 레이블이 붙었다는 건 하나만 뜻합니다 — "이 Pod은 Ambient mesh 대상이어야 한다"는 **의도**. 레이블이 붙었다고 트래픽이 ztunnel을 지나가지는 않습니다.

실제로 트래픽이 ztunnel을 지나가려면 두 단계를 다 마쳐야 합니다.

{{< flow src="_flow/레이블은-의도-표명일-뿐이다.json" />}}

두 단계 중 하나라도 빠진 Pod은 쿠버네티스 관점에서는 정상 Pod처럼 보이지만 메시 데이터플레인 쪽에서는 아직 완전하지 않습니다. 이 상태를 **partially enrolled**라고 부릅니다.

### 사이드카 모드와의 근본적 차이

| 구분 | Sidecar mode | Ambient mode |
| --- | --- | --- |
| 프록시 위치 | Pod 내부 컨테이너 | 노드 위 DaemonSet(ztunnel) |
| 준비 판정 | Pod 자체가 준비되면 메시 기능도 준비 | Pod 준비와 별개로 node-local 컴포넌트가 준비돼야 함 |
| 실패 시점 | Pod 기동 실패로 드러남 | Pod은 정상, 트래픽만 실패 |
| 의존 방향 | Pod 내부 자기완결 | node-local 컴포넌트(istio-cni · ztunnel)에 강하게 의존 |

Ambient에서는 Pod이 뜨는 시점에 이 노드 컴포넌트들이 이미 준비돼 있어야 합니다. 그렇지 않으면 트래픽 손실이 납니다. Ambient의 Envoy 설정 구조 자체는 [2편]({{< relref "02-envoy-config-anatomy.md" >}})에서 다룹니다.

## 3. Partially enrolled — 두 가지 실패 시나리오

원문은 partially enrolled를 두 갈래로 분류합니다.

| 구분 | 시나리오 1 | 시나리오 2 |
| --- | --- | --- |
| 무엇이 안 됐나 | istio-cni 미호출 또는 ambient 판정 실패 | 규칙은 생성됐으나 ztunnel 연결·ACK 미준비 |
| netns 리다이렉션 규칙 | 없음 | 있음 |
| `ambient.istio.io/redirection` | 미적용 | `pending` |
| 실제 트래픽 | 메시를 그대로 우회 | 인바운드·아웃바운드가 동작하지 않음 |
| 위험 | mTLS, `AuthorizationPolicy`, telemetry가 우회될 수 있음 | 커넥션 실패로 드러남 |

{{< callout type="error" >}}
시나리오 1이 더 위험합니다. 트래픽이 막히는 게 아니라 **정책을 우회한 채 성공**하기 때문입니다. mTLS도, `AuthorizationPolicy`도, 텔레메트리도 적용되지 않은 평문 트래픽이 오가는데 메트릭에는 아무 이상도 잡히지 않습니다. 시나리오 2는 최소한 5xx로 시끄럽게 실패합니다.
{{< /callout >}}

### annotation이 상태를 드러낸다

등록 상태는 Istio가 Pod의 `ambient.istio.io/redirection` annotation으로 관리합니다.

| 값 | 의미 |
| --- | --- |
| `enabled` | 리다이렉션 구성 완료. Pod이 captured 상태 |
| `pending` | 리다이렉션이 일부 적용됐으나 ztunnel 등록이 완료되지 않음 |

원문은 `pending`을 이렇게 규정합니다 — active ztunnel이 해당 Pod을 프록시하기 전까지는 인바운드·아웃바운드 트래픽이 동작하지 않을 수 있는 상태입니다.

### 소스코드에서의 위치

채널팀은 istio 소스를 열어 이 경로를 직접 확인했습니다. 진입점은 `cni/pkg/nodeagent/meshdataplane_linux.go`의 `AddPodToMesh`입니다.

{{< seq src="_seq/소스코드에서의-위치.json" />}}

재시도 로직은 있습니다. 그래도 재시도가 성공하기 전까지는 트래픽이 그대로 유실됩니다.

## 4. 근본 원인 — 스케줄러는 DaemonSet 준비를 기다리지 않는다

kube-scheduler는 **DaemonSet의 준비 완료를 일반 워크로드 스케줄링의 선행 조건으로 보장하지 않습니다.** 새 노드가 클러스터에 추가되면 istio-cni DaemonSet Pod, ztunnel DaemonSet Pod, 일반 워크로드 Pod의 스케줄링이 거의 동시에 진행될 수 있습니다.

{{< seq src="_seq/4-근본-원인-스케줄러는-daemonset.json" />}}

### readiness probe로는 잡히지 않는다

원문의 표현대로 "쿠버네티스는 Pod이 준비됐다고 보지만, Ambient mesh는 아직 이 Pod을 처리할 준비가 되지 않은 상태"입니다.

readiness probe는 애플리케이션이 준비됐는지만 봅니다. 컨테이너가 포트를 열었는지, 헬스 엔드포인트가 200을 주는지까지가 확인 범위입니다. 노드의 메시 데이터플레인이 이 Pod을 받을 준비가 됐는지는 검사 대상이 아닙니다. 사이드카 시절에는 프록시가 Pod의 컨테이너였으므로 Ready 판정 안에 프록시 준비가 자연히 포함됐지만 Ambient는 그 포함 관계가 끊깁니다. probe를 아무리 촘촘하게 짜도 이 문제는 걸러지지 않습니다.

## 5. 해법 — Untaint Controller

Istio 팀의 공식 해결책은 untaint-controller입니다. 이미 떠버린 Pod을 사후에 고치는 대신 node-local 데이터플레인이 준비되기 전에는 워크로드 Pod이 그 노드에 스케줄되지 못하게 막습니다.

### 동작

{{< seq src="_seq/동작.json" />}}

### 누가 붙이고 누가 떼는가

도입할 때 가장 자주 어긋나는 대목입니다.

| 동작 | 담당 |
| --- | --- |
| taint **추가** | 인프라 레벨 — Karpenter NodePool, 노드 그룹, 오토스케일링 그룹 등이 새 노드 생성 시점에 붙인다 |
| taint **제거** | untaint-controller (istiod 내부) |

{{< callout type="warning" >}}
**untaint-controller는 taint를 붙이지 않습니다. 떼기만 합니다.** Istio 쪽 설정만 켜고 노드 프로비저닝 쪽에 startup taint를 넣지 않으면 아무 일도 일어나지 않습니다. 경합은 그대로 남습니다. 노드가 어디서 만들어지든 그 경로마다 taint를 붙여야 합니다.
{{< /callout >}}

### 설정

Karpenter를 쓴다면 NodePool에 startup taint를 구성합니다.

```yaml
apiVersion: karpenter.sh/v1beta1
kind: NodePool
metadata:
  name: default
spec:
  template:
    spec:
      startupTaints:
        - key: cni.istio.io/not-ready
          value: "true"
          effect: NoSchedule
```

Istio 쪽은 Helm values로 켭니다.

```yaml
pilot:
  taint:
    enabled: true
  env:
    PILOT_ENABLE_NODE_UNTAINT_CONTROLLERS: "true"
```

두 값의 역할이 다릅니다.

| 설정 | 역할 |
| --- | --- |
| `pilot.taint.enabled=true` | 노드 패치 권한과 CNI 네임스페이스 설정을 활성화한다 |
| `PILOT_ENABLE_NODE_UNTAINT_CONTROLLERS=true` | 실제 컨트롤러 실행을 활성화한다 |

{{< callout type="important" >}}
채널팀이 짚어낸 함정이 여기 있습니다. **`pilot.taint.enabled=true` 하나만으로는 컨트롤러가 돌지 않습니다.** Istio 1.22 릴리스 노트는 `cni.istio.io/not-ready` taint를 제거하는 node taint controller가 추가됐다고 짧게 언급해둔 정도라서 Helm 값 하나만 켜고 끝났다고 오해하기 쉽습니다.
{{< /callout >}}

### Istio 1.30에서 달라진 것

원문이 링크한 [Istio 1.30 upgrade note](https://istio.io/latest/news/releases/1.30.x/announcing-1.30/upgrade-notes/#untaint-controller)에 따르면 `istiod` Helm 차트에서 `taint.enabled`를 설정하면 `PILOT_ENABLE_NODE_UNTAINT_CONTROLLERS` 환경변수가 자동으로 구성됩니다. istiod 디플로이먼트에서 이 변수를 수동으로 켤 필요가 없어졌습니다.

1.30 이상이면 위 Helm values의 `env` 블록은 생략해도 됩니다. 그 이전 버전에서는 두 값을 모두 명시해야 합니다.

## 6. 적용 시 주의점 — 이걸로 전부 막히지는 않는다

untaint controller는 경합의 큰 축 하나를 없앱니다. 원문이 정리한 한계입니다.

- **untaint-controller는 istio-cni의 준비까지만 보장합니다.** ztunnel의 readiness까지 완전히 보장하지는 않습니다. 앞서 본 시나리오 2(리다이렉션은 됐지만 ztunnel 연결·ACK 미준비)는 taint만으로 닫히지 않습니다.
- **기존 Pod의 재등록 경로가 남습니다.** 이미 노드에 떠 있던 Pod이 다시 등록돼야 하는 상황에는 startup taint가 개입하지 않습니다.
- 리다이렉션 적용 이후의 ztunnel 단절, 그리고 `pending` 상태의 짧은 윈도우는 여전히 존재할 수 있습니다.
- **taint는 반드시 인프라 단계에서 설정해야 합니다.** 컨트롤러는 제거만 합니다.

원문이 링크한 [ambientmesh.io 운영 가이드](https://ambientmesh.io/docs/operations/untaint-controller/)는 컨트롤러가 실제로 도는지 확인하려면 istiod 로그를 보고 `istioctl admin log`로 untaint 관련 로그 레벨을 올리라고 안내합니다. 이 문단은 원문 본문이 아니라 원문이 인용한 문서의 내용입니다.

## 7. 사이드카 시절의 운영 감각이 어긋나는 지점

상위 챕터의 사이드카 계열 문서들과 나란히 놓으면 차이가 드러납니다.

| 질문 | Sidecar mode에서의 답 | Ambient mode에서의 답 |
| --- | --- | --- |
| "이 Pod은 메시에 들어와 있나?" | 사이드카 Ready면 그렇다 | Pod Ready와 무관 — netns 규칙·ztunnel 등록을 따로 확인 |
| "노드를 늘리면?" | 각 Pod이 사이드카를 각자 띄운다 | istio-cni·ztunnel이 먼저 떠야 함 — 경합 구간 발생 |
| 컨트롤 플레인 부하의 형태 | 프록시 수에 비례한 xDS push ([02]({{< relref "../../02-istiod-control-plane.md" >}})) | 노드 수 기준 컴포넌트 + 노드 taint 패치 |
| 스케일아웃의 부작용 | xDS 커넥션이 재분배되지 않음 ([09]({{< relref "../../09-istiod-scaling-connections.md" >}})) | 신규 노드마다 partially enrolled 윈도우 발생 |

[01 서비스 메시와 Istio 기초]({{< relref "../../01-mesh-basics.md" >}})가 정리한 메시 운영 비용은 Ambient에서도 남습니다. 사이드카에서 그 비용은 Pod당 프록시의 CPU·메모리였고 Ambient에서는 **노드 라이프사이클과 메시 데이터플레인 준비를 맞추는 일**입니다.

노드 단위로 데이터플레인을 다루는 사고는 [03 게이트웨이 노드 분리]({{< relref "../../03-gateway-node-isolation.md" >}})와 결이 같습니다. 그쪽은 자원 경합을 피하려 노드를 나누고 이쪽은 노드가 준비될 때까지 스케줄을 미룹니다.

## 이 문서에서 가져갈 것

- **Ambient에서 Pod의 Ready는 메시 준비를 뜻하지 않습니다.** `istio.io/dataplane-mode=ambient` 레이블은 의도일 뿐이고 실제 참여는 istio-cni의 netns 리다이렉션 규칙과 ztunnel의 workload 등록이 둘 다 끝나야 성립합니다.
- 등록 상태는 `ambient.istio.io/redirection` annotation으로 판별합니다. `enabled`면 captured, `pending`이면 ztunnel이 아직 프록시하지 않는 상태입니다. annotation이 아예 없는 경우가 더 위험합니다 — 트래픽이 실패하지 않고 mTLS·`AuthorizationPolicy`·telemetry를 우회한 채 성공합니다.
- kube-scheduler는 DaemonSet 준비를 워크로드 스케줄링의 선행 조건으로 보장하지 않습니다. 노드 프로비저닝이 잦은 환경(오토스케일, 노드 교체)일수록 이 경합을 반복해서 겪습니다.
- 해법은 사전 차단입니다. `cni.istio.io/not-ready` startup taint로 스케줄 자체를 막고 istio-cni Ready 이후 untaint-controller가 taint를 뗍니다. 재시도 로직은 있지만 재시도가 성공하기 전까지는 그대로 트래픽 유실입니다.
- 설정은 `pilot.taint.enabled`(권한·네임스페이스)와 `PILOT_ENABLE_NODE_UNTAINT_CONTROLLERS`(컨트롤러 실행) 두 손잡이가 짝이며 Istio 1.30부터는 전자가 후자를 자동 구성합니다. taint를 **붙이는 쪽은 인프라(Karpenter NodePool 등)** 이고 컨트롤러는 떼기만 합니다.

## 소스

- **원문**: [Istio 3-2편: Partially Enrolled Pod와 Untaint Controller](https://tech.channel.io/kr/articles/ambient-mode-troubleshooting-2-1f761f31) (채널코퍼레이션 기술 블로그, 2026-07-02)
- 시리즈 [1편 — 왜 Istio Ambient mode인가?](https://tech.channel.io/ko/articles/tech-istio-ambient-mode-30cdf79a) · [2편 — Envoy config로 해부하는 Ambient mode](https://tech.channel.io/ko/articles/tech-istio-envoy-config-c5193569) · [3-1편 — 503과 Half-open Connection](https://tech.channel.io/ko/articles/ambient-mode-troubleshooting-1-82576790)
- 원문이 인용한 문서
  - [Untaint controller — ambientmesh.io 운영 가이드](https://ambientmesh.io/docs/operations/untaint-controller/)
  - [Istio 1.30 upgrade notes — untaint controller](https://istio.io/latest/news/releases/1.30.x/announcing-1.30/upgrade-notes/#untaint-controller)
  - [istio/istio.io PR #17190 — untaint-controller 문서 추가](https://github.com/istio/istio.io/pull/17190)
- 이 문서가 다루지 못한 것: 원문에는 partially enrolled Pod을 찾는 구체적인 `kubectl`/`istioctl` 명령 전문, ztunnel 로그 메시지 원문, 경합 발생 빈도·복구 시간 같은 정량 수치가 실려 있지 않습니다. 해당 항목은 여기서도 채우지 않았습니다.
