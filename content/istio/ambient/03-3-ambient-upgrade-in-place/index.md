---
title: "3-3편 — Ambient 안전하게 업그레이드하기"
weight: 5
---

# 03-3 · Ambient mode 안전하게 업그레이드하기 — istiod → istio-cni → ztunnel, 그리고 ztunnel만은 node pool blue-green (2026-07)

{{< callout type="info" >}}
**참조한 내용정리** · 이 문서는 아래 원문을 읽고 우리 지식베이스 형식으로 재구성한 요약이다. 원문 자체가 아니며, 정확한 워딩·전체 맥락·그림은 원문에서 확인한다.
- **원문**: [Istio 3-3편: Ambient mode 안전하게 업그레이드하기](https://tech.channel.io/kr/articles/tech-istio-cni-in-place-b004fdb9)
- **매체 · 게시일**: 채널코퍼레이션 기술 블로그 · 2026-07-08
- **저자**: 딜런 · 재티(정재홍), 채널코퍼레이션 DevOps팀
{{< /callout >}}

{{< callout type="info" >}}
**한눈에**
- Ambient mode는 사이드카가 없어 애플리케이션 Pod을 재시작하지 않아도 된다. 대신 업그레이드의 위험이 `istio-cni`·`ztunnel`이라는 node-local 컴포넌트로 옮겨 온다.
- 채널팀이 세운 순서는 **`istiod` → `istio-cni` → `ztunnel`**. `v1.x` istio-cni와 ztunnel이 `v1.x` 및 `v1.x+1` control plane과 호환되므로 control plane이 먼저 올라간다.
- `istiod`와 `istio-cni`는 in-place로 간다. istio-cni가 in-place로 성립하는 이유는 이미 Running인 Pod의 network namespace가 재생성되지 않기 때문이고, 위험은 rollout 틈에 새로 생성되는 Pod의 `FailedCreatePodSandBox` 정도인데 이건 kubelet이 재시도한다.
- `ztunnel`만은 rolling update를 쓰지 않는다. graceful shutdown 기본값이 30초 수준이라 그 안에 끝나지 않은 long-lived connection은 종료 순간 끊긴다. 그래서 **node pool 단위 blue-green**으로 옮긴다.
- 구현은 ztunnel DaemonSet을 `ztunnel-a`(1.25.0) / `ztunnel-b`(1.26.2)로 나눠 `node.channel.io/istio-version` label에 매핑하고, istiod의 `CA_TRUSTED_NODE_ACCOUNTS`에 두 service account를 모두 등록한 뒤 blue node를 점진적으로 cordon/drain하는 것이다.
{{< /callout >}}

Ambient mode 도입기 시리즈의 3-3편이다. [3-1편]({{< relref "03-1-503-half-open-connection.md" >}})은 waypoint와 ztunnel 사이의 stale connection이 만든 503을, [3-2편]({{< relref "03-2-partially-enrolled-untaint-controller.md" >}})은 istio-cni와 ztunnel이 준비되기 전에 Pod이 스케줄되어 생기는 partially enrolled 문제를 다뤘다. 이번 편은 장애 추적이 아니라 버전 업그레이드 런북이다.

Ambient mode의 장점으로 자주 꼽히는 "사이드카가 없으니 앱 Pod을 재시작하지 않아도 된다"는 말은 사실이다. [사이드카 모드]({{< relref "../../01-mesh-basics.md" >}})에서 프록시 버전을 올리려면 결국 워크로드 Pod을 다시 띄워야 했고, 그 롤아웃 자체가 [istiod에 xDS 부하]({{< relref "../../02-istiod-control-plane.md" >}})를 만드는 이벤트였다. Ambient에서는 그 재시작이 사라지고, 재시작해야 할 대상이 노드 위의 DaemonSet 두 개로 옮겨 간다.

Istio Slack의 `#ambient` 채널에도 업그레이드 절차 질문이 종종 올라온다. 채널팀이 참고한 thread의 고민도 같았다. `istio-cni`는 여러 release를 동시에 설치하기 어렵고, `ztunnel`은 `resourceName`으로 여러 DaemonSet을 만들 수 있어 보이지만 istiod의 설정값인 `trustedZtunnelName`과 묶여 있어 istiod의 revision canary처럼 다루기 어렵다. 그래서 채널팀은 ztunnel을 workload 단위가 아니라 node pool 단위로 blue-green 배포하는 방향을 선택했다.

원문이 정리한 결론은 한 문장이다.

> Ambient mode 업그레이드는 `istiod → istio-cni → ztunnel` 순서로 진행하되, ztunnel은 일반적인 rolling update보다 **blue-green node pool 방식**으로 접근하는 편이 안전하다.

## 1. 업그레이드 대상은 세 가지

Ambient mode의 버전 업그레이드는 세 컴포넌트를 대상으로 한다.

| 컴포넌트 | 역할 | 업그레이드 특성 |
| --- | --- | --- |
| `istiod` | Gateway controller, Envoy config 전파 | — |
| `istio-cni` | Pod 감지·iptables 설정·ztunnel 포트 구성 | in-place — 실행 중 Pod엔 보통 영향 없음 |
| `ztunnel` | node 단위 L4 data plane | 교체 시 해당 node의 long-lived connection이 reset될 수 있음 |

`istiod`나 `istio-cni`도 중요하지만, 실제 운영에서 가장 조심해야 하는 컴포넌트는 ztunnel이다. ztunnel은 노드마다 하나씩 떠 있고, 그 노드에 올라간 Ambient workload의 트래픽을 직접 처리하기 때문이다. ztunnel이 무엇을 어떻게 처리하는지는 [2편 Envoy config 해부]({{< relref "02-envoy-config-anatomy.md" >}})에서 다룬다.

{{< flow src="_flow/1-업그레이드-대상은-세-가지.json" />}}

## 2. Step 1 — istiod는 in-place로 업그레이드

먼저 control plane인 `istiod`를 업그레이드한다.

여기서 놓치기 쉬운 점은, Ambient 환경의 istiod가 config 전파뿐 아니라 Gateway controller 역할까지 수행한다는 것이다. Istio Gateway controller가 관리하는 Envoy 워크로드는 istiod의 revision·버전과 맞물려 있어, istiod를 업그레이드하면 istio-gateway도 새 Envoy 이미지·설정으로 자동 rollout된다. 업그레이드 후에는 gateway 쪽도 같이 확인해야 한다.

Istio는 graceful shutdown을 지원하므로 control plane과 gateway rollout이 곧바로 서비스 중단으로 이어지지 않는 것이 정상이다. 다만 업그레이드 중에 채널팀이 확인하는 항목은 다음과 같다.

- 새 istiod revision이 정상적으로 뜨는가?
- gateway/waypoint가 의도한 revision을 보고 있는가?
- xDS sync가 깨지지 않았는가?
- control plane 에러 로그가 증가하지 않는가?

원문 밖 배경으로 덧붙이면, istiod를 여러 대로 굴리는 환경에서 xDS 커넥션이 재배치되지 않는 성질은 [09 istiod 스케일링과 xDS 커넥션 재분배]({{< relref "../../09-istiod-scaling-connections.md" >}})에서 다뤘다. istiod Pod이 교체되는 순간은 커넥션이 강제로 재수립되는 몇 안 되는 시점이기도 하다. 원문은 여기까지 파고들지 않고 "xDS sync가 깨지지 않았는가"를 체크 항목으로 두는 데서 멈춘다.

## 3. Step 2 — istio-cni는 in-place로 업그레이드

Ambient mode에서 `istio-cni`는 노드 안의 Pod를 감지하고, Pod network namespace 안에 redirection rule을 설정해 트래픽이 `ztunnel`을 거치도록 만든다. 이 과정에서 ztunnel은 해당 Pod network namespace 안에 redirection socket을 준비하고, workload Pod의 inbound/outbound 트래픽은 이 경로를 통해 처리된다.

istio-cni 업그레이드는 Kubernetes DaemonSet rollout으로 이루어진다.

### 왜 이게 "in-place"로 성립하는가

핵심은 network namespace가 언제 만들어지는가다. 이미 실행 중인 Pod은 network namespace가 생성될 때 redirection rule과 ztunnel로 향하는 경로가 함께 준비된다. istio-cni Pod이 재시작돼도 그 namespace가 다시 만들어지지는 않는다. istio-cni는 트래픽이 지나가는 길이 아니라 길을 깔아 주는 쪽이어서, 기존 Pod의 트래픽이 곧바로 끊기는 data plane 교체가 되지 않는다.

### 위험은 rollout 틈에 새로 뜨는 Pod에 있다

in-place가 허용되는 이유는 이때의 실패가 조용히 망가진 상태로 뜨는 쪽이 아니라 시끄럽게 실패하고 재시도되는 쪽이기 때문이다.

{{< seq src="_seq/위험은-rollout-틈에-새로.json" />}}

### 버전 호환 규칙

Istio가 제시하는 CNI 버전 호환성은 다음과 같다.

> `v1.x` istio-cni는 `v1.x` 및 `v1.x+1` control plane과 호환된다. (ztunnel도 마찬가지)

따라서 일반적인 업그레이드 순서는 control plane을 먼저 올리고 그다음 CNI를 올리는 것이다. 노드 컴포넌트가 control plane보다 한 마이너 뒤처져 있는 상태는 허용되지만, 그 반대는 보장되지 않는다.

다만 [3-2편]({{< relref "03-2-partially-enrolled-untaint-controller.md" >}})에서 다룬 것처럼, istio-cni 및 ztunnel이 준비되지 않은 상태에서 workload Pod이 먼저 뜨는 race condition은 여전히 관측될 수 있다. 이때의 `FailedCreatePodSandBox`도 영구 장애라기보다 istio-cni가 준비될 때까지 Pod 생성이 재시도되는 현상으로 보고 있다. 그래서 CNI 업그레이드에서 채널팀이 보는 것은 기존 Pod의 연결 상태가 아니라 다음 두 가지다.

| 확인 대상 | 무엇을 보는가 |
| --- | --- |
| istio-cni DaemonSet | rollout이 정상적으로 끝나는가 |
| 신규 생성 Pod | redirection이 누락되거나 pending 상태로 남는 Pod이 없는가 |

## 4. Step 3 — ztunnel은 blue-green node pool로 업그레이드

ztunnel은 Ambient mode의 data plane이다. `v1.x` ztunnel은 `v1.x` 및 `v1.x+1` control plane과 호환되므로, control plane을 먼저 업그레이드한 뒤 ztunnel을 옮길 수 있다. 문제는 버전 호환이 아니라 업그레이드 방식이다.

{{< callout type="warning" >}}
ztunnel은 graceful shutdown을 지원하지만 이 시간을 길게 잡는 것은 권장되지 않고, **기본값도 30초 수준**이다.

즉 ztunnel upgrade를 무조건 무중단으로 볼 수는 없다.
{{< /callout >}}

{{< seq src="_seq/4-step-ztunnel-은-blue.json" />}}

이건 채널팀만의 판단이 아니다. Istio의 [Ztunnel Safe Upgrade 이슈](https://github.com/istio/istio/issues/51126)에서도 in-place hitless upgrade나 같은 노드에서 여러 ztunnel revision을 활성화하는 것은 범위 밖으로 두고, node drain 기반 절차를 문서화하는 방향으로 논의되고 있다.

사이드카에서는 프록시가 Pod에 붙어 있으니 revision canary로 워크로드 단위 카나리가 가능했다. ztunnel은 노드에 붙어 있으므로 카나리의 단위도 노드가 된다.

### 4.1 Green ztunnel 리소스 생성

먼저 기존 ztunnel과 새 ztunnel을 서로 다른 node label에 매핑한다. 기존 버전을 `ztunnel-a`, 새 버전을 `ztunnel-b`로 둔다.

```yaml
ztunnel-a:
  enabled: true
  resourceName: ztunnel-a
  nodeSelector:
    node.channel.io/istio-version: 1.25.0

ztunnel-b:
  enabled: true
  resourceName: ztunnel-b
  nodeSelector:
    node.channel.io/istio-version: 1.26.2
```

핵심은 ztunnel 버전별로 `nodeSelector`를 다르게 주는 것이다. 그러면 기존 노드에서는 기존 ztunnel이 계속 돌고, 새 노드에서는 새 ztunnel만 뜬다. 두 DaemonSet의 nodeSelector가 겹치지 않으므로 한 노드에 ztunnel이 둘 뜨는 일도 없다.

여기까지만 하면 반쪽이다. ztunnel의 resource 이름을 바꾸거나 여러 ztunnel DaemonSet을 동시에 운영하려면 `istiod` 설정도 같이 맞춰야 한다. istiod Helm chart는 기본적으로 ztunnel의 이름을 `ztunnel`로 가정한다. 따라서 `ztunnel-a`, `ztunnel-b`를 쓰려면 istiod가 신뢰할 ztunnel service account 목록에 두 이름을 모두 추가해야 한다.

```yaml
istiod:
  env:
    CA_TRUSTED_NODE_ACCOUNTS: "istio-system/ztunnel-a,istio-system/ztunnel-b"
```

{{< callout type="important" >}}
이 설정이 빠지면 새 `resourceName`으로 뜬 ztunnel이 istiod와 신뢰 관계를 맺지 못할 수 있다. green ztunnel을 만드는 작업에는 **istiod의 trusted node account 설정 변경까지 포함된다.**
{{< /callout >}}

서두에서 말한 "istiod의 revision canary처럼 다루기 어렵다"가 이 제약이다. ztunnel DaemonSet은 복제할 수 있어도, 그 이름을 신뢰하는 쪽은 control plane에 하나의 목록으로 남아 있다. 배경으로 덧붙이면 이 값은 ztunnel이 노드 위 워크로드를 대신해 인증서를 받을 수 있는 service account를 istiod에 알려 주는 설정인데, 원문은 그 내부 동작까지는 설명하지 않고 "두 이름을 모두 추가해야 한다"까지만 밝힌다.

### 4.2 Green NodePool 구성

다음으로 새 ztunnel이 뜰 green node pool을 만든다. Karpenter를 사용한다면 NodePool template에 새 istio version label을 붙인다.

```yaml
apiVersion: karpenter.sh/v1beta1
kind: NodePool
metadata:
  name: channel-general
spec:
  template:
    metadata:
      labels:
        node.channel.io/istio-version: 1.26.2
```

{{< flow src="_flow/4-2-green-nodepool-구성.json" />}}

### 4.3 Blue node를 점진적으로 drain한다

green node pool과 green ztunnel이 준비되면, 기존 blue node를 점진적으로 비운다.

```bash
kubectl cordon <blue-node>
kubectl drain <blue-node> --ignore-daemonsets --delete-emptydir-data
```

이때 **stateless workload부터 옮기는 것이 안전하다.** Stateful workload나 long-running job은 PDB, local storage, connection 특성 때문에 오래 남을 수 있다. 그래서 `ztunnel-a`를 완전히 제거하는 시점은 생각보다 늦어질 수 있다.

원문이 제시한 운영 절차는 다음과 같다.

1. green node pool 생성
2. green node에서 `ztunnel-b` Ready 확인
3. blue node를 조금씩 cordon/drain
4. workload가 green node로 이동하는지 확인
5. 5xx, TCP reset, latency 지표 확인
6. `ztunnel-a`가 올라간 node가 더 이상 없으면 `ztunnel-a` 제거

이 절차에서 5번 항목이 실질적인 게이트다. workload가 green node로 옮겨 간 직후에 5xx나 TCP reset이 늘면, 그건 새 ztunnel이 기존 트래픽 패턴을 그대로 처리하지 못하고 있다는 신호다. [3-1편]({{< relref "03-1-503-half-open-connection.md" >}})이 다룬 half-open connection 계열의 증상이 여기서 다시 나타날 수 있다.

## 5. Step 4 — NodeGroup 정리

모든 workload가 green node pool로 이동했고, 더 이상 blue ztunnel이 필요한 노드가 없다면 기존 NodeGroup을 정리한다. 원문은 이 단계를 한 문장으로만 언급하고 세부 절차는 밝히지 않는다.

## 6. 정리 — 컴포넌트별 업그레이드 방식 대조

- **`istiod`** — 방식: in-place. 재시작 대상: istiod Pod + gateway Envoy. 주 위험: gateway가 같이 rollout된다는 사실을 놓치는 것. 확인 지표: revision 상태, xDS sync, control plane 에러 로그
- **`istio-cni`** — 방식: in-place (DaemonSet rollout). 재시작 대상: istio-cni Pod. 주 위험: rollout 틈에 생성되는 Pod의 `FailedCreatePodSandBox`. 확인 지표: DaemonSet rollout 완료, redirection 누락·pending Pod
- **`ztunnel`** — 방식: blue-green node pool. 재시작 대상: 노드 전체 (workload 재스케줄). 주 위험: graceful shutdown 30초를 넘긴 long-lived connection 절단. 확인 지표: 5xx, TCP reset, latency

아래 대조는 원문이 직접 말한 것이 아니라, 이 지식베이스의 사이드카 모드 문서들과 맞춰 읽기 위한 정리다.

| 항목 | 사이드카 모드 | Ambient mode |
| --- | --- | --- |
| 프록시가 붙는 위치 | Pod | 노드 |
| 프록시 업그레이드 시 재시작 | 워크로드 Pod 전부 | 노드 DaemonSet (앱 Pod 무재시작) |
| 카나리의 자연스러운 단위 | 워크로드 (revision label) | 노드 (node pool) |
| 업그레이드 중 부하가 몰리는 곳 | istiod의 xDS push ([02]({{< relref "../../02-istiod-control-plane.md" >}}) · [09]({{< relref "../../09-istiod-scaling-connections.md" >}})) | 노드 drain과 재스케줄 |

Ambient mode 업그레이드는 Istio 버전 하나를 올리는 작업이 아니라 성격이 다른 세 컴포넌트를 순서대로 다루는 작업이다. 원문의 결론 세 줄은 다음과 같다.

- `istiod`는 먼저 업그레이드하고 gateway/waypoint 상태를 확인한다.
- `istio-cni`는 in-place로 업그레이드하되, untaint-controller 및 `ambient.istio.io/redirection: enabled` annotation들을 확인한다.
- `ztunnel`은 가장 조심해야 하며, 가능하면 blue-green node pool 방식으로 node 단위 migration을 수행한다.

## 이 문서에서 가져갈 것

- 앱 재시작이 사라진 대신 재시작 대상이 워크로드 Pod에서 노드 위 DaemonSet 두 개로 옮겨 갔다. 그중 ztunnel은 트래픽이 실제로 지나가는 경로다.
- **데이터 플레인의 배포 단위가 카나리의 단위를 결정한다.** 프록시가 Pod에 있으면 워크로드 카나리가 되고, 노드에 있으면 노드 풀 카나리가 된다. ztunnel을 revision canary로 다루기 어려운 이유는 istiod의 trusted account 설정(`CA_TRUSTED_NODE_ACCOUNTS` / `trustedZtunnelName`)이 이름 하나에 묶여 있기 때문이다.
- graceful shutdown이 있다고 무중단은 아니다. 30초 유예는 짧은 요청만 지켜 주고 long-lived connection에는 무의미해서, 유예를 늘리는 대신 연결이 끊기는 지점 자체를 우회하는 쪽(node drain)을 택했다.
- in-place를 허용할지는 실패 모드가 갈랐다. istio-cni rollout 중의 `FailedCreatePodSandBox`는 시끄럽게 실패하고 재시도되는 쪽이라 넘어갈 수 있다. Pod이 redirection 없이 Running으로 떠 버린다면 같은 판단을 내릴 수 없다.
- blue-green은 끝나는 시점을 운영자가 정하지 못한다. stateful workload와 PDB 때문에 blue node가 오래 남고, 그동안 두 ztunnel 버전과 두 node pool을 동시에 운영해야 한다. 이 병존 기간의 비용을 계획에 넣는다.

## 소스

- **원문**: [Istio 3-3편: Ambient mode 안전하게 업그레이드하기](https://tech.channel.io/kr/articles/tech-istio-cni-in-place-b004fdb9) (채널코퍼레이션 기술 블로그, 딜런·재티(정재홍), 2026-07-08)
- 원문이 인용한 Istio Slack thread: [`#ambient` — Ambient upgrade procedure](https://istio.slack.com/archives/C041EQL1XMY/p1776272824502379)
- 원문이 인용한 Istio 이슈: [Ztunnel Safe Upgrade (istio/istio#51126)](https://github.com/istio/istio/issues/51126)
- Istio 공식문서 — [Upgrading Ambient Mode](https://istio.io/latest/docs/ops/ambient/upgrade/) (istio-cni·ztunnel의 `v1.x` / `v1.x+1` control plane 호환 규칙)
- 시리즈 형제 문서: [1편 왜 Ambient mode인가]({{< relref "01-why-ambient-mode.md" >}}) · [2편 Envoy config 해부]({{< relref "02-envoy-config-anatomy.md" >}}) · [3-1편 503과 Half-open Connection]({{< relref "03-1-503-half-open-connection.md" >}}) · [3-2편 Partially Enrolled Pod]({{< relref "03-2-partially-enrolled-untaint-controller.md" >}}) · [3-4편 507과 istiod disconnected]({{< relref "03-4-507-istiod-disconnected.md" >}})
