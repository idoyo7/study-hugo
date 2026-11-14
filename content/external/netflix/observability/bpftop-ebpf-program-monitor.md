---
title: "bpftop, eBPF 프로그램 성능 모니터링 도구"
description: "Netflix가 eBPF 프로그램의 실행 시간과 CPU 사용률을 실시간으로 보여 주는 bpftop을 오픈소스로 공개했습니다. 동작 방식과 쓰임새를 정리했습니다."
date: 2026-11-14
weight: 6
---

# bpftop, eBPF 프로그램 성능 모니터링 도구 (2024-02)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Announcing bpftop: Streamlining eBPF performance optimization](https://netflixtechblog.com/announcing-bpftop-streamlining-ebpf-performance-optimization-6a727c1ae2e5)
- 매체 · 게시일: Netflix TechBlog · 2024-02-26
- 저자: Jose Fernandez
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 공개 배경 {#background}

Netflix는 eBPF를 점점 더 많이 쓰고 있고, 다른 관리형 서비스에 들이는 만큼의 엄밀함을 eBPF 애플리케이션에도 적용해야 한다고 봅니다. eBPF의 이점과 시스템 부하 사이의 균형이 중요하기 때문입니다. bpftop은 이 균형을 맞추면서 eBPF의 가능성을 쓰도록 돕는 명령줄 도구로, 2024년 2월에 공개됐습니다.

## 보여 주는 정보와 쓰임새 {#features}

bpftop은 실행 중인 eBPF 프로그램을 실시간으로 보여 줍니다. 프로그램마다 평균 실행 시간, 초당 이벤트 수, 추정 전체 CPU 사용률을 표시합니다. 성능 통계는 도구가 켜져 있는 동안에만 켜 두어 오버헤드를 줄입니다.

최적화 과정이 벤치마크, 코드 개선, 즉각적인 확인의 순환으로 돌아가게 하는 것이 목적입니다. 도구가 없으면 값을 직접 계산해야 해서 번거롭습니다. bpftop을 쓰면 기준선을 빠르게 잡고, 개선을 적용한 뒤, 효과를 바로 확인할 수 있습니다. 통계를 시계열 그래프로 볼 수 있다는 점이 눈에 띄는 기능입니다. 표만 봐서는 놓치기 쉬운 패턴과 추세가 그래프에서는 드러납니다.

## 동작 방식 {#how-it-works}

bpftop은 `BPF_ENABLE_STATS` 시스템 콜 명령으로 eBPF 런타임 통계 수집을 켭니다. 이 통계는 성능 오버헤드를 줄이려고 기본값이 꺼져 있습니다. 1초마다 통계를 모아 그 구간의 프로그램별 평균 실행 시간, 초당 이벤트 수, 추정 CPU 사용률을 계산합니다. 결과는 top 같은 표나 10초 이동 창의 시계열 그래프로 볼 수 있습니다. bpftop이 종료되면 통계 수집도 다시 꺼집니다. 도구는 Rust로 작성했고 libbpf-rs와 ratatui crate를 씁니다.

## 시작하기 {#getting-started}

사용법은 프로젝트의 GitHub 페이지에 있습니다. Apache 2 라이선스의 오픈소스이고, 원문은 커뮤니티의 기여를 기다린다고 밝힙니다.
