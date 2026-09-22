---
title: "SOA에서 마이크로서비스로 — 무엇을 나눴고 무엇을 못 나눴나"
linkTitle: "02 SOA → 마이크로서비스"
weight: 2
date: 2026-09-22
lastmod: 2026-09-22
---

# 02 · SOA에서 마이크로서비스로 — 무엇을 나눴고 무엇을 못 나눴나

{{< callout type="info" >}}
- **Bezos의 2002년 API 강제 명령이 SOA 전환의 시작점으로 꼽힌다** — 원문은 Amazon 공식 문서가 아니라 Steve Yegge가 2011년에 남긴 회고이고, 연도도 "2002년경, ±1년"으로만 적혀 있다 `?`
- **Hystrix는 격리의 산수를 숫자 하나로 보여줬다** — 의존성 30개가 각각 99.99%를 지켜도 합성 가용성은 99.7%로 떨어지고, 한 달에 두 시간 넘는 장애로 이어진다 `✓`
- **MSA가 나눈 것은 배포·확장·조직이지 장애 도메인이 아니었다** — 벌크헤드로 프로세스 안의 격리는 얻었지만, 그 바깥의 공유 인프라 층은 여전히 하나였다 `Σ`
{{< /callout >}}

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

애플리케이션의 일부만 고쳐도 전체를 다시 배포하고, 일부에만 부하가 몰려도 전체를 확장해야 했습니다. [01 모놀리스와 수직 확장]({{< relref "../01-monolith/index.md" >}})에서 본 초기 웹 서비스의 구조입니다. 2000년대 초 아마존을 비롯한 몇몇 회사는 이를 서비스로 쪼개기 시작했습니다. 각 서비스를 따로 배포하고 확장할 수 있게 됐지만, 서비스들이 함께 쓰는 인프라까지 나뉜 것은 아니었습니다.

## 1. 서비스 인터페이스와 팀의 책임

가장 널리 도는 SOA 전환의 기원담은 Steve Yegge가 2011년에 쓴 회고입니다. 원래 Google+에 올린 글이 공개 범위 설정 실수로 외부에 새어나간 것으로, Amazon이 공식 확인한 적은 없습니다 `?`. Yegge는 Bezos의 명령을 이렇게 묘사했습니다.

> "he issued a mandate that was so out there, so huge and eye-bulgingly ponderous, that it made all of his other mandates look like unsolicited peer bonuses."
>
> — Steve Yegge, "Stevey's Google Platforms Rant", 2011-10

명령의 골자는 모든 팀이 데이터와 기능을 서비스 인터페이스로만 노출하고, 다른 형태의 프로세스 간 통신(직접 링크, 다른 팀 데이터스토어 직접 읽기, 공유 메모리)을 금지하는 것이었습니다. Yegge는 전환의 대가도 같은 글에 나열했습니다. 호출 체인을 타고 도는 페이지 에스컬레이션, 내부 서비스도 DoS를 당할 수 있다는 점, 서비스 디스커버리의 필요, 디버깅 난이도 상승입니다. 이후 MSA의 부담으로 거론된 문제들이 2011년 회고에 이미 등장합니다.

조직과 아키텍처를 함께 바꿨다는 서사에는 "you build it, you run it"이라는 표현도 따라붙습니다. 2006년 ACM Queue에서 Jim Gray와 Werner Vogels가 나눈 대담으로 알려져 있지만, 원문 접근이 막혀 있어 최초 발화 맥락은 확인하지 못했습니다 `?`. 다만 서비스를 만든 팀이 운영까지 책임진다는 조직 변화는 이후 SOA·MSA 문헌 전반에서 반복됩니다.

## 2. 마이크로서비스가 풀려던 결합

"마이크로서비스"라는 용어를 정리해 표준으로 만든 글은 James Lewis와 Martin Fowler가 2014년 3월에 쓴 "Microservices"입니다 `✓`.

> "The microservice architectural style is an approach to developing a single application as a suite of small services, each running in its own process and communicating with lightweight mechanisms, often an HTTP resource API."
>
> — James Lewis & Martin Fowler, 2014-03-25

두 저자는 컴포넌트를 서비스로 나누기, 비즈니스 역량 중심 조직, 탈중앙 데이터 관리, 장애를 전제로 한 설계 등 아홉 가지 특성을 꼽았습니다. 이들이 짚은 모놀리스의 문제는 배포와 확장의 결합입니다. 부분을 고쳐도 전체를 다시 빌드하고 배포해야 하며, 필요한 부분만 확장할 수 없어 애플리케이션 전체를 늘려야 한다는 것입니다.

서비스를 나누면 이 결합을 풀 수 있습니다. 그렇다고 두 저자가 마이크로서비스를 모든 소프트웨어의 미래로 확정한 것은 아닙니다. 글 말미에는 다음과 같은 유보가 붙어 있습니다.

> "We aren't arguing that we are certain that microservices are the future direction for software architectures."
>
> — Lewis & Fowler, 2014

## 3. Hystrix의 벌크헤드가 막는 경로

서비스를 나눈 뒤에는 호출하는 의존성의 장애를 감당해야 합니다. Netflix의 Hystrix 위키는 그 부담을 가용성의 곱셈으로 보여줍니다 `✓`.

| 항목 | 값 |
|---|---|
| 의존성 개수 | 30개 |
| 개별 가용성 | 99.99% |
| 합성 가용성(0.9999³⁰) | 99.7% `✓` |
| 10억 요청 기준 실패 건수 | 300만 건 `✓` |
| 월간 예상 장애 시간 | 2시간 이상 `✓` |

Hystrix가 내건 목표는 "복잡한 분산 시스템에서 연쇄 장애를 멈추고, 빠르게 실패하고 빠르게 회복한다"는 것이었습니다. 수단은 스레드 풀 격리(벌크헤드), 서킷 브레이커, 폴백입니다. 이 가운데 벌크헤드는 Michael Nygard가 *Release It!*(2007)에서 배 격벽 비유로 이름 붙인 패턴을 프로세스 안으로 가져온 것입니다.

호출 서비스가 서비스 B를 부를 때는 B 전용 스레드 풀을 거칩니다. B가 느려지거나 응답을 멈추면 그 풀만 차오르고, 호출 서비스의 다른 스레드는 영향을 받지 않습니다. 아래 도식은 지연된 호출이 전용 풀 안에 머무는 경로를 보여줍니다.

{{< seq src="_seq/3-벌크헤드.json" />}}

이 경계는 한 프로세스 안에서 서비스 B의 지연이 호출 서비스 전체로 번지는 것을 막습니다. 2007년의 벌크헤드 패턴이 2012년의 스레드 풀로 구현된 셈입니다. 이 은유는 이후 [04 셀 기반 아키텍처]({{< relref "../04-cell-anatomy/index.md" >}})에서 배포 단위 전체로 한 번 더 확대됩니다.

## 4. 서비스 아래에 남은 공유 층

MSA를 설명하는 표준 그림에는 게이트웨이 뒤로 여러 서비스가 있고, 서비스마다 자기 DB가 있습니다. 실제 배치에서는 여기에 이벤트 버스, 설정 저장소, 서비스 디스커버리처럼 서비스들이 함께 쓰는 층이 더해집니다. 아래 도식에서는 서비스 경계 밖의 의존성이 어디로 모이는지 볼 수 있습니다.

{{< flow src="_flow/2-공유-층.json" />}}

설정 저장소가 잘못된 값을 전파하거나 이벤트 버스가 막히면, 장애는 그 층에 의존하는 서비스 전부로 퍼집니다. Hystrix의 전용 풀도 공유 인프라 자체의 장애를 막지는 못합니다. 스레드 풀은 각자 멀쩡한 채로 같은 원인에 함께 실패합니다. 보호하는 범위가 "서비스 호출"이었지 "공유 자원"은 아니었기 때문입니다 `Σ`.

이 구분을 배포·확장·조직·장애 도메인에 적용하면 다음과 같습니다.

| 축 | 나눔 여부 | 근거 |
|---|---|---|
| 배포 주기 | 나눔 | 서비스별 독립 빌드·배포 |
| 확장 단위 | 나눔 | 서비스별 인스턴스 수 조절 |
| 조직 경계 | 나눔 | "만든 팀이 운영한다"는 책임 분리 |
| 장애 도메인 | 안 나눔 | 이벤트 버스·설정 저장소 등 공유 층이 하나 `Σ` |

서비스별 경계가 생겨도 "고객 한 명의 몫"을 따로 가두는 경계는 생기지 않았습니다. 공유 층 하나가 무너지면 서비스 수와 무관하게 장애가 퍼질 수 있습니다. 이 경로가 실제 장애에서 어떻게 드러났는지는 [03 MSA가 스케일에서 깨진 지점]({{< relref "../03-shared-failure/index.md" >}})에서 이어집니다. 격리 단위를 서비스에서 고객 몫으로 옮긴 시도는 [04 셀 기반 아키텍처]({{< relref "../04-cell-anatomy/index.md" >}})에서 다룹니다.

## 5. Prime Video의 역류는 어디까지였나

2023년 5월, Prime Video의 한 팀이 쓴 글이 "마이크로서비스에서 모놀리스로 돌아갔다"는 제목으로 널리 퍼졌습니다. 이 글을 인용할 때는 출처의 제한부터 밝혀야 합니다. `primevideotech.com`의 원문은 현재 `aboutamazon.com`으로 리다이렉트되어 직접 확인할 수 없고, 아래 수치는 여러 2차 보도에서 반복적으로 확인된 것입니다 `?`.

보도가 전하는 대상은 Prime Video 전체가 아니라 오디오·비디오 품질을 모니터링하는 한 도구입니다. Step Functions와 Lambda, S3로 짠 서버리스 오케스트레이션이 예상 부하의 약 5% 지점에서 스케일 한계에 부딪혔고, 컴포넌트를 하나의 프로세스로 합쳐 ECS로 옮긴 뒤 "인프라 비용이 90% 넘게 줄었다"고 2차 자료들은 전합니다 `?`.

전 Netflix 클라우드 아키텍트 Adrian Cockcroft는 이를 "마이크로서비스에서 모놀리스로의 후퇴"가 아니라 "서버리스 프로토타입에서 마이크로서비스로 가는 정상적인 2단계"라고 짚었습니다. 며칠 뒤 Werner Vogels도 같은 입장을 정리했습니다.

> "Building evolvable software systems is a strategy, not a religion."
>
> — Werner Vogels, "Monoliths are not dinosaurs", 2023-05-05

Vogels는 같은 글에서 Prime Video가 라이브 스포츠에는 분산 워크플로를, 모니터링에는 모놀리식 구조를 쓴다고 나란히 언급합니다. 같은 조직 안에서도 용도에 따라 두 구조가 공존합니다. 모놀리스를 선택지로 남겨 둔 논의는 2023년 이전에도 있었습니다. Fowler는 2015년에 이렇게 썼습니다.

> "The majority of software systems should be built as a single monolithic application."
>
> — Martin Fowler, "MonolithFirst", 2015-06-03

코드 구조와 장애 경계를 다른 축으로 다룬 사례도 있습니다. Shopify는 애플리케이션 코드를 "모듈러 모놀리스"로 유지하면서, 데이터 계층은 2015년 샤딩과 2016년 pods 재편을 거쳐 셀 단위로 격리했습니다. 이는 2018년 공개 글 기준의 설명입니다 `≈`. 공유 Redis 장애("Redismageddon") 이후에는 샤드마다 MySQL·Redis·Memcached를 따로 뒀습니다 `≈`. 애플리케이션을 모듈러 모놀리스로 유지하는 선택과 셀로 장애 범위를 나누는 선택은 함께 성립합니다.

## 참고 자료

- [Stevey's Google Platforms Rant](https://gist.github.com/chitchcock/1281611) — Steve Yegge, 2011-10, 회고(Amazon 공식 확인 없음)
- [Microservices](https://martinfowler.com/articles/microservices.html) — James Lewis, Martin Fowler, 2014-03-25
- [Netflix/Hystrix wiki](https://github.com/Netflix/Hystrix/wiki) — Netflix
- [MonolithFirst](https://martinfowler.com/bliki/MonolithFirst.html) — Martin Fowler, 2015-06-03
- [MicroservicePremium](https://martinfowler.com/bliki/MicroservicePremium.html) — Martin Fowler, 2015-05-13
- [Monoliths are not dinosaurs](https://www.allthingsdistributed.com/2023/05/monoliths-are-not-dinosaurs.html) — Werner Vogels, 2023-05-05
- [Deconstructing the Monolith](https://shopify.engineering/deconstructing-monolith-designing-software-maximizes-developer-productivity) — Kirsten Westeinde, Shopify Engineering, 2019-02-21
- [A Pods Architecture To Allow Shopify To Scale](https://shopify.engineering/a-pods-architecture-to-allow-shopify-to-scale) — Xavier Denis, Shopify Engineering, 2018-03-02
