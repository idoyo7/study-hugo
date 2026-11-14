---
title: "Kubernetes 무중단 업그레이드를 지탱하는 etcd의 원리"
description: "Kubernetes 마스터를 교체하는 동안 etcd는 어떻게 데이터를 지킬까요? 쿼럼을 채우는 로그 복제와 리더 선출이 동작의 바탕이며, 카카오 DKOS는 장애로 데이터가 유실될 때를 대비해 매일 백업을 남깁니다."
date: 2026-11-14
weight: 5
---

# Kubernetes 무중단 업그레이드를 지탱하는 etcd의 원리 (2021-12)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Kubernetes 운영을 위한 etcd 기본 동작 원리의 이해](https://tech.kakao.com/posts/484)
- 매체 · 게시일: 카카오 기술블로그 · 2021-12-20
- 저자: ted.ghd (클라우드플랫폼팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 하나씩 교체되는 DKOS의 마스터 노드 {#background}

카카오의 Kubernetes as a Service인 DKOS는 Kubernetes Live Upgrade를 API로 제공합니다. 실행 중인 애플리케이션에 영향을 주지 않고 Kubernetes 버전을 올리기 위해 마스터 노드를 하나씩 삭제하고 교체합니다. 그때마다 etcd 서버도 빠지고 새로 들어옵니다.

etcd에는 클러스터의 모든 데이터가 있습니다. 노드가 몇 개인지, 어떤 파드가 어느 노드에서 동작하는지도 이곳에 기록됩니다. 데이터베이스를 잃으면 컨테이너뿐 아니라 클러스터가 쓰던 자원 전부가 미아가 됩니다. 클라우드플랫폼팀이 Live Upgrade를 준비하며 etcd의 기본 동작부터 유지 보수와 복구 방법까지 조사한 배경입니다.

## 모든 서버를 기다리지 않는 Raft {#rsm-raft}

etcd는 쓰기 요청을 처리할 때 모든 서버의 복제를 기다리지 않습니다. 의사결정에 필요한 최소 서버 수인 쿼럼만큼 복제되면 commit을 진행합니다. 서버가 3대라면 쿼럼은 2입니다.

이 동작의 바탕에는 Replicated state machine(RSM)이 있습니다. etcd는 key:value 데이터를 여러 서버에 복제하고, 각 서버는 command가 담긴 log를 순서대로 처리합니다. 쓰기는 이 로그를 덧붙이는 log append입니다. 복제본이 있다는 사실만으로 신뢰성이 보장되지는 않습니다. 서버 일부가 다운돼도 응답해야 하고, 네트워크 지연에도 로그 일관성을 지켜야 합니다. 항상 올바른 결과를 내면서 조건을 채웠다면 모든 서버를 기다리지 않고 빠르게 응답해야 한다는 요구도 있습니다. etcd는 이 합의를 Raft 알고리즘으로 확보합니다.

서버 3대 중 leader가 x=1이라는 쓰기 요청을 받았다고 가정하겠습니다. leader는 마지막 로그 위치인 lastIndex 다음에 로그를 기록하고, 다음 heartbeat 주기에 follower마다 새 로그를 기록할 위치인 nextIndex에 맞춰 AppendEntry RPC를 보냅니다.

follower F1이 로그를 기록하고 응답했다면 leader 자신까지 합쳐 쿼럼을 채웠습니다. F2의 응답은 아직 없어도 됩니다. leader는 메모리의 log entry를 db에 쓰는 commit을 수행하고, 이후 x를 읽으면 1이 반환됩니다. follower들도 leader가 commit한 사실을 알게 되면 자신이 보관하던 로그를 commit합니다.

## 로그를 따라잡기 전에 늘어나는 쿼럼 {#runtime-reconfiguration}

DKOS의 마스터 교체에는 실행 중인 etcd 클러스터에서 멤버를 추가하거나 삭제하는 런타임 재구성이 필요합니다. 설정 변경도 일반 데이터처럼 로그로 복제합니다. 차이는 효력이 생기는 시점입니다. 새 설정은 commit을 기다리지 않고 log entry에 기록되는 즉시 적용되며, 설정 로그가 여럿이면 가장 최신 것을 사용합니다. 서버를 3대에서 4대로 늘리는 Cnew가 기록되면 commit에 필요한 복제 수는 3이 됩니다.

새 멤버는 아직 같은 데이터를 갖고 있지 않습니다. 추가 요청에 OK를 보낸 뒤 leader는 파일시스템에 보관한 최신 snapshot과 현재 log entry를 합쳐 새 snapshot을 전달합니다. 새 서버는 이것으로 db를 만들고 이후 Append RPC를 받을 준비를 합니다.

이 준비가 끝나기 전에 다시 멤버 추가 요청을 받으면 문제가 생길 수 있습니다. 4번째 멤버가 로그를 따라잡는 동안 새 설정 Cnew2를 기록했는데, 필요한 로그를 복제한 follower가 부족하다면 Cnew2의 commit이 늦어집니다. 그 뒤에 들어온 쓰기도 막힙니다. 밀린 작업을 client timeout 안에 처리하지 못하면 가용성 문제로 이어집니다.

etcd 3.4.0부터 구현된 learner는 이 위험을 다루기 위한 상태입니다. 클러스터 멤버로 로그를 받되 쿼럼 계산에서는 제외됩니다. 로그를 모두 따라잡은 뒤 promote API로 일반 follower가 되며, 아직 따라잡지 못했다면 승격 요청은 거절됩니다. 원문 작성 당시 kubeadm과 Kubespray는 클러스터를 생성할 때 learner를 활용하지 않았습니다. Kubernetes용 etcd snapshot은 평균 수십 KB에 불과해 이런 문제가 발생할 가능성은 낮다는 설명도 함께 제시했습니다.

설정 변경을 한꺼번에 밀어 넣는 데에도 제한이 있습니다. Raft는 런타임 재구성을 한 번에 하나씩 처리하는 것을 원칙으로 삼습니다. etcd에서는 leader의 로그에 commit되지 않은 설정이 있으면 다음 설정을 받지 않는 restriction이 기본으로 활성화되어 있습니다.

## 최신 로그를 가진 서버의 다음 임기 {#election-replication}

서버 3대로 클러스터를 처음 구성하면 모두 follower이고, 임기를 나타내는 term은 0입니다. 아직 leader가 없으므로 heartbeat도 오지 않습니다. election timeout이 먼저 발생한 서버는 candidate로 바뀌어 term을 1 올리고 다른 서버에 RequestVote RPC를 보냅니다. 요청을 받은 서버는 candidate의 term과 log를 자신의 정보와 비교해 표를 줄지 결정합니다.

자신의 표를 포함해 OK 응답이 쿼럼에 이르면 leader가 됩니다. 이후 term과 log index를 담은 Append RPC를 heartbeat로 보내 자신이 있음을 알립니다. 이를 받은 서버는 더 높은 term을 확인하면 자신의 term도 그 값으로 맞춥니다.

먼저 선거를 시작했다고 반드시 이기지는 않습니다. 앞서 F1까지 로그를 복제한 뒤 leader가 다운됐다고 가정하겠습니다. F2가 먼저 timeout되어 표를 구해도, 더 최신 로그를 가진 F1은 거절합니다. 이후 F1도 timeout되어 선거를 시작하면 term은 F2와 같고 로그는 더 최신이므로 F2의 표를 받아 leader가 됩니다. F1의 heartbeat를 받은 F2는 follower로 돌아갑니다. 남은 서버가 쿼럼을 채우므로 새 쓰기도 처리합니다.

옛 leader가 복구되면 낮은 lastIndex와 term을 확인하고 follower로 내려가며, term을 높은 쪽에 맞춥니다. 새 leader를 뽑지 못하고 선거만 반복하면 요청을 처리하지 못해 가용성이 떨어질 수 있습니다. Raft에는 이를 다루는 randomize election timeout과 preVote가 있으며, etcd에도 preVote가 구현되어 있습니다.

### 자기 표를 빼고 내려오는 leader

계획된 멤버 삭제도 로그 복제로 진행합니다. leader 자신을 삭제할 때는 복제 수를 세는 방식이 달라집니다. 자기 자신을 제외하고 쿼럼만큼 복제를 마친 뒤 설정을 commit하고 클라이언트에 OK를 보냅니다. 이후 heartbeat를 멈추고 자리에서 내려오는 동작이 step down입니다. 남은 서버에 쿼럼만큼 로그가 복제되어 있으므로 새 leader 선출은 보장됩니다.

설정 entry에서 자신이 빠졌더라도 commit 전까지는 leader 역할을 계속합니다. 그사이 들어온 쓰기도 자신을 제외한 쿼럼에 복제합니다. step down 이후에도 남은 서버가 올바른 데이터를 유지하며 동작하도록 하기 위한 처리입니다.

삭제 요청에도 restriction이 적용됩니다. 정상 동작 중인 서버 수를 started라고 할 때, 삭제 후 started가 쿼럼보다 작아질 것으로 예상되면 요청을 거절합니다. 원문이 든 5대 클러스터의 예에서는 started가 4이고 쿼럼이 3입니다. 이 상황에서는 두 대까지 삭제 요청을 받아들이지만, 세 번째 삭제는 이 조건에 걸려 거절됩니다.

## 메모리에서 비워 내는 로그 {#maintenance}

합의를 지켜도 자원을 끝없이 쓰면 저장소는 멈춥니다. etcd는 log entry를 메모리에 보관하므로 계속 쌓아 두면 결국 OOM이 발생합니다. 이를 막기 위해 주기적으로 snapshot을 파일시스템에 저장하고 메모리의 로그를 비우는 truncate를 수행합니다. 주기를 정하는 snapshot-count의 기본값은 100,000입니다.

로그를 비운 뒤에도 느린 follower를 따라잡게 할 방법은 남습니다. follower가 leader의 메모리에서 이미 사라진 로그를 요구하면 최근 snapshot 파일을 보냅니다. 새 멤버에게 데이터를 전달할 때와 같은 방식입니다.

## 이력을 지워도 돌아오지 않는 디스크 공간 {#compaction}

db에는 현재 값만 쌓이는 것이 아닙니다. etcd는 같은 key에 새 값을 쓸 때 기존 값을 덮어쓰는 대신 변경 이력을 revision과 함께 보관합니다. 이를 계속 남겨 두면 디스크가 차서 프로세스가 멈춥니다. compaction은 불필요한 revision을 삭제하는 기능이며, 지운 revision은 다시 조회할 수 없습니다.

자동 compaction에서는 모드에 따라 auto-compaction-retention의 뜻이 달라집니다. revision 모드는 5분마다 실행하며 revision을 기준으로 정리 범위를 정합니다. periodic 모드는 같은 옵션을 시간으로 해석합니다. periodic의 세부 동작은 etcd 버전에 따라 다르고, 원문이 사용한 3.3의 예에서는 retention이 8h일 때 1h 단위로 compaction합니다.

compaction만으로 디스크 공간까지 확보되지는 않습니다. RDB에서 TRUNCATE 없이 DELETE만 했을 때와 비슷합니다. revision 삭제로 생긴 단편화를 defragmentation으로 정리해야 공간이 돌아옵니다. 이 작업에는 자동 기능이 없고, 실행 중에는 읽기와 쓰기가 모두 막힙니다. 작업 시간이 몇 ms 단위여서 Kubernetes용 etcd 클러스터에서 timeout이 발생할 가능성은 적습니다.

db 크기에도 한도가 있습니다. etcd_quota_backend_bytes의 기본값은 2G이며 최대 8G까지 설정할 수 있습니다. leader의 db가 한도를 넘으면 "database space exceeded" 메시지와 함께 쓰기를 받지 않는 read-only 모드로 동작합니다. key:value를 많이 사용할 것으로 예상된다면 별도 CronJob으로 defragmentation을 주기적으로 수행하거나 이 한도를 넉넉하게 부여해야 합니다.

## 매일 MetaKage에 남기는 DKOS의 백업 {#dkos-backup}

데이터베이스 자체를 잃는 사고에는 백업이 필요합니다. DKOS는 클러스터를 생성할 때 백업용 CronJob을 함께 배포합니다. 마스터 노드에서 실행되는 이 작업은 카카오의 분산 오브젝트 스토리지 MetaKage에 하루 한 번 etcd 데이터베이스를 저장하고, 클러스터마다 최근 5일치를 보관합니다. 백업이 한 시각에 몰려 네트워크에 부하를 주지 않도록 클러스터별 실행 시간도 다르게 정합니다.

백업에서도 snapshot이라는 말을 쓰지만, 로그 리텐션에서 만든 snapshot과는 다릅니다. 백업 snapshot은 commit한 데이터가 들어 있는 db 파일의 사본입니다. compaction을 많이 수행한 뒤 defragmentation을 하지 않았다면 백업에도 불필요하게 많은 공간을 쓸 수 있습니다.

파일을 어떻게 복사했는지도 복구에 영향을 줍니다. `etcdctl snapshot save`로 만든 백업에는 무결성 해시가 들어 있어 `etcdctl snapshot restore` 때 변조 여부를 확인합니다. data dir의 db 파일을 단순 복사한 백업에는 이 해시가 없으므로, 그런 파일로 복구해야 한다면 `--skip-hash-check` 옵션이 필요합니다.

복구할 때는 db 파일을 호스트의 특정 경로에 놓고 새 etcd를 시작합니다. 이때 클러스터와 멤버의 uuid를 담은 메타데이터를 새로 주어야 합니다. etcd는 db의 메타데이터를 새 정보로 덮어쓰고 동작합니다. 옛 메타데이터를 유지하면 죽은 줄 알았던 서버가 다시 살아났을 때 구성이 꼬여 오동작할 가능성이 큽니다.

{{% details title="원문의 etcd 기본값과 한도" closed="true" %}}

| 항목 | 값 |
|---|---|
| snapshot-count 기본값 | 100,000 |
| 메모리에 남기는 log | snapshot 시점 lastIndex 기준 5,000개 (옵션으로 조정 불가) |
| revision 모드 자동 컴팩션 주기 | 5분마다 (최신 revision - retention까지만 남김) |
| periodic 모드 예시 (etcd 3.3) | retention 8h일 때 1h 단위로 compaction |
| etcd_quota_backend_bytes 기본값 | 2G (최대 8G) |
| learner 도입 버전 | etcd 3.4.0 |
| DKOS 백업 | 하루 1회, 클러스터당 최근 5일 보관 |

{{% /details %}}
