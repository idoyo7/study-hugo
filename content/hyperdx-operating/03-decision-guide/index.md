---
title: "의사결정 가이드 — 기본값·승급 트리거·실측 체크리스트"
date: 2026-08-01
lastmod: 2026-08-24
weight: 3
aliases: ["/hyperdx-operating/06-decision-guide/", "/hyperdx/operating/06-decision-guide/"]
---

# HyperDX 구성을 언제 바꿀 것인가

디스크가 느려졌다고 곧바로 io2로 옮기거나, Keeper 부하가 늘었다고 노드를 두 대 더 추가할 필요는 없습니다. 볼륨 대역폭, 인스턴스 한계, 작은 INSERT가 만드는 part 수처럼 원인에 따라 조치가 달라집니다. 반면 AZ 장애 중에도 쓰기를 계속해야 한다는 요구는 현재 부하가 작아도 replica 구성을 바꿀 이유가 됩니다.

아래는 2026-07~08 조사 당시의 설계와 추정치입니다. 실제 stage 구성은 [배포 기록]({{< relref "01-our-deployment.md" >}}), 장애 대응 순서는 [운영 런북]({{< relref "02-runbook.md" >}})에서 확인할 수 있습니다.

## 1. 구성별 변경 조건 {#1-결정-매트릭스--기본값왜-안전충분승급-트리거}

| 대상 | 시작 구성과 선택 이유 | 다시 검토할 조건 |
|---|---|---|
| 배포 | HyperDX Only(`clickhouse.enabled:false`) + Altinity CHI·CHK. 분석용 ClickHouse와 관리 도구를 통일 | 운영 주체나 관리형 사용 요구가 달라질 때 [배포 구조]({{< relref "../../hyperdx/01-stack-topology.md" >}}) 재검토 |
| hot 저장소 | 단일 gp3. 예상 부하에서 필요한 대역폭을 설정해 사용 `≈` | gp3나 인스턴스의 실용 한계, 지연·내구성 요구를 [EBS 비교]({{< relref "../../hyperdx/02-hot-storage-ebs.md" >}})와 대조 |
| cold 저장소 | 장기 보관은 S3 TTL MOVE, stage는 EBS 단일 티어 | 짧은 보관 기간이나 S3 사용 제한이면 [블록 스토리지 구성]({{< relref "../../hyperdx/08-block-only-tuning.md" >}}) 검토 |
| 데이터 복제 | 1 shard × RF2, 2 AZ. EBS 재연결 중에는 다른 replica 사용 `≈` | 장애 중 quorum 쓰기 지속, AZ 장애 요구, 노드 용량·CPU 한계 |
| Keeper | gp3 영속 볼륨의 3노드, 3 AZ. 과반인 2노드로 정족수 유지 `✓` | 2대 동시 장애를 견뎌야 하면 5노드 검토 |
| MongoDB | prod 3멤버 또는 Atlas. 앱 설정의 가용성과 백업 확보 | 자체 백업·복원 운영이 어려워지면 관리형 검토 |
| 업그레이드 | 검증한 버전 고정, 변경 전 스냅샷·백업 | 필요한 수정·기능이 생기면 호환성과 복원 절차부터 확인 |

RF3·Keeper 5노드는 허용할 장애 수를 늘리는 선택입니다. io2나 shard 추가는 관측된 자원 부족에 대응하는 선택이 될 수 있습니다. 이 둘을 같은 지표로 판단하면 부하가 낮다는 이유로 필요한 복제를 미루거나, 부하를 줄이려고 불필요하게 정족수를 늘리게 됩니다.

예제의 CH/Keeper 24.8 LTS는 당시 고정한 버전입니다. 새 배포에서는 [버전 호환]({{< relref "../../hyperdx/09-version-upgrade-compat.md" >}})을 다시 확인해야 합니다. `compatibility` 설정은 동작 기본값을 조절하며, 이전 바이너리가 새 part를 읽게 만드는 복원 수단은 아닙니다.

## 2. 변경 전에 확인할 지표 {#2-승급-트리거의-관측-지점--무엇을-어디서-보면-발동인가}

### gp3 대역폭과 인스턴스 한계

CloudWatch의 EBS 대역폭·IOPS와 `system.asynchronous_metrics`를 함께 봅니다. 기본 125 MiB/s를 지속해서 사용한다면 gp3의 provisioned throughput을 조정할 여지가 있습니다. r7g.2xlarge의 약 312 MB/s baseline을 예로 들었지만 `≈`, 실제 인스턴스의 지속·버스트 대역폭을 확인한 뒤 설정합니다.

조사 당시 gp3 단일 볼륨 상한인 2,000 MiB/s·80,000 IOPS를 넘는 요구나 별도의 볼륨 내구성 요구가 있을 때 io2를 비교합니다. 볼륨만 바꿔도 인스턴스의 EBS 대역폭 한계는 남습니다. [블록 스토리지 튜닝]({{< relref "../../hyperdx/08-block-only-tuning.md" >}})에서 조정 순서를 설명합니다.

### 보관 기간과 hot 디스크 여유

보관 기간이 90일 이내로 짧거나, S3를 쓸 수 없거나, stage 운영을 단순하게 유지하려면 블록 스토리지만 쓰는 구성이 후보입니다. 90일은 예시 조건이며 손익은 실제 데이터량과 가격에 따라 달라집니다. 장기 보관으로 비용 차이가 커지면 [용량 산정]({{< relref "../../hyperdx/07-capacity-planning.md" >}})의 기간별 모델을 다시 계산합니다.

S3를 붙였다면 정책을 로드한 것과 실제 이동이 된 것을 모두 확인합니다. `system.storage_policies`와 `system.disks`에서 설정을, `system.parts.disk_name`과 `system.part_log`에서 저장 위치와 이동 이력을 확인합니다. [S3 티어링]({{< relref "../../hyperdx/03-s3-cold-tiering.md" >}})에 조회와 설정 예제가 있습니다.

이 구성의 사용률 경보 예시는 70% 경고, 80% 조치, 85% 상한이며 정상 운영에서는 30~40% 여유를 목표로 합니다 `≈`. active parts가 파티션당 300개에 가까워지거나 merge가 정체되는지도 함께 봅니다. 볼륨 확장, TTL 조정, cold 이동 복구 중 원인에 맞는 조치를 고릅니다. 이 숫자를 모든 워크로드에 적용하는 엔진 제한으로 취급하지 않습니다.

### replica와 shard를 늘릴 때

RF2에서 `insert_quorum:2`를 쓰면 한 replica가 재연결하는 동안 두 사본의 확인을 받을 수 없습니다. 이때도 quorum 쓰기를 이어가야 한다면 RF3를 검토합니다. 다만 RF3에 quorum 2를 쓴다고 임의의 두 replica를 동시에 잃어도 모든 ACK 데이터가 남는 것은 아닙니다. 허용할 장애와 쓰기 확인 조건을 함께 정해야 합니다. [배포 플레이북]({{< relref "../../clickhouse/04-deployment-playbook.md" >}})에서 이 관계를 다룹니다.

shard 추가는 노드별 `system.parts.bytes_on_disk`, merge·쿼리 CPU를 보고 판단합니다. 기존 산정의 노드당 4~8TB, CPU 70% 지속 사용은 검토를 시작할 예시값입니다 `≈`. 읽기 부하라면 replica 추가를, 단일 노드 여유가 있다면 사이즈업을 먼저 비교할 수 있습니다. shard를 늘릴 때는 새 스키마와 기존 데이터 재분배까지 계획해야 합니다. [Altinity 운영]({{< relref "../../clickhouse/05-altinity-operations.md" >}})에 제약을 정리했습니다.

### Keeper와 MongoDB

Keeper 3대는 한 대의 장애를, 5대는 두 대의 장애를 견디는 정족수 구성입니다. znode 수나 디스크 사용률이 늘어나는 문제는 작은 INSERT·part 증가와 디스크 여유부터 조사합니다. 자세한 관계는 [Keeper]({{< relref "../../hyperdx/05-keeper.md" >}})를 참고합니다.

MongoDB는 `mongodump` CronJob의 성공 여부와 복원 리허설 결과를 확인합니다. MCK에는 내장 백업이 없으므로 이 운영을 맡기기 어렵다면 Atlas를 비교합니다. 과거에 적은 M10 월 약 $57는 조사 당시 추정치이며, 실제 리전·가용성 구성과 견적을 다시 확인해야 합니다 `≈`. [스택 토폴로지]({{< relref "../../hyperdx/01-stack-topology.md" >}})에 배포 선택지가 있습니다.

{{< flow src="_flow/2-승급-트리거의-관측-지점.json" />}}

<span id="우리-케이스에서는"></span>

## 3. 배포 전 실측 항목 {#3-배포-전-실측-체크리스트---9항목을-staging에서-로}

아직 측정하지 않은 항목을 아래에 남겼습니다. 용량과 복구 시간은 stage에서 측정하고, 인증·경로·볼륨 보존은 S3 구성과 일치하는 시험 환경에서 확인합니다.

| # | 실측 항목 | 현재 | 측정 방법 | 확인 후 |
|---|---|---|---|---|
| 1 | 월 0.7TB = raw인가 on-disk인가 | `?` | 동일 기간·신호의 수집 원본량과 압축 후 저장량 대조. TTL 삭제·이동량 반영 | `✓` — 실측 유입량·압축비로 용량·비용 재계산 |
| 2 | 세션 리플레이 압축비(5x, 4~6x `≈`) | `?` | active part의 `sum(data_uncompressed_bytes) / sum(bytes_on_disk)` | `✓` — [용량 산정]({{< relref "../../hyperdx/07-capacity-planning.md" >}}) §2 산식 밴드 확정 |
| 3 | ClickStack 기본 TTL(`${TABLES_TTL}`, 문서상 3일) | `?` | `SHOW CREATE TABLE`로 실 TTL 확인 | `✓` — 오버라이드와 대조 |
| 4 | EBS reattach + part-load 실소요 | `?` | staging drain·강제종료 리허설 | `✓` — `reconcile.statefulSet.update.timeout` 튜닝 |
| 5 | CH 서버 disk의 IRSA `use_environment_credentials` 실동작(최소 버전·필수 env·`AWS_EC2_METADATA_DISABLED` 영향) | `?` | staging에서 cold 디스크를 실제로 붙여 자격증명 픽업 확인 | `✓` — 근거와 설정은 [S3 티어링]({{< relref "../../hyperdx/03-s3-cold-tiering.md" >}}) §3.3에서 설명 |
| 6 | `region` 명시 필수 여부의 정확한 실패 모드(STS regional endpoint 서명 오류) | `≈` | `region` 생략 구성으로 실패 재현 | `✓` — 실패 모드 확정([S3 티어링]({{< relref "../../hyperdx/03-s3-cold-tiering.md" >}}) §3.3) |
| 7 | operator issue #1619 — CHI/CHK `reclaimPolicy: Retain` 미준수로 클러스터 삭제 시 볼륨 소실. 기준 버전 0.27.1의 수정 여부 | `?` | 릴리스 노트 확인 + staging에서 CHI 삭제 후 PV 잔존 확인 | `✓` — 수정 확인 전까지는 StorageClass 레벨 Retain을 이중으로 건다 |
| 8 | part metadata 로컬 소비량(part 수 비례) | `?` | staging cold 이동 후 로컬 잔존분 측정 | `✓` — hot 사이징 반영([S3 티어링]({{< relref "../../hyperdx/03-s3-cold-tiering.md" >}}) §5.1) |
| 9 | S3 Gateway VPC Endpoint가 워커 노드 서브넷에 실제로 걸려 있나 | `?` | 아래 확인 명령 — 워커 노드 서브넷의 라우팅 테이블 ID가 결과에 있어야 한다 | `✓` — 없으면 cold 트래픽이 NAT를 타 절감액이 잠식된다([S3 티어링]({{< relref "../../hyperdx/03-s3-cold-tiering.md" >}}) §3.4가 요금·근거 소유) |

볼륨 삭제 시험은 버려도 되는 별도 리소스에서 수행합니다. issue #1619의 수정 여부를 확인하기 전까지는 StorageClass의 Retain 설정도 점검합니다. 실사용 CHI를 삭제해 검증해서는 안 됩니다.

S3 Gateway Endpoint 조회 결과의 라우팅 테이블 ID가 워커 노드 서브넷의 라우팅 테이블과 연결되는지 확인합니다.

```bash
# 항목 9 — 서울 리전 S3 Gateway Endpoint 존재·연결 라우팅 테이블 확인
aws ec2 describe-vpc-endpoints --region ap-northeast-2 \
  --filters Name=service-name,Values=com.amazonaws.ap-northeast-2.s3
```

테이블별 압축비와 현재 저장량은 다음 쿼리로 볼 수 있습니다.

```sql
SELECT table,
       formatReadableSize(sum(bytes_on_disk))               AS on_disk,
       formatReadableSize(sum(data_uncompressed_bytes))     AS uncompressed,
       round(sum(data_uncompressed_bytes)/sum(bytes_on_disk),1) AS ratio
FROM system.parts
WHERE active AND database = 'default'
GROUP BY table ORDER BY sum(bytes_on_disk) DESC;
```

이 쿼리는 현재 active part의 크기를 보여줍니다. 월 적재량을 구하려면 기간을 두고 기록해야 하고, 그동안 TTL로 삭제되거나 이동한 데이터도 고려해야 합니다. 시작과 끝의 크기 차이만으로 총 적재량을 확정하지 않습니다.

노드 교체 시험은 cordon·drain과 강제 종료를 따로 진행해 파드 종료, EBS 재연결, part 로딩 시간을 기록합니다. 복제 설정과 Keeper 버전의 조합도 시험해야 합니다. 해당 조건은 [버전 호환]({{< relref "../../hyperdx/09-version-upgrade-compat.md" >}}), 대응 순서는 [운영 런북]({{< relref "02-runbook.md" >}})에 있습니다.

{{% details title="작은 stage에서 측정할 수 있는 범위" closed="true" %}}
[용량 산정]({{< relref "../../hyperdx/07-capacity-planning.md" >}})의 최소 예시는 r7g.large 1대(2vCPU/16GB), Keeper 1대 또는 임베디드 Keeper, MongoDB 1멤버, gp3 100~200GB입니다. 세션 샘플링 5~10% 또는 QA 트래픽으로 월 on-disk 35~70GB, 월 비용 $150~250를 가정했습니다 `≈`.

압축비·세션당 크기·TTL·EBS 재연결을 측정할 수 있지만 RF1·Keeper 1은 HA가 아닙니다. S3 인증과 이동을 확인할 때는 cold 구성을 별도로 붙여야 하고, prod의 장애 중 서비스 지속 여부는 prod와 같은 복제·큐 구성에서 시험해야 합니다.
{{% /details %}}
