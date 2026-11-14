---
title: "카카오 MySQL의 새 HA 표준이 된 Orchestrator"
description: "MHA로 대응하기 어려웠던 네트워크 장애와 Replica 모니터링 요구를 카카오는 어떻게 풀었을까요? Orchestrator를 Raft HA로 구성하고 DBaaS 연동과 DNS Failover를 개발했으며, 장애 판단 방식에 맞춰 MySQL 설정도 바꿨습니다."
date: 2026-11-14
weight: 2
---

# 카카오 MySQL의 새 HA 표준이 된 Orchestrator (2025-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [MySQL Orchestrator 기반의 새로운 HA 표준 개발기](https://tech.kakao.com/posts/775)
- 매체 · 게시일: 카카오 기술블로그 · 2025-09-30
- 저자: 본문에 저자 미표기 (카카오 MySQL 플랫폼 엔지니어 글)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## Replica까지 살펴야 했던 MySQL 운영 {#mha-한계}

카카오에는 MySQL Replica를 서비스에 투입하려는 요구가 있었습니다. Source만 살펴서는 부족했습니다. MHA는 Source 서버의 운영이 어렵다고 판단하면 Replica를 승격하는 방식이어서, Replica 상태까지 확인해 고가용성을 확보하려는 요구를 담을 수 없었습니다.

네트워크 장애도 문제였습니다. MHA는 외부에서 Source에 접근해 상태를 확인하는데, 카카오는 이 방식에 네트워크가 안정적이라는 전제가 있다고 봤습니다. 실제로 여러 네트워크 장애 상황에서 오동작이 확인됐고, 이를 보완하려고 MHA Cluster Manager인 HAM을 개발해 그 안에서 MHA를 운영했습니다.

MHA는 2012년 DeNA의 Yoshinori Matsunobu가 대규모 MySQL 환경의 고가용성을 위해 만들고 공개한 오픈소스입니다. 카카오도 2015년경에는 MHA가 가장 적절하다고 판단해 이를 바탕으로 MySQL 표준 구성을 세웠습니다. 하지만 MySQL과 OS 버전이 계속 오르는 동안 MHA에는 10년 넘게 패치와 기능 추가가 없었습니다. 한국에서 거의 쓰이지 않는 Perl로 작성된 코드를 분석하고 수정하는 일도 운영 엔지니어에게 부담으로 남았습니다.

## Orchestrator 자체의 HA를 위한 Raft 구성 {#orchestrator-선정}

카카오는 2023년부터 새 HA 표준을 찾는 R&D를 시작했습니다. 당시 사용할 수 있던 MySQL Cluster, ProxySQL, Corosync + Pacemaker 조합, Percona XtraDB Cluster, MySQL InnoDB Cluster 등을 검토한 끝에 Orchestrator를 골랐습니다.

Shlomi Noach가 만든 Orchestrator는 MySQL Replication Topology를 관리하는 HA·시각화 도구입니다. 자동 페일오버를 넘어 복잡한 복제 구성을 이해하고 복구하는 데 초점을 두고 있습니다. 한 클러스터에 여러 MySQL Replication Topology를 등록할 수 있어 대규모 환경을 관리하기에도 적합했습니다.

관리 대상만 HA로 구성하는 것은 아닙니다. Orchestrator 자체도 클러스터로 묶을 수 있습니다. Meta DB 구성과 Orchestrator 프로세스 관리 방식에 따라 No HA, Semi HA, Shared Backend HA, Raft HA를 선택할 수 있는데, 앞의 셋은 Orchestrator Manager 자체의 HA를 제공하지 않습니다. 카카오는 구성 난이도가 가장 높지만 안전하게 사용할 수 있다고 판단한 Raft HA를 택했습니다. Raft로 선출된 리더가 MySQL을 모니터링하고 장애를 검출하며 Meta DB 데이터도 관리합니다.

Raft 구성에서는 노드 수가 가용성에 영향을 줍니다. 리더 선출에 필요한 최소 동의 수인 정족수는 과반수이며, 로그 커밋에도 과반수가 필요합니다. 노드는 최소 3대 이상으로 구성하고 홀수 구성을 권장합니다.

3개 노드와 4개 노드는 모두 1대의 장애까지 허용합니다. 노드를 한 대 더 둔다고 장애를 더 견디지는 못합니다. 특히 4개 노드가 2 대 2로 분리되면 어느 쪽도 과반수를 채우지 못해 서비스가 멈춥니다. 여러 노드가 자신을 Primary로 선언하는 Split-Brain은 막지만, 과반수 노드가 다시 통신할 때까지 서비스는 중단됩니다. 5개 노드로 구성하면 2대의 장애까지 허용합니다.

## 네트워크 단절 뒤에 길어진 대기 시간 {#장애-판단-운영}

도구를 바꾸자 MySQL 설정도 다시 봐야 했습니다. Orchestrator는 Source의 `SELECT 1` 결과와 Replica의 `SHOW REPLICA STATUS`, `SHOW SOURCE STATUS` 결과를 함께 보고 Fail-over를 결정합니다. Source에 접근할 수 있는지뿐 아니라 Replica에서 복제가 어떻게 동작하는지도 판단에 쓰는 방식입니다.

Source의 MySQL이 내려가면 Orchestrator는 이상을 감지하고 UnreachableMaster 상태를 확인합니다. 일반적으로 이때 Source는 Replica에 Dead Signal을 보내며, 이를 받은 Replica는 IO Running 상태를 Connecting으로 바꿉니다. Orchestrator가 이 복제 이상까지 확인하면 Fail-over를 확정해 진행합니다. 소요 시간은 약 2초에서 6초입니다.

네트워크만 끊기면 사정이 달라집니다. Source 프로세스는 살아 있어도 Replica가 Dead Signal을 받지 못합니다. 이때 기다리는 시간을 정하는 변수가 `slave_net_timeout`입니다. Replica가 Source로부터 이벤트를 받지 못한 뒤 몇 초를 기다려 연결 끊김을 확정할지 정합니다.

이 시간이 지나기 전에는 Replication 중지가 확정되지 않습니다. Orchestrator도 Replica의 IO Thread 동작이 멈출 때까지 기다리므로 Fail-over가 늦어집니다. 카카오는 MySQL 서버들의 `slave_net_timeout` 값을 바꿔 네트워크 장애 시 Fail-over가 5초에서 10초 정도에 수행되도록 개선했습니다. 구체적으로 어떤 값으로 바꿨는지는 원문에 제시되지 않았습니다.

## 카카오 DBaaS에 맞춰 손본 Orchestrator {#카카오-환경-개발}

Raft HA를 선택한 뒤에도 서비스에 적용할 작업은 남아 있었습니다. 카카오는 모든 MySQL을 DBaaS로 운영하므로 Orchestrator도 이 시스템과 연결해야 했습니다. 이를 위해 만든 운영 솔루션이 Protego입니다. DB 메타 정보를 제공하고 Orchestrator와 카카오 DBaaS 사이의 연동을 담당합니다.

내부 요구를 반영한 카카오 버전의 Orchestrator도 만들었습니다. 변경 범위는 최소로 잡았습니다. 이후 오픈소스의 패치와 버전 변경을 쉽게 적용하려고, 최신 오픈소스와 카카오 버전 사이의 코드 충돌을 막을 배포 프로세스를 정의한다는 원칙도 세웠습니다. 구성 요소별 변경은 필요한 부분에 집중했습니다.

- WEB Interface: 위험하다고 판단한 UI 제거
- Client API: Protego 연동용 API 추가
- Hook: Orchestrator 이벤트 알람 기능 추가
- Backend DB: Protego가 메타정보에 접근해 여러 기능을 구현하는 데 활용

### Replica 도메인을 옮기는 DNS Failover {#dns-failover}

MHA에서 받아들이기 어려웠던 Replica 운영 요구에는 DNS Failover로 대응했습니다. Orchestrator는 일부 수정으로 Replica 모니터링과 서비스 제외 기능을 개발할 수 있었습니다.

동작은 도메인 변경에 한정됩니다. 서비스용 Replica 도메인을 만들어 서버에 매핑하고, Orchestrator Backend DB의 정보로 Replica 상태를 확인합니다. 장애가 확인되면 도메인이 가리키는 대상을 다른 Replica로 바꿉니다. 다른 작업 없이 도메인만 변경하므로 DNS Failover라는 이름을 붙였습니다.

도메인은 5분 정도의 간격을 두고 바꾸도록 구현했습니다. 추가 요구에 따라 이 기능을 더 고도화할 수 있다고 보고 있습니다.

### 수동 작업을 줄인 배포·빌드 자동화 {#deployment}

여러 서버에서 같은 작업을 반복하는 과정도 바꿨습니다. 최초 Orchestrator 클러스터 구성에는 git clone부터 빌드, 계정 생성, 파일 수정까지 7가지 수동 작업이 필요했습니다. 이를 스크립트로 자동화해 사람의 실수를 줄이고 빠르게 구성할 수 있도록 했습니다.

빌드가 필요 없는 코드를 배포할 때도 서버마다 접속해 git pull로 소스를 동기화하고, 클러스터에 맞게 conf 파일을 수정해야 했습니다. 경우에 따라 재기동도 필요했습니다. Jenkins가 배포와 conf 설정을 처리하도록 바꾼 뒤에는 필요할 때 Orchestrator를 재기동하는 작업만 남았습니다.

빌드 역시 자동화 대상이었습니다. 서버에 접속해 코드를 받고 상태를 살핀 뒤 빌드하던 과정을 Jenkins로 옮겼습니다. 빌드 전후 상태를 모니터링하며 안전하게 진행하도록 구성했습니다.

## MHA와 병행하는 Orchestrator 전환 {#전환-계획}

2025년 9월 글이 게시된 시점에도 카카오는 MHA와 Orchestrator를 함께 운영하고 있었습니다. 새 표준을 정했지만 전체 전환이 끝난 것은 아닙니다. 3년 안에 모든 시스템을 Orchestrator로 통합하는 것이 목표입니다.

전환을 마친 뒤에는 업무 생산성이 높아질 것으로 기대하고 있습니다. 네트워크 장애에 따른 Failover 오류 제거와 Replica 모니터링·후속 처리 기능 확장도 기대하는 효과입니다. 이미 확인한 설정 조정의 성과와 전체 통합 뒤에 기대하는 효과는 구분해서 읽어야 합니다.

{{% details title="구성 기준과 동작 시간" closed="true" %}}

| 항목 | 값 |
|---|---|
| Raft 3노드 | 과반수 2, 1대 장애 허용 |
| Raft 4노드 | 과반수 3, 1대 장애 허용, 2 대 2 분리 시 서비스 불가 |
| Raft 5노드 | 과반수 3, 2대 장애 허용 |
| Source 다운 시 Fail-over 소요 | 약 2초에서 6초 |
| 네트워크 장애 시 Fail-over 소요 (변수 조정 뒤) | 5초에서 10초 안팎 |
| DNS Failover 도메인 변경 간격 | 5분 정도 |
| 최초 구성 자동화 대상 | 수동 작업 7가지 |
| 통합 목표 | 3년 안에 전체를 Orchestrator로 |

{{% /details %}}
