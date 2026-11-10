---
title: "데이터 플랫폼에 Kerberos 인증을 넓힌 계정 체계와 Keytab 자동 배포"
description: "우버가 2016년부터 Hadoop 기반 데이터 플랫폼에 Kerberos 인증을 도입하고 확장한 과정을 정리했습니다. 계정 유형 표준화, 다중 provider KDC 구성, keytab 배포 자동화 파이프라인을 요약합니다."
date: 2026-11-10
weight: 12
---

# 데이터 플랫폼에 Kerberos 인증을 넓힌 계정 체계와 Keytab 자동 배포 (2023-01)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Scaling Adoption of Kerberos at Uber](https://www.uber.com/us/en/blog/scaling-adoption-of-kerberos-at-uber/)
- 매체 · 게시일: Uber Engineering Blog · 2023-01-19
- 저자: Alexander Gulko(Staff Software Engineer, Data Security), Matt Mathew(Principal Engineer, Engineering Security)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 배경 {#background}

우버는 2015년부터 Apache Hadoop 기반 데이터 분석 플랫폼을 운영해 왔고, 2016년에 사용이 급격히 늘면서 Kerberos 인증으로 플랫폼을 보호하기로 했습니다. 이후 Kerberos는 Hadoop 생태계를 넘어 기술 스택의 핵심 서비스까지 지원하는 중요한 보안 구성요소가 되었습니다. 수천 대 머신에 배포되고 300PB가 넘는 분석 데이터를 저장하는 환경이며, YARN, HDFS, Hive, Kafka, Zookeeper, Presto, Spark, Flink, Pinot과 사내 개발 플랫폼이 Kerberos로 인증합니다. 이 글은 Kerberos 도입을 확장하면서 겪은 과제와 해법을 다룹니다.

## Kerberos의 동작 {#kerberos-basics}

Kerberos는 그리스 신화에서 하데스를 지키는 머리 셋 달린 개 케르베로스에서 이름을 딴 네트워크 인증 프로토콜입니다. 1980년대 초 MIT에서 시작했고 현재 버전(v5)은 1993년에 나왔습니다. 오래된 프로토콜이지만 원래 설계를 크게 바꾸지 않고 분산 시스템 요구를 충족해 왔습니다.

주체는 셋입니다. KDC(Key Distribution Center)는 principal(사용자나 서비스)과 자격 증명을 저장하는 Kerberos 서버이고, 클라이언트는 자원이 필요한 프로세스이며, 리소스 서버는 자원을 제공하는 서버입니다. 서비스는 대개 시작할 때 KDC에 인증하고 실행 중 인증 티켓을 유지합니다. 클라이언트는 KDC에 로그인해 만료되는 TGT(ticket-granting-ticket)를 받고, 이 TGT로 자격 증명 없이 특정 리소스 서버용 서비스 티켓을 KDC에 요청해, 그 티켓으로 리소스 서버에 인증합니다. 인증은 평문 비밀번호나 keytab이라는 보안 키 파일로 할 수 있습니다.

우버가 Kerberos를 쓰는 이유로 원문이 꼽는 장점은 다음과 같습니다.

- 자주 쓰는 Hadoop 생태계가 Kerberos 인증을 기본 지원합니다.
- 자격 증명이 암호화되지 않은 채 네트워크로 가지 않습니다.
- 티켓 수명이 한정되어 만료되면 KDC에 다시 인증해야 합니다.
- SSO 프로토콜이라 KDC에 한 번 인증하면 티켓이 유효한 동안 보호된 모든 자원에 접근합니다.
- 클라이언트와 서버가 서로를 인증합니다.
- 티켓에 호스트 정보를 보태 한 호스트가 침해당해도 다른 호스트의 보안에 영향이 없게 할 수 있습니다.
- 신뢰 관계를 맺어 독립적인 realm의 계층을 만들 수 있습니다.
- 검증되고 안정적이며 인프라 보안 실적이 좋습니다.

## 계정 유형 표준화 {#account-types}

인증은 신원에서 시작합니다. 우버가 급성장하면서 데이터 플랫폼을 매일 쓰는 직원과 팀이 빠르게 늘었고, 운영, 데이터 과학, 분석, 엔지니어링 등 다양한 직군이 맞는 계정을 맞게 쓰도록 안내하기 어려워졌습니다. 사용자는 늘 클라이언트이지만 서비스는 양쪽이 될 수 있어서, 먼저 용어를 정리해 모범 사례를 전했습니다.

- 사용자 계정: 직원 개인 접근과 임시 데이터 탐색용입니다. 예: employee-account@uber.com
- 서비스 계정: 매일 도는 파이프라인용으로, 원래 작성자가 퇴사해도 팀이 유지합니다. 같은 이름의 Linux 그룹이 뒷받침해 프로젝트 멤버를 그룹에 넣어 서비스 계정이 쓴 데이터에 접근하게 합니다. 예: uber_eats@DATA.UBER.COM
- 시스템 계정: 데이터 인프라 스택을 이루는 시스템용입니다. 보안 위험을 피하려고 그룹 멤버를 추가하지 않습니다. 예: hdfs@DATA.UBER.COM
- 서비스-호스트 계정: principal과 keytab 자격 증명의 범위를 {서비스, 호스트} 조합 하나로 한정합니다. keytab이 탈취되면 여러 호스트에 걸친 서비스 keytab 전체가 아니라 해당 조합의 keytab만 교체하면 됩니다. 대규모 호스트에 배포하는 서비스가 주로 씁니다. 예: hdfs/us-west-123.internal@DATA.UBER.COM

계정을 정의하고 위키에 설명하는 데 그치지 않고 서비스 계정 생성과 접근 제어 정책 연결을 셀프서비스로 만들었습니다. 새 데이터셋이나 ETL 작업을 온보딩할 때 계정이 없는 서비스는 소유 팀이 셀프서비스 계정 생성 절차로 안내되고, 새 계정은 24시간 안에 쓸 수 있습니다. 해당 keytab도 자동으로 만들어져 알맞은 권한으로 엣지 호스트에 배포됩니다.

### 계정 전파 {#account-propagation}

우버는 사용자와 그룹 관리에 Microsoft Active Directory(Uber AD)를 쓰며 직원 계정과 그룹 멤버십의 원본입니다. 서비스와 시스템 계정은 AD에서 일반 사용자 그룹과 구별되는 속성을 가진 그룹으로 표현됩니다. 관심사 분리를 위해 realm을 여럿 두는 것이 일반적이어서, 데이터 조직은 OpenLDAP 데이터베이스를 쓰는 MIT Kerberos 구현으로 전용 Kerberos를 구성했습니다. 이 Data Kerberos가 호스트, 서비스, 시스템 계정의 principal을 저장하고, 직원 계정(employee@uber.com)은 Uber AD(다른 realm)와의 단방향 신뢰로 Data 자원에 인증합니다. 데이터 서비스는 Docker 컨테이너나 베어메탈 호스트의 일반 OS 프로세스로 배포되므로, Active Directory의 부하를 줄이려고 사용자와 그룹 멤버십을 데이터 스택 전체에 전파하는 동기화 프로세스를 만들었습니다.

## Kerberos 서버 구성 {#kerberos-architecture}

Kerberos 인프라는 전체 10만 개가 넘는 principal의 인증을 맡고, 요청량과 낮은 지연을 맞추려고 모든 리전에 Kerberos 서버를 여러 인스턴스 배포합니다. 고가용성을 위해 다중 provider 구성을 택했습니다. 모든 provider 노드가 독립적으로 동작하고 같은 정보를 갖고 있어 서로 쉽게 교체할 수 있습니다.

provider 하나가 KDC consumer 노드 여럿과 독립 클러스터를 이루고, provider의 데이터는 클러스터의 consumer 노드로 복제됩니다. Kerberos 복제는 KDC나 백엔드 데이터베이스 어느 쪽으로도 할 수 있는데, 우버는 KDC의 데이터베이스로 OpenLDAP을 쓰므로 모든 복제가 OpenLDAP에 의존합니다. consumer 노드만 provider를 알면 되기 때문에 클러스터에서 consumer를 쉽게 더하고 뺄 수 있고, consumer를 provider로 승격하는 것도 비교적 쉽고 빠릅니다. provider 사이의 쓰기 충돌을 피하려고 어느 시점이든 read-write 모드의 provider는 하나뿐이고 나머지는 read-only입니다.

각 클러스터의 consumer 노드는 리전 기반 DNS 이름(kdc.region-1.data.uber 등) 아래 A 레코드로 등록되어, 클라이언트는 특정 호스트 이름 대신 짧고 알려진 DNS 이름으로 인증합니다. provider 노드는 클라이언트에게 숨겨져 Kerberos 인프라 서비스만 접근합니다. 리전별 클러스터와 수십 개의 consumer 노드를 둔 다중 provider 구성이 요청량을 감당하고 도입 확산을 뒷받침했습니다.

## Keytab 배포 파이프라인 {#keytab-distribution-pipeline}

2016년 Kerberos를 처음 세웠을 때 팀의 새 운영 업무는 principal 등록과 keytab 안전 배포였습니다. 처음에는 Kerberos kadmin 호스트에 직접 로그인해 계정을 등록하고 keytab을 만들어 팀과 정한 공유 위치에 scp로 보냈습니다. 여기에는 문제가 여럿 있었습니다.

- 장애와 확장성 문제로 이미 바쁜 팀에 principal과 keytab 생성 요청이 임시로 몰려 일이 늘었습니다.
- 수동 프로비저닝이 서비스 배포의 완전 자동화 비전을 막았습니다.
- 엄격히 정해진 절차 없이 자격 증명이 사람 손을 거쳐 전달되는 보안 문제가 있었습니다.
- kadmind를 수동으로 건드릴 때마다 운영 데이터를 실수로 지우거나 손상시킬 위험이 있었습니다.

Hadoop 인프라 전체를 컨테이너화한 이전 작업과 같은 회사 차원의 완전 자동화 노력의 하나로, keytab 생성과 배포를 자동화한 Keytab Distribution Pipeline(KDP)을 만들었습니다. KDP의 역할은 세 가지입니다. 미리 정한 소스의 메타데이터 변경을 관찰해 Kerberos principal 생성과 삭제의 입력으로 쓰고, principal에 맞는 keytab을 만들거나 지워 보안 금고(secure vault)에서 쓸 수 있게 하며, 금고에서 keytab을 안전하게 가져오는 클라이언트를 제공하고 유지합니다. 새 서비스의 온보딩을 간단하게 만드는 데 투자해, 서비스 소유 팀은 약 3줄의 설정을 정의하고 서비스 코드에 약 3줄의 클라이언트 호출을 넣으면 됩니다. 이 쉬운 온보딩과 keytab 자동 관리가 Kerberos 도입 확산에 크게 기여했습니다.

keytab 사용 사례는 크게 둘입니다. 서비스 계정이나 시스템 계정으로 자동 파이프라인과 작업을 도는 서비스, 그리고 HDFS와 YARN처럼 큰 플릿에서 서비스 클러스터에 노드를 추가할 때 서비스-호스트 principal(예: hdfs/us-west-123)로 인증하는 서비스입니다. KDP 자동화는 세 시스템과 연결됩니다. 서비스·시스템 계정의 원본인 Active Directory, 그리고 서비스와 배포 호스트 정보의 원천인 Odin(스테이트풀 서비스용 사내 오케스트레이션 시스템)과 Peloton(스테이트리스 서비스용)입니다.

### 파이프라인 구성요소 {#pipeline-components}

- Kerberos-Bridge: Kerberos 인프라와 외부 메타데이터 제공자를 잇는 서비스입니다. 서비스와 호스트 메타데이터를 주기적으로 가져와 사내 Git 저장소의 keytab 엔트리를 갱신합니다. keytab 엔트리는 실제 keytab이 아니라 principal 이름, 권한 설정용 소유자 정보 등 keytab의 메타데이터입니다. Git을 쓰면 이력을 통한 감사, revert를 통한 롤백, 접근 제어, 수동 변경 때의 동료 리뷰 같은 기능을 그대로 얻습니다.
- Keytab-Manager: 파이프라인의 핵심으로, 클라이언트에게 숨겨져 KDP만 접근하는 Kerberos provider 호스트에서 돕니다. 이 호스트는 KDC, kadmin, OpenLDAP, 그리고 Keytab-Manager를 실행합니다. Keytab-Manager는 오픈소스 KDC/OpenLDAP와 우버 내부 서비스를 잇는 접착제로, 엔트리 저장소를 감시하다가 새 엔트리(예를 들어 HDFS가 새 호스트 us-west-123에 배포됨을 뜻하는 `hdfs/us-west-123@DATA.UBER.COM`)가 생기면 로컬 kadmin으로 같은 이름의 principal을 만들고 keytab 파일(hdfs_us-west-123.keytab)을 생성합니다. keytab은 세분화된 권한과 함께 Secrets Store에 저장되고, Keytab-Manager는 Secrets Store도 감시하며 새로 생기거나 사라진 keytab을 반영하고 엔트리의 소유자에 맞춰 권한을 설정합니다.
- Keytab-Fetcher: 서비스 코드에 넣어 Secrets Store에서 자신의 keytab을 가져오는 라이브러리입니다. 전체 플릿에 배포된 오케스트레이션 시스템 에이전트가 이를 이용해 keytab을 받아 서비스 컨테이너에 제공합니다.

KDP 전체는 SPIRE로 보호됩니다. 서비스가 Secret Store를 갱신하거나 읽기 전에 인증하게 하고, Secrets Store는 허용된 서비스에게만 keytab 접근을 허락합니다. KDP는 2년 넘게 운영되며 매주 1,000개 넘는 keytab을 생성하고 배포합니다. 자동화 덕에 팀은 principal 등록과 keytab 배포에서 해방되었고, 필요할 때 keytab을 교체(rotate)할 수도 있으며, KDP 대시보드를 지켜보는 데 드는 시간은 아주 적습니다.

## 맺음 {#wrap-up}

선택한 Kerberos 구조와 KDP 자동화는 개발자 생산성과 데이터 스택의 보안, 신뢰성(모든 것이 자동화된 덕분)을 높이고 데이터 서비스의 인증을 손쉽게 확장하게 했습니다. 후속 글에서는 플릿 전체의 keytab 교체를 중앙 자동화 시스템으로 관리하는 방법을 소개할 예정이라고 합니다.

{{% details title="규모와 계정 유형 요약" closed="true" %}}

| 항목 | 값 |
|---|---|
| 데이터 플랫폼 운영 / Kerberos 도입 | 2015년 / 2016년 |
| 저장 분석 데이터 | 300PB 이상 |
| 인증하는 principal | 10만 개 이상 |
| KDP 운영 기간 / 처리량 | 2년 이상 / 주 1,000개 이상 keytab |
| KDP 온보딩 작업량 | 설정 약 3줄 + 코드 약 3줄 |
| 서비스 계정 생성 후 사용 가능 시점 | 24시간 이내 |
| 계정 유형 | 사용자, 서비스, 시스템, 서비스-호스트 |
| Kerberos 서버 구성 | 리전별 클러스터, 다중 provider(쓰기 가능한 provider 1개), 수십 개 consumer, OpenLDAP 복제 |
| KDP 연동 시스템 | Active Directory, Odin, Peloton, Secrets Store, SPIRE |

{{% /details %}}
