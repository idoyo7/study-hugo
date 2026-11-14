---
title: "TSDB as a Service TSCoke 개발기"
description: "카카오 분산기술셀이 Redicoke 위에 사내 TSDB 서비스 TSCoke를 만든 이유와 설계 목표를 정리했습니다. 테스트에서 만난 Out-of-memory와 Timestamp 역전 문제, ART와 LSS로 푼 과정을 요약합니다."
date: 2026-11-14
weight: 6
---

# TSDB as a Service TSCoke 개발기 (2022-08)

{{< callout type="info" >}}
**원문 정보**
- 원문: [TSDB as a Service, TSCoke 개발기](https://tech.kakao.com/posts/531)
- 매체 · 게시일: 카카오 기술블로그 · 2022-08-09
- 저자: yanoo.kim (분산기술셀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 개발 배경 {#background}

분산기술셀은 카카오의 이미지, 동영상, 파일을 저장하는 분산 스토리지 Kage를 운영합니다. Kage는 서버와 스토리지가 셀 수 없이 많아서 지표 서비스도 여럿 썼습니다. Kage 전용 커스텀 메트릭 대시보드, 서버 모니터링용 Prometheus, 계절 이벤트 같은 장기 변화를 보고 비용 산정과 구매 계획을 세우기 위한 Hadoop 기반 내부 BI 서비스가 그것입니다. 약 10년 동안 서비스가 방대해지며 지표가 하나둘 쌓인 결과입니다.

지표가 많아지자 관리 자체가 일이 됐고, 서로 다른 지표를 조합해 분석하고 싶은 욕구도 생겼습니다. 장단기 지표를 보관하며 빠르게 조회하고 분석할 지표 저장소를 찾으려고 여러 TSDB를 시험했지만, 싱글 노드만 지원하거나 클러스터링 비용 부담이 있거나 조회가 느리거나 원하는 기능이 없었습니다.

## Redicoke 위에 올린 TSDB {#redicoke}

당시 셀은 Redicoke라는 Distributed Key-value store도 운영했습니다. redis 프로토콜과 자료구조를 그대로 제공해 Redis 클라이언트와 서드파티를 쓸 수 있지만 redis는 아닙니다. In-memory가 아니라 NAND 기반이고 데이터 삼중화로 안정성을 주기 때문에, redis는 빠른 latency를 얻고 Redicoke는 넓은 저장 공간을 얻은 셈입니다. 서비스 중단 없는 Online scale out도 제공해 실질적으로는 무한에 가까운 공간을 줄 수 있습니다.

초기 사용자는 대부분 redis를 쓰다 공간과 안전성 요구로 옮겨 온 사람들이었습니다. 이용 패턴이 redis에 맞춘 고성능, 저용량이어서, 성능이 더 필요해 scale out하면 안 그래도 남는 저장 공간이 더 남았습니다. 이 남는 공간에 지표 데이터를 저장하기로 했습니다. 중간에 데몬을 두어 연산을 취합해 Redicoke의 Throughput 소모를 줄이고 방대한 공간을 쓰는 구상입니다. 프로토타입 결과는 저장 공간과 조회 성능 모두 요구를 만족했고, 익숙한 Prometheus의 PromQL도 제공하기로 했습니다. 비슷한 고민을 하던 사내 다른 팀을 만나 요구를 모은 끝에 카카오의 요구에 맞는 TSDB를 만들기로 결정했습니다.

## 설계 목표 {#goals}

기획 목표는 네 가지였습니다.

- 웹 콘솔: 사용자는 대개 Grafana 같은 대시보드로 TSDB를 보므로, 계정 생성과 동작 및 사용량 확인, 로그 확인을 웹에서 쉽게 하도록 합니다.
- 오픈소스 연동: 자체 솔루션은 익숙하지 않고 서드파티가 부족하며 프로토콜도 생소하다는 문제가 있어 Prometheus API와 호환되게 합니다.
- 내구성과 고가용성: 지표가 없어도 서비스가 멈추지는 않지만 의사결정에 중요하고, 장애 대응처럼 촌각을 다투는 순간에 갑자기 안 보이면 곤혹스러우므로 손실이 없어야 합니다.
- 무중단 수평 확장: 장비를 추가하면 데몬이 자동으로 Shard를 분배하고 Migration하며 서비스는 중단되지 않아야 합니다.

구현은 이 목표를 그대로 이뤘습니다. 사내 클라우드 포털 KCP에서 웹으로 제어하고, PromQL Compliance test를 100% 통과하며, Sharding과 Replication으로 내구성과 무중단 확장을 제공하고 확장에 따른 성능 향상도 확인했습니다.

## 타 부서 테스트에서 만난 문제 {#problems}

그러나 타 부서와 함께 해 본 테스트 결과는 실망스러웠습니다. 동작조차 제대로 되지 않았고 특히 Out-of-memory와 Timestamp 역전이 가장 심각했습니다.

### Series index와 Out-of-memory {#oom}

PromQL의 Label 검색은 문자열 일치와 불일치는 물론 정규식까지 지원해서 각 Label에 Index가 필요합니다. 그런데 이 Index가 방대했습니다. 데이터가 많아 O(logN)조차 무시 못 할 만큼 부담이 늘어 In-memory indexing으로 풀었지만, Index가 너무 커서 Out-of-memory가 자주 났습니다.

### Timestamp 역전 {#timestamp-inversion}

시계열 데이터는 보통 시간 순서로 들어오는데 가끔 시간 축이 뒤집혔습니다. 원인은 이중화였습니다. TSCoke는 Master-Master Replication을 기본으로 하되 정합성 처리를 쉽게 하려고 두 노드에 우선순위를 두어 어지간하면 Primary에 먼저 쓰고 Secondary로 동기화합니다. 약간의 네트워크 지연이나 Primary의 동작 지연으로 쓰기가 Secondary로 Failover되면 두 노드가 서로 다른 최신 데이터를 갖게 되고, 동기화할 때 한 노드는 자기 최신 데이터보다 오래된 데이터를 받아야 합니다.

이게 문제인 이유는 대량 I/O를 부르기 때문입니다. TSDB는 압축 효율이 좋습니다. CPU 점유율은 0에서 100 사이고 디스크 사용량은 단조 증가하는 것처럼 시계열 값은 비슷한 특성을 가집니다. TSCoke는 Double Delta와 Gorilla로 압축하고 압축 문맥을 메모리에 유지해, 순서대로 오는 데이터는 기존 데이터를 건드리지 않고 Append Only로 로컬 스토리지에 썼습니다. 역전이 일어나면 압축 데이터 중간에 삽입해야 하는데 이때는 압축 문맥이 없어서 전체를 읽어 문맥을 다시 만들고 삽입해 다시 저장해야 합니다. 높은 가용성을 위한 Master-Master 구조에서는 이 현상이 여러 노드에 동시에 일어나 I/O가 크게 튀고 클러스터 전체 성능에 영향을 줬습니다.

## 해결 {#solutions}

### Adaptive Radix Tree와 Dictionary coding {#art}

Radix Tree는 노드 안에서 원하는 Child를 바로 찾을 수 있어 BinarySearch를 쓰는 BTree보다 탐색에 유리하지만, 빈 Slot 때문에 메모리가 낭비됩니다. 이 약점을 줄인 ART(Adaptive radix tree)를 TSCoke는 빠른 Label 탐색에 씁니다. ART는 노드 크기가 4, 16, 48, 256으로 적응적으로 바뀌어 더 촘촘히 기록하고, Path compression으로 같은 Prefix의 Child Node를 생략하며, Lazy expansion으로 무의미한 Suffix용 Internal node를 생략합니다.

그래도 Key 분포가 촘촘하지 않으면 비효율적입니다. A와 B로만 구성된 4byte Key를 넣으면 한 노드의 Child가 둘뿐이라 효율이 Binary tree 수준으로 떨어지는데, TSCoke의 Label이 이런 패턴이었습니다. 그래서 Dictionary coding으로 문자열을 Integer로 매핑했습니다. ART 논문에 따르면 Key 분포가 가장 촘촘한 데이터셋이 Integer이기 때문입니다. 실데이터 10만 건 기준 통계에서, 기본 구현(`sync.Map`)을 ART로 바꾸면 성능은 좋아지지만 메모리 효율은 오히려 떨어졌습니다. 여기에 Dictionary coding을 더하면 `sync.Map`에 Dictionary coding을 붙인 것보다 메모리 효율이 더 좋았고 성능도 덤으로 올랐습니다. 실제로는 억 단위 Series가 저장돼 있어 개수가 많을수록 압축비가 올라가므로, 실제 효율은 그래프 이상이라고 합니다.

### LSS 도입 {#lss}

처음엔 Golang으로 구현된 Embedded KV store인 Bolt와 Badger를 썼는데, Timestamp 역전으로 I/O가 튈 때마다 기대에 못 미쳤습니다. 사용하지 않는 기능이 많아 무거운 Local KV Store라고 결론짓고, NAND의 I/O 특성에 맞는 Append Only 방식의 LSS(Log-structured Segment Store)를 직접 만들었습니다. 복잡한 기능 없이 코드가 짧습니다. 2차 Buffer 역할의 Segment store에 맞춰 만료 시간이 비슷한 Slot을 묶어 Chunking해 생성과 만료 시간, 메모리 소모를 크게 줄였을 뿐입니다. 결과는 놀라웠습니다. IOPS가 수십 배로 늘고 메모리 소모는 비교할 수 없이 작아졌습니다. Write와 Delete의 연산과 자료구조가 거의 없어졌고, 구현을 더하기보다 빼는 방향으로 설계한 결과입니다. 덕분에 Timestamp 역전으로 인한 I/O 병목은 지표상 보이지 않을 정도로 줄었습니다.

## 베타 오픈과 앞으로 {#beta}

TSCoke는 2022년 6월 9일 카카오의 쿠버네티스 서비스 DKOS 위에서 사내 베타를 열었고, 글을 쓴 2022년 8월 4일 기준으로 3억 개가 넘는 Series가 들어와 활발히 쓰이고 있습니다. 글을 처음 쓸 때 없던 분산 쿼리와 Label 추출 성능 향상이 그사이 추가될 만큼 빠르게 발전하는 중입니다. 2020년 말 시작한 프로젝트라 갈 길이 멀다고 하며, 미뤄 둔 성능 튜닝 요소가 많고 Prometheus의 Alarm과 Recording rule은 미구현이며 외부 스토리지 연동 같은 기능도 추가하고 싶다고 합니다.

{{% details title="원문의 주요 수치" closed="true" %}}

| 항목 | 값 |
|---|---|
| Kage 운영 기간 | 약 10년 |
| 개발 시작 | 2020년 말 |
| 사내 베타 오픈 | 2022-06-09 (DKOS 기반) |
| 글 작성 시점 Series 수 | 3억 개 이상 (2022-08-04 기준) |
| PromQL Compliance test | 100% 통과 |
| ART 노드 크기 | 4, 16, 48, 256 |
| ART 효과 검증 데이터 | TSCoke 실데이터 10만 건 |
| LSS 도입 효과 | IOPS 수십 배 증가, 메모리 소모 대폭 감소 (원문에 세부 수치 없음) |
{{% /details %}}
