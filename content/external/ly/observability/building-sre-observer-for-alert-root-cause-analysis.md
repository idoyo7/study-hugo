---
title: "SRE Observer의 Alert 근본 원인 자동 분석"
description: "LINE Plus Home SRE 팀이 Alert를 받으면 상관분석과 가설 주도 RCA를 수행해 Slack에 보고하는 SRE Observer를 만든 과정을 정리했습니다. 세 축 상관분석, 근거 기반 가드레일, 승인 경계로 자동화의 범위를 정한 설계를 다룹니다."
date: 2026-11-14
weight: 1
---

# SRE Observer의 Alert 근본 원인 자동 분석 (2026-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [장애 Alert의 원인을 스스로 찾다: SRE Observer 개발기](https://techblog.lycorp.co.jp/ko/building-sre-observer-for-alert-root-cause-analysis)
- 매체 · 게시일: LY Corporation Tech Blog · 2026-09-04
- 저자: 박상기, 강계돈 (LINE Plus Home SRE 팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 만든 이유 {#motivation}

새벽 3시에 장애 알림이 울리면 담당자는 알림 확인, 대시보드의 메트릭, 로그 플랫폼의 같은 시간대 에러, 트레이스, 필요하면 프로파일 순으로 원인을 좇습니다. 신호는 이미 각 도구에 있지만 화면이 흩어져 있어, 이를 하나의 흐름으로 엮고 원인을 판단하는 일은 사람의 몫이었습니다. 알림을 인지하고 도구를 오가며 신호를 잇는 최초의 몇 분을 줄이려고, Home SRE 팀은 초기 대응의 시작점부터 자동화하기로 했습니다. 목표는 "Alert를 수신하면 사람이 개입하기 전에 시스템이 먼저 상관분석을 수행하고, 근본 원인을 찾아 Slack에 보고까지 마친다"였습니다.

SRE Observer는 자체 관측성 스택(LGTM-P), Slack, Kubernetes 등의 데이터 소스를 바탕으로 LLM과 MCP를 써서 근본 원인을 분석합니다. 원문은 도입 결과로 초기 Alert 노이즈의 85~95%를 실시간 차단하고 평균 장애 식별 시간(MTTR)을 50% 줄였다고 밝힙니다.

문제는 세 가지였습니다. 업스트림 하나가 흔들리면 의존하는 다운스트림이 줄줄이 타임아웃을 내 하나의 원인이 수십 개의 알림으로 쪼개져 오고, 담당자는 같은 장애인지부터 판단해야 했습니다. 근본 원인 분석(RCA)은 메트릭, 로그, 트레이스, 프로파일을 사람이 각각 열어 이어야 했고, LGTM-P로 데이터를 모았어도 신호 연결은 사람의 머릿속에서만 일어났습니다. 그리고 기존 도구로는 원하는 제어권을 얻기 어려웠습니다. Alertmanager grouping은 정적인 라벨 일치에 의존해 의존 관계나 증상의 의미적 유사성으로는 묶지 못합니다. 상용 AIOps는 자체 호스팅 LGTM-P 스택, 사내 인증과 권한 체계, 고유의 심각도 정책과 대응 워크플로를 모두 반영하기 어려웠고, "어떤 근거가 있을 때만 원인을 확정할지", "어디까지 자동화하고 어디서 승인을 받을지" 같은 정책을 직접 통제할 필요가 있었습니다. 팀은 자동화 자체보다 LLM 에이전트의 동작을 운영 환경에 맞게 통제할 제어권이 중요하다고 결론 냈습니다.

## 처리 흐름 {#pipeline}

Alert 수신부터 지식 축적까지 하나의 파이프라인입니다. 구성 요소는 독립적으로 동작하되 Incident별 Alert, 분석 결과, 증거를 저장하는 Incident Context Store로 맥락을 공유합니다.

- Alert Ingestion: Mimir Alertmanager가 PromQL Rule(Mimir Ruler)과 LogQL Rule(Loki Ruler)을 평가해 이상 징후를 감지하고 웹훅으로 Alert를 보냅니다.
- Alert Correlation: Temporal, Topology, Semantic 세 축으로 채점해 Alert를 단일 Incident로 묶습니다.
- AI Analysis Agent: 가설 주도 RCA로 근본 원인과 영향 범위를 도출합니다.
- 위험도 판단: 근거 기반 가드레일을 적용한 AI 신뢰도로 P1~P4를 확정하거나 미확정으로 둡니다.
- 1차 대응: 승인 없이 즉시 실행합니다. 심각도에 따라 Slack 담당팀 멘션과 에스컬레이션을 자동 실행합니다.
- 2차 대응: Pod 재시작, 롤백처럼 시스템 상태를 바꾸는 작업을 승인(Approval Gate) 후 실행합니다.
- Post-Incident Knowledge: 확정된 P1 리포트를 사내 지식 베이스에 발행해 축적합니다.

## 세 축 상관분석 {#correlation}

Alert마다 Incident를 만들면 같은 장애가 여러 스레드로 찢어지고, 무조건 합치면 관계없는 장애가 섞입니다. 새 Alert 그룹이 오면 열려 있는 Incident 각각에 대해 세 축의 점수를 계산하고, 가중치대로 합산해 임계치 이상일 때만 기존 Incident에 병합합니다. 가중치 우선순위는 Semantic이 가장 높고(LLM의 증상 의미 유사도 판단), Topology가 다음(Tempo Trace 기반 서비스 의존 관계), Temporal이 가장 낮습니다(발생 시점의 근접성). 시간 근접만으로는 같은 장애로 단정하기 어렵기 때문입니다. 합산 점수가 임계치를 넘지 못하면 별개의 신규 Incident로 분리합니다.

한 축만 과신하지 않는 장치도 있습니다. LLM이 pair별로 돌려준 신뢰도가 기준에 못 미치면 그 Semantic 점수를 0점으로 낮춥니다. 서비스 의존 그래프가 없으면 Topology를 0점으로 두고 나머지로 판단하며, LLM 가중치도 0이고 그래프도 없으면 temporal-only fallback으로 동작합니다. fallback은 기능 실패가 아니라 쓸 수 없는 축을 빼고도 계속 동작하게 하는 안전장치입니다. Topology는 Tempo에서 서비스 간 통신 내역을 보고, Alert가 난 서비스 기준으로 업스트림과 다운스트림 연관 서비스를 찾아 점수를 매깁니다.

## 가설 주도 RCA {#rca}

상관분석으로 Incident가 확정되면 AI Analysis Agent가 RCA를 시작합니다. 도구 하나의 결과만 보고 성급히 결론짓지 않도록, Agent는 조사를 시작할 때 5개 원인 가설을 모두 열거해야 하고 검토 없는 결론은 금지됩니다. 가설은 `deployment_change`, `resource_exhaustion`, `external_dependency`, `code_bug`, `infra_platform`입니다. 각 가설은 직접 관측 신호로 충족하면 rule-in, 반박 신호가 있으면 rule-out으로 판단하고, 5개가 모두 rule-out이거나 cannot-verify이면 원인 미특정인 `other`를 씁니다. 초기 탐색은 증상에 맞는 도구를 먼저 조회합니다. 클러스터 이슈는 Kubernetes 도구를, CPU와 메모리 압박은 Pyroscope의 hot function을, 배포 후보는 `get_annotations`를, 지연과 타임아웃은 `query_prometheus`와 `tempo_traceql-search`를 씁니다. 첫 조회가 비어도 "데이터 없음"으로 단정하지 않고, 데이터 소스와 tenant마다 라벨과 필드가 다를 수 있어 다른 후보 소스를 다시 시도합니다. RCA는 증상이 어디서 비롯됐는지까지 설명하도록, 지연은 어느 다운스트림 호출이나 span인지, CPU는 어느 컨테이너와 함수인지, 오류는 어느 예외 클래스인지, 포화는 어떤 자원과 워크로드인지에 답하게 했습니다.

Agent가 도구를 호출할 때마다 `provider_category`, `tool_name`, `query_summary`, `observation_summary`, `raw_excerpt`를 Evidence Ledger에 기록하고, 최종 결론 때 이 Ledger로 근거를 다시 검증합니다. 근거가 없는데 LLM이 `code_bug`나 `external_dependency` 같은 구체적 원인을 말하면 앱이 `category`를 `other`로 낮춥니다. 무한 탐색은 Soft timeout(추가 수집을 멈추고 모은 근거로 결론 준비), Hard timeout(RCA 전체 실행 시간의 상한), Tool budget(도구 호출 횟수 상한)으로 막고, 값은 운영 중 조정하는 설정입니다.

## 위험도 판단과 가드레일 {#severity}

RCA가 끝나면 LLM이 `suggested_severity`(p1~p4)와 신뢰도를 제안하지만, 앱은 근거 기반 가드레일을 적용해 `chosen_confidence`를 산출합니다. 심각도 확정에는 세 조건이 모두 필요합니다. 가드레일이 개입한 강등 사유(`degrade_reason`)가 없을 것, Incident 자체가 확정 상태(`incident_confirmation`)일 것, 보정된 신뢰도가 확정 기준선 이상일 것입니다. 하나라도 어긋나면 심각도는 "추정" 상태로 남습니다.

가드레일은 분석 결과가 확보된 근거보다 높은 신뢰도를 갖지 못하게 합니다. 근거 없이 구체적 원인을 말하면 `category`를 `other`로 낮추고 신뢰도도 낮추며, `resource_exhaustion`인데 추세 쿼리나 재시작·OOM 확인이 없으면 신뢰도를 더 낮게 제한합니다. 신뢰도는 근거 수준에 따라 단계적으로 부여됩니다. 가장 높은 단계는 직접적이고 구체적인 근거가 있을 때만 허용하며 이 단계에서만 심각도를 확정합니다. 높은 단계는 원인이 증상과 구분되고 메트릭 외에 보강 신호가 하나 더 있어야 하고, 중간 단계는 기여 요인은 보이지만 근본 원인이 불확실한 경우, 낮은 단계는 증상 확인 수준이거나 근거가 부족한 경우입니다.

심각도는 추정에서 확정으로 승격할 수 있습니다. 미확정 상태에서 재분석이나 새 Alert 합류로 근거가 쌓이면 같은 P1이라도 확정으로 오르고, 한 번 확정되면 재분석해도 추정으로 돌아가거나 다른 등급으로 바뀌지 않습니다(latch).

## 동작 시나리오 {#scenarios}

원문은 서비스명을 일반화한 두 시나리오를 듭니다. 첫째는 service-a 배포 직후 의존하는 service-b, c, d에서 타임아웃 Alert가 쏟아진 경우입니다. 첫 Alert가 도착한 T+0에 신규 Incident가 생기고, T+1분에 도착한 service-c, d의 Alert는 Temporal 높음, Topology 중간 이상(Tempo trace에서 service-a를 공통 업스트림으로 공유), Semantic 높음으로 채점되어 임계치를 넘어 병합됩니다. T+2분에 하나의 Incident로 수렴하며 RCA가 시작되고, 5개 가설을 열거한 뒤 `get_annotations`로 service-a의 배포 annotation과 최근 commit을 확인해 `deployment_change`를 rule-in, 나머지는 반증 신호로 rule-out합니다. 근거가 명확하고 신뢰도가 기준선을 넘어 P1로 확정하고, Slack 스레드에 근본 원인과 영향 서비스, 롤백 권장 대응을 근거 링크와 함께 게시합니다. 담당자는 스레드를 열었을 때 이미 알림이 하나로 묶이고 원인과 대응안이 정리돼 있어 판단부터 시작합니다.

둘째는 service-e의 요청 지연 증가인데 로그가 아직 Loki에 수집되기 전이라 트레이스의 1~2초 타임아웃 span과 HTTP 500만 있던 경우입니다. 여러 가설이 대부분 cannot-verify로 남았고, LLM은 다운스트림 의존성 문제를 어느 정도 신뢰도로 제안했지만 `external_dependency`를 rule-in할 직접 근거가 부족해 가드레일이 `category`를 `other`로 낮추고 신뢰도도 낮췄습니다. 심각도는 확정되지 않고 추정으로 남았으며, Slack에는 확보한 근거(Tempo 트레이스)와 유력한 방향, 로그 근거가 없다는 점, 추가 근거가 필요하다는 점이 게시됐습니다. 로그가 수집되면 Re-analyze 버튼으로 근거를 보강해 확정으로 승격할 수 있습니다. 필자들은 "모른다"를 정직하게 말하는 것이 잘못된 확신만큼 중요하다고 말합니다.

## Slack 인터페이스와 승인 경계 {#slack-approval}

인터페이스는 Slack이고 Incident 하나가 스레드 하나입니다. 스레드는 Incident Created, Alert Group Joined(후속 Alert 그룹이 새 스레드 없이 답글로 합류), RCA Analyzing(가설 검증과 증거 수집 진행을 실시간 갱신), RCA Result(근본 원인, 영향 서비스, 신뢰도, 권장 대응) 순으로 진행됩니다.

자동 대응에서 중요한 질문은 자동으로 무엇까지 해도 되는가입니다. 승인 경계는 실제 Operation 실행에만 적용하고 RCA 결과를 Slack에 보고하는 것은 자동입니다. 1차 대응은 상태를 바꾸지 않는 알림과 에스컬레이션이고 심각도별로 달리 실행합니다. P1은 팀 멘션, 대응 채널 즉시 에스컬레이션, 티켓과 Runbook 링크를 제공하고, P2는 팀 멘션과 티켓·Runbook 링크(1시간 내 대응), P3는 티켓 생성(다음 근무일), P4 또는 P1 미확정은 스레드를 종료합니다. 2차 대응은 승인 후 실행하며 P1/P2에서는 Pod 재시작, 롤백, 스케일 조정, Alert Rule 임계치 조정이고 P3에서는 코드 수정 PR 자동 생성과 DB 쿼리 최적화 제안입니다. 사용자는 Close Incident(종료하면 더 이상 병합과 RCA가 없음)와 Re-analyze(근거가 부족하거나 새 데이터가 생겼을 때 RCA 재시도)를 쓸 수 있습니다. 포함된 Alert가 모두 Resolved면 Incident는 자동 종료되고, 해결됐는데도 Alert가 한동안 Firing으로 남을 것 같으면 노이즈 제거를 위해 수동 종료할 수 있습니다.

## 운영하며 배운 것과 계획 {#lessons-and-plans}

- 근거 없는 확신을 막아야 합니다. 자동 대응에서 가장 경계할 것은 LLM이 그럴듯하지만 근거 없는 원인을 단정하는 일이고, Evidence Ledger와 가드레일이 이를 줄입니다. 시스템이 근거 없이 단정하면 사람이 직접 대응할 때보다 더 위험할 수 있어 `other`로 말하는 능력이 설계 전체의 원칙입니다.
- 관측성 응답은 큽니다. 로그와 트레이스 조회 결과는 금세 수백 KB가 되어 컨텍스트 창을 채웁니다. 도구 결과 크기를 제한하고 잘렸다는 표시를 붙였으며, 최종 결론 입력은 메트릭 위반, 주요 트레이스, 의존성, 로그 유무를 담은 신호 요약으로 압축했습니다. 덕분에 Loki 로그가 드물어도 Prometheus와 Tempo 신호가 결론 입력에서 밀리지 않게 됐습니다.
- 데이터 소스와 라벨 차이가 복병입니다. 같은 서비스명도 Prometheus 계열은 `service_name`, Tempo는 `resource.service.name`을 쓰고, Loki는 에러 레벨이 로그 본문 JSON이 아니라 구조화된 메타데이터에 있기도 합니다. 그래서 여러 tenant를 순회하는 Mimir 조회, Loki tenant 라벨 주입, cAdvisor 라벨 기준 안내 같은 조회 관습을 RCA 프롬프트에 계속 반영했습니다.

앞으로는 error budget 소모 속도(Burn Rate)를 심각도 확정에 반영하는 정책, 승인 경계 안에서 제한적으로 동작하는 2차 대응 자동 조치의 안전한 확대, 확정된 P1 리포트를 사내 지식 베이스에 발행해 반복 장애 패턴을 축적하는 post-incident knowledge 강화를 확장할 계획입니다. 필자들은 SRE Observer가 Alertmanager에 챗봇을 붙인 도구가 아니라고 하며, 핵심은 얼마나 많이 자동화했느냐가 아니라 어디까지 자동화하고 어디서 사람의 판단과 승인을 받느냐였다고 정리합니다.
