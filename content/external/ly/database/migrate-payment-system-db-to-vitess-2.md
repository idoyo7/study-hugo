---
title: "Nbase-T에서 Vitess로 옮긴 결제 DB의 6개월 운영기"
description: "Vitess로 결제 DB를 옮기면 기존 MySQL 코드와 운영 절차를 어디까지 재사용할 수 있을까요? LINE Billing Platform 팀은 MySQL 프로토콜과 DBA가 직접 수행하는 DDL을 선택하고, 페일오버 테스트에서 자동 복구의 범위와 재기동 조건을 확인했습니다."
date: 2026-11-14
weight: 2
---

# Nbase-T에서 Vitess로 옮긴 결제 DB의 6개월 운영기 (2025-08)

{{< callout type="info" >}}
**원문 정보**
- 원문: [일 평균 30억 건을 처리하는 결제 시스템의 DB를 Vitess로 교체하기 - 2. 개발 및 운영기](https://techblog.lycorp.co.jp/ko/migrate-payment-system-db-to-vitess-2)
- 매체 · 게시일: LY Corporation Tech Blog · 2025-08-01
- 저자: 김영재, 이정재 (LINE Billing Platform 개발 팀)
- 시리즈 2편이며, 솔루션 선정 과정은 [1편]({{< relref "/external/ly/database/migrate-payment-system-db-to-vitess-1.md" >}})에서 다룹니다. 원문은 1편을 먼저 읽으면 이해하기 쉽다고 안내합니다.
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

LINE Billing Platform 개발 팀은 일 평균 30억 건을 처리하는 결제 시스템의 DB를 Nbase-T에서 Vitess로 옮겼습니다. 6개월간 운영한 뒤에는 Vitess를 다양한 기능을 갖춘 견고한 플랫폼으로 평가했습니다. 그 과정에는 처음 골랐던 프로토콜을 바꾸고, DDL을 직접 수행할 주체를 정하고, 장애 후 되살린 노드에서 다시 문제를 찾는 일이 있었습니다.

## gRPC 테스트 뒤 선택한 MySQL 프로토콜 {#protocol}

첫 선택은 gRPC였습니다. VTGate는 gRPC와 MySQL 프로토콜을 모두 지원하지만, 팀에는 Nbase-T에서 RPC 프로토콜로 좋은 성능을 얻었던 경험이 있었습니다. Vitess 공식 저장소의 Java 클라이언트 중 grpc-client 모듈로 개발을 시작한 배경입니다.

성능 테스트에서 문제가 드러났습니다. `http2: frame too large` 오류가 간헐적으로 발생했고 CPU 사용량도 크게 늘었습니다. 쿼리 결과를 Java 객체로 변환하는 과정까지 번거로웠습니다.

팀은 Vitess 공식 Slack에서 gRPC 사용 시 CPU 오버헤드가 발생한다는 점을 확인했습니다. 프로토콜 선택을 문의했을 때는 관련 모듈을 활발히 개발하고 있지 않으므로 MySQL 프로토콜을 권장한다는 답을 받았습니다. 이후 애플리케이션은 MySQL 프로토콜로 개발했습니다. 기존 MySQL 연동 코드를 재사용해 개발 시간을 줄일 수 있다는 점도 이 선택의 장점입니다.

공식 문서만으로 설치와 설정부터 애플리케이션 개발까지 진행할 수 있다는 점은 팀이 높이 평가한 부분입니다. 설정값 튜닝까지 문서만 따라가기는 어려웠습니다. 튜닝 가이드가 보기 쉽게 제공되지 않아 사용 환경에 맞춰 여러 설정값으로 성능을 시험해야 합니다. Vitess를 계속 학습하고 버전 업데이트를 추적·적용하는 부담도 운영 과정에 남았습니다.

## 샤딩 키로 찾아가는 코인 데이터 {#keyspace}

코인 충전 요청이 들어오면 VTGate는 사용자 데이터가 있는 샤드를 찾아 쿼리를 보냅니다. 애플리케이션이 조건절에 샤딩 키를 넣거나 `insert`할 데이터에 그 키를 포함하면, 해당 샤드에만 쿼리가 실행됩니다.

이를 위해 키스페이스를 나눴습니다. 글로벌 키스페이스는 단일 샤드로 운영하며, 사용자 정보와 자동 증가하는 샤딩 키 값을 `account_sharding_key` 테이블에 저장합니다. VSchema에서는 이 테이블의 타입을 `sequence`로 지정합니다. 코인 잔액과 충전·사용 내역은 N개 샤드로 나눈 서비스 키스페이스에 저장하고, Vindex는 해시를 사용합니다. 서비스 키스페이스는 프라이머리-레플리카-읽기전용 또는 프라이머리-레플리카 구성으로 운영할 수 있습니다.

MySQL 프로토콜로 접속해도 샤딩에 따른 차이는 남습니다. 트랜잭션 격리 수준은 단일 샤드에서 `REPEATABLE READ`, 다중 샤드에서 `READ COMMITTED`가 적용됩니다. 클라이언트는 `SET`으로 트랜잭션 모드를 바꿀 수 있습니다. 일부 쿼리에는 제약이 있으며, 해당 목록은 공식 저장소의 `unsupported_cases.json`에서 관리합니다.

View와 임시 테이블도 지원 범위가 다릅니다. View는 샤딩된 키스페이스에서만 지원하며, VTGate와 VTTablet을 실행할 때 `--enable-views`를 활성화해야 합니다. 임시 테이블을 만들 수 있는 곳은 샤딩되지 않은 키스페이스입니다.

실행 계획 분석에는 VTAdmin 웹 UI에서 VTEXPLAIN을 사용합니다. Vitess는 VEXPLAIN도 제공하며, 팀이 사용 중이거나 도입을 고려하는 기능 목록에는 샤드 간 트랜잭션을 처리하는 Two-Phase Commit도 포함돼 있습니다. 리샤딩과 다양한 샤딩 키 처리, 분산 트랜잭션 기능을 vtctldclient나 VTAdmin으로 쉽게 다룰 수 있다는 점도 팀이 꼽은 장점입니다.

## DBA가 각 샤드에서 수행하는 DDL {#ddl-process}

스키마 변경은 DBA가 각 샤드의 프라이머리 MySQL에서 직접 수행하도록 정했습니다. Vitess의 스키마 관리 기능을 사용하지 않는 비관리 방식입니다. 관리 방식의 일괄 수행과 추적 기능도 시험했지만, 온라인 DDL 지원과 DBA 팀의 역할 구분을 고려해 내린 결정이었습니다.

비관리 방식에도 여러 경로가 있습니다. vtctldclient의 `ApplySchema`를 쓰거나, VTGate의 DDL 전략을 `direct`로 설정하거나, 개별 MySQL에서 직접 DDL을 수행한 뒤 `ReloadSchema`로 변경 내용을 반영할 수 있습니다. 팀이 고른 경로는 마지막 방식입니다.

비교 대상은 Vitess의 Online DDL 전략 중 `vitess`와 `mysql`이었습니다. `vitess`는 내장된 VReplication을 활용하고, `mysql`은 온라인 DDL 스케줄러가 관리하되 일반 MySQL 문으로 실행합니다. 팀은 직접 수행하는 방식과 이 전략들로 `varchar` 크기 증감, 컬럼 추가·삭제, 인덱스 추가를 테스트했습니다.

관리 방식은 일괄 수행과 추적이 가능했습니다. `vitess` 전략에는 리버트, 컷 오버 백오프, 강제 컷 오버 기능도 있습니다. 문제는 MySQL이 온라인 DDL을 지원하지 않는 쿼리였습니다. 테스트에서는 각 샤드의 작업이 끝날 때마다 순단이 발생했고, 애플리케이션이 해당 샤드로 보낸 쿼리에서 에러가 났습니다.

MySQL에서 직접 수행하려면 모든 샤드의 프라이머리에 개별적으로 작업해야 합니다. 대신 DBA는 Vitess를 익히지 않아도 기존처럼 MySQL DDL 수행과 반영 확인을 맡을 수 있습니다. 온라인 DDL이 불가능한 쿼리에는 pt-osc 같은 서드 파티 도구를 사용해 애플리케이션 영향을 줄이는 방법도 있습니다.

실제 절차는 개발 팀의 쿼리 작성과 기안 상신으로 시작합니다. DBA가 각 샤드의 프라이머리에서 DDL을 수행하면, 개발 팀은 `ReloadSchema`로 변경된 스키마를 Vitess에 반영합니다. 이어 `ValidateSchemaKeyspace`로 샤드 간 스키마가 일치하는지 검증하는 순서입니다.

## 문제가 생긴 MySQL을 찾는 모니터링 {#monitoring}

장애를 감지하고 복구하는 VTOrc는 토폴로지 서버와 VTTablet에서 데이터를 모아 문제를 파악합니다. 팀은 Prometheus로 VTOrc 지표를 수집하고, 문제가 생기면 이메일과 Slack으로 알람을 받습니다. 예를 들어 VTOrc를 16000 포트에서 실행했다면 해당 포트의 `/metrics`에서 지표를 수집할 수 있습니다.

어느 노드가 문제인지도 지표에 남습니다. `vtorc_detected_problems`의 `analysis`에는 문제 종류가, `keyspace`와 `shard`에는 발생 위치가 기록됩니다. VTTablet의 고유한 값인 `tablet_alias`를 확인하면 연결된 MySQL 노드까지 식별할 수 있습니다. 복구 내역은 `vtorc_recoveries_count`나 웹 페이지의 `/debug/status`에서 확인합니다.

VTGate와 VTTablet 지표도 `/metrics`에서 수집합니다. VTGate에는 `vtgate_api_count`, `vtgate_api_error_counts`가 있고, VTTablet에는 `vttablet_queries_count`, `vttablet_errors` 등이 있습니다. 이런 지표는 서비스 성격에 맞는 Grafana 대시보드와 알람을 구성하는 데 사용합니다.

로그는 별도로 모읍니다. 각 프로그램이 `--log_dir`에 남기는 레벨별 로그 파일을 Vector로 전송하며, 수집 범위는 `INFO` 이상입니다. 그중 `ERROR`나 `FATAL` 로그가 들어오면 알람을 받습니다.

MySQL과 인프라, 프로세스의 응답도 함께 확인합니다. MySQL 다운이나 일정 시간 이상의 복제 지연은 DBA 조직과 개발 팀 모두에게 알리고, CPU·메모리·디스크 등 인프라 자원에도 모니터링과 알람을 적용합니다. 자체 헬스 체크는 VTGate·VTTablet·vtctld의 `/debug/status`, etcd의 `/version`으로 GET 요청을 보내 200 응답을 확인하는 방식입니다.

## 프라이머리 다운 뒤 작동한 VTOrc {#failover-test}

프라이머리 노드의 MySQL 프로세스를 종료하자 애플리케이션에 장애가 발생했습니다. VTOrc는 헬스 체크로 `DeadPrimary`를 감지하고, `EmergencyReparentShard`로 새 프라이머리를 승격했습니다. 이 테스트에서 애플리케이션 장애가 해소되기까지 걸린 시간은 10초 내외였습니다.

VTTablet 프로세스가 다운됐을 때의 결과는 달랐습니다. VTOrc가 `InvalidPrimary`, `ConnectedToWrongPrimary`를 감지했지만 페일오버는 수행하지 않았습니다. 이 경우에는 직접 문제를 해결해야 합니다.

### 이전 프라이머리에 남아 있던 PRIMARY 설정 {#errant-gtid}

새 프라이머리를 승격했다고 테스트가 끝난 것은 아니었습니다. 종료했던 MySQL을 다시 띄우자 VTOrc에서 `ErrantGTIDDetected` 오류가 발생했습니다.

GTID는 트랜잭션마다 부여하는 고유 식별자입니다. 레플리카에 프라이머리에서 복제되지 않은 트랜잭션이 생기면, 그 트랜잭션의 GTID는 프라이머리에 존재하지 않습니다. 이를 잘못된 GTID, 즉 errant GTID라고 부릅니다. 주로 복제가 활성화된 상태에서 레플리카에 직접 DML을 수행할 때 발생합니다.

이번 테스트에서 문제가 된 것은 기존 프라이머리의 VTTablet 설정이었습니다. MySQL을 종료해도 VTTablet의 `tabletType`은 `PRIMARY`로 남아 있었습니다. 팀은 MySQL을 다시 구동하기 전에 기존 VTTablet을 종료하고, MySQL을 구동한 뒤에는 `tabletType`을 `REPLICA`나 `RDONLY`로 바꿔 VTTablet을 실행했습니다. 이 순서로 재기동하자 문제가 발생하지 않았습니다.

이미 잘못된 GTID가 생겼다면 백업 복구를 거칩니다. 먼저 `DeleteTablets`로 문제가 발생한 노드의 VTTablet을 제거하며, 대상의 `tabletType`은 `REPLICA` 또는 `RDONLY`입니다. 이 명령이 삭제하는 것은 중앙 저장소에 있는 태블릿 메타데이터입니다. 제거 여부는 VTAdmin이나 vtctldclient의 `GetTablets`로 확인합니다.

그다음 VTTablet 프로세스를 종료하고 MySQL의 복제 설정을 제거합니다. GTID 문제가 생기기 전의 최신 백업으로 MySQL을 복구한 뒤 VTTablet을 다시 띄우면 복제를 재개합니다.

### 프라이머리 교체 동안 대기하는 애플리케이션 {#buffering}

장애가 없어도 프라이머리를 바꿀 때 순단이 발생합니다. MySQL 장비 점검을 위해 `PlannedReparentShard`로 레플리카를 프라이머리로 승격하는 작업이 그런 경우입니다. 이때도 애플리케이션에서 일시적인 에러가 발생합니다.

VTGate의 버퍼링 기능은 `EmergencyReparentShard`와 `PlannedReparentShard` 수행 중 애플리케이션에 미치는 장애 영향을 줄일 수 있습니다. 기다리는 동안의 자원 사용은 따로 고려해야 합니다. 버퍼링으로 애플리케이션 스레드를 점유한 채 대기하면 서버 자원이 고갈될 수 있으므로, 적절한 타임아웃을 설정해 사용해야 합니다.

{{% details title="설정과 명령어 참고" closed="true" %}}

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
