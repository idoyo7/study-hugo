---
title: "부록 · EKS 범용 노드와 gp3에서 잰 ClickHouse 1억 행 실측"
linkTitle: "부록 A EKS gp3 실측"
description: "atomai 문서가 m5.xlarge와 gp3 100GiB에서 로그 1억 행으로 잰 적재 속도, 코덱별 압축률, primary key·skip index 효과를 정리하고, 로컬 NVMe 전제의 본편과 어느 수치끼리 비교할 수 있는지 나눈다."
weight: 90
date: 2026-10-05
lastmod: 2026-10-05
url: "/clickhouse/a1-eks-gp3-benchmark/"
---

# 부록 · EKS 범용 노드와 gp3에서 잰 ClickHouse 1억 행 실측

4 vCPU 범용 노드 한 대와 기본 설정 gp3 100GiB에 Kubernetes 로그 1억 행을 넣으면 적재, 압축, 쿼리에서 어떤 결과가 나올까요? atomai의 [ClickHouse on EKS 실측 벤치마크](https://www.atomai.click/kubernetes-docs/ko/database/01-clickhouse-on-eks)는 이 조건을 서버 내부 적재와 코덱·인덱스별 쿼리로 나누어 측정했습니다. 이 글의 수치는 모두 원문 보고값이며 별도로 재실행하지 않았습니다.

[로컬 NVMe(i7i/i8g) 스토리지 아키텍처]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})와 비교할 때는 압축 크기·읽은 행 수와 실행 시간을 구분해야 합니다. 앞의 값들은 데이터·스키마·코덱·인덱스에 따라 달라지고, 시간에는 CPU와 디스크, 캐시 조건까지 반영됩니다.

근거 표기 — `✓` 원문 직접 확인 · `Ⓥ` 저자 주장 · `Ⓑ` 벤치마크 수치 · `?` 미확인. 각 절 끝의 '근거와 측정 조건'에 조건과 세부 수치를 모았습니다.

## 1. 무엇을 어떤 조건에서 쟀는가

노드는 m5.xlarge(4 vCPU, 16GiB) 한 대이며 벤치마크 파드만 배치했습니다. EBS gp3 100GiB를 기본값인 3,000 IOPS·125MiB/s로 붙였고 ClickHouse 24.8.14.39의 기본 설정을 사용했습니다. 데이터는 반복 템플릿에 가변 필드를 섞어 만든 합성 로그 1억 행입니다. 타임스탬프는 7일치이며 ERROR 비율은 0.8%입니다.

압축률을 해석할 때는 합성 데이터의 단순화를 고려해야 합니다. 네임스페이스 10종마다 파드 이름이 하나뿐이라 pod 컬럼도 10종입니다. 원문은 이 구성이 실제 클러스터보다 pod 압축률을 낙관적으로 만든다고 밝혔습니다.

이 기록은 단일 노드의 기존 실행 결과입니다. 원시 query_log와 당시 캐시 상태는 남아 있지 않고 복제·샤딩도 측정하지 않았습니다. 원문에 실린 26.3.33.24 매니페스트는 새 실행용 예제이며, 아래 24.8 측정값을 그 버전에서 다시 얻었다는 뜻은 아닙니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 근거 |
|---|---|---|
| 클러스터 | Amazon EKS, Kubernetes 1.36, ap-northeast-2 | `✓` |
| 노드 | m5.xlarge 한 대, Karpenter가 띄운 전용 노드, 벤치마크 파드 단독 배치 | `✓` |
| 파드 리소스 | requests 2.5 vCPU / 9Gi, limits 3.5 vCPU / 12Gi | `✓` |
| 볼륨 | EBS gp3 100GiB, 3,000 IOPS / 125MiB/s 기본값, EBS CSI 드라이버 | `✓` |
| ClickHouse | `clickhouse/clickhouse-server:24.8` (24.8.14.39), 설정 기본값. 원문은 24.x가 지원 종료라고 덧붙임. 원문이 인용: ClickHouse 보안 정책(SECURITY.md)의 지원 버전 목록 | `✓` |
| 데이터 | 8컬럼 `MergeTree`, 일 단위 파티션, ORDER BY (namespace, timestamp). 네임스페이스 10종, pod 10종, ERROR 0.8%, 7일치 | `✓` |
| 문서 갱신일 | 2026-09-11. 실제 측정일은 적혀 있지 않음 | `?` |
| 재현용 매니페스트 | 26.3.33.24 이미지를 쓰는 새 실행 예제이며 24.8 측정값과는 별개. 새 실행의 결과는 실려 있지 않음 | `✓` |
| 수치의 성격 | 기존 실행의 보고값. 원시 query_log와 당시 캐시 상태는 문서에 없어 같은 숫자의 재현을 보장하지 않는다고 원문이 밝힘 | `✓` |
| 반복 횟수 | 적재는 1회. 쿼리는 Direct I/O 요청 1회, warm 3회 중 최솟값. 적재의 반복 여부는 언급 없음 | `✓` `?` |

출처: [ClickHouse on EKS 실측 벤치마크](https://www.atomai.click/kubernetes-docs/ko/database/01-clickhouse-on-eks) — 「테스트 환경」, 「데이터셋 — 현실적인 Kubernetes 로그 1억 행」, 「TL;DR — 측정 결과 요약」

{{% /details %}}

## 2. 적재 속도

서버 내부에서 1억 행을 만들어 넣는 데 106.7초, 초당 약 94만 행이 걸렸습니다. `numbers_mt`로 생성한 행을 `INSERT … SELECT`로 바로 넣은 값입니다. 네트워크 전송과 텍스트 파싱은 빠지고 행을 생성하는 CPU 비용은 포함됩니다. 원문도 외부 수집 처리량의 상한으로 해석하지 말라고 적었습니다.

설정은 `max_threads = 3`, `max_insert_threads = 2`였고 파드 CPU 한도는 3.5 vCPU였습니다. 적재 후에는 파티션 7개와 active part 36개가 남았습니다. 압축된 최종 크기를 경과 시간으로 나누면 약 75MiB/s지만 페이지 캐시·writeback·merge가 섞인 값이므로 EBS 쓰기 처리량의 계측값은 아닙니다.

이 결과는 해당 CPU 한도에서 서버 내부 적재 경로를 잰 기준값입니다. 디스크가 적재에 미친 영향을 분리하지 않았으므로 로컬 NVMe의 쓰기 대역과 비교할 수는 없습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 근거 |
|---|---|---|
| 적재 시간 | 106.747초, 약 936,800행/초 | `Ⓑ` |
| 적재 설정 | `max_threads = 3`, `max_insert_threads = 2`, `max_memory_usage = 9000000000` | `✓` |
| 적재 결과 | 파티션 7개, active parts 36개 | `Ⓑ` |
| 경로 | 서버 내부 `INSERT … SELECT`. 외부 클라이언트·포맷·네트워크·배치·동시성은 변수로 남음 | `✓` |
| 75MiB/s | 최종 압축 크기를 경과 시간으로 나눈 값. 실제 EBS 쓰기 처리량이 아님 | `✓` |
| 디스크 한계 분리 | gp3 125MiB/s와 인스턴스 EBS 대역 중 무엇이 적재를 막았는지 분리해 재지 않음 | `?` |

출처: [ClickHouse on EKS 실측 벤치마크](https://www.atomai.click/kubernetes-docs/ko/database/01-clickhouse-on-eks) — 「측정 1 — Ingest: 1억 행 / 106.7초」

{{% /details %}}

## 3. 코덱별 압축률

기본 LZ4에서는 전체 15.37GiB가 7.82GiB로 줄어 압축률이 1.97배였습니다. 컬럼별 차이는 큽니다. 정렬 키 첫 컬럼인 namespace는 약 95.7MiB에서 489KiB로 줄어 201배였지만, 32자 hex 문자열인 trace_id는 3.07GiB에서 3.08GiB로 거의 줄지 않았습니다. trace_id 하나가 전체 압축 크기의 39.4%를 차지했습니다.

| 컬럼 | 압축 후 | 압축 전 | 비율 |
|---|---|---|---|
| message | 3.97GiB | 8.75GiB | 2.2배 |
| trace_id | 3.08GiB | 3.07GiB | 1.0배 |
| timestamp | 404.07MiB | 762.94MiB | 1.89배 |
| duration_ms | 289.17MiB | 381.47MiB | 1.32배 |
| level | 45.88MiB | 95.72MiB | 2.09배 |
| container | 39.27MiB | 95.72MiB | 2.44배 |
| pod | 9.32MiB | 2.15GiB | 236배 |
| namespace | 488.63KiB | 95.72MiB | 201배 |

같은 데이터를 `CODEC(ZSTD(3))` 테이블에 다시 넣으면 4.16GiB, 압축률 3.7배로 LZ4보다 47% 작았습니다. CPU 비중이 큰 warm 풀스캔은 2.63초에서 4.9초로 1.9배 느려졌습니다. 저장량과 스캔 시간의 변화가 함께 관찰된 결과입니다.

압축률은 디스크 종류보다 데이터와 스키마·코덱에 따라 달라지므로 NVMe 구성에서도 참고할 수 있습니다. 실제 로그의 값 분포는 이 합성 데이터와 같지 않습니다. pod의 236배는 값이 10종인 단순화에서 나온 낙관적인 결과이고 trace_id는 거의 압축되지 않는 사례입니다. CPU에 묶인 1.9배 스캔 시간도 다른 인스턴스에 그대로 적용할 수 없습니다.

원문은 최근 데이터에 LZ4를 쓰고 오래된 파티션을 TTL로 ZSTD 재압축하는 방안을 제시했습니다. hot NVMe와 cold를 나누는 본편과 연결해 검토할 수 있지만, 이 코덱 조합 자체를 측정한 결과는 아닙니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 근거 |
|---|---|---|
| 전체 크기, LZ4 | 15.37GiB에서 7.82GiB, 1.97배 | `Ⓑ` |
| 컬럼별 크기 | `system.parts_columns`의 압축 전후 바이트 합계. 비율은 반올림 전 바이트로 계산 | `Ⓑ` |
| ZSTD(3) | 4.16GiB, 3.7배. 같은 데이터를 ZSTD(3) 테이블에 재삽입. 재삽입 120.0초 | `Ⓑ` |
| 스캔 비용 | `LIKE '%timeout%'` warm이 LZ4 2.63초, ZSTD(3) 4.9초 | `Ⓑ` |
| pod 압축률의 한계 | 합성 데이터의 pod가 10종이라 namespace의 복사본처럼 동작. 원문이 낙관적이라고 밝힘 | `✓` |
| trace_id 비중 | 3.08GiB가 7.82GiB의 39.4%. 원문은 UUID·FixedString(16) 같은 표현은 코덱·인덱스 호환까지 포함해 재야 한다고 함 | `Ⓥ` |
| 코덱 조합 | LZ4 + 오래된 파티션 TTL ZSTD 재압축은 검토 대상일 뿐, 이 조합을 직접 재지는 않음 | `Ⓥ` |
| 다른 ClickHouse 버전·실제 로그 | 압축률이 어떻게 달라지는지 원문에 없음 | `?` |

출처: [ClickHouse on EKS 실측 벤치마크](https://www.atomai.click/kubernetes-docs/ko/database/01-clickhouse-on-eks) — 「측정 2 — 압축: 어떤 컬럼이 돈을 쓰는가」, 「LZ4 vs ZSTD(3) — 저장 47% vs 스캔 1.9×」

{{% /details %}}

## 4. 쿼리 성능과 인덱스

쿼리마다 mark·uncompressed 캐시를 비운 뒤 `min_bytes_to_use_direct_io=1`로 페이지 캐시 우회를 요청한 실행 1회와 warm 실행 3회의 최솟값을 기록했습니다.

| 쿼리 | Direct I/O 요청 | warm | 읽은 행 |
|---|---|---|---|
| Q1 키 범위 1시간 count | 13ms | 4ms | 16,385 |
| Q2 파드별 ERROR, 2일 창 | 0.57초 | 0.36초 | 2,800만 |
| Q3 `LIKE` 전 기간 풀스캔 | 31.5초 | 2.63초 | 1억 |
| Q4 네임스페이스별 p50·p99 | 1.34초 | 1.03초 | 1억 |
| Q5 trace_id 점 조회, 인덱스 없음 | 24.3초 | 1.13초 | 1억 |

### 정렬 키와 skip index가 줄인 읽기

1시간 창 count의 결과는 59,916행인데 실제 `read_rows`는 1억 중 16,385행(0.016%)이었습니다. 원문은 키 범위에 완전히 들어가는 granule은 인덱스만으로 세고 양끝 granule만 풀어 읽는 최적화가 쓰였다고 설명합니다. 이 원리는 로컬 NVMe에서도 적용되며 실제 범위는 `EXPLAIN indexes = 1`과 `read_rows`로 확인하도록 권합니다.

trace_id 점 조회에 bloom filter skip index를 적용하면 warm 시간이 1.13초에서 0.036초로 줄었습니다. 읽은 행은 1억에서 108만으로, 데이터는 3.82GiB에서 42.6MiB로 줄었고 인덱스는 119.7MiB로 테이블의 1.5%였습니다. 읽기 감소와 인덱스 크기는 스토리지 매체와 무관하게 참고할 수 있지만, 시간은 이 CPU와 캐시 상태에서 나온 값입니다.

### 캐시를 우회한 풀스캔의 대역폭

같은 `LIKE '%timeout%'` 풀스캔은 warm에서 2.63초, Direct I/O 요청에서 31.5초였습니다. message 컬럼 약 4GiB를 31.5초에 읽었다면 약 130MiB/s입니다. gp3 설정 125MiB/s와 인스턴스 EBS 기본 대역 1,150Mbps(약 137MiB/s)가 가까워 원문도 어느 쪽이 먼저 한계에 닿았는지 분리하지 못했다고 적었습니다.

EBS 경로에서 인스턴스 대역을 함께 봐야 한다는 본편의 설명과 연결되지만 규모가 다릅니다. 본편은 큰 인스턴스의 수 GB/s급 상한을, 이 측정은 4 vCPU 노드와 기본 설정 gp3를 다룹니다. 볼륨 처리량을 올려 보지 않은 이 결과를 gp3 전체의 성능으로 일반화할 수는 없습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 근거 |
|---|---|---|
| 측정 방식 | 쿼리마다 mark·uncompressed 캐시를 비운 뒤 Direct I/O 요청 1회, warm 3회의 최솟값. warm 첫 회는 캐시 적재로 느림(Q3는 첫 회 8.7초에서 이후 2.6초) | `✓` |
| Q1 | 결과 59,916행, `read_rows` 16,385. 파티션(일)과 ORDER BY (namespace, timestamp)가 겹쳐 하나의 연속 키 범위가 됨 | `Ⓑ` |
| Q2 | 데이터셋에 pod가 10종뿐이라 `LIMIT 10`이 사실상 전체 반환 | `✓` |
| Q3 병목 | 4GiB를 31.5초에 읽어 약 130MiB/s. gp3 상한 125MiB/s, 인스턴스 EBS 기본 대역 1,150Mbps(약 137MiB/s)와 겹쳐 원인 분리 불가 | `Ⓥ` |
| Q4 | message 대신 duration_ms(289MiB)와 namespace만 읽음. warm은 Float32 분위수 계산에 CPU가 묶임 | `Ⓥ` |
| Q5 | trace_id 3.08GiB를 24.3초에 읽어 약 130MiB/s | `Ⓑ` |
| bloom filter | `bloom_filter(0.01) GRANULARITY 4`. 1.13초에서 0.036초(31배), 읽은 행 1억에서 108만(98.9% 스킵), 읽은 데이터 3.82GiB에서 42.6MiB, 인덱스 119.7MiB | `Ⓑ` |
| 인덱스 구축 | `MATERIALIZE INDEX`는 비동기이며 원문은 약 20초라고 적음. `system.mutations` 완료 확인 필요 | `Ⓥ` |
| Q1·Q2·Q5의 원 SQL | 재현 절의 SQL은 새 실행용 예시이며 기존 결과의 행 수·밀리초와 일치한다고 주장하지 않음. 원 시간 창과 ID는 보존되지 않음 | `✓` |
| Direct I/O 수치의 해석 | 짧은 구간(Q2, Q4)으로 물리 디스크 처리량을 계산할 수 없음. 캐시·read method를 분리하지 못한 채 원래 실행이 종료됨 | `✓` |
| 쓰기·merge 비용에 대한 인덱스 영향 | 확인 필요 항목으로 남겨 두었고 측정값은 없음 | `?` |

출처: [ClickHouse on EKS 실측 벤치마크](https://www.atomai.click/kubernetes-docs/ko/database/01-clickhouse-on-eks) — 「측정 3 — 쿼리: 어떤 쿼리가 왜 빠른가/느린가」, 「측정 4 — bloom filter skip index: 1.13초 → 0.036초」

{{% /details %}}

## 5. NVMe 구성과 비교할 수 있는 결과 {#5-본편과-비교할-수-있는-것과-없는-것}

이 측정에서 다른 스토리지 구성으로 옮겨 검토할 수 있는 것은 데이터와 인덱스 설계입니다. 실행 시간까지 비교하려면 CPU 한도, 캐시 상태, 볼륨과 인스턴스 대역을 맞춰야 합니다.

| 구분 | 수치 | 본편과의 관계 |
|---|---|---|
| 스토리지와 무관 | 코덱별 압축률, 컬럼별 압축 비율 | 비교할 수 있음. 데이터 형태와 버전이 달라 절댓값은 참고용 |
| 스토리지와 무관 | `read_rows`, 인덱스 스킵 비율, 인덱스 크기 | 비교할 수 있음. 정렬 키·skip index의 원리는 매체와 상관없음 |
| 디스크에 묶임 | Direct I/O 요청의 풀스캔 시간(Q3, Q5) | 본편과 비교할 수 없음. gp3 100GiB 기본값에서 나온 하한 쪽 값 |
| CPU에 묶임 | 적재 속도, warm 쿼리 시간, ZSTD 스캔 지연 | 본편과 비교할 수 없음. 4 vCPU 노드(파드 한도 3.5 vCPU)의 값 |
| 방향만 일치 | 풀스캔이 볼륨·인스턴스 EBS 대역에 막힌다는 해석 | 본편의 EBS 대역 병목 설명과 같은 방향. 규모가 다름 |

본편: [스토리지 아키텍처 — 로컬 NVMe(i7i/i8g)]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})

본편이 소개한 Altinity 사례에서는 신세대 CPU와 EBS 조합이 캐시된 쿼리에서 구세대 로컬 NVMe를 앞섰습니다. 이 부록에서도 warm 풀스캔과 캐시 우회를 요청한 풀스캔의 시간이 크게 달랐습니다. 캐시된 쿼리의 CPU 비용과 디스크에서 읽는 대역폭을 구분해서 볼 수 있는 사례입니다. 실제 운영에서 어느 조건이 더 많은지는 두 글 모두 측정하지 않았습니다.

## 6. 압축 크기와 EBS 요금의 관계 {#6-본편에-없던-보충}

컬럼별 저장량은 어떤 데이터를 줄일지 결정하는 데 쓰입니다. 이 합성 로그에서는 ID 문자열 하나가 약 40%를 차지했습니다. 정렬 키가 읽은 행을 전체의 0.016%로 줄인 결과나 테이블의 1.5%인 bloom filter는 저장 매체 선택과 함께 검토할 수 있는 설계 항목입니다. 본편은 이 코덱·컬럼·인덱스 내역을 다루지 않습니다.

압축으로 저장량을 줄여도 EBS 요금이 곧바로 같은 비율로 줄지는 않습니다. 원문은 EBS가 실제 사용량이 아닌 프로비저닝한 용량으로 과금되므로 데이터가 8GiB여도 100GiB 볼륨 요금이 나온다고 설명합니다. 용량 계획에는 압축 후 크기와 확보할 볼륨 크기를 구분해서 반영해야 합니다. 여기의 비율은 단일 노드·합성 데이터이고 복제·샤딩은 포함하지 않았습니다.

출처: [ClickHouse on EKS 실측 벤치마크](https://www.atomai.click/kubernetes-docs/ko/database/01-clickhouse-on-eks) — 「비용으로 환산하면」, 「해석 시 주의사항」

## 7. 확인하지 못한 것

| 항목 | 상태 |
|---|---|
| 측정 일자 | 문서 갱신일(2026-09-11)만 있고 실제 측정일은 없음 |
| 적재의 반복 횟수와 편차 | 적재는 단일 결과이며 반복 여부는 언급 없음 |
| gp3 125MiB/s와 인스턴스 EBS 대역 중 병목 | 원문도 분리하지 못함 |
| 원시 query_log, 캐시 상태 | 문서에 포함되지 않음 |
| 처리량·IOPS를 올린 gp3, 로컬 NVMe 인스턴스에서의 같은 측정 | 원문에 없음 |
| 현행 LTS에서의 같은 수치 | 새 실행 예제만 있고 결과는 없음 |

## 출처

- 「ClickHouse on EKS 실측 벤치마크」 — atomai `kubernetes-docs` 데이터베이스 편, 2026-09-11 갱신(실제 측정일은 원문에 없음). https://www.atomai.click/kubernetes-docs/ko/database/01-clickhouse-on-eks
- 대응 본편: [스토리지 아키텍처 — 로컬 NVMe(i7i/i8g)]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}}), [로컬 NVMe 하드 유저들 — 데이터스토어 횡단 벤치마킹]({{< relref "/data/clickhouse/storage/07-local-nvme-datastore-patterns.md" >}})
