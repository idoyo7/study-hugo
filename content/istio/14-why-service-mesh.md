---
title: "왜 서비스 메시인가"
weight: 14
---

# 14 · 왜 서비스 메시인가 — 대안 스펙트럼과 손익 분석

{{< callout type="info" >}}
**한눈에**
- 결정의 대상은 기능이 아니라 **배치**다 — 재시도·타임아웃·mTLS·관측이라는 공통 관심사를 앱 안에 둘 것인가, 앱 밖 프록시에 둘 것인가, 그 프록시를 파드마다 둘 것인가 노드마다 둘 것인가.
- 대안은 넷(라이브러리 · 게이트웨이만 · 사이드카 메시 · ambient)이고, 갈리는 축도 넷이다: **커버 범위 · 언어 의존 · 업그레이드 결합 · 운영 비용**.
- 메시가 이기는 조건은 서비스 수 × 언어 수가 크고 정책을 일괄로 바꿔야 할 때다. 우리 챕터에서 그 증거는 [06]·[07]·[05]에 실물로 남아 있다.
- 청구서에는 공식 수치가 있다 — 벤치마크 조건에서 사이드카 하나가 **약 0.20 vCPU · 60 MB**, 그리고 데이터 경로에 프록시가 붙는 만큼의 지연.
- 메시는 재시도·서킷브레이커까지 대신해주지만 **폴백은 앱 몫**이다. 공식 문서가 이 경계를 직접 명시한다.
{{< /callout >}}

> **이 문서의 자리.** [01 메시 기초]({{< relref "01-mesh-basics.md" >}})는 메시가 **구조적으로 무엇이고 그 대가가 무엇인지**를 다뤘다 — 두 개의 플레인, iptables 가로채기, 네 가지 비용. 그건 메커니즘이다. 이 문서는 그 앞에 오는 질문을 다룬다: **같은 문제를 푸는 다른 방법들과 비교했을 때 메시가 이기는 조건은 무엇이고, 지는 조건은 무엇인가.** 01과 겹치는 서술은 링크로 넘기고, 여기서는 판단에 필요한 것만 본다.

> 관련 문서: [01 메시 기초]({{< relref "01-mesh-basics.md" >}}) · [06 관측성]({{< relref "06-observability-points.md" >}}) · [07 nginx에서 Istio로]({{< relref "07-from-nginx-to-istio.md" >}}) · [10 Ambient 이행 심사]({{< relref "10-ambient-migration-questions.md" >}}) · [Ambient 도입기]({{< relref "ambient/_index.md" >}}) · Envoy 쪽 부품 설명은 [12 Envoy가 할 수 있는 것]({{< relref "12-envoy-capabilities.md" >}})·[13 Istio는 Envoy를 어떻게 조립하나]({{< relref "13-istio-envoy-assembly.md" >}})

## 1. 문제의 기원 — 관심사 하나가 서비스 수 × 언어 수만큼 복제된다

[01]({{< relref "01-mesh-basics.md" >}})은 메시의 출발점이 "공통 관심사의 중복"이라고 짚었다. 여기서는 그 중복의 **단가**를 본다.

Envoy 공식 문서는 이 문제를 분산 아키텍처 일반의 문제로 적는다 — 분산 아키텍처로 옮길 때 생기는 운영 문제의 대부분이 결국 **네트워킹과 관측성** 두 영역에 뿌리를 둔다는 것이다. 같은 문서의 철학 문장이 해법의 방향까지 못 박는다: *"The network should be transparent to applications. When network and application problems do occur it should be easy to determine the source of the problem."*

istio.io도 메시를 같은 방향으로 정의한다 — *"A service mesh is an infrastructure layer that gives applications capabilities like zero-trust security, observability, and advanced traffic management, without code changes."* 세 축(트래픽 관리 · 관측성 · 보안)을 **코드 수정 없이 인프라 레이어에서** 준다는 것이 공식 자기 정의다.

### 라이브러리 방식이 부러지는 지점

가장 먼저 떠오르는 대안은 공용 라이브러리다. Envoy 공식 문서는 이 비교를 정면으로 프레이밍한 드문 1차 자료인데, 지적하는 마찰은 둘이다.

- **언어마다 따로 유지해야 한다.** Java·C++·Go·PHP·Python 각각의 커뮤니케이션 라이브러리를 별도로 만들고 별도로 올려야 한다.
- **업그레이드가 앱 배포에 결합된다.** Envoy를 "각 애플리케이션과 나란히 도는 자체 완결형(self-contained) 프로세스"로 제시하는 이유가 여기다 — 언어 무관 운용과, 애플리케이션과 분리된 업그레이드.

istio.io 쪽은 같은 결론에 다른 각도로 닿는다. 아키텍처 문서가 사이드카 프록시 모델의 효용을 **재설계나 코드 재작성 없이 기존 배포에 기능을 얹을 수 있다**는 취지로 적는다. 다만 "라이브러리 대비"라는 명시적 비교 프레이밍은 Envoy 문서 쪽에서만 확인되고, istio.io 문서 트리에서는 찾지 못했다.

### 실제로 비교해야 할 것은 리드타임이다

기능 유무로 비교하면 라이브러리도 재시도·타임아웃·mTLS를 다 한다. 갈리는 건 **정책 하나를 바꾸는 데 걸리는 시간**이다.

| 바꿔야 할 것 | 라이브러리 방식의 경로 | 프록시 방식의 경로 |
|---|---|---|
| mTLS 적용 범위 | 언어별 라이브러리 릴리스 → 서비스별 의존성 갱신 → 전 서비스 재빌드·재배포 | 정책 리소스 한 건 적용 |
| 재시도·타임아웃 정책 | 위와 동일 | `VirtualService` 한 건 ([07]({{< relref "07-from-nginx-to-istio.md" >}})) |
| 지표 스키마 통일 | 언어별 계측 코드를 서비스마다 수정 | 이미 나오고 있다 ([06]({{< relref "06-observability-points.md" >}})) |
| 프록시/라이브러리 자체의 보안 패치 | 그 라이브러리를 쓰는 모든 서비스의 배포 일정에 결합 | 프록시 이미지 갱신 (파드 재시작은 필요) |

라이브러리 방식의 리드타임은 **서비스 수에 비례**하고, 언어가 섞이면 그 앞에 계수가 하나 더 붙는다. 서비스가 다섯 개면 무시할 만한 계수고, 수십 개가 되면 정책 변경 자체가 분기 단위 프로젝트가 된다. 메시의 손익이 규모에서 뒤집히는 이유가 이 계수다.

## 2. 대안 스펙트럼 — 관심사를 어디에 놓을 것인가

선택지는 이분법이 아니라 배치의 스펙트럼이다. 왼쪽으로 갈수록 인프라가 가볍고 앱이 무거우며, 오른쪽으로 갈수록 반대다.

| | ① 앱 내 라이브러리 | ② API 게이트웨이만 | ③ 사이드카 메시 | ④ ambient(노드 프록시) |
|---|---|---|---|---|
| **관심사가 사는 곳** | 앱 프로세스 안 | 클러스터 경계 한 지점 | 파드마다 붙는 프록시 | 노드마다 ztunnel + 필요한 곳에만 waypoint |
| **커버 범위** | 그 라이브러리를 쓰는 서비스 사이만 | **남북만** — 동서 호출은 지나지 않는다 | 남북·동서 전부 | 남북·동서 전부, 단 **L7은 waypoint가 있는 구간만** |
| **언어 의존** | 언어마다 별도 구현 | 없음 | 없음 | 없음 |
| **업그레이드 결합** | 앱 재빌드·재배포에 결합 | 게이트웨이만 갈면 된다 | 앱 코드와 분리 (프록시 갱신 시 파드 재시작) | 앱 코드와 분리, 갱신 단위가 노드 |
| **운영 비용** | 별도 인프라 없음. 대신 언어 수만큼의 유지보수 | 컴포넌트 하나 | 프록시 N개 + 컨트롤 플레인 ([02]({{< relref "02-istiod-control-plane.md" >}})·[09]({{< relref "09-istiod-scaling-connections.md" >}})) | 프록시 수는 줄고, **장애 격리 단위가 노드·네임스페이스로 커진다** |
| **더 볼 곳** | — | [07]({{< relref "07-from-nginx-to-istio.md" >}}) | [01]({{< relref "01-mesh-basics.md" >}})~[09]({{< relref "09-istiod-scaling-connections.md" >}}) | [10]({{< relref "10-ambient-migration-questions.md" >}}) · [Ambient 도입기]({{< relref "ambient/_index.md" >}}) |

②와 ③ 사이의 칸이 실무에서 가장 자주 오해되는 지점이다. 게이트웨이는 **클러스터 경계 한 지점**을 덮는다. 그 지점을 지나지 않는 트래픽에는 게이트웨이가 건 정책도, 게이트웨이가 만든 지표도 존재하지 않는다.

{{< flow caption="게이트웨이는 외부에서 들어오는 한 지점만 덮는다. 서비스끼리 주고받는 동서 호출은 그 지점을 지나지 않으므로, 정책도 지표도 그 구간에는 없다." >}}
{
  "nodes": [
    { "id": "ext", "col": 0, "row": 0, "label": "외부 클라이언트", "kind": "src" },
    { "id": "gw", "col": 1, "row": 0, "label": "API 게이트웨이", "sub": "TLS · 라우팅 · 인가", "kind": "proc" },
    { "id": "a", "col": 2, "row": 0, "label": "서비스 A", "kind": "proc" },
    { "id": "b", "col": 3, "row": 0, "label": "서비스 B", "kind": "proc" },
    { "id": "c", "col": 3, "row": 1, "label": "서비스 C", "kind": "proc" },
    { "id": "d", "col": 4, "row": 0, "label": "서비스 D", "kind": "sink" }
  ],
  "edges": [
    { "from": "ext", "to": "gw", "rate": 700 },
    { "from": "gw", "to": "a", "rate": 700 },
    { "from": "a", "to": "b", "rate": 700 },
    { "from": "a", "to": "c", "rate": 700 },
    { "from": "b", "to": "d", "rate": 700 },
    { "from": "c", "to": "d", "rate": 700 }
  ],
  "groups": [
    { "id": "ns", "label": "남북 — 게이트웨이가 덮는 구간", "members": ["ext", "gw"] },
    { "id": "ew", "label": "동서 — 덮이지 않는 구간", "members": ["a", "b", "c", "d"] }
  ]
}
{{< /flow >}}

그러니 "게이트웨이만으로 충분한가"는 취향 문제가 아니라 **동서 트래픽의 양과 다양성**을 세면 답이 나오는 질문이다. 서비스 간 호출이 한두 쌍뿐이면 ②로 끝난다. 호출 그래프가 촘촘하면 ②는 메시의 대안이 아니라 메시의 부분집합이다.

## 3. 이점을 우리 챕터에 매핑 — 증거는 어디 있나

공식 문서의 자기 정의(§1)는 **주장**이지 증거가 아니다. 우리가 실제로 얻은 것이 무엇인지는 우리 문서에 남아 있으므로, 이점 목록 대신 증거의 위치로 적는다.

| 메시가 준다는 것 | 우리 쪽 증거 | 그 문서가 실제로 보여주는 것 |
|---|---|---|
| **관측성이 앱 무수정으로 나온다** | [06]({{< relref "06-observability-points.md" >}}) | 서비스마다 제각각이던 지표가 동일 스키마로 통일됐고, `response_flags`·`connection_security_policy` 같은 **표준 라벨 차원**이 생겼다. 대시보드를 서비스별로 새로 짜지 않는다 |
| **설정이 선언적 리소스로 정리된다** | [07]({{< relref "07-from-nginx-to-istio.md" >}}) | `nginx.conf` 한 파일의 절차적 설정이 관심사별 CRD로 나뉘었다. 얻은 것은 분리, 잃은 것은 "이 동작이 어디서 정의됐나"의 국소성 |
| **장애를 층으로 갈라 볼 수 있다** | [05]({{< relref "05-incident-intermittent-5xx.md" >}}) | 간헐적 5xx의 홉을 가른 나침반이 Envoy response flag였다. 앱 로그만 있었다면 "앱은 멀쩡한데 클라이언트는 실패"에서 조사가 멈춘다 |
| **mTLS를 코드 변경 없이 전면 적용** | [01]({{< relref "01-mesh-basics.md" >}}) + [06]({{< relref "06-observability-points.md" >}}) | 적용은 [01]의 자동 mTLS, **커버리지 측정**은 [06]의 `connection_security_policy="none"` 한 줄. istio.io도 mTLS 암호화·정책 관리·접근 제어를 메시가 제공하는 통제 항목으로 명시한다 |

이 표에서 세 번째 줄은 양면이다. 프록시가 단서를 준 것도 맞지만, **조사해야 할 층을 하나 늘린 것도 프록시**다. 그 계산이 다음 절이다.

## 4. 비용의 정직한 계산

### 데이터 플레인 — 프록시 단가와 지연

Istio 공식 Performance and Scalability 문서가 벤치마크 수치를 직접 공개한다. HTTP 1,000 req/s · 1KB payload 조건, 문서 내 **Istio 1.24 기준** 벤치마크다.

| 프록시 | CPU | 메모리 |
|---|---|---|
| 사이드카 (worker thread 2개) | 약 **0.20 vCPU** | 약 **60 MB** |
| waypoint | 약 0.25 vCPU | 약 60 MB |
| ztunnel | 약 0.06 vCPU | 약 12 MB |

사이드카 값은 **파드 수에 1:1로 곱해진다.** 이 곱셈이 [Ambient 도입기 01]({{< relref "ambient/01-why-ambient-mode.md" >}})에서 4,000 파드짜리 계산이 나온 자리이고, 그 팀이 사이드카를 건너뛴 이유다. 우리처럼 이미 사이드카로 돌고 있는 클러스터에서는 같은 곱셈이 [02]({{< relref "02-istiod-control-plane.md" >}})의 리소스 최적화 과제로 나타났다.

지연도 공식 문서가 인정한다 — *"Since Istio adds a sidecar proxy or ztunnel proxy on the data path, latency is an important consideration."* 그리고 P90/P99 지연 벤치마크를 sidecar · ambient L4 · ambient L4+L7 세 배포 모드별로 제시한다. 문서의 절대값을 우리 SLO에 그대로 옮기면 안 된다. [01]({{< relref "01-mesh-basics.md" >}})이 말한 "요청당 프록시 홉 2회"가 우리 꼬리 지연의 어디를 먹는지는 우리 트래픽으로 재야 한다.

### 컨트롤 플레인 — 운영 항목이 하나 늘어난다

프록시를 앱 밖에 두면 그 프록시들에게 설정을 내려보내는 컴포넌트가 생긴다. [02]({{< relref "02-istiod-control-plane.md" >}})가 그 부하를 **프록시 수 × 변경 빈도 × 설정 범위**의 곱으로 정리했고, [09]({{< relref "09-istiod-scaling-connections.md" >}})는 그 컴포넌트를 스케일할 때 xDS 커넥션이 자동으로 재분배되지 않는다는 함정을 다뤘다. 둘 다 라이브러리 방식에는 아예 없는 항목이다.

공식 문서도 기본값 그대로 규모를 키우면 안 된다는 것을 인정한다 — 대규모 배포에서는 **configuration scoping이 강력히 권장된다**고 성능 문서가 적는다. 다만 istio.io가 '운영 복잡성(operational complexity)'이라는 표현을 그대로 써서 메시의 비용으로 인정하는 대목은 성능 문서 밖에서 확인하지 못했다.

### 인지 비용 — 조사해야 할 층이 늘어난다

수치로 잡히지 않지만 실제로 가장 비싼 항목이다. [11]({{< relref "11-request-path-anatomy.md" >}})이 보여주듯 요청 하나에 L7 파싱 지점이 여러 곳 생기고, [05]({{< relref "05-incident-intermittent-5xx.md" >}})처럼 5xx가 나면 **주인을 먼저 가리는 절차**가 조사 앞에 붙는다. [08]({{< relref "08-envoyfilter-extension.md" >}})의 EnvoyFilter는 이 비용의 극단 — 저수준 탈출구는 업그레이드 취약성과 리뷰 난이도를 함께 데려온다.

### 메시가 대체하지 못하는 것

가장 자주 과대평가되는 칸이다. Istio 공식 트래픽 관리 개념 문서가 경계를 직접 긋는다. 실패 복구 기능은 애플리케이션에 *"completely transparent"* 하지만, 그 실패를 다루는 책임까지 가져가지는 않는다는 것이다.

{{< callout type="important" >}}
공식 문서 원문: *"While Istio failure recovery features improve the reliability and availability of services in the mesh, applications must handle the failure or errors and take appropriate fallback actions."* 로드밸런싱 풀의 인스턴스가 전부 실패하면 Envoy는 HTTP 503을 반환하고, **그 503에 대한 폴백 로직은 애플리케이션이 구현해야 한다.** → [소스](#소스)
{{< /callout >}}

즉 메시는 **네트워크 수준 복원력**(재시도·타임아웃·서킷브레이킹)을 앱 밖으로 빼주지만, **비즈니스 수준 폴백**은 못 가져간다. 라이브러리를 걷어냈다고 앱이 네트워크 실패를 몰라도 되는 상태가 되는 것은 아니다. 라이브러리 대비 절감폭을 계산할 때 이 칸을 빼먹으면 이득이 과대 계상된다.

## 5. 언제 안 쓰는 게 맞나

앞의 손익표를 뒤집으면 채택하지 않을 조건이 나온다.

| 상황 | 메시가 지는 이유 | 대신 |
|---|---|---|
| **서비스 수가 적다** | 컨트롤 플레인 운영은 고정비인데 나눠 담을 서비스가 없다. §1의 리드타임 계수도 작다 | ① 라이브러리 또는 ② 게이트웨이 |
| **단일 언어 · 단일 팀** | 폴리글랏 비용이 0이면 라이브러리의 가장 큰 약점이 사라진다. 업그레이드 결합도 팀이 하나면 조율 가능하다 | ① 잘 관리되는 공용 라이브러리 |
| **동서 호출이 거의 없다** | 메시가 게이트웨이보다 더 덮는 구간이 곧 차별점인데, 그 구간이 비어 있다 | ② API 게이트웨이 |
| **필요한 게 기능 하나뿐** | 그 하나를 위해 데이터 플레인 전체를 깔 이유가 없다 | 그 기능의 전용 도구 |

마지막 줄은 메시를 실제로 도입한 팀도 인정한다. 채널코퍼레이션 DevOps팀은 도입 기록에서 **개별 기능만 놓고 보면 서비스 메시가 필수는 아니라고** 적었고, 그럼에도 도입한 근거는 기능 하나가 아니라 **늘어날 서비스 규모와 인프라 확장성**이었다. 그 저울질의 전문은 [Ambient 도입기 01]({{< relref "ambient/01-why-ambient-mode.md" >}})에 있다.

이 인정을 뒤집으면 채택 조건이 된다. **지금 필요한 기능이 하나인가, 3년 뒤에 셋 이상이 필요해질 규모인가.** 하나라면 그 기능의 전용 도구가 이긴다.

## 6. 결론 축 — 기능 묶음이 아니라 배치 결정

메시를 "재시도 + mTLS + 관측성 + 카나리 패키지"로 읽으면 도입 판단이 기능 체크리스트가 된다. 그러면 §5의 인정대로 어느 칸에서도 메시가 유일한 답이 아니고, 판단이 나지 않는다.

실제 결정은 다른 질문이다 — **이 공통 관심사를 어느 레이어에 배치할 것인가.** 앱 프로세스 안인가, 클러스터 경계 한 지점인가, 파드마다인가, 노드마다인가. 이 질문에는 보편적인 정답이 없고 곱셈의 항이 답을 정한다.

- **서비스 수 × 언어 수**가 커지면 관심사를 앱 안에 두는 비용이 먼저 폭발한다. 우리가 그 벽에서 메시를 골랐고, [01]({{< relref "01-mesh-basics.md" >}})~[09]({{< relref "09-istiod-scaling-connections.md" >}})가 그 이후의 기록이다.
- **파드 수**가 커지면 관심사를 파드마다 두는 비용이 폭발한다. 채널팀이 그 벽에서 ambient를 골랐고([Ambient 도입기]({{< relref "ambient/_index.md" >}})), 우리가 그 벽에 닿았을 때 무엇을 다시 심사해야 하는지가 [10]({{< relref "10-ambient-migration-questions.md" >}})이다.

두 팀은 같은 스펙트럼 위의 다른 칸을 골랐을 뿐 다른 판단을 한 게 아니다. 도입 검토서를 쓴다면 기능 목록이 아니라 이 곱셈의 항 — 서비스 수, 언어 수, 파드 수, 동서 호출 밀도 — 을 먼저 세는 편이 빠르다.

## 이 문서에서 가져갈 것

- 비교는 **기능 유무가 아니라 리드타임과 커버 범위**로 한다. 라이브러리도 기능은 다 하지만 정책 변경 리드타임이 서비스 수 × 언어 수에 비례하고, 게이트웨이는 동서 구간을 덮지 못한다.
- 이점을 주장하려면 **증거의 위치**를 대야 한다. 우리 쪽 증거는 [06](관측성 통일) · [07](설정의 선언화) · [05](장애 층 분리) · [01]+[06](mTLS 적용과 커버리지 측정)에 있다.
- 청구서는 세 줄이다 — 프록시 단가(벤치마크 조건에서 사이드카당 약 0.20 vCPU · 60 MB)와 지연, 컨트롤 플레인 운영([02]·[09]), 그리고 수치로 안 잡히는 인지 비용([05]·[08]·[11]).
- **폴백은 여전히 앱 몫이다.** 공식 문서가 명시하는 이 경계를 빼먹으면 라이브러리 대비 절감폭이 과대 계상된다.

## 소스

- Istio 공식 문서 — **What is a service mesh?** (메시의 자기 정의: zero-trust 보안 · 관측성 · 고급 트래픽 관리를 코드 수정 없이, mTLS·정책 관리·접근 제어 포함): <https://istio.io/latest/about/service-mesh/>
- Envoy 공식 문서 — **What is Envoy** (언어별 커뮤니케이션 라이브러리 유지 문제, self-contained 프로세스로서의 사이드카 논거, "The network should be transparent to applications" 철학, 분산 아키텍처 문제의 두 뿌리): <https://www.envoyproxy.io/docs/envoy/latest/intro/what_is_envoy>
- Istio 공식 문서 — **Performance and Scalability** (사이드카 0.20 vCPU/60MB · waypoint 0.25 vCPU/60MB · ztunnel 0.06 vCPU/12MB, 배포 모드별 P90/P99 지연 벤치마크, configuration scoping 권고): <https://istio.io/latest/docs/ops/deployment/performance-and-scalability/> — **문서 내 벤치마크는 Istio 1.24 기준으로 명시돼 있다.** 인용 시점의 최신 안정 릴리스와 다를 수 있으므로 도입 검토에 쓸 때는 해당 버전 문서를 다시 확인할 것.
- Istio 공식 문서 — **Traffic Management** (실패 복구는 앱에 투명하지만 폴백은 앱 책임, 풀 전체 실패 시 Envoy가 503 반환): <https://istio.io/latest/docs/concepts/traffic-management/>
- Istio 공식 문서 — **Deployment Architecture** (사이드카 프록시 모델을 기존 배포에 코드 재작성 없이 적용): <https://istio.io/latest/docs/ops/deployment/architecture/>
- 채널코퍼레이션 기술 블로그 원문 목록은 [Ambient 도입기]({{< relref "ambient/_index.md" >}})의 참조 블록에 있다.

{{% details title="확인하지 못한 것" closed="true" %}}
- **istio.io 자체 문서에 '사이드카 vs 라이브러리' 비교를 명시적으로 프레이밍한 페이지**는 찾지 못했다. §1의 그 비교는 Envoy 공식 문서 쪽에서만 확인된다. istio.io는 "코드 수정 없이 기존 배포에 적용"이라는 각도로만 적는다.
- **istio.io가 '운영 복잡성(operational complexity)'이라는 표현을 그대로 써서** 메시의 비용으로 인정하는 대목은 성능 문서의 configuration scoping 권고 외에는 확인하지 못했다. §4의 운영 비용 서술은 그 권고와 우리 [02]·[09]의 실측에 근거한 것이다.
{{% /details %}}
