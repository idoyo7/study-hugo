---
title: "VictoriaLogs·Loki·Elasticsearch·OpenSearch·SigNoz·ClickStack 구조화 로그 수집 벤치마크"
linkTitle: "로그 스택 수집 벤치마크"
description: "VictoriaMetrics가 2026년 10월 공개한 여섯 로그 시스템의 단일 노드 수집 벤치마크를 요약한다. 최대 수집량, CPU, 메모리, 디스크 수치와 시스템별로 결과가 달라진 이유, 이 수치를 읽을 때 감안할 조건을 정리한다."
date: 2026-11-21
lastmod: 2026-11-21
weight: 11
url: "/logging/11-log-ingestion-benchmark/"
---

# VictoriaLogs·Loki·Elasticsearch·OpenSearch·SigNoz·ClickStack 구조화 로그 수집 벤치마크

{{< callout type="info" >}}
**원문 정보**
- 원문: [VictoriaLogs vs Loki, Elasticsearch, OpenSearch, SigNoz and ClickStack on structured log ingestion](https://victoriametrics.com/blog/structured-log-ingestion-benchmark/) · Cuong Le · VictoriaMetrics · 2026-10-29
- 결과 표와 재현 코드: [VictoriaMetrics/logs-benchmark](https://github.com/VictoriaMetrics/logs-benchmark), [2026-10 수집 시험 결과](https://github.com/VictoriaMetrics/logs-benchmark/tree/main/results/2026-10-ingest)
- 소개한 곳: [promkr 뉴스레터 2026년 11월호](https://promkr.substack.com/p/prometheus-and-observability-2026-9a6)
{{< /callout >}}

promkr 뉴스레터 2026년 11월호에 소개된 로그 스택 비교를 원문과 재현 저장소를 바탕으로 정리했습니다. 측정자는 VictoriaLogs 개발사인 VictoriaMetrics이며, 여기 실은 수치는 직접 재현한 결과가 아닙니다. 수집량과 자원 사용량을 먼저 살펴보고, 시스템마다 차이가 생긴 이유와 이 결과를 읽을 때 필요한 조건을 짚습니다.

## 여섯 시스템의 저장 방식

로그를 받을 때 검색에 필요한 정보를 얼마나 만들어 두는지가 수집 비용에 영향을 줍니다. 필드를 어떤 단위로 저장하느냐도 압축률과 이후의 쿼리 비용을 바꿉니다.

| 시스템 | 인덱싱하는 것 | 저장하는 모양 | 수집 입구 |
|---|---|---|---|
| Loki | 스트림 라벨만 인덱싱(이 시험에서는 node와 app) | 로그 줄을 그대로 압축 | 직접 수신. Alloy·Vector는 protobuf, Fluent Bit·Fluentd·Logstash는 JSON |
| Elasticsearch | 모든 단어와 값의 역색인 | 원본 JSON, 역색인, doc values를 함께 저장 | 직접 수신(bulk JSON) |
| OpenSearch | Elasticsearch와 같은 코어. 로그용 기본 템플릿이 없어 문자열 필드 대부분을 text와 keyword로 두 번 인덱싱 | Elasticsearch와 같으나 LogsDB 같은 모드는 없음 | 직접 수신(bulk JSON) |
| VictoriaLogs | 가벼운 인덱스와 bloom filter. 전체 역색인은 만들지 않음 | 로그를 스트림별로 모으고 필드마다 컬럼에 저장 | 직접 수신(OpenTelemetry, Loki, Elasticsearch, Datadog, Splunk 형식) |
| SigNoz | ClickHouse 테이블에서 고정 필드는 전용 컬럼, 속성은 Map 컬럼에 저장 | ClickHouse 컬럼 | OpenTelemetry collector 기반 수집기를 거쳐 수신 |
| ClickStack | SigNoz와 같은 방식 | ClickHouse 컬럼 | OpenTelemetry collector 기반 수집기를 거쳐 수신 |

## 시험 조건

| 항목 | 내용 |
|---|---|
| 측정 시점과 버전 | 2026년 10월. VictoriaLogs v1.53.0, Loki 3.7.8, Elasticsearch 9.5.5, OpenSearch 3.9.0, SigNoz v0.145.0, ClickStack 2.39.1 |
| 장비 | 시스템마다 GCP n2d-standard-8 노드 하나(8 vCPU, 32GB), 500GiB pd-balanced 디스크, GKE v1.36.4. CPU·메모리 limit 없음 |
| 설정 | 공식 차트나 오퍼레이터의 기본값을 최대한 유지. Loki의 수집 한도처럼 단일 노드에서 설계상 한계에 도달하는 데 필요한 값만 변경. VictoriaLogs는 변경 없음 |
| 워크로드 | 노드 125대에서 파드가 40개씩 실행되는 클러스터를 가정한 로그 스트림 5,000개. 한 줄에 필드 30~40개, 평균 약 930바이트 JSON. 고정 시드로 매번 같은 로그 생성 |
| 전송 형식 | 각 시스템이 선호하는 형식 사용. VictoriaLogs는 JSON lines, Elasticsearch와 OpenSearch는 bulk JSON, Loki는 snappy 압축 protobuf, SigNoz와 ClickStack은 OTLP protobuf |
| 부하 | 초당 1만 줄로 시작해 10분마다 1만 줄씩 늘려 최대 18만 줄까지 전송. 여섯 시스템에 같은 로그를 동시에 전송 |
| 최대 수집량의 정의 | 첫 크래시 전에 마친 단계 중 10분 평균 저장 속도가 가장 높았던 값. 수신한 줄이 아닌 저장한 줄을 기준으로 계산. Loki만 수신한 줄로 계산(응답 전에 WAL에 기록) |
| 반복 | 세 번 실행한 중앙값. 수집 시험 중에는 쿼리 시험을 함께 실행하지 않음 |

## 측정 결과

{{< lane src="_lane/1-최대-수집량.json" />}}

한 줄을 약 930바이트로 계산하면 초당 12만 줄은 약 106MiB/s입니다. 이 속도로 하루 동안 쌓이는 원본 로그는 약 9TiB입니다.

| 시스템 | 최대 수집량(줄/s) | 세 번의 범위 | CPU 코어(1만 / 4만 / 12만 줄) | 메모리 GiB(1만 / 4만 / 12만 줄) |
|---|---|---|---|---|
| Loki | 13.9만 | 12.4만~14.3만 | 0.4 / 1.6 / 6.1 | 2.8 / 11.4 / 12.8 |
| VictoriaLogs | 12만 | 11.9만~12.4만 | 0.4 / 1.6 / 7.2 | 0.4 / 0.8 / 2.5 |
| Elasticsearch | 4.8만 | 4.8만~4.9만 | 1.0 / 5.2 / N/A | 16.7 / 16.8 / N/A |
| ClickStack | 4.6만 | 4.5만~5만 | 0.9 / 4.0 / N/A | 1.3 / 2.2 / N/A |
| OpenSearch | 2.8만 | 2.7만~2.9만 | 1.5 / N/A / N/A | 17.0 / N/A / N/A |
| SigNoz | 1만(2만에서 크래시) | 0.9만~1만 | 4.2 / N/A / N/A | 3.1 / N/A / N/A |

CPU는 각 단계의 평균이며, 메모리는 페이지 캐시를 제외한 단계 최고값입니다. N/A는 세 번 중 한 번이라도 해당 단계 목표의 90% 미만을 저장한 경우입니다. SigNoz와 ClickStack의 CPU와 메모리에는 수집기, ClickHouse, 보조 서비스가 모두 포함됩니다.

Elasticsearch와 OpenSearch의 메모리가 거의 일정한 이유는 시작할 때 고정 heap을 확보하기 때문입니다. 원문에 따르면 Elasticsearch는 기본으로 장비 메모리의 절반을 heap으로 잡습니다. OpenSearch는 이를 자동으로 정하지 않아 같은 크기를 할당했습니다. 원문은 대부분의 시스템이 이 시험에서 CPU 한계에 먼저 닿았다고 설명합니다.

| 시스템 | 백만 줄당 디스크(MiB) | 압축비 | 저장한 줄당 디스크 쓰기(바이트, 1만 / 4만 / 12만 줄) |
|---|---|---|---|
| VictoriaLogs | 56 | 15.7배 | 323 / 226 / 163 |
| ClickStack | 82 | 10.9배 | 414 / 572 / N/A |
| Loki | 101 | 8.8배 | 1,108 / 1,411 / 1,210 |
| Elasticsearch | 266 | 3.3배 | 1,393 / 1,917 / N/A |
| OpenSearch | 561 | 1.6배 | 2,295 / N/A / N/A |
| SigNoz | N/A | N/A | 1,420 / N/A / N/A |

압축비는 원본 JSON 크기인 백만 줄당 887MiB를 디스크 사용량으로 나눈 값입니다. SigNoz는 수집기가 반복해서 종료돼 비교할 만큼 로그를 저장하지 못했습니다. 줄당 디스크 쓰기에는 인덱스 기록과 백그라운드 병합도 포함되므로 최종 저장 크기보다 값이 큽니다.

보관 기간까지 고려하면 필요한 디스크 규모가 커집니다. 원문은 초당 5만 줄을 30일 보관할 때 VictoriaLogs 약 7TiB, Loki 12TiB, Elasticsearch 33TiB가 필요하다고 계산합니다. 시험에 사용한 디스크의 쓰기 한도는 초당 280MiB였으며, 이 한도에 먼저 도달한 시스템은 없었습니다.

## 시스템별 성능 차이의 배경

### Loki의 인덱싱과 검색 비용

라벨에만 인덱스를 만드는 Loki는 수집 단계에서 처리할 일이 적습니다. 로그를 필드별로 나눠 저장하는 VictoriaLogs는 이 작업 때문에 초당 12만 줄에서 Loki보다 CPU를 약 18% 더 썼습니다.

전송 형식에 따른 처리 비용도 영향을 줍니다. 별도 실행에서 Loki에 JSON을 보내자 수집량이 초당 약 9.9만 줄로 낮아져 VictoriaLogs보다 적게 받았습니다. 원문은 Loki가 protobuf보다 JSON을 처리할 때 CPU를 훨씬 많이 쓰기 때문이라고 설명합니다.

원문은 Loki의 설계에 따르는 비용으로 메모리, 디스크, 쿼리 시간을 듭니다.

- 메모리: 스트림마다 최신 로그를 메모리에 모아 함께 압축하므로 스트림 수가 늘면 메모리도 늘어난다. 스트림 15,000개를 넣은 시험에서는 초당 6만 줄에서 메모리가 부족해 Loki가 종료됐다. VictoriaLogs는 스트림 수가 세 배여도 메모리를 0.2GiB만 더 썼다.
- 디스크: 필드 구조를 활용하지 않고 줄 전체를 일반 텍스트로 압축하므로 VictoriaLogs보다 디스크가 1.8배 더 필요하다.
- 쿼리 시간: 라벨로 범위를 좁힌 뒤에도 단어나 필드 값을 찾으려면 해당 스트림의 모든 줄을 압축 해제하고 훑어야 한다.

이 절의 쿼리 시간은 VictoriaLogs, Elasticsearch, Loki에 같은 로그를 초당 3.5만 줄로 4시간 넣은 뒤 콜드 캐시 상태에서 측정한 값입니다. 저장소 밖에서 한 번 실행한 추가 시험이며, 원문은 쿼리 성능을 후속 글에서 더 자세히 다룰 계획이라고 밝힙니다.

| 질문(1시간 범위) | VictoriaLogs(초) | Loki(초) |
|---|---|---|
| 앱 하나의 에러 수 | 0.06 | 3.5 |
| 모든 앱의 에러 수 | 0.59 | 171 |
| 흔한 단어가 든 최신 100줄 | 2.5 | 32 |
| 모든 앱의 p99 지연 | 1.9 | 302 |
| 요청 경로 상위 10개 | 8.8 | 거부(시리즈 500개 초과) |

Loki에는 필드 검색을 빠르게 하는 bloom filter도 있습니다. 원문에 따르면 시험 당시에는 실험 단계였고 기본으로 꺼져 있었으며, 단일 노드에서 사용할 수 없어 이 시험에서도 켜지 않았습니다.

원문은 이 결과만으로 Loki가 로그 저장소로 나쁜 선택이 되는 것은 아니라고 덧붙입니다. Loki는 오브젝트 스토리지에 로그를 저렴하게 보관하고, 큰 쿼리는 워커를 늘려 처리하도록 만든 시스템입니다. 모든 앱의 에러 수를 센 쿼리는 8코어의 절반쯤을 사용했습니다. 이때 걸린 171초를 2초 안으로 줄이려면 약 300코어가 필요하다는 계산은 원문의 대략적인 추정입니다.

### Elasticsearch와 OpenSearch의 인덱싱 비용

Elasticsearch는 검색에 쓸 정보를 수집할 때 미리 준비합니다. 역색인과 doc values를 만드는 데 CPU가 들고, 이 시험에서도 수집량을 제한한 자원은 CPU였습니다. 응답 전에 fsync를 하는 설정을 끈 별도 실행에서도 수집량은 거의 그대로였습니다.

시험에는 로그용 압축 인덱스 모드인 LogsDB를 사용했습니다. 이 조건에서도 디스크 사용량은 Loki의 2.6배, VictoriaLogs의 거의 5배였습니다. 쿼리는 앞서 설명한 추가 시험에서 VictoriaLogs와 비교했습니다.

| 질문(1시간 범위) | VictoriaLogs(초) | Elasticsearch(초) |
|---|---|---|
| 흔한 단어가 든 줄 수 | 6.5 | 0.10 |
| 모든 앱의 에러 수 | 0.59 | 0.46 |
| 모든 앱의 p99 지연 | 1.9 | 3.9 |
| 요청 경로 상위 10개 | 8.8 | 14.7 |
| 두 단어 구문이 든 줄 수 | 4.4 | 175 |

두 단어가 나란히 있는지 확인하려면 단어의 위치 정보가 필요합니다. Elasticsearch의 로그용 기본 설정은 디스크를 아끼려고 이 정보를 저장하지 않습니다. 구문을 검색할 때는 로그를 다시 읽어 두 단어가 붙어 있는지 확인해야 하므로 시간이 오래 걸립니다.

OpenSearch와 Elasticsearch의 차이는 기본 설정에서 시작됩니다. OpenSearch에는 LogsDB 같은 모드가 없어 원본 JSON의 압축률이 낮고, 저장 전 정렬도 하지 않습니다. 로그용 내장 템플릿도 없어 문자열 필드 대부분을 단어 단위와 정확한 값으로 각각 인덱싱합니다.

원문은 Elasticsearch와 코어가 같으므로 압축을 강화하고 정렬과 로그용 템플릿을 적용하면 차이를 많이 좁힐 수 있을 것으로 봅니다. 이번 시험에서는 기본 상태에서 얻는 결과를 보여 주려고 이 설정들을 조정하지 않았다고 설명합니다.

### VictoriaLogs의 컬럼 저장과 집계

같은 스트림의 로그에는 비슷한 필드가 반복되고, 많은 필드의 값이 거의 바뀌지 않습니다. VictoriaLogs는 로그를 스트림별로 모으고 필드마다 컬럼에 저장해 이 반복을 압축에 활용합니다. 줄 전체를 압축하는 방식보다 잘 압축되는 이유입니다.

쿼리에서 필드 몇 개만 필요하면 해당 컬럼만 읽습니다. 이런 저장 방식 자체가 디스크 사용량을 줄이고 집계를 빠르게 하므로, 수집 시점에는 가벼운 인덱스와 적은 메타데이터만 만듭니다. 이 시험에서 수집량은 VictoriaLogs가 Elasticsearch보다 2.5배 많았고, 디스크 사용량은 Elasticsearch가 VictoriaLogs보다 4.7배 많았습니다.

전체 역색인을 만들지 않으면 수집과 저장 비용을 줄일 수 있지만 흔한 단어를 찾는 검색은 느려집니다. 사용자 ID처럼 드문 단어는 bloom filter로 그 단어가 없는 데이터를 건너뛸 수 있어 빠르게 찾습니다.

원문은 이번 시험이 VictoriaLogs에 유리한 조건임을 밝힙니다. 구조화 로그를 사용했고, 이런 로그를 다루는 일상 작업에는 컬럼 저장이 유리한 집계가 많기 때문입니다. 오래된 애플리케이션이나 네트워크 장비의 평문 로그에서는 얻는 이점이 줄어듭니다.

### SigNoz와 ClickStack의 수집기와 필드 저장

원문은 컬럼형 저장소를 쓰는 SigNoz와 ClickStack의 수집량이 낮았던 이유를 ClickHouse 앞의 수집기에서 찾습니다. ClickHouse는 범용 데이터베이스라 일반적인 로그 형식을 직접 받지 못하므로 OpenTelemetry collector가 로그를 행으로 바꿔야 합니다.

이 수집기가 ClickHouse 자체보다 CPU를 더 썼습니다. SigNoz는 초당 1만 줄에서 수집기 2.7코어, ClickHouse 1.5코어를 사용했습니다. ClickStack은 최대 수집량에서 각각 3.3코어와 2.2코어였습니다.

디스크 사용량이 더 큰 이유는 필드를 저장하는 방식에 있을 가능성이 크다는 것이 원문의 해석입니다. Timestamp, SeverityText, TraceId 같은 고정 필드는 전용 컬럼에 들어가 잘 압축됩니다. 나머지 속성은 Map 컬럼 몇 개에 여러 필드의 값이 섞여 저장되므로 압축이 덜 되고 쿼리도 느려집니다.

SigNoz의 수집기는 쿼리와 UI를 돕는 메타데이터도 추가로 만듭니다. 같은 설계인 ClickStack보다 CPU를 거의 5배 쓴 이유는 주로 이 작업에 있었습니다. 메모리 limit이 없는 기본값도 유지했기 때문에, 처리가 밀리자 수집기는 로그를 메모리에 계속 쌓았습니다. 결국 Kubernetes가 수집기를 종료했습니다.

원문은 두 스택에 공정한 설명을 덧붙이며, 이들이 제공하는 기능의 범위를 짚습니다. SigNoz와 ClickStack은 로그·메트릭·트레이스를 한곳에 모으고 트레이스와 로그를 연결하는 전체 관측 스택입니다. 이번 시험에서 측정한 부분은 그중 로그 수집뿐입니다.

두 스택 모두 수집량이 늘면 수집기를 늘리는 구성을 권합니다. ClickHouse 문서는 수집기 하나의 처리량을 3코어에서 초당 약 6만 이벤트로 잡습니다. SigNoz 자체 벤치마크에서는 16코어 장비에 수집기 셋을 두고 초당 약 5.5만 줄을 수집했습니다. 이번 시험에서는 수집기가 ClickHouse와 8코어 장비 하나를 나눠 썼다는 차이가 있습니다.

## 시스템별 장점과 단점

| 시스템 | 이 시험에서 드러난 장점 | 단점 | 원문이 맞다고 본 조건 |
|---|---|---|---|
| Loki | 최대 수집량 1위. 인덱싱 작업이 가장 적음 | 스트림 수에 따라 늘어나는 메모리, 라벨 밖 검색에 분 단위 소요 | 오브젝트 스토리지에 많은 로그를 저렴하게 보관하고 일부만 읽거나, 검색에 많은 코어를 쓸 수 있을 때 |
| Elasticsearch | 단어·정확한 값을 거의 즉시 검색 | 수집 시 CPU 비용, 약 17GiB의 고정 heap, VictoriaLogs의 거의 5배인 디스크 사용량 | 어떤 필드든 빠른 검색이 필요할 때. 비용과 대규모 클러스터 운영 부담이 따름 |
| OpenSearch | Elasticsearch와 같은 코어 | 기본값에서 Elasticsearch 대비 수집량은 절반 남짓, 디스크는 약 두 배 | 압축·정렬·로그 템플릿 조정으로 차이를 좁힐 수 있음 |
| VictoriaLogs | 수집량 2위. 메모리·디스크·디스크 쓰기가 가장 적고 쿼리는 초 단위 | Elasticsearch보다 흔한 단어 검색이 느림. 평문 로그에서는 이점 감소 | 구조화 로그를 주로 집계와 대시보드에 사용할 때 |
| ClickStack | 디스크 2위, 적은 메모리 사용량 | 수집기의 CPU 비용으로 수집량이 초당 4.6만 줄에 머묾 | OTLP 로그·메트릭·트레이스를 한곳에 모을 때. 수집기를 별도로 늘리는 구성 권장 |
| SigNoz | 수집할 때 쿼리와 UI용 메타데이터 생성 | 수집기 CPU 비용이 커 초당 1만 줄. 메모리 limit 없는 기본값에서 크래시 | ClickStack과 같음 |

## 이 수치를 읽을 때 감안할 조건

- 측정자는 VictoriaLogs 개발사다. 원문은 마케팅 글이 아니라고 밝히며 설정 변경 내역과 재현 코드를 공개했다. 제3자가 재현한 결과는 이 글을 쓰는 시점에 확인하지 못했다.
- 주된 비교 대상은 단일 노드와 일반 클라우드 디스크에서 구조화 로그를 수집하는 성능이다. 저장소 로드맵에서 쿼리 시험은 진행 중이며, 클러스터 모드와 오브젝트 스토리지 시험은 예정돼 있다.
- 본문의 쿼리 시간은 저장소 밖에서 한 번 실행한 추가 시험의 결과다. 저장소 README는 진행 중인 쿼리 시험의 수치가 아직 공개되지 않았고 시스템 간 비교에도 쓸 수 없다고 적는다.
- 시스템마다 전송 형식이 다르다. 로그는 보통 JSON으로 시작하지만 이를 각 시스템의 형식으로 바꾸는 비용은 측정에서 빠졌다. 저장소도 이 점을 다소 불공정하다고 밝힌다. 압축된 본문을 받은 시스템은 Loki뿐이다.
- 응답 시점의 내구성 기준도 다르다. Elasticsearch와 OpenSearch는 fsync를 마친 뒤 응답하지만 나머지는 그보다 일찍 응답한다.
- SigNoz와 ClickStack은 수집기, ClickHouse, UI가 한 노드의 자원을 나눠 썼다. 나머지 시스템은 해당 노드에서 서버 하나만 실행했다.
- OpenSearch는 기본 설정을 유지한 탓에 Elasticsearch보다 불리한 인덱싱 조건으로 시험했다.

promkr 뉴스레터는 로그 본문을 인덱싱하는 VictoriaLogs와 인덱싱하지 않는 Loki의 차이가 수집과 쿼리 성능에 드러난다는 점을 흥미롭게 소개했습니다.

## 이 사이트의 관련 글

- 저장소 선택 조건은 [로그 스택 통합 비교]({{< relref "/observability/logs/10-log-stack-comparison/index.md" >}})와 [저장소 비교·선택]({{< relref "/observability/logs/comparison/_index.md" >}})에서 다룬다.
- Elasticsearch와 VictoriaLogs가 로그를 저장하는 방식은 [VictoriaLogs vs Elasticsearch]({{< relref "/observability/logs/victorialogs-internals/es-vs-victorialogs/index.md" >}})의 도식으로 비교할 수 있다.
- Loki와 ClickStack을 각각 검토한 내용은 [Loki + Alloy]({{< relref "/observability/logs/comparison/02-loki-alloy.md" >}}), [HyperDX / ClickStack]({{< relref "/observability/logs/comparison/05-hyperdx-clickstack.md" >}})에서 볼 수 있다.
