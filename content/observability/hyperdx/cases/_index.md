---
title: "타사 사례"
description: "다른 회사가 ClickStack(ClickHouse + OpenTelemetry Collector + HyperDX)을 직접 구축·운영한 공개 사례를 읽고 요약한 자료입니다. 우리 설계 문서와 대조할 수 있도록 수집 경로, 스토리지 티어링, 감시 장치, 운영 장애를 중심으로 정리합니다."
date: 2026-11-10
weight: 30
comments: false
---

# 타사 사례

## 이 분류에서 찾기 {#section-navigation}

- [S3 적재 뒤 응답하는 게임듀오 ClickStack]({{< relref "/observability/hyperdx/cases/gameduo-clickstack-ec2.md" >}})

{{< callout type="info" >}}
**출처**

다른 회사 기술 블로그와 AWS 기술 블로그에 공개된 ClickStack 운영 사례를 골랐습니다. 원문 제목, 게시일, 저자를 적었고 링크에서 원문을 확인할 수 있습니다.

- [게임듀오가 Amazon EC2 기반 ClickStack으로 게임 서버 관측성 비용을 절반 이하로 줄인 방법](https://aws.amazon.com/ko/blogs/tech/gameduo-clickstack-on-amazon-ec2/) · 2026-11-10 · 서창민, 이은학
{{< /callout >}}

원문이 아니라 읽고 재구성한 요약이므로 정확한 내용은 각 문서의 원문 링크에서 확인하시기 바랍니다. 우리 환경의 설계 기준은 [설계·구축]({{< relref "/observability/hyperdx/design/_index.md" >}})에 있습니다.
