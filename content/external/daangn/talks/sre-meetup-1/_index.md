---
title: "SRE 밋업 1회"
description: "당근 SRE 밋업 1회 발표 요약 3편입니다. EKS 무중단 업그레이드, gRPC 서비스 운영, AWS Config 기반 컴플라이언스 관리를 다룹니다. PrivateLink 발표는 영상과 슬라이드를 구하지 못해 싣지 못했습니다."
date: 2026-10-21
weight: 5
comments: false
---

# SRE 밋업 1회

## 이 분류에서 찾기 {#section-navigation}

- [새 EKS 클러스터로 트래픽을 옮겨 버전 업그레이드하기]({{< relref "/external/daangn/talks/sre-meetup-1/01-eks-zero-downtime-upgrade.md" >}})
- [당근의 gRPC 운영: 연결 관리와 요청 분산, 장애 지표]({{< relref "/external/daangn/talks/sre-meetup-1/02-grpc-operations.md" >}})
- [사내 운영 규칙을 AWS Config로 검사하고 보고하기]({{< relref "/external/daangn/talks/sre-meetup-1/03-aws-config-compliance.md" >}})

당근마켓과 당근페이 SRE 팀이 안정적인 인프라 구축과 운영 노하우를 나눈 첫 번째 밋업입니다. 영상은 2021-08-31에 YouTube 당근 채널에 올라왔고(설명란 기준 녹화일 2021-08-26), [1회 다시보기 재생목록](https://www.youtube.com/playlist?list=PLaHcMRg2hoBqWWla-pCBSRqU-jSriiZHj)에서 볼 수 있습니다. AWS Config 발표는 영상을 확인하지 못해 슬라이드만으로 정리했습니다.

YouTube 영상을 자동 자막과 공개된 슬라이드로 읽고 재구성한 요약입니다. 원문 영상이 아니므로 정확한 내용은 각 문서의 링크에서 확인하시기 바랍니다.
