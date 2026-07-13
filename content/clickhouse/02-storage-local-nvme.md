---
title: "스토리지 아키텍처 — 로컬 NVMe(i7i/i8g)"
weight: 2
---

# 스토리지 아키텍처 — 로컬 NVMe(i7i/i8g)

"i7i 같은 로컬 스토리지를 크게 가져가는 구성이 실제 가능한가"에 대한 답은 **가능하고, 일정 조건에서는 EBS보다 명백히 낫다** — 단 "크게"의 상한은 디스크 용량이 아니라 **노드 소실 시 재수화 시간**이 정한다. 로컬 NVMe(instance store)는 network block storage보다 5~10배 빠르지만 `[벤치]` 휘발성이라, ClickHouse에서 내구성은 **디스크가 아니라 복제(replication)로 확보**한다. 즉 로컬 NVMe 전략의 본질은 "빠른 휘발성 디스크 + 멀티 AZ replica + S3 백업"의 3종 세트다. 이 페이지는 스토리지 4전략 비교 → i7i/i8g 상세 → 내구성 설계 → k8s local PV·Karpenter 운영 → 재수화까지를 의사결정 순서로 정리한다. managed vs self-host의 큰 그림과 달러 TCO는 [Managed vs Self-hosted]({{< relref "01-managed-vs-selfhosted.md" >}})가 담당한다.

## 스토리지 4전략 — 무엇을 고르나

self-host ClickHouse의 스토리지 매체는 네 갈래다. 로컬 NVMe만 놓고 결정하지 말고 tradeoff 축(성능·비용·내구성·운영 복잡도)을 한 표로 본다.

| 지표 | (a) 로컬 NVMe | (b) EBS gp3 | (b) EBS io2 Block Express | (c) S3 + local cache | (d) tiered(hot NVMe/cold S3) |
|---|---|---|---|---|---|
| 지연(latency) | **µs 단위(최저)** | 100~500 µs | **<500 µs @16KiB** | hot=캐시급 / cold=수십~수백 ms | hot=NVMe / cold=S3 |
| 최대 IOPS | 인스턴스 물리한계(수백만급) | 80,000/vol | **256,000/vol** | 캐시 히트 시 로컬급 | 티어별 |
| 최대 처리량 | 인스턴스 한계(수 GB/s, RAID로↑) | 2,000 MiB/s | **4,000 MB/s/vol** | 캐시+S3 대역 | 티어별 |
| 내구성 | **없음(휘발성)** — 복제로 보완 | 99.8~99.9% | **99.999%** | S3 11 nines | 티어별 |
| GB당 비용 | **인스턴스 가격에 포함($0 별도)** | $0.08/GB-mo + IOPS·throughput 초과분 | gp3보다 크게 비쌈 | S3 최저(~$0.023/GB-mo) | hot 비쌈/cold 저렴 |
| 노드 이동 시 데이터 | **소실** | 재부착 가능(같은 AZ) | 재부착 가능 | S3에 보존 | hot 소실/cold 보존 |
| 운영 복잡도 | **높음**(RAID·재수화·백업 설계) | 낮음(EBS CSI 표준) | 낮음 | 중간(캐시 튜닝) | **가장 높음**(정책·TTL·이동 감시) |
| 적합 워크로드 | 고QPS·저지연·대규모 스캔 | 일반 프로덕션·중규모 | 극한 IOPS DB | 콜드/아카이브·비용 최적 | 관측성(hot 최근/cold 장기) |

*(위 성능·내구성 수치는 AWS 공식 스펙 기준 `[확인됨]`, GB당 비용은 us-east-1 2026-07 시점.)*

핵심 판단:

- **EBS(gp3/io2)는 인스턴스의 EBS 대역폭 한계에 묶인다.** gp3 볼륨을 아무리 붙여도 인스턴스 EBS 파이프(예: i7i는 EBS 최대 60 Gbps, 중형은 1,250 MB/s급)가 병목이라 `[확인됨]` 로컬 NVMe의 수 GB/s를 못 낸다. "스토리지 성능을 강하게"라는 요구는 EBS 경로로는 **월 수천 달러를 써도 물리적으로 도달 불가**하다(정량 근거는 [Managed vs Self-hosted]({{< relref "01-managed-vs-selfhosted.md" >}})).
- **S3-backed MergeTree(c)는 self-host에서 진짜 storage-compute 분리가 아니다.** SharedMergeTree는 Cloud 전용이고, self-host의 S3 disk는 part metadata가 로컬에 남아 filesystem_cache가 사실상 필수이며 콜드 쿼리는 느리다. self-host에서 S3는 **primary가 아니라 cold tier로만** 쓴다.
- **관측성 워크로드의 정석은 (d) tiered**: 최근 데이터는 hot(로컬 NVMe), 오래된 데이터는 `TTL ... TO VOLUME 'cold'`로 S3에 내린다. 성능은 hot에서 얻고 비용은 cold에서 아낀다. 스토리지 티어링 프리미티브 자체는 [로깅 챕터의 ClickHouse]({{< relref "../logging/04-clickhouse.md" >}}) 페이지에서도 다룬다.

### 로컬 NVMe가 정당화되는 신호

로컬 NVMe는 운영 부담(RAID·재수화·백업 설계)이 크므로 "빠르니까 무조건"이 아니라 아래 신호가 겹칠 때 고른다. Altinity는 운영 단순성 때문에 32 vCPU 이하 노드에는 gp3 단일 볼륨을 기본 권장할 만큼 보수적이지만 `[벤더]`, PostHog 같은 대규모 사용자는 로컬 NVMe로 이동했다 — 규모·성능 요구가 임계를 넘으면 로컬 NVMe가 정당화된다.

| 신호 | 로컬 NVMe 정당화 |
|---|---|
| **데이터 규모** | 노드당 수 TB~수십 TB, 클러스터 총 10TB+ 압축 |
| **쿼리 패턴** | 대규모 full/range scan, 고QPS 대시보드, 저지연(<수십ms), 무거운 aggregation |
| **처리량 요구** | EBS 단일/다중 볼륨(~2GB/s대)으로 부족, 수 GB/s 필요 |
| **워크로드 안정성** | 24/7 always-on(로컬 NVMe 노드는 상시 가동 전제) |

반대로 소규모(<5~10TB)·bursty·운영 인력 부족·강한 내구성 단순화 요구면 gp3나 managed가 합리적이다.

## i7i / i8g — 로컬 NVMe 인스턴스 상세

**i7i (2025-04-28 출시 `[확인됨]`)** 는 x86 스토리지 최적화 인스턴스의 현행 최강이다. **3세대 AWS Nitro SSD** + 5세대 Intel Xeon(Emerald Rapids) + DDR5, 로컬 NVMe **최대 45TB**, 네트워크 최대 100 Gbps `[확인됨]`. AWS는 이전 세대 i4i 대비 실시간 스토리지 성능 ~50%↑·I/O 지연 ~50%↓를 주장한다 `[벤더]`.

로컬 NVMe 성능의 결정적 사실: **3.75TB Nitro SSD 드라이브 1개 = random read 600,000 IOPS / write 330,000 IOPS**(4KB 블록, 큐 깊이 포화) `[확인됨]`. 총 IOPS는 드라이브 수에 **완전 선형**으로 증가한다. 요금도 vCPU당 단가가 사이즈 전체에서 동일해 가격 페널티 없이 필요한 NVMe·RAM으로만 사이즈를 고르면 된다.

| 사이즈 | vCPU | Mem(GiB) | 로컬 NVMe | random read/write IOPS | $/hr(OD) | $/mo(×730) |
|---|---|---|---|---|---|---|
| i7i.large | 2 | 16 | 1×468 GB | 75,000 / 41,250 | $0.1888 | $138 |
| i7i.xlarge | 4 | 32 | 1×937 GB | 150,000 / 82,500 | $0.3775 | $276 |
| i7i.2xlarge | 8 | 64 | 1×1,875 GB | 300,000 / 165,000 | $0.7550 | $551 |
| i7i.4xlarge | 16 | 128 | 1×3,750 GB | **600,000 / 330,000** | $1.5101 | $1,102 |
| i7i.8xlarge | 32 | 256 | 2×3,750 GB | 1,200,000 / 660,000 | $3.0202 | $2,205 |
| i7i.12xlarge | 48 | 384 | 3×3,750 GB | 1,800,000 / 990,000 | $4.5302 | $3,307 |
| i7i.16xlarge | 64 | 512 | 4×3,750 GB | 2,400,000 / 1,320,000 | $6.0403 | $4,409 |
| i7i.24xlarge | 96 | 768 | 6×3,750 GB | 3,600,000 / 1,980,000 | $9.0605 | $6,614 |
| i7i.48xlarge | 192 | 1,536 | 12×3,750 GB (45TB) | 7,200,000 / 3,960,000 | $18.121 | $13,228 |

*(사양·IOPS `[확인됨]`, us-east-1 on-demand 요금 `[확인됨]`, 2026-07 시점. metal-24xl/48xl은 각각 24xl/48xl과 동일 스펙.)*

순차(sequential) 대역은 random 4K보다 높다 — PostHog는 4×7.5TB NVMe RAID10에서 **쓰기 ~1,000 MB/s + 읽기 ~4,000 MB/s 동시 달성**을 실측했고 "어떤 EBS 조합으로도 불가능"이라 평했다 `[확인됨]`. 즉 i7i.4xlarge 단일 노드만으로도 random 4K ~2.46 GB/s `[추정]`, 대형 노드는 수십 GB/s 대역이 나온다.

**i8g 우선 권고.** i8g는 **Graviton4 + 동일한 3세대 Nitro SSD**라 **드라이브당 IOPS가 i7i와 완전히 동일**(3.75TB당 600,000/330,000)하면서 **동일 사이즈 기준 ~9% 저렴**하다 `[확인됨]`(i8g.8xlarge $2.7456 vs i7i.8xlarge $3.0202). ClickHouse는 ARM64 바이너리를 제공하고 "클럭보다 코어 수"를 선호해 Graviton 궁합이 좋다. 성능/달러가 명백히 i8g 우위이므로 **기본은 i8g**로 간다.

| 인스턴스 | 아키텍처 | 드라이브 | 드라이브당 read/write IOPS | 언제 |
|---|---|---|---|---|
| **i8g** | Graviton4(ARM64) | 3.75 TB | **600,000 / 330,000** | **기본 후보** — IOPS 동률, ~9% 저렴 |
| **i7i** | Intel x86 | 3.75 TB | 600,000 / 330,000 | x86 의존(사이드카·에이전트 바이너리) 있을 때 |
| **i7ie / i3en** | Intel x86 | 7.5 TB / 대용량 | TB당 IOPS는 i7i/i8g보다 낮음 | 초고밀도(45~60TB+/노드)가 목적일 때만 |

주의: i7ie는 7.5TB 드라이브라 용량 밀도는 높지만 **TB당 IOPS 밀도는 i7i/i8g보다 낮다** `[확인됨]`. 초고밀도 저장이 목적일 때만 i7ie/i3en을 쓰고, **IOPS 성능 극대화가 목적이면 i7i/i8g**가 맞다. i8g는 최대 22.5TB/노드로 i7i(45TB)보다 밀도 상한이 낮다는 점도 사이즈 계획에 반영한다 `[확인됨]`.

## 휘발성을 복제로 덮는다 — 내구성 3종 세트

로컬 NVMe는 인스턴스 stop/terminate/하드웨어 장애 시 **데이터가 영구 소실**된다. 그래서 로컬 NVMe 전략을 채택하는 순간 아래 3종 세트는 **선택이 아니라 전제**다.

1. **멀티 AZ replica 2~3개(shard당).** ReplicatedMergeTree(RMT)에서 각 replica가 데이터 파트 전체 사본을 보유하고 Keeper로 조정한다 — 단일 노드 로컬 디스크 소실을 복제가 방어한다 `[확인됨]`. k8s에서는 pod anti-affinity(hostname) + topologySpreadConstraints(zone)로 replica를 AZ에 분산한다. "멀티 AZ 복제는 모든 설치의 기본"이다.
2. **clickhouse-backup → S3(주간 full + 일간 incremental, shard별).** Altinity clickhouse-backup이 사실상 표준이다 `[확인됨]`. 단 **incremental 체인은 fragile** — 이전 백업 전체 체인에 의존하므로 하나라도 손상되면 이후 복구 불가다. S3 lifecycle로 base를 Glacier에 넣으면 체인이 붕괴하니 lifecycle 규칙과 정기 restore drill을 직접 소유해야 한다.
3. **Keeper 3(최소)/5(HA) 노드, 멀티 AZ, 전용 노드.** 조율 계층이 소실되면 메타데이터 복구가 번거로우므로 **Keeper 데이터만은 gp3(영속) 디스크**에 둔다 `[확인됨]`. Keeper는 소량 데이터라 4GB RAM·gp3로 충분하고, AZ 간 round-trip이 50ms를 넘으면 replication throughput이 악화되니 지연을 확인한다.

**zero-copy replication은 프로덕션 금지다.** 22.8+부터 기본 비활성이며, mutation 중 데이터 손실(#39560)·merge 중 손상·TTL 이동 시 NOT_ENOUGH_SPACE·Keeper 부하 증가 등 이슈가 다수 보고됐다 `[확인됨]`. S3 tier를 쓰더라도 이 기능에 의존하지 말고, **각 replica가 자기 경로에 독립 저장하는 표준 RMT 복제**를 유지한다. (self-host가 SharedMergeTree를 못 쓴다는 제약과 그 배경은 [Managed vs Self-hosted]({{< relref "01-managed-vs-selfhosted.md" >}}) 참고.)

## 로컬 PV를 k8s에 얹기

**instanceStorePolicy: RAID0 (필수 첫 단추).** Karpenter EC2NodeClass에 `instanceStorePolicy: RAID0`를 설정하면 노드의 로컬 NVMe들이 자동으로 RAID0(`/dev/md/0`, 마운트 `/mnt/k8s-disks/0`)로 묶인다. **이 설정이 없으면 Karpenter가 instance-store를 스케줄링에서 아예 고려하지 않는다** `[확인됨]`. Bottlerocket은 Karpenter v1.1.0+부터 자동 구성된다.

그 위에 local PV provisioner를 얹는다. 공통적으로 로컬 스토리지는 **데이터 경로 오버헤드가 없어(컨테이너 없이 직접 쓰는 것과 동일 throughput)** 성능은 좋지만, **노드 장애 = 해당 볼륨/데이터 소실**이라는 성질은 도구가 바꿔주지 않는다 — 내구성은 위 3종 세트가 담당한다.

| 도구 | 방식 | 스냅샷/LVM | 특징 |
|---|---|---|---|
| **Rancher local-path-provisioner** | hostPath 디렉토리 | 없음 | 가장 단순. RAID0 base(`/mnt/k8s-disks/0`) 위에 바로 |
| **OpenEBS Hostpath LocalPV** | `/var/openebs/local` 하위 | 없음 | 설치 즉시 OOB, 오버헤드 없음 |
| **OpenEBS LVM LocalPV** | 노드 LVM VG에서 LV | **LVM 스냅샷/thin** | 여러 NVMe를 VG로 묶고 PV 동적 할당·온라인 확장 |
| **TopoLVM** | LVM + 용량 인식 스케줄링 | LVM | 용량 aware 스케줄링이 필요할 때 |

권고 `[추정]`: 가장 단순하게는 **local-path-provisioner**(RAID0 base 위), **용량 인식 스케줄링·LVM 유연성**이 필요하면 **TopoLVM 또는 OpenEBS LVM LocalPV**. Altinity operator는 local StorageClass + node affinity를 지원하지만 노드 소실 재수화는 operator가 해결하지 않으므로 replica·백업 설계는 여전히 사용자 몫이다(operator 상세는 [clickhouse-operator]({{< relref "03-operator.md" >}})).

## Karpenter가 노드를 지우는 문제

로컬 NVMe 노드에서 가장 위험한 것은 하드웨어 장애가 아니라 **Karpenter consolidation**이다. consolidation은 pod request만 보고 팩킹하므로 **데이터 지역성·스토리지 제약을 무시하고 노드를 없앨 수 있다** — 로컬 스토리지 워크로드에 특히 치명적이다 `[확인됨]`. 게다가 `karpenter.sh/do-not-disrupt` 애노테이션은 **voluntary disruption만 방지**하고 **expiration·Spot interruption·수동 삭제는 우회한다** `[확인됨]`.

방어 조합:

- ClickHouse 데이터 pod에 `do-not-disrupt` + `consolidationPolicy: WhenEmpty`(또는 `consolidateAfter`를 10분+로 길게).
- **On-Demand / Savings Plan 사용, Spot 데이터 노드 금지** — Spot 중단 → 노드 종료 → 로컬 NVMe 전소 → replica 재수화 비용이 할인분을 초과한다. (요금·SP 할인은 [Managed vs Self-hosted]({{< relref "01-managed-vs-selfhosted.md" >}}))
- 노드 **expiration 비활성 또는 매우 길게**, PDB `maxUnavailable: 1`, disruption budget으로 rate limit.
- taint(`dedicated=clickhouse:NoSchedule`) + toleration으로 전용 NodePool 격리, Keeper는 별도 소형 NodePool(gp3).
- **완전 안정성 우선이면 Karpenter 대신 고정 ASG/노드그룹 + local PV**로 ClickHouse만 별도 운용한다 — 노드 IP·디스크 안정성이 올라간다. Karpenter의 탄력성보다 stateful 안정성이 중요하다면 이쪽이 정답이다.

## 노드 소실과 재수화

노드가 소실되면 그 노드의 로컬 NVMe 데이터는 사라지고, ClickHouse는 healthy replica에서 데이터를 다시 당겨온다(rehydration).

- **부분 복구**: replica가 잠깐 빠졌다 복귀하면 lag를 감지해 누락 파트만 fetch하고, 로컬에 남아있던 파트는 재다운로드 없이 re-attach한다 `[확인됨]`. 수동으로는 `SYSTEM RESTART REPLICA` / `SYSTEM SYNC REPLICA`.
- **완전 소실**(로컬 NVMe 전소한 신규 노드): 전체 데이터를 healthy replica에서 재전송한다. 소요 ≈ (노드 데이터량) / (네트워크 대역). 예: 10TB를 25Gbps 링크로 → 이론상 ~1시간, 실전은 압축 해제·머지·디스크 쓰기로 **수 시간** `[추정]`.
- **TB당 정확한 재수화 시간은 공식 수치가 없다** `[미확인]` — 인프라·네트워크·머지 부하에 의존하므로 실환경 측정이 필수다.

이것이 "로컬 스토리지를 얼마나 크게 가져갈 수 있나"의 실질 상한이다. **노드당 데이터를 너무 크게(예: 45TB) 채우면 재수화가 길어지고 그동안 redundancy가 줄어든다.** 45TB 노드 하나를 통째로 재수화하는 동안 남은 replica가 하나뿐이면 그 shard는 위태롭다. 따라서 **노드당 데이터량과 replica 수의 균형**이 설계의 핵심이다 — shard를 늘려 노드당 데이터를 줄이면 재수화가 빨라지고 병렬 복구도 쉬워진다. "45TB i7i.48xlarge 몇 대"보다 "적당 용량 노드를 shard로 넓게 편" 구성이 재수화 관점에서 안전하다.

## 참조 아키텍처

스토리지 관점의 참조 배치(조사 §4.3에서 발췌):

```
AWS EKS
├─ NodePool: clickhouse-data (Karpenter, do-not-disrupt, On-Demand/1yr SP)
│   ├─ i8g.4xl~8xl (또는 i7i) — instanceStorePolicy: RAID0 → /mnt/k8s-disks/0
│   ├─ taint dedicated=clickhouse:NoSchedule
│   ├─ local-path 또는 TopoLVM → local PV
│   └─ ClickHouse (Altinity operator, ReplicatedMergeTree)
│       ├─ shard N × replica 2~3 (AZ 분산, anti-affinity + topologySpread)
│       └─ storage_policy: hot=로컬 NVMe → cold=S3 (TTL MOVE)
├─ NodePool: clickhouse-keeper
│   └─ 소형 노드 × 3 (멀티 AZ), Keeper 데이터 = gp3(영속)
└─ 백업: clickhouse-backup → S3 (주간 full + 일간 incremental, shard별)
```

관측성의 대량 ingest가 분석 쿼리 지연을 오염시키지 않도록, 쿼리 패턴·보존정책이 다르면 **관측성용과 범용 분석용을 별도 클러스터(또는 shard/DB)로 분리**한다.

## 우리 케이스에서는

**전제 차이부터 분명히 한다.** 로깅 챕터([우리 케이스 · 권장안]({{< relref "../logging/08-recommendation.md" >}}))는 **로그 내재화 관점**이라 로그 1차 저장은 VictoriaLogs(D1/D2), 메트릭은 VM, ClickHouse 통합(D4)은 "여러 신호를 한 팀에 수렴시킬 명분이 섰을 때 earn it last"로 미룬다 — 신호 하나만 내재화하면 인건비가 절감을 상쇄하기 때문이다. 반면 이 조사는 **RUM 대체 + 범용 분석 + 이미 인력을 보유했다는 전제**에서 출발한다. 이 페이지의 로컬 NVMe 스토리지 청사진은 **그 D4가 실제로 발동됐을 때(RUM 웹 코어 + 범용 분석이 같은 CH·같은 팀에 얹히는 상황)의 저장소 설계도**이지, 로그를 VictoriaLogs에서 CH로 옮기라는 말이 아니다. 두 결론은 층위가 달라 모순되지 않는다 — 로그 1차 = VictoriaLogs, 모바일 RUM = Datadog 잔류는 그대로 유지된다.

그 전제 위에서, 이 조사의 권고를 스토리지 주제로 좁히면:

- **인스턴스: i8g 우선.** i7i와 IOPS가 동률이고 ~9% 저렴하며 ClickHouse ARM64 궁합이 좋다. x86 의존 바이너리가 있으면 i7i, 초고밀도가 목적이면 i7ie/i3en.
- **성능은 살 수 있다.** 원하는 수 GB/s·수십만 IOPS는 EBS로는 물리적으로 불가능하지만 로컬 NVMe로는 스토리지 한계비용 $0에 얻는다 — "로컬 스토리지를 크게"라는 요구의 물리적 해답은 로컬 NVMe self-host뿐이다.
- **내구성은 3종 세트로 산다.** 멀티 AZ replica 2~3 + clickhouse-backup(S3, 주간full·일간incr) + Keeper(gp3 영속). zero-copy replication은 금지.
- **"크게"의 상한은 재수화가 정한다.** 노드당 데이터량과 replica 수의 균형, shard 확장으로 재수화 시간을 관리하고, TB당 재수화 시간은 스테이징에서 반드시 실측한다 `[미확인]`.
- **Karpenter는 길들여서 쓰거나 고정 ASG로 대체한다.** do-not-disrupt(voluntary만 방지임을 인지) + On-Demand/SP + Spot 데이터 노드 금지 + PDB. 안정성이 최우선이면 고정 ASG.

이 스토리지 결정이 managed와 어떻게 갈리는지, 달러 TCO 크로스오버는 [Managed vs Self-hosted]({{< relref "01-managed-vs-selfhosted.md" >}}), operator 운영은 [clickhouse-operator]({{< relref "03-operator.md" >}})에서 이어진다.
