---
title: "개요 — 아키텍처·운영·규모 산정 로드맵"
weight: 0
---

# 개요 — 아키텍처·운영·규모 산정 로드맵

이 문서는 HyperDX 내재화 카테고리에 흩어진 10개 문서를 **"읽는 순서와 큰 그림"** 으로 묶는 로드맵이다. 각 주제의 세부 정본(매니페스트·DDL·다운타임 타임라인·달러 산식)은 링크된 문서에 그대로 있고, 이 문서는 그것들을 **어떤 순서로, 왜 그 순서로 읽어야 하는지**만 세운다 — 재서술이 아니라 서사의 뼈대다.

이 로드맵을 관통하는 원칙은 하나다: **각 결정마다 "왜 그렇게 하나"와 "어떻게 안전한가"를 함께 본다.** 스토리지 한 장, 토폴로지 한 장을 고를 때 성능·비용만 보지 않고, 그 선택이 장애·다운타임·데이터 유실 앞에서 어떻게 버티는지를 같은 호흡으로 확인한다. 6부는 그 원칙을 따라 **"무엇이 구현돼 있나(1) → 데이터를 어떻게 나누나(2) → 무엇을 관리하나(3) → 클러스터 위 운영은 왜 어렵나(4) → 얼마나 필요한가(5) → 무엇을 언제 고르나(6)"** 로 흐른다.

{{< callout type="info" >}}
**한눈에 — 이 로드맵의 6단계**

1. **솔루션 아키텍처**: ClickStack 4컴포넌트를 `clickhouse.enabled:false`(BYO)로 조립해 CH/Keeper만 Altinity CHI/CHK로 분리한다 — 무엇이 어떻게 구현돼 있나.
2. **데이터 티어링**: hot(EBS gp3) / cold(S3 TTL MOVE), 리플레이는 hot만 — hot/cold를 어떻게 나누나.
3. **컴포넌트별 가용성·운영**: 어느 하나가 죽으면 무엇이 멈추나(blast radius)와 무손실 2트랙 — 무엇을 어떻게 관리하나.
4. **operator 패턴**: 클러스터 위 운영(복제·다운타임·Keeper 정족수·업그레이드)이 왜 어렵고, EBS-first가 어떻게 난이도를 낮추나.
5. **규모 산정**: 0.7TB/월 워크드 모델(압축비·hot/cold·RF·비용)을 계산식으로 — 얼마나 필요한가.
6. **의사결정 가이드**: 무엇을 언제 고르고 왜 안전한가 + 배포 전 실측 체크리스트 — 종합.
{{< /callout >}}

## 1. 솔루션 아키텍처 — 무엇이 어떻게 구현돼 있나

이 스택은 ClickStack 4컴포넌트 — **HyperDX(app+api) · OTel Collector · ClickHouse · MongoDB** — 로 이뤄지지만, 우리는 표준 2-Helm 차트를 그대로 얹지 않는다. `clickhouse.enabled: false`(**BYO**)로 ClickHouse/Keeper를 차트 밖으로 빼 **Altinity operator의 CHI/CHK**로 분리 운영하고, HyperDX·OTel Collector·MongoDB만 차트/operator로 남긴다. 표준 차트가 딸려오는 ClickHouse Inc. 공식 operator를 끌어들이지 않아, 관측성용 CH를 범용분석 CH와 하나의 운영 체계로 일원화하는 것이 이 조립의 핵심이다 `✓`.

데이터 흐름에서 반드시 붙잡을 사실은 **RUM 인제스트 경로에 MongoDB가 없다**는 것이다. 브라우저 SDK는 HyperDX api가 아니라 OTel Collector(`:4318`)로 직접 텔레메트리를 보내고, 세션 리플레이는 ClickHouse `hyperdx_sessions` 테이블로 적재된다. MongoDB는 사용자가 UI에서 대시보드·알럿·소스를 만들 때만 쓰인다.

**왜 안전한가**: 컴포넌트 경계가 분리돼 있어 ingest 경로(브라우저 → Collector → CH)에 메타스토어(Mongo)가 끼지 않는다 — MongoDB가 흔들려도 관측 데이터 적재는 멈추지 않는다. BYO 분기로 CH 운영 표면을 하나로 모아, 뒤 페이지들의 CHI 매니페스트가 표준 install과 모순 없이 읽힌다. 조립 구조·컴포넌트 역할·포트·의존·데이터 흐름의 정본은 → {{< relref "01-stack-topology.md" >}}.

## 2. 데이터 티어링 — hot/cold를 어떻게 나누나

hot 데이터의 정답은 **노드당 단일 gp3 볼륨**(baseline IOPS + 인스턴스 baseline에 맞춘 소량 provisioned throughput)이다. ClickHouse는 throughput-bound이고 인스턴스 EBS 파이프가 볼륨보다 먼저 천장이라, 0.7TB/월엔 gp3를 80,000 IOPS/2,000 MiB/s까지 올릴 이유도 스트라이핑할 이유도 없다. io2 Block Express는 극한 IOPS·sub-ms·볼륨 99.999%가 걸릴 때만 각주다 `✓/≈`. cold는 **S3 Standard + cache disk**에 **시간 기반 TTL `TO VOLUME 'cold'`** 로 내린다(`move_factor=0.1`은 안전판).

RUM 테이블별 TTL이 이 티어링의 실체다: `otel_logs`/`otel_traces`는 hot 14일→S3→지평별 DELETE, `otel_metrics_*`는 hot 30일→S3, 그리고 **`hyperdx_sessions`(세션 리플레이)는 S3에 내리지 않고 hot만·30일 DELETE**로 끝낸다 — 리플레이는 볼륨을 지배하지만 유용 수명이 짧아 S3 이전이 순비용이기 때문이다. S3를 아예 쓰지 않는 **block-only 대안**(짧은 보존·staging·운영 단순성)도 열어둔다.

**왜 안전한가**: **티어링 ≠ 내구성**이다 — 데이터 내구성은 복제(RF)+백업이 담당하지 티어가 담당하지 않는다. cold(S3)도 replica마다 사본을 두므로 **RF배수**로 저장되고(UltraWarm식 단일사본 절감은 self-host에서 성립 안 함), **zero-copy replication은 프로덕션 금지**다. hot(EBS)·cold(S3) 정본은 → {{< relref "02-hot-storage-ebs.md" >}}·{{< relref "03-s3-cold-tiering.md" >}}, block-only 변형은 → {{< relref "04-block-only-tuning.md" >}}.

## 3. 무엇을 어떻게 관리하나 — 컴포넌트별 가용성·운영

1부가 "무엇이 있나"라면, 3부는 그것들을 **가용성 한 장**으로 종합한다: 컴포넌트마다 (a)무슨 역할인지, (b)죽으면 무엇이 멈추는지, (c)HA·스케일이 되는지, (d)데이터를 어떻게 무손실로 지키는지다. 핵심 판단은 **"어느 하나가 죽어도 전체 관측이 정지하지는 않는다"** 이다 — app 다운은 UI·쿼리만, Collector 다운은 신규 ingest만, MongoDB 다운은 설정·알럿·UI만 멈춘다. 광범위한 정지는 **CH 전체 다운**(저장 원천)과 **Keeper 정족수 상실**(쓰기 경로 SPOF)뿐이다 `Σ`.

무손실 방어는 **성격이 다른 두 트랙**으로 갈린다. 이걸 뭉뚱그리면 "Keeper가 데이터를 지킨다" 같은 오해가 생긴다. **트랙 1(텔레메트리, 대량·스트리밍)**: OTel Collector `file_storage` persistent queue → ClickHouse RMT 복제 + `insert_quorum` + 백업. **트랙 2(메타데이터, 소량·문서)**: MongoDB ReplicaSet(`members:3`) + `mongodump` 백업. 두 트랙의 내구성 메커니즘은 완전히 다르고, Keeper 정족수는 트랙 1의 **쓰기 가용성**만 좌우할 뿐 이벤트 데이터를 보관하지 않는다.

**왜/어떻게 안전**: 스케일 축도 컴포넌트마다 달라서, app·Collector는 수평 replica로 처리량을, CH replica·Keeper·Mongo는 복제로 가용성을 얻는다 — 이 스케일에서 늘려야 할 것은 가용성용 replica이지 용량용 shard가 아니다. 가용성 매트릭스·blast radius·무손실 2트랙의 정본은 → {{< relref "01-stack-topology.md" >}}(§7), 조정 계층은 → {{< relref "06-keeper.md" >}}, 복제·failover는 → {{< relref "07-replication-failover.md" >}}.

## 4. operator 패턴을 얹기 — 클러스터 위 운영 난이도

여기서부터 솔직하게 짚는다: **클러스터 위 운영은 어렵다.** Altinity CHI/CHK로 replication/sharding을 얹으면 다운타임 시나리오(설정 reconcile·롤링 업그레이드·노드 재부팅·재스케줄·AZ 장애·ungraceful death), 멀티마스터 복제의 의미론, Keeper 정족수, 버전/업그레이드가 전부 운영 표면으로 들어온다. 특히 조심할 두 지점은 **Keeper 정족수 상실 = 쓰기 SPOF**(데이터 노드가 멀쩡해도 조정 계층 과반 상실만으로 INSERT/DDL이 read-only로 전락)와 **ungraceful node death의 무한 Terminating**(StatefulSet+RWO는 자동 복구 안 됨, `out-of-service` taint 개입이 정석)이다.

그런데 **EBS-first가 이 난이도를 근본적으로 낮춘다.** 로컬 NVMe라면 "노드 유실 = 전량 재수화(수 시간, RF2→실질 RF1)"인 것이, EBS에선 볼륨이 노드와 독립적으로 살아남아 "reattach + 델타 catch-up(수 분, RF 온전)"이 된다. 멀티마스터라 replica 하나가 죽어도 **승격(promotion) 절차 자체가 없다** — 살아있는 replica가 read+write를 그대로 계속한다.

**어떻게 안전**: EBS reattach로 노드 레벨 재수화가 불필요해지고, `RF2 + anti-affinity(hostname) + topologySpread(AZ) + PDB(maxUnavailable 1)`로 동시 하락을 직렬화하며, **Keeper 3노드 정족수**(1 장애 허용)로 쓰기 가용성을 사수하고, 업그레이드는 **EBS 스냅샷 + `clickhouse-backup` 이중 안전**으로 되돌린다(다운그레이드는 포맷 변경 이후 불가하므로 "없다고 가정"). 단 EBS는 AZ-bound라 **AZ 장애는 reattach로 못 풀고 cross-AZ RF만이 방어**하는 것은 로컬 NVMe와 수렴한다. 다운타임·복구 정본은 → {{< relref "05-operator-topology-downtime.md" >}}, Keeper는 → {{< relref "06-keeper.md" >}}, 복제·멀티마스터는 → {{< relref "07-replication-failover.md" >}}, 버전·업그레이드는 → {{< relref "08-version-upgrade-compat.md" >}}, 일반 operator 운영 런북은 → {{< relref "../clickhouse/05-altinity-operations.md" >}}.

## 5. 규모 산정 — 계산식과 정리

캐파의 첫 갈림길은 **"월 0.7TB가 raw ingest인가 on-disk(압축 후)인가"** 다 — 이 해석에 배포 규모·비용이 2~3배 갈린다. 본 로드맵은 블렌디드 압축비 **~6.0x**(시그널별 압축비를 raw 구성비로 가중)로 환산한 on-disk 해석 B를 1차 모델로 삼고, 배포 후 `system.parts`로 1회 실측해 확정한다 — 가중 산식의 유도·시그널별 압축비(리플레이 ~5x·로그/트레이스 ~10x·메트릭 ~8x) 정본은 → {{< relref "09-capacity-planning.md" >}}.

여기서 캐파의 단일 최대 지렛대가 드러난다: on-disk의 ~78%를 지배하는 **세션 리플레이가 hot 30일에서 잘리고 S3로도 안 가 누적되지 않는다.** 그래서 "0.7TB × 12 = 8.4TB" 순진한 누적은 틀리고, 1년 실제 누적(단일사본)은 **~2.35TB** — 차이 ~6TB가 전부 "안 쌓이는 리플레이"다. hot·컴퓨트는 지평 무관 고정(hot gp3 ~2TB, 2× r7g.2xlarge)이고, 3→12개월 증분은 거의 전부 싼 S3 cold($9→$79/mo)다.

**왜 안전/충분한가**: 인제스트 피크 ~8 MB/s는 `<1 vCPU` 수준이라 **1 shard × RF2로 1년+ 충분**하고 gp3로 충분하다(io2 트리거 미도달). Keeper 3노드·MongoDB 3멤버는 데이터량과 무관하게 소형 고정이다. prod 월 **~$1.0K**(us-east-1, RF2 12개월), RF3 시 ~$1.5K, 서울 +10~15%. 워크드 모델·계산식·비용의 정본은 → {{< relref "09-capacity-planning.md" >}}.

## 6. 의사결정 가이드 — 무엇을 언제 고르고, 왜 안전한가

앞 5부의 결정을 한 장으로 모은다. 각 축의 기본값은 **"작게 시작하고 트리거로 승급"** 원칙을 따른다 — 0.7TB/월 규모에서 조기 수평 확장·고성능 스토리지·과도한 복제는 비용과 운영 부채만 남기기 때문이다.

| 축 | 기본 결정 | 왜 안전/충분한가 | 승급 트리거 |
|---|---|---|---|
| 배포 | HyperDX-only(BYO) + Altinity CHI/CHK | 공식 operator 회피·CH 운영 일원화, ingest 경로에 Mongo 없음 `✓` | — |
| hot 스토리지 | 단일 gp3(baseline + 소량 throughput) | throughput-bound·인스턴스 파이프가 먼저 천장, 99.9% + RF로 충분 `✓/≈` | io2: >2,000 MiB/s·>80,000 IOPS/vol·99.999% 규제 |
| cold 티어링 | S3 Standard + TTL MOVE(또는 block-only) | 티어링≠내구성(복제+백업), cold도 RF배수·zero-copy 금지 `✓` | block-only: 짧은 보존(≤90일)·S3 미접근 |
| 토폴로지 | 1 shard × RF2(2 AZ) | shard는 부채, EBS reattach라 노드 급사≠데이터 소실 `≈` | RF3: AZ 무저하·`insert_quorum:2` 상시 / shard: 노드 상한 접근 |
| 조정 | Keeper 3노드(gp3 영속, 3 AZ) | 정족수 3=1 장애 허용, Raft 메타 EBS 생존 `✓` | 5노드: 2 장애 허용 필요 시 |
| MongoDB | 최소(`members:3`) 또는 Atlas | 부하∝설정 수·적재량 무관, ingest 경로 밖 `≈` | Atlas M10: 백업 공백 위임 |
| 업그레이드 | LTS(24.8) 핀 + EBS 스냅샷 롤백 | 다운그레이드는 포맷 이후 불가 → 스냅샷/백업이 유일 롤백 `✓` | — |

{{< callout type="warning" >}}
**배포 전 실측 체크리스트** — 아래는 전부 현재 `?`이며, staging에서 `✓`으로 승격하는 것이 이 배포의 1번 과제다.

1. **"월 0.7TB"가 raw인가 on-disk인가** — `system.parts`로 1회 실측(배포 규모 2~3배 좌우) `?` → {{< relref "09-capacity-planning.md" >}}
2. **세션 리플레이 압축비**(모델 기본 5x, 공개 실측 부재) — staging에서 `data_uncompressed_bytes / bytes_on_disk` 측정 `?`
3. **ClickStack 기본 TTL**(`${TABLES_TTL}` 단일값 vs 신호별) — `SHOW CREATE TABLE`로 실제값 확인 `?` → {{< relref "03-s3-cold-tiering.md" >}}
4. **EBS reattach + CH part-load 실소요** — 노드 drain·강제 종료 리허설로 실측, `reconcile.statefulSet.update.timeout` 튜닝 `?` → {{< relref "05-operator-topology-downtime.md" >}}
{{< /callout >}}

전체 결정 매트릭스의 정본은 → {{< relref "05-operator-topology-downtime.md" >}}(토폴로지)·{{< relref "09-capacity-planning.md" >}}(사이징·비용)·{{< relref "08-version-upgrade-compat.md" >}}(버전 핀)이며, io2/RF3/shard/block-only 승급 판단은 각 문서의 트리거 절을 따른다.

## 권장 읽기 순서

이 로드맵의 6부를 실제 문서 순서로 매핑하면 다음과 같다. 아키텍처(1부)에서 시작해 티어링(2부) → 클러스터 운영(4부) → 사이징(5부)으로 좁혀 읽는 것을 권한다. 2부 안에서는 본문 강조 순서를 따라 hot 스토리지(02)를 먼저 확정하고 그 위에 cold TTL(03, 티어링의 실체)을 얹는 순으로 읽는다.

| 순서 | 문서 | 이 로드맵의 어느 부 | 한 줄 |
|---|---|---|---|
| 1 | {{< relref "01-stack-topology.md" >}} | 1부 아키텍처 · §7=3부 관리 | 4컴포넌트 배치·BYO 분기·데이터 흐름(RUM은 Mongo 안 거침) |
| 2 | {{< relref "02-hot-storage-ebs.md" >}} | 2부(티어링) | hot=단일 gp3, io2 각주, 인스턴스 파이프가 천장 |
| 3 | {{< relref "03-s3-cold-tiering.md" >}} | 2부(티어링) | TTL 정본·storage_configuration·IRSA — 티어링의 실체 |
| 4 | {{< relref "04-block-only-tuning.md" >}} | 2부(티어링) | S3 없는 EBS 단일 티어 대안(짧은 보존·staging) |
| 5 | {{< relref "05-operator-topology-downtime.md" >}} | 4부(operator 패턴) | EBS 재부착이 바꾸는 복구 모델·다운타임 시나리오 S1~S9 |
| 6 | {{< relref "06-keeper.md" >}} | 4부(operator 패턴) | Keeper는 조정 계층이지 durable queue가 아니다 |
| 7 | {{< relref "07-replication-failover.md" >}} | 4부(operator 패턴) | 멀티마스터·승격 없는 failover·split-brain 방지 |
| 8 | {{< relref "08-version-upgrade-compat.md" >}} | 4부(operator 패턴) | 6구성요소 호환 매트릭스·다운그레이드 비지원·EBS 스냅샷 롤백 |
| 9 | {{< relref "09-capacity-planning.md" >}} | 5부(규모 산정) | 0.7TB/월 워크드 모델·계산식·3/6/12개월 비용 |
| 10 | {{< relref "10-sources.md" >}} | 전체 | 1차 출처 URL 모음(분류 표) |

> **3부(무엇을 어떻게 관리)는 별도 문서가 아니라 01의 §7(컴포넌트별 가용성)이므로, 01을 읽을 때 함께 본다.** 위 표 01 행의 "§7=3부 관리" 표기가 이를 가리킨다.

> **6부(의사결정 가이드)는 전용 문서가 없다** — 04·07·09의 결정을 이 로드맵 §6에서 한 장으로 종합하는 층이기 때문이다. 위 표의 10개 행은 1~5부에 대응하며, 6부는 그 위에 얹히는 종합 챕터다.

## 우리 케이스에서는

**HyperDX-only(BYO) + Altinity CHI/CHK + MongoDB(MCK 또는 Atlas)** 로 조립하고, hot은 **단일 gp3**, cold는 **S3 + TTL MOVE**, 조정은 **Keeper 3노드**, 토폴로지는 **1 shard × RF2(2 AZ)** 로 시작한다. io2·RF3·shard·block-only는 전부 **트리거 기반 승급**으로 미뤄두는 것이 0.7TB/월 규모의 정답이다.

이 로드맵의 뼈대는 "각 결정을 성능·비용만이 아니라 **장애 앞에서 어떻게 안전한가**와 함께 본다"는 것이다 — EBS reattach로 재수화를 없애고, RF·anti-affinity·PDB·Keeper 정족수로 가용성을 사고, 티어링과 내구성을 분리하며, 리플레이 TTL로 캐파를 잡는다. 세부 정본은 위 11개 문서에 있으니, 이 문서는 그 지도로만 쓴다. 배포 전 실측 체크리스트 4건(0.7TB 해석·리플레이 압축비·기본 TTL·reattach 실소요)은 전부 `?`이며 staging에서 `✓`으로 승격하는 것이 착수 1번 과제다. 시점 기준 2026-07.

> **근거 표기 범례**: `✓` 확인됨(1차 출처 검증) · `≈` 추정 · `Ⓥ` 벤더 주장 · `?` 미확인 · `Ⓑ` 퍼블릭 벤치마크 · `Σ` 종합 판단. `⁽ ⁾`는 부가 설명, `✓/≈`처럼 병기하면 혼재를 뜻한다.
