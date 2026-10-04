---
title: "MSA가 스케일에서 깨진 지점 — 공유 의존성 하나가 전체를 멈춘 사례들"
linkTitle: "03 공유 의존성 장애"
weight: 3
date: 2026-09-22
lastmod: 2026-09-22
url: "/cellarch/03-shared-failure/"
---

# 03 · MSA가 스케일에서 깨진 지점 — 공유 의존성 하나가 전체를 멈춘 사례들

{{< callout type="info" >}}
- **서비스를 나눠도 그 밑의 공유 층이 하나면 폭발 반경은 전체다** — Uber가 2,200개 마이크로서비스를 운영하며 다시 도메인 단위로 묶어야 했던 이유다 `✓`
- **지리적 분산은 격리가 아니다** — Datadog 2023-03, 5개 리전이 같은 OS 이미지 때문에 동시에 쓰러졌다 `✓`
- **전파가 빠를수록 폭발 반경도 커진다** — Cloudflare 2025-11-18, 파일 하나가 5분마다 전 네트워크에 실려 갔다 `✓`
{{< /callout >}}

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

서비스 수백 개가 설정 저장소 하나를 함께 쓰면, 그 저장소의 장애는 서비스 경계를 넘어갑니다. 서비스 디스커버리, 네트워크 패브릭, 메타데이터 DB, 배포 이미지도 같은 공유 층이 될 수 있습니다. [02 SOA에서 마이크로서비스로]({{< relref "/engineering/architecture/02-microservices/index.md" >}})에서 살펴본 MSA는 배포와 확장의 단위를 나누고 벌크헤드로 프로세스 안의 격리를 얻었습니다. 하지만 서비스 하나의 실패가 호출자로 번지는 것을 막아도, 모든 서비스가 공통으로 딛고 선 층은 남습니다.

## 1. Uber가 서비스를 도메인으로 다시 묶은 이유

2,200개에 가까운 마이크로서비스를 운영하던 Uber는 2020년, 그 규모에서 얻은 것과 잃은 것을 정리했습니다.

> "As Uber has grown to around 2,200 critical microservices, we experienced these tradeoffs first hand."
>
> — Adam Gluck, "Introducing Domain-Oriented Microservice Architecture", Uber Engineering Blog, 2020-07-23 `✓`

Uber가 짚은 문제 중 하나는 서비스가 독립적으로 보여도 실제로는 함께 배포해야 안전한 "네트워크 모놀리스"가 형성된다는 것이었습니다.

> "Networked monoliths can form, where services that appear to be independent all have to be deployed together to safely perform any change."
>
> — 같은 글 `✓`

Uber는 관련 서비스를 도메인 단위로 다시 묶었습니다. 장애가 났을 때 영향을 받는 서비스 수를 도메인 경계로 제한하려는 시도였습니다. 아래 사고들은 그런 경계가 공유 인프라에까지 이르지 못했을 때 어떤 일이 벌어지는지 보여줍니다.

## 2. 여덟 사고의 공유 층과 영향 범위

폭발 반경을 결정하는 것은 서비스 개수가 아니라 공유 자원의 개수입니다. 서비스를 늘리거나 지리적으로 분산해도 이 숫자는 줄지 않습니다. 아래 표에서는 각 사고의 공유 의존성과 그 영향을 함께 볼 수 있습니다.

| 날짜 | 조직 | 공유 의존성 | 폭발 반경 | 지속 시간 | 출처 |
|---|---|---|---|---|---|
| 2017-02-28 | AWS S3 | 리전 단일 index·placement 서브시스템 | AWS 서비스 33개 + 외부 다수 | 약 4시간 17분 | `✓` |
| 2019-07-02 | Cloudflare | 전역 WAF 설정 배포 경로(Quicksilver) | 코어 프록시·CDN·WAF 전체 | 27분 | `✓` |
| 2021-01-04 | Slack | AWS Transit Gateway | 전 서비스 + 모니터링 대시보드 | 약 3시간 반 | `✓` |
| 2021-10-04 | Facebook | 백본 + 권위 DNS BGP 광고 조건 | 전 서비스 + 사내 도구 + 물리 출입 | 약 6시간 | `✓` |
| 2021-10-28~31 | Roblox | Consul 클러스터 하나 | 전체 백엔드 + Nomad·Vault + 관측 | 73시간 | `✓` |
| 2023-03-08~09 | Datadog | 전 리전 동일 OS 이미지·systemd 정책 | 5개 리전 동시 | 약 27시간 | `✓` |
| 2025-06-12 | Google Cloud | Service Control 단일 바이너리 | 제품 수십 개 | 약 3~7시간 | `?` |
| 2025-11-18 | Cloudflare | Bot Management 피처 파일 | 전 네트워크 + 다수 고객사 | 약 6시간 | `✓` |

이 목록과 별도로, 가장 최근이자 가장 복잡한 사례는 [07 2025-10-20 us-east-1]({{< relref "/engineering/architecture/07-aws-2025-outage/index.md" >}})에서 다룹니다. 아래 도식은 표에 든 사고들의 지속 시간 차이를 보여줍니다.

{{< lane src="_lane/2-지속-시간.json" />}}

## 3. Roblox, 73시간 — 진단까지 가로막은 Consul 의존

위 도식에서 가장 오래 이어진 Roblox의 2021년 10월 장애는 원인도 겹겹이었습니다. Consul의 신규 streaming 기능이 읽기·쓰기 부하가 동시에 높을 때 단일 Go 채널 경합을 일으켰고, 여기에 BoltDB의 프리리스트 병리가 겹쳤습니다.

> "Under very high load – specifically, both a very high read load and a very high write load – the design of streaming exacerbates the amount of contention on a single Go channel."
>
> — Roblox, "Roblox Return to Service 10/28-10/31 2021", 2022-01 `✓`

Consul 클러스터는 하나뿐이었고, 전사 서비스 디스커버리를 받쳤습니다. Nomad와 Vault도 그 위에서 컨테이너 스케줄링과 시크릿 조회를 수행했습니다. 원인을 진단해야 할 관측 시스템마저 Consul에 의존해, 장애가 나자 진단에 필요한 가시성까지 잃었습니다.

> "Critical monitoring systems that would have provided better visibility into the cause of the outage relied on affected systems, such as Consul."
>
> — 같은 글 `✓`

아래 도식에서 서비스 장애가 관측을 가로막는 순환을 볼 수 있습니다.

{{< seq src="_seq/3-roblox-순환.json" />}}

Roblox의 사후 조치는 이 순환을 끊는 방향으로 이어졌습니다. 지리적으로 분리된 데이터센터를 늘리고, 텔레메트리를 감시 대상에서 독립시키고, 서비스 샤딩으로 Consul 클러스터를 여러 개로 나눴습니다. 그 뒤 셀 경계를 어떻게 세웠는지는 [05 실전 사례]({{< relref "/engineering/architecture/05-cell-cases/index.md" >}})에서 이어집니다.

## 4. Cloudflare의 전역 설정 배포

Cloudflare가 겪은 두 사고는 6년 간격이지만 전파 경로가 닮았습니다. 서비스 코드는 그대로 두고 설정이나 데이터 파일만 바뀌었는데, 그 변화가 전역에 거의 동시에 도착했습니다.

2019년 7월 2일, 정규식 규칙 하나가 중첩 수량자로 인한 백트래킹 폭발을 일으켰습니다. WAF 규칙은 안전을 위한 단계적 배포 대신 Quicksilver를 통해 몇 초 만에 전 세계로 퍼지도록 설계돼 있었습니다.

> "On average, we hit a p99 of 2.29s for a change to be distributed to every machine worldwide."
>
> — John Graham-Cumming, "Details of the Cloudflare outage on July 2, 2019", Cloudflare Blog `✓`

2025년 11월 18일에는 ClickHouse 권한 변경이 Bot Management 피처 파일 생성 쿼리의 범위를 바꿔 행을 중복시켰습니다. 파일이 런타임 한계를 넘자 Rust 프록시가 패닉을 일으켰고, 그 부풀어 오른 파일이 5분 주기 배포 경로를 타고 전 네트워크에 뿌려졌습니다.

> "The larger-than-expected feature file was then propagated to all the machines that make up our network."
>
> — Cloudflare, "18 November 2025 outage" `✓`

아래 도식은 설정의 변화가 전역 장애로 이어지는 경로를 보여줍니다.

{{< flow src="_flow/4-설정-전파.json" />}}

이 경로에서는 서비스 코드를 한 줄도 바꾸지 않고 전체에 영향을 줄 수 있었습니다. 데이터를 실어 나르는 배포 경로가 서비스 경계를 가로질렀기 때문입니다.

## 5. Facebook과 Slack: 네트워크와 함께 멈춘 복구 수단

Facebook의 2021년 10월 장애는 백본 용량 점검 명령이 감사 도구의 버그로 멈추지 않으면서 시작됐습니다. 백본 전체가 운영에서 빠지자 각 시설이 스스로를 비정상으로 선언하고 BGP 광고를 철회했고, 그 결과 DNS 서버가 멀쩡히 돌고 있으면서도 인터넷에서 사라졌습니다.

> "The entire backbone was removed from operation, making these locations declare themselves unhealthy and withdraw those BGP advertisements. The end result was that our DNS servers became unreachable even though they were still operational."
>
> — Santosh Janardhan, VP Infrastructure, Meta Engineering, 2021-10-05 `✓`

복구 도구조차 같은 DNS에 의존해 멈췄고, 데이터센터 물리 출입 시스템까지 네트워크에 물려 있어 엔지니어가 건물에 들어가지도 못했습니다.

Slack의 2021년 1월 장애는 연휴 직후 트래픽 급증이 공유 AWS Transit Gateway를 포화시키며 시작됐습니다. 오토스케일링이 과잉 반응해 서버 1,200대를 한꺼번에 띄우려다 프로비저닝 서비스가 리눅스 open-files 한계에 걸려 무너졌습니다. 모니터링 대시보드마저 같은 Transit Gateway를 지나는 VPC에 있어, 장애 중에 계기판이 꺼졌습니다.

Roblox에서 진단을 가로막았던 의존 구조가 여기서도 반복됩니다. 관측과 복구 수단이 장애를 일으킨 시스템에 의존하면, 원인을 찾고 서비스를 되살리는 시간까지 길어집니다.

## 6. S3·Datadog·Google Cloud의 공통 기반

AWS S3의 2017년 장애는 입력 실수에서 시작됐습니다. 빌링 시스템을 디버깅하던 엔지니어가 의도보다 많은 서버를 내렸고, 그중에 리전 전체의 객체 메타데이터를 쥔 index 서브시스템 서버가 섞여 있었습니다. S3에 저장을 의존하던 EC2 신규 인스턴스 기동, EBS, Lambda까지 함께 멎었습니다.

Datadog의 2023년 3월 장애는 5개 리전이 공유하는 베이스 OS 이미지에서 systemd 보안 업데이트가 자동 적용되며 Cilium 라우트를 지워, 이 목록에서 유일하게 리전 격리 자체를 무력화한 사례입니다. 실패가 퍼진 경로와 복구 과정은 [05 실전 사례]({{< relref "/engineering/architecture/05-cell-cases/index.md" >}})에서 이어집니다.

Google Cloud의 2025년 6월 12일 장애는 2차 출처로만 확인됩니다 `?`. 정책 변경 기능이 빈 필드가 든 설정을 전역에 거의 즉시 복제하면서 Service Control이라는 단일 관문 바이너리가 널 역참조로 죽었고, 이 관문을 거치는 거의 모든 API 호출과 IAM 토큰 발급이 함께 멈췄다고 알려져 있습니다.

서비스 아래의 공유 층까지 나누려면 격리 경계를 어디에 둬야 할까요. [04 셀 기반 아키텍처]({{< relref "/engineering/architecture/04-cell-anatomy/index.md" >}})에서는 그 경계를 구성하는 요소를 살펴봅니다.

## 참고 자료

- [Introducing Domain-Oriented Microservice Architecture](https://www.uber.com/en-us/blog/microservice-architecture/) — Adam Gluck, Uber Engineering Blog, 2020-07-23
- [Summary of the Amazon S3 Service Disruption in the Northern Virginia (US-EAST-1) Region](https://aws.amazon.com/message/41926/) — AWS, 2017
- [Details of the Cloudflare outage on July 2, 2019](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/) — John Graham-Cumming, Cloudflare
- [Slack's outage on January 4th 2021](https://slack.engineering/slacks-outage-on-january-4th-2021/) — Laura Nolan, Slack Engineering
- [More details about the October 4 outage](https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/) — Santosh Janardhan, Meta Engineering, 2021-10-05
- [Roblox Return to Service 10/28-10/31 2021](https://about.roblox.com/newsroom/2022/01/roblox-return-to-service-10-28-10-31-2021) — Roblox, 2022-01
- [2023-03-08 Incident: Infrastructure connectivity issue affecting multiple regions](https://www.datadoghq.com/blog/2023-03-08-multiregion-infrastructure-connectivity-issue/) — Datadog, 2023-03 `Ⓥ`
- [Failure is inevitable: Learning from a large outage](https://www.datadoghq.com/blog/engineering/rethinking-reliability/) — Datadog Engineering `Ⓥ`
- [18 November 2025 outage](https://blog.cloudflare.com/18-november-2025-outage/) — Cloudflare, 2025-11-18
- [Google Cloud Service Health — 12 June 2025 incident](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) — Google Cloud Status, 2025-06-12
