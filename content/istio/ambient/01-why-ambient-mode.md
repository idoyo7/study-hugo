---
title: "왜 Ambient mode인가"
weight: 1
---

# 01 · 왜 Istio Ambient mode인가 — 사이드카를 건너뛴 선택 (2026-03)

{{< callout type="info" >}}
**참조한 내용정리** · 이 문서는 아래 원문을 읽고 우리 지식베이스 형식으로 재구성한 요약이다. 원문 자체가 아니며, 정확한 워딩·전체 맥락·그림은 원문에서 확인한다.
- **원문**: [Istio 1편: 왜 Istio Ambient mode인가?](https://tech.channel.io/kr/articles/tech-istio-ambient-mode-30cdf79a)
- **매체 · 게시일**: 채널코퍼레이션 기술 블로그 · 2026-03-20
- **저자**: Jetty · Dylan (채널코퍼레이션 DevOps팀)
{{< /callout >}}

{{< callout type="info" >}}
**한눈에**
- 채널팀은 2025년 3월부터 11월까지 약 8개월에 걸쳐 Istio를 프로덕션에 도입하면서, 성숙한 Sidecar mode를 건너뛰고 2024년 말 Istio 1.24에서 GA된 **Ambient mode를 첫 도입 대상으로 골랐다**.
- 결정의 무게추는 **약 4,000개 파드**였다. 전부 사이드카를 붙이면 idle 상태에서만 수십~수백 vCPU와 **약 240Gi 메모리**가 순수하게 프록시로 나간다. ztunnel은 노드당 1개, waypoint는 namespace·service 단위라 증가폭이 훨씬 완만하다.
- 컨트롤 플레인 쪽 이유는 **polynomial scaling problem**이다. 사이드카 모드는 모든 사이드카가 메시 안 다른 모든 destination을 알아야 해서 설정 변경 하나가 파드 수만큼 전파되지만, Ambient는 전파 대상이 ztunnel과 waypoint로 줄어든다.
- 대가는 **SPoF**다. 사이드카는 장애 범위가 파드 하나였지만 ztunnel은 노드 전체, waypoint는 namespace 전체다. 거기에 HBONE·hop 증가로 디버깅이 어려워지고, GA 직후라 프로덕션 검증 사례가 적다.
- Ambient의 실제 동작은 **istio-cni가 파드 네트워크 네임스페이스에 넣는 iptables 규칙**과 **15001 · 15006 · 15008 세 포트**로 요약된다. "in-pod ztunnel"은 ztunnel이 파드 안에 있다는 뜻이 아니라, 파드 안 localhost socket이 노드 ztunnel DaemonSet에 연결돼 있다는 뜻이다.
{{< /callout >}}

이 챕터의 [01 서비스 메시와 Istio 기초]({{< relref "../01-mesh-basics.md" >}})부터 [09 istiod 스케일링과 xDS 커넥션 재분배]({{< relref "../09-istiod-scaling-connections.md" >}})까지는 전부 **Sidecar mode를 전제로 쓰인 문서**다. 파드마다 Envoy가 붙고, istiod가 그 프록시 전부에 xDS를 밀어 넣는 구조. 이 `ambient/` 하위 섹션은 그 전제 자체를 바꾼 팀의 기록을 다룬다.

채널코퍼레이션 DevOps팀은 서비스 메시를 처음 도입하면서 이미 검증된 Sidecar mode 대신 Ambient mode를 택했다. 신기술 선호가 아니라, 4,000개 파드라는 이미 확정된 규모 앞에서 사이드카의 단가 계산이 맞지 않았기 때문이다. 이 문서는 그 의사결정의 근거와, 결정 이후 팀이 새로 배워야 했던 Ambient의 구성요소(ztunnel · waypoint · istio-cni)와 프로토콜(HBONE), 그리고 트래픽 리다이렉션의 실체를 정리한다.

시리즈는 세 편으로 나뉜다. 1편(이 문서)이 도입 배경과 선택 이유, [2편]({{< relref "02-envoy-config-anatomy.md" >}})이 Envoy config로 들어가는 기술 상세, 3편이 프로덕션 운영 중 만난 문제와 해결이다.

## 1. 왜 서비스 메시였나

채널팀이 서비스 메시에서 얻으려던 **핵심 목표는 두 가지**다.

| 목표 | 내용 |
| --- | --- |
| 네트워크 가시성 | L7 네트워크 metrics와 서비스 간 호출 관계 파악 |
| 카나리 배포 | L7 네트워크 통제를 통한 정교한 배포 구현 |

여기에 덤으로 기대한 것이 Distributed Tracing, Traffic Management, Circuit Breaking, mTLS·상호 인증이다.

원문이 스스로 인정하듯 **개별 기능만 놓고 보면 서비스 메시가 필수는 아니다**. 트레이싱은 라이브러리로, 카나리는 배포 도구로, mTLS는 애플리케이션 레벨로도 어느 정도 된다. 다만 이 기능들을 **통합적으로 제공하는 레이어**에 투자하는 편이, 지속적으로 늘어나는 서비스 규모와 인프라 확장성을 감안할 때 장기적으로 맞다고 판단했다. 메시가 무엇을 대신 해주고 그 대가가 무엇인지는 [01 서비스 메시와 Istio 기초]({{< relref "../01-mesh-basics.md" >}})가 다룬 그대로다.

## 2. 왜 Istio였나 — Linkerd와 Cilium을 놓은 이유

Istio 외에 Linkerd와 Cilium도 검토했다.

| 후보 | 검토 결과 |
| --- | --- |
| Linkerd | 가볍고 단순하지만, 사용 사례가 적어 참고할 자료가 부족했다 |
| Cilium | eBPF 기반 CNI로 더 알려져 있고, 채널팀은 이미 다른 CNI를 쓰고 있어 서비스 메시만을 위해 채택하기엔 부담이었다 |
| **Istio** | **커뮤니티와 생태계가 가장 크고, 레퍼런스와 자료가 가장 많다** |

Cilium 탈락 사유가 기능 비교가 아니라 **"이미 다른 CNI를 쓰고 있다"는 현실 제약**이었다는 점이 눈에 띈다. 서비스 메시를 위해 CNI를 갈아엎는 결정은 메시 도입보다 훨씬 큰 변경이다.

## 3. Sidecar를 건너뛴 세 가지 이유

Istio를 고른 뒤 남은 질문은 "Sidecar냐 Ambient냐"였다. 채널팀은 세 가지 근거로 Ambient를 골랐다.

### 3.1 컨트롤 플레인 — polynomial scaling problem

Sidecar mode에서는 **모든 사이드카가 메시 안 다른 모든 destination의 정보를 알고 있어야 한다.** 그래서 destination 하나의 설정이 바뀌면 그 변경을 모든 사이드카에 전파해야 한다. 설정의 크기와 전파 대상의 수가 함께 커지면서 부하가 비선형으로 증가한다. 원문은 이를 **polynomial scaling problem**이라 부른다.

Ambient mode는 전파 대상이 파드마다 실행되는 사이드카 프록시가 아니라 **ztunnel과 waypoint**다. ztunnel은 노드당 1개, waypoint는 필요한 namespace·service에만 있으므로 전파 대상 자체가 몇 자릿수 줄어든다.

{{< flow caption="설정 변경 하나가 전파되는 대상 — 사이드카 모드는 파드 수만큼, Ambient는 노드 수(ztunnel)와 waypoint 수만큼이다." >}}
{
  "nodes": [
    {"id": "d", "col": 0, "row": 1, "label": "istiod", "sub": "xDS 서버", "kind": "proc"},
    {"id": "sc", "col": 1, "row": 0, "label": "사이드카", "sub": "파드 수만큼 · 기존 모드", "kind": "sink"},
    {"id": "zt", "col": 1, "row": 1, "label": "ztunnel", "sub": "노드당 1개 · Ambient", "kind": "sink"},
    {"id": "wp", "col": 1, "row": 2, "label": "waypoint", "sub": "필요한 ns·service만", "kind": "sink"}
  ],
  "edges": [
    {"from": "d", "to": "sc", "label": "파드 수 비례", "rate": 200},
    {"from": "d", "to": "zt", "label": "노드 수 비례", "rate": 900},
    {"from": "d", "to": "wp", "label": "선택적", "rate": 1100}
  ]
}
{{< /flow >}}

istiod가 왜, 어떤 순간에 CPU를 먹는지의 메커니즘은 [02 컨트롤 플레인 해부: istiod]({{< relref "../02-istiod-control-plane.md" >}})가, 스케일아웃해도 xDS 커넥션이 재분배되지 않는 문제는 [09 istiod 스케일링과 xDS 커넥션 재분배]({{< relref "../09-istiod-scaling-connections.md" >}})가 다룬다. Ambient는 그 두 문서가 다루는 부하의 **분모 자체(프록시 수)를 줄이는** 접근이다.

### 3.2 데이터 플레인 — 4,000 파드에 붙는 프록시의 단가

채널팀은 약 **4,000개 Pod**을 운영 중이다. Istio 공식 성능 문서 기준과 채널팀 자체 측정값은 다음과 같다.

| 대상 | 기준 | CPU | 메모리 | 출처 |
| --- | --- | --- | --- | --- |
| Sidecar (Envoy) | 1,000 RPS | 약 0.2 vCPU | 60Mi | Istio 공식 성능 문서 |
| ztunnel | 1,000 RPS | 약 0.06 vCPU | 12Mi | Istio 공식 성능 문서 |
| Sidecar (Envoy) | idle | 0.05~0.01 vCPU | 60Mi | 채널팀 측정 |
| Sidecar (Envoy) | 2,000 RPS | 0.8~1.2 vCPU | 300~500Mi | 채널팀 측정 |

같은 1,000 RPS를 처리할 때 **ztunnel의 CPU는 사이드카의 약 1/3, 메모리는 약 1/5**이다. 그런데 실제로 더 큰 차이를 만드는 건 단가가 아니라 **개수**다.

4,000개 파드에 모두 사이드카를 붙이면 **idle 상태에서만 수십~수백 vCPU와 약 240Gi 메모리**가 순수하게 프록시에 소모된다(60Mi × 4,000 ≒ 240Gi). 이 자원은 애플리케이션이 아니라 프록시가 그냥 떠 있기 위해 쓰인다. Ambient mode에서는 ztunnel이 노드당 1개, waypoint가 namespace·service 단위이므로 **파드가 늘어도 프록시 수가 같이 늘지 않는다.** 리소스 사용량의 증가폭이 훨씬 완만해진다.

사이드카 비용의 본질은 "프록시 하나가 비싸다"가 아니라 **"프록시 개수가 파드 개수와 1:1로 묶여 있다"** 는 점이다. RPS가 낮은 파드에도 idle 오버헤드는 그대로 붙는다. 파드가 수천 개 단위면 이 고정비가 지배적이 된다.

### 3.3 Kubernetes Gateway API 지원

Kubernetes의 Ingress 리소스는 freeze되었고 **Gateway API가 새로운 표준으로 자리잡는 중**이다. Istio 팀도 이 흐름에 맞춰 Gateway API를 기본 옵션으로 채택하는 방향으로 움직이고 있었고, 공식 문서도 Gateway API 기준으로 쓰이기 시작했다.

Gateway API 자체는 Sidecar mode에서도 쓸 수 있다. 다만 **Ambient mode의 공식 문서가 처음부터 Gateway API 기준으로 작성**되어 있어서, Ambient와 함께 도입하는 편이 자연스러웠다는 것이 채널팀의 판단이다.

## 4. 그래도 Ambient는 비싸다 — 인정한 세 가지 단점

채널팀은 Ambient의 단점을 회피하지 않고 명시적으로 나열한 뒤 선택했다.

| 단점 | 내용 |
| --- | --- |
| 장애 영향 범위 확대 | Sidecar mode에서는 프록시가 파드와 lifecycle을 같이 해 장애 범위가 각 파드에 그친다. Ambient는 ztunnel(노드 단위)과 waypoint(namespace·service 단위)에 의존하므로, 장애 시 노드 전체 혹은 namespace 전체로 영향이 번진다. **Sidecar mode에는 없던 SPoF(Single Point of Failure)가 생긴다.** |
| 디버깅 난이도 증가 | ztunnel · waypoint · HBONE 같은 새 개념을 익혀야 하고, 프록시와 hop이 늘어난 만큼 문제 원인 추적이 까다롭다. |
| 낮은 성숙도 | GA 직후라 프로덕션에서 검증된 사례가 적었고, Sidecar mode와 기존 Istio API(예: VirtualService)에 비해 덜 성숙하다. |

### 팀 내 의사결정

원문은 팀 논의에서 나온 발언을 그대로 싣는다. 결정의 성격을 드러내는 부분이라 인용한다.

> "2~3년 동안은 건드리지 않을 걸 선택하고 싶음. 차라리 시간을 들이고 깊게 고민해서 결정했으면 좋겠음."

> "네트워크 트래픽에 대한 조작과 가시성이 핵심임. 그것만 잘 되면 Ambient mode도 상관없음. 대신 버그나 안정성이 걸리긴 함."

> "리소스 측면 제외하고는 Sidecar 장점이 많아 보이는데, 다양한 기능을 사용하지 않을 거면 Ambient. 문제 발생 빈도보다는 장애 복구 속도에 집중해야 함."

세 발언을 관통하는 기준은 **"장애가 안 나는 쪽"이 아니라 "나중에 다시 갈아엎지 않아도 되는 쪽"** 이다. 결론적으로 채널팀은 Sidecar mode로 도입한 뒤 다시 Ambient mode로 마이그레이션하는 상황을 피하고 싶었고, 팀 내 Istio와 Envoy 이해도를 높이면서 신중히 리서치를 진행하는 방향으로 Ambient mode를 택했다.

다만 이 결정이 성립한 전제는 세 번째 발언에 드러난 **"다양한 기능을 다 쓰지는 않는다"** 였다. 필요한 것이 L7 가시성과 트래픽 통제 정도라면 Ambient의 기능 공백이 크게 문제되지 않는다. 반대로 기존 Istio API의 세밀한 기능(예: [EnvoyFilter]({{< relref "../08-envoyfilter-extension.md" >}}) 기반 확장)에 이미 깊게 의존하는 조직이라면 같은 계산이 나오지 않는다. 이 단서는 원문의 논지를 옮긴 것이 아니라 적용 조건을 짚은 보충이다.

## 5. Ambient mode의 구성요소

### 5.1 컨트롤 플레인 — istiod가 내려보내는 것

istiod가 xDS API로 설정을 전파한다는 구조 자체는 Sidecar mode와 같다. 다른 것은 **전파 대상**이다. 파드마다 실행되는 사이드카 프록시가 아니라 **ztunnel과 waypoint**가 xDS 클라이언트다.

istiod가 내려보내는 것은 크게 세 가지다.

| 종류 | 내용 |
| --- | --- |
| 서비스 메타데이터 | 클러스터 안 서비스 엔드포인트, 네트워크 토폴로지 정보 |
| 정책 설정 | 트래픽 관리 및 보안 정책 |
| 인증서 | mTLS 통신을 위한 x509 인증서 |

### 5.2 데이터 플레인 — ztunnel과 waypoint의 역할 분담

Ambient의 데이터 플레인은 **L4와 L7을 두 컴포넌트로 쪼갠 것**이 핵심이다.

| 컴포넌트 | 배치 단위 | 담당 계층 | 하는 일 |
| --- | --- | --- | --- |
| ztunnel | 노드당 1개 (DaemonSet) | L4 | mTLS 터널(HBONE), 기본 정책 |
| waypoint proxy | 필요한 namespace·service에만 | L7 | 라우팅, 관측, L7 정책 |

waypoint가 처리하는 L7 정책으로 원문이 명시한 것은 `AuthorizationPolicy` · `RequestAuthentication` · `WasmPlugin` · `Telemetry`다. **waypoint가 enable되면 waypoint의 범위에 해당하는 트래픽은 모두 waypoint를 거쳐간다.**

여기서 중요한 성질 하나. **waypoint는 source·destination 파드와 같은 노드에 있을 필요가 없다.** 사이드카가 파드와 같은 네트워크 네임스페이스에 있던 것과 달리, waypoint는 위치가 자유로운 별도 배포다. 즉 hop이 하나 더 늘고, 그 hop은 노드 경계를 넘을 수 있다. 디버깅 난이도가 올라가는 이유 중 하나다.

L7을 **켠 곳에만** 두는 이 구조 덕에, L4 mTLS만 필요한 대다수 워크로드는 waypoint 비용을 내지 않는다. 사이드카 모드에서 모든 파드가 L7 프록시 전체 기능을 짊어지던 것과 대비된다.

### 5.3 워크로드의 세 가지 상태

Ambient에서 워크로드가 놓일 수 있는 상태는 세 가지고, 각각 트래픽 경로가 다르다.

| 상태 | 경로 |
| --- | --- |
| 메시 미참여 (out-mesh) | 기존 쿠버네티스 네트워크(kube-proxy) 동작 방식과 **완전히 동일**하다. 서비스 디스커버리를 거쳐 엔드포인트로 직접 연결된다. |
| 메시 참여 · waypoint 없음 | 파드에서 나가는 트래픽이 ztunnel로 투명하게 리다이렉트되고, destination이 메시에 포함된 경우 **암호화된 HBONE 채널**로 보내진다. 들어오는 트래픽도 해당 노드의 ztunnel을 거치며, `AuthorizationPolicy`에 위배되지 않는 한 성공적으로 들어온다. |
| 메시 참여 · waypoint 설정 | ztunnel과 destination 사이에 waypoint가 끼어 L7 정책을 적용한다. |

{{< flow caption="세 상태의 경로를 같은 축에 겹쳐 본 것 — out-mesh는 kube-proxy 경로 그대로고, 메시에 들면 양쪽 ztunnel이 HBONE 구간을 만들며, waypoint를 켜면 그 사이에 L7 홉이 하나 더 붙는다. 홉 수가 곧 디버깅 난이도다." >}}
{
  "nodes": [
    {"id": "a0", "col": 0, "row": 0, "label": "파드 A", "sub": "메시 미참여", "kind": "src"},
    {"id": "kp", "col": 2, "row": 0, "label": "kube-proxy", "sub": "Service · Endpoint", "kind": "store"},
    {"id": "b0", "col": 4, "row": 0, "label": "파드 B", "sub": "메시 미참여", "kind": "sink"},

    {"id": "a1", "col": 0, "row": 1, "label": "파드 A", "sub": "메시 참여", "kind": "src"},
    {"id": "z1", "col": 1, "row": 1, "label": "ztunnel", "sub": "출발 노드", "kind": "proc"},
    {"id": "z2", "col": 3, "row": 1, "label": "ztunnel", "sub": "도착 노드", "kind": "proc"},
    {"id": "b1", "col": 4, "row": 1, "label": "파드 B", "sub": "메시 참여", "kind": "sink"},

    {"id": "a2", "col": 0, "row": 2, "label": "파드 A", "sub": "메시 참여", "kind": "src"},
    {"id": "z3", "col": 1, "row": 2, "label": "ztunnel", "sub": "출발 노드", "kind": "proc"},
    {"id": "wp", "col": 2, "row": 2, "label": "waypoint", "sub": "L7 정책 · 노드 무관", "kind": "query"},
    {"id": "z4", "col": 3, "row": 2, "label": "ztunnel", "sub": "도착 노드", "kind": "proc"},
    {"id": "b2", "col": 4, "row": 2, "label": "파드 B", "sub": "메시 참여", "kind": "sink"}
  ],
  "edges": [
    {"from": "a0", "to": "kp", "label": "Service 조회", "rate": 420},
    {"from": "kp", "to": "b0", "label": "엔드포인트 직결", "rate": 420},

    {"from": "a1", "to": "z1", "label": ":15001", "rate": 420},
    {"from": "z1", "to": "z2", "label": "HBONE :15008", "rate": 420},
    {"from": "z2", "to": "b1", "label": "평문 전달", "rate": 420},

    {"from": "a2", "to": "z3", "label": ":15001", "rate": 420},
    {"from": "z3", "to": "wp", "label": "HBONE", "rate": 420},
    {"from": "wp", "to": "z4", "label": "L7 통과", "rate": 420},
    {"from": "z4", "to": "b2", "label": "평문 전달", "rate": 420}
  ]
}
{{< /flow >}}

메시 미참여 상태가 kube-proxy 경로 그대로라는 점은 **점진적 도입의 근거**가 된다. namespace 단위로 하나씩 메시에 넣어도 나머지는 건드려지지 않는다.

## 6. HBONE — 새 프로토콜이 아니라 표준 세 개의 조합

HBONE은 **HTTP-Based Overlay Network Environment**의 약자다. 이름이 거창하지만 원문이 강조하는 요점은 **새로 만든 프로토콜이 아니라 이미 검증된 표준 세 개를 Envoy config로 조립한 것**이라는 점이다.

| 구성 요소 | 역할 |
| --- | --- |
| HTTP/2 | 다중화된 전송 계층 |
| HTTP CONNECT | tunnel connection을 여는 메서드 |
| mTLS | 상호 인증과 암호화 |

**HTTP CONNECT 메서드로 터널을 열고, 그 위에 TLS를 씌운 것이 HBONE**이다. L4 페이로드를 이 조합으로 캡슐화하므로, 애플리케이션 트래픽의 원본을 바꾸지 않으면서 프록시가 처리할 수 있다.

{{< seq caption="메시 안 두 파드의 한 번의 요청·응답 — 터널은 CONNECT와 그 응답으로 한 번 세워지고, 이후 요청과 응답이 같은 HBONE 터널을 왕복한다. 인가 판정은 도착 노드 ztunnel에서 일어나므로 위배된 요청은 도착 파드까지 가지 않는다." >}}
{
  "participants": [
    {"id": "P1", "label": "출발 파드"},
    {"id": "Z1", "label": "ztunnel(출발)"},
    {"id": "Z2", "label": "ztunnel(도착)"},
    {"id": "P2", "label": "도착 파드"}
  ],
  "steps": [
    {"msg": ["P1", "Z1"], "label": "1. 평문 TCP → :15001 REDIRECT"},
    {"msg": ["Z1", "Z2"], "label": "2. :15008로 HTTP/2 CONNECT — x509 mTLS 상호 인증"},
    {"msg": ["Z2", "Z1"], "label": "3. 200 — 터널 수립", "dashed": true},
    {"note": ["Z1", "Z2"], "lines": ["이 구간만 mTLS로 감싸인 HTTP/2 스트림이다", "앱은 자기가 평문 TCP를 보냈다고 알고 있다"]},
    {"msg": ["Z1", "Z2"], "label": "4. L4 페이로드 캡슐화 전송"},
    {"alt": "AuthorizationPolicy 통과", "steps": [
      {"msg": ["Z2", "P2"], "label": "5. 복호화한 평문 전달"},
      {"msg": ["P2", "Z2"], "label": "6. 응답", "dashed": true},
      {"msg": ["Z2", "Z1"], "label": "7. 같은 터널로 역방향", "dashed": true},
      {"msg": ["Z1", "P1"], "label": "8. 평문 응답", "dashed": true}
    ], "elseLabel": "AuthorizationPolicy 위배", "elseSteps": [
      {"msg": ["Z2", "Z1"], "label": "도착 ztunnel이 차단 — 앱에 닿지 않음", "dashed": true},
      {"msg": ["Z1", "P1"], "label": "연결 실패", "dashed": true}
    ]}
  ]
}
{{< /seq >}}

{{< callout type="error" >}}
**디버깅 관점에서 HBONE은 양날의 검이다.** 채널팀이 실제로 겪은 것은 이렇다. HBONE 구간에서 `tcpdump`를 떠도 **암호화된 TLS 내용만** 보인다. 안을 보려면 **destination 측에서 모든 네트워크 인터페이스를 대상으로 캡처**해야 ztunnel이 복호화한 트래픽을 확인할 수 있었다. 사이드카 모드에서 파드 안 loopback을 뜨면 평문이 보이던 것과 다른 작업 방식이 필요하다.
{{< /callout >}}

HBONE 터널링과 traffic redirection이 Envoy listener·cluster 수준에서 실제로 어떻게 구현돼 있는지는 [2편 — Envoy config로 해부하는 Ambient mode]({{< relref "02-envoy-config-anatomy.md" >}})가 이어 다룬다.

## 7. Traffic redirection — 15001 · 15006 · 15008

Ambient에서 "투명하게 리다이렉트된다"는 문장의 실체는 **istio-cni가 삽입한 iptables 규칙**이다.

여기서 놓치기 쉬운 조건이 하나 있다. **리다이렉트는 모두 파드 네트워크 안에서 이루어지며, host(node) side에서 이루어지지 않는다.**

리다이렉트 규칙은 세 갈래다.

| 트래픽 | 판단 기준 | 목적지 포트 |
| --- | --- | --- |
| 인바운드 plaintext | source port ≠ 15008 | ztunnel plaintext port **15006** |
| 인바운드 HBONE | source port = 15008 | ztunnel HBONE port **15008** |
| 아웃바운드(egress) | 파드를 나가는 모든 TCP | ztunnel egress port **15001** |

아웃바운드 쪽 문장을 정확히 옮기면 이렇다. 파드를 나가는 모든 TCP 트래픽은 **HBONE 캡슐화를 사용해 ztunnel에서 전송되기 전에**, egress 처리를 위해 ztunnel의 port 15001로 리다이렉트된다.

인바운드 분기가 **source port**로 갈린다는 점이 재미있다. 상대 ztunnel이 HBONE으로 보낸 트래픽은 source port가 15008이므로, 이 조건 하나로 "이미 메시 안에서 감싸여 온 트래픽"과 "메시 밖에서 온 평문"을 구분한다.

{{< seq caption="파드 하나가 메시에 등록되는 순서 — istio-cni가 파드 netns 안에 socket을 만들고 규칙을 넣은 뒤 ztunnel에 알리고, ztunnel이 그 socket에 붙어야 비로소 경로가 완성된다. 이 순서가 어긋난 채 파드가 뜨면 규칙 없는 파드가 메시 안에 표시된다." >}}
{
  "participants": [
    {"id": "K", "label": "kubelet · CNI"},
    {"id": "C", "label": "istio-cni agent"},
    {"id": "N", "label": "파드 netns"},
    {"id": "Z", "label": "ztunnel DaemonSet"}
  ],
  "steps": [
    {"msg": ["K", "C"], "label": "1. 파드 생성 CNI 이벤트"},
    {"msg": ["C", "N"], "label": "2. netns 안에 TCP socket 생성"},
    {"msg": ["C", "N"], "label": "3. iptables REDIRECT 주입 (host side 아님)"},
    {"note": ["C", "N"], "lines": ["세 socket 모두 파드 안 localhost에 뜬다", ":15001 egress · :15006 plaintext · :15008 HBONE"]},
    {"msg": ["C", "Z"], "label": "4. 파드 등록 알림"},
    {"msg": ["Z", "N"], "label": "5. 파드 안 socket에 연결"},
    {"note": ["N", "Z"], "lines": ["in-pod ztunnel의 실체 — ztunnel은 파드 밖 DaemonSet이고", "리다이렉트 대상은 파드 안 socket이다"]},
    {"alt": "istio-cni가 먼저 준비된 경우", "steps": [
      {"msg": ["N", "Z"], "label": "모든 TCP가 ztunnel 통과 — 인가 적용"}
    ], "elseLabel": "istio-cni 준비 전에 파드가 스케줄됨", "elseSteps": [
      {"msg": ["N", "Z"], "label": "규칙 없음 — ztunnel 우회", "dashed": true},
      {"note": ["K", "Z"], "lines": ["partially enrolled — 메시 안에 있다고 표시된 채", "mTLS도 AuthorizationPolicy도 없이 뜬다"]}
    ]}
  ]
}
{{< /seq >}}

### 7.1 "in-pod ztunnel"의 실체

Istio 공식 문서는 이 구조를 **in-pod ztunnel**이라 부른다. 이 표현이 오해를 부른다. ztunnel이 파드 안에 들어 있다는 인상을 주기 때문이다.

실제는 다르다. **ztunnel은 엄연히 워크로드 파드와는 별개의 DaemonSet 컨테이너**다. istio-cni가 iptables에 주입하는 규칙은 단순히 ztunnel 컨테이너로 트래픽을 보내는 것이 아니라, **파드의 container network namespace 안에 생성된 TCP socket(localhost의 port 15001 · 15006 · 15008)으로 REDIRECT하는 것**이다.

{{< callout type="important" >}}
이 구분이 중요한 이유는 진단 방법이 달라지기 때문이다. 파드 안에서 `localhost:15006`이 잡혀 있는지 확인하는 것과, 노드에서 ztunnel 파드가 Running인지 확인하는 것은 **서로 다른 실패를 잡아낸다.** 둘 다 정상이어야 트래픽이 메시를 탄다.
{{< /callout >}}

### 7.2 우회하면 정책도 함께 사라진다

리다이렉트 규칙을 어떤 이유로든 우회하면 트래픽은 그냥 나간다. 문제는 그 다음이다. **ztunnel을 우회하면 메시에서 설정한 모든 Authorization policy 또한 무시된다.**

mTLS가 안 걸리는 것으로 끝나지 않는다. `AuthorizationPolicy`가 걸어 둔 접근 통제가 통째로 빠진 상태로 요청이 목적지에 도착한다. 그래서 **ztunnel과 istio-cni는 항상 Running 상태여야 한다.**

### 7.3 partially enrolled pod와 untaint controller

여기서 순서 문제가 하나 나온다. **istio-cni가 아직 준비되지 않은 상태에서 파드가 스케줄되면, 그 파드는 메시에 불완전(partially)하게 참여하는 상태가 될 수 있다.**

원문은 이 문제를 방지하는 수단으로 **untaint-controller**를 언급하고, 상세는 3편으로 넘긴다. 이 섹션에서는 [3-2편 — Partially Enrolled Pod와 Untaint Controller]({{< relref "03-2-partially-enrolled-untaint-controller.md" >}})가 이어 다룬다.

Ambient를 실제로 운영하면서 만난 문제들은 3편 시리즈에 나뉘어 있다.

| 문서 | 다루는 문제 |
| --- | --- |
| [3-1편 — 503과 Half-open Connection]({{< relref "03-1-503-half-open-connection.md" >}}) | HBONE 터널이 반쯤 열린 채 남을 때의 503 |
| [3-2편 — Partially Enrolled Pod와 Untaint Controller]({{< relref "03-2-partially-enrolled-untaint-controller.md" >}}) | istio-cni 준비 전 스케줄된 파드 |
| [3-3편 — Ambient mode 안전하게 업그레이드하기]({{< relref "03-3-ambient-upgrade-in-place.md" >}}) | ztunnel·waypoint in-place 업그레이드 |
| [3-4편 — 507 status code와 istiod disconnected 탐지]({{< relref "03-4-507-istiod-disconnected.md" >}}) | 컨트롤 플레인 연결이 끊긴 데이터 플레인 |

## 이 문서에서 가져갈 것

- **사이드카의 비용은 단가가 아니라 개수다.** ztunnel이 사이드카보다 1,000 RPS 기준 CPU 1/3, 메모리 1/5인 것보다, 프록시 개수가 파드 개수에서 노드 개수로 바뀌는 쪽이 훨씬 크게 작용한다. 4,000 파드 × 60Mi ≒ 240Gi가 idle에서 그냥 나가는 상황이면 계산은 이미 끝나 있다.
- **Ambient를 고르는 것은 파드 단위 장애 격리를 노드·namespace 단위 SPoF와 맞바꾸는 거래다.** 채널팀의 판단 기준은 "문제 발생 빈도보다 장애 복구 속도"였다. 이 기준에 동의하지 않는 조직에는 같은 결론이 나오지 않는다.
- **"투명한 리다이렉트"의 실체는 파드 netns 안의 iptables 규칙과 세 개의 localhost socket이다.** 인바운드는 source port가 15008인지로 HBONE(15008)과 plaintext(15006)를 가르고, 아웃바운드는 전량 15001로 간다. host side가 아니라 파드 안에서 일어난다는 점이 진단의 출발점이다.
- **ztunnel 우회는 암호화만 빠지는 게 아니라 인가 정책 전체가 빠지는 사건이다.** ztunnel과 istio-cni가 항상 Running이어야 한다는 요구는 성능이 아니라 보안 요구다. istio-cni 준비 전에 스케줄된 파드(partially enrolled)가 이 구멍의 대표적 발생 경로다.
- **HBONE은 새 프로토콜이 아니라 HTTP/2 + HTTP CONNECT + mTLS의 조립이다.** 대신 구간이 암호화되어 `tcpdump`로 안이 안 보이고, destination 측 전체 인터페이스 캡처라는 다른 작업 방식을 요구한다.

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
