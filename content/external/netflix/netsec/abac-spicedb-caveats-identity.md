---
title: "SpiceDB Caveats로 구현한 Netflix 애플리케이션 신원의 ABAC"
description: "Netflix 인증·인가 팀이 AuthZed와 함께 Zanzibar 계열 권한 시스템 SpiceDB에 속성 기반 접근 제어(ABAC)를 더한 Caveats 기능을 만든 배경과 설계를 정리했습니다. 속성으로 정의되는 애플리케이션 신원을 다루려는 요구에서 출발했습니다."
date: 2026-11-14
weight: 5
---

# SpiceDB Caveats로 구현한 Netflix 애플리케이션 신원의 ABAC (2023-05)

{{< callout type="info" >}}
**원문 정보**
- 원문: [ABAC on SpiceDB: Enabling Netflix's Complex Identity Types](https://netflixtechblog.com/abac-on-spicedb-enabling-netflixs-complex-identity-types-c118f374fa89)
- 매체 · 게시일: Netflix TechBlog · 2023-05-19
- 저자: Chris Wolfe, Joey Schorr, Victor Roldán Betancort
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 개요와 배경 {#overview}

Netflix의 인가(authorization) 팀은 AuthZed가 만든 오픈소스 권한 시스템 SpiceDB에 속성 기반 접근 제어(ABAC) 지원을 추가하는 작업을 후원했습니다. SpiceDB는 Google Zanzibar에서 영감을 받은 시스템입니다. Netflix 애플리케이션 신원의 핵심 구조를 표현하려면 속성 지원이 필요했기 때문입니다. 글은 Netflix가 SpiceDB에 ABAC를 원한 이유, AuthZed와의 협업 과정, 결과물인 SpiceDB Caveats, 앞으로의 활용 방향을 다룹니다.

Netflix는 보안, 사용성, 효율을 높일 방법을 늘 찾고, 인가 도구도 예외가 아닙니다. Zanzibar는 인가 결정 객체와, 주체가 접근할 수 있는 리소스의 역인덱스를 만들기 쉽게 해 준다는 점에서 눈길을 끌었습니다. 지난해 Zanzibar식 인가를 실험하다 SpiceDB를 찾아 모델링 시험용 프로토타입을 만들었는데, 이 프로토타입은 SpiceDB에서 ABAC를 구현할 때 따라오는 트레이드오프를 드러냈고, 그 때문에 애플리케이션 신원에 대한 Netflix의 핵심 요구에는 잘 맞지 않았습니다.

## Caveated 관계가 필요했던 이유 {#why-caveats}

Netflix의 애플리케이션 신원은 본질적으로 속성 기반입니다. 예를 들어 Data Processor 인스턴스 하나는 test 환경의 eu-west-1에서 public 샤드로 돌아갑니다. 이런 신원의 인가는 애플리케이션 이름만이 아니라 맞춰야 할 구체적인 속성을 지정해서 합니다.

애플리케이션 소유자는 "EU data processors 그룹의 애플리케이션 구성원은 PI 복호화 키에 접근할 수 있다"라는 정책을 쓰고 싶을 수 있습니다. 이는 SpiceDB의 평범한 관계 하나입니다. 하지만 규정 준수를 위해 PI 키 접근을 민감한 샤드에서 EU에 떠 있는 data processor 인스턴스로만 제한하는 정책을 쓰고 싶을 수도 있습니다. 바꿔 말하면 애플리케이션 이름에 더해 region==eu 같은 신원 속성이 맞을 때만 그 신원을 "EU-data-processors 그룹의 구성원"으로 쳐야 합니다. 이것이 SpiceDB의 caveated 관계입니다.

## Caveats 이전의 모델링 어려움 {#modeling-challenges}

SpiceDB는 관계 기반 접근 제어(ReBAC) 시스템이라, 인가 확인을 객체 사이에 특정 관계가 존재하는지로 판단하리라 기대합니다. 사용자는 하나의 사용자 ID로 자신을 나타내므로 이 모델에 맞습니다. 반면 Netflix의 애플리케이션은 맞지 않습니다. 속성이 권한의 범위를 여러 정도로 한정하기 때문입니다.

기존 정책 모델을 관계로 옮기려면 설계에 다음이 필요했습니다.

- 오토스케일링 그룹 정보를 받아들이는 이벤트 기반 메커니즘. 오토스케일링 그룹은 가장 낮은 단위는 아니지만, 보통 인가 정책이 적용되는 가장 낮은 단위에 꽤 가깝습니다.
- 오토스케일링 그룹의 속성을 받아들여 별도의 관계로 쓰기. data-processor라면 리전, 환경, 계정, 애플리케이션 이름 등을 설명하는 관계를 써야 합니다.
- 인가 확인 때 확인할 신원의 속성을 제공하기. 예를 들어 "us-west-2의 앱 bar가 이 문서에 접근할 수 있는가"를 묻고, 이름·환경·리전 등 오토스케일링 그룹에 연결되는 관계는 SpiceDB가 찾습니다.
- 데이터베이스의 오래된 관계를 정리하는 프로세스.

이 설계는 복잡한 것 말고도 Netflix가 불편해한 점이 몇 가지 있었습니다. 가장 두드러진 것은 관계 데이터가 없을 때 복원력이 없다는 점입니다. 새 오토스케일링 그룹이 시작됐는데 SpiceDB에 존재를 알리는 일이 아직 안 됐다면, 그 그룹의 구성원은 실행에 필요한 권한이 없어집니다. 결국 Netflix가 관계 상태를 쓰고 정리하는 일을 엄격한 신선도 요건 아래서 해야 하고, 이는 기존 정책 기반 시스템에서 크게 벗어나는 일입니다.

이 문제를 고민하던 Netflix는 SpiceDB Discord에서 해법을 논의하다 열려 있던 커뮤니티 이슈, caveated relationships 제안을 찾았습니다.

## Caveats의 시작 {#beginning}

SpiceDB 커뮤니티는 SpiceDB와 Open Policy Agent(OPA)의 통합을 이미 검토했고, 그것이 Zanzibar의 핵심 약속인 강한 일관성의 전역 수평 확장성에서 너무 벗어난다고 결론 냈습니다. Netflix의 지원으로 AuthZed 팀은 Zanzibar 고유 방식의 ABAC를 고민하게 됐습니다.

요구 사항은 정리해 GitHub에 caveated relationships 제안으로 올려 SpiceDB 커뮤니티의 의견을 받았습니다. 댓글, 반응, Discord의 대화에서 커뮤니티의 관심이 분명히 드러났습니다. SpiceDB와 정책 기반 접근을 조화시키는 어려움을 겪는 곳은 Netflix만이 아니었고, 그래서 Netflix는 직접 돕기로 했습니다. 프로젝트를 후원해 AuthZed가 엔지니어링 노력의 우선순위를 정하고 Caveats 추가를 앞당기도록 도왔습니다.

## SpiceDB 구조 개괄 {#spicedb-intro}

SpiceDB 스키마 언어는 권한 결정을 내리려고 SpiceDB의 관계 그래프를 만들고 순회하고 해석하는 규칙을 정합니다. `document:readme writer user:emilia` 같은 관계는 CockroachDB나 PostgreSQL 같은 데이터 저장소에 그래프로 저장됩니다. SpiceDB는 그래프를 따라가며 하위 문제로 쪼갭니다. 하위 문제는 consistent hashing으로 배정해 SpiceDB가 도는 클러스터의 노드로 보냅니다. 시간이 지나면 노드마다 하위 문제의 일부를 캐시해 분산 캐시를 이루고, 이것이 저장소 부하를 줄이며 수평 확장성을 만듭니다.

## Caveats의 설계 {#caveats-design}

정책의 근본적인 어려움은 입력 인자에 따라 인가 결과가 달라질 수 있는데, 중앙 관계 저장소는 이를 모른다는 점입니다. 정책 변수가 "오염된" 하위 문제를 캐시하면 다른 요청에서 재사용될 가능성이 낮아져 캐시 적중률이 크게 떨어집니다. 이는 시스템의 기둥인 확장성을 해칩니다.

분산 캐시에 입력 인자를 넣는 것이 비효율적이라는 데 동의하면, 입력을 캐시되는 하위 문제 밖에 두자는 생각이 자연스럽게 따라옵니다. 입력은 요청 시점에야 알 수 있으니 하위 문제에 변수로 추가합니다. 변수를 전파하고 조립하고 논리를 실행하는 비용은 저장소에서 관계를 가져오는 비용에 비하면 보잘것없습니다.

다음 질문은 정책 결정을 관계 그래프에 어떻게 넣느냐였습니다. SpiceDB 스키마 언어의 핵심 개념은 Relation과 Permission이며 개발자는 이것으로 관계의 모양과 순회 방법을 정의합니다. 그래프라는 점에서 정책 논리는 간선이나 노드에 붙이는 것이 어울립니다. 그러면 Relation 수준의 정책과 Permission 수준의 정책이라는 두 가지 뚜렷한 선택지가 남습니다. 두 방식을 반복해 써 보며 사용성과 표현력을 가늠한 끝에 Relation 수준을 택했습니다. SpiceDB가 관계 기반 접근 제어(ReBAC) 시스템이기 때문입니다. Relation 수준 정책은 각 관계를 매개변수화할 수 있어 "이 관계는 존재하지만 Caveat가 있다"는 말이 나왔습니다. 이렇게 하면 SpiceDB가 요청 시점에 관계를 거부(veto)할 수 있습니다. 원문의 예는 human 정의와, received가 42일 때만 참인 `the_answer` caveat, 그리고 `humans: human with the_answer` 관계에서 `enlightenment = humans` 권한을 두는 스키마입니다.

Netflix와 AuthZed는 정적 Caveat와 동적 Caveat도 논의했습니다. 정적 Caveat 표현식은 개발자가 SpiceDB 스키마에 정의하고, 동적 Caveat는 표현식을 런타임에 정의합니다. 논의는 정적 타입 언어와 동적 타입 언어의 비교 같았고, SpiceDB 스키마 언어가 타입 안전성을 염두에 두고 설계됐으니 정적 Caveat를 계속하는 것이 전체 설계와 일관됐습니다. 런타임에 제공되는 정책을 지원하려고 표현식을 Caveat의 인자로 받기로 했습니다. 스키마를 이해하기 쉽게 유지하는 것이 이 결정의 핵심 동기였습니다.

표현 언어는 부분 평가된 표현식을 일급으로 지원해야 했고, Google의 CEL이 분명한 선택으로 보였습니다. CEL은 protobuf 네이티브 표현 언어로 선형 시간에 평가하고, 엣지에서 실행할 수 있는 부분 결과를 일급으로 지원하며, 튜링 완전하지 않습니다. 타입 안전해서 런타임 오류가 적고 컴파일된 protobuf로 데이터 저장소에 저장할 수 있습니다. 요구에 거의 완벽히 들어맞는 만큼, Google의 Zanzibar는 백서 이후 무엇을 해 왔는지 궁금해진다고 원문은 농담을 합니다.

표현식을 실행하려면 SpiceDB가 ALLOW와 DENY 말고 세 번째 응답 CAVEATED를 돌려줘야 했습니다. CheckPermission 요청의 결과가 해결되지 않은 CEL 표현식 연쇄의 계산에 달려 있음을 알리는 값입니다.

Netflix 애플리케이션 신원의 다차원성을 표현하려면 평가 전에 정적 입력 변수를 저장할 수 있어야 했습니다. 오늘날 이를 "Caveat context"라고 하며, SpiceDB 스키마에서 Relation 옆에 적은 값과 클라이언트가 제공하는 값으로 정의됩니다. 빌드 시점 변수는 템플릿 CEL 표현식을 펼치는 것으로 보면 되고, 요청 시점 인자보다 우선합니다. 예시는 `caveat the_answer(received int, expected int)`에 `received == expected` 조건을 건 것입니다.

Caveat가 걸린 하위 문제가 여러 개인 경우는 최종 CEL 표현식 트리를 모은 뒤에 평가하기로 했습니다. 최종 평가 결과는 ALLOW, DENY, CAVEATED 중 하나입니다. 와일드카드와 SpiceDB API가 얽히면 더 까다로워지는데, 이는 다른 글에서 다루겠다고 합니다. 응답이 CAVEATED면 클라이언트는 표현식을 제대로 평가하는 데 필요한, 빠진 변수의 목록을 받습니다.

주요 설계 결정은 다섯 가지입니다.

- Caveat는 Permission 수준이 아니라 Relation 수준에서 정의합니다.
- SpiceDB 스키마의 타입 안전한 성격과 일관되게 유지합니다.
- 호출자가 제공하는 잘 타입된 값을 지원합니다.
- Caveat 표현식은 Google의 CEL로 정의합니다.
- 새 결과 유형 CAVEATED를 도입합니다.

## Netflix 신원 인가에 달라진 점 {#netflix-identities}

SpiceDB Caveats 덕분에 Netflix는 애플리케이션에 대해 예전부터 하던 식으로 인가 정책을 지정할 수 있습니다. 인가 세계의 전체 상태를 관계로 영속화하는 대신, 시스템은 관계와 함께 인가 확인 시점에 제공되는 신원의 속성을 가지면 됩니다.

이제 Netflix는 `match_fine` 같은 Caveat를 쓸 수 있습니다. 이 Caveat는 기대하는 속성 목록, 예를 들어 리전과 계정을 받아, 인가 확인 context에 관측된 계정, 스택, 상세(detail), 리전, 확장 속성 값이 대응하는 기대값과 맞을 때만 관계가 가리키는 애플리케이션을 허용합니다. 원문은 스키마와 관계를 직접 만져 볼 수 있는 playground 링크를 제공합니다.

스키마는 `app` 정의와, 기대값 목록(`expected_accounts`, `expected_regions`, `expected_stacks`, `expected_details`, `expected_ext_attrs`)과 관측값(`observed_*`)을 인자로 받는 `match_fine` caveat로 구성됩니다. 본문은 관측된 계정·리전·스택·detail이 각각 기대 목록에 포함되고, 기대 확장 속성이 관측된 확장 속성의 부분 트리인지를 `&&`로 묶습니다. `movie` 정의는 `replicator: app with match_fine` 관계와 `replicate = replicator` 권한을 갖습니다.

이 스키마로 replicator 애플리케이션 접근을 제한하는 관계를 쓸 수 있습니다. 예시는 `movie:newspecial#replicator@app:mover`로, 다음 조건을 모두 만족할 때만 실행을 허용합니다.

- highrisk 또는 birdie 계정에 있을 것
- 리전이 us-west-1 또는 us-east-1일 것
- 스택이 bg일 것
- detail이 casser일 것
- 확장 속성에 키·값 쌍 `foo: bar`가 들어 있을 것

playground에서는 CheckPermission API의 동작을 비춘 assertion도 쓸 수 있어 Caveat가 의도대로 동작하는지 확인됩니다. 원문의 assertion은 이렇습니다.

- 계정 highrisk, 리전 us-west-1, 스택 bg, detail casser, 확장 속성 foo: bar인 mover는 허용(true)
- 계정이 lowrisk인 mover는 거부(false)
- 다른 앱 purger는 속성이 같아도 거부(false)

## 맺음 {#closing}

Netflix와 AuthZed 모두 협업의 결과에 만족합니다. Netflix는 쓸 수 있는 인가 도구가 하나 늘었고, SpiceDB 사용자는 풍부한 인가 확인을 할 수 있는 선택지가 하나 늘었습니다. 정책 기반 인가와 ReBAC 사이의 틈을 메우는 것은 강력한 패러다임이며, 인가 스택을 현대화하려고 Zanzibar 기반 구현을 찾는 기업들에 이미 도움이 되고 있다고 원문은 말합니다. 글 끝에는 Zanzibar 소개와 주석을 단 논문, SpiceDB, CEL, 용어집, 자주 쓰는 Caveat 패턴, SpiceDB의 권한 응답 방식, Netflix의 복합 신원 예제 스키마 같은 추가 읽을거리가 붙어 있습니다.
