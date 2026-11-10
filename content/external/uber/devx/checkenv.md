---
title: "부하 테스트 전에 환경 간 RPC를 찾는 CheckEnv"
description: "우버의 CheckEnv는 서비스 의존성 그래프에서 환경 경계를 넘는 RPC 호출 경로를 찾습니다. 부하 테스트 플랫폼 Ballast는 이 경로를 실행 전에 확인해 의심스러운 호출을 사용자에게 알립니다."
date: 2026-11-10
weight: 10
---

# 부하 테스트 전에 환경 간 RPC를 찾는 CheckEnv (2023-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [CheckEnv: Fast Detection of RPC Calls Between Environments Powered by Graphs](https://www.uber.com/us/en/blog/checkenv/)
- 매체 · 게시일: Uber Engineering Blog · 2023-09-13
- 저자: Minglei Wang(Staff Software Engineer, Maps Production Engineering 팀), Kamyar Arbabifard(Senior Software Engineer, Local Graph Platform 팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 테스트 실행 앞에서 경로를 확인하는 Ballast {#ballast}

부하 테스트의 호출은 어디까지 이어질까요? 우버의 합성 부하 테스트 플랫폼 Ballast는 테스트를 실행하기 전에 CheckEnv에 호출 사슬 분석을 요청합니다. production에 뜻밖의 영향을 줄 경로가 없는지 먼저 확인하려는 절차입니다.

Ballast는 CheckEnv의 첫 사용처입니다. 사용자가 부하 테스트를 시작하려고 하면 CheckEnv가 해당 테스트의 호출 사슬을 분석하고, 의심스러운 환경 간 호출이 있으면 Ballast가 사용자에게 알립니다. 사용자는 부하를 보내기 전에 문제를 확인하고 조치할 기회를 얻습니다.

## 긴 호출 사슬로 연결된 production과 staging {#problem}

우버의 수많은 마이크로서비스는 느슨하게 결합되어 RPC로 서로 통신합니다. 호출은 깊게 이어집니다. 여러 서비스를 거치는 동안 의도하지 않게 production과 staging 사이의 경계를 넘으면 데이터 불일치나 예상 밖의 동작, 장애로 이어질 수 있습니다.

경계를 넘었다고 모두 잘못된 호출은 아닙니다. 새 기능을 검증하려고 production 트래픽을 staging에 섀도잉하는 경우도 있습니다. 막으려는 대상은 의도하지 않은 환경 간 호출입니다.

서비스 격리와 환경별 설정, 거버넌스, 통합·회귀 테스트는 이런 호출을 예방하는 수단입니다. CheckEnv는 여기에 빠른 감지를 보탭니다. 문제가 심각한 장애로 번지기 전에 호출 경로를 찾아 대응하려는 목적입니다.

활용 범위도 부하 테스트에만 머물지는 않습니다. 통합 테스트나 섀도 테스트에서 호출 경로를 미리 확인하고 실행 전에 수동 확인을 받도록 활용할 수 있습니다. 의심스러운 환경 간 트래픽을 선제적으로 스캔해 매일 보고서를 만드는 것도 우버가 제시한 용도입니다.

## 환경 경계를 붉은 선으로 드러낸 의존성 그래프 {#dependency-graph}

CheckEnv가 경로를 찾는 바탕은 서비스 의존성 그래프입니다. 우버에는 RPC 호출을 기록한 메트릭과 트레이스 등 여러 데이터 소스가 있습니다. 서비스와 호출 관계를 그래프로 표현하면 바로 연결된 서비스뿐 아니라 여러 단계를 거치는 간접 의존성까지 볼 수 있습니다.

여기에 환경 정보를 붙입니다. 서비스 노드마다 production, staging 같은 메타데이터를 기록하면 어느 호출이 환경 경계를 넘는지 드러납니다. 원문의 첫 그림에서 이런 호출은 붉은 선입니다. 그래프 탐색 알고리즘은 호출 경로를 환경 정보와 대조하며, 이 탐색을 모니터링·알림에 연결해 환경 간 호출을 빠르게 감지합니다.

현재의 연결을 담는 것은 실시간 의존성 그래프입니다. RPC 호출을 계속 관찰하면서 출발지와 목적지, 서비스와 엔드포인트 이름, 환경 정보를 수집해 만듭니다.

시간에 따른 변화는 집계 의존성 그래프에 남깁니다. 그래프에 시간 구간 노드를 추가하고 각 구간의 서비스 의존성을 기록하는 방식입니다. 구간별 의존성을 비교하면 변경이 미친 영향을 분석하거나, 시간의 흐름에 따라 나타난 환경 간 호출을 찾을 수 있습니다.

## Grail의 호출 기록을 Local Graph로 옮기는 MazeX {#architecture}

이 그래프를 뒷받침하는 저장 시스템은 Grail과 Local Graph입니다. Grail은 모든 존과 리전에 걸친 우버 인프라의 현재 상태를 하나의 전역 뷰로 모읍니다. 여러 데이터 공급원 가운데 실시간 RPC 호출 데이터가 현재의 호출 그래프를 만드는 재료입니다. Grail에서는 쿼리 하나로 서비스의 의존성을 환경별로 조회할 수 있습니다.

그 기록을 집계 그래프로 만드는 전체 수집 파이프라인이 MazeX입니다. MazeX 안의 g-to-h bridge는 Grail 데이터를 계속 모아 Apache Hive 테이블에 저장합니다. 이후 매일 예약된 수집 작업이 Apache Spark와 Spark SQL로 Hive 데이터를 읽고, Local Graph에 저장할 트리플로 변환합니다. Grail에서 Hive로 데이터를 모으는 작업은 계속 이어지지만, Local Graph로 변환하는 작업은 매일 실행됩니다.

Local Graph는 주어·술어·목적어로 이루어진 트리플 모델을 씁니다. Hive 테이블에는 날짜, 호출자, 피호출자, 호출자 환경이 한 행에 담기고, 그 행이 서비스 간 RPC 관계를 나타내는 트리플 하나로 바뀝니다. `service_name`, `caller_env` 같은 메타데이터는 노드 속성으로 저장합니다. 이 변환은 Local Graph의 범용 수집 프레임워크가 담당합니다.

수집 이후에는 Local Graph View가 낮은 지연으로 그래프 탐색을 제공합니다. View 계층의 RPC 프로시저로 그래프의 홉을 읽고 필요한 속성을 모으면서 애플리케이션에 맞는 탐색을 구현할 수 있습니다. CheckEnv도 이 의존성 데이터를 이용하는 애플리케이션이며, 호출 관계 전체와 production으로 이어지는 경로를 각각 API로 제공합니다.

- `ListAllDependencies`: 간접 의존성을 포함한 서비스 의존성 전체 조회
- `ListPathsToProdDependencies`: production 의존성으로 이어지는 경로 조회

Ballast가 테스트 전에 요청하는 호출 사슬 분석도 이 의존성 데이터를 바탕으로 합니다. 그래프에 저장한 서비스 관계를 실제 테스트의 사전 점검에 쓰는 연결점입니다.

{{% details title="Hive 입력에서 CheckEnv API까지" closed="true" %}}

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

## 더 넓은 마이크로서비스 지형과 RPC 호출 효율 {#next}

우버는 MazeX가 수집하는 데이터 소스를 늘려 마이크로서비스 지형을 더 풍부하게 담으려 합니다. 다음으로 집중할 문제는 RPC 호출 효율입니다. 서비스 사이의 통신 패턴과 관계를 분석해 서비스 그룹의 데이터 흐름을 최적화하려는 계획입니다.

그래프의 다른 활용 가능성도 제시합니다. 실시간 장애 감지와 인시던트 예측, 서비스 상태 이상 탐지, 효율을 높이기 위한 커뮤니티 탐지, 워크플로 관리가 그 대상입니다. CheckEnv와 Ballast의 연동은 이미 적용한 사례이고, 이들은 앞으로 그래프를 확장해 다루려는 과제입니다.
