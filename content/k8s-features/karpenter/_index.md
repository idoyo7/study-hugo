---
title: "Karpenter"
weight: 4
---

# Karpenter — 노드를 고르는 알고리즘, 그리고 그 위의 운영 판단

{{< callout type="info" >}}
**한눈에**
- **단일 NodePool 안에는 세대 선호를 표현할 축이 아예 없다.** `requirements` 스키마는 Key/Operator/Values/MinValues 넷뿐이고 `weight`는 NodePool **레벨**에만 있다. 업스트림도 이 요구를 두 번 반려했다(karpenter#1829 *closed as not planned*, provider-aws#6721 *closed*).
- **`spec.weight`는 가격보다 먼저 적용된다.** NodePool을 고르는 코드 경로에는 가격 비교가 한 줄도 없다 — `grep -ic price` on `scheduler.go` → **0건**. 세대 선호를 만드는 GA 해법은 NodePool을 쪼개고 weight를 주는 것 하나뿐이다.
- **그러나 weight는 "보장"이 아니다.** 공식 문서가 명시적으로 비보장을 선언한다. 원인은 "이미 떠 있는 노드"가 아니라 **단일 프로비저닝 루프 내부의 빈패킹** — in-flight NodeClaim을 weight가 아니라 파드 수 오름차순으로 정렬하고, 거기 얹는 시도가 새 NodeClaim 생성보다 먼저 온다.
- **consolidation은 weight를 아예 모른다.** disruption 패키지에 `Spec.Weight` 참조 **0건**, 교체 조건은 `launchPrice < candidatePrice` 부등식 하나(strict라 동가격 교체도 없다). 그래서 **한 번 7세대로 내려가면 consolidation으로는 절대 안 돌아온다** — 오버레이를 쓰지 않는 한 복귀 경로는 `expireAfter`와 drift뿐이다.
- **폴백 자체는 이미 공짜다.** ICE가 나면 provider-aws가 오퍼링을 unavailable로 마킹하고(TTL 3분) 코어가 후보에서 뺀다. 만들어야 하는 건 폴백이 아니라 **"평소엔 8세대"라는 상향 강제**다.
- **단일 NodePool을 지키는 유일한 우회로 NodeOverlay는 알파다.** `v1alpha1` + feature gate **기본 false**, 그리고 마지막 결정을 EC2 Fleet의 `prioritized` 해석에 위임하는데 거기에 **코드로도 공개 문서로도 확정 못 한 구멍이 둘** 있다(정수 `Priority` 규정, 단일 CreateFleet 내 폴백 미보장).
{{< /callout >}}

> **왜 이 섹션인가.** 상위 [Kubernetes]({{< relref "../_index.md" >}}) 챕터가 "공식 문서가 말해주지 않는 실사용 판단"을 다룬다면, 이 섹션은 그 중에서도 **판단의 근거가 전부 소스 코드 안에 있는** 주제다. Karpenter는 "적당한 노드를 알아서 띄워 주는" 컨트롤러로 소개되지만, 그 "적당히"의 실체는 몇 개의 정렬·절단·부등식이고, 그 조합이 운영자의 의도와 어긋나는 지점은 문서가 아니라 코드에만 적혀 있다. 이 섹션은 노드를 고르는 경로를 함수 단위로 내려가 뜯고, **그 위에서 "그래서 무엇을 선언할 것인가"까지** 결정한다.

> 자매 챕터: 상위 [Kubernetes]({{< relref "../_index.md" >}}) · [eks-upgrade 01 Karpenter]({{< relref "../../eks-upgrade/components/01-karpenter.md" >}}) — 그쪽이 0.36.2 → 1.14.0, v1beta1 → v1 CRD를 **어떻게 올렸나**의 기록이라면, 이 섹션은 **올리고 나서 무엇을 어떻게 고르게 만드나**다.

## 한 질문에서 시작했다

출발점은 아키텍처 리뷰가 아니라 NodePool YAML 한 장이었다. EKS 클러스터에 8세대 인텔 패밀리(c8i·m8i·r8i)를 `karpenter.k8s.aws/instance-family In [...]`로 선언해 뒀다. 그런데 8세대는 리전·AZ에 따라 용량이 얇아서 InsufficientInstanceCapacity가 날 수 있다. 그러니 7세대(c7i·m7i·r7i)를 폴백으로 같은 `values`에 얹어 두고 싶은데 — **7세대가 더 싸다.**

> "이렇게 넣으면 8세대는 영영 안 뜨고 항상 7세대만 뜨는 것 아닌가?"

답은 "예"다. 하지만 **왜 예인지**를 답하지 못하면 대응책을 고를 수 없다. 후보 목록이 잘려서인지, requirements 필터가 걸러서인지, Karpenter가 정렬해서인지, 아니면 EC2가 정하는 건지 — 원인이 어디냐에 따라 손댈 곳이 완전히 달라지기 때문이다. "Karpenter가 싼 걸 좋아해서"는 설명이 아니라 관측 결과의 재진술이다.

그래서 코어와 provider-aws 소스를 파드가 pending되는 순간부터 EC2가 인스턴스를 띄우는 순간까지 따라갔다. 질문 하나가 네 개로 갈라졌다.

| 원래 질문의 조각 | 갈라져 나온 문서 |
|---|---|
| 인스턴스 타입을 **누가** 정하나 | 01 — 스케줄러는 확정하지 않는다. 후보를 통째로 넘기고 EC2가 `lowest-price`로 고른다 |
| 그럼 선호는 **어디에** 표현하나 | 02 — NodePool 경계 바깥에는 표현할 자리가 없다 |
| 만들어 놓은 선호는 **왜** 무너지나 | 03 — 재계산 루프(consolidation·drift)는 "세대"라는 단어를 모른다 |
| 8세대가 정말 없을 때 **무슨 일**이 나나 | 04 — ICE 캐시 3분, 폴백 왕복 11~30초, spot을 섞으면 전제가 바뀐다 |

결론만 먼저 말하면 이렇다. **단일 NodePool 안에서는 불가능하다. NodePool을 세대별로 쪼개고 `spec.weight`를 주는 것이 유일한 GA 해법이다.** 알파를 감수하면 NodeOverlay `priceAdjustment`로 7세대에 가상 가격세를 물리는 길이 하나 더 있지만, 그 길 끝에 확인 못 한 구멍이 둘 있다.

## 문서 지도

| 문서 | 전제 | 한 줄 요약 |
|------|------|-----------|
| [01 인스턴스는 누가 고르는가]({{< relref "01-instance-selection.md" >}}) | 없음 — 섹션 진입점 | 스케줄러 → NodeClaim → Truncate → EC2 Fleet 경로를 함수 단위로 따라간다. 최종 선택자는 EC2고, "절단이 8세대를 잘라낸다"는 흔한 오해는 사실이 아니다 |
| [02 세대 선호 만들기]({{< relref "02-generation-preference.md" >}}) | 01 | NodePool 분리 + `spec.weight`(GA) vs NodeOverlay `priceAdjustment`(알파)를 코드 경로로 비교하고, **복붙해서 쓸 매니페스트 전문**을 낸다 |
| [03 consolidation이 되돌리는 것]({{< relref "03-consolidation-traps.md" >}}) | 02 | 세워 놓은 구성이 며칠~몇 주에 걸쳐 조용히 무너지는 경로 — 가격 부등식 하나, weight 미인지, 복귀 부재, `expireAfter`의 함정, drift |
| [04 용량이 없을 때]({{< relref "04-ice-fallback.md" >}}) | 01 | ICE 캐시의 3분과 세 축, 폴백 실측 지연, spot을 섞는 순간 논의가 바뀌는 이유, 알파 없이 8세대를 1순위로 만드는 ODCR |

**읽는 순서**는 01 → 02가 최단 경로다. 당장 매니페스트만 필요하면 02 §4로 바로 가도 되지만, 그 매니페스트가 왜 두 개의 NodePool인지는 01에서만 설명된다. 03과 04는 독립적으로 읽어도 되고, 이미 운영 중이라면 03이 실무 직결이다.

## 공통 핵심

- **"싸서 고른다"의 주어는 Karpenter가 아니다.** 코어 스케줄러는 인스턴스 타입을 확정하지 않고 후보 집합을 통째로 NodeClaim에 실어 보낸다. 가격으로 하나를 뽑는 주체는 EC2 CreateFleet이다. 주어를 틀리면 손댈 곳도 틀린다. → [01]({{< relref "01-instance-selection.md" >}})
- **선호는 NodePool 경계로만 표현된다.** `requirements`는 집합 연산(In/NotIn/Gt/Lt/Exists)일 뿐 서열이 아니고, 파드의 `preferred` nodeAffinity도 대안이 아니다. 서열이 필요하면 경계를 나눠야 한다. → [02]({{< relref "02-generation-preference.md" >}})
- **컨트롤러는 계속 다시 계산한다.** "적용한 순간 의도대로 동작함"은 정상 상태의 증거가 아니다. consolidation·drift·expiration이 각각 다른 기준으로 노드를 갈아치우고, 그중 어느 것도 weight를 모른다. → [03]({{< relref "03-consolidation-traps.md" >}})
- **없는 기능을 만들기 전에 있는 기능을 확인하라.** 이 조사에서 가장 값싼 발견은 "폴백은 이미 동작한다"였다. 원래 요구의 절반이 이미 구현돼 있었고, 실제로 만들어야 할 것은 반대 방향(상향 강제)이었다. → [04]({{< relref "04-ice-fallback.md" >}})
- **알파 기능의 비용은 기능 자체가 아니라 확정 불가한 구멍이다.** NodeOverlay는 코어 쪽 배선이 깔끔하지만, 마지막 한 홉(EC2 Fleet `prioritized`)의 계약이 코드로도 문서로도 확정되지 않는다. 이런 구멍은 도입 전 실측 말고는 메울 방법이 없다. → [02]({{< relref "02-generation-preference.md" >}})
- **버전을 안 밝힌 Karpenter 문장은 믿지 마라.** 코어(kubernetes-sigs/karpenter)와 provider(aws/karpenter-provider-aws)가 따로 태깅되고, provider 릴리스가 코어를 핀한다. 같은 "v1.11.3"이라도 안에 든 코어는 다르다.

## 검증 기준

이 섹션의 모든 코드 인용은 아래 두 저장소의 로컬 체크아웃을 직접 읽어 확인했다.

| 저장소 | 기준 버전 | 비고 |
|---|---|---|
| kubernetes-sigs/karpenter (코어) | **v1.14.0-6-gac7a021e** | 라인번호 인용의 기준. 스케줄링·disruption·NodeOverlay 배선 |
| aws/karpenter-provider-aws | **main** · **v1.7.0** · **v1.11.3** | CreateFleet 호출부·ICE 캐시·오퍼링 가격. v1.7.0은 NodeOverlay 지원이 처음 들어간 태그 |

{{< callout type="warning" >}}
**라인번호는 배포 버전과 어긋날 수 있다.** provider-aws **v1.11.3이 핀하는 코어는 v1.11.2**인데, 이 섹션의 코어 라인번호는 v1.14 기준이다. 함수명·조건식·상수값은 그대로 유효하지만 `파일:라인` 형태의 인용을 그대로 열면 몇 줄 어긋난 곳에 도착할 수 있다. 자기 클러스터에서 확인할 때는 라인이 아니라 **함수명·식별자로 검색**하라.

각 문서 말미에는 **확인하지 못한 항목**을 별도 callout으로 모아 뒀다. 특히 EC2 Fleet `prioritized` 전략의 소수 `Priority` 해석은 01·02·04 세 문서에 걸쳐 반복 등장하는데, AWS API 레퍼런스가 `Priority`를 "whole numbers starting at 0"으로 규정하는 반면 Karpenter는 소수 달러값을 넣는다. 정수 절단이 일어나면 시간당 $1 미만 인스턴스가 전부 priority 0이 되어 세대 선호가 조용히 무력화된다 — **NodeOverlay를 도입한다면 실측 검증이 필수다.**
{{< /callout >}}
