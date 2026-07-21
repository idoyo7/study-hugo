---
title: "원문별 정리"
weight: 4
---

# 원문별 정리 — 네이버 D2 발표·기사 4건

{{< callout type="info" >}}
**참조한 내용정리**

이 섹션의 모든 문서는 아래 네이버 D2 발표·기사 4건을 읽고 재구성한 요약이다. 원문 자체가 아니며, 정확한 원문은 각 링크에서 확인한다.

- [네이버 검색 SRE의 시계열 데이터베이스 운영기](https://d2.naver.com/helloworld/6867189) · 2024-02-07
- [네이버 검색의 대규모 메트릭 저장소, VictoriaMetrics 운영기 (1편)](https://d2.naver.com/helloworld/6475419) · 2026-04-22
- [Inside VictoriaMetrics](https://d2.naver.com/helloworld/9290861) · 2026-06-02
- [VictoriaMetrics 운영기 2편 — 3단계 최적화 전략](https://d2.naver.com/helloworld/5788040) · 2026-07-21
{{< /callout >}}

{{< callout type="info" >}}
**한눈에**
- 기본 개념·잘 쓰는 방법·우리의 운영이 **주제별로 보기**라면, 이 섹션은 **원문(발표·기사)별로 보기**다.
- 01은 SingleNode→Cluster→멀티클러스터 확장과 지표 선계산·라우팅 게이트웨이를 다룬 2024년 기사다.
- 02는 12.5억 시계열·555조 데이터포인트·180노드 규모의 Hot/Warm 2계층 운영기(1편)다.
- 03은 vmagent·vminsert·vmstorage·vmselect 내부 동작을 6섹션으로 정독한 발표 영상이다.
- 04는 조회(vmselect OOM)·저장(IndexDB·RetentionPeriod)·수집(필터링) 3단계 최적화를 다룬 최신 운영기(2편)다.
{{< /callout >}}

같은 지식을 주제로 재배열하지 않고, 각 원문이 실제로 무엇을 말했는지 그대로 승계해 보존하는 것이 이 섹션의 목적이다. 원문 한 건 = 문서 한 편으로 대응해, 발표·기사의 흐름과 강조점을 훼손하지 않는다.

## 문서 지도

| 문서 | 게시일 | 성격 | 한 줄 요약 |
|------|--------|------|-----------|
| 01 [네이버 검색 SRE 시계열 DB 운영기]({{< relref "01-2024-02-sre-tsdb.md" >}}) | 2024-02 | 기사(DEVIEW 2023 기반) | SingleNode→Cluster→멀티클러스터·지표 선계산·라우팅 게이트웨이 |
| 02 [대규모 메트릭 저장소 운영기 1편]({{< relref "02-2026-04-large-scale-metric-store.md" >}}) | 2026-04 | 기사 | 12.5억 시계열·555조 DP·180노드, Hot/Warm 2계층, 무중단 장비 전환 |
| 03 [Inside VictoriaMetrics]({{< relref "03-2026-06-inside-victoriametrics.md" >}}) | 2026-06 | 발표영상 | vmagent·vminsert·vmstorage·vmselect 내부 동작 6섹션 정독 |
| 04 [운영기 2편 — 3단계 최적화]({{< relref "04-2026-07-three-stage-optimization.md" >}}) | 2026-07 | 기사(최신) | 조회(vmselect OOM)·저장(IndexDB·RetentionPeriod)·수집(필터링) 3단계 |

## 주제별로 보기

원리가 궁금하면 [기본 개념]({{< relref "../concepts/_index.md" >}}), 설계·운영 패턴이 궁금하면 [잘 쓰는 방법]({{< relref "../practice/_index.md" >}}), 우리 환경 적용 사례가 궁금하면 [우리의 운영]({{< relref "../ours/_index.md" >}})을 본다.

## 읽는 순서

시간순으로 01 → 02 → 03 → 04가 자연스럽다. 04(운영기 2편)는 같은 시리즈인 02(운영기 1편)를 먼저 읽으면 맥락이 더 잘 잡힌다.
