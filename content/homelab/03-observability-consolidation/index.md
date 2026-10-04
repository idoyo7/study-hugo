---
title: "03 관측 스택 일원화 — Vector와 HyperDX 컬렉터로 모으기"
date: 2026-10-04
lastmod: 2026-10-04
weight: 3
---

# 관측 스택 일원화 — 입구는 둘, 저장소는 둘로

앞 편이 개발환경이었다면 이번에는 hub 안쪽의 관측 스택입니다. 9월 말부터 일주일 남짓 로그·트레이스·APM이 들어오는 길을 한꺼번에 손봤습니다. 목표는 한 줄로 적어 두고 시작했습니다. **입구는 Vector와 HyperDX(ClickStack) OTel 컬렉터 두 곳, 저장은 ClickHouse(HyperDX)와 VictoriaMetrics 두 곳.**

끝내 놓고 보니 새로 만든 길은 하나이고 나머지는 걷어낸 것들입니다. otel-gateway, Tempo, fluent-bit, VictoriaLogs가 없어졌습니다. 클러스터 배치와 NAS는 [hub / edge 구조]({{< relref "../01-hub-edge-architecture/index.md" >}})에, HyperDX 쪽 구성은 [우리 배포 형상]({{< relref "../../hyperdx-operating/01-our-deployment/index.md" >}})에 있습니다. 이 글은 그 위에서 무엇을 어떤 순서로 옮겼는지와 어디서 걸렸는지를 적습니다.

## 1. 왜 모았나 — 같은 것이 두 번 들어가던 구조

{{< flow src="_flow/1-왜-모았나.json" />}}

9월 27일 무렵의 hub는 같은 데이터를 두 번씩 받고 있었습니다. 먼저 로그 저장소가 둘이었습니다. VictoriaLogs(보존 7일, 시놀로지 NFS 10Gi)와 HyperDX의 ClickHouse에 같은 로그가 쌓였고 9월 23일 커밋 이후로는 클러스터 전체 파드 로그가 양쪽에 다 들어갔습니다. 두 곳의 일별 건수는 0.1% 이내로 일치했습니다.

수집기도 둘이었습니다. 처음에는 otel-agent DaemonSet이 로그를 읽었는데, Vector와 Fluent Bit를 비교해 보려고 vector-agent와 fluent-bit DaemonSet을 나란히 띄웠습니다. 둘 다 `/var/log/containers/*`를 전부 읽어 aggregator(StatefulSet)로 보내고 aggregator가 두 입력을 VRL `normalize` 하나로 합쳐 HyperDX에 넣는 구조입니다. 비교하려고 만든 구성이니 같은 로그가 두 번 들어오는 건 설계대로였습니다. 1시간치를 세어 보니 fluent-bit 경로가 100,082건, vector-agent 경로가 100,049건이었습니다. 같은 양이 겹쳐 들어온 겁니다.

트레이스는 다른 길을 탔습니다. 앱(OTel operator의 auto-instrumentation, `parentbased_traceidratio` 0.25)과 istio(메시 10%, ingressgateway 100%)가 monitoring 네임스페이스의 otel-gateway로 보내면 gateway가 Tempo(3.x, SeaweedFS의 S3 버킷)와 HyperDX에 나란히 썼습니다. span_metrics 커넥터가 만든 `traces.spanmetrics`는 VictoriaMetrics로 갔고 OTLP 메트릭도 delta_to_cumulative를 거쳐 PRW로 vminsert 테넌트 0에 들어갔습니다. [개발환경]({{< relref "../02-dev-workspace/index.md" >}})에서 쓰는 code-server 안의 Claude Code와 Codex CLI도 같은 gateway의 4318로 보냈습니다. Grafana 대시보드는 VictoriaLogs와 Tempo 데이터소스를 읽고 있었습니다.

그려 놓고 세어 보니 텔레메트리 저장소가 넷, 로그 수집기가 둘, 중간 홉이 하나였습니다. 같은 데이터를 두 번 받는 만큼 돌봐야 할 것도 두 벌이었습니다. 로깅 조사 연재에서는 [VictoriaLogs]({{< relref "../../logging/03-victorialogs.md" >}})를 먼저 골랐고 [HyperDX / ClickStack]({{< relref "../../logging/05-hyperdx-clickstack.md" >}})은 RUM까지 옮길 때의 선택지로 따졌습니다. 이번에는 둘 중 HyperDX를 남기고 나머지를 걷기로 했습니다. 트레이스와 브라우저 세션(RUM)이 이미 HyperDX의 ClickHouse에 들어오고 있었으니 로그까지 그쪽에 두면 대시보드와 쿼리를 손볼 곳이 한 군데로 줄어듭니다. 로그 시스템을 둘로 계속 돌릴 이유는 없었습니다.

## 2. 순서 — 받는 쪽을 먼저 열고 낡은 길은 마지막에 걷는다

저장소부터 끄면 보내던 쪽이 갈 곳을 잃습니다. 그래서 받는 쪽을 먼저 준비하고, 보내는 쪽을 옮기고, 아무도 보내지 않는 걸 확인한 뒤에 끄는 순서로 갔습니다. 이름 정리는 맨 마지막입니다.

### 2.1 로그 저장소부터 하나로

가장 먼저 로그 백엔드를 HyperDX 하나로 모았습니다. otel-agent를 걷어 수집을 Vector 한 길로 돌리고 VictoriaLogs Application은 통째로 주석 처리했습니다. apps-root가 prune 모드라서 파일을 지우지 않아도 리소스가 0개로 읽혀 Application이 정리됩니다. 파일은 복원용으로 남겼습니다. 같은 무렵 Grafana 대시보드의 Tempo 트레이스 패널도 ClickHouse-HyperDX 데이터소스로 바꿔 두었습니다. Tempo는 화면부터 옮겨 놓은 다음에 껐습니다.

### 2.2 입구 열기 — hdx 컬렉터에 내부 입구 하나

트레이스와 메트릭이 갈 새 길은 HyperDX 컬렉터(`hdx-otel-collector`)에 냈습니다. 신경 쓸 건 설정을 받는 방식이었습니다. ClickStack 컬렉터는 HyperDX 앱이 OpAMP remote config로 내려주는 설정을 받는데, 원격 설정은 마지막에 병합되고 리스트는 통째로 교체됩니다. 기존 이름(`otlp/hyperdx`, `clickhouse`, `traces`, `logs/in` 등)을 건드리면 원격 설정에 덮일 수 있습니다. 그래서 기존 것은 그대로 두고 새 구성요소를 전부 `/ingest` 접미 이름으로 차트 `customConfig`에 따로 정의했습니다.

{{< flow src="_flow/2-2-입구-열기.json" />}}

새 입구는 grpc 4327, http 4328이고 인증이 없습니다. hdx 네임스페이스에는 istio 사이드카가 없고(비메시) 공개 VirtualService가 4318만 라우팅하기 때문에 밖에서는 닿지 않습니다. 기존 4318은 ingestion key로 인증하는 길이고 Vector aggregator가 계속 이쪽을 씁니다.

파이프라인은 셋입니다. traces는 ClickHouse와 `span_metrics/ingest`로 가는데, spanmetrics의 namespace를 gateway 때와 같은 `traces.spanmetrics`로 맞춰서 기존 대시보드의 시리즈 이름이 그대로 이어집니다. logs는 이미지 기본 설정의 severity 추론 transform을 재사용해 ClickHouse로, metrics는 OTLP로 VictoriaMetrics 테넌트 0에 넣습니다. 이 이미지에는 deltatocumulative 프로세서가 없어서 delta 메트릭은 변환 없이 들어갑니다.

메트릭은 바로 테넌트 0에 넣지 않고 카나리부터 돌렸습니다. OTLP를 테넌트 1에 직결해 테넌트 0과 견주어 보니 메트릭 이름과 시리즈 수는 같았습니다. 차이는 라벨과 저장 방식에서 났습니다. 새 시리즈에는 `job`·`k8s_*` 라벨이 없고 `otel_scope_*`가 `scope_*`로 바뀝니다. Codex 메트릭은 delta 그대로 저장됩니다. 라벨 차이는 대시보드가 그 라벨을 쓰지 않아 영향이 없었고 delta 쪽은 쿼리를 고쳐야 했습니다.

### 2.3 송신자 옮기기

입구가 서고 나서 보내는 쪽을 하나씩 옮겼습니다. 앱은 Instrumentation CR의 엔드포인트를 hdx의 4328로, istio는 istiod의 extensionProvider `otel-tracing`을 4327로 바꿨고 Claude Code와 Codex CLI도 4328로 보냅니다. 메트릭은 테넌트 0으로 OTLP 직결입니다.

Codex 대시보드 쿼리는 한 번 손봐야 했습니다. delta로 저장된 샘플은 하나하나가 이미 증가분이라 `increase_pure`로 세면 안 되고 합산해야 합니다. 그런데 옛 PRW 시리즈는 cumulative로 남아 있어서 한 쿼리가 둘을 다 읽어야 했습니다. 옛 시리즈에만 `job` 라벨이 있는 점을 이용해 `or`로 이었습니다.

```promql
# 이전
increase_pure(M{sel}[r])

# 이후
(increase_pure(M{sel,job!=""}[r]) or sum_over_time(M{sel,job=""}[r]))
```

옛 시리즈가 90일 보관으로 사라지는 2026-12-27 이후에는 왼쪽 절을 걷어냅니다.

### 2.4 수집기 하나로 — fluent-bit을 걷은 근거

로그 수집기는 24시간치를 놓고 비교한 뒤에 골랐습니다. 수집량은 거의 같았습니다. vector-agent가 2,399,840건, fluent-bit이 약 2,400,004건이었습니다. 서비스 수는 vector-agent 77개, fluent-bit 61개로 달랐고 ServiceName 기준으로는 fluent-bit에만 있는 서비스가 30개였습니다. 놓친 게 있나 싶어 `(k8s.namespace.name, k8s.container.name)` 쌍으로 다시 맞춰 보니 양쪽 차이는 0개였습니다. 놓친 로그는 없었습니다. 두 수집기가 `service.name`을 정하는 방식이 달랐던 겁니다. fluent-bit은 owner 정보가 없어서 라벨과 컨테이너 이름으로 정하고 vector-agent는 Deployment·StatefulSet 같은 owner 이름으로 정합니다. 같은 컨테이너인데 이름이 이렇게 갈렸습니다.

| fluent-bit이 붙인 이름 | vector-agent가 붙인 이름 |
|---|---|
| grafana | victoria-metrics-grafana |
| clickhouse | chi-hdx-default-0-0 |
| hdx-mongodb-svc | hdx-mongodb |
| kube-apiserver | master1 |

vector-agent만 남겼습니다. 머지 직후 5분 동안 vector-agent 8,496건만 들어왔고 fluent-bit 행은 0이었습니다. 같은 로그가 두 번 들어오던 게 사라지면서 `otel_logs` 적재량도 대략 절반이 됐습니다.

aggregator 이미지가 distroless라 파드 안에서 `vector test`용 파일을 복사할 수 없었습니다(tar가 없습니다). 대신 머지 전에는 `vector vrl`로 테스트 7개를 재현해 확인했고 머지 뒤 새 파드에서 `vector test /etc/vector/vector.yaml`을 돌려 7/7 통과를 봤습니다.

### 2.5 중간 홉 걷기 — otel-gateway와 Tempo

보내는 쪽이 다 넘어간 걸 확인하고 gateway를 지웠습니다. otel-gateway의 Collector CR·RBAC·VMServiceScrape, 그리고 Tempo입니다. OpenTelemetry operator는 남겼습니다. auto-instrumentation을 파드에 주입하는 웹훅이 계속 필요하기 때문입니다. Collector CR은 0개가 됐습니다.

### 2.6 이름 정리 — vector-study에서 logging으로

마지막으로 비교 스터디 때 붙인 이름을 걷었습니다. 네임스페이스는 `logging`, Argo 앱은 `vector-agent`와 `vector-aggregator`, 디렉터리는 `hub/vector/`입니다. 이 작업에서 걸린 것들은 아래 §3에 같이 적었습니다.

## 3. 걸린 것들

순서를 정해도 걸릴 건 걸렸습니다. 기억해 둘 만한 것만 묶었습니다.

### 3.1 옛 길에 남은 송신자

auto-instrumentation의 엔드포인트는 파드가 만들어질 때 env로 주입됩니다. Instrumentation CR을 바꿔도 이미 떠 있는 파드는 옛 gateway로 계속 보냅니다. hotdeal-monitor, k8s-dashboard, kanna, nextra, portal 다섯 Deployment를 rollout restart해야 했습니다. hotdeal은 `maxUnavailable: 0`이라 한 대씩 교체되어 가장 늦게 끝났습니다. 중간에 PreStop hook 실패 경고가 떴지만 진행을 막지는 않았습니다.

마지막 송신자는 작업하던 Claude Code 세션 자신이었습니다. CLI의 OTel env는 세션이 시작될 때 고정됩니다. 설정 파일을 고친 뒤에도 gateway에는 초당 0.22 spans, 5.4 metric points, 0.09 log records가 계속 들어왔는데, 출처는 제 세션과 아직 교체 중이던 hotdeal의 옛 파드였습니다. 옛 길을 닫아도 되는지는 설정 파일이 아니라 gateway가 지금 받는 양으로 봐야 했습니다.

### 3.2 끈 뒤에 남은 참조

Tempo 패널은 끄기 전에 옮겼지만 VictoriaLogs 쪽 패널은 그러지 못했습니다. VictoriaLogs를 끄고 데이터소스 파일까지 주석 처리한 뒤에도 AI CLI 대시보드 세 개가 `uid: victorialogs`를 245곳에서 참조하고 있었습니다(claude-code 106, codex 127, ai-cli-common 12). 그 패널들은 빈 화면이 됐습니다. 이관 PR이 진행 중이고 거기서 패널 115개와 변수 4개를 ClickHouse SQL로 옮겼습니다. 바꾼 SQL 126개를 실제 ClickHouse에서 돌려 오류 0을 확인했고 이벤트가 한 번도 없었던 쿼리 8개는 0행이 나왔습니다. 대시보드를 처음 만든 경위는 [Claude Code 관측]({{< relref "../../ai-tools/01-claude-code-otel/index.md" >}})과 [Codex CLI 관측]({{< relref "../../ai-tools/02-codex-otel/index.md" >}})에 있는데, 두 글이 설명하는 수집 경로는 이번 정리 이전 기준입니다.

이름에 남는 부채도 있습니다. HyperDX의 S3 자격증명(`hdx-s3-secret`)과 rum-loader가 `monitoring/tempo-s3-secret`의 값을 재사용하고 있어서 Tempo가 없어진 지금도 이 시크릿은 지울 수 없습니다.

### 3.3 스택 PR과 rename이 조용히 빠뜨린 것

스택으로 쌓은 PR에서 파일 하나가 빠졌습니다. gateway와 Tempo를 지우는 PR을 이전 단계 브랜치 위에 올렸는데, 그 브랜치가 main의 "gateway 자체 지표 VMServiceScrape 추가" 커밋보다 먼저 갈라져 있었습니다. 그래서 그 파일의 삭제가 PR에 없었습니다. main으로 rebase하며 같이 지웠고 이때 `collector-gateway.yaml`에서 modify/delete 충돌이 났습니다(main은 NetworkPolicy를 손봤고 PR은 파일을 지웠습니다).

개명 쪽은 충돌조차 없어서 알아채기가 더 어려웠습니다. 한 PR이 `hub/apps/vector-study-aggregator.yaml`에 annotation 한 줄(아래 ServerSideDiff)을 넣었고 다른 PR이 같은 파일을 `vector-aggregator.yaml`로 옮겼습니다. 앞 PR이 머지된 뒤 개명 PR을 rebase하니 충돌 없이 끝났는데 annotation이 사라져 있었습니다. rename을 사이에 두면 다른 PR의 변경이 따라오지 않는 일이 있습니다. rebase 뒤에 annotation이 남았는지 grep으로 확인하는 단계가 있어서 잡았습니다.

### 3.4 Argo의 삭제 순서와 영구 OutOfSync

삭제에는 순서가 있습니다. apps-root가 tempo Application을 prune하면 resources-finalizer가 하위 리소스를 지우는데, StatefulSet은 foregroundDeletion이라 파드가 종료될 때까지 기다린 뒤에야 사라집니다. 제가 "아직 안 지워졌다"고 본 건 삭제를 시작하고 30초밖에 안 지났을 때였습니다. 그래서 정리 단계에는 Tempo StatefulSet이나 gateway Deployment가 남아 있으면 멈추는 확인을 넣었습니다.

영구 OutOfSync도 하나 풀었습니다. vector 0.58.0 차트는 `volumeClaimTemplates`에 apiVersion과 kind를 렌더하지 않는데 apiserver는 apps/v1로 변환할 때 항상 채워 넣습니다. Argo의 기본 diff(구조적 병합)는 이 리스트를 atomic으로 비교해서 매번 다르다고 보기 때문에 aggregator StatefulSet이 계속 OutOfSync로 남았습니다. `argocd.argoproj.io/compare-options: ServerSideDiff=true`를 달아 해결했습니다. atlantis 앱도 같은 원인에 같은 해법이었습니다.

### 3.5 "비었다"를 재는 기준

개명 전에 옛 aggregator의 버퍼 PVC를 보니 54MB가 차 있었습니다. 못 보낸 데이터가 이만큼 쌓였나 싶었지만 아니었습니다. Vector의 disk buffer v2는 쓰던 데이터 파일을 롤오버 전까지 남기기 때문에 이미 보낸 데이터도 크기에 잡힙니다. 버퍼가 다 빠졌는지는 크기 대신 "ClickHouse 도착 지연(최신 행과 현재 시각의 차이)이 60초 이하이고 aggregator 에러가 0"인지로 보기로 했습니다. 실측은 3~6초였습니다.

개명 자체에도 공백이 있었습니다. 머지할 때 옛 aggregator가 멈추고 새 aggregator가 뜨기까지 약 1분 동안 새 로그가 들어오지 않았습니다. 새 agent가 hostPath `/var/lib/vector`의 체크포인트를 이어받아(`Loaded checkpoint data`) 그 사이 파일에 쓰인 로그는 다시 읽었지만, 옛 agent 메모리 버퍼에 있던 이벤트는 유실됐을 수 있습니다. OTLP `scope.name`도 `vector-study-aggregator`에서 `vector-aggregator`로 바뀌었습니다.

## 4. 결과 — 입구 둘, 저장소 둘

{{< flow src="_flow/4-결과.json" />}}

{{< basis "기준 2026-10-04" "범위 hub 클러스터" "로그·트레이스는 5분 합계" >}}

{{< kpis >}}
{{< kpi label="텔레메트리 저장소" value="4 → 2" sub="VictoriaLogs·Tempo 제거" tone="good" >}}
{{< kpi label="로그 적재(5분)" value="10,784건" sub="ClickHouse otel_logs" >}}
{{< kpi label="트레이스(5분)" value="2,538건" sub="서비스 15개" >}}
{{< kpi label="ClickHouse 도착 지연" value="3~6초" sub="최신 행과 현재 시각의 차" tone="good" >}}
{{< /kpis >}}

그림의 점선 카드는 걷어낸 자리입니다. 전부 세어 보면 otel-gateway(Deployment·CR·RBAC·VMServiceScrape), Tempo(StatefulSet·PVC 10Gi·약 73MB가 들어 있던 S3 버킷), fluent-bit DaemonSet 2대, VictoriaLogs 앱, 옛 `vector-study` 네임스페이스(버퍼 PVC 5Gi), monitoring 네임스페이스에 두었던 ingestion key 시크릿입니다. 새로 생긴 건 hdx 컬렉터의 입구 하나뿐입니다.

ClickHouse에는 계층 스토리지가 걸려 있습니다. 최근 7일은 node1의 local-path에, 90일까지는 SeaweedFS의 S3(cold)에 두고 `otel_metrics_*`는 3일만 보관합니다. 트레이스를 보내는 서비스는 hdx-oss-api, kanna, nextra, seaweedfs, istio-ingressgateway, portal, fmkorea-hotdeal-monitor, claude-code 등 15개입니다. aggregator의 `vector test`는 7/7 통과했고 Argo 앱 vector-agent와 vector-aggregator는 Synced/Healthy입니다.

## 5. 대가와 남은 일

입구를 하나로 모은 대가도 있습니다. hdx 컬렉터가 이제 단일 입구입니다. 재시작하는 동안 SDK와 istio 쪽에는 받아 둘 버퍼가 없습니다. Vector 경로에는 디스크 버퍼가 있어서 컬렉터가 재시작해도 견딥니다. ClickHouse와 MongoDB, 컬렉터가 모두 node1에 몰려 있어서 그 노드의 여유도 따져 봐야 합니다.

- AI CLI 대시보드 이관 PR이 머지되면 Grafana 화면을 확인합니다. 그룹 시계열 범례 같은 렌더링은 SQL 실행까지만 검증했습니다.
- Codex 이벤트에는 `workspace.user`와 `ttft_ms` 필드가 없어서 일부 패널이 비거나 사용자 필터에서 빠집니다.
- 대시보드를 만들던 로컬 생성 스크립트(`build-*.py`)는 아직 VictoriaLogs 기준입니다. 이제는 git의 YAML을 원본으로 봅니다.
- VictoriaLogs의 고아 PVC(10Gi)를 삭제합니다. 복원용으로 남긴 일몰 파일(tempo·victoria-logs·fluent-bit)은 2주쯤 안정적으로 돌면 지웁니다.
- Codex 대시보드의 `or` 절은 2026-12-27 이후에 걷어냅니다.
- `tempo-s3-secret`은 HyperDX 전용 S3 identity로 분리합니다.
- CronJob 로그는 service.name에 epoch 접미사가 붙어(`daily-reboot-<epoch>`) 시계열이 갈라집니다. VRL 정규식을 고칠 후보입니다.
