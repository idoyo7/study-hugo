---
title: "03 관측 스택 일원화 — Vector와 HyperDX 컬렉터로 모으기"
date: 2026-10-04
lastmod: 2026-10-04
weight: 3
url: "/homelab/03-observability-consolidation/"
---

# 관측 스택 일원화 — 입구는 둘, 저장소는 둘로

9월 말의 hub에서는 로그 수집기 여러 개가 같은 파일을 읽고, 로그와 트레이스를 저장소 두 곳에 각각 쓰고 있었습니다. 비교를 위해 늘린 구성이 그대로 남아 수집·저장 경로를 중복 운영하던 상태였습니다. 일주일 남짓 이 경로를 정리해, 로그는 Vector로 모으고 앱·istio·AI CLI의 OTLP는 HyperDX(ClickStack) OTel 컬렉터로 받게 했습니다. 저장소는 로그·트레이스를 담는 ClickHouse(HyperDX)와 메트릭을 담는 VictoriaMetrics입니다.

otel-gateway, Tempo, fluent-bit, VictoriaLogs는 제거했습니다. 새로 추가한 경로는 HyperDX 컬렉터의 내부 OTLP 입구입니다. 클러스터 배치와 NAS는 [hub / edge 구조]({{< relref "/platform/homelab/01-hub-edge-architecture/index.md" >}})에, HyperDX 쪽 구성은 [우리 배포 형상]({{< relref "/observability/hyperdx/operations/01-our-deployment/index.md" >}})에 있습니다.

## 출발점

9월 27일 무렵의 hub는 같은 로그를 여러 벌 받고 있었습니다. 로그 수집기 셋(otel-agent, vector-agent, fluent-bit)이 같은 파일을 각자 읽었고, 텔레메트리 저장소는 넷(VictoriaLogs, ClickHouse, VictoriaMetrics, Tempo), 중간 홉은 하나였습니다. 아래 그림은 그중 otel-agent를 걷은 직후의 모습입니다.

{{< flow src="_flow/1-왜-모았나.json" />}}

중복 수집을 없애면서 OTel 계열 컴포넌트도 줄이려 했지만 OTLP 수신 자체는 남겨야 했습니다. [개발환경]({{< relref "/platform/homelab/02-dev-workspace/index.md" >}})의 code-server 안에서 쓰는 Claude Code와 Codex CLI는 메트릭을 OTLP로 보내며, vmagent로는 이 메트릭을 가져올 수 없습니다. gateway와 Tempo를 제거하기 전 클러스터와 차트를 읽기 전용으로 검토하니, 이를 HyperDX 컬렉터로 옮길 때의 제약도 있었습니다. 컬렉터 설정을 HyperDX 앱이 원격으로 내려주고, 그 이미지에는 delta 메트릭을 cumulative로 바꾸는 프로세서가 없었습니다.

## 계층별 결정

표의 '써 본 것'은 hub에서 돌린 구성이고, '검토'라고 적은 안은 돌리지 않고 따져 보기만 했습니다.

| 계층 | 써 본 것·검토한 것 | 최종 선택 | 선택 근거 |
|---|---|---|---|
| 로그 수집기 | otel-agent, fluent-bit, vector-agent | vector-agent → aggregator | 셋이 같은 로그를 따로 읽어 중복으로 쌓였다. 나란히 돌린 비교에서 Vector 경로가 낫다고 판단했고, fluent-bit은 24시간 비교에서 수집량이 거의 같고 누락이 없음을 확인한 뒤 걷었다 |
| 로그 저장소 | VictoriaLogs, HyperDX의 ClickHouse (조사 단계 후보는 [로깅 연재 권장안]({{< relref "/observability/logs/comparison/08-recommendation.md" >}})) | ClickHouse | 트레이스와 RUM이 이미 ClickHouse에 있어 로그까지 두면 쿼리와 대시보드를 손볼 곳이 한 군데로 준다 |
| 트레이스 저장소 | Tempo, ClickHouse | ClickHouse | 같은 1시간 창에서 Tempo에만 있는 건 창 경계의 몇 건뿐이었고 Tempo는 5MB가 넘는 트레이스를 잘랐다 |
| OTLP 입구 | otel-gateway 유지(Tempo만 제거, 검토), hdx 컬렉터에 내부 입구 신설 | hdx 컬렉터 `/ingest` | 목표가 입구 둘이었고, deltatocumulative를 뺀 필요한 컴포넌트가 컬렉터 이미지에 이미 있었다 |
| OTLP 메트릭 경로 | gateway 경유 remote write(cumulative로 변환), VictoriaMetrics OTLP 직결(delta 그대로) | OTLP 직결 | 컬렉터 이미지에 deltatocumulative가 없고 카나리에서 이름과 시리즈 수가 같았다 |
| 대시보드 데이터소스 | VictoriaLogs·Tempo, ClickHouse | ClickHouse | 읽던 저장소가 없어지면 패널을 옮겨야 하고, RUM 대시보드가 이미 ClickHouse를 읽고 있었다 |

## 로그 수집기

처음에는 OTel Collector의 otel-agent DaemonSet이 노드의 파드 로그 파일을 읽어 Kubernetes 메타데이터를 붙인 뒤 VictoriaLogs와 HyperDX로 OTLP를 보냈습니다. Vector와 Fluent Bit를 비교하려고 vector-agent와 fluent-bit DaemonSet을 추가하면서 수집기가 셋이 됐습니다. 세 수집기가 같은 노드의 같은 파일을 읽어, 대부분의 로그가 VictoriaLogs에는 세 벌, HyperDX에는 두 벌 쌓였습니다. 병행 운영 결과 Vector 경로를 택해 otel-agent를 제거했고, 이후에는 Vector와 비교용 fluent-bit만 남았습니다.

Vector의 agent는 파싱 없이 로그를 aggregator(StatefulSet)로 넘깁니다. aggregator는 VRL `normalize` 한 곳에서 JSON·logfmt 파싱, severity 정규화, `service.name` 산정을 처리하고 디스크 버퍼를 거쳐 HyperDX로 보냅니다. Fluent Bit는 이 구성의 agent를 비교하려고 추가했습니다. Fluent Bit도 같은 aggregator로 보내게 했으므로, `/var/log/containers/*`를 읽는 두 DaemonSet의 로그가 동일한 `normalize`를 지나 HyperDX에 들어갔습니다. 1시간 수집량은 fluent-bit 경로가 100,082건, vector-agent 경로가 100,049건으로, 비교 기간에는 의도적으로 같은 양의 로그가 중복 적재됐습니다.

두 agent 모두 원문을 파싱하지 않고 넘기며 메모리 버퍼를 쓰도록 비교 조건을 맞췄습니다. aggregator가 죽으면 버퍼에 찬 만큼 유실될 수 있습니다. ack는 vector-agent의 Vector 자체 프로토콜과 Fluent Bit의 forward 프로토콜이 서로 다른 모델을 쓰므로 각자 기본값을 유지했습니다.

Fluent Bit를 연결할 때는 전송 형식도 맞춰야 했습니다. fluent-bit 5.1.2는 forward로 보낼 때 레코드를 메타데이터로 한 겹 감싸는 것이 기본값인데, Vector 0.58의 fluent 소스가 이 형식을 디코드하지 못해 이벤트를 전부 버렸습니다. `Retain_Metadata_In_Forward_Mode`를 꺼서 해결했습니다.

최종 선택은 24시간 수집량과 수집 대상을 대조한 뒤 내렸습니다. vector-agent는 2,399,840건, fluent-bit은 약 2,400,004건으로 수집량이 거의 같았습니다. 서비스 수는 vector-agent 77개, fluent-bit 61개였고 ServiceName으로 세면 fluent-bit에만 있는 서비스가 30개였습니다. 그러나 `(k8s.namespace.name, k8s.container.name)` 쌍으로 대조하면 양쪽 차이는 0개였습니다. 수집 대상 누락이 아니라 `service.name`을 정하는 방식의 차이였습니다. owner 정보가 없는 fluent-bit은 라벨과 컨테이너 이름을 쓰고, vector-agent는 Deployment·StatefulSet 같은 owner 이름을 씁니다.

| fluent-bit이 붙인 이름 | vector-agent가 붙인 이름 |
|---|---|
| grafana | victoria-metrics-grafana |
| clickhouse | chi-hdx-default-0-0 |
| hdx-mongodb-svc | hdx-mongodb |
| kube-apiserver | master1 |

비교가 끝나 vector-agent만 남겼습니다. 머지 직후 5분 동안 vector-agent 8,496건만 들어왔고 fluent-bit 행은 0이었습니다. 같은 로그가 두 번 들어오던 게 사라지면서 `otel_logs` 적재량도 대략 절반이 됐습니다. 이때 aggregator의 VRL에서 fluent-bit 분기와 그 입력을 쓰던 테스트를 같이 뺐습니다. aggregator 이미지가 distroless라 파드 안에서 `vector test`용 파일을 복사할 수 없었습니다(tar가 없습니다). 대신 머지 전에는 `vector vrl`로 테스트 7개를 재현해 확인했고 머지 뒤 새 파드에서 `vector test /etc/vector/vector.yaml`을 돌려 7/7 통과를 봤습니다.

aggregator의 opentelemetry 싱크는 beta라서 Vector 버전을 0.58.0에 고정해 두었습니다. 버전을 올리기 전에는 HyperDX로 보내는 이 싱크의 릴리스 노트를 확인해야 합니다.

## 로그 저장소

로깅 조사 연재에서는 [VictoriaLogs]({{< relref "/observability/logs/comparison/03-victorialogs.md" >}})를 골랐고 [HyperDX / ClickStack]({{< relref "/observability/logs/comparison/05-hyperdx-clickstack.md" >}})은 RUM까지 옮길 때의 선택지로 따졌습니다. 연재가 VictoriaLogs를 우선 고른 이유로 든 것은 당시 로그 규모에서 ClickHouse와 MongoDB를 새로 운영할 만큼 웹 RUM 통합의 필요가 확인되지 않았다는 점입니다. hub는 사정이 달랐습니다. 트레이스와 브라우저 세션(RUM)이 이미 HyperDX의 ClickHouse에 들어오고 있어서, ClickHouse와 MongoDB는 이미 운영하던 것이었습니다. 연재는 회사 환경을 조사한 글이라 OpenSearch나 Loki 같은 나머지 후보는 [권장안]({{< relref "/observability/logs/comparison/08-recommendation.md" >}})에 두고, 여기서는 hub에서 함께 돌린 둘만 견줍니다.

두 저장소는 같은 로그를 같은 양으로 받고 있었습니다. VictoriaLogs는 보존 7일에 시놀로지 NFS 10Gi였고, 9월 23일 커밋 이후로는 클러스터 전체 파드 로그가 양쪽에 다 들어갔습니다. 두 곳의 일별 건수는 0.1% 이내로 일치했습니다. 차이는 보존과 질의에 있었습니다. ClickHouse는 최근 7일을 node1의 local-path에, 90일까지는 SeaweedFS의 S3(cold)에 둡니다. VictoriaLogs는 연재를 쓸 때 쿼리할 수 있는 오브젝트 스토리지 티어가 없어서, 보존을 늘리려면 디스크를 그만큼 늘리는 방법뿐이었습니다. 질의 언어도 VictoriaLogs는 LogsQL이고 ClickHouse는 SQL입니다.

로그까지 ClickHouse에 두면 대시보드와 쿼리를 손볼 곳이 한 군데로 줄어듭니다. 로그 시스템을 둘로 계속 돌릴 이유는 없었습니다. 그래서 둘 중 HyperDX를 남기고 VictoriaLogs를 걷기로 했습니다. VictoriaLogs Application은 통째로 주석 처리했습니다. apps-root가 prune 모드라서 파일을 지우지 않아도 리소스가 0개로 읽혀 Application이 정리됩니다. 파일은 복원용으로 남겼습니다.

로그와 트레이스를 ClickHouse에 모으면서 node1 장애의 영향도 커졌습니다. ClickHouse는 replica 하나이고 hot 데이터는 node1의 local-path에 있으며, MongoDB와 hdx 컬렉터도 같은 노드에 있습니다. 사전 검토에서 디스크 여유는 충분했지만 node1의 메모리와 CPU requests를 병목으로 짚었습니다. 로그 적재가 늘어 이 여유가 줄면 저장소 배치를 다시 검토해야 합니다. VictoriaLogs를 제거한 뒤 기존 대시보드 패널이 빈 문제는 뒤의 대시보드 절에서 다룹니다. 복원할 때는 남겨 둔 Application 파일과 함께 aggregator의 VictoriaLogs 싱크, Grafana 데이터소스도 다시 활성화해야 합니다.

## 트레이스 저장소

트레이스는 두 저장소에 동시에 쓰고 있었습니다. 앱(OTel operator의 auto-instrumentation, `parentbased_traceidratio` 0.25)과 istio(메시 10%, ingressgateway 100%)가 monitoring 네임스페이스의 otel-gateway로 보내면 gateway가 Tempo(3.x, SeaweedFS의 S3 버킷)와 HyperDX에 나란히 썼습니다. gateway 설정 주석에 따르면 HyperDX로도 보내는 이유는 RUM과 백엔드 span을 한 화면에서 보려는 것이었고, Tempo는 그와 병행해서 유지했습니다. Grafana에서는 Tempo 데이터소스가 trace에서 메트릭과 로그로 넘어가는 연결(tracesToMetrics, tracesToLogs)을 맡았습니다.

둘이 같은 데이터인지부터 확인했습니다. 9월 27일 14시부터 한 시간(UTC)을 잡아 서비스별 span 수를 ClickHouse와 Tempo API에서 세어 봤습니다.

| 서비스 | ClickHouse span | Tempo 검색에서 잡힌 span |
|---|---:|---:|
| codex_exec | 157,610 | 24,075 |
| claude-code | 2,139 | 1,675 |
| kanna | 4,560 | 4,560 |
| study-hugo (RUM) | 70 | 0 |

Tempo는 트레이스 하나가 5MB(`max_bytes_per_trace` 기본값)를 넘으면 잘랐습니다. tempo-0 로그에는 `TRACE_TOO_LARGE`가 `max=5000000`, `totalSize=22665536`으로 찍혔습니다. 가장 큰 Codex 트레이스는 ClickHouse에 95,106 span이 있었지만 Tempo API로는 12,848 span까지만 나왔고, 다른 큰 트레이스도 51,092 대 12,648이었습니다. span 48개짜리 작은 트레이스는 양쪽이 같았습니다.

RUM은 수신 경로부터 달랐습니다. 브라우저의 span은 공개 VirtualService를 거쳐 hdx 컬렉터로 직접 들어가므로 Tempo를 지나지 않습니다. study-hugo의 span 70개(트레이스 31개)가 ClickHouse에만 있던 이유입니다. 나머지 서비스는 span 수까지 맞았습니다. 창 경계의 몇 건은 Tempo 검색이 트레이스 단위로 찾고 ClickHouse는 span 시각으로 자르면서 차이가 났습니다.

보존 기간도 달랐습니다. Tempo는 24시간이고 ClickHouse는 90일(최근 7일 hot, 나머지 83일 cold)입니다. 샘플링과 필터는 두 곳이 같았습니다. 둘 다 gateway의 traces 파이프라인 하나에서 갈라지고 거기에는 sampler도 filter도 없어서, 소스 쪽 샘플링(메시 10%, ingress 100%, SDK 25%)이 양쪽에 그대로 적용됩니다. 그러니 Tempo에 있는 데이터 가운데 ClickHouse에 없는 것은 없고, 반대로는 ClickHouse가 더 많습니다.

디스크 여유도 확인했습니다. 9월 27일 시점에 ClickHouse의 hot 디스크 사용량은 579MiB였고, 그 가운데 `otel_traces`가 161MiB(7일치, 하루 약 23MiB)였습니다. cold(S3)에는 `otel_traces`가 163MiB 있었습니다. PVC는 30Gi로 잡혀 있지만 local-path라서 쿼터 없이 node1의 파일시스템을 쓰고, 그 파일시스템은 465.9GiB 가운데 261.6GiB가 비어 있었습니다. ClickHouse는 이미 트레이스를 전부 받고 있으니 Tempo를 걷어도 적재량은 늘지 않습니다.

Tempo를 읽는 쪽도 세어 봤습니다. Grafana 데이터소스 하나, 대시보드의 패널과 데이터링크 여러 개, gateway의 exporter입니다. 데이터소스에 걸어 둔 serviceMap은 이미 죽어 있었습니다. VictoriaMetrics에 `traces_service_graph_*` 시리즈가 하나도 없었습니다. Tempo에만 있는 데이터가 없었고 트레이스 저장소를 둘로 이중 운영할 이유도 없어서, 트레이스도 ClickHouse 하나로 모으기로 했습니다.

Tempo 데이터소스를 없애면서 trace에서 메트릭·로그로 넘어가던 연결도 사라졌습니다. 사전 검토에서는 ClickHouse 플러그인의 trace 보기가 이를 일부 대신하고, 로그는 HyperDX의 `otel_logs`에서 조회하는 것으로 정했습니다. Grafana의 Tempo 트레이스 패널은 ClickHouse-HyperDX 데이터소스로 바꿨습니다.

리소스 삭제는 파드 종료까지 기다려야 했습니다. apps-root가 tempo Application을 prune하면 resources-finalizer가 하위 리소스를 지우고, StatefulSet의 foregroundDeletion은 파드가 끝날 때까지 기다립니다. 삭제를 시작한 지 30초 뒤에는 StatefulSet이 아직 남아 있었습니다. 이후 정리 단계에는 Tempo StatefulSet이나 gateway Deployment가 남아 있으면 멈추는 확인을 넣었습니다.

Tempo를 제거해도 `monitoring/tempo-s3-secret`은 아직 지울 수 없습니다. HyperDX의 S3 자격증명(`hdx-s3-secret`)과 rum-loader가 이 값을 재사용하기 때문입니다. HyperDX 전용 S3 identity로 분리할 계획입니다. Tempo를 복원하려면 `hub/apps/tempo.yaml`의 주석을 풀고, 같은 변경에서 지운 gateway 매니페스트를 git revert로 되돌리면 됩니다.

## OTLP 입구

otel-gateway는 monitoring 네임스페이스에서 OpenTelemetry operator가 관리하는 Collector CR(collector-contrib 0.159.0, replica 1)이었습니다. 앱·istio·AI CLI가 보내는 OTLP를 받아 트레이스는 Tempo와 HyperDX에 쓰고, span_metrics 커넥터가 트레이스에서 만든 `traces.spanmetrics`와 OTLP 메트릭은 VictoriaMetrics로 보냈습니다. 이 입구를 두고 두 안을 견줬습니다. gateway를 남기고 Tempo만 걷는 안은 돌리지 않고 검토만 했고, 송신자를 HyperDX 컬렉터(`hdx-otel-collector`)에 곧장 붙이는 안은 구현해서 지금 쓰고 있습니다. OTLP 입구를 아예 없애는 안은 선택지가 되지 못했습니다. CLI 메트릭이 들어오는 길이 이 입구뿐이고, mesh 트래픽을 보는 메트릭도 span_metrics가 트레이스에서 만드는 `traces_spanmetrics_*`뿐이기 때문입니다. envoy가 자체로 내는 통계는 어느 경로로도 수집하지 않습니다.

### gateway를 남기자는 반론과 단일 입구의 대가

gateway를 유지하고 Tempo만 제거하는 안도 검토했습니다. gateway는 upstream contrib 빌드여서 deltatocumulative가 들어 있고, HyperDX와 별개로 배포할 수 있으며 설정도 CRD 파일 하나에 모여 있습니다. HyperDX 컬렉터로 흡수하면 설정 병합 순서에 의존하고, HyperDX를 올릴 때마다 supervisor의 재시작과 원격 설정 변경이 수신 경로에 미치는 영향을 확인해야 합니다. 컴포넌트는 줄지만 장애에 함께 영향을 받는 경로가 늘어납니다.

사전 검토에서는 Tempo를 먼저 제거하고 gateway를 트레이스 전용 무상태 파드 하나로 몇 주 운영한 뒤 흡수를 결정하자는 절충안이 나왔습니다. CLI 메트릭을 VictoriaMetrics로 보내면 gateway와 HyperDX 컬렉터의 기능 차이가 사라지므로, 나중에 customConfig 한 블록으로 흡수할 수 있다는 평가였습니다. 이 절충안은 실제로 운영하지 않았습니다.

입구를 Vector와 HyperDX 컬렉터 둘로 줄이려는 목표에 따라 gateway까지 제거했습니다. 송신자가 모두 옮겨 간 것을 확인한 뒤, 같은 PR 스택에서 otel-gateway의 Collector CR·RBAC·VMServiceScrape와 Tempo를 삭제했습니다.

이제 트레이스와 spanmetrics 수신도 HyperDX의 수명주기에 영향을 받습니다. HyperDX 앱이 원격 설정을 바꾸거나 다시 배포되면 supervisor가 replica 하나인 컬렉터를 재시작합니다. 그동안 SDK와 istio 쪽에는 받아 둘 버퍼가 없지만, Vector 경로는 디스크 버퍼로 컬렉터 재시작을 견딜 수 있습니다. 이 의존 관계 때문에 트레이스 공백이 생기거나 HyperDX 업그레이드가 입구 파이프라인에 계속 영향을 준다면 트레이스 전용 gateway를 다시 둘 수 있습니다. 삭제한 매니페스트는 해당 변경을 git revert해 복원합니다.

### 입구를 여는 방법

HyperDX 컬렉터가 gateway 일을 받을 수 있는지는 컬렉터 이미지의 컴포넌트 목록으로 확인했습니다. span_metrics, prometheus_remote_write, k8s_attributes는 들어 있었고 차트에도 사용자 설정을 병합하는 자리(`global.otelCollector.customConfig`)가 있었습니다. deltatocumulative는 없었습니다. 차트의 `clickstack.otel-collector.config`는 쓸 수 없습니다. 컨테이너 인자로 들어가는 이 설정을 entrypoint가 무시하기 때문입니다.

ClickStack 컬렉터는 HyperDX 앱이 OpAMP remote config로 내려주는 설정을 받습니다. 원격 설정이 마지막에 병합되며 리스트는 통째로 교체되므로, 기존 이름(`otlp/hyperdx`, `clickhouse`, `traces`, `logs/in` 등)을 수정하면 원격 설정에 덮일 수 있습니다. 새 구성요소를 전부 `/ingest` 접미 이름으로 차트의 `customConfig`에 정의한 이유입니다. ClickHouse exporter도 별도로 정의했습니다. 원격 설정의 exporter를 참조하면 HyperDX가 그 설정을 바꿀 때나, 부팅 직후 원격 설정이 도착하기 전에 컬렉터가 기동에 실패할 수 있다고 사전 검토에서 판단했습니다.

인증은 새 입구에서 뺐습니다. 기존 `otlp/hyperdx`는 bearer token이 필수인데, Envoy(istiod의 extensionProvider)와 SDK, CLI에 키를 나눠 주려면 키가 meshConfig에 평문으로 들어가고 SDK env에는 앱 네임스페이스마다 시크릿이 필요합니다. 새 입구는 grpc 4327, http 4328이고 인증이 없습니다. hdx 네임스페이스에는 istio 사이드카가 없고(비메시) 공개 VirtualService가 4318만 라우팅하기 때문에 밖에서는 닿지 않습니다. 기존 4318은 ingestion key로 인증하는 길이고 Vector aggregator가 계속 이쪽을 씁니다. Vector의 opentelemetry 싱크는 gRPC를 지원하지 않아 HTTP 포트인 4318로 보냅니다.

{{< flow src="_flow/2-2-입구-열기.json" />}}

파이프라인은 셋입니다. traces는 ClickHouse와 `span_metrics/ingest`로 가는데, spanmetrics의 namespace를 gateway 때와 같은 `traces.spanmetrics`로 맞춰서 기존 대시보드의 시리즈 이름이 그대로 이어집니다. logs는 이미지 기본 설정의 severity 추론 transform을 재사용해 ClickHouse로, metrics는 OTLP로 VictoriaMetrics 테넌트 0에 넣습니다. metrics를 그렇게 넣은 이유는 메트릭 경로 절에서 설명합니다.

### 송신자를 옮길 때 걸린 것

입구가 서고 나서 보내는 쪽을 하나씩 옮겼습니다. 앱은 Instrumentation CR의 엔드포인트를 hdx의 4328로, istio는 istiod의 extensionProvider `otel-tracing`을 4327로 바꿨고 Claude Code와 Codex CLI도 4328로 보냅니다(옮기기 전에는 gateway의 4318이었습니다). 메트릭은 테넌트 0으로 OTLP 직결입니다.

auto-instrumentation의 엔드포인트는 파드가 만들어질 때 env로 주입됩니다. Instrumentation CR을 바꿔도 이미 떠 있는 파드는 옛 gateway로 계속 보냅니다. hotdeal-monitor, k8s-dashboard, kanna, nextra, portal 다섯 Deployment를 rollout restart해야 했습니다. hotdeal은 `maxUnavailable: 0`이라 한 대씩 교체되어 가장 늦게 끝났습니다. 중간에 PreStop hook 실패 경고가 떴지만 진행을 막지는 않았습니다.

마지막 송신자는 작업하던 Claude Code 세션 자신이었습니다. CLI의 OTel env는 세션이 시작될 때 고정됩니다. 설정 파일을 고친 뒤에도 gateway에는 초당 0.22 spans, 5.4 metric points, 0.09 log records가 계속 들어왔는데, 출처는 제 세션과 아직 교체 중이던 hotdeal의 옛 파드였습니다. 옛 길을 닫아도 되는지는 gateway가 지금 받는 양을 보고 판단해야 했습니다.

## OTLP 메트릭 경로

OTLP 메트릭은 Claude Code의 `claude_code_*`와 Codex CLI의 `codex_*`가 이 경로를 탑니다. 둘은 temporality가 다릅니다. Claude Code는 cumulative로 보내서 변환 없이 지나가고 이름도 깔끔합니다(`claude_code_*_total`). Codex CLI는 delta로만 내보내고 설정으로 바꿀 수 없습니다.

Prometheus remote write(PRW)는 delta를 버리기 때문에 gateway는 `delta_to_cumulative` 프로세서(max_stale 10m)로 cumulative로 바꾼 뒤 PRW로 vminsert 테넌트 0에 넣었습니다. HyperDX 컬렉터 이미지에는 이 프로세서(옛 이름 deltatocumulative)가 없고, 여기서 PRW로 보내면 Codex 메트릭이 사라집니다. 그래서 delta를 받아들이는 VictoriaMetrics의 OTLP 수신(`/insert/0/opentelemetry/v1/metrics`)으로 넣었습니다. VictoriaMetrics는 delta 값을 그대로 저장하고, 문서에서는 `sum_over_time()`이나 `rate_over_sum()`으로 조회하라고 안내합니다.

메트릭은 바로 테넌트 0에 넣지 않고 카나리부터 돌렸습니다. OTLP를 테넌트 1에 직결해 테넌트 0과 견주어 보니 메트릭 이름과 시리즈 수는 같았습니다. 차이는 라벨과 저장 방식에서 났습니다. 새 시리즈에는 `job`·`k8s_*` 라벨이 없고 `otel_scope_*`가 `scope_*`로 바뀝니다. Codex 메트릭은 delta 그대로 저장됩니다. 라벨 차이는 대시보드가 그 라벨을 쓰지 않아 영향이 없었고 delta 쪽은 쿼리를 고쳐야 했습니다.

ms 단위 Codex 히스토그램은 PRW 경로에서 이름에 `_milliseconds`가 한 번 더 붙어 `codex_*_duration_ms_milliseconds_*`가 됐습니다. 메트릭 이름이 이미 `_ms`로 끝나는데 단위 접미사가 또 붙은 것이고, seconds 단위 히스토그램에는 없던 현상입니다. 이 접미사는 OTLP 경로에서도 그대로여서, 카나리 테넌트에도 `codex_sqlite_logs_write_duration_ms_milliseconds_*`라는 이름으로 들어왔습니다.

Codex 대시보드 쿼리는 한 번 손봐야 했습니다. delta로 저장된 샘플은 하나하나가 이미 증가분이라 `increase_pure`로 세면 안 되고 합산해야 합니다. 그런데 옛 PRW 시리즈는 cumulative로 남아 있어서 한 쿼리가 둘을 다 읽어야 했습니다. 옛 시리즈에만 `job` 라벨이 있는 점을 이용해 `or`로 이었습니다.

```promql
# 이전
increase_pure(M{sel}[r])

# 이후
(increase_pure(M{sel,job!=""}[r]) or sum_over_time(M{sel,job=""}[r]))
```

옛 시리즈가 90일 보관으로 사라지는 2026-12-27 이후에는 왼쪽 절을 걷어냅니다.

메트릭 저장소는 VictoriaMetrics 그대로입니다. gateway 때도 메트릭 파이프라인에서 HyperDX로 가는 exporter를 일부러 뺐고, HyperDX의 `otel_metrics_*` 테이블에는 HyperDX 자신의 텔레메트리만 들어옵니다. 현재 경로는 HyperDX 컬렉터 이미지에 deltatocumulative가 없고 Codex가 delta로만 보내는 조건에서 선택했습니다. 둘 중 하나가 바뀌면 PRW로 돌아가 쿼리를 한 벌로 줄일 수 있는지 다시 봐야 합니다.

## 대시보드 데이터소스

Grafana 대시보드는 VictoriaLogs와 Tempo 데이터소스를 읽고 있었습니다. 저장소를 걷으면 그 데이터소스를 읽던 패널도 옮겨야 하고, 옮길 곳은 RUM 대시보드가 이미 쓰던 ClickHouse-HyperDX 데이터소스였습니다. Tempo 패널은 끄기 전에 옮겼지만 VictoriaLogs 쪽 패널은 그러지 못했습니다. VictoriaLogs를 끄고 데이터소스 파일까지 주석 처리한 뒤에도 AI CLI 대시보드 세 개가 `uid: victorialogs`를 245곳에서 참조하고 있었습니다(claude-code 106, codex 127, ai-cli-common 12). 그 패널들은 빈 화면이 됐습니다.

패널 115개와 변수 4개를 ClickHouse SQL로 옮겼습니다. 바꾼 SQL 126개를 실제 ClickHouse에서 돌려 오류 0을 확인했고 이벤트가 한 번도 없었던 쿼리 8개는 0행이 나왔습니다. 대시보드를 처음 만든 경위는 [Claude Code 관측]({{< relref "/engineering/ai-tools/01-claude-code-otel/index.md" >}})과 [Codex CLI 관측]({{< relref "/engineering/ai-tools/02-codex-otel/index.md" >}})에 있는데, 두 글은 설정·경로 설명을 지금 경로로 고쳤고, 함정과 실측을 적은 절은 이전 경로 기준 기록으로 남겨 두었습니다. 저장소 선택에 따라 데이터소스도 함께 바뀐 것입니다.

## 옮긴 순서

실제 이관은 로그 저장소를 HyperDX 하나로 모으는 작업부터 시작했습니다. Tempo 패널을 옮기고 hdx 컬렉터에 내부 입구를 연 뒤 송신자를 전환했습니다. 옛 입구로 들어오는 양을 확인한 다음 fluent-bit, gateway, Tempo를 제거하고 마지막에 비교용 이름을 바꿨습니다.

수신 경로뿐 아니라 조회 경로도 저장소보다 먼저 옮겨야 했습니다. Tempo는 패널을 바꾼 뒤 종료했지만, VictoriaLogs는 먼저 종료한 탓에 뒤늦게 빈 패널을 발견했습니다.

### 이름 변경과 수집 공백

이관 과정에서 aggregator StatefulSet의 OutOfSync도 해결해야 했습니다. vector 0.58.0 차트는 `volumeClaimTemplates`에 apiVersion과 kind를 렌더하지 않는데 apiserver는 apps/v1로 변환할 때 항상 채워 넣습니다. Argo의 기본 diff(구조적 병합)는 이 리스트를 atomic으로 비교해서 매번 다르다고 보기 때문입니다. `argocd.argoproj.io/compare-options: ServerSideDiff=true`를 달아 해결했습니다. atlantis 앱도 같은 원인에 같은 해법이었습니다.

비교 스터디 때 붙인 이름을 바꾸면서 네임스페이스는 `logging`, Argo 앱은 `vector-agent`와 `vector-aggregator`, 디렉터리는 `hub/vector/`가 됐습니다. 개명 전에 옛 aggregator의 버퍼 PVC를 보니 54MB가 차 있었습니다. 그러나 이것만으로 미전송량을 알 수는 없었습니다. Vector의 disk buffer v2는 쓰던 데이터 파일을 롤오버 전까지 남기기 때문에 이미 보낸 데이터도 크기에 잡힙니다. 버퍼가 다 빠졌는지는 "ClickHouse 도착 지연(최신 행과 현재 시각의 차이)이 60초 이하이고 aggregator 에러가 0"인지로 판단하기로 했습니다. 실측은 3~6초였습니다.

이름을 바꾸는 동안에는 수집 공백이 있었습니다. 머지할 때 옛 aggregator가 멈추고 새 aggregator가 뜨기까지 약 1분 동안 새 로그가 들어오지 않았습니다. 새 agent가 hostPath `/var/lib/vector`의 체크포인트를 이어받아(`Loaded checkpoint data`) 그 사이 파일에 쓰인 로그는 다시 읽었지만, 옛 agent 메모리 버퍼에 있던 이벤트는 유실됐을 수 있습니다. OTLP `scope.name`도 `vector-study-aggregator`에서 `vector-aggregator`로 바뀌었습니다.

## PR을 쌓고 이름을 바꾸다 빠뜨린 것

스택으로 쌓은 PR에서 파일 하나가 빠졌습니다. gateway와 Tempo를 지우는 PR을 이전 단계 브랜치 위에 올렸는데, 그 브랜치가 main의 "gateway 자체 지표 VMServiceScrape 추가" 커밋보다 먼저 갈라져 있었습니다. 그래서 그 파일의 삭제가 PR에 없었습니다. main으로 rebase하며 같이 지웠고 이때 `collector-gateway.yaml`에서 modify/delete 충돌이 났습니다(main은 NetworkPolicy를 손봤고 PR은 파일을 지웠습니다).

개명 쪽은 충돌조차 없어서 알아채기가 더 어려웠습니다. 한 PR이 `hub/apps/vector-study-aggregator.yaml`에 annotation 한 줄(앞서 적은 ServerSideDiff)을 넣었고 다른 PR이 같은 파일을 `vector-aggregator.yaml`로 옮겼습니다. 앞 PR이 머지된 뒤 개명 PR을 rebase하니 충돌 없이 끝났는데 annotation이 사라져 있었습니다. rename을 사이에 두면 다른 PR의 변경이 따라오지 않는 일이 있습니다. rebase 뒤에 annotation이 남았는지 grep으로 확인하는 단계가 있어서 잡았습니다.

## 최종 구성

{{< flow src="_flow/4-결과.json" />}}

{{< basis "기준 2026-10-04" "범위 hub 클러스터" "로그·트레이스는 5분 합계" >}}

{{< kpis >}}
{{< kpi label="텔레메트리 저장소" value="4 → 2" sub="VictoriaLogs·Tempo 제거" tone="good" >}}
{{< kpi label="로그 적재(5분)" value="10,784건" sub="ClickHouse otel_logs" >}}
{{< kpi label="트레이스(5분)" value="2,538건" sub="서비스 15개" >}}
{{< kpi label="ClickHouse 도착 지연" value="3~6초" sub="최신 행과 현재 시각의 차" tone="good" >}}
{{< /kpis >}}

정리한 리소스는 그림에서 점선으로 표시했습니다. otel-gateway(Deployment·CR·RBAC·VMServiceScrape), Tempo(StatefulSet·PVC 10Gi·약 73MB가 들어 있던 S3 버킷), fluent-bit DaemonSet 2대, VictoriaLogs 앱, 옛 `vector-study` 네임스페이스(버퍼 PVC 5Gi), monitoring 네임스페이스의 ingestion key 시크릿입니다. 새로 추가한 것은 hdx 컬렉터의 내부 입구입니다. 파드에 auto-instrumentation을 주입하는 웹훅은 계속 필요해서 OpenTelemetry operator는 유지했고, Collector CR은 0개가 됐습니다.

ClickHouse에는 계층 스토리지가 걸려 있습니다. 최근 7일은 node1의 local-path에, 90일까지는 SeaweedFS의 S3(cold)에 두고 `otel_metrics_*`는 3일만 보관합니다. 트레이스를 보내는 서비스는 hdx-oss-api, kanna, nextra, seaweedfs, istio-ingressgateway, portal, fmkorea-hotdeal-monitor, claude-code 등 15개입니다. aggregator의 `vector test`는 7/7 통과했고 Argo 앱 vector-agent와 vector-aggregator는 Synced/Healthy입니다.

## 남은 일

Codex 대시보드의 `or` 절 정리와 `tempo-s3-secret` 분리 외에도, 화면 검증과 다음 정리가 남았습니다.

- 이관한 AI CLI 대시보드의 Grafana 화면을 확인합니다. 그룹 시계열 범례 같은 렌더링은 SQL 실행까지만 검증했습니다.
- Codex 이벤트에는 `workspace.user` 필드가 없어서 사용자를 골라 보면 Codex 행이 빠집니다.
- 대시보드를 만들던 로컬 생성 스크립트(`build-*.py`)는 아직 VictoriaLogs를 전제로 만들어져 있습니다. 이제는 git의 YAML을 원본으로 봅니다.
- VictoriaLogs의 고아 PVC(10Gi)를 삭제합니다. StatefulSet의 volumeClaimTemplates로 만들어진 PVC라 Application을 정리해도 남습니다. 복원용으로 남긴 일몰 파일(tempo·victoria-logs·fluent-bit)은 2주쯤 안정적으로 돌면 지웁니다.
- CronJob 로그는 service.name에 epoch 접미사가 붙어(`daily-reboot-<epoch>`) 시계열이 갈라집니다. VRL 정규식을 고칠 후보입니다.
