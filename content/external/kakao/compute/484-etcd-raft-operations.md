---
title: "Kubernetes 운영을 위한 etcd 동작 원리와 유지 보수"
description: "카카오 클라우드플랫폼팀이 Kubernetes Live Upgrade를 개발하며 조사한 etcd의 Raft 동작과 멤버 추가·삭제 방식을 정리했습니다. 로그 리텐션, 컴팩션, 백업 같은 유지 보수 방법과 DKOS의 백업 운영도 함께 다룹니다."
date: 2026-11-14
weight: 5
---

# Kubernetes 운영을 위한 etcd 동작 원리와 유지 보수 (2021-12)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Kubernetes 운영을 위한 etcd 기본 동작 원리의 이해](https://tech.kakao.com/posts/484)
- 매체 · 게시일: 카카오 기술블로그 · 2021-12-20
- 저자: ted.ghd (클라우드플랫폼팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 조사의 배경 {#background}

Kubernetes는 기반 스토리지로 etcd를 쓰고, 노드가 몇 개인지와 어떤 파드가 어느 노드에서 도는지까지 모든 데이터를 여기에 둡니다. 운영 중인 클러스터에서 etcd 데이터베이스가 유실되면 컨테이너뿐 아니라 클러스터가 쓰던 자원 전부가 미아가 됩니다.

카카오의 Kubernetes as a Service인 DKOS는 Kubernetes Live Upgrade를 API로 제공합니다. 앱에 영향을 주지 않고 버전을 올리려고 마스터 노드를 하나씩 지우고 교체하는데, 이때 etcd 서버를 빼고 넣는 작업이 반복됩니다. 안정적인 API를 만들고 운영하려면 etcd가 어떻게 동작하는지 알아야 했고, 이 글은 그때 조사한 기본 동작과 유지 보수 방법을 풀어 쓴 것입니다.

## Replicated state machine과 Raft {#rsm-raft}

etcd는 key:value 저장소이면서 Replicated state machine(RSM)입니다. 같은 데이터를 여러 서버에 계속 복제해 서버 몇 대가 죽어도 동작하게 하는 방식이고, 데이터 쓰기는 command가 담긴 log를 순서대로 append하는 일입니다. 복제만으로는 문제가 끝나지 않아서 컨센서스를 확보해야 하며, 원문은 이를 다음 네 속성을 만족하는 것으로 정리합니다. etcd는 이를 위해 Raft 알고리즘을 씁니다.

- Safety: 항상 올바른 결과를 돌려준다.
- Available: 서버가 몇 대 죽어도 응답한다.
- Independent from timing: 네트워크 지연이 있어도 로그 일관성이 깨지지 않는다.
- Reactivity: 모든 서버에 복제되지 않았어도 조건을 채우면 빠르게 응답한다.

용어는 쿼럼, 상태, 타이머 세 가지만 먼저 잡습니다. 쿼럼은 의사결정에 필요한 최소 서버 수로, 서버가 3대면 2입니다. etcd는 쓰기 요청이 쿼럼 수만큼의 서버에 복제되면 작업이 끝난 것으로 봅니다. 상태는 Leader, Follower, Candidate 중 하나입니다. 타이머는 리더가 보내는 heartbeat와 관련됩니다. 리더가 아닌 서버가 election timeout 동안 heartbeat를 받지 못하면 리더가 사라진 것으로 보고 움직이기 시작합니다.

## 리더 선출과 로그 복제 {#election-replication}

서버 3대로 클러스터를 처음 띄우면 모두 follower이고 term은 0입니다. 한 서버에서 election timeout이 나면 그 서버가 candidate가 되어 term을 1 올리고 다른 서버에 RequestVote RPC를 보냅니다. 받은 서버는 자기 term과 log가 더 크면 거절하고, 아니면 OK를 줍니다. 자신을 포함해 OK가 쿼럼에 이르면 leader가 되고, 이후 term과 log index가 담긴 Append RPC를 heartbeat로 보냅니다.

쓰기 요청이 오면 leader는 자기 lastIndex 다음에 로그를 쓰고, 다음 heartbeat 때 follower별 nextIndex에 맞는 로그를 AppendEntry로 보냅니다. follower 하나가 응답하면 leader 자신까지 쿼럼만큼 복제된 것이므로, 다른 follower가 아직 응답하지 않아도 commit합니다. commit은 메모리의 log entry를 서버의 db에 쓰는 일입니다. 이 시점부터 읽기에 새 값이 나옵니다.

leader가 죽으면 follower가 election timeout 뒤 candidate가 됩니다. 원문의 예에서는 먼저 timeout된 F2가 term을 올려 표를 구하지만, F1의 log가 더 최신이라 거절당합니다. 이어서 F1에서 timeout이 나면 term이 같고 log가 더 최신이므로 F2가 OK를 주어 F1이 새 leader가 됩니다. 옛 leader가 돌아오면 lastIndex와 term이 모두 낮아 follower로 내려갑니다. election이 거듭 실패하면 가용성이 떨어질 수 있는데, Raft는 이를 randomize election timeout과 preVote로 다루며 etcd에는 preVote가 구현돼 있다고 합니다.

## 런타임 재구성 {#runtime-reconfiguration}

런타임 재구성은 동작 중인 클러스터에서 서버를 추가·삭제하는 일입니다. etcd는 설정 변경을 별도 메커니즘 없이 기존 log replication으로 처리합니다. 다만 새 config는 commit을 기다리지 않고 entry에 쓰이는 즉시 효력이 생기고, 여러 개가 있으면 가장 최신을 씁니다. 서버가 4대가 되는 Cnew라면 commit에 필요한 복제 수는 3입니다.

멤버를 추가하면 leader는 최근 snapshot에 현재 log entry를 합친 새 snapshot을 보내고, 새 서버는 이것으로 db를 만들어 Append RPC를 받을 준비를 합니다. 그런데 새 멤버가 따라잡기 전에 또 멤버 추가 요청이 오면 Cnew2의 commit이 늦어지고, 그 사이 쓰기가 막혀 client timeout을 넘기면 가용성 문제가 됩니다. 이를 위해 etcd 3.4.0부터 네 번째 상태인 learner가 있습니다. 클러스터 멤버이지만 쿼럼 계산에서는 빠지고, promote API로 follower가 됩니다. 로그를 다 따라잡지 못했으면 promote는 거절됩니다. 원문은 kubeadm과 Kubespray가 클러스터 생성 때 learner를 쓰지 않으며, Kubernetes용 etcd의 snapshot이 평균 수십 KB라 이 문제가 날 가능성은 낮다고 덧붙입니다.

여러 멤버를 한꺼번에 추가하는 것도 막아야 합니다. 충분히 복제되지 않은 config log가 쌓이면 안 되므로 Raft는 한 번에 하나씩 처리하는 것을 원칙으로 하고, etcd는 leader log에 commit되지 않은 config가 있으면 새 config를 받지 않는 restriction을 둡니다.

멤버 삭제도 로그 복제로 진행합니다. leader가 자신을 지우라는 요청을 받으면 commit에 필요한 복제 수를 셀 때 자기를 뺍니다. commit한 뒤 heartbeat를 멈추고 자리에서 내려오는데, 이를 step down이라고 합니다. 남은 서버 중 하나가 timeout되어 새 leader를 뽑습니다. 삭제에도 restriction이 있어서, 정상 동작 중인 서버 수(started)가 쿼럼보다 낮아질 것으로 예상되면 삭제 요청을 거절합니다. 5대 클러스터라면 started 4에 쿼럼 3이고, 두 대까지는 지울 수 있지만 세 번째는 거절됩니다.

## 유지 보수 방법 {#maintenance}

Raft를 완벽히 구현해도 etcd가 메모리와 파일시스템을 무분별하게 쓰면 스토리지 구실을 못 합니다. 원문은 네 가지를 다룹니다.

로그 리텐션: etcd는 log entry를 메모리에 두므로 계속 쌓으면 OOM이 납니다. 그래서 주기적으로 snapshot을 파일시스템에 쓰고 메모리를 비웁니다(truncate). 비워진 log를 follower가 요구하면 leader가 최근 snapshot 파일을 보냅니다. 주기는 snapshot-count 옵션으로 정합니다.

리비전과 컴팩션: etcd는 key마다 값 하나만 두지 않고 변경 이력 전체를 revision과 함께 파일시스템에 기록합니다. 관리하지 않으면 디스크가 차서 프로세스가 멈추므로 compaction으로 오래된 revision을 지우며, 지운 revision은 더 조회할 수 없습니다. 자동 컴팩션에는 revision 모드와 periodic 모드가 있고, auto-compaction-retention 옵션의 의미가 모드에 따라 달라집니다. periodic 모드의 세부 동작은 etcd 버전마다 조금씩 다르며 원문 예시는 3.3 기준입니다.

단편화 제거: compaction으로 revision을 지워도 디스크 공간은 돌아오지 않습니다. RDB에서 TRUNCATE 없이 DELETE만 하면 공간이 안 나오는 것과 비슷합니다. defragmentation을 해야 공간이 확보되고, 이 작업에는 자동 기능이 없습니다. 진행 중에는 읽기와 쓰기가 모두 막히지만 몇 ms 단위라 Kubernetes용 클러스터에서 timeout이 날 가능성은 적다고 합니다. db 크기가 etcd_quota_backend_bytes 한도를 넘으면 "database space exceeded"와 함께 쓰기를 받지 않는 read-only 모드가 됩니다. 키가 많을 것 같으면 defragmentation을 CronJob으로 주기 실행하거나 이 옵션을 넉넉하게 주라고 권합니다.

백업과 복구: etcdctl snapshot save로 만든 db 파일에는 무결성 해시가 들어 있어 snapshot restore 때 변조 여부를 확인할 수 있습니다. 파일을 그냥 복사한 백업으로 복구하려면 --skip-hash-check가 필요합니다. 복구는 db 파일을 특정 경로에 두고 새 etcd를 시작하는 두 단계이며, 새 메타데이터로 시작해야 합니다. 메타데이터에는 클러스터와 멤버의 uuid가 있어서, 옛 메타데이터를 유지한 채 새 클러스터를 만들면 죽은 줄 알았던 서버가 살아났을 때 구성이 꼬일 가능성이 큽니다. 컴팩션이 많이 일어났는데 defragmentation하지 않은 db를 백업하면 용량도 불필요하게 큽니다.

## DKOS의 etcd 백업 {#dkos-backup}

DKOS는 클러스터를 만들 때 백업용 CronJob을 함께 배포합니다. CronJob은 마스터 노드에서 돌며 카카오의 분산 오브젝트 스토리지 MetaKage에 etcd 데이터베이스를 하루에 한 번 백업하고, 클러스터당 최근 5일치를 보관합니다. 모든 클러스터가 같은 시간에 백업해 네트워크에 부하를 주지 않도록 클러스터마다 백업 시간이 다릅니다.

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
