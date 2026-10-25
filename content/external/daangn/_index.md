---
title: "당근"
description: "당근 SRE팀 클러스터 파트를 중심으로 당근 기술 블로그 글 9편과 SRE 밋업·빌더 밋업 발표 24편을 요약한 자료입니다. 쿠버네티스 운영, 배포와 개발자 플랫폼, 네트워크, 옵저버빌리티, 감사, 비용까지 주제별로 찾아볼 수 있습니다."
date: 2026-10-21
weight: 20
comments: false
---

# 당근

## 이 분류에서 찾기 {#section-navigation}

- [기술 블로그]({{< relref "/external/daangn/blog/_index.md" >}})
- [발표 영상]({{< relref "/external/daangn/talks/_index.md" >}})

{{< callout type="info" >}}
**출처**

당근 기술 블로그 9편과 발표 24편을 바탕으로 작성한 요약입니다. 아래에는 원문 제목, 매체나 행사, 게시일, 저자나 발표자(소속)를 적었습니다. 각 링크에서 원문을 확인할 수 있습니다.

**SRE팀 클러스터 파트**

블로그 (Medium 당근 블로그)

- [‘kubectl create pod’를 실행하면 발생하는 일 — kube-apiserver 감사 로그(Audit Log)로 엿보기](https://medium.com/daangn/kubectl-create-pod%EB%A5%BC-%EC%8B%A4%ED%96%89%ED%95%98%EB%A9%B4-%EB%B0%9C%EC%83%9D%ED%95%98%EB%8A%94-%EC%9D%BC-kube-apiserver-%EA%B0%90%EC%82%AC-%EB%A1%9C%EA%B7%B8-audig-log-%EB%A1%9C-%EC%97%BF%EB%B3%B4%EA%B8%B0-6f01487abdda) · Medium 당근 블로그 · 2024-05-07 · Karin (SRE팀 클러스터 파트)
- [쿠버네티스 파드에 Host Network 도입기](https://medium.com/daangn/%EC%BF%A0%EB%B2%84%EB%84%A4%ED%8B%B0%EC%8A%A4-%ED%8C%8C%EB%93%9C%EC%97%90-host-network-%EB%8F%84%EC%9E%85%EA%B8%B0-99b4c02ca490) · Medium 당근 블로그 · 2025-09-25 · Jungsub Shin (SRE팀 클러스터 파트)
- [Job 워크로드를 위한 EKS Node Group 오토스케일링 도입기](https://medium.com/daangn/job-%EC%9B%8C%ED%81%AC%EB%A1%9C%EB%93%9C%EB%A5%BC-%EC%9C%84%ED%95%9C-eks-node-group-%EC%98%A4%ED%86%A0%EC%8A%A4%EC%BC%80%EC%9D%BC%EB%A7%81-%EB%8F%84%EC%9E%85%EA%B8%B0-a6a28376d153) (영문판: [Our Journey to Autoscaling EKS Node Groups for Job Workloads](https://medium.com/daangn/our-journey-to-autoscaling-eks-node-groups-for-job-workloads-e8a6a7ed845e)) · Medium 당근 블로그 · 2026-04-16 · Jungsub Shin (SRE팀 클러스터 파트)

발표 영상 (YouTube 당근 채널)

- [아마존 EKS 업그레이드](https://www.youtube.com/watch?v=4Q8It_UvIws) · 당근마켓 SRE 밋업 1회 · 2021-08-31 · 유정열 (SRE팀 클러스터 파트)
- [당근마켓 gRPC 서비스 운영 노하우](https://www.youtube.com/watch?v=igHrQPzLVRw) · 당근마켓 SRE 밋업 1회 · 2021-08-31 · 배상익 (SRE팀 클러스터 파트)
- [쿠버네티스 멀티 클러스터에서 Addons를 관리하는 방법](https://www.youtube.com/watch?v=tqyj1klizCU) · 당근마켓 SRE 밋업 2회 · 2021-12-02 · 유정열 (SRE팀 클러스터 파트)
- [How to Monitor Karrot Services](https://www.youtube.com/watch?v=3iLTBBC9ZX4) · 당근 SRE 밋업 3회 · 2023-06-27 · 배상익 (SRE팀 클러스터 파트, 자막 기준)
- [Case Study on Reducing Amazon EKS Data Transfer Costs](https://www.youtube.com/watch?v=HPYuFpKJI-E) · 당근 SRE 밋업 3회 · 2023-06-27 · 허진수 (인프라실 SRE팀 클러스터 파트)
- [AlertDelivery: grafana를 활용한 효율적인 알림 시스템 구축](https://www.youtube.com/watch?v=poPZvLi0O08) · 당근 SRE 밋업 3회 · 2023-06-27 · 이시은 (인프라실 SRE팀 클러스터 파트)
- [당근에서 Loki 1년간 운영기](https://www.youtube.com/watch?v=pzvzOmZOKWc) · 당근 SRE 밋업 4회 · 2025-10-10 · 이영훈 (SRE 클러스터 파트)
- [Istio ServiceEntry 자동생성으로 외부 트래픽 가시화하기](https://www.youtube.com/watch?v=Uf4_38HV9JY) · 당근 SRE 밋업 4회 · 2025-10-10 · 이시은 (SRE 클러스터 파트)
- [API 앞단에 CloudFront를 세우다: 더 빠르고 더 단단하게](https://www.youtube.com/watch?v=02UhM4wiSZg) · 당근 SRE 밋업 4회 · 2025-10-10 · 배상익, 홍성택 (영상 설명란 기준)
- [EKS 노드를 재단하는 목수 : 당근의 Karpenter 도입 여정](https://www.youtube.com/watch?v=rmGEMwQIG-A) · 2026 당근 빌더 밋업 · 2026-10-07 · 신정섭 (EKS 클러스터 라이프사이클 담당, 자막 기준)
- [AI 시대의 옵저버빌리티 재설계 : Grafana를 걷어내고, 얼럿은 에이전트에게](https://www.youtube.com/watch?v=UV4-G58NLrw) · 2026 당근 빌더 밋업 · 2026-10-07 · 배상익 (SRE 테크 리드)

**그 밖의 SRE 파트·다른 팀**

블로그 (Medium 당근 블로그)

- [CircleCI에서 GitHub Actions로 이전하며 배포 속도 개선하기](https://medium.com/daangn/circleci%EC%97%90%EC%84%9C-github-actions%EB%A1%9C-%EC%9D%B4%EC%A0%84%ED%95%98%EB%A9%B0-%EB%B0%B0%ED%8F%AC-%EC%86%8D%EB%8F%84-%EA%B0%9C%EC%84%A0%ED%95%98%EA%B8%B0-39fc41617993) · Medium 당근 블로그 · 2022-09-20 · Seungwook Seo (운영개발팀 인턴 서버 개발자)
- [매일 배포하는 팀이 되는 여정(1) — 브랜치 전략 개선하기](https://medium.com/daangn/%EB%A7%A4%EC%9D%BC-%EB%B0%B0%ED%8F%AC%ED%95%98%EB%8A%94-%ED%8C%80%EC%9D%B4-%EB%90%98%EB%8A%94-%EC%97%AC%EC%A0%95-1-%EB%B8%8C%EB%9E%9C%EC%B9%98-%EC%A0%84%EB%9E%B5-%EA%B0%9C%EC%84%A0%ED%95%98%EA%B8%B0-1a1df85b2cff) · Medium 당근 블로그 · 2023-04-07 · Jeremy (당근페이 머니서비스팀)
- [매일 배포하는 팀이 되는 여정(2) — Feature Toggle 활용하기](https://medium.com/daangn/%EB%A7%A4%EC%9D%BC-%EB%B0%B0%ED%8F%AC%ED%95%98%EB%8A%94-%ED%8C%80%EC%9D%B4-%EB%90%98%EB%8A%94-%EC%97%AC%EC%A0%95-2-feature-toggle-%ED%99%9C%EC%9A%A9%ED%95%98%EA%B8%B0-b52c4a1810cd) · Medium 당근 블로그 · 2023-04-10 · Jeremy (당근페이 머니서비스팀)
- [당근마켓 검색 엔진, 쿠버네티스로 쉽게 운영하기](https://medium.com/daangn/%EB%8B%B9%EA%B7%BC%EB%A7%88%EC%BC%93-%EA%B2%80%EC%83%89-%EC%97%94%EC%A7%84-%EC%BF%A0%EB%B2%84%EB%84%A4%ED%8B%B0%EC%8A%A4%EB%A1%9C-%EC%89%BD%EA%B2%8C-%EC%9A%B4%EC%98%81%ED%95%98%EA%B8%B0-bdf2688df267) · Medium 당근 블로그 · 2023-05-09 · Kideok Kim (검색 플랫폼팀)
- [Karpenter 트러블슈팅 — 비용과 안정성 두 마리 토끼 잡기](https://medium.com/daangn/karpenter-%ED%8A%B8%EB%9F%AC%EB%B8%94%EC%8A%88%ED%8C%85-%EB%B9%84%EC%9A%A9%EA%B3%BC-%EC%95%88%EC%A0%95%EC%84%B1-%EB%91%90%EB%A7%88%EB%A6%AC-%ED%86%A0%EB%81%BC-%EC%9E%A1%EA%B8%B0-ce8bd45ec8f2) · Medium 당근 블로그 · 2025-03-27 · Yany Choi (당근페이 인프라팀)
- [당근 검색 엔진, 쿠버네티스로 쉽게 운영하기 2편 — 데이터 노드 웜업 적용](https://medium.com/daangn/%EB%8B%B9%EA%B7%BC-%EA%B2%80%EC%83%89-%EC%97%94%EC%A7%84-%EC%BF%A0%EB%B2%84%EB%84%A4%ED%8B%B0%EC%8A%A4%EB%A1%9C-%EC%89%BD%EA%B2%8C-%EC%9A%B4%EC%98%81%ED%95%98%EA%B8%B0-2%ED%8E%B8-%EB%8D%B0%EC%9D%B4%ED%84%B0-%EB%85%B8%EB%93%9C-%EC%9B%9C%EC%97%85-%EC%A0%81%EC%9A%A9-f687a6c2c00a) (영문판: [Running Elasticsearch on Kubernetes the Easy Way, Part 2: Data Node Warm-up](https://medium.com/daangn/running-elasticsearch-on-kubernetes-the-easy-way-part-2-data-node-warm-up-0d81d433c5c1)) · Medium 당근 블로그 · 2025-12-15 · Dongsun Shin (검색 플랫폼팀)

발표 영상 (YouTube 당근 채널)과 슬라이드

- [AWS Config로 시작하는 컴플라이언스 기반 리소스 관리](https://daangn.notion.site/SRE-c62abc2b6f0347a4ace9ee9cdfc49b6b) (영상 없이 공개 슬라이드만 확인) · 당근마켓 SRE 밋업 1회 · 2021-08-26 · Ozzy (SRE팀, 슬라이드 기준)
- [당근페이, 6개월 간의 인프라 구축 이야기](https://www.youtube.com/watch?v=8a2-b9X7Xno) · 당근마켓 SRE 밋업 2회 · 2021-12-02 · 강진우 (당근페이 SRE팀)
- [당근마켓은 왜 배포 시스템을 만드는가?](https://www.youtube.com/watch?v=pc3H9i6Yv2Y) · 당근마켓 SRE 밋업 2회 · 2021-12-02 · 변정훈 (SRE팀 딜리버리 파트)
- [cdk8s 활용 당근마켓 서비스 배포 탬플릿 만들기](https://www.youtube.com/watch?v=tPEXZI2JO-g) · 당근마켓 SRE 밋업 2회 · 2021-12-02 · 김규환 (SRE팀 딜리버리 파트)
- [당근마켓 개발자 플랫폼: 지난 2년간 무엇을 만들었는가?](https://www.youtube.com/watch?v=JWR8pEPimsY) · 당근 SRE 밋업 3회 · 2023-06-27 · 변정훈 (인프라실 SRE팀 딜리버리 파트)
- [당근마켓 개발자 플랫폼: 전사 배포 시스템을 만들기 전 알았으면 좋았을 것들](https://www.youtube.com/watch?v=7NCsd4Vd8yk) · 당근 SRE 밋업 3회 · 2023-06-27 · 김규환 (인프라실 SRE팀 딜리버리 파트)
- [당근마켓 개발자 플랫폼: 클릭! 클릭! 글로벌로 향하는 멀티 클러스터 지원 스토리](https://www.youtube.com/watch?v=jCT360SJnqA) · 당근 SRE 밋업 3회 · 2023-06-27 · 유병화 (인프라실 SRE팀 딜리버리 파트)
- [당근마켓 개발자 플랫폼: 프로젝트 오너십 관리를 통한 DevOps 기반 만들기](https://www.youtube.com/watch?v=p1MjEInScbw) · 당근 SRE 밋업 3회 · 2023-06-27 · 김효민 (인프라실 SRE팀 클라우드 파트)
- [당근마켓 개발자 플랫폼: (쉽고 빠르고 안전하게) 개발자가 직접 관리하는 클라우드 리소스](https://www.youtube.com/watch?v=Um2CXoD-0QE) · 당근 SRE 밋업 3회 · 2023-06-27 · 김승호 (인프라실 SRE팀 클라우드 파트)
- [HPA Scale-in이 만든 AZ 불균형, Pod Deletion Cost로 바로잡기](https://www.youtube.com/watch?v=_8suLM4lrRo) · 당근 SRE 밋업 4회 · 2025-10-10 · 김규환 (SRE팀 딜리버리 파트)
- [멋진 운영 경험을 위하여: Prometheus 레코딩 룰로 SLI 정하기](https://www.youtube.com/watch?v=f76i29l4aGs) · 당근 SRE 밋업 4회 · 2025-10-10 · 이주원 (SRE팀 클라우드 파트, 자막 기준)
- [나가는 길을 다시 그리다: 당근페이 VPC 재설계](https://www.youtube.com/watch?v=nvSKvrP3Z7Y) · 당근 SRE 밋업 4회 · 2025-10-10 · 최용환 (SRE팀 클라우드 파트)
- [당근 개발자 플랫폼은 어떻게 발전하고 있을까](https://www.youtube.com/watch?v=I1_0-kFghDM) · 당근 SRE 밋업 4회 · 2025-10-10 · 변정훈 (SRE팀 리드)

출처 판단 근거: 클러스터 파트 자료는 [당근 채용 공고](https://careers.daangn.com/jobs/role/5811688003/)가 링크한 자료와, 블로그 저자 소개 및 [SRE 밋업 발표자료 페이지](https://daangn.notion.site/SRE-c62abc2b6f0347a4ace9ee9cdfc49b6b)의 소속 표기로 판단했습니다. 발표자 소속은 각 문서의 원문 정보에 적힌 대로이며, 근거가 자막이면 "자막 기준"이라고 표시했습니다. 그 밖의 묶음은 클러스터 파트가 아니라고 확인된 글과 발표입니다.

확인 범위: 2026-10-21에 당근 Medium 블로그의 전체 글 목록(2015-06~2026-10, 223편)과 SRE 밋업 1~4회 발표 목록을 확인했습니다. SRE 밋업 1회 "AWS VPC PrivateLink를 이용한 네트워크 구성 전략"은 공개된 영상과 슬라이드를 찾지 못해 요약하지 않았습니다.
{{< /callout >}}

## 어떤 주제를 다뤘나

| 주제 | 글·영상 | 한 줄 요약 |
|------|--------|-----------|
| 쿠버네티스 운영·오토스케일링 | [새 EKS 클러스터로 트래픽을 옮겨 버전 업그레이드하기]({{< relref "/external/daangn/talks/sre-meetup-1/01-eks-zero-downtime-upgrade.md" >}}) | 마스터·노드 그룹을 단계별로 올리는 방식과 새 클러스터로 트래픽을 옮기는 방식을 비교하고 1.15에서 1.18까지 한 번에 업그레이드 |
| 쿠버네티스 운영·오토스케일링 | [ApplicationSet으로 여러 EKS 클러스터에 애드온 배포하기]({{< relref "/external/daangn/talks/sre-meetup-2/01-multicluster-addons-argocd.md" >}}) | 새 EKS 클러스터마다 필요한 Addons를 Argo CD ApplicationSet으로 한꺼번에 배포 |
| 쿠버네티스 운영·오토스케일링 | [수동으로 배포하던 Elasticsearch를 ECK로 옮기기]({{< relref "/external/daangn/blog/07-search-engine-on-kubernetes.md" >}}) | EC2 위 Elasticsearch 수동 배포를 ECK 기반으로 바꿔 평균 5시간 걸리던 배포를 자동화 |
| 쿠버네티스 운영·오토스케일링 | [당근페이가 Karpenter 도입 후 해결한 스케줄링과 노드 교체 문제]({{< relref "/external/daangn/blog/08-karpenter-troubleshooting.md" >}}) | ASG 기반 클러스터를 Karpenter로 옮기며 겪은 다섯 가지 문제와 해결 |
| 쿠버네티스 운영·오토스케일링 | [Elasticsearch 노드를 웜업한 뒤 검색 요청에 복귀시키기]({{< relref "/external/daangn/blog/09-search-engine-warmup.md" >}}) | Elasticsearch 롤링 리스타트 때 생기던 지연 급증을 프록시와 데이터 노드 웜업으로 해결 |
| 쿠버네티스 운영·오토스케일링 | [Pod Deletion Cost로 HPA의 AZ 불균형을 줄인 방법]({{< relref "/external/daangn/talks/sre-meetup-4/04-hpa-az-skew-pod-deletion-cost.md" >}}) | Locality LB 때문에 생긴 Zone Skew를 Pod Deletion Cost 컨트롤러로 해결 |
| 쿠버네티스 운영·오토스케일링 | [Job을 중단하지 않고 EKS 노드 그룹 자동 확장·축소하기]({{< relref "/external/daangn/blog/03-job-nodegroup-autoscaling.md" >}}) | 고정 크기이던 Job용 노드 그룹에 오토스케일링을 붙이며 bin-packing 부작용을 maxPods 등으로 해결 |
| 쿠버네티스 운영·오토스케일링 | [필요한 AZ에 노드를 만들기 위한 당근의 Karpenter 전환]({{< relref "/external/daangn/talks/builder-meetup-2026/01-karpenter-adoption.md" >}}) | Cluster Autoscaler에서 Karpenter로 전환해 네임스페이스별 평균 Pending이 최대 4분에서 약 30초로 감소 |
| 배포·개발자 플랫폼 | [당근페이 초기 인프라의 접근 제어·배포·관측 구성]({{< relref "/external/daangn/talks/sre-meetup-2/02-daangnpay-six-months-infra.md" >}}) | 로그인, 서버 접근, 애플리케이션, 배포, 관측, 성능 테스트 여섯 가지를 어떻게 정했는지 회고 |
| 배포·개발자 플랫폼 | [당근이 Argo CD 기반 배포에서 Kontrol을 만든 이유]({{< relref "/external/daangn/talks/sre-meetup-2/03-why-build-deploy-system.md" >}}) | Argo CD와 GitOps 모노레포 방식의 한계를 짚고 사내 배포 시스템 Kontrol을 만든 이유 |
| 배포·개발자 플랫폼 | [cdk8s로 사내 배포 설정을 Kubernetes 매니페스트로 변환하기]({{< relref "/external/daangn/talks/sre-meetup-2/04-cdk8s-deploy-template.md" >}}) | 배포 매니페스트를 Kubernetes 매니페스트로 바꾸는 도구로 Helm 대신 cdk8s와 TypeScript를 고른 이유 |
| 배포·개발자 플랫폼 | [GitHub Actions 이전과 Docker 캐시로 배포 시간을 줄인 과정]({{< relref "/external/daangn/blog/04-circleci-to-github-actions.md" >}}) | Docker layer caching과 Dockerfile 순서 조정으로 15분이 넘던 배포를 약 2분까지 단축 |
| 배포·개발자 플랫폼 | [GitHub Flow로 바꾸고 매일 배포하기까지]({{< relref "/external/daangn/blog/05-daily-deploy-branch-strategy.md" >}}) | Git Flow 주 1회 배포에서 GitHub Flow로 옮겨 배포에 쓰던 1시간을 20분 미만으로 단축 |
| 배포·개발자 플랫폼 | [코드 배포와 기능 공개를 분리한 당근페이 Feature Toggle]({{< relref "/external/daangn/blog/06-daily-deploy-feature-toggle.md" >}}) | 어노테이션 기반 Feature Toggle을 직접 만든 과정과 설계 원칙 다섯 가지, 권한·카나리 토글 운영 |
| 배포·개발자 플랫폼 | [개발자가 직접 배포하고 운영하는 플랫폼, Kontrol의 2년]({{< relref "/external/daangn/talks/sre-meetup-3/01-developer-platform-two-years.md" >}}) | 인프라 요청 티켓의 한계에서 출발해 배포, 오너십, 비용, 리소스 생성을 하나의 UI로 묶어 온 과정 |
| 배포·개발자 플랫폼 | [전사 배포 플랫폼이 팀의 작업 방식을 받아들이는 법]({{< relref "/external/daangn/talks/sre-meetup-3/02-deployment-system-lessons.md" >}}) | Kontrol을 2년간 만들며 얻은 교훈. 이해관계 충돌, 포장도로와 비포장도로 구조, 운영 컨텍스트 제공 |
| 배포·개발자 플랫폼 | [Kontrol로 4개 리전을 배포하기까지의 설계 선택]({{< relref "/external/daangn/talks/sre-meetup-3/03-multi-cluster-global-deploy.md" >}}) | 4개 리전 글로벌 배포를 붙인 과정과 배포 엔진을 Argo Workflows로 바꾼 결정 |
| 배포·개발자 플랫폼 | [클라우드 리소스의 담당 팀을 한곳에서 찾는 katalog]({{< relref "/external/daangn/talks/sre-meetup-3/04-project-ownership-katalog.md" >}}) | Kontrol 프로젝트를 오너십 단위로 삼아 AWS와 GCP 리소스를 하나의 ID로 묶은 과정 |
| 배포·개발자 플랫폼 | [Terraform 요청을 개발자 셀프 서비스로 바꾼 KRP]({{< relref "/external/daangn/talks/sre-meetup-3/05-developer-managed-cloud-resources.md" >}}) | Terraform state 약 1000개를 운영하는 부담에서 출발해 Redis 생성과 수정을 개발자가 UI에서 직접 하게 만든 과정 |
| 배포·개발자 플랫폼 | [배포 도구에서 사내 개발자 플랫폼으로 확장한 Kontrol]({{< relref "/external/daangn/talks/sre-meetup-4/07-developer-platform-evolution.md" >}}) | 배포 도구로 시작해 워크로드, 설정, 클라우드 리소스, 비용까지 넓어진 Kontrol을 화면 중심으로 소개 |
| 네트워크·서비스 메시·엣지 | [당근의 gRPC 운영: 연결 관리와 요청 분산, 장애 지표]({{< relref "/external/daangn/talks/sre-meetup-1/02-grpc-operations.md" >}}) | 채널과 HTTP/2 연결의 관계, keepalive, 상태 코드, L7 로드밸런싱, 모니터링 지표를 당근의 구성과 함께 설명 |
| 네트워크·서비스 메시·엣지 | [DaemonSet과 Job에 hostNetwork를 적용해 IP 사용과 대기 줄이기]({{< relref "/external/daangn/blog/02-host-network.md" >}}) | DaemonSet의 IP 점유와 Job Pod의 IP 할당 지연을 hostNetwork로 줄여 IP 할당 실패 이벤트를 시간당 약 13,000건에서 약 50건으로 감소 |
| 네트워크·서비스 메시·엣지 | [CoreDNS 로그로 ServiceEntry를 생성해 외부 HTTPS 호출 관측하기]({{< relref "/external/daangn/talks/sre-meetup-4/02-istio-serviceentry.md" >}}) | CoreDNS 로그에서 호출 도메인을 뽑아 ServiceEntry를 자동으로 만들어 Mesh 외부 트래픽을 L4로 가시화 |
| 네트워크·서비스 메시·엣지 | [API 앞에 CloudFront를 두고 연결 지연과 전송 비용 줄이기]({{< relref "/external/daangn/talks/sre-meetup-4/03-cloudfront-in-front-of-api.md" >}}) | 캐나다 initial connection 시간 중앙값 45% 감소, 트래픽 비용 약 20% 절감, WAF와 Shield로 보안 보강 |
| 네트워크·서비스 메시·엣지 | [당근페이가 NAT와 방화벽을 Network VPC로 모은 과정]({{< relref "/external/daangn/talks/sre-meetup-4/06-daangnpay-vpc-redesign.md" >}}) | 흩어진 NAT Gateway와 Transit Gateway를 Network VPC로 모으고 NACL을 AWS Network Firewall로 교체 |
| 옵저버빌리티·알림 | [서비스 400개에 공통 모니터링을 제공한 방법]({{< relref "/external/daangn/talks/sre-meetup-3/06-monitoring-karrot-services.md" >}}) | 공통 모니터링 영역을 정하고 USE·RED 방법론을 Prometheus와 Grafana 대시보드로 구현해 Alert Delivery와 연결 |
| 옵저버빌리티·알림 | [Grafana 알림을 담당 팀별 메시지로 바꾼 AlertDelivery]({{< relref "/external/daangn/talks/sre-meetup-3/08-alertdelivery-grafana.md" >}}) | Grafana 레거시 알림이 여러 네임스페이스를 한 메시지로 보내는 한계를 katalog 담당자 정보와 알림별 정책으로 해결 |
| 옵저버빌리티·알림 | [Loki 로그 유실과 느린 조회를 줄인 당근의 운영 과정]({{< relref "/external/daangn/talks/sre-meetup-4/01-loki-one-year.md" >}}) | 로그 유실의 원인을 수집기 병목과 CPU 스로틀링에서 찾았고 느린 쿼리 기준 조회 속도가 약 50% 개선 |
| 옵저버빌리티·알림 | [팀이 합의한 Redis SLI를 Prometheus 레코딩 룰로 제공하기]({{< relref "/external/daangn/talks/sre-meetup-4/05-prometheus-recording-rule-sli.md" >}}) | Redis 자원의 SLI를 팀 설문과 논의로 정하고 조회 API 방식에서 레코딩 룰 방식으로 이전 |
| 옵저버빌리티·알림 | [장애 원인 분석 시간을 줄이려는 당근의 관측 플랫폼과 Doctor Agent]({{< relref "/external/daangn/talks/builder-meetup-2026/02-observability-agents.md" >}}) | 올해 3월 약 50분 장애에서 원인 파악이 오래 걸린 경험에서 출발해 자체 웹 플랫폼과 Doctor Agent를 개발 중 |
| 보안·감사·거버넌스 | [사내 운영 규칙을 AWS Config로 검사하고 보고하기]({{< relref "/external/daangn/talks/sre-meetup-1/03-aws-config-compliance.md" >}}) | Rule과 Conformance Pack, RDK, 사내 Rulebook 연동과 써 보며 느낀 한계를 슬라이드 기준으로 정리 |
| 보안·감사·거버넌스 | [EKS 감사 로그로 따라가는 Pod 생성 과정]({{< relref "/external/daangn/blog/01-kube-apiserver-audit-log.md" >}}) | Pod 하나를 만들 때 컨트롤 플레인 컴포넌트가 호출하는 API를 EKS 감사 로그로 따라가는 입문 해설 |
| 비용 | [EKS 크로스 AZ 호출을 줄여 전송 비용을 절반 이하로 낮추기]({{< relref "/external/daangn/talks/sre-meetup-3/07-eks-data-transfer-cost.md" >}}) | Istio Locality Load Balancing과 Topology Aware Hints로 호출이 같은 가용 영역 안에서 끝나게 해 크로스존 비용 절감 |

2021년 발표는 배포 시스템과 개발자 플랫폼에서 시작합니다. EKS 업그레이드와 멀티 클러스터 Addons 관리, Argo CD와 cdk8s 기반 배포가 이 시기의 주제입니다. 2023년에는 Kontrol이 멀티 클러스터 글로벌 배포와 오너십 관리, 개발자가 직접 쓰는 리소스 플랫폼으로 넓어졌고, 같은 행사에서 모니터링과 Alert Delivery, EKS 데이터 전송 비용 절감도 함께 다뤘습니다. 2025년 발표는 Loki 운영과 외부 트래픽 가시화, CloudFront, AZ 불균형, VPC 재설계처럼 운영 중에 드러난 비용과 네트워크 문제로 옮겨 갑니다. 2026년 빌더 밋업에서는 Karpenter 전환과 함께, 장애 분석과 알림을 에이전트에게 맡기려는 옵저버빌리티 재설계가 나옵니다.

여러 글이 비슷한 순서를 따릅니다. Pending 시간, IP 할당 실패, 로그 유실, Zone Skew처럼 수치로 보이는 증상을 먼저 잡고, 병목을 좁힌 뒤 설정이나 구조를 바꿉니다. 바꾼 결과가 새 문제로 이어지는 대목도 자주 나옵니다. 이 분류의 글과 영상을 함께 읽으면 그 과정을 같은 조직의 여러 시기에 걸쳐 따라갈 수 있습니다.
