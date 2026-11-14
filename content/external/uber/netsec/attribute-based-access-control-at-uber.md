---
title: "UUID만으로 풀리지 않던 권한 문제와 Uber의 ABAC"
description: "고객의 지역이나 직원과 매니저의 관계까지 어떻게 인가 정책에 담을까요? Uber는 Charter의 권한 모델에 속성 조건을 추가하고, 속성 저장소와 CEL로 이를 평가해 Kafka 토픽 관리에도 적용했습니다."
date: 2026-11-10
weight: 8
---

# UUID만으로 풀리지 않던 권한 문제와 Uber의 ABAC (2023-07)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Attribute-Based Access Control at Uber](https://www.uber.com/us/en/blog/attribute-based-access-control-at-uber/)
- 매체 · 게시일: Uber Engineering Blog · 2023-07-13
- 저자: Alan Cao(Staff Software Engineer, Core Security Engineering 팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 결제 프로필 UUID에 담기지 않은 고객의 지역 {#need}

우버의 결제 지원 서비스에는 고객 지원 담당자가 특정 국가·지역·도시의 고객 결제 정보에만 접근해야 한다는 요구가 있었습니다. 그런데 기존 정책이 다루는 대상은 결제 프로필 UUID뿐입니다. UUID에서 고객 계정과 지역을 알아낼 수는 있어도, 기존 정책 문법으로는 그 지역을 접근 조건에 담을 수 없었습니다.

직원 프로필에서는 사람 사이의 관계가 필요했습니다. 직원 본인이나 그 직원의 매니저가 프로필을 관리하게 하려면, 리소스가 가리키는 직원 ID와 요청한 행위자·매니저의 ID를 연결해야 합니다. 누가 어떤 프로필에 접근하는지 식별한 뒤, 서로 어떤 관계인지까지 판단해야 하는 요구입니다.

데이터 분석 서비스에는 그룹 조건이 부족했습니다. 사용자가 N개 그룹 모두에 속할 때만 접근을 허용해야 했지만, 기존 모델은 그룹을 지원하면서도 그룹 사이의 AND 관계는 표현하지 못했습니다.

우버는 이런 요구를 정책에 담기 위해 속성 기반 접근 제어(ABAC)를 도입했습니다. 행위자나 리소스의 ID에 더해, 여러 정보 시스템에서 얻은 속성과 그 관계를 인가 조건으로 쓰는 방식입니다. 고객의 지역을 정책으로 제한하거나 직원과 매니저의 관계를 확인하는 규칙도 같은 모델 안에서 표현하게 됐습니다.

## Charter에서 관리하고 authfx에서 평가하는 정책 {#concepts}

우버에는 이미 중앙 정책 서비스 Charter가 있었습니다. AWS나 Google Cloud의 IAM 정책처럼 접근 제어 정책을 한곳에서 관리합니다. 정책 작성자가 Charter에서 YAML 정책을 작성하면 서비스가 실행되는 호스트로 배포되고, 각 서비스는 로컬 라이브러리인 authfx의 인가 API를 호출해 정책을 평가하고 접근을 제어합니다.

인가 요청을 바라보는 방식도 공통입니다. “행위자(Actor)가 주어진 맥락(Context)에서 리소스(Resource)에 행동(Action)을 수행한다”로 표현합니다. Action은 리소스 타입별로 정의하며 CRUD가 흔한 예입니다.

Actor는 인가 판단의 대상이 되는 주체입니다. 인증이 신원을 확인한다면, 인가는 그 주체에게 요청한 행동을 허용할지 결정합니다. 우버는 Actor를 SPIFFE 형식으로 나타냅니다. 직원 ID가 123456인 직원은 `spiffe://personnel.upki.ca/eid/123456`, 고객은 `spiffe://customer.upki.ca/user/`, production의 service-foo 마이크로서비스는 `spiffe://prod.upki.ca/workload/service-foo/production` 같은 식입니다.

Resource의 범위는 넓습니다. RPC나 HTTP 엔드포인트뿐 아니라 테이블의 행·열, 고객·승차·주문 같은 비즈니스 객체도 대상입니다. 각 리소스는 타입을 가지며, `uon` 스킴을 쓰는 URI인 UON(Uber Object Name)으로 식별합니다. `uon://service-foo/production/rpc/foo/method1`은 RPC 엔드포인트를, `uon://orders.mysql.storage/production/table/orders`는 테이블을 나타냅니다. 호스트 부분은 Charter가 사용 사례별 정책과 설정을 묶는 네임스페이스인 정책 도메인입니다.

기본 정책은 리소스 매처와 액션, 행위자 매처를 권한(permission)으로 연결합니다. 서비스 bar에 서비스 foo의 method1 호출을 허용하거나, `querybuilder-development` 그룹의 직원에게 쿼리 리포트 읽기와 쓰기를 허용하는 식입니다. 앞서 본 결제 지역이나 직원 관계는 이 매칭만으로 표현할 수 없는 조건이었습니다.

ABAC도 이 정책 관리·배포 방식을 유지합니다. 서비스마다 인가 로직을 따로 구현할 부담을 줄이고, 정책 소유자는 서비스 코드를 다시 빌드하거나 재배포하지 않고 Charter에서 접근 규칙을 바꿀 수 있습니다.

## 권한에 추가한 condition 필드 {#model}

기존 권한 모델에는 선택 필드인 `condition`을 추가했습니다. 조건이 붙은 권한은 리소스·액션·행위자 매처가 모두 요청과 맞아도 곧바로 효력이 생기지 않습니다. 조건 표현식까지 true로 평가돼야 합니다.

조건에 쓰는 재료가 속성(Attribute)입니다. 행위자, 리소스, 액션, 환경의 특성을 인가 판단에 사용합니다. 이 값을 인가 시점에 제공하는 원천이 속성 저장소(Attribute Store)이며, 인가 프레임워크에서는 PIP(Policy Information Point)에 해당합니다.

우버는 속성 저장소를 서비스의 업무에 필요한 값을 가져오는 플러그인으로 만들었습니다. 한 서비스가 여러 저장소를 사용할 수 있고, 여러 서비스가 같은 저장소를 공유할 수도 있습니다. 서비스별 요구를 지원하면서 속성을 가져오는 구현은 재사용하는 방식입니다.

정책을 평가할 때 인가 엔진은 조건에 필요한 속성 값을 저장소에 요청합니다. 조건과 값을 받은 표현식 엔진이 불리언 결과를 반환하면, 인가 엔진은 이를 권한 판단에 반영합니다.

속성을 미리 파악하는 단계와 실제 값을 읽는 시점은 다릅니다. 저장소는 `SupportedAttributes()`를 구현해 지원하는 속성을 알려야 하며, 인가 엔진은 이 정보로 조건 표현식을 미리 컴파일합니다. 실제 인가 요청을 처리하다 값이 필요해지면 `Get*Attribute` 메서드를 호출합니다.

## 필요한 속성만 요청하는 표현식 언어 CEL {#cel}

조건을 추가하려면 이를 작성하고 평가할 언어가 필요합니다. 우버는 새 언어를 만들기보다 오픈소스 후보를 검토했고, 단순함과 유연성을 이유로 Google의 Common Expression Language(CEL)를 선택했습니다.

CEL로 작성한 조건은 이런 모습입니다.

`resource.paymentType == 'credit card' && actor.location == resource.paymentLocation`

결제 수단이 `credit card`이고, 행위자의 위치와 결제 위치가 같아야 한다는 뜻입니다. UUID로 식별한 리소스에서 결제 수단과 위치를 가져오고, 이를 행위자의 속성과 비교하는 조건을 정책 안에 적을 수 있게 됐습니다.

CEL은 단일 값과 다중 값을 다루는 여러 데이터 타입을 지원합니다. 문자열·산술·불리언 함수에 더해, 다중 값 속성을 평가하는 데 유용한 내장 매크로도 제공합니다. 우버의 백엔드에서는 Go용 google/cel-go와 Java용 Project Nessie의 cel-java가 요구를 충족했습니다.

표현식 평가 시간은 수 마이크로초 수준입니다. 속성을 가져오는 방식도 선택에 맞았습니다. 두 구현 모두 평가 중 값이 필요할 때 가져오는 기능을 지원하므로, 인가 엔진은 해당 표현식을 평가하는 데 필요한 속성만 요청합니다.

## 수천 개 Kafka 토픽에 적용한 공통 정책 {#adoption}

당시 우버에서 ABAC 정책을 도입한 서비스는 70개였습니다. Kafka 토픽 관리는 속성을 활용하면서 정책 관리 부담까지 줄인 사례입니다.

Kafka의 접근 정책은 어떤 서비스가 토픽을 구독하고 메시지를 게시할 수 있는지 정합니다. 토픽은 `uon://topics.kafka/production/…` 형식의 리소스이며, 액션은 subscribe, publish, admin입니다. 기존에는 admin 액션의 정책 관리를 Kafka 팀만 맡았습니다.

작은 팀이 수천 개 토픽의 정책을 관리하기는 어려웠습니다. 그렇다고 토픽 소유자에게 단순한 토픽별 정책을 직접 관리하게 해도, 토픽 수가 많다는 부담은 남습니다. 우버는 토픽마다 정책을 따로 다루는 대신, 기존 소유권 정보를 참조하는 공통 정책 하나를 만들었습니다.

그 소유권 정보는 uOwn에 있습니다. uOwn은 서비스, Kafka 토픽, 데이터베이스 같은 기술 자산의 소유권을 관리하는 서비스입니다. 자산에 역할을 직접 정의하거나 조직 계층에서 역할을 상속할 수 있습니다.

새 정책의 기준은 “직원이 uOwn에서 해당 토픽의 Develop 역할을 가지면 토픽을 관리할 수 있다”입니다. 속성 저장소 플러그인을 제공해, 요청한 Kafka 토픽에서 Develop 역할을 가진 사용자 그룹을 uOwn에서 가져와 `resource.uOwnDevelopGroups`라는 리소스 속성으로 쓸 수 있게 합니다. 정책은 이 속성을 사용해 직원의 토픽 관리 권한을 판단합니다.

이제 같은 정책을 모든 Kafka 토픽에 적용할 수 있습니다. 요청한 토픽에 따라 uOwn에서 가져오는 그룹 정보가 달라지므로, 토픽별 소유권을 정책 판단에 반영하면서도 공통 규칙을 유지합니다. Kafka 팀은 토픽별 정책 관리에 쓰던 상당한 시간을 절약했습니다.

{{% details title="원문에 나온 정책 모델 요소" closed="true" %}}

| 항목 | 값 |
|---|---|
| 중앙 정책 서비스 | Charter |
| 서비스 측 평가 라이브러리 | authfx |
| 행위자 표현 | SPIFFE ID |
| 리소스 표현 | UON(`uon://<policy domain>/...`) |
| 표현식 언어 | CEL(Go: google/cel-go, Java: cel-java) |
| 표현식 평가 시간 | 수 마이크로초 |
| ABAC 정책 도입 서비스 | 70개 |
| 속성 저장소 필수 함수 | SupportedAttributes(), Get*Attribute |
| Kafka 토픽 액션 | subscribe, publish, admin |
| Kafka 사례 속성 | resource.uOwnDevelopGroups |

{{% /details %}}
