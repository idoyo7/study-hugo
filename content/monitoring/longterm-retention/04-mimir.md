---
title: "Mimir"
weight: 4
aliases: ["/monitoring/longterm-retention/04-option-c-mimir/"]
---

# Mimir — Grafana Mimir 장기 tier

{{< callout type="info" >}}
**한눈에**
- Mimir는 **다운샘플링이 OSS·GEM·3.0 어디에도 없어** "5m 해상도 400d" 요구를 원리적으로 충족할 수 없다 — 이 시나리오에서 탈락.
- 유일한 실현 형태는 **raw 400d 전부 S3** — 경제성이 시나리오 ①(전 구간 raw)로 되돌아가 월 **~$740 + Kafka·컴퓨트**.
- 운영 footprint가 최대다 — distributor/ingester/compactor/store-gateway/querier/query-frontend에 3.0부터 Kafka 기본 의존까지 **8~10종**.
- **PromQL 전용**이라 MetricsQL 상실은 Thanos안과 동일하다. 재검토는 대규모 멀티테넌시·Grafana 스택 표준화가 독립 목표일 때만.
{{< /callout >}}

S3 native 저장과 remote_write native 수신으로 매력적으로 보이지만, **다운샘플링이 존재하지 않아** "5m 해상도 400d" 요구를 원리적으로 충족할 수 없다. 이 문서는 Mimir안의 구조와 탈락 사유, 그리고 언제 재검토할 값어치가 있는지를 정리한다.

> 관련 문서: [01 문제·2축]({{< relref "01-problem-and-axes.md" >}}), [02 VictoriaMetrics]({{< relref "02-vm-archive.md" >}}), [03 Thanos]({{< relref "03-thanos-s3.md" >}}), [07 핵심논점]({{< relref "07-streamaggr-vs-downsampling.md" >}}) · PromQL vs MetricsQL은 [VM 쿼리·컴포넌트]({{< relref "../victoriametrics/concepts/05-query-and-ops-components.md" >}})

## 한 줄 판정

400d Mimir tier = **400d 전부 full-resolution raw가 S3에** 앉는 구조다. 5m 아카이브 요구에서 **항상 탈락한다**. 대규모 멀티테넌시·Grafana 스택 표준화가 별도의 독립 목표일 때만 재검토 대상이다.

## 아키텍처 (참고)

```
라우터 vmagent ──RW#4 (forcePromProto, queues=1, -remoteWrite.headers='X-Scope-OrgID:…')──▶
  distributor ─(3.0: Kafka 기본 write path 의존)→ ingester ─▶ S3 blocks
  compactor(-compactor.blocks-retention-period=400d) / store-gateway / querier / query-frontend …
```

- **remote_write 수신**: `/api/v1/push`로 vmagent가 그대로 송신할 수 있다(자동 Prometheus proto 다운그레이드, `-remoteWrite.forcePromProto` 명시 권장). out-of-order를 기본 거부(409)하므로 해당 URL에 `-remoteWrite.queues=1`이 필요하다 — 이 레그의 백프레셔·OOM 리스크는 Thanos안과 동일하다([03 Thanos안]({{< relref "03-thanos-s3.md" >}}) 참조).
- **멀티테넌시**: `X-Scope-OrgID` 헤더가 필요하다(테넌시 비활성화 시 생략 가능).
- **S3 retention**: `-compactor.blocks-retention-period` 단일 플래그(YAML `limits.compactor_blocks_retention_period`, 테넌트별 오버라이드 가능). **기본값 0 = 무기한**이라 명시하지 않으면 S3가 영원히 쌓인다.

## 탈락 사유 (검증됨)

### 1. 다운샘플링이 존재하지 않는다 — OSS·GEM·3.0 전부

이것이 결정적 결함이다. OSS도, 유료 self-hosted GEM(Grafana Enterprise Metrics)도, Mimir 3.0(2025-11)에도 다운샘플링이 없다.

- 유지보수자 발언: *"down sampling is not currently supported. I'm not sure if there are plans to work on it"* (56quarters, 2022-05, discussion #1834) / *"downsampling just wasn't a priority for Grafana Labs so far"* (colega, 2024-12)
- 커뮤니티 설계 제안 PR #5028: **미병합**
- Mimir 3.0 헤드라인은 **Kafka ingest storage + Mimir Query Engine(MQE, 쿼리 피크 메모리 최대 -92%)** 이지 다운샘플링이 아니다.
- Grafana의 집계 대안 **Adaptive Metrics는 Grafana Cloud 전용**이다(self-hosted 불가).

즉 시나리오 ②(raw 90d + 5m 집계 400d)를 Mimir로 만들 저장-시점 수단 자체가 없다. 남는 길은 raw 400d뿐이고, 그 순간 경제성은 시나리오 ①(전 구간 raw)로 되돌아간다.

### 2. 시나리오 ②를 흉내내는 비용이 비현실적

다운샘플링이 없으니 5m 집계를 만들려면 **ruler recording rules로 전 메트릭을 5m마다 쿼리 재평가**해야 한다. 이는 인제스트-시점 스트림 처리(streamAggr)가 아니라 사실상 수동 사전집계이고, **대상이 전 메트릭이면 쿼리 기반 평가 부하가 비현실적**이다. streamAggr가 라우터 vmagent 메모리에서 스트림으로 접는 것과 근본적으로 성격이 다르다([07 핵심논점]({{< relref "07-streamaggr-vs-downsampling.md" >}}) 참조).

### 3. 운영 footprint가 최대다 — 컴포넌트 8~10종 + Kafka

distributor / ingester×N / compactor / store-gateway / querier / query-frontend에 더해 **3.0부터 Kafka가 기본 write path 의존**으로 붙는다. 마이크로서비스 **8~10종**의 컴퓨트를 상시 운영해야 한다. VM 아카이브안의 신규 stateful 1개(vmsingle)와 대비된다.

공식 사이징 참고치(예산 근거 아님, 방향성):

| 컴포넌트 | 참고 사이징 |
|---|---|
| ingester | ~2.5 GB RAM / 30만 in-memory 시리즈 |
| compactor | 1대 / 2천만 활성 시리즈 |

### 4. PromQL 전용

MetricsQL을 잃는다(Thanos안과 동일). 업스트림 PromQL 엔진 재사용으로 100% 호환이나, WITH 템플릿·`rollup_*`·`histogram_share`·`keep_metric_names` modifier·default/if/ifnot 등 MetricsQL 전 기능이 아카이브 쿼리에서 사라진다. 대시보드/vmalert의 MetricsQL 의존도가 미확인이라면 이 리스크는 VM 아카이브안을 가중한다.

## raw 400d로 갈 경우의 비용

다운샘플링이 없으니 Mimir안의 유일한 실현 형태는 raw 400d다. bytes/sample은 **Mimir 공식 보수치 ~2 B**(index+chunk)를 쓴다.

| 구성 | 값 | 비고 |
|---|---|---|
| raw 400d S3 저장량 | ~16.4 TiB | ~2 B/sample × 400d |
| S3 Standard 저장비 | ~$409/mo | 서울 $0.025/GB-mo ([06 단가]({{< relref "06-storage-pricing.md" >}})) |
| hot (80~90d) | $328~369 | $328=80d 실사용·$369=90d |
| **합계** | **~$740/mo + Kafka·컴퓨트** | 시나리오 ①·hot 80d 하단 기준, 컴퓨트 별도 |

시나리오 ②에서는 **부적합**으로 처리한다 — 5m 집계를 만들 수단이 없어 raw로 갈 수밖에 없고, 그러면 시나리오 ①의 경제성이 된다.

## 벤치마크 신호 (예산 근거로 쓰지 말 것)

VM 자체 벤치마크(2022-09, 벤더 작성, Mimir 2.2 상대)는 실측 사용량 기준 CPU ~1.7x·RAM ~5x·디스크 ~3x 우위와 p99 20s vs 47s를 주장한다. 그러나 **24h 윈도우가 Mimir compaction 사이클보다 짧아 Mimir 디스크가 과대평가**됐고, Mimir 3.0+MQE 이후의 중립 벤치마크는 부재하다. **예산 근거로 쓰지 말고 방향성 참고로만** 둔다.

## 언제 재검토하나

- 대규모 **멀티테넌시**(팀별 격리·per-tenant limit)와 Grafana 스택 표준화가 **독립 목표**가 될 때
- raw 400d S3 + Kafka 운영을 수용할 수 있을 때
- **그 경우에도** "5m 장기"가 요구로 남아 있으면 여전히 부적합하다 — 다운샘플링 부재는 버전이 바뀌기 전까지 변하지 않는다.

## 출처

- `03-option-c-mimir.md` — C안 상세(아키텍처, 탈락 사유, 참고 사실, 재검토 조건)
- `99-full-report.md` §2.3 — C안 옵션 비교, 비용 모델 시나리오 ①/② 표
