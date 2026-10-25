---
title: "여러 클러스터의 메트릭을 모으는 Thanos와 VictoriaMetrics 구성"
linkTitle: "멀티클러스터 구성"
description: "여러 Kubernetes 클러스터에서 메트릭을 수집할 때 중앙 저장과 지역별 조회·경보를 어떻게 구성할지 비교합니다. WAN 단절, 전송 큐, 복제, 테넌트와 객체 스토리지의 역할을 설명합니다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 6
url: "/monitoring/prometheus-vs-victoriametrics-multi-cluster/"
---

# 여러 클러스터의 메트릭을 모으는 Thanos와 VictoriaMetrics 구성

여러 Kubernetes 클러스터의 메트릭을 통합할 때는 중앙 조회가 필요한 범위와 연결 장애 중에도 지역에서 계속해야 할 일을 정해야 합니다. 중앙에서 수집·보관·조회하려면 각 클러스터의 HA `vmagent`를 중앙 리전의 `VMCluster`에 연결할 수 있습니다. WAN이 끊겨도 현장 경보를 평가해야 한다면 지역 저장소와 `vmalert`도 필요합니다. 그 위에 중앙 사본을 둘지, 지역별 데이터를 통합 조회만 할지 선택합니다.

Thanos는 Prometheus TSDB 블록을 객체 스토리지에 보관하고 Query가 여러 Store API에서 읽은 데이터를 통합합니다. VictoriaMetrics는 remote write와 분산 저장·조회 컴포넌트를 조합합니다. 이 글은 두 제품의 배치 방식이 연결 단절과 데이터 보관에 미치는 차이를 비교합니다. 기본 구조는 [Prometheus와 VM 비교]({{< relref "/observability/metrics/prometheus-vs-victoriametrics/index.md" >}}), [장기 보관 비교]({{< relref "/observability/metrics/longterm-retention/_index.md" >}}), [Prometheus·Thanos 연동]({{< relref "/observability/metrics/prometheus-thanos/_index.md" >}})에서 이어서 확인할 수 있습니다.

## Thanos Sidecar와 Receive가 최근 데이터를 두는 위치 {#thanos의-두-연결-방식부터-구분한다}

Sidecar는 Prometheus 옆에서 닫힌 TSDB 블록을 객체 스토리지에 올리고 Store API를 제공합니다. Thanos Query는 Sidecar에서 최근 데이터를, Store Gateway에서 객체 스토리지의 과거 블록을 읽습니다. 최근 데이터를 읽을 수 있는지는 원격 Prometheus·Sidecar와의 연결에도 달려 있습니다. `external_labels`로 클러스터·샤드·복제본을 구분하고, Query의 replica label 설정으로 HA 복제본을 묶습니다. [Thanos Sidecar](https://thanos.io/tip/components/sidecar.md/)

{{< flow caption="Thanos Query는 각 클러스터의 최근 데이터와 객체 스토리지의 과거 블록을 합쳐 조회합니다. 화살표는 블록 업로드와 조회 데이터의 전달 방향입니다." >}}
{
  "nodes": [
    { "id": "prom", "col": 0, "row": 0, "label": "각 클러스터", "sub": "Prometheus + Sidecar", "kind": "proc" },
    { "id": "bucket", "col": 0, "row": 2, "label": "객체 스토리지", "sub": "업로드된 TSDB 블록", "kind": "store" },
    { "id": "gateway", "col": 1, "row": 2, "label": "Store Gateway", "sub": "과거 블록 읽기", "kind": "query" },
    { "id": "query", "col": 1, "row": 0, "label": "Thanos Query", "sub": "통합 조회·중복 제거", "kind": "query" }
  ],
  "edges": [
    { "from": "prom", "to": "query", "label": "최근 값" },
    { "from": "prom", "to": "bucket", "label": "블록 업로드" },
    { "from": "bucket", "to": "gateway", "label": "블록" },
    { "from": "gateway", "to": "query", "label": "과거 값" }
  ]
}
{{< /flow >}}

Receive는 각 클러스터가 보내는 remote write를 받아 자신의 TSDB에 저장하고 Store API를 제공합니다. 중앙으로 아웃바운드 전송하는 구성을 만들 수 있습니다. 연결이 끊겨도 중앙 조회·규칙 평가는 실행되지만, 단절된 지역의 새 샘플은 받지 못합니다. Sidecar와 비교할 때는 최근 데이터의 위치와 연결 방향이 달라집니다. [Thanos의 샘플 수명 설명](https://thanos.io/blog/2023-11-20-life-of-a-sample-part-1/)

## 중앙 VMCluster에 저장하고 각 클러스터에는 수집기 두기 {#권장안-edge는-버퍼-중앙은-저장조회규칙-평가}

같은 운영 범위에 속한 클러스터들이 중앙 리전과 안정적으로 연결되고, WAN 단절 중 로컬 경보가 필수가 아니라면 수집기만 각 클러스터에 배치하는 구성을 우선 검토할 수 있습니다.

{{< flow src="_flow/1-중앙-VMCluster-패턴.json" />}}

각 Kubernetes 클러스터에 동일 설정의 `vmagent` 두 대를 두고 같은 타깃을 scrape해 중앙 `VMCluster`로 보냅니다. destination별 디스크 큐는 연결이 끊긴 동안 샘플을 보관하고 복구 후 전송합니다. Kubernetes Operator의 큐 기본 경로는 임시 `/tmp`이므로 장애 중 버퍼로 사용하려면 Stateful mode와 PVC 등 영속 경로를 지정해야 합니다. [vmagent HA와 영속 큐](https://docs.victoriametrics.com/vmagent.html), [Operator vmagent](https://docs.victoriametrics.com/operator/resources/vmagent/)

중앙의 공개 진입점은 `vmauth`로 구성해 인증과 테넌트별 경로를 처리합니다. `vminsert`가 쓰기를 받아 `vmstorage`에 분배하고, Grafana와 `vmalert`는 `vmselect`로 조회합니다. Recording rule 결과를 저장할 때는 `vmalert`의 remote-write 대상을 `vminsert`로 지정합니다. 읽기와 쓰기가 서로 다른 엔드포인트를 사용합니다. vmauth의 담당 범위는 HTTP 인증·인가·라우팅이며, 데이터 복제나 리전 장애 복구는 별도로 구성해야 합니다. [vmauth](https://docs.victoriametrics.com/vmauth.html), [vmalert 구성](https://docs.victoriametrics.com/victoriametrics/vmalert/), [클러스터 URL 예시](https://docs.victoriametrics.com/url-examples.html)

WAN 단절 중에도 수집기는 큐 용량이 허용하는 만큼 샘플을 받아 둘 수 있습니다. 중앙 `vmselect`·`vmalert`도 실행되지만 해당 지역의 새 값이 없어 이전 값이나 빈 결과를 읽고, 데이터 부재 경보를 낼 수 있습니다. 연결 복구 후 과거 샘플을 전송해도 단절 당시의 실시간 경보가 소급 전달되지는 않습니다. 현장 조회·평가가 필요한지와 큐 용량은 따로 판단해야 합니다. 상한을 넘으면 오래된 데이터가 버려질 수 있으므로 예상 단절 시간과 복구 후 전송 속도를 반영해 용량을 정합니다. [vmagent 디스크 큐](https://docs.victoriametrics.com/victoriametrics/vmagent/#on-disk-persistence)

### 수집 이중화와 저장 복제, 테넌트를 각각 설정하기 {#ha-중복-제거-복제는-각각-다르다}

HA `vmagent` 쌍은 같은 시계열을 중복 수집합니다. VMCluster의 vmselect·vmstorage에 동일한 `dedup.minScrapeInterval`을 지정하고 실제 scrape interval에 맞춥니다. 수집 간격이 섞여 있다면 짧은 간격의 정상 샘플까지 제거하지 않도록 구성을 나눠 검토해야 합니다. 공식 문서는 같은 타깃을 수집하는 HA 구성원마다 `-promscrape.cluster.name`을 다르게 지정하도록 권합니다. [vmagent HA](https://docs.victoriametrics.com/victoriametrics/vmagent/#high-availability), [클러스터 dedup](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#deduplication)

데이터 출처는 `region`, `cluster` 같은 레이블로 구분합니다. 이름이 같아도 서로 다른 Kubernetes 클러스터의 타깃을 합쳐서는 안 됩니다. 반면 수집기 복제본만 구분하는 레이블이 남으면 복제본마다 다른 시계열이 돼 일반적인 시간 기반 dedup으로 합쳐지지 않습니다. 출처를 구분할 레이블과 수집 중복을 제거할 방법을 함께 정해야 합니다.

`VMCluster`의 `replicationFactor`는 저장 사본 수를 지정합니다. 공식 문서에 따르면 장애 중에도 복제 수 `N`을 유지하려면 최소 `2N-1`개의 `vmstorage`와 이에 맞는 용량이 필요합니다. vmselect는 복제된 샘플의 중복을 제거할 수 있습니다. 그러나 이 복제만으로 리전 전체 장애, 공용 네트워크 장애나 잘못된 쓰기에 대응할 수는 없습니다. 수집 HA, 저장 복제, AZ 배치, 리전 DR의 보호 범위를 각각 정해야 합니다. [VMCluster 복제와 데이터 안전성](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#replication-and-data-safety)

테넌트별 쓰기 URL은 `/insert/<tenantID>/...`, 조회 URL은 `/select/<tenantID>/...`입니다. tenant ID는 인증 수단이 아니므로 vmauth가 인증된 사용자·수집기를 허용된 경로와 API에 연결하고, backend에 직접 접근해 우회하지 못하도록 구성합니다. 여러 클러스터를 한 tenant에 모으면 `cluster` 레이블로 구분합니다. tenant를 나누는 경우에는 전역 조회 계정이 접근할 범위도 지정해야 합니다. [멀티테넌트 URL](https://docs.victoriametrics.com/url-examples.html), [vmauth](https://docs.victoriametrics.com/vmauth.html)

## WAN 단절 중 지역에서 조회하고 경보를 평가하는 구성 {#지역에서-계속-보려면-localglobal-fan-out을-쓴다}

중앙과 연결되지 않아도 현장 대시보드·경보를 유지하려면 지역마다 `VMSingle` 또는 `VMCluster`와 `vmalert`를 배치합니다. `vmagent`는 같은 샘플을 local·global destination에 fan-out합니다. 이 구성은 중앙 연결 단절에 대비하는 방법이며, 지역 자체가 유실되는 장애까지 로컬 저장소로 해결할 수는 없습니다.

{{< flow src="_flow/2-지역-자립-fanout-패턴.json" />}}

WAN이 끊겼을 때도 지역의 저장소·조회 엔드포인트·`vmalert`가 동작하면 지역 규칙을 계속 평가할 수 있습니다. VMSingle은 자체 HTTP 엔드포인트를, VMCluster는 `vmselect`를 조회 대상으로 지정합니다. 대신 두 목적지에 데이터를 전송·보관하고 큐 용량, dedup, 보관 기간, 규칙을 각각 운영해야 합니다. 목적지별 큐는 독립적이므로 한쪽 전송이 중단돼도 다른 쪽은 계속 전송할 수 있습니다. [VM 다중 AZ 수집 패턴](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#multi-level-cluster-setup)

지역 저장소를 유지하고 조회만 합치는 용도로는 multi-level VMCluster를 사용할 수 있습니다. 상위 `vmselect`가 `-clusternativeListenAddr`를 연 하위 `vmselect`를 조회하는 공식 지원 구성입니다. 지역 데이터를 다른 지역의 `vmstorage`에 복제하지는 않습니다. 테넌트별 외부 query URL과 내부 cluster-native 주소가 서로 다른 용도인 만큼 배포 전에 주소·방화벽·테넌트 매핑을 검증해야 합니다. [multi-level VMCluster](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#multi-level-cluster-setup)

서로 먼 리전에 하나의 `VMCluster`의 `vminsert`·`vmstorage`를 나눠 두는 구성은 기본안으로 권하지 않습니다. 공식 문서는 AZ 간 동기 쓰기에서도 가장 느린 링크가 수집 속도를 제한하고, 일시적으로 접근할 수 없는 영역의 쓰기가 다른 곳으로 재라우팅되면 공백이 생길 수 있다고 설명합니다. WAN에서는 지연·대역폭·단절 가능성을 더 엄격하게 검토해야 한다는 것이 이 글의 추론입니다. `vmagent`의 목적지별 디스크 큐로 전송 중단을 완화할 수는 있지만 원격 저장 노드 사이의 지연까지 없앨 수는 없습니다. [AZ 간 VMCluster의 제약](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#multi-level-cluster-setup)

## Thanos의 장기 조회와 VM의 백업·복원 구분하기 {#객체-스토리지는-같은-역할이-아니다}

Thanos Sidecar·Receive가 쓰는 객체 스토리지는 TSDB 블록을 보관하며 Query·Store Gateway가 과거 데이터를 읽는 저장 계층입니다. VictoriaMetrics의 `vmbackup`·`vmrestore`는 백업과 저장 디렉터리 복원을 담당합니다. 복원할 때는 VictoriaMetrics를 중지해야 합니다. 따라서 VM 백업 버킷을 Thanos Store Gateway처럼 실시간 조회 경로에 사용할 수는 없습니다. [Thanos Sidecar](https://thanos.io/tip/components/sidecar.md/), [vmrestore](https://docs.victoriametrics.com/victoriametrics/vmrestore/)

앞의 vmagent·VMCluster·vmauth·vmalert와 multi-level 조회는 오픈소스 구성으로 사용할 수 있습니다. Enterprise에는 백업 자동화, 다운샘플링, 복수 retention, 객체 스토리지에서 `vmalert` 규칙을 읽는 기능 등이 있습니다. 이 중 규칙 읽기는 설정 파일의 위치에 관한 기능이며 메트릭 데이터를 객체 스토리지에서 질의하는 기능이 아닙니다. 도입 시 Community와 Enterprise의 기능·계약 범위를 나눠 확인해야 합니다. [VictoriaMetrics Enterprise 기능](https://docs.victoriametrics.com/enterprise/), [클라우드 스토리지 연결](https://docs.victoriametrics.com/guides/connecting-vm-components-to-cloud-storage/)

## 연결 장애 중 필요한 기능에 따른 구성 선택 {#선택표}

| 우선 요구 | 먼저 선택할 구성 | 포기하거나 추가로 설계할 것 |
|---|---|---|
| 중앙 운영, 안정적인 WAN, 중앙에서만 조회·규칙 평가 | **HA vmagent → 중앙 VMCluster + vmauth + 중앙 vmalert** | WAN 단절 중 해당 지역의 새 데이터 조회·경보 |
| 지역 단절 중에도 현장 경보·대시보드 | 지역 VMSingle/VMCluster + 지역 vmalert, vmagent local+global fan-out | 이중 저장·전송·규칙 운영 비용 |
| 기존 Prometheus와 객체 스토리지의 장기·전역 Query | Prometheus + Thanos Sidecar + Query/Store Gateway | 최근 데이터에 대한 원격 Sidecar 연결과 Thanos 운영 |
| 인바운드 없이 중앙 수집 | Prometheus/vmagent → Thanos Receive 또는 VM 중앙화 | Receive와 VM은 별도 저장 아키텍처; 지역 규칙은 별도 배치 |
| 여러 지역 저장소의 전역 조회 | 지역 VMCluster + 상위 vmselect | 교차 리전 조회 비용·지연과 주소/테넌트 운영 |

중앙 연결이 안정적이고 현장 경보가 필수가 아니라는 앞의 조건에서는 첫 번째 구성을 출발점으로 삼을 수 있습니다. HA `vmagent`의 영속 큐, 중앙 VMCluster의 복제·AZ 배치, vmauth의 테넌트 정책을 함께 정하고, `vmalert`의 조회는 `vmselect`, recording rule 저장은 `vminsert`에 연결합니다. WAN 단절 중에도 지역에서 대응해야 한다면 로컬 저장소·평가기를 추가합니다. 리전 전체 장애에 대한 HA는 별도의 설계가 필요합니다.

## 참고 자료

- **Thanos**: [Sidecar](https://thanos.io/tip/components/sidecar.md/), [Life of a Sample](https://thanos.io/blog/2023-11-20-life-of-a-sample-part-1/) — Sidecar의 블록·Store API와 Receive의 remote write 역할.
- **VictoriaMetrics 클러스터**: [Cluster architecture](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/), [multi-level cluster setup](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#multi-level-cluster-setup), [replication](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#replication-and-data-safety) — 분리된 컴포넌트, 상위 vmselect, 복제 조건과 AZ 경계.
- **수집·규칙·테넌트**: [vmagent](https://docs.victoriametrics.com/vmagent.html), [vmalert](https://docs.victoriametrics.com/victoriametrics/vmalert/), [vmauth](https://docs.victoriametrics.com/vmauth.html), [URL examples](https://docs.victoriametrics.com/url-examples.html) — HA/dedup, 읽기·쓰기 경로, 인증과 tenant URL.
- **백업과 Enterprise**: [vmrestore](https://docs.victoriametrics.com/victoriametrics/vmrestore/), [Enterprise](https://docs.victoriametrics.com/enterprise/) — 백업 복원 절차와 유료 기능 범위.
