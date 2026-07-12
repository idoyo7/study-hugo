---
title: "D안 — VMCluster 확장"
weight: 5
---

# D안 — 현행 VMCluster 단순 확장 (기준선) & D′ Enterprise

현행 VMCluster를 그대로 400d로 늘리는 가장 단순한 길(D안)과, 그 위에 설정 한 줄로 다운샘플을 얹는 Enterprise 경로(D′)를 다룬다. D안은 다른 옵션의 **비용 비교 기준선**이고, D′는 OSS-우선 제약상 참고용이다.

> 관련 블록: [02 A안 ★권장]({{< relref "02-option-a-vm-archive.md" >}}), [07 핵심논점]({{< relref "07-streamaggr-vs-downsampling.md" >}}), [06 스토리지 단가]({{< relref "06-storage-pricing.md" >}}), [08 권장·하지말것]({{< relref "08-recommendation-and-pitfalls.md" >}})

## D안: `-retentionPeriod=400d` + PVC 증설

구조·쿼리·운영 변화가 **전혀 없는** 가장 단순한 길이다. 대신 90d 이후 데이터에도 `raw 30s × SSD(gp3) × RF2`가 그대로 걸려 4안 중 가장 비싸다. 그래서 이 안은 채택 후보이기보다 다른 안이 얼마나 절감하는지를 재는 자[尺]로 쓴다.

### 구성

- VMCluster `retentionPeriod: 80d → 400d`
- vmstorage PVC `900Gi → ~4.5 TiB/노드` ×4 (gp3 볼륨 한도는 64 TiB라 여유 — 2025-09에 16→64 TiB 상향)
- 신규 stateful 컴포넌트 **0개**, 신규 기술 학습 **0**, 쿼리 경로(MetricsQL·vmselect) **무변화**

즉 마이그레이션 난이도는 사실상 "설정값 하나 + 볼륨 증설"이다. 이 단순성이 D안의 유일한 강점이다.

### 비용

```
D = U × (400/80) × $0.0912 = 18,000 GiB × 0.0912 ≈ $1,642/mo   (선형 외삽 하한)
```

| 항목 | 값 |
|---|---|
| 저장 구성 | 18.0 TiB gp3 RF2 |
| 월 저장비 (하한) | **~$1,642/mo** |
| VM 공식 사이징 반영 시 | **~$2,000/mo 근접** (+1 merge cycle, ×1.25 헤드룸) |
| 현재($328/mo) 대비 | **약 5배** |

여기서 `U`는 80d·RF2 실사용 바이트로, 위 대입은 **프로비저닝 3,600 GiB를 100% 사용한다는 상한 가정**이다. 실제 사용률이 70%면 모든 수치를 0.7배로 선형 보정한다. VM 공식 사이징 공식 `(retention + 1 cycle) × 1.25`상 선형 외삽은 **하한**이므로, 실제 청구는 $1,642와 ~$2,000 사이로 봐야 한다.

### 왜 비싼가 (본질)

90d 이후 데이터에 세 가지가 전부 과잉이라는 게 이 안의 낭비의 핵심이다.

| 요인 | 과잉 지점 |
|---|---|
| gp3 단가 $0.0912 | **sc1의 5.2배** — 장애 재조사용 아카이브에 SSD 성능은 불필요 |
| RF2 | 아카이브에 실시간 이중화 불필요 — 백업 사본으로 충분 |
| raw 30s | >90d 구간은 **5m이면 충분**(사용자 확정) |

비싼 이유는 결국 **gp3 단가 × RF2**의 곱이다. 단가 축은 [06 스토리지 단가]({{< relref "06-storage-pricing.md" >}})에서, "5m이면 충분한데 왜 raw를 버리는가"라는 해상도 축은 [07 핵심논점]({{< relref "07-streamaggr-vs-downsampling.md" >}})에서 각각 정면으로 다룬다. A안은 이 세 과잉을 `sc1 × RF1 × 5m 집계`로 동시에 걷어내 D안 대비 약 70% 절감한다([02 A안]({{< relref "02-option-a-vm-archive.md" >}})).

### 언제 D를 고르나

- >90d 구간에도 raw 30s가 **규제·감사로 필수**이고, 운영 단순성이 비용보다 중요할 때
- 그 외에는 선택할 이유가 없다 — 단순성의 대가가 월 $1,000 이상이기 때문

>90d raw가 규제상 필수라면 D 대신 A′(RF1 sc1/st1 + vmbackup, $485~787)로도 raw를 훨씬 싸게 들 수 있다. 판단 트리와 시나리오 ① 비용 종합은 [07 핵심논점]({{< relref "07-streamaggr-vs-downsampling.md" >}})이 주인이다.

---

## D′ (참고): VM Enterprise `-downsampling.period`

아키텍처 관점에서 **최단 경로**다. 기존 클러스터에 설정 한 줄을 얹으면 vmstorage가 자동으로 다운샘플한다. 단 Enterprise 라이선스(정가 비공개)가 필요해 OSS-우선 제약상 기본 배제한다.

### 구성

```
# vmstorage + vmselect 양쪽에 동일 값
-downsampling.period=90d:5m     # 90d 지난 데이터를 5m 1샘플로
-retentionPeriod=400d
```

신규 컴포넌트도, 쿼리 경로 변경도 없다. 아카이브 tier도, 라우터 RW#4도, streamAggr 상태 관리도 없이 클러스터가 스스로 90d 경계에서 raw를 5m로 접는다. 운영 표면으로만 보면 4안 중 가장 얇다.

### 비용

```
≈ 90d raw + 310d 5m ≈ 5,445 GiB × $0.0912 ≈ $497/mo + 라이선스
```

- 저장비 자체는 **~$497/mo**로 D안($1,642)의 약 1/3
- **라이선스**: 공개 정가 없음 — 전 채널 contact-sales. 2개월 무료 트라이얼 존재(회사 이메일 필요)
- **공식 caveat**: 다운샘플링은 **시리즈 수를 줄이지 않는다** — 고카디널리티·고churn 워크로드에서는 저장 절감 효과가 제한된다

즉 D′의 $497은 **저장비만**의 수치이고, 실제 총비용은 여기에 비공개 라이선스가 더해진다. 라이선스가 "A안 대비 추가 저장비 + 운영비 절감"과 수지가 맞는지는 견적 없이 판단할 수 없다.

### 언제 D′를 고르나

- A안 드라이런 결과 운영(휴리스틱 관리, 라우터 vmagent 메모리)이 부담으로 판명되고
- 라이선스 견적이 "A안 대비 추가 저장비 + 운영비 절감"과 수지가 맞을 때

판단 절차는 **2개월 트라이얼로 실측 → 견적 협상**이며, 협상 앵커로 VM Cloud $0.511/GB·월을 참고한다. OSS-우선 제약을 유지하는 한 D′는 "A안 운영이 검증 후에도 부담스러울 때의 유일한 설정 한 줄 대안"으로만 보류해 둔다.

### Enterprise 경계 — OSS에서 기대 금지

D′를 검토할 때 헷갈리기 쉬운 지점이다. 아래 셋은 **전부 Enterprise 전용**(라이선스 키 필요)이라 OSS 구성에서 기대하면 안 된다.

| 기능 | 용도 | OSS 대체 |
|---|---|---|
| `-downsampling.period` | 클러스터 자동 다운샘플(= D′의 핵심) | streamAggr(인제스트 시점 집계, [02 A안]({{< relref "02-option-a-vm-archive.md" >}})) |
| `vmbackupmanager` | 백업 스케줄 자동화·보존 관리 | k8s CronJob으로 `vmbackup` 직접 실행 |
| `-retentionFilter` | 시리즈별 차등 보존 | 없음 — tier 분리로 우회 |

vmbackup/vmrestore 자체는 OSS이지만 **스케줄 자동화 계층(vmbackupmanager)**만 Enterprise라는 점을 구분해야 한다(무중단·대규모 운영 상세는 [초대규모 운영과 무중단 전환]({{< relref "../victoriametrics/07-operations-at-scale.md" >}})). 압축·retention 동작의 엔진 레벨 근거는 [저장과 압축]({{< relref "../victoriametrics/04-storage-and-compression.md" >}})를 참조한다.

---

## 요약

| | D안 (OSS 기준선) | D′ (Enterprise 참고) |
|---|---|---|
| 방식 | `-retentionPeriod=400d` + PVC 증설 | `-downsampling.period=90d:5m` 한 줄 |
| 저장 구성 | 18.0 TiB gp3 RF2 | 90d raw + 310d 5m ≈ 5,445 GiB |
| 월 저장비 | **~$1,642** (헤드룸 시 ~$2,000) | **~$497 + 라이선스(비공개)** |
| 신규 stateful | 0 | 0 |
| 쿼리 변화 | 없음 (MetricsQL 유지) | 없음 (MetricsQL 유지) |
| 라이선스 | OSS | Enterprise (contact-sales, 2개월 트라이얼) |
| 역할 | 다른 옵션의 비용 기준선 | 운영 최소화가 목표일 때의 설정 한 줄 대안 |

시나리오 ②(raw 90d + 전 메트릭 5m) 전체 비용 종합표와 A/B/C/D/D′ 대조는 [07 핵심논점]({{< relref "07-streamaggr-vs-downsampling.md" >}})이 주인이며, 권장안(A) 근거와 "하지 말 것"은 [08 권장·하지말것]({{< relref "08-recommendation-and-pitfalls.md" >}})에 있다.

## 출처

- `/home/mont/evejuni/monitoring/longterm-400d/04-option-d-expansion.md` — D안 구성·비용·본질, D′ 구성·비용·라이선스·선택 기준
- `/home/mont/evejuni/monitoring/longterm-400d/99-full-report.md` (§2.4 D안 기준선, §2.0 공통 전제·기호, §6-9 Enterprise 경계, §1 검증된 서울 단가)
