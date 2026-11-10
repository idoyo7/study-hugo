---
title: "중단 없이 Kubernetes로 옮긴 대화형 노트북 워크로드"
description: "우버가 Peloton에서 돌던 Data Science Workbench의 Jupyter·RStudio 세션 3,500개를 Kubernetes로 옮긴 과정을 요약합니다. 세션을 Job으로 모델링한 방식, Federator, NFS 마운트, 패키지 체크포인트 설계를 다룹니다."
date: 2026-11-10
weight: 8
---

# 중단 없이 Kubernetes로 옮긴 대화형 노트북 워크로드 (2025-05)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Migrating Large-Scale Interactive Compute Workloads to Kubernetes Without Disruption](https://www.uber.com/us/en/blog/migrating-large-scale-compute-workloads-to-kubernetes/)
- 매체 · 게시일: Uber Engineering Blog · 2025-05-08
- 저자: Sayan Pal(Senior Software Engineer, Data Platform), Rishabh Mishra(Senior Software Engineer, Compute Platform)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 배경과 마이그레이션 동기 {#background}

DSW(Data Science Workbench)는 응용 과학자, 데이터 과학자, ML 엔지니어, 운영 전문가가 웹에서 데이터 탐색, 분석, 모델 학습, 워크플로 스케줄링, 시각화, 협업을 하는 대화형 노트북 플랫폼입니다. 뒤에서는 메모리, 컴퓨트, GPU 구성이 제각각인 격리 컨테이너를 할당해 Jupyter와 RStudio를 제공합니다. 세션마다 Python 커널, PySpark, Sparkmagic 커널이 독립된 환경으로 붙고, 사용자는 환경에 패키지를 더 설치할 수 있습니다.

이 글은 Apache Mesos 기반 컨테이너 오케스트레이터 Peloton에서 Kubernetes로 대화형 세션 3,500개를 최소한의 중단으로 옮긴 이야기입니다. Kubernetes 마이그레이션 시리즈의 두 번째 글로, 앞 글은 공유 무상태 워크로드의 이전을 다뤘습니다. 우버는 배치, 무상태, 스토리지 워크로드를 차례로 Kubernetes로 모으는 중이고, 업계 표준 기술과 풍부한 내장 기능, 안정성을 얻는 것이 목표입니다.

우버의 인프라 원칙은 Crane과 Google Cloud 이전 프로젝트에서 정해졌습니다. 온프레미스와 클라우드를 벤더 종속 없이 오가야 하고, 존 증설과 인프라 관리는 동질적인 호스트로 자동화해야 하며, 온프레미스에서 클라우드로의 용량 이전은 단일 컨테이너 오케스트레이션 플랫폼에서 중앙 관리로 간단해야 합니다. DSW 세션은 세션 사이에 데이터를 남기려고 공용 NFS 마운트를 쓰는데, Peloton에서는 이를 전용 호스트 그룹의 하위 서비스가 맡았고 이 전용 호스트가 워크로드 이동성을 막았습니다.

## 이전을 어렵게 한 네 가지 {#challenges}

첫째는 대화형 워크로드의 모델링입니다. DSW 세션은 Kubernetes의 Job과 비슷하지만, Job은 비대화형이고 수명이 짧으며 다중 컨테이너를 전제로 합니다. DSW 세션은 대화형이고 수명이 길며 컨테이너가 하나입니다.

둘째는 효율입니다. Peloton에서 DSW는 존 단위 전용 클러스터에서 돌았기 때문에 존이나 클러스터가 죽으면 전체가 멈출 수 있었습니다. DSW 클러스터는 부하가 몰려 스케줄링이 지연되는데 다른 Peloton 클러스터는 한가한 불균형도 있었습니다. DSW 플랫폼이 전용 클러스터와 직접 맞물려 있어 클러스터를 폐기하거나 정비하고 새로 붙일 때마다 DSW 팀과 Compute 팀이 함께 움직여야 했습니다.

셋째는 NFS 마운트입니다. Kubernetes는 CSI 드라이버나 Kubelet 추가 패키지로 NFS를 지원하지만 개발과 유지 비용이 따릅니다.

넷째는 무중단 이전입니다. 사용자는 세션에 패키지를 직접 설치하는데, 오케스트레이터를 옮기려면 컨테이너를 재시작해야 해서 메모리 상태, 로컬 디스크 데이터, 설치한 패키지를 잃습니다. 생산성과 플랫폼 만족도에 큰 타격이 됩니다.

## 세션을 Kubernetes Job으로 모델링 {#job-modeling}

CRD로 세션을 정의하면 오래 사는 컨테이너의 파드 동작을 완전히 통제할 수 있지만 CRD를 유지하기가 부담스럽습니다. 기존 Kubernetes Federation이 Job 인터페이스를 지원해 이전 속도도 빠르다는 점을 들어, Job을 일부 수정해 쓰기로 했습니다.

- parallelism은 1입니다. 세션 하나가 Job 하나라서 파드도 하나만 돕니다.
- completions는 1,024로 큰 값을 줍니다. 세션은 끝나지 않아 종료 코드 0으로 성공을 선언할 일이 없습니다.
- restartPolicy는 Never입니다. 파드가 실패하면 새 파드로 교체합니다. OnFailure는 같은 파드에서 컨테이너를 다시 띄워 문제가 됩니다. backoffLimit도 크게 올려, 퇴거 같은 Kubernetes 쪽 교란이 한도를 깎지 않도록 이런 실패는 무시하게 설정했습니다.
- 네트워킹은 동적 포트 할당과 Compute 팀의 서비스 메시, hostNetwork: true로 서비스 간 통신을 엽니다.
- 소유권별 시크릿과 SPIRE 신원을 쓰도록 볼륨을 추가로 마운트합니다.

## Federator로 얻은 효율 {#federation}

우버 배치 컴퓨트의 페더레이션 계층 Federator는 Kubernetes 배치 클러스터 위의 추상화입니다. Peloton 시절에는 전용 클러스터에 직접 작업을 던졌지만, 이제 DSW는 Federator와만 이야기하고 Federator가 아래 Kubernetes 클러스터와 소통합니다.

효과는 세 가지입니다. 리전 서비스인 Federator는 여러 존의 클러스터를 계속 폴링해 상태를 감시하므로 클러스터나 존이 무너져도 리전의 DSW 워크로드가 통째로 멈추지 않습니다. 들어오는 워크로드마다 자원 여유와 수요를 보고 최적 클러스터를 고르는 알고리즘이 부하를 고르게 나눠 SLA와 스케줄링 대기 시간이 나아집니다. 그리고 Kubernetes 클러스터를 DSW 팀 개입 없이 리전에 붙이고 뗄 수 있어, 폐기·프로비저닝·시크릿 교체·정비 때의 운영 부담이 줄었습니다.

## NFS 마운트와 패키지 체크포인트 {#nfs-and-checkpoint}

Kubernetes가 CSI 드라이버와 플러그인으로 NFS를 지원해도, 우버의 초기 Kubernetes 배포에서는 그런 설치가 허용되지 않았습니다. 그래서 기존 방식을 유지하되 전용 호스트 그룹은 없애고, Kubernetes 플릿 전체에 호스트 단위 단일 마운트를 두었습니다.

Docker 체크포인트 기능과 Kubernetes 볼륨 스냅샷도 살펴봤지만 쓸 수 없거나 성능 요구에 맞지 않았습니다. 사용자의 가장 큰 불만이 재시작할 때마다 개발 환경을 다시 꾸리는 일이라는 점에 착안해, 설치된 패키지를 체크포인트하기로 했습니다. 설치 경로는 pip, poetry, R 도구 등 여럿이라 패키지 설치 디렉터리를 감시하는 방식을 택했습니다. 새로운 방법으로 inotify 이벤트를 디바운스해 설치와 삭제를 추적하고 그 기록을 NFS에 저장합니다. 세션이 다시 뜨면 부트스트랩 단계에서 빠진 패키지를 자동으로 재설치합니다. 사용자는 메모리 상태만 잃고 노트북과 패키지는 그대로입니다.

처음에는 환경 전체를 NFS에 두려 했습니다. 하지만 Python이든 R이든 환경은 작은 파일이 아주 많아, 부트스트랩이 느리고 IOPS를 크게 먹었습니다(원문 Figure 6의 NFS 지표). 그래서 환경 전체 대신 세션 중에 추가로 설치한 패키지의 목록만 보관하는 쪽으로 돌아섰습니다. Peloton에서 돌던 세션에 알리고, 체크포인트하고, 끄고, Kubernetes에서 다시 띄우는 새 재시작 API도 설계했습니다.

## 메타데이터 UI와 샌드박스 {#ui-and-sandbox}

Peloton UI에는 Job과 리소스 풀 뷰처럼 Kubernetes UI에 없는 기능이 있고, 뒷단 Apache Cassandra가 etcd보다 용량이 커서 30일 이력 보관도 확장돼 있었습니다. DSW 사용자는 Job 정보를 이 UI로 봤습니다. 팀은 etcd의 워크로드 상태를 Cassandra로 거의 실시간 복제해, 같은 UI를 Compute UI로 이름만 바꿔 Kubernetes에서도 쓰게 했습니다. 개별 파드의 현재 상태와 실행 중이거나 종료된 파드의 로그, Job 상태와 연관 파드 목록, 리소스 풀의 할당·예약 지표와 풀 안의 Job 목록을 볼 수 있습니다. 상태를 Cassandra에 두자 etcd의 저장 한계도 넘어서 Peloton과 같은 관측성을 유지했습니다.

로그와 샌드박스 탐색도 달라졌습니다. Kubernetes는 컨테이너 로그가 일시적이고 과거 접근이 제한적입니다. 그래서 Browse Sandbox 기능을 넣어, Kubernetes API 서버의 pod/exec API로 실행 중 파일시스템을 탐색하고 Kubelet의 컨테이너 로그 API로 Compute UI에 로그를 스트리밍합니다. 종료된 파드는 샌드박스 내용과 로그를 압축해 TerraBlob에 올려 두고 나중에 열어 봅니다.

## 결과와 남은 과제 {#impact}

DSW는 우버에서 가장 먼저 Kubernetes로 완전히 옮겨 간 배치 워크로드 중 하나입니다. 팀 간 자원 공유, 클라우드로 가는 쉬운 길, 비용 절감이 열렸습니다. 사용자 2,000명 넘는 수천 개의 대화형 세션을 큰 중단이나 불만 없이 옮겼습니다.

Kubernetes가 성숙하면 CSI 드라이버나 Kubelet의 nfs-common Debian 패키지로 NFS를 일급 지원할 계획입니다. 그때가 되면 워크로드가 진짜로 이식 가능해집니다.

{{% details title="원문의 주요 설정값" closed="true" %}}

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
