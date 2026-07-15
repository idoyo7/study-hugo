---
title: "HyperDX의 MongoDB — 역할·부하 프로파일·운영"
weight: 6
---

# HyperDX의 MongoDB — 역할·부하 프로파일·운영

{{< callout type="info" >}}
**한눈에**
- MongoDB는 **전량 메타데이터**(대시보드·저장검색·사용자·알림)만 저장한다 — 로그·트레이스·RUM 세션 같은 관측 데이터는 전부 ClickHouse에 들어간다.
- 부하는 **적재량이 아니라 사용자·대시보드·알림 수에 비례**한다. 유일하게 시계열처럼 보이는 `alertHistory`도 30일 TTL 인덱스로 자동 소거된다.
- 배포 경로별 형태가 다르다: docker-compose는 기본 **무인증**(단 포트 비노출), Helm은 SCRAM 인증이 기본이지만 **기본값이 `members: 1`**(단일 멤버, HA 아님).
- 공식 운영 가이드는 사실상 한 문장뿐이라 **사이징·백업·HA는 자체 설계**가 필요하다.
- 무인증 상태로 포트를 노출했다가 스캐너에 데이터가 삭제된 **실사고 사례**가 있다 — 인증 + NetworkPolicy 격리가 필수다.
{{< /callout >}}

[HyperDX / ClickStack 심층 분석]({{< relref "01-hyperdx-deep-dive.md" >}})은 3 코어 컴포넌트(ClickHouse·HyperDX·OTel Collector)에 **메타데이터 저장용 MongoDB가 필수 의존성**으로 붙는다는 것을 아키텍처 레벨에서 짚었다. 이 페이지는 그 "필수 의존성 하나"를 파고들어 실무 질문 두 개에 답한다: ① MongoDB의 역할이 정확히 뭔가, ② 로그·트레이스·RUM 같은 관측 데이터를 장기간 대량으로 적재하면 MongoDB 부하도 같이 커지는가. 딥리서치 적대검증(3-vote)을 통과한 결과를 근거로 삼는다.

## MongoDB가 저장하는 것 — 전량 메타데이터

`packages/api/src/models` 아래 Mongoose 모델 디렉토리를 코드 레벨로 전수 확인하면, MongoDB에 있는 컬렉션은 전부 앱 상태/설정이다: `alert`, `alertHistory`, `connection`, `dashboard`, `favorite`, `pinnedFilter`, `presetDashboardFilter`, `savedSearch`, `source`, `team`, `teamInvite`, `user`, `webhook`. 이 중 관측 데이터의 "본문"처럼 보일 수 있는 `source.ts`도 실제로는 ClickHouse 테이블을 가리키는 쿼리/표현식 설정(serviceNameExpression, bodyExpression, timestampValueExpression, metricTables 매핑 등)일 뿐 이벤트 데이터 자체가 아니다 `✓`.

로그·트레이스·메트릭·RUM 세션 리플레이 등 관측 데이터는 전부 ClickHouse의 "wide events" 테이블(`otel_logs`, `otel_traces`, `otel_metrics_*`, `hyperdx_sessions`)에 들어간다 `✓`. 세션 리플레이 스키마는 [HyperDX 심층 분석의 신호별 테이블 스키마 절]({{< relref "01-hyperdx-deep-dive.md" >}})에서 이미 다룬 `hyperdx_sessions`와 동일하다. "MongoDB에 세션 리코딩이나 메트릭 집계가 저장된다"는 일부 벤더 블로그 주장은 이번 딥리서치 검증에서 근거 없음으로 기각됐다 — 실제 모델 목록에 세션/리플레이/메트릭 데이터포인트 스키마가 존재하지 않는다 `✓`.

## 핵심 답 — 부하는 데이터량이 아니라 사용자·설정 수에 비례

MongoDB 데이터량·부하는 로그/트레이스/RUM **적재량이나 보관 기간이 아니라 사용자·대시보드·알림 같은 앱 오브젝트 수에 비례**한다 `✓`. 유일하게 시계열처럼 보이는 컬렉션은 alertHistory(주기적 `checkAlerts` 태스크가 씀)인데, 여기엔 30일 TTL 인덱스가 걸려 있어 자동 소거된다. `alertHistory.ts`에 다음이 그대로 있다.

```
AlertHistorySchema.index({ createdAt: 1 }, { expireAfterSeconds: ms('30d') / 1000 })
```

MongoDB의 백그라운드 TTL 모니터(~60초 주기)가 이 인덱스를 근거로 만료 문서를 계속 지우므로, alertHistory는 컬렉션 나이와 무관하게 (알럿 수 × 평가 빈도)의 30일 롤링 윈도우 이상으로는 절대 쌓이지 않는다 `✓`. 저장 내용도 원시 이벤트가 아니라 집계된 평가 메타데이터(state, counts, lastValues, group, fired)뿐이다 `✓`.

결론: **로그·트레이스·RUM을 수년간 적재해도 MongoDB는 커지지 않는다.** 커지는 건 ClickHouse뿐이다. 다만 알럿을 수백 개 등록하고 평가 주기를 짧게 잡으면 alertHistory 쓰기 부하는 그 알럿 수·빈도에 비례해 늘어난다 `≈`.

## 배포 경로별 MongoDB 형태

[HyperDX 심층 분석의 배포 6모드]({{< relref "01-hyperdx-deep-dive.md" >}})와 정합적으로, MongoDB의 실제 형태는 배포 경로마다 다르다.

- **docker-compose**: `mongo:5.0.32-focal` 컨테이너가 **무인증**으로 뜬다 — `db` 서비스에 환경변수 블록 자체가 없고, 앱은 credential-free URI(`mongodb://db:27017/hyperdx`)로 접속한다 `✓`. 다만 호스트 포트 27017은 **기본적으로 노출되지 않는다** — `ports` 매핑이 주석 처리돼 있어 내부 docker 네트워크 전용이다. 위험은 사용자가 그 주석을 의도적으로 해제할 때만 발생하며, compose 파일 자체에 "포트를 열면 강한 인증·방화벽 규칙 없이는 무단 접근 위험이 있다"는 경고가 인라인으로 박혀 있다 `✓`. "docker-compose가 기본으로 MongoDB 포트를 노출한다"는 통념은 이번 검증에서 기각됐다.
- **Helm (Kubernetes)**: MongoDB Community Operator(MCK)가 `MongoDBCommunity` CR(`type: ReplicaSet`)로 관리한다. SCRAM 인증이 기본 활성화돼 있고, `hyperdx` 전용 앱 유저가 `hyperdx` DB에 dbOwner, `admin` DB에 clusterMonitor 권한을 갖는다 `✓`. 다만 **기본값은 `members: 1`** — 즉 단일 멤버 ReplicaSet이며, 진짜 HA(멀티노드)를 얻으려면 `mongodb.spec.members`를 수동으로 3 이상으로 올려야 한다 `✓`. "Helm 차트 기본이 이미 multi-node HA replica set"이라는 주장은 이번 검증에서 3-vote 전원 기각됐다 — 반대로 인용하면 안 된다. 기본 비밀번호(`hyperdx`)도 그대로 쓰면 안 되는 placeholder다 `✓`.
- **HyperDX-only / BYO 모드**: ClickHouse는 자체 운영하고 HyperDX만 얹는 경로에서도 MongoDB는 여전히 필수다 — `MONGO_URI`로 외부 MongoDB 인스턴스를 직접 공급해야 하며, `docker run -e MONGO_URI=...` 형태로 기동한다 `✓`. [심층 분석의 BYO 절]({{< relref "01-hyperdx-deep-dive.md" >}})에서 짚었듯 "CH만 자체 운영하면 메타스토어가 사라진다"는 오해는 성립하지 않는다.

## 공식 운영 가이드의 공백

ClickStack 공식 `/production` 페이지의 MongoDB 관련 지침은 사실상 한 문장뿐이다 — "MongoDB의 공식 보안 체크리스트를 따르라"는 링크 하나이고, 그 외엔 "ClickHouse 8123이나 MongoDB 27017 같은 내부 포트 노출을 피하라"는 한 줄 네트워크 주의뿐이다 `✓`. 사이징(`vCPU`/스토리지)·TTL 가이드는 전부 ClickHouse 얘기이고 MongoDB 사이징·HA·백업 권고는 부재하다 `✓`.

따라서 MongoDB 사이징·백업 설계는 자체적으로 해야 한다. 위 부하 프로파일(메타데이터 전용, alertHistory 30일 TTL)을 고려하면 데이터셋 자체는 수 GB 미만의 소용량일 가능성이 높고 `≈`, `mongodump` 기반 정기 백업 정도면 충분할 것으로 보인다 `≈`. 다만 백업이 없다면 유실 시 사용자·팀·대시보드·알럿을 처음부터 재구성해야 하는 비용이 발생한다.

셀프호스터 일화 하나는 참고 수준으로 덧붙인다: 한 자체 호스팅 사용자가 CPU 2코어·메모리 4GB짜리 저사양 서버로도 트래픽을 감당했다고 보고했지만, 이는 스택 전체(ClickHouse 포함) 사이징 일화이지 MongoDB 단독 사이징 근거는 아니다 `≈`. 같은 사용자는 프로덕션 배포 전 `EXPRESS_SESSION_SECRET` 환경변수를 랜덤 문자열로 설정해야 한다는 공식 안내도 언급한다 — MongoDB와 직접 관련은 없지만 같은 "기본값을 그대로 쓰면 안 되는" 운영 체크리스트 항목이다 `≈`.

## 보안 — 무인증 노출 실사고

{{< callout type="warning" >}}
docker-compose 기본값(무인증, 포트 비노출)에서 사용자가 포트를 열면 실제로 사고가 난다. 한 셀프호스터가 자신의 MongoDB 포트를 인터넷에 노출한 채 운영하다가, 자동화된 스캐너가 몇 시간 간격으로 반복 접속해 데이터를 삭제하는 실사고를 문서화했다. 유실된 것은 사용자·팀 정보였고 로그·트레이스 같은 관측 데이터는 아니었다 — 이는 위에서 확인한 "MongoDB=메타데이터 전용" 구조를 실사고 사례로도 뒷받침한다 `✓⁽단일 1인칭 블로그⁾`. 해당 사용자는 HyperDX 팀 권고에 따라 포트를 다시 막는 방식으로 대응했다.
{{< /callout >}}

근거 등급은 medium으로 잡는다 — 통계적 집계가 아니라 단일 1인칭 사례이기 때문이다. 다만 "무인증 기본값 + 포트 노출 시 위험"이라는 구조 자체는 코드로 확인된 사실이므로, 권고는 명확하다: 인증을 반드시 켜고 [심층 분석에서 이미 짚은 NetworkPolicy 격리]({{< relref "01-hyperdx-deep-dive.md" >}})와 묶어서 MongoDB를 운영한다.

## 우리 케이스에서는

장기 적재 관점에서 MongoDB는 **용량 계획(capacity planning) 대상이 아니라 가용성·백업 대상**이다 — 데이터가 쌓여서 문제가 되는 축이 아니라, 인증 없이 노출되거나 단일 인스턴스가 죽었을 때 팀·대시보드·알럿 설정을 통째로 잃는 축이다. Helm 경로를 쓴다면 기본값 `members: 1`을 그대로 두지 말고 `members: 3`으로 올리거나, 외부 관리형 MongoDB(Atlas 등)를 붙이는 쪽을 검토한다 `≈`. BYO/HyperDX-only 경로를 택해도 이 메타스토어 자체는 사라지지 않으므로, ClickHouse 운영 계획과 별도로 MongoDB 인증·백업·(필요 시) HA를 팀 룰로 못박아야 한다. 시점 기준 2026-07.
