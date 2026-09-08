---
title: "03 Claude Code 관측 — OTel 내보내기·대시보드·백필"
date: 2026-09-08
lastmod: 2026-09-08
weight: 3
---

# Claude Code 관측 — 토큰이 어디로 새는지 숫자로 보기

앞 편의 code-server 터미널에서 하루 종일 Claude Code를 돌립니다. 얼마를 쓰는지는 `/cost`로 그때그때 볼 수 있지만, 어느 에이전트가 먹는지, 세션을 새로 열 때마다 얼마가 고정비로 나가는지, 훅이 몇 분을 잡아먹는지는 안 보입니다. 이 글은 그걸 hub 클러스터의 관측 스택(VictoriaMetrics·VictoriaLogs·Tempo·Grafana)으로 끌어온 하루치 기록입니다. 공식 문서는 [monitoring-usage](https://code.claude.com/docs/ko/monitoring-usage) 한 장이고, 실제로 발목을 잡은 건 문서 밖에 있었습니다.

## 어디로 보내나

hub에는 이미 `otel-gateway-collector`가 떠 있습니다. OTLP를 받아 메트릭은 VictoriaMetrics로 remote write, 트레이스는 Tempo로 넘기고 spanmetrics 커넥터가 스팬에서 RED 메트릭을 만듭니다. logs 파이프라인만 없습니다. Claude Code의 이벤트(user_prompt, api_request, tool_result 같은 것)는 OTLP logs로 나가므로 이벤트만 VictoriaLogs의 OTLP 엔드포인트로 직접 보냈습니다.

설정은 `~/.claude/settings.json`의 `env` 블록 하나입니다. 환경변수는 프로세스 시작 때만 읽히니 이미 떠 있는 세션엔 적용되지 않습니다.

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_TRACES_EXPORTER": "otlp",
    "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA": "1",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://otel-gateway-collector.monitoring.svc.cluster.local:4318",
    "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT": "http://victoria-logs-victoria-logs-single-server.monitoring.svc.cluster.local:9428/insert/opentelemetry/v1/logs",
    "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE": "cumulative",
    "OTEL_RESOURCE_ATTRIBUTES": "workspace.user=mont,deployment.environment=hub",
    "OTEL_LOG_TOOL_DETAILS": "1"
  }
}
```

| 신호 | 경로 | 저장소 |
|---|---|---|
| 메트릭 | gateway :4318 → prometheusremotewrite | VictoriaMetrics (90d) |
| 트레이스 (beta) | gateway :4318 → otlp/tempo + spanmetrics | Tempo |
| 이벤트 로그 | VictoriaLogs :9428 직접 | VictoriaLogs (7d) |

프롬프트 본문은 기본값대로 `<REDACTED>`로 나갑니다. `OTEL_LOG_TOOL_DETAILS=1`은 나중에 켰습니다. 이 옵션이 있어야 Bash 명령 문자열과 커스텀 에이전트 이름이 `custom`으로 뭉개지지 않고 나옵니다.

## 함정 하나: 메트릭만 안 들어온다

haiku로 테스트 세션을 돌리자 VictoriaLogs에 이벤트가 쌓이고 Tempo에 트레이스가 잡혔습니다. 메트릭만 없었습니다. 게이트웨이 로그에도 아무것도 남지 않았습니다.

원인은 temporality입니다. Claude Code의 메트릭 기본값이 `delta`이고 prometheusremotewrite exporter는 delta 카운터를 에러 없이 버립니다. 그런데 리소스 속성으로 만든 `target_info` 시리즈는 VictoriaMetrics에 들어와 있었습니다. 배치는 도착했는데 데이터포인트만 사라진 모양이라 이 조합을 보고 temporality를 의심했습니다. `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative` 한 줄로 끝났습니다.

며칠 뒤 같은 게이트웨이에 `deltatocumulative` 프로세서가 붙었습니다. Codex CLI는 delta로 고정돼 있어 설정으로 바꿀 수 없기 때문입니다. 이제 delta도 통과하지만 Claude Code 쪽은 cumulative를 그대로 둡니다.

## 함정 둘: 첫 샘플을 버리는 increase()

메트릭이 들어온 뒤에도 토큰 합계가 0이었습니다. 비용과 세션 수는 맞는데 토큰만 0이었습니다.

Claude Code는 세션마다 `session_id` 레이블이 다른 새 시리즈를 만들고 0부터 셉니다. VictoriaMetrics의 `increase()`는 새 시리즈의 첫 샘플을 보고 "이미 큰 값이면 원래 있던 카운터"로 판단해 무시합니다. 비용 0.003이나 세션 1처럼 작은 값은 0에서 시작한 것으로 보고 세어 주고 토큰 22,125는 버립니다. 그래서 절반만 맞았습니다.

| 쿼리 | 결과 |
|---|---|
| `sum(increase(claude_code_token_usage_tokens_total[2h]))` | 0 |
| `sum(increase_pure(claude_code_token_usage_tokens_total[2h]))` | 22312 |

MetricsQL의 `increase_pure()`는 카운터가 항상 0에서 시작한다고 가정합니다. 세션 단위로 새 시리즈가 생기는 이 데이터엔 이쪽이 맞습니다. 이후 만든 모든 대시보드 쿼리가 `increase_pure`를 씁니다. `rate()`도 같은 이유로 짧은 세션을 통째로 놓치므로 쓰지 않았습니다.

## 대시보드 셋

공개 대시보드부터 찾았습니다. grafana.com의 [25255 Claude Code Metrics (Prometheus)](https://grafana.com/grafana/dashboards/25255-claude-code-metrics-prometheus/)가 메트릭 이름과 레이블이 지금 들어오는 데이터와 그대로 맞았습니다. 대신 VictoriaMetrics에서 쓰려면 손볼 곳이 있었습니다.

- `increase()`와 `rate()` 27곳을 `increase_pure()`로
- 단일값 패널 20개를 range 쿼리에서 instant로. 원본은 7d 범위에서 7일짜리 창을 1,000번 계산하고 step 정렬 때문에 방금 들어온 샘플을 놓칩니다
- 구간 합계 시계열은 선 대신 막대로. 세션이 드문드문이라 선은 0을 잇는 톱니가 됩니다
- `sum(rate(X)) by (k) * 3600` 형태를 `by` 절 때문에 못 잡아 값이 수백 배 부풀던 제 변환 버그 하나

여기에 자체 대시보드 둘을 더했습니다. **Usage**는 25255가 다루지 않는 spanmetrics 지연 p50/p95, Tempo 트레이스 검색, VictoriaLogs 이벤트 스트림을 담습니다. **Optimization**은 아래에서 다룰 사용 패턴 분석용입니다.

셋 다 `victoria-metrics` 네임스페이스의 ConfigMap(라벨 `vm_grafana_dashboard=1`)으로 Grafana 사이드카가 읽어 갑니다. JSON은 손으로 만지지 않고 생성 스크립트 하나가 25255 원본을 패치하고 자체 대시보드를 조립해 매니페스트 하나로 뽑습니다. 그 파일이 montstrap의 `hub/opentelemetry/manifests/`에 들어가 argocd가 관리합니다.

VictoriaLogs Grafana 플러그인은 쿼리 형태에 규칙이 있어서 적어 둡니다. 시계열은 `statsRange`, 단일값은 `stats`(숫자만), 테이블은 `raw` 쿼리에 `| stats ...` 파이프를 붙이고 결과 labels를 컬럼으로 펼치는 변환이 필요합니다. `count_if`는 없고 `count() if (조건)`을 씁니다. `min(_time)`은 `raw`에서만 됩니다.

## 첫 인사이트: 세션 시작이 열 배

테스트 세션 여섯 요청의 api_request 이벤트만으로도 패턴이 보였습니다.

| 요청 | cache_read | cache_creation | 비용 |
|---|---|---|---|
| 세션 첫 요청 | 7,657 | 14,468 | $0.031 |
| 이후 요청 | 22k~24k | 0~1,300 | $0.003~0.006 |

시스템 프롬프트, 도구 정의, CLAUDE.md, 스킬 목록 14k 토큰을 캐시에 새로 쓰는 비용입니다. haiku라 $0.03이지만 opus면 $0.1 안팎이고 fable이면 그 두 배입니다. `claude -p`를 자주 돌리는 스크립트가 있으면 이 고정비가 쌓입니다.

훅도 수치가 나옵니다. 세션마다 훅 105개가 등록되고 프롬프트 하나에 UserPromptSubmit 100ms, Read 한 번에 Pre/Post 180ms가 붙습니다. `hook_execution_complete` 이벤트가 `hook_name`별 소요시간을 주니 도구 호출이 수백 번인 세션에서 어느 훅이 느린지 바로 드러납니다.

Optimization 대시보드는 이런 축으로 6개 행, 37패널입니다. 세션 시작 고정비와 캐시 미스, query_source × agent × model × effort 비용 교차표, 마라톤 세션의 컨텍스트 성장, 훅 오버헤드, 압축·429·재시도, 도구별 호출·실패·결과 크기. 메트릭에 `agent.name`, `skill.name`, `effort`, `query_source`(main/subagent/auxiliary) 레이블이 붙기 때문에 CLAUDE.md의 티어 규칙(explore는 haiku, executor는 sonnet, architect는 opus)이 실제로 지켜지는지 여기서 확인합니다.

## 프리픽스는 무엇으로 이루어졌나

콜드 스타트 14k 토큰이 무엇인지는 OTel이 알려주지 않습니다. 대신 `/context`가 알려줍니다. 공식 내장 명령이고 `claude -p '/context'`로 비대화형 실행이 됩니다. 로컬에서 추정만 하므로 Messages API를 부르지 않습니다. 실행 전후 api_request 이벤트 수가 그대로인 것으로 확인했습니다.

| 구성 요소 | 토큰 | 비고 |
|---|---|---|
| System prompt | 1.6k | |
| System tools | 5.7k | 항상 로드 |
| Memory files | 4.1k | `~/.claude/CLAUDE.md` 하나 |
| Custom agents | 3.2k | 37개, humanize-korean 플러그인 9개가 2.1k |
| Skills | 2k | 목록 상한(컨텍스트의 1%)에 잘림 |
| MCP tools (deferred) | 8.6k ~ 61.1k | 실행마다 다름 |
| System tools (deferred) | 15.7k | |

첫 요청에 캐시로 쓰이는 건 deferred를 뺀 16.6k입니다. 앞서 본 cache_creation 14.5k와 맞습니다. MCP 도구는 이름만 실리고 스키마는 ToolSearch로 불러올 때 들어옵니다. MCP는 콜드 스타트 비용이 아니라 세션 중 로드 비용입니다. MCP 수치가 실행마다 61k와 8.6k로 달라진 이유는 Notion MCP 연결 여부였고 Notion 도구 하나(`notion-query-data-sources`)가 19.7k입니다. 연결 자체의 불안정은 `mcp_server_connection` 이벤트로 따로 잡힙니다.

이 표를 매일 07:30에 찍어 VictoriaMetrics 게이지로 넣는 프로브를 만들었습니다. 프로브 세션이 세션 수에 잡히지 않도록 `--settings '{"env":{"CLAUDE_CODE_ENABLE_TELEMETRY":"0"}}'`로 텔레메트리를 끄고 돕니다. 스케줄러는 pod 안에 이미 있던 supercronic 방식을 따라 별도 crontab으로 두고 `~/.workspace-init.sh`에서 pod 기동 시 다시 띄웁니다. 기존 warmup crontab은 `render`가 통째로 다시 쓰기 때문에 섞지 않았습니다.

## 과거는 트랜스크립트에서

OTel은 켠 시점부터 쌓이는 스트림입니다. 지난 세션은 `~/.claude/projects/**/*.jsonl` 트랜스크립트에 있습니다. assistant 레코드마다 `message.model`과 `message.usage`가 남아 있고 usage에는 cache write가 5분 TTL과 1시간 TTL로 나뉘어 있어 단가 계산이 맞아떨어집니다.

트랜스크립트의 함정은 둘이었습니다. 같은 `requestId`가 content block마다 반복되므로 requestId로 묶지 않으면 두세 배로 셉니다. 그리고 서브에이전트 파일은 `<session>/subagents/agent-*.jsonl` 말고 `subagents/workflows/<wf_id>/` 아래에 훨씬 많습니다. 처음 훑었을 때 539개 파일만 잡혔는데 경로를 다시 보니 Workflow 에이전트 4,525개가 더 있었습니다.

백필 스크립트는 이걸 읽어 OTel과 같은 이름의 누적 카운터로 VictoriaMetrics에, 보존 기간 안쪽 7일은 api_request 이벤트로 VictoriaLogs에 넣습니다. 레이블에 `source="backfill"`과 `query_source=main|subagent|workflow`를 붙이고 OTel로 이미 나간 session_id와 텔레메트리를 켠 뒤 시작한 세션은 건너뜁니다.

| 항목 | 값 |
|---|---|
| 파일 | 5,065개 (main 183, 서브에이전트 356, Workflow 4,525) |
| 세션 / 요청 | 167 / 45,541 (2026-06-20부터) |
| 토큰 | 53.5억 |
| 추정 비용 | $5,285 (API 단가 환산) |

모델별로는 opus-5 $2,487, fable-5 $1,402, opus-4-8 $679, sonnet-5 $454. 출처별로는 main $3,727, workflow $1,048, subagent $533입니다. 구독으로 쓰고 있어 청구액과는 다르지만 OTel의 cost 메트릭도 같은 방식이라 서로 비교는 됩니다. 이 스크립트도 매일 07:35에 돌아 텔레메트리보다 먼저 떠서 아직 도는 세션을 따라잡습니다.

## 그래프가 끊기는 이유

백필 뒤 그래프 중간이 비어 보였습니다. 데이터 누락이 아니었습니다.

vmselect가 `search.maxStalenessInterval=30s`라 30초 이상 샘플이 없으면 그 시점엔 시리즈가 없는 것으로 칩니다. 요청이 있을 때만 샘플이 생기는 카운터라 요청 없는 구간은 값이 아예 없고 선이 끊깁니다. 12시간을 10분 단위로 조회하면 73칸 중 11칸에만 값이 있었습니다. 구간 합계 패널은 "없음"이 곧 0이므로 쿼리 끝에 MetricsQL `default 0`을 붙였습니다. 지연 p50/p95 같은 비율 패널엔 붙이지 않았습니다. 0ms는 거짓이기 때문입니다.

저장된 샘플 수가 밀어 넣은 수의 31%인 것도 놀랐습니다. `dedup.minScrapeInterval=30s`가 30초 안의 요청 여러 개를 마지막 하나로 합친 결과입니다. 누적 카운터라 합계는 보존됩니다. 모델별 비용 합계가 백필 추정치와 맞는 것으로 확인했습니다.

## 남은 것

- 이 글을 쓰는 세션은 설정보다 먼저 떠서 OTel로 나가지 않습니다. 백필이 매일 따라잡고 `claude --resume`으로 다시 열면 그 시점부터 OTel로 나갑니다.
- 같은 code-server에 있는 다른 사용자 pod 둘은 각자 홈의 settings.json이라 아직 아무것도 안 들어가 있습니다.
- Bash 명령별 집계는 아직 없습니다. `tool_input`이 JSON 문자열이라 LogsQL `unpack_json`으로 꺼내야 합니다.
- montstrap을 여러 Claude 세션이 같이 만지다 보니 푸시 직후 다른 세션의 커밋에 제 커밋이 밀려난 적이 있습니다. argocd selfHeal이 클러스터까지 되돌립니다. 푸시 전 rebase, 푸시 후 revision 확인이 필요합니다.
