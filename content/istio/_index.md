---
title: "Istio"
weight: 50
cascade:
  type: docs
---

# Istio · 서비스 메시 운영기 — EKS 위에 메시를 얹고 겪은 것들

EKS 클러스터 위에서 Istio를 굴리며 실제로 부딪힌 일들을 스토리 순서로 묶은 챕터입니다. 척추는 네 개의 사건입니다 — 컨트롤 플레인이 CPU를 먹어 증설했던 일, Ingress Gateway를 전용 노드로 분리한 일, 메시 설정을 Git으로 동기화한 일, 간헐적 응답 이상 장애를 메시 관점에서 추적한 일. 그 밑에 깔린 Istio 메커니즘을 하나씩 파고듭니다.

자매 챕터: [로깅 · 옵저버빌리티]({{< relref "../logging/_index.md" >}}) — istio 액세스 로그를 어디에 쌓을지는 그쪽 로그 스택 결정과 이어집니다. · [VictoriaMetrics]({{< relref "../monitoring/victoriametrics/_index.md" >}}) — 메시가 뿜는 텔레메트리를 받는 저장 계층.

## 왜 이걸 정리하는가

서비스가 수십 개로 늘면 mTLS·재시도·트래픽 분할·관측성을 애플리케이션마다 구현하는 부담을 감당할 수 없습니다. 이 공통 관심사를 인프라 레이어로 내려버린 게 서비스 메시입니다. 대신 운영자가 데이터 플레인의 사이드카 오버헤드와 컨트롤 플레인의 부하를 떠안습니다. 이 챕터의 네 사건은 전부 그 "대가"를 관리한 기록입니다. 메시를 처음 올리는 것보다 올리고 나서 규모가 커질 때 무엇이 터지는지가 훨씬 중요합니다.

## 문서 지도

- [01 서비스 메시와 Istio 기초]({{< relref "01-mesh-basics.md" >}}) (기초 · 왜 EKS에 메시를 얹나) — 사이드카/컨트롤 플레인 구조, 메시가 해주는 것과 그 비용
- [02 컨트롤 플레인 해부: istiod]({{< relref "02-istiod-control-plane.md" >}}) (컨트롤 플레인 · istiod CPU 증설·리소스 최적화) — xDS push 메커니즘, istiod가 CPU를 먹는 이유, 진짜 해법
- [03 데이터 플레인과 Ingress Gateway]({{< relref "03-gateway-node-isolation.md" >}}) (데이터 플레인 · Gateway 전용 노드 분리) — Envoy 데이터 경로, 게이트웨이를 왜/어떻게 노드로 격리하나
- [04 설정을 코드로: GitOps]({{< relref "04-config-as-code.md" >}}) (형상 관리 · Manifest Sync) — IstioOperator·Helm·GitOps, 메시 설정 드리프트를 없애는 법
- [05 장애 이야기: 간헐적 응답 이상]({{< relref "05-incident-intermittent-5xx.md" >}}) (트러블슈팅 · 간헐적 응답 이상 인시던트) — 메시가 낀 요청 경로에서 5xx·지연을 추적하는 순서
- [06 메시가 공짜로 주는 관측성]({{< relref "06-observability-points.md" >}}) (관측성 · 얻게 되는 모니터링 포인트) — 표준 골든 시그널·라벨, 액세스 로그, 트레이싱, 카디널리티 비용
- [07 nginx에서 Istio로]({{< relref "07-from-nginx-to-istio.md" >}}) (이주 · rewrite·헤더·인가) — nginx 지시어 → VirtualService·AuthorizationPolicy·ext_authz 대응
- [08 EnvoyFilter — 표준 CRD의 탈출구]({{< relref "08-envoyfilter-extension.md" >}}) (확장 · 저수준 조작) — Envoy 설정 직접 패치, 레이트 리밋(local/global), Lua·WASM
- [09 istiod 스케일링과 xDS 커넥션 재분배]({{< relref "09-istiod-scaling-connections.md" >}}) (컨트롤 플레인 · 이벤트 중 istiod 8대 재시작) — 커넥션 단가가 변하는 이유, 재분배가 없는 이유, keepalive·스코핑 손잡이
- [10 Ambient 이행 심사]({{< relref "10-ambient-migration-questions.md" >}}) (이행 검토 · 사이드카에서 Ambient로 간다면) — 01~09의 결론 중 무엇이 무효가 되고 무엇이 재심사 대상인가
- [11 요청 경로 해부]({{< relref "11-request-path-anatomy.md" >}}) (경로 · 요청 하나를 끝까지 따라가기) — istio-agent 배선, 남북·동서 경로, L7 파싱 지점 = 기능이 생기는 지점, 포트 지도
- [12 Envoy가 제공하는 것]({{< relref "12-envoy-capabilities.md" >}}) (부품 · Istio를 걷어내고 프록시 하나만 보기) — 재시도·서킷 브레이킹·로드밸런싱·관측성은 Envoy가 이미 가진 기능, xDS는 Envoy의 API
- [13 Istio의 Envoy 조립]({{< relref "13-istio-envoy-assembly.md" >}}) (조립 · proxyv2 이미지부터 CRD 번역까지) — 확장 컴파일된 Envoy 빌드, CRD→xDS 번역, Envoy 커밋 pin, 내장 확장과 사용자 확장의 차이
- [14 왜 서비스 메시인가]({{< relref "14-why-service-mesh.md" >}}) (채택 판단 · 대안 스펙트럼과 손익 분석) — 라이브러리·게이트웨이·사이드카·ambient 넷 중 언제 메시가 이기는가, 사이드카 비용 수치
- [15 CRD 카탈로그와 연계]({{< relref "15-crd-catalog.md" >}}) (CRD 카탈로그 · 14개 리소스가 서로를 참조하는 축) — 트래픽 축(Gateway→VirtualService→DestinationRule→엔드포인트)과 보안 축(PeerAuthentication↔DestinationRule tls, RequestAuthentication→AuthorizationPolicy) 짝 맞추기, 버전 컬럼에 드러나는 성숙도
- [16 1.20 → 1.24 변경사항]({{< relref "16-changelog-1.20-1.24.md" >}}) (버전별 변경 · ambient가 실험에서 나온 구간) — ambient Beta(1.22)·GA(1.24), IstioOperator 계열 폐기로 설치 경로가 강제 변경, API `v1` 승격은 추가이지 이동이 아닙니다
- [17 1.25 → 1.30 변경사항]({{< relref "17-changelog-1.25-1.30.md" >}}) (버전별 변경 · ambient를 안 써도 피할 수 없는 것들) — native sidecar 기본화(파드 스펙·기동·종료 세맨틱 변경), base·istiod 차트 통합과 리소스 개명, 경고 없이 깨지는 플래그·메트릭 기본값

01~09는 전부 Sidecar mode 기준입니다. 같은 문제를 Ambient mode로 푼 외부 팀의 프로덕션 기록은 하위 섹션 [Ambient mode 도입기 (채널코퍼레이션)]({{< relref "ambient/_index.md" >}})에 대조군으로 따로 모아 두었습니다.

## 읽는 순서

- 처음이라면 01에서 메시의 구조와 비용을 잡은 뒤 02(컨트롤 플레인) → 03(데이터 플레인)으로 두 축을 나눠 이해합니다.
- 운영자라면 02와 03이 실무 직결입니다. istiod가 왜 헐떡이는지(02), 게이트웨이를 왜 격리하는지(03) — 규모가 커지면 반드시 만나는 두 질문입니다.
- 장애 대응 관점이면 05부터 훑어 "메시가 낀 경로에서 무엇부터 의심하나" 체크리스트를 손에 쥐고 개념이 필요할 때 02·03으로 되짚습니다.
- 메시로 무엇을 얻나가 궁금하면 06(관측성)에서 공짜로 얻는 모니터링 포인트를 봅니다. 07(nginx→Istio)에서 기존 nginx 설정이 어디로 갔는지 확인한 다음 08(EnvoyFilter)에서 표준 CRD 밖의 조작을 봅니다.
- istiod를 오토스케일링하려면 02로 부하의 구조를 잡고 09로 넘어갑니다. 09가 답하는 질문은 "몇 대를 띄울까"가 아니라 "커넥션이 어느 파드로 가는가"입니다.
- 요청이 실제로 어디를 지나는지 궁금하면 11로 갑니다. 01(구조)·02(컨트롤 플레인)·03(게이트웨이)이 나눠 든 조각을 클라이언트→앱 경로 하나로 꿴 배선도입니다.
- Ambient mode가 궁금하면 01~09로 사이드카 모드의 비용 구조를 먼저 잡고 [10 Ambient 이행 심사]({{< relref "10-ambient-migration-questions.md" >}})로 그 비용 구조 중 무엇이 무효가 되는지 본 뒤 하위 섹션 [Ambient mode 도입기]({{< relref "ambient/_index.md" >}})로 갑니다. 프록시가 파드에서 노드로 옮겨 가면 무엇이 달라지는지를 다룹니다.
- 버전을 올려야 한다면 [16]({{< relref "16-changelog-1.20-1.24.md" >}})·[17]({{< relref "17-changelog-1.25-1.30.md" >}})이 1.20부터 1.30까지 마이너 11개의 변경을 "무엇을 조치해야 하나"로 정리합니다. 우리 클러스터의 실제 이관 절차·차트·리스크는 [eks-upgrade / istio]({{< relref "../eks-upgrade/components/02-istio.md" >}}) 소관입니다. 16·17은 그 절차가 통과할 변경 목록을 추려 둔 쪽입니다.
- Envoy가 궁금하면 [12 Envoy가 제공하는 것]({{< relref "12-envoy-capabilities.md" >}})으로 부품 자체를 본 뒤 [13 Istio의 Envoy 조립]({{< relref "13-istio-envoy-assembly.md" >}})으로 넘어갑니다. 메시 채택 여부를 판단해야 한다면 [14 왜 서비스 메시인가]({{< relref "14-why-service-mesh.md" >}})를 봅니다.
- CRD가 뭐가 있고 서로 어떻게 엮이는지 한자리에서 보려면 15 — 각 리소스의 깊은 내용은 15가 가리키는 문서로.

## 공통 핵심

- 메시는 공짜가 아닙니다. 파드마다 붙는 사이드카 프록시가 CPU·메모리·지연을 더합니다. 컨트롤 플레인은 프록시 수에 비례해 부하를 받습니다. → [01]({{< relref "01-mesh-basics.md" >}})
- istiod 부하 = f(프록시 수, 설정 변경 빈도, 설정 범위). CPU 증설은 응급 처치에 그치고 근본 해법은 각 프록시가 보는 설정 범위를 좁히는 것입니다. → [02]({{< relref "02-istiod-control-plane.md" >}})
- xDS 커넥션은 장수 gRPC라 스케일아웃해도 재분배되지 않습니다. 파드를 늘려도 기존 커넥션은 그 자리에 남으니 늘린 만큼 부하가 나눠지지 않습니다. Istio에 능동 재분배 기능은 없습니다. → [09]({{< relref "09-istiod-scaling-connections.md" >}})
- 게이트웨이는 데이터 경로의 병목이자 격리 대상입니다. 남북(north-south) 트래픽을 받는 Ingress Gateway는 워크로드와 자원을 다투면 안 되므로 전용 노드로 뺍니다. → [03]({{< relref "03-gateway-node-isolation.md" >}})
- 메시 설정은 Git으로 관리합니다. VirtualService·DestinationRule 같은 CRD를 손으로 바꾸면 드리프트가 장애로 돌아옵니다. → [04]({{< relref "04-config-as-code.md" >}})
- 관측성은 공짜로 얻지만 카디널리티는 공짜가 아닙니다. 사이드카가 앱 무수정으로 표준 골든 시그널을 뿜습니다 — 대신 라벨 폭발을 관리해야 합니다. → [06]({{< relref "06-observability-points.md" >}})
- Ambient mode는 프록시 개수를 파드 수에서 노드 수로 옮깁니다. 사이드카 몫의 CPU·메모리는 줄지만 노드가 뜨고 지는 시점과 메시 데이터플레인이 준비되는 시점을 맞추는 일이 새 운영 축이 됩니다. → [Ambient mode 도입기]({{< relref "ambient/_index.md" >}})
- nginx가 한 파일에 하던 걸 Istio는 CRD로 흩습니다. rewrite·헤더·인가가 VirtualService·AuthorizationPolicy·ext_authz로 나뉩니다. 그래도 안 되는 건 EnvoyFilter가 최후의 수단입니다. → [07]({{< relref "07-from-nginx-to-istio.md" >}}) · [08]({{< relref "08-envoyfilter-extension.md" >}})
