---
title: "권장안·하지 말 것"
weight: 8
---

# 08 · 권장안(VM OSS 아카이브) 종합 근거 · 업계 선례 · 하지 말 것 10선

400d 보관 결정의 최종 종합이다. VM 아카이브안을 왜 권장하는지의 근거를 한자리에 모으고, 업계 선례로 패턴을 뒷받침하며, 검증에서 기각된 함정 10개와 진행 전 드라이런 2주 실측 목록을 정리한다.

> 관련 블록: [02 VM 아카이브 상세]({{< relref "02-vm-archive.md" >}}), [07 핵심논점·비용종합·판단트리]({{< relref "07-streamaggr-vs-downsampling.md" >}}), [06 스토리지 단가]({{< relref "06-storage-pricing.md" >}}), [01 문제·2축]({{< relref "01-problem-and-axes.md" >}})

## 1. 권장: VM OSS 아카이브안 — 라우터 RW#4 + streamAggr 5m → vmsingle-archive 400d

핵심 논점(사전집계 vs 사후집계)과 비용 종합표는 [07번]({{< relref "07-streamaggr-vs-downsampling.md" >}})이 주인이다. 여기서는 VM 아카이브안을 고른 근거만 종합한다.

| 선정 근거 | 내용 |
|---|---|
| **최저 저장비** | 시나리오 ② 월 **$385~416** (sc1). 4안 중 최저 — 단순 확장안($1,642) 대비 **~70% 절감**, Thanos안($780~1,200 + 컴퓨트)의 절반 이하이고 컴퓨트 차이는 더 벌어진다 |
| **가역적** | RW#4는 언제든 Thanos Receive로 갈아끼워 Thanos안으로 전환 가능. 드라이런에서 f가 예상을 크게 벗어나면 그 시점에 재평가 |
| **service 무상태·무영향** | 이미 설계한 라우터 vmagent 패턴에 RW#4로 자연 결합. **service 클러스터는 손대지 않아 무상태 원칙 유지** |
| **신규 기술 0** | 신규 stateful 컴포넌트 **1개(vmsingle)** — 그마저 기존과 동일 기술스택. 신규 기술 학습 0 |
| **MetricsQL 보존** | 아카이브도 VM이라 MetricsQL 그대로 유지. `keep_metric_names`로 기존 쿼리가 datasource만 바꾸면 동작 → 미확인 의존도 리스크 자체가 소멸 |

**잔여 리스크와 수용 근거**: 남는 리스크는 "확정 집계가 재조사에 부족할 가능성"이다. hot 90d raw가 최근 장애의 golden window를 담당하고, >90d 재조사는 추세·수준 비교가 주라는 전제에서 수용한다. 이 전제 때문에 **아카이브 검증 전 hot retention 축소는 금지**된다(§3-10).

**스토리지 클래스**: 본 분석의 sc1은 "최저가 옵션"일 뿐, **시작은 gp3(기본값)가 맞다.** 아카이브 볼륨이 작아(0.9~2.7 TiB) gp3 프리미엄이 월 $66~199 수준이므로 검증 기간엔 gp3로 안전하게 가고, 이후 IO 실측을 보고 st1/sc1 최적화를 판단한다. 단가·볼륨 선택 상세는 [06번]({{< relref "06-storage-pricing.md" >}}).

## 2. 업계 선례 — "장기 = 집계만"은 표준 패턴

VM 아카이브안의 "hot raw 단기 + 장기는 집계 tier"라는 계층화는 신규 발명이 아니라 대규모 운영에서 반복 확인된 패턴이다.

| 사례 | 규모·구성 | 시사점 |
|---|---|---|
| **Criteo** | 약 **10억 활성 시리즈**, VM cluster 계층화(고카디널리티·고churn은 단기 7d / 집계는 90d / 장기는 별도 클러스터 1y+) | 계층화로 자릿수 비용 절감을 자체 보고 — VM 아카이브안의 hot/아카이브 분리와 동형 |
| **Uber M3** | rollup 정책 1m/30d + **1h/5y** | "**장기 = 집계만**"이 장기 보관의 업계 표준임을 보여줌 |
| **MHI Vestas** | VM **13개월** retention 안정 운영 | VM 계열 장기 retention의 실운영 레퍼런스 |

이 선례들은 방향성 근거일 뿐 예산 산정 근거가 아니다. 비용 수치는 [07번 종합표]({{< relref "07-streamaggr-vs-downsampling.md" >}})와 [06번 단가]({{< relref "06-storage-pricing.md" >}})의 서울 실측치만 쓴다.

## 3. 하지 말 것 (검증에서 기각·경고된 사항) 10선

이 목록은 리서치 과정에서 "그럴듯하지만 검증 결과 틀렸거나 함정인" 것들이다. 각 항목은 400d 설계에서 반복적으로 나오는 오판이다.

| # | 하지 말 것 | 기각 근거 |
|---|---|---|
| 1 | **VM에 S3 primary/티어링 기대** | 메트릭 엔진의 쿼리 가능한 오브젝트 스토리지는 미출시·일정 미약속("VictoriaLogs 이후 검토" 발언과 #38 self-assign은 신호일 뿐). 로드맵 베팅으로 설계를 미루지 말 것 |
| 2 | **vmbackup을 "쿼리 가능한 아카이브"로 착각** | S3 백업은 콜드 사본 — 조회하려면 vmstorage/vmsingle을 정지하고 vmrestore로 전체 복원해야 한다. 재조사용 저장소가 될 수 없다 (→ [VM 챕터 07 vmbackup/vmrestore]({{< relref "../victoriametrics/07-operations-at-scale.md" >}})) |
| 3 | **Thanos downsampling을 "저장 절감" 수단으로 도입** | 공식 문서 명시: 공간 절감 없음, 해상도 공존 시 ~3x. 절감은 `--retention.resolution-raw` 단축에서만. 다운샘플링은 장기 쿼리 **속도** 장치다 |
| 4 | **Mimir를 5m 장기 tier로 선택** | 다운샘플링이 OSS/GEM 어디에도 없고 3.0에서도 없다. Adaptive Metrics는 Grafana Cloud 전용 (→ [04번]({{< relref "04-mimir.md" >}})) |
| 5 | **Thanos/Store Gateway가 읽는 버킷을 S3-IA/Glacier IR에** | GB당 리트리벌 수수료(IA $0.01 / GIR $0.03)가 쿼리·동기화마다 발생. IA/GIR는 vmbackup 사본 전용 |
| 6 | **Thanos Receive를 service 클러스터에** | hashring 상태 보유 StatefulSet — 설정 변경마다 ~5분 unready. 무상태 원칙과 양립 불가, 반드시 chain에 |
| 7 | **vmagent→Thanos/Mimir 레그를 기본 queues로 송신** | out-of-order 409 유발 — **`-remoteWrite.queues=1` 필요** + 버퍼 한도 설계(그 자체의 백프레셔·OOM 리스크 포함). per-URL queues는 v1.135.0+ |
| 8 | **벤더 벤치마크(RAM 5x 등)·0.4~0.8 B/sample 베스트케이스를 예산 근거로** | 비용 모델은 VM ~1~1.2 B, Prom/Thanos 1.5~2 B, Mimir ~2 B + 자체 실측으로 |
| 9 | **OSS에서 Enterprise 플래그 기대** (`vmbackupmanager`·`-downsampling.period`·`-retentionFilter`) | 셋 다 Enterprise 전용(라이선스 키 필요). 스케줄 백업은 k8s CronJob으로 직접 |
| 10 | **아카이브 검증 전 hot retention 축소** | streamAggr 집계는 인제스트 시점 확정 — **hot raw가 유일한 재계산 원본**이다. 아카이브가 검증되기 전엔 절대 축소 금지 |

## 4. 진행 전 실측 목록 (드라이런 2주 · UNCERTAIN)

아래는 소스가 명시적으로 "검증 필요/실측 필요"라 표시한 항목이다. 확정치가 아니므로 예산·설계를 이 가정값으로 굳히지 말고 드라이런으로 확정한다.

| 실측 항목 | 무엇을 재는가 | 소스의 가정값 |
|---|---|---|
| **집계 축소율 f** | 집계 산출물의 실제 bytes/sample·압축률 → 아카이브 저장량 확정 | f = **0.1~0.3** (가정 → 실측 확정) |
| **카운터/게이지 오분류** | 접미사 휴리스틱의 오분류 목록(비표준 네이밍 카운터가 avg로, `_total` 게이지가 total로 왜곡) → 예외 match 규칙 보강 | 규칙 2개로 배타 커버 가정 |
| **라우터 vmagent 메모리 증분** | 전 메트릭 집계 상태가 라우터 메모리에 올라감 — 활성 시리즈 수에 비례 | 사이징 실측 필요 |
| **sc1/st1 부하** | vmsingle 머지·동시 쿼리 부하 테스트(sc1 **250 IOPS 상한**). 인제스트(일 수 GiB)는 트리비얼하나 대형 머지가 관건 | 불안하면 st1(gp3 대비 44% 저렴) |
| **vmctl 시드 / vmbackup×S3-IA** | 기존 80d raw를 vmctl로 라우터 경유 재주입해 아카이브 시드 가능 여부 / vmbackup 증분 오브젝트 churn과 S3-IA 최소 30일 과금의 상호작용 | Standard 시작 후 관찰 권장 |

**롤아웃 순서**(요약, 상세는 [02번]({{< relref "02-vm-archive.md" >}})): ① vmsingle 배포 → ② RW#4 드라이런 2주(f·시리즈 수·카운터 오분류·rate/histogram_quantile 정합 확인) → ③ 예외 규칙 보강 → ④ Grafana DS + 재조사 대시보드 1개 시범 이관 → ⑤ vmbackup CronJob → ⑥ (선택) vmctl 시드. **모니터링**: RW#4의 `vmagent_remotewrite_pending_data_bytes`, 라우터 vmagent 메모리, vmsingle 디스크 증가율.

## 출처

- `README.md` (§5 권장안 A, §6 하지 말 것, §7 진행 전 실측 목록)
- `99-full-report.md` (§5 권장안 A 구성·선례, §6 하지 말 것, 부록 UNCERTAIN)
- `01-option-a-vm-archive.md` (A안 상세 구성·리스크)
- 교차: [02 VM 아카이브]({{< relref "02-vm-archive.md" >}}), [06 단가]({{< relref "06-storage-pricing.md" >}}), [07 핵심논점]({{< relref "07-streamaggr-vs-downsampling.md" >}}), [VM 챕터 07 운영]({{< relref "../victoriametrics/07-operations-at-scale.md" >}})
