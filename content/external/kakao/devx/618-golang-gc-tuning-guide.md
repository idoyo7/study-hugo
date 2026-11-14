---
title: "Golang GC 튜닝 가이드"
description: "Golang GC가 CPU 부담이 될 때 프로파일로 진단하고 GOMEMLIMIT과 Heap 할당 줄이기로 푸는 방법을 정리했습니다. 벤치마크로 확인하는 순서와 코드 수준의 팁을 요약합니다."
date: 2026-11-14
weight: 7
---

# Golang GC 튜닝 가이드 (2024-05)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Golang GC 튜닝 가이드](https://tech.kakao.com/posts/618)
- 매체 · 게시일: 카카오 기술블로그 · 2024-05-13
- 저자: yanoo.kim (편집 June.6)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 글의 범위 {#scope}

Golang으로 개발하다 보면 어느 순간 GC가 성능의 짐이 됩니다. 알아서 메모리를 관리해 주던 고마운 GC가 CPU를 점점 더 쓰면서 로직에 부담을 주는 시점입니다. 이 글은 여기저기서 찾아 배운 튜닝 방법을 정리하고, 잘 언급되지 않지만 크게 도움받은 부분에 무게를 둡니다. 다른 글에서 이미 자주 다룬 내용과 GC 동작 원리는 다루지 않고, 필요하면 글 말미의 레퍼런스를 보라고 안내합니다.

## 프로파일로 튜닝 필요 여부 판단 {#profile}

튜닝이 필요한지부터 확인해야 합니다. 필요 없는 튜닝에 시간을 쓰는 건 낭비일 수 있고, 그 판단 도구가 Profile입니다. 원문은 파일로 저장하는 방식과 웹 서버로 요청받는 방식을 소개하고, 필요할 때 단말에서 바로 볼 수 있는 웹 방식(`net/http/pprof`)을 선호한다고 합니다. 인프라가 갖춰져 있다면 Pyroscope 같은 Continuous Profiling을 권합니다.

`go tool pprof`로 프로파일을 받아 Top으로 정렬했을 때 GC가 쓰는 함수인 `runtime.findObject`나 `runtime.greyObject`가 상위권에 있으면 GC를 튜닝할 때가 된 것입니다. 원문의 예시 프로파일에서는 `findObject`가 flat 기준 16%로 맨 위였습니다.

## GOGC를 끄고 GOMEMLIMIT만 쓰기 {#gomemlimit}

GC 튜닝의 핵심은 GC가 도는 동안 프로그램이 멈추는 STW를 줄이는 것입니다. 가장 쉬운 방법으로 원문은 GOGC를 끄고 GOMEMLIMIT을 쓰는 것을 꼽습니다.

GOGC는 직전 시점 대비 Heap 증가율로 GC 수행 여부를 정하며 기본값은 100, 곧 Heap이 두 배가 되면 GC를 합니다. 값이 작으면 문제가 생깁니다. 재시작 직후처럼 메모리가 작을 때는 조금만 할당해도 100% 증가로 잡혀 GC가 허겁지겁 수행됩니다. 1GB가 2GB가 되는 것도, 10MB가 20MB가 되는 것도 같은 100% 증가이기 때문입니다. 값이 크면 OOM 가능성이 커집니다. Heap이 40GB일 때 GOGC가 50이면 60GB가 되어야 GC가 도니까요. 이를 막으려고 시작하자마자 더미 메모리를 잡는 ballast 기법이 있었지만, GOMEMLIMIT이 나왔으니 잊어도 된다는 것이 원문의 입장입니다.

GOMEMLIMIT은 프로그램이 쓸 수 있는 메모리의 한계선으로, 메모리 사용량이 그 값에 이를 때만 GC가 돕니다. 쓸 수 있는 최대 메모리를 미리 산정해 그보다 작은 값을 설정하면 됩니다. 한계선보다 작게 잡는 이유는 GOMEMLIMIT이 소프트 리밋이라 설정값보다 조금 더 쓸 수 있기 때문입니다. 이렇게 하면 GC가 최대한 늦게 돌고 GC Cycle이 길어져 STW가 최소화됩니다.

## Heap Profile에서 alloc 지표 보기 {#heap-profile}

Stack 메모리는 함수 호출과 종료에 따라 자연스럽게 관리되므로 GC 튜닝의 핵심은 Heap입니다. Heap Profile에는 `inuse_objects`, `inuse_space`, `alloc_objects`, `alloc_space` 네 지표가 있고, GC 튜닝에서는 alloc 계열이 더 중요합니다. inuse가 1GB인데 alloc도 1GB면 한 번 할당해 계속 쓴다는 뜻이라 GC가 개입할 일이 없습니다. inuse가 1GB인데 alloc이 1TB면 1024번 할당했고 GC도 그만큼 돌았다는 뜻입니다.

두 지표 모두 봐야 합니다. alloc_space가 크면 Heap이 빨리 늘어 GC 주기가 짧아지고, alloc_objects가 크면 Marking 같은 작업에 CPU를 씁니다. 큰 값은 주기를 짧게 할 뿐 아니라 수행 시간도 늘려 STW를 키웁니다. 두 지표를 기준으로 Flame graph를 그리면 가로축이 긴 함수가 GC 대상 객체를 많이 만드는 곳이고, 함수를 클릭해 소스에서 어느 코드가 할당하는지도 볼 수 있습니다.

## gcflags로 Heap 할당 원인 확인 {#gcflags}

위치를 찾았어도 왜 Heap에 할당됐는지 알아야 줄일 수 있습니다. `go build -gcflags='-m'`을 쓰면 `escapes to heap`으로 Heap에 할당된 변수를 보여 주고, `-m -m`을 쓰면 그 원인(flow)까지 나옵니다. 원문의 예제에서는 `fmt.Println`에 넘긴 `j`, `fmt.Printf`에 넘긴 `k`가 Heap으로 갔고 `i`는 Stack에 남았습니다.

그러나 `escapes to heap`을 일일이 확인하기는 눈이 아프고, 코드에 많아도 실제 할당은 적을 수 있습니다. 객체를 재활용하거나 호출이 드문 코드일 수 있기 때문입니다. 서비스에 배포해 확인하는 방법이 가장 확실하지만 괴로우므로 Benchmark 중심으로 튜닝하길 권합니다.

```
go test -bench=. -benchmem -benchtime=10s -cpuprofile=cpu.prof -memprofile=mem.prof -gcflags='-m'
```

`-benchmem`은 루프 한 번당 할당 크기와 횟수를, `-cpuprofile`과 `-memprofile`은 할당 위치를 보여 줍니다. 다만 한계가 있습니다. Pool을 쓰면 Heap 할당은 줄어도 Pool 연산에 CPU를 쓰므로 벤치마크 속도가 오히려 떨어질 수 있습니다. 또 할당을 줄인 이득은 GC가 돌아야 드러나는데 벤치마크는 대개 짧아 GC 부하가 잘 안 보입니다. 어느 쪽이 이득인지는 프로그램에 따라 달라 개발자가 판단해야 합니다.

## Heap 할당을 줄이는 팁 {#tips}

- 비정형 인자: `fmt.Println` 같은 함수는 `any`를 받으므로 타입 정보가 필요하고, 그런 데이터는 Heap에 할당됩니다. `interface`나 `reflect`처럼 타입을 해석하는 추상화도 같은 부담입니다. 인자로 쓰일 가능성만 있어도 컴파일 시점에 Heap으로 정해져, `if i == 1 { fmt.Println(j) }`처럼 도달할 수 없는 분기여도 `j`는 선언 시점부터 Heap에 할당됩니다. 에러 때만 찍는 로그가 인자 변수를 항상 Heap으로 보내기도 합니다. 그렇다고 쓰지 말라는 뜻은 아니며 가독성과 생산성을 해치면 배보다 배꼽이 크므로, 성능이 문제일 때 적용하길 권합니다.
- Logger 선택: `log`는 `any` 비중이 높아 인자가 모두 Heap으로 갑니다. `slog`는 타입을 적는 모양이지만 내부에서 Value 추상화에 `any`를 써서 Heap에 할당됩니다. Uber의 `zap`은 모양은 비슷해도 Primitive type을 Stack에만 두어 할당이 훨씬 적습니다. 예외는 있지만 다른 Logger보다는 낫다고 합니다.
- 포인터: 원문은 포인터로 선언하는 순간 객체가 무조건 Heap에 할당되므로, Go에서는 값 전달이 더 효율적인 경우가 자주 있다고 말합니다.
- slice 용량: Capacity를 상수로 주면 Heap 할당을 없앨 수 있습니다. Go가 크기 64KB 이하 객체를 Stack에 두는 기능이 있기 때문입니다. `make([]int, n)`은 Heap으로 가고 `make([]int, n, maxSize)`는 가지 않습니다.
- Pool: 다른 방법을 적용하기 어려울 때 가장 쉬운 방법이지만 관리 비용 때문에 CPU를 낭비할 수 있어 선택에 신중해야 합니다.
- 최신 패키지: `sort.Slice`는 호출마다 객체 두 개를 Heap에 할당하지만 `slices.SortFunc`는 생성하는 객체가 없습니다. Go가 계속 발전하므로 신규 버전을 모니터링하길 권합니다.

## 튜닝의 절제 {#restraint}

원문은 역설적이게도 가장 중요한 건 필요한 만큼만 하고 멈추는 것이라고 맺습니다. 테크닉을 쌓는 것보다 처음부터 좋은 구조로 설계하는 편이 훨씬 중요하고, 과도한 튜닝은 가독성과 유지보수를 해쳐 더 좋은 구조로 바꾸는 데 장애물이 될 수 있다고 합니다.

{{% details title="원문의 벤치마크 결과 (darwin/arm64)" closed="true" %}}

| 비교 | 결과 |
|---|---|
| 용량 상수 여부 (gcflags 예제) | 용량 변수 `make([]int, n)`: 271.2 ns/op, 2048 B/op, 1 allocs/op. 상수 용량 `make([]int, n, 1024)`: 0.6588 ns/op, 0 B/op, 0 allocs/op |
| 용량 상수 여부 (슬라이스 예제) | 변수: 233.0 ns/op, 2048 B/op, 1 allocs/op. 상수(`maxSize` 1024): 0.6222 ns/op, 0 B/op, 0 allocs/op |
| Pool 비교 | NoCapacity 265.0 ns/op, 2048 B/op, 1 allocs/op. Pool 8.661 ns/op, 0 B/op. ConstantCapacity 171.7 ns/op, 0 B/op |
| 정렬 (1000개 정수) | `slices.SortFunc` 52203 ns/op, 0 B/op, 0 allocs/op. `sort.Slice` 62061 ns/op, 56 B/op, 2 allocs/op |
| 프로파일 예시 | `runtime.findObject` flat 16.00%, `runtime.greyobject` 8.32%, `runtime.scanobject` cum 35.43%, `runtime.gcDrain` cum 36.60% |
{{% /details %}}
