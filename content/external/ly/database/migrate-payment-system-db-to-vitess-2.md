---
title: "결제 시스템 DB를 Nbase-T에서 Vitess로 옮기기 2편, 개발과 운영"
description: "LINE Billing Platform 팀이 Vitess를 도입한 뒤 프로토콜 선택, 키스페이스 설계, 모니터링, DDL 프로세스, 페일오버 테스트를 어떻게 다뤘는지 정리했습니다. 6개월 운영 뒤 팀이 꼽은 장단점도 요약합니다."
date: 2026-11-14
weight: 2
---

# 결제 시스템 DB를 Nbase-T에서 Vitess로 옮기기 2편, 개발과 운영 (2025-08)

{{< callout type="info" >}}
**원문 정보**
- 원문: [일 평균 30억 건을 처리하는 결제 시스템의 DB를 Vitess로 교체하기 - 2. 개발 및 운영기](https://techblog.lycorp.co.jp/ko/migrate-payment-system-db-to-vitess-2)
- 매체 · 게시일: LY Corporation Tech Blog · 2025-08-01
- 저자: 김영재, 이정재 (LINE Billing Platform 개발 팀)
- 시리즈 2편이며, 솔루션 선정 과정은 [1편]({{< relref "/external/ly/database/migrate-payment-system-db-to-vitess-1.md" >}})에서 다룹니다. 원문은 1편을 먼저 읽으면 이해하기 쉽다고 안내합니다.
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 프로토콜 선택 {#protocol}

VTGate는 MySQL 프로토콜과 gRPC 프로토콜을 모두 지원합니다. 팀은 Nbase-T에서 RPC 프로토콜이 성능이 좋았던 경험이 있어 Vitess 공식 저장소의 Java 클라이언트 중 grpc-client 모듈로 먼저 개발했습니다. 그런데 성능 테스트에서 `http2: frame too large` 오류가 간헐적으로 나고 CPU 사용량이 크게 늘었으며, 쿼리 결과를 Java 객체로 바꾸는 과정도 번거로웠습니다. Vitess 공식 Slack에서 gRPC 사용 시 CPU 오버헤드가 있다는 점을 확인했고, 관련 모듈을 활발히 개발하고 있지 않으니 MySQL 프로토콜을 권한다는 답을 받아 MySQL 프로토콜로 개발했습니다.

## 키스페이스와 요청 처리 {#keyspace}

키스페이스는 둘입니다. 글로벌 키스페이스는 단일 샤드이고, 사용자 정보와 샤딩 키 값을 저장하는 자동 증가 샤딩 키 관리 테이블(`account_sharding_key`)을 `sequence` 타입으로 둡니다. 서비스 키스페이스는 N개 샤드로 분산해 코인 잔액, 충전, 사용 내역 같은 가상 재화 데이터를 저장하며 Vindex는 해시를 씁니다. 프라이머리-레플리카-읽기전용 혹은 프라이머리-레플리카 구조로 운영할 수 있습니다. 코인 충전 요청이 오면 조건절에 샤딩 키를 넣거나 삽입 시 샤딩 키를 포함해, VTGate가 해당 사용자 데이터가 있는 샤드를 특정하고 그 샤드에만 쿼리를 보냅니다.

## MySQL 호환성과 쓰는 기능 {#compatibility}

트랜잭션 격리 수준은 단일 샤드에서 `REPEATABLE READ`, 다중 샤드에서 `READ COMMITTED`이며 클라이언트가 `SET`으로 트랜잭션 모드를 바꿀 수 있습니다. 샤딩 DB 특성상 일부 쿼리에는 제약이 있고, 목록은 공식 저장소의 `unsupported_cases.json`에서 관리됩니다. View는 샤딩된 키스페이스에서만 지원하며 VTGate와 VTTablet에 `--enable-views`를 켜야 하고, 임시 테이블은 샤딩되지 않은 키스페이스에서만 만들 수 있습니다.

쓰거나 쓸 것을 고려 중인 기능으로는 샤드 간 트랜잭션을 처리하는 Two-Phase Commit이 있고, 실행 계획 분석에는 VEXPLAIN과 VTEXPLAIN을 씁니다. 팀은 VTAdmin의 웹 UI로 VTEXPLAIN을 실행합니다.

## 모니터링 {#monitoring}

주로 VTOrc 지표, VTGate와 VTTablet 지표, Vitess 로그를 봅니다.

- VTOrc는 토폴로지 서버와 VTTablet에서 데이터를 모아 문제를 파악하며, 16000 포트의 `/metrics`로 Prometheus가 지표를 수집합니다. `vtorc_detected_problems`에는 `analysis`(문제 종류), `keyspace`, `shard`, `tablet_alias`가 기록돼 문제가 생긴 VTTablet과 MySQL 노드를 식별할 수 있습니다. 문제가 생기면 이메일과 Slack으로 알람을 받고, 복구 내역은 `vtorc_recoveries_count`나 `/debug/status`에서 봅니다.
- VTGate와 VTTablet도 같은 `/metrics` 경로를 Prometheus로 수집해 Grafana 대시보드와 알람에 씁니다. VTGate는 `vtgate_api_count`와 `vtgate_api_error_counts`, VTTablet은 `vttablet_queries_count`와 `vttablet_errors` 등이 있습니다.
- 로그는 `--log_dir`에 레벨별 파일로 쌓이며, Vector로 `INFO` 이상을 모두 수집하고 `ERROR`나 `FATAL`이 수집되면 알람을 받습니다.
- 그 밖에 사내 DB용 MySQL 모니터링(다운, 복제 지연 시 DBA 조직과 개발팀 모두 알람), 인프라 모니터링, 그리고 VTGate·VTTablet·vtctld·etcd에 대한 자체 헬스 체크가 있습니다. 앞의 셋에는 `/debug/status`, etcd에는 `/version`에 GET 요청을 보내 200 응답을 확인합니다.

## DDL 수행 프로세스 {#ddl-process}

스키마 관리 방식은 비관리(unmanaged)와 관리(managed)로 나뉩니다. 비관리는 `ApplySchema`나 DDL 전략 `direct`, 또는 개별 MySQL에서 직접 DDL을 수행한 뒤 `ReloadSchema`로 반영하는 방법입니다. 관리 방식은 Vitess의 Online DDL 전략으로, 팀은 `vitess`(VReplication 활용)와 `mysql`(온라인 DDL 스케줄러가 관리하되 일반 MySQL 문으로 실행) 전략을 테스트했습니다. 테스트 DDL은 `varchar` 크기 증감, 컬럼 추가·삭제, 인덱스 추가였습니다.

관리 방식은 일괄 수행과 추적이 가능하고 `vitess` 전략에는 리버트, 컷 오버 백오프, 강제 컷 오버도 있습니다. 하지만 MySQL이 온라인 DDL을 지원하지 않는 쿼리는 샤드마다 완료될 때 순단이 생겨 해당 샤드로 가는 요청에 에러가 납니다. 비관리 방식은 모든 샤드의 프라이머리에서 개별 수행해야 하지만, DBA가 기존처럼 일할 수 있고 Vitess를 몰라도 되며 온라인 DDL이 안 되는 쿼리에는 pt-osc 같은 서드 파티 도구로 영향을 줄일 수 있습니다. 팀은 온라인 DDL 지원과 DBA 팀과의 역할 구분을 이유로 비관리 방식을 택했습니다. 프로세스는 다음과 같습니다.

- 개발 팀이 쿼리를 작성하고 기안을 올립니다.
- DBA가 각 샤드의 프라이머리에서 MySQL 수준 DDL을 직접 수행합니다.
- 개발 팀이 `ReloadSchema`로 Vitess에 반영하고 `ValidateSchemaKeyspace`로 샤드 간 스키마 일치를 검증합니다.

프라이머리 MySQL 점검이 필요하면 `PlannedReparentShard`로 레플리카를 프라이머리로 승격하며, 이때 일시적으로 순단이 생겨 애플리케이션에 에러가 납니다.

## 페일오버 테스트 {#failover-test}

프라이머리 노드의 MySQL 프로세스를 종료하는 테스트에서는 애플리케이션 장애가 발생하고, VTOrc가 헬스 체크로 `DeadPrimary`를 감지해 `EmergencyReparentShard`로 새 프라이머리를 승격하며 장애가 해소됐습니다. 애플리케이션 장애는 10초 내외였고, 프라이머리 노드가 다운돼도 10초 안팎으로 자동 복구됩니다.

테스트 중에는 GTID 일관성 문제가 있었습니다. 레플리카에 프라이머리에서 복제되지 않은 트랜잭션이 생기면 그 GTID는 프라이머리에 없어 잘못된 GTID(errant GTID)가 되는데, 보통 복제 중에 레플리카에 직접 DML을 수행할 때 생깁니다. 새 프라이머리를 선언한 뒤 종료했던 MySQL을 다시 띄우자 VTOrc에서 `ErrantGTIDDetected`가 나왔습니다. 복구는 `DeleteTablets`로 해당 VTTablet을 지우고, VTTablet 프로세스를 종료한 뒤, 복제 설정을 제거하고 GTID 문제가 생기기 전 최신 백업으로 복구하고, VTTablet을 다시 띄워 복제를 재개하는 순서입니다. 원인은 기존 프라이머리의 VTTablet이 `tabletType`을 `PRIMARY`로 가지고 있던 것으로, MySQL을 재구동하기 전에 VTTablet을 종료하고 재구동 뒤 `tabletType`을 `REPLICA`나 `RDONLY`로 바꿔 띄우자 문제가 생기지 않았습니다.

그 밖에 VTTablet 프로세스가 다운되면 VTOrc가 `InvalidPrimary`, `ConnectedToWrongPrimary`를 감지하지만 페일오버는 하지 않아 직접 해결해야 합니다. VTGate의 버퍼링 기능은 `EmergencyReparentShard`와 `PlannedReparentShard` 중 애플리케이션 영향을 줄이지만, 대기하는 동안 스레드를 점유해 서버 자원이 고갈될 수 있어 적절한 타임아웃이 필요합니다.

## 6개월 운영 뒤의 평가 {#retrospective}

팀은 Vitess를 다양한 기능을 갖춘 견고한 플랫폼이라고 평가합니다. 장점으로는 공식 문서만으로 설치부터 애플리케이션 개발까지 가능한 체계적인 문서(다만 설정값 튜닝 가이드는 보기 쉽지 않아 환경별 성능 테스트가 필요), MySQL 프로토콜 지원 덕에 기존 연동 코드를 재사용해 개발 시간이 줄어드는 점, 리샤딩과 다양한 샤딩 키 처리, 분산 트랜잭션을 vtctldclient나 VTAdmin으로 쉽게 다루는 점, VTOrc의 장애 감지·복구와 Prometheus 지표 수집을 꼽습니다. 단점은 지속적으로 학습해야 하고, 오픈소스 특성상 버전 업데이트를 추적하고 적용하는 데 부담이 있다는 것입니다.

{{% details title="원문의 주요 설정과 명령어" closed="true" %}}

| 항목 | 값 |
|---|---|
| 키스페이스 | 글로벌(단일 샤드, `sequence`), 서비스(N 샤드, 해시 Vindex) |
| 트랜잭션 격리 수준 | 단일 샤드 REPEATABLE READ, 다중 샤드 READ COMMITTED |
| VTOrc 지표 경로 | 16000 포트 `/metrics`, `/debug/status`, `/debug/vars` |
| 로그 수집 | Vector로 INFO 이상, ERROR·FATAL 알람 |
| 헬스 체크 | VTGate·VTTablet·vtctld는 `/debug/status`, etcd는 `/version` |
| 비관리 DDL 반영 | `ReloadSchema`, `ValidateSchemaKeyspace` |
| 프라이머리 다운 시 복구 | VTOrc `DeadPrimary` 감지, `EmergencyReparentShard`, 장애 약 10초 |
| 잘못된 GTID 복구 | `DeleteTablets`, 최신 백업 복구, VTTablet 재구동 |

{{% /details %}}
