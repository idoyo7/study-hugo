---
title: "권장안·하지 말 것"
date: 2026-07-12
lastmod: 2026-08-24
weight: 8
---

# 08 · 권장안(VM OSS 아카이브) 종합 근거 · 업계 선례 · 하지 말 것 10선

{{< callout type="info" >}}
- 권장은 VM OSS 아카이브안(라우터 RW#4 + streamAggr 5m → vmsingle-archive 400d)입니다. 4안 중 비용이 월 $385~416으로 가장 낮고 되돌릴 수 있으며 service 무상태에 영향이 없습니다. 신규 기술은 0이고 MetricsQL도 그대로 남습니다.
- 업계 선례가 "장기 = 집계만"을 뒷받침합니다. Criteo(계층화 절감), Uber M3(1h/5y rollup), MHI Vestas(VM 13개월 안정 운영) — 방향성 근거이고 예산 근거는 아닙니다.
- 검증에서 기각된 함정 10선: VM에 S3 primary 기대 금지, vmbackup을 쿼리 가능한 아카이브로 착각 금지, Thanos downsampling을 저장 절감 수단으로 오인 금지, 아카이브 검증 전 hot retention 축소 금지 등.
- 진행 전 드라이런 2주로 실측해야 하는 항목: 집계 축소율 f(가정 0.1~0.3), 카운터/게이지 오분류, 라우터 vmagent 메모리 증분, sc1/st1 부하.
{{< /callout >}}

400d 보관 결정의 최종 종합입니다. VM 아카이브안을 왜 권장하는지 근거를 한자리에 모읍니다. 업계 선례로 패턴을 뒷받침한 뒤 검증에서 기각된 함정 10개와 진행 전 드라이런 2주 실측 목록을 정리합니다.

> 관련 문서: [02 VM 아카이브 상세]({{< relref "02-vm-archive.md" >}}), [07 핵심논점·비용종합·판단트리]({{< relref "07-streamaggr-vs-downsampling.md" >}}), [06 스토리지 단가]({{< relref "06-storage-pricing.md" >}}), [01 문제·2축]({{< relref "01-problem-and-axes.md" >}})

## 1. 권장: VM OSS 아카이브안 — 라우터 RW#4 + streamAggr 5m → vmsingle-archive 400d

핵심 논점(사전집계 vs 사후집계)과 비용 종합표는 [07번]({{< relref "07-streamaggr-vs-downsampling.md" >}})이 주인입니다. 여기서는 VM 아카이브안을 고른 근거만 종합합니다.

- 저장비가 가장 낮습니다. 시나리오 ② 월 $385~416(sc1)으로 4안 중 최저이고 단순 확장안($1,642) 대비 ~70% 절감입니다. Thanos안($780~1,200 + 컴퓨트)의 절반 이하이며 컴퓨트 차이는 더 벌어집니다.
- 되돌릴 수 있습니다. RW#4는 언제든 Thanos Receive로 갈아끼워 Thanos안으로 넘어갈 수 있습니다. 드라이런에서 f가 예상을 크게 벗어나면 그때 재평가합니다.
- service는 무상태 그대로입니다. 이미 설계한 라우터 vmagent 패턴에 RW#4를 자연스럽게 붙이고 service 클러스터는 손대지 않아 무상태 원칙을 그대로 지킵니다.
- 신규 기술 0입니다. 신규 stateful 컴포넌트가 1개(vmsingle)뿐이고 그마저 기존과 동일 기술스택이어서 새로 배울 것이 없습니다.
- MetricsQL은 그대로 갑니다. 아카이브도 VM이라 `keep_metric_names`로 기존 쿼리가 datasource만 바꾸면 동작하고 미확인 의존도 리스크도 사라집니다.

잔여 리스크는 확정 집계가 재조사에 부족할 가능성입니다. hot 90d raw가 최근 장애의 golden window를 담당하고 >90d 재조사는 추세·수준 비교가 주라는 전제에서 이 리스크를 수용합니다. 그래서 아카이브 검증 전 hot retention 축소를 금지합니다(§3-10).

스토리지 클래스는 gp3(기본값)로 시작해야 맞습니다. 본 분석의 sc1은 최저가 옵션일 뿐입니다. 아카이브 볼륨이 작아(0.9~2.7 TiB) gp3 프리미엄이 월 $66~199 수준입니다. 검증 기간엔 gp3로 안전하게 가고 이후 IO 실측을 보고 st1/sc1 최적화를 판단합니다. 단가·볼륨 선택 상세는 [06번]({{< relref "06-storage-pricing.md" >}}).

## 2. 업계 선례 — "장기 = 집계만"은 표준 패턴

VM 아카이브안이 택한 "hot raw 단기 + 장기는 집계 tier" 계층화는 대규모 운영에서 이미 반복 확인된 패턴입니다.

- Criteo · 약 10억 활성 시리즈, VM cluster 계층화(고카디널리티·고churn 단기 7d / 집계 90d / 장기 별도 클러스터 1y+) — 계층화로 자릿수 비용 절감을 자체 보고했습니다. VM 아카이브안의 hot/아카이브 분리와 동형입니다.
- Uber M3 · rollup 정책 1m/30d + 1h/5y — 장기 보관에서 "장기 = 집계만"이 업계 표준이라는 근거입니다.
- MHI Vestas · VM 13개월 retention 안정 운영 — VM 계열 장기 retention의 실운영 레퍼런스입니다.

선례에서 얻는 것은 방향이고 예산 산정 근거는 아닙니다. 비용 수치는 [07번 종합표]({{< relref "07-streamaggr-vs-downsampling.md" >}})와 [06번 단가]({{< relref "06-storage-pricing.md" >}})의 서울 실측치만 씁니다.

## 3. 하지 말 것 (검증에서 기각·경고된 사항) 10선

리서치 과정에서 그럴듯해 보였지만 검증 결과 틀렸거나 함정으로 드러난 항목을 모았습니다. 400d 설계에서 되풀이되는 오판입니다.

1. VM에 S3 primary/티어링 기대 — 메트릭 엔진의 쿼리 가능한 오브젝트 스토리지는 미출시·일정 미약속입니다("VictoriaLogs 이후 검토" 발언과 #38 self-assign은 신호에 그칩니다). 로드맵 베팅으로 설계를 미루지 말 것.
2. vmbackup을 "쿼리 가능한 아카이브"로 착각 — S3 백업은 콜드 사본입니다. 조회하려면 vmstorage/vmsingle을 정지하고 vmrestore로 전체 복원해야 하므로 재조사용 저장소가 될 수 없습니다(→ [VM 챕터 07 vmbackup/vmrestore]({{< relref "../victoriametrics/practice/02-operations-at-scale.md" >}})).
3. Thanos downsampling을 "저장 절감" 수단으로 도입 — 공식 문서가 공간 절감 없음, 해상도 공존 시 ~3x로 명시합니다. 절감은 `--retention.resolution-raw` 단축에서만 나옵니다. 다운샘플링은 장기 쿼리 속도 장치입니다.
4. Mimir를 5m 장기 tier로 선택 — 다운샘플링이 OSS/GEM 어디에도 없고 3.0에서도 없습니다. Adaptive Metrics는 Grafana Cloud 전용입니다(→ [04번]({{< relref "04-mimir.md" >}})).
5. Thanos/Store Gateway가 읽는 버킷을 S3-IA/Glacier IR에 — GB당 리트리벌 수수료(IA $0.01 / GIR $0.03)가 쿼리·동기화마다 붙습니다. IA/GIR는 vmbackup 사본 전용입니다.
6. Thanos Receive를 service 클러스터에 — hashring 상태를 쥔 StatefulSet이라 설정 변경마다 ~5분 unready가 됩니다. 무상태 원칙과 맞지 않으므로 반드시 chain에 둡니다.
7. vmagent→Thanos/Mimir 레그를 기본 queues로 송신 — out-of-order 409를 부릅니다. `-remoteWrite.queues=1`가 필요하고 버퍼 한도 설계(그 자체의 백프레셔·OOM 리스크 포함)가 따라야 합니다. per-URL queues는 v1.135.0+.
8. 벤더 벤치마크(RAM 5x 등)·0.4~0.8 B/sample 베스트케이스를 예산 근거로 — 비용 모델은 VM ~1~1.2 B, Prom/Thanos 1.5~2 B, Mimir ~2 B에 자체 실측을 더해 씁니다.
9. OSS에서 Enterprise 플래그 기대(`vmbackupmanager`·`-downsampling.period`·`-retentionFilter`) — 셋 다 Enterprise 전용(라이선스 키 필요)입니다. 스케줄 백업은 k8s CronJob으로 직접 합니다.
10. 아카이브 검증 전 hot retention 축소 — streamAggr 집계는 인제스트 시점에 확정되므로 hot raw가 유일한 재계산 원본입니다. 아카이브가 검증되기 전엔 절대 축소를 금지합니다.

## 4. 진행 전 실측 목록 (드라이런 2주 · UNCERTAIN)

아래는 소스가 "검증 필요/실측 필요"로 표시한 항목입니다. 확정치가 아니므로 예산·설계를 이 가정값으로 굳히지 말고 드라이런으로 확정합니다.

- 집계 축소율 f · 가정값 0.1~0.3(실측 확정 필요) — 집계 산출물의 실제 bytes/sample·압축률을 재서 아카이브 저장량을 확정합니다.
- 카운터/게이지 오분류 · 규칙 2개로 배타 커버 가정 — 접미사 휴리스틱이 어디서 틀리는지 오분류 목록을 뽑아 예외 match 규칙을 보강합니다. 비표준 네이밍 카운터가 avg로, `_total` 게이지가 total로 왜곡되는 경우입니다.
- 라우터 vmagent 메모리 증분 · 사이징 실측 필요 — 전 메트릭 집계 상태가 라우터 메모리에 올라가며 활성 시리즈 수에 비례합니다.
- sc1/st1 부하 · 불안하면 st1(gp3 대비 44% 저렴) — vmsingle 머지·동시 쿼리 부하 테스트(sc1 최대 250 IOPS 상한). 인제스트(일 수 GiB)는 트리비얼하나 대형 머지가 관건입니다.
- vmctl 시드 / vmbackup×S3-IA · Standard 시작 후 관찰 권장 — 기존 80d raw를 vmctl로 라우터 경유 재주입해 아카이브 시드가 가능한지, vmbackup 증분 오브젝트 churn·S3-IA 최소 30일 과금이 어떻게 맞물리는지 확인합니다.

롤아웃 순서(요약, 상세는 [02번]({{< relref "02-vm-archive.md" >}})): ① vmsingle 배포 → ② RW#4 드라이런 2주(f·시리즈 수·카운터 오분류·rate/histogram_quantile 정합 확인) → ③ 예외 규칙 보강 → ④ Grafana DS + 재조사 대시보드 1개 시범 이관 → ⑤ vmbackup CronJob → ⑥ (선택) vmctl 시드. 모니터링 대상은 RW#4의 `vmagent_remotewrite_pending_data_bytes`, 라우터 vmagent 메모리, vmsingle 디스크 증가율입니다.

## 출처

- `README.md` (§5 권장안 A, §6 하지 말 것, §7 진행 전 실측 목록)
- `99-full-report.md` (§5 권장안 A 구성·선례, §6 하지 말 것, 부록 UNCERTAIN)
- `01-option-a-vm-archive.md` (A안 상세 구성·리스크)
- 교차: [02 VM 아카이브]({{< relref "02-vm-archive.md" >}}), [06 단가]({{< relref "06-storage-pricing.md" >}}), [07 핵심논점]({{< relref "07-streamaggr-vs-downsampling.md" >}}), [VM 챕터 07 운영]({{< relref "../victoriametrics/practice/02-operations-at-scale.md" >}})
