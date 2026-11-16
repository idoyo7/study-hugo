---
title: "오리진의 리전을 알게 된 Smart Tiered Cache"
description: "anycast IP까지의 짧은 지연이 가까운 오리진을 뜻하지는 않습니다. Cloudflare는 리전 힌트와 클라우드 IP 대역, 탐사 데이터를 결합해 퍼블릭 클라우드 오리진에 맞는 upper tier를 선택합니다."
date: 2026-11-16
weight: 7
---

# 오리진의 리전을 알게 된 Smart Tiered Cache (2026-07)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Improving Smart Tiered Cache for Public Cloud Regions](https://blog.cloudflare.com/smart-tiered-cache-for-public-clouds)
- 매체 · 게시일: The Cloudflare Blog · 2026-07-10
- 저자: Chenxi Zhang
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## Singapore를 두고 Chicago로 향한 요청 {#single-upper-tier-and-location-limits}

오리진은 Singapore에 있고 사용자도 아시아에 있는데, 요청은 Chicago까지 갔다가 돌아올 수 있습니다. 클라우드의 anycast IP 뒤에 오리진을 두었을 때 생길 수 있는 경로입니다. 요청이 가까운 Cloudflare 데이터 센터에 도착한 뒤 상위 캐시인 upper tier를 찾아 Chicago로 건너가고, 그곳에서 다시 Singapore의 오리진을 조회합니다.

바다를 두 번 건넙니다. 이런 헤어핀 경로는 수백 밀리초의 지연을 더할 수 있으며, 클라우드에 오리진을 둔 고객이 가장 꾸준히 보고해 온 문제 중 하나입니다.

2021년에 출시한 Smart Tiered Cache는 각 Cloudflare 데이터 센터에서 오리진 IP까지의 지연을 재고, 가장 짧은 곳 하나를 upper tier로 고릅니다. 캐시 미스 요청을 한곳에 모으려는 설계입니다. 이렇게 모인 요청이 같은 캐시를 공유하면 적중률은 높아지고, 오리진 연결 수와 조회 지연은 줄어듭니다. IP가 고정된 한 장소를 가리킨다면 잘 작동하는 방식입니다.

퍼블릭 클라우드에서는 IP가 가리키는 대상부터 달라집니다. 로드 밸런서나 프런트엔드, 리전 진입점에 쓰이는 anycast 또는 regional unicast IP는 실제 오리진의 단일 위치를 나타내지 않습니다. 같은 IP를 탐사해도 각 Cloudflare 데이터 센터는 서로 다른 인근 클라우드 엣지에 닿고, 실제 백엔드까지의 요청 전달은 클라우드 사업자 네트워크가 맡습니다. 여러 데이터 센터에서 오리진이 모두 가깝게 보이는 이유입니다. 이 때문에 Singapore에 오리진을 두고도 탐사 지연이 가장 짧게 나온 Chicago를 upper tier로 고를 수 있습니다.

## 빛의 속도로 가려낸 anycast 응답 {#hairpin-routing-and-safe-fallback}

Cloudflare는 이 불필요한 왕복을 피하려고 빛의 속도를 기준으로 anycast를 감지하도록 했습니다. 세계 각지의 체크포인트 데이터 센터에서 오리진까지 탐사 지연을 잽니다. 두 체크포인트에서 잰 지연의 합이 두 지점 사이를 빛이 광섬유로 이동하는 데 필요한 시간보다 짧다면, 오리진이 한 장소에서 응답한 것으로는 설명할 수 없습니다. 같은 IP가 여러 위치에서 응답하고 있다는 뜻입니다.

anycast로 판단한 IP는 하나의 upper tier에 고정하지 않습니다. 여러 upper tier를 쓰는 토폴로지로 전환해 계층형 캐시가 계속 작동하도록 합니다. 안전한 선택이지만 대가가 있습니다. 요청이 여러 캐시로 흩어지면서 한곳에 모았을 때보다 오리진에 도달하는 요청이 늘어납니다. 어떤 구성에서는 받아들일 만해도, anycast 뒤의 클라우드 오리진 가까이에 upper tier 하나를 두려는 고객에게는 부족한 선택이었습니다.

이번 Smart Tiered Cache for Public Cloud Regions는 사용자가 오리진의 클라우드 리전을 알려 주도록 했습니다. 이 리전 힌트를 받으면 Cloudflare는 위치가 모호한 IP의 탐사 결과에만 기대지 않고, 해당 리전에 적합한 기본 upper tier와 대체 upper tier를 선택합니다.

## 서브넷의 투표로 정해지는 리전별 upper tier {#cloud-prefixes-and-probe-data}

리전 이름을 아는 것만으로 선택이 끝나지는 않습니다. Cloudflare는 지원하는 클라우드 사업자의 IP 대역 파일을 몇 시간마다 가져와, 각 리전에 속한 IP 프리픽스를 확인합니다. 사업자가 서브넷을 추가하거나 삭제하고 다른 리전으로 재할당하는 변화도 여기에 반영합니다.

그다음에는 수집한 서브넷을 upper tier 데이터베이스와 대조합니다. 이 데이터베이스는 지속적인 지연 탐사로 구축하며 15분마다 갱신합니다. 각 리전에서 일치하는 서브넷은 현재 자신의 upper tier 할당을 바탕으로 가중 투표에 참여하고, 가장 강한 신호를 얻은 upper tier가 그 리전의 기본 upper tier가 됩니다.

투표할 데이터가 없는 리전도 있습니다. 예를 들어 클라우드 사업자가 새 리전을 아직 구축 중이거나, 해당 리전에 Cloudflare에 등록된 오리진이 없어 탐사 데이터가 부족할 수 있습니다. 이때는 지리적으로 가장 가까운 Tier 1 PoP를 선택합니다. 이후 오리진이 등록되고 탐사 데이터가 쌓이면 지리적 추정에서 실제 데이터에 근거한 선택으로 자동 전환합니다.

장애에 대비한 배치 조건도 있습니다. 기본 upper tier와 대체 upper tier는 항상 서로 다른 PoP에서 고릅니다. 한 PoP를 잃었을 때 둘 모두가 중단되지 않도록 한 구성입니다.

## 대시보드에서 지정하는 오리진의 리전 {#origin-region-hints}

설정은 오리진 IP에서 시작합니다. 대시보드의 Caching > Tiered Cache > Origin Configuration에서 해당 IP를 찾아 Set Region Hint를 선택하고 클라우드 리전을 지정합니다. 리전 힌트 문자열의 예로는 `aws:us-east-1`, `gcp:europe-west1`이 있습니다. 대시보드에서는 Cloudflare가 anycast로 감지한 IP에만 힌트를 설정할 수 있습니다.

IP별로 지정해도 되고, 여러 오리진 IP의 클라우드 리전을 한꺼번에 편집해도 됩니다. 같은 설정을 API와 Terraform에서도 지원하므로 기존 코드 기반 인프라 관리 작업에 포함할 수 있습니다. 사용자가 리전 힌트를 지정하면 지속적인 탐사와 upper tier 선정, 지리적 대체 경로와 PoP 간 장애 전환은 Cloudflare가 처리합니다.

Smart Tiered Cache는 모든 요금제에서 무료로 제공되며, Cloudflare 고객이 가장 많이 사용하는 계층형 캐시 토폴로지입니다. 앞서 R2 버킷의 실제 위치에 가까운 upper tier를 자동으로 고르고, Load Balancing 풀 전체가 하나의 최적 upper tier와 캐시를 공유하도록 지원 범위를 넓혔습니다. 이번에는 AWS, GCP, Azure, Oracle Cloud의 오리진에 리전 힌트를 사용할 수 있게 됐습니다.

새 기능 적용 전후의 캐시 적중률, 오리진 요청 수, 지연 감소량을 비교한 실측 결과는 원문에 제시되지 않았습니다. 앞서 나온 수백 밀리초도 헤어핀 경로가 더하는 지연의 설명이며, 이번 기능으로 측정한 개선 폭은 아닙니다. Cloudflare는 앞으로 지원 사업자를 늘리고, 더 다양한 오리진 구성을 인식해 적절한 경로를 자동으로 선택하도록 Smart Tiered Cache를 확장할 계획입니다.

{{% details title="도입 시점과 갱신 주기·설정 예시" closed="true" %}}
| 항목 | 값 |
|---|---|
| Smart Tiered Cache 최초 출시 | 2021년 |
| R2 지원 확장 | 2024년 11월, 버킷의 실제 위치에 가장 가까운 upper tier 자동 선택 |
| Load Balancing 지원 확장 | 2025년 1월, 풀 전체에 단일 최적 upper tier 선택 |
| 이번 출시의 지원 사업자 | AWS, GCP, Azure, Oracle Cloud |
| 클라우드 IP 대역 파일 수집 주기 | 몇 시간마다 |
| 지연 탐사 기반 upper tier 데이터베이스 갱신 주기 | 15분마다 |
| 리전 힌트 문자열 예시 | `aws:us-east-1`, `gcp:europe-west1` |
| 헤어핀 경로의 지연 설명 | Singapore 오리진을 Chicago upper tier로 조회하는 예시에서 수백 ms가 추가될 수 있음 |
| 탐사 데이터 부족 시 선택 | 가장 가까운 Tier 1 PoP |
| 기본·대체 upper tier 배치 조건 | 서로 다른 PoP |
{{% /details %}}
