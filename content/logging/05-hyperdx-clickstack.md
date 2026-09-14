---
title: "HyperDX / ClickStack"
date: 2026-07-12
lastmod: 2026-08-24
weight: 5
---

# HyperDX / ClickStack으로 로그와 RUM을 함께 보기

HyperDX는 로그를 찾다가 같은 요청의 트레이스와 브라우저 세션 리플레이까지 이어 보는 데 유용합니다. ClickHouse를 저장소로 쓰고, HyperDX UI·API, 전용 OTel Collector, 앱 설정용 MongoDB를 함께 운영합니다. ClickHouse Inc.가 2025-03에 HyperDX를 인수한 뒤 2025-05에 이 조합을 ClickStack으로 출시했습니다.

로그 저장소만 고르는 경우와 웹 RUM까지 옮기는 경우에는 도입 비용을 다르게 봐야 합니다. 이 글은 로깅 관점의 평가이며, 플랫폼 구성과 접근통제는 [HyperDX 심층 분석]({{< relref "../rum/01-hyperdx-deep-dive.md" >}})에서 자세히 다룹니다.

## 세션에서 트레이스와 로그로 {#강점}

`@hyperdx/browser`는 rrweb 기반 리플레이, 에러, Web Vitals, 네트워크 요청을 수집합니다. 세션의 요청이나 에러에서 백엔드 트레이스로 이동하고 관련 로그를 찾을 수 있습니다. 웹 화면에서 발생한 문제와 서버 요청을 따로 검색하던 작업을 연결할 수 있다는 점이 도입 이유가 됩니다.

검색은 Lucene 스타일 문법과 ClickHouse SQL을 함께 지원합니다. 기존 ClickHouse에 HyperDX Only로 연결할 수도 있어, 이미 운영 중인 저장소와 수집 파이프라인을 활용할 수 있습니다. 저장 효율과 쿼리 성능은 [ClickHouse 자체의 평가]({{< relref "04-clickhouse.md" >}})를 참고하되, 벤더의 압축·검색 배수를 모든 schema에 적용하지는 않습니다.

트레이스 워터폴, Service Maps, Event Deltas도 조사한 기능에 포함됩니다. 다만 ClickHouse의 대규모 운영 사례를 곧바로 ClickStack 전체의 운영 사례로 셀 수는 없습니다. UI·수집기·MongoDB까지 묶은 구성의 부하와 장애 대응은 별도로 검증해야 합니다.

## 옮기기 전에 확인할 기능 {#약점--한계}

브라우저 리플레이 지원만으로 Datadog RUM 전체를 대체할 수는 없습니다. 조사한 표준 SDK에서 네이티브 iOS·Android·Flutter 리플레이는 지원되지 않았고, React Native SDK도 트레이스·에러·네트워크 수집 범위였습니다. 기존 녹화 포맷과 세션·trace ID 연결도 이관 시험 대상입니다. [Datadog RUM 커버리지]({{< relref "../rum/02-datadog-rum-coverage.md" >}})에서 비교합니다.

2026-09에 재검토한 결과, PromQL을 단순히 미지원이라고 쓰는 것은 맞지 않습니다. TimeSeries Engine 질의와 외부 Prometheus 호환 저장소 프록시가 실험적으로 제공됩니다. 기존 `otel_metrics_*` 테이블에 자동 적용되는 기능은 아니므로 메트릭 화면과 알림을 옮기려면 저장소·schema·쿼리를 대조해야 합니다.

알림에는 그룹별 발화, 평가 이력, SQL로 작성하는 통계 조건이 있고, Terraform으로 ClickStack 설정을 관리하는 Beta 경로도 있습니다. 이 기능들이 Datadog 모니터와 Alertmanager의 억제·유지보수 정책을 그대로 옮겨 주지는 않습니다. 세부 변경점과 공식 출처는 [2026-09 기능 재검토]({{< relref "../rum/08-datadog-coverage-2026-09.md" >}})에 정리했습니다.

## 추가되는 운영 작업

ClickHouse에서는 복제·merge·TTL·수집 배치를, MongoDB에서는 인증·백업·가용성을 관리해야 합니다. MongoDB에는 대시보드·사용자·알림 설정이 들어갑니다. 로그 보관량과 같은 비율로 커지는 저장소는 아니지만, 잃으면 앱 설정을 복원해야 합니다. [MongoDB 운영]({{< relref "../rum/07-hyperdx-mongodb.md" >}})에서 배포 경로별 기본값을 확인할 수 있습니다.

HyperDX UI·API는 MIT 라이선스입니다. 그러나 오픈소스 라이선스와 제품 기능 범위는 별개입니다. OSS의 SSO·RBAC 제약 때문에 여러 팀을 한 인스턴스에 넣을 수 있는지 먼저 판단해야 합니다. 초기 설치에서는 app/API URL, CORS, MongoDB 연결도 확인합니다.

<span id="우리-케이스에서는"></span>

## 로그만 옮길 때의 판단 {#적합--부적합}

우리 로깅 조사에서는 [VictoriaLogs]({{< relref "03-victorialogs.md" >}})를 우선 선택했습니다. 당시 로그 규모에서 ClickHouse와 MongoDB를 새로 운영할 만큼 웹 RUM 통합의 필요가 확인되지 않았기 때문입니다.

RUM까지 옮기려면 웹·모바일 사용량과 비용부터 분리해 봐야 합니다. 웹 리플레이가 필요한 비중이 크고 ClickHouse 운영을 맡을 수 있다면 ClickStack을 다시 검토할 수 있습니다. 실제 배포에는 자체 RUM 컨버터도 포함되므로 표준 SDK 지원표와 우리 수집 경로의 동작을 따로 확인해야 합니다. 그 배경은 [RUM 내재화]({{< relref "../rum/_index.md" >}})와 [우리 배포 형상]({{< relref "../hyperdx-operating/01-our-deployment.md" >}})에 있습니다.
