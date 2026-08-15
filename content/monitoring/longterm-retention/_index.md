---
title: "메트릭 장기보관 아키텍처 비교"
weight: 2
---

# 메트릭 장기보관 아키텍처 비교 — 400일 보관 권장안

과거 장애를 다시 파헤치려면 그때 메트릭이 남아 있어야 합니다. 이 챕터는 **메트릭 400일 보관**을 놓고 아키텍처 후보를 비교해 권장안까지 정리합니다. 옵션마다 비용·구성·제약을 같은 축에 올려두고 VM OSS 아카이브안이 이 조건에서 최적인 이유까지 이어서 짚습니다.

> 자매 챕터: [VictoriaMetrics Deep Dive]({{< relref "../victoriametrics/_index.md" >}}) — 이 챕터의 VM 아카이브안이 쓰는 streamAggr·vmsingle·vmbackup·MetricsQL의 내부 동작은 그쪽에서 다룬다.

## 전제 (사용자 확정)

- **목적**: 과거 장애 재조사용 400d 보관. 어떤 메트릭이 필요할지 미리 고를 수 없으니 **전 메트릭 커버리지**가 조건입니다.
- **>90d 구간은 5m 해상도 허용** — 이 한 줄에서 비용이 자릿수로 갈립니다.
- **OSS 우선.** 근거는 공식 문서와 AWS Price List API(서울, 2026-07-10) 적대적 검증입니다.

## 문서 지도

| 문서 | 주제 | 한 줄 요약 |
|------|------|-----------|
| [01 문제와 결정 2축]({{< relref "01-problem-and-axes.md" >}}) | 프레이밍 | 무엇을 보관(raw vs 5m 집계)·어디에 저장(EBS vs S3), 시나리오 ①② 비용 규모 |
| [02 VictoriaMetrics]({{< relref "02-vm-archive.md" >}}) | ★권장 | 라우터 RW#4 + streamAggr 5m → vmsingle-archive, 월 $385~416 |
| [03 Thanos]({{< relref "03-thanos-s3.md" >}}) | 대안 | Receive→S3 + compactor downsampling, 월 $780~1,200 + 컴퓨트 |
| [04 Mimir]({{< relref "04-mimir.md" >}}) | 탈락 | downsampling 부재 → 5m 불가 → raw 강제, 컴포넌트 8~10 + Kafka |
| [05 VMCluster 확장]({{< relref "05-vmcluster-expansion.md" >}}) | 기준선 | 현행 그대로 400d, 월 $1,642. Enterprise 다운샘플은 한 줄이지만 라이선스 |
| [06 스토리지 단가]({{< relref "06-storage-pricing.md" >}}) | 근거 | sc1 < S3 Std < st1 < gp3 (서울), 아카이브 볼륨 선택 가이드 |
| [07 streamAggr vs downsampling]({{< relref "07-streamaggr-vs-downsampling.md" >}}) | 핵심 논점 | 사전 확정 vs 사후 재계산, 판단 기준 트리, 비용 종합 비교표 |
| [08 권장안·하지 말 것·실측]({{< relref "08-recommendation-and-pitfalls.md" >}}) | 결론 | VM 아카이브안 근거·업계 선례, 검증 기각 10개, 드라이런 2주 실측 목록 |

## 결정의 구조 — 2축

**축 1: 무엇을 400d 보관하나** (비용을 자릿수로 가름)

| 시나리오 | 형태 | 비용 규모 |
|---|---|---|
| ① | raw 30s × 400d | $1,600+/mo |
| ② (← 본 건 확정) | raw 90d + 전 메트릭 5m 집계 400d | $400~500/mo |

본 건은 ②를 전제로 깔고 들어가므로 남는 질문은 하나입니다. "VM OSS엔 downsampling이 없는데 5m을 누가 만드나" — 후보는 **streamAggr(VM 아카이브안)** 아니면 **Thanos compactor(Thanos안)** 둘 중 하나입니다. **Mimir는 downsampling 자체가 없어 탈락**입니다.

**축 2: 어디에 저장하나** — VM은 S3를 쿼리 가능한 primary 스토리지로 지원하지 않습니다. VM 계열은 EBS 위입니다. 서울 단가가 `sc1 < S3 Standard < st1 < gp3` 순이라 "S3라서 싸다"는 전제부터 성립하지 않습니다. 갈리는 지점은 단가가 아니라 **내구성 모델과 운영 컴포넌트 수**입니다.

## 권장 요약

**VM OSS 아카이브안** — 라우터 RW#4 + streamAggr 5m → vmsingle-archive. 월 **$385~416**으로 단순 확장안 대비 **~70% 절감**이고 새로 들일 기술은 0입니다. service는 무상태라 무영향, MetricsQL도 그대로 갑니다. **가역적**이기도 합니다 — RW#4를 Thanos Receive로 갈아끼우면 Thanos안으로 넘어갑니다. 상세 근거와 잔여 리스크 수용 논리는 [08 권장안]({{< relref "08-recommendation-and-pitfalls.md" >}}), 사전/사후 집계 판정은 [07 핵심 논점]({{< relref "07-streamaggr-vs-downsampling.md" >}}).
