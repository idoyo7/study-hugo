---
title: "CPU 부담이 된 Golang GC의 진단과 튜닝 지점"
description: "Golang GC가 CPU를 많이 쓸 때 어디부터 손대야 할까요? 프로파일로 부담을 확인하고 GOMEMLIMIT과 Heap 할당 코드를 조정한 뒤, Benchmark에서 할당량과 CPU 비용을 비교합니다."
date: 2026-11-14
weight: 7
---

# CPU 부담이 된 Golang GC의 진단과 튜닝 지점 (2024-05)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Golang GC 튜닝 가이드](https://tech.kakao.com/posts/618)
- 매체 · 게시일: 카카오 기술블로그 · 2024-05-13
- 저자: yanoo.kim (편집 June.6)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## CPU 프로파일 상위권에 오른 GC 함수 {#profile}

알아서 메모리를 관리해 주던 고마운 GC가 어느 순간 프로그램의 짐이 됩니다. CPU를 점점 더 쓰면서 로직에 부담을 주기 시작합니다. 그렇다고 곧바로 코드를 고칠 일은 아닙니다. GC 때문에 성능이 떨어지는지부터 Profile로 확인해야 합니다.

프로파일은 프로그램에서 파일로 저장하거나 `net/http/pprof` 웹 서버에 요청해 얻습니다. 저자가 선호하는 쪽은 필요할 때 단말에서 바로 결과를 확인하는 웹 방식입니다. 인프라가 갖춰져 있다면 Pyroscope를 이용한 Continuous Profiling도 권합니다.

결과를 `go tool pprof`로 열고 Top으로 정렬하면 CPU를 많이 쓰는 함수가 드러납니다. `runtime.findObject`나 `runtime.greyObject` 같은 GC 함수가 상위권에 있다면 튜닝에 나설 때입니다. 예시 프로파일에서는 `runtime.findObject`가 flat 기준 16%로 맨 위에 올랐습니다.

## 증가율 대신 한계선을 둔 GOMEMLIMIT {#gomemlimit}

저자가 가장 쉬운 방법으로 제시한 것은 GOGC를 끄고 GOMEMLIMIT만 사용하는 설정입니다. GC가 동작하는 동안 프로그램이 멈추는 Stop the World(STW)를 줄이기 위해, GC가 최대한 늦게 동작하도록 하는 접근입니다.

GOGC는 직전 시점 대비 Heap 증가율로 GC 수행 여부를 정합니다. 기본값은 100입니다. Heap이 두 배가 되면 GC가 동작하는데, 같은 두 배라도 실제 늘어난 메모리 양은 크게 다를 수 있습니다. 1GB가 2GB가 되는 경우와 10MB가 20MB가 되는 경우가 모두 100% 증가입니다. 재시작 직후처럼 Heap이 작을 때는 조금만 할당해도 GC가 허겁지겁 수행됩니다.

GOGC 값을 크게 잡으면 메모리 사용량이 문제가 됩니다. Heap이 40GB이고 GOGC가 50이면 60GB가 되어야 GC가 동작하므로 OOM 가능성이 커집니다. 프로그램 시작과 함께 더미 메모리를 할당하는 ballast 기법도 있었지만, 저자는 GOMEMLIMIT을 그 대안으로 제시합니다.

GOGC를 끄고 GOMEMLIMIT만 사용하면, 메모리 사용량이 설정한 한계선에 이를 때 GC가 동작합니다. 먼저 프로그램이 쓸 수 있는 최대 메모리를 산정하고, GOMEMLIMIT은 그보다 작게 잡습니다. 이 설정은 소프트 리밋이어서 프로그램이 설정값을 조금 넘겨 메모리를 쓸 수 있기 때문입니다. 이처럼 한계선을 두면 GC 주기를 최대한 늘려 STW를 최소화할 수 있습니다.

## 누적 할당량이 드러나는 Heap Profile {#heap-profile}

설정으로 GC 주기를 늦췄다면, 코드에서는 GC가 관리할 객체를 줄입니다. Stack은 함수 호출과 종료에 따라 자연스럽게 관리됩니다. GC 튜닝에서 살펴볼 곳은 Heap입니다.

Heap Profile의 `inuse_objects`와 `inuse_space`는 현재 사용 중인 객체 수와 메모리 양입니다. `alloc_objects`와 `alloc_space`는 프로그램 시작 이후 누적해서 할당한 객체 수와 메모리 양을 뜻합니다. GC 부하를 찾을 때는 alloc 계열에 더 무게를 둡니다.

원문이 든 예는 현재 사용량이 모두 1GB인 객체입니다. alloc도 1GB라면 한 번 할당한 뒤 계속 쓰므로 GC가 개입할 일이 없습니다. alloc이 1TB인 경우는 1024번 할당했고 GC도 그만큼 수행된 상황으로 설명합니다. 지금 남아 있는 양만으로는 반복해서 할당한 비용이 드러나지 않습니다.

`alloc_space`가 크면 Heap이 빠르게 늘어 GC 주기가 짧아집니다. `alloc_objects`가 크면 Marking 같은 작업에 CPU를 많이 씁니다. GC가 자주 동작하는 문제와 오래 걸리는 문제를 찾으려면 함께 봐야 하는 지표입니다.

이 지표들을 기준으로 Flame graph를 열면 할당이 많은 함수를 찾을 수 있습니다. 가로축에서 차지하는 비중이 큰 함수가 GC 대상 객체를 많이 만드는 곳입니다. 함수를 클릭하면 소스코드까지 이어져, 어느 줄에서 할당하는지 확인할 수 있습니다.

## Heap으로 빠져나간 변수의 경로 {#gcflags}

할당이 많은 코드를 찾았어도 이유는 남아 있습니다. `go build -gcflags='-m'`은 Heap에 할당되는 변수를 `escapes to heap`으로 표시합니다. 인자를 `-m -m`으로 바꾸면 그 원인인 flow까지 나옵니다. 예제에서는 `fmt.Println`에 넘긴 `j`와 `fmt.Printf`에 넘긴 `k`가 Heap으로 갔고, `i`는 Stack에 남았습니다.

값 복사를 피하려고 포인터를 넘기는 코드도 점검 대상입니다. 원문은 포인터로 선언하는 순간 객체가 무조건 Heap에 할당된다고 설명하며, 이를 이유로 Golang에서는 CallByPointer보다 CallByValue가 효율적인 경우가 자주 있다고 말합니다.

## 에러 때만 찍는 로그에도 남는 Heap 할당 {#tips}

앞선 예제에서 `j`와 `k`가 Heap으로 간 이유는 `fmt.Println`과 `fmt.Printf`가 `any` 인자를 받기 때문입니다. 무엇이든 받으려면 변수의 타입을 설명하는 보조 정보가 필요하고, 이 정보가 있는 데이터는 Heap에 할당됩니다. `interface`나 `reflect`처럼 타입을 읽고 해석하는 추상화도 GC 부하의 원인입니다.

실제로 호출되는지만 살펴서는 부족합니다. 예제에서는 `i`가 0이어서 실행될 일 없는 `if i == 1 { fmt.Println(j) }` 분기만 있어도 `j`가 Heap에 할당됩니다. 컴파일러가 비정형 인자로 사용될 가능성을 보고 선언 시점부터 Heap에 두도록 정했기 때문입니다. 에러가 났을 때만 잠깐 실행하는 로그가 평소에도 GC 대상을 늘리는 원인이 될 수 있습니다.

Logger 선택에 따라 할당량도 달라집니다. 기본 패키지의 `log`는 `any` 사용 비중이 높아 인자들이 모두 Heap으로 갑니다. go1.21에서 추가된 `slog`는 타입을 지정하는 모양이지만, 내부에서 Value를 추상화하며 `any`를 사용해 Heap 할당이 발생합니다.

Uber의 `zap`은 비슷한 형태로 로그를 남기면서도 Heap 할당이 훨씬 적습니다. Primitive type은 Stack에 두고 Heap으로 보내지 않습니다. 예외적인 경우는 있지만, 원문에서 비교한 다른 Logger보다 좋은 성능을 보였습니다.

그렇다고 비정형 인자를 모두 없애라는 뜻은 아닙니다. 가독성과 생산성을 높여 주는 장점도 있습니다. 성능 문제가 확인됐을 때 줄일 대상을 찾는 편이 낫습니다.

## 상수 용량과 새 패키지에서 줄어든 할당 {#allocation}

slice나 map을 만들 때 Capacity를 지정하면 재할당을 피하는 데 도움이 됩니다. 크기가 커질 때 새 메모리를 할당하고, 데이터를 옮기고, 기존 객체를 버리는 realloc의 비용을 줄이는 방법입니다.

slice는 여기서 더 줄일 여지가 있습니다. Capacity나 len을 상수로 지정하면 Heap 할당 자체를 없앨 수 있습니다. Golang이 데이터 타입을 고려해 크기가 64KB 이하인 객체를 Stack에 두는 기능을 이용합니다. 예제의 `make([]int, n)`은 Heap에 할당됐지만, 상수 `maxSize`가 1024인 `make([]int, n, maxSize)`는 Heap에 할당되지 않았습니다.

정렬할 개수가 적다는 이유로 자주 호출하는 함수도 살펴볼 대상입니다. 원문에서 비교한 `sort.Slice`는 호출할 때마다 객체 두 개를 Heap에 할당하지만, `slices.SortFunc`는 객체를 생성하지 않습니다. 1000개의 정수를 정렬한 Benchmark에서도 각각 2 allocs/op와 0 allocs/op를 기록했습니다.

이 차이는 새 패키지를 살필 이유이기도 합니다. 저자는 이후 버전에서 `sort.Slice`도 Heap 할당이 없도록 최적화될 수 있다고 보고, Golang의 새 버전과 기능을 꾸준히 살피기를 권합니다.

## 할당량과 CPU 비용을 함께 보는 Benchmark {#restraint}

`escapes to heap`을 한 줄씩 따라가는 일은 눈이 아픕니다. 표시가 많다고 실제 할당까지 많은 것도 아닙니다. 한 번 만든 객체를 재활용하거나, 해당 코드를 드물게 호출할 수 있기 때문입니다. 서비스에 배포해 확인하는 방법이 가장 확실하지만, 매번 그렇게 확인하는 부담을 줄이기 위해 저자는 Benchmark 중심의 튜닝을 권합니다.

```
go test -bench=. -benchmem -benchtime=10s -cpuprofile=cpu.prof -memprofile=mem.prof -gcflags='-m'
```

`-benchmem`은 루프 한 번당 할당 크기와 횟수를 보여 줍니다. `-cpuprofile`과 `-memprofile`은 실행 중의 CPU·메모리 프로파일을 파일로 남겨 할당 위치를 찾는 데 씁니다. 테스트에도 `-gcflags='-m'`을 적용해 Heap으로 가는 변수를 확인할 수 있습니다.

다른 방법을 적용하기 어려울 때는 Pool이 가장 쉽게 쓸 수 있는 방법입니다. 객체를 재활용해 Heap 할당을 줄입니다. 하지만 Pool을 관리하는 연산에도 CPU가 들기 때문에, 할당량은 줄었는데 Benchmark 속도는 오히려 떨어질 수 있습니다.

짧게 실행하는 Benchmark에서는 GC 부하가 잘 드러나지 않는다는 점도 남습니다. 할당을 줄인 이득은 GC가 동작해야 확인할 수 있기 때문입니다. Pool의 관리 비용과 GC 부하 감소 중 어느 쪽이 더 큰지는 프로그램에 따라 판단해야 합니다.

{{% details title="프로파일과 벤치마크의 측정값 (darwin/arm64)" closed="true" %}}

| 비교 | 결과 |
|---|---|
| 용량 상수 여부 (gcflags 예제) | 용량 변수 `make([]int, n)`: 271.2 ns/op, 2048 B/op, 1 allocs/op. 상수 용량 `make([]int, n, 1024)`: 0.6588 ns/op, 0 B/op, 0 allocs/op |
| 용량 상수 여부 (슬라이스 예제) | 변수: 233.0 ns/op, 2048 B/op, 1 allocs/op. 상수(`maxSize` 1024): 0.6222 ns/op, 0 B/op, 0 allocs/op |
| Pool 비교 | NoCapacity 265.0 ns/op, 2048 B/op, 1 allocs/op. Pool 8.661 ns/op, 0 B/op. ConstantCapacity 171.7 ns/op, 0 B/op |
| 정렬 (1000개 정수) | `slices.SortFunc` 52203 ns/op, 0 B/op, 0 allocs/op. `sort.Slice` 62061 ns/op, 56 B/op, 2 allocs/op |
| 프로파일 예시 | `runtime.findObject` flat 16.00%, `runtime.greyobject` 8.32%, `runtime.scanobject` cum 35.43%, `runtime.gcDrain` cum 36.60% |
{{% /details %}}

튜닝 때문에 가독성과 생산성이 떨어지면 배보다 배꼽이 커집니다. 프로그램의 바탕은 자료구조와 알고리즘이며, 과도하게 손본 코드는 유지보수가 어려워져 더 좋은 설계로 바꾸는 데도 장애물이 됩니다. 잘 조리한 요리의 풍미를 살리는 향신료 한 방울처럼, 튜닝도 필요한 만큼에서 멈춰야 합니다.
