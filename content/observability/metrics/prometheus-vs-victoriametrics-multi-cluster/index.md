---
title: "멀티클러스터 메트릭: Thanos와 VictoriaMetrics 구성"
linkTitle: "멀티클러스터 구성"
description: "Prometheus·Thanos의 Sidecar·Receive와 VictoriaMetrics의 중앙화·지역 자립 배치를 비교해 WAN 단절, 복제, 테넌트와 객체 저장소의 경계를 정리합니다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 6
url: "/monitoring/prometheus-vs-victoriametrics-multi-cluster/"
---

# 멀티클러스터 메트릭: Thanos와 VictoriaMetrics 구성

여러 Kubernetes 클러스터의 메트릭을 모을 때, **중앙에서 장기간 한 번에 조회하는 것**과 **WAN이 끊겨도 각 지역에서 경보를 계속 내는 것**은 별개의 요구입니다. 대규모 중앙 운영이 목적이라면 각 클러스터의 HA `vmagent`가 하나의 중앙 리전에 둔 `VMCluster`로 보내는 구성을 출발점으로 삼을 수 있습니다. 지역 자립이 필수라면 현장 저장소와 `vmalert`가 필요하고, 중앙 데이터 사본을 만들지 조회만 합칠지를 추가로 정합니다.

이는 Thanos와의 우열보다 배치 모델의 차이입니다. Thanos는 Prometheus TSDB 블록을 객체 스토리지에 장기 보관하고 Query가 여러 Store API를 합쳐 읽는 경로를 제공합니다. VictoriaMetrics는 원격 쓰기와 분산 저장·조회 컴포넌트로 같은 문제를 조립합니다. [Prometheus와 VM의 단일·클러스터 비교]({{< relref "/observability/metrics/prometheus-vs-victoriametrics/index.md" >}}), [장기 보관 비교]({{< relref "/observability/metrics/longterm-retention/_index.md" >}}), [Prometheus·Thanos 연동]({{< relref "/observability/metrics/prometheus-thanos/_index.md" >}})을 먼저 보면 이 글의 선택 기준이 더 분명해집니다.

## Thanos의 두 연결 방식부터 구분한다

**Sidecar 방식**에서는 Prometheus 옆 Sidecar가 닫힌 TSDB 블록을 객체 스토리지에 올리고 Store API를 엽니다. Thanos Query는 Sidecar의 최근 데이터와 Store Gateway가 객체 스토리지에서 읽은 과거 블록을 함께 조회합니다. 따라서 업로드된 장기 데이터와 달리 최근 데이터의 가용성은 원격 Prometheus·Sidecar 연결에도 좌우됩니다. `external_labels`에는 클러스터·샤드·복제본을 구분할 값을 두고, Query의 replica label 설정으로 HA 복제본을 묶어야 합니다. [Thanos Sidecar](https://thanos.io/tip/components/sidecar.md/)

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

**Receive 방식도 있습니다.** Receive는 remote write 수신기이며 받은 샘플을 자신의 TSDB에 기록하고 Store API를 제공합니다. 각 클러스터에서 중앙으로 아웃바운드 전송하는 구성에 맞습니다. 링크가 끊겨도 중앙 조회·규칙 평가 자체는 계속 실행되지만, 단절된 지역의 새 샘플을 받지 못합니다. Sidecar와 Receive는 최근 데이터를 어디에 두고 어느 방향으로 연결하는지가 다릅니다. [Thanos의 샘플 수명 설명](https://thanos.io/blog/2023-11-20-life-of-a-sample-part-1/)

## 권장안: edge는 버퍼, 중앙은 저장·조회·규칙 평가

여러 클러스터가 같은 운영 경계에 있고, 중앙 리전까지의 연결이 안정적이며, WAN 단절 중 즉시 로컬 경보가 필수는 아니라면 다음 구성을 권합니다.

{{< flow src="_flow/1-중앙-VMCluster-패턴.json" />}}

각 Kubernetes 클러스터에 같은 설정의 `vmagent` 두 대를 두고, 동일 타깃을 scrape해 중앙 `VMCluster`로 remote write합니다. `vmagent`의 destination별 디스크 큐는 중앙 연결이 끊긴 동안 샘플을 보류했다가 복구 후 전송할 수 있습니다. Kubernetes Operator에서 큐 기본 경로는 임시 `/tmp`이므로, 이 동작을 장애 버퍼로 기대한다면 Stateful mode와 PVC 등 영속 경로를 명시해야 합니다. [vmagent HA와 영속 큐](https://docs.victoriametrics.com/vmagent.html), [Operator vmagent](https://docs.victoriametrics.com/operator/resources/vmagent/)

중앙에서는 `vmauth`를 공개 진입점으로 두고 인증·테넌트별 경로를 처리합니다. 쓰기는 `vminsert`가 받고 `vmstorage`에 분배하며, Grafana와 `vmalert`의 조회 대상은 `vmselect`입니다. recording rule 결과를 저장할 때 `vmalert`의 remote-write 대상은 `vminsert`여야 합니다. 즉 `vmalert`는 읽기와 쓰기에 서로 다른 VMCluster 엔드포인트를 사용합니다. vmauth는 HTTP 인증·인가·라우팅 프록시일 뿐이며, 데이터 복제나 리전 장애 복구를 제공하지 않습니다. [vmauth](https://docs.victoriametrics.com/vmauth.html), [vmalert 구성](https://docs.victoriametrics.com/victoriametrics/vmalert/), [클러스터 URL 예시](https://docs.victoriametrics.com/url-examples.html)

WAN이 끊기면 edge는 큐 용량 안에서 계속 수집합니다. 중앙 `vmselect`와 `vmalert`도 계속 실행되지만 해당 지역의 최신 데이터가 없어 이전 값·빈 결과·데이터 부재 경보를 보게 될 수 있습니다. 복구 후 과거 샘플을 보낸다고 단절 당시의 실시간 경보가 소급해서 전달되지는 않습니다. 전송 큐는 현장 조회·규칙 평가를 대신하지 않습니다. 큐 상한을 넘으면 오래된 데이터가 버려질 수 있으므로 예상 단절 시간과 복구 후 전송 속도로 용량을 잡아야 합니다. [vmagent 디스크 큐](https://docs.victoriametrics.com/victoriametrics/vmagent/#on-disk-persistence)

### HA, 중복 제거, 복제는 각각 다르다

HA `vmagent` 쌍은 같은 시계열을 중복 수집하므로, VMCluster의 vmselect·vmstorage에 같은 `dedup.minScrapeInterval`을 두고 실제 scrape interval과 맞춥니다. 여러 수집 간격을 섞는다면 짧은 간격의 정상 샘플까지 버리지 않도록 dedup 구성을 나눠 검토해야 합니다. 공식 문서는 같은 타깃을 수집하는 HA 구성원마다 `-promscrape.cluster.name`도 다르게 지정하도록 권합니다. [vmagent HA](https://docs.victoriametrics.com/victoriametrics/vmagent/#high-availability), [클러스터 dedup](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#deduplication)

데이터에는 `region`, `cluster`처럼 실제 출처를 구분하는 레이블을 유지합니다. 서로 다른 Kubernetes 클러스터의 동명 타깃을 합치면 안 됩니다. 반대로 수집기 복제본만 구분하는 레이블이 샘플에 남으면 서로 다른 시계열이 되어 일반적인 시간 기반 dedup으로 합쳐지지 않습니다. **실제 출처의 구분과 수집기 복제본의 중복 제거**를 따로 설계해야 합니다.

`VMCluster`의 `replicationFactor`는 **저장 사본 수**를 정합니다. 예를 들어 복제 수 `N`을 장애 중에도 유지하려면 문서는 최소 `2N-1`개의 `vmstorage`와 그에 맞는 용량을 요구합니다. `vmselect`는 복제된 샘플을 dedup할 수 있지만, 이 복제는 한 리전 전체·공용 네트워크·잘못된 쓰기 같은 장애 도메인을 자동으로 넘지 않습니다. 수집 HA, vmstorage 복제, 가용 영역 배치, 리전 DR은 별도로 설계해야 합니다. [VMCluster 복제와 데이터 안전성](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#replication-and-data-safety)

테넌트별 쓰기는 `/insert/<tenantID>/...`, 조회는 `/select/<tenantID>/...` 경로를 사용합니다. vmauth는 인증된 사용자·수집기를 허용한 tenant 경로와 API에 매핑하고, backend로 직접 우회할 수 없게 배치합니다. tenant ID 자체가 인증 수단은 아닙니다. 여러 클러스터를 같은 tenant에 모으면 `cluster` 레이블로 구분하고, tenant를 나누면 전역 조회 계정의 접근 범위를 별도로 정합니다. [멀티테넌트 URL](https://docs.victoriametrics.com/url-examples.html), [vmauth](https://docs.victoriametrics.com/vmauth.html)

## 지역에서 계속 보려면 local+global fan-out을 쓴다

중앙과의 연결 장애 중에도 현장 대시보드와 경보가 필요하다면, 각 지역에 `VMSingle` 또는 `VMCluster`와 그 지역의 `vmalert`를 둡니다. `vmagent`는 같은 샘플을 local과 global destination에 fan-out합니다. 지역 자체가 유실되는 장애까지 이 로컬 배치가 해결하는 것은 아닙니다.

{{< flow src="_flow/2-지역-자립-fanout-패턴.json" />}}

이 배치는 WAN이 끊겨도 local 저장소·조회 엔드포인트·`vmalert`가 남아 있으므로 지역 규칙을 계속 평가할 수 있습니다. VMSingle에서는 자체 HTTP 엔드포인트를, VMCluster에서는 `vmselect`를 조회 대상으로 둡니다. 대신 두 저장소에 쓰고 보관하는 비용, 두 목적지의 큐 용량, 각 저장소의 dedup·보관·규칙 운영을 감수합니다. 같은 `vmagent`의 목적지별 큐는 독립적으로 동작하므로 한 destination이 멈췄다고 다른 destination의 전송을 기다릴 필요는 없습니다. [VM 다중 AZ 수집 패턴](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#multi-level-cluster-setup)

지역 클러스터를 유지하면서 전역 조회만 합쳐야 할 때는 multi-level VMCluster도 선택지입니다. 상위 `vmselect`가 `-clusternativeListenAddr`를 연 하위 `vmselect`들을 조회하는 방식은 공식 지원됩니다. 이는 **분산 조회**이지 지역 데이터를 다른 지역 `vmstorage`에 복제하는 기능은 아닙니다. 테넌트별 외부 query URL과 내부 cluster-native 주소는 역할이 다르므로, 실제 주소·방화벽·테넌트 매핑을 배포 전 검증해야 합니다. [multi-level VMCluster](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#multi-level-cluster-setup)

반대로 하나의 `VMCluster`에 서로 먼 리전의 `vminsert`·`vmstorage`를 직접 펼치는 구성은 기본 권장안으로 삼지 않습니다. 공식 문서도 AZ 간 동기 쓰기에서 가장 느린 링크가 수집 속도를 제한하고, 일시적으로 접근하지 못한 영역으로 재라우팅하면 공백이 생길 수 있다고 설명합니다. 이는 AZ 사례이지만, 지연·대역폭·단절 가능성이 더 큰 WAN에서는 더 엄격하게 검토해야 한다는 합리적인 추론입니다. destination별 디스크 큐를 둔 `vmagent`가 그 문제를 완화할 수는 있어도, WAN을 하나의 저지연 저장 클러스터로 바꾸지는 않습니다. [AZ 간 VMCluster의 제약](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#multi-level-cluster-setup)

## 객체 스토리지는 같은 역할이 아니다

Thanos Sidecar·Receive의 객체 스토리지는 TSDB 블록을 장기 보관하고, Query/Store Gateway 경로에서 과거 데이터를 읽는 데이터 계층입니다. 반면 VictoriaMetrics의 `vmbackup`은 데이터를 백업하고 `vmrestore`가 저장 디렉터리로 복원하는 도구입니다. 복원에는 VictoriaMetrics를 중지해야 하므로, 백업 버킷을 Thanos Store Gateway처럼 실시간 조회할 수는 없습니다. [Thanos Sidecar](https://thanos.io/tip/components/sidecar.md/), [vmrestore](https://docs.victoriametrics.com/victoriametrics/vmrestore/)

앞서 설명한 vmagent·VMCluster·vmauth·vmalert와 multi-level 조회는 오픈소스 구성으로 사용할 수 있습니다. VictoriaMetrics Enterprise에는 백업 자동화, 다운샘플링, 복수 retention, 객체 스토리지에서 `vmalert` 규칙을 읽는 기능 등이 있습니다. 마지막 기능은 **규칙 파일의 저장 위치**에 관한 것이며 메트릭 데이터를 객체 스토리지에서 질의하는 기능은 아닙니다. Community와 Enterprise의 기능·계약 범위를 분리해 확인해야 합니다. [VictoriaMetrics Enterprise 기능](https://docs.victoriametrics.com/enterprise/), [클라우드 스토리지 연결](https://docs.victoriametrics.com/guides/connecting-vm-components-to-cloud-storage/)

## 선택표

| 우선 요구 | 먼저 선택할 구성 | 포기하거나 추가로 설계할 것 |
|---|---|---|
| 중앙 운영, 안정적인 WAN, 중앙에서만 조회·규칙 평가 | **HA vmagent → 중앙 VMCluster + vmauth + 중앙 vmalert** | WAN 단절 중 해당 지역의 새 데이터 조회·경보 |
| 지역 단절 중에도 현장 경보·대시보드 | 지역 VMSingle/VMCluster + 지역 vmalert, vmagent local+global fan-out | 이중 저장·전송·규칙 운영 비용 |
| 기존 Prometheus와 객체 스토리지의 장기·전역 Query | Prometheus + Thanos Sidecar + Query/Store Gateway | 최근 데이터에 대한 원격 Sidecar 연결과 Thanos 운영 |
| 인바운드 없이 중앙 수집 | Prometheus/vmagent → Thanos Receive 또는 VM 중앙화 | Receive와 VM은 별도 저장 아키텍처; 지역 규칙은 별도 배치 |
| 여러 지역 저장소의 전역 조회 | 지역 VMCluster + 상위 vmselect | 교차 리전 조회 비용·지연과 주소/테넌트 운영 |

새 VM 기반 플랫폼의 기본안은 첫 행입니다. 각 클러스터의 HA `vmagent`에 **영속 큐**, 중앙 VMCluster의 **명시적 복제·AZ 배치**, vmauth의 **명시적 테넌트 정책**, 중앙 `vmselect`를 읽는 `vmalert`와 `vminsert`로 쓰는 recording rule 경로를 함께 배치합니다. 지역 단절 중에도 대응 시간이 요구될 때만 두 번째 행처럼 local 저장소와 평가기를 추가합니다. VMCluster 하나만으로 멀티리전 HA가 완성되는 것은 아닙니다.

## 참고 자료

- **Thanos**: [Sidecar](https://thanos.io/tip/components/sidecar.md/), [Life of a Sample](https://thanos.io/blog/2023-11-20-life-of-a-sample-part-1/) — Sidecar의 블록·Store API와 Receive의 remote write 역할.
- **VictoriaMetrics 클러스터**: [Cluster architecture](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/), [multi-level cluster setup](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#multi-level-cluster-setup), [replication](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#replication-and-data-safety) — 분리된 컴포넌트, 상위 vmselect, 복제 조건과 AZ 경계.
- **수집·규칙·테넌트**: [vmagent](https://docs.victoriametrics.com/vmagent.html), [vmalert](https://docs.victoriametrics.com/victoriametrics/vmalert/), [vmauth](https://docs.victoriametrics.com/vmauth.html), [URL examples](https://docs.victoriametrics.com/url-examples.html) — HA/dedup, 읽기·쓰기 경로, 인증과 tenant URL.
- **백업과 Enterprise**: [vmrestore](https://docs.victoriametrics.com/victoriametrics/vmrestore/), [Enterprise](https://docs.victoriametrics.com/enterprise/) — 백업 복원 절차와 유료 기능 범위.
