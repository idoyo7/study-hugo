---
title: "AWS WAF 운영 경험과 구성 선택"
description: "우아한형제들 정보보안팀이 AWS WAF를 운영하며 정리한 구성 방식, 룰 관리, 로깅과 탐지 데이터의 한계를 요약했습니다. 상용 WAF와 비교한 아쉬운 점과 그럼에도 쓸 만한 이유도 함께 다룹니다."
date: 2026-11-14
weight: 7
---

# AWS WAF 운영 경험과 구성 선택 (2020-10)

{{< callout type="info" >}}
**원문 정보**
- 원문: [AWS WAF 운영에 대한 이야기](https://techblog.woowahan.com/2699/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2020-10-15
- 저자: 이주호 (우아한형제들 정보보안팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## WAF가 막는 범위와 막지 못하는 범위 {#waf-scope}

웹 애플리케이션 방화벽(WAF)은 HTTP 정보를 바탕으로 비정상 트래픽을 탐지하고 차단합니다. TCP/IP 수준의 정보로 룰을 세우는 일반 방화벽(FW)이나 침입 탐지·차단 시스템(IDS/IPS)과는 역할이 다릅니다. 하나를 쓴다고 나머지가 필요 없어지지는 않습니다.

WAF가 등장하기 전에는 웹 보안이 개발자의 보안 프로그래밍 능력에 기대는 구조였습니다. 서비스가 개편될 때마다 새 취약점이 생기고, 충분히 검토하고 출시해도 사람은 실수합니다. WAF는 이런 실수를 받아내는 방파제 역할을 합니다.

그렇다고 모든 공격을 막지는 못합니다. 대표적인 사각지대가 논리적 취약점입니다. 메인 페이지 주석에 관리자 페이지 주소와 계정이 적혀 있어도 WAF는 그 주석을 보고 접속한 요청을 공격으로 구분할 수 없습니다. 잘못된 권한 부여, 불충분한 세션 관리, 서버 정보 노출, 우회를 노린 파라미터 변조도 같은 부류입니다. 보안 솔루션은 공격의 일부를 막아 줄 뿐이라 서버와 애플리케이션 자체의 보안 조치를 게을리하면 안 된다는 것이 원문의 입장입니다.

## 클라우드에서의 WAF 구성 방식 {#deployment-models}

원문은 먼저 두 가지 일반적인 구성을 비교합니다.

VPC 안에 프록시 형태로 두는 설치형은 IDC의 인라인 WAF와 비슷합니다. 모든 L7 패킷이 WAF를 거쳐 Origin LB로 가고, WAF 리소스를 직접 관리할 수 있으며 Origin LB를 Private으로 숨길 수 있습니다. 대신 WAF 자체가 주요 장애 지점이 됩니다. 이벤트로 트래픽이 몰려 서비스팀이 Origin을 스케일 아웃했는데 WAF만 평소 규모라면 WAF에서 장애가 납니다. Origin Private ELB와 Public ELB(WAF ELB)를 함께 상시 모니터링하고 확장 정책을 유연하게 적용해야 합니다. 원인을 바로 못 찾을 때는 WAF를 우회할 수 있지만, Origin LB가 Private이면 DNS를 바꾸는 방법을 쓸 수 없어 기능적 Bypass가 필요하므로 대응 절차에 이 점을 넣어야 합니다.

SECaaS(SaaS) 형태는 DNS 설정만으로 트래픽을 돌려 필터링하므로 도입이 쉽습니다. 다만 업체와의 네트워크 환경을 따져야 합니다. 서울 리전을 쓴다면 같은 리전에서 서비스하는 업체가 지연 시간에 유리합니다. 리소스를 직접 관리할 수 없어 장애 때 트러블슈팅과 대응이 느려질 수 있고, 데이터 기밀성 문제도 있습니다.

AWS WAF는 이 두 구성의 고민을 덜어 줍니다. 원문이 꼽은 장점은 다음과 같습니다.
- CloudFront, ALB, API Gateway를 쓰고 있으면 바로 적용할 수 있다.
- 적용 대상과 같은 선상에서 동작해 네트워크 홉이 늘지 않는다.
- 트래픽이 늘 때 확장이 유연하다.
- 유지보수 부담이 작고, 장애 때 원복 시나리오가 간단하다.

원문은 다양한 측면에서 상용 WAF보다 부족한 점이 많다고도 덧붙입니다.

## 연동 위치와 Firewall Manager {#integration-and-fms}

AWS WAF는 CloudFront, ALB, API Gateway에 붙일 수 있습니다. 필자는 보안 측면에서 CloudFront 연동이 유리하다고 봅니다. Volumetric DDoS를 Global edge에서 먼저 처리한 뒤 VPC로 트래픽이 들어오게 할 수 있고, CloudFront WAF에 임계치 룰과 L7 DoS 차단 룰을 두면 VPC로 들어오는 부적절한 트래픽이 줄기 때문입니다. CloudFront와 ALB 양쪽에 모두 붙이는 방법도 있습니다. CloudFront WAF는 L7 DoS, 임계치, IP 블랙리스트를 맡고 ALB WAF는 웹 취약점 공격 룰에 집중하는 식입니다.

다만 구조는 한 번 고르면 바꾸기 어렵습니다. 국내 한정 서비스라면 CDN이 필요 없을 수 있고 CloudFront 비용도 무시할 수 없으며, 장애와 멀티 클라우드 가능성까지 IT 전반의 상황을 함께 봐야 합니다.

Firewall Manager Service(FMS)는 멀티 계정 환경에서 AWS Config와 연계해 누락된 Public ELB를 WAF 적용 대상에 자동으로 넣고 룰을 중앙에서 관리하게 해 줍니다. 그러나 "모든 Public Subnet의 ALB를 보호 대상으로 삼겠다"고 결정하면 오탐 확인과 예외 처리에 시달리게 됩니다. FMS로는 도메인이나 서비스별 룰을 적용하기 어렵기 때문입니다. 원문은 계정 네 개에 서비스 네 개, 도메인 12개가 같은 룰을 쓰는 상황을 예로 듭니다. 서비스마다 개발 언어가 다를 수 있고 룰이 복잡해질수록 오탐 가능성이 커집니다. 그래서 관리가 쉽다는 이유만으로 멀티 계정에 무조건 FMS를 쓰는 것은 좋지 않다고 봅니다. 운영 여력이 있다면 최소한 서비스별로, 더 복잡한 룰이 필요하면 도메인별로 WAF를 두는 쪽을 권합니다. AWS WAF의 예외 처리 기능이 고도화되면 적극적으로 활용할 가치가 있을 것이라는 전망도 덧붙입니다.

## Managed Rule 비교와 Custom 룰 {#rule-management}

2019년 11월에 발표된 WAFv2는 AWS Managed Rule을 제공합니다. WAFv1에서는 룰을 10개까지 쓸 수 있었던 반면 WAFv2는 1,500 capacity 안에서 조합하며, 부족하면 AWS에 증설을 요청할 수 있습니다.

필자는 기본 용량 안에서 Managed Rule을 임의로 구성(1,475 capacity)해 Marketplace Rule과 탐지율을 비교했습니다. 서로 다른 웹 스캐너 두 개로 시험한 결과 AWS Managed Rule의 탐지율은 28%와 17.9%, Marketplace Rule은 13%와 5.6%였습니다. 평균적으로 2배 이상 높았지만 상용 WAF보다는 부족하다고 평가합니다. 적절한 워크로드 보안을 위해서는 Custom Rule로 탐지율을 높이고 오탐을 줄이는 노력과 함께 별도의 CWPP 솔루션도 써야 한다는 의견입니다.

Custom 룰은 AND, OR, NOT 조건으로 논리 규칙문을 짤 수 있습니다. 여기에 헤더 검사를 조합한 사례가 둘 나옵니다.

- Host 헤더 검사: Public ELB에는 기본 도메인 주소가 있어서, 공격자가 실제 서비스 도메인이 아니라 ALB 도메인이나 IP로 직접 공격해 상단의 CloudFront WAF 같은 보안 서비스를 우회하려 할 수 있습니다. Host 헤더가 정식 도메인이 아니면 차단하는 룰로 막습니다. ELB 보안 그룹으로 CloudFront가 쓰는 AWS IP만 허용하는 방법도 좋습니다.
- Referer 헤더 검사: 특정 페이지를 거쳐야만 접근되는 API라면 Referer가 없거나 예상 경로와 다른 요청을 비정상 유입으로 볼 수 있습니다.

헤더는 쉽게 변조되므로 이런 룰을 100% 신뢰할 수는 없습니다. 그래도 이상 트래픽을 알아채는 단서는 됩니다.

## 로깅 구성 {#logging}

원문 작성 시점에 AWS WAF는 Kinesis Firehose를 통한 로깅만 지원했고, 적재 대상은 Amazon ES와 S3였습니다. 콘솔의 자체 로그와 CloudWatch 그래프만으로는 분석이 부족합니다. SIEM이 없으면 S3에 쌓고 Athena로 분석하는 방법이 있고, 여러 보안 솔루션을 쓸 계획이 있다면 전문 SIEM이 낫다고 봅니다.

필자는 로그를 계정마다 따로 두지 않고 별도의 보안(S) 계정 S3에 중앙 수집하는 구성을 소개합니다. Firehose가 다른 계정의 버킷을 직접 가리켜야 하는데 웹 콘솔에서는 같은 Organization이어도 설정이 안 되므로 AWS CLI로 만듭니다. WAF가 쓰는 Firehose 이름은 `aws-waf-logs`로 시작해야 하고, 대상 버킷에는 Firehose 역할이 적재할 수 있도록 정책을 열어 줘야 합니다.

WAF는 Allow, Count, Block 로그를 모두 Firehose로 보내고, 일부만 고르는 기능은 없습니다. Allow 로그는 미탐과 침해사고 조사에 쓸모가 있지만 서버나 ELB 액세스 로그를 따로 모으고 있다면 굳이 분석하지 않아도 됩니다. 로그 총량으로 과금되는 SIEM이나 ES라면 전체의 80~90%를 차지할 Allow 로그를 버리는 선택도 가능합니다. 버리는 방법은 둘입니다. Firehose에 Lambda 트리거를 걸어 Allow를 거르고 Count와 Block만 적재하거나, 전체 로그를 S3에 쌓은 뒤 Logstash로 당겨 Count와 Block만 새 버킷에 저장합니다. 지연, 효율, 유지보수, 비용을 따져 고르라고 합니다.

## 탐지 데이터의 한계 {#detection-data}

오탐이 났을 때 이유를 분석하려면 Matched on Data가 필요합니다. 그런데 AWS WAF는 Body 값을 검사는 하지만 로그에 남기지 않고, Body에서 매칭돼 차단됐을 때도 그 이유를 기록하지 않습니다. 다만 SQLi와 XSS 룰에 걸린 데이터는 Body에 있어도 `terminatingRuleMatchDetails` 필드에 남습니다. 필자는 모든 공격에 대해 Body 내 탐지 데이터가 기록되기를 기대하며, 이 점을 AWS WAF에서 가장 아쉬운 부분으로 꼽습니다.

## 평가 {#assessment}

필자는 AWS WAF가 상용 WAF를 온전히 대체하기는 어렵다고 봅니다. 룰 예외 처리, 모니터링, 탐지 값 제공이 아쉽고, 봇 트래픽도 1차원적인 속성으로만 탐지합니다. 운영이 쉬워 보여도 제대로 학습하지 않으면 의도하지 않은 차단과 오탐으로 장애나 가용성 문제를 겪을 수 있습니다. 그래도 클라우드에서 상용 WAF를 들이는 것보다 저렴하고 안전하며 빠르고 쉽게 적용할 수 있습니다. 상용 솔루션을 도입하기 전의 임시 수단이나 적절한 솔루션을 찾을 때까지의 메인 웹 방화벽으로 쓰기에도 기본 이상의 가치가 있다는 것이 결론입니다.

{{% details title="탐지율 비교와 Managed Rule 구성" closed="true" %}}

| 항목 | 값 |
|---|---|
| 테스트 룰 구성 | AWS Managed Rule 1,475 capacity (기본 1,500 안에서 임의 구성) |
| A 스캐너, AWS Managed Rule | Block 442 / Allow 1,096 / 탐지율 28% |
| A 스캐너, Marketplace Rule | Block 204 / Allow 1,334 / 탐지율 13% |
| B 스캐너, AWS Managed Rule | Block 1,743 / Allow 8,936 / 탐지율 17.9% |
| B 스캐너, Marketplace Rule | Block 700 / Allow 9,979 / 탐지율 5.6% |
| Core Rule Set | 700 |
| Known bad inputs | 200 |
| SQLi Rule Set | 200 |
| Linux operating system | 200 |
| Admin Protection Rule Set | 100 |
| Anonymous IP list | 50 |
| Amazon IP reputation list | 25 |
| WAFv1 룰 수 | 10개 |
| WAFv2 기본 용량 | 1,500 capacity (증설 요청 가능) |

{{% /details %}}
