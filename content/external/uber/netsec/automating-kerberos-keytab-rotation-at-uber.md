---
title: "10만 개 Kerberos keytab의 자동 교체"
description: "우버가 5년간 10만 개 넘게 늘어난 Kerberos keytab을 서비스 중단 없이 자동으로 교체한 방법을 정리했습니다. Secret Management Platform 연동, kvno 불일치 방지, 교체 범위를 제한하는 안전장치를 요약합니다."
date: 2026-11-10
weight: 6
---

# 10만 개 Kerberos keytab의 자동 교체 (2025-06)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Automating Kerberos Keytab Rotation at Uber](https://www.uber.com/us/en/blog/automating-kerberos-keytab-rotation-at-uber/)
- 매체 · 게시일: Uber Engineering Blog · 2025-06-18
- 저자: Junyan Guo(Senior Software Engineer, Data Security 팀), Matt Mathew(Principal Engineer, Engineering Security 팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 교체가 어려워진 배경 {#background}

우버는 앞선 글에서 MIT Kerberos 도입을 넓힌 과정을 소개했고, 그때 keytab(Kerberos 자격 증명)을 만들어 배포하는 자동화 시스템 KDP(Keytab Distribution Pipeline)를 만들었습니다. Uber Eats 검색 인덱스를 HDFS에서 가져오는 일, 수백 개 Flink 스트리밍 애플리케이션 보안, 데이터 인프라용 Zookeeper 클러스터 250개의 인증, 20개가 넘는 배치 분석 시스템의 인증이 KDP 위에서 돌아갑니다.

사용처가 늘면서 keytab은 5년 사이 10만 개를 넘겼습니다. 보안 요구가 높은 용도라 주기적 교체를 켜기로 했는데, 여기에는 두 가지 어려움이 있었습니다.

- 규모와 복잡도. keytab이 수천 개 애플리케이션과 노드에 흩어져 있어 손으로 바꿀 수 없습니다. 이런 규모의 교체를 다룬 Kerberos API나 오픈소스 도구, 업계 사례도 없어 직접 만들어야 했습니다. Kerberos가 대칭키 방식이라 KDC와 클라이언트가 보조를 맞춰야 하는 점도 부담이었습니다.
- 서비스 중단 위험. 교체하면 이전 키 버전(kvno)이 곧바로 무효가 됩니다. 새 keytab 배포가 조금만 늦어도 인증이 실패하고, 고객에게 보이는 기능이라면 장애로 이어집니다.

그래서 사람 손 없이 장애 도메인을 고려해 교체를 지휘하는 자동화를 설계했습니다.

## SMP와 KDP를 잇는 구조 {#architecture}

keytab은 우버의 Secret Management Platform(SMP)을 통해 각 워크로드에 전달됩니다. SMP는 모든 시크릿의 마지막 갱신 시각, 종류, 생성과 삭제를 맡는 secret provider, 종류별 교체 주기(N일)를 기록합니다. Secret Lifecycle Manager가 교체일이 다가온 시크릿에 대해 Cadence 워크플로를 예약하고 필요한 secret provider를 호출합니다.

Kerberos 쪽에서는 두 컴포넌트가 수명주기를 맡습니다. 기존 Kerberos Bridge가 Secret Provider 인터페이스를 구현해 keytab 생성, 교체, 삭제를 지원하고 Secret Lifecycle Manager의 교체 요청을 받습니다. KDC 옆 호스트에 있는 Keytab Manager는 비밀번호 변경과 새 keytab 생성 명령을 내리고 최신 keytab을 Secret Store에 올립니다. keytab이 필요한 워크로드는 Secret Store에서 주기적으로 keytab을 받아 가도록 설정되어 있습니다.

이 연동으로 사람이 개입하지 않는 자동 교체가 가능해졌고, 남은 과제는 교체 중에 시스템을 건드리지 않는 일이었습니다.

## 교체 중 인증 실패를 줄이는 방법 {#auth-failures}

팀은 Kerberos 프로토콜을 다시 훑어 kvno 불일치로 실패하는 지점을 찾았습니다.

- AS_REQ. 클라이언트가 TGT를 받으려는데 KDC에서는 이미 kvno 2로 바뀌었고 클라이언트는 kvno 1 keytab을 쓰고 있으면 실패합니다.
- TGS_REQ. keytab이 관여하지 않으므로 실패 지점이 아닙니다.
- AP_REQ. 클라이언트가 서버의 kvno 1로 암호화된 서비스 티켓을 받았는데, 서버가 이미 kvno 2 keytab으로 바뀌었으면 서버가 복호화하지 못합니다.

### 클라이언트 쪽 AS_REQ {#as-req}

교체 타임라인은 이렇습니다. t0에 kvno 1 keytab이 만들어지고, t1에 애플리케이션이 이 keytab으로 24시간짜리 TGT 1을 받습니다. t2에 SMP가 KDP를 불러 교체하면 principal 키가 kvno 2가 되고 새 keytab 2가 Secret Store에 올라갑니다. t3에 애플리케이션이 keytab 2를 받아 가고, t4에 TGT 1이 만료될 즈음 keytab 2로 TGT 2를 받습니다.

t2와 t3 사이에는 keytab 1이 무효이고 keytab 2는 아직 없어서 새 TGT를 받을 수 없습니다. t2 < t4 < t3이면 인증 오류와 다운타임이 생깁니다. 대응은 둘입니다.

- 교체 전에 TGT 1의 남은 유효 시간을 확인합니다. Kerberos 감사 로그로 마지막 로그인 시각을 보고 남은 시간을 예측하며, 만료가 가까우면 교체하지 않고 다음 로그인을 기다립니다.
- t2와 t3 사이를 줄입니다. 애플리케이션이 cron 일정으로 Secret Store에서 keytab을 가져오는데, 이 주기를 조정해 30초마다 최신 keytab을 받게 했습니다.

인증 실패가 절대 허용되지 않는 고가용성 애플리케이션에는 서로 다른 principal의 keytab 두 개를 주고 자동화는 그중 하나만 교체합니다. 첫 keytab으로 인증이 실패하면 두 번째 keytab으로 재시도하는 대비책입니다.

### 서버 쪽 AP_REQ {#ap-req}

HDFS NameNode, YARN ResourceManager, Presto Coordinator는 Kerberos에서 서버 역할을 합니다. 서버 키를 교체하면 이전 kvno로 암호화된 서비스 티켓이 캐시에 남아 있을 수 있습니다. 해법은 전환 기간 동안 서버 keytab에 이전 kvno와 현재 kvno를 함께 넣어 두 키로 모두 복호화를 시도하게 하는 것입니다.

서버 교체 타임라인은 다음과 같습니다.

- t0: 서버 keytab 1(kvno 1) 생성
- t1: 클라이언트가 kvno 1로 암호화된 서비스 티켓 1을 받음
- t2: SMP가 교체를 요청. KDC에 kvno 2가 생기고, kvno 1과 2를 모두 담은 keytab 2가 Secret Store에 올라가 서버가 받아 감
- t3: 클라이언트가 서비스 티켓 1을 보내고 서버가 수락
- t4~t5: 서비스 티켓 1이 만료되고 클라이언트가 kvno 2로 암호화된 서비스 티켓 2를 받음
- t6: t2로부터 24시간 뒤, kvno 2만 담은 keytab 3을 올려 서버가 받아 감. 이때는 t2 이전에 발급된 티켓이 모두 만료된 상태
- t7: 서비스 티켓 2를 서버가 수락

클라이언트처럼 동작하는지 서버처럼 동작하는지(둘 다인 경우도 있음)를 구분해 KDP 메타데이터에 적어 두었고, 자동화가 이를 보고 위 두 경우의 로직을 알맞게 적용합니다.

## 자동화를 안전하게 만드는 장치 {#safety}

### 영향 범위 줄이기 {#blast-radius}

수천 개 노드에서 도는 컨테이너 애플리케이션이 principal 하나와 keytab 하나를 공유하는 경우가 있었습니다. 이 keytab 교체에서 문제가 생기면 애플리케이션 상당 부분, 심하면 전체가 실패합니다. 그래서 애플리케이션 소유자와 함께 노드별 principal과 keytab으로 옮겼습니다. keytab 수는 늘었지만 애플리케이션의 장애 도메인 단위로 작은 배치씩 교체할 수 있게 되었습니다. 핵심 애플리케이션에는 노드 단위 principal과 다른 principal에서 파생한 대체 keytab을 두어 위험을 한 번 더 낮췄습니다.

### 속도 제한 {#rate-limit}

Kerberos에 의존하는 시스템 대부분은 쿠버네티스와 비슷한 배포 시스템 Odin이 관리합니다. Odin은 가용 영역, 클러스터, 노드 역할 같은 개념과 워크로드 배치 메타데이터를 조회할 수 있게 해 줍니다. KDP가 장애 도메인 메타데이터를 캐시하도록 고쳐, 한 애플리케이션 클러스터의 같은 역할 노드를 N대 넘게 동시에 교체하지 않는 속도 제한을 만들었습니다. 수십 개뿐인 핵심 컨트롤 플레인 역할에는 더 엄격한 제한과 교체 간 지연을 걸고, 수만 개인 데이터 플레인 역할은 느슨하게 두어 대규모로 교체합니다. 구현에 약 2주가 걸린 간단한 기능이었지만, 핵심 애플리케이션이 사고를 겪지 않게 막는 데 가장 효과가 컸다고 합니다.

### 클러스터 허용 목록 {#allowlist}

HDFS, YARN, Presto 같은 기술마다 중요도(tier)가 다른 클러스터가 여럿입니다. 교체를 켤 때는 클러스터 허용 목록으로 가장 덜 중요한 테스트 클러스터부터 시작해 점차 넓혔습니다. 핵심 tier에 적용하기 전에 오류에서 배우고 롤아웃 방식과 속도 제한을 다듬을 수 있었습니다.

## keytab 자동 삭제 {#deletion}

생성과 교체를 자동화한 다음 순서는 삭제였습니다. 교체를 위해 만든 기능을 그대로 활용했습니다. Kerberos 감사 로그로 삭제해도 되는 principal과 keytab을 가려내고, 속도 제한으로 실수로 쓰던 keytab을 지워도 애플리케이션 전체가 무너지지 않게 했습니다.

서버는 keytab을 AP_REQ로 받은 서비스 티켓 복호화에만 쓰는 경우가 있습니다. 이때는 서버가 직접 로그인(AS_REQ)하지 않으므로, 다른 클라이언트가 이 서버의 서비스 티켓을 요청한 TGS_REQ를 찾아야 합니다. keytab을 소비하는 시스템이 아직 있는지, 마지막 로그인 이후 얼마나 지났는지, 클러스터의 속도 제한 같은 신호를 본 뒤 Secret Store의 keytab과 KDC의 principal을 지웁니다.

## 성과와 다음 단계 {#results}

우버는 2016년 Hadoop 인프라를 키우면서 Kerberos를 들여왔고 이후 여러 핵심 용도로 도입을 넓혔습니다. 이 시스템은 피크 때 한 달에 3만 개가 넘는 keytab을 교체했습니다.

다음 단계로는 클라우드 네이티브로 옮겨 가는 흐름에 맞춰 PKINIT(RFC 4556)를 살펴보고 있습니다. 긴 수명의 keytab을 인증서 기반 인증으로 대체하는 방식입니다. 원문이 꼽은 이점은 세 가지입니다.

- PKI는 비대칭키라서 KDC와 클라이언트가 교체 시점을 맞출 필요가 없고, 교체가 더 안전하고 안정적입니다.
- 인증서 수명을 현재 keytab 교체 주기(개월)보다 훨씬 짧은 시간 단위로 줄일 수 있어 보안 수준이 올라갑니다.
- 인증과 인증서에 PKI와 X.509를 점점 더 쓰는 우버의 현대화 방향과 맞습니다.

데이터 인프라 인증을 현대화한 경험은 이후 글에서 다루겠다고 예고합니다.

{{% details title="원문의 주요 수치" closed="true" %}}

| 항목 | 값 |
|---|---|
| keytab 총수 | 5년간 10만 개 이상 |
| Zookeeper 클러스터 | 250개 |
| 배치 분석 시스템 | 20개 이상 |
| TGT 유효 시간 | 24시간 |
| keytab 가져오기 주기 | 30초 |
| 서버 keytab에서 이전 kvno 제거 시점 | 교체 후 24시간 |
| 속도 제한 구현 기간 | 약 2주 |
| 피크 월간 교체량 | 3만 개 이상 |
| Kerberos 도입 시기 | 2016년 |

{{% /details %}}
