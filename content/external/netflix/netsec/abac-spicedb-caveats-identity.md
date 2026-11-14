---
title: "Netflix의 속성 기반 인가를 담은 SpiceDB Caveats"
description: "애플리케이션의 리전과 계정까지 권한 조건에 넣으면서 SpiceDB의 확장성을 지키려면 어떻게 해야 할까요? Netflix와 AuthZed는 관계에 조건을 붙이고 요청 시점의 신원 속성으로 평가하는 Caveats를 만들었습니다."
date: 2026-11-14
weight: 5
---

# Netflix의 속성 기반 인가를 담은 SpiceDB Caveats (2023-05)

{{< callout type="info" >}}
**원문 정보**
- 원문: [ABAC on SpiceDB: Enabling Netflix's Complex Identity Types](https://netflixtechblog.com/abac-on-spicedb-enabling-netflixs-complex-identity-types-c118f374fa89)
- 매체 · 게시일: Netflix TechBlog · 2023-05-19
- 저자: Chris Wolfe, Joey Schorr, Victor Roldán Betancort
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 이름만으로 묶기 어려운 Data Processor {#why-caveats}

Netflix의 Data Processor 인스턴스 하나가 test 환경의 eu-west-1에서 public 샤드로 실행된다고 해 보겠습니다. 이름만으로는 신원을 다 설명하지 못합니다. 어느 리전에서 어떤 환경과 샤드로 실행되는지도 권한을 정하는 속성이기 때문입니다. Netflix의 애플리케이션 인가는 이런 속성 기반 접근 제어(ABAC)를 전제로 합니다.

PI 복호화 키의 접근 정책을 보면 차이가 선명해집니다. 애플리케이션 소유자가 “EU data processors 그룹의 애플리케이션 구성원에게 키 접근을 허용한다”고 정했다면, SpiceDB에는 그룹 구성원이라는 평범한 관계를 표현하면 됩니다. 여기에 규정 준수 조건이 붙으면 이야기가 달라집니다. 키에 접근할 대상을 EU에 있으면서 민감한 샤드에서 실행되는 data processor 인스턴스로 더 좁히고 싶을 수 있습니다.

그때는 애플리케이션 이름만 확인해서는 부족합니다. `region==eu` 같은 신원 속성까지 맞아야 해당 인스턴스를 EU-data-processors 그룹의 구성원으로 인정해야 합니다. 관계는 존재하되, 조건이 맞을 때만 인가에 유효한 관계입니다. 이런 관계를 표현하는 것이 SpiceDB의 caveated 관계입니다.

## 새 그룹의 권한까지 늦추는 관계 갱신 {#modeling-challenges}

Netflix 인가 팀이 SpiceDB에 관심을 가진 출발점은 Google의 Zanzibar였습니다. 인가 결정 객체와 주체가 접근할 수 있는 리소스의 역인덱스를 만들기 쉽다는 점이 매력적이었습니다. 보안과 사용성, 효율을 높일 도구를 찾던 Netflix는 글이 나오기 전해 Zanzibar 방식을 실험하다 AuthZed의 오픈소스 SpiceDB를 발견했고, 모델링을 시험할 프로토타입을 만들었습니다.

문제는 신원을 표현하는 방식이었습니다. SpiceDB는 객체 사이에 특정 관계가 존재하는지 확인하는 관계 기반 접근 제어(ReBAC) 시스템입니다. 사용자라면 하나의 사용자 ID를 관계에 연결하면 되지만, Netflix 애플리케이션은 속성에 따라 권한의 범위가 달라집니다. 기존 정책을 관계로 옮기려면 그 속성까지 관계 데이터로 관리해야 했습니다.

이를 위해서는 먼저 오토스케일링 그룹 정보를 이벤트로 받아야 했습니다. 오토스케일링 그룹은 가장 낮은 단위는 아니지만, 보통 정책이 적용되는 가장 작은 단위에 가깝습니다. 그룹 정보를 받은 뒤에는 리전, 환경, 계정, 애플리케이션 이름 같은 속성을 각각 관계로 기록해야 합니다.

권한을 확인할 때도 이 모델에 맞춰야 합니다. 클라이언트가 “us-west-2의 앱 bar가 이 문서에 접근할 수 있는가”처럼 신원의 속성을 전달하면, SpiceDB는 그 속성을 나타내는 관계를 따라 해당 오토스케일링 그룹을 찾아야 합니다. 수명이 끝난 관계를 데이터베이스에서 지우는 작업도 따로 필요했습니다.

복잡성보다 더 마음에 걸린 것은 데이터가 빠졌을 때의 동작이었습니다. 새 오토스케일링 그룹이 시작됐는데 아직 SpiceDB에 자신을 알리지 못했다면, 그 그룹의 구성원에게는 실행에 필요한 권한이 없습니다. 애플리케이션이 조건을 만족하더라도 관계 데이터가 늦게 도착하면 권한을 얻지 못하는 모델입니다.

Netflix는 관계를 기록하고 오래된 관계를 정리하는 작업에 엄격한 최신성 요건까지 적용해야 하는 설계였습니다. 기존 정책 기반 시스템과는 거리가 컸습니다. 프로토타입에서 드러난 이 부담 때문에, 당시의 SpiceDB는 Netflix 애플리케이션 신원의 주요 요구에 잘 맞지 않았습니다.

## Zanzibar의 약속을 지키려던 Netflix와 AuthZed의 협업 {#beginning}

해법을 찾던 Netflix는 SpiceDB Discord에서 이미 열려 있던 caveated relationships 제안을 발견했습니다. 비슷한 고민을 하는 곳은 더 있었습니다. GitHub 제안에 달린 댓글과 반응, Discord의 대화는 관계 기반 인가에 정책을 결합하려는 수요를 보여 줬습니다.

커뮤니티는 앞서 Open Policy Agent(OPA)와 SpiceDB의 통합을 검토한 상태였습니다. 그러나 이 접근은 Zanzibar가 약속한 강한 일관성과 전역 수평 확장에서 너무 멀어진다는 판단을 내렸습니다. 정책을 표현하는 기능을 추가하면서도 Zanzibar 방식의 확장성을 유지해야 했습니다.

Netflix는 이 작업을 후원했습니다. 지원을 받은 AuthZed는 Zanzibar에 맞는 ABAC 설계에 우선순위를 두고 Caveats 개발을 앞당겼습니다. Netflix가 필요로 한 신원 모델을 지원하면서, 다른 SpiceDB 사용자도 더 풍부한 조건으로 권한을 확인하도록 만드는 협업이었습니다.

## 요청의 입력값을 담지 않는 분산 캐시 {#spicedb-intro}

정책을 어디에 넣을지 결정하려면 SpiceDB가 권한을 계산하는 방식부터 봐야 합니다. SpiceDB 스키마 언어는 관계 그래프를 만들고, 따라가고, 해석하는 규칙을 정합니다. `document:readme writer user:emilia` 같은 관계는 CockroachDB나 PostgreSQL 같은 저장소에 그래프로 기록됩니다.

SpiceDB는 그래프를 순회하면서 권한 확인을 하위 문제로 나눕니다. 이 문제들은 consistent hashing으로 클러스터의 각 노드에 배정됩니다. 노드마다 자신이 맡은 하위 문제를 캐시하면 클러스터 전체가 분산 캐시를 이루고, 저장소에서 관계를 반복해서 읽는 부하가 줄어듭니다. SpiceDB의 수평 확장을 뒷받침하는 방식입니다.

속성 기반 정책은 여기에 난점을 더합니다. 관계 저장소에는 없는 요청 입력값이 인가 결과를 바꿀 수 있기 때문입니다. 이런 정책 변수에 “오염된” 하위 문제를 그대로 캐시하면 다른 요청에서 재사용하기 어려워집니다. 캐시 적중률이 떨어지고, 저장소 접근을 줄이던 확장 방식도 영향을 받습니다.

그래서 실제 입력값은 캐시되는 하위 문제 밖에 두기로 했습니다. 요청이 와야 알 수 있는 값은 하위 문제에 변수로 남겨 둡니다. 관계를 찾는 계산을 재사용하면서, 요청마다 달라지는 입력은 나중에 평가하는 방식입니다.

물론 변수와 표현식을 전달하고 조립하고 실행하는 비용은 생깁니다. 하지만 그 비용은 저장소에서 관계를 가져오는 비용에 비하면 작습니다. 정책을 추가할 때 지켜야 했던 것은 요청마다 다른 값 때문에 관계 조회의 재사용까지 잃지 않는 것이었습니다.

## 요청 시점의 조건을 붙인 Relation {#caveats-design}

정책을 관계 그래프에 넣을 자리도 정해야 했습니다. SpiceDB 스키마의 Relation과 Permission은 관계의 모양과 그래프를 순회하는 방법을 정의합니다. 그래프의 간선에 해당하는 관계에 정책을 붙일 수도 있고, 권한 수준에 붙일 수도 있었습니다.

Netflix와 AuthZed는 양쪽을 반복해서 시험하며 사용성과 표현력을 비교했습니다. 선택한 자리는 Relation입니다. SpiceDB가 관계 기반 인가 시스템인 만큼, 각 관계를 매개변수화하는 방식이 잘 맞았습니다. “이 관계는 존재하지만 Caveat가 있다”는 뜻을 주고, SpiceDB가 요청 시점에 조건을 검사해 그 관계를 거부하도록 했습니다.

간단한 예로 `human`을 정의하고, `received == 42`를 검사하는 `the_answer` Caveat를 둘 수 있습니다. 여기에 `humans: human with the_answer` 관계와 `enlightenment = humans` 권한을 정의합니다. 관계가 있다는 사실만으로는 충분하지 않습니다. 전달받은 `received` 값이 42라는 조건도 통과해야 합니다.

표현식을 언제 정의할지도 논쟁거리였습니다. 정적 Caveat는 개발자가 스키마에 표현식을 적고, 동적 Caveat는 런타임에 표현식을 정의합니다. 정적 타입 언어와 동적 타입 언어를 두고 벌이는 논의와 닮아 있었습니다.

팀은 스키마에 표현식을 정의하는 정적 방식을 택했습니다. SpiceDB 스키마 언어가 이미 타입 안전성을 중심에 두고 있었기 때문입니다. 런타임에 제공되는 정책은 Caveat의 인자로 받을 수 있게 하면서, 스키마 자체는 이해하기 쉬운 상태로 유지하려 했습니다. 호출자가 전달하는 값도 정해진 타입에 맞아야 합니다.

## 빠진 변수를 알려 주는 CAVEATED {#partial-evaluation}

Caveat가 들어오면 관계를 찾았다고 해서 곧바로 허용이나 거부를 결정할 수 있는 것은 아닙니다. 조건식에 필요한 입력이 아직 없을 수 있습니다. 표현식 언어부터 이런 부분 평가를 제대로 지원해야 했습니다.

Google의 CEL은 그 요구에 잘 맞았습니다. protobuf를 기본으로 다루는 언어이고, 표현식을 선형 시간에 평가하며, 튜링 완전하지 않습니다. 타입 안전성은 런타임 오류를 줄이고, 컴파일한 표현식은 protobuf 형태로 저장소에 보관할 수 있습니다. 아직 계산이 끝나지 않은 부분 결과를 직접 다루고 엣지에서 실행할 수 있다는 점도 맞아떨어졌습니다.

요구와 닮은 점이 많았습니다. Zanzibar 논문이 나온 뒤 Google 안에서는 어떤 일이 있었을지 궁금해질 만큼, CEL은 필요한 특성을 갖추고 있었습니다.

부분 평가를 지원하려면 API 응답도 달라져야 합니다. CheckPermission의 결과가 아직 해결되지 않은 CEL 표현식에 달려 있다면 ALLOW나 DENY만으로는 그 상태를 나타낼 수 없습니다. SpiceDB는 이를 알리는 CAVEATED 응답을 추가했습니다.

CAVEATED를 받은 클라이언트에는 빠진 변수의 목록도 전달됩니다. 단순히 판단을 미뤘다고 알리는 데서 끝나지 않고, 표현식을 평가하려면 어떤 입력이 더 있어야 하는지 알려 줍니다.

## 미리 정한 값이 우선하는 Caveat context {#caveat-context}

Netflix의 신원처럼 여러 속성을 함께 검사하려면, 요청이 오기 전에 정해 둘 값과 요청에서 받아야 할 값을 함께 표현해야 합니다. 관계와 함께 미리 기록한 값, 클라이언트가 제공하는 값을 다루는 것이 Caveat context입니다.

앞의 예에서 정답을 항상 42로 고정하지 않는다고 해 보겠습니다. Caveat를 `caveat the_answer(received int, expected int)`로 정의하고 조건을 `received == expected`로 바꾸면 됩니다. 미리 정한 `expected`와 요청에서 받은 `received`를 같은 표현식에서 비교하게 됩니다.

빌드 시점에 정한 변수는 템플릿으로 만든 CEL 표현식을 펼칠 때 넣는 값과 비슷합니다. 이 값은 요청 시점의 인자보다 우선합니다. 같은 변수에 클라이언트가 다른 값을 보내더라도, 미리 정한 값이 평가에 쓰입니다.

권한 확인 하나에 Caveat가 붙은 하위 문제가 여러 개 포함될 수도 있습니다. SpiceDB는 이들의 표현식을 모아 최종 CEL 표현식 트리를 만든 뒤 평가합니다. 결과는 ALLOW, DENY, CAVEATED 중 하나입니다. 입력이 충분한지까지 최종 표현식에서 판단하는 방식입니다.

와일드카드와 SpiceDB API가 얽히는 경우에는 더 까다로운 문제가 남습니다. 이 부분은 별도 글에서 다루기로 했습니다.

## mover의 복제 권한을 좁히는 match_fine {#netflix-identities}

이 설계 덕분에 Netflix는 애플리케이션 정책을 기존에 쓰던 방식으로 표현할 수 있게 됐습니다. 인가에 필요한 전체 상태를 관계로 영속화할 필요가 줄었습니다. 관계를 저장하고, 권한을 확인할 때 신원의 속성을 전달받아 조건과 비교하면 됩니다.

예제의 `match_fine` Caveat는 이 모델을 구체적으로 보여 줍니다. 기대하는 계정·리전·스택·detail은 각각 `expected_accounts`, `expected_regions`, `expected_stacks`, `expected_details`라는 목록으로 받습니다. 기대하는 확장 속성은 `expected_ext_attrs` 맵에 담습니다. 검사할 인스턴스의 실제 값은 `observed_account`, `observed_region`, `observed_stack`, `observed_detail`, `observed_ext_attrs`로 전달됩니다.

조건식은 각 관측값이 대응하는 기대 목록에 들어 있는지 검사합니다. 확장 속성은 `expected_ext_attrs.isSubtreeOf(observed_ext_attrs)`로 확인합니다. 기대하는 확장 속성이 관측된 확장 속성의 부분 트리여야 한다는 뜻입니다. 이 조건들을 `&&`로 연결하므로 모두 통과해야 합니다.

관계를 정의하는 부분은 짧습니다. `app`을 정의한 뒤, `movie`에 `replicator: app with match_fine` 관계와 `replicate = replicator` 권한을 둡니다. 애플리케이션이 영화의 복제 권한을 얻으려면 관계에 연결돼 있어야 하고, 그 관계에 붙은 `match_fine` 조건도 만족해야 합니다.

구체적인 관계는 `movie:newspecial#replicator@app:mover`입니다. 이 관계에 붙인 Caveat는 mover가 아래 조건을 모두 만족할 때만 복제를 허용합니다.

- 계정은 highrisk 또는 birdie
- 리전은 us-west-1 또는 us-east-1
- 스택은 bg
- detail은 casser
- 확장 속성에 `foo: bar` 포함

원문에서 제공하는 playground에는 스키마와 관계를 직접 다뤄 볼 예제가 있고, CheckPermission의 동작을 나타내는 assertion도 들어 있습니다. 허용 조건뿐 아니라 어느 조건에서 거부되는지도 확인하는 예제입니다.

계정이 highrisk이고 리전이 us-west-1이며, 스택 bg와 detail casser, 확장 속성 `foo: bar`를 가진 mover의 결과는 `true`입니다. 같은 mover라도 계정을 lowrisk로 바꾸면 `false`가 됩니다. 애플리케이션 이름이 맞아도 속성 조건에서 탈락합니다.

속성을 모두 맞춘 채 애플리케이션을 purger로 바꿔도 결과는 `false`입니다. 속성 검사를 통과하는 것만으로는 부족합니다. `movie:newspecial`의 replicator 관계가 가리키는 애플리케이션은 여전히 mover입니다.
