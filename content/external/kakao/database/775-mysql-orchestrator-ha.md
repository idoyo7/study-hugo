---
title: "MySQL Orchestrator 기반의 새로운 HA 표준"
description: "카카오가 MHA의 한계를 넘으려고 2023년부터 R&D를 거쳐 Orchestrator Raft HA 구성을 새 MySQL 고가용성 표준으로 세운 과정을 정리했습니다. 카카오 DBaaS 연동, 내부 로직 수정, slave_net_timeout 조정까지 요약합니다."
date: 2026-11-14
weight: 2
---

# MySQL Orchestrator 기반의 새로운 HA 표준 (2025-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [MySQL Orchestrator 기반의 새로운 HA 표준 개발기](https://tech.kakao.com/posts/775)
- 매체 · 게시일: 카카오 기술블로그 · 2025-09-30
- 저자: 본문에 저자 미표기 (카카오 MySQL 플랫폼 엔지니어 글)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## MHA 기반 표준의 한계 {#mha-한계}

MHA는 2012년 DeNA의 Yoshinori Matsunobu가 대규모 MySQL 운영 환경의 고가용성을 위해 만들어 오픈소스로 공개한 솔루션입니다. 카카오도 2015년경 대규모 MySQL의 고가용성이 필요했고, MHA가 가장 적절하다고 판단해 그 소스를 바탕으로 MySQL 표준 구성을 세웠습니다. 시간이 지나 MySQL 버전이 오르고 요구 사항이 다양해지면서 MHA로는 이를 모두 받아들이기 어려워졌고, 2023년부터 고가용성 R&D를 진행해 Orchestrator 기반의 새 표준을 확립했습니다.

원문이 꼽은 MHA의 한계는 세 갈래입니다.

- 변화하는 환경에 대한 대응 부족: 10년 넘게 패치와 기능 추가가 없어 MySQL과 OS 버전이 오르는 환경에 대응하지 못한다고 판단했습니다.
- 구조적 한계: Source 서버 상태를 외부에서 접근해 확인하는 방식이라 네트워크가 안정적이라는 전제가 깔려 있고, 다양한 네트워크 장애에서 오동작이 확인됐습니다. 카카오는 이를 보완하려고 MHA Cluster Manager인 HAM을 만들었습니다. 또 Source가 어려울 때 Replica를 승격하는 것이 기본 설계라, Replica 상태를 보고 고가용성을 확보해야 하는 카카오의 요구는 담을 수 없었습니다.
- 유지 보수의 어려움: Perl로 작성돼 있고 한국에서 Perl은 거의 쓰지 않는 언어라 코드 분석과 수정에 시간이 많이 들었습니다.

## Orchestrator 선정과 Raft HA 구성 {#orchestrator-선정}

2023년에 쓸 수 있던 솔루션으로 MySQL Cluster, ProxySQL, Corosync + Pacemaker 조합, Percona XtraDB Cluster, MySQL InnoDB Cluster 등을 조사했고, 요구사항에 맞는 것으로 Orchestrator를 골랐습니다. Orchestrator는 Shlomi Noach가 만든 오픈소스로, 자동 페일오버를 넘어 복잡한 Replication 구조 전체를 이해하고 healing하는 데 초점을 둔 MySQL Replication Topology용 HA·시각화 도구입니다. 한 클러스터에 여러 MySQL Replication Topology를 등록해 관리할 수 있고, Orchestrator 자체도 클러스터로 구성해 고가용성을 얻습니다.

클러스터 구성은 Meta DB를 어떻게 둘지와 Orchestrator 프로세스를 어떻게 관리할지에 따라 No HA, Semi HA, Shared Backend HA, Raft HA의 네 가지입니다. 앞의 셋은 Orchestrator 프로세스 자체의 HA를 제공하지 않습니다. 카카오는 구성 난이도가 가장 높지만 안전한 Raft HA를 택했습니다. Raft로 선출된 리더가 MySQL을 모니터링하고 장애를 검출하며 Meta DB 데이터도 관리합니다.

Raft 노드는 최소 3대, 가급적 홀수로 구성합니다. 짝수여도 Split-Brain은 생기지 않지만, 정족수가 다시 통신할 수 있을 때까지 서비스가 멈추고 한 대 적은 홀수 구성과 장애 허용 수가 같아 비효율적이기 때문입니다. 3노드는 1대, 5노드는 2대까지 장애를 허용하고, 4노드는 2 대 2로 갈리면 양쪽 모두 과반수를 못 채워 클러스터가 멈춥니다.

## 카카오 환경에 맞춘 개발 {#카카오-환경-개발}

표준을 정한 뒤에도 실서비스에 쓰려면 추가 개발이 필요했고, 크게 두 부분이었습니다.

첫째는 DBaaS 연동입니다. 카카오는 모든 MySQL을 DBaaS로 운영하므로 Orchestrator도 이 시스템과 이어져야 했고, 그 운영 솔루션을 Protego라 이름 붙였습니다. Protego는 DB 메타 정보를 제공하고 Orchestrator와 DBaaS 사이의 연동을 맡습니다.

둘째는 Orchestrator 내부 로직 수정입니다. 카카오 버전을 따로 만들되 두 가지 전제를 뒀습니다. 코드 변경은 최소화하고, 오픈소스 최신 버전과 카카오 버전의 배포 프로세스를 정의해 소스 충돌을 막는다는 것입니다. 구성 요소별 수정은 다음과 같습니다.

- WEB Interface: 위험하다고 본 UI를 제거했습니다.
- Client API: Protego와 연동하는 API를 추가했습니다.
- Hook: 이벤트 알람 기능을 붙였습니다.
- Backend DB: Protego가 Orchestrator의 메타정보에 접근해 여러 기능의 정보로 씁니다.

카카오에는 Replica 서버를 서비스에 투입해 쓰려는 요구가 있었습니다. MHA는 설계상 Replica 모니터링이 어려워 받아들이지 못했지만, Orchestrator는 조금만 고치면 되어 DNS Failover를 만들었습니다. 서비스용 Replica 도메인을 만들어 매핑하고, Orchestrator Backend DB 정보로 Replica 상태를 확인하다가, 장애가 확인되면 다른 Replica로 도메인만 바꿉니다. 현재는 5분 정도의 시간 간격을 두고 바꾸며, 추가 요구에 따라 더 고도화할 수 있다고 봅니다.

배포·빌드도 자동화했습니다. 최초 클러스터 구성에서는 git clone부터 빌드, 계정 생성, 파일 수정까지 7가지 수동 작업을 스크립트로 묶었습니다. 빌드가 필요 없는 배포는 예전엔 서버마다 git pull과 conf 수정, 재기동을 손으로 했지만 이제 Jenkins가 배포와 conf 설정까지 맡고 필요할 때 재기동만 하면 됩니다. 빌드도 Jenkins가 전후 상태를 모니터링하며 진행합니다.

## Orchestrator의 장애 판단에 맞춘 MySQL 운영 {#장애-판단-운영}

Orchestrator는 Source의 `SELECT 1` 결과, Replica의 `SHOW REPLICA STATUS`, `SHOW SOURCE STATUS` 결과, 세 가지로 상태를 판단하고, 이 때문에 기존에 쓰던 시스템 변수를 바꿔야 했습니다. 핵심은 `slave_net_timeout`입니다. Replica가 Source로부터 이벤트를 받지 못할 때 얼마나 기다린 뒤 연결 끊김을 확정할지를 정해, Fail-over 확정 시간에 영향을 줍니다.

Source의 MySQL이 내려간 경우에는 Source가 Replica에 Dead Signal을 보내고, Replica는 IO Running 상태를 Connecting으로 바꿉니다. Orchestrator는 UnreachableMaster를 확인한 뒤 Replication 이상을 보고 Fail-over를 확정하며, 이때 걸리는 시간은 약 2초에서 6초입니다. 반대로 프로세스는 멀쩡하고 네트워크만 끊긴 경우에는 Dead Signal이 가지 않아 `slave_net_timeout`이 지날 때까지 Replication 중지가 확정되지 않고, 그만큼 Fail-over가 늦어집니다. 카카오는 MySQL 서버들의 `slave_net_timeout` 값을 바꿨고, 네트워크 장애로 인한 Fail-over가 5초에서 10초 안에 끝나도록 개선됐습니다. 원문에 바꾼 값은 적혀 있지 않습니다.

## 전환 계획 {#전환-계획}

현재 카카오는 Orchestrator와 MHA를 함께 쓰고 있고, 3년 안에 모든 시스템을 Orchestrator로 통합하는 것을 목표로 전환 중입니다. 완료되면 네트워크 장애로 인한 Failover 오류가 없어지고, Replica 모니터링과 후속 처리 기능을 더할 수 있으며 업무 생산성도 오를 것으로 기대합니다.

{{% details title="원문의 구성 기준과 소요 시간" closed="true" %}}

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
