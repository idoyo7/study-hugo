---
title: "eBPF 성능 튜닝에 즉각적인 피드백을 주는 bpftop"
description: "Netflix의 bpftop은 eBPF 코드를 고친 뒤 성능이 얼마나 달라졌는지 바로 확인하도록 돕습니다. 프로그램별 성능 지표를 실시간으로 계산하고, 실행 중에만 통계를 수집해 측정에 따른 부하를 줄입니다."
date: 2026-11-14
weight: 6
---

# eBPF 성능 튜닝에 즉각적인 피드백을 주는 bpftop (2024-02)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Announcing bpftop: Streamlining eBPF performance optimization](https://netflixtechblog.com/announcing-bpftop-streamlining-ebpf-performance-optimization-6a727c1ae2e5)
- 매체 · 게시일: Netflix TechBlog · 2024-02-26
- 저자: Jose Fernandez
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 코드 수정 뒤 바로 확인하는 성능 변화 {#features}

bpftop을 쓰면 eBPF 프로그램의 성능 기준선을 빠르게 잡고, 코드를 고친 뒤 그 효과를 바로 확인할 수 있습니다. 값을 직접 계산하던 수고를 덜어 줍니다. 벤치마크를 실행하고 코드를 개선한 다음 결과를 확인하는 과정에 즉각적인 피드백을 주는 명령줄 도구입니다.

Netflix가 bpftop을 공개한 배경에는 늘어나는 eBPF 활용이 있습니다. 다른 관리형 서비스에 적용하는 엄밀함을 eBPF 프로그램에도 적용해야 한다고 본 것입니다. eBPF가 주는 이점을 누리면서도 시스템에 얼마나 부하를 주는지 살펴야 합니다.

화면에는 실행 중인 프로그램마다 평균 실행 시간, 초당 이벤트 수, 추정 전체 CPU 사용률이 나타납니다. 숫자를 읽는 방식도 고를 수 있습니다. top 같은 표로 현재 값을 보거나, 최근 10초를 담는 이동 창의 시계열 그래프로 흐름을 살펴보는 방식입니다. 그래프에서는 숫자만 볼 때 놓치기 쉬운 패턴과 추세가 드러납니다.

## 측정하는 동안에만 켜 두는 런타임 통계 {#how-it-works}

측정 자체에도 부하가 따릅니다. eBPF 런타임 통계가 기본적으로 꺼져 있는 이유입니다. bpftop은 `BPF_ENABLE_STATS` 시스템 콜 명령으로 전역 eBPF 런타임 통계 수집을 켜고, 종료할 때 다시 끕니다. 통계를 수집하는 시간을 도구가 실행되는 동안으로 한정해 오버헤드를 줄입니다.

통계는 1초마다 읽습니다. bpftop은 매번 읽은 통계를 바탕으로 해당 구간의 프로그램별 평균 실행 시간과 초당 이벤트 수, 추정 CPU 사용률을 계산합니다. 코드 개선의 효과를 확인할 때 쓰는 실시간 지표는 이렇게 만들어집니다.

## Rust로 만든 오픈소스 프로젝트 {#getting-started}

bpftop은 Rust로 작성했으며 libbpf-rs와 ratatui crate를 사용합니다. Apache 2 라이선스로 공개했고, 커뮤니티의 기여를 기대한다고 밝혔습니다. 사용법은 프로젝트의 GitHub 페이지에서 확인할 수 있습니다.
