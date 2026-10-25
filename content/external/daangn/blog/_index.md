---
title: "기술 블로그"
description: "Medium 당근 블로그 글 9편의 요약입니다. SRE팀 클러스터 파트가 쓴 3편과 CI/CD, 배포 문화, 검색 엔진, Karpenter를 다룬 다른 팀의 6편을 최근 게시일부터 정리했습니다."
date: 2026-10-21
weight: 10
comments: false
---

# 기술 블로그

## 이 분류에서 찾기 {#section-navigation}

- [Job을 중단하지 않고 EKS 노드 그룹 자동 확장·축소하기 (클러스터 파트, 2026-04)]({{< relref "/external/daangn/blog/03-job-nodegroup-autoscaling.md" >}})
- [Elasticsearch 노드를 웜업한 뒤 검색 요청에 복귀시키기 (2025-12)]({{< relref "/external/daangn/blog/09-search-engine-warmup.md" >}})
- [DaemonSet과 Job에 hostNetwork를 적용해 IP 사용과 대기 줄이기 (클러스터 파트, 2025-09)]({{< relref "/external/daangn/blog/02-host-network.md" >}})
- [당근페이가 Karpenter 도입 후 해결한 스케줄링과 노드 교체 문제 (2025-03)]({{< relref "/external/daangn/blog/08-karpenter-troubleshooting.md" >}})
- [EKS 감사 로그로 따라가는 Pod 생성 과정 (클러스터 파트, 2024-05)]({{< relref "/external/daangn/blog/01-kube-apiserver-audit-log.md" >}})
- [수동으로 배포하던 Elasticsearch를 ECK로 옮기기 (2023-05)]({{< relref "/external/daangn/blog/07-search-engine-on-kubernetes.md" >}})
- [코드 배포와 기능 공개를 분리한 당근페이 Feature Toggle (2023-04)]({{< relref "/external/daangn/blog/06-daily-deploy-feature-toggle.md" >}})
- [GitHub Flow로 바꾸고 매일 배포하기까지 (2023-04)]({{< relref "/external/daangn/blog/05-daily-deploy-branch-strategy.md" >}})
- [GitHub Actions 이전과 Docker 캐시로 배포 시간을 줄인 과정 (2022-09)]({{< relref "/external/daangn/blog/04-circleci-to-github-actions.md" >}})

최근 게시일부터 차례로 놓았습니다. 클러스터 파트 표시가 붙은 세 편은 SRE팀 클러스터 파트가 본문에서 소속을 밝힌 글로, 감사 로그, Host Network, Job 노드 그룹 오토스케일링을 다룹니다. 나머지 여섯 편은 운영개발팀, 당근페이 머니서비스팀과 인프라팀, 검색 플랫폼팀이 쓴 글로, 클러스터 파트 글은 아닙니다. CI/CD, 매일 배포, 검색 엔진 운영, Karpenter 트러블슈팅 같은 인접 주제를 함께 읽도록 모았습니다.

원문이 아니라 읽고 재구성한 요약이므로 정확한 내용은 각 문서의 원문 링크에서 확인하시기 바랍니다.
