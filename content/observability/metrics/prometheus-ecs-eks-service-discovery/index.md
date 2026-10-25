---
title: "EKS와 ECS에서 Prometheus 타깃을 자동으로 찾는 구성"
linkTitle: "ECS·EKS 타깃 자동 발견"
description: "2026-10-25 기준 EKS는 API server watch로, ECS는 ECS API 폴링으로 바뀌는 타깃을 찾는다. 컨테이너와 포트 구성, 저장 위치에 따라 발견 방법과 수집기 배치를 고르며 사이드카로 발견 없이 수집할 수도 있다."
date: 2026-10-25
lastmod: 2026-10-25
weight: 7
url: "/monitoring/prometheus-ecs-eks-service-discovery/"
---

# EKS와 ECS에서 Prometheus 타깃을 자동으로 찾는 구성

{{< kpis >}}
{{< kpi label="네이티브 ECS SD 기본 갱신" value="60s" sub="watch가 아니라 폴링" >}}
{{< kpi label="ecs_observer 소스 기본 갱신" value="30s" sub="README 표는 10s" >}}
{{< kpi label="ECS 읽기 API 지속 한도" value="20 req/s" sub="계정·리전 공유, 버스트 50~100" tone="warn" >}}
{{< kpi label="managed collector 최소 간격" value="30s" sub="서브넷 2개 이상 필요" >}}
{{< /kpis >}}

{{< basis "기준 2026-10-25" "Prometheus v3.15.1" "리전 ap-northeast-2" >}}

## 1. IP를 적어 두는 대신 실행 중인 대상을 따라간다

ECS에 서비스 A·B·C·D가 있고, 서비스 A의 태스크 A1~A4와 서비스 B의 B1·B2가 실행 중이라고 해 보겠습니다. 부하가 줄면 A3와 A4가 사라지고, 배포하면 A1~A4가 새 태스크로 바뀝니다. Prometheus 설정에 이 IP를 일일이 적는 대신 실행 중인 대상의 목록을 받아야 합니다. 이 역할이 service discovery(SD, 수집 대상 자동 발견)입니다.

EKS에서는 Prometheus가 Kubernetes API server의 변경 이벤트를 구독합니다. ECS에서는 ECS API를 주기적으로 조회합니다. 태스크마다 수집기 사이드카를 붙여 같은 태스크의 엔드포인트만 읽는다면 발견 과정 없이 수집할 수도 있습니다.

{{< flow src="_flow/0-overview.json" />}}

"A1~A4"는 두 가지로 읽을 수 있고, 어느 쪽이냐에 따라 필요한 목록이 다릅니다. awsvpc 모드에서 A1~A4가 서비스 A의 태스크 복제본 넷이면 IP도 넷입니다. 한 태스크 안의 컨테이너 넷을 뜻한다면 IP는 하나이고 포트로 구별해야 합니다. 복제본은 어느 발견 방법이든 같게 처리하지만, 컨테이너 넷은 방법에 따라 결과가 다릅니다. ECS와 Kubernetes의 개념을 수집 관점에서 대응시키면 다음과 같습니다.

| ECS | Kubernetes | 수집 관점의 차이 |
|---|---|---|
| Cluster | Cluster | API watch 없음 |
| Task definition | PodSpec | 등록할 때마다 revision 증가 |
| Service | Deployment + Service 일부 | 고정 VIP와 Endpoints 객체 없음 |
| Task | Pod | IP가 붙는 단위 |
| Container | Container | 같은 태스크 안은 IP와 localhost 공유 |
| rolling deployment | rolling update | 최대 비율 200%면 타깃 일시 두 배 |
| docker label | annotation 관례 | 네이티브 SD는 읽지 않음 |

ECS 서비스는 원하는 태스크 수를 유지하는 스케줄러입니다. Kubernetes Service처럼 고정 주소나 Endpoints 객체를 만들지는 않으므로, 안정적인 이름이 필요하면 Cloud Map 서비스 디스커버리나 Service Connect를 따로 켭니다. awsvpc 태스크에는 ENI(네트워크 인터페이스)와 사설 IPv4가 하나씩 붙고, 태스크가 멈추면 ENI도 사라집니다.

여기서는 Prometheus를 운영한다는 전제로 구성을 고릅니다. HA(고가용성)와 샤딩을 포함한 VictoriaMetrics 비교는 [Prometheus와 VictoriaMetrics 비교 글]({{< relref "/observability/metrics/prometheus-vs-victoriametrics/index.md" >}})에 있습니다. vmagent에는 ECS 전용 SD가 없어 `dns_sd`·`file_sd`·`http_sd`를 사용해야 합니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 조사 기준일은 2026-10-25이며 Prometheus v3.15.1(LTS 3.13), prometheus-operator v0.94.2, kube-prometheus-stack 92.13.1, ADOT v0.50.0, OTel Collector contrib v0.163.0, CloudWatch agent v1.300073.2, VictoriaMetrics vmagent v1.154.1을 봤습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| Prometheus 버전 | v3.15.1(2026-10-21). LTS는 3.13 계열로 2027-07-31까지 지원 | Prometheus 릴리스 | `✓` |
| 운영 도구 버전 | prometheus-operator v0.94.2(2026-10-23), kube-prometheus-stack 92.13.1(2026-10-24) | operator 릴리스, 차트 소스 | `✓` |
| AWS 쪽 버전 | ADOT v0.50.0(2026-08-31, upstream v0.158.0 기반), OTel contrib v0.163.0(2026-10-14), CloudWatch agent v1.300073.2(2026-10-21) | 각 릴리스 페이지 | `✓` |
| vmagent | v1.154.1. ECS 전용 SD 디렉터리 없음, 요청 이슈 #10610 열려 있음 | VictoriaMetrics 소스·이슈 | `✓` |
| 태스크가 IP 단위 | awsvpc에서 태스크마다 ENI 하나와 사설 IPv4 하나. 멈추거나 축소되면 ENI 분리·삭제. Fargate는 항상 awsvpc | ECS 개발자 가이드(awsvpc, Fargate) | `✓` |
| 컨테이너 네트워크 공유 | 같은 태스크 컨테이너는 pause 컨테이너의 네임스페이스를 공유. awsvpc에서 hostPort는 containerPort와 같음 | ECS 개발자 가이드(awsvpc, 태스크 정의) | `✓` |
| 배포 중 두 배 | `maximumPercent: 200`이면 desired 4개일 때 새 태스크 4개를 먼저 띄운 뒤 옛 태스크를 멈출 수 있음 | ECS 개발자 가이드(배포) | `✓` |
| 고정 주소 없음 | ECS service에 VIP나 Endpoints 객체가 없고, 이름은 Cloud Map이나 Service Connect로 따로 만듦 | ECS 개발자 가이드(서비스 디스커버리) | `✓` |
| 대응표 | Kubernetes 쪽과의 1:1 대응은 두 문서의 서술을 맞춰 본 해석 | 위 문서들 | `Σ` |

{{% /details %}}

## 2. EKS는 변경 이벤트를 받아 수집할 포트를 고른다

EKS에서는 `kubernetes_sd_configs`가 타깃 목록을 유지합니다. Prometheus 소스의 client-go ListWatch와 SharedInformer가 처음에 LIST로 전체 목록을 받고, 이후 WATCH의 add·update·delete 이벤트마다 해당 객체의 target group을 다시 만듭니다. 주기적 resync는 꺼져 있습니다. pod 하나가 target group 하나이며, 그 안에 컨테이너 포트별 타깃이 들어갑니다.

새 pod의 첫 샘플은 API 이벤트가 전달된 직후에 바로 생기지는 않습니다. podIP가 있어야 후보가 되고, 새 scrape loop는 타깃 해시로 정한 오프셋에 맞춰 첫 스크레이프(메트릭 엔드포인트 읽기)를 시작합니다. 다음 도식은 이 대기 구간을 보여 줍니다.

{{< seq src="_flow/1-eks-watch-seq.json" />}}

pod가 사라지면 scrape pool은 해당 loop를 멈추고 이전 시계열을 곧바로 stale(더는 유효하지 않은 시계열)로 표시합니다. 그래서 쿼리는 기본 lookback 5분을 기다리지 않고 바로 끊깁니다.

### 앱 메트릭에는 pod나 endpointslice를 쓴다

SD의 role은 타깃을 만드는 단위를 정합니다.

| role | 타깃 단위 | 대표 메타 라벨 |
|---|---|---|
| `node` | 노드마다 하나 | `__meta_kubernetes_node_name` |
| `service` | 서비스 포트마다 하나 | `__meta_kubernetes_service_name` |
| `pod` | 컨테이너 포트마다 하나 | `__meta_kubernetes_pod_container_name` |
| `endpoints` | endpoint 주소의 포트마다 하나 | `__meta_kubernetes_endpoint_ready` |
| `endpointslice` | endpoint 주소마다 하나 | `__meta_kubernetes_endpointslice_name` |
| `ingress` | ingress path마다 하나 | `__meta_kubernetes_ingress_name` |

`service`와 `ingress`는 블랙박스 모니터링용이고, `node`는 kubelet 같은 노드 단위 타깃용입니다. 앱의 `/metrics`에는 `pod`나 `endpointslice`를 씁니다. `pod` role은 `spec.containers`와 `spec.initContainers`를 모두 읽습니다. 선언된 포트마다 타깃을 만들고, 포트 선언이 없는 컨테이너에는 pod IP만 가진 타깃 하나를 만듭니다.

예를 들어 앱이 8080·9090을, `istio-proxy`가 15090을 선언했다면 같은 pod IP를 쓰는 타깃 셋이 생깁니다. `__meta_kubernetes_pod_container_name`, `__meta_kubernetes_pod_container_port_name`, `__meta_kubernetes_pod_container_port_number`로 구분할 수 있습니다. init 컨테이너 타깃에는 `__meta_kubernetes_pod_container_init="true"`가 붙으므로, 필요 없는 init 컨테이너 포트는 이 라벨로 걸러낼 수 있습니다.

Kubernetes 1.33부터 Endpoints API가 deprecated되면서 Prometheus 문서도 `endpointslice`를 권합니다. prometheus-operator의 `serviceDiscoveryRole`은 빈 값이면 여전히 Endpoints를 쓰고, kube-prometheus-stack 92.13.1의 기본값도 빈 문자열입니다. 새 구성에서는 `EndpointSlice`를 명시하는 편이 낫습니다.

### 어노테이션이나 Monitor가 수집 대상을 정한다

relabel은 SD가 찾은 후보를 걸러 내고 라벨을 붙이는 단계입니다. `prometheus.io/scrape: "true"`는 Prometheus가 자동으로 해석하는 표준이 아닙니다. Kubernetes SD 소스에는 `prometheus.io/`를 읽는 코드가 없고, 어노테이션은 `__meta_kubernetes_pod_annotation_prometheus_io_scrape` 같은 메타 라벨로 나올 뿐이어서 keep과 replace 규칙을 직접 써야 의미가 생깁니다. 이 관례가 퍼진 경로는 커뮤니티 `prometheus` Helm 차트이고, kube-prometheus-stack의 values에는 이 처리가 없습니다. Prometheus 공식 예제도 2018년 커밋 이후 이 설명을 지웠고, 현재는 `example.io/` 접두어를 씁니다.

prometheus-operator를 쓰면 ServiceMonitor·PodMonitor·ScrapeConfig라는 CRD로 수집 설정을 선언합니다. operator가 이를 일반 `scrape_configs`로 렌더링해 Secret에 넣고 Prometheus가 reload합니다. 실제 발견은 계속 Prometheus의 `kubernetes_sd_configs`가 담당합니다.

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: service-a
  namespace: team-a
  labels:
    release: kube-prometheus-stack
spec:
  selector:
    matchLabels:
      app: service-a
  namespaceSelector:
    matchNames: [team-a]
  podMetricsEndpoints:
    - port: metrics
      path: /metrics
      interval: 30s
```

이 PodMonitor는 소스 기준으로 `job_name: podMonitor/team-a/service-a/0`, `role: pod`, `namespaces.names: [team-a]`, `app=service-a` keep, `container_port_name=metrics` keep으로 바뀝니다. 기본으로 켜진 `filterRunning`은 `Failed`·`Succeeded` pod를 drop합니다. pod 안에서 `metrics` 포트를 선언한 컨테이너가 하나라면 수집 타깃도 하나입니다. kube-prometheus-stack은 셀렉터가 비었을 때 `release: <Helm 릴리스 이름>`을 기본 조건으로 넣으므로, `release` 라벨이 없는 ServiceMonitor와 PodMonitor는 오류 없이 조용히 무시됩니다.

### 관리형 수집과 Fargate의 별도 제약

AMP(Amazon Managed Service for Prometheus) managed collector는 서브넷마다 ENI를 만들고 클러스터 내부 타깃을 직접 수집한 뒤, VPC 엔드포인트를 거쳐 AMP로 `remote_write`합니다. 클러스터에 에이전트를 설치하지 않으며, 문서상 EC2와 Fargate를 모두 지원합니다. 허용 섹션은 `global`, `scrape_config`, `static_config`, `relabel_config`, `metric_relabel_configs`, `kubernetes_sd_config`뿐입니다. 이 목록에 없으므로 operator의 CRD는 읽지 못한다고 해석합니다.

scrape interval은 30초 이상, 응답은 50MB 이하이며 scraper당 엔드포인트는 30,000개까지입니다. 인증 모드가 `API`나 `API_AND_CONFIG_MAP`이면 access entry가 자동으로 만들어지지만, 자동 정책에는 `endpointslices`가 없습니다. 이 정책 그대로 `endpointslice` role을 쓰면 권한 부족으로 실패할 가능성이 높으며, 실제 실패 여부는 확인하지 못했습니다.

EKS Fargate에서는 DaemonSet·privileged 컨테이너·`HostPort`·`HostNetwork`·IMDS를 사용할 수 없습니다. node-exporter 같은 노드 에이전트 배치는 성립하지 않고, AWS Containers 블로그는 cAdvisor 지표를 API server proxy로 가져오는 방법을 설명합니다. Fargate pod에서는 Pod Identity도 사용할 수 없어 Prometheus나 agent의 AWS 인증에는 IRSA를 씁니다. AMP 전송 설정은 다음과 같습니다.

```yaml
remote_write:
  - url: https://aps-workspaces.ap-northeast-2.amazonaws.com/workspaces/ws-xxxx/api/v1/remote_write
    sigv4:
      region: ap-northeast-2
```

`sigv4`에는 리전만 적고 자격 증명은 AWS SDK 기본 체인에서 받습니다. EC2 노드의 Prometheus는 IRSA와 Pod Identity를 모두 쓸 수 있다고 해석하지만, Prometheus 문서에 Pod Identity가 적혀 있지는 않습니다. Fargate 앱 pod의 `/metrics`는 pod IP가 VPC IP이므로 `pod` role로 발견해 긁을 수 있다고 보는 것이 합리적이며, 이때도 보안 그룹 허용은 필요합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| LIST+WATCH | client-go ListWatch와 SharedInformer. 주기적 resync는 꺼져 있음(`resyncDisabled = 0`) | Prometheus 소스(Kubernetes SD) | `✓` |
| target group 단위 | pod 하나가 target group 하나, 안에 컨테이너 포트마다 타깃 | Prometheus 소스(Kubernetes SD) | `✓` |
| 첫 스크레이프 경로 | podIP 없으면 타깃 없음. discovery 백오프 최대 5초, scrape reloader 5초 ticker, 첫 스크레이프는 해시 오프셋 | Prometheus 소스(Kubernetes SD, scrape) | `✓` |
| 첫 샘플까지의 상한 | watch 전파 + 5초 + 5초 + scrape interval 하나. 코드 경로 합산이며 실측 아님. watch 전파 시간의 공식 수치는 찾지 못함 | 위 소스의 합산 | `?` |
| stale 처리 | 타깃이 사라지면 해당 시계열을 곧바로 stale로 표시 | Prometheus 쿼리 문서, Prometheus 소스(scrape) | `✓` |
| role 여섯 가지 | node, service, pod, endpoints, endpointslice, ingress. pod는 containers와 initContainers를 모두 돌며 컨테이너 포트마다 타깃(init 타깃에 `container_init="true"`), 포트 없으면 pod IP 타깃 하나 | Prometheus 설정 문서, Prometheus 소스(Kubernetes SD) | `✓` |
| init 타깃 걸러내기 | 코드가 initContainers를 무조건 포함하는 데 근거한 권고 | Prometheus 소스(Kubernetes SD) | `Σ` |
| Endpoints 폐기 | Kubernetes 1.33부터 deprecated, 문서가 `endpointslice` 권고 | Kubernetes 블로그, Prometheus 설정 문서 | `✓` |
| operator 기본값 | `serviceDiscoveryRole` 빈 값이면 Endpoints. 차트 92.13.1 기본값은 빈 문자열 | operator API 문서, 차트 values | `✓` |
| prometheus.io 어노테이션 | SD 코드에 해석 로직 없음. 2018 커밋에서 예시를 주석 처리하고 설명을 지움. 지금 예제는 `example.io/` 사용 | Prometheus 소스(Kubernetes SD), Prometheus 커밋(2018) | `✓` |
| 관례의 전파 경로 | 커뮤니티 `prometheus` 차트 29.38.1의 `kubernetes-pods` job이 해석. kube-prometheus-stack 92.13.1에는 없음 | 커뮤니티 차트 소스, 차트 values | `✓` |
| CRD 렌더링 | operator가 `scrape_configs`로 렌더링해 Secret에 넣음. PodMonitor는 `podMonitor/<ns>/<name>/<i>` job | operator 소스, operator 문서 | `✓` |
| release 라벨 | 셀렉터가 비면 차트 템플릿이 `release: <릴리스 이름>`을 넣음 | 차트 values | `✓` |
| AMP managed collector | 서브넷 ENI, 허용 섹션 6종, 30초 이상, 50MB, scraper당 30,000개. operator CRD 미지원은 허용 섹션 목록에서 나온 해석 | AMP 사용자 가이드 | `✓` |
| access entry 권한 | 자동 정책에 `endpointslices`가 없음. 실제 실패 여부는 확인 못함 | AMP 사용자 가이드 | `?` |
| Fargate 제약 | DaemonSet, privileged, HostPort, HostNetwork, IMDS 없음. Pod Identity 불가, IRSA 사용 | EKS 사용자 가이드 | `✓` |
| Fargate의 cAdvisor | pod가 워커 노드 kubelet에 직접 닿지 못해 API server proxy 사용 | AWS Containers 블로그(2022) | `Ⓥ` |
| remote_write 인증 | `sigv4: {region}`, 자격 증명은 SDK 기본 체인. EC2 노드에서 IRSA·Pod Identity 모두 가능하다는 것은 SDK 지원에서 나온 해석. AMP URL은 `.../workspaces/<id>/api/v1/remote_write` | Prometheus 설정 문서, EKS 사용자 가이드, AMP 사용자 가이드 | `Σ` |
| Fargate 앱 pod 수집 | pod IP가 VPC IP라서 pod role로 수집 가능하다는 해석 | EKS 사용자 가이드 | `Σ` |

{{% /details %}}

## 3. ECS에서는 태스크와 컨테이너 중 무엇을 찾을지 먼저 정한다

ECS의 발견 방법은 필요한 IP와 포트를 얻을 수 있는지부터 고릅니다. 태스크마다 정해진 포트 하나를 수집한다면 Prometheus의 네이티브 ECS SD를 쓸 수 있습니다. 컨테이너 이름이나 docker label로 대상을 골라야 한다면 ecs_observer나 CloudWatch agent를 봅니다. bridge의 동적 포트는 이 둘로 풀 수 있습니다.

주소가 붙는 위치는 네트워크 모드에 따라 다릅니다.

| 모드 | launch type | 태스크가 받는 주소 | 포트 |
|---|---|---|---|
| awsvpc | Fargate(필수), EC2 | 태스크 ENI의 private IP | containerPort와 같음 |
| bridge | EC2 | 호스트 IP | 동적 또는 고정 host port |
| host | EC2 | 호스트 IP | containerPort와 같음 |

awsvpc에서는 같은 태스크의 컨테이너가 pause 컨테이너의 네트워크 네임스페이스를 공유합니다. localhost로 서로 호출할 수 있고, 포트는 태스크 안에서 겹치면 안 됩니다. bridge에서 host port를 생략하면 ephemeral 범위에서 자동 할당되며, 결과는 `DescribeTasks`의 `networkBindings`에 나옵니다. 커널 값이 없을 때 Linux의 범위는 49153~65535입니다. 이 포트를 읽지 못하는 발견 방법은 bridge 태스크의 주소를 완성할 수 없습니다.

Fargate는 awsvpc만 지원하며 `privileged`와 호스트 접근을 허용하지 않습니다. `ec2_sd`나 호스트 단위 exporter인 node_exporter·cAdvisor를 배치하는 방식은 여기에 맞지 않습니다. 중앙 수집기가 awsvpc 태스크에 접근하려면 태스크 ENI의 보안 그룹에서 수집기 보안 그룹의 메트릭 포트 인바운드를 허용해야 합니다. 같은 보안 그룹을 쓰면 self-referencing 규칙을 둡니다.

### 정해진 포트 하나라면 네이티브 ECS SD

Prometheus v3.8.0부터 `aws_sd_configs`의 `role: ecs`를 사용할 수 있습니다. 문서에 experimental 표시가 없고 feature flag도 필요 없습니다. 3.12의 `external_id`, 3.15.0의 standalone 태스크 패닉 수정처럼 이후 버전에서도 변경이 이어졌습니다. CloudWatch 문서에 남은 "ECS에는 내장 SD가 없다"는 설명은 3.8.0 이전의 내용입니다.

Prometheus는 `ListTasks`와 태그를 포함한 `DescribeTasks`로 태스크를 읽습니다. `task.Group`의 `service:` 접두사로 서비스 소속을 판별하며, 독립 실행 태스크도 타깃이 됩니다. 태스크당 타깃 하나를 만들고 `__address__`를 `<IP>:<설정한 port>`로 채웁니다. 컨테이너 이름·포트·docker label·`networkBindings`는 라벨로 나오지 않습니다. IP는 awsvpc면 태스크 ENI의 private IP, bridge와 host면 EC2 호스트의 private IP입니다. networkBindings가 라벨로 나오지 않으니 bridge의 동적 포트는 이 방법만으로 맞출 수 없습니다.

주요 `__meta_ecs_*` 라벨은 `cluster`, `service`, `task_arn`, `task_definition`(ARN), `availability_zone`, `launch_type`, `last_status`, `health_status`와 클러스터·서비스·태스크·EC2 태그(`tag_task_<k>` 등)입니다. `task_definition_family`와 `container_name`은 없으므로 family는 ARN에서 추출합니다.

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

이 예시는 실행 상태와 태그로 수집 대상을 고릅니다. `last_status`는 keep 조건에만 쓰고 저장 라벨로 남기지 않습니다. 태그로 opt-in하려면 서비스의 태그가 태스크로 전파되어야 하는데, 그 ECS 설정 이름은 확인하지 못했습니다.

IAM에는 `ecs:ListClusters`, `DescribeClusters`, `ListServices`, `DescribeServices`, `ListTasks`, `DescribeTasks`가 필요합니다. EC2 launch type이면 `DescribeContainerInstances`와 `ec2:DescribeInstances`, awsvpc 태스크의 공인 IP가 필요하면 `ec2:DescribeNetworkInterfaces`를 추가합니다. `ecs:DescribeTaskDefinition`은 필요 권한 목록에 없고 소스도 호출하지 않습니다. 소스에는 `ecs_sd_configs`라는 별도 등록도 있지만 설정 예시는 문서의 `aws_sd_configs`를 따릅니다.

### 컨테이너와 동적 포트가 필요하면 ecs_observer

OpenTelemetry Collector contrib의 `ecs_observer`와 CloudWatch agent의 ECS 서비스 디스커버리는 ECS·EC2 API를 폴링하고 결과를 file_sd 형식 파일로 만듭니다. 서비스 이름 패턴, task definition ARN 패턴, docker label(`port_label`, `metrics_path_label`, `job_name_label`)로 대상을 고릅니다. 컨테이너와 포트의 조합마다 타깃을 만들며, bridge에서는 `networkBindings`의 host port를 읽습니다.

`ecs_observer`는 contrib 기준 beta이며 ADOT v0.50.0에 포함됩니다. `cluster_name`은 클러스터 하나만 받습니다. CloudWatch agent의 `sd_target_cluster`도 같으므로 클러스터마다 수집기가 필요합니다. `refresh_interval` 기본값은 README 표에 10초, 소스의 `config.go`에는 30초로 적혀 있어 아래 예시는 소스의 30초를 씁니다. 라벨 이름도 README 표와 소스가 달라 소스 상수를 따랐습니다.

```yaml
extensions:
  ecs_observer:
    cluster_name: app
    cluster_region: ap-northeast-2
    refresh_interval: 30s
    result_file: /etc/ecs_sd_targets.yaml
    docker_labels:
      - port_label: ECS_PROMETHEUS_EXPORTER_PORT
        metrics_path_label: ECS_PROMETHEUS_METRICS_PATH
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: ecs
          file_sd_configs:
            - files: [/etc/ecs_sd_targets.yaml]
          relabel_configs:
            - source_labels: [__meta_ecs_service_name]
              target_label: ecs_service
            - source_labels: [__meta_ecs_container_name]
              target_label: container_name
service:
  extensions: [ecs_observer]
```

pipeline과 `prometheusremotewrite` exporter는 생략한 예시입니다. 확장을 실행하려면 `service.extensions`에 `ecs_observer`를 등록해야 합니다. AMP로 보낼 때는 `sigv4auth` 확장(`service: aps`)을 만들고 exporter의 `auth.authenticator`에 연결합니다. 소스 라벨은 `__meta_ecs_cluster_name`, `__meta_ecs_service_name`, `__meta_ecs_task_definition_family`, `__meta_ecs_container_name`이며 task ARN 라벨은 없습니다.

CloudWatch agent의 기본 목적지는 CloudWatch Logs의 EMF입니다. Prometheus와 결합하려면 `sd_result_file`을 file_sd로 재사용할 수 있습니다. OTel Collector를 발견 전용으로 실행해 `result_file`을 공유 볼륨에 쓰고 Prometheus가 읽는 구성도 기술적으로 가능하지만, 공식 예시는 확인하지 못했습니다.

### 한 태스크에 앱과 사이드카가 함께 있다면

A1~A4가 한 태스크 안의 컨테이너 넷이라면, 네이티브 SD는 태스크마다 타깃을 하나만 만들기 때문에, 컨테이너 넷을 긁으려면 포트마다 job을 따로 둬야 합니다. 다음 그림이 그 구성입니다.

{{< flow src="_flow/3-multi-container.json" />}}

같은 태스크를 ecs_observer나 CloudWatch agent로 발견하면 컨테이너와 포트별 타깃을 얻습니다.

{{< flow src="_flow/3-multi-container-observer.json" />}}

네이티브 SD를 유지하려면 포트마다 같은 SD를 별도 job으로 선언합니다. 그 포트가 없는 태스크는 매번 scrape에 실패해 `up=0`이 나오므로, 서비스 태그에 포트 규약을 두고 `keep`으로 거르는 편이 좋습니다. Spring의 `/actuator/prometheus`와 Envoy의 `/stats/prometheus`처럼 경로와 포트가 서비스마다 다르면 docker label 규약을 쓰는 쪽이 간결합니다. CloudWatch agent의 기본 라벨은 `ECS_PROMETHEUS_EXPORTER_PORT`, `ECS_PROMETHEUS_METRICS_PATH`와 job 이름용 라벨입니다.

태스크 내부 사이드카가 `localhost:9090`, `localhost:9113` 등을 모두 수집해 한 경로로 보내는 방법도 있습니다. 외부 발견과 인바운드 보안 그룹이 필요 없어지지만, 컨테이너 구분 라벨은 사이드카 설정에서 직접 붙여야 합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| 모드별 주소 | Fargate는 항상 awsvpc. bridge는 host port 생략 시 ephemeral 자동 할당, `networkBindings`에 기록 | ECS API 레퍼런스(PortMapping), ECS 개발자 가이드(Fargate) | `✓` |
| ephemeral 범위 | 커널 `ip_local_port_range`가 없으면 Linux 49153~65535 | ECS API 레퍼런스(PortMapping) | `✓` |
| Fargate 제약 | privileged 불가, `dockerVolumeConfiguration` 불가. EC2 인스턴스가 보이지 않음 | ECS 개발자 가이드(Fargate) | `✓` |
| 보안 그룹 | 태스크 ENI SG가 수집기 SG에서 메트릭 포트 인바운드 허용. 같은 SG면 self-referencing | CloudWatch Prometheus-on-ECS 문서 | `✓` |
| cAdvisor 요구사항 | Docker 소켓·호스트 cgroup 마운트를 요구한다는 점은 원문 확인하지 않음 | cAdvisor 쪽 요구사항 | `?` |
| 네이티브 ECS SD | v3.8.0에 추가("unified AWS service discovery for ec2, lightsail and ecs"). feature flag·experimental 표기 없음 | Prometheus 릴리스, Prometheus 설정 문서 | `✓` |
| v3.8.0 날짜 | 릴리스 페이지와 CHANGELOG의 표기가 2025-12-02, 2025-11-28로 다름. 글에는 버전만 적음 | Prometheus 릴리스, Prometheus CHANGELOG | `?` |
| 이후 변경 | 3.12에서 ECS에 `external_id`, 3.14에서 `promtool` region 문제 수정, 3.15.0에서 standalone 태스크 패닉 수정 | Prometheus 릴리스 | `✓` |
| 타깃 단위와 주소 | 태스크당 하나, `__address__`는 `IP:port`(awsvpc는 ENI private IP, bridge·host는 호스트 private IP). 컨테이너 이름·docker label·`networkBindings` 라벨 없음 | Prometheus 소스(ecs.go), Prometheus 설정 문서 | `✓` |
| 메타 라벨 | cluster, service, task_arn, task_definition(ARN), availability_zone, launch_type, last/desired/health_status, 태그 4종. family·container_name 없음 | Prometheus 설정 문서 | `✓` |
| IAM | List/Describe 6종과 DescribeContainerInstances, ec2:DescribeInstances, DescribeNetworkInterfaces. DescribeTaskDefinition 없음 | Prometheus 설정 문서 | `✓` |
| 설정 키 | 소스에 `ecs_sd_configs` 별도 등록과 `request_concurrency`(기본 20)가 있으나 문서에는 `aws_sd_configs`만 있음 | Prometheus 소스(ecs.go) | `✓` |
| 태스크 태그 전파 | 서비스에서 태스크로 태그를 전파하는 ECS 쪽 설정명은 확인하지 못함 | 해당 없음 | `?` |
| AWS 문서의 옛 문장 | CloudWatch 문서에 "no built-in service discovery for Amazon ECS"가 남아 있음 | CloudWatch agent 문서 | `✓` |
| ecs_observer 설계 | 필터 3종, 컨테이너×포트 타깃, 결과 file_sd 파일, 클러스터 1개, 확장 stability beta | ecsobserver README | `✓` |
| refresh_interval | README 표 10s, 소스 `defaultRefreshInterval = 30s`. 소스 기준을 씀 | ecsobserver 소스 | `✓` |
| 라벨 이름 | README 표와 소스가 다르며 소스 상수를 씀. task ARN 라벨 없음 | ecsobserver 소스 | `✓` |
| Prometheus 서버와의 결합 | Collector를 발견 전용으로 띄워 결과 파일을 file_sd로 읽는 공식 예시는 없음 | ecsobserver README | `?` |
| CloudWatch agent | 모드 3종 동시 사용, `{private_ip}:{port}/{metrics_path}`로 중복 제거, 기본 목적지는 CloudWatch Logs EMF | CloudWatch agent 문서 | `✓` |
| 포트 규칙 | 한 태스크 컨테이너는 ENI IP 하나를 공유하며 포트는 겹치면 안 되고 awsvpc에서 hostPort는 containerPort와 같음 | ECS 개발자 가이드(awsvpc, 태스크 정의) | `✓` |
| 도구별 능력 | 네이티브 SD는 태스크당 타깃 하나·포트 하나, ecs_observer와 CloudWatch agent는 컨테이너×포트, Cloud Map은 포트 하나 | Prometheus 소스(ecs.go), ecsobserver README, CloudWatch agent 문서 | `✓` |
| docker label 기본값 | CloudWatch agent 기본 `ECS_PROMETHEUS_EXPORTER_PORT`, `ECS_PROMETHEUS_METRICS_PATH` | CloudWatch agent 문서 | `✓` |
| job 분리와 태그 필터 | 포트별 job으로 나누고 태그 규약으로 keep을 거는 권장안 | 도구별 능력의 조합 | `Σ` |

{{% /details %}}

## 4. 폴링 주기가 발견 범위를 제한한다

ECS API로 발견할 때는 태스크 수명과 갱신 주기를 함께 봐야 합니다. ECS에는 Kubernetes API server 같은 watch 채널이 없고 변화분만 받는 delta도 없습니다. Prometheus의 네이티브 ECS SD는 `refresh_interval`마다 전체 목록을 다시 받으며 기본값은 60초입니다. 새 태스크가 처음 긁히기까지는 최대 "발견 주기 + scrape 간격"이 걸리므로, 수십 초에서 1분 남짓 실행되는 태스크는 한 번도 긁히지 않을 수 있습니다.

{{< seq src="_flow/2-ecs-poll-seq.json" />}}

첫 수집까지는 발견 주기와 scrape 간격뿐 아니라 Prometheus 내부의 갱신 대기도 걸립니다. 아래 도식은 방법별 기본 갱신 주기와 목록 반영까지의 대기를 비교합니다.

{{< lane src="_lane/3-refresh-intervals.json" />}}

발견 주기를 줄이면 ECS API 호출량이 늘어납니다. 읽기 API의 지속 한도는 카테고리별 20 req/s이며, 계정과 리전의 모든 호출자가 같은 버킷을 공유합니다.

| 카테고리 | 대표 액션 | 버스트 | 지속(req/s) |
|---|---|---|---|
| Cluster read | DescribeClusters, ListClusters | 50 | 20 |
| Service read | DescribeServices, ListServices | 100 | 20 |
| Cluster resource read | DescribeTasks, ListTasks | 100 | 20 |
| Task definition read | DescribeTaskDefinition | 50 | 20 |

배포 도구와 콘솔도 이 한도를 사용합니다. HA 복제본이나 샤드가 각자 폴링하면 호출량도 늘어나므로, AWS는 간격 확대·EventBridge 이벤트 활용·캐시를 안내합니다. ecs_observer README도 폴링 간격이 짧거나 수집기가 여럿이면 rate limit에 걸릴 수 있고, `hashmod`로 샤딩해도 샤드마다 전체 태스크를 가져온다고 경고합니다. 소스의 ECS 전용 키 `ecs_sd_configs`에는 동시성 기본값 20을 이 지속 한도에 맞췄다는 주석이 있습니다. 문서에 있는 `aws_sd_configs`로는 이 값을 정할 수 없습니다.

`ec2_sd_configs`는 EC2 인스턴스만 찾고 ECS 태스크와 포트는 모릅니다. 호스트마다 고정 포트로 실행하는 node_exporter에는 쓸 수 있지만 Fargate에는 해당하지 않습니다. Consul을 이미 쓴다면 `consul_sd_configs`도 선택지지만, ECS가 Consul에 자동 등록해 주지는 않습니다.

외부 생성기로는 teralytics/prometheus-ecs-discovery(Go, v1.4.1, 2021-09-06)와 signal-ai/prometheus-ecs-sd(Python, v1.6.0, 2021-05-17)가 있습니다. 각 프로젝트 자료에 따르면 둘 다 컨테이너의 환경변수나 docker label을 읽지만 4~5년째 릴리스가 없습니다. 네이티브 SD가 생긴 지금은 docker label로 컨테이너와 포트를 고르는 기능이 꼭 필요할 때만 의미가 있습니다. vmagent의 ECS SD 요청 이슈 #10610도 열려 있습니다.

방법별 기능을 비교하면 다음과 같습니다.

| 방법 | 발견 주체 | Fargate | 컨테이너 단위 | bridge 동적 포트 | 주의 |
|---|---|---|---|---|---|
| 네이티브 `aws_sd` ecs | Prometheus 본체 | {{< badge "지원" good >}} | {{< badge "없음" bad >}} | {{< badge "없음" bad >}} | 태스크당 타깃 하나 |
| `ec2_sd` | Prometheus 본체 | {{< badge "없음" bad >}} | {{< badge "없음" bad >}} | {{< badge "없음" bad >}} | 호스트 단위만 |
| ecs_observer | 수집기 확장 | {{< badge "지원" good >}} | {{< badge "지원" good >}} | {{< badge "지원" good >}} | beta, 클러스터 하나 |
| CloudWatch agent | CW agent | {{< badge "지원" good >}} | {{< badge "지원" good >}} | {{< badge "지원" good >}} | 기본 목적지 CloudWatch |
| 외부 생성기 | 별도 프로세스 | {{< badge "지원" good >}} | {{< badge "지원" good >}} | {{< badge "지원" good >}} | 2021년 이후 릴리스 없음 |
| managed collector | AWS 관리형 | {{< badge "지원" good >}} | {{< badge "없음" bad >}} | {{< badge "미확인" info >}} | 8개 제한, 30초 하한, AMP 목적지는 블로그 근거 |

prometheus-operator v0.94.2의 ScrapeConfig CRD에는 ECS role이 없습니다. kube-prometheus-stack에서 ECS를 수집하려면 `additionalScrapeConfigs`에 원문 YAML을 넣어야 합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| watch 부재와 폴링 | Prometheus ECS SD는 `refresh_interval` 기본 60s로 AWS API 폴링. ecs_observer README도 매번 전체를 가져오고 delta가 없다고 설명 | Prometheus 설정 문서, ecsobserver README | `✓` |
| API 한도 | 카테고리별 지속 20 req/s, 버스트 50~100. 계정·리전 전체가 버킷 공유. HA·샤드마다 호출 증가, AWS는 간격 확대, EventBridge, 캐시를 권고 | ECS 스로틀링 문서 | `✓` |
| 동시성 기본 20 | ECS 지속 한도에 맞춘 값이라는 소스 주석 | Prometheus 소스(ecs.go) | `✓` |
| 짧은 태스크 | 발견 주기 + scrape 간격보다 짧으면 놓친다는 해석 | 위 기본값의 조합 | `Σ` |
| 갱신 주기 기본값 | 네이티브 ECS SD 60s, `dns_sd` 30s, `http_sd` 60s, `ecs_observer` 소스 30s | Prometheus 설정 문서, ecsobserver 소스 | `✓` |
| 갱신 대기 최대치 | discovery 묶음 대기 최대 5초와 scrape reload 5초 ticker의 합 약 10초. ECS SD도 같은 경로를 거치므로 refresh 주기에 더해짐. watch 전파와 scrape 간격은 제외 | Prometheus 소스(discovery manager, scrape) | `≈` |
| 알려진 한계 | rate limit 우려, 샤드마다 전체 태스크를 가져옴 | ecsobserver README | `✓` |
| 폴링 호출 | `ListClusters`(`clusters`를 비웠을 때만), `ListTasks`, `DescribeTasks`(태그 포함), EC2 launch type이면 `DescribeContainerInstances`·`DescribeInstances`, awsvpc 공인 IP가 필요하면 `DescribeNetworkInterfaces`. 호출 간 순서는 확정하지 못함 | Prometheus 설정 문서, Prometheus 소스(ecs.go) | `✓` |
| 외부 생성기 | teralytics v1.4.1(2021-09-06), signal-ai v1.6.0(2021-05-17). 둘 다 이후 릴리스 없음 | teralytics README, signal-ai README | `Ⓥ` |
| http_sd 구현 | 유지보수가 확인된 공개 구현은 찾지 못함 | 검색 결과 | `?` |
| ScrapeConfig CRD | v0.94.2 API에 ECS role 없음 | operator 소스(ScrapeConfig 타입) | `✓` |
| vmagent | ECS SD 없음. 요청 이슈 #10610 열려 있음 | VictoriaMetrics 이슈 | `✓` |

{{% /details %}}

## 5. 수집기 배치가 저장소와 장애 범위를 바꾼다

발견 방법이 같아도 수집기를 어디에 두느냐에 따라 운영 부담이 달라집니다. 중앙 Prometheus는 수집 상태를 한곳에서 보여 주고 사이드카는 발견 없이 태스크 안에서 끝나며, Fargate라면 로컬 저장소의 수명도 함께 정해야 합니다. 아래 배치도는 모두 같은 틀(ECS 태스크·발견·수집·저장·조회)로 그렸습니다.

### 중앙 Prometheus가 직접 수집하는 구성

{{< flow src="_flow/2-ecs-native-pull.json" />}}

중앙 Prometheus는 `up`과 scrape 실패를 한곳에서 보여 주며 태스크 정의에 수집기 컨테이너를 추가하지 않아도 됩니다. 한 대만 운영하다가 장애가 나면 모든 서비스의 수집이 비고, 그 서버가 평가하던 알림도 멈춥니다. 서버가 한 AZ에 있고 태스크가 여러 AZ에 퍼져 있다면 스크레이프 트래픽에 AZ 간 전송 요금이 붙을 수 있다고 추정합니다.

Fargate에서 ECS 서비스로 Prometheus를 띄우면 저장 볼륨에서 막힙니다. 태스크에 붙이는 EBS는 새 볼륨만 가능하고 서비스 태스크가 종료되면 항상 삭제됩니다. EFS도 대안이 되지 않습니다. Prometheus 저장소 문서는 NFS와 AWS EFS를 지원하지 않는다고 명시합니다. 로컬 TSDB(시계열 데이터베이스)를 오래 유지하려면 EC2에 직접 배치하고, Fargate라면 agent 모드를 쓰고 저장은 AMP 같은 외부 저장소에 맡기는 쪽이 현실적입니다. agent에는 로컬 쿼리·규칙·알림 기능이 없고, 전송을 마친 데이터는 WAL(쓰기 전 로그)에서 지웁니다. 원격 장애 때는 최대 2시간 분량을 디스크에 버퍼링합니다.

2021년 AWS 블로그는 Cloud Map을 읽는 config-reloader 사이드카와 SigV4 프록시를 붙여 AMP로 보내는 구성을 소개했습니다. WAL은 호스트 bind mount에 두고 필요하면 EFS를 쓰라는 내용도 있지만, 이는 remote write 전송 버퍼를 전제로 한 설명입니다. 로컬 TSDB를 EFS에 두는 구성은 Prometheus 문서와 충돌합니다.

### 태스크마다 사이드카를 두는 구성

사이드카 구성은 태스크 정의 쪽에서 수집을 끝내는 배치입니다. 메트릭 포트의 인바운드 보안 그룹 규칙도 필요 없습니다.

{{< flow src="_flow/2-ecs-sidecar.json" />}}

AWS 문서는 ECS 콘솔의 "Use metric collection" 옵션으로 이 방식을 안내하며 Fargate와 EC2를 지원합니다. AMP 예시는 prometheus receiver로 수집하고 `prometheusremotewrite`와 `sigv4auth`로 전송합니다. 태스크 수만큼 수집기를 실행하므로 CPU·메모리도 태스크마다 배정해야 하고, 설정을 바꿀 때는 각 서비스의 태스크 정의를 재배포해야 합니다.

`essential: true`인 사이드카가 실패하면 앱 태스크도 종료됩니다. KINTO Technologies의 Qiita 글은 설정 오타와 권한 오류로 겪은 장애를 기록합니다. 2024년 AWS 한국 기술 블로그는 규모가 커지면 메트릭용과 트레이스용 사이드카를 분리하라고 권합니다.

이 배치에는 중앙에서 보는 `up`이 없습니다. 태스크째 사라지면 신호가 남지 않는 것으로 보이므로, ECS 이벤트나 `awsecscontainermetrics` 같은 다른 신호로 메워야 합니다. 종료 시 마지막 배치가 전송되는지도 확인하지 못했습니다. ECS는 SIGTERM 뒤 `stopTimeout`만큼 기다렸다가 강제 종료하며, 기본값은 30초이고 최대값은 120초입니다.

### 클러스터에 전용 수집기를 두는 구성

태스크별 수집기의 자원 부담을 피하려면 ecs_observer 등을 쓰는 전용 수집기 태스크를 둘 수 있습니다.

{{< flow src="_flow/2-ecs-observer.json" />}}

수집기 수가 태스크 수에 따라 늘지 않고, 태스크 정의에는 docker label을 붙이며, 수집 설정은 한곳에서 바꿉니다. 수집기는 모든 태스크 ENI에 접근할 수 있어야 합니다. 하나면 단일 장애점이고 둘이면 중복 수집이 생기므로, AMP에서는 dedup(중복 제거) 설정까지 필요합니다. 이를 생략하면 중복 샘플도 과금됩니다.

2022년 AWS 블로그가 소개한 ADOT 수집기 한 대와 Cloud Map 조합에는 현재 "no longer recommended"라는 문구가 붙어 있으며 ecs_observer를 대안으로 가리킵니다. ecs_observer 자체는 beta입니다.

managed collector도 이 배치에 해당하지만 수집기 태스크를 직접 운영하지 않습니다. AMP 워크스페이스로 보내는 ECS 경로는 앞서 본 블로그가 근거입니다. 서울 리전의 AMP 목적지 단가는 collector 시간당 $0.04와 1천만 샘플당 $0.03이며, CloudWatch 목적지에서는 수집 요금이 CloudWatch OTel 메트릭 단가로 바뀝니다.

### 앱에서 OTLP로 보내는 구성

앱을 OTel SDK로 계측했다면 OTLP로 Collector에 보내고, Collector가 Prometheus 3의 OTLP receiver나 AMP로 전달할 수 있습니다. 발견 과정이 없어 짧게 실행되는 태스크도 종료 전에 전송할 수 있습니다. Prometheus의 OTLP receiver는 정식 기능이지만 `--web.enable-otlp-receiver`로 켜야 하며, 3.14와 3.15에서도 수정이 이어졌습니다.

이 방식에는 `up`이 없고, `service.instance.id`가 태스크마다 바뀌면 pull과 같은 시계열 교체가 생깁니다. AMP의 OTLP 직접 수신 경로는 문서에서 확인하지 못했으므로, AMP에 보낼 때는 Collector가 OTLP를 remote write로 바꿔야 합니다.

### 기존 EKS Prometheus를 사용하는 구성

이미 EKS에 Prometheus가 있고 ECS까지 네트워크가 이어져 있다면, 저장소와 볼륨을 새로 마련하지 않고 수집 대상을 확장할 수 있습니다.

{{< flow src="_flow/2-eks-reuse.json" />}}

Prometheus 3.8 이상의 ECS SD는 `role_arn`을, 3.12부터는 `external_id`도 받아 다른 계정의 ECS를 읽을 수 있습니다. kube-prometheus-stack에서는 `additionalScrapeConfigs`에 ECS 설정을 넣습니다. 같은 VPC라면 ECS 태스크 보안 그룹에서 EKS 노드 보안 그룹을 허용하고, security groups for pods를 쓴다면 Prometheus 파드의 보안 그룹을 허용합니다. 다른 VPC라면 peering이나 Transit Gateway로 라우팅을 연결합니다. AWS 발표에 따르면 Transit Gateway는 2024-09부터 같은 리전의 다른 VPC 보안 그룹을 인바운드 규칙에서 참조할 수 있습니다.

이 구성에서는 EKS 업그레이드나 Prometheus 파드 재스케줄이 ECS 수집에도 영향을 줄 수 있습니다. 메모리와 카디널리티(시계열 수) 예산도 공유합니다. ECSSDConfig의 `region`은 하나이므로 여러 리전을 수집하려면 리전마다 scrape job을 둡니다.

| 패턴 | 발견 주체 | 태스크 쪽 변경 | 저장 볼륨 | 짧은 태스크 | 중앙 `up` |
|---|---|---|---|---|---|
| a 중앙 Prometheus pull | Prometheus | 메트릭 포트 개방 | {{< badge "부담 큼" bad >}} | {{< badge "놓칠 수 있음" warn >}} | {{< badge "있음" good >}} |
| b 사이드카 push | 없음 | 사이드카 추가 | {{< badge "없음" good >}} | {{< badge "수집" good >}} | {{< badge "없음" bad >}} |
| c 클러스터 수집기 | ecs_observer 등 | docker label | {{< badge "없음" good >}} | {{< badge "놓칠 수 있음" warn >}} | {{< badge "수집기 기준" info >}} |
| d OTLP push | 없음 | SDK 계측 | {{< badge "목적지에 따름" info >}} | {{< badge "수집" good >}} | {{< badge "없음" bad >}} |
| e EKS Prometheus 재사용 | EKS의 Prometheus | 메트릭 포트 개방 | {{< badge "이미 해결" good >}} | {{< badge "놓칠 수 있음" warn >}} | {{< badge "있음" good >}} |

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| Fargate EBS | 새 볼륨만 가능, 서비스 태스크의 볼륨은 종료 시 항상 삭제 | ECS 개발자 가이드(EBS) | `✓` |
| EFS | Prometheus가 NFS(EFS 포함) 비지원을 명시 | Prometheus 저장소 문서 | `✓` |
| agent 모드 | `--agent`, 로컬 쿼리·규칙·알림 없음, 원격 장애 시 약 2시간 버퍼 | Prometheus agent 문서 | `✓` |
| AZ 간 전송 비용 | 서버가 한 AZ에 있고 태스크가 여러 AZ에 퍼진다는 전제에서 나온 추정 | 구조에서 유추 | `Σ` |
| 2021 AWS 블로그 | Cloud Map을 읽는 config-reloader 사이드카와 SigV4 프록시로 AMP 전송, WAL은 호스트 bind mount에 두고 필요하면 EFS | AWS 오픈소스 블로그(2021) | `Ⓥ` |
| 사이드카 안내 | 콘솔 "Use metric collection", Fargate·EC2 지원, External instance 미지원 | ECS 개발자 가이드(애플리케이션 메트릭) | `✓` |
| AMP의 ECS 예시 | prometheus receiver가 같은 태스크 엔드포인트를 정적으로 scrape, `awsecscontainermetrics`로 태스크 CPU·메모리 | AMP 사용자 가이드(ECS) | `✓` |
| 사이드카 단점 | essential 사이드카 장애가 태스크 전체를 종료시킨 경험담. 태스크 CPU를 512 units로 다시 잡은 메모. 규모가 커지면 메트릭·트레이스 사이드카 분리 권고 | KINTO Qiita, HackMD 운영 메모, AWS 한국 기술 블로그(2024) | `Ⓥ` |
| 태스크째 사라질 때 | 중앙에서 신호가 남지 않는다는 해석 | 구조에서 유추 | `Σ` |
| 종료 시 flush | stopTimeout 기본 30초·최대 120초는 확인, 수집기가 종료 시 남은 WAL·배치를 비우는지는 미확인 | ECS 개발자 가이드(태스크 정의) | `?` |
| 수집기 태스크 단점 | 단일 수집기는 큰 클러스터를 감당 못 할 수 있고, 샤드를 늘리면 rate limit 우려 | ecsobserver README | `✓` |
| 2022 AWS 블로그 | "no longer recommended" 문구가 붙고 ecsobserver를 대안으로 지목 | AWS Containers 블로그(2022) | `Ⓥ` |
| managed collector 단가 | AMP 워크스페이스 목적지 기준 서울 collector 시간당 $0.04, 1천만 샘플당 $0.03. CloudWatch 목적지도 collector 시간 단가는 같고 수집 요금은 CloudWatch OTel 메트릭 단가 | AMP 요금(Price List), AWS 운영 블로그(2026-04) | `✓` |
| 중복 과금 | AMP dedup(`cluster`·`__replica__`)을 설정하지 않으면 중복 샘플까지 과금 | AMP 중복 제거 문서 | `✓` |
| OTLP receiver | 정식이나 기본 꺼짐, `--web.enable-otlp-receiver`. 3.14·3.15에서 수정 이어짐 | Prometheus OTLP 가이드, Prometheus 릴리스 | `✓` |
| AMP의 OTLP | 문서가 적은 수집 경로는 remote write와 managed collector 둘뿐이며 OTLP 직접 수신은 문서에서 못 찾음 | AMP 수집 방식 문서 | `?` |
| 패턴 e의 근거 | `role_arn`·`external_id`(3.12에서 ECS 추가), ScrapeConfig에 ECS role 없음 | Prometheus 소스(ecs.go), operator 소스 | `✓` |
| TGW 보안 그룹 참조 | 2024-09부터 같은 리전에서 인바운드 규칙이 다른 VPC의 보안 그룹을 참조 | AWS What's New(TGW) | `Ⓥ` |
| 패턴 e의 대가 | 실패 도메인이 묶이고 카디널리티 예산을 공유한다는 해석 | 구조에서 유추 | `Σ` |

{{% /details %}}

## 6. 라벨과 중복 처리를 먼저 정한다

태스크가 교체되면 IP가 바뀌고 시계열도 새로 생깁니다. 교체 때 새 시계열이 생기는 것은 Kubernetes에서 Pod IP가 바뀔 때와 같아 피할 수 없습니다. 막아야 하는 것은 태스크 수명 중에 바뀌는 상태 값이 라벨에 들어가 시계열을 곱하는 경우입니다. 아래 운영 판단 가운데 일부는 소스와 문서의 동작을 조합한 해석입니다.

| 라벨 | 값의 출처 | 비고 |
|---|---|---|
| `cluster` | `__meta_ecs_cluster` | AMP dedup의 `cluster`와 규약 조율 |
| `service` | `__meta_ecs_service` | 독립 실행 태스크는 비어 있음 |
| `task_family` | `__meta_ecs_task_definition`에서 추출 | revision은 버림 |
| `container` | job 이름 또는 수집기 라벨 | 네이티브 SD는 원천 라벨 없음 |
| `instance` | `__address__` | 태스크 단위 churn은 불가피 |
| `task_id` | task ARN의 마지막 구간 | 선택, IP 재사용 구분용 |
| 버림 | `last_status`, `desired_status`, `health_status` | 태스크 수명 중 변함 |

`last_status`, `desired_status`, `health_status`는 refresh마다 현재 값으로 채워집니다. 이 값을 라벨로 남기면 PENDING에서 RUNNING으로, UNKNOWN에서 HEALTHY로 바뀌는 상태 변화도 시계열을 끊습니다. 상태는 keep 조건에만 쓰고 저장 라벨에서는 제외하는 편이 좋습니다. task ARN 전체 대신 마지막 task ID를 `task_id`로 남기면 라벨 바이트를 줄이고 IP 재사용도 구분할 수 있습니다. AMP의 시리즈당 라벨 합계 제한은 7KB입니다.

배포 때는 실행 중인 태스크 수와 active series를 구분해야 합니다. `maximumPercent: 200`이면 새 태스크와 옛 태스크가 함께 실행될 수 있습니다. AMP는 최근 2시간 안에 샘플을 받은 시리즈를 active series로 세므로, 배포 직후 두 시간 동안 서비스의 active series가 배포 전의 두 배쯤으로 보일 수 있습니다. 배포가 잦다면 이 증가분을 쿼터와 메모리 계획에 포함합니다.

pull 방식(a, c, e)은 태스크가 SD 목록에서 빠지면 시계열을 곧바로 stale 처리하므로 `count(up{service="A"})`가 현재 태스크 수에 가까워집니다. push 방식(b, d)은 stale 마커를 쓸 주체가 없어 마지막 샘플이 기본 lookback 5분 동안 쿼리에 남을 수 있습니다. 이 동작은 구조에서 유추한 것이고, AMP가 remote write로 받은 stale 마커를 어떻게 처리하는지는 확인하지 못했습니다.

### 샤딩은 발견 부하까지 나누지 않는다

EKS에서 operator의 `spec.shards`를 늘리면 ServiceMonitor·PodMonitor·ScrapeConfig는 `__address__`에 `hashmod`를 적용하고 자기 샤드 번호만 keep합니다. 이 단계가 SD 뒤의 relabel에 있으므로, 샤드와 replica가 저마다 전체 pod 목록을 watch한다고 보는 것이 자연스럽습니다. 그렇다면 스크레이프 부하는 나뉘어도 API server watch 수와 SD 메모리는 샤드와 replica 수만큼 곱해집니다.

같은 Prometheus 안에서는 SD 설정이 완전히 같을 때 provider를 공유합니다. label selector나 field selector를 추가하면 이 공유가 깨져 selector 조합마다 LIST와 WATCH가 늘어난다는 경고도 Prometheus 문서에 있습니다. ECS의 폴링 역시 샤드마다 전체 목록을 받는 비용을 따로 계산해야 합니다.

### AMP의 HA 라벨과 서비스 라벨 조율

Prometheus HA는 같은 설정의 서버를 둘 이상 두고 replica external label만 다르게 붙입니다. Prometheus 자체는 중복을 제거하지 않습니다. AMP로 보낼 때는 복제본의 `cluster`를 같게, `__replica__`를 다르게 설정하면 리더 하나의 샘플만 받습니다. 리더가 30초 동안 전송하지 않으면 다른 복제본으로 넘어가며, 저장 시계열에는 `cluster`만 남습니다. `__replica__` 값을 다른 라벨로 복사하지 않아야 합니다.

이 설정이 없으면 중복 샘플도 과금됩니다. 사이드카는 태스크마다 수집기가 하나이므로 HA 쌍이 성립하지 않고, 이 중복 제거는 중앙 수집기(a, c, e)에 해당합니다. 여러 클러스터를 한 저장소로 모을 때 붙이는 `account`, `region`, `cluster`는 external_labels나 relabel로 정하되, HA 묶음 이름과 같은 라벨을 다투지 않도록 규약을 맞춥니다.

보안 그룹도 공통 규약을 둘 수 있습니다. 앱은 8080, 메트릭은 9090대처럼 포트를 분리하면 수집기 보안 그룹에 메트릭 대역만 허용하기 쉽습니다. awsvpc 태스크의 보안 그룹은 최대 다섯 개이므로 모니터링 수신용 그룹을 공통으로 붙이면 이 제한 안에서 관리하기 쉽습니다. bridge의 동적 포트를 쓰면 컨테이너 인스턴스 보안 그룹이 ephemeral 범위 전체를 수집기에 열어야 한다는 결론이 따라 나옵니다. 이 점을 AWS가 명시해 권고하는지는 확인하지 못했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| 상태 라벨 | `last_status` 등은 refresh마다 현재 값으로 채워짐. 라벨로 올리면 시계열이 끊긴다는 판단 | Prometheus 소스(ecs.go) | `Σ` |
| 라벨 크기 | AMP는 시리즈당 라벨 합계 7KB 제한 | AMP 쿼터 | `✓` |
| active series | 최근 2시간 안에 샘플이 들어온 시리즈를 셈. 배포 직후 두 배라는 해석 | AMP 쿼터, ECS 개발자 가이드(배포) | `Σ` |
| stale 처리 | 타깃이 목록에서 빠지면 곧 stale. 쿼리 lookback 기본 5분 | Prometheus 쿼리 문서 | `✓` |
| push의 stale | 마커를 써 줄 주체가 없어 5분간 남는다는 해석. AMP의 stale 마커 처리는 미확인 | 구조에서 유추 | `?` |
| provider 공유 | 구조가 같은 SD 설정은 provider 공유. selector를 쓰면 공유가 깨짐 | Prometheus 소스(discovery manager), Prometheus 설정 문서 | `✓` |
| 샤딩 | `hashmod`를 `__address__`에 적용. 샤드 수를 바꿔도 기존 데이터는 다시 나뉘지 않음 | operator 샤딩 문서, operator 소스 | `✓` |
| 샤드별 전체 watch | relabel 단계에서 샤딩하므로 샤드·replica마다 전체 pod를 watch한다는 해석. 부하를 잰 공식 수치는 찾지 못함 | operator 소스의 구조 | `Σ` |
| HA와 dedup | replica 라벨만 다르게 둠. AMP는 `cluster`와 `__replica__`로 중복 제거 | operator HA 문서, AMP 중복 제거 문서 | `✓` |
| AMP dedup | `cluster` 같게, `__replica__` 다르게. 리더가 30초 침묵하면 교체. 미설정 시 중복 과금. 추적 cluster는 워크스페이스당 500개 | AMP 중복 제거 문서, AMP HA FAQ, AMP 쿼터 | `✓` |
| 수집기와 클러스터 | ecs_observer·CloudWatch agent는 `cluster_name`/`sd_target_cluster` 하나 | ecsobserver README, CloudWatch agent 문서 | `✓` |
| awsvpc SG 개수 | 태스크당 최대 5개 | ECS 개발자 가이드(awsvpc) | `✓` |
| 메트릭 포트 분리 | 포트 대역 분리와 공통 SG는 관리 편의에 대한 판단 | 구조에서 유추 | `Σ` |
| bridge ephemeral SG | 범위 전체를 열어야 한다는 결론은 서술에서 추론했고 AWS의 명시적 권고는 확인하지 못함 | ECS API 레퍼런스(PortMapping) | `?` |

{{% /details %}}

## 7. 기존 수집기와 워크로드 조건으로 후보를 좁힌다

EKS에 Prometheus가 있다면 네트워크 연결과 수집 여력을 확인해 재사용을 검토할 수 있습니다. ECS만 있다면 서비스당 태스크 수, 컨테이너 라벨의 필요 여부, 저장소 운영 조건이 선택을 좁힙니다. 아래 표는 앞의 사실을 조건별로 조합한 판단이며, 사례로 검증된 처방은 아닙니다.

| 조건 | 권하는 패턴 | 이유 |
|---|---|---|
| EKS에 Prometheus가 있고 ECS와 네트워크가 이어짐 | e | 저장·알림·대시보드가 이미 있음 |
| EKS 없음, ECS만, 관리형 선호, 서비스당 태스크 8개 이하 | c의 managed collector(목적지 확인) | 수집기 운영 없음, 8개 제한과 컨테이너 라벨 부재 감수. AMP 목적지 ECS 수집은 블로그 근거 |
| EKS 없음, ECS만, 서비스당 태스크가 8개를 넘음 | ecs_observer 또는 agent + 네이티브 SD | ECS API 기반이라 8개 제한 없음 |
| EKS 없음, ECS만, 컨테이너 이름 라벨 필요 | c의 ecs_observer(또는 CloudWatch agent 결과 파일) | 네이티브 SD에는 컨테이너 라벨이 없음 |
| Fargate 비중이 높고 저장소를 ECS 안에 두고 싶음 | 중앙은 agent 모드, 저장은 외부 | Fargate EBS 삭제, EFS 비지원 |
| EC2 launch type 중심, 비용 민감, 자체 운영 가능 | a | AMP 수집 단가 없음 |
| 짧게 사는 태스크와 배치가 많음 | 그 워크로드만 b나 d | pull은 짧은 태스크를 놓침 |
| 이미 OTel SDK로 계측하고 트레이스도 같이 봄 | d | Collector 하나로 신호를 모음 |
| 태스크가 수십 개 이하이고 팀이 작음 | b | 발견과 보안 그룹을 신경 쓰지 않아도 됨 |

관리형 수집기에서는 서비스당 8개 제한과 30초 하한이 수집 요구에 맞아야 합니다. EC2 중심이어도 bridge 동적 포트를 쓴다면 네이티브 SD만으로는 부족하므로 CloudWatch agent나 ecs_observer의 결과 파일을 file_sd로 읽는 구성을 검토합니다. 짧은 태스크 때문에 push가 필요하더라도 모든 서비스를 같은 방식으로 바꿀 필요는 없습니다.

공개 사례를 시점 순으로 보면 2021~2022년에는 ECS 내장 SD가 없어 사이드카나 "Cloud Map + 자작 SD"가 기본이었고, v3.8의 네이티브 ECS SD와 2026년 managed collector의 ECS 지원으로 중앙 pull의 진입 장벽이 낮아진 흐름으로 읽힙니다. 사례에서 읽은 흐름이지 통계는 아닙니다. 공개 운영 사례는 제한적이며 한국 회사의 ECS 운영 사례는 확인하지 못했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| 선택표 | 앞 절의 사실을 조건별로 조합한 판단. 검증된 처방이 아님 | 2~6절 근거 | `Σ` |
| 공개 사례 | KINTO Technologies의 ADOT 사이드카(2021, 2022·2023 갱신), AWS 블로그 4건(2021, 2022, 2024 한국 기술 블로그, 2026-04). 한국 회사 ECS 운영 사례는 찾지 못함 | KINTO Qiita, AWS 블로그들 | `Ⓥ` |
| 사례의 한계 | 국내 부트캠프 프로젝트와 개인 프로젝트 이슈는 검색 요약만 보았고 원문은 열람하지 않음 | 검색 요약 | `?` |
| 흐름 해석 | 사례의 시점 순서에서 읽은 경향 | 위 사례들 | `Σ` |

{{% /details %}}

## 8. 수집 간격을 월 샘플 수로 바꿔 비용을 본다

태스크 100개가 각각 1,000시리즈를 내보내면 총 10만 시리즈입니다. 30초 간격으로 수집할 경우 한 시리즈가 30일에 86,400샘플을 만들므로 월 86.4억 샘플이 됩니다.

서울 리전 공개 단가는 첫 4천만 샘플 무료, 2B(20억)까지 1천만 샘플당 $0.90, 다음 250B까지 $0.35입니다. 이 단가로 추정한 수집 요금은 다음과 같습니다. 실제 운영 사례의 측정값은 아닙니다.

| scrape 간격 | 월 샘플 | 수집 요금 | 비중 |
|---|---|---|---|
| 30초 | 86.4억 | 약 $409 | {{< bar 100 >}} |
| 60초 | 43.2억 | 약 $258 | {{< bar 63 >}} |

같은 30초 조건에서 AMP 워크스페이스로 보내는 managed collector를 쓰면, collector 1개의 월 약 $29와 샘플 단가분 약 $26이 더해진다고 계산했습니다. 이 역시 추정 예시입니다. 2026-04 AWS 블로그도 scrape 간격을 반으로 줄이면 수집 비용이 두 배가 된다고 경고합니다. 배포 직후 active series가 한동안 두 배로 보여도 샘플 수는 같은 시각에 떠 있는 태스크 수에 비례하므로, 옛 태스크와 새 태스크가 겹치는 시간만큼만 늘어난다고 봅니다.

저장소 선택에서 Thanos나 VictoriaMetrics를 함께 고려한다면, 여러 클러스터에서 모으는 구성은 [여러 클러스터 메트릭 글]({{< relref "/observability/metrics/prometheus-vs-victoriametrics-multi-cluster/index.md" >}})에, Prometheus 보존이 끝나는 지점과 Thanos의 연결은 [Prometheus·Thanos 연동]({{< relref "/observability/metrics/prometheus-thanos/_index.md" >}})에 정리해 두었습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| AMP 서울 단가 | 첫 4천만 샘플 무료, 2B까지 $0.90, 250B까지 $0.35, 이후 $0.16(1천만 샘플당). Price List publicationDate 2026-10-14 | AMP 요금(Price List) | `✓` |
| 월 샘플 수 | 10만 시리즈 × 86,400샘플 = 86.4억(30초), 43.2억(60초) | 산식 | `≈` |
| 수집 요금 계산 | 4천만~20억 구간 19.6억에 $0.90을 곱해 약 $176.4, 나머지 66.4억에 $0.35를 곱해 약 $232.4가 더해져 30초 약 $409. 60초는 176.4에 23.2억 × $0.35를 더한 약 $258 | 공개 단가로 계산 | `≈` |
| managed collector 추가분 | $0.04 × 730시간 약 $29.2, 수집 $0.03 × 864 = 약 $25.9. 샘플 단가가 위 수집 단가에 더해지는 것으로 계산함. AMP 목적지 기준 | AMP 요금(Price List)로 계산 | `≈` |
| 간격 경고 | "halving your scrape interval doubles your ingestion cost" | AWS 운영 블로그(2026-04) | `Ⓥ` |
| 배포 시 비용 | 샘플 수는 같은 시각에 떠 있는 태스크 수에 비례한다는 해석 | 구조에서 유추 | `Σ` |

{{% /details %}}

### Cloud Map DNS로도 찾을 수 있다

Cloud Map과 `dns_sd_configs`를 쓰면 IAM 없이 DNS로 주소를 받습니다. ECS 서비스 디스커버리는 awsvpc 태스크를 A 또는 SRV 레코드로 등록하며, bridge와 host는 SRV만 지원합니다. SRV에는 호스트 IP와 동적 호스트 포트가 함께 들어가므로 bridge의 동적 포트도 처리할 수 있습니다.

문제는 응답 개수입니다. Route 53 multivalue 응답은 건강한 레코드를 최대 여덟 개만 돌려줍니다. 태스크가 아홉 개 이상인 서비스에서는 조회마다 일부가 빠질 수 있으며, 서비스당 태스크 상한은 1,000개입니다. DNS 응답에 있는 라벨도 이름과 주소뿐입니다. `ECS_CLUSTER_NAME`, `ECS_SERVICE_NAME` 같은 Cloud Map 인스턴스 속성은 `DiscoverInstances` API로 받아야 합니다.

ECS의 관리형 수집은 AWS 문서끼리 지원 범위가 맞지 않습니다. AMP 사용자 가이드는 EKS가 유일한 지원 소스이며 SD도 `kubernetes_sd_config`만 지원한다고 적습니다. AMP API 레퍼런스의 `vpcConfiguration` 설명은 MSK용입니다. 그런데 2026-04-08 AWS 운영 블로그는 `vpcConfiguration` 소스의 scraper가 Cloud Map DNS로 ECS 태스크를 수집해 AMP 워크스페이스로 보내는 예시를 제시합니다.

2026-07-31 발표된 CloudWatch managed Prometheus collector는 EKS·EC2·ECS·MSK·OpenSearch를 대상으로 합니다. 공식 문서상 ECS 발견은 Cloud Map DNS의 `dns_sd_configs`만 지원하며 `file_sd`와 Consul은 지원하지 않습니다. 최소 scrape 간격은 30초이고 목적지는 CloudWatch입니다. 따라서 ECS에서 CloudWatch로 보내는 경로는 공식 문서로 확인되지만, AMP 워크스페이스로 보내는 경로의 근거는 위 블로그입니다. ECS 지원은 2026년에 등장했으며, 문서 사이의 차이는 남아 있습니다.

managed collector 문서는 응답 개수를 언급하지 않지만, 같은 Cloud Map DNS를 쓰므로 여덟 개 제한도 그대로 받는다고 해석합니다.

| 방법 | 발견 주체 | Fargate | 컨테이너 단위 | bridge 동적 포트 | 주의 |
|---|---|---|---|---|---|
| Cloud Map `dns_sd` | Route 53 DNS | {{< badge "지원" good >}} | {{< badge "없음" bad >}} | {{< badge "SRV만" warn >}} | 응답 8개 제한 |

관리형 수집기를 쓰는 경우가 아니라면 이 글의 기본 구성처럼 Cloud Map 없이 ECS API로 찾는 편이 단순합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| Cloud Map 레코드 규칙 | awsvpc는 A·SRV, bridge·host는 SRV만. 서비스당 태스크 1,000개 | ECS 개발자 가이드(서비스 디스커버리) | `✓` |
| 응답 8개 제한 | MULTIVALUE는 건강한 레코드 최대 8개, WEIGHTED는 1개 | Route 53 문서, Cloud Map API 문서 | `✓` |
| 8개 제한의 영향 | 9개 이상 서비스에서 일부 누락 가능하다는 해석. 실측 안 함 | 위 문서의 조합 | `?` |
| 인스턴스 속성 | `ECS_CLUSTER_NAME` 등은 `DiscoverInstances` API로만 얻음 | ECS 개발자 가이드(서비스 디스커버리) | `✓` |
| AMP 문서 서술 | 사용자 가이드는 EKS 전용, API 레퍼런스의 Source 설명은 MSK용 | AMP 사용자 가이드, AMP API 레퍼런스 | `✓` |
| CloudWatch managed collector의 ECS 발견·제약 | ECS는 `dns_sd_configs`만, `file_sd`·Consul 미지원, 최소 30s, 목적지 CloudWatch | CloudWatch 관리형 수집기 문서 | `✓` |
| AMP 워크스페이스로 보내는 ECS 수집 | 2026-04-08 블로그의 Cloud Map DNS scraper 예시. AMP 문서는 EKS 전용 | AWS 운영 블로그(2026-04) | `Ⓥ` |
| CloudWatch managed collector 발표일 | 2026-07-31 | AWS What's New(2026-07) | `Ⓥ` |
| managed 수집기의 8개 제한 | 문서는 언급하지 않으며 같은 DNS를 쓴다는 점에서 받는다는 해석 | 위 문서의 조합 | `Σ` |

{{% /details %}}

## 9. 확인하지 못한 것

- Kubernetes watch 전파 시간과 대규모 클러스터에서 watch 수 대비 API server 부하를 잰 공식 수치
- AMP managed collector의 자동 access entry 정책(`endpointslices` 없음)에서 `endpointslice` role이 실제로 실패하는지
- managed collector가 ECS에서 서비스당 태스크 아홉 개 이상일 때 실제로 누락하는지, AMP 사용자 가이드와 2026년 블로그 사이의 ECS 지원 서술 차이를 AWS가 어떻게 바로잡는지
- 서비스 태그를 태스크로 전파하는 ECS 설정 이름과, 네이티브 SD에서 태그 기반 포트 재작성의 공식 예시
- OTel Collector를 발견 전용으로 띄워 Prometheus 서버의 file_sd로 읽는 구성, CloudWatch agent가 AMP로 remote_write하는 경로의 공식 예시
- 사이드카 수집기가 태스크 종료 시 남은 데이터를 비우는지
- AMP가 remote write로 들어온 stale 마커를 처리하는 방식, Remote Write 2.0 지원 여부, OTLP 직접 수신 문서
- 다른 계정 워크스페이스로 쓰는 사이드카의 cross-account remote write 절차
- cAdvisor의 Docker 소켓·호스트 cgroup 요구사항 원문
- bridge 동적 포트에서 보안 그룹 범위에 대한 AWS의 명시적 권고
- 한국 회사의 ECS 운영 사례, ECS Fargate에서 Prometheus 재시작 시 데이터 손실을 다룬 Fasal Engineering 글(403으로 본문 못 엶)

## 참고 자료

- Prometheus 설정 문서, 쿼리 문서(staleness), agent 문서, 저장소 문서, OTLP 가이드 — https://prometheus.io/docs/prometheus/latest/configuration/configuration/ , https://prometheus.io/docs/prometheus/latest/querying/basics/#staleness , https://prometheus.io/docs/prometheus/latest/prometheus_agent/ , https://prometheus.io/docs/prometheus/latest/storage/ , https://prometheus.io/docs/guides/opentelemetry/
- Prometheus 릴리스, CHANGELOG — https://github.com/prometheus/prometheus/releases/tag/v3.15.1 , https://github.com/prometheus/prometheus/releases/tag/v3.8.0 , https://github.com/prometheus/prometheus/blob/main/CHANGELOG.md
- Prometheus 소스(Kubernetes SD, discovery manager, scrape, ecs.go) — https://github.com/prometheus/prometheus/tree/v3.15.1/discovery/kubernetes , https://github.com/prometheus/prometheus/blob/v3.15.1/discovery/manager.go , https://github.com/prometheus/prometheus/blob/v3.15.1/scrape/manager.go , https://github.com/prometheus/prometheus/blob/v3.15.1/discovery/aws/ecs.go
- Prometheus 커밋(2018) — https://github.com/prometheus/prometheus/commit/03a9e7f72e072c6d29f422425d8acd91a957836b
- operator 문서, API 문서, 샤딩 문서, HA 문서 — https://prometheus-operator.dev/docs/getting-started/design/ , https://prometheus-operator.dev/docs/api-reference/api/ , https://prometheus-operator.dev/docs/platform/sharding/ , https://prometheus-operator.dev/docs/platform/high-availability/
- operator 소스, 릴리스, ScrapeConfig 타입 — https://github.com/prometheus-operator/prometheus-operator/blob/v0.94.2/pkg/prometheus/promcfg.go , https://github.com/prometheus-operator/prometheus-operator/releases/tag/v0.94.2 , https://github.com/prometheus-operator/prometheus-operator/blob/main/pkg/apis/monitoring/v1alpha1/scrapeconfig_types.go
- 차트 소스, 차트 values, 커뮤니티 차트 소스 — https://github.com/prometheus-community/helm-charts/blob/kube-prometheus-stack-92.13.1/charts/kube-prometheus-stack/Chart.yaml , https://github.com/prometheus-community/helm-charts/blob/kube-prometheus-stack-92.13.1/charts/kube-prometheus-stack/values.yaml , https://github.com/prometheus-community/helm-charts/blob/prometheus-29.38.1/charts/prometheus/values.yaml
- Kubernetes 블로그 — https://kubernetes.io/blog/2025/04/24/endpoints-deprecation/
- AMP 사용자 가이드, API 레퍼런스 — https://docs.aws.amazon.com/prometheus/latest/userguide/AMP-collector-how-to.html , https://docs.aws.amazon.com/prometheus/latest/APIReference/API_Source.html
- AMP 중복 제거 문서, HA FAQ, 쿼터, 수집 방식 문서 — https://docs.aws.amazon.com/prometheus/latest/userguide/AMP-ingest-dedupe.html , https://docs.aws.amazon.com/prometheus/latest/userguide/HA_FAQ.html , https://docs.aws.amazon.com/prometheus/latest/userguide/AMP_quotas.html , https://docs.aws.amazon.com/prometheus/latest/userguide/AMP-ingest-methods.html
- AMP 사용자 가이드(ECS), AMP 요금(Price List) — https://docs.aws.amazon.com/prometheus/latest/userguide/AMP-onboard-ingest-metrics-OpenTelemetry-ECS.html , https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonPrometheus/current/ap-northeast-2/index.json
- AMP 사용자 가이드(remote_write 인증) — https://docs.aws.amazon.com/prometheus/latest/userguide/AMP-onboard-ingest-metrics-new-Prometheus.html
- EKS 사용자 가이드 — https://docs.aws.amazon.com/eks/latest/userguide/fargate.html , https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html
- ECS 개발자 가이드(awsvpc, 태스크 정의, Fargate, 배포) — https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-networking-awsvpc.html , https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html , https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html , https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-ecs.html
- ECS 개발자 가이드(서비스 디스커버리, EBS, 애플리케이션 메트릭) — https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-discovery.html , https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ebs-volumes.html , https://docs.aws.amazon.com/AmazonECS/latest/developerguide/application-metrics-prometheus.html
- ECS API 레퍼런스(PortMapping), ECS 스로틀링 문서 — https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_PortMapping.html , https://docs.aws.amazon.com/AmazonECS/latest/APIReference/request-throttling.html
- Route 53 문서, Cloud Map API 문서 — https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-multivalue.html , https://docs.aws.amazon.com/cloud-map/latest/api/API_DnsConfig.html
- CloudWatch agent 문서, 관리형 수집기 문서, Prometheus-on-ECS 문서 — https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/ContainerInsights-Prometheus-Setup-autodiscovery-ecs.html , https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/managed-prometheus-collectors-scraper-configuration.html , https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Solution-Prometheus-On-ECS.html
- ecsobserver README, 소스 — https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.163.0/extension/observer/ecsobserver/README.md , https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.163.0/extension/observer/ecsobserver/config.go
- AWS 운영 블로그(2026-04) — https://aws.amazon.com/blogs/mt/simplifying-prometheus-metrics-collection-across-your-aws-infrastructure
- AWS What's New(CloudWatch managed collector, TGW 보안 그룹 참조) — https://aws.amazon.com/about-aws/whats-new/2026/07/cloudwatch-managed-collectors/ , https://aws.amazon.com/about-aws/whats-new/2024/09/general-availability-security-group-referencing-aws-transit-gateway
- AWS 오픈소스 블로그(2021) — https://aws.amazon.com/blogs/opensource/metrics-collection-from-amazon-ecs-using-amazon-managed-service-for-prometheus
- AWS Containers 블로그(2022) — https://aws.amazon.com/blogs/containers/metrics-and-traces-collection-from-amazon-ecs-using-aws-distro-for-opentelemetry-with-dynamic-service-discovery , https://aws.amazon.com/blogs/containers/introducing-amazon-cloudwatch-container-insights-for-amazon-eks-fargate-using-aws-distro-for-opentelemetry/
- AWS 한국 기술 블로그(2024) — https://aws.amazon.com/ko/blogs/tech/springboot-application-observability-on-amazon-ecs
- KINTO Qiita, HackMD 운영 메모 — https://qiita.com/sokasanan/items/738c69c7f4d6fd47378a , https://hackmd.io/@ForsakenIdol/observability-on-ecs-with-opentelemetry
- teralytics README, signal-ai README, VictoriaMetrics 이슈 — https://github.com/teralytics/prometheus-ecs-discovery , https://github.com/signal-ai/prometheus-ecs-sd , https://github.com/VictoriaMetrics/VictoriaMetrics/issues/10610
