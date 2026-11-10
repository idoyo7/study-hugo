---
title: "그래프로 찾아내는 환경 간 RPC 호출 CheckEnv"
description: "우버가 마이크로서비스 호출 사슬에서 환경 경계를 넘는 RPC를 빠르게 찾으려고 만든 CheckEnv의 구조를 정리했습니다. 서비스 의존성 그래프를 만드는 데이터 파이프라인과 첫 사용처인 부하 테스트 플랫폼을 요약합니다."
date: 2026-11-10
weight: 11
---

# 그래프로 찾아내는 환경 간 RPC 호출 CheckEnv (2023-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [CheckEnv: Fast Detection of RPC Calls Between Environments Powered by Graphs](https://www.uber.com/us/en/blog/checkenv/)
- 매체 · 게시일: Uber Engineering Blog · 2023-09-13
- 저자: Minglei Wang(Staff Software Engineer, Maps Production Engineering 팀), Kamyar Arbabifard(Senior Software Engineer, Local Graph Platform 팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 환경 경계를 넘는 RPC 호출이라는 문제 {#problem}

우버는 느슨하게 결합된 수많은 마이크로서비스가 RPC로 서로 호출하며 돌아갑니다. 호출 사슬이 복잡하고 서비스가 많이 얽혀 있으니, production과 non-production 사이의 환경 경계를 넘는 호출이 생길 수 있습니다. 데이터가 여러 서비스를 거치며 단계마다 RPC를 일으키므로, production과 staging이 함께 있으면 의도하지 않게 두 환경이 상호작용할 위험이 있습니다. 결과는 데이터 불일치, 예상 밖의 동작, 장애입니다.

환경 간 호출이 모두 나쁜 것은 아닙니다. 기능 검증을 위해 production 트래픽을 staging에 섀도잉하는 경우처럼 허용되는 호출도 있고, 막으려는 대상은 의도하지 않은 호출입니다.

서비스 격리와 환경별 설정, 통합 테스트와 회귀 테스트 같은 예방책은 기본이고, 여기에 환경 간 호출을 빠르게 알아채는 감지 장치가 더해져야 큰 사고가 되기 전에 해결할 수 있습니다. 이 장치는 부하 테스트에 쓸 수 있습니다. 부하 테스트가 호출이 지나갈 경로를 미리 확인해 이해관계자에게 알리면 production에 의도치 않은 영향을 주지 않고 테스트를 할 수 있습니다. 통합 테스트나 섀도 테스트도 실행 전에 수동 확인을 받도록 쓸 수 있고, 매일 보고서를 내는 선제 스캔으로 수상한 환경 간 트래픽을 찾을 수도 있습니다. 원문은 이 감지 장치를 그래프로 만든 CheckEnv를 소개합니다.

## 서비스 의존성 그래프 {#dependency-graph}

서비스 간 호출은 의존성 그래프로 표현할 수 있습니다. 우버에는 서비스 간 RPC 호출의 메트릭과 트레이스를 저장한 소스가 여럿 있어서 서비스 사이의 의존성과 통신 패턴을 볼 수 있습니다. 이 그래프에 production, staging 같은 환경 메타데이터를 붙이면, 특정 서비스의 환경 간 RPC 호출을 짚어 낼 수 있습니다. 원문의 첫 그림은 환경 경계를 넘는 호출을 붉은 선으로 표시한 그래프입니다. 그래프 탐색 알고리즘이 호출 경로를 환경 메타데이터와 대조해 환경 간 호출을 찾고, 이를 모니터링과 알림 시스템에 통합해 빠른 대응을 가능하게 합니다.

CheckEnv가 쓰는 그래프는 두 종류입니다.

- 실시간 의존성 그래프: RPC 호출을 실시간으로 계속 관찰해 만듭니다. 호출의 출발지와 목적지, 서비스와 엔드포인트 이름, 환경 정보를 담아 서비스 연결의 현재 모습을 동적으로 보여 줍니다.
- 집계 의존성 그래프: 서비스 의존성이 시간에 따라 어떻게 변했는지 보려고 구조에 시간 구간 노드를 넣습니다. 특정 시간대에 있던 의존성을 담아 상호작용의 변화와 추세를 읽고, 시간 축에서 환경 간 호출을 찾으며 변경이 시스템 성능에 준 영향도 분석할 수 있습니다.

## 아키텍처와 데이터 파이프라인 {#architecture}

CheckEnv는 우버의 그래프 저장 시스템 두 개 위에 올라갑니다.

- Grail은 우버 인프라의 현재 상태를 모든 존과 리전에 걸친 단일 전역 뷰로 모읍니다. 그래프 모델이며 현재의 호출 그래프도 담고 있습니다.
- Local Graph 플랫폼은 Grail에서 모은 집계 호출 그래프 데이터를 저장하고 제공하는 계층입니다. 범용 수집 프레임워크로 사용자가 자기 데이터를 그래프에 넣을 수 있고, 내부에서는 Apache Spark로 Apache Hive의 데이터를 읽어 트리플로 바꿔 그래프 구조를 만듭니다. 서빙 쪽의 Local Graph View는 호출 그래프 데이터를 낮은 지연으로 탐색하게 합니다.

**Grail 데이터.** Grail에는 여러 데이터 소스 제공자가 있고 그중 실시간 RPC 호출 데이터가 실시간 의존성 그래프의 재료입니다. Grail 쿼리 하나로 환경별 서비스와 의존성의 관계를 얻을 수 있습니다. 이 데이터는 Hive로 계속 들어가고, Local Graph가 집계 의존성 그래프를 만드는 주된 공급원이 됩니다.

**Local Graph 데이터.** Local Graph는 트리플 데이터 모델로 엔티티, 엔티티 사이의 관계, 엔티티별 속성을 저장합니다. 모든 것을 주어(Subject), 술어(Predicate), 목적어(Object)로 나타냅니다. Hive 테이블에는 날짜, 호출자, 피호출자, 호출자 환경이 한 행에 담기는데, 행 하나가 곧바로 트리플 하나로 바뀝니다. 서비스 간 RPC 호출은 호출자-피호출자 트리플로 표현하고, service_name이나 caller_env 같은 노드 메타데이터는 속성으로 저장합니다. 트리플로 수집이 끝나면 View 계층의 RPC 프로시저로 그래프 홉을 읽고 원하는 탐색 로직을 구현할 수 있습니다.

**CheckEnv 구성.** CheckEnv는 Local Graph의 의존성 그래프 데이터를 이용하는 애플리케이션이고, 다음 API를 제공합니다.

- ListAllDependencies: 간접 의존성을 포함해 서비스의 의존성 전체를 돌려줍니다.
- ListPathsToProdDependencies: production 의존성으로 가는 경로를 찾아 나열합니다.

그래프를 만드는 전체 수집 파이프라인은 MazeX라고 부릅니다. MazeX 안의 g-to-h bridge가 Grail 데이터를 계속 모아 Hive 테이블에 저장하고, 매일 도는 수집 작업이 Hive 데이터를 Local Graph 트리플로 변환합니다. 덕분에 CheckEnv의 그래프는 지속적으로 갱신되어 마이크로서비스 사이의 상호 의존성을 정확하게 반영합니다.

## 첫 사용처 Ballast {#ballast}

우버의 합성 부하 테스트 플랫폼 Ballast가 CheckEnv의 첫 사용자입니다. 사용자가 부하 테스트를 시작하면 Ballast는 그 테스트에서 일어날 수 있는 환경 간 호출을 CheckEnv에 물어봅니다. CheckEnv가 호출 사슬을 분석해 의심스러운 사슬이 있으면 Ballast가 사용자에게 바로 알립니다. 사용자는 테스트를 돌리기 전에 환경 간 호출 문제를 알고 조치할 수 있습니다.

## 다음 계획 {#next}

원문은 CheckEnv를 MazeX 그래프 수집 파이프라인이 실제 문제에 적용된 사례로 둡니다. 앞으로 MazeX가 받는 데이터 소스를 넓혀 훨씬 강력한 그래프를 만들고, 마이크로서비스 지형을 더 풍부하게 이해하려 합니다. 다음 과제는 서비스 사이의 통신 패턴과 관계를 분석해 RPC 호출의 효율 문제를 푸는 것입니다. 그래프로는 실시간 장애 감지, 인시던트 예측, 서비스 상태 이상 탐지, 효율을 높이기 위한 커뮤니티 탐지, 워크플로 관리 같은 과제도 다룰 수 있다고 원문은 말합니다.

{{% details title="Local Graph 입력 테이블과 트리플 모델" closed="true" %}}

| 항목 | 내용 |
|---|---|
| Hive 테이블 컬럼 | datestr, caller, callee, caller_env |
| 예시 행 | 2023-05-25, Service A, Service B, production |
| 예시 행 | 2023-05-25, Service C, Service B, staging |
| 데이터 모델 | Subject, Predicate, Object 트리플 |
| 노드 속성 예 | service_name, caller_env |
| 수집 방식 | g-to-h bridge가 Grail에서 Hive로 연속 저장, 매일 수집 작업이 트리플로 변환 |
| 제공 API | ListAllDependencies, ListPathsToProdDependencies |

{{% /details %}}
