---
title: "용량 축 — Provisioned Control Plane 티어와 복귀 제약"
weight: 3
---

# 용량 축 — Provisioned Control Plane 티어와 복귀 제약

{{< callout type="info" >}}
**한눈에**
- **finance 판정부터 — 해당 없다.** XL 최소 증분이 월 **+$1,204.50**인데, 이걸 켜서 새로 얻는 파라미터는 HPA `syncPeriod` 하나뿐이고 그 실효는 metrics-server 스크레이프 간격과 scaleDown stabilization이 상한을 건다.
- **신규 기능이 아니다 — 2025-11-21 GA.** 2026-08-12 발표는 레이어 2 파라미터 개방이고, Provisioned CP는 그 발표에서 **전제조건으로 언급된 9개월 된 기존 기능**이다.
- 파는 것은 용량 자체가 아니라 **"언제 그 용량이 되는가"**다. Standard는 APF inflight 상한을 600에서 **사후적으로** 최대 2000까지 올리고 Provisioned는 그 점진 증가를 건너뛰고 티어 값을 처음부터 고정 할당한다.
- **8XL은 "스케줄링이 더 빠른 티어"가 아니다.** 파드 스케줄링 처리율이 4XL에서 **400/s로 포화**하고 8XL도 400/s다. 8XL이 늘리는 것은 API 동시성 2배뿐이다.
- **Standard 복귀를 막는 조건이 둘인데 서로 다른 문서에 하나씩만 있다** — etcd 8GB 초과와 `horizontalPodAutoscalerSyncPeriod` 비기본값. 한 문서만 읽으면 절반을 놓친다.
- **티어 수치는 보장 처리량이 아니다.** AWS 표현은 "underlying configuration"이고 APF는 그 위에서 계속 작동한다 — 그래서 티어 선정은 계산이 아니라 측정이다.
{{< /callout >}}

[레이어 1]({{< relref "01-cluster-parameters.md" >}})이 "클러스터에 어떤 값을 넣을 수 있나"를, [레이어 2]({{< relref "02-component-parameters.md" >}})가 "컨트롤 플레인 컴포넌트의 동작을 어디까지 바꿀 수 있나"를 다룹니다. 이 페이지는 축이 다릅니다 — **컨트롤 플레인을 얼마나 크게 사느냐**입니다. 파라미터 하나를 열려면 이 축을 먼저 결정해야 하는 의존이 걸려 있어, 레이어 2의 HPA `syncPeriod`가 이 페이지를 반드시 거치게 만듭니다.

이 페이지의 사실은 전부 **2026-08 기준** AWS 1차 문서(EKS User Guide·API Reference·Best Practices Guide·요금 페이지) 확인분입니다. 업스트림 소스 인용은 레이어 2가 단일 소유로 다루므로 여기서는 반복하지 않습니다.

## 1. 이건 신규 기능이 아니다

Provisioned Control Plane은 네 번에 걸쳐 지금 형태가 됐습니다. 2026-08-12 발표를 보고 이 기능까지 신규로 오해하면 "새 기능이라 아직 위험하다"는 잘못된 리스크 판단으로 이어집니다.

| 날짜 | 발표 | 무엇이 바뀌었나 |
|---|---|---|
| **2025-11-21** | Provisioned Control Plane **GA** | XL·2XL·4XL 3개 티어로 출시. 당시 8XL 없음 |
| **2026-03-20** | 99.99% SLA + **8XL 티어 추가** | Standard 99.95%(5분 단위) → Provisioned **99.99%(1분 단위)**. 8XL은 4XL 대비 API 요청 처리 용량 2배 |
| **2026-07-28** | HPA sync **concurrency** 최대 40배 확대 | **전 Provisioned 클러스터에 자동 적용, 설정 변경 불필요** |
| **2026-08-12** | (별개 기능) 컴포넌트 파라미터 4종 개방 | HPA sync **period**가 Provisioned CP를 전제로 요구 → [레이어 2]({{< relref "02-component-parameters.md" >}}) |

마지막 두 행은 이름이 비슷해서 특히 헷갈립니다. **2026-07-28은 concurrency**(컨트롤러 매니저가 동시에 처리하는 HPA 오브젝트 수)이고 자동 적용이라 우리가 할 일이 없습니다. **2026-08-12는 period**(reconcile 간격)이고 티어 opt-in과 파라미터 설정을 모두 요구합니다.

같은 문제(HPA 오토스케일 지연)를 한 달 간격으로 다른 레버로 겨냥한 셈이라, AWS가 이 영역을 2026 하반기 우선순위로 두고 있다고 **추정**할 수 있습니다. 1차 문서가 두 발표를 명시적으로 연결한 것은 아닙니다.

## 2. Standard와 무엇이 다른가

User Guide는 두 모드를 이렇게 갈라 놓습니다. Standard가 "the best price to performance ratio"이고 "recommended option for the vast majority of use cases"이며 Provisioned는 "성능 변동을 전혀 허용할 수 없거나 매우 큰 컨트롤 플레인 용량이 필요한" 예외 워크로드용이라고 명시합니다. 기본값이 Standard라는 사실을 AWS 자신이 권고로 재확인하는 구조입니다.

### 2.1 차이는 값이 아니라 타이밍이다

Standard 모드의 APF 동시성 동작이 핵심입니다. Best Practices Guide 원문은 EKS가 `--max-requests-inflight` 400 + `--max-mutating-requests-inflight` 200으로 **총 600**에서 시작해 사용률과 워크로드 churn이 올라가면 "correspondingly increases the inflight request quota all the way till 2000"이라고 서술합니다. 즉 상한 상승이 **부하를 관측한 뒤에 따라오는 사후 반응**입니다.

그래서 급격한 버스트에서 429(Too Many Requests)가 납니다. 캐치올 우선순위 레벨이 큐잉 없이 즉시 거부하는 Reject 타입이라 특히 취약합니다. Best Practices Guide가 "클러스터 크기를 한 번에 두 자릿수 퍼센트씩 늘리는 스파이크를 제한하라"(1000→1100 노드, 4000→4500 파드 수준)고 권고하는 이유가 이것입니다.

Provisioned는 그 점진 증가 구간을 **건너뜁니다.** 티어가 정한 값을 처음부터 고정 할당해 두므로 워크로드가 갑자기 튀어도 스케일업을 기다리지 않습니다(User Guide: "without waiting for automatic scaling to respond to demand"). 팔고 있는 것은 도달 가능한 최대 용량이 아니라 **그 용량에 도달하는 시점**입니다 — v1.34+ XL의 2,000 seats는 Standard가 시간을 들여 도달하는 상한과 같은 숫자입니다.

역사적 맥락으로는 2022-06-27 AWS 블로그가 참고가 됩니다. 당시 컨트롤 플레인 스케일링이 "as long as 50 minutes"까지 걸렸고 그 지연이 "API and etcd latencies를 올리거나 API 서버를 일시적으로 무응답으로 만들 수 있었다"고 서술합니다. 최소 컨트롤 플레인 노드 수를 항상 유지해야 해서 순차 스케일링만 가능했던 것이 원인이었습니다. 그 포스트는 4배 개선을 발표한 것이고 지금 상태를 서술한 문서가 아니므로, 현재 수치의 근거로 쓰면 안 됩니다.

### 2.2 축별 대조

| 축 | Standard | Provisioned |
|---|---|---|
| 용량 확보 방식 | 부하 관측 후 사후 증가 | 티어 값 사전 고정 할당 |
| APF inflight 상한 | 600 → 최대 2,000(점진) | 티어 값 즉시(XL 1,700 / v1.34+ 2,000) |
| 파드 스케줄링 처리율 | 문서화된 고정 수치 없음 | 티어별 명시(167~400/s) |
| cluster database(etcd) 상한 | **8GB** | 전 티어 **16GB** |
| HPA sync concurrency | 업스트림 기본값 계열 | 티어별 50~200 |
| SLA | 99.95%, 5분 단위 측정 | **99.99%, 1분 단위 측정** |
| 요금 | 기본요금만 | 기본요금 **+** 티어 요금(§5) |
| 티어 간 자동 스케일 | 해당 없음 | **없다.** 고정 핀(§6) |

etcd 상한 8GB → 16GB 차이가 §6의 복귀 제약을 만듭니다. Provisioned에서 DB를 8GB 넘게 키워 놓으면 Standard가 받을 수 없는 크기가 되기 때문입니다.

## 3. 티어 표

지원 k8s는 **v1.28 이상**이지만 티어 수치는 두 구간으로 나뉩니다. API 동시성만 v1.34에서 올라가고 나머지 축은 동일합니다.

| Tier | API 동시성(seats) v1.30~1.33 | API 동시성 v1.34+ | Pod scheduling rate | Cluster DB | HPA sync concurrency | SLA |
|---|---|---|---|---|---|---|
| XL | 1,700 | **2,000** | 167/s | 16GB | 50 | 99.99% |
| 2XL | 3,400 | **4,000** | 283/s | 16GB | 100 | 99.99% |
| 4XL | 6,800 | **8,000** | **400/s** | 16GB | 200 | 99.99% |
| 8XL | 13,600 | **16,000** | **400/s** | 16GB | 200 | 99.99% |

### 3.1 8XL의 비대칭

표를 가로로 읽으면 8XL이 4XL의 두 배처럼 보이지만 실제로 두 배가 되는 축은 **API 동시성 하나**입니다. 파드 스케줄링 처리율은 **4XL에서 400/s로 포화하고 8XL도 400/s**이며 HPA sync concurrency도 4XL·8XL 모두 200으로 같습니다.

| 축 | 4XL → 8XL |
|---|---|
| API 요청 동시성 | 8,000 → 16,000 (**2배**) |
| Pod scheduling rate | 400/s → 400/s (**변화 없음**) |
| HPA sync concurrency | 200 → 200 (**변화 없음**) |
| Cluster DB | 16GB → 16GB (변화 없음) |
| 요금 | $6.90/h → $13.90/h (약 2배) |

읽는 방식은 하나입니다 — **8XL은 "스케줄링이 더 빠른 티어"가 아니라 "API 요청을 더 많이 받는 티어"**입니다. 파드 배치 속도가 병목이면 4XL 위로 올려도 그 병목은 그대로 남고 요금만 2배가 됩니다. 병목 축을 먼저 식별해야 티어 선택이 의미가 있습니다(§7).

### 3.2 HPA sync concurrency와 40배

User Guide 원문은 "Each Provisioned Control Plane scaling tier is configured with the following HPA sync concurrency"라고 쓰고 위 표의 50/100/200/200을 제시합니다. 업스트림 쿠버네티스 기본값이 **5**이므로 8XL의 200은 정확히 40배이고, 이것이 2026-07-28 발표가 말한 "최대 40배"의 정체입니다. 표현이 "최대"라서 전 티어가 40배로 오해되기 쉬운데 XL은 10배, 2XL은 20배입니다.

### 3.3 v1.28~1.29 구간의 간극

지원 범위는 "v1.28 and higher"인데 **티어 수치 표는 v1.30~1.33과 v1.34+ 두 개만 제공됩니다.** v1.28~1.29에서 어떤 수치가 적용되는지는 문서로 확인되지 않았습니다 — 확인 필요로 남깁니다. 이 챕터의 목표 버전은 1.35라 실무 영향은 없지만, 확장지원 구간의 구 클러스터에 이 기능을 붙일 때는 수치를 문서에서 찾을 수 없다는 점을 알고 시작해야 합니다.

## 4. 프로그래매틱 조회 — 티어가 파라미터 제약까지 흔들 수 있다

`DescribeClusterVersions` API가 `clusterVersions[].controlPlaneScalingTiers[]`로 티어 정의를 반환합니다. 필드는 `tierName`·`apiRequestConcurrency`·`podSchedulingRatePerSecond`·`clusterDatabaseSizeGb`, 그리고 **`controlPlaneComponentConfigOverrides`**입니다.

마지막 필드가 중요합니다. 스키마상 티어별로 `kubeApiServerConfig`·`kubeControllerManagerConfig`·`kubeSchedulerConfig`의 **기본값과 제약을 오버라이드할 수 있는 구조**입니다. 그러면 [레이어 2]({{< relref "02-component-parameters.md" >}})가 정리한 파라미터 허용 범위가 티어 무관 고정이라고 단정할 수 없습니다 — 예컨대 `horizontalPodAutoscalerSyncPeriod`의 min/max/default가 티어마다 다를 여지가 열려 있습니다. 다만 **실제 응답값에 티어별 차이가 있는지는 API를 호출해 확인하지 않았습니다.** 스키마에 필드가 존재한다는 사실까지만 확정이고, 값 차이는 미확인입니다.

실무 함의는 IaC에 기본값을 하드코딩하지 말라는 것입니다. 티어를 바꿀 계획이 있으면 파라미터 제약을 `describe-cluster-versions`로 조회해 확인하는 편이 안전합니다.

## 5. 요금 — 기본요금에 더해진다

여기가 계산을 가장 많이 틀리는 지점입니다. AWS 요금 페이지 원문(2026-08-14 직접 확인)이 못박습니다.

> "This charge is in addition to the standard Amazon EKS cluster pricing based on Kubernetes version support tier detailed in the 'Amazon EKS cluster pricing' section above."

즉 Provisioned 티어 요금은 기본 클러스터 요금을 **대체하지 않고 더합니다.** 기본요금을 티어 요금에서 빼면 총액과 증분이 모두 틀립니다.

| 구성 | 시간당 | 월(730h) | Standard 대비 증분 |
|---|---|---|---|
| Standard(표준 지원) | $0.10 | $73.00 | — |
| **Provisioned XL** | $0.10 + $1.65 = **$1.75** | **$1,277.50** | **+$1,204.50** |
| Provisioned 2XL | $0.10 + $3.40 = $3.50 | $2,555.00 | +$2,482.00 |
| Provisioned 4XL | $0.10 + $6.90 = $7.00 | $5,110.00 | +$5,037.00 |
| Provisioned 8XL | $0.10 + $13.90 = $14.00 | $10,220.00 | +$10,147.00 |

배수를 말할 때는 기준을 함께 밝혀야 합니다. **티어 요금분만 보면 기본요금의 약 16.5배**($1.65 ÷ $0.10)이고, **총액으로는 17.5배**($1.75 ÷ $0.10)입니다. 두 숫자가 다른 것을 모르고 인용하면 배수가 한 단계 어긋납니다.

### 5.1 기본요금이 지원 티어에 따라 달라진다

위 인용문에서 놓치기 쉬운 한정어가 "based on Kubernetes version support tier"입니다. 더해지는 기본요금이 **표준 지원인지 확장 지원인지에 따라 달라진다**는 뜻이므로, Provisioned 총액도 클러스터의 지원 상태를 따라 움직입니다. 확장지원 구간 클러스터에 Provisioned를 붙이면 위 표의 총액보다 커집니다.

이 챕터에는 직접 걸리는 맥락이 있습니다. blue는 1.35 표준지원이라 기본요금 $0.10이 맞지만 green은 확장지원 구간이고 종료일이 2026-11-26입니다([목표버전]({{< relref "../01-target-version.md" >}})). **확장지원 클러스터의 시간당 기본요금 정확한 금액은 이번에 확인하지 않았으므로 금액을 쓰지 않습니다** — "지원 티어에 따라 기본요금이 달라진다"까지만 확정입니다.

### 5.2 리전과 상한

티어 요금은 **us-east-1 · eu-west-1 · ap-northeast-2 · ap-south-1 · us-gov-west-1** 5개 리전을 대조한 결과 전부 동일했습니다(2026-08 기준). China 리전은 확인 범위 밖입니다. 8XL을 넘는 규모가 필요하면 User Guide가 어카운트 팀 문의로 넘깁니다 — 공개 요금표에 없습니다.

환경 일관성(staging↔production의 컨트롤 플레인 성능을 맞춰 배포 전 문제를 조기 발견) 유스케이스를 채택하면 증분이 클러스터 수만큼 곱해진다는 점도 계산에 들어가야 합니다. prod만 XL로 올리는 것과 staging까지 올리는 것은 월 +$1,204.50과 +$2,409.00의 차이입니다.

## 6. 전환과 복귀

### 6.1 전환 자체는 가볍다

| 항목 | 내용 |
|---|---|
| 기본 상태 | 신규·기존 클러스터 모두 Standard. **명시적 opt-in 필수** — 자동 승격은 없다 |
| API | `CreateCluster`·`UpdateClusterConfig`의 `controlPlaneScalingConfig: { tier }` |
| `tier` 허용값 | `standard` \| `tier-xl` \| `tier-2xl` \| `tier-4xl` \| `tier-8xl` |
| 티어 간 자동 스케일 | **없다.** 선택한 티어에 고정 핀. 필요하면 사용률 메트릭과 API로 직접 오토스케일링을 구현하라는 것이 AWS 안내 |
| 전환 소요 | 수 분. **API 서버 다운타임 없음** — 신규 API 서버를 먼저 띄운 뒤 구 서버를 종료한다 |
| 전환 빈도 | **제한 없음** |
| 티어 다운그레이드(8XL→XL 등) | DB 크기 제약 없음 — 전 Provisioned 티어 etcd가 16GB 동일 |
| k8s 버전 | 1.28+ |
| 리전 | 전 상용 + GovCloud + China |

"자동 스케일 없음 + 빈도 제한 없음"이 함께 오는 조합이 설계 여지를 만듭니다. AWS가 오토스케일링을 대신 해주지는 않지만 예상되는 이벤트 앞뒤로 티어를 올렸다 내리는 운영을 막지도 않습니다. 다만 그 운영은 §6.2의 복귀 제약을 매번 통과해야 합니다.

업데이트 추적은 이름 표기가 문서 두 곳에서 엇갈립니다.

| 항목 | 값 |
|---|---|
| 티어 변경 update type | **`ControlPlaneScalingConfigUpdate`**(API Reference `Update` enum) |
| ⚠️ 표기 불일치 | Provisioned CP User Guide 본문은 같은 것을 **`ScalingTierConfigUpdate`**라고 쓴다 |
| 진행 중 클러스터 status | `UPDATING`(eventually consistent) |
| 완료 후 | 성공·실패 무관하게 `ACTIVE` 복귀. 실패 시 `update.errors[]`에 `errorCode`·`errorMessage`·`resourceIds` |

```bash
aws eks list-updates --name "$CLUSTER"
aws eks describe-update --name "$CLUSTER" --update-id "$UPDATE_ID"
aws eks wait cluster-active --name "$CLUSTER"   # 블로킹 대기
```

자동화에서 update type 문자열로 필터를 거는 코드를 쓸 때는 두 이름 중 어느 쪽이 실제 응답에 오는지 먼저 한 번 호출해 확인하는 편이 안전합니다.

"API 서버 다운타임 없음"은 요청 수준의 서술입니다. 컨트롤 플레인 교체 전반을 다루는 AWS re:Post 서술은 기존 watch 연결이 "might be affected"라고 하므로 **전환 중 watch가 끊길 수 있습니다.** 이 문장의 근거는 Provisioned CP 기능 문서가 아니라 컨트롤 플레인 교체 일반을 다루는 서술이라는 점을 함께 밝힙니다 — 컨트롤러가 watch 재연결과 relist를 견디는지는 어차피 확인해 둘 값어치가 있습니다.

### 6.2 Standard 복귀를 막는 두 조건 — 문서가 하나씩 나눠 갖고 있다

이 페이지에서 가장 값진 함정입니다. **Standard로 못 돌아가게 만드는 조건이 둘인데, 각각 다른 문서에만 적혀 있습니다.**

| # | 조건 | 어느 문서에 있나 | 해소 방법 |
|---|---|---|---|
| 1 | **etcd(cluster database) 크기가 8GB 초과** — Standard 상한이 8GB다 | `eks-provisioned-control-plane.html` | DB를 8GB 미만으로 줄인 뒤 전환. User Guide 예시는 14GB 사용 중인 케이스다 |
| 2 | **`horizontalPodAutoscalerSyncPeriod`가 기본값(15s)이 아님** | `control-plane-configuration.html` | 먼저 15s로 되돌리고, 그 다음 티어를 `standard`로 |

Provisioned CP 문서만 읽으면 2번을 모르고, 파라미터 문서만 읽으면 1번을 모릅니다. 조사 과정에서도 Provisioned CP User Guide에서 2번을 재확인하지 못해 열린 질문으로 남았고 파라미터 문서 쪽에서만 명시적으로 확인됐습니다 — 두 조건이 한 문서에 모인 곳은 없습니다.

실무 함의는 하나입니다. **"HPA syncPeriod를 실험적으로 켜 본다"는 결정은 두 단계 롤백을 예약하는 결정**입니다. 파라미터를 되돌리는 업데이트 한 번, 티어를 내리는 전환 한 번. 순서도 고정입니다 — 파라미터가 비기본값인 채로 티어를 `standard`로 내리려 하면 막힙니다.

1번은 성격이 다릅니다. 파라미터는 우리가 되돌리면 되지만 etcd 크기는 워크로드가 만든 결과라서 되돌리는 데 시간과 판단이 듭니다. Provisioned에서 16GB 여유를 쓰다가 8GB를 넘기면, 그 시점부터 Standard 복귀는 **요금 결정이 아니라 데이터 정리 프로젝트**가 됩니다. 티어를 켤 때 `apiserver_storage_size_bytes`에 8GB 경보를 함께 걸어 두는 편이 낫습니다.

## 7. 티어 수치는 보장 처리량이 아니다

User Guide에 "Understanding Tier capacity versus actual performance" 섹션이 따로 있고, 티어의 숫자가 처리량 보장이 아니라 **"underlying configuration"**이라고 못박습니다. list 요청이 get 요청보다 큰 페널티를 받는 것처럼 요청 종류에 따라 실효 처리량이 달라지고, **APF는 Provisioned에서도 계속 작동합니다.**

그래서 "우리는 초당 N 요청이 필요하니 N을 넘는 티어를 고른다"는 계산이 성립하지 않습니다. AWS 자신의 권고도 계산이 아닙니다.

> 최적 티어 선정: **8XL(최고 티어)로 프로비저닝 → 피크 수요를 시뮬레이션하는 로드테스트 → 피크 부하에서 티어 사용률 메트릭 관찰 → 그 관측을 근거로 적정 티어 선택.**

공식 절차가 "과할당해서 측정한 뒤 내린다"라는 뜻입니다. 8XL 로드테스트 기간의 요금($14.00/h)을 선정 비용으로 예산에 넣어야 하고, 그 뒤 내리는 전환이 §6.2의 복귀 제약과는 무관하다는 점(티어 간 다운그레이드는 DB 제약이 없다)도 함께 봐야 합니다.

> **2차 해설에 도는 노드·파드 규모 벤치마크 수치는 이 페이지에서 쓰지 않는다.** 해당 수치는 AWS containers 블로그 본문을 요약 도구가 생성한 값이고 원문을 직접 대조하지 못했다. 1차 문서인 User Guide·요금 페이지·API Reference 어디에도 그런 규모 수치는 없다. 티어 선택의 근거로 인용하면 검증되지 않은 숫자에 요금 결정을 걸게 된다.

## 8. 관측

티어 사용률을 보는 메트릭은 축마다 하나씩 대응됩니다.

| 무엇 | Prometheus | CloudWatch |
|---|---|---|
| API 요청 동시성 | `apiserver_flowcontrol_current_executing_seats` | 동일 |
| Pod 스케줄링 처리율 | `scheduler_schedule_attempts_total` | `scheduler_schedule_attempts_total` · `scheduler_schedule_attempts_SCHEDULED` · `scheduler_schedule_attempts_UNSCHEDULABLE` |
| Cluster DB 크기 | `apiserver_storage_size_bytes` | `etcd_mvcc_db_total_size_in_use_in_bytes` |
| HPA 적체 | `workqueue_depth{name="horizontalpodautoscaler"}` | — |

- `etcd_mvcc_db_total_size_in_use_in_bytes`는 Prometheus 메트릭으로도 **2026년 하반기 중 전체 EKS 클러스터에 순차 배포 예정**이다. 그 전까지 Prometheus 경로에서는 `apiserver_storage_size_bytes`를 쓴다.
- `workqueue_depth{name="horizontalpodautoscaler"}`가 **0 근처에 머물면 컨트롤 플레인이 따라가고 있다는 뜻**이다(User Guide: "A workqueue depth that stays at or near zero indicates the control plane is keeping up"). 이 값이 0인데 오토스케일이 느리다고 느껴진다면 병목은 컨트롤 플레인이 아니라 워크로드 쪽이다.
- **콘솔**: 클러스터 Overview → Monitor cluster → 옵저버빌리티 대시보드 → **Control plane monitoring** 탭 → **Control plane scaling** 섹션에서 티어 대비 사용률을 시각화한다.
- **현재 티어 확인**: `aws eks describe-cluster --name "$CLUSTER" --query 'cluster.controlPlaneScalingConfig.tier'`. `DescribeCluster` 응답에 `controlPlaneScalingConfig`가 그대로 포함된다.

```bash
# 현재 티어
aws eks describe-cluster --name "$CLUSTER" \
  --query 'cluster.controlPlaneScalingConfig.tier' --output text

# 버전별 티어 정의(수치·컴포넌트 오버라이드)
aws eks describe-cluster-versions \
  --query 'clusterVersions[].controlPlaneScalingTiers[]'
```

티어를 켤지 판단하는 순서는 이 메트릭들이 정해줍니다. 먼저 Standard에서 네 메트릭을 보고 **어느 축이 실제로 상한에 닿는지**를 식별하고, 그 축이 티어가 늘려주는 축인지 확인한 다음(§3.1의 비대칭 때문에 이 확인이 필요합니다) 요금을 계산합니다. 축을 식별하지 않고 티어부터 올리면 §3.1의 함정을 그대로 밟습니다.

## 우리 케이스에서는

**해당 없습니다.** finance가 Provisioned CP를 켜서 새로 얻는 것은 실질적으로 [레이어 2]({{< relref "02-component-parameters.md" >}})의 HPA `syncPeriod` 하나(15s→10s)뿐인데, 최소 티어인 XL의 증분이 월 **+$1,204.50**입니다. 그 5초를 사서도 실효가 나지 않습니다 — metrics-server 기본 `--metric-resolution`이 15초라 10초 reconcile의 상당수가 같은 스냅샷을 다시 읽고, 스케일다운 지연을 지배하는 `behavior.scaleDown.stabilizationWindowSeconds`(기본 5분)는 이번에 열리지 않아 실효가 scaleUp 반응성에만 걸립니다. 나머지 축은 애초에 필요가 없습니다 — 99.99% SLA를 요구하는 계약이 없고, etcd 8GB나 파드 스케줄링 400/s에 닿는 규모도 아닙니다.

판단을 뒤집을 조건은 명확하게 정해 둘 수 있습니다. `workqueue_depth{name="horizontalpodautoscaler"}`가 지속적으로 0에서 떨어져 있거나 `apiserver_flowcontrol_current_executing_seats`가 Standard 상한 부근에서 429를 만들기 시작하면 그때 다시 계산합니다. 그전까지 오토스케일 체감이 느린 원인은 컨트롤 플레인이 아닌 쪽에 있고(§8), 그쪽 값들은 추가 비용 없이 워크로드에서 조절할 수 있습니다. 게다가 지금 켜면 **켜는 결정이 아니라 두 단계 롤백을 예약하는 결정**(§6.2)이 되므로, blue 안정화 전에는 후보로도 올리지 않습니다.
