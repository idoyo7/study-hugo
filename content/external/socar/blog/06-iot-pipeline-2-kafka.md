---
title: "Kinesis에서 MSK로 옮긴 차량 단말 데이터 파이프라인"
description: "쏘카 모비딕 팀이 Kinesis 기반 단말 파이프라인의 한계를 넘기 위해 IoT Core와 MSK로 새 파이프라인을 만든 과정입니다. 클러스터 설정, Producer와 Consumer 구성, 모니터링에서 확인한 내용을 요약합니다."
date: 2026-11-08
weight: 6
---

# Kinesis에서 MSK로 옮긴 차량 단말 데이터 파이프라인 (2022-02)

{{< callout type="info" >}}
**원문 정보**
- 원문: [차량용 단말을 위한 IoT 파이프라인 구축기 (feat. Kafka) #2](https://tech.socar.kr/mobility/2022/02/09/socar-iot-pipeline-2)
- 매체 · 게시일: 쏘카 기술 블로그 · 2022-02-09
- 저자: 바다, 올리버 (데이터 엔지니어링 그룹 모비딕 팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 텔레매틱스 서버와 Kinesis의 한계 {#기존-파이프라인}

기존에는 단말이 HTTPS로 텔레매틱스 서버에 정보를 보냈습니다. 서버는 정보 종류에 따라 다른 엔드포인트로 받아 운영에 필요한 데이터만 걸러 DB에 넣었고, 걸러내지 않은 원본은 Kinesis로 흘렸습니다. Kinesis Firehose를 거친 데이터는 Elasticsearch, S3, BigQuery에 쌓였습니다.

Kinesis는 예상보다 손이 많이 갔습니다. 관리 주체가 없어 Consumer가 불필요하게 늘었고 스트림에 병목이 생겼습니다. 샤드를 늘리고 향상된 팬아웃을 써서 버틸 수는 있었지만 비용이 따라 올랐고 근본 해결도 아니었습니다.

## 신규 파이프라인의 설계 방향 {#설계-방향}

명령 채널에 IoT Core를 쓰게 되면서 보고 채널도 옮길 기회가 생겼습니다. 목표는 여섯 가지였습니다.

- 장애 시 병목이 되던 텔레매틱스 서버를 은퇴시키거나 용도를 줄인다.
- 사내에 쌓이던 Kafka 지식에 맞춰 Kafka를 쓴다.
- 하나였던 토픽을 관심사별로 나눈다.
- 시스템 부하가 신규 서비스 개발을 막지 않게 한다.
- 운영 리소스를 줄이려고 완전 관리형인 MSK를 쓴다.
- 토픽과 파티션 설정은 직접 정한다.

## MSK 클러스터와 토픽 설정 {#msk-클러스터}

MSK는 인스턴스, 브로커당 용량, Kafka 버전, 보안 설정만으로 만들 수 있습니다. 다만 생성 뒤에는 인스턴스 타입만 자유롭게 바꿀 수 있고 브로커 수와 용량은 늘리는 쪽으로만 바뀝니다. 이 점을 놓쳐 초기에 클러스터를 여러 번 새로 만들었다고 합니다. 스토리지는 기존 파이프라인의 최대 피크를 기준으로 잡았고, 자동 확장도 증설만 가능합니다. 보존 기간은 장애가 나도 2일 안에 해결하겠다는 뜻으로 48시간으로 했습니다.

토픽 자동 생성은 무분별한 생성을 막으려고 껐습니다. 복제 팩터는 2 이상이어야 합니다. MSK는 보안 업데이트나 설정 변경 때 브로커를 한 대씩 재부팅하는데, 복제 팩터가 1이면 그 사이 쓰기가 유실될 수 있기 때문입니다.

## Producer 두 갈래 {#producer}

펌웨어 업데이트는 서버 배포와 달리 빨라도 몇 주, 길면 몇 달이 걸립니다. 그동안 보고 채널이 둘로 나뉘므로 Producer도 둘을 구현했습니다.

신규 펌웨어는 IoT Core의 토픽에 보고하고, Rule이 SQL로 타임스탬프를 붙여 Kafka로 보냅니다. 토픽 이름을 `message-${type}`으로 지정해 log 타입은 message-log로, boot 타입은 message-boot로 나뉘게 했습니다. 같은 단말의 메시지는 시간 순서가 지켜져야 합니다. 파티션이 둘 이상이면 파티션 사이에서는 순서가 보장되지 않으므로, 원문은 대체 템플릿으로 메시지 Key를 지정한다고 쓰다 문장이 끊겼습니다. 다만 Key가 있으면 해시로 파티션이 정해진다는 설명이 덧붙어 있습니다.

기존 펌웨어는 텔레매틱스 서버가 Kinesis와 Kafka에 동시에 보내도록 했고, GPS, Kinematic, ADAS, 주기 보고를 각각 다른 토픽으로 나눴습니다. 이 과정에서 uWSGI와 kafka-python이 충돌해 uWSGI를 gunicorn으로, 라이브러리를 boto3로 바꿨다고 합니다. IoT Core 데이터는 DB 적재를 위해 텔레매틱스 서버의 새 엔드포인트를 한 번 거친 뒤 Kafka로 갑니다.

## Consumer와 Kafka Connect {#consumer}

Kafka의 보존이 2일이라 장기 보관 경로가 필요했습니다. Consumer를 직접 짜는 대신 Kafka Connect의 Sink Connector를 썼습니다. 단말 데이터는 S3에 먼저 쌓고, 최신 데이터는 분석과 연구용으로 Elasticsearch에 넣습니다.

Elasticsearch Sink Connector에는 TimeBasedPartitioner를 쓰면 Offset을 제대로 기록하지 못해, Worker를 재시작할 때마다 토픽을 처음부터 다시 읽는 버그가 있었습니다. 그래서 파티셔너를 쓰지 않고 인덱스를 고정한 뒤 Write Index와 Rollover로 일자별 인덱스를 만들었습니다.

단말-차량 Converter는 단말 번호 기준의 데이터에 차량 정보를 붙여 다시 Kafka로 내보내는 첫 Consumer이자 Producer입니다. 차량 정보는 캐시해 두고 주기적으로 갱신합니다.

## 모니터링 {#모니터링}

Grafana에 CloudWatch를 연동해 CPU, 디스크, 네트워크 입출력, Elasticsearch 스토리지를 봅니다. Consumer별 OffsetLag도 보는데, 이 값이 줄지 않고 커지면 Consumer 장애로 판단합니다. OffsetLag는 MSK 고급 모니터링 옵션이 있어야 볼 수 있습니다. 임계치를 넘으면 Slack이나 Opsgenie로 알림이 갑니다.

{{% details title="원문의 주요 설정값" closed="true" %}}

| 항목 | 값 |
|---|---|
| MSK 메시지 보존 | `log.retention.hours: 48`, `log.cleanup.policy: delete` |
| 복제 팩터 | 2 이상 |
| 토픽 이름 패턴 | `message-${type}` |
| S3 Sink | `flush.size` 20000, 롤링 180000ms, gzip, 경로 `YYYY/MM/dd/HH` |
| Elasticsearch Sink | `batch.size` 2000, `max.retries` 50, `retry.backoff.ms` 2000 |
| Elasticsearch Sink 버퍼 | `max.buffered.records` 40000, `read.timeout.ms` 60000 |

{{% /details %}}
