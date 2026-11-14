---
title: "Spring Boot의 실제 설정을 점검하는 Config Checker"
description: "설정 파일만 검사해서 실제 적용값까지 확인할 수 있을까요? Config Checker는 배포 이벤트를 받아 Spring Boot Actuator에서 읽은 설정값을 서비스별 Rule과 비교합니다."
date: 2026-11-14
weight: 4
---

# Spring Boot의 실제 설정을 점검하는 Config Checker (2021-12)

{{< callout type="info" >}}
**원문 정보**
- 원문: [절대적 Rule을 지켜 – Config Checker 개발기](https://techblog.woowahan.com/7242/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2021-12-30
- 저자: 남윤서 (시스템신뢰성개발팀, SRE팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 장애보고서에서 시작한 최소품질체크리스트 {#requirement}

2020년 우아한형제들에서 Spring 애플리케이션 설정값 때문에 발생한 다운타임은 4시간 32분이었습니다. HikariCP와 Redis의 connection pool size 부족, DB connection의 SSL 사용, Redis connection timeout 미설정, AWS Aurora failover 미동작이 원인으로 꼽혔습니다. 설정값 점검은 코드리뷰에만 의존하고 있었습니다.

고객에게서 서비스의 요구사항이 나오듯, 장애는 SRE팀의 새 요구사항이 됩니다. SRE팀은 개발팀과 함께 장애를 수습한 뒤 보고서에 근본 원인과 후속 대책을 남기고, 월·연 단위로 분석하며 장애를 막거나 다운타임을 줄일 방법을 찾았습니다. 설정값 자동 점검도 이 과정에서 나온 요구입니다. 자세한 장애 대응 과정은 같은 블로그의 「우아~한 장애대응」에서 다룹니다.

처음 마련한 해법은 가이드였습니다. 운영 경험이 풍부한 개발자들이 힘을 모아, 서비스가 운영 환경에서 원활하게 동작하는 데 필요한 설정을 `최소품질체크리스트`로 작성했습니다. 전사에서 주로 쓰는 라이브러리와 connection pool 설정의 주의사항, 추천값을 담은 문서입니다. 예를 들어 HikariCP의 maximum-pool-size는 50 이내를 추천하되 상황에 맞춰 조절하도록 했습니다. 새 프로젝트와 기존 프로젝트 모두를 위한 기준이었습니다.

가이드만으로는 끝낼 수 없었습니다. 설정은 사람이 해야 했고, 값을 잘못 적용하고도 제대로 설정했다고 착각할 여지가 남았습니다. 그래서 체크리스트를 자동으로 검사하고 실제 적용 여부를 확인하는 `Config Checker`를 개발했습니다.

## 서로 다른 설정 경로가 모이는 dataSource {#actuator}

Config Checker는 Spring Boot Actuator로 설정값을 읽습니다. 서비스마다 `env`, `configprops` 엔드포인트를 열어 두면, 배포된 인스턴스의 웹서버에 API 요청을 보내 점검할 값을 가져오는 방식입니다.

처음에는 `/actuator/env`면 충분해 보였습니다. 환경 변수와 JVM 정보뿐 아니라 `application.properties`나 `application.yaml`에 지정한 설정도 JSON으로 나왔기 때문입니다. 데이터를 파싱해 정해진 경로의 값만 검사하면 끝날 듯했습니다.

Spring의 설정 방법은 하나가 아니었습니다. 예를 들어 같은 HikariCP의 `connection-timeout`도 `spring.datasource.hikari.connection-timeout`으로 지정하거나, `@ConfigurationProperties`를 사용해 `ysnam.begaonnuri.custom.connection-timeout`이라는 경로로 적용할 수 있습니다. 같은 설정인데 입력 경로는 달랐습니다. 이 경로를 따라 검사하려면 프로젝트마다 설정 방식을 알아야 했습니다.

확인할 위치를 `/actuator/configprops`로 바꿨습니다. 여기에는 `@ConfigurationProperties`가 적용된 모든 빈의 설정 정보가 담깁니다. 앞의 HikariCP 예제는 입력 경로가 달라도 `prefix`만 다를 뿐, 같은 `dataSource` 하위 항목으로 나타났습니다. `env`에서 읽던 사용자 입력값과 달리 빈에 최종 적용된 값입니다. 덕분에 프로젝트마다 입력 경로를 맞추지 않고도 해당 설정을 검사할 수 있게 됐습니다.

## 새 배포 잡 없이 받는 Kafka 이벤트 {#when-and-how}

점검을 시작할 신호는 기존 배포 이벤트에서 찾았습니다. 클라우드플랫폼개발팀의 의견에서 나온 해법입니다. 배포가 끝나면 DynamoDB에 배포 내역이 저장되고, 이를 트리거로 Lambda 함수가 Kafka에 이벤트를 보냅니다. Config Checker는 이 이벤트를 소비해 배포된 인스턴스 정보를 얻고, 해당 웹서버에서 설정값을 가져옵니다.

이 선택에 앞서 배포 전 CI에서 properties나 yaml 파일을 정적으로 분석하는 안을 검토했습니다. 파일에 적힌 값은 입력값일 뿐입니다. 실제 적용 여부를 확인하려면 배포가 필요해 CI의 성격과 맞지 않았고, master 브랜치에 merge한 뒤 동작하는 CI 파이프라인도 프로젝트마다 수정해야 했습니다.

배포 파이프라인에 검사를 넣는 방법은 부담이 더 컸습니다. 새 배포 잡에서 에이전트가 Config Checker API를 호출하도록 프로젝트별 스크립트를 고쳐야 했고, 잡이 늘어나는 만큼 배포 시간도 길어집니다. 한 프로젝트에서는 작은 지연이어도, 운영·베타 환경에서 하루 수십 번에서 수백 번 이루어지는 배포에 모두 적용하면 전사 생산성에 영향을 줍니다.

긴급 배포도 예외가 아닙니다. 새 버전에 문제가 생겨 롤백하거나 핫픽스를 내보낼 때도 추가한 잡을 거쳐야 하므로 다운타임이 늘 수 있습니다. 잡을 건너뛰는 옵션은 사용률을 떨어뜨릴 수 있었고, Config Checker의 장애가 배포 실패로 이어지는 문제도 있었습니다.

프로젝트마다 적용 작업이 필요하다는 부담도 남았습니다. 에이전트 방식은 변경이 생길 때 적용한 프로젝트 수에 비례해 운영 비용이 늘 수 있습니다. 프로젝트별 사일로를 줄이려는 플랫폼이 각 팀의 수정 작업을 계속 요구해서는 장점이 줄어듭니다. SRE팀이 최대한 NoOps를 지향한 이유입니다.

배포 이벤트를 소비하면 기존 배포 시스템을 사용하는 프로젝트의 CI나 배포 스크립트를 일일이 고치지 않아도 됩니다. 서비스에서 Actuator 엔드포인트를 여는 준비는 필요하지만, 점검을 위해 새 배포 잡을 추가할 필요는 없어졌습니다. Config Checker가 설정값을 가져오는 pull 방식도 에이전트가 API 요청을 보내는 방식보다 운영 비용이 적고 관리가 수월했습니다.

## 서비스별 기준을 담은 Rule {#rules}

가져온 값을 판정하는 기준인 Rule은 대부분 최소품질체크리스트에서 출발했습니다. 그러나 최소 기준이 모든 서비스의 정답은 아닙니다. 기본적으로 체크리스트를 따르면서도 서비스마다 Rule 값과 점검 조건을 바꿀 수 있게 했고, 전사 플랫폼 포탈에서 서비스별 값을 지정하도록 했습니다.

Rule은 전사 플랫폼의 Key-Value 저장소에 JSON으로 저장하고 런타임에 읽습니다. 기준을 추가할 때 서비스 배포를 기다릴 필요가 없습니다. JSON 항목을 추가하면 적용됩니다. 각 항목에는 `name`, `ruleValue`, `condition`, `path`, `level`, `description` 등이 들어가며, `condition`에 지정한 조건으로 설정값과 `ruleValue`를 비교합니다.

비교 조건은 Enum 클래스에 Predicate 형태의 람다로 구현했습니다. `EQUALS`, 대소 비교, 정규식, 포함 여부 등을 지원하고, 새 조건이 필요하면 boolean을 반환하는 람다를 추가하는 방식입니다. 기준값을 추가하는 일과 비교 조건을 확장하는 일을 이렇게 나누었습니다. 점검 결과는 슬랙 알람으로 보내 각 팀이 배포 직후 확인하도록 했습니다.

원문 작성 시점에는 Config Checker 배포 이후 설정값으로 인한 장애가 아직 없었습니다. 저자는 이를 각 팀의 노력 덕분으로 돌리면서, 설정값을 한 번 더 확인한 영향도 있었다고 봤습니다.

남은 과제는 장애 경험을 Rule에 계속 반영하는 일이었습니다. 새로운 설정값 장애가 생기면 그 원인을 점검 기준으로 추가해, Config Checker가 적용된 서비스에서 같은 이슈가 재발하지 않도록 하려는 방향입니다. AWS 각 서비스의 설정값 점검과 k8s 기반 배포 플랫폼 적용도 당시의 도전과제로 남아 있었습니다. SRE팀은 Config Checker 외에도 CMDB 등 신뢰성을 높이는 플랫폼을 개발하고 있었습니다.

{{% details title="원문의 수치와 체크리스트 예시" closed="true" %}}

| 항목 | 값 |
|---|---|
| 2020년 설정값 기인 다운타임 | 4시간 32분 |
| HikariCP connection-timeout 추천값 | 3000(3초) |
| HikariCP maximum-pool-size 추천값 | 50 이내, 상황에 맞춰 조절 (최대 커넥션 도달 시 RDS 허용 최대치의 50% 정도) |
| HikariCP max-lifetime 추천값 | 50000(50초), RDS wait_timeout보다 작게 (사내 공통 wait_timeout 60초) |
| Rule 예시 | HIKARI_CONNECTION_TIMEOUT, ruleValue 3000, condition EQUALS, level INFO |

{{% /details %}}
