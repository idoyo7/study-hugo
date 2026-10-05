---
title: "부록 · 사이드카와 Ambient의 지연·롤아웃 실측은 무엇을 말하는가"
linkTitle: "부록 A 실측 비교"
description: "atomai 문서가 보고한 사이드카, Ambient L4(ztunnel), Ambient L7(waypoint)의 지연 분포와 롤아웃 중 503 비율, 측정 조건과 원문이 밝힌 한계를 정리하고, 본편 01의 도입 이유와 같은 방향인 부분과 나란히 놓을 수 없는 부분을 구분한다."
weight: 90
date: 2026-10-05
lastmod: 2026-10-05
url: "/istio/ambient/a1-sidecar-vs-ambient-measurements/"
---

# 부록 · 사이드카와 Ambient의 지연·롤아웃 실측은 무엇을 말하는가

사이드카, ztunnel만 쓰는 Ambient L4, waypoint를 추가한 Ambient L7의 차이는 정상 요청과 롤아웃에서 각각 확인해야 합니다. atomai의 [Sidecar vs Ambient 모드 선택 가이드 (EKS 1.36 실험 보고)](https://www.atomai.click/kubernetes-docs/ko/service-mesh/istio/comparison/03-sidecar-vs-ambient)는 같은 클러스터에서 지연 분포와 Deployment 재시작 중의 오류를 비교했습니다.

측정된 것은 지연과 HTTP·비HTTP 결과입니다. CPU·메모리 사용량은 측정하지 않았고, 원문의 리소스 절감 수치는 가정 입력으로 계산한 예산 모델입니다. 따라서 이 부록은 본편 01의 프록시 메모리·컨트롤 플레인 부하에 관한 도입 근거와 구분해 읽어야 합니다.

근거 표기 — `✓` 원문 직접 확인 · `Ⓑ` 원문이 보고한 벤치마크 수치 · `Ⓥ` 저자 주장 · `?` 원문에서 확인하지 못함. 각 절 끝의 '근거와 측정 조건'에 조건을 모았습니다. 본편은 [01 왜 Ambient mode인가]({{< relref "/platform/istio/ambient/01-why-ambient-mode/index.md" >}})와 [10 Ambient 이행 심사]({{< relref "/platform/istio/ambient/10-ambient-migration-questions.md" >}})입니다.

## 1. 정상 상태의 지연

Istio 1.30.2·EKS 1.36.2 환경에서 Fortio 1.69.4로 200 QPS, 연결 16개, 60초를 설정했습니다. 노드는 eksctl 입력 기준 Amazon Linux 2023 arm64 m7g.xlarge 3대이며, 케이스마다 성공 요청 12,000건을 기록했습니다. 원문의 보고일은 2026-08-21입니다.

| 경로 | P50 | P99 | P99.9 | 기준선 대비 P50 |
|---|---|---|---|---|
| no-mesh | 0.82ms | 1.97ms | 2.00ms | 기준선 |
| 사이드카 | 2.11ms | 3.91ms | 8.00ms | +1.29ms |
| Ambient L4(ztunnel만) | 0.86ms | 1.98ms | 2.93ms | +0.04ms |
| Ambient L7(waypoint) | 2.68ms | 3.98ms | 7.67ms | +1.86ms |

이 표본에서 L4 경로는 기준선에 가까웠고 waypoint의 P50은 사이드카보다 0.57ms 컸습니다. P99.9에서는 사이드카 8.00ms와 waypoint 7.67ms가 가까웠습니다. L7 기능이 필요한 서비스에서 Ambient가 지연 면에서 앞선다는 결과로 읽을 수는 없습니다.

원시 결과 파일과 정확한 실행 스크립트 아카이브는 없고 반복 편차도 제시하지 않았습니다. payload·정책, 지연 실험의 echo replica 수와 프록시 리소스 조건도 충분히 공개되지 않았습니다. 원문은 이 표로 작은 차이를 무시해도 된다거나 SLO를 만족한다고 판단하지 말라고 명시합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 케이스별 지연 분포 | no-mesh P50 0.82 / P99 1.97 / P99.9 2.00ms, 사이드카 2.11 / 3.91 / 8.00ms, ambient-L4 0.86 / 1.98 / 2.93ms, ambient-L7 2.68 / 3.98 / 7.67ms | atomai 03-sidecar-vs-ambient §3 | `Ⓑ` |
| P50 기준선 대비 차이 | 사이드카 +1.29ms, ambient-L4 +0.04ms, ambient-L7 +1.86ms. 원문이 뺄셈이 맞다고 확인 | 같은 문서 §3 | `Ⓑ` |
| 부하 조건 | Fortio, 요청 설정 200 QPS, 60초, 연결 16개, 케이스마다 성공 요청 12,000건 | 같은 문서 §3 | `Ⓑ` |
| 실험 환경 | Istio 1.30.2, EKS 1.36.2, Fortio 1.69.4. 노드는 Amazon Linux 2023 arm64 m7g.xlarge 3대(eksctl 입력 기준, 볼륨 40GB). 원문 보고일 2026-08-21 | 같은 문서 머리말·§1·부록 A | `✓` |
| 원시 결과와 스크립트가 없음 | 전체 원시 결과와 정확한 실행 스크립트 아카이브가 첨부되지 않았고, 검토 때 클러스터를 재구성하지 않음. 설정과 산술 검증은 독립 재현이 아니라고 명시 | 같은 문서 머리말 | `✓` |
| 반복 횟수와 편차 | 원문에 반복 실험 횟수나 편차가 없음. 원문도 판단하려면 반복 편차가 필요하다고 적음 | 같은 문서 §3 | `?` |
| 요청 크기·응답 크기·정책 구성 | 지연 실험의 payload와 부착한 정책 | — | `?` |
| 지연 실험의 echo replica 수와 프록시 리소스 설정 | 롤아웃 절은 echo 6개 replica로 적혀 있으나 지연 절에는 따로 적히지 않음. 주입·공유 프록시 리소스도 모드마다 달랐다고만 기술 | 같은 문서 §3·§4 | `?` |
| Cilium 열 | 배포하지 않았고 이번 실험에서 쟀다는 값이 없음 | 같은 문서 선택 요약 | `✓` |

출처: [Sidecar vs Ambient 모드 선택 가이드 (EKS 1.36 실험 보고)](https://www.atomai.click/kubernetes-docs/ko/service-mesh/istio/comparison/03-sidecar-vs-ambient) — 「3. Latency — 실험 결과 (T5)」
{{% /details %}}

## 2. 롤아웃 중 503

메시 네임스페이스마다 echo 6개 replica와 Fortio client를 두고 대상 Deployment를 반복 재시작했습니다. 요청 설정은 100 QPS, 실행 시간은 600초입니다. 조정 전 사이드카는 60,000건 중 503이 324건(0.5%), waypoint 없는 Ambient는 503이 0건, waypoint를 둔 Ambient는 59,913건 중 503이 1,528건(2.6%)이었습니다.

HTTP 상태 코드만으로 오류를 세면 일부 결과가 빠집니다. waypoint 없는 Ambient에는 HTTP 응답을 받지 못한 Fortio -1이 195건(0.3%) 있었습니다. 사이드카는 2건, waypoint 경로는 84건입니다. 실제 오류 기록이 없어 reset·EOF·timeout 중 무엇이었는지는 원문도 구분하지 못했습니다.

후속 실행에서는 모든 모드에 preStop sleep 10초와 종료 유예 40초를 적용했습니다. 사이드카에는 `EXIT_ON_ZERO_ACTIVE_CONNECTIONS`와 drain 30초 설정도 추가했습니다. 이 표본에서 사이드카와 ztunnel만 쓴 경우는 오류가 0건이었습니다. waypoint 경로는 성공 200이 59,352건, 503이 648건(1.1%)이었고 비HTTP 결과는 0건이었습니다.

결과는 개선됐지만 종료 조정 하나의 독립 효과를 분리한 실험은 아닙니다. 사이드카는 조정 요인이 둘이고, 롤아웃 횟수도 모드별로 조정 전 42/64/65회, 조정 후 42/38/45회로 달랐습니다. 목적지 IP 재사용 경쟁이나 ztunnel 알림 누락이라는 원인 설명은 원문에서도 가설입니다. 남은 waypoint 오류가 같은 원인인지, 다른 모드가 언제나 오류 없이 동작하는지는 이 결과로 확인할 수 없습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 조정 전 결과 | 사이드카: 롤아웃 42회, 60,000건 중 503 324건(0.5%), -1 2건. ambient-L4: 64회, 60,000건 중 503 0건, -1 195건(0.3%). ambient-L7: 65회, 59,913건 중 503 1,528건(2.6%), -1 84건(0.1%) | atomai 03-sidecar-vs-ambient §4 | `Ⓑ` |
| 조정 후 결과 | 사이드카: 42회, 60,000건 모두 200. ambient-L4: 38회, 60,000건 모두 200. ambient-L7: 45회, 59,352건 200과 503 648건(1.1%), -1 0건 | 같은 문서 §4 | `Ⓑ` |
| 실험 조건 | 메시 네임스페이스마다 echo 6개 replica와 Fortio client, 요청 설정 100 QPS, 600초, 대상 Deployment 반복 재시작 | 같은 문서 §4 | `Ⓑ` |
| 조정 내용 | 모든 모드에 preStop sleep 10초, 종료 유예 40초. 사이드카에 `EXIT_ON_ZERO_ACTIVE_CONNECTIONS=true`와 `terminationDrainDuration` 30s | 같은 문서 §4 | `✓` |
| 평균 지연과 Fortio 소켓 수 | 조정 전 waypoint 평균 50.4ms, 다른 두 모드는 약 2~3ms. 조정 후 평균은 사이드카 2.630ms, ambient-L4 1.189ms, ambient-L7 3.843ms. 소켓 수는 조정 전 350/1,652/2,486, 조정 후 16/395/678 | 같은 문서 §4 | `Ⓑ` |
| 503 비율의 배수 | 324/60,000은 0.54%, 1,528/59,913은 약 2.55%로 비는 약 4.72. 원문의 "약 5배"는 이 표본의 설명이며 제품 고유 배수가 아님 | 같은 문서 §4 한계 1 | `✓` |
| 집계 수가 명목 부하보다 적음 | waypoint 59,913건은 명목 60,000건보다 87건 적음. 시간 기반 실행이라 집계가 적을 수 있고, 누락 요청의 상태를 단정하지 않음 | 같은 문서 §4 한계 3 | `✓` |
| 롤아웃 횟수가 모드마다 다름 | 서로 다른 롤아웃 노출과 리소스·시간선 증거 부족으로 인과 비교에 제약 | 같은 문서 §4 한계 5 | `✓` |
| IP 재사용 경쟁·알림 누락 원인 설명 | 원문이 가설로 분류. 응답 플래그, upstream host, endpoint/Pod UID 시간선 확인이 필요하다고 명시 | 같은 문서 §4 배경 | `Ⓥ` |
| 남은 waypoint 오류의 원인 | 같은 원인이라는 증거가 없고, 다른 모드가 언제나 오류 없다는 보장도 아님 | 같은 문서 §4 | `✓` |
| 반복 실험 횟수 | 모드·조건마다 한 번인지 여러 번인지 원문에 없음 | — | `?` |

출처: [Sidecar vs Ambient 모드 선택 가이드 (EKS 1.36 실험 보고)](https://www.atomai.click/kubernetes-docs/ko/service-mesh/istio/comparison/03-sidecar-vs-ambient) — 「4. 무중단 롤아웃 — 503 실험 결과 (핵심 관측)」, 「후속 실험: graceful shutdown 조정 후」
{{% /details %}}

## 3. 리소스 예산 모델과 실측의 차이 {#3-리소스-수치는-어디에-있는가}

원문의 비교 가이드에는 프록시 리소스 실측 절이 없습니다. Ambient 개요(advanced/01)는 이전 성능 표의 이미지 링크가 404였고 Pod별 CPU·메모리·지연 수치의 출처를 확인하지 못해 표를 삭제했다고 밝힙니다.

남아 있는 것은 100파드를 가정한 예산 계산입니다. 사이드카를 파드마다 50MB·0.1 vCPU로 놓으면 5,000MB·10 vCPU입니다. Ambient에 ztunnel 10개(각 50MB·0.1 vCPU)와 waypoint 하나(200MB·0.5 vCPU)를 둔다고 가정하면 700MB·1.5 vCPU로 계산됩니다. 이 입력에서는 메모리 약 86%, CPU 약 85%가 줄어듭니다.

원문은 이 값을 추천 request·limit이나 실측 비용으로 제시하지 않았습니다. waypoint replica 수가 바뀌면 계산도 달라집니다. 실제 비교에는 ztunnel·waypoint 전체 replica와 컨트롤 플레인 자원을 포함해야 하고, request나 사용량 감소가 청구 감소를 뜻하지도 않는다고 설명합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 이전 성능 표를 삭제함 | 이미지 URL이 404였고 Pod별 CPU·메모리·지연·처리량 수치의 출처를 확인하지 못함 | atomai advanced/01-ambient-mode, 성능 비교 | `✓` |
| 100파드 절감 계산 | 사이드카 100 x 50MB = 5,000MB, 100 x 0.1 = 10 vCPU. Ambient 10 x 50 + 200 = 700MB, 10 x 0.1 + 0.5 = 1.5 vCPU. 절감 4,300MB(86%), 8.5 vCPU(85%) | 같은 문서, 리소스 절감 계산 | `✓` |
| 계산 입력의 성격 | 가상 예산 모델의 가정 입력. 추천 request·limit이나 실측 비용이 아님 | 같은 문서 | `✓` |
| 실험 echo·client의 리소스 설정 | echo와 Fortio client 컨테이너가 request 50m CPU·32Mi, limit 300m CPU·128Mi. 프록시 쪽 값이 아니라 애플리케이션 컨테이너 설정이며, 사용량 측정 결과가 아님 | 비교 가이드 부록의 워크로드 템플릿 | `✓` |
| 실사용 메모리·CPU 측정 | 사이드카·ztunnel·waypoint의 사용량 실측 | — | `?` |
| 비용과 청구 | request나 사용량이 줄어도 청구가 줄어든다는 뜻은 아니라고 원문이 명시 | 같은 문서, 벤치마크 결과 표 | `✓` |
| 기업 절감 수치 | 출처 없는 기업 절감 수치는 비용 감소 보장의 근거가 아니라고 원문이 명시 | 같은 문서, 검증한 이력과 현재 제한 절 | `✓` |

출처: [Ambient Mode](https://www.atomai.click/kubernetes-docs/ko/service-mesh/istio/advanced/01-ambient-mode) — 「성능 비교」, 「벤치마크 결과」, 「리소스 절감 계산」, 「검증한 이력과 현재 제한」. 워크로드 템플릿 행은 [Sidecar vs Ambient 모드 선택 가이드 (EKS 1.36 실험 보고)](https://www.atomai.click/kubernetes-docs/ko/service-mesh/istio/comparison/03-sidecar-vs-ambient) — 「부록: 후속 실험 절차」, 「C. 네임스페이스와 워크로드 매니페스트」
{{% /details %}}

## 4. 도입 사례와 비교할 수 있는 범위 {#4-본편과-나란히-놓을-때}

본편 01은 4,000개 파드에 사이드카를 붙일 때 idle 메모리만 약 240Gi가 필요하고 컨트롤 플레인 부하가 사이드카 수에 따라 비선형으로 커진다고 설명합니다. 사이드카 60Mi·ztunnel 12Mi라는 메모리 값은 본편이 인용한 Istio 공식 성능 문서와 채널코퍼레이션 측정에서 나온 것이며 이 외부 실험의 값이 아닙니다.

| 비교 조건 | 이 외부 실험 | 본편 01 |
|---|---|---|
| 규모 | 노드 3대, 롤아웃 실험 echo 6개 replica | 수천 개 파드의 프록시 고정비 |
| 측정·판단 대상 | 지연과 롤아웃 중 오류 | 메모리와 컨트롤 플레인 전파 |
| 워크로드 | Fortio echo 서버 | 실제 서비스 |
| waypoint 지연 | 사이드카보다 P50이 큼 | hop 증가를 설명하지만 대응 측정값은 없음 |

두 문서 모두 ztunnel을 노드 단위 L4 프록시로, waypoint를 필요한 곳에 두는 L7 프록시로 설명합니다. 프록시 수에 따라 자원이 달라진다는 관계는 연결해 볼 수 있지만, 원문의 100파드 예산 모델을 채널코퍼레이션 규모에 적용해 절감률을 계산할 근거는 없습니다.

롤아웃 오류는 [03-1 503과 Half-open Connection]({{< relref "/platform/istio/ambient/03-1-503-half-open-connection/index.md" >}})과 함께 읽을 수 있습니다. 본편은 waypoint가 죽은 Pod의 터널을 재사용하는 문제를 다룹니다. 외부 실험의 waypoint 503도 같은 원인인지는 확인되지 않았습니다.

본편: [01 왜 Ambient mode인가]({{< relref "/platform/istio/ambient/01-why-ambient-mode/index.md" >}})

## 5. NetworkPolicy에서 확인한 허용 포트 {#5-본편에-없던-보충}

원문의 VPC CNI NetworkPolicy 실험에서는 TCP 8080만 허용했을 때 Ambient L4와 L7 모두 `i/o timeout`으로 막혔습니다. TCP 15008(HBONE)을 함께 허용하자 200 OK가 됐습니다. 이 결과는 검사한 경로에서 필요한 허용 조건을 보여 주며, 모든 환경의 최소 권한 정책이 완성됐다는 뜻은 아니라고 원문이 밝혔습니다.

원문 저자는 mTLS만 필요하면 L4부터 검증하고 L7이 필요한 서비스에만 waypoint를 추가하라고 권합니다. 이는 저자의 운영 권고입니다. 지연·롤아웃 결과와 함께 검토하되 프록시 자원이나 정책을 같은 조건에서 측정했다는 의미로 확대하지 않습니다.

출처: [Sidecar vs Ambient 모드 선택 가이드 (EKS 1.36 실험 보고)](https://www.atomai.click/kubernetes-docs/ko/service-mesh/istio/comparison/03-sidecar-vs-ambient) — 「2. NetworkPolicy — 실험 결과」, 「5. 권장: 요구사항에 따른 계층별 접근」

## 확인하지 못한 것

| 항목 | 상태 |
|---|---|
| 지연 실험의 반복 횟수·편차 | 원문에 없음 |
| 사이드카·ztunnel·waypoint의 실사용 메모리·CPU | 실측이 없음 |
| 지연 실험의 payload와 정책 구성 | 원문에 없음 |
| Fortio -1의 구체적 원인 | 오류 기록이 없어 원문도 단정하지 않음 |
| 원시 결과 JSON과 정확한 실행 스크립트 | 첨부되지 않음 |
| Cilium의 지연·롤아웃 | 이번 실험에서 쟀다는 값이 없음 |

## 출처

- 원문 1: Sidecar vs Ambient 모드 선택 가이드 (EKS 1.36 실험 보고) — atomai, 원문 보고일 2026-08-21, 마지막 업데이트 2026-09-11. https://www.atomai.click/kubernetes-docs/ko/service-mesh/istio/comparison/03-sidecar-vs-ambient
- 원문 2: Ambient Mode — atomai, 마지막 업데이트 2026-09-11. https://www.atomai.click/kubernetes-docs/ko/service-mesh/istio/advanced/01-ambient-mode
