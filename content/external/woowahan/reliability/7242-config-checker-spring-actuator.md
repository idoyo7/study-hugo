---
title: "Spring Boot 설정값 자동 점검 시스템 Config Checker"
description: "설정값 때문에 난 장애를 줄이려고 SRE팀이 만든 Config Checker의 설계를 정리했습니다. 배포 이벤트 기반 점검, Actuator configprops 활용, Rule 관리 방식을 요약합니다."
date: 2026-11-14
weight: 4
---

# Spring Boot 설정값 자동 점검 시스템 Config Checker (2021-12)

{{< callout type="info" >}}
**원문 정보**
- 원문: [절대적 Rule을 지켜 – Config Checker 개발기](https://techblog.woowahan.com/7242/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2021-12-30
- 저자: 남윤서 (시스템신뢰성개발팀, SRE팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 장애에서 나온 요구사항 {#requirement}

원문은 서비스의 요구사항이 고객에게서 오듯 SRE의 요구사항은 장애에서 나온다고 시작합니다. 서비스에 장애가 나면 SRE팀이 개발팀과 함께 대응하고, 상황이 끝나면 장애보고서를 씁니다. 보고서에서 장애를 항목별로 분류하고 근본 원인과 후속 대책을 뽑습니다. SRE팀은 이 보고서를 월·연 단위로 회고하며 어떤 유형이 많았는지, 시스템으로 막을 수 있는지, 못 막는다면 다운타임을 어떻게 줄일지 고민합니다. 장애 대응 프로세스 자체는 같은 블로그의 「우아~한 장애대응」을 참고하라고 안내합니다.

2020년 한 해를 분석하니 스프링 애플리케이션 설정값 때문에 생긴 다운타임이 4시간 32분이었습니다. 원인은 HikariCP connection pool size 부족, DB connection의 SSL 사용, Redis connection pool size 부족, Redis connection timeout 미설정, AWS Aurora failover 미동작이었습니다. 장애로 이어질 수 있는 설정이 코드리뷰로만 점검되고 있다는 점을 고쳐야 한다고 보았고, "설정값을 통한 장애를 예방한다"는 요구사항이 생겼습니다.

## 최소품질체크리스트에서 자동 점검으로 {#checklist-to-checker}

먼저 가이드를 만들었습니다. 서비스가 운영 환경에서 무리 없이 돌려면 최소한 이 정도는 설정해야 한다는 `최소품질체크리스트`입니다. 전사에서 주로 쓰는 라이브러리와 connection pool 설정마다 주의사항과 추천값을 적었고, 운영 경험이 많은 개발자들이 작성에 기여했습니다. HikariCP의 connection-timeout, maximum-pool-size, max-lifetime이 예시로 실렸습니다.

그러나 가이드는 가이드일 뿐이었습니다. 사람이 직접 설정해야 하니 실수가 있어도 적용했다고 착각할 수 있습니다. 그래서 체크리스트를 자동으로 점검하는 `Config Checker`를 만들기로 했습니다.

## 언제, 어떻게 점검할지 {#when-and-how}

먼저 배포 전에 properties나 yaml 파일을 정적으로 분석하는 방법을 따졌습니다. 이 경우 master merge 뒤 CI 파이프라인에서 검증하게 됩니다. 단점은 세 가지였습니다. 적용하는 팀이 프로젝트마다 CI 파이프라인을 고쳐야 하고, 파일의 값은 사용자 입력일 뿐 실제 적용된 값이 아니며, 적용 여부를 보려면 배포가 필요해 CI의 성격과 맞지 않았습니다. 그래서 배포 시점에 동적으로 분석하기로 했습니다.

다음으로 사내 배포 시스템의 파이프라인에 새 배포 잡을 넣고 에이전트가 Config Checker API를 호출하게 하는 방식을 검토했습니다. 이 방식도 프로젝트마다 배포 스크립트를 고쳐야 했습니다. 더 큰 문제는 배포 시간이었습니다. 운영·베타 환경을 가리지 않고 하루에 수십 번에서 수백 번 배포가 일어나는데, 잡이 하나 늘면 전사 생산성이 떨어집니다. 롤백이나 핫픽스 같은 긴급 상황에서도 배포가 길어져 다운타임이 늘 수 있습니다. 스킵 옵션을 주면 사용률이 떨어지고, Config Checker 장애가 배포 실패로 번지는 문제도 있었습니다.

두 방식의 공통 단점은 프로젝트별로 적용해야 한다는 점이었습니다. 에이전트 방식은 운영 비용이 크고, 변경이 생기면 적용된 프로젝트 수에 비례해 늘어날 수 있습니다. 플랫폼 개발은 프로젝트별 사일로를 없애려는 일인데 프로젝트마다 작업이 필요하면 장점이 퇴색하므로, 최대한 NoOps를 지향해야 한다고 느꼈습니다.

해법은 배포 이벤트를 받는 것이었습니다. 배포가 끝나면 배포 내역이 DynamoDB에 저장되고, 이를 트리거로 Lambda 함수가 Kafka에 이벤트를 발생시킵니다. 이 이벤트를 소비해 점검하면 배포 시스템을 쓰는 모든 프로젝트에 별도 작업 없이 적용됩니다. 이 아이디어는 클라우드플랫폼개발팀의 의견에서 나왔다고 합니다.

## Actuator로 설정값 가져오기 {#actuator}

Config Checker는 배포 이벤트의 인스턴스 정보로 웹서버에 API 요청을 보내 적용된 설정값을 가져옵니다. 이때 Spring Boot Actuator의 `env`, `configprops` 엔드포인트를 서비스마다 열어 두면 됩니다. 에이전트가 push하는 방식보다 Config Checker가 pull하는 방식이 운영 비용이 적어 관리가 쉬웠습니다.

처음에는 `/actuator/env`로 점검했습니다. 환경 변수와 JVM 정보뿐 아니라 properties나 yaml로 지정한 값이 담겨 있기 때문입니다. 그런데 Spring은 설정을 지정하는 방식이 다양합니다. 같은 HikariCP 설정도 `spring.datasource.hikari.connection-timeout` 경로로 쓸 수 있고, `@ConfigurationProperties`로 `ysnam.begaonnuri.custom.connection-timeout` 같은 임의 경로에 둘 수도 있습니다. 프로젝트마다 다른 경로를 점검해야 하니 한계가 분명했습니다.

그래서 설정 방식과 무관하게 Spring에서 최종 적용되는 곳을 보기로 했고, `/actuator/configprops`로 옮겼습니다. 여기에는 `@ConfigurationProperties`가 적용된 모든 빈 정보가 담기며, 입력값인 env와 달리 애플리케이션에 최종 적용된 값입니다. env에서 다르게 보이던 두 경로가 configprops에서는 prefix만 다를 뿐 똑같이 dataSource 하위 항목으로 나타났습니다.

## Rule 관리 {#rules}

점검 기준인 Rule은 대부분 최소품질체크리스트 항목에서 가져왔습니다. 다만 체크리스트는 최소 기준이라 서비스마다 기준값이 다를 수 있습니다. 그래서 기본은 체크리스트로 하되 서비스별로 Rule 값과 조건을 바꿀 수 있게 했습니다.

Rule은 전사 플랫폼의 Key-Value 저장소에 JSON으로 두고 런타임에 가져옵니다. Rule을 추가할 때 서비스 배포 없이 JSON 항목만 넣으면 됩니다. 항목은 name, ruleValue, condition, path, level, description 등으로 이루어집니다. condition은 Enum 클래스로 두고 Predicate 형태의 람다를 썼습니다. EQUALS, 대소 비교, 정규식, 포함 여부 같은 조건이 있고, 새 조건이 필요하면 boolean을 반환하는 람다를 추가하면 됩니다. 서비스별 Rule 값은 전사 플랫폼 포탈에서 지정하고, 점검 결과는 슬랙 알람으로 배포 직후 받아 볼 수 있습니다.

## 결과와 남은 과제 {#result-and-next}

이후 설정값 때문에 장애가 나면 그 원인이 Rule로 추가되고, Config Checker가 적용된 서비스는 같은 이슈의 재발을 막게 됩니다. Rule을 이렇게 보강해 나가는 선순환이 앞으로의 과제입니다. 2020년에 4시간 32분이던 설정값 장애 다운타임은 Config Checker 배포 뒤 아직 발생하지 않았습니다. 각 팀이 잘한 덕이 크지만 설정값이 한 번 더 점검된 영향도 있다고 원문은 봅니다.

앞으로는 AWS 각 서비스의 설정값 점검, k8s 기반 배포 플랫폼 적용 같은 도전과제가 있고, SRE팀은 CMDB 같은 신뢰성 플랫폼도 개발하고 있다고 합니다.

{{% details title="원문의 수치와 체크리스트 예시" closed="true" %}}

| 항목 | 값 |
|---|---|
| 2020년 설정값 기인 다운타임 | 4시간 32분 |
| HikariCP connection-timeout 추천값 | 3000(3초) |
| HikariCP maximum-pool-size 추천값 | 50 이내, 상황에 맞춰 조절 (최대 커넥션 도달 시 RDS 허용 최대치의 50% 정도) |
| HikariCP max-lifetime 추천값 | 50000(50초), RDS wait_timeout보다 작게 (사내 공통 wait_timeout 60초) |
| Rule 예시 | HIKARI_CONNECTION_TIMEOUT, ruleValue 3000, condition EQUALS, level INFO |

{{% /details %}}
