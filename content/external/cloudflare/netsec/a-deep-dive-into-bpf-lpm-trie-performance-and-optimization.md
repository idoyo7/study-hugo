---
title: "수백만 항목 앞에서 한계를 드러낸 BPF LPM trie"
description: "Cloudflare가 BPF LPM trie의 조회 지연을 추적하자, 자식 포인터 두 개로 제한된 분기와 노드별 메모리 할당이 병목으로 드러났습니다. Linux 라우팅 코드의 Level-Compressed Trie를 재사용하려는 개선 방향까지 짚습니다."
date: 2026-11-16
weight: 13
---

# 수백만 항목 앞에서 한계를 드러낸 BPF LPM trie (2025-10)

{{< callout type="info" >}}
**원문 정보**
- 원문: [A deep dive into BPF LPM trie performance and optimization](https://blog.cloudflare.com/a-deep-dive-into-bpf-lpm-trie-performance-and-optimization)
- 매체 · 게시일: The Cloudflare Blog · 2025-10-21
- 저자: Matt Fleming, Jesper Brouer
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## CPU를 10초 넘게 붙잡은 map 해제 {#production-soft-lockup}

시작은 수수께끼 같은 로그 한 줄이었습니다. production에 나타난 soft lockup 메시지를 따라가던 Cloudflare 엔지니어들은 패킷 라우팅에 널리 쓰던 BPF LPM trie의 성능을 깊이 파고들게 됐습니다. `BPF_MAP_TYPE_LPM_TRIE`는 IP나 IP+Port를 매칭해 요청이 알맞은 서비스를 거치도록 하는 데 쓰이는 map입니다.

수백만 항목을 담자 조회에 수백 밀리초가 걸렸고, map을 해제하는 동안 CPU가 10초 넘게 묶이기도 했습니다. 영향은 고객 트래픽까지 번졌습니다. Magic Firewall 규칙 평가에도 BPF map을 사용하는데, 이런 병목으로 일부 고객에게 패킷 손실이 발생했습니다.

작은 map에서도 해제 비용은 눈에 띄었습니다. BPF selftests로 연속된 키 10K개를 채워 측정했을 때, lookup 지연은 134.710 ns/op였지만 free는 1.743 ms/op였습니다. 운영 중에는 이 해제가 너무 오래 걸려 soft lockup 메시지가 쏟아졌습니다.

{{% details title="벤치마크 조건과 연산별 측정값" closed="true" %}}
| 항목 | 값 |
|---|---|
| 측정 도구 | BPF selftests 벤치마크 |
| 측정 장비 | AMD EPYC 9684X 96-Core |
| Trie 구성 | 항목 10K개, 접두사 길이 32비트, `[0, 10K)` 범위의 모든 키 저장 |
| 데이터 조건 | 키가 조밀하게 채워져 path compression이 효과를 내지 못하는 조건 |
| lookup | 처리량 7.423M ops/s, 표준편차 0.023M ops/s, 지연 134.710 ns/op |
| update | 처리량 2.643M ops/s, 표준편차 0.015M ops/s, 지연 378.310 ns/op |
| delete | 처리량 0.712M ops/s, 표준편차 0.008M ops/s, 지연 1405.152 ns/op |
| free | 처리량 0.573K ops/s, 표준편차 0.574K ops/s, 지연 1.743 ms/op |
| 대규모 조회 처리량 | 항목 100만 개에서 약 1.5M ops/s, 이후 항목 증가에 따라 추가 하락 |
| dTLB 병목 관찰 지점 | 항목 약 80K개부터 |
{{% /details %}}

## ABC와 ABCD가 공유하는 접두사 {#prefix-search-and-compression}

Trie는 키를 검색 경로에 나눠 저장합니다. 각 노드에 키의 일부 비트를 두고 경로를 따라가며 키를 재구성하므로, 매 단계에서 전체 키를 비교하는 전통적인 이진 검색 트리와 달리 모든 노드가 전체 키를 저장할 필요는 없습니다.

`ABC`와 `ABCD`를 저장한다고 생각하면 간단합니다. 두 문자열은 `ABC`에 해당하는 노드를 함께 쓰므로, ASCII 기준으로 문자 데이터에 필요한 공간은 3바이트 + 4바이트에서 3바이트 + 1바이트로 줄어듭니다. 실제 trie에 필요한 비트 수는 구현에 따라 다릅니다. 검색도 접두사 순서로 진행하기 때문에 맞는 접두사가 없으면 일찍 끝납니다.

CIDR 기반 IP 라우팅에도 이 특성이 잘 맞습니다. IP 주소에서 네트워크 부분의 경계가 고정되지 않으므로, 라우팅 테이블에서는 정확히 같은 키 대신 일치하는 접두사 중 가장 길고 구체적인 것을 찾아야 합니다. 이것이 최장 접두사 매칭입니다.

## 세 방향 분기를 막는 두 개의 자식 포인터 {#dense-data-branching-limits}

0, 1, 3은 32비트나 64비트 워드 하나에 들어갑니다. 한 번 비교해 알맞은 자식으로 내려갈 수 있을 듯하지만, 현재 `kernel/bpf/lpm_trie.c`의 내부 노드에는 자식 포인터가 두 개뿐입니다. 세 방향 중 하나를 고르려면 중간 노드를 넣어 분기를 두 방향씩 나눠야 합니다.

노드마다 한 비트씩 비교하면 binary trie, 여러 비트를 비교하면 multibit trie입니다. Multibit trie는 노드에 메모리를 더 쓰는 대신 컴퓨터가 여러 비트의 워드를 처리하는 특성을 활용해 비교 횟수를 줄입니다. BPF LPM trie도 리프에서는 여러 비트를 비교하지만, 한 비트씩만 다른 키가 조밀하게 채워진 경로에서는 검색이 한 비트씩 진행되는 수준으로 떨어집니다.

분기가 필요 없는 중간 노드를 생략하는 path compression은 이미 적용돼 있습니다. 앞의 예에서 3을 15(`0b1111`)로 바꿔도 trie의 배치는 그대로입니다. 루트의 오른쪽 자식에는 여전히 노드 하나면 충분합니다. 생략한 비트까지 검색 키와 일치하는지는 확인해야 하므로, BPF LPM trie는 리프에 전체 키를 저장합니다.

데이터가 빽빽해지면 이 압축도 힘을 잃습니다. 앞서 측정한 10K개의 연속된 키에서는 path compression이 전혀 효과를 내지 못하므로, 벤치마크가 최악의 동작을 가늠하는 조건이 됩니다. 완전히 채워진 trie의 높이는 최악의 경우 `log2(nr_entries)`가 되며, 높이가 커질수록 조회에 필요한 비교도 늘어납니다.

## 흩어진 노드를 따라가는 조회 경로 {#cache-and-translation-bottlenecks}

항목이 100만 개에 이르자 조회 처리량은 초당 약 150만 회까지 내려갔습니다. 항목을 더 넣으면 처리량은 계속 떨어졌습니다.

초기 성능 저하의 원인은 L1 데이터 캐시 미스였습니다. 검색 경로에서 방문하는 노드 하나하나가 캐시 미스를 일으킬 기회가 됩니다. 그런데 L1 데이터 캐시 미스율이 비교적 일정해진 뒤에도 처리량은 계속 하락했습니다. 항목 약 80K개부터는 dTLB 미스가 병목이 됐습니다.

노드는 메모리에 모여 있지 않습니다. BPF LPM trie는 커널 메모리의 freelist에서 노드를 하나씩 동적 할당하므로, 각 노드가 임의의 주소에 놓일 수 있습니다. 경로를 따라갈 때 캐시 미스는 거의 피할 수 없고 dTLB 미스도 발생할 수 있습니다. 항목 수가 늘고 trie가 높아질수록 이 문제가 더 심해집니다.

## 공통 구현으로 재사용하려는 Linux 라우팅 코드 {#upstream-and-future-work}

조밀한 데이터에도 쓸 수 있는 압축은 있습니다. 예를 들어 상위 3개 레벨이 모두 채워졌다면, 그 레벨의 노드들을 자식 `2**3`개를 가진 노드 하나로 바꾸는 level compression을 적용할 수 있습니다. 자식 포인터가 두 개뿐인 현재 BPF LPM trie에는 이 압축이 없습니다.

Linux 커널의 IP 경로 조회 코드인 `net/ipv4/fib_trie.c`는 이미 Level-Compressed Trie를 구현합니다. IP 라우팅 테이블에는 공통 접두사가 많아 상위 레벨이 조밀하게 채워지는 경우가 흔합니다. 이 때문에 level compression이 효과를 내기 좋은 대상입니다.

Cloudflare는 이번 벤치마크를 upstream Linux 커널에 이미 기여했습니다. 다음으로는 자사 워크로드에서 많이 쓰는 조회 함수의 성능을 개선할 계획입니다. 그 첫 단계로 `net/ipv4/fib_trie.c`를 리팩터링해 공통으로 사용할 Level-Compressed Trie 구현을 마련하는 방향을 제시했습니다. 아직 완료된 최적화는 아니며, 후속 블로그 글에서 이 작업을 더 깊이 다룰 예정입니다.
