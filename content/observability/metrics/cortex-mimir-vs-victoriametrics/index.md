---
title: "Prometheus 중앙 장기 저장소를 고를 때 감수할 조건"
linkTitle: "Cortex·Mimir vs VictoriaMetrics"
description: "2026-11-01 기준 Cortex, Grafana Mimir, VictoriaMetrics cluster 가운데 어떤 조건에서 무엇을 고를지 비교한다. 데이터가 남는 방식과 운영 범위, 쿼리 호환과 테넌트 격리를 기준으로 선택할 때 감수할 조건을 짚는다."
date: 2026-11-01
lastmod: 2026-11-01
weight: 8
url: "/monitoring/cortex-mimir-vs-victoriametrics/"
---

# Prometheus 중앙 장기 저장소를 고를 때 감수할 조건

## 1. 중앙 저장소를 찾게 된 시점

Prometheus 단일 서버나 HA 쌍으로는 보존 기간을 늘리는 데 한계가 옵니다. 여러 클러스터의 메트릭을 모아야 하고, 테넌트(사용자나 팀을 구분하는 논리 단위)마다 사용량도 관리해야 합니다. 중앙 저장소는 받는 데이터 양만으로 고를 수 없습니다. 데이터를 어디에 남기는지, 복제본을 어떻게 처리하는지, 저장소 밖에서 어떤 시스템을 운영해야 하는지도 선택을 바꿉니다.

후보 구성은 Prometheus가 remote_write(수집한 샘플을 외부 저장소로 보내는 기능)로 Cortex나 Grafana Mimir에 전송하는 방식, vmagent 또는 Prometheus가 VictoriaMetrics cluster에 전송하는 방식입니다. Cortex와 Mimir는 2022년 포크로 나뉜 같은 뿌리입니다. Grafana Labs는 2022-03-30 Mimir를 발표하면서 클라우드 사업자와 ISV의 Cortex 기여가 상품 활용에 비례하지 않았다고 설명했습니다. Grafana Enterprise Metrics에 투자하며 만든 split-and-merge compactor, query sharding 같은 확장성 기능을 AGPLv3로 공개한 것이 Mimir입니다. Cortex는 AWS와 Apple 등의 메인테이너가 유지하고 있습니다.

VictoriaMetrics는 처음부터 다른 설계를 택했습니다. vmstorage가 로컬 디스크에 데이터를 보관하며, 노드끼리 서로를 알거나 통신하지 않는 shared-nothing 방식입니다. 같은 중앙 저장소 역할을 맡겨도 Cortex·Mimir와 운영 구성이 달라지는 출발점입니다.

단일 서버 단계의 선택은 [Prometheus와 VictoriaMetrics의 확장 방식과 운영 비용 비교]({{< relref "/observability/metrics/prometheus-vs-victoriametrics/index.md" >}})에, 여러 클러스터를 연결하는 구성은 [여러 클러스터의 메트릭을 모으는 Thanos와 VictoriaMetrics 구성]({{< relref "/observability/metrics/prometheus-vs-victoriametrics-multi-cluster/index.md" >}})에 있습니다. 여기서는 그 뒤에서 데이터를 받아 오래 보관할 중앙 저장소를 비교합니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 조사 기준일은 2026-11-01이며 Cortex v1.21.1, Grafana Mimir 3.2.4, VictoriaMetrics v1.155.0을 봤습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| Cortex 버전 | v1.21.1(2026-06-05). v1.22.0은 rc.3(2026-10-06)까지만 나옴 | Cortex 릴리스 | `✓` |
| Mimir 버전 | 3.2.4(2026-10-30). 3.1.x도 병행 패치(3.1.9). 3.0.0은 2025-10-31 | Mimir 릴리스 | `✓` |
| VictoriaMetrics 버전 | v1.155.0(2026-10-26). LTS는 v1.148.x와 v1.136.x | VictoriaMetrics 릴리스, LTS 문서 | `✓` |
| Mimir 포크 경위 | 클라우드 사업자·ISV의 기여 부족을 이유로 들고 GEM의 확장성 기능을 AGPLv3로 공개 | Grafana Labs 발표 블로그(2022-03-30) | `Ⓥ` |
| 같은 해 라이선스 변경 | Grafana·Loki·Tempo도 Apache 2.0에서 AGPLv3로 변경 | Grafana Labs 발표 블로그 | `Ⓥ` |
| Cortex 현재 유지 주체 | AWS가 Cortex 기반 Amazon Managed Service for Prometheus를 운영. 메인테이너 6명 중 AWS 3, Apple 2, KakaoEnterprise 1 | AWS FAQ, Cortex MAINTAINERS | `✓` |
| VM shared-nothing | "vmstorage nodes don't know about each other" 문구. 해시 링·메타데이터 저장소 없음 | VictoriaMetrics cluster 문서 | `✓` |

{{% /details %}}

## 2. 데이터를 둘 곳이 운영 구성을 정한다

장기 데이터를 오브젝트 스토리지에 보관하려면 Cortex와 Mimir가 맞습니다. VictoriaMetrics cluster는 보존 기간 전체의 데이터를 vmstorage 로컬 디스크에 둡니다. 이 차이는 저장 매체에서 끝나지 않습니다. 쓰기를 누가 확인하는지, 복제본이 얼마나 남는지, 캐시와 메시지 시스템을 따로 운영해야 하는지까지 달라집니다.

### 쓰기 응답과 장기 저장이 이어지는 경로

Cortex에서는 distributor가 테넌트 한도를 검증하고 ingester로 샘플을 보냅니다. ingester는 최근 샘플을 메모리와 디스크 WAL(복구용 쓰기 로그)에 두었다가 2시간 블록으로 오브젝트 스토리지에 올립니다. querier는 최근 구간을 ingester에서, 과거 구간을 store-gateway에서 읽습니다. 선택 컴포넌트인 query-frontend는 쿼리의 큐잉·분할·캐시를 맡고, compactor는 저장된 블록을 병합하며 tenant별 bucket index를 갱신합니다.

다음 그림은 Cortex에서 최근 데이터와 장기 데이터의 쓰기·읽기 경로가 나뉘는 모습을 보여줍니다.

{{< flow src="_flow/1-cortex.json" />}}

Mimir는 3.0부터 ingest storage라는 쓰기 경로를 지원합니다. distributor가 시리즈를 Kafka 토픽의 파티션으로 나누고, Kafka 브로커가 복제와 영속화를 확인하면 클라이언트에 응답합니다. ingester는 정확히 한 파티션을 소비하므로 쓰기 응답에 ingester 쿼럼이 필요하지 않습니다. 읽기 경로는 Cortex와 같은 계열이지만, 쓰기를 받는 앞단에 Kafka가 들어갑니다.

{{< flow src="_flow/1-mimir.json" />}}

Grafana 문서는 ingest storage를 안정적이며 권장하는 방식으로 설명합니다. 실제 기본값은 배포 수단에 따라 다릅니다. 바이너리의 `-ingest-storage.enabled`는 기본 꺼짐이므로 그대로 실행하면 stateful ingester와 로컬 WAL을 쓰는 classic입니다. Helm 차트 `mimir-distributed` 6.0은 ingest storage가 기본이며 데모용 단일 노드 Kafka를 함께 띄웁니다. 차트 문서는 운영에 외부 Kafka 호환 클러스터를 쓰라고 안내합니다.

Grafana가 안내하는 classic 이전 경로도 제자리 업그레이드가 아닙니다. 새 클러스터를 병행 구성해 양쪽에 쓰고, 그 뒤 읽기를 옮기는 방식입니다. 따라서 ingest storage를 선택할 때는 Kafka 운영과 이전 과정까지 고려해야 합니다. classic을 언제까지 지원할지는 확인하지 못했습니다.

VictoriaMetrics에서는 vminsert가 metric name과 전체 label을 consistent hashing으로 계산해 vmstorage에 나눠 보냅니다. vmselect는 모든 vmstorage에서 데이터를 받아 쿼리를 계산합니다. vmstorage끼리 통신하지 않고 해시 링이나 메타데이터 저장소도 없으므로, vminsert와 vmselect에 `-storageNode` 목록을 직접 지정합니다. DNS SRV나 파일로 노드를 자동 발견하는 기능은 Enterprise에 있습니다.

{{< flow src="_flow/1-victoriametrics.json" />}}

이 경로를 운영하려면 Cortex는 오브젝트 스토리지와 링 KV를 갖춰야 합니다. 링 KV로 Consul, etcd, memberlist 중 하나를 쓰며, 캐시는 memcached, redis, in-memory를 지원합니다. Mimir도 오브젝트 스토리지가 필수이고 ingest storage에는 Kafka 또는 호환 시스템이 추가됩니다. 링 KV는 memberlist가 기본이고 캐시는 memcached만 지원합니다. Mimir 3.0에서 Redis 캐시와 experimental read-write 모드가 제거됐으며 query-scheduler는 필수가 됐습니다.

VictoriaMetrics는 외부 의존성이 없습니다. 데이터는 `-storageDataPath`의 로컬 디스크에 저장하고, 오브젝트 스토리지는 vmbackup의 백업 대상으로만 씁니다. 배포 모드도 함께 볼 필요가 있습니다. Cortex 문서는 마이크로서비스를 기본으로, single process를 주로 로컬 테스트와 개발용으로 설명합니다. Mimir는 monolithic과 microservices를 지원합니다. VictoriaMetrics 문서는 초당 100만 데이터 포인트 미만이면 cluster를 고르기 전에 single-node를 고려하라고 권합니다.

### 복제본이 장기 용량에 남는 방식

복제 계수가 같아도 장기 저장 용량은 다르게 남습니다. Cortex와 Mimir는 compactor가 오브젝트 스토리지의 중복 샘플을 합쳐 장기 데이터를 대략 1배로 줄입니다. VictoriaMetrics는 여러 vmstorage에 저장한 사본이 장기 용량에도 그대로 남습니다.

| 항목 | Cortex | Mimir | VictoriaMetrics cluster |
|---|---|---|---|
| 장기 저장 매체 | 오브젝트 스토리지 | 오브젝트 스토리지 | vmstorage 로컬 디스크 |
| 복제 | ingester RF(보통 3), 쿼럼 쓰기 | classic은 RF 3, ingest storage는 Kafka 복제 | vminsert `-replicationFactor=N` |
| 복제의 용량 영향 | compactor가 중복 제거, 대략 1배 | compactor가 중복 제거, 대략 1배 | N배, 조회 시 dedup |
| 다운샘플링 | 없음 | 없음 | Enterprise만 |

RF는 복제 계수입니다. Grafana Labs는 10억 active series(활성 시계열)를 시험하면서 복제로 들어온 30억 시리즈가 compaction 중 10억으로 중복 제거됐다고 밝혔습니다. Mimir ingest storage에서도 compactor가 여러 ingester의 블록을 합치며 중복을 제거합니다.

VictoriaMetrics의 `-replicationFactor=N`은 서로 다른 vmstorage N대에 같은 샘플을 저장합니다. 중복은 vmselect가 조회할 때 제거하므로 `-dedup.minScrapeInterval=1ms` 같은 설정이 필요합니다. 저장 용량은 N배이며 공식 용량 산정에도 복제 계수를 곱합니다. 문서는 노드 추가·제거, 일시 장애, 과부하로 같은 시리즈의 사본이 서로 다른 vmstorage에 떨어지면 dedup을 보장할 수 없다고 설명합니다. 복제를 직접 수행하는 대신 클라우드 영구 디스크처럼 이미 복제된 디스크에 맡기는 방법도 권합니다.

### 디스크 단가와 별도 시스템 비용을 함께 계산한다

Cortex와 Mimir의 비용에는 오브젝트 스토리지 외에 ingester 로컬 디스크, store-gateway의 index-header 디스크, 별도 캐시(memcached)가 포함됩니다. Mimir ingest storage에는 Kafka 클러스터 비용도 붙습니다. VictoriaMetrics는 오브젝트 스토리지와 캐시 클러스터가 없지만, 보존 기간 전체를 담을 vmstorage 디스크에 복제 계수를 곱해야 합니다. VictoriaMetrics 문서는 20% 이상의 여유 디스크를 권하고, 월별 dedup에 직전 달 크기만큼의 임시 공간이 필요하다고 적습니다.

공개 사용자 사례도 같은 결론을 내리지는 않았습니다. InfoQ가 소개한 Prezi는 블록 스토리지와 외부 캐시가 없는 구성을 더 싸고 빠르다고 평가해 VictoriaMetrics를 선택했습니다. 약 500만 active series를 운영하는 loveholidays는 HA용 regional persistent disk가 GCS보다 상당히 비싸고 리소스 차이가 선택을 뒤집을 정도는 아니라고 판단해 Mimir를 골랐다고 알려져 있습니다. loveholidays 사례는 원문에 접근하지 못해 검색 요약으로만 확인했으므로, 비용 판단의 참고 자료로만 볼 수 있습니다.

샘플당 바이트를 비교할 때도 숫자의 성격을 구분해야 합니다. VictoriaMetrics 용량 산정 문서는 압축 후 평균 샘플 하나에 1바이트 안팎이 들며, churn(시계열이 생기거나 사라지는 변화)이 크면 압축이 나빠진다고 설명합니다. Mimir 용량 계획 문서의 compacted block당 샘플 2바이트는 실측 결과가 아닌 산정 가정입니다. Cortex의 용량 가이드는 문서 자체가 낡았다고 표시한 chunks storage 시절 자료여서 현재 blocks storage 계산에 대입할 수 없습니다.

Thanos를 붙이는 방식은 [Prometheus · Thanos · VictoriaMetrics 조립]({{< relref "/observability/metrics/prometheus-thanos/_index.md" >}})에서, 보존 기간에 따른 구성은 [메트릭 장기보관 아키텍처 비교]({{< relref "/observability/metrics/longterm-retention/_index.md" >}})에서 따로 다룹니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| Cortex 쓰기·읽기 경로 | distributor, ingester(메모리+WAL, 2시간 블록 업로드), query-frontend(선택), querier, store-gateway, compactor | Cortex 아키텍처 문서 | `✓` |
| Cortex 저장 방식 | blocks storage만 문서화. chunks storage는 마이그레이션 가이드로만 남음 | Cortex 아키텍처 문서 | `✓` |
| Cortex 링 KV·캐시 | Consul, etcd, memberlist. 캐시는 memcached·redis·in-memory, 다단 가능 | Cortex 아키텍처·querier 문서 | `✓` |
| Cortex HA tracker | 문서는 memberlist 미지원이라 적었으나 v1.21.0 릴리스 노트에 experimental 지원 추가. 문서와 릴리스 노트가 어긋남 | Cortex v1.21.0 릴리스 | `✓` |
| Mimir 두 아키텍처 | 3.0부터 ingest storage와 classic 지원. 문서에 "stable and the preferred way" | Mimir 아키텍처 문서 | `✓` |
| Mimir 기본값 | 바이너리 `-ingest-storage.enabled`는 기본 꺼짐. Helm 차트 6.0은 기본 ingest storage이고 데모용 단일 노드 Kafka를 함께 띄움 | Mimir 3.2.4 flag 도움말, Helm 6.0 릴리스 노트 | `✓` |
| classic 이전 경로 | 새 클러스터를 병행 구성하고 이중 쓰기 뒤 읽기 이전 | Grafana Mimir 3.0 블로그 | `Ⓥ` |
| classic 폐기 계획 | 3.1·3.2 릴리스 노트와 versioning 문서에서 일정을 찾지 못함 | Mimir 릴리스 노트 | `?` |
| ingest storage 쓰기 | Kafka가 복제·영속화를 확인하면 응답. 기본은 시리즈 하나가 파티션 하나. ingester는 파티션 하나 소비 | Mimir ingest storage 문서 | `✓` |
| Mimir 3.0 구성 변경 | query-scheduler 필수, Redis 캐시 제거, read-write 모드 제거 | Mimir CHANGELOG 3.0.0 | `✓` |
| VM 컴포넌트 | vminsert(consistent hashing), vmstorage(stateful), vmselect. `-storageNode` 목록 직접 지정, 자동 발견은 Enterprise | VictoriaMetrics cluster 문서 | `✓` |
| VM 외부 의존성 | 없음. 오브젝트 스토리지는 vmbackup 대상 | VictoriaMetrics cluster 문서 | `✓` |
| single-node 권고 | 초당 100만 데이터 포인트 미만이면 single-node 권장 | VictoriaMetrics cluster 문서 | `✓` |
| VM 최근 변경 | v1.149.0 느린 노드 재라우팅 기본 활성(RF>1이면 자동 비활성). v1.153.0 vmstorage 직접 remote write 수신(기본 꺼짐). v1.154.0은 긴 범위 조회 OOM 위험 공지 | VictoriaMetrics 릴리스 노트 | `✓` |
| Cortex 중복 제거 | compactor가 복제로 여러 블록에 쓰인 샘플을 중복 제거 | Cortex compactor 문서 | `✓` |
| Mimir 중복 제거 규모 | 10억 active series 테스트에서 30억 시리즈가 들어와 compaction 중 10억으로 중복 제거 | Grafana Labs 블로그(2022-04-08) | `Ⓥ` |
| ingest storage 중복 제거 | compactor가 여러 ingester 블록을 합쳐 중복 제거 | Mimir ingest storage 문서 | `✓` |
| VM 복제 비용 | 복제는 CPU·RAM·디스크·네트워크 사용량을 최대 N배. dedup은 vmselect에 `-dedup.minScrapeInterval=1ms` 필요 | VictoriaMetrics cluster 문서 | `✓` |
| VM 용량 산정 | 공식에 Replication Factor가 곱해짐 | VictoriaMetrics 용량 산정 가이드 | `✓` |
| VM dedup 한계 | 노드 추가·제거, 일시 장애, 과부하로 사본이 다른 노드에 떨어지면 dedup 보장 불가 | VictoriaMetrics cluster 문서 | `✓` |
| VM 디스크 여유 | vmstorage에 20% 이상 여유 권장. 월별 dedup이 직전 달 크기만큼 임시 공간 사용 | VictoriaMetrics cluster 문서 | `✓` |
| Prezi 사례 | 블록 스토리지와 외부 캐시 없음을 더 싸고 빠르다고 평가해 VM 선택 | InfoQ Prezi 기사 | `Ⓑ` |
| loveholidays 사례 | 약 500만 active series, regional persistent disk가 GCS보다 상당히 비싸다는 판단으로 Mimir 선택. 원문 403 | loveholidays 기술 블로그(검색 요약) | `?` |
| VM 샘플당 바이트 | "less or around 1 byte after compression" | VictoriaMetrics 용량 산정 가이드 | `✓` |
| Mimir 샘플당 바이트 | compacted block 2바이트 가정. 15초 스크레이프, 1년 보존, 100만 active series당 13GB. 실측 아님 | Mimir 용량 계획 문서 | `✓` |
| Cortex 샘플당 바이트 | 12시간·15초 간격에 약 2KB~10KB 예시를 환산하면 약 0.7~3.5바이트. 문서가 out of date로 표시 | Cortex 용량 계획 문서(구버전) | `≈` |
| 장기 보존 비용 구조 | Cortex·Mimir는 오브젝트 스토리지(1배) + ingester·store-gateway 디스크 + 캐시, VM은 vmstorage 디스크 × 복제 계수 | 위 문서들 종합 | `Σ` |

{{% /details %}}

## 3. 여러 팀을 받기 위한 경계

테넌트를 구분해 저장하는 것과 테넌트마다 사용량을 제한하는 것은 별개입니다. 여러 팀에 수집률·시리즈 수·쿼리 한도를 따로 적용해야 한다면 Cortex와 Mimir가 맞습니다. VictoriaMetrics OSS는 테넌트 식별을 지원하지만, 테넌트별 수집·시리즈 한도는 제공하지 않습니다.

| 항목 | Cortex | Mimir | VictoriaMetrics cluster |
|---|---|---|---|
| 테넌트 식별 | `X-Scope-OrgID` 헤더 | `X-Scope-OrgID` 헤더 | URL 경로 accountID, 헤더 방식 병행 |
| 테넌트별 limit | 런타임 overrides, 1.21부터 Overrides API | 런타임 overrides | OSS에는 없음 |
| shuffle sharding | 지원, 기본 꺼짐 | 지원, 기본 꺼짐 | 개념 없음 |
| tenant 간 쿼리 | tenant federation | tenant federation | 확인 못 함 |

Cortex와 Mimir는 `X-Scope-OrgID` 헤더로 테넌트를 식별합니다. 인증 기능은 없으므로 앞단 프록시가 필요합니다. VictoriaMetrics는 URL 경로의 `accountID[:projectID]`를 사용하며 값은 32비트 정수입니다. 헤더 방식은 v1.143.0부터 지원하고, `-enableMultitenancyViaHeaders`는 v1.150.0부터 기본 true입니다.

VictoriaMetrics도 인증을 직접 맡지 않습니다. 앞단에 vmauth(OSS)나 vmgateway(Enterprise)를 두며, cluster 문서는 tenant 이름·토큰·limit·과금 정보를 별도 관계형 DB에 저장해 앞단 서비스가 관리하라고 안내합니다.

사용량을 제한하는 단위에서는 차이가 더 커집니다. Cortex와 Mimir는 런타임 overrides로 테넌트별 수집률, 시리즈 수, 쿼리 한도를 정합니다. shuffle sharding은 테넌트가 사용할 ingester와 store-gateway 등의 집합을 제한해 한 테넌트의 문제가 퍼지는 범위를 줄이는 방식입니다. 두 제품 모두 이를 지원하며 기본값은 꺼짐입니다.

VictoriaMetrics의 `-storage.maxHourlySeries`와 `-storage.maxDailySeries`는 vmstorage 노드별로 모든 테넌트를 합산한 카디널리티(시계열 수)를 제한합니다. 테넌트별 시리즈 한도가 아닙니다. 테넌트별 속도 제한은 vmgateway(Enterprise)가 맡습니다. 모든 테넌트의 데이터가 vmstorage 전체에 고르게 퍼지므로 shuffle sharding 같은 격리 수단도 없습니다. VictoriaMetrics 문서는 성능과 자원 사용이 테넌트 수보다 전체 active series에 좌우된다고 설명합니다.

Mimir는 연결할 때 기본 한도부터 확인해야 합니다. `-distributor.ingestion-rate-limit`은 기본 초당 10,000 샘플이고, `-ingester.max-global-series-per-user`는 복제 전 150,000 시리즈입니다. 기본값이 작아 그대로 붙이면 limit 오류를 만나게 됩니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| Cortex·Mimir 식별과 인증 | `X-Scope-OrgID`, 인증 없음. Cortex는 `-auth.enabled=false`면 tenant `fake` | Cortex auth 문서, Mimir 문서 | `✓` |
| VM 식별 | URL 경로 `accountID[:projectID]`. 헤더 방식 v1.143.0부터, `-enableMultitenancyViaHeaders` v1.150.0부터 기본 true | VictoriaMetrics cluster 문서, 릴리스 노트 | `✓` |
| VM 앞단 | vmauth(OSS), vmgateway(Enterprise). tenant 정보는 별도 관계형 DB에 두라고 문서가 안내 | VictoriaMetrics cluster 문서 | `✓` |
| VM tenant limit | OSS에는 tenant별 수집·시리즈 limit 없음. 노드 단위 합산 limit만. tenant별 속도 제한은 vmgateway(Enterprise) | VictoriaMetrics cluster·Enterprise 문서 | `✓` |
| VM 카디널리티 제한 | `-storage.maxHourlySeries`, `-storage.maxDailySeries`는 vmstorage 노드 단위, 모든 tenant 합산 | VictoriaMetrics cluster 문서 | `✓` |
| Cortex·Mimir limit | 런타임 overrides. Cortex 1.21 Overrides API. Mimir 3.1은 헤더 메타데이터 기반 부분 limit | Cortex v1.21.0 릴리스, Mimir 3.1 릴리스 | `✓` |
| shuffle sharding | Cortex·Mimir 모두 기본 꺼짐. Mimir는 쓰기 경로에서 켜면 읽기 경로도 자동 적용 | Cortex·Mimir shuffle sharding 문서 | `✓` |
| VM 성능과 tenant | "성능과 자원 사용은 tenant 수가 아니라 전체 active series에 좌우" | VictoriaMetrics cluster 문서 | `✓` |
| tenant 간 쿼리 | Cortex tenant federation(1.21 partial response experimental), Mimir federation 헤더. VM의 tenant 간 쿼리는 세부 문서를 읽지 못함 | Cortex 릴리스, Mimir 3.2.4 flag 도움말 | `?` |
| Mimir 기본 limit | `-distributor.ingestion-rate-limit` 기본 10000 samples/s, `-ingester.max-global-series-per-user` 기본 150000(복제 전) | Mimir 3.2.4 flag 도움말 | `✓` |

{{% /details %}}

## 4. 메모리 차이는 현재 워크로드로 확인해야 한다

공식 용량 문서만으로 같은 active series를 받는 데 필요한 RAM을 나란히 계산하기는 어렵습니다. Mimir에는 ingester 산정 기준이 있지만 classic과 ingest storage를 구분하지 않습니다. Cortex의 수치는 구버전 저장 방식 기준이고, VictoriaMetrics의 현재 문서에는 active series당 RAM 공식 수치가 없습니다.

Mimir 용량 계획 문서는 메모리 내 시리즈 30만 개당 CPU 1코어, 메모리 2.5GB, 디스크 5GB를 잡습니다. 메모리 내 시리즈는 active series에 복제 계수인 기본 3을 곱한 값입니다. Kafka 용량 산정은 포함하지 않습니다. Cortex 문서의 ingester 시리즈 100만 개당 RAM 15GB는 문서 자체가 낡았다고 표시한 chunks storage 시절 수치입니다.

VictoriaMetrics FAQ는 vmstorage가 active series를 내부 ID로 매핑하는 캐시를 메모리에 두며, 이 캐시가 부족하면 성능이 급락한다고 설명합니다. cluster 문서는 메모리 사용량이 워크로드에 크게 좌우된다고 적고 여유 RAM 50%를 권합니다. 따라서 시리즈 수만 같은 환경이라도 공식 문서의 숫자를 단순 환산해 제품별 순위를 만들기는 어렵습니다. 과거에 알려진 RAM 경험칙은 현재 문서에서 확인하지 못했습니다.

그렇다면 공개 벤치마크로 차이를 판단할 수 있을까요? 가장 많이 인용되는 비교는 VictoriaMetrics 팀이 2022-09-09에 발표한 시험입니다. GKE e2-standard-16에서 Mimir 2.2.0(RF 3)과 VictoriaMetrics 1.80.0(RF 2)을 약 550만 active series, 초당 36만 샘플로 24시간 실행했습니다. VictoriaMetrics 팀은 자사 제품의 평균 CPU 사용량이 약 1.7배, RAM 사용량이 약 5배 적었다고 보고했습니다. 디스크는 VictoriaMetrics 49GiB, Mimir는 로컬 369GiB와 오브젝트 스토리지 149.7GiB였습니다. instant 쿼리 p99는 Mimir 약 47초, VictoriaMetrics 약 20초였으며, 약 5배 부하의 후속 시험에서는 Mimir ingester가 OOM으로 종료됐습니다.

이 결과는 시험 조건 안에서만 읽어야 합니다. 측정자인 VictoriaMetrics 팀은 24시간 시험이라 Mimir compaction이 끝나지 않았을 수 있고, 복제 계수와 active series 계산법이 다르며, range 쿼리를 측정하지 않았다고 밝혔습니다. Mimir에 익숙하지 않아 리소스도 수동으로 조정했습니다. 무엇보다 Mimir 2.2는 MQE와 ingest storage 도입 전 버전입니다. 이 결과를 현행 Mimir보다 RAM을 5배 적게 쓴다는 뜻으로 옮길 수는 없습니다.

Grafana Labs의 공개 시험은 다른 질문에 답합니다. 단일 테넌트 10억 active series를 약 1500 레플리카, 7000 CPU 코어, 30TiB RAM으로 운영한 규모 시험입니다. Mimir 3.0 발표에서는 대형 내부 클러스터의 리소스가 최대 15% 줄었고 MQE가 쿼리 최대 메모리를 최대 92% 줄였다고 주장했습니다. 모두 Grafana Labs 자체 발표이며 제품 간 동등 조건 비교는 아닙니다.

사용자 측정도 적용 범위를 구분해야 합니다. Criteo는 2020년 가을 무렵 비교에서 VictoriaMetrics의 응답이 빠르고 tail latency가 안정적이며 Cortex는 튜닝이 많이 필요했다고 보고했습니다. 비교 대상은 chunks storage 시절 Cortex였습니다. InfoQ가 소개한 Prezi의 PoC에서는 Prometheus에서 VictoriaMetrics로 옮겨 저장 70%, 메모리 60%, CPU 30% 감소를 얻었지만, Cortex나 Mimir와 비교한 결과는 아닙니다.

현행 버전(Mimir 3.x, Cortex 1.2x, VictoriaMetrics 1.15x)을 같은 조건에서 잰 중립적인 제3자 공개 벤치마크는 찾지 못했습니다. 공개 수치는 후보를 좁히는 데 쓰고, 최종 용량은 자기 데이터로 재는 편이 낫습니다. VictoriaMetrics가 공개한 `prometheus-benchmark`는 Cortex와 Mimir도 비교 대상으로 지원합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| Mimir ingester 산정 | 메모리 내 시리즈 30만 개당 CPU 1코어, 메모리 2.5GB, 디스크 5GB. 메모리 내 시리즈 = active series × RF(기본 3). classic·ingest storage 구분 없음 | Mimir 용량 계획 문서 | `✓` |
| Cortex ingester 산정 | "Each million series in an ingester takes 15GB of RAM". 문서가 out of date로 표시 | Cortex 용량 계획 문서(구버전) | `✓` |
| VM 메모리 | 현재 문서에 active series당 RAM 수치 없음. series ID 캐시 부족 시 성능 급락, 여유 RAM 50% 권장 | VictoriaMetrics FAQ, cluster 문서 | `✓` |
| VM 과거 경험칙 | "RAM = 2 × active series × 1KB"는 과거 커밋 미러 기록뿐, 현재 문서에서 확인 못 함 | 미러 기록 | `?` |
| VM 측 Mimir 비교 | GKE e2-standard-16, Mimir 2.2.0(RF 3) vs VM 1.80.0(RF 2), node_exporter 6000타깃, 15초, 약 550만 active series, 36만 samples/s, 10분마다 타깃 1% churn, 24시간 | VictoriaMetrics 블로그(2022-09-09) | `Ⓑ` |
| 위 벤치마크 결과 | 할당 Mimir 43.2 CPU/283GiB, VM 44 CPU/208GiB. 평균 CPU 약 1.7배, RAM 약 5배 차이. 디스크 VM 49GiB vs Mimir 369GiB+149.7GiB. instant p99 약 47초 vs 약 20초. 5배 부하에서 Mimir ingester OOM | VictoriaMetrics 블로그(2022-09-09) | `Ⓑ` |
| 위 벤치마크 한계 | 저자 명시: 24시간이라 compaction 미완 가능, active series 계산법 상이, range 쿼리 미측정, 저자가 Mimir에 익숙지 않음, 복제 계수 상이. Mimir 2.2 기준이라 MQE·ingest storage 이전 | 같은 글 | `Ⓑ` |
| Grafana 10억 series 시험 | 단일 tenant 10억 active series, 약 1500 레플리카·7000 CPU 코어·30TiB RAM, 20초 기준 약 5000만 samples/s 추정. SLO는 쓰기 요청 99.9%가 10초 미만 | Grafana Labs 블로그(2022-04-08) | `Ⓥ` |
| Mimir 3.0 자체 주장 | 대형 내부 클러스터 리소스 최대 15% 감소, MQE로 쿼리 최대 메모리 최대 92% 감소 | Grafana Mimir 3.0 블로그 | `Ⓥ` |
| Criteo 비교 | 2020년 가을 무렵, chunks 시절 Cortex 대비 VM 응답이 빠르고 tail latency 안정 | Criteo 엔지니어링 블로그 | `Ⓑ` |
| Prezi PoC | Prometheus(약 500만 series)에서 VM으로 저장 70%, 메모리 60%, CPU 30% 감소. Cortex·Mimir와의 비교 아님 | InfoQ Prezi 기사 | `Ⓑ` |
| 현행 버전 중립 벤치마크 | 찾지 못함. VM이 `prometheus-benchmark` 도구를 공개(Cortex·Mimir·Thanos 대상 지원) | VictoriaMetrics GitHub | `?` |
| 벤치마크 해석 | 공개 수치로 후보를 좁히고 자기 데이터로 재는 것이 낫다는 판단 | 위 항목 종합 | `Σ` |

{{% /details %}}

## 5. 대시보드와 수집 기능을 이어 가는 조건

기존 Grafana 대시보드의 값이 그대로 나와야 한다면 Cortex와 Mimir가 가까운 선택입니다. VictoriaMetrics의 MetricsQL에는 PromQL과 의도적으로 다른 계산 규칙이 있습니다. 쿼리가 실행된다는 사실만으로 결과도 같다고 기대해서는 안 됩니다.

Cortex의 기본 엔진은 Prometheus PromQL 엔진입니다. Thanos PromQL 엔진은 experimental이며, 1.21에서 query-frontend의 논리 플랜 분할을 이용한 분산 실행과 projection pushdown이 추가됐습니다. Mimir는 3.0부터 자체 엔진 MQE(Mimir Query Engine)를 querier와 query-frontend의 기본으로 사용합니다. `-querier.query-engine=prometheus`로 되돌릴 수 있습니다.

Grafana는 MQE가 PromQL과 100% 호환된다고 주장합니다. 관련 flag는 도움말과 versioning 문서에서 아직 experimental로 분류됩니다. Mimir 3.2는 remote execution이 기본 활성화되므로 업그레이드 전에 모든 querier가 3.1이어야 합니다.

MetricsQL 문서는 PromQL과 하위 호환된다고 설명하면서 계산 차이도 명시합니다. `rate`와 `increase`는 외삽하지 않고 창 직전의 마지막 원시 샘플까지 계산에 포함합니다. 그래서 느린 정수 카운터의 `increase()` 결과가 정수로 나옵니다. 창을 생략하면 step과 스크레이프 간격 중 큰 값을 사용하며, 결과에서 NaN을 제거하고 scalar를 label 없는 instant vector처럼 취급합니다. `offset` 위치와 WITH 템플릿 같은 확장도 있습니다. 이런 차이 때문에 같은 PromQL을 쓴 대시보드라도 옮긴 뒤 값이 미세하게 달라질 수 있습니다.

### 같은 쿼리를 실행하는 방식도 다르다

Cortex query-frontend는 `split_queries_by_interval`로 시간 구간을 나누고 `query_vertical_shard_size`로 vertical sharding을 수행합니다. 동적 분할은 2025년에 소개됐습니다. 결과·인덱스·청크·메타데이터 캐시는 memcached, redis, in-memory를 사용할 수 있습니다.

Mimir는 3.2부터 query sharding이 기본 활성화됩니다. 기본 16개 shard로 나누며 최대 128개 부분 쿼리를 만들고, split-by-interval은 기본 24시간입니다. 공식 query sharding 문서 본문에는 아직 opt-in이라고 적혀 있어 flag 기본값과 일치하지 않습니다.

VictoriaMetrics에는 query-frontend 같은 분할·샤딩 계층이 없습니다. vmselect가 모든 vmstorage에서 데이터를 받아 계산하고 rollup 결과 캐시도 보관합니다. 쿼리 자원은 `-search.maxMemoryPerQuery`, `-search.maxQueryDuration`, `-search.maxConcurrentRequests` 등으로 제한합니다.

### Prometheus의 새 데이터 형식을 받는 범위

쿼리 호환과 별도로 Remote Write 2.0과 native histogram의 지원 범위도 봐야 합니다. Remote Write 2.0 스펙은 release candidate(2.0-rc.6)이며 experimental입니다. Cortex는 1.20에서 수신을 experimental로 추가했고 1.21에서 데이터 손상과 panic을 수정했습니다. Mimir는 2.17부터 experimental로 지원합니다. VictoriaMetrics 문서는 스펙이 experimental이어서 현재 지원하지 않는다고 설명합니다.

Native histogram은 Prometheus 3.8.0에서 stable이 됐지만 스크레이프와 remote write 전송은 각각 opt-in입니다. Mimir는 2.16부터 수신이 기본 활성화됐으나 3.2.4 flag 도움말에는 experimental 표시가 남아 있습니다. Cortex는 1.22(rc)에서 수신 기능이 experimental을 벗어납니다.

VictoriaMetrics는 v1.143.0부터 수신한 native histogram을 VictoriaMetrics histogram 형식인 `vmrange` 라벨로 변환해 저장합니다. 따라서 native histogram을 받는다는 설명에는 변환 저장이라는 조건이 함께 붙어야 합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| Cortex 엔진 | 기본 Prometheus PromQL 엔진. Thanos 엔진은 experimental(`-querier.thanos-engine`). 1.21에서 논리 플랜 분할·projection pushdown 추가 | Cortex v1guarantees·querier 문서, v1.21.0 릴리스 | `✓` |
| Mimir MQE | 3.0부터 querier·query-frontend 기본. `-querier.query-engine=prometheus`로 복귀. 관련 flag는 도움말에서 experimental 표시 | Mimir 3.0 릴리스 노트, help-all, versioning 문서 | `✓` |
| MQE 호환 주장 | "100% PromQL compatible" | Grafana Labs 주장 | `Ⓥ` |
| Mimir 3.2 업그레이드 | remote execution 기본 활성화, 업그레이드 전 모든 querier가 3.1이어야 함 | Mimir 3.2 릴리스 노트 | `✓` |
| MetricsQL 차이 | rate·increase 외삽 없음, 직전 샘플 포함, 창 생략 시 step과 스크레이프 간격 중 큰 값, NaN 제거, scalar 처리, `offset`·WITH 확장 | VictoriaMetrics MetricsQL 문서 | `✓` |
| 값이 달라질 가능성 | 위 차이에서 이끌어 낸 실무상 영향. 대시보드별 실측은 아님 | MetricsQL 문서 | `≈` |
| Cortex 분할·캐시 | 시간 분할, vertical sharding, 동적 분할(2025), memcached·redis·in-memory 캐시 | Cortex 블로그(2025-08-12), querier 문서 | `✓` |
| Mimir query sharding | 3.2부터 `-query-frontend.parallelize-shardable-queries` 기본 true, 16 shard, 최대 128 부분 쿼리, split 24시간. 공식 문서 본문은 아직 opt-in | Mimir 3.2 릴리스, 3.2.4 flag 도움말, query-sharding 문서 | `✓` |
| VM 쿼리 경로 | 분할·샤딩 계층 없음, vmselect의 rollup 결과 캐시, `-search.*` limit | VictoriaMetrics cluster 문서, FAQ | `✓` |
| Remote Write 2.0 스펙 | release candidate(2.0-rc.6), experimental | Prometheus 스펙 문서 | `✓` |
| RW 2.0 지원 | Cortex 1.20 수신 experimental(`-distributor.remote-writev2-enabled`), 1.21 수정. Mimir 2.17 experimental, 3.0에서도 experimental. VM은 "not currently supported" | Cortex·Mimir 릴리스, VictoriaMetrics Prometheus 연동 문서 | `✓` |
| Native histogram | Prometheus 3.8.0 stable, 스크레이프 `scrape_native_histograms`와 전송 `send_native_histograms` 각각 opt-in(v4에서 기본 true 예정) | Prometheus 스펙 문서 | `✓` |
| Mimir·Cortex native histogram | Mimir 2.16부터 수신 기본 true이나 3.2.4 도움말에 experimental 표시 잔존. Cortex 1.20 tenant별 limit 제어, 1.21 NHCB 수신, 1.22(rc)에서 experimental 졸업 | Mimir·Cortex 릴리스 노트, CHANGELOG | `✓` |
| VM native histogram | v1.143.0부터 수신 시 VM histogram(`vmrange`)으로 변환. 문서의 다른 문장은 `_count`/`_sum`/`_bucket` 고전 히스토그램으로 바뀐다고 적어 설명이 섞임 | VictoriaMetrics Prometheus 연동 문서 | `✓` |
| UTF-8 메트릭 이름 | Cortex 1.20, Mimir 3.0 지원. VM은 확인 못 함 | Cortex·Mimir 릴리스 노트 | `?` |

{{% /details %}}

## 6. 증설과 장애를 함께 견디는 구성

컴포넌트 수가 적다고 장애나 재시작 때 필요한 여유 용량까지 작아지지는 않습니다. VictoriaMetrics는 노드를 추가하는 절차가 단순하지만, 기존 데이터가 자동으로 새 노드에 옮겨지지 않습니다. Cortex와 Mimir는 링이나 파티션의 소유권을 관리하며, 여러 가용 영역을 사용하는 운영 방식도 다릅니다.

VictoriaMetrics에 vmstorage를 추가하면 새 데이터부터 새 노드 집합에 분산됩니다. 같은 `-retentionPeriod`로 vmstorage를 실행하고 vmselect와 vminsert를 재시작하는 절차입니다. OSS는 노드 목록을 flag로 지정하므로 재시작이 필요합니다. 노드를 제거할 때는 vminsert 목록에서 먼저 빼고, vmselect에는 보존 기간이 끝날 때까지 남기거나 vmctl로 데이터를 옮깁니다.

Cortex와 Mimir classic은 해시 링 토큰에 따라 시리즈 소유권이 바뀝니다. 변경 대상은 ingester 메모리의 최근 데이터이며, 장기 데이터는 오브젝트 스토리지에 남습니다. store-gateway는 링에 맞춰 블록 샤딩을 다시 정합니다. Mimir ingest storage는 ingester가 파티션 하나를 소비하므로 확장도 파티션 수 조정과 연결됩니다. 세부 절차는 확인하지 못했습니다.

### 가용 영역을 묶는 방식

하나의 클러스터를 여러 AZ(가용 영역)에 걸쳐 복제하고 싶다면 Cortex와 Mimir가 맞습니다. VictoriaMetrics 문서는 AZ마다 독립 클러스터를 두고 vmagent가 복제와 샤딩을 맡는 구성을 권합니다. AZ 장애가 나면 vmagent가 디스크에 버퍼링합니다.

InfoQ가 소개한 Prezi도 처음에는 여러 AZ에 걸친 클러스터를 사용했습니다. 이후 AZ 간 트래픽 비용 때문에 AZ별 single-node 두 대와 장기 보존용 한 대로 구성을 바꿨습니다.

Mimir classic은 RF 3일 때 최소 3개 존이 필요하며, `floor(RF/2)+1`개 존이 살아 있어야 동작합니다. ingest storage는 명시적 RF 없이 Kafka가 파티션을 복제합니다. 같은 파티션을 소비하는 ingester를 존마다 하나씩 두므로 보통 파티션당 2개, RF 2에 해당하는 구성이 됩니다. 롤링 업데이트는 한 번에 한 존만 진행하며 Kubernetes rollout-operator가 이를 강제합니다. Helm 6.0부터는 webhook이 기본 활성화돼 업그레이드 전에 CRD를 설치해야 합니다. Cortex도 zone-aware replication을 지원하고 shuffle sharding으로 존별 균형을 맞춥니다.

### 재시작할 때 필요한 여유

VictoriaMetrics의 롤링 재시작 순서는 vmstorage, vminsert, vmselect입니다. 무중단 운영에는 컴포넌트별 최소 2대와 여유 용량이 필요합니다. vmstorage가 재시작하는 동안 남은 노드로 재라우팅이 몰리면 CPU·RAM·디스크 I/O가 증가하므로 `-disableReroutingOnUnavailable` 같은 설정을 사용합니다.

노드 수가 적을수록 한 대의 장애가 남은 노드에 주는 부담이 큽니다. 3대 구성에서 1대가 멈추면 남은 노드는 50%씩 더 맡고, 10대 구성에서는 약 11%씩 더 맡습니다. VictoriaMetrics 문서는 이 때문에 최소 10대를 권합니다.

Cortex의 구버전 용량 문서는 ingester가 WAL을 재생할 때 메모리가 일시적으로 늘어날 수 있으므로 사용률이 높아지기 전에 확장하라고 경고합니다. 1.21에서는 bucket index가 기본 활성화됐습니다. Mimir는 앞서 본 3.2의 3.1 경유 조건 외에도 3.1에서 `-target=flusher`가 제거됐고, 업로드 블록에 index v2가 필수가 됐습니다.

운영 부담은 현재 구성에 맞는 문서 문구로 따져야 합니다. VictoriaMetrics 문서는 single-node가 cluster보다 설정과 운영이 쉽다고 적습니다. Mimir ingest storage에는 Kafka 운영이 추가되며, Mimir 3.0은 query-scheduler 필수화와 Redis 캐시·read-write 모드 제거로 구성 선택지를 줄였습니다.

VictoriaMetrics FAQ에는 Cortex가 Consul, Memcache, DynamoDB, BigTable, Cassandra에 크게 의존하고 ingester 장애로 최대 12시간 데이터를 잃을 수 있다는 비교 문구가 있습니다. 이 설명은 chunks storage 시절 링크에 근거하므로 현재 blocks storage와 WAL을 쓰는 Cortex의 특성으로 인용할 수 없습니다.

VTEX가 Cortex 자체 운영에서 AMP로 이전했다는 사례는 검색 요약으로만 확인했으며 원문은 읽지 못했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| VM 노드 추가·제거 | 과거 데이터 이동 없음. 추가는 vmstorage 기동, vmselect·vminsert 재시작. 제거는 vminsert에서 먼저 제외, vmctl로 이동 가능 | VictoriaMetrics cluster 문서 | `✓` |
| Cortex·Mimir 링 변경 | 토큰으로 시리즈 소유권 변경, ingester 메모리 데이터에 한정. Mimir는 classic `/ingester/prepare-instance-ring-downscale`, ingest storage `/ingester/prepare-partition-downscale` | Mimir CHANGELOG(#16469) | `✓` |
| ingest storage 확장 절차 | 파티션 수 조정과 묶임. 세부 절차는 조사하지 못함 | Mimir 문서 | `?` |
| VM AZ 권고 | 하나의 클러스터를 여러 AZ에 걸치지 말 것. AZ별 독립 클러스터 + vmagent 복제·샤딩, 장애 시 디스크 버퍼 | VictoriaMetrics cluster 문서 | `✓` |
| Prezi AZ 전환 | 다중 AZ 클러스터에서 AZ 간 트래픽 비용 때문에 AZ별 single-node 두 대 + 장기 보존용 한 대로 변경 | InfoQ Prezi 기사 | `Ⓑ` |
| Mimir zone-aware | classic RF 3이면 최소 3존, `floor(RF/2)+1`존 생존 필요. ingest storage는 파티션당 보통 2 ingester. 존 단위 롤링, rollout-operator 강제. Helm 6.0 webhook 기본 활성, CRD 선설치 | Mimir zone-aware 문서, Helm 6.0 릴리스 노트 | `✓` |
| Mimir 3.1 라우팅 | experimental zone-aware memberlist 라우팅(교차 AZ 비용 절감 목적) | Mimir 3.1 릴리스 노트 | `✓` |
| Cortex zone-aware | zone-aware replication 지원, shuffle sharding이 존별 균형 보장 | Cortex shuffle-sharding 문서 | `✓` |
| VM 롤링 재시작 | vmstorage, vminsert, vmselect 순 SIGINT. 컴포넌트별 최소 2대. 3대 구성 1대 장애 시 50%, 10대 약 11%, 최소 10대 권장 | VictoriaMetrics cluster 문서 | `✓` |
| Mimir 업그레이드 | 3.2는 3.1 경유 필수(remote execution), 3.1에서 `-target=flusher` 제거, 업로드 블록 index v2 필수 | Mimir 3.1·3.2 릴리스 노트 | `✓` |
| Cortex 업그레이드 | WAL 재생 시 메모리 일시 증가 경고(구버전 용량 문서). 1.21에서 bucket index 기본 활성화 | Cortex 용량 문서, v1.21.0 릴리스 | `✓` |
| 운영 난이도 근거 | single-node가 cluster보다 쉽다는 문서 문구, Kafka 운영 추가, Mimir 3.0 구성 선택지 축소 | VictoriaMetrics·Mimir 문서 | `✓` |
| VM FAQ의 Cortex 비판 | chunks storage 시절 링크에 기댄 문구라 현재 Cortex(blocks+WAL)와 맞지 않음. 인용 불가 | VictoriaMetrics FAQ | `✓` |
| VTEX 사례 | Cortex 자체 운영에서 AMP로 이전했다는 검색 요약만 확인, 원문 미열람 | 검색 결과 요약 | `?` |

{{% /details %}}

## 7. OSS와 Enterprise 사이의 선택

VictoriaMetrics의 구성이 요구에 맞더라도 필요한 기능이 OSS에 포함되는지는 따로 확인해야 합니다. 다운샘플링, 다중 보존기간, 내부 통신 암호화, 테넌트별 속도 제한, LTS가 필요하면 Enterprise 계약이 전제입니다.

다운샘플링은 오래된 샘플의 간격을 늘려 남기는 기능입니다. 비교 대상 가운데 VictoriaMetrics Enterprise만 제공합니다. `-downsampling.period=offset:interval` 형식으로 여러 단계와 tenant별 설정을 할 수 있으며, 다중 보존기간도 Enterprise 기능입니다. VictoriaMetrics 문서는 구간의 마지막 샘플을 남기는 방식이므로 gauge와 summary에서 구간 내 변화를 일부 잃는다고 설명합니다.

Cortex는 다운샘플링이 로드맵 항목으로만 남아 있습니다. Mimir는 웨비나 Q&A에서 현재 제공하지 않는다고 답했습니다. Grafana는 PromQL 정확도를 유지하려면 여러 해상도를 보관해야 하므로 다운샘플링을 제공해도 오브젝트 스토리지 사용량이 꼭 줄지는 않는다고 설명했습니다.

내부 통신 요구도 선택을 바꿉니다. VictoriaMetrics OSS에서 vminsert와 vmselect가 vmstorage에 보내는 통신은 평문입니다. 암호화는 Enterprise 기능이며, cluster 문서는 컴포넌트를 보호된 사설망에 배치하라고 안내합니다.

VictoriaMetrics Enterprise에는 이 밖에도 vmstorage 자동 발견, 고급 tenant 통계, 쿼리 실행 통계, vmgateway, mTLS, Kafka·Google PubSub 연동, vmalert 멀티테넌트, vmbackupmanager, FIPS 빌드가 포함됩니다. 앞서 본 다운샘플링과 다중 보존기간을 포함해, 필요한 기능이 이 범위에 들어가면 OSS만으로 구성한다는 전제를 바꿔야 합니다.

LTS(장기 지원 릴리스)도 같은 조건입니다. VictoriaMetrics의 v1.148.x와 v1.136.x LTS 릴리스는 Enterprise 전용입니다. 공식 문서는 OSS 사용자에게 최신 릴리스로 올리라고 안내하므로, OSS를 선택하면서 LTS 사용을 전제로 운영 계획을 세울 수는 없습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| VM 다운샘플링 | `-downsampling.period`, 다단계, tenant별. 마지막 샘플 유지라 gauge·summary 일부 손실. 다중 보존기간(`-retentionFilter`)도 Enterprise | VictoriaMetrics Enterprise 문서 | `✓` |
| Cortex 다운샘플링 | 로드맵 항목뿐. thanosconvert가 Thanos 다운샘플 블록을 건너뜀 | Cortex roadmap, 마이그레이션 문서 | `✓` |
| Mimir 다운샘플링 | 웨비나 Q&A에서 미제공이라 답변. 2022년 잔여 코드 제거 PR #3024, 2023년 제안 PR #5028은 open | Grafana 커뮤니티 Q&A, Mimir PR | `Ⓥ` |
| VM Enterprise 전용 | 다운샘플링, 다중 보존기간, vmstorage 자동 발견, 고급 tenant·쿼리 통계, vmgateway, mTLS, Kafka·PubSub 연동, vmalert 멀티테넌트, vmbackupmanager, FIPS, LTS | VictoriaMetrics Enterprise 문서 | `✓` |
| VM 내부 통신 | OSS는 평문, 암호화는 Enterprise. 보호된 사설망 권고 | VictoriaMetrics cluster·Enterprise 문서 | `✓` |
| LTS 범위 | 문서 원문은 "LTS releases are published only for Enterprise versions" | VictoriaMetrics LTS 문서 | `✓` |

{{% /details %}}

## 8. 오래 쓸 프로젝트를 판단하는 근거

Apache-2.0과 재단 거버넌스를 함께 요구한다면 Cortex가 맞습니다. VictoriaMetrics OSS도 Apache-2.0이지만 VictoriaMetrics Inc. 단독 프로젝트입니다. Mimir는 Grafana Labs 단독 프로젝트이며 AGPL-3.0을 사용합니다. VictoriaMetrics Enterprise는 상용 라이선스입니다.

Cortex는 CNCF Incubating 프로젝트로, 2018-09-20 Sandbox에 수락됐고 2020-08-20 Incubating 단계가 됐습니다. Mimir와 VictoriaMetrics에는 재단이 없습니다. Mimir를 수정하거나 서비스로 제공하는 경우에는 AGPLv3에 따른 법무 검토가 필요할 수 있습니다.

| 항목 | Cortex | Mimir | VictoriaMetrics |
|---|---|---|---|
| 라이선스 | Apache-2.0 | AGPL-3.0 | Apache-2.0(OSS) |
| 거버넌스 | CNCF Incubating | Grafana Labs 단독 | VictoriaMetrics Inc. 단독 |
| 최근 1년 커밋 | 462 | 2,648 | 1,546 |
| 최근 1년 병합 PR | 453 | 2,815 | 882 |
| 최근 1년 고유 작성자 | 44 | 137 | 104 |
| GitHub stars | 5,877 | 5,270 | 17,990 |

활동량은 거버넌스와 다른 질문에 답합니다. 2026-11-01에 집계한 52주 수치에서 Cortex의 커밋은 462개로 Mimir의 약 1/6, VictoriaMetrics의 약 1/3입니다. 개발 속도와 기여자 수를 중시한다면 이 차이가 선택에 영향을 줍니다.

Cortex가 유지보수를 멈춘 것은 아닙니다. 2026년에 v1.21.0과 v1.21.1이 나왔고 1.22는 rc가 진행 중입니다. AWS·Apple·KakaoEnterprise 메인테이너가 Parquet 저장과 Remote Write 2.0 같은 기능을 추가하고 있습니다. VictoriaMetrics의 병합 PR 수가 커밋보다 적은 것은 직접 push 비중 때문으로 보이므로, PR 수만으로 개발 활동을 비교하면 왜곡될 수 있습니다.

릴리스 주기에도 차이가 있습니다. 최근 1년 Cortex 릴리스는 v1.20.0, v1.20.1, v1.21.0, v1.21.1 네 개입니다. Mimir는 3.0.1부터 3.2.4까지 패치가 많고 마이너는 3.1.0과 3.2.0입니다. VictoriaMetrics는 약 2주 간격으로 마이너 27개(v1.129~v1.155)를 내고 LTS 패치도 제공합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| 라이선스 | Cortex Apache-2.0, Mimir AGPL-3.0, VM OSS Apache-2.0(Enterprise는 상용) | 각 프로젝트 저장소 | `✓` |
| Cortex 거버넌스 | CNCF Incubating(2018-09-20 Sandbox, 2020-08-20 Incubating) | CNCF 프로젝트 페이지 | `✓` |
| 52주 활동량 | 커밋 462/2,648/1,546, 병합 PR 453/2,815/882, 고유 작성자(봇 제외) 44/137/104, stars 5,877/5,270/17,990. 2026-11-01 집계 | `gh api` 집계 | `≈` |
| 활동량 해석 | VM은 직접 push 비중 때문에 PR 수가 커밋보다 적어 보임. PR 수만의 비교는 왜곡 | 집계 결과의 해석 | `≈` |
| 최근 1년 릴리스 | Cortex 4개(1.22는 rc), Mimir 3.0.1~3.2.4 패치와 마이너 3.1.0·3.2.0, VM 마이너 27개(v1.129~v1.155) | 각 릴리스 페이지 | `≈` |
| Cortex 유지 주체 | 메인테이너 6명(AWS 3, Apple 2, KakaoEnterprise 1). 1.20에 Parquet 변환 experimental | Cortex MAINTAINERS, 릴리스 노트 | `✓` |

{{% /details %}}

## 9. 포기하기 어려운 조건부터 후보를 좁힌다

선택은 가장 많은 항목에서 앞서는 제품을 찾는 방식보다, 포기하기 어려운 조건을 정하는 방식이 적합합니다. 이 글의 판단으로는 조건이 겹칠 때 가장 비용이 큰 조건부터 따지는 편이 낫습니다.

| 조건 | 맞는 쪽 | 이유 |
|---|---|---|
| Apache-2.0과 재단 거버넌스가 필요하다 | Cortex | CNCF Incubating, Apache-2.0. VictoriaMetrics OSS도 Apache-2.0이나 재단은 없음 |
| AGPL을 받아들이기 어렵다 | Cortex 또는 VictoriaMetrics OSS | Mimir는 AGPL-3.0 |
| 장기 보존을 오브젝트 스토리지에 두고 복제를 1배로 합치고 싶다 | Cortex, Mimir | compactor가 복제본을 합침. VictoriaMetrics는 복제 계수만큼 저장 |
| 오브젝트 스토리지·Kafka·캐시 없이 컴포넌트 셋만 쓰고 싶다 | VictoriaMetrics | 외부 의존성 없음 |
| tenant별 limit과 shuffle sharding 같은 격리가 필요하다 | Mimir, Cortex | VictoriaMetrics OSS에는 tenant별 시리즈 limit이 없음 |
| Grafana 대시보드를 값 변화 없이 옮기고 싶다 | Cortex, Mimir | MetricsQL에 의도적인 차이가 있음 |
| 다운샘플링이나 다중 보존기간이 필요하다 | VictoriaMetrics Enterprise | Cortex·Mimir에는 없음 |
| Kafka를 이미 운영하거나 운영할 수 있다 | Mimir ingest storage | 쓰기 경로가 Kafka 복제에 기댐. 운영하기 어려우면 classic |
| 하나의 클러스터로 여러 AZ에 걸쳐 복제하고 싶다 | Cortex, Mimir | VictoriaMetrics는 AZ별 독립 클러스터와 vmagent 복제를 권함 |
| 개발 속도와 기여자 수를 중시한다 | Mimir, VictoriaMetrics | Cortex는 커밋이 Mimir의 약 1/6 |
| 같은 하드웨어로 active series를 많이 받아야 한다 | VictoriaMetrics를 먼저 시험 | 공개 근거는 2022년 벤더 벤치마크뿐이라 직접 측정이 필요 |

라이선스와 중립 거버넌스가 우선이라면 Cortex가 맞습니다. AWS의 Amazon Managed Service for Prometheus와 같은 코드 계열을 직접 운영하고, Parquet 기반 장기 쿼리 같은 실험 기능을 따라갈 의향이 있는 경우에도 후보가 됩니다. 다른 후보보다 적은 활동량은 감수해야 합니다. Cortex ADOPTERS.md에는 Adobe, AWS, DigitalOcean, Electronic Arts, Etsy, GoJek, KakaoEnterprise, Twilio 등 23곳이 올라 있습니다. AWS는 Amazon Managed Service for Prometheus가 워크스페이스당 2억 active series까지 지원한다고 발표했습니다.

장기 데이터를 오브젝트 스토리지에 저렴하게 두면서 테넌트 격리와 PromQL 결과의 일치를 요구한다면 Mimir가 맞습니다. ingest storage를 택하려면 Kafka 운영도 가능해야 합니다. 수정하거나 서비스로 제공하는 용도로 AGPLv3를 사용하려면 법무 검토를 거쳐야 합니다. 공개 사용자로는 Grafana Cloud Metrics, OVHcloud, SysEleven, Giant Swarm이 있으며, InfoQ는 CERN을 대규모 사용자로 언급했습니다.

외부 의존성 없이 컴포넌트 셋을 운영하는 편을 원하고, MetricsQL의 계산 차이와 복제 계수만큼 늘어나는 저장 용량을 받아들일 수 있다면 VictoriaMetrics가 맞습니다. 다운샘플링, 다중 보존기간, 내부 mTLS, 테넌트별 속도 제한, LTS가 필요하면 Enterprise 계약을 선택 조건에 포함해야 합니다.

VictoriaMetrics가 게시한 사례 30건 중 cluster 사례는 7건입니다. 벤더가 소개한 규모에는 Roblox의 50억 active series·초당 1억 2천만 포인트·저장 노드 200대, RELEX Solutions의 2,500만 시리즈, Wedos의 3,200만 시리즈, Xiaohongshu의 30개 이상 클러스터가 있습니다. 큰 사례가 있다는 이유만으로 cluster를 고를 필요는 없습니다. 초당 100만 샘플 미만이면 공식 문서도 single-node를 권하므로, cluster가 필요한 조건인지부터 확인하는 편이 순서에 맞습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| 조건별 표 | 2절~8절의 근거 항목을 조건 단위로 다시 묶은 판단. 어느 한 제품도 모든 조건에서 앞서지 않음 | 2~8절 근거 | `Σ` |
| Cortex 공개 사례 | ADOPTERS.md에 23곳(Adobe, AWS, DigitalOcean, Electronic Arts, Etsy, GoJek, KakaoEnterprise, Twilio 등). AMP는 워크스페이스당 2억 active series 지원 발표 | Cortex ADOPTERS, AWS 블로그 | `Ⓥ` |
| Mimir 공개 사례 | Grafana Cloud Metrics, OVHcloud, SysEleven, Giant Swarm, InfoQ가 CERN을 언급 | Mimir ADOPTERS, InfoQ | `Ⓥ` |
| VM 공개 사례 | 사례 30건 중 cluster 7건. Roblox 50억 active series·초당 1억 2천만 포인트·저장 노드 200대, RELEX 2,500만, Wedos 3,200만, Xiaohongshu 30개 이상 클러스터 | VictoriaMetrics case studies(벤더 게시) | `Ⓥ` |
| 같은 하드웨어 대비 효율 | 중립적인 현행 버전 비교가 없어 2022년 벤더 벤치마크와 사용자 사례(Prezi는 Prometheus 대비)로만 추정 | 4절 근거 | `≈` |
| Cortex 활동량 비용 | 커밋 약 1/6~1/3 | 8절 근거 | `≈` |

{{% /details %}}

## 10. 확인하지 못한 것

- Mimir classic 아키텍처의 폐기 계획
- Mimir ingest storage에서 ingester를 늘리고 줄이는 세부 절차와 block-builder의 정확한 역할
- Mimir ingest storage 기준의 공식 용량 산정(Kafka 포함)
- VictoriaMetrics vmstorage의 active series당 RAM 공식 수치(현재 문서에 없음)
- VictoriaMetrics의 tenant 간 쿼리 기능 세부와 UTF-8 메트릭 이름 지원
- loveholidays와 VTEX 사례의 원문(접근하지 못해 검색 요약만 확인)
- 현행 버전끼리 같은 조건에서 잰 중립 제3자 벤치마크

## 참고 자료

- Cortex 아키텍처: https://cortexmetrics.io/docs/architecture/
- Cortex compactor: https://cortexmetrics.io/docs/blocks-storage/compactor/
- Cortex querier: https://cortexmetrics.io/docs/blocks-storage/querier/
- Cortex v1guarantees: https://cortexmetrics.io/docs/configuration/v1guarantees/
- Cortex 인증: https://cortexmetrics.io/docs/guides/auth/
- Cortex shuffle sharding: https://cortexmetrics.io/docs/guides/shuffle-sharding/
- Cortex 용량 계획(구버전): https://cortexmetrics.io/docs/guides/capacity-planning/
- Cortex 동적 쿼리 분할: https://cortexmetrics.io/blog/2025/08/12/efficient-query-parallelism-in-cortex-with-dynamic-query-splitting/
- Cortex v1.21.0 릴리스: https://github.com/cortexproject/cortex/releases/tag/v1.21.0
- Cortex 릴리스: https://github.com/cortexproject/cortex/releases
- Cortex 로드맵: https://github.com/cortexproject/cortex/blob/master/docs/roadmap.md
- Cortex Thanos 마이그레이션: https://github.com/cortexproject/cortex/blob/master/docs/blocks-storage/migrate-storage-from-thanos-and-prometheus.md
- Cortex MAINTAINERS: https://github.com/cortexproject/cortex/blob/master/MAINTAINERS.md
- Cortex ADOPTERS: https://github.com/cortexproject/cortex/blob/master/ADOPTERS.md
- CNCF Cortex: https://www.cncf.io/projects/cortex/
- Mimir 릴리스: https://github.com/grafana/mimir/releases
- Mimir CHANGELOG: https://github.com/grafana/mimir/blob/main/CHANGELOG.md
- Mimir ADOPTERS: https://github.com/grafana/mimir/blob/main/ADOPTERS.md
- Mimir 아키텍처: https://grafana.com/docs/mimir/latest/get-started/about-grafana-mimir-architecture/
- Mimir ingest storage: https://grafana.com/docs/mimir/latest/get-started/about-grafana-mimir-architecture/about-ingest-storage-architecture/
- Mimir 3.0 릴리스 노트: https://grafana.com/docs/mimir/latest/release-notes/v3.0/
- Mimir versioning: https://grafana.com/docs/mimir/latest/configure/about-versioning/
- Mimir 배포 모드: https://grafana.com/docs/mimir/latest/references/architecture/deployment-modes/
- Mimir query sharding: https://grafana.com/docs/mimir/latest/references/architecture/query-sharding/
- Mimir shuffle sharding: https://grafana.com/docs/mimir/latest/configure/configure-shuffle-sharding/
- Mimir zone-aware replication: https://grafana.com/docs/mimir/latest/configure/configure-zone-aware-replication/
- Mimir 용량 계획: https://grafana.com/docs/mimir/latest/manage/run-production-environment/planning-capacity/
- Mimir Helm 6.0 릴리스 노트: https://grafana.com/docs/helm-charts/mimir-distributed/latest/release-notes/v6.0/
- Grafana Mimir 발표(2022-03-30): https://grafana.com/blog/2022/03/30/announcing-grafana-mimir/
- Grafana Mimir 10억 active series(2022-04-08): https://grafana.com/blog/2022/04/08/how-we-scaled-our-new-prometheus-tsdb-grafana-mimir-to-1-billion-active-series/
- Grafana Mimir 3.0 블로그(2025-11-03): https://grafana.com/blog/2025/11/03/grafana-mimir-3-0-release-all-the-latest-updates/
- Mimir 웨비나 Q&A: https://community.grafana.com/t/intro-to-mimir-webinar-q-a/102614
- Mimir 다운샘플링 제안 PR: https://github.com/grafana/mimir/pull/5028
- InfoQ Mimir 3: https://www.infoq.com/news/2025/11/grafana-mimir-3
- VictoriaMetrics cluster: https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/
- VictoriaMetrics LTS: https://docs.victoriametrics.com/victoriametrics/lts-releases/
- VictoriaMetrics Enterprise: https://docs.victoriametrics.com/victoriametrics/enterprise/
- VictoriaMetrics MetricsQL: https://docs.victoriametrics.com/victoriametrics/metricsql/
- VictoriaMetrics FAQ: https://docs.victoriametrics.com/victoriametrics/faq/
- VictoriaMetrics Prometheus 연동: https://docs.victoriametrics.com/victoriametrics/integrations/prometheus/
- VictoriaMetrics 용량 산정: https://docs.victoriametrics.com/guides/understand-your-setup-size/
- VictoriaMetrics 사례: https://docs.victoriametrics.com/victoriametrics/casestudies/
- VictoriaMetrics 릴리스: https://github.com/VictoriaMetrics/VictoriaMetrics/releases
- VictoriaMetrics prometheus-benchmark: https://github.com/VictoriaMetrics/prometheus-benchmark
- VictoriaMetrics의 Mimir 비교(2022-09-09): https://victoriametrics.com/blog/mimir-benchmark/
- Prometheus Remote Write 2.0: https://prometheus.io/docs/specs/prw/remote_write_spec_2_0/
- Prometheus native histogram: https://prometheus.io/docs/specs/native_histograms/
- Amazon Managed Service for Prometheus FAQ: https://aws.amazon.com/prometheus/faqs/
- Amazon Managed Service for Prometheus 2억 지표: https://aws.amazon.com/blogs/mt/amazon-managed-service-for-prometheus-adds-support-for-200m-active-metrics/
- InfoQ Prezi: https://www.infoq.com/news/2025/02/prezi-prometheus-victoriametrics
- Criteo 엔지니어링: https://medium.com/criteo-engineering/victoriametrics-a-prometheus-remote-storage-solution-57081a3d8e61
- loveholidays: https://tech.loveholidays.com/grafana-mimir-our-journey-towards-infinite-wisdom-with-5m-active-time-series-7a262ba53a3f
