---
title: "서버 로그 적재를 Kafka와 데이터 컨트랙트로 다시 짠 파이프라인"
description: "쏘카 데이터엔지니어링팀이 S3와 Airflow 배치 기반 로그 파이프라인을 MSK, 커스텀 Consumer, Protobuf 스키마 관리로 바꾼 과정입니다. 설계 선택과 시행착오, 남은 과제를 요약합니다."
date: 2026-11-08
weight: 15
---

# 서버 로그 적재를 Kafka와 데이터 컨트랙트로 다시 짠 파이프라인 (2025-02)

{{< callout type="info" >}}
**원문 정보**
- 원문: [로그 파이프라인 개선기 - 기존 파이프라인 문제 정의 및 해결 방안 적용](https://tech.socar.kr/data/2025/02/26/log-pipeline-revamp)
- 매체 · 게시일: 쏘카 기술 블로그 · 2025-02-26
- 저자: 삐약, 루디 (쏘카 데이터엔지니어링팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 분류, 신선도, 스키마라는 서로 얽힌 세 문제 {#기존-문제}

기존 파이프라인은 서버 로그를 Kinesis Data Stream과 Firehose로 S3에 모은 뒤, GKE에서 도는 Airflow가 주기적으로 읽어 타입별로 나눠 GCS에 쓰고 BigQuery에 적재했습니다. 로그 한 파일에 여러 type이 섞여 있고, 요구사항은 요청한 type만 타입별 테이블로 적재하되 늦어도 2시간 안에 처리하는 것이었습니다.

운영하면서 세 가지 문제가 드러났습니다.

- 분류기가 모든 type을 다 나누고 적재기가 필요한 것만 올리는 구조라 시간이 오래 걸렸습니다. 분류 전후 데이터가 S3와 GCS에 중복 저장됐고, 분류가 실패하면 모든 로그 적재가 멈추는 단일 장애 지점이었습니다.
- 배치 스케줄링이라 실시간에 가까운 로그 수요에 대응하지 못했습니다.
- 생산자와 소비자가 함께 보는 Schema Registry가 없었습니다. 스키마가 섞인 데이터는 임시 적재기로 처리하고 BigQuery 스키마는 사람이 직접 고쳐야 했습니다.

팀은 세 문제가 서로 얽혀 있다고 보고 전면 개선을 택했습니다. 원본 저장소를 하나로 줄이고, 스트리밍으로 전환하고, 스키마를 한곳에서 관리하는 것이 목표였습니다.

## MSK, 커스텀 Consumer, GCS, BigQuery 뷰 {#새-구조}

새 구조의 핵심은 생산자와 소비자가 같은 단일 진실 공급원(SSoT)을 본다는 점입니다. 서버가 Protobuf로 직렬화한 로그를 MSK로 보내면 파이썬 Consumer가 읽어 분류하고 GCS에 type, 날짜, 시간 단위로 파티셔닝해 바로 씁니다. 오류가 난 메시지는 DLQ로 보내 나중에 다시 처리합니다.

GCS 데이터는 BigQuery 외부 테이블이 참조합니다. 외부 테이블은 쿼리가 느려서 매일 배치로 내부 테이블에 옮기고, 사용자는 두 테이블을 합친 뷰로 조회합니다. 원문은 이 구조로 데이터 신선도가 기존 1~2시간에서 준실시간, 약 3분으로 줄었다고 밝힙니다.

스키마는 Protobuf 통합 레포지토리에서 관리합니다. Buf가 린팅, 포맷팅, 호환성 검증을 자동화하고 파이썬과 자바 클래스, BigQuery 스키마를 플러그인으로 생성합니다. 스키마 변경은 생산자와 소비자 모두 PR 리뷰를 거치고 GitHub Actions가 기본 검사를 돌립니다. 원문은 이 체계를 데이터 컨트랙트라고 부르며, 생산자와 소비자의 합의, 코드로 쓴 명시적 스키마, 파이프라인 전반의 적용을 세 요소로 듭니다.

## Firehose와 Kafka Connect를 두고 Consumer를 직접 만든 이유 {#consumer-선택}

MSK를 고른 이유는 Schema Registry였습니다. 소비 도구 후보에는 모두 걸림돌이 있었습니다.

- **Firehose:** MSK를 소스로 쓰면 Dynamic Partitioning을 쓸 수 없어 type별 분류가 안 됐고, Lambda로 변환 계층을 더해야 해서 과하다고 봤습니다.
- **Kafka Connect:** MSK Connect는 에러 로그가 불친절해 설정이 어려웠습니다. Protobuf 변환기는 oneof 필드에서 쓰지 않는 필드까지 null로 채워 팀이 원한 형태가 나오지 않았고, 이를 고칠 Java/Kotlin 변환 로직은 팀 경험이 부족해 유지보수가 어렵다고 판단했습니다.

팀은 토픽 하나에 스키마가 하나만 대응한다는 점도 고려했습니다. 수백 종의 로그마다 토픽을 만들 수는 없어서 Protobuf의 oneof로 스키마 하나에 여러 로그 메시지를 담고, 사용자·운전·예약 같은 대분류로 토픽을 묶었습니다. Consumer는 confluent-kafka로 만들었습니다. 버퍼 크기와 간격, DLQ, 파티션 키 조합, 적재 대상을 설정으로 바꿀 수 있습니다.

## Protobuf 역직렬화에서 드러난 검증 공백 {#검증-공백}

파이썬 SDK의 ProtobufDeserializer는 Schema Registry 클라이언트를 인자로 받지 않습니다. 메시지에 담긴 schema id의 Writer Schema와 Consumer의 Reader Schema를 대조할 수 없어, Reader Schema로 해석만 하게 됩니다. Protobuf는 와이어 포맷에 필드 번호와 타입만 담기 때문에 필드 이름이나 메시지 구조가 달라도 오류 없이 읽힙니다. 팀은 Java SDK가 이 교차 검증을 지원하는 것을 확인해 백로그에 올렸습니다.

남은 과제는 Registry 기반 검증 보완과 모니터링 및 알림 강화입니다. 쏘카와 네이버 제휴 서비스의 로그는 새 파이프라인으로 적재해 안정적으로 운영 중이라고 합니다.

{{% details title="기존 구성과 변경 구성 비교" closed="true" %}}

| 항목 | 기존 | 변경 |
|---|---|---|
| 분산 메시지 플랫폼 | Kinesis Data Stream | Managed Streaming for Apache Kafka |
| 메시지 소비 | Firehose | Kafka Consumer |
| 데이터 가공 | Airflow | Kafka Consumer |
| 스키마 통합 관리 | 없음 | 1차 Protobuf, 2차 Schema Registry |
| 데이터 신선도 | 1~2시간 | 준실시간(약 3분) |

{{% /details %}}
