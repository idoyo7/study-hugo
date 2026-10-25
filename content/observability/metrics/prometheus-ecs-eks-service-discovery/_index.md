---
title: "EKS와 ECS에서 Prometheus 타깃을 자동으로 찾는 구성"
linkTitle: "ECS·EKS 타깃 자동 발견"
description: "2026-10-25 기준 EKS는 Kubernetes API watch로, ECS는 ECS API 폴링으로 타깃을 찾는다. 태스크와 컨테이너 구성, 저장 위치에 맞춰 발견 방법과 수집기 배치를 고른다."
date: 2026-10-25
lastmod: 2026-10-26
weight: 7
url: "/monitoring/prometheus-ecs-eks-service-discovery/"
---

# EKS와 ECS에서 Prometheus 타깃을 자동으로 찾는 구성

{{< kpis >}}
{{< kpi label="네이티브 ECS SD 기본 갱신" value="60s" sub="watch가 아니라 폴링" >}}
{{< kpi label="ecs_observer 소스 기본 갱신" value="30s" sub="README 표는 10s" >}}
{{< kpi label="ECS 읽기 API 지속 한도" value="20 req/s" sub="계정·리전 공유, 버스트 50~100" tone="warn" >}}
{{< /kpis >}}

{{< basis "기준 2026-10-25" "Prometheus v3.15.1" "리전 ap-northeast-2" >}}

## 1. 타깃 목록은 실행 환경의 API에서 받는다

EKS의 타깃 목록은 Kubernetes API server에서, ECS의 태스크 목록은 ECS API에서 받습니다. Prometheus는 EKS에서는 변경 이벤트를 watch하고, ECS에서는 API를 폴링합니다. ECS의 기본 구성은 별도 등록 시스템 없이 ECS API를 읽는 방식입니다.

{{< flow src="_flow/0-overview.json" />}}

서비스 A·B·C·D의 태스크가 늘거나 교체되어도 IP를 직접 고칠 필요는 없습니다. service discovery(SD, 수집 대상 자동 발견)가 실행 환경에서 목록을 받아 갱신합니다. 네이티브 ECS SD의 기본 갱신 주기는 60초입니다.

먼저 A1~A4가 무엇인지 구분해야 합니다. awsvpc에서 A1~A4가 서비스 A의 태스크 복제본 넷이면 IP도 넷입니다. 한 태스크 안의 컨테이너 넷이라면 IP 하나를 공유하므로 포트로 구별해야 합니다. 수집할 포트 하나가 모든 태스크에 있는지, 컨테이너마다 다른 포트를 찾아야 하는지가 발견 방법을 결정합니다.

세부 근거와 나머지 설정 예시·도식은 [근거와 설정 예시 전체본]({{< relref "/observability/metrics/prometheus-ecs-eks-service-discovery/detail/index.md" >}})에 있습니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 조사 기준일은 2026-10-25이며 Prometheus v3.15.1(LTS 3.13), prometheus-operator v0.94.2, kube-prometheus-stack 92.13.1, ADOT v0.50.0, OTel Collector contrib v0.163.0, CloudWatch agent v1.300073.2, VictoriaMetrics vmagent v1.154.1을 봤습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| 태스크가 IP 단위 | awsvpc에서 태스크마다 ENI 하나와 사설 IPv4 하나. 멈추거나 축소되면 ENI 분리·삭제. Fargate는 항상 awsvpc | ECS 개발자 가이드(awsvpc, Fargate) | `✓` |
| 컨테이너 네트워크 공유 | 같은 태스크 컨테이너는 pause 컨테이너의 네임스페이스를 공유. awsvpc에서 hostPort는 containerPort와 같음 | ECS 개발자 가이드(awsvpc, 태스크 정의) | `✓` |
| LIST+WATCH | client-go ListWatch와 SharedInformer. 주기적 resync는 꺼져 있음(`resyncDisabled = 0`) | Prometheus 소스(Kubernetes SD) | `✓` |
| watch 부재와 폴링 | Prometheus ECS SD는 `refresh_interval` 기본 60s로 AWS API 폴링. ecs_observer README도 매번 전체를 가져오고 delta가 없다고 설명 | Prometheus 설정 문서, ecsobserver README | `✓` |

{{% /details %}}

## 2. EKS는 변경 이벤트를 받고 컨테이너 포트를 고른다

EKS에서는 `kubernetes_sd_configs`가 처음에 LIST로 전체 목록을 받고, 이후 WATCH의 add·update·delete 이벤트에 맞춰 타깃을 갱신합니다. 주기적 resync는 꺼져 있습니다. `pod` role에서는 pod 하나가 target group 하나이며, 그 안에 컨테이너 포트별 타깃이 들어갑니다.

{{< seq src="_flow/1-eks-watch-seq.json" />}}

watch를 쓴다고 새 pod의 첫 샘플이 즉시 생기지는 않습니다. podIP가 있어야 후보가 되고, scrape loop는 타깃 해시로 정한 오프셋에 맞춰 첫 수집을 시작합니다.

`pod` role은 컨테이너와 선언된 포트의 조합마다 타깃을 만듭니다. 앱이 8080·9090을, `istio-proxy`가 15090을 선언하면 같은 pod IP에 타깃 셋이 생깁니다. 포트 선언이 없는 컨테이너에는 pod IP만 가진 타깃 하나를 만듭니다. init 컨테이너도 포함되므로 필요 없는 init 컨테이너 포트는 `__meta_kubernetes_pod_container_init="true"`로 걸러낼 수 있습니다.

prometheus-operator를 써도 실제 발견 주체는 Prometheus입니다. operator는 ServiceMonitor·PodMonitor·ScrapeConfig를 일반 `scrape_configs`로 바꿔 Secret에 넣고 Prometheus가 reload하도록 합니다. 어떤 컨테이너 포트를 수집할지는 PodMonitor의 포트 선택이나 relabel 규칙으로 정합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| target group 단위 | pod 하나가 target group 하나, 안에 컨테이너 포트마다 타깃 | Prometheus 소스(Kubernetes SD) | `✓` |
| 첫 스크레이프 경로 | podIP 없으면 타깃 없음. discovery 백오프 최대 5초, scrape reloader 5초 ticker, 첫 스크레이프는 해시 오프셋 | Prometheus 소스(Kubernetes SD, scrape) | `✓` |
| role 여섯 가지 | node, service, pod, endpoints, endpointslice, ingress. pod는 containers와 initContainers를 모두 돌며 컨테이너 포트마다 타깃(init 타깃에 `container_init="true"`), 포트 없으면 pod IP 타깃 하나 | Prometheus 설정 문서, Prometheus 소스(Kubernetes SD) | `✓` |
| CRD 렌더링 | operator가 `scrape_configs`로 렌더링해 Secret에 넣음. PodMonitor는 `podMonitor/<ns>/<name>/<i>` job | operator 소스, operator 문서 | `✓` |

{{% /details %}}

## 3. ECS는 포트 하나면 네이티브 SD로 시작한다

태스크마다 정해진 포트 하나를 수집한다면 `aws_sd_configs`의 `role: ecs`를 쓰면 됩니다. Prometheus v3.8.0부터 지원하며, 태스크당 타깃 하나를 `<IP>:<설정한 port>`로 만듭니다. Prometheus가 `ListTasks`와 태그를 포함한 `DescribeTasks`로 목록을 다시 읽으므로 Kubernetes처럼 변경 이벤트를 받지는 않습니다.

{{< seq src="_flow/2-ecs-poll-seq.json" />}}

발견 주기와 scrape 간격을 더한 시간보다 짧게 실행되는 태스크는 수집을 놓칠 수 있다고 해석합니다. 발견 주기를 줄여도 Prometheus 내부의 갱신 대기는 남고, ECS API 호출량은 늘어납니다. ECS 읽기 API의 지속 한도는 카테고리별 20 req/s이며 계정·리전 안의 호출자가 공유하므로, HA 복제본과 샤드를 늘릴 때는 API 호출량도 계산해야 합니다.

다음 설정은 실행 상태가 RUNNING이고 `prometheus_scrape` 태그가 `"true"`인 태스크의 9090 포트를 수집합니다.

```yaml
scrape_configs:
  - job_name: ecs-tasks
    aws_sd_configs:
      - role: ecs
        region: ap-northeast-2
        port: 9090
        refresh_interval: 60s
    relabel_configs:
      - source_labels: [__meta_ecs_last_status]
        regex: RUNNING
        action: keep
      - source_labels: [__meta_ecs_tag_task_prometheus_scrape]
        regex: "true"
        action: keep
      - source_labels: [__meta_ecs_cluster]
        target_label: ecs_cluster
      - source_labels: [__meta_ecs_service]
        target_label: ecs_service
      - source_labels: [__meta_ecs_task_definition]
        regex: '.*:task-definition/([^:]+):\d+'
        target_label: task_definition_family
      - source_labels: [__meta_ecs_task_arn]
        target_label: task_arn
```

이 예시는 태스크 태그를 읽습니다. 서비스 태그를 수집 조건으로 쓰려면 태스크까지 전파되어야 하는데, 그 ECS 설정 이름은 확인하지 못했습니다. 중앙 수집기가 awsvpc 태스크에 접근하려면 태스크 ENI의 보안 그룹에서 수집기 보안 그룹의 메트릭 포트 인바운드를 허용해야 합니다.

IAM에는 `ecs:ListClusters`, `DescribeClusters`, `ListServices`, `DescribeServices`, `ListTasks`, `DescribeTasks`가 필요합니다. EC2 launch type이면 `DescribeContainerInstances`와 `ec2:DescribeInstances`, awsvpc 태스크의 공인 IP가 필요하면 `ec2:DescribeNetworkInterfaces`를 추가합니다.

A1~A4가 태스크 복제본이라면 위 job 하나가 서비스 A~D의 태스크를 모두 찾고, 태스크가 붙거나 떨어지면 다음 폴링에서 목록이 바뀝니다. 한 태스크의 컨테이너 넷이라면 네이티브 SD는 타깃을 하나만 만들므로 포트마다 job을 나눠야 합니다. 해당 포트가 없는 태스크는 `up=0`이 되므로 서비스 태그 규약으로 수집 대상을 거르는 편이 좋습니다.

{{< flow src="_flow/3-multi-container.json" />}}

Spring의 `/actuator/prometheus`와 Envoy의 `/stats/prometheus`처럼 경로와 포트가 서비스마다 다르면 docker label 규약을 쓰는 `ecs_observer`가 간결합니다. OpenTelemetry Collector의 이 확장은 ECS·EC2 API를 폴링해 컨테이너와 포트별 타깃을 file_sd 파일로 만듭니다. docker label로 포트와 경로를 고르고, bridge에서는 `networkBindings`의 동적 host port도 읽습니다. 네이티브 SD에는 컨테이너 이름·docker label·`networkBindings` 라벨이 없습니다.

{{< flow src="_flow/3-multi-container-observer.json" />}}

`ecs_observer`는 beta이며 `cluster_name`에 클러스터 하나만 받으므로 클러스터마다 수집기가 필요합니다. CloudWatch agent의 `sd_target_cluster`도 같습니다. 컨테이너 이름 라벨이나 bridge 동적 포트가 필요한 구성이라면 이 제약까지 포함해 수집기를 배치합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| 네이티브 ECS SD | v3.8.0에 추가("unified AWS service discovery for ec2, lightsail and ecs"). feature flag·experimental 표기 없음 | Prometheus 릴리스, Prometheus 설정 문서 | `✓` |
| 타깃 단위와 주소 | 태스크당 하나, `__address__`는 `IP:port`(awsvpc는 ENI private IP, bridge·host는 호스트 private IP). 컨테이너 이름·docker label·`networkBindings` 라벨 없음 | Prometheus 소스(ecs.go), Prometheus 설정 문서 | `✓` |
| IAM | List/Describe 6종과 DescribeContainerInstances, ec2:DescribeInstances, DescribeNetworkInterfaces. DescribeTaskDefinition 없음 | Prometheus 설정 문서 | `✓` |
| ecs_observer 설계 | 필터 3종, 컨테이너×포트 타깃, 결과 file_sd 파일, 클러스터 1개, 확장 stability beta | ecsobserver README | `✓` |
| API 한도 | 카테고리별 지속 20 req/s, 버스트 50~100. 계정·리전 전체가 버킷 공유. HA·샤드마다 호출 증가, AWS는 간격 확대, EventBridge, 캐시를 권고 | ECS 스로틀링 문서 | `✓` |
| 짧은 태스크 | 발견 주기 + scrape 간격보다 짧으면 놓친다는 해석 | 위 기본값의 조합 | `Σ` |

{{% /details %}}

## 4. 수집기 배치는 저장소와 함께 정한다

패턴 a는 중앙 Prometheus가 직접 수집하는 구성입니다. 태스크 정의에 수집기를 추가하지 않아도 되고, `up`과 scrape 실패를 한곳에서 확인할 수 있습니다. 한 대만 운영하다가 장애가 나면 모든 서비스의 수집과 그 서버의 알림 평가가 멈춥니다.

{{< flow src="_flow/2-ecs-native-pull.json" />}}

Fargate의 ECS 서비스에서 로컬 TSDB를 오래 유지하려면 저장 볼륨이 문제가 됩니다. 태스크에는 새 EBS 볼륨만 붙일 수 있고 서비스 태스크가 종료되면 삭제됩니다. Prometheus는 NFS와 AWS EFS도 지원하지 않습니다. 로컬 TSDB를 유지하려면 EC2에 직접 배치하고, Fargate에서는 `--agent`와 `remote_write`로 AMP 같은 외부 저장소에 보내는 편이 현실적입니다. agent에는 로컬 쿼리·규칙·알림 기능이 없습니다.

패턴 b는 태스크마다 사이드카를 두고 같은 태스크의 `localhost:9090`, `localhost:9113` 등을 수집하는 구성입니다. 발견 과정과 메트릭 포트의 외부 인바운드 규칙이 필요 없으며, 컨테이너 구분 라벨은 사이드카 설정에 직접 붙입니다. 발견 단계가 없어 폴링 주기보다 짧게 실행되는 태스크도 수집할 수 있습니다.

{{< flow src="_flow/2-ecs-sidecar.json" />}}

사이드카는 태스크마다 CPU·메모리를 배정해야 하고, 설정을 바꾸면 서비스의 태스크 정의도 재배포해야 합니다. 중앙에서 보는 `up`이 없어 태스크 전체가 사라지는 상황은 ECS 이벤트 같은 다른 신호로 보완해야 한다고 해석합니다. 종료 시 마지막 배치가 전송되는지는 확인하지 못했습니다. ECS는 SIGTERM 뒤 `stopTimeout`만큼 기다렸다가 강제 종료하며, 기본값은 30초이고 최대값은 120초입니다.

패턴 c는 클러스터에 전용 수집기 태스크를 두는 구성입니다. `ecs_observer`로 대상을 찾고 수집 설정을 한곳에서 바꿉니다. 태스크 수만큼 수집기를 늘리지 않아도 되지만, 수집기는 모든 대상 태스크 ENI에 접근할 수 있어야 합니다.

{{< flow src="_flow/2-ecs-observer.json" />}}

앱에서 OTLP로 보내는 패턴 d는 [전체본]({{< relref "/observability/metrics/prometheus-ecs-eks-service-discovery/detail/index.md" >}})에 있습니다.

패턴 e는 기존 EKS Prometheus를 재사용하는 구성입니다. ECS까지 네트워크가 이어져 있고 수집 여력이 있다면 저장소를 새로 마련하지 않고 대상을 확장할 수 있습니다. kube-prometheus-stack에서는 `additionalScrapeConfigs`에 ECS 설정을 넣습니다. 이 구성에서는 EKS 업그레이드나 Prometheus 파드 재스케줄이 ECS 수집에도 영향을 줄 수 있고, 메모리와 카디널리티 예산도 공유합니다. ECS SD의 region은 하나이므로 여러 리전을 수집하려면 리전마다 scrape job을 둡니다.

저장소 선택에서 Thanos나 VictoriaMetrics를 함께 고려한다면, 여러 클러스터에서 모으는 구성은 [여러 클러스터 메트릭 글]({{< relref "/observability/metrics/prometheus-vs-victoriametrics-multi-cluster/index.md" >}})에, Prometheus 보존이 끝나는 지점과 Thanos의 연결은 [Prometheus·Thanos 연동]({{< relref "/observability/metrics/prometheus-thanos/_index.md" >}})에 정리해 두었습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| Fargate EBS | 새 볼륨만 가능, 서비스 태스크의 볼륨은 종료 시 항상 삭제 | ECS 개발자 가이드(EBS) | `✓` |
| EFS | Prometheus가 NFS(EFS 포함) 비지원을 명시 | Prometheus 저장소 문서 | `✓` |
| agent 모드 | `--agent`, 로컬 쿼리·규칙·알림 없음, 원격 장애 시 약 2시간 버퍼 | Prometheus agent 문서 | `✓` |
| AMP의 ECS 예시 | prometheus receiver가 같은 태스크 엔드포인트를 정적으로 scrape, `awsecscontainermetrics`로 태스크 CPU·메모리 | AMP 사용자 가이드(ECS) | `✓` |
| 종료 시 flush | stopTimeout 기본 30초·최대 120초는 확인, 수집기가 종료 시 남은 WAL·배치를 비우는지는 미확인 | ECS 개발자 가이드(태스크 정의) | `?` |
| 패턴 e의 근거 | `role_arn`·`external_id`(3.12에서 ECS 추가), ScrapeConfig에 ECS role 없음 | Prometheus 소스(ecs.go), operator 소스 | `✓` |

{{% /details %}}

## 5. 기존 수집기와 컨테이너 조건으로 후보를 좁힌다

EKS에 Prometheus가 있다면 재사용할 수 있는지부터 확인합니다. ECS만 있다면 컨테이너 이름과 동적 포트가 필요한지, 저장소를 직접 운영할지가 선택을 좁힙니다. 아래 표는 앞의 사실을 조건별로 조합한 판단이며, 사례로 검증된 처방은 아닙니다.

| 조건 | 권하는 패턴 | 이유 |
|---|---|---|
| EKS에 Prometheus가 있고 ECS와 네트워크가 이어짐 | e | 저장·알림·대시보드가 이미 있음 |
| EKS 없음, ECS만, 컨테이너 이름 라벨 필요 | c의 ecs_observer(또는 CloudWatch agent 결과 파일) | 네이티브 SD에는 컨테이너 라벨이 없음 |
| Fargate 비중이 높고 저장소를 ECS 안에 두고 싶음 | 중앙은 agent 모드, 저장은 외부 | Fargate EBS 삭제, EFS 비지원 |
| EC2 launch type 중심, 비용 민감, 자체 운영 가능 | a | AMP 수집 단가 없음 |
| 태스크가 수십 개 이하이고 팀이 작음 | b | 발견과 보안 그룹을 신경 쓰지 않아도 됨 |

EC2 중심이어도 bridge 동적 포트를 쓰면 네이티브 SD만으로는 부족합니다. 컨테이너와 포트를 읽는 `ecs_observer`를 검토해야 합니다. 짧은 태스크 때문에 사이드카가 필요하더라도 모든 서비스를 같은 방식으로 바꿀 필요는 없습니다.

라벨과 HA 규약은 수집기를 늘리기 전에 정합니다. `last_status`·`desired_status`·`health_status`를 저장 라벨로 남기면 상태 변화도 시계열을 끊으므로, 상태는 keep 조건에만 쓰는 편이 좋습니다. Prometheus 자체는 HA 중복을 제거하지 않으며, AMP에 보내는 복제본은 `cluster`를 같게, `__replica__`를 다르게 설정해야 합니다. HA 묶음 이름과 ECS 클러스터를 나타내는 라벨이 같은 이름을 다투지 않도록 규약을 맞춥니다. AMP 중복 제거를 생략하면 중복 샘플도 과금됩니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| 상태 라벨 | `last_status` 등은 refresh마다 현재 값으로 채워짐. 라벨로 올리면 시계열이 끊긴다는 판단 | Prometheus 소스(ecs.go) | `Σ` |
| HA와 dedup | replica 라벨만 다르게 둠. AMP는 `cluster`와 `__replica__`로 중복 제거 | operator HA 문서, AMP 중복 제거 문서 | `✓` |
| AMP dedup | `cluster` 같게, `__replica__` 다르게. 리더가 30초 침묵하면 교체. 미설정 시 중복 과금. 추적 cluster는 워크스페이스당 500개 | AMP 중복 제거 문서, AMP HA FAQ, AMP 쿼터 | `✓` |

{{% /details %}}

## 부록 — Cloud Map DNS로도 찾을 수 있다

Cloud Map과 `dns_sd_configs`를 쓰면 IAM 없이 DNS로 주소를 받을 수 있습니다.
응답은 최대 8개여서 태스크가 많은 서비스에서는 일부가 빠질 수 있습니다.
CloudWatch 관리형 수집기는 공식 문서상 ECS 발견에 이 방식만 지원합니다. AMP 워크스페이스로 보내는 ECS 수집은 AMP 사용자 가이드가 EKS 전용으로 적고 있고, 2026-04 AWS 블로그가 Cloud Map DNS scraper 예시를 보여 줄 뿐입니다. 관리형 수집기를 쓰는 경우가 아니라면 Cloud Map 없이 ECS API로 구성하는 편이 단순합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| 응답 8개 제한 | MULTIVALUE는 건강한 레코드 최대 8개, WEIGHTED는 1개 | Route 53 문서, Cloud Map API 문서 | `✓` |
| 8개 제한의 영향 | 9개 이상 서비스에서 일부 누락 가능하다는 해석. 실측 안 함 | 위 문서의 조합 | `?` |
| CloudWatch managed collector의 ECS 발견·제약 | ECS는 `dns_sd_configs`만, `file_sd`·Consul 미지원, 최소 30s, 목적지 CloudWatch | CloudWatch 관리형 수집기 문서 | `✓` |
| AMP 워크스페이스로 보내는 ECS 수집 | 2026-04-08 블로그의 Cloud Map DNS scraper 예시. AMP 문서는 EKS 전용 | AWS 운영 블로그(2026-04) | `Ⓥ` |

{{% /details %}}

## 참고 자료

- Prometheus 설정 문서, 쿼리 문서(staleness), agent 문서, 저장소 문서, OTLP 가이드 — https://prometheus.io/docs/prometheus/latest/configuration/configuration/ , https://prometheus.io/docs/prometheus/latest/querying/basics/#staleness , https://prometheus.io/docs/prometheus/latest/prometheus_agent/ , https://prometheus.io/docs/prometheus/latest/storage/ , https://prometheus.io/docs/guides/opentelemetry/
- Prometheus 릴리스, CHANGELOG — https://github.com/prometheus/prometheus/releases/tag/v3.15.1 , https://github.com/prometheus/prometheus/releases/tag/v3.8.0 , https://github.com/prometheus/prometheus/blob/main/CHANGELOG.md
- Prometheus 소스(Kubernetes SD, discovery manager, scrape, ecs.go) — https://github.com/prometheus/prometheus/tree/v3.15.1/discovery/kubernetes , https://github.com/prometheus/prometheus/blob/v3.15.1/discovery/manager.go , https://github.com/prometheus/prometheus/blob/v3.15.1/scrape/manager.go , https://github.com/prometheus/prometheus/blob/v3.15.1/discovery/aws/ecs.go
- operator 문서, API 문서, 샤딩 문서, HA 문서 — https://prometheus-operator.dev/docs/getting-started/design/ , https://prometheus-operator.dev/docs/api-reference/api/ , https://prometheus-operator.dev/docs/platform/sharding/ , https://prometheus-operator.dev/docs/platform/high-availability/
- operator 소스, 릴리스, ScrapeConfig 타입 — https://github.com/prometheus-operator/prometheus-operator/blob/v0.94.2/pkg/prometheus/promcfg.go , https://github.com/prometheus-operator/prometheus-operator/releases/tag/v0.94.2 , https://github.com/prometheus-operator/prometheus-operator/blob/main/pkg/apis/monitoring/v1alpha1/scrapeconfig_types.go
- 차트 소스, 차트 values, 커뮤니티 차트 소스 — https://github.com/prometheus-community/helm-charts/blob/kube-prometheus-stack-92.13.1/charts/kube-prometheus-stack/Chart.yaml , https://github.com/prometheus-community/helm-charts/blob/kube-prometheus-stack-92.13.1/charts/kube-prometheus-stack/values.yaml , https://github.com/prometheus-community/helm-charts/blob/prometheus-29.38.1/charts/prometheus/values.yaml
- AMP 사용자 가이드, API 레퍼런스 — https://docs.aws.amazon.com/prometheus/latest/userguide/AMP-collector-how-to.html , https://docs.aws.amazon.com/prometheus/latest/APIReference/API_Source.html
- AMP 중복 제거 문서, HA FAQ, 쿼터, 수집 방식 문서 — https://docs.aws.amazon.com/prometheus/latest/userguide/AMP-ingest-dedupe.html , https://docs.aws.amazon.com/prometheus/latest/userguide/HA_FAQ.html , https://docs.aws.amazon.com/prometheus/latest/userguide/AMP_quotas.html , https://docs.aws.amazon.com/prometheus/latest/userguide/AMP-ingest-methods.html
- AMP 사용자 가이드(ECS), AMP 요금(Price List) — https://docs.aws.amazon.com/prometheus/latest/userguide/AMP-onboard-ingest-metrics-OpenTelemetry-ECS.html , https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonPrometheus/current/ap-northeast-2/index.json
- ECS 개발자 가이드(awsvpc, 태스크 정의, Fargate, 배포) — https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-networking-awsvpc.html , https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html , https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html , https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-ecs.html
- ECS 개발자 가이드(서비스 디스커버리, EBS, 애플리케이션 메트릭) — https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-discovery.html , https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ebs-volumes.html , https://docs.aws.amazon.com/AmazonECS/latest/developerguide/application-metrics-prometheus.html
- ECS API 레퍼런스(PortMapping), ECS 스로틀링 문서 — https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_PortMapping.html , https://docs.aws.amazon.com/AmazonECS/latest/APIReference/request-throttling.html
- Route 53 문서, Cloud Map API 문서 — https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-multivalue.html , https://docs.aws.amazon.com/cloud-map/latest/api/API_DnsConfig.html
- CloudWatch agent 문서, 관리형 수집기 문서, Prometheus-on-ECS 문서 — https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/ContainerInsights-Prometheus-Setup-autodiscovery-ecs.html , https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/managed-prometheus-collectors-scraper-configuration.html , https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Solution-Prometheus-On-ECS.html
- ecsobserver README, 소스 — https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.163.0/extension/observer/ecsobserver/README.md , https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.163.0/extension/observer/ecsobserver/config.go
- AWS 운영 블로그(2026-04) — https://aws.amazon.com/blogs/mt/simplifying-prometheus-metrics-collection-across-your-aws-infrastructure
