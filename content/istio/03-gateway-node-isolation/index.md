---
title: "데이터 플레인과 Ingress Gateway"
date: 2026-08-01
lastmod: 2026-08-24
weight: 3
---

# 03 · 데이터 플레인과 Ingress Gateway — 게이트웨이를 왜 노드로 격리하나

{{< callout type="info" >}}
- 데이터 플레인 트래픽은 남북(Ingress Gateway)과 동서(사이드카)로 나뉩니다. Ingress Gateway는 독립적으로 뜬 Envoy로, 모든 외부 트래픽이 지나는 단일 통로입니다.
- 관문은 성능 크리티컬한 전역 급소입니다. noisy neighbor·자원 경쟁·보안 희석을 막으려 전용 노드로 격리합니다.
- 격리는 taint/toleration + nodeSelector로, 가용성은 AZ 분산·안티어피니티·PDB로, 독립 스케일은 HPA·전용 LB로 확보합니다.
- 대가는 노드 활용률↓·운영 대상↑이지만 관문의 성능·가용성·보안 값어치가 그 비용보다 큽니다.
{{< /callout >}}

외부 트래픽을 받는 Ingress Gateway가 일반 워크로드 파드들과 같은 노드에서 자원을 다퉜습니다. 트래픽이 몰리는 순간 게이트웨이가 옆 파드에 CPU·네트워크를 뺏기거나 반대로 게이트웨이가 노드를 잡아먹어 이웃이 흔들렸습니다 — 전형적인 noisy neighbor입니다. 그래서 게이트웨이를 전용 노드로 분리했습니다. 이 문서는 데이터 플레인 트래픽의 두 방향과 게이트웨이의 정체, 왜·어떻게 노드로 격리하는지를 정리합니다.

관련 문서: [01 메시 기초]({{< relref "01-mesh-basics.md" >}}) · [02 컨트롤 플레인]({{< relref "02-istiod-control-plane.md" >}}) · [05 장애 이야기]({{< relref "05-incident-intermittent-5xx.md" >}})

## 데이터 플레인 트래픽의 두 방향

메시 안의 트래픽은 두 방향으로 흐르고 방향마다 통과하는 프록시가 다릅니다.

{{< flow src="_flow/데이터-플레인-트래픽의-두.json" />}}

- North-south(남북) — 클러스터 바깥과 주고받는 트래픽. 외부 → 서비스 진입은 Ingress Gateway를, 서비스 → 외부는 Egress Gateway(쓸 경우)를 지납니다.
- East-west(동서) — 클러스터 안의 서비스 간 트래픽. 각 파드에 붙은 사이드카 Envoy가 처리합니다([01]({{< relref "01-mesh-basics.md" >}})의 그 사이드카).

이 문서의 주인공은 남북의 관문인 Ingress Gateway입니다.

## Ingress Gateway의 정체 — 그냥 독립적으로 뜬 Envoy

Ingress Gateway는 특별한 컴포넌트가 아닙니다. 사이드카와 똑같은 Envoy를 파드에 붙이지 않고 독립 Deployment로 띄운 것입니다. istiod에서 xDS 설정을 받아오는 방식도 같습니다. 역할만 다릅니다:

- 클라우드 로드밸런서(NLB/ALB)가 이 게이트웨이 파드로 외부 트래픽을 넣습니다.
- `Gateway` 리소스가 "어떤 포트·호스트·TLS로 받을지"를, `VirtualService`가 "받은 걸 어느 내부 서비스로 라우팅할지"를 정합니다.

```yaml
apiVersion: networking.istio.io/v1
kind: Gateway
metadata:
  name: web-gateway
spec:
  selector:
    istio: ingressgateway     # 이 셀렉터에 맞는 게이트웨이 파드가 설정을 받는다
  servers:
  - port: { number: 443, name: https, protocol: HTTPS }
    tls: { mode: SIMPLE, credentialName: web-cert }
    hosts: [ "www.example.com" ]
```

여기가 급소입니다. 외부 트래픽 전부가 이 한 계층을 통과합니다. 게이트웨이가 느리면 전 서비스가 느리고 게이트웨이가 죽으면 외부 진입이 통째로 막힙니다. east-west 사이드카는 장애가 해당 파드에 머물지만 게이트웨이 장애는 전역으로 번집니다.

## 왜 전용 노드로 분리하나

게이트웨이가 일반 워크로드와 노드를 공유하면 생기는 문제:

| 문제 | 내용 |
|---|---|
| **Noisy neighbor** | 트래픽 피크에 게이트웨이가 CPU·네트워크 대역을 두고 이웃 파드와 경쟁. 서로가 서로를 흔든다 |
| **자원 보장 실패** | 관문은 항상 여유 자원이 있어야 하는데, 옆 파드의 스파이크에 밀린다 |
| **스케일 독립성 부재** | 게이트웨이는 트래픽에, 워크로드는 처리량에 맞춰 스케일하는데 노드가 얽히면 따로 못 한다 |
| **네트워크 경로 비효율** | LB 타깃이 워크로드 노드 곳곳에 흩어져, 트래픽 경로·SG·모니터링이 지저분해진다 |
| **보안 경계 희석** | 외부에 노출된 관문과 내부 워크로드가 같은 노드에 있으면 공격면·폭발 반경이 커진다 |

원리는 하나입니다. 관문은 데이터 경로의 성능 크리티컬 지점이자 단일 통로이므로 자원과 장애를 워크로드와 공유하면 안 됩니다. 이게 분리의 이유 전부입니다.

## 어떻게 분리하나

### 1) 전용 노드풀 + taint/toleration

게이트웨이 전용 노드풀을 만들고 taint를 걸어 일반 파드가 못 들어오게 막습니다. 게이트웨이에만 toleration과 nodeSelector를 줘서 그 노드에만 뜨게 합니다.

```yaml
# 노드풀: taint = dedicated=ingress-gateway:NoSchedule
# 게이트웨이 Deployment
spec:
  template:
    spec:
      nodeSelector:
        dedicated: ingress-gateway
      tolerations:
      - key: dedicated
        operator: Equal
        value: ingress-gateway
        effect: NoSchedule
```

일반 워크로드는 toleration이 없으니 이 노드에 못 오고 게이트웨이는 nodeSelector 때문에 다른 노드에 안 갑니다. → 완전 격리.

### 2) 가용성: AZ 분산과 안티어피니티

관문이 전역 급소인 만큼 가용성이 중요합니다.

- 노드풀을 여러 AZ에 걸친 뒤 `topologySpreadConstraints`(또는 `podAntiAffinity`)로 게이트웨이 파드를 AZ·노드에 고르게 흩뿌립니다. 노드나 AZ 하나가 빠져도 관문이 삽니다.
- 게이트웨이 파드는 최소 2개 이상 두고 `PodDisruptionBudget`으로 동시 축출을 제한합니다.

### 3) 스케일·네트워크 독립

- 게이트웨이에 HPA를 트래픽 지표(CPU 또는 커넥션·RPS)로 걸어 워크로드와 무관하게 스케일합니다.
- 전용 노드풀 앞에 전용 NLB/ALB를 두면 LB 타깃이 이 노드들로 모여 트래픽 경로·보안그룹·모니터링이 단순해집니다.

## 트레이드오프

공짜 격리는 없습니다.

- 노드 활용률↓ — 전용 노드는 게이트웨이만 쓰므로 자원이 남아 놉니다. 가용성(AZ별 최소 노드) 요구와 겹치면 최소 노드 수·비용이 늘 수 있습니다.
- 운영 대상↑ — 관리할 노드풀이 하나 더 생깁니다.

그럼에도 분리하는 이유는 관문의 성능·가용성·보안이 노드 몇 대의 비용보다 훨씬 비싸기 때문입니다. 전역 급소에는 자원을 보장하는 쪽이 옳습니다.

## 이 문서에서 가져갈 것

- 데이터 플레인 트래픽은 남북(게이트웨이)과 동서(사이드카)로 갈립니다. Ingress Gateway는 독립적으로 뜬 Envoy로 모든 외부 트래픽의 단일 통로입니다.
- 관문은 성능 크리티컬한 전역 급소라 noisy neighbor·자원 경쟁·보안 희석을 피하려 전용 노드로 격리합니다.
- taint/toleration + nodeSelector로 격리하고 AZ 분산·안티어피니티·PDB로 가용성을, HPA·전용 LB로 독립 스케일을 확보합니다. 대가는 노드 활용률·비용이지만 관문의 값어치가 그보다 큽니다.
