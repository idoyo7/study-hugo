---
title: "쏘카 차량 단말의 연결 구조"
description: "쏘카가 차량 관제 장치와 서버, 스마트폰을 어떻게 잇는지 공개 기술 블로그 일곱 편만으로 다시 그렸습니다. 원문이 밝힌 사실과 밝히지 않은 부분을 나눠 적었습니다."
date: 2026-11-08
weight: 20
---

# 쏘카 차량 단말의 연결 구조

{{< callout type="info" >}}
**근거 범위**
- 쏘카 기술 블로그의 관제 장치 소개(2022-02), IoT 파이프라인 구축기 1·2편(2022-01·02), FMS 데이터 파이프라인 1·2편(2023-01), FMS 주행이벤트 파이프라인 개선기(2024-06), 쏘카프레임 블루투스 모듈(2026-01) 일곱 편을 읽고 연결 구조만 추려 다시 그린 진단입니다.
- 원문이 밝히지 않은 항목은 추정하지 않고 "알 수 없는 부분"으로 따로 모았으며, 추정이 섞인 문장에는 추정이라고 적었습니다. 글마다 쓰인 시점이 달라 지금의 구성과 다를 수 있습니다.
{{< /callout >}}


## 단말과 서버, 스마트폰을 잇는 세 갈래 {#세-갈래-연결-경로}

쏘카 차량의 관제 장치는 STS(Socar Telematics System)라는 자체 제작 단말입니다. 2020년에 처음 장착됐고 2022년 2월 기준으로 1만 대가 넘는 차량에 들어갔습니다. 단말은 LTE·3G 망으로 서버와 메시지를 주고받고, 가까이 있는 스마트폰과는 BLE 5.0으로 직접 통신합니다([관제 장치 소개]({{< relref "/external/socar/blog/07-telematics-device-role.md" >}})).

| 구간 | 수단 | 원문에 나온 구성 |
|---|---|---|
| 단말 → 서버 보고 | MQTT, LTE·3G | AWS IoT Core 토픽에 JSON 발행, IoT Core Rule이 타임스탬프를 붙여 MSK로 라우팅 |
| 서버 → 단말 제어 | MQTT | IoT Core 명령 채널, 단말은 수행 결과를 제어 응답 메시지로 회신 |
| 스마트폰 ↔ 단말 | BLE 5.0 | 앱의 쏘카프레임 블루투스 모듈이 문 열기 같은 명령을 직접 전달 |
| 서버 → 데이터 플랫폼 | Kafka(MSK) | Kafka Connect가 S3·Elasticsearch, FMS에서는 S3·DynamoDB로 적재 |

제어 명령은 두 길 중 하나로 들어옵니다. STS는 서버나 블루투스로 "문을 열어라"를 받으면 정합성과 보안성을 검사한 뒤 문을 엽니다. 쏘카는 블루투스를 서버 통신보다 믿을 만하다고 보고, 블루투스가 되면 그쪽을 먼저 쓰고 안 될 때 서버로 보냅니다([블루투스 모듈]({{< relref "/external/socar/blog/18-socarframe-bluetooth-module.md" >}})). 지하주차장이나 산지처럼 망이 약한 곳, 근거리에서 더 빨리 제어하고 싶을 때가 블루투스의 자리입니다. 앱 모듈은 연결을 유지하려고 aliveMessage를 주기적으로 보내고, 보안을 위해 커맨드를 재발급합니다.

서버 뒤쪽은 사업마다 다릅니다. 2022년 카셰어링 파이프라인은 메시지 type별로 `message-${type}` 토픽을 나누고, Kafka Connect로 장기 보관용 S3와 최신 분석용 Elasticsearch에 넣었습니다([IoT 파이프라인 2편]({{< relref "/external/socar/blog/06-iot-pipeline-2-kafka.md" >}})). BigQuery는 구형 경로에서 Kinesis Firehose의 적재 대상이었고, 신형 경로에서는 스트리밍 적재가 남은 과제였습니다. 2023년 FMS 신사업은 object 필드로 토픽을 고르고, EKS 위 Kafka Connect가 DynamoDB와 S3에 적재합니다. S3의 JSON은 Lambda가 Parquet로 바꾸고, Redshift Spectrum에서 집계한 결과를 Airflow가 MySQL 데이터 마트로 옮깁니다([FMS 1편]({{< relref "/external/socar/blog/09-fms-data-pipeline-1-streaming-batch.md" >}})).

## 구형 단말과 신형 단말의 차이 {#구형-신형-단말-차이}

| 항목 | 구형(CSA) | 신형(STS) |
|---|---|---|
| 제어 | 단말 전화번호로 SMS 발송 | MQTT, IoT Core 명령 채널 |
| 보고 | 텔레매틱스 서버 `/log`·`/boot` 엔드포인트로 HTTP(S) | IoT Core 토픽으로 MQTT |
| 수집 뒤 | 서버가 운영 필드만 DB 적재, 원본은 Kinesis 경유 | IoT Core Rule → MSK → 소비자별 구독 |
| 접근 관리 | 웹서버 | Fleet provisioning으로 인증서와 보안 정책 결합 |

SMS는 도달 시간이 지역마다 달랐고 서울에서 멀수록 길어졌습니다. 보낼 때마다 비용도 들었습니다. HTTP 수집은 웹서버가 필요했고 요청이 몰리면 밀렸습니다([IoT 파이프라인 1편]({{< relref "/external/socar/blog/05-iot-pipeline-1-new-device.md" >}})). MQTT는 제한된 IoT 기기를 위해 설계됐고, Pub/Sub 구조라 단말마다 따로 붙지 않아도 됩니다. 브로커를 직접 운영하지 않고 IoT Core를 고른 데에는 운영 부담과 연결 단말 확인, 클러스터링, 차량 제어에 걸맞은 보안이 걸려 있었습니다.

전환은 단계적이었습니다. 명령 채널이 먼저 IoT Core로 옮겨 갔고, 한동안은 명령은 MQTT로, 응답과 상태 보고는 HTTPS로 가는 두 채널 구조였습니다. 펌웨어 업데이트에 몇 주에서 몇 달이 걸려서 텔레매틱스 서버가 Kinesis와 Kafka에 동시에 썼습니다. Kinesis는 관리 주체 없이 소비자가 늘면서 병목과 스로틀링을 겪었고, 샤드 증설이나 향상된 팬아웃은 비용만 키웠습니다.

## 순서 보장과 재처리 설계 {#순서-보장-재처리-설계}

- 메시지 키를 단말 번호로 지정해 같은 단말 메시지를 한 파티션에 모은다. 파티션이 둘 이상이면 토픽 전체 순서는 지켜지지 않기 때문이다.
- MSK 보존 기간은 장애를 2일 안에 해결한다는 기준으로 48시간이다.
- MSK가 업데이트 때 브로커를 한 대씩 재부팅하므로 복제 팩터는 2 이상으로 둔다.
- Kafka Connect는 오프셋을 별도 토픽에 남겨 재시작 뒤 이어 읽는다. Elasticsearch 싱크는 처음부터 다시 읽는 버그가 있어 고정 인덱스와 Rollover로 우회했다.
- FMS의 DynamoDB 싱크는 at-least-once이고 같은 기본 키는 upsert라 중복이 흡수된다. S3 싱크는 조건부 exactly-once다.
- 건너뛴 메시지는 deadletter 토픽으로, Lambda 실패 이벤트는 SQS로 보내 원인을 파악한 뒤 재처리한다.
- 한 토픽에 여러 프로토콜이 섞여 Schema Registry를 미뤘다. 먼저 적재하고 나중에 검증한다.
- 단말은 측정값을 배열로 묶어 보내 통신비와 클라우드 비용을 줄이고, 적재 단계에서 Connector가 배열을 푼다.

순서 문제는 2024년 주행이벤트 글에서 다시 나옵니다. 단말은 최대 2분 분량의 이동·상태 데이터를 묶어 올리는데, 도착 주기가 바뀌면 같은 프로토콜 안에서도 순서가 어긋났습니다([주행이벤트 파이프라인]({{< relref "/external/socar/blog/14-fms-trip-event-pipeline.md" >}})). 첫 개선은 RDB에 쌓고 스케줄러로 탐지하는 방식이었지만 부하가 특정 Pod에 쏠렸습니다. 두 번째 개선에서 Kafka 이벤트 기반과 NoSQL로 옮겼습니다. 차량별로 한 번에 Chunk 하나만 처리하는 Check-In·Check-Out을 두고, 교착을 막는 Check-In Expire와 멱등 설계를 붙였습니다.

## 원문으로는 알 수 없는 부분 {#알-수-없는-부분}

- 통신사, APN, 전용망 여부는 알 수 없다. LTE·3G를 쓴다는 사실만 나온다.
- MQTT QoS 단계, keep-alive, 세션 유지, Device Shadow 사용 여부는 알 수 없다.
- 인증서 발급 시점과 보관 위치, 교체 주기는 알 수 없다. 인증서와 보안 정책을 묶는다는 데까지만 나온다.
- 명령 응답 대기 시간, 재시도, 타임아웃 수치는 없다. 신형 전환으로 제어 지연이 얼마나 줄었는지도 알 수 없다.
- BLE 페어링, 암호화, 명령 검증 방식은 알 수 없다. 커맨드 재발급이 서버에서 새 명령을 받아오는 구조라는 해석은 추정이다.
- 블루투스에서 서버로 넘어가는 판단 기준, 두 경로가 모두 끊겼을 때의 처리는 알 수 없다.
- 텔레매틱스 서버 은퇴와 BigQuery 스트리밍 적재가 끝났는지는 2022년 이후 글에 나오지 않는다. FMS 단말이 STS와 같은 하드웨어인지도 알 수 없다.
- 구형 보고 프로토콜을 1편은 HTTP, 2편은 HTTPS로 적었다.

## 주장별 근거 {#주장별-근거}

| 주장 | 출처 |
|---|---|
| STS 자체 제작, 2020년 첫 장착, 1만 대 이상 | [쏘카의 관제 장치가 하는 일]({{< relref "/external/socar/blog/07-telematics-device-role.md" >}}), 2022-02 |
| LTE·3G 서버 통신, BLE 5.0, 음영 지역과 근거리 제어 | [쏘카의 관제 장치가 하는 일]({{< relref "/external/socar/blog/07-telematics-device-role.md" >}}), 2022-02 |
| SMS 제어·HTTP 수집의 한계, MQTT·IoT Core 채택 이유 | [IoT 파이프라인 구축기 #1]({{< relref "/external/socar/blog/05-iot-pipeline-1-new-device.md" >}}), 2022-01 |
| 명령 채널 선행 전환, 두 채널 병행, Kinesis 병목 | [IoT 파이프라인 구축기 #2]({{< relref "/external/socar/blog/06-iot-pipeline-2-kafka.md" >}}), 2022-02 |
| 단말 번호 키, 48시간 보존, 복제 팩터, Elasticsearch 싱크 우회 | [IoT 파이프라인 구축기 #2]({{< relref "/external/socar/blog/06-iot-pipeline-2-kafka.md" >}}), 2022-02 |
| 블루투스 우선·서버 대체, aliveMessage, 커맨드 재발급 | [쏘카프레임 블루투스 모듈]({{< relref "/external/socar/blog/18-socarframe-bluetooth-module.md" >}}), 2026-01 |
| FMS 토픽 구성, DynamoDB·S3 싱크, 전달 보장, deadletter·SQS 재처리 | [FMS 데이터 파이프라인 1편]({{< relref "/external/socar/blog/09-fms-data-pipeline-1-streaming-batch.md" >}}), 2023-01 |
| IoT Core부터 시작하는 부하 테스트, 메시지 시뮬레이터 | [FMS 데이터 파이프라인 2편]({{< relref "/external/socar/blog/10-fms-data-pipeline-2-testing.md" >}}), 2023-01 |
| 2분 묶음 데이터의 순서 문제, Check-In·Check-Out | [FMS 주행이벤트 파이프라인]({{< relref "/external/socar/blog/14-fms-trip-event-pipeline.md" >}}), 2024-06 |
