---
title: "Thanos"
date: 2026-07-12
lastmod: 2026-08-24
weight: 3
aliases: ["/monitoring/longterm-retention/03-option-b-thanos/"]
---

# Thanos — Receive → S3 (cold 400d, compactor downsampling)

{{< callout type="info" >}}
- raw는 S3에 짧게(7~30d)만 두고 400d 보관은 compactor가 **사후에** 만들어내는 5m/1h 다운샘플 블록이 맡습니다 — **S3 내구성(11-nines) + 사후 재계산 보험**을 얻는 대신 stateful 컴포넌트 3~4종과 더 높은 비용을 치릅니다.
- **다운샘플링은 저장 절감 수단이 아닙니다**(공식 명시) — 해상도가 공존하는 구간이 ~3x로 부풀어 총액이 월 **$780~1,200 + 컴퓨트**가 됩니다.
- **Receive**는 hashring 상태를 쥔 StatefulSet이라 반드시 chain에 둬야 하고 **Compactor**는 오류를 만나면 알림 없이 halt하므로 감시 알림이 필수입니다.
- 아카이브 쿼리는 **PromQL 전용**이 되어 MetricsQL 전 기능을 상실합니다 — 대신 VM 아카이브안에서 RW#4 대상만 교체하면 언제든 이 안으로 전환 가능합니다.
{{< /callout >}}

VM hot은 단기로 유지하고 raw는 S3에 짧게만 쌓습니다. 400d를 채우는 쪽은 Thanos compactor가 **사후에** 생성하는 5m/1h 다운샘플 블록입니다. 이 구성으로 **S3 내구성 + 사후 재계산 보험**을 얻고 대가로 **stateful 컴포넌트 3~4종과 더 높은 저장비**를 치릅니다.

> 관련 문서: [02 VM 아카이브(권장)]({{< relref "02-vm-archive.md" >}}), [07 streamAggr vs downsampling]({{< relref "07-streamaggr-vs-downsampling.md" >}}), [06 스토리지 단가]({{< relref "06-storage-pricing.md" >}}), [08 권장·하지 말 것]({{< relref "08-recommendation-and-pitfalls.md" >}})

## 아키텍처

```
라우터 vmagent ──RW#4 (-remoteWrite.forcePromProto 권장, -remoteWrite.queues=1)──▶
  Thanos Receive (StatefulSet, ketama hashring, 로컬 TSDB → 2h마다 S3 업로드)
       └─▶ S3 Standard 버킷 ◀── Compactor (엄격한 싱글턴: compaction + downsample + retention)
                 ▲                --retention.resolution-raw=7~30d
                 │                --retention.resolution-5m=400d / --retention.resolution-1h=400d
Grafana(Prometheus 타입 DS) ◀─ Querier ◀─ Store Gateway (블록당 ~6MB 로컬 index-header)
```

- Thanos Receive로 보내는 경로는 라우터 vmagent의 RW#4 하나뿐입니다. S3에서 raw는 짧게(7~30d), 5m/1h는 400d로 갑니다.
- 조회 경로는 나뉩니다. ≤90d는 기존 vmselect가, >90d는 Thanos Querier가 받습니다 — Grafana에는 **datasource 2개가 공존**합니다.
- **다운샘플 성립 조건**: raw 보존이 >40h여야 5m 블록이 생성되고 5m 보존이 >10d여야 1h 블록이 생성됩니다. `resolution-raw`를 7~30d로 권장하는 이유입니다.

## 컴포넌트 — 신규 stateful/준-stateful 3~4종

| 컴포넌트 | 상태성 | 배치 | 핵심 리스크 |
|---|---|---|---|
| **Receive** | hashring 상태 보유(StatefulSet) | **chain 필수** | 설정 변경 시 전 파드 flush로 ~5분 unready, OOM 사례 다수 |
| **Compactor** | 스트림당 엄격한 싱글턴 | chain | 데이터 오류 시 crash 대신 **halt** → 조용한 정지 |
| **Store Gateway** | 블록당 ~6MB 로컬 index-header | chain | 캐시 계층 없으면 쿼리 팬아웃 GET 급증 |
| **캐시(권장)** | index/chunk/bucket 캐시 | chain | Store GW 지연·S3 요청비 완화용, 3~4번째 유형 |

- **Receive가 쥔 hashring 상태는 StatefulSet을 요구합니다 — service 클러스터의 무상태 원칙과 양립 불가이므로 반드시 chain에 둡니다.** 로컬 TSDB의 기본값이 `--tsdb.retention=15d`라 EBS도 별도로 붙습니다.
- **Compactor는 자체 실패 모드가 있습니다**: 데이터 오류를 만나면 죽는 대신 **halt(`thanos_compact_halted=1`)** 합니다. halt 이후에는 **compaction·다운샘플·retention이 알림 없이 전면 정지**하고 S3는 계속 늘어납니다(반복 보고된 운영 이슈 #517 / #6748 / #5211). → **halt 알림은 필수**입니다.

## 송신 레그 주의 (vmagent → Receive)

- Thanos Receive는 out-of-order 샘플을 **기본 거부(409)** 합니다 → VM 공식 가이드가 해당 URL에 `-remoteWrite.queues=1`을 권고합니다(기본값은 2×CPU코어). per-URL queues 설정은 **vmagent v1.135.0+** 입니다.
- 단 `queues=1`에는 `vmagent_remotewrite_pending_data_bytes` 증가·OOM 리스크가 실증돼 있어(#7108) `-remoteWrite.maxDiskUsagePerURL` 버퍼 설계가 필수입니다.
- `-remoteWrite.forcePromProto`는 자동 다운그레이드가 있어 필수는 아니나 명시 권장입니다.
- vmagent 파이프라인·remoteWrite 세부는 VM 챕터 [인제스트]({{< relref "../victoriametrics/concepts/03-ingestion.md" >}}) 참조.

## 비용 (시나리오 ②: raw 90d + 5m 집계 400d)

시나리오 정의와 검증된 서울 단가의 주인은 [01 문제·2축]({{< relref "01-problem-and-axes.md" >}})·[06 단가]({{< relref "06-storage-pricing.md" >}})입니다. 이 절은 Thanos안 대입만 옮깁니다.

```
S3 = S × (1.5~2 B/sample) × (raw일수 + 400d × 1.2~1.8) × $0.025
  S ≈ 2.2×10¹⁰ samples/day (254k samples/s 상한 가정)
  ×1.2~1.8 = "5m·1h 블록이 raw와 비슷한 크기"라는 공식 서술의 해석 범위
  → 14.9~30.7 TiB ≈ $374~767/mo
```

| 항목 | 월 저장비 |
|---|---|
| hot 90d (기존 VMCluster) | $369 |
| S3 (5m+1h 400d + raw 7~30d) | $374~767 |
| Receive 로컬 TSDB EBS (기본 15d, 축소 가능) | $42~56 |
| S3 요청비 (compactor 재작성 + Store GW GET) | +α (쿼리 패턴 의존, 미산입) |
| **합계** | **~$780~1,200/mo + 컴퓨트 4종** |

- 시나리오 ①(raw 400d 전 구간)로 가면 S3가 12.3~16.4 TiB = $307~409, 총 **~$680~800 + 컴퓨트**입니다. **raw를 통째로 400d 들고 가도 이 정도입니다 — Thanos안의 "사후 재계산 보험"이 서는 근거가 여기입니다.**
- **S3 범위가 이렇게 넓은 이유는 다운샘플링이 공간을 줄이지 않기 때문입니다** — 공식 문서가 5m·1h 블록을 raw와 "약간 작거나 비슷한 크기"라 명시합니다. 공존 구간은 **~3x**로 부풀고 실제 절감은 오직 `--retention.resolution-raw` 단축(=raw 삭제)에서만 나옵니다. 이 논점의 심층 대조는 [07]({{< relref "07-streamaggr-vs-downsampling.md" >}})이 주인입니다.

## 쿼리 경로 — PromQL 전용

- Grafana에 Prometheus 타입 DS로 공존시킬 수는 있지만 쿼리는 **PromQL 전용**입니다. WITH 템플릿, `rollup_*`, `histogram_share`, `keep_metric_names` modifier, `default/if/ifnot` 등 **MetricsQL 전 기능을 아카이브 쿼리에서 상실**합니다 → 재작성 비용이 듭니다.
- 반대급부: 5m 블록은 시리즈당 **5 aggregate(sum/count/min/max/counter)** 를 청크에 자동 내장합니다. 덕분에 시리즈명·수가 불변이고 `rate()`가 투명하게 동작합니다. 카운터/게이지 구분을 사람이 할 필요가 없습니다.
- MetricsQL/PromQL 차이는 VM 챕터 [쿼리·운영 컴포넌트]({{< relref "../victoriametrics/concepts/05-query-and-ops-components.md" >}}) 참조.

## 버킷 스토리지 클래스 — S3 Standard 필수

- Store Gateway가 읽는 버킷은 **반드시 S3 Standard**($0.025/GB-mo, 리트리벌 수수료 없음)여야 합니다.
- **S3 Standard-IA/Glacier IR 금지**: IA는 +리트리벌 $0.01/GB(최소 30일), Glacier IR은 +$0.03/GB(최소 90일)입니다. 이 **GB당 리트리벌 수수료가 Store Gateway 동기화·쿼리마다** 부과됩니다. 자주 읽는 primary 저장에는 부적합하고 IA/GIR는 vmbackup류 콜드 사본 전용입니다(하지 말 것 #5, [08]({{< relref "08-recommendation-and-pitfalls.md" >}})).
- 같은 리전 S3↔EC2 전송은 무료입니다. 단가·클래스 상세는 [06]({{< relref "06-storage-pricing.md" >}}).

## 강점·약점 요약

**강점**
- **S3 내구성(11-nines)** — RF1 EBS 아카이브보다 우월(감사 등 조직 요구 대응).
- **사후 재계산 보험** — raw를 S3에 두는 기간 안에서는 "5m으로 부족했다" 시나리오에 대응 가능합니다.
- 카운터/게이지 구분·설계 불필요(5 aggregate 자동 내장).

**약점 / 리스크**
- 다운샘플링은 **저장 절감 수단이 아닙니다**(공식 명시) — 공존 시 ~3x.
- 신규 stateful/준-stateful **3~4종**의 상시 운영 부담(Receive hashring, Compactor halt, Store GW + 캐시).
- **PromQL 전용** — MetricsQL 의존이 있거나 미확인이면 재작성 리스크.
- Receive는 service 클러스터 부적합(hashring stateful).

## 언제 Thanos안을 고르나

- raw의 **사후 재계산 보험**이 집계-확정 리스크보다 중요할 때.
- S3 내구성이 조직 요구(감사 등)일 때.
- Thanos 운영 경험·여력이 이미 있을 때(hashring·compactor halt·캐시 계층 상시 운영).
- **VM 아카이브안에서 전환할 수 있습니다** — 라우터의 RW#4 대상만 Thanos Receive로 갈아끼우면 되므로 처음부터 Thanos안으로 갈 필요는 없습니다. VM 아카이브안 구성과 가역성은 [02]({{< relref "02-vm-archive.md" >}}) 참조.

## 출처

- `02-option-b-thanos.md` — B안 아키텍처·컴포넌트·비용·실패 모드 상세
- `99-full-report.md` §2.2 — B안 옵션 비교(컴포넌트 3~4종, 송신 레그, 강점/약점), §1·§3 검증된 서울 단가·비용 모델
- 근거: thanos.io compact 문서("downsampling doesn't save you any space", 해상도 공존 ~3x, 해상도별 retention 플래그) / docs.victoriametrics.com 통합 가이드(queues=1 권고, forcePromProto 선택) / Prometheus TSDB "1-2 bytes per sample" / Thanos GitHub 이슈 #517·#6748·#5211·#7108 및 커뮤니티 운영 보고
