---
title: "VictoriaLogs 스토리지 내부 구조"
linkTitle: "VictoriaLogs 내부 구조"
date: 2026-11-08
weight: 11
url: "/logging/victorialogs-internals/"
comments: false
cascade:
  type: docs
---

# VictoriaLogs 스토리지 내부 구조

## 이 분류에서 찾기 {#section-navigation}

- [VictoriaLogs 로그 한 줄의 스트림과 디스크 배치]({{< relref "/observability/logs/victorialogs-internals/01-data-model/index.md" >}})

로그 저장소가 빠르다는 말은 쉽게 하지만, 수 TB 위에서 파드 하나의 최근 15분 에러를 밀리초에 돌려주는 일은 바이트를 어떻게 놓느냐에 달려 있습니다. 이 시리즈는 VictoriaLogs 한 엔진을 아래층부터 읽으며 그 속도가 디스크 배치의 당연한 결과로 보이는 지점까지 따라갑니다.

원문은 장마다 같은 순서를 밟습니다. 한 메커니즘의 단순한 구현을 먼저 만들고, 그 구현이 부딪히는 벽을 확인한 뒤, VictoriaLogs가 실제로 어떻게 푸는지 읽습니다. 모든 주장은 실제 소스 코드에 묶고, 머릿속 모델이 엔진의 테스트와 어긋나면 모델이 틀린 것으로 칩니다. LogsQL 문법은 다루지 않고 쿼리가 스토리지에서 실행되는 경로만 따라갑니다.

원문이 예고한 전체 구성은 데이터 모델, 추가 전용 수집, 정렬과 불변 part, LSM 병합 엔진, 컬럼 블록, 스캔 없는 전문 검색, 와이드 이벤트 개편, 스트림 역색인(indexdb), 파티션·보관·쿼리 흐름 아홉 편입니다. 현재 공개된 것은 1편뿐이어서 이 분류에도 1편만 있습니다. 이후 편이 나오면 읽고 이어 붙입니다.

{{< callout type="info" >}}
원문은 Write-Ahead 블로그의 「VictoriaLogs storage internals: the data model and the map of the engine」(2026-11-07)이고, 시리즈의 1편입니다. 이 분류의 글은 원문을 읽고 재구성한 정리이며 번역이 아닙니다. 원문 링크는 [1편](https://write-ahead.github.io/victorialogs/internals/storage-engine/data-model/)에 적었습니다.
{{< /callout >}}
