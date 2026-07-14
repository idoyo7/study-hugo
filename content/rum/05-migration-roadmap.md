---
title: "마이그레이션 로드맵"
weight: 5
---

# 마이그레이션 로드맵 — Datadog 이관 실행 계획

RUM/Datadog 탈출을 **rip-and-replace가 아니라 dual-write/dual-instrument → 병행 검증 → 단계적 컷오버**로 끌고 가는 실행 계획이다. 앞선 페이지들의 판정([HyperDX 심층]({{< relref "01-hyperdx-deep-dive.md" >}}), [Datadog RUM 커버리지]({{< relref "02-datadog-rum-coverage.md" >}}), [프록시 매핑]({{< relref "03-dd-proxy-mapping.md" >}}), [대체 매트릭스]({{< relref "04-datadog-replacement-matrix.md" >}}))을 스프린트 단위 액션으로 접는다. ClickHouse 배포·스토리지·operator 상세는 [ClickHouse 자체 운영]({{< relref "../clickhouse/_index.md" >}}) 챕터로 위임하고, 이 페이지는 RUM/Datadog 이관 실행에 집중한다.

## Executive 판정 (6줄)

- **프록시는 브릿지일 뿐이다.** OTel Collector `datadogreceiver`는 Datadog Agent intake(로그·인프라 메트릭·APM 트레이스)만 수신하고 **브라우저 RUM·세션 리플레이 intake는 수신 대상 자체가 아니다** `[확인됨]`. 프록시는 서버사이드 신호의 단기 무중단 다리로만 쓴다.
- **RUM은 SDK 교체가 정답이다.** dd browser-sdk를 걷어내고 `@hyperdx/browser`로 교체한다. dd browser-sdk의 `proxy` 옵션은 변환용이 아니라 과도기 트래픽 통제용으로만 활용한다.
- **ClickHouse는 self-host + Altinity operator로 간다.** i8g 로컬 NVMe + ReplicatedMergeTree가 기본형이다(상세는 clickhouse 챕터). SharedMergeTree는 Cloud 전용이라 self-host에서 재현 불가 `[확인됨]`.
- **메트릭 계층은 HyperDX로 몰지 않는다.** 메트릭·대시보드·모니터·SLO는 `VictoriaMetrics + Grafana + Sloth/Pyrra`로 분리 존치하고, Grafana가 ClickHouse도 조회해 단일 UI로 봉합한다.
- **최대 리스크는 OSS 접근통제 공백이다.** OSS HyperDX는 SSO/RBAC/멀티테넌시/감사로그가 전무하며 RBAC는 Managed(ClickHouse Cloud) 전용으로만 GA됐다 `[확인됨]`. "앱 레벨 RBAC/SSO"와 "self-hosted EKS/NVMe"는 동시에 가질 수 없다.
- **전례가 없으므로 PoC를 진입 게이트로 삼는다.** RUM 대체는 공개 프로덕션 전례가 없는 개척 경로다 `[미확인]`. 자체 PoC 성공을 Wave 1 컷오버의 필수 통과 조건으로 명문화한다.

## 리스크 Top 5

| # | 리스크 | 영향 | 완화책 |
|---|---|---|---|
| **R1** | **OSS 접근통제 공백** — SSO/RBAC/멀티테넌시/감사로그 전무, RBAC는 Cloud 전용 GA `[확인됨]`. "앱 레벨 RBAC/SSO"와 "self-hosted"는 동시 불가 | 다수 팀 롤아웃 시 Datadog 대비 거버넌스 후퇴 | 단계적 하이브리드 — ① oauth2-proxy 경계 SSO ② 팀별 HyperDX 인스턴스(공유 CH) + ClickHouse row policy ③ 규제/감사 필수 팀만 Managed ClickStack. **MongoDB 인증 + NetworkPolicy 필수**(무인증 노출 삭제 공격 이력) |
| **R2** | **RUM 대체 프로덕션 전례 부재** `[미확인]` — 기술 대등성은 높으나 검증된 전환 사례 없음. Datadog RUM→OTel/ClickHouse 인테이크 번역기의 공개 구현체·프로덕션 운영 사례도 2026-07 딥리서치 재검색(2회)에서 발견되지 않음 — 전량 자체 구축 전제 `[미확인]` | Wave 1 "리스크 낮음" 판정이 실제로는 위험 | PoC 성공을 Wave 1 진입 게이트로 필수화. dual-instrument로 CWV·에러·리플레이·프론트↔백엔드 트레이스 상관을 Datadog과 side-by-side 검증 후 컷오버 |
| **R3** | **변환 파이프라인 미성숙 + CPU 세금** — `datadogreceiver`(전 신호 alpha), `clickhouseexporter` traces/logs beta·metrics alpha. 변환 CPU가 native 대비 최대 ~200배 `[벤치]`, delta metric 30~70% 손실(#44907) `[확인됨]` | 프록시 영구 의존 시 손실·비용·회귀 | 프록시는 로그/메트릭의 단기 브릿지로만. traces는 OTel 재계측, RUM은 SDK 교체. dual-write 후 **속성 단위 diff 검증**. 규모 결정 전 자체 벤치마크 필수 |
| **R4** | **로컬 NVMe 노드 lifecycle** — 노드 소실/drain/업그레이드 시 데이터 재수화, Karpenter consolidation이 스토리지 지역성 무시하고 노드 제거 | 가용성·성능 저하, 최악의 경우 shard 장애 | replica ≥2 + anti-affinity(hostname) + PDB `maxUnavailable=1` + `do-not-disrupt` + On-Demand/SP(Spot 금지) + hot/cold tiering으로 노드당 데이터량 축소. 상세는 [clickhouse 챕터]({{< relref "../clickhouse/_index.md" >}}) |
| **R5** | **메트릭/대시보드/모니터 이관 비용** — HyperDX(ClickHouse SQL) 타겟 자동 변환기 부재, PromQL/Grafana 타겟에만 도구 존재 | HyperDX로 메트릭 강행 시 공수 2~4배 팽창 `[추정]` | 메트릭 계층을 VM+Grafana+Sloth/Pyrra로 분리. AST 쿼리 변환기(→PromQL)·graang(대시보드)·무계측 dual-ship 활용. 이관 전 rationalization으로 자산 40~60% 감축 |

## 2주 스프린트 체크리스트

> 각 스프린트 종료 시 dual-write/dual-instrument 병행 검증 결과를 근거로 다음 스프린트 진입을 결정한다. 게이트를 통과하지 못하면 다음 Wave로 넘어가지 않는다.

### Sprint 1 (Wk 1-2) — 기반 구축 + 자산 인벤토리
- [ ] ClickHouse 스테이징 구성(Altinity operator, i8g 단일 shard×2 replica, 로컬 NVMe RAID0, Keeper 3노드/gp3) — 구성 상세는 [clickhouse 챕터]({{< relref "../clickhouse/_index.md" >}})
- [ ] `clickhouse-backup` → S3 파이프라인 검증(주간 full + 일간 incremental)
- [ ] Datadog dashboard/monitor/SLO 전량 export(Terraform/API) → **rationalization**(죽은 메트릭·미사용 자산 40~60% 폐기)
- [ ] MongoDB 인증 + NetworkPolicy 격리 구성(무인증 노출 방지)
- [ ] **게이트**: 스테이징 CH 쿼리 가능 + backup restore drill 1회 성공 + 자산 인벤토리 확정

### Sprint 2 (Wk 3-4) — RUM PoC (Wave 1 진입 게이트)
- [ ] 대표 웹 페이지에 `@hyperdx/browser` dual-instrument 배포(dd browser-sdk와 병행)
- [ ] 세션 리플레이·CWV·에러·프론트↔백엔드 트레이스 상관을 Datadog과 side-by-side 검증
- [ ] oauth2-proxy 경계 SSO + HyperDX only 모드로 스테이징 CH 연결
- [ ] **게이트**: PoC 성공 확인 → Wave 1 컷오버 승인. **실패 시 RUM 이관 보류**(전례 부재 리스크 R2가 현실화한 것이므로 강행 금지)

### Sprint 3 (Wk 5-6) — 로그 이관(Wave 2) + RUM-Core 웹 컷오버
- [ ] Vector `datadog_agent` → `clickhouse` sink 또는 OTel Collector로 로그 dual-ship
- [ ] HyperDX에서 로그 검색/알림 검증, TTL/tiering(hot NVMe → cold S3) 구성
- [ ] RUM-Core 웹 컷오버 시작, 좌절 신호를 ClickHouse SQL 룰로 구현(rage=1초 내 동일요소 3+클릭, dead=클릭 후 무반응, error=클릭±에러)
- [ ] **게이트**: 로그 검색 동등성 확인 + 웹 세션 비중 검증 → dd RUM **웹** 제거(모바일은 잔류)

### Sprint 4 (Wk 7-8) — 메트릭 계층 분리(Wave 4 준비)
- [ ] VictoriaMetrics 구성 + DD agent `DD_ADDITIONAL_ENDPOINTS`로 dual-ship
- [ ] 메트릭 이름 매핑표 + AST 쿼리 변환(→PromQL), graang로 대시보드 구조 변환
- [ ] Grafana에 ClickHouse datasource 연결(로그/트레이스 봉합), Sloth/Pyrra로 SLO 이식
- [ ] **게이트**: 병행조회 diff가 허용오차 내 → 메트릭 컷오버 계획 확정(HyperDX로 몰지 않음을 재확인)

### Sprint 5 (Wk 9-10) — APM 트레이스(Wave 3)
- [ ] 신규 서비스부터 OTel SDK 재계측(dd-trace는 OTLP 미방출 → 재계측 필요), 레거시는 `datadogreceiver` 브릿지
- [ ] 프록시 변환 CPU/손실률 벤치마크 측정 후 규모 결정(R3 완화)
- [ ] **게이트**: 속성 단위 diff 검증 통과 + 프록시 벤치가 수용 가능 → 트레이스 확대

### Sprint 6+ (Wk 11+) — 확장 롤아웃 + 잔여 트랙
- [ ] 팀별 HyperDX 인스턴스(허브-스포크) + ClickHouse row policy로 멀티테넌시 확보(3~15팀)
- [ ] 규제/감사 필수 팀은 Managed ClickStack 분리 검토
- [ ] 별도 트랙 — RUM-PA(PostHog/CH SQL), RUM-Mobile(OTel + Embrace/OpenReplay), Security/Synthetics/NPM/DBM/CI/On-Call 개별 이관
- [ ] 데이터 규모 20TB+ 도달 시 self-host 인스턴스 스케일(shard 추가), 1yr Savings Plan 적용
- [ ] **게이트**: 지속 롤아웃(단일 종료 게이트 없음), 각 잔여 트랙은 개별 PoC를 진입 조건으로 둔다

## 남은 오픈 퀘스천

- **dd 프록시 처리량/CPU/손실률 벤치마크** — 공개 부재, 자체 PoC로만 확정 가능 `[미확인]`(2026-07 딥리서치(소스 25·claim 60 검증)에서도 공개 실측치 미발견 — 전량 자체 벤치 전제).
- **감사로그 GA 시점·배포 형태**(OSS vs Cloud) — RBAC 선례상 Cloud 전용일 가능성 `[미확인]`.
- **HyperDX 쿼리 생성과 ClickHouse row policy 상호작용** — 집계/JOIN 시 정책 누수 여부 실증 필요 `[미확인]`.
- **AST 변환기 PromQL 출력이 VictoriaMetrics(MetricsQL)와 100% 호환**되는지 — PoC 필요 `[미확인]`.
- **Managed ClickStack RBAC가 "HyperDX only(BYO 자체 CH)"에 백포트될지** — 현재 근거상 아니오 `[미확인]`.
- (CH 배포 측 오픈 퀘스천 — 재수화 TB당 소요 시간, i7i 순차 대역 실측 등 — 은 [clickhouse 챕터]({{< relref "../clickhouse/_index.md" >}})에서 다룬다.)

## 우리 케이스에서는

**전제부터 다르다.** 이 로드맵은 조사 문서의 세 전제 — ① Datadog **RUM 대체**가 드라이버, ② ClickHouse를 관측성 외 **범용 분석**에도 쓸 예정, ③ 이미 **EKS·인프라 운영 인력 보유** — 위에서 그려진다. 반면 [로깅 챕터]({{< relref "../logging/08-recommendation.md" >}})의 결정은 **로그 내재화** 관점에서 나왔고 전제가 좁다. 두 문서는 모순이 아니라 적용 범위가 다르다.

따라서 로깅 챕터의 결정을 이 로드맵이 뒤집지 않는다:

- **로그는 VictoriaLogs다(D 결정 유지).** 위 Sprint 3의 "로그 이관"은 *Datadog에서 빠져나오는 신호를 어디로 보낼지*의 문제이지, 로깅 챕터가 고른 [VictoriaLogs]({{< relref "../logging/03-victorialogs.md" >}})를 ClickHouse로 갈아치우라는 뜻이 아니다. volatile한 istio access log 경로에는 여전히 단일 바이너리 VictoriaLogs가 더 가볍다.
- **통합 저장소(ClickHouse)는 earn-it-last다.** 이 로드맵이 CH self-host를 밀 수 있는 유일한 이유는 전제 ②·③ 때문이다 — CH가 **RUM/범용 분석 용도로 이미 정당화**되어 들어오는 경우에 한해, 관측성 데이터를 그 위에 얹는 것이 한계비용이 낮다. CH가 순수 로그 저장만을 위해 새로 도입되는 상황이라면 로깅 챕터의 "self-hosted CH를 1차 채택안으로 밀지 않는다"가 그대로 유효하다.
- **오너십이 최종 관문이다.** 우리는 PLG 방치 이력이 있는 소규모 플랫폼 팀이다. 전제 ③(전담 오너)이 **명시적 오너 + 런북 + 정기 리뷰**로 못 박히지 않으면, R1(접근통제 공백)·R4(NVMe lifecycle)가 그대로 폭탄이 된다. 그 경우 self-host CH 대신 Managed(ClickHouse Cloud / Altinity.Cloud) 견적과 반드시 비교하고, RUM은 웹 코어만 HyperDX로 떼어내되 나머지는 Datadog 잔류가 현실적이다.

**착수 전 필수 확인**(RUM 도메인 공통): Datadog RUM usage를 소스별(웹/모바일)로 분해해 모바일 비중부터 측정한다 — 모바일이 과반이면 웹 전용 HyperDX는 청구서를 별로 못 줄이면서 관리 스택(CH+MongoDB)만 늘린다. 도메인 큰 그림은 [RUM 내재화]({{< relref "_index.md" >}}) 참고.

> 근거 등급은 조사 문서의 판정을 승계한다. `[추정]`은 자릿수 추정, `[미확인]`은 공개 전례·검증 부재를 뜻한다. 조사 기준 2026-07.
