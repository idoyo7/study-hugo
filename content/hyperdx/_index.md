---
title: "HyperDX 내재화"
date: 2026-07-15
lastmod: 2026-08-24
weight: 70
cascade:
  type: docs
comments: false
---

# HyperDX 내재화

월 0.7TB 규모의 RUM 데이터를 ClickStack에 저장하려면 ClickHouse 외에도 수집기, 조회 애플리케이션, 메타데이터 저장소를 운영해야 합니다. 이 시리즈는 세션 리플레이·로그·트레이스·Web Vitals를 EKS에 적재하는 구성을 다룹니다. staging에서 시작해 prod로 확장하는 과정에 맞춰 스토리지, 복제, 장애 복구, 비용을 살펴봅니다.

여기서 제시하는 prod 구성은 설계안입니다. 2026-08 배포 기록의 stage는 ClickHouse replica 1, MongoDB `members:1`, Collector 인메모리 큐, EBS 단일 티어로 운영했습니다. 자체 RUM 컨버터를 포함한 실제 배치와 설계안의 차이는 [우리 배포 형상]({{< relref "../hyperdx-operating/01-our-deployment.md" >}})에 기록했습니다.

<span id="핵심-결정-요약"></span>

## EBS로 시작하는 구성 {#이-챕터의-위치--전제-차이}

ClickStack 차트에서 `clickhouse.enabled: false`를 설정하고, Altinity operator가 관리하는 ClickHouse(CHI)와 Keeper(CHK)에 연결합니다. 이 글에서는 이를 HyperDX Only 구성이라고 부릅니다. ClickHouse Cloud의 상품인 BYOC와는 구분해야 합니다.

hot 저장소는 gp3 단일 볼륨으로 시작합니다. 노드를 교체해도 EBS 볼륨이 남아 같은 AZ의 새 노드에 다시 연결할 수 있기 때문입니다. [ClickHouse 운영 시리즈]({{< relref "../clickhouse/_index.md" >}})의 로컬 NVMe 구성은 더 큰 데이터와 높은 성능을 전제로 합니다. 이 RUM 구성에서는 복구 절차와 운영 부담을 고려해 EBS를 선택했습니다.

prod 목표는 1 shard × RF2를 2개 AZ에 배치하고, Keeper 3노드를 3개 AZ에 분산하는 것입니다. 오래 보관할 데이터는 S3 Standard로 이동합니다. MongoDB는 설정과 사용자 정보를 저장하며, prod에서는 3멤버 구성이나 Atlas를 검토합니다. 수집 중인 데이터는 Collector 영속 큐와 재시도, ClickHouse의 INSERT 확인 설정까지 함께 설계해야 보호할 수 있습니다.

<span id="우리-케이스-청사진-한-장-토폴로지"></span>

{{< flow src="_flow/우리-케이스-청사진-한.json" />}}

위 그림은 표준 SDK·Collector 경로를 설명합니다. 우리 배포의 RUM 데이터는 자체 컨버터에서 ClickHouse로 직접 들어가며, 표준 텔레메트리의 Collector 경로와 별개입니다. MongoDB에는 두 경로의 이벤트 본문이 들어가지 않습니다.

## 설치와 저장소 설정 {#이-챕터-구성-문서-지도}

| 글 | 다루는 내용 |
|---|---|
| [스택 토폴로지]({{< relref "01-stack-topology.md" >}}) | 컴포넌트 배치, 포트와 데이터 흐름, MongoDB 운영 |
| [hot 스토리지와 EBS]({{< relref "02-hot-storage-ebs.md" >}}) | gp3·io2 선택, 인스턴스 대역폭, StorageClass와 PVC |
| [S3 cold 티어링]({{< relref "03-s3-cold-tiering.md" >}}) | storage policy, cache disk, TTL, IRSA와 네트워크 경로 |
| [블록 스토리지만 쓰는 구성]({{< relref "08-block-only-tuning.md" >}}) | S3 없이 보관할 때의 TTL·볼륨 확장·merge 튜닝 |

## 장애와 변경에 대비하기

[토폴로지와 다운타임]({{< relref "04-operator-topology-downtime.md" >}})에서 컴포넌트별 장애 영향과 EBS 재연결 과정을 설명합니다. 이어 [Keeper]({{< relref "05-keeper.md" >}})는 복제 메타데이터와 쓰기 정족수를, [복제와 failover]({{< relref "06-replication-failover.md" >}})는 살아 있는 replica로 요청이 이어지는 조건을 다룹니다.

이미지를 올리기 전에는 [버전 호환과 업그레이드]({{< relref "09-version-upgrade-compat.md" >}})의 조합과 복원 절차를 확인해야 합니다. 예제에 쓰인 24.8 LTS는 작성 당시의 기준 버전이며, 지금 새로 설치할 버전을 권하는 표시는 아닙니다.

실제 장애 대응 순서는 [운영 런북]({{< relref "../hyperdx-operating/02-runbook.md" >}}), 구성 변경을 판단할 지표와 실측 항목은 [의사결정 가이드]({{< relref "../hyperdx-operating/03-decision-guide.md" >}})에서 찾을 수 있습니다.

## 월 0.7TB를 용량으로 환산하기 {#우리-케이스에서는}

0.7TB가 수집 전 원본인지, 압축 후 디스크 크기인지에 따라 필요한 용량이 달라집니다. [용량 산정]({{< relref "07-capacity-planning.md" >}})은 두 해석을 구분하고 3·6·12개월 보관 비용을 계산합니다. 압축비와 신호별 구성비는 추정값이므로 staging에서 실제 테이블 크기와 TTL을 확인해야 합니다.

보관 기간을 늘릴 때 hot 기간과 처리량을 유지할 수 있다면 증가는 주로 S3 쪽에 생깁니다. 다만 replica별 S3 사본, 요청·전송 비용, 조회 부하도 계산에 들어갑니다. 숫자는 각 글의 조사 시점과 조건을 붙여 읽어야 합니다.

<span id="자매-챕터"></span>

제품 기능과 Datadog 대체 범위는 [HyperDX 플랫폼 분석]({{< relref "../rum/01-hyperdx-deep-dive.md" >}}), [2026-09 기능 재검토]({{< relref "../rum/08-datadog-coverage-2026-09.md" >}}), [RUM 내재화]({{< relref "../rum/_index.md" >}})에서 다룹니다. 로그 저장소만 필요한 경우의 판단은 [로깅 관점의 ClickStack 평가]({{< relref "../logging/05-hyperdx-clickstack.md" >}})에 있습니다.

[참고 자료]({{< relref "10-sources.md" >}})에 원문 링크를 모았습니다. 본문의 `✓`는 확인된 내용, `≈`는 추정, `Ⓥ`는 벤더 주장, `?`는 미확인, `Ⓑ`는 공개 벤치마크, `Σ`는 자료를 종합한 판단입니다.
