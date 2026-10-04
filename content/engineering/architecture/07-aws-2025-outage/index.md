---
title: "2025-10-20 us-east-1 — 격리가 지킨 것과 못 지킨 것"
linkTitle: "07 2025 us-east-1 해부"
weight: 7
date: 2026-09-22
lastmod: 2026-09-22
url: "/cellarch/07-aws-2025-outage/"
---

# 07 · 2025-10-20 us-east-1 — 격리가 지킨 것과 못 지킨 것

{{< callout type="info" >}}
- **터진 건 DynamoDB의 데이터가 아니라 리전 엔드포인트로 가는 길이었다** `✓` — 파티션·스토리지 노드는 무사했고, 다른 리전도 그대로 돌았다.
- **경합을 일으킨 건 셀도 샤드도 아닌, 리전당 하나뿐인 DNS 관리 자동화였다** `✓` — 중복 실행이라는 안전장치가 오히려 경합의 재료가 됐다.
- **AWS의 개선 약속 4개 중 3개는 셀 분할이 아니라 속도 제한이었다** `✓` — 이 사고는 공간을 나눠서 풀리는 문제가 아니었다.
{{< /callout >}}

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

2025년 10월 20일 월요일 오후, us-east-1 하나가 인터넷의 상당 부분을 14시간 32분 동안 흔들었습니다. Snapchat, Fortnite, Coinbase, Venmo가 동시에 흔들리는 모습을 본 사람들에게는 "클라우드 하나가 세상을 멈췄다"는 인상이 남았을 것입니다. 그런데 AWS가 공개한 사후보고서를 그대로 따라가 보면, 이 사건은 그런 이야기가 아닙니다. [06 AWS는 어떻게 가두나]({{< relref "/engineering/architecture/06-aws-isolation/index.md" >}})에서 본 리전·AZ·셀·셔플샤딩의 격리 계층은 이번에도 대부분 제 역할을 했습니다.

무너진 자리는 따로 있었습니다. 리전 하나에 딱 하나뿐인 DNS 레코드를 관리하는 자동화, 그리고 그 위에 얹힌 EC2·NLB·Lambda의 의존 사슬입니다. 고객 몫을 나누는 셀 경계가 있어도, 모든 고객이 거치는 엔드포인트와 그 관리 자동화는 공유 의존성으로 남아 있었습니다.

## 1. DNS 복구 뒤에도 이어진 14시간 32분

AWS의 공식 사후보고서 제목은 "Summary of the Amazon DynamoDB Service Disruption in the Northern Virginia (US-EAST-1) Region"입니다 `✓`. 전체 사건은 PDT 10월 19일 23시 48분부터 10월 20일 14시 20분까지, KST로는 10월 20일 오후 3시 48분부터 21일 새벽 6시 20분까지 이어졌습니다.

| PDT | UTC | KST | 사건 |
|---|---|---|---|
| 10-19 23:48 | 10-20 06:48 | 10-20 15:48 | DynamoDB 리전 엔드포인트 DNS 레코드가 비워짐. 장애 시작 |
| 10-20 00:38 | 10-20 07:38 | 10-20 16:38 | DNS 상태가 원인으로 특정됨 (50분 소요) |
| 10-20 02:25 | 10-20 09:25 | 10-20 18:25 | DNS 정보 전면 복구. 동시에 EC2 DWFM이 리스 재수립 착수 |
| 10-20 02:40 | 10-20 09:40 | 10-20 18:40 | 캐시된 DNS 만료 완료. 1차(DynamoDB) 장애 종료 |
| 10-20 04:14 | 10-20 11:14 | 10-20 20:14 | DWFM 유입 스로틀·선별 재시작으로 정체 탈출 시도 |
| 10-20 05:28 | 10-20 12:28 | 10-20 21:28 | 신규 EC2 기동 재개. Network Manager 전파 백로그 시작 |
| 10-20 05:30 | 10-20 12:30 | 10-20 21:30 | NLB 연결 오류 시작 |
| 10-20 09:36 | 10-20 16:36 | 10-21 01:36 | NLB 자동 헬스체크 failover 비활성화 → 연결 오류 해소 |
| 10-20 13:50 | 10-20 20:50 | 10-21 05:50 | EC2 API·신규 기동 전면 정상 |
| 10-20 14:20 | 10-20 21:20 | 10-21 06:20 | 이벤트 종료 |

DynamoDB API 오류는 2시간 52분이었지만, 여기에 의존하던 서비스의 복구는 훨씬 오래 걸렸습니다. NLB 연결 오류는 8시간 39분(AWS 집계 구간 05:30~14:09 PDT), EC2 신규 기동 실패의 여파는 13시간 넘게 남았습니다. 아래 도식에서 각 서비스의 장애 구간이 어떻게 겹치고 이어지는지 볼 수 있습니다.

{{< lane src="_lane/1-타임라인.json" />}}

## 2. 오래된 플랜이 DNS 레코드를 비우기까지

DynamoDB는 리전마다 대규모 이기종 로드밸런서 플릿을 운영하려고 수십만 개의 DNS 레코드를 관리합니다 `✓`. 이 자동화는 플랜을 만드는 쪽과 적용하는 쪽으로 나뉩니다. DNS Planner는 로드밸런서의 헬스와 용량을 감시해 엔드포인트별 플랜을 주기적으로 만듭니다. 리전당 단일 플랜을 만드는 이유는 AWS 원문에 따르면 "용량이 여러 엔드포인트에 걸쳐 공유될 때 용량 관리와 장애 완화를 크게 단순화하기 때문"입니다 `✓`.

DNS Enactor는 그 플랜을 Route 53 트랜잭션으로 적용합니다. "어떤 시나리오에서든 시스템 복구가 가능하도록 의존성을 최소로 설계"됐고, 3개 AZ에서 서로 완전히 독립적으로 중복 실행됩니다 `✓`. 의존성을 줄이고 AZ 3중화와 트랜잭션 보호까지 갖췄지만, 이 중복 실행이 경합의 재료가 됐습니다.

Enactor는 플랜 적용을 시작할 때 "자기 플랜이 직전 적용 플랜보다 최신인가"를 한 번만 검사합니다 `✓`. Enactor A가 여러 엔드포인트에서 비정상적으로 느려져 재시도를 거듭하는 사이, Planner는 계속 새 세대의 플랜들을 만들어냈습니다. Enactor B는 최신 플랜을 집어 전체 엔드포인트를 빠르게 갱신한 뒤 오래된 플랜을 지우는 정리 절차를 호출했습니다. 바로 그 순간, 지연됐던 A가 자신의 오래된 플랜으로 최신 플랜을 덮어썼습니다. 시작할 때 했던 최신성 검사는 이미 낡아 이 역전을 막지 못했습니다 `✓`.

> "The check that was made at the start of the plan application process … was stale by this time due to the unusually high delays in Enactor processing. Therefore, this did not prevent the older plan from overwriting the newer plan." `✓`

곧이어 B의 정리 절차가 A가 방금 적용한 오래된 플랜을 지웠습니다.

> "As this plan was deleted, all IP addresses for the regional endpoint were immediately removed." `✓`

활성 플랜이 통째로 사라지자 어떤 Enactor도 새 플랜을 적용할 수 없는 불일치 상태가 됐습니다. AWS 원문은 "이것이 결국 수동 운영자 개입을 필요로 했다"고 적었습니다 `✓`. TOCTOU(check-then-act) 경합에 삭제 기반 정리가 맞물린 것입니다. 아래 도식은 지연이 없을 때와 비교해, 최신성 검사와 실제 적용 사이에서 순서가 어떻게 뒤집혔는지 보여줍니다.

{{< seq src="_seq/2-dns-경합.json" />}}

## 3. 복구 작업이 다음 장애를 만든 경로

DynamoDB 엔드포인트 DNS가 비자마자 us-east-1의 모든 신규 연결이 실패했습니다. EC2의 컨트롤 플레인인 DWFM(DropletWorkflow Manager)도 DynamoDB에 의존했습니다. 리스 상태 체크가 실패한 탓에 02:25 DNS 복구 이후 대규모 리스 재수립이 한꺼번에 몰렸고, 재수립 작업이 타임아웃보다 느려지며 재시도가 쌓였습니다. DWFM은 이렇게 "정체 붕괴(congestive collapse)" 상태에 빠졌습니다. 이 상태에서 빠져나올 정해진 운영 절차도 없었습니다.

> "Since this situation had no established operational recovery procedure, engineers took care in attempting to resolve the issue…" `✓`

인스턴스 기동이 재개되자 이번에는 Network Manager에 설정 전파 백로그가 쌓였습니다. 갓 뜬 인스턴스들이 "떴는데 네트워크가 없는" 상태로 남았고, NLB 헬스체크 결과는 healthy와 failing 사이를 오갔습니다. 반복되는 상태 변화가 헬스체크 서브시스템 자체를 과부하로 열화시키면서 자동 AZ DNS failover까지 발동시켰습니다.

> "This resulted in health checks alternating between failing and healthy. … The alternating health check results increased the load on the health check subsystem, causing it to degrade, resulting in delays in health checks and triggering automatic AZ DNS failover to occur. For multi-AZ load balancers, this resulted in capacity being taken out of service." `✓`

멀쩡한 용량이 서비스에서 빠져나가자 Lambda 인스턴스가 종료되며 내부 시스템 용량 부족까지 이어졌습니다. 아래 도식은 이 전파 사슬과 같은 시각 격리된 채로 남은 경로를 나란히 보여줍니다.

{{< flow src="_flow/3-전파-사슬.json" />}}

## 4. 기존 인스턴스와 다른 리전이 버틴 이유

AWS 사후보고서는 이미 실행 중이던 EC2 인스턴스의 상태를 분명히 기록했습니다.

> "Existing EC2 instances that had been launched prior to the start of the event remained healthy and did not experience any impact for the duration of the event." `✓`

컨트롤 플레인이 멈춰도 기존 인스턴스는 계속 돌았습니다. [06편의 정적 안정성(static stability)]({{< relref "/engineering/architecture/06-aws-isolation/index.md" >}})이 설계대로 작동한 사례입니다. DynamoDB의 파티션과 스토리지 노드, 복제 그룹도 손상되지 않았습니다. 보고서에 데이터 손실이나 손상은 기록돼 있지 않습니다. 엔드포인트를 찾는 경로가 끊겼지만 데이터는 보존됐습니다.

global tables를 쓰던 고객은 다른 리전의 복제 테이블에 계속 접속하고 요청을 보낼 수 있었습니다. 복제 지연은 길어졌지만 연결 자체는 끊기지 않았습니다 `✓`. Redshift의 "local" 사용자로 접속하는 고객도 영향을 받지 않았습니다 `✓`. 리전 격리와 정적 안정성이 사건 내내 버틴 경로들입니다.

물리 인프라 장애에서는 AZ 경계가 지켜진 대조 사례도 있습니다. 2026년 5월 us-east-1의 한 AZ(`use1-az4`)에서 냉각 장치가 무더기로 고장 나 온도 안전 셧다운이 걸렸을 때, 피해는 랙 단위 물리 손상으로 그 AZ 하나에 갇혔습니다 `≈`. 다만 AWS의 공식 사후보고서는 확인되지 않았습니다. 소프트웨어·설정에서 시작한 2025-10-20 사건과 같은 종류로 묶기보다, 서로 다른 원인이 어느 경계까지 영향을 미쳤는지 비교하는 사례로만 참고할 만합니다.

## 5. 공유 자동화와 global 서비스가 넘은 경계

Enactor는 3개 AZ에서 중복 실행됐지만, 관리 대상인 리전 엔드포인트 레코드는 하나였습니다. 셀도 셔플샤딩도 이 자리에는 적용돼 있지 않았습니다. EC2 역시 실행 중 인스턴스는 정적으로 안정적이었지만, DWFM은 DynamoDB 의존성 때문에 함께 멈췄습니다.

앞서 본 DWFM의 정체 붕괴에는 정해진 복구 절차가 없었습니다 `✓`. 셀 아키텍처 문서가 강조하는 "상한을 두고 정기적으로 리허설한다"는 원칙이 이 경로에는 적용돼 있지 않았다는 뜻입니다. NLB의 자동 AZ failover에도 속도 제한이 없어 fallback이 장애를 증폭했습니다.

영향은 리전 바깥으로도 번졌습니다. STS 기본 엔드포인트, 콘솔 페더레이션 로그인처럼 us-east-1에 컨트롤 플레인을 둔 global 서비스는 다른 리전에서도 로그인이 막혔습니다. Redshift에서는 사용자 그룹을 조회하는 코드가 리전 경계를 뚫었습니다.

> "Amazon Redshift customers in all AWS Regions were unable to use IAM user credentials for executing queries due to a Redshift defect that used an IAM API in the N. Virginia (us-east-1) Region to resolve user groups." `✓`

앞 절의 "local" 사용자와 달리 IAM 사용자 자격 증명을 쓰던 고객은 모든 AWS 리전에서 쿼리를 실행할 수 없었습니다. 애플리케이션 코드에 하드코딩된 us-east-1의 IAM API 의존성 때문입니다. Support Console에서는 리전 failover 자체는 성공했지만, 계정 메타데이터 서브시스템이 "실패" 대신 "유효하지 않은 응답"을 돌려줘 우회 로직이 작동하지 않았습니다.

## 6. AWS가 약속한 복구 속도와 규모의 제어

AWS는 사후보고서에서 네 가지를 약속했습니다.

> "We have already disabled the DynamoDB DNS Planner and the DNS Enactor automation worldwide. … For NLB, we are adding a velocity control mechanism to limit the capacity a single NLB can remove when health check failures cause AZ failover. For EC2, we are building an additional test suite to augment our existing scale testing, which will exercise the DWFM recovery workflow to identify any future regressions. We will improve the throttling mechanism in our EC2 data propagation systems to rate limit incoming work based on the size of the waiting queue…" `✓`

DNS 자동화는 전 세계에서 비활성화했습니다. 나머지 셋은 NLB가 한 번에 제거할 수 있는 용량을 제한하고, DWFM 복구를 규모 테스트에 포함하고, 대기열 크기에 맞춰 EC2 설정 전파 작업의 유입을 제한하는 처방입니다. 복구 과정에서 속도와 규모를 다루겠다는 약속이며, 셀을 더 쪼개겠다는 말은 없습니다.

이전 사고의 처방과는 차이가 있습니다. 2011년 4월에는 네트워크 변경 실수가 re-mirroring storm을 일으켜 한 AZ 볼륨의 약 13%가 묶였고, 장애가 EBS 컨트롤 플레인을 타고 리전 전체로 번졌습니다 `✓`. AWS는 그때 컨트롤 플레인을 클러스터별로 갈랐습니다. 이 장애가 [06편에서 본 Physalia]({{< relref "/engineering/architecture/06-aws-isolation/index.md" >}})의 설계 동기가 됩니다.

2017년 S3 사고와 2020년 Kinesis 사고의 사후보고서도 셀 분할을 명시했습니다. Kinesis 보고서는 "프론트엔드 플릿의 셀화를 크게 앞당기겠다"고 적었습니다 `✓`. 반대로 2021년 12월 내부 네트워크 장애에서는 컨트롤 플레인이 무너져도 S3·DynamoDB·실행 중 Lambda의 데이터 경로가 대체로 버텼습니다 `✓`.

2025-10-20의 개선 약속은 이미 나눈 경계 안에서 복구 작업이 몰리는 문제를 다룹니다. 격리가 공간을 나누는 일이라면, 이번에 남은 문제는 작업이 한꺼번에 몰리지 않도록 시간을 나누는 일이었습니다.

## 7. 전역 설정 배포에서는 어디까지 번지는가

2025년 6월 12일 Google Cloud에서는 빈 필드가 담긴 설정이 전 세계로 거의 즉시 복제되면서, 인가 정책을 다루는 Service Control이 모든 리전에서 동시에 null pointer 크래시 루프에 빠졌습니다 `?`. [03 공유 의존성 장애]({{< relref "/engineering/architecture/03-shared-failure/index.md" >}})에서 다룬 이 사건은 AWS의 리전 단위 DNS 장애와 달리 전역 복제 시스템 자체가 폭발 반경이 된 사례입니다.

2025년 10월 29일 Azure Front Door는 더 구조적인 문제를 드러냈습니다. Front Door는 설계상 전역 서비스라 다른 리전으로 피할 수 없습니다. Microsoft는 고객 설정을 배포하는 구조를 이렇게 설명했습니다.

> "Like any large-scale CDN, we deploy each customer configuration across a globally distributed edge fleet, densely shared with thousands of other tenants. … certain incompatible configurations, if not contained, can propagate broadly and quickly which can result in a large blast radius of impact." `✓`

두 컨트롤 플레인 버전에 걸친 설정 변경이 호환 불가 메타데이터를 만들었습니다. 데이터 플레인의 실패가 비동기로 나타난 탓에 단계적 롤아웃의 헬스체크는 전부 통과했습니다. 나쁜 설정은 "마지막으로 알려진 정상(LKG)" 스냅샷까지 오염시켜 되돌아갈 곳도 없앴습니다 `✓`.

AWS·GCP·Azure 세 사건은 설정과 그것을 배포하는 자동화에서 시작했다는 점에서 같은 계열입니다. 다만 자동화가 다루는 범위에 따라 피해가 번진 크기는 달랐습니다. Microsoft는 이후 "micro cellular Azure Front Door with ingress layered shards"를 공개적으로 예고했습니다 `Ⓥ`.

## 8. 셔플샤딩에서 계층형 샤딩까지의 12년

2014년 4월, Colm MacCárthaigh는 AWS Architecture Blog에 셔플샤딩을 처음 공개했습니다 `✓`. 뒤에 Builders' Library에서 그는 이 발명이 DDoS 방어 전용 장비를 다 사려면 "수천만 달러"가 드는 궁핍에서 나왔다고 적었습니다 `✓`. 워커 8개 중 2개를 묶는 28가지 조합으로 고객의 장애 영향을 나누는 원리는, Route 53에서 2,048개의 가상 네임서버와 도메인당 4개 조합, 약 7,300억 개의 셔플 샤드로 커졌습니다 `Ⓥ`.

처음부터 "요청자가 재시도로 우회할 수 있어야 한다"는 전제가 붙어 있었습니다 `✓`. [04 셀의 해부]({{< relref "/engineering/architecture/04-cell-anatomy/index.md" >}})에서 봤듯 줄어드는 것은 워커 손실이 아니라 완전히 서비스를 못 받는 고객의 비율입니다.

12년 뒤인 2026년 7월, Microsoft가 이 전제를 정면으로 문제 삼았습니다. Azure Front Door 팀은 "Layered Ingress Sharding"을 발표하며 이렇게 적었습니다.

> "shuffle sharding still allows 100% availability loss for tenants in the affected shard, relies heavily on client retries, and introduces nontrivial capacity loss in overlapping shards." `✓`

Microsoft의 처방은 두 가지입니다. Ingress Sharding에서는 인그레스 컨트롤러가 클라이언트 재시도에 기대는 대신 직접 트래픽을 건강한 인스턴스로 돌립니다. Layered Sharding에서는 서비스를 여러 독립 레이어로 나누고, 레이어마다 테넌트-샤드 배정을 따로 무작위화합니다 `✓`. 한 레이어에서 충돌한 두 테넌트가 다른 레이어에서도 같이 충돌할 확률은 이항분포를 따르며, 레이어가 수십 겹이면 "폭발 반경이 플릿 전체에서 테넌트 하나로 줄어든다"고 Microsoft는 씁니다 `✓`.

이 발표는 요청과 테넌트를 나누는 것에 더해, 장애가 났을 때 누가 우회를 맡는지까지 다룹니다. 그러나 DNS Enactor처럼 리전당 하나뿐인 관리 자동화는 여전히 별도의 문제입니다. 셔플샤딩은 그 자동화를 분할하지 못하고, 클라이언트의 재시도 여력 자체도 늘려주지 못합니다.

## 9. 리전 격리의 성공과 전역 의존성의 책임

The Register는 사후보고서를 정리하며 "DynamoDB 하나의 실패가 EC2·Lambda·ECS·EKS·Fargate로 연쇄했다"는 프레임을 썼습니다 `✓`. The Pragmatic Engineer의 Gergely Orosz는 "왜 정리 절차가 활성 레코드를 지웠는지, 이 취약점이 전에 발견된 적이 있는지가 보고서에서 빠졌다"고 지적했습니다 `✓`. 다만 2023년 사고 보고서가 4개월 걸렸던 데 비해 이번에는 공개 속도가 훨씬 빨랐다는 점은 인정했습니다.

사고 이후의 분석은 경합에 관여한 안전장치들을 드러냈습니다. Craig Howard가 re:Invent 2025 DAT453에서 발표한 내용에 따르면, 이번 경합은 사고 이후 TLA+ 모델링으로 재현해 찾아낸 것이었습니다 `✓`. Lorin Hochstein은 이 발표를 "AWS가 공개한 사후 인시던트 자료 중 가장 통찰력 있는 것"이라 평했습니다 `Ⓥ`.

Hochstein이 짚은 것은 실패를 막으려고 넣은 다섯 장치, 곧 복수 Enactor, 락, 정리 절차, 트랜잭션 보호, 롤백의 상호작용입니다 `Ⓥ`. 그는 "우리는 모든 종류의 실패를 상상할 수 없다"고 덧붙입니다. 06편에서 본 AWS의 격리 원칙을 지키더라도, 이렇게 안전장치끼리 맞물려 생기는 장애까지 없애지는 못한다는 뜻입니다.

피해 규모를 보는 관점도 달랐습니다. 보험 데이터 회사 CyberCube는 보험 손실을 3,800만~5억 8,100만 달러로 추정하면서도 "이런 유형의 사건은 보험사가 이미 모델링하고 가격을 매겨둔, 예상 범위 안의 일"이라 논평했습니다 `≈`. 비판하는 쪽은 리전 하나가 인터넷 절반을 멈췄으니 격리가 실패한 것 아니냐고 묻습니다.

**AWS의 리전 격리는 작동했습니다.** AWS의 리전 격리가 작동했다는 근거는 다른 리전의 DynamoDB 복제 테이블에 계속 요청을 보낼 수 있었다는 관측에 있습니다. Corey Quinn은 이를 두고 "AWS는 한 번도 전역 장애를 낸 적이 없다"고 정리합니다 `Ⓥ`. 리전 격리 덕에 장애는 갇혔고, 전역으로 보였던 것은 고객이 us-east-1에 몰려 있었기 때문이라는 해석입니다.

기술적으로 실패한 것은 us-east-1 하나에 몰린 DNS 관리 자동화의 단일 배치였습니다. 인터넷 절반이 us-east-1 한 곳에 몰려 있었다는 사실 자체는 AWS 아키텍처의 결함이라기보다 고객의 배치 선택입니다.

고객의 배치 선택만으로 설명되지 않는 책임도 남습니다. global 컨트롤 플레인을 us-east-1에 묶어 둔 것은 AWS가 책임질 설계 선택입니다. STS 기본 엔드포인트와 콘솔 페더레이션 로그인은 us-east-1에 의존했고, Redshift는 사용자 그룹을 조회할 때 그 리전의 IAM API를 하드코딩해 불렀습니다. 다른 리전의 데이터 경로가 살아 있어도, 여기에 접속하고 권한을 확인하는 경로가 같은 경계를 지킨 것은 아니었습니다.

## 10. 자기 시스템에서 확인할 경계

- 우리 시스템에서 "리전당 하나뿐인" 자동화나 레코드가 있는가. 있다면 그것이 3중화된 실행 주체보다 먼저 단일점인지 확인했는가.
- 컨트롤 플레인이 데이터 플레인과 같은 의존성(같은 DB, 같은 DNS)을 타고 있지 않은가. 이미 뜬 인스턴스가 컨트롤 플레인 장애에도 살아남는지 실제로 검증한 적이 있는가.
- 자동 복구 경로(재시도, failover, 정리 절차)에 속도 제한이 있는가, 아니면 최악의 순간에 전속력으로 돌아가는가.
- "복구 불능" 상태에 도달했을 때를 상정한 리허설이 있는가, 아니면 DWFM처럼 처음 만나는 상태인가.
- global로 광고하는 서비스의 컨트롤 플레인이 실제로는 특정 리전 하나에 묶여 있지 않은가.

## 참고 자료

- [Summary of the Amazon DynamoDB Service Disruption in the Northern Virginia (US-EAST-1) Region](https://aws.amazon.com/message/101925/) — AWS, 2025-10-20 `✓`
- [A single DNS race condition brought Amazon's cloud empire to its knees](https://www.theregister.com/2025/10/23/amazon_outage_postmortem/) — Dan Robinson, The Register, 2025-10-23 `✓`
- [What caused the large AWS outage?](https://blog.pragmaticengineer.com/aws-outage-us-east-1/) — Gergely Orosz, The Pragmatic Engineer, 2025-10-23 `✓`
- [AWS re:Invent talk on their Oct '25 incident](https://surfingcomplexity.blog/2025/12/14/aws-reinvent-talk-on-their-oct-25-incident/) — Lorin Hochstein, 2025-12-14 `✓`
- [12 June 2025 incident](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) — Google Cloud Status, 2025 `✓`
- [Azure Front Door: Implementing lessons learned following October outages](https://techcommunity.microsoft.com/blog/azurenetworkingblog/azure-front-door-implementing-lessons-learned-following-october-outages/4479416) — Abhishek Tiwari 외, Microsoft, 2025-12-18 `✓`
- [Introducing Layered Ingress Sharding: Achieving Single-Tenant Isolation in Multi-Tenant Services](https://techcommunity.microsoft.com/blog/reliability-and-resiliency-in-azure/introducing-layered-ingress-sharding-achieving-single-tenant-isolation-in-multi-/4535859) — Abhishek Tiwari 외, Microsoft, 2026-07-10 `✓`
- [Amazon outage: myths vs reality](https://www.theregister.com/2025/10/27/aws_outage_myths_reality/) — Corey Quinn, The Register, 2025-10-27 `Ⓥ`
- [AWS hit by us-east-1 outage after data center thermal event](https://www.networkworld.com/article/4168878/aws-hit-by-us-east-1-outage-after-data-center-thermal-event.html) — Network World, 2026-05-11 `≈`
- [Summary of the Amazon EC2 and Amazon RDS Service Disruption in the US East Region](https://aws.amazon.com/message/65648/) — AWS, 2011-04-21 `✓`
- [Summary of the Amazon Kinesis Event in the Northern Virginia (US-EAST-1) Region](https://aws.amazon.com/message/11201/) — AWS, 2020-11-25 `✓`
- [Summary of the AWS Service Event in the Northern Virginia (US-EAST-1) Region](https://aws.amazon.com/message/12721/) — AWS, 2021-12-07 `✓`
