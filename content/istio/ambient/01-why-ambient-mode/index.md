---
title: "왜 Ambient mode인가"
weight: 1
---

# 01 · 왜 Istio Ambient mode인가 — 사이드카를 건너뛴 선택 (2026-03)

{{< callout type="info" >}}
**참조한 내용정리** · 이 문서는 아래 원문을 읽고 우리 지식베이스 형식으로 재구성한 요약입니다. 원문 자체가 아니며, 정확한 워딩·전체 맥락·그림은 원문에서 확인합니다.
- **원문**: [Istio 1편: 왜 Istio Ambient mode인가?](https://tech.channel.io/kr/articles/tech-istio-ambient-mode-30cdf79a)
- **매체 · 게시일**: 채널코퍼레이션 기술 블로그 · 2026-03-20
- **저자**: Jetty · Dylan (채널코퍼레이션 DevOps팀)
{{< /callout >}}

{{< callout type="info" >}}
**한눈에**
- 채널팀은 2025년 3월부터 11월까지 약 8개월에 걸쳐 Istio를 프로덕션에 도입하면서 성숙한 Sidecar mode를 건너뛰고 2024년 말 Istio 1.24에서 GA된 **Ambient mode를 첫 도입 대상으로 골랐습니다**.
- 결정의 무게추는 **약 4,000개 파드**였습니다. 전부 사이드카를 붙이면 idle 상태에서만 수십~수백 vCPU와 **약 240Gi 메모리**가 순수하게 프록시로 나갑니다. ztunnel은 노드당 1개, waypoint는 namespace·service 단위라 증가폭이 훨씬 완만합니다.
- 컨트롤 플레인 쪽 이유는 **polynomial scaling problem**입니다. 사이드카 모드는 모든 사이드카가 메시 안 다른 모든 destination을 알아야 해서 설정 변경 하나가 파드 수만큼 전파되지만, Ambient는 전파 대상이 ztunnel과 waypoint로 줄어듭니다.
- 대가는 **SPoF**입니다. 사이드카는 장애 범위가 파드 하나였지만 ztunnel은 노드 전체, waypoint는 namespace 전체입니다. 거기에 HBONE·hop 증가로 디버깅이 어려워지고 GA 직후라 프로덕션 검증 사례가 적습니다.
- Ambient의 동작은 **istio-cni가 파드 네트워크 네임스페이스에 넣는 iptables 규칙**과 15001 · 15006 · 15008 세 포트로 요약됩니다. "in-pod ztunnel"이라는 이름과 달리 ztunnel은 노드 DaemonSet이고 파드 안에 있는 것은 그 DaemonSet이 붙는 localhost socket입니다.
{{< /callout >}}

이 챕터의 [01 서비스 메시와 Istio 기초]({{< relref "../../01-mesh-basics.md" >}})부터 [09 istiod 스케일링과 xDS 커넥션 재분배]({{< relref "../../09-istiod-scaling-connections.md" >}})까지는 전부 **Sidecar mode를 전제로 쓰인 문서**입니다. 파드마다 Envoy가 붙고 istiod가 그 프록시 전부에 xDS를 밀어 넣는 구조를 깔고 갑니다. 이 `ambient/` 하위 섹션은 그 전제 자체를 바꾼 팀의 기록입니다.

채널코퍼레이션 DevOps팀은 서비스 메시를 처음 도입하면서 이미 검증된 Sidecar mode 대신 Ambient mode를 택했습니다. 4,000개 파드라는 이미 확정된 규모 앞에서 사이드카의 단가 계산이 맞지 않았기 때문입니다. 여기서 정리하는 것은 그 의사결정의 근거와 결정 이후 팀이 새로 배워야 했던 Ambient의 구성요소(ztunnel · waypoint · istio-cni)와 프로토콜(HBONE), 그리고 트래픽 리다이렉션이 어떻게 걸리는지입니다.

시리즈는 세 편으로 나뉩니다. 1편(이 문서)이 도입 배경과 선택 이유, [2편]({{< relref "02-envoy-config-anatomy.md" >}})이 Envoy config로 들어가는 기술 상세, 3편이 프로덕션 운영 중 만난 문제와 해결입니다.

## 1. 왜 서비스 메시였나

채널팀이 서비스 메시에서 얻으려던 핵심 목표는 두 가지입니다.

| 목표 | 내용 |
| --- | --- |
| 네트워크 가시성 | L7 네트워크 metrics와 서비스 간 호출 관계 파악 |
| 카나리 배포 | L7 네트워크 통제를 통한 정교한 배포 구현 |

여기에 덤으로 기대한 것이 Distributed Tracing, Traffic Management, Circuit Breaking, mTLS·상호 인증입니다.

원문이 스스로 인정하듯 **개별 기능만 놓고 보면 서비스 메시가 필수는 아닙니다**. 트레이싱은 라이브러리로, 카나리는 배포 도구로, mTLS는 애플리케이션 레벨로도 어느 정도 됩니다. 다만 이 기능들을 통합적으로 제공하는 레이어에 투자하는 편이 늘어나는 서비스 규모와 인프라 확장성을 감안할 때 장기적으로 맞다고 판단했습니다. 메시가 무엇을 대신 해주고 그 대가가 무엇인지는 [01 서비스 메시와 Istio 기초]({{< relref "../../01-mesh-basics.md" >}})가 다룹니다.

## 2. 왜 Istio였나 — Linkerd와 Cilium을 놓은 이유

Istio 외에 Linkerd와 Cilium도 검토했습니다.

| 후보 | 검토 결과 |
| --- | --- |
| Linkerd | 가볍고 단순하지만, 사용 사례가 적어 참고할 자료가 부족했다 |
| Cilium | eBPF 기반 CNI로 알려져 있고, 채널팀은 이미 다른 CNI를 쓰고 있어 메시만을 위해 채택하기엔 부담이었다 |
| **Istio** | **커뮤니티와 생태계가 가장 크고, 레퍼런스와 자료가 가장 많다** |

Cilium을 뺀 것은 기능 문제가 아니었습니다. 이미 다른 CNI를 쓰고 있었고 서비스 메시를 위해 CNI를 갈아엎는 결정은 메시 도입보다 훨씬 큰 변경입니다.

## 3. Sidecar를 건너뛴 세 가지 이유

Istio를 고른 뒤 남은 질문은 "Sidecar냐 Ambient냐"였습니다. 채널팀은 세 가지 근거로 Ambient를 골랐습니다.

### 3.1 컨트롤 플레인 — polynomial scaling problem

Sidecar mode에서는 **모든 사이드카가 메시 안 다른 모든 destination의 정보를 알고 있어야 합니다.** 그래서 destination 하나의 설정이 바뀌면 그 변경을 모든 사이드카에 전파해야 합니다. 설정의 크기와 전파 대상의 수가 함께 커지면서 부하가 비선형으로 증가합니다. 원문은 이를 **polynomial scaling problem**이라 부릅니다.

Ambient mode에서 전파 대상은 **ztunnel과 waypoint**입니다. ztunnel은 노드당 1개, waypoint는 필요한 namespace·service에만 있으므로 전파 대상 자체가 몇 자릿수 줄어듭니다.

{{< flow src="_flow/3-1-컨트롤-플레인-polynomial-scaling.json" />}}

istiod가 CPU를 먹는 메커니즘은 [02 컨트롤 플레인 해부: istiod]({{< relref "../../02-istiod-control-plane.md" >}})가, 스케일아웃해도 xDS 커넥션이 재분배되지 않는 문제는 [09 istiod 스케일링과 xDS 커넥션 재분배]({{< relref "../../09-istiod-scaling-connections.md" >}})가 다룹니다. Ambient는 그 부하에서 프록시 수라는 항을 직접 줄이는 접근입니다.

### 3.2 데이터 플레인 — 4,000 파드에 붙는 프록시의 단가

채널팀은 약 **4,000개 Pod**을 운영 중입니다. Istio 공식 성능 문서 기준과 채널팀 자체 측정값은 다음과 같습니다.

| 대상 | 기준 | CPU | 메모리 | 출처 |
| --- | --- | --- | --- | --- |
| Sidecar (Envoy) | 1,000 RPS | 약 0.2 vCPU | 60Mi | Istio 공식 성능 문서 |
| ztunnel | 1,000 RPS | 약 0.06 vCPU | 12Mi | Istio 공식 성능 문서 |
| Sidecar (Envoy) | idle | 0.05~0.01 vCPU | 60Mi | 채널팀 측정 |
| Sidecar (Envoy) | 2,000 RPS | 0.8~1.2 vCPU | 300~500Mi | 채널팀 측정 |

같은 1,000 RPS를 처리할 때 **ztunnel의 CPU는 사이드카의 약 1/3, 메모리는 약 1/5**입니다. 그런데 더 큰 차이를 만드는 건 단가가 아니라 **개수**입니다. 4,000개 파드에 모두 사이드카를 붙이면 **idle 상태에서만 수십~수백 vCPU와 약 240Gi 메모리**가 순수하게 프록시에 소모됩니다(60Mi × 4,000 ≒ 240Gi). RPS가 낮은 파드에도 idle 오버헤드는 붙기 때문에 파드가 수천 개 단위면 이 고정비가 지배적이 됩니다.

Ambient mode에서는 ztunnel이 노드당 1개, waypoint가 namespace·service 단위이므로 파드가 늘어도 프록시 수가 같이 늘지 않고 증가폭이 훨씬 완만합니다.

### 3.3 Kubernetes Gateway API 지원

Kubernetes의 Ingress 리소스는 freeze되었고 Gateway API가 새로운 표준으로 자리잡는 중입니다. Istio 팀도 이 흐름에 맞춰 Gateway API를 기본 옵션으로 채택하는 방향으로 움직이고 있었습니다. 공식 문서도 Gateway API 기준으로 쓰이기 시작했습니다.

Gateway API 자체는 Sidecar mode에서도 쓸 수 있습니다. 다만 **Ambient mode의 공식 문서가 처음부터 Gateway API 기준으로 작성**되어 있어서 Ambient와 함께 도입하는 편이 자연스러웠다고 채널팀은 판단했습니다.

## 4. 그래도 Ambient는 비싸다 — 인정한 세 가지 단점

채널팀은 Ambient의 단점을 명시적으로 나열한 뒤 선택했습니다.

| 단점 | 내용 |
| --- | --- |
| 장애 영향 범위 확대 | 파드 단위였던 장애 범위가 노드·namespace 단위로 커진다 |
| 디버깅 난이도 증가 | 새 개념과 늘어난 hop 만큼 원인 추적이 까다롭다 |
| 낮은 성숙도 | GA 직후라 검증 사례가 적고 기존 API보다 덜 성숙하다 |

- **장애 영향 범위 확대**: Sidecar mode에서는 프록시가 파드와 lifecycle을 같이 해 장애 범위가 각 파드에 그칩니다. Ambient는 ztunnel(노드 단위)과 waypoint(namespace·service 단위)에 의존하므로 장애 시 노드 전체 혹은 namespace 전체로 영향이 번집니다. **Sidecar mode에는 없던 SPoF(Single Point of Failure)가 생깁니다.**
- **디버깅 난이도 증가**: ztunnel · waypoint · HBONE 같은 새 개념을 익혀야 하고 프록시와 hop이 늘어난 만큼 문제 원인 추적이 까다롭습니다.
- **낮은 성숙도**: GA 직후라 프로덕션에서 검증된 사례가 적었고 Sidecar mode와 기존 Istio API(예: VirtualService)에 비해 덜 성숙합니다.

### 팀 내 의사결정

원문은 팀 논의에서 나온 발언을 싣습니다.

> "2~3년 동안은 건드리지 않을 걸 선택하고 싶음. 차라리 시간을 들이고 깊게 고민해서 결정했으면 좋겠음."

> "네트워크 트래픽에 대한 조작과 가시성이 핵심임. 그것만 잘 되면 Ambient mode도 상관없음. 대신 버그나 안정성이 걸리긴 함."

> "리소스 측면 제외하고는 Sidecar 장점이 많아 보이는데, 다양한 기능을 사용하지 않을 거면 Ambient. 문제 발생 빈도보다는 장애 복구 속도에 집중해야 함."

세 발언을 관통하는 기준은 **"장애가 안 나는 쪽"이 아니라 "나중에 다시 갈아엎지 않아도 되는 쪽"** 입니다. 채널팀은 Sidecar mode로 도입한 뒤 다시 Ambient로 마이그레이션하는 상황을 피하고 싶었습니다. 팀 내 Istio·Envoy 이해도를 높이며 리서치를 진행하는 쪽으로 Ambient를 택했습니다.

다만 이 결정이 성립한 전제는 세 번째 발언에 드러난 **"다양한 기능을 다 쓰지는 않는다"** 였습니다. 필요한 것이 L7 가시성과 트래픽 통제 정도라면 Ambient의 기능 공백이 크게 문제되지 않습니다. 반대로 기존 Istio API의 세밀한 기능(예: [EnvoyFilter]({{< relref "../../08-envoyfilter-extension.md" >}}) 기반 확장)에 이미 깊게 의존하는 조직이라면 같은 계산이 나오지 않습니다. 이 단서는 원문에 없는 보충입니다.

## 5. Ambient mode의 구성요소

### 5.1 컨트롤 플레인 — istiod가 내려보내는 것

istiod가 xDS API로 설정을 전파한다는 구조는 Sidecar mode와 같습니다. 다른 것은 전파 대상입니다. 파드마다 실행되는 사이드카 프록시 대신 **ztunnel과 waypoint**가 xDS 클라이언트입니다.

istiod가 내려보내는 것은 크게 세 가지입니다.

| 종류 | 내용 |
| --- | --- |
| 서비스 메타데이터 | 클러스터 안 서비스 엔드포인트, 네트워크 토폴로지 정보 |
| 정책 설정 | 트래픽 관리 및 보안 정책 |
| 인증서 | mTLS 통신을 위한 x509 인증서 |

### 5.2 데이터 플레인 — ztunnel과 waypoint의 역할 분담

Ambient의 데이터 플레인은 **L4와 L7을 두 컴포넌트로 쪼갭니다.**

| 컴포넌트 | 배치 단위 | 담당 계층 | 하는 일 |
| --- | --- | --- | --- |
| ztunnel | 노드당 1개 (DaemonSet) | L4 | mTLS 터널(HBONE), 기본 정책 |
| waypoint proxy | 필요한 namespace·service에만 | L7 | 라우팅, 관측, L7 정책 |

waypoint가 처리하는 L7 정책으로 원문이 명시한 것은 `AuthorizationPolicy` · `RequestAuthentication` · `WasmPlugin` · `Telemetry`입니다. waypoint가 enable되면 waypoint의 범위에 해당하는 트래픽은 모두 waypoint를 거쳐갑니다.

**waypoint는 source·destination 파드와 같은 노드에 있을 필요가 없습니다.** 사이드카가 파드와 같은 네트워크 네임스페이스에 있던 것과 달리 waypoint는 위치가 자유로운 별도 배포입니다. hop이 하나 더 늘고 그 hop은 노드 경계를 넘을 수 있습니다. 디버깅 난이도가 올라가는 이유 중 하나입니다.

L7을 켠 곳에만 두므로 L4 mTLS만 필요한 대다수 워크로드는 waypoint 비용을 내지 않습니다. 사이드카 모드에서 모든 파드가 L7 프록시 기능 전체를 짊어지던 것과 대비됩니다.

### 5.3 워크로드의 세 가지 상태

Ambient에서 워크로드가 놓일 수 있는 상태는 세 가지고, 각각 트래픽 경로가 다릅니다.

| 상태 | 경로 |
| --- | --- |
| 메시 미참여 (out-mesh) | 기존 kube-proxy 경로 그대로 — 서비스 디스커버리로 엔드포인트에 직접 연결 |
| 메시 참여 · waypoint 없음 | 양쪽 ztunnel이 HBONE 채널로 감싸 전달 |
| 메시 참여 · waypoint 설정 | ztunnel 사이에 waypoint가 끼어 L7 정책 적용 |

**메시 미참여(out-mesh)**는 기존 쿠버네티스 네트워크(kube-proxy) 동작 방식과 동일합니다. 서비스 디스커버리를 거쳐 엔드포인트로 직접 연결됩니다.

**메시 참여 · waypoint 없음**에서는 파드에서 나가는 트래픽이 ztunnel로 투명하게 리다이렉트되고 destination이 메시에 포함된 경우 **암호화된 HBONE 채널**로 보내집니다. 들어오는 트래픽도 해당 노드의 ztunnel을 거치며 `AuthorizationPolicy`에 위배되지 않는 한 파드로 전달됩니다.

**메시 참여 · waypoint 설정**에서는 ztunnel과 destination 사이에 waypoint가 끼어 L7 정책을 적용합니다.

{{< flow src="_flow/5-3-워크로드의-세-가지-상태.json" />}}

메시 미참여 상태가 kube-proxy 경로 그대로라는 점이 점진적 도입의 근거가 됩니다. namespace 단위로 하나씩 메시에 넣어도 나머지는 그대로입니다.

## 6. HBONE — 표준 세 개의 조합

HBONE은 **HTTP-Based Overlay Network Environment**의 약자입니다. 원문이 강조하는 요점은 이미 검증된 표준 세 개를 Envoy config로 조립했다는 것입니다.

| 구성 요소 | 역할 |
| --- | --- |
| HTTP/2 | 다중화된 전송 계층 |
| HTTP CONNECT | tunnel connection을 여는 메서드 |
| mTLS | 상호 인증과 암호화 |

HTTP CONNECT 메서드로 터널을 열고 그 위에 TLS를 씌운 것이 HBONE입니다. L4 페이로드를 이 조합으로 캡슐화하므로 애플리케이션 트래픽의 원본을 바꾸지 않으면서 프록시가 처리할 수 있습니다.

{{< seq src="_seq/6-hbone-표준-세-개의.json" />}}

{{< callout type="error" >}}
**HBONE은 디버깅 방식을 바꿉니다.** HBONE 구간에서 `tcpdump`를 떠도 암호화된 TLS 내용만 보입니다. 채널팀은 destination 측에서 모든 네트워크 인터페이스를 대상으로 캡처해야 ztunnel이 복호화한 트래픽을 확인할 수 있었습니다. 사이드카 모드에서 파드 안 loopback을 뜨면 평문이 보이던 것과 다른 작업 방식이 필요합니다.
{{< /callout >}}

HBONE 터널링과 traffic redirection이 Envoy listener·cluster 수준에서 어떻게 구현돼 있는지는 [2편 — Envoy config로 해부하는 Ambient mode]({{< relref "02-envoy-config-anatomy.md" >}})가 이어 다룹니다.

## 7. Traffic redirection — 15001 · 15006 · 15008

Ambient에서 "투명하게 리다이렉트된다"는 것은 istio-cni가 삽입한 iptables 규칙을 말합니다. **리다이렉트는 모두 파드 네트워크 안에서 이루어지며 host(node) side에서 이루어지지 않습니다.**

리다이렉트 규칙은 세 갈래입니다.

| 트래픽 | 판단 기준 | 목적지 포트 |
| --- | --- | --- |
| 인바운드 plaintext | source port ≠ 15008 | ztunnel plaintext port **15006** |
| 인바운드 HBONE | source port = 15008 | ztunnel HBONE port **15008** |
| 아웃바운드(egress) | 파드를 나가는 모든 TCP | ztunnel egress port **15001** |

아웃바운드 트래픽은 egress 처리를 위해 ztunnel의 port 15001로 리다이렉트된 뒤 ztunnel이 HBONE으로 캡슐화해 목적지로 보냅니다.

인바운드 분기는 **source port**로 갈립니다. 상대 ztunnel이 HBONE으로 보낸 트래픽은 source port가 15008이므로 이 조건 하나로 "이미 메시 안에서 감싸여 온 트래픽"과 "메시 밖에서 온 평문"을 구분합니다.

{{< seq src="_seq/7-traffic-redirection.json" />}}

### 7.1 "in-pod ztunnel"이라는 이름

Istio 공식 문서는 이 구조를 **in-pod ztunnel**이라 부르는데, 이 이름이 ztunnel이 파드 안에 들어 있다는 인상을 줍니다. ztunnel은 워크로드 파드와 별개의 DaemonSet 컨테이너입니다. istio-cni가 iptables에 주입하는 규칙은 ztunnel 컨테이너로 트래픽을 보내는 것이 아니라 **파드의 container network namespace 안에 생성된 TCP socket(localhost의 port 15001 · 15006 · 15008)으로 REDIRECT하는 것**입니다.

{{< callout type="important" >}}
이 구분이 중요한 이유는 진단 방법이 달라지기 때문입니다. 파드 안에서 `localhost:15006`이 잡혀 있는지 확인하는 것과 노드에서 ztunnel 파드가 Running인지 확인하는 것은 **서로 다른 실패를 잡아냅니다.** 둘 다 정상이어야 트래픽이 메시를 탑니다.
{{< /callout >}}

### 7.2 우회하면 정책도 함께 사라진다

리다이렉트 규칙을 어떤 이유로든 우회하면 트래픽은 그냥 나갑니다. **ztunnel을 우회하면 메시에서 설정한 모든 Authorization policy 또한 무시됩니다.** mTLS만 빠지는 게 아니라 `AuthorizationPolicy`가 걸어 둔 접근 통제까지 빠진 상태로 요청이 목적지에 도착합니다. 그래서 ztunnel과 istio-cni는 항상 Running 상태여야 합니다.

### 7.3 partially enrolled pod와 untaint controller

순서 문제가 하나 남습니다. **istio-cni가 아직 준비되지 않은 상태에서 파드가 스케줄되면 그 파드는 메시에 불완전(partially)하게 참여하는 상태가 될 수 있습니다.**

원문은 이 문제를 방지하는 수단으로 **untaint-controller**를 언급하고 상세는 3편으로 넘깁니다. 이 섹션에서는 [3-2편 — Partially Enrolled Pod와 Untaint Controller]({{< relref "03-2-partially-enrolled-untaint-controller.md" >}})가 이어 다룹니다.

Ambient를 실제로 운영하면서 만난 문제들은 3편 시리즈에 나뉘어 있습니다.

| 문서 | 다루는 문제 |
| --- | --- |
| [3-1편 — 503과 Half-open Connection]({{< relref "03-1-503-half-open-connection.md" >}}) | HBONE 터널이 반쯤 열린 채 남을 때의 503 |
| [3-2편 — Partially Enrolled Pod와 Untaint Controller]({{< relref "03-2-partially-enrolled-untaint-controller.md" >}}) | istio-cni 준비 전 스케줄된 파드 |
| [3-3편 — Ambient mode 안전하게 업그레이드하기]({{< relref "03-3-ambient-upgrade-in-place.md" >}}) | ztunnel·waypoint in-place 업그레이드 |
| [3-4편 — 507 status code와 istiod disconnected 탐지]({{< relref "03-4-507-istiod-disconnected.md" >}}) | 컨트롤 플레인 연결이 끊긴 데이터 플레인 |

## 이 문서에서 가져갈 것

- 사이드카 비용은 **프록시 개수가 파드 개수와 1:1로 묶여 있다**는 데서 나옵니다. ztunnel의 1,000 RPS 기준 CPU 1/3·메모리 1/5보다, 프록시 개수가 파드 개수에서 노드 개수로 바뀌는 쪽이 훨씬 크게 작용합니다. 4,000 파드 × 60Mi ≒ 240Gi가 idle에서 그냥 나갑니다.
- Ambient는 파드 단위 장애 격리를 **노드·namespace 단위 SPoF**와 맞바꾸는 선택입니다. 채널팀의 판단 기준은 "문제 발생 빈도보다 장애 복구 속도"였습니다. 이 기준에 동의하지 않는 조직에는 같은 결론이 나오지 않습니다.
- "투명한 리다이렉트"는 파드 netns 안의 **iptables 규칙과 세 개의 localhost socket**입니다. 인바운드는 source port가 15008인지로 HBONE(15008)과 plaintext(15006)를 가르고 아웃바운드는 전량 15001로 갑니다. host side가 아니라 파드 안에서 일어난다는 점이 진단의 출발점입니다.
- ztunnel을 우회하면 암호화와 함께 **인가 정책 전체가 빠집니다.** ztunnel과 istio-cni가 항상 Running이어야 한다는 요구는 성능이 아니라 보안 요구입니다. istio-cni 준비 전에 스케줄된 파드(partially enrolled)가 대표적 발생 경로입니다.
- HBONE은 **HTTP/2 + HTTP CONNECT + mTLS**의 조립입니다. 대신 구간이 암호화되어 `tcpdump`로 안이 안 보이고 destination 측 전체 인터페이스를 캡처해야 합니다.

## 소스

- **원문**: [Istio 1편: 왜 Istio Ambient mode인가?](https://tech.channel.io/kr/articles/tech-istio-ambient-mode-30cdf79a) (채널코퍼레이션 기술 블로그, 2026-03-20)
- [Istio Ambient Mode Reaches General Availability](https://istio.io/latest/blog/2024/ambient-reaches-ga/) — Istio 1.24 GA 공지
- [Istio Performance and Scalability](https://istio.io/latest/docs/ops/deployment/performance-and-scalability/) — 사이드카·ztunnel 리소스 기준값
- [Ambient Mode Architecture](https://istio.io/latest/docs/ambient/architecture/) — 구성요소와 동작 원리
- [Ambient Data Plane](https://istio.io/latest/docs/ambient/architecture/data-plane/) — ztunnel·waypoint 역할 분담
- [HBONE](https://istio.io/latest/docs/ambient/architecture/hbone/) — HTTP/2 CONNECT + mTLS 터널
- [Traffic Redirection in Ambient Mode](https://istio.io/latest/docs/ambient/architecture/traffic-redirection/) — 15001 · 15006 · 15008 리다이렉션
- [Istio Architecture (Sidecar)](https://istio.io/latest/docs/ops/deployment/architecture/) — 비교 대상인 사이드카 구조
- [istio/istio — architecture 문서](https://github.com/istio/istio/tree/release-1.28/architecture)
- [Waypoint Proxy Made Simple](https://istio.io/latest/blog/2023/waypoint-proxy-made-simple) · [CNCF 게재본](https://www.cncf.io/blog/2023/04/26/istio-ambient-waypoint-proxy-made-simple/)
- [Kubernetes Gateway API](https://gateway-api.sigs.k8s.io/)
- [Untaint Controller](https://ambientmesh.io/docs/operations/untaint-controller/) — partially enrolled pod 방지
