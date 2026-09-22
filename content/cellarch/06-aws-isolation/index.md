---
title: "AWS는 어떻게 가두나 — DynamoDB·Route 53·Lambda·S3의 격리 단위"
linkTitle: "06 AWS의 격리 설계"
weight: 6
date: 2026-09-22
lastmod: 2026-09-22
---

# 06 · AWS는 어떻게 가두나 — DynamoDB·Route 53·Lambda·S3의 격리 단위

{{< callout type="info" >}}
- **AWS의 격리는 셀 하나가 아니라 네 겹이다** — Region → AZ → cell → shuffle shard, 그리고 이 넷을 가로지르는 control plane / data plane 분리 `✓`
- **리전 격리에도 예외가 있다** — IAM·Route 53·CloudFront 같은 글로벌 서비스의 컨트롤 플레인은 `us-east-1` 하나에 몰려 있다 `✓`
- **DynamoDB는 이 전부를 한 서비스 안에서 보여준다** — 파티션·요청 라우터·MemDS·GAC. 다만 논문에 "cell"이라는 단어는 없다 `✓`
{{< /callout >}}

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

리전이 분리되어 있어도 복구에 필요한 컨트롤 플레인은 다른 리전에 있을 수 있습니다. 고객 요청을 처리하는 경로와 장애 중 구성을 바꾸는 경로를 나눠 봐야 AWS의 격리 경계가 드러납니다.

## 1. 리전·AZ·셀이 가두는 실패

AWS Fault Isolation Boundaries 백서는 리전을 이렇게 정의합니다.

> "Regions themselves are isolated and independent from other Regions with a few exceptions … This separation between Regions limits service failures, when they occur, to a single Region."

리전 하나는 대개 3개 이상의 AZ로 나뉩니다. EC2 같은 서비스는 AZ 하나가 죽어도 부하를 흡수할 수 있게 과다 프로비저닝합니다. Builders' Library의 *Static stability using Availability Zones*는 필요한 여유를 수치로 명시합니다.

> "when we use three Availability Zones, we overprovision by 50 percent. Put another way, we overprovision such that each Availability Zone is operating at only 66 percent of the level for which we have load-tested it."

AZ 아래에 오는 게 셀입니다. Well-Architected 가이드는 셀을 "워크로드의 독립적인 여러 사본"이라 정의하고, 셀 하나가 막는 실패는 인프라 장애가 아니라 **잘못된 배포나 poison pill 요청** 같은 소프트웨어·운영 사고라고 명시합니다.

아래 도식에서 각 격리 경계와, 리전 경계를 건너는 오른쪽 점선의 의존성을 함께 볼 수 있습니다.

{{< flow src="_flow/1-격리-계층.json" />}}

## 2. 글로벌 컨트롤 플레인과 복구 경로

리전 격리 원칙에는 백서가 직접 인정하는 예외가 있습니다.

> "there is a small set of AWS services whose control planes and data planes don't exist independently in each Region … The significant difference for most global services is that their control plane is hosted in a single AWS Region, while their data plane is globally distributed." `✓`

백서는 다음 글로벌 서비스의 컨트롤 플레인이 어느 리전에 있는지도 명시합니다.

| 서비스 | 컨트롤 플레인 리전 |
|---|---|
| IAM · Organizations · Account Management | `us-east-1` |
| Route 53 Private DNS · Public DNS | `us-east-1` |
| CloudFront · WAF(CloudFront용) · ACM(CloudFront용) · Shield Advanced | `us-east-1` |
| Route 53 ARC(routing control) | `us-west-2` |
| AWS Network Manager · Global Accelerator | `us-west-2` |

이 목록에 없는 리전 서비스도 생성·수정·삭제 같은 컨트롤 플레인 동작에서만 `us-east-1`의 Route 53에 의존하는 경우가 있습니다. ELB·API Gateway·PrivateLink·Lambda URL·EKS 컨트롤 플레인이 여기 해당합니다 `✓`. 요청을 계속 처리할 수 있는지와 장애 중 구성을 바꿀 수 있는지는 별개입니다. Well-Architected REL11-BP04는 복구 경로에서 이 차이를 구분하도록 요구합니다.

> "Route 53 routing policies use the control plane, so do not rely on it for recovery. The Route 53 data planes answer DNS queries and perform and evaluate health checks. They are globally distributed and designed for a 100% availability service level agreement (SLA)." `✓`
> "the control planes are located in a single Region: US East (N. Virginia). While both systems are built to be very reliable, the control planes are not included in the SLA." `✓`

복구 경로가 컨트롤 플레인에 의존하지 않게 짜는 설계를 AWS는 정적 안정성이라 부릅니다. Builders' Library는 이를 더 넓은 의존성의 문제로 정의합니다.

> "In a statically stable design, the overall system keeps working even when a dependency becomes impaired." `✓`

## 3. DynamoDB의 파티션과 핫키 제어

USENIX ATC '22에 실린 DynamoDB 논문(Elhemali et al.)은 테이블이 여러 파티션으로 나뉘고, 파티션마다 여러 AZ에 흩어진 복제 그룹을 두며, Multi-Paxos로 리더를 뽑는다고 설명합니다. 리더만 쓰기와 강한 일관성 읽기를 처리합니다 `✓`.

DynamoDB는 셀 기반 아키텍처가 아닙니다. 논문 본문에 "cell"이라는 단어가 나오지 않습니다 `✓`. 이 서비스의 격리 단위는 파티션·복제 그룹·AZ이지, 04에서 다룬 의미의 셀이 아닙니다.

핵심 컴포넌트는 요청 라우팅 서비스, 메타데이터 서비스, 스토리지 노드, 그리고 "the central nervous system of DynamoDB"라 불리는 autoadmin입니다 `✓`. 아래 도식은 요청이 이 구성 요소를 거쳐 파티션에 도달하는 경로를 보여줍니다.

{{< flow src="_flow/3-dynamodb-경로.json" />}}

파티션 하나가 감당하는 처리량에는 상한이 있습니다. 논문은 예시로 "a partition can accommodate a maximum provisioned throughput of 1000 WCUs"라 가정하고, 이 가정 위에서 테이블 처리량이 늘 때 파티션이 쪼개지는 과정을 보여줍니다 `✓`. 파티션 크기·RCU·WCU의 구체적인 공식 상한(10GB / 3,000 RCU / 1,000 WCU)은 AWS 개발자 가이드 *Partitions and data distribution*에 나오는 수치입니다. 논문에는 SimpleDB의 옛 한계로 "10GB"가 다른 문맥에서 한 번 나올 뿐이므로, 두 출처를 섞지 않아야 합니다 `Ⓥ`.

한 핫키가 테이블 전체를 굶기지 못하게 막는 장치는 세 겹으로 진화했습니다. 처음에는 파티션마다 쓰지 않은 용량을 300초 동안 쌓아뒀다 쓰는 bursting이었고, 파티션은 노드 레벨 토큰 버킷도 함께 확인해야 했습니다 `✓`. 이어 등장한 adaptive capacity는 치우친 접근 패턴으로 인한 스로틀링의 99.99% 이상을 없앴지만 `✓`, 반응형이라 이미 스로틀링을 겪은 뒤에야 개입했습니다. Global Admission Control(GAC)은 승인 제어 자체를 파티션에서 떼어내 파티션이 항상 버스트할 수 있게 했습니다.

> "Each GAC server can be stopped and restarted without any impact on the overall operation of the service." `✓`

GAC 서버가 상태 없이(ephemeral) 동작한다는 이 문장은 정적 안정성의 또 다른 예입니다. IAM·KMS 의존성도 같은 원칙으로 다룹니다. 요청 라우터가 인증 결과를 캐시해두고, 두 서비스가 끊겨도 캐시로 계속 동작합니다 `✓`. 다만 보호를 받으려면 라우터에 캐시가 있어야 합니다.

> "Clients that send operations to request routers that don't have the cached results will see an impact." `✓`

캐시가 아직 없는 새 라우터는 이 보호를 받지 못합니다.

## 4. 2015-09-20 장애와 MemDS의 일정한 부하

캐시는 의존 서비스의 장애를 버티게 해주지만, 캐시가 비었을 때 몰리는 요청은 별도로 감당해야 합니다. 초기 DynamoDB는 메타데이터를 DynamoDB 자기 자신에 저장했고, 라우터는 테이블 하나를 처음 만나면 그 라우팅 정보 전체를 내려받아 캐시했습니다. 평소 히트율은 약 99.75%였습니다 `✓`. 논문은 높은 히트율 뒤에 남아 있던 취약점을 짚습니다.

> "In the case of a cold start where request routers have empty caches, every DynamoDB request would result in a metadata lookup, and so the service had to scale to serve requests at the same rate as DynamoDB. … Occasionally the metadata service traffic would spike up to 75 percent." `✓`

2015년 9월 20일에는 메타데이터 요청이 몰리면서 장애가 커졌습니다. AWS 사후보고서에 따르면 GSI(글로벌 보조 인덱스) 채택이 늘면서 스토리지 서버의 멤버십 데이터가 커졌고, 02:19 PDT의 네트워크 장애로 다수 스토리지 서버가 동시에 멤버십을 재요청했습니다. 커진 멤버십 데이터를 처리하는 시간이 타임아웃을 넘기자 서버들이 스스로 요청 풀에서 빠졌습니다. 그 자리를 메우려는 재시도가 재시도를 불렀고, 오류율은 02:37 PDT에 약 55%까지 치솟았습니다 `✓`. AWS는 원인을 이렇게 인정합니다.

> "We did not have detailed enough monitoring for this dimension (membership size), and didn't have enough capacity allocated." `✓`

처방으로 나온 MemDS는 메타데이터 전량을 메모리에 올려두는 분산 데이터스토어입니다. 라우터는 캐시가 맞아도 매번 비동기로 갱신을 호출합니다.

> "a cache hit also results in an asynchronous call to MemDS to refresh the cache. Thus, the new cache ensures the MemDS fleet is always serving a constant volume of traffic regardless of cache hit ratio … prevents cascading failures to other parts of the system when the caches become ineffective." `✓`

MemDS가 받는 트래픽은 캐시 적중률과 무관하게 일정하므로, 히트율이 무너져도 부하가 튀지 않습니다. 아래 시퀀스는 기존 경로에서 재시도가 쌓이는 과정과 MemDS가 바꾼 요청 경로를 나란히 보여줍니다.

{{< seq src="_seq/4-2015-메타데이터.json" />}}

## 5. Route 53의 셔플샤딩 규모와 전제

셔플샤딩은 Route 53을 만들 때 태어났습니다. Colm MacCárthaigh는 DDoS 방어 전용 장비를 모두 사기에는 예산이 부족했던 사정을 이렇게 회고합니다.

> "Our necessity was to quickly build a world-class, 100 percent uptime DNS service using a modest amount of resources. Our invention was shuffle sharding." `✓`

워커 8대를 기준으로 한 샤딩·셔플샤딩 비교와 조합 계산은 [04 셀의 해부]({{< relref "../04-cell-anatomy/index.md" >}}) 5절에서 다룹니다. 이 시리즈는 Builders' Library의 *Workload isolation using shuffle-sharding*(2019)에 나온 28을 정본으로 씁니다. 같은 예시를 쓴 2014년 AWS Architecture Blog 원조 글의 8×7=56은 순서를 구분한 값입니다 `✓`.

Route 53은 권위 DNS 용량을 2,048개의 가상 네임서버로 편성하고, 호스팅 존 하나에 그중 4개를 배정합니다. MacCárthaigh의 스레드가 인용하는 조합 수는 약 7,300억(C(2048,4) = 730,862,190,080)이고, 어떤 두 도메인도 가상 네임서버를 2개보다 많이 공유하지 않도록 보장한다고 밝힙니다 `Ⓥ`(2차 인용 대조, 정확한 숫자는 ≈).

셔플샤딩의 이득에는 클라이언트 동작이라는 전제가 붙습니다.

> "If the requestors are fault tolerant and can work around this (with retries for example)" `✓`

클라이언트가 재시도로 실패를 우회해야 이득이 실현됩니다. 앞선 워커 예시에서 손실 자체(워커 2/8, 25%)는 줄지 않습니다. Route 53 SLA 본문도 호스팅 존에 배정된 4개 서버의 응답을 기준으로 비가용 상태를 정의합니다.

> "A Hosted Zone is 'Unavailable' during a given minute if all four virtual name servers assigned to the Hosted Zone fail to respond to all DNS queries made to the Hosted Zone throughout the minute." `✓`

"Route 53은 100% SLA"라는 통념에도 구분이 필요합니다. Well-Architected 문서는 "designed for a 100% availability SLA"라 쓰지만, 실제 SLA 본문은 가용성 구간별로 크레딧을 다르게 주는 계층형이고 그 첫 구간이 "Less than 100%"에서 시작합니다 `✓`. 설계 목표와 SLA의 보상 조건을 같은 뜻으로 읽으면 안 됩니다.

## 6. EBS Physalia의 셀 경계는 볼륨 하나

셀 백서의 "Further reading"이 직접 가리키는 예시가 EBS의 메타데이터 스토어 Physalia입니다. 이 설계의 출발점은 2011년 4월 21일 장애입니다 `✓`.

> "This failure vector was the inspiration behind Physalia's design goal of limiting the blast radius of failures, including overload, software bugs, and infrastructure failures." `✓`

Physalia는 구조를 해파리 군체(colony)에 빗대어 설명합니다.

> "each Physalia installation is a colony, made up of many cells. The cells live in the same environment: a mesh of nodes… Each cell manages the data of a single partition key, and is implemented using a distributed state machine, distributed across seven nodes. Cells do not coordinate with other cells, but each node can participate in many cells." `✓`

여기서 파티션 키는 EBS 볼륨과 대응합니다.

> "Each EBS volume is assigned a unique partition key at creation time, and all operations for that volume occur within that partition key." `✓`

EBS 볼륨 하나가 셀 하나라는 뜻입니다. 논문은 노드 하나가 여러 셀에 걸치고 셀 하나가 소수 클라이언트만 상대한다고도 밝힙니다 `✓`. 셀마다 별도 노드를 독점하지 않고 노드의 조합을 나눈다는 점에서, Route 53의 셔플샤딩과 같은 발상입니다.

## 7. Lambda와 S3에서 공개된 경계

Lambda는 2023-06-13 사후보고서에서 셀 아키텍처를 명시하고, 다른 셀의 함수 호출은 영향을 받지 않았다고 밝힙니다.

> "AWS Lambda makes use of a cellular architecture, where each cell consists of multiple subsystems to serve function invocations for customer code. … Lambda function invocations within other Lambda cells were not affected by this event." `✓`

내부 큐에도 셔플샤딩을 씁니다.

> "AWS Lambda provisions a fixed number of queues, and hashes each customer to a small number of queues. Before enqueueing a message, it checks to see which of those targeted queues contains the fewest messages, and enqueues into that one." `✓`

다만 셀의 크기·개수, 큐의 개수는 공개된 수치를 찾지 못했습니다 `?`.

S3는 2017년 대규모 장애의 사후보고서에서 셀이라는 단어를 직접 쓰며, 인덱스 서브시스템을 더 나누는 작업을 앞당기겠다고 밝혔습니다.

> "By factoring services into cells, engineering teams can assess and thoroughly test recovery processes of even the largest service or subsystem. The S3 team had planned further partitioning of the index subsystem later this year. We are reprioritizing that work to begin immediately." `✓`

이후 인덱스 서브시스템의 내부 구조를 서술한 1차 자료는 찾지 못했습니다 `?`. 고객에게 보이는 파티션 단위는 키 접두사뿐입니다. 접두사 하나당 초당 PUT/COPY/POST/DELETE 3,500건, GET/HEAD 5,500건을 보장하고 버킷 안 접두사 개수에는 제한이 없습니다 `✓`.

ShardStore(SOSP '21)를 S3의 인덱스 계층으로 오인하는 자료도 있습니다. ShardStore는 디스크 하나를 관리하는 최하단 스토리지 노드의 재작성이지 인덱스 계층이 아닙니다 `✓`. Lambda와 S3 모두 셀을 쓴다는 사실은 1차 문서로 확인되지만, 얼마나 잘게 나눴는지는 공개 자료로 확인하지 못한 영역입니다.

서비스 운영 조직이 직접 셀 경계를 정한 사례는 [05 실전 사례]({{< relref "../05-cell-cases/index.md" >}})에서 다룹니다.

## 8. 복구 경로에서 점검할 동작

- 복구 경로에서 Route 53 레코드 변경, IAM 역할·정책 생성, Global Accelerator 가중치 조정 같은 컨트롤 플레인 동작을 빼라 — 이것들은 장애 중 SLA 밖에 있다.
- SDK·CLI가 STS 글로벌 엔드포인트(`us-east-1` 기본값) 대신 **리전 STS 엔드포인트**를 쓰도록 설정을 바꿔라.
- 복구에 필요한 최소한의 자격 증명과 설정은 SSM Parameter Store·DynamoDB·S3에 미리 캐시해두고, break-glass 계정을 미리 만들어두라.
- 여러 AZ에 걸쳐 미리 과다 프로비저닝해두라 — zonal shift 같은 레버는 이미 있는 여유를 옮길 뿐, 새 용량을 만들어주지 않는다.
- 캐시가 무효화될 때 원본으로 몰리는 트래픽이 원본을 넘어뜨리지 않는지 확인하라 — MemDS처럼 히트율과 무관하게 상수 트래픽을 유지하는 설계인지 점검하라.
- fallback 경로를 넣기 전에 "이게 없으면 애초에 왜 캐시를 뒀는가"를 스스로 물어라.
- 운영 툴이 여러 셀·여러 서버를 동시에 건드리지 못하게 속도 제한(velocity control)을 걸어라.

이 격리 설계가 2025년 10월 장애에서 지킨 경계와 지키지 못한 경계는 [07 2025 us-east-1 해부]({{< relref "../07-aws-2025-outage/index.md" >}})에서 이어집니다.

## 참고 자료

- [Reducing the Scope of Impact with Cell-Based Architecture](https://docs.aws.amazon.com/wellarchitected/latest/reducing-scope-of-impact-with-cell-based-architecture/) — AWS Well-Architected, 2023-09-20
- [AWS Fault Isolation Boundaries](https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/) — AWS Whitepaper, 2022-11-16
- [REL11-BP04](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_withstand_component_failures_avoid_control_plane.html) — AWS Well-Architected Framework
- [Static stability using Availability Zones](https://d1.awsstatic.com/builderslibrary/pdfs/static-stability-using-availability-zones.pdf) — Becky Weiss, Mike Furr, Amazon Builders' Library
- [Workload isolation using shuffle-sharding](https://d1.awsstatic.com/builderslibrary/pdfs/workload-isolation-using-shuffle-sharding.pdf) — Colm MacCárthaigh, Amazon Builders' Library
- [Avoiding fallback in distributed systems](https://d1.awsstatic.com/builderslibrary/pdfs/avoiding-fallback-in-distributed-systems.pdf) — Jacob Gabrielson, Amazon Builders' Library
- [Avoiding insurmountable queue backlogs](https://d1.awsstatic.com/builderslibrary/pdfs/avoiding-insurmountable-queue-backlogs.pdf) — David Yanacek, Amazon Builders' Library
- [Amazon DynamoDB: A Scalable, Predictably Performant, and Fully Managed NoSQL Database Service](https://www.usenix.org/system/files/atc22-elhemali.pdf) — Elhemali et al., USENIX ATC '22
- [Millions of Tiny Databases](https://www.usenix.org/system/files/nsdi20-paper-brooker.pdf) — Marc Brooker et al., USENIX NSDI '20
- [Summary of the Amazon DynamoDB Service Disruption and Related Impacts in the US-East Region](https://aws.amazon.com/message/5467D2/) — AWS, 2015-09-20
- [Summary of the Amazon S3 Service Disruption in the Northern Virginia (US-EAST-1) Region](https://aws.amazon.com/message/41926/) — AWS, 2017-02-28
- [Lambda Service Disruption post-mortem](https://aws.amazon.com/message/061323/) — AWS, 2023-06-13
- [Amazon Route 53 SLA](https://aws.amazon.com/route53/sla/) — AWS, 최종 갱신 2025-04-16
- [Amazon S3 성능 최적화 — 접두사당 요청 한도](https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html) — AWS 문서
