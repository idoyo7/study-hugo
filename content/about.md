---
title: "이 사이트에 대하여"
type: docs
weight: 999
description: "Ops Insights를 누가 쓰는지, 무엇을 쓰는지, 근거 표기와 출처 정리 방식."
---

## 누가 쓰나

Mont(mont kim)이 씁니다. EKS 위에서 Istio·Karpenter·VictoriaMetrics·ClickHouse·HyperDX 같은 것을 운영하며 남긴 기록이 중심입니다. 같은 사람이 쓰는 블로그는 [makgol.com](https://makgol.com)이고, 프로필은 [makgol.com/about](https://makgol.com/about)에 있습니다.

## 무엇을 쓰나

운영하다 부딪힌 것을 도메인 단위로 묶습니다. 일부 문서에는 「우리 케이스에서는」 절이 있습니다 — 일반론과 우리 클러스터에 대한 판단을 그 절에서 갈라놓습니다.

외부 발표·블로그를 정독해 정리한 문서는 챕터 인덱스와 문서 도입부에 원저자와 원본을 적습니다. 그 문서의 사실은 원저자의 것이고, 우리 스택에 대입한 판단만 이쪽 몫입니다.

## 근거 표기

> **근거 표기 범례**: `✓` 확인됨(1차 출처 검증) · `≈` 추정 · `Ⓥ` 벤더 주장 · `?` 미확인 · `Ⓑ` 퍼블릭 벤치마크 · `Σ` 종합 판단. `⁽ ⁾`는 부가 설명, `✓/≈`처럼 병기하면 혼재를 뜻합니다.

## 출처

섹션마다 인용 URL 을 모은 「출처」 문서를 따로 두는 곳이 있습니다 — [ClickHouse 운영]({{< relref "clickhouse/10-sources.md" >}}) · [HyperDX 내재화]({{< relref "hyperdx/10-sources.md" >}}) · [RUM 내재화]({{< relref "rum/06-sources.md" >}}) · [Redis · Valkey · Memcached]({{< relref "elasticache/99-sources.md" >}}). VictoriaMetrics 섹션은 [소스맵]({{< relref "monitoring/victoriametrics/concepts/06-sources.md" >}})과 [원문별 정리]({{< relref "monitoring/victoriametrics/by-source/_index.md" >}})가 같은 일을 합니다.

## 정정 제보

덧글은 GitHub Discussions(giscus)로 받습니다. 사실 관계 정정 제보를 특히 환영합니다.
