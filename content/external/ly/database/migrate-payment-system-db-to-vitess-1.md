---
title: "결제 시스템 DB를 Nbase-T에서 Vitess로 옮기기 1편, 솔루션 선정"
description: "LINE Billing Platform 팀이 라이선스 비용 때문에 Nbase-T를 대체할 샤딩 솔루션을 고른 과정을 정리했습니다. ShardingSphere, TiDB, Vitess를 비교한 PoC의 성능·비용·기능 결과와 Vitess 선정 이유를 요약합니다."
date: 2026-11-14
weight: 3
---

# 결제 시스템 DB를 Nbase-T에서 Vitess로 옮기기 1편, 솔루션 선정 (2025-06)

{{< callout type="info" >}}
**원문 정보**
- 원문: [일 평균 30억 건을 처리하는 결제 시스템의 DB를 Vitess로 교체하기 - 1. 솔루션 선정기](https://techblog.lycorp.co.jp/ko/migrate-payment-system-db-to-vitess-1)
- 매체 · 게시일: LY Corporation Tech Blog · 2025-06-18
- 저자: 김영재, 이정재 (LINE Billing Platform 개발 팀)
- 시리즈 1편이며, 개발·운영 경험은 [2편]({{< relref "/external/ly/database/migrate-payment-system-db-to-vitess-2.md" >}})에서 다룹니다.
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 마이그레이션 배경과 후보 {#background}

LINE Billing Platform 팀은 LINE 앱 안의 여러 서비스가 쓰는 결제·포인트 플랫폼을 운영합니다. 가장 핵심이고 오래 운영한 결제 시스템의 DB를 Nbase-T에서 Vitess로 옮겼는데, 가장 큰 이유는 지금까지 비용이 들지 않았지만 계약 관계가 바뀌어 라이선스 비용이 붙게 됐기 때문입니다.

결제 코어 시스템이라 성능 대비 운용 비용이 낮은 솔루션을 조사했고, 그중 PoC로 비교한 샤딩 솔루션은 Apache ShardingSphere, TiDB, Vitess였습니다.

- Apache ShardingSphere는 프락시와 JDBC 방식을 모두 지원하고 다양한 샤딩 전략과 분산 트랜잭션을 갖췄습니다. 하지만 프락시 방식은 SQL 통합 처리 정도의 단순한 기능만 처리하고, JDBC 방식은 컴포넌트마다 구현 포인트가 늘어 관리 비용이 큽니다. 두 방식 모두 데이터 리샤딩(리밸런싱)을 직접 구현해야 해서 추가 개발 포인트가 많다고 보고 PoC 대상에서 뺐습니다.
- TiDB는 MySQL 호환 분산 SQL 데이터베이스로 OLTP와 OLAP를 모두 겨냥합니다. SQL 계층 TiDB, 메타데이터와 배치를 맡는 PD, 데이터를 저장하는 스토리지(행 기반 TiKV, 열 기반 TiFlash)로 구성됩니다. 데이터가 TiKV에 자동으로 리밸런싱되어 샤딩 전략과 샤딩 키가 필요 없고, 개발과 DBA의 운용 비용을 크게 줄일 수 있다고 보고 PoC를 진행했습니다. 사내 MySQL DB 팀의 추천과 VOOM 팀의 사용 선례가 있었습니다.
- Vitess는 YouTube가 MySQL 확장 문제를 풀려고 만든 CNCF 프로젝트입니다. 클라우드, 베어 메탈, 하이브리드 환경을 제공하는데, 팀은 결제 시스템이라 잠깐의 페일오버도 손실이 되므로 물리 서버에 직접 설치하는 베어 메탈을 택했습니다. GitHub과 Slack도 베어 메탈 환경을 쓴다는 점이 장점이었습니다.

Vitess 구성 요소는 다음과 같습니다. VTGate는 클라이언트와 클러스터 사이의 게이트웨이로 쿼리를 알맞은 VTTablet에 보내고 샤딩과 분산 트랜잭션을 처리하며, 여러 대를 두어 HA를 구성합니다. VTTablet은 MySQL 인스턴스 앞에서 쿼리 실행, 복제, 장애 조치를 관리하고 MySQL과 1:1로 묶어 운영하길 권합니다. VTAdmin은 웹 UI, VTctld는 CLI 기반 관리 서비스, VTorc는 orchestrator를 감싼 장애 자동 복구 도구이며, 토폴로지 서버는 ZooKeeper, etcd, Consul 같은 저장소로 메타데이터를 공유합니다. 옵션이 다양해 팀도 옵션 테스트에 많은 리소스를 썼다고 합니다.

## 성능 PoC {#performance}

TiDB와 Vitess를 기존 Nbase-T와 성능, 비용, 가이드, 기능, 운영 측면에서 비교했습니다(Vitess는 v20.0 기준). 실제 결제 API 기반 시나리오로 결제와 조회를 일정 비율로 요청하며 스레드 수를 늘려 TPS와 리소스 상태를 봤습니다. 가장 적은 장비로 높은 TPS와 효율적인 자원 사용을 보인 쪽은 Nbase-T였습니다.

Nbase-T와 TiDB는 스레드 수에 비례해 CPU 사용률이 올랐지만, Vitess는 스레드를 늘려도 CPU 사용률이 50% 선에서 머물렀습니다. 구간별 스레드 옵션은 효과가 없었고 구간별 모니터링으로 병목이 VTGate임을 확인했습니다. Go GC 설정(`GOMEMLIMIT` 조정, `GOGC=off`)으로 GC 실행 빈도와 쿼리 지연·분산이 줄었지만 DB 장비 성능을 끝까지 쓰지는 못했습니다.

그래서 VTGate를 늘려 적정 비율을 찾았습니다. 프라이머리 샤드를 3대로 두고 VTGate를 3대부터 그 배수로 늘리자, TPS는 VTGate 3대에서 3,835, 9대에서 8,637, 18대에서 12,295로 올랐습니다. 샤드 대비 3배(VTGate 9대)까지는 크게 늘다가 4배부터 증가폭이 줄었고, 팀은 프라이머리 샤드와 VTGate의 비율을 최소 1:3으로 유지해야 최대 성능을 낼 수 있다고 정리했습니다. VTGate는 로직이 복잡하지 않아 사양을 낮추고 대수를 늘리는 쪽이 효과적이었습니다.

VTTablet 옵션 `queryserver-config-transaction-cap`(트랜잭션 허용치, 기본 20)도 조정했습니다. 스레드 700개에서 50으로 올리자 TPS가 11,268, 100으로 올리자 15,639였습니다. Vitess는 버전별로 옵션이 달라 확인이 필요하다고 덧붙입니다.

종합하면 Vitess는 Nbase-T보다 단위 성능이 낮지만 서버 자원을 효율적으로 쓰고 트래픽 대비 응답 시간 편차가 작아 안정적이었습니다. TiDB는 TiDB와 TiKV를 1:3으로 맞춰 장비를 늘릴수록 성능이 올랐지만 클러스터마다 장비가 최소 3배 필요했고 자원 사용도 컸습니다. 새 솔루션은 기존 성능을 내려면 각각 일정 비율의 추가 장비가 필요하다는 결론입니다.

## 비용과 기능 비교 {#cost-and-features}

비용은 기존과 같은 성능을 내는 구성의 월 인프라 비용을 예시로 비교했습니다. 서버 단가를 같은 사양이면 임의로 같게 가정한 값이고 실제 비용이 아닙니다. 이 가정에서 Nbase-T는 100만, Vitess는 DB 100만에 VTGate 25대 5만을 더한 105만, TiDB는 TiDB 100만, TiKV 140만, PD 10만, TiFlash 50만, 모니터링 6천을 더한 약 300만입니다. TiDB는 운용 비용을 줄이는 형태지만 기본 장비 비용이 기존보다 최소 3배 이상 필요했고, 불필요한 비용을 줄이면서 성능을 내는 솔루션은 Vitess였습니다.

그 밖의 비교에서 눈에 띄는 점은 다음과 같습니다.

- 가이드: 네 솔루션 모두 커뮤니티 지원이 있고, Nbase-T만 Java 예제 코드가 없습니다. 사용 사례로 Vitess는 YouTube, Slack, GitHub, 네이버 등이 꼽힙니다.
- 기능: Nbase-T는 모듈러 샤딩이고 분산 트랜잭션이 없습니다. Vitess는 VSchema의 Vindex로 샤딩 키를 관리하며 2PC로 분산 트랜잭션을 지원하고, VTGate가 쿼리 WHERE 절을 분석해 특정 샤드나 모든 샤드로 보냅니다(scatter query). TiDB는 리전 기반 샤딩과 래프트 복제로 샤딩 키 없이 분산하지만 프락시 서버 지원은 없습니다.
- 운영: Vitess는 리샤딩을 지원하고 VTorc가 프라이머리 이상 시 레플리카를 승격합니다. 자동 스케일 아웃은 미지원이지만 쿠버네티스에서 샤드 설정과 추가를 명령어로 지원해 공수가 크지 않습니다. 관리 도구로 VTAdmin, Prometheus, Grafana를 제공합니다.

## 선정 결과 {#decision}

팀의 요약은 이렇습니다. ShardingSphere는 개발자가 모든 것을 제어하지만 리밸런싱 등 현재 쓰는 기능을 쓰려면 추가 개발과 비용이 듭니다. TiDB는 개발자가 쓰기 편하고 내부 DBA 팀의 지원도 받지만 서버 비용이 약 3배 이상입니다. Vitess는 성능과 비용이 가장 합리적이고 필요한 기능 이상을 제공하며 많은 트래픽을 처리하는 여러 회사가 쓰는 검증된 플랫폼이지만, DBA와 개발자가 높은 학습 비용을 감내해야 합니다. 팀은 추가 학습 비용을 어느 정도 감내하기로 하고 Vitess를 선택했습니다.

{{% details title="PoC 환경과 측정값" closed="true" %}}

| 항목 | 값 |
|---|---|
| Nbase-T · Vitess 샤드 DB | 8vCPU 16GB 100GB SSD, 4대(프라이머리 2, 레플리카 2) |
| VTGate(초기 구성) | 4vCPU 18GB, 4대 |
| TiDB 구성 | TiDB 2대, PD 3대, TiKV 4대 |
| VTGate 대수별 TPS(프라이머리 샤드 3대) | 3대 3,835 / 6대 6,420 / 9대 8,637 / 12대 10,354 / 15대 11,671 / 18대 12,295 |
| `queryserver-config-transaction-cap`(스레드 700) | 50: 11,268 TPS, 100: 15,639 TPS (기본값 20) |
| 비용 예시(임의 단가) | Nbase-T 1,000,000 / Vitess 1,050,000 / TiDB 3,006,000 |
| 비용 예시의 장비 가정 | Nbase-T와 Vitess DB는 프라이머리 25·레플리카 25, VTGate 25대, TiDB는 프라이머리 50, TiKV 70, PD 5, TiFlash 25 |

{{% /details %}}
