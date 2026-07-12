---
title: "우리 케이스 · 권장안"
weight: 8
---

# 우리 케이스 — "이거랑 저거만 있으면"

각 솔루션의 성격은 앞의 솔루션별 페이지(OpenSearch·Loki·VictoriaLogs·ClickHouse·HyperDX·StarRocks)에서 다뤘다 — 목록은 [챕터 개요]({{< relref "_index.md" >}}) 참고. 여기서는 그걸 우리 환경에 얹어 최소 조합·게이트·마이그레이션 순서로 정리한다.

발라내면 결론은 **수집 1개 + 저장 패밀리 1개 + Grafana**로 수렴한다. RUM/APM은 별도 트랙으로 분리해 판단한다.

```
[수집 — 전부 여기로 통일]
  OTel Collector 또는 Grafana Alloy (DaemonSet + gateway)
   ├─ 앱 로그        (filelog — fluent-bit 대체)
   ├─ istio 로그     (envoyOtelAls gRPC 직송, 파일 테일 아님)
   ├─ EC2 로그       (기존 fluent-bit 단계적 흡수)
   └─ 메트릭 스크레이프 (vmagent 역할 병합 가능)
          │  ← "collector as switch": 백엔드 전환은 여기서 dual-write로
          ▼
[저장]
  메트릭    VictoriaMetrics 클러스터        (현행 유지 + 400d 아카이브는 별도 챕터)
  로그      VictoriaLogs                    (istio부터 → 검증 후 앱 로그 hot)
  트레이스  Datadog APM 유지                → ClickStack/VictoriaTraces 후속 평가
  웹 RUM    ClickStack(HyperDX)             (usage 분해 결과 웹 우세일 때)
  모바일    Datadog RUM 유지                (셀프호스트 대안 성숙 전까지)
          ▼
[조회]  Grafana 단일 (victorialogs-datasource 공식 플러그인)
```

> 메트릭 계층의 400일 장기보관 설계는 [메트릭 400일 보관]({{< relref "../monitoring/longterm-retention/_index.md" >}}) 챕터에서 별도로 다룬다.

이 구조가 사실상 "2개"로 수렴하는 이유:

1. **수집기 하나**가 모든 소스를 커버하면서, 백엔드 전환기에는 dual-write 스위치 역할을 한다. 나중에 저장소를 바꿔도(exporter 한 줄) 앱은 건드리지 않는다.
2. **Victoria 패밀리**는 팀이 이미 검증한 운영 모델이라 학습·rot 비용이 0에 가깝다. 메트릭(VM)에서 쌓은 근육이 로그(VictoriaLogs)에 그대로 전이된다.

## 진짜 게이트는 기술이 아니라 인건비

숫자로 확인해야 할 불편한 진실: OpenSearch 인프라 절감은 vs RI **~$205K/yr**, vs 온디맨드 **~$365K/yr `[추정]`**로 크다. 그러나 셀프호스트 스택을 제대로 운영할 **platform SRE 1.5~2명의 fully-loaded 비용이 ~$330~440K/yr** `[추정]`로, **온디맨드 기준($365K)이면 거의 상쇄**되고 문서가 실제로 모델링한 **RI 기준($205K)이면 인건비가 절감을 오히려 초과**한다.

> **결론: 신호 하나만 내재화하면 수지가 안 맞는다.** logs + metrics + 웹 RUM 셋이 **같은 팀·같은 컬럼나 스토어를 나눠 물어야** 비로소 성립한다. 이것이 "여러 신호를 한 스택/한 팀에 수렴"시키는 통합 권고의 진짜 근거다. 그래서 D4(ClickHouse 통합)는 이 세 신호가 한곳에 모일 명분이 섰을 때 "earn it last"로 얹는다.

## 저후회(low-regret) 시퀀싱

| 시점 | 내용 | 성공 기준 |
|---|---|---|
| **Week 0 — 공짜 이득** | Envoy JSON 액세스 로그 켜기 · Datadog 7일 로그 중복 제거 · hot만 1yr RI · Datadog 갱신일/Order Form 확인 | 즉시 절감 + 의사결정 데이터 |
| **Week 2–8 — 키스톤** | **OTel Collector 스파인 구축.** 이후 모든 백엔드 결정이 exporter 한 줄로 수렴 | 모든 소스가 Collector 경유 |
| **Sprint — istio 부활 (D1)** | envoyOtelAls → Collector → VictoriaLogs. **오너 지정 + 런북 + 알림** | Grafana 조회 + 유실 알림 동작 |
| **Month 2–4 — dual-write (D2)** | Collector에서 OpenSearch + VictoriaLogs 동시 기록 → 검증 후 보존 90d→7d, UltraWarm 축소 | 실장애 2–4건을 새 스택으로 해결 |
| **Month 4–6 — OpenSearch 은퇴 (D2)** | UltraWarm 제거 → hot 축소·OR 이전 → 벌크 은퇴 (**여기서 $200–365K 실현**) | "옛 시스템 확인" 0건 |
| **Month 5–8 — RUM 트랙 (D3)** | 웹 → ClickStack PoC / 모바일 → Datadog 잔류, 갱신 협상 반영 | 갱신 전 서면 할인 유지 확보 |
| **Month 8+ — 선택적 통합 (D4)** | traces+RUM 통합이 우선순위가 되면 ClickHouse/ClickStack. **메트릭은 제외** | 통합 명분·오너 확보 시에만 |

**거버넌스(PLG 재발 방지)**: 스택별 명시적 오너 1인 + 런북 + "수집기는 분기별 업그레이드" 캘린더 + 수집 파이프라인 자체에 대한 알림(로그 유입량 급감 = 페이지).

## 한 줄 결론

> 로그 내재화의 축은 **OTel Collector(수집) + VictoriaLogs(저장) + Grafana(조회)**. 이미 VM을 잘 운영하고 있다면 이 조합이 학습 비용과 방치 리스크를 동시에 최소화한다. OpenSearch는 해체 전에 **tail 이전 + OR/RI in-place 최적화**로 먼저 다이어트하고, ClickHouse/HyperDX는 "여러 신호를 한 팀에 수렴"이라는 분명한 명분이 섰을 때 얹는 다음 챕터다. StarRocks는 S3 탄력성이 하드 요구인 별도 분석 플랫폼 mandate가 아닌 한 로그 숏리스트에서 빠지고, 모바일 RUM은 대안이 성숙할 때까지 Datadog에 남겨두는 것이 현실적이다.

## 하지 말 것 (검증에서 기각)

1. OpenSearch "전체 클러스터 40% RI 절감" 기대 — UltraWarm 예약 불가로 블렌디드 상한 ~25%.
2. 메트릭을 ClickHouse/StarRocks에 억지로 넣기 — 메트릭은 VM에.
3. StarRocks를 "완전 ephemeral"로 오해 — FE 쿼럼은 stateful(PV 필수).
4. VM/VictoriaLogs에 쿼리 가능한 S3 primary 티어 기대 — 미출시(로드맵 베팅 금지).
5. 신호 하나만 내재화하고 ROI 기대 — 인건비가 상쇄, 여러 신호를 한 팀에 수렴시켜야 성립.
6. HyperDX를 모바일 RUM 중계처로 — 모바일 세션 리플레이 SDK 없음(2026).
7. 새로 짓는 Loki를 **Simple Scalable(SSD) 모드**로 — Loki 4.0 전 제거 예정(single-binary/monolithic은 유지).

## 참고 — 근거 출처

이 챕터는 두 리서치 세트를 압축한 것이다(원본은 내부 리서치 저장소).

- **로깅/관측성 전략**: 4개 결정 프레이밍·인건비 게이트·저후회 로드맵, CH vs StarRocks 8축 매트릭스, OpenSearch RI·OR1/OR2 정정 모델, StarRocks 진단.
- **솔루션별 딥다이브 + 팩트체크**: Loki+Alloy / VictoriaLogs / HyperDX·ClickStack / ClickHouse on EKS / OpenSearch 비용 / RUM 대안군, 각 주장별 적대적 검증.
- **메트릭 장기보관**: [메트릭 400일 보관]({{< relref "../monitoring/longterm-retention/_index.md" >}}) 챕터(streamAggr vs Thanos downsampling).

> 주의: 비용 수치는 AWS 리스트가 기반 파생 추정이며 실 계약 할인·트래픽·RI 커밋으로 교정 필요(서울 리전은 +12~23% 추정). `[벤더]`는 자기보고 벤치라 회의적으로, `[벤치]`는 퍼블릭 벤치마크, `[추정]`은 자릿수 추정이다. GA 이력·라이선스는 2026-07 시점 기준.
