---
title: "FMS 차량 데이터의 스트리밍·배치 파이프라인 구성"
description: "쏘카 데이터 플랫폼 팀이 신사업 FMS의 PoC용으로 만든 데이터 파이프라인을 정리한 글입니다. IoT Core에서 Kafka Connect, Lambda, Redshift로 이어지는 구성과 기술 선택 이유를 요약합니다."
date: 2026-11-08
weight: 9
---

# FMS 차량 데이터의 스트리밍·배치 파이프라인 구성 (2023-01)

{{< callout type="info" >}}
**원문 정보**
- 원문: [FMS(차량 관제 시스템) 데이터 파이프라인 구축기 1편. 스트리밍/배치 파이프라인 개발기](https://tech.socar.kr/data/2023/01/17/build-fms-data-pipeline-1)
- 매체 · 게시일: 쏘카 기술 블로그 · 2023-01-17
- 저자: 그랩 (데이터 플랫폼 팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 실시간과 배치를 함께 요구한 FMS {#요구사항}

FMS는 차량에 IoT 단말기를 달아 운행 정보를 모으고 관제하는 쏘카의 신사업입니다. 2022년 6월에 PoC 개발을 시작했습니다. 실시간 관제 데이터와 운영 분석용 집계 데이터가 모두 필요해서 스트리밍과 배치 파이프라인을 둘 다 만들었습니다. 출시까지 시간이 짧았기 때문에 구조는 간결하게, 관리 비용은 낮게 잡는 것이 설계 방향이었습니다.

스트리밍 쪽은 IoT Core, MSK(Kafka), EKS 위의 Kafka Connect로 구성합니다. 배치 쪽은 S3 데이터 레이크와 Glue Data Catalog, Redshift Spectrum, MWAA(Airflow)입니다. 집계 결과는 RDS(MySQL) 데이터 마트에 쌓입니다.

## IoT Core에서 Kafka까지 {#iot-core에서-kafka까지}

단말기 메시지는 주기 보고와 제어 응답 두 종류입니다. 주기 보고는 통신비와 클라우드 비용을 줄이려고 여러 측정값을 `measurements` 배열로 묶어 보내기 때문에, 적재할 때 레코드 단위로 풀어야 합니다. 프로토콜은 수십 개이고, 스키마는 참여 팀들이 함께 논의해 정했습니다.

IoT Core 라우팅 규칙은 메시지의 `object` 필드를 기준으로 토픽에 보냅니다. 프로토콜마다 토픽을 만들면 관리 부담이 커져서 한 토픽에 여러 프로토콜이 섞입니다. 그래서 Schema Registry는 쓰지 않았고, 먼저 장애 없이 적재한 뒤 스키마를 검증하는 방식을 택했습니다. 토픽 모니터링은 MSK의 파티션 수준 모니터링을 CloudWatch에서 보고, 메시지 확인에는 UI for Apache Kafka를 씁니다.

## 직접 만든 Kafka Sink Connector {#kafka-sink-connector}

S3에는 오픈소스 Sink Connector가 있지만 DynamoDB용은 유료 라이선스뿐이었습니다. 한 플랫폼으로 빌드하고 운영하려고 DynamoDB Sink Connector를 Kotlin으로 직접 만들었고, S3 쪽은 Confluent 구현체를 상속해 변형 로직만 얹었습니다. 변형은 설정값으로 조작합니다. 템플릿으로 `pk` 같은 키 필드를 붙이는 Transform과, 배열 필드를 레코드 여러 개로 쪼개는 Converter가 있습니다. 별도 Consumer를 두지 않으려는 선택입니다.

운영 방식은 다음과 같습니다.

- Connector는 jar로 빌드해 Kafka Connect 이미지에 넣고, Helm 차트와 ArgoCD로 EKS에 배포합니다. 원문은 이후 Strimzi로 옮길 계획이라고 적었습니다.
- S3 Sink는 특정 조건에서 Exactly Once를 지원하고, DynamoDB Sink는 At Least Once입니다. 같은 Primary Key는 덮어쓰므로 중복이 문제되지 않는다고 판단했습니다.
- 변환에 실패한 메시지는 `errors.tolerance`를 `all`로 두고 Deadletter Queue 토픽으로 보냅니다.
- 메트릭은 jmx_exporter로 Prometheus에 모으고, Consumer Lag은 CloudWatch를 Grafana에 연동해 봅니다. 이상 시 Grafana Alert가 슬랙으로 알립니다.

## S3 이후의 배치 처리 {#배치-처리-흐름}

분석가가 SQL을 쓸 수 있어야 해서 Spark 대신 Athena와 Redshift를 비교했습니다. 초기에 쓰던 Athena는 일부 윈도우 함수를 지원하지 않아 Redshift로 정했고, 비용을 줄이려고 Serverless와 Spectrum을 썼습니다.

흐름은 세 단계입니다. S3 Sink가 5분 주기로 원본 JSON을 시간 파티션으로 적재하면, 객체 생성 이벤트로 Lambda가 실행됩니다. Lambda는 메시지를 `object`, `type`, `command`별로 나눠 Parquet로 바꾸고 `ymd`, `hour` 파티션으로 다시 저장합니다. 이때 AWS Data Wrangler가 Glue 테이블 스키마와 대조해 검증하고 파티션도 등록합니다. 실패한 이벤트는 SQS로 보내 원인을 파악한 뒤 다른 Lambda가 다시 처리합니다. 이후 Airflow가 Redshift 집계 쿼리를 돌려 결과를 MySQL 마트에 넣습니다.

Glue 테이블은 분석 환경의 기준 스키마로 보기 때문에, 합의 없이 바뀌지 않게 Crawler 설정을 막을 것을 권합니다. JSON 파싱은 Pandas의 `read_json` 대신 `splitlines`와 `json.loads`로 바꿔 메모리 할당을 절반 이하, 처리 속도를 2배 이상 개선했습니다.

테스트와 데이터 품질 검사는 {{< relref "/external/socar/blog/10-fms-data-pipeline-2-testing.md" >}}에서 이어집니다.

{{% details title="원문의 구성 요소와 설정값 정리" closed="true" %}}

| 항목 | 값 |
|---|---|
| 메시지 브로커 | AWS IoT Core(MQTT) → MSK |
| 토픽 분류 기준 | 메시지의 `object` 필드, 실패 메시지는 전용 deadletter 토픽 |
| S3 Sink 설정 예 | `flush.size` 60000, `rotate.interval.ms` 300000, `partition.duration.ms` 3600000 |
| Kafka Connect Helm 설정 | `replicaCount` 3, `heapOptions` `-Xms512M -Xmx1024M` |
| 원본 S3 파티션 | `object/type/year/month/day/hour` |
| Parquet 파티션 | `ymd`, `hour` |
| JSON 파싱 개선 | 메모리 할당 절반 이하, 처리 속도 2배 이상 |
| 마트 | RDS(MySQL), Airflow의 커스텀 Operator로 적재 |

{{% /details %}}
