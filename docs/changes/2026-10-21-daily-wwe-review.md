# 2026-10-21 게시글 전면 재작성

게시일(`date`)이 2026-10-21인 게시글 54편의 제목, 설명, 소제목과 본문을 재작성했다. 분류 페이지 10개에서는 제목 링크 81곳과 안내 문구를 함께 수정했다.

## 대상과 기준

| 분류 | 게시글 수 |
|---|---:|
| 당근 기술 블로그 요약 | 9 |
| 당근 SRE·빌더 밋업 요약 | 24 |
| Kubernetes GPU | 11 |
| 블록 스토리지 04–08 | 5 |
| GPU 스토리지 01–03 | 3 |
| Prometheus·VictoriaMetrics 비교와 멀티클러스터 구성 | 2 |
| 합계 | 54 |

사용자가 지정한 로컬 WWE 스킬(`/home/mont/evejuni/skills/wwe/SKILL.md`, v1.7.1)의 구조 재작성 경로를 적용했다. `structure-editing.md`, `korean-clarity.md`, `author-tics.txt`, `slop-lexicon.txt`를 함께 참조했다.

반복되는 질문형 도입, 추상적인 제목, 과도한 대비, 비유와 번역투를 줄였다. 글마다 설명해야 할 문제를 앞에 놓고 동작·선택 조건·운영 결과가 이어지도록 구성했다. 기술 명칭과 측정 조건은 구체적으로 남겼다. 원문이 추정이나 종합 판단으로 한정한 문장은 그 수준을 유지했다.

발표 요약은 반복되던 틀을 발표별 쟁점에 맞춰 다시 구성하고, 영상의 주요 구간은 본문 뒤로 옮겼다. 원문 제목·발표자·소속·게시일·근거 자료의 종류는 출처 정보에 남겼다. 기술 시리즈는 코드·근거 표·도식의 연결을 유지하면서 문단과 소제목을 다시 작성했다. Metrics 두 글은 단일 노드 비교와 여러 클러스터의 배치·장애 대응을 각각 설명하도록 정리했다.

## 보존과 검증

- 54편 모두 `title`·`description` 외 frontmatter, 코드 블록, 외부 URL 집합, 도식 데이터, 구조용 shortcode가 원문과 같다. 내부 `relref` 대상도 같다. 최신 GPU 본문의 내부 링크와 기술 조건도 그대로 보존했다.
- 수치 차이 진단은 단위 표기·한글 수 표현·중복 설명을 대조해 확인했다. 측정값과 조건, 버전, 명령어와 설정값을 보존했다.
- 소제목 변경에 따른 링크 손실을 막기 위해 기존 Hugo 출력의 ID를 확인했다. 직접 변경한 소제목 171곳에 기존 ID를 지정했다. 최신 원문을 기준으로 대조한 소제목 ID는 357개다. 작업 시작 시점의 소제목 ID까지 합쳐 최종 출력에서 357개가 모두 한 번씩 존재함을 확인했다.
- 직접 재작성한 후보는 서로 다른 작성자가 의미 보존을 교차 검토했다. 기술 동작의 단정 수준, 벤더 주장과 종합 판단, 발표 당시 운영·시연·개발 중·계획을 구분했다.
- Hugo Extended 0.166.0 빌드 통과: 726 pages.
- 탐색 검사 통과: HTML 372개, 생성 경로·리소스 1,829개, 기존 출력과 비교한 URL·내부 참조·canonical·사이드바 상태.
- 탐색 검사 도구의 단위 테스트 17개 통과.
- `git diff --check` 통과.

WWE의 반복 구절은 후보 본문에서 문자열로 찾아 문맥을 검토했다. `실은`이 `사실은`·`손실은` 안에서 검출되는 경우와 실제 기록 동작을 설명하는 `남깁니다`는 오탐·허용 용례로 구분했다. 조건을 제한하는 접속어를 횟수만 줄이기 위해 삭제하지 않았다. 공식 반복 분석 스크립트의 합본 실행은 장시간 완료되지 않아 종료했으며, 그 실행을 통과한 것으로 집계하지 않았다.

## 검토 중 바로잡은 부분

- 검색 엔진 1편은 검색 클러스터를 8개로 설명하지만 2편의 비교 표에는 1개에서 4개로 증가했다고 적혀 있다. 두 수치가 같은 지역·환경을 센 것인지 확인되지 않으므로, 2편에 비교 범위가 불명확하다는 설명을 추가했다.
- Linux NVMe/TCP 글의 패키지 버전 표는 `nvme-stas` 자료였다. 타깃 설정 도구 `nvmetcli`와 혼동하지 않도록 행 제목에 패키지 이름을 명시했다.
- 블록 스토리지 목록에 남아 있던 Windows 중심 소개를 최신 05편의 Kubernetes CSI·Linux 내용에 맞췄다.

이번 검토는 제공된 원문을 재작성하고 의미를 보존하는 작업이다. 모든 외부 출처를 새로 조사한 결과는 아니다. 원문에서 미확인으로 둔 지원 범위와 측정 조건은 그대로 남아 있다.

## 동시 작업 보존

편집 중 변경된 스토리지·Metrics 원문은 최신 파일로 별도 스냅샷을 만든 뒤 다시 작성했다. 최종 적용 직전 GPU 11편이 `1cbb3f2`에서 Astra의 전면 구조 편집과 기술 조건 보정을 거쳤다. 이 11편은 최신 본문을 그대로 보존하고 이번 작업의 제목·설명·H1을 합쳤다. GPU 목록 페이지도 최신 구조에 새 제목을 반영했다. 해당 구조 편집의 검증 내용은 [GPU Astra 검토 기록](2026-10-21-gpu-astra-review.md)에 있다. 적용 직전 각 원문의 SHA-256을 대조했다. 게시일이 2026-10-22인 새 글과 다른 작업의 변경 내역은 대상에서 제외했다.

원문·후보·헤딩 대응·의미 검토·보존 검사 기록은 `_workspace/structure-2026-10-21-all-posts-wwe/`에 있다. 갱신된 원문의 기록은 같은 접두어의 `-refresh`, `-refresh2`, `-refresh3` 디렉터리에 있다.

## 제목 변경 목록

| 파일 | 이전 제목 | 새 제목 |
|---|---|---|
| [data/block-storage/04-enterprise-transports/index.md](../../content/data/block-storage/04-enterprise-transports/index.md) | 2026년 어레이 벤더가 NVMe/TCP를 기본으로 미는 이유 | 엔터프라이즈 어레이의 전송 선택: NVMe/TCP가 기본이 된 배경 |
| [data/block-storage/05-host-side-and-cloud/index.md](../../content/data/block-storage/05-host-side-and-cloud/index.md) | Kubernetes에서 NVMe-oF를 어디까지 쓸 수 있나 | Kubernetes NVMe-oF 지원 범위와 노드·클라우드 조건 |
| [data/block-storage/06-linux-nvme-tcp-operations/index.md](../../content/data/block-storage/06-linux-nvme-tcp-operations/index.md) | Linux NVMe/TCP의 연결과 장애 대응을 구성하는 법 | Linux NVMe/TCP 운영: 연결 자동화와 장애 정책 |
| [data/block-storage/07-fc-tcp-rdma-transports/index.md](../../content/data/block-storage/07-fc-tcp-rdma-transports/index.md) | NVMe over FC·TCP·RDMA의 성능과 안정성 비교 | NVMe-oF 전송 선택: FC·TCP·RDMA의 조건과 근거 |
| [data/block-storage/08-kubernetes-nvmeof-mayastor/index.md](../../content/data/block-storage/08-kubernetes-nvmeof-mayastor/index.md) | Kubernetes NVMe-oF 선택지와 Mayastor의 도입 조건 | Kubernetes NVMe-oF: Mayastor를 도입할 조건 |
| [data/gpu-storage/01-workload-io-patterns/index.md](../../content/data/gpu-storage/01-workload-io-patterns/index.md) | GPU 스토리지 요구는 읽기 경로와 쓰기 방식에 따라 달라진다 | GPU 워크로드의 I/O 요구: 데이터 읽기부터 체크포인트와 캐시까지 |
| [data/gpu-storage/02-data-path-and-filesystems/index.md](../../content/data/gpu-storage/02-data-path-and-filesystems/index.md) | GPU 스토리지의 병목을 파일 접근과 전송 경로로 읽는 법 | GPU 스토리지 데이터 경로와 파일시스템 선택 기준 |
| [data/gpu-storage/03-managed-object-kubernetes/index.md](../../content/data/gpu-storage/03-managed-object-kubernetes/index.md) | GPU 체크포인트 저장 방식으로 보는 병렬 파일시스템의 필요성 | GPU 체크포인트를 위한 병렬 파일시스템·오브젝트·Kubernetes 선택 |
| [external/daangn/blog/01-kube-apiserver-audit-log.md](../../content/external/daangn/blog/01-kube-apiserver-audit-log.md) | kubectl create pod 뒤에 일어나는 일: kube-apiserver 감사 로그로 보기 | EKS 감사 로그로 따라가는 Pod 생성 과정 |
| [external/daangn/blog/02-host-network.md](../../content/external/daangn/blog/02-host-network.md) | 쿠버네티스 파드에 Host Network 도입기 | DaemonSet과 Job에 hostNetwork를 적용해 IP 사용과 대기 줄이기 |
| [external/daangn/blog/03-job-nodegroup-autoscaling.md](../../content/external/daangn/blog/03-job-nodegroup-autoscaling.md) | Job 워크로드를 위한 EKS Node Group 오토스케일링 도입기 | Job을 중단하지 않고 EKS 노드 그룹 자동 확장·축소하기 |
| [external/daangn/blog/04-circleci-to-github-actions.md](../../content/external/daangn/blog/04-circleci-to-github-actions.md) | CircleCI에서 GitHub Actions로 이전하며 배포 속도 개선하기 | GitHub Actions 이전과 Docker 캐시로 배포 시간을 줄인 과정 |
| [external/daangn/blog/05-daily-deploy-branch-strategy.md](../../content/external/daangn/blog/05-daily-deploy-branch-strategy.md) | 매일 배포하는 팀이 되는 여정(1) — 브랜치 전략 개선하기 | GitHub Flow로 바꾸고 매일 배포하기까지 |
| [external/daangn/blog/06-daily-deploy-feature-toggle.md](../../content/external/daangn/blog/06-daily-deploy-feature-toggle.md) | 매일 배포하는 팀이 되는 여정(2) — Feature Toggle 활용하기 | 코드 배포와 기능 공개를 분리한 당근페이 Feature Toggle |
| [external/daangn/blog/07-search-engine-on-kubernetes.md](../../content/external/daangn/blog/07-search-engine-on-kubernetes.md) | 당근마켓 검색 엔진, 쿠버네티스로 쉽게 운영하기 | 수동으로 배포하던 Elasticsearch를 ECK로 옮기기 |
| [external/daangn/blog/08-karpenter-troubleshooting.md](../../content/external/daangn/blog/08-karpenter-troubleshooting.md) | Karpenter 트러블슈팅 — 비용과 안정성 두 마리 토끼 잡기 | 당근페이가 Karpenter 도입 후 해결한 스케줄링과 노드 교체 문제 |
| [external/daangn/blog/09-search-engine-warmup.md](../../content/external/daangn/blog/09-search-engine-warmup.md) | 당근 검색 엔진, 쿠버네티스로 쉽게 운영하기 2편 — 데이터 노드 웜업 적용 | Elasticsearch 노드를 웜업한 뒤 검색 요청에 복귀시키기 |
| [external/daangn/talks/builder-meetup-2026/01-karpenter-adoption.md](../../content/external/daangn/talks/builder-meetup-2026/01-karpenter-adoption.md) | EKS 노드를 재단하는 목수: 당근의 Karpenter 도입 여정 | 필요한 AZ에 노드를 만들기 위한 당근의 Karpenter 전환 |
| [external/daangn/talks/builder-meetup-2026/02-observability-agents.md](../../content/external/daangn/talks/builder-meetup-2026/02-observability-agents.md) | AI 시대의 옵저버빌리티 재설계: Grafana를 걷어내고, 얼럿은 에이전트에게 | 장애 원인 분석 시간을 줄이려는 당근의 관측 플랫폼과 Doctor Agent |
| [external/daangn/talks/sre-meetup-1/01-eks-zero-downtime-upgrade.md](../../content/external/daangn/talks/sre-meetup-1/01-eks-zero-downtime-upgrade.md) | 아마존 EKS 무중단 업그레이드 | 새 EKS 클러스터로 트래픽을 옮겨 버전 업그레이드하기 |
| [external/daangn/talks/sre-meetup-1/02-grpc-operations.md](../../content/external/daangn/talks/sre-meetup-1/02-grpc-operations.md) | 실전! gRPC 서비스 운영 노하우 | 당근의 gRPC 운영: 연결 관리와 요청 분산, 장애 지표 |
| [external/daangn/talks/sre-meetup-1/03-aws-config-compliance.md](../../content/external/daangn/talks/sre-meetup-1/03-aws-config-compliance.md) | AWS Config로 시작하는 컴플라이언스 기반 리소스 관리 | 사내 운영 규칙을 AWS Config로 검사하고 보고하기 |
| [external/daangn/talks/sre-meetup-2/01-multicluster-addons-argocd.md](../../content/external/daangn/talks/sre-meetup-2/01-multicluster-addons-argocd.md) | 쿠버네티스 멀티 클러스터에서 Addons를 관리하는 방법 | ApplicationSet으로 여러 EKS 클러스터에 애드온 배포하기 |
| [external/daangn/talks/sre-meetup-2/02-daangnpay-six-months-infra.md](../../content/external/daangn/talks/sre-meetup-2/02-daangnpay-six-months-infra.md) | 당근페이, 6개월 간의 인프라 구축 이야기 | 당근페이 초기 인프라의 접근 제어·배포·관측 구성 |
| [external/daangn/talks/sre-meetup-2/03-why-build-deploy-system.md](../../content/external/daangn/talks/sre-meetup-2/03-why-build-deploy-system.md) | 당근마켓은 왜 배포 시스템을 만드는가? | 당근이 Argo CD 기반 배포에서 Kontrol을 만든 이유 |
| [external/daangn/talks/sre-meetup-2/04-cdk8s-deploy-template.md](../../content/external/daangn/talks/sre-meetup-2/04-cdk8s-deploy-template.md) | 당근마켓 서비스를 cdk8s를 활용해 쿠버네티스에 배포하기 | cdk8s로 사내 배포 설정을 Kubernetes 매니페스트로 변환하기 |
| [external/daangn/talks/sre-meetup-3/01-developer-platform-two-years.md](../../content/external/daangn/talks/sre-meetup-3/01-developer-platform-two-years.md) | 개발자 플랫폼 Kontrol: 지난 2년간 무엇을 만들었는가 | 개발자가 직접 배포하고 운영하는 플랫폼, Kontrol의 2년 |
| [external/daangn/talks/sre-meetup-3/02-deployment-system-lessons.md](../../content/external/daangn/talks/sre-meetup-3/02-deployment-system-lessons.md) | 전사 배포 시스템을 만들기 전 알았으면 좋았을 것들 | 전사 배포 플랫폼이 팀의 작업 방식을 받아들이는 법 |
| [external/daangn/talks/sre-meetup-3/03-multi-cluster-global-deploy.md](../../content/external/daangn/talks/sre-meetup-3/03-multi-cluster-global-deploy.md) | 클릭 몇 번으로 글로벌 배포: Kontrol 멀티 클러스터 지원기 | Kontrol로 4개 리전을 배포하기까지의 설계 선택 |
| [external/daangn/talks/sre-meetup-3/04-project-ownership-katalog.md](../../content/external/daangn/talks/sre-meetup-3/04-project-ownership-katalog.md) | 프로젝트 오너십 관리로 DevOps 기반 만들기: katalog | 클라우드 리소스의 담당 팀을 한곳에서 찾는 katalog |
| [external/daangn/talks/sre-meetup-3/05-developer-managed-cloud-resources.md](../../content/external/daangn/talks/sre-meetup-3/05-developer-managed-cloud-resources.md) | 개발자가 직접 관리하는 클라우드 리소스: KRP | Terraform 요청을 개발자 셀프 서비스로 바꾼 KRP |
| [external/daangn/talks/sre-meetup-3/06-monitoring-karrot-services.md](../../content/external/daangn/talks/sre-meetup-3/06-monitoring-karrot-services.md) | 당근마켓 서비스를 모니터링하는 방법 | 서비스 400개에 공통 모니터링을 제공한 방법 |
| [external/daangn/talks/sre-meetup-3/07-eks-data-transfer-cost.md](../../content/external/daangn/talks/sre-meetup-3/07-eks-data-transfer-cost.md) | Amazon EKS 데이터 전송 비용 절감 사례 | EKS 크로스 AZ 호출을 줄여 전송 비용을 절반 이하로 낮추기 |
| [external/daangn/talks/sre-meetup-3/08-alertdelivery-grafana.md](../../content/external/daangn/talks/sre-meetup-3/08-alertdelivery-grafana.md) | AlertDelivery: Grafana 알림을 네임스페이스별로 나누다 | Grafana 알림을 담당 팀별 메시지로 바꾼 AlertDelivery |
| [external/daangn/talks/sre-meetup-4/01-loki-one-year.md](../../content/external/daangn/talks/sre-meetup-4/01-loki-one-year.md) | 당근에서 Loki 1년간 운영기 | Loki 로그 유실과 느린 조회를 줄인 당근의 운영 과정 |
| [external/daangn/talks/sre-meetup-4/02-istio-serviceentry.md](../../content/external/daangn/talks/sre-meetup-4/02-istio-serviceentry.md) | Istio ServiceEntry 자동생성으로 외부 트래픽 가시화하기 | CoreDNS 로그로 ServiceEntry를 생성해 외부 HTTPS 호출 관측하기 |
| [external/daangn/talks/sre-meetup-4/03-cloudfront-in-front-of-api.md](../../content/external/daangn/talks/sre-meetup-4/03-cloudfront-in-front-of-api.md) | API 앞단에 CloudFront를 세우다 | API 앞에 CloudFront를 두고 연결 지연과 전송 비용 줄이기 |
| [external/daangn/talks/sre-meetup-4/04-hpa-az-skew-pod-deletion-cost.md](../../content/external/daangn/talks/sre-meetup-4/04-hpa-az-skew-pod-deletion-cost.md) | HPA Scale-in이 만든 AZ 불균형, Pod Deletion Cost로 바로잡기 | Pod Deletion Cost로 HPA의 AZ 불균형을 줄인 방법 |
| [external/daangn/talks/sre-meetup-4/05-prometheus-recording-rule-sli.md](../../content/external/daangn/talks/sre-meetup-4/05-prometheus-recording-rule-sli.md) | 멋진 운영 경험을 위하여: Prometheus 레코딩 룰로 SLI 정하기 | 팀이 합의한 Redis SLI를 Prometheus 레코딩 룰로 제공하기 |
| [external/daangn/talks/sre-meetup-4/06-daangnpay-vpc-redesign.md](../../content/external/daangn/talks/sre-meetup-4/06-daangnpay-vpc-redesign.md) | 나가는 길을 다시 그리다: 당근페이 VPC 재설계 | 당근페이가 NAT와 방화벽을 Network VPC로 모은 과정 |
| [external/daangn/talks/sre-meetup-4/07-developer-platform-evolution.md](../../content/external/daangn/talks/sre-meetup-4/07-developer-platform-evolution.md) | 당근 개발자 플랫폼은 어떻게 발전하고 있을까 | 배포 도구에서 사내 개발자 플랫폼으로 확장한 Kontrol |
| [observability/metrics/prometheus-vs-victoriametrics-multi-cluster/index.md](../../content/observability/metrics/prometheus-vs-victoriametrics-multi-cluster/index.md) | 멀티클러스터 메트릭: Thanos와 VictoriaMetrics 구성 | 여러 클러스터의 메트릭을 모으는 Thanos와 VictoriaMetrics 구성 |
| [observability/metrics/prometheus-vs-victoriametrics/index.md](../../content/observability/metrics/prometheus-vs-victoriametrics/index.md) | 대규모 메트릭 운영, Prometheus와 VictoriaMetrics 중 무엇을 고를까 | Prometheus와 VictoriaMetrics의 확장 방식과 운영 비용 비교 |
| [platform/kubernetes/gpu/01-node-topology/index.md](../../content/platform/kubernetes/gpu/01-node-topology/index.md) | 01 GPU 조합이 성능을 바꾸는 조건 | 01 GPU 연결 구조와 노드 토폴로지 읽기 |
| [platform/kubernetes/gpu/02-allocation-device-plugin/index.md](../../content/platform/kubernetes/gpu/02-allocation-device-plugin/index.md) | 02 요청한 GPU는 누가 골라 주는가 | 02 Kubernetes는 요청한 GPU를 어떻게 고르는가 |
| [platform/kubernetes/gpu/03-allocation-dra/index.md](../../content/platform/kubernetes/gpu/03-allocation-dra/index.md) | 03 GPU 할당에 DRA가 필요한 때 — 개수는 device plugin, 노드 간 NVLink는 ComputeDomain | 03 GPU 할당을 DRA로 옮길 시점 |
| [platform/kubernetes/gpu/04-scheduling-labels-kueue/index.md](../../content/platform/kubernetes/gpu/04-scheduling-labels-kueue/index.md) | 04 학습 잡을 가까운 노드에 모으려면 — 토폴로지 라벨과 Kueue TAS | 04 분산 학습 잡을 가까운 노드에 배치하는 법 |
| [platform/kubernetes/gpu/05-scheduling-volcano-kai-slurm/index.md](../../content/platform/kubernetes/gpu/05-scheduling-volcano-kai-slurm/index.md) | 05 노드 간 스케줄링 2부 — Volcano·KAI·Slurm 비교 | 05 노드 간 스케줄링 2부: Volcano·KAI·Slurm 선택 |
| [platform/kubernetes/gpu/06-gpudirect-rdma-basics/index.md](../../content/platform/kubernetes/gpu/06-gpudirect-rdma-basics/index.md) | 06 GPUDirect RDMA 1부 — 파드의 NIC이 GPU 메모리에 닿는 조건과 준비 | 06 GPUDirect RDMA 1부: 파드에서 쓰기 위한 조건 |
| [platform/kubernetes/gpu/07-gpudirect-rdma-operations/index.md](../../content/platform/kubernetes/gpu/07-gpudirect-rdma-operations/index.md) | 07 GPUDirect RDMA가 실제로 쓰이는지 확인하고 클라우드별 차이를 읽기 | 07 GPUDirect RDMA 경로를 검증하고 성능 저하를 추적하는 법 |
| [platform/kubernetes/gpu/08-storage-gds-nvmeof/index.md](../../content/platform/kubernetes/gpu/08-storage-gds-nvmeof/index.md) | 08 스토리지 — GDS와 NVMe-oF의 CPU 우회 범위 | 08 GDS와 NVMe-oF는 CPU 작업을 어디까지 줄이는가 |
| [platform/kubernetes/gpu/09-storage-reality/index.md](../../content/platform/kubernetes/gpu/09-storage-reality/index.md) | 09 스토리지 — 학습·추론의 GDS 활용과 패브릭 분리 | 09 학습과 추론에서 GDS가 필요한 지점을 고르는 법 |
| [platform/kubernetes/gpu/10-provider-fabric-config/index.md](../../content/platform/kubernetes/gpu/10-provider-fabric-config/index.md) | 10 제공자가 GPU 파드보다 먼저 맞추는 NVLink·패브릭 설정 | 10 GPU 클러스터 제공자를 위한 NVLink·네트워크 패브릭 설정 |
| [platform/kubernetes/gpu/11-provider-validation-tenancy/index.md](../../content/platform/kubernetes/gpu/11-provider-validation-tenancy/index.md) | 11 GPU 클러스터를 사용자에게 내주기 위한 조건 | 11 GPU 클러스터 인수 검증과 테넌트 격리 기준 |
