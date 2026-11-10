---
title: "재시작의 부담을 줄여 Kubernetes로 옮긴 DSW"
description: "DSW 세션 3,500개를 Kubernetes로 옮길 때 사용자 환경은 어떻게 지켰을까요? Uber는 추가 패키지 목록으로 환경을 복원하고, Job과 Federator로 세션 실행과 클러스터 배치를 바꿨습니다."
date: 2026-11-10
weight: 8
---

# 재시작의 부담을 줄여 Kubernetes로 옮긴 DSW (2025-05)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Migrating Large-Scale Interactive Compute Workloads to Kubernetes Without Disruption](https://www.uber.com/us/en/blog/migrating-large-scale-compute-workloads-to-kubernetes/)
- 매체 · 게시일: Uber Engineering Blog · 2025-05-08
- 저자: Sayan Pal(Senior Software Engineer, Data Platform), Rishabh Mishra(Senior Software Engineer, Compute Platform)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 재시작을 앞둔 3,500개 세션 {#challenges}

Uber는 DSW(Data Science Workbench)의 대화형 세션 3,500개를 Apache Mesos 기반 오케스트레이터 Peloton에서 Kubernetes로 옮겼습니다. 재시작은 피할 수 없었습니다. 기존에는 컨테이너를 다시 띄우면 메모리 상태와 로컬 디스크 데이터, 사용자가 설치한 패키지가 사라졌고, 사용자는 개발 환경부터 다시 꾸려야 했습니다.

DSW는 응용 과학자, 데이터 과학자, ML 엔지니어, 운영 전문가가 웹에서 데이터를 탐색·분석하고 모델을 학습시키며, 워크플로 스케줄링과 시각화, 협업을 하는 노트북 플랫폼입니다. Jupyter와 RStudio는 메모리·컴퓨트·GPU 구성이 다양한 격리 컨테이너에서 실행됩니다. 세션 안에서도 여러 Python 커널과 Spark용 PySpark·Sparkmagic 커널이 각자 독립된 환경을 사용합니다. 컨테이너 하나를 다시 띄우는 일이 사용자에게는 여러 환경을 재설정하는 일이었습니다.

이전 팀은 사용자가 추가한 패키지를 기록하고 복원하는 방식으로 이 부담을 줄였습니다. 사용자 2,000명 넘는 수천 개 세션의 이전은 큰 중단이나 불만 없이 끝났고, DSW는 Uber에서 Kubernetes 이전을 완료한 초기 배치 워크로드 중 하나가 됐습니다.

이 사례는 Uber의 Kubernetes 마이그레이션 시리즈 두 번째 글에 담겼습니다. 앞 글에서는 공유 무상태 워크로드 전체의 이전을 다뤘으며, 후속 글에서도 다른 이전 사례를 소개할 예정입니다.

## 재시작 뒤 환경을 복원할 패키지 목록 {#nfs-and-checkpoint}

사용자가 가장 불편해한 것은 재시작할 때마다 개발 환경을 다시 설정하는 일이었습니다. Docker 체크포인트와 Kubernetes 볼륨 스냅샷도 검토했지만, 사용할 수 없거나 성능 요구에 맞지 않았습니다. 그래서 사용자가 설치한 패키지를 보존하는 데 집중했습니다.

처음 구상은 환경 전체를 NFS에 두는 것이었습니다. DSW에는 이미 세션 사이에 데이터를 남기는 공용 NFS 마운트가 있었습니다. 하지만 Python과 R 환경에는 작은 파일이 아주 많아 부트스트랩이 느려지고 NFS IOPS 소모도 커졌습니다(원문 Figure 6). 환경 전체를 보관하는 방식은 여기서 포기했습니다. 대신 세션 중에 추가로 설치한 패키지 목록만 남기기로 했습니다.

설치 명령 하나만 감시해서는 부족했습니다. 사용자는 pip, poetry, R 도구 등 여러 경로로 패키지를 설치했기 때문입니다. 팀은 패키지 설치 디렉터리를 감시하고, 여기서 발생하는 inotify 이벤트에 디바운스를 적용해 설치와 삭제를 추적하는 방법을 고안했습니다. 기록은 NFS에 저장합니다. 세션을 다시 띄울 때는 부트스트랩 단계에서 목록에 있는 패키지 중 새 환경에 없는 것을 재설치합니다. 노트북과 패키지 환경은 유지되지만, 메모리 상태는 재시작과 함께 사라집니다.

실제 이전에는 이 복원 절차를 실행할 새 재시작 API도 필요했습니다. API는 사용자에게 재시작을 알린 뒤 Peloton 세션을 체크포인트하고 종료하며, Kubernetes에서 세션을 다시 띄우도록 설계했습니다.

## 클라우드 이전을 막던 전용 호스트 {#background}

사용자 환경을 복원하는 일과 별개로, DSW를 옮겨야 할 인프라 차원의 이유가 있었습니다. Uber는 배치·무상태·스토리지 워크로드를 Kubernetes로 모으면서 업계 표준 기술의 내장 기능과 안정성을 활용하려 했습니다. Crane과 Google Cloud 이전 프로젝트에서 세운 원칙도 이 방향과 맞닿아 있었습니다. 인프라는 벤더에 종속되지 않고 온프레미스와 클라우드에서 동작해야 했고, 동질적인 호스트를 바탕으로 존 증설과 인프라 관리를 자동화해야 했습니다. 클라우드로 용량을 옮기는 일도 가급적 단일 컨테이너 오케스트레이션 플랫폼에서 간단하게 중앙 관리하려 했습니다.

DSW의 NFS는 이 목표에 걸림돌이었습니다. Peloton에서는 전용 호스트 그룹의 하위 초기화 서비스가 NFS 클러스터를 마운트했습니다. 세션이 이 호스트들에 의존하는 한 워크로드만 자유롭게 옮기기는 어려웠습니다.

그렇다고 곧바로 Kubernetes의 NFS 지원을 사용할 수도 없었습니다. CSI 드라이버나 Kubelet 추가 패키지를 적용하려면 개발과 유지보수가 필요했고, Uber의 초기 Kubernetes 배포에서는 NFS용 CSI 드라이버 설치가 허용되지 않았습니다. 팀은 기존 호스트 마운트 방식을 유지하면서 적용 범위를 Kubernetes 플릿 전체로 넓혔습니다. 호스트 단위의 단일 NFS 마운트를 공통으로 적용해 전용 호스트 그룹에 대한 의존을 없앤 것입니다.

NFS 지원 자체는 후속 과제로 남았습니다. Uber는 Kubernetes 운영이 성숙하면 CSI 드라이버나 Kubelet의 nfs-common Debian 패키지로 NFS를 일급 지원할 계획입니다. 워크로드의 이식성을 완성하려면 이 단계까지 가야 한다고 봤습니다.

## 한가한 클러스터도 활용하는 Federator {#federation}

Peloton에서는 자원이 남아 있어도 DSW가 쓰지 못하는 일이 있었습니다. DSW가 존 단위 전용 클러스터에서 실행됐기 때문입니다. 다른 Peloton 클러스터는 한가한데 DSW 클러스터에는 부하가 몰려 스케줄링이 지연됐습니다. 존이나 클러스터의 장애는 전체 중단으로 이어질 수 있었고, 클러스터 폐기나 정비, 새 클러스터 추가에도 DSW 팀과 Compute 팀이 함께 움직여야 했습니다.

Kubernetes에서는 DSW와 개별 클러스터 사이에 Federator를 뒀습니다. Federator는 Kubernetes 배치 클러스터들을 관리하는 Uber의 배치 컴퓨트 페더레이션 계층입니다. DSW가 특정 클러스터로 직접 작업을 보내던 관계를 끊고 Federator에 요청하면, Federator가 자원 여유와 수요를 보고 실행할 클러스터를 고릅니다. 이 배치 알고리즘으로 클러스터 부하가 고르게 분산되면서 SLA와 스케줄링 대기 시간도 개선됐습니다.

장애의 영향 범위도 줄었습니다. Federator는 여러 존에 걸친 리전 서비스로, 클러스터 상태를 계속 폴링합니다. 한 클러스터나 존에 장애가 나도 DSW 전체가 멈추지 않게 된 것입니다.

클러스터 운영에서도 DSW 팀이 매번 참여할 이유가 사라졌습니다. Compute 팀은 DSW의 개입 없이 리전에 Kubernetes 클러스터를 추가하거나 제거할 수 있게 됐고, 폐기·프로비저닝·시크릿 교체·정비의 부담이 줄었습니다. 팀 사이에서 자원을 공유하고 비용을 줄일 여지도 생겼습니다.

## 오래 실행할 세션에 맞춘 Kubernetes Job {#job-modeling}

클러스터 선택은 Federator에 맡겼지만, 개별 세션을 어떤 Kubernetes 리소스로 표현할지는 따로 결정해야 했습니다. DSW는 컨테이너 하나를 오래 유지하며 사용자와 상호작용합니다. 비대화형의 짧은 다중 컨테이너 작업을 겨냥한 Job과는 사용 방식이 달랐습니다.

CRD를 만들면 오래 실행되는 컨테이너의 파드 동작을 완전히 통제할 수 있었습니다. 대신 이를 계속 유지해야 했습니다. 기존 Kubernetes Federation이 이미 Job 인터페이스를 지원하고 있었으므로, 팀은 이전 속도와 유지보수 부담을 고려해 Job을 세션에 맞게 조정하는 쪽을 택했습니다.

먼저 `parallelism`을 1로 두어 Job 하나에 파드 하나만 실행했습니다. 세션은 종료 코드 0으로 끝나지 않으므로 `completions`에는 1,024라는 큰 값을 줬습니다. 실패 뒤 동작도 바꿨습니다. `OnFailure`는 같은 파드 안에서 컨테이너를 재시작해 문제가 생겼기 때문에, `restartPolicy`를 `Never`로 설정하고 실패한 파드를 새 파드로 교체하게 했습니다. `spec.backoffLimit`은 매우 높게 잡았으며, 퇴거 같은 실패는 한도를 소진하지 않도록 제외했습니다.

서비스 간 통신에는 동적 포트 할당과 Compute 팀의 서비스 메시, `hostNetwork: true`를 사용합니다. 소유권에 따른 시크릿과 SPIRE 신원을 제공할 볼륨도 추가로 마운트했습니다. 세션의 실행 단위뿐 아니라 통신과 신원에 필요한 조건까지 Job에 반영한 구성입니다.

## Kubernetes에서도 이어 쓴 Compute UI {#ui-and-sandbox}

세션을 옮긴 뒤에도 사용자는 작업 상태와 로그를 확인해야 했습니다. 기존 Peloton UI에는 Kubernetes UI에 없는 Job·리소스 풀 화면이 있었습니다. 뒷단 저장소인 Apache Cassandra는 etcd보다 큰 용량을 제공해 이력을 30일 동안 보관했습니다. Kubernetes로 이전하면서 이 조회 기능과 보관 기간도 이어가야 했습니다.

팀은 etcd의 워크로드 상태를 Cassandra로 거의 실시간 복제했습니다. 기존 UI에 Kubernetes 클러스터를 표시하도록 바꾸고 이름도 Compute UI로 고쳤습니다. 사용자는 파드의 현재 상태와 실행 중이거나 종료된 파드의 로그, Job 상태와 연관 파드를 확인합니다. 리소스 풀별로 할당·예약 지표와 실행 중이거나 종료된 Job 목록도 조회합니다. 상태 이력을 Cassandra에 보관하면서 etcd의 저장 한계에 묶이지 않고 더 긴 보관 기간을 확보했습니다.

파일과 로그를 여는 경로도 마련했습니다. Browse Sandbox는 Kubernetes API 서버의 pod/exec API로 실행 중인 컨테이너의 파일시스템을 탐색하고, Kubelet의 컨테이너 로그 API로 Compute UI에 로그를 스트리밍합니다. 종료된 파드의 샌드박스 내용과 로그는 압축해 TerraBlob에 보관합니다. 파드가 종료된 뒤에도 이 내용을 다시 열어볼 수 있습니다.

{{% details title="원문의 설정값과 보관 기준" closed="true" %}}

| 항목 | 값 |
|---|---|
| 이전한 세션 수 | 3,500개 (최종 규모는 2,000명 넘는 사용자의 수천 개 세션) |
| Job parallelism | 1 |
| Job completions | 1,024 |
| restartPolicy | Never (backoffLimit은 높게, 퇴거 등 교란은 한도에서 제외) |
| hostNetwork | true |
| Peloton UI 이력 보관 | 30일 (Cassandra) |
| 로그 보관 | 종료된 파드의 샌드박스와 로그를 압축해 TerraBlob에 저장 |

{{% /details %}}
