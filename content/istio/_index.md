---
title: "Istio"
weight: 5
cascade:
  type: docs
---

# Istio · 서비스 메시 운영기 — EKS 위에 메시를 얹고 겪은 것들

> EKS 클러스터에 Istio를 올려 운영하면서 실제로 부딪힌 일들을 스토리 순서로 정리한 챕터다. **컨트롤 플레인이 CPU를 먹어 증설했던 일**, **Ingress Gateway를 전용 노드로 분리한 일**, **메시 설정을 Git으로 동기화한 일**, 그리고 **간헐적 응답 이상 장애를 메시 관점에서 추적한 일** — 네 개의 사건을 척추로 삼고, 그 밑에 깔린 Istio 메커니즘을 하나씩 파고든다.

> 자매 챕터: [로깅 · 옵저버빌리티]({{< relref "../logging/_index.md" >}}) — istio 액세스 로그를 어디에 쌓을지는 그쪽 로그 스택 결정과 이어진다. · [VictoriaMetrics]({{< relref "../monitoring/victoriametrics/_index.md" >}}) — 메시가 뿜는 텔레메트리를 받는 저장 계층.

## 왜 이걸 정리하는가

서비스가 수십 개로 늘면 mTLS·재시도·트래픽 분할·관측성을 **애플리케이션마다** 구현하는 부담이 감당이 안 된다. 그래서 이 공통 관심사를 인프라 레이어로 내리는 게 서비스 메시고, 그 대가로 운영자는 **데이터 플레인의 사이드카 오버헤드**와 **컨트롤 플레인의 부하**를 떠안는다. 이 챕터의 네 사건은 전부 그 "대가"를 관리한 기록이다. 메시를 처음 얹는 것보다, 얹고 나서 **규모가 커질 때 무엇이 터지는지**가 훨씬 중요하다.

## 문서 지도

| 문서 | 주제 | 스토리 앵커 | 한 줄 요약 |
|------|------|------------|-----------|
| [01 서비스 메시와 Istio 기초]({{< relref "01-mesh-basics.md" >}}) | 기초 | 왜 EKS에 메시를 얹나 | 사이드카/컨트롤 플레인 구조, 메시가 해주는 것과 그 비용 |
| [02 컨트롤 플레인 해부: istiod]({{< relref "02-istiod-control-plane.md" >}}) | 컨트롤 플레인 | istiod CPU 증설·리소스 최적화 | xDS push 메커니즘, istiod가 CPU를 먹는 이유, 진짜 해법 |
| [03 데이터 플레인과 Ingress Gateway]({{< relref "03-gateway-node-isolation.md" >}}) | 데이터 플레인 | Gateway 전용 노드 분리 | Envoy 데이터 경로, 게이트웨이를 왜/어떻게 노드로 격리하나 |
| [04 설정을 코드로: GitOps]({{< relref "04-config-as-code.md" >}}) | 형상 관리 | Manifest Sync | IstioOperator·Helm·GitOps, 메시 설정 드리프트를 없애는 법 |
| [05 장애 이야기: 간헐적 응답 이상]({{< relref "05-incident-intermittent-5xx.md" >}}) | 트러블슈팅 | 간헐적 응답 이상 인시던트 | 메시가 낀 요청 경로에서 5xx·지연을 추적하는 순서 |
| [06 메시가 공짜로 주는 관측성]({{< relref "06-observability-points.md" >}}) | 관측성 | 얻게 되는 모니터링 포인트 | 표준 골든 시그널·라벨, 액세스 로그, 트레이싱, 카디널리티 비용 |
| [07 nginx에서 Istio로]({{< relref "07-from-nginx-to-istio.md" >}}) | 이주 | rewrite·헤더·인가 | nginx 지시어 → VirtualService·AuthorizationPolicy·ext_authz 대응 |
| [08 EnvoyFilter — 표준 CRD의 탈출구]({{< relref "08-envoyfilter-extension.md" >}}) | 확장 | 저수준 조작 | Envoy 설정 직접 패치, 레이트 리밋(local/global), Lua·WASM |

## 읽는 순서

- **처음이라면** 01로 메시의 구조와 비용을 잡고, 02(컨트롤 플레인) → 03(데이터 플레인)으로 두 축을 나눠 이해한다.
- **운영자라면** 02와 03이 실무 직결이다. istiod가 왜 헐떡이는지(02)와 게이트웨이를 왜 격리하는지(03)는 규모가 커질 때 반드시 만난다.
- **장애 대응 관점이면** 05를 먼저 훑어 "메시가 낀 경로에서 무엇부터 의심하나"의 체크리스트를 잡고, 필요한 개념은 02·03으로 되짚는다.
- **메시로 무엇을 얻나가 궁금하면** 06(관측성)으로 공짜로 얻는 모니터링 포인트를, 07(nginx→Istio)로 기존 nginx 설정이 어디로 갔는지를, 08(EnvoyFilter)로 표준 CRD 밖의 조작을 본다.

## 공통 핵심

- **메시는 공짜가 아니다.** 파드마다 붙는 사이드카 프록시가 CPU·메모리·지연을 더하고, 컨트롤 플레인은 프록시 수에 비례해 부하를 받는다. → [01]({{< relref "01-mesh-basics.md" >}})
- **istiod 부하 = f(프록시 수, 설정 변경 빈도, 설정 범위).** CPU 증설은 응급 처치고, 근본 해법은 각 프록시가 보는 설정 범위를 좁히는 것이다. → [02]({{< relref "02-istiod-control-plane.md" >}})
- **게이트웨이는 데이터 경로의 병목이자 격리 대상이다.** 남북(north-south) 트래픽을 받는 Ingress Gateway는 워크로드와 자원을 다투면 안 되므로 전용 노드로 뺀다. → [03]({{< relref "03-gateway-node-isolation.md" >}})
- **메시 설정은 손이 아니라 Git으로 관리한다.** VirtualService·DestinationRule 같은 CRD가 손으로 바뀌면 드리프트가 장애로 돌아온다. → [04]({{< relref "04-config-as-code.md" >}})
- **관측성은 공짜로 얻지만 카디널리티는 공짜가 아니다.** 사이드카가 앱 무수정으로 표준 골든 시그널을 뿜는다 — 대신 라벨 폭발을 관리해야 한다. → [06]({{< relref "06-observability-points.md" >}})
- **nginx가 한 파일에 하던 걸 Istio는 CRD로 흩는다.** rewrite·헤더·인가가 VirtualService·AuthorizationPolicy·ext_authz로 갈리고, 그래도 안 되는 건 EnvoyFilter가 최후의 수단이다. → [07]({{< relref "07-from-nginx-to-istio.md" >}}) · [08]({{< relref "08-envoyfilter-extension.md" >}})
