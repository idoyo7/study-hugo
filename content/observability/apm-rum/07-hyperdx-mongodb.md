---
title: "HyperDX의 MongoDB — 역할·부하 프로파일·운영"
date: 2026-07-15
lastmod: 2026-08-24
weight: 6
url: "/rum/07-hyperdx-mongodb/"
---

# HyperDX에서 MongoDB를 운영하는 이유

HyperDX는 로그·트레이스·메트릭·세션 리플레이를 ClickHouse에 저장합니다. MongoDB에는 사용자, 대시보드, 저장검색, 알림 같은 앱 설정이 들어갑니다. 그래서 ClickHouse의 보관 기간을 늘릴 때 MongoDB 용량도 같은 비율로 늘려 잡을 필요는 없습니다. 대신 설정을 잃었을 때 어떻게 복원할지 계획해야 합니다.

이 글은 2026-07에 확인한 HyperDX 모델과 배포 설정을 기준으로 합니다. 전체 스택의 연결 관계는 [HyperDX / ClickStack 분석]({{< relref "/observability/apm-rum/01-hyperdx-deep-dive.md" >}})에서 다룹니다.

## MongoDB에 저장되는 앱 설정 {#mongodb가-저장하는-것--전량-메타데이터}

조사 당시 `packages/api/src/models`의 Mongoose 모델은 `alert`, `alertHistory`, `connection`, `dashboard`, `favorite`, `pinnedFilter`, `presetDashboardFilter`, `savedSearch`, `source`, `team`, `teamInvite`, `user`, `webhook`이었습니다. 모두 앱 상태와 설정을 위한 컬렉션입니다 `✓`.

`source`도 이벤트 본문을 담는 모델은 아닙니다. ClickHouse 테이블의 `serviceNameExpression`, `bodyExpression`, `timestampValueExpression`, `metricTables` 같은 필드와 쿼리 설정을 저장합니다. 실제 이벤트는 `otel_logs`, `otel_traces`, `otel_metrics_*`, `hyperdx_sessions`에 들어갑니다 `✓`. 리플레이 schema는 [플랫폼 분석]({{< relref "/observability/apm-rum/01-hyperdx-deep-dive.md" >}})의 테이블 설명을 참고합니다.

## 알림 수와 평가 주기가 부하를 만든다 {#핵심-답--부하는-데이터량이-아니라-사용자설정-수에-비례}

대시보드·사용자·알림을 늘리면 MongoDB의 데이터와 접근량도 늘어납니다. 시간에 따라 계속 추가되는 컬렉션으로는 알림 평가 이력인 `alertHistory`가 있습니다. 상태, 건수, 마지막 값, 그룹, 발화 여부 등을 저장하며 원시 로그를 복사하지는 않습니다 `✓`.

`alertHistory.ts`에는 다음 30일 TTL 인덱스가 있습니다.

```
AlertHistorySchema.index({ createdAt: 1 }, { expireAfterSeconds: ms('30d') / 1000 })
```

TTL은 만료 시점의 즉시 삭제를 보장하지 않습니다. MongoDB가 백그라운드 작업으로 지우며 부하에 따라 지연될 수 있습니다. 따라서 “30일치 이상은 절대 쌓이지 않는다”는 용량 상한으로 쓰면 안 됩니다. [MongoDB TTL 문서](https://www.mongodb.com/docs/manual/core/index-ttl/)가 이 동작을 설명합니다.

로그 보관량보다 알림 수와 평가 빈도가 MongoDB 사이징에 더 직접적인 영향을 줍니다. 알림을 수백 개 등록하고 짧은 주기로 평가한다면 이력 쓰기와 TTL 삭제량을 함께 봐야 합니다. 메타데이터만 저장한다는 이유로 용량·부하 모니터링을 생략할 수는 없습니다.

## 배포 경로별 MongoDB 형태

### Docker Compose

조사한 Compose 구성은 `mongo:5.0.32-focal`을 무인증으로 띄우고, 앱은 `mongodb://db:27017/hyperdx`로 연결합니다. 호스트의 27017 포트 매핑은 주석 처리돼 있어 기본적으로 Docker 내부 네트워크에서만 접근합니다 `✓`.

무인증 상태에서 포트를 열면 접근 범위가 달라집니다. Compose 파일에도 인증과 방화벽 없이 포트를 노출하지 말라는 경고가 있습니다. 기본 설정이 외부 포트를 열지는 않지만, 실제 배포의 포트 매핑과 네트워크 접근은 별도로 확인해야 합니다.

### Kubernetes Helm

MongoDB Community Operator(MCK)가 `MongoDBCommunity` CR의 ReplicaSet을 관리합니다. 조사한 차트는 SCRAM 인증을 사용하며, `hyperdx` 사용자는 `hyperdx` DB의 `dbOwner`와 `admin` DB의 `clusterMonitor` 권한을 가집니다 `✓`.

기본 `members:1`은 단일 멤버입니다. ReplicaSet이라는 이름만으로 여러 노드의 HA 구성이 된 것은 아닙니다. prod에서는 `mongodb.spec.members`를 3 이상으로 구성할지, 외부 관리형 MongoDB를 쓸지 결정해야 합니다. 예제 비밀번호 `hyperdx`도 교체해야 합니다.

### HyperDX Only

기존 ClickHouse에 UI를 연결해도 MongoDB는 필요합니다. `MONGO_URI`로 앱 설정을 저장할 MongoDB를 제공해야 합니다. 이 모드의 의존성과 수집 책임은 [HyperDX Only 설명]({{< relref "/observability/apm-rum/01-hyperdx-deep-dive.md" >}})에 있습니다.

## 작게 시작해도 백업은 필요하다 {#공식-운영-가이드의-공백}

조사한 ClickStack production 문서는 MongoDB 보안 체크리스트와 내부 포트 노출 방지를 안내했지만, MongoDB의 CPU·스토리지·HA·백업 규모를 구체적으로 정하지는 않았습니다. ClickHouse 인제스트 기준 사이징을 MongoDB에 적용해서는 안 됩니다.

앱 설정 중심이라 작은 데이터셋으로 시작할 가능성은 있지만 `≈`, 사용자·대시보드·알림 이력을 측정해 정해야 합니다. `mongodump` 정기 백업은 후보가 될 수 있으며 허용 복구 시점과 복원 시간을 만족하는지 시험해야 합니다. MongoDB 데이터와 복원 가능한 백업을 모두 잃으면 사용자·팀·대시보드·알림 설정을 다시 만들어야 합니다.

2코어·4GB 서버로 운영했다는 셀프호스터의 기록은 ClickHouse를 포함한 전체 스택의 일화였습니다. MongoDB 단독 권장 사양으로 옮길 수는 없습니다. 같은 배포 준비에서 `EXPRESS_SESSION_SECRET`도 예제값 대신 무작위 값으로 설정합니다.

<span id="우리-케이스에서는"></span>

## 인증과 네트워크 접근 {#보안--무인증-노출-실사고}

MongoDB 포트를 무인증으로 인터넷에 노출했다가 자동 스캐너가 사용자·팀 정보를 반복 삭제한 셀프호스터 사례가 있습니다. 단일 사용자의 기록이므로 빈도나 전체 운영 위험을 추정하는 근거로는 부족하지만, 노출된 메타데이터 저장소에서 어떤 설정을 잃는지는 보여 줍니다.

MongoDB 인증과 NetworkPolicy를 적용하고, HyperDX에서 필요한 경로만 허용합니다. prod에서 단일 멤버 장애를 감수할 수 없다면 3멤버 구성이나 Atlas를 검토합니다. ClickHouse에 이벤트가 남아 있어도 HyperDX 설정을 복원해야 화면과 알림을 다시 사용할 수 있으므로, 두 저장소의 복원 절차를 함께 준비해야 합니다.
