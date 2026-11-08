---
title: "FMS 데이터 파이프라인의 E2E 테스트와 데이터 품질 검사"
description: "쏘카 데이터 플랫폼 팀이 FMS 파이프라인의 신뢰성을 높이려고 만든 테스트 환경을 정리한 글입니다. Docker Compose 기반 E2E 테스트, 부하 테스트, Airflow 기반 데이터 품질 검사를 요약합니다."
date: 2026-11-08
weight: 10
---

# FMS 데이터 파이프라인의 E2E 테스트와 데이터 품질 검사 (2023-01)

{{< callout type="info" >}}
**원문 정보**
- 원문: [FMS(차량 관제 시스템) 데이터 파이프라인 구축기 2편. 신뢰성 높은 데이터를 위한 테스트 환경 구축기](https://tech.socar.kr/data/2023/01/24/build-fms-data-pipeline-2)
- 매체 · 게시일: 쏘카 기술 블로그 · 2023-01-24
- 저자: 그랩 (데이터 플랫폼 팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## B2B 고객 앞의 두 가지 테스트 {#테스트-종류}

데이터 플랫폼의 고객은 보통 사내 팀이지만 FMS는 B2B 고객을 상대합니다. 그래서 데이터에 엄격한 SLO를 두고 안정적으로 운영해야 했습니다. 원문은 테스트를 소프트웨어 테스트와 데이터 품질 테스트로 나눕니다. 파이프라인에서는 컴포넌트 하나가 멈추면 뒤쪽 처리가 모두 막히므로, 각 컴포넌트가 단일 장애점이 되기 쉽다는 점이 소프트웨어 테스트의 이유입니다. 데이터 품질은 정합성과 무결성으로 정의합니다. 정합성은 원본을 가공해 옮긴 결과가 양쪽에서 일치하는 것이고, 무결성은 Non Null이나 값의 범위 같은 조건을 지키는 것입니다.

## Docker Compose와 서브모듈로 만든 E2E 환경 {#e2e-테스트-환경}

테스트 대상은 직접 개발한 Kafka Connect와 Lambda입니다. 나머지는 SaaS나 클라우드 서비스라 신뢰성을 어느 정도 기대할 수 있다고 봤습니다. PoC 단계라 내부 구현이 자주 바뀔 수 있고 입력과 출력은 분명했기 때문에 E2E 테스트에 무게를 뒀습니다.

외부 의존성은 Docker Compose로 띄웁니다. Zookeeper, Kafka 브로커, AWS를 흉내 내는 localstack, kafka-ui가 들어가고, 이 구성은 별도 저장소로 분리해 다른 프로젝트에서도 쓸 수 있게 했습니다. 각 컴포넌트 저장소는 이 저장소를 Git Submodule로 연결합니다.

Kafka Sink Connector의 E2E 테스트는 Bash 스크립트입니다. Connector가 등록됐는지 확인하고, 설정을 REST API로 넣고, 토픽에 메시지를 보낸 뒤 localstack S3의 객체 수를 확인하며, 잘못된 메시지가 Deadletter 토픽으로 가는지도 봅니다. Lambda는 localstack S3만 띄우고 Pytest로 검증합니다. GitHub Action에서는 pull request마다 파이프라인 저장소를 체크아웃해 컨테이너를 띄우고, 원래 저장소로 돌아와 테스트를 실행합니다. 이때 `clean: false`를 줘야 먼저 받은 저장소가 지워지지 않습니다.

## 시뮬레이터로 진행한 부하 테스트 {#부하-테스트}

실제 차량 데이터가 들어오기 전에 IoT Core부터 Kafka, Kafka Connect, DynamoDB와 S3까지 이어지는 E2E 부하 테스트를 계획했습니다. 부하 기준은 FMS의 다음 해 목표 차량 대수입니다. 지표는 다음과 같이 잡았습니다.

- Kafka Connect: Worker Pod의 CPU·메모리·네트워크 IO와 Connector별 Lag
- DynamoDB: 온디맨드 모드의 WCU/RCU와 쓰로틀링, 에러
- Lambda: 이벤트 처리 시간과 메모리 사용량

부하는 메시지 시뮬레이터로 만들었습니다. S3 로그나 BigQuery의 기존 데이터로 메시지를 만들고, 없는 프로토콜은 가짜 데이터로 채웁니다. IoT Core와 Kafka 중 원하는 곳으로 보낼 수 있고, 다른 팀도 개발 중에 같은 시뮬레이터를 썼습니다. 테스트에서는 동시 메시지가 늘수록 S3 Sink Connector의 내부 버퍼가 차서 Out Of Memory가 종종 났습니다. Connector 속성을 조정하고 Worker Pod 메모리와 heapOptions를 높였습니다. Lambda도 메모리를 늘리고 처리 로직을 고쳤습니다. 예상 비용과 우려 사항은 리포트로 공유했습니다.

## Airflow로 돌리는 데이터 품질 검사 {#데이터-품질-검사}

검사는 세 가지입니다. 단말기 원본 데이터의 이상 여부, Redshift 집계가 MySQL 마트에 그대로 들어갔는지를 보는 정합성, 마트 컬럼 값이 도메인 규칙에 맞는지 보는 무결성입니다. 무결성은 Airflow의 `SQLColumnCheckOperator`, 정합성은 SQL의 EXCEPT 구문과 Pandas로 구현했습니다. great_expectations와 dbt도 검토했지만 가벼운 Airflow Operator를 골랐습니다. 구체적인 검사 항목은 사내 프로젝트라 의도적으로 생략했다고 밝혔습니다.

`SQLColumnCheckOperator`는 실패하면 예외만 던질 뿐 결과를 저장하지 않아, 이를 감싸는 `MonitoringValidationOperator`를 만들었습니다. 검사 결과를 RDS에 쌓고 Grafana 대시보드로 보며, 실패하면 Grafana Alert가 슬랙으로 알립니다. 앞선 구성은 {{< relref "/external/socar/blog/09-fms-data-pipeline-1-streaming-batch.md" >}}에 있습니다.

{{% details title="검사 일정과 도구 정리" closed="true" %}}

| 항목 | 값 |
|---|---|
| E2E 환경 | Docker Compose(Zookeeper, Kafka 브로커, localstack, kafka-ui, kafkacat) |
| CI | GitHub Action, pull request와 배포 전 실행 |
| 무결성 검사 | `SQLColumnCheckOperator`, 전날 생성된 마트 데이터 기준 |
| 정합성 검사 | SQL EXCEPT와 Pandas, 이틀 전 데이터 기준 |
| 검사 시각 | 매일 새벽 |
| 결과 저장·표시 | RDS(MySQL), Grafana, 슬랙 알림 |

{{% /details %}}
